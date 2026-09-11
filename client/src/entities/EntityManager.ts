/**
 * EntityManager (Phase 2) — maps ZDO updates to the scene.
 *
 * Static ZDOs (trees, rocks, building pieces, …) become THIN INSTANCES in
 * per-prefab buckets (the only sane way to render this much vegetation
 * density — see Docs/03 §4). Dynamic ZDOs (creatures, item drops, ships,
 * other players) become instantiated hierarchies with per-entity
 * transforms. LocationProxy ZDOs carry the feature hash for terrain
 * leveling (Unity TerrainModifier parity) and stay invisible.
 */
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
// Nur für `VertexBuffer.ColorKind`: Ob ein Netz schon Vertexfarben trägt,
// entscheidet, ob es eine Instanzfarbe bekommen darf (darfGetoentWerden).
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import {
  PrefabFlag,
  findPrefabByHash,
  isRenderable,
  getFeatureByHash,
  getRoomByHash,
  getKitByPrefabHash,
  getStableHash,
  getTerrainLeveling,
  FOLIAGE_HASHES,
  lebenAnteil,
  modellZu,
  AUSSEHEN_ORDNER,
  frisurZu,
  bartAusFrisur,
  haarfarbeZu,
  ruestungZu,
  istFrisur,
  // ── Kollision: alles aus `shared`, nichts mehr von hier ─────────────
  // `istFesterKoerper` sagt, WELCHES Prefab einen Koerper bekommt,
  // `kollisionsForm` WELCHE Form, `BEGEHBAR_NAME`, welches Bauwerk das
  // Flag-Gatter umgehen darf, `formUebersteuerung`, welche Handvoll
  // Prefabs ihre Form von Hand bekommt (die grossen Buesche), und
  // `storeKollision`, was der Speicher selbst ueber seine Kollision
  // sagt. Alle liest der Server ebenfalls — daran haengt, dass Bild und
  // Serverrechnung dieselben Hindernisse sehen.
  BEGEHBAR_NAME,
  formUebersteuerung,
  istFesterKoerper,
  kollisionsForm,
  kollisionsModellPfad,
  storeKollision,
} from '@wov/shared';
import type { KollisionsForm, NpcEinordnung, SteinKitConfig } from '@wov/shared';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { erzeugeSteinKitMaterial, mergeSteinKit } from '../engine/DungeonSteinMaterial.js';
import { faerbeHaar } from '../player/haarfarbe.js';
import { StaticColliderSet } from '../engine/Physics';

import {
  IMPOSTOR_GRENZE_M_VORGABE,
  SPRITE_STRIDE,
  teileZelle,
  yawUndSkala,
  zellLage,
} from '../engine/BaumImpostorKern';
// TYP-Import, damit hier kein Laufzeit-Zyklus entsteht: BaumImpostor.ts
// holt sich aus dieser Datei huellkoerperAufweiten() und
// zellMeshAusPrototyp() (die abgesegneten Bauwege), und ein Typ-Import
// wird beim Uebersetzen restlos entfernt. Ausserdem bleibt der statische
// Pfad damit ohne Szene konstruierbar (client/test/entity-index.ts baut
// `new EntityManager(null, …)`).
import type { BaumImpostor } from '../engine/BaumImpostor';
import type { AssetManager } from '../engine/AssetManager';
import type { TerrainManager } from '../engine/Terrain';
import {
  istGestreuteLandschaft,
  markiereAlsGestreuteLandschaft,
} from '../engine/RefraktionsAuswahl';
import type { ClientWorld } from '../world/World';
import type { ZDOEntityUpdate } from '../net/ZDOSync';

/** Flags whose ZDOs move on their own (server-side AI / physics). */
const DYNAMIC_FLAGS =
  PrefabFlag.ANIMAL_AI |
  PrefabFlag.MONSTER_AI |
  PrefabFlag.ITEM_DROP |
  PrefabFlag.SHIP |
  PrefabFlag.SYNCED_TRANSFORM;

const f32 = Math.fround;

/**
 * Radius around the player that carries collision bodies, in metres. Small
 * enough that a dense forest stays in the low hundreds of bodies instead of
 * the tens of thousands the view distance holds — building them for
 * everything visible pins the main thread outright.
 */
const COLLIDER_RANGE = 48;
/**
 * Zeitbudget pro Frame für Bucket-Neuaufbauten, in Millisekunden — dasselbe
 * Muster wie GrassClutters CELL_BUILD_BUDGET_MS.
 *
 * War vorher eine feste Stückzahl (2). Ein Neuaufbau kostet aber je nach
 * Instanzzahl des Prefabs mal 0,1 ms, mal mehrere Millisekunden — eine feste
 * Zahl trifft das falsche Mass. Besonders beim Sprinten: setPlayerPosition()
 * markiert dann mehrere Buckets gleichzeitig dirty, und zwei teure darunter
 * reissen das 16,7-ms-Budget in einem einzigen Frame.
 */
const REBUILD_BUDGET_MS = 4;

/**
 * Reserve, um die der Hüllkörper eines Thin-Instance-Masters aufgeweitet
 * wird, in Metern (D10).
 *
 * Seit die Master wieder am Frustum-Culling teilnehmen (siehe zuMaster()
 * in AssetManager) entscheidet ihr Hüllkörper darüber, ob sie gezeichnet
 * werden. Babylon rechnet ihn aus den Instanzmatrizen und der ROHEN
 * Geometrie — der Windshader verschiebt die Blattscheitel aber darüber
 * hinaus (WindPlugin.strength = 0,38 je Referenzhöhe; an Beech1
 * nachgerechnet im Mittel 0,84 m Ausschlag am äusseren Kronenrand, vor
 * der Ansatzdämpfung 1,48 m). Ohne Reserve könnte ein Baum am Bildrand
 * verschwinden, während sein Laub noch hineinragt.
 *
 * 1,5 m deckt den gemessenen Ausschlag mit Luft ab. Grosszügig zu sein
 * kostet hier fast nichts: Die Reserve verschiebt nur die Grenze, ab der
 * ein Master ohnehin ausserhalb des Bildes liegt.
 */
const SCHWUNG_RESERVE_M = 1.5;

/** Player travel that triggers a rebuild of the collision window. */
const COLLIDER_REBUILD_STEP = 12;
/**
 * Spielerweg bis die begrenzte Vegetationsauswahl neu gepackt wird.
 * 32 m vermeiden Matrix-Uploads in jedem Lauf-Frame; dieselbe Distanz
 * bleibt als aeussere Reserve stehen, damit zwischen zwei Neuaufbauten
 * kein Baum innerhalb der gewaehlten Grenze verschwindet.
 */
const VEGETATIONS_NEUPACK_M = 32;

/**
 * Reine Auswahlfunktion hinter der Vegetationsgrenze. Exportiert, damit
 * ihre wichtigste Zusicherung ohne Szene/GPU testbar bleibt: 0 liefert
 * unveraendert alles, eine Grenze prueft nur die X/Z-Translation.
 */
export function vegetationsMatrizenImRadius<T extends { m: ArrayLike<number> }>(
  matrizen: readonly T[],
  mitteX: number,
  mitteZ: number,
  radius: number
): readonly T[] {
  if (radius <= 0 || !Number.isFinite(radius)) return matrizen;
  const r2 = radius * radius;
  return matrizen.filter((matrix) => {
    const dx = Number(matrix.m[12]) - mitteX;
    const dz = Number(matrix.m[14]) - mitteZ;
    return dx * dx + dz * dz <= r2;
  });
}
/** ?showcolliders=1 — zeichnet die Kollisionsformen als Drahtgitter. */
const SHOW_COLLIDERS =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('showcolliders');

/**
 * Mehrere Master zu EINER Punktwolke in Prefab-Koordinaten zusammenlegen
 * — die Eingabe der gemeinsamen Formableitung.
 *
 * Die Master sind ein Netz je GLB-Submesh mit eigenem lokalen Versatz;
 * `formen.ts` will EINE Liste in Instanzkoordinaten und kennt keine
 * Matrizen. Umgerechnet wird deshalb hier, und zwar von Hand aus den
 * Matrixelementen: Ein Baum-GLB trägt Zehntausende Vertices, und ein
 * `Vector3` je Vertex (mal jedes Prefab) reicht, um einen Frame zu
 * verschlucken.
 *
 * `null`, wenn nichts zusammenkommt. Meshes ohne Indizes steuern ihre
 * Positionen bei (die Kiste/Kapsel misst sie mit), aber keine Dreiecke —
 * ein Netz-Collider kann sie nicht gebrauchen.
 *
 * Merges the masters' vertices into one prefab-local cloud for the shared
 * shape derivation.
 */
function netzAusMastern(
  meshes: readonly import('@babylonjs/core/Meshes/mesh').Mesh[],
  locals: readonly Matrix[]
): { positionen: Float32Array; indizes: Uint32Array | null } | null {
  const teile: {
    pos: Float32Array | number[];
    idx: ArrayLike<number> | null;
    m: Float32Array;
  }[] = [];
  let ecken = 0;
  let dreiecke = 0;
  for (let i = 0; i < meshes.length; i++) {
    const pos = meshes[i]!.getVerticesData(VertexBuffer.PositionKind);
    if (!pos) continue;
    const idx = meshes[i]!.getIndices();
    const local = locals[i];
    teile.push({
      pos,
      idx: idx && idx.length > 0 ? idx : null,
      m: (local ? local.m : Matrix.Identity().m) as unknown as Float32Array,
    });
    ecken += pos.length;
    dreiecke += idx ? idx.length : 0;
  }
  if (ecken === 0) return null;

  const positionen = new Float32Array(ecken);
  const indizes = dreiecke > 0 ? new Uint32Array(dreiecke) : null;
  let p = 0;
  let q = 0;
  for (const t of teile) {
    const e = t.m;
    const basis = p / 3;
    for (let v = 0; v < t.pos.length; v += 3) {
      const x = t.pos[v]!;
      const y = t.pos[v + 1]!;
      const z = t.pos[v + 2]!;
      positionen[p++] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      positionen[p++] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      positionen[p++] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    if (indizes && t.idx) for (let k = 0; k < t.idx.length; k++) indizes[q++] = basis + t.idx[k]!;
  }
  return { positionen, indizes: indizes === null ? null : indizes.subarray(0, q) };
}

/**
 * Kantenlänge einer Zelle des Umkreis-Index, in Metern.
 *
 * 32 m ist ein Kompromiss zwischen zwei Kosten: Kleinere Zellen filtern
 * schärfer, aber `nearbyInstances(…, 70)` (Minimap-Objektebene) müsste dann
 * hunderte Map-Zugriffe machen, und jeder leere Map-Zugriff ist auch nicht
 * gratis. Grössere Zellen sparen Zugriffe, schleppen dafür pro Zelle mehr
 * Instanzen mit, die die Abstandsprüfung wieder verwirft.
 *
 * Bei 32 m deckt die kleinste Abfrage (Fadenkreuz, 5 m) 1–4 Zellen ab, die
 * Namensschilder (40 m) 4–9, die Minimap (70 m) 9–25. Es ist die halbe
 * Kantenlänge einer ZoneSystem-Zone des Originals (64 m) — bewusst feiner,
 * weil die typische Abfrage hier viel kleiner ist als eine ganze Zone.
 */
const INDEX_ZELLE_M = 32;

/**
 * Zellenschlüssel aus Zellenkoordinaten.
 *
 * Zwei 16-Bit-Felder in EINER Zahl, statt eines Strings `"cx,cz"`: Der
 * String müsste pro Zugriff frisch gebaut werden, und genau das läuft hier
 * pro Frame hundertfach. Der Versatz um 0x8000 macht negative Koordinaten
 * mit — die Welt geht von -10500 bis +10500 m, also ±329 Zellen, weit
 * innerhalb des Feldes.
 */
const zellenSchluessel = (cx: number, cz: number): number =>
  ((cx + 0x8000) << 16) | (cz + 0x8000);

/**
 * Kantenlänge einer RENDER-Zelle, in Metern (E19 c).
 *
 * ── Der Befund, der diese Zahl erzwingt ──────────────────────────────
 * Bis hierher hielt der EntityManager EINEN Master je (Prefab ×
 * verschmolzenem Submesh) für die ganze Welt. Bei `leaves_merged` waren
 * das bis zu 3391 Instanzen in einem einzigen Mesh mit 425 m Hüllkörper.
 * Gemessen auf der Insel (Teleport 10077/-18723, Tageszeit gepinnt auf
 * 0,42): GPU zu 100 % ausgelastet, GPU-Bild 20,2 ms, davon rund 58 %
 * Schattenpass — und von 24.265 Vegetationsinstanzen erreichten je
 * Kaskade nur 14–15 % überhaupt die Schattenkarte. 85 % der
 * Einreichungen waren umsonst.
 *
 * Keulen konnte daran nichts: Shadows.darfWerfen() rechnet
 * `hypot(mitte − spieler) − radius <= kaskadendistanz`, und bei einem
 * Hüllradius von rund 212 m ist das für jede Kaskadendistanz erfüllt.
 * Der Master als GANZES ist immer nah. Erst kleine Hüllen machen die
 * vorhandene Prüfung wirksam: Bei 128 m Kante ist der Hüllradius rund
 * 90 m + Kronenhöhe, die Zelle fällt also ab etwa 240 m Mittelpunkts-
 * abstand aus der Werferliste statt nie.
 *
 * ── Warum 128 und nicht 8, 40 oder 64 ────────────────────────────────
 * Das Original schneidet Gras in 8-m-Patches, weil dort zehntausende
 * Halme auf engstem Raum liegen; für Bäume benutzt es gar kein Raster,
 * sondern je Baum ein GameObject mit LODGroup. Unser GrassClutter fährt
 * 40 m. Für Vegetations-Prefabs ist die Gegenkraft aber die ANZAHL der
 * Master: Der bestbelegte Messwert des Projekts (AssetManager-Kopf, D10)
 * sagt 435 Master = 9,4 ms gegen 124 Master = 3,3 ms, während die
 * Instanzzahl praktisch nichts kostet. Jede Halbierung der Kantenlänge
 * vervierfacht die Zellenzahl.
 *
 * 128 m ist das 4-fache von INDEX_ZELLE_M (32) und das Doppelte einer
 * ZoneSystem-Zone des Originals (64): gross genug, dass ein
 * Streaming-Gebiet von rund 640 m in eine überschaubare Zahl Zellen
 * zerfällt (≈ 25 belegte je Prefab statt 400 bei 32 m), klein genug,
 * dass die Entfernungsprüfung wirklich beisst.
 *
 * Bewusst eine EIGENE Konstante neben INDEX_ZELLE_M: Der Umkreis-Index
 * hat seine 32 m aus ganz anderen Gründen (Fadenkreuz 5 m,
 * Namensschilder 40 m, Minimap 70 m) und darf nicht mitwandern, wenn
 * hier jemand nachmisst. Nur `zellenSchluessel()` wird geteilt — ±82
 * Zellen bei ±10500 m Welt passen weit in seine 16-Bit-Felder.
 */
const RENDER_ZELLE_M = 384;

/**
 * Harte Obergrenze der Instanzen je Zell-Master (E19 c).
 *
 * Übernommen vom Vorbild: Dessen InstanceRenderer bündelt höchstens
 * 1024 Instanzen je Gruppe und prüft das Frustum pro Gruppe. Eine dichte
 * 128-m-Zelle kann mehr als das halten (leaves_merged hat insgesamt bis
 * 3391), deshalb hält jede Zelle eine LISTE von Meshes und füllt sie in
 * Blöcken. Die Blöcke einer Zelle liegen räumlich übereinander und
 * bringen für sich keine Keulung — sie halten nur die einzelne
 * Einreichung in der Grössenordnung, in der das Original sie hält.
 */
const ZELL_MAX_INSTANZEN = 1024;

/**
 * Ab wie vielen Instanzen ein Bucket überhaupt zellweise geschnitten
 * wird.
 *
 * Der Schnitt kostet je Zelle einen Zeichenaufruf und eine Kopie der
 * Geometrie; er zahlt sich nur, wo viele Instanzen weit gestreut liegen.
 * Ortsfeste Bauwerke bleiben deshalb ungeschnitten — für sie greift das
 * Culling seit D10 ohnehin (der Grabhügel stellt allein 10 der rund 58
 * Master einer Grasland-Sitzung und fällt als Ganzes weg, sobald man
 * wegschaut).
 *
 * 128 ist bewusst niedrig genug, dass die dicke Vegetation sicher
 * erfasst wird, und hoch genug, dass ein Bucket mit einer Handvoll
 * Instanzen nicht in fünf Zellen zerfällt. Es schützt zugleich einen
 * stillen Mitleser: HuegelGras liest `thinInstanceCount` und
 * `thinInstanceGetWorldMatrices` direkt vom Grabhügel-Master (s.
 * HuegelGras.ts) und setzt voraus, dass EIN Mesh alle Instanzen trägt —
 * Grabhügel liegen zu wenige in der Welt, um je über diese Schwelle zu
 * kommen.
 */
// ── Sweep-Befund (18.08.2026) und die Rolle, die daraus folgt ───────
// Der Zellschnitt funktioniert und erreicht sein GPU-Ziel — aber auf
// dem Referenzsystem (7900 XT + schneller CPU) schlaegt KEINE Koernung
// den Voll-Master-Stand in der Frame-Zeit. Der Sweep, Insel 10077/-18723,
// Tageszeit 0,42 gepinnt, headed, je 400 Bilder:
//
//   Zelle    CPU-Frame   GPU-Frame   GPU-Takt
//   128 m    26,6 ms     20,3 ms     1255 MHz   (GPU wartet auf CPU)
//   192 m    24,8 ms     18,9 ms     1526 MHz
//   256 m    20,6 ms     15,7 ms     2104 MHz
//   384 m    17,2 ms     13,5 ms     2519 MHz   <- Sweet Spot, -21 % GPU-Arbeit
//   ohne     16,3 ms     17,1 ms     2564 MHz   (Voll-Master, ein Call je Prototyp)
//
// Die beiden Kurven schneiden sich nicht: Was die GPU spart, zahlt die
// CPU in WebGL-Zeichenaufrufen (546 -> 1128 bei 128 m). Der Schnitt ist
// damit kein fps-Hebel FUER SICH, sondern der UNTERBAU fuer den Schritt,
// der beide Kurven zugleich senkt: das Impostor-Fernfeld (Roadmap E10-
// Revision nach ClaudeCraft-Vorbild) — ferne Zellen werden nicht kleiner
// gezeichnet, sondern durch 2-Dreiecke-Sprites ERSETZT.
//
// ── REAKTIVIERT (18.08.2026), weil genau dieser Schritt jetzt da ist ─
// Der Schnitt ist der Unterbau des Sprite-Fernfeldes, und zwar in zwei
// Rollen, die er beide ALLEIN nicht ausspielen konnte:
//
//  1. Die ZELLE ist die Wechseleinheit. Der Vorfilter in
//     BaumImpostorKern.zellLage() prueft Nah- und Fernkante EINER Zelle
//     und spart damit fuer die allermeisten Zellen die Pro-Instanz-
//     Rechnung; ohne Zellen gaebe es nur die flache Liste eines Prefabs.
//  2. Nur mit kleinen Huellen kann eine ferne Zelle als GANZES aus Bild-
//     und Werferpass fallen. Genau das ist der CPU-Hebel: Wo frueher
//     1128 Zell-Master gezeichnet wurden, zeichnen jetzt die nahen
//     Zell-Master plus EIN Sprite-Mesh je ferner Zelle.
//
// RENDER_ZELLE_M bleibt bei den gemessenen 384 m. Die Kante ist gross
// gegen die Uebergabegrenze (240 m) und gegen das Streaming-Fenster
// (9x9 Zonen a 64 m = 576 m, WovServer.SICHT_RADIUS_ZONEN); es gibt
// deshalb kaum eine Zelle, die ganz jenseits der Grenze liegt. Genau
// dafuer hat teileZelle() den Zweig 'geteilt': Eine Zelle auf der Grenze
// reicht ihre nahen Instanzen an den echten Zell-Master und ihre fernen
// ans Sprite-Feld. Der Vorfilter ist eine Abkuerzung, nicht die Regel.
// ⚠ 18.08.2026, ZWEITE Parkung — jetzt inklusive Impostor-Fernfeld.
// Die Messung des Impostor-Pakets (Workflow, solo headed, Basis in
// derselben Sitzung reproduziert) ergab: Das Sprite-Feld leistet exakt
// null (Kontrolle "Sprites aus" im selben Build: 21,0 gegen 21,1 ms,
// 733 gegen 734 Calls), das Gesamtpaket ist +33 % Regression gegen die
// Voll-Master-Basis (16,1 ms). Die Buchhaltung erklaert es: Bei 384-m-
// Zellen in einem Streamingfenster von nur 576 x 576 m (SICHT_RADIUS_
// ZONEN = 4) entfernen die Sprites zwar Instanzen, aber nur 9 von 136
// Zell-Mastern — die Zeichenaufrufe bleiben, und die sind der Engpass.
// Dazu zwei kritische Baking-Fehler (Review): Atlas-Zeilen werden vor
// der Material-Bereitschaft gebacken (bleiben leer) und das Albedo
// landet quadriert im Atlas. Beides nicht repariert, weil das Konzept
// an der Fenstergeometrie scheitert, nicht an den Fehlern.
const ZELL_SCHNITT_AB = Number.MAX_SAFE_INTEGER;

/**
 * Wie weit der Spieler laufen darf, bevor die Zuteilung echt/Sprite neu
 * gerechnet wird (m).
 *
 * ── Warum ueberhaupt eine Schwelle ──────────────────────────────────
 * Die Zuteilung haengt an der Spielerposition, ihr Neuaufbau ist aber ein
 * voller Bucket-Umbau (Matrixmultiplikation je Instanz plus GPU-Upload).
 * Je Bild waere das genau die Sorte Pufferverkehr, die in
 * SchattenInstanzKeulung.ts mit 18 -> 59 ms vermessen ist. Also derselbe
 * Weg wie bei COLLIDER_REBUILD_STEP: abstandsgetaktet, ueber das
 * REBUILD_BUDGET_MS von flush() verteilt.
 *
 * ── Warum 32 und nicht weniger ──────────────────────────────────────
 * Die Zuteilung friert zwischen zwei Neupackungen ein und haengt der
 * Bewegung um bis zu diesen Betrag hinterher. Ein Baum kann also bereits
 * bei GRENZE - 32 m als Sprite stehen. Das darf die Schattenweite nicht
 * unterschreiten, sonst fehlt ein Schlagschatten:
 *
 *     240 m (Uebergabe) - 32 m (Nachlauf) = 208 m > 150 m (shadowMaxZ)
 *
 * Wer die Uebergabegrenze senkt (der geplante Sweep 150/180/240), muss
 * diese Ungleichung mitrechnen.
 *
 * Groesser als COLLIDER_REBUILD_STEP (12 m), weil hier der TEURE Pfad
 * dranhaengt: dirty statt colliderDirty.
 */
const SPRITE_NEUPACK_M = 32;

/** Obergrenze des Wiederverwendungs-Pools je (Prefab, Prototyp) — s. zellMeshFreigeben(). */
const ZELL_POOL_DECKEL = 16;

/**
 * Eine statische Instanz, wie `nearbyInstances()` sie herausgibt.
 *
 * Bewusst nur lesbar: Die Aufrufer bekommen die INTERNEN Indexeinträge
 * gereicht, nicht Kopien. Das spart pro Frame ein frisches Objektliteral je
 * gefundener Instanz — wer etwas davon behalten will, muss die Felder
 * einzeln übernehmen (s. ObjectLabels), niemals das Objekt selbst.
 */
export interface StatischeInstanz {
  readonly prefab: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Indexeintrag EINER statischen Instanz — Nutzsicht ist `StatischeInstanz`. */
interface IndexEintrag {
  prefab: string;
  x: number;
  y: number;
  z: number;
  /** Zelle, in der der Eintrag gerade hängt. */
  zelle: number;
  /** Platz im Zellen-Array. Macht das Entfernen O(1) statt indexOf(). */
  platz: number;
}

/**
 * Schlüssel eines statischen Buckets: der Prefabhash allein — und NUR wenn
 * ein Raum-Steinmaterial daran hängt, der Hash plus dessen JSON.
 *
 * Warum das JSON und nicht der Raumindex: Zwei Kammern mit demselben
 * Override sollen auch denselben Bucket (und damit ein Material und einen
 * Zeichenaufruf) teilen — der Index würde sie trennen, obwohl sie gleich
 * aussehen. Und ohne Override bleibt der Schlüssel wortgleich der alte,
 * es entsteht also kein zweiter Bucket, wo es früher einen gab.
 * Bucket key: prefab hash alone, or hash + the room override's JSON.
 */
function bucketSchluessel(prefabHash: number, ueberschreibung: string): string {
  return ueberschreibung ? `${prefabHash}|${ueberschreibung}` : String(prefabHash);
}

/**
 * Das JSON des Raum-Overrides einmal lesen. Unlesbares ergibt `undefined` —
 * dann gilt die Kette bis zum `RoomDef`, und die Kammer sieht aus wie ihr Typ.
 * Ein Wurf wäre hier falsch: Der Wert kommt über die Leitung, und ein einzelner
 * kaputter Member darf nicht den Aufbau der ganzen Welt anhalten.
 */
function leseSteinKitOverride(json: string): Partial<SteinKitConfig> | undefined {
  if (!json) return undefined;
  try {
    const roh: unknown = JSON.parse(json);
    if (!roh || typeof roh !== 'object') return undefined;
    return roh as Partial<SteinKitConfig>;
  } catch {
    console.warn('[EntityManager] unlesbares steinKit am Raum-ZDO — ignoriert');
    return undefined;
  }
}

interface StaticBucket {
  prefabName: string;
  /** Prefab des Buckets — der Collider-Pfad braucht die Prefab-Definition. */
  prefabHash: number;
  /** Schlüssel in `buckets`, s. {@link bucketSchluessel}. */
  schluessel: string;
  /**
   * Schlüssel für `masterMeshes`/`masterLocals`/`zellMaster`/`colliders` —
   * `prefabName`, oder `prefabName#<Override-JSON>` beim Override-Bucket.
   *
   * Getrennt vom Prefabnamen, weil sich zwei Buckets desselben Prefabs sonst
   * gegenseitig Master UND Kollisionsauswahl (samt deren Signatur)
   * überschrieben. Ohne Override ist er gleich `prefabName` — alles bleibt
   * wie zuvor.
   */
  masterKey: string;
  /**
   * Rohes JSON des Raum-Overrides (ZDO-Member `steinKit`), '' wenn keiner —
   * wortgleich vom Server übernommen und Teil von `schluessel`.
   */
  steinKitOverride: string;
  /** `steinKitOverride` EINMAL geparst; undefined, wenn keiner/unlesbar. */
  steinKitCfg?: Partial<SteinKitConfig>;
  /** zdoKey → flat matrix index */
  indexOf: Map<string, number>;
  /** flat f32 matrix buffer (16 per instance), swap-remove on destroy */
  matrices: number[];
  /** Renderdaten (Thin-Instance-Puffer) UND Collider müssen neu — ZDO-Änderung. */
  dirty: boolean;
  /** Nur der Collider muss neu — reines Verschieben des Kollisionsfensters,
   *  s. setPlayerPosition(). Renderdaten bleiben unverändert. */
  colliderDirty: boolean;
  mastersReady: boolean;
}

/**
 * Eine dynamische Instanz, wie die Namensschilder sie brauchen: wer sie ist,
 * wo sie steht und wie gross sie geraten ist. Wird WIEDERVERWENDET —
 * siehe dynamischeInstanzen().
 */
export interface DynamischeInstanz {
  /** ZDO-Schlüssel (`userId:id`, im Testflug `edplace-<i>`/`edghost`). */
  key: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  /** Weltskalierung auf der Hochachse (localScale × ZDO-Skalierung). */
  skalierungY: number;
  /**
   * Leben in PROZENT, oder -1 für „unbekannt".
   *
   * Prozent und nicht Trefferpunkte, weil hier der einzige Ort ist, an dem
   * Wert und Prefabname sicher zusammenliegen — das Namensschild bekommt
   * die Instanz, kennt aber deren Maximalwert nicht ohne einen zweiten
   * Tabellenzugriff. Umgerechnet wird mit `lebenAnteil` (shared/leben.ts).
   */
  leben: number;
}

/** Minimalform von Vector3 aus den Prefab-Daten. */
interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface DynamicEntity {
  root: TransformNode;
  /**
   * Angelegte Aussehen-Teile eines FREMDEN Spielers, nach Slot.
   * Gemerkt wird, WAS haengt, damit ein Wechsel im Spiel nur den
   * betroffenen Slot austauscht statt alles neu zu laden.
   */
  aussehen?: Map<string, { datei: string; wurzel: TransformNode }>;
  /** Letztes Server-Ziel — updateDynamics() gleitet pro Frame dorthin. */
  ziel?: { pos: Vector3; rot: Quaternion };
  /**
   * Prozedurale Gangart für Kreaturen OHNE echte Animationsclips — und das
   * sind alle Tiere: sämtliche 1.142 AnimationClips des Exports haben null
   * Kurven (komprimiertes Mecanim wurde nie dekodiert), die Tier-GLBs sind
   * ungeskinnte Starrkörper. Basis (Server-Ziel) und Anzeige (Wippen)
   * liegen getrennt, sonst flösse der Wipp-Offset in die nächste
   * Interpolation ein und die Kreatur schaukelte sich auf.
   */
  gang?: { basisPos: Vector3; basisRot: Quaternion; phase: number; tempo: number };
  /**
   * Zuletzt gestartete Animationsgruppe. Der Server schickt den
   * Bewegungszustand nur bei Änderung, aber JEDES Update trägt ihn — ohne
   * diesen Vergleich würde die Gruppe im Sync-Takt neu gestartet und der
   * Zyklus bliebe im ersten Bild hängen.
   */
  anim?: string;
  /**
   * Leben in Prozent, -1 = unbekannt. Wird NUR überschrieben, wenn das
   * Update den Member wirklich trägt: Ein Tick ohne `health` heisst „hat
   * sich nicht geändert", nicht „ist auf null gefallen".
   */
  leben?: number;
}

/** Wiederverwendetes Nick-Quaternion des prozeduralen Gangs (kein Alloc pro Frame). */
const GANG_NICK_TMP = new Quaternion();

/**
 * Den Hüllkörper eines Thin-Instance-Masters um SCHWUNG_RESERVE_M
 * aufweiten — nach jedem Schreiben des Matrixpuffers aufzurufen.
 *
 * Exportiert, weil das die Zusicherung ist, an der die Sichtbarkeit hängt:
 * `client/test/master-huelle.ts` prüft ohne GPU nach, dass der Kasten jede
 * gesetzte Instanz vollständig enthält. Ein Hüllkörper, der eine Instanz
 * auslässt, lässt das Objekt im Spiel verschwinden — und zwar nur aus
 * bestimmten Blickwinkeln, also genau die Sorte Fehler, die man beim
 * Durchklicken nicht findet.
 *
 * Kein Alloc je Neuaufbau: `reConstruct` schreibt mit `copyFromFloats` in
 * die bestehenden Vektoren des Hüllkörpers, und die beiden Endpunkte
 * kommen aus wiederverwendeten Arbeitsvektoren.
 */
export function huellkoerperAufweiten(mesh: Mesh, reserve = SCHWUNG_RESERVE_M): void {
  const info = mesh.getBoundingInfo();
  const min = info.minimum;
  const max = info.maximum;
  info.reConstruct(
    RESERVE_MIN_TMP.copyFromFloats(min.x - reserve, min.y - reserve, min.z - reserve),
    RESERVE_MAX_TMP.copyFromFloats(max.x + reserve, max.y + reserve, max.z + reserve),
    mesh.getWorldMatrix()
  );
}

/** Arbeitsvektoren für huellkoerperAufweiten (kein Alloc je Neuaufbau). */
const RESERVE_MIN_TMP = new Vector3();
const RESERVE_MAX_TMP = new Vector3();

// ── Instanz-Tönung der Store-Vegetation ─────────────────────────────
//
// ── Das Problem ─────────────────────────────────────────────────────
// Ein Store-Wald sieht GESTEMPELT aus. Der Grund steht in der
// Look-Analyse (§2 „Vegetation"): Der Shader des Vorbilds färbt jedes
// Blatt aus einem WELTRAUM-Rauschen (`LeafNoiseColour`,
// `ColourNoiseLargeScale`) — zwei Bäume derselben Art tragen dort nie
// exakt dieselbe Farbe. Unsere Bäume dagegen teilen sich ein Material
// und damit einen einzigen `baseColorFactor`; 400 Fichten sind 400 mal
// dieselbe Fichte, und das sieht das Auge sofort, auch wenn es nicht
// benennen kann, woran es liegt.
//
// ── Der billige Ersatz ──────────────────────────────────────────────
// Kein Shader-Rauschen, sondern eine Farbe JE INSTANZ über den
// Thin-Instance-Puffer `color`. Babylon multipliziert sie im
// Fragmentshader auf die Albedo (VERTEXCOLOR/INSTANCESCOLOR); sie kostet
// vier Floats je Instanz und keinen einzigen Zeichenaufruf.
// `GrassClutter` geht diesen Weg seit jeher (dort `terrainTint`) — der
// Zeuge dafür, dass er in dieser Pipeline trägt.
//
// ── Woher der Zufall kommt ──────────────────────────────────────────
// Aus der WELTPOSITION, nicht aus dem Instanzindex. Der Index ändert
// sich bei jedem Neuaufbau des Buckets (Swap-Remove in removeZDO,
// Streaming, Sprite-Umverteilung); ein Baum wechselte dann beim
// Vorbeilaufen die Farbe. Die Position ist die einzige Grösse, die ein
// gestreuter Baum über seine ganze Lebensdauer behält.

/** Ist die Tönungsstreuung an? `false` stellt den Zustand davor her. */
export const INSTANZ_TOENUNG_AN = true;

/**
 * Halbe Bandbreite der Helligkeitsstreuung (Anteil der Luma).
 *
 * 0,07 heisst: die dunkelste Instanz trägt 93 %, die hellste 107 % der
 * Materialfarbe. Die Look-Analyse nennt 5–8 % als das Fenster, in dem
 * ein Wald aufhört, gestempelt zu wirken, ohne dass einzelne Bäume als
 * „falsch gefärbt" auffallen.
 */
export const TOENUNG_LUMA = 0.07;

/**
 * Halbe Bandbreite der Farbtondrift (warm/kühl), gegenläufig auf R und B.
 *
 * Bewusst kleiner als die Helligkeit: Ein Grünton, der um 5 % nach Rot
 * kippt, liest sich als anderer Baum; einer, der um 15 % kippt, liest
 * sich als kranker Baum. R hoch UND B runter zugleich, damit die Luma
 * dabei nahezu erhalten bleibt und sich die beiden Achsen nicht
 * gegenseitig verrechnen.
 */
export const TOENUNG_TON = 0.05;

/**
 * Zwei unabhängige Zufallszahlen in [0,1) aus einer Weltposition.
 *
 * Ganzzahliges Mischen, damit dasselbe Paar (x, z) IMMER dieselben zwei
 * Zahlen ergibt — auf jeder Maschine, in jeder Sitzung, in jeder
 * Reihenfolge. Das ist die Zusage, die `client/test/instanz-toenung.ts`
 * festhält.
 *
 * Gerastert wird auf 10 cm. Ohne Rasterung entschiede das letzte Bit
 * einer f32-Position über die Farbe, und die ist zwischen Serverwert und
 * zurückgerechneter Weltmatrix nicht bitgleich — derselbe Baum bekäme
 * nach einem Neuaufbau eine andere Farbe.
 */
export function toenungsRauschen(x: number, z: number): { a: number; b: number } {
  let h = Math.imul(Math.round(x * 10) | 0, 0x27d4eb2d);
  h ^= h >>> 15;
  h = (h + Math.imul(Math.round(z * 10) | 0, 0x165667b1)) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  let g = Math.imul(h ^ 0x9e3779b9, 0xc2b2ae35);
  g ^= g >>> 15;
  g = Math.imul(g, 0x27d4eb2d);
  g ^= g >>> 13;
  return { a: (h >>> 0) / 4294967296, b: (g >>> 0) / 4294967296 };
}

/**
 * Die Instanzfarbe eines gestreuten Objekts an (x, z), in `aus` ab `o`.
 *
 * Multiplikativ auf die Albedo: 1,0 ist „unverändert". Nach OBEN wird
 * nicht gedeckelt — ein Faktor über 1 hellt auf, und das ist die halbe
 * Streuung. Nach unten gegen Null schon, damit eine künftig grössere
 * Amplitude keine negativen Farben erzeugt.
 */
export function instanzToenung(x: number, z: number, aus: Float32Array, o: number): void {
  const { a, b } = toenungsRauschen(x, z);
  const luma = 1 + TOENUNG_LUMA * (2 * a - 1);
  const ton = TOENUNG_TON * (2 * b - 1);
  aus[o] = Math.max(0, luma * (1 + ton));
  aus[o + 1] = Math.max(0, luma);
  aus[o + 2] = Math.max(0, luma * (1 - ton));
  aus[o + 3] = 1;
}

/**
 * Darf dieser Master eine Instanzfarbe bekommen?
 *
 * Zwei Bedingungen, beide gemessen statt behauptet:
 *
 *  1. Das Modell kommt aus dem Store (`store/` oder `store-lab/`). Die
 *     eigenen Altmodelle bleiben, wie sie sind — sie gehören nicht zu
 *     dieser Stufe, und eine Farbänderung an ihnen wäre eine
 *     Look-Entscheidung, die niemand getroffen hat.
 *  2. Das Netz bringt KEINE eigene Vertexfarbe mit. Im Store tun das
 *     genau vier Modelle, und es sind die vier Grasbüschel
 *     (`grass-short-clump-*`; gemessen R 0,01…0,13, G 0,00…1,00 — eine
 *     Halmmaske, keine Farbe). Getönt würde dort eine fremde Maske
 *     multipliziert, und Gras gehört ohnehin Bauer „Gras und Wasser".
 *     Erkannt wird das nicht über eine Namensliste, sondern weil das Netz
 *     selbst es sagt.
 *
 * ── Warum `ColorKind` und nicht `ColorInstanceKind` ──────────────────
 * Weil die Frage „bringt dieses Netz eine eigene Farbe mit" lautet und
 * nicht „habe ich hier schon getönt". Die beiden liegen in Babylon
 * NEBENEINANDER, nicht übereinander: `thinInstanceSetBuffer('color', …)`
 * schaltet den `kind` intern auf `instanceColor` um (8.56.2,
 * `thinInstanceMesh.js` Zeile 138, Kommentar „hot switching kind here to
 * preserve backward compatibility"), und der Shader multipliziert dann
 * beide (`vertexColorMixing`: `vColor *= instanceColor`,
 * `pbrBlockAlbedoOpacity`: `surfaceAlbedo *= vColor.rgb`).
 *
 * Das ist nachgesehen worden, weil die erste Fassung genau hier daneben
 * lag: Sie fragte `getVertexBuffer('color')` ab, um den eigenen Puffer
 * wiederzuerkennen — und fand ihn nie, weil er unter dem anderen Namen
 * liegt. Der Fehler war nicht sichtbar (die Tönung wirkte trotzdem), nur
 * die Begründung war falsch.
 */
function darfGetoentWerden(mesh: Mesh, modell: string | null, an: boolean): boolean {
  if (!an) return false;
  if (!modell || !/^store(-lab)?\//.test(modell)) return false;
  return !mesh.isVerticesDataPresent(VertexBuffer.ColorKind);
}

/**
 * Die Farbpuffer, die dieses Modul je Master schon angelegt hat.
 *
 * Sie werden WIEDERVERWENDET, und das ist keine Sparsamkeit um ihrer
 * selbst willen: `thinInstanceSetBuffer` legt jedes Mal einen neuen
 * `VertexBuffer` an und hängt ihn über `setVerticesBuffer` in die
 * Geometry — das ist eine GPU-Pufferanlage und ein
 * `_markSubMeshesAsAttributesDirty` je Aufruf. Die Buckets werden beim
 * Laufen dauernd neu gebaut (Streaming, Vegetationsgrenze), also fiele
 * das in jeden zweiten Sprintabschnitt.
 *
 * Bleibt die Instanzzahl gleich, wird deshalb nur der Inhalt neu
 * geschrieben und Babylon über `thinInstanceBufferUpdated` gesagt, dass
 * es den vorhandenen Puffer hochladen soll.
 *
 * Eine WeakMap, damit der Puffer mit seinem Master stirbt — Zell-Master
 * kommen aus einem Pool und werden entsorgt.
 */
const TOENUNGS_PUFFER = new WeakMap<Mesh, Float32Array>();

/**
 * Den Farbpuffer eines Masters schreiben — oder ihn ausdrücklich
 * abräumen.
 *
 * Das Abräumen ist kein Beiwerk: Zell-Master kommen aus einem POOL und
 * werden zwischen Prefabs wiederverwendet. Ein liegengebliebener
 * Farbpuffer träfe dann ein anderes Modell mit einer Instanzzahl, die
 * nicht mehr passt. Deshalb wird bei JEDEM Aufbau entschieden, auch für
 * `anzahl = 0`.
 */
function schreibeToenung(
  mesh: Mesh,
  mats: readonly Matrix[] | null,
  indizes: readonly number[] | null,
  anzahl: number
): void {
  if (!mats || anzahl === 0) {
    if (TOENUNGS_PUFFER.has(mesh)) {
      TOENUNGS_PUFFER.delete(mesh);
      mesh.thinInstanceSetBuffer('color', null, 4, false);
    }
    return;
  }
  const vorhanden = TOENUNGS_PUFFER.get(mesh);
  const puffer = vorhanden && vorhanden.length === anzahl * 4 ? vorhanden : new Float32Array(anzahl * 4);
  for (let k = 0; k < anzahl; k++) {
    const m = mats[indizes ? indizes[k]! : k]!.m;
    instanzToenung(m[12]!, m[14]!, puffer, k * 4);
  }
  if (puffer === vorhanden) {
    // Derselbe Puffer, neuer Inhalt: nur hochladen, keinen VertexBuffer
    // neu anlegen und keine Defines anfassen.
    mesh.thinInstanceBufferUpdated('color');
  } else {
    TOENUNGS_PUFFER.set(mesh, puffer);
    mesh.thinInstanceSetBuffer('color', puffer, 4, false);
  }
}

/**
 * Der EINE Weg, einen Thin-Instance-Puffer zu setzen — Puffer, Hülle,
 * Sichtbarkeit, in dieser Reihenfolge.
 *
 * Stand vorher wörtlich in rebuildBucketInstances(). Seit dem Zellschnitt
 * (E19 c) gibt es diese Stelle nicht mehr einmal, sondern in jedem
 * Zellauf- und -abbaupfad; jede vergessene Wiederholung liefert eine
 * eingefrorene Hülle und damit einen Werfer, den der Schattenpass als
 * GANZES keult (Babylon-Forum 33711/51901) — also fehlende Schatten ohne
 * jede Fehlermeldung. Deshalb steht die Dreierfolge nur noch hier.
 *
 * Ein LEERER Master bekommt `null`, nicht einen Puffer der Länge 0.
 * Beides schaltet ihn ab, aber nur bei `null` stellt Babylon den
 * Hüllkörper der Rohgeometrie wieder her; mit einem leeren Puffer läuft
 * seine Min/Max-Schleife über null Instanzen und hinterlässt ±Infinity
 * (thinInstanceMesh.js:103 gegen :109). Solange der Master abgeschaltet
 * ist, sieht man davon nichts — aber ein Hüllkörper aus Unendlichkeiten
 * ist eine Falle für jeden, der ihn später ausliest, und seit D10 lesen
 * ihn zwei Stellen aus (Frustumprüfung und Shadows.darfWerfen).
 * Aufgefallen in client/test/master-huelle.ts.
 */
function schreibeInstanzen(mesh: Mesh, daten: Float32Array | null): void {
  mesh.thinInstanceSetBuffer('matrix', daten, 16, false);
  // setBuffer hat den Hüllkörper soeben über alle Instanzen neu gespannt
  // (thinInstanceMesh.js:103) — jetzt ist der Moment, ihm die Windreserve
  // zu geben. Vorher wäre sie wieder überschrieben.
  huellkoerperAufweiten(mesh);
  mesh.setEnabled(daten !== null);
}

/**
 * Rohgeometrie je Prototyp-Master, EINMAL aus dem Mesh gezogen.
 *
 * Modulweit und über eine WeakMap, damit sie mit dem Prototyp stirbt und
 * damit `zellMeshAusPrototyp()` ohne Manager-Instanz benutzbar bleibt —
 * client/test/master-huelle.ts prüft damit den echten Bauweg statt einer
 * Nachbildung.
 */
const ZELL_GEOMETRIE = new WeakMap<Mesh, VertexData>();

/**
 * Ein Zell-Master aus einem Prototyp-Master (E19 c).
 *
 * ── Warum VertexData und nicht mesh.clone() ──────────────────────────
 * Der Kardinalfehler dieses Umbaus wäre geteilte Geometrie. Babylon hängt
 * die Instanzmatrizen NICHT ans Mesh, sondern an die Geometry:
 * `thinInstanceSetBuffer('matrix', …)` legt die Vertexpuffer world0..3
 * über `mesh.setVerticesBuffer()` an (thinInstanceMesh.js:88 →
 * mesh.js:1396), und `mesh.clone()` reicht die Geometry der Quelle
 * einfach weiter (mesh.js:350). Zwei Zell-Master auf einer Geometry
 * überschrieben sich also gegenseitig ihre Instanzen, und
 * `geometry._updateBoundingInfo()` zöge obendrein die Hülle des anderen
 * mit (geometry.js:283). Symptom wäre kein Fehler, sondern das aus
 * Anlauf 2 bekannte „ganze Bäume verschwinden" (Leitplanke 2).
 *
 * `VertexData.applyToMesh()` auf einem frischen Mesh legt dagegen eine
 * EIGENE Geometry samt eigener BoundingInfo an — derselbe Weg, den
 * GrassClutter.buildCell() seit jeher für seine Zellen geht. Die
 * CPU-seitigen Typed Arrays werden dabei zwischen den Zellen geteilt
 * (das ist gewollt und billig), die GPU-Puffer nicht.
 *
 * `_ExtractFrom` zieht ausschliesslich bekannte Attribute (Positionen,
 * Normalen, Tangenten, UVs, Farben, Skinning-Gewichte, Indizes,
 * mesh.vertexData.js:952) — die Instanzpuffer world0..3 sind NICHT
 * dabei. Der Prototyp darf zum Zeitpunkt des Ziehens also ruhig noch
 * einen Matrixpuffer aus dem ungeschnittenen Betrieb tragen.
 *
 * Materialien werden GETEILT, nicht kopiert: WindPlugin,
 * ShadowDepthWrapper und GlutPuls hängen je Material genau einmal
 * (AssetManager.setzeWind), ein Material je Zelle hiesse Shaderkompilate
 * je Zelle. `sideOrientation` muss dagegen mitkommen — zuMaster() bäckt
 * dort die Determinantenkorrektur der GLB-Hierarchie ein, ohne sie sind
 * die hohlen Felsen und halbierten Stämme zurück.
 */
export function zellMeshAusPrototyp(proto: Mesh, name: string, scene: Scene): Mesh {
  let vd = ZELL_GEOMETRIE.get(proto);
  if (!vd) {
    vd = VertexData.ExtractFromMesh(proto, true, true);
    /*
      Die Instanz-Tönung kommt hier NICHT mit, und zwar von selbst:
      `ExtractFromMesh` liest `color`, unsere Tönung liegt aber unter
      `instanceColor` (Babylon schaltet den `kind` in
      `thinInstanceSetBuffer` um — s. darfGetoentWerden). Hier stand
      einmal ein Längenabgleich, der genau das verhindern sollte; er
      wurde entfernt, weil er einen Fall abfing, den es nicht gibt, und
      damit eine falsche Erklärung im Quelltext festhielt.
    */
    ZELL_GEOMETRIE.set(proto, vd);
  }
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = proto.material;
  mesh.sideOrientation = proto.sideOrientation;
  mesh.isPickable = false;
  mesh.receiveShadows = proto.receiveShadows;
  mesh.renderingGroupId = proto.renderingGroupId;
  mesh.alphaIndex = proto.alphaIndex;
  // Die Refraktionsauswahl hängt an der Objektidentität. Ein Zell-Master
  // bekommt eine neue Identität und muss die semantische Markierung seines
  // Prototyps deshalb ausdrücklich übernehmen.
  if (istGestreuteLandschaft(proto)) markiereAlsGestreuteLandschaft(mesh);
  // ── Frustum-Culling BLEIBT AN — und wird hier erst richtig wirksam ──
  // Fortschreibung der D10-Begründung aus AssetManager.zuMaster(): Dort
  // ist festgehalten, dass `alwaysSelectAsActiveMesh = true` gefallen ist,
  // weil Babylon den Hüllkörper über alle Thin Instances nachführt — und
  // zugleich, dass das FÜR GESTREUTE VEGETATION NICHTS BRINGT, weil ihre
  // Instanzen den Spieler umschliessen und die Hülle damit jede
  // Frustumprüfung besteht.
  //
  // Genau diese Einschränkung kippt mit dem Zellschnitt. Die Hülle eines
  // Zell-Masters umfasst nur noch eine 128-m-Kachel (rund 90 m Radius
  // plus Kronenhöhe plus 1,5 m Windreserve) statt der 425 m des alten
  // Vollmasters. Damit fallen Zellen hinter der Kamera im Bildpass weg
  // und ferne Zellen über Shadows.darfWerfen() aus der Werferliste —
  // das ist der ganze Zweck des Umbaus (E19 c, Befund E20: 85 % der
  // Einreichungen je Kaskade waren umsonst).
  //
  // Das Flag hier „sicherheitshalber" zurückzuholen, machte den Umbau
  // wirkungslos: Es würde jede Zelle wieder bedingungslos einreichen.
  // Die Gegenzusicherung liefert client/test/master-huelle.ts — der
  // Hüllkörper enthält jede Instanz vollständig, und die ferne Zelle
  // fällt aus dem Frustum, während die Zelle um den Spieler bleibt.
  mesh.alwaysSelectAsActiveMesh = false;
  mesh.computeWorldMatrix(true);
  mesh.setEnabled(false);
  return mesh;
}

export class EntityManager {
  private readonly buckets = new Map<string, StaticBucket>();
  /**
   * Bewusster Qualitätstausch des gemessenen 100-FPS-Profils.
   *
   * Normale und `*Dick`-Bäume bleiben getrennte ZDOs und Collider. Nur
   * ihre Renderinstanzen landen gemeinsam auf der normalen Geometrie —
   * dadurch entfällt je Familie ein Master in Bild- und Schattenpässen.
   */
  private hundertFpsProfil = false;
  /** 0 = das gesamte geladene Streaming-Fenster (bisheriger Stand). */
  private vegetationsGrenzeM = 0;
  private vegetationsMitteX = 0;
  private vegetationsMitteZ = 0;
  private vegetationsMitteBekannt = false;
  /** zdoKey → Bucket-Schlüssel (s. {@link bucketSchluessel}). */
  private readonly bucketOf = new Map<string, string>();
  private readonly dynamics = new Map<string, DynamicEntity>();
  /**
   * Einordnung der NPC-Instanzen (Namensschild), Schlüssel wie bei den
   * ZDOs. Bewusst NEBEN `dynamics` und nicht darin: Die Angaben kommen von
   * woanders her (Layout-Dokument statt ZDO-Transform), und eine statische
   * Platzierung dürfte sie genauso tragen. Position und Höhe holt sich das
   * Schild aus `dynamischeInstanzen()` — die ändern sich pro Frame, die
   * Einordnung nie.
   */
  private readonly npcs = new Map<string, NpcEinordnung>();
  /**
   * Auflösung `layoutId` → Einordnung. Setzt main.ts, sobald das
   * Weltdokument da ist; ohne Layout-Welt bleibt sie null und der ganze
   * NPC-Pfad kostet nichts.
   */
  private npcQuelle: ((layoutId: string) => NpcEinordnung | null) | null = null;
  private readonly appliedLocations = new Set<string>();
  /**
   * Bucket-Schlüssel, deren Master gerade geladen werden bzw. schon geladen
   * sind. Je BUCKET und nicht je Prefabhash: Ein Override-Bucket braucht
   * eigene Master, auch wenn der Prefab längst geladen ist.
   * Bucket keys whose render prep is already in flight.
   */
  private readonly pending = new Set<string>();
  /**
   * Räumlicher Index der statischen Instanzen: Zellenschlüssel → Einträge.
   *
   * ── Warum überhaupt ──────────────────────────────────────────────
   * `nearbyInstances()` lief vorher linear über JEDEN Bucket und JEDE
   * Instanz darin — bei rund 9.900 ZDOs also knapp 10.000 Durchläufe, und
   * das je Frame gleich zweimal (Fadenkreuz und Namensschilder), plus die
   * Minimap. Gesucht wurde dabei ein Umkreis von 5 bis 70 m; der Rest der
   * Welt wurde nur angefasst, um ihn zu verwerfen. Schlimmer noch: Es
   * skaliert mit dem Inhalt der Welt und mit allem, was Spieler bauen.
   *
   * Der Index dreht das um: Nur die Zellen, die der Suchkreis berührt,
   * werden angefasst. Aus O(alle Instanzen) wird O(Instanzen in der
   * Nachbarschaft).
   *
   * Die Einträge halten die Position SELBST und nicht einen Verweis auf
   * `bucket.matrices`, weil die Matrixindizes beim Löschen per Swap-Remove
   * wandern — ein Index auf eine wandernde Stelle wäre der klassische
   * Weg, still auf die falsche Instanz zu zeigen.
   */
  private readonly zellen = new Map<number, IndexEintrag[]>();
  /** ZDO-Schlüssel → Indexeintrag. Nur statische ZDOs stehen hier. */
  private readonly indexVon = new Map<string, IndexEintrag>();

  constructor(
    private readonly scene: Scene,
    private readonly world: ClientWorld,
    private readonly assets: AssetManager,
    private readonly terrain: TerrainManager
  ) {}

  /** Stats for the HUD. */
  staticCount = 0;
  dynamicCount = 0;

  /**
   * Alle statischen Instanzen im Umkreis, mit Prefab-Namen.
   *
   * Für das Namens-Overlay (Einstellung "Objektnamen anzeigen"): Anders als
   * colliderPositions() listet das ALLES, was in der Welt steht — auch
   * Deko und Aufsammelbares ohne Kollisionskörper. Genau das braucht man,
   * um ein unbekanntes Objekt zu identifizieren.
   */
  nearbyInstances(
    x: number,
    z: number,
    radius: number,
    aus: StatischeInstanz[] = []
  ): StatischeInstanz[] {
    aus.length = 0;
    const r2 = radius * radius;
    const cx0 = Math.floor((x - radius) / INDEX_ZELLE_M);
    const cx1 = Math.floor((x + radius) / INDEX_ZELLE_M);
    const cz0 = Math.floor((z - radius) / INDEX_ZELLE_M);
    const cz1 = Math.floor((z + radius) / INDEX_ZELLE_M);
    // Das umschliessende QUADRAT der Zellen, danach der exakte Kreistest je
    // Instanz. Zellen kreisförmig vorzufiltern lohnt sich nicht: Bei den
    // hier üblichen 1 bis 25 Zellen kostet die Ecke weniger als die
    // Rechnung, die sie einsparen würde.
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const liste = this.zellen.get(zellenSchluessel(cx, cz));
        if (liste === undefined) continue;
        for (let i = 0; i < liste.length; i++) {
          const e = liste[i]!;
          const dx = e.x - x;
          const dz = e.z - z;
          if (dx * dx + dz * dz > r2) continue;
          aus.push(e);
        }
      }
    }
    return aus;
  }

  // ── Räumlicher Index der statischen Instanzen ────────────────────

  /**
   * Instanz im Index anlegen ODER verschieben.
   *
   * Der zweite Fall ist nicht theoretisch: Statische ZDOs bekommen im
   * Editor und beim Terrain-Werkzeug neue Positionen, und der Server
   * schickt für dasselbe ZDO wiederholt Updates. Bleibt die Zelle
   * dieselbe, wird nur die Position nachgezogen — das ist der Normalfall
   * und kostet dann keinen Listenumbau.
   */
  private indexSetzen(key: string, prefab: string, x: number, y: number, z: number): void {
    const zelle = zellenSchluessel(
      Math.floor(x / INDEX_ZELLE_M),
      Math.floor(z / INDEX_ZELLE_M)
    );
    let e = this.indexVon.get(key);
    if (e) {
      e.prefab = prefab;
      e.x = x;
      e.y = y;
      e.z = z;
      if (e.zelle === zelle) return;
      this.ausZelleLoesen(e);
      e.zelle = zelle;
    } else {
      e = { prefab, x, y, z, zelle, platz: 0 };
      this.indexVon.set(key, e);
    }
    let liste = this.zellen.get(zelle);
    if (!liste) {
      liste = [];
      this.zellen.set(zelle, liste);
    }
    e.platz = liste.length;
    liste.push(e);
  }

  /** Eintrag aus seiner Zellenliste nehmen (Swap-Remove, O(1)). */
  private ausZelleLoesen(e: IndexEintrag): void {
    const liste = this.zellen.get(e.zelle);
    if (!liste) return;
    const letzter = liste[liste.length - 1]!;
    liste[e.platz] = letzter;
    letzter.platz = e.platz;
    liste.length--;
    // Leere Zellen wieder wegwerfen, sonst wächst die Map beim Durchlaufen
    // der Welt monoton mit — jede je betretene Zelle bliebe für immer als
    // leeres Array liegen und verlangsamte nichts, belegte aber Speicher.
    if (liste.length === 0) this.zellen.delete(e.zelle);
  }

  /** Instanz aus dem Index nehmen — Gegenstück zu indexSetzen(). */
  private indexEntfernen(key: string): void {
    const e = this.indexVon.get(key);
    if (!e) return;
    this.ausZelleLoesen(e);
    this.indexVon.delete(key);
  }

  /** Diagnose: Anzahl indizierter Instanzen und belegter Zellen. */
  get indexStats(): { instanzen: number; zellen: number } {
    return { instanzen: this.indexVon.size, zellen: this.zellen.size };
  }

  /**
   * Alle dynamischen Instanzen (Kreaturen, NPCs, fremde Spieler) mit ihrer
   * aktuellen Pose — Futter für die Namensschilder.
   *
   * Schreibt in eine vom Aufrufer GEHALTENE Liste und liefert die Anzahl
   * zurück, statt ein Array anzulegen: Das hier läuft in jedem Frame, und
   * ein frisches Array je Frame ist genau die Sorte Müll, die den GC in
   * regelmässigen Abständen für ein paar Millisekunden anhält.
   *
   * `skalierungY` ist die WELTSKALIERUNG der Instanz (localScale des
   * Prefabs mal ZDO-Skalierung, siehe applyDynamic) — mit ihr lässt sich
   * die Modellhöhe aus dem Prefab auf dieses Exemplar umrechnen.
   */
  dynamischeInstanzen(out: DynamischeInstanz[]): number {
    let n = 0;
    for (const [key, dyn] of this.dynamics) {
      let e = out[n];
      if (!e) {
        e = { key: '', prefab: '', x: 0, y: 0, z: 0, skalierungY: 1, leben: -1 };
        out.push(e);
      }
      const p = dyn.root.position;
      e.key = key;
      e.prefab = dyn.root.name;
      e.x = p.x;
      e.y = p.y;
      e.z = p.z;
      e.skalierungY = dyn.root.scaling.y;
      e.leben = dyn.leben ?? -1;
      n++;
    }
    return n;
  }

  /**
   * World positions of the active collision bodies. Diagnosis only — lets a
   * test walk deliberately into one instead of hoping to hit something.
   */
  colliderPositions(): Array<{ prefab: string; x: number; z: number }> {
    const out: Array<{ prefab: string; x: number; z: number }> = [];
    for (const [prefab, e] of this.colliders) {
      const buf = e.carrier.thinInstanceGetWorldMatrices();
      for (const m of buf) out.push({ prefab, x: m.m[12]!, z: m.m[14]! });
    }
    return out;
  }

  /** Active collision bodies and prefabs we could not derive a shape for. */
  get colliderStats(): { bodies: number; havok: number; prefabs: number; ohneForm: number } {
    let bodies = 0;
    let havok = 0;
    for (const e of this.colliders.values()) {
      bodies += e.set.count;
      havok += e.set.bodyInstances;
    }
    return { bodies, havok, prefabs: this.colliders.size, ohneForm: this.colliderless.size };
  }

  /**
   * Woher die NPC-Einordnung einer Online-Instanz kommt (s. npcQuelle).
   * Einmal je Welt gesetzt — die Zuordnung ist statisch.
   */
  setzeNpcQuelle(quelle: ((layoutId: string) => NpcEinordnung | null) | null): void {
    this.npcQuelle = quelle;
  }

  /**
   * Einordnung EINER Instanz (null = kein NPC oder nicht aus dem Layout).
   *
   * Die Auskunft ist bewusst je Schlüssel und nicht als Umkreisliste: Wer
   * Schilder zeichnet, geht ohnehin über `dynamischeInstanzen()` und
   * braucht dann nur noch die Angaben zum bereits gefundenen Exemplar.
   */
  npcEinordnung(key: string): NpcEinordnung | null {
    return this.npcs.get(key) ?? null;
  }

  applyUpdate(u: ZDOEntityUpdate): void {
    if (u.isOwnPlayer) return; // our own character is the camera (Phase 4: avatar)

    // F4: terrain leveling under locations (Unity TerrainModifier parity)
    if (u.locationFeatureHash !== undefined && !this.appliedLocations.has(u.key)) {
      this.appliedLocations.add(u.key);
      this.applyLocationLeveling(u.locationFeatureHash, u.position);
      return; // LocationProxy itself is invisible (isRenderable false)
    }

    const def = findPrefabByHash(u.prefabHash);
    if (!def || !isRenderable(def)) return;

    // Einordnung mitführen: offline liegt sie am Update (Testflug), online
    // kommt sie über die Herkunft aus dem Layout-Dokument. Bewusst bei
    // JEDEM Update neu bestimmt statt einmal gemerkt — im Editor ändert
    // ein Feld die Einordnung, und der Eintrag wird mit demselben
    // Schlüssel neu gezeichnet. Zwei Map-Zugriffe sind billiger als eine
    // Sonderbehandlung für „Schild muss wieder verschwinden".
    const einordnung = u.npc ?? (u.layoutId ? (this.npcQuelle?.(u.layoutId) ?? null) : null);
    if (einordnung) {
      this.npcs.set(u.key, einordnung);
    } else {
      this.npcs.delete(u.key);
    }

    const isDynamic = (def.flags & DYNAMIC_FLAGS) !== 0n;
    if (isDynamic) {
      // Tiere/Monster ohne echten Clip bekommen den prozeduralen Gang;
      // Player/NPC bringen Animationsgruppen mit und bleiben davon frei.
      const belebt =
        (def.flags & (PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI)) !== 0n && !def.animation;
      // Fremde SPIELER tragen ihre gewaehlte Figur als ZDO-Member; sie
      // schlaegt das Vorgabemodell des Prefabs. Ohne das saehe man jeden
      // anderen als `npc_1_walk` — das Modell, das am Player-Prefab
      // haengt und mit der eigenen Figur nie etwas zu tun hatte. Wer
      // seine Wahl im Spiel aendert, aendert denselben Member, und der
      // Sync traegt sie hierher.
      const modell = u.figur ? modellZu(u.figur) : def.model;
      void this.applyDynamic(u, def.name, modell, def.animation, belebt).then(() => {
        // Frisur und Ruestung NACH dem Koerper: Sie brauchen dessen
        // Skelett. Fehlt der Member, traegt der Spieler nichts — kein
        // Rueckfall auf eine Vorgabefrisur, sonst saehe man bei jedem
        // Fremden etwas anderes als er selbst.
        if (u.frisur !== undefined || u.ruestung !== undefined) {
          void this.setzeFremdesAussehen(u);
        }
      });
    } else {
      this.applyStatic(u, def.name, def.model);
    }
  }

  /**
   * Frisur und Ruestung eines FREMDEN Spielers anlegen.
   *
   * Die Teile liegen als eigene Dateien neben dem Koerper und werden
   * einzeln geladen — dieselbe Aufteilung wie beim eigenen Avatar.
   *
   * Jedes Teil bringt sein eigenes Skelett mit; benutzt wird das des
   * KOERPERS, sonst stuende die Frisur in der Bindepose, waehrend der
   * Fremde laeuft. Zulaessig nur, weil alle Teildateien dieselbe
   * Gelenkliste tragen (tools/asset-aufteilen.py prueft das nach).
   *
   * Der `__root__`-Knoten des Teils bleibt in der Kette: Er traegt die
   * Haendigkeitsumrechnung von glTF nach Babylon. Haengt man die Netze
   * direkt um, sitzt das Teil gespiegelt — genau dieser Fehler ist beim
   * eigenen Avatar schon einmal passiert.
   */
  private async setzeFremdesAussehen(u: ZDOEntityUpdate): Promise<void> {
    const dyn = this.dynamics.get(u.key);
    if (!dyn) return;
    // Beide aktuellen Körper stammen aus derselben 63-Knochen-Armatur und
    // können deshalb dieselben modularen Teile tragen.
    if (u.figur && !/^(wikinger\/|wikingerin\/)/.test(modellZu(u.figur))) return;
    dyn.aussehen ??= new Map();

    // Skelett des Koerpers suchen — an ihm haengen alle Teile.
    let skelett = null as import('@babylonjs/core/Bones/skeleton').Skeleton | null;
    for (const m of dyn.root.getChildMeshes()) {
      if (m.skeleton) { skelett = m.skeleton; break; }
    }
    if (!skelett) return;

    const [ober, beine] = (u.ruestung ?? '|').split('|');
    const gewuenscht: Record<string, string | null> = {
      frisur: u.frisur && istFrisur(u.frisur)
        ? `${AUSSEHEN_ORDNER}/${frisurZu(u.frisur).datei}` : null,
      bart: u.frisur && istFrisur(u.frisur) && bartAusFrisur(u.frisur)
        ? `${AUSSEHEN_ORDNER}/${bartAusFrisur(u.frisur)!.datei}` : null,
      oberkoerper: ruestungZu(ober) ? `${AUSSEHEN_ORDNER}/${ruestungZu(ober)!.datei}` : null,
      beine: ruestungZu(beine) ? `${AUSSEHEN_ORDNER}/${ruestungZu(beine)!.datei}` : null,
    };

    for (const [slot, datei] of Object.entries(gewuenscht)) {
      const alt = dyn.aussehen.get(slot);
      if ((alt?.datei ?? null) === datei) continue;
      if (alt) {
        alt.wurzel.dispose(false, false);
        dyn.aussehen.delete(slot);
      }
      if (!datei) continue;
      const wurzel = await this.assets.instantiate(datei);
      if (!wurzel) continue;
      // Das Rennen um denselben Slot verlieren: Ein zweites Update kann
      // waehrend des Ladens dasselbe getan haben.
      if (!this.dynamics.has(u.key) || dyn.aussehen.has(slot)) {
        wurzel.dispose(false, false);
        continue;
      }
      wurzel.parent = dyn.root;
      wurzel.position.setAll(0);
      wurzel.rotationQuaternion = null;
      wurzel.rotation.setAll(0);
      wurzel.scaling.setAll(1);
      const netze = wurzel.getChildMeshes().filter((m) => m.getTotalVertices() > 0);
      for (const m of netze) {
        m.skeleton = skelett;
        m.isPickable = false;
      }
      // MIT Klon: Diese Netze stammen aus dem Container-Cache, und
      // `instantiateModelsToScene` teilt Materialien zwischen allen
      // Instanzen. Ohne Klon faerbte der erste Spieler mit dieser
      // Frisur alle anderen mit (s. haarfarbe.ts).
      if (slot === 'frisur' || slot === 'bart') {
        faerbeHaar(netze, haarfarbeZu(u.haarfarbe).hex, true);
      }
      dyn.aussehen.set(slot, { datei, wurzel });
    }
  }

  /**
   * Eine statische Instanz aus ihrem Bucket nehmen (Swap-Remove auf dem
   * Matrixpuffer).
   *
   * Eigene Methode, seit ein ZDO den Bucket WECHSELN kann: Mit dem
   * Raum-Steinmaterial gehört ein Raum je nach Override in einen anderen
   * Bucket, und ein Wechsel ohne dieses Ausräumen liesse dieselbe Instanz in
   * beiden stehen — sichtbar als doppelte Wand, unsichtbar als doppelter
   * Kollisionskörper.
   * Extracted because a ZDO can now MOVE between buckets (per-room stone
   * material); leaving it in the old one would draw it twice.
   */
  private ausBucketEntfernen(key: string): void {
    const bucketKey = this.bucketOf.get(key);
    if (bucketKey === undefined) return;
    const bucket = this.buckets.get(bucketKey);
    const idx = bucket?.indexOf.get(key);
    if (bucket && idx !== undefined) {
      // swap-remove the matrix
      const last = bucket.matrices.length / 16 - 1;
      if (idx !== last) {
        bucket.matrices.copyWithin(idx * 16, last * 16, last * 16 + 16);
        for (const [k, v] of bucket.indexOf) {
          if (v === last) {
            bucket.indexOf.set(k, idx);
            break;
          }
        }
      }
      bucket.matrices.length = last * 16;
      bucket.indexOf.delete(key);
      bucket.dirty = true;
      this.staticCount--;
    }
    this.bucketOf.delete(key);
  }

  removeZDO(key: string): void {
    this.npcs.delete(key);
    // Vor dem Bucket-Abbau: Der Index steht unabhängig davon, ob der Bucket
    // die Instanz noch kennt — ein Eintrag, der ihn überlebt, wäre ein
    // Geisterobjekt unter dem Fadenkreuz.
    this.indexEntfernen(key);
    this.ausBucketEntfernen(key);
    const dyn = this.dynamics.get(key);
    if (dyn) {
      this.assets.entsorgeAnimationen(dyn.root);
      // NUR die Instanz abräumen — NIEMALS Material und Texturen.
      //
      // `dispose(_, true)` sah nach gründlichem Aufräumen aus und war in
      // Wahrheit die Ursache für „die Völva hat keine Texturen":
      // AssetManager.instantiate ruft instantiateModelsToScene mit
      // cloneMaterials = FALSE — alle Instanzen eines Prefabs teilen sich
      // also EIN PBRMaterial samt seiner Texturen, und das gehört dem
      // gecachten AssetContainer, nicht dieser Instanz.
      //
      // Babylon macht daraus (abstractMesh.dispose → material.dispose(
      // false, true) → pbrBaseMaterial.dispose) zweierlei: Es entsorgt
      // albedo-/metallic-/bump-Textur, UND es läuft über scene.meshes und
      // setzt `mesh.material = null`, wo dasselbe Material hing. Ein
      // einziges entferntes Exemplar zieht damit allen übrigen — und
      // jedem später erzeugten, weil der Container gecacht bleibt — das
      // Material unter den Füßen weg; sie rendern ab da mit Babylons
      // Standardmaterial, also weiß und ohne Textur.
      //
      // Aufgefallen an der Völva, weil im Spawn-Editor ständig eine
      // Instanz verschwindet: Der Vorschau-Geist (`edghost`) wird bei
      // jedem Setzen, jedem Prefab-Wechsel und jedem Rechtsklick
      // entfernt, und alleNeuZeichnen wirft nach dem Löschen alle
      // `edplace-*` weg. Es trifft aber jedes dynamische Prefab, auch
      // despawnende Kreaturen.
      //
      // Nichts leckt dadurch: Material und Texturen hängen ohnehin am
      // Container, den `AssetManager.containers` absichtlich für die
      // ganze Sitzung hält.
      dyn.root.dispose(false, false);
      this.dynamics.delete(key);
      this.dynamicCount--;
    }
  }

  /**
   * Geänderte Thin-Instance-Puffer neu aufbauen (einmal pro Frame).
   *
   * ── Warum hier ein Budget steht ──────────────────────────────────
   * Ein Neuaufbau ist teuer: Für jedes Sub-Mesh des Prefabs wird ein
   * frischer Float32Array über ALLE Instanzen angelegt und jede Matrix
   * neu multipliziert, danach laufen die Havok-Körper nach. Ein einziges
   * geändertes ZDO markiert dabei den ganzen Bucket — bei einem Prefab
   * mit hunderten Instanzen also hunderte Multiplikationen wegen eines
   * einzelnen Objekts.
   *
   * Ohne Budget passierte das für alle geänderten Buckets IM SELBEN
   * FRAME, und zwar im Takt der Server-Updates. Gemessen am 2026-07-29
   * im Regen: Der Median lag bei 17,1 ms (also 60 fps), aber 30 % der
   * Frames brauchten über 25 ms — im Abstand von exakt 3–4 Frames, das
   * sind die 20 Hz der Netzwerkschleife. Über 8,7 s gingen so 2013 ms
   * verloren; daraus entstand die gemeldete "43 fps", obwohl das Bild
   * die meiste Zeit mit voller Rate lief.
   *
   * Das Budget macht aus einem grossen Ruckler mehrere unsichtbare
   * kleine. Die Buckets bleiben als geändert markiert und kommen in den
   * Folgeframes dran — es geht nichts verloren, es dauert nur länger.
   *
   * ── Grenze des Budgets seit dem Zellschnitt (E19 c) ──────────────
   * Abgebrochen wird zwischen BUCKETS, nicht innerhalb. Ein
   * geschnittener Vegetations-Bucket packt jetzt in EINEM Zug seine
   * sämtlichen Zellen; die Rechenarbeit ist dieselbe wie vorher (gleich
   * viele Matrixmultiplikationen), hinzu kommen mehrere kleine
   * GPU-Uploads statt eines grossen. Die Regel „mindestens ein Element
   * pro Frame" (verarbeitet > 0) gilt weiterhin, sonst friert der Aufbau
   * unter Dauerlast ein. Eine Taktung auf ZELLEN-Ebene samt
   * `dirtyZellen`-Merker je Bucket ist die zweite Ausbaustufe — erst
   * messen, dann bauen (s. Roadmap E19/E20).
   */
  flush(): void {
    const budgetEnde = performance.now() + REBUILD_BUDGET_MS;
    let verarbeitet = 0;
    for (const bucket of this.buckets.values()) {
      if (!bucket.mastersReady || (!bucket.dirty && !bucket.colliderDirty)) continue;
      if (verarbeitet > 0 && performance.now() >= budgetEnde) break;
      if (bucket.dirty) {
        // Renderdaten UND Collider betroffen (ZDO-Änderung) — voller Umbau.
        bucket.dirty = false;
        bucket.colliderDirty = false;
        this.rebuildBucketInstances(bucket);
      } else {
        // Nur das Kollisionsfenster ist weitergerückt (Spieler bewegt sich)
        // — die Thin-Instance-Renderpuffer sind unverändert und brauchen
        // keinen Neuaufbau samt GPU-Upload. rebuildBucketCollidersOnly()
        // filtert intern ohnehin per Signatur: ändert sich die Nah-Auswahl
        // gar nicht, passiert danach nichts weiter.
        bucket.colliderDirty = false;
        this.rebuildBucketCollidersOnly(bucket);
      }
      verarbeitet++;
    }
    // ── Sprite-Zellen EINMAL am Ende zusammensetzen ─────────────────
    // Ein Sprite-Zellmesh traegt die Beitraege MEHRERER Buckets (ein
    // Zeichenaufruf je Zelle statt einer je Zelle x Prefab — das IST der
    // Hebel). Die Schleife oben arbeitet prefabweise; wuerde die Zelle
    // dort bei jedem Bucket neu zusammengesetzt, liefe derselbe Puffer
    // mehrfach pro Bild ueber den Bus. Genau diese Sorte GPU-Verkehr ist
    // in SchattenInstanzKeulung.ts mit 18 -> 59 ms vermessen.
    //
    // Ausserhalb des Budgets: Zusammengesetzt wird nur, was in DIESEM
    // Durchlauf schmutzig wurde — abgebrochene Buckets bleiben dirty und
    // liefern ihre Beitraege im Folgeframe nach.
    this.impostoren?.baueZellen();
  }

  // ── Static (thin instances) ──────────────────────────────────────

  /**
   * PROTOTYPEN je Prefab, ein Eintrag je verschmolzenem Submesh.
   *
   * Seit dem Zellschnitt (E19 c) sind sie zweierlei: Für kleine Buckets
   * (bis ZELL_SCHNITT_AB Instanzen) tragen sie ihre Instanzen weiterhin
   * SELBST — das ist der unveränderte Weg von D10. Für geschnittene
   * Buckets sind sie reine Vorlage: dauerhaft abgeschaltet, ohne
   * Matrixpuffer, Quelle für die Zellgeometrie UND weiterhin Quelle der
   * Kollisionsform (rebuildBucketColliders liest getTotalIndices und
   * baut buildMeshCollider/deriveCollider aus genau diesen beiden Maps —
   * der Kollisionspfad bleibt prefabweise und merkt vom Schnitt nichts).
   */
  private masterMeshes = new Map<string, import('@babylonjs/core/Meshes/mesh').Mesh[]>();
  private masterLocals = new Map<string, Matrix[]>();
  /**
   * Die REINEN KOLLISIONSNETZE je masterKey (`_col`-Meshes der GLB, s.
   * AssetManager-Kopf) — bewusst NEBEN `masterMeshes`, nicht darin.
   *
   * Sie stehen damit vollständig ausserhalb des Renderwegs: kein
   * Thin-Instance-Puffer, kein Zellschnitt, kein Steinmaterial, kein
   * Klon für Override-Buckets. Das ist kein Sparen, sondern die
   * einzige Stelle, an der es überhaupt richtig sein kann — Babylon
   * hängt die Instanzpuffer an die GEOMETRY (s. prepareMasters), zwei
   * Buckets desselben Prefabs dürften sich also kein instanziertes Mesh
   * teilen. Kollision braucht die Instanzen gar nicht:
   * `buildMeshCollider()` liest nur Positionen, Indizes und `local`,
   * und die Weltlagen kommen ohnehin aus den ZDO-Matrizen.
   */
  private kollisionsMasters = new Map<string, import('@babylonjs/core/Meshes/mesh').Mesh[]>();
  private kollisionsLocals = new Map<string, Matrix[]>();
  /**
   * KI-Steinmaterialien der 1.0-Kits, gecacht je Konfiguration (Master leben die
   * ganze Sitzung, also EIN Material je Kit). Ein gemeinsames Material für alle
   * Kit-Teile heißt: die Verwitterungs-Masken leben in EINEM Weltraum und laufen
   * nahtlos über Teilgrenzen. Siehe `DungeonSteinMaterial.ts`.
   */
  private steinMaterials = new Map<string, PBRMaterial>();
  /**
   * Die Steinteile je prefabHash — die Master, die `weiseSteinMaterialZu`
   * beim Dokumentwechsel ERNEUT bemalen muss.
   *
   * Eine eigene Karte, weil `masterMeshes` nach prefabName geht: Vom Namen
   * zurück auf den Hash käme man nur über eine Suche, und `prepareMasters`
   * läuft je Hash genau EINMAL pro Sitzung (nichts leert `pending`). Wer
   * das zweite Grab betritt, bekommt also keinen zweiten Ladevorgang — die
   * Master von eben sind alles, was es je geben wird.
   * Stone masters per prefabHash: `prepareMasters` runs exactly ONCE per
   * hash per session, so re-painting these is the only way a second
   * document can look different.
   */
  private steinMasters = new Map<
    string,
    { bucket: StaticBucket; masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[] }
  >();
  /**
   * Das Steinmaterial des BETRETENEN Dokuments (1.0), sonst null. Liegt
   * über der Kit-Vorgabe und unter dem Raum-Override.
   */
  private dokumentSteinKit: Partial<SteinKitConfig> | null = null;
  /**
   * Übergibt fertige Vegetations-Matrixpuffer an Shadows. Wert-Callback
   * statt Modulimport: EntityManager bleibt ohne Szene testbar und der
   * Schattenpfad kann die sichtbaren Puffer niemals selbst überschreiben.
   */
  private vegetationsSchattenEmpfaenger:
    | ((mesh: Mesh, matrizen: Float32Array | null) => void)
    | null = null;

  setVegetationsSchattenEmpfaenger(
    empfaenger: ((mesh: Mesh, matrizen: Float32Array | null) => void) | null
  ): void {
    this.vegetationsSchattenEmpfaenger = empfaenger;
    if (!empfaenger) return;
    // Registrierung geschieht normalerweise vor dem ersten Weltpaket.
    // Falls beim Wiederverbinden schon Master existieren, erzwingt dirty
    // einen vollständigen Replay statt einen still schattenlosen Bestand.
    for (const bucket of this.buckets.values()) {
      if (bucket.mastersReady && FOLIAGE_HASHES.has(bucket.prefabHash)) bucket.dirty = true;
    }
  }

  private meldeVegetationsSchatten(
    bucket: StaticBucket,
    mesh: Mesh,
    matrizen: Float32Array | null
  ): void {
    if (!FOLIAGE_HASHES.has(bucket.prefabHash)) return;
    this.vegetationsSchattenEmpfaenger?.(mesh, matrizen);
  }
  /**
   * Zell-Master der geschnittenen Buckets:
   * prefabName → Zellenschlüssel → [Prototyp-Index][Überlaufblock].
   */
  private readonly zellMaster = new Map<string, Map<number, Mesh[][]>>();
  /**
   * Abgeschaltete Zell-Master zur Wiederverwendung, je
   * `${prefabName}|${prototypIndex}`.
   *
   * ── Warum poolen statt entsorgen ─────────────────────────────────
   * Zwei Gründe. Erstens Kosten: Ein frischer Zell-Master lädt seine
   * ganze Geometrie neu auf die Grafikkarte; beim Laufen wandern Zellen
   * aber ständig aus dem Streaming-Fenster heraus und wieder herein.
   * Zweitens Sicherheit: `mesh.dispose()` räumt sich zwar selbst aus
   * `shadowMap.renderList` (abstractMesh.js:1768), NICHT aber aus dem
   * über mehrere Frames laufenden Werfer-Scan in Shadows.tick() — ein
   * dort noch gemerktes, inzwischen entsorgtes Mesh landete in der
   * nächsten renderList. Ein abgeschaltetes Mesh kostet dagegen nichts:
   * der Schattenpass überspringt es (objectRenderer.js:695), der
   * Bildpass ebenso.
   *
   * Wiederverwendet wird NUR innerhalb desselben (Prefab, Prototyp),
   * also auf identischer Geometrie. Über diese Grenze hinweg wäre es ein
   * stiller Fehler: Babylon cacht rawBoundingInfo und boundingVectors je
   * Mesh einmalig aus der Rohgeometrie (thinInstanceMesh.js:236-249) und
   * setzt sie beim Geometriewechsel nicht zurück — die Hülle wäre falsch,
   * der Werfer würde als Ganzes gekeult, und man sähe nur fehlende
   * Schatten.
   */
  private readonly zellPool = new Map<string, Mesh[]>();
  /**
   * Meldeweg fuer wiederverwendete Zell-Master, verdrahtet in main.ts mit
   * Shadows.meldeWerfer(). Noetig, weil onNewMeshAddedObservable nur bei
   * der Konstruktion feuert und der Pool bestehende Meshes wieder ausgibt
   * — ohne die Meldung fehlen nach Teleport + Stillstand die Schatten der
   * reaktivierten Zellen (Review-Fund E19 c, kritisch). Optional, damit
   * EntityManager keinen Import auf Shadows braucht.
   */
  onMasterBelebt: ((mesh: Mesh) => void) | null = null;
  /**
   * Das Sprite-Fernfeld. Optional und von aussen gesetzt (main.ts) —
   * derselbe Grund wie bei onMasterBelebt: Der EntityManager soll keinen
   * Wertimport auf ein Babylon-Modul brauchen, und der statische Pfad
   * muss ohne Szene konstruierbar bleiben (client/test/entity-index.ts).
   * Bleibt das Feld null, verhaelt sich alles wie vor diesem Umbau.
   */
  impostoren: BaumImpostor | null = null;
  /**
   * Uebergabegrenze in Metern. Wird von main.ts aus BaumImpostor.grenze
   * nachgefuehrt, damit der geplante Sweep zur Laufzeit greift, ohne dass
   * diese Datei das Modul importieren muss.
   */
  impostorGrenze = IMPOSTOR_GRENZE_M_VORGABE;
  /**
   * Mitte des Sprite-Fensters — die Position, gegen die die Zuteilung
   * echt/Sprite gerechnet wurde. Rueckt in Schritten von SPRITE_NEUPACK_M
   * nach, s. setPlayerPosition().
   */
  private spriteMitteX = 0;
  private spriteMitteZ = 0;
  /** Erst wenn die Spielerposition EINMAL angekommen ist, darf getauscht
   *  werden — s. die Begruendung in baueZellMaster(). */
  private spielerBekannt = false;
  /** Gegenstueck fuer die Entsorgung: erst beim Schattensystem abmelden
   *  (Shadows.entferneWerfer), dann dispose. Verdrahtet in main.ts. */
  onMasterEntsorgt: ((mesh: Mesh) => void) | null = null;
  /** Invisible collision carriers, one per prefab — see rebuildBucketColliders. */
  private readonly colliders = new Map<
    string,
    { carrier: Mesh; set: StaticColliderSet; signature: string }
  >();
  /** Abgeleitete Formen je Prefab — Diagnose. */
  readonly colliderSpecs = new Map<string, unknown>();
  /** Prefabs whose meshes yielded no usable shape — never retried, because
   *  deriveCollider walks every vertex and repeating that stalls frames. */
  private readonly colliderless = new Set<string>();
  /** Set once Havok is up; before that collider building is skipped. */
  private physicsEnabled = false;
  /** Centre of the collision window — see setPlayerPosition. */
  private colliderCenterX = 0;
  private colliderCenterZ = 0;

  /**
   * Ob nahe (x,z) bereits ein Kollisionskörper steht. Ladeprüfung nach dem
   * Instanz-Teleport (Phase G): Der Spieler bleibt eingefroren, bis der
   * Mesh-Collider des Eingangsraums existiert — sonst fällt er durch den
   * noch ladenden Dungeon (GLB-Fetch + Bucket-Aufbau brauchen Sekunden).
   */
  colliderNahe(x: number, z: number, radius: number, nurRaeume = false): boolean {
    for (const [prefabName, e] of this.colliders) {
      // Beim Warten aufs Dungeon zählt nur der RAUM-Collider: eine bereits
      // geladene Fackel/Truhe hätte zwar einen Körper, aber keinen Boden.
      if (nurRaeume && getRoomByHash(getStableHash(prefabName)) === undefined) continue;
      if (e.set.hasBodyNear(x, z, radius)) return true;
    }
    return false;
  }

  /**
   * Nächstes interagierbares Objekt (Pickable/Tür/Truhe) im Umkreis — Ziel
   * der E-Taste. Liefert Prefab-Hash + Position für PacketType.Interact.
   */
  naechstesInteragierbares(
    x: number,
    z: number,
    radius: number
  ): { prefab: string; prefabHash: number; x: number; y: number; z: number } | null {
    const F = PrefabFlag;
    // BED (Schlafplatz), FIREPLACE (Braten) und die Namens-Sonderfälle
    // (Portal-Reise, Eikthyr-Altar) gehören ebenfalls zur E-Zielsuche.
    const wanted =
      F.PICKABLE | F.PICKABLE_ITEM | F.ITEM_DROP | F.DOOR | F.CONTAINER | F.BED | F.FIREPLACE;
    const SONDER = new Set(['portal_wood', 'StatueDeer']);
    let bestD = radius * radius;
    let best: { prefab: string; prefabHash: number; x: number; y: number; z: number } | null = null;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      if (!def || ((def.flags & wanted) === 0n && !SONDER.has(def.name))) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { prefab: def.name, prefabHash: bucket.prefabHash, x: px, y: bucket.matrices[i * 16 + 13]!, z: pz };
        }
      }
    }
    return best;
  }

  /**
   * Alle Lichtquellen-Instanzen im Umkreis (Prefabs mit `PrefabDef.light`)
   * — Futter für den LightPool. Nur statische Buckets; Fackeln/Feuer sind
   * nie dynamisch.
   */
  lichtquellen(
    x: number,
    z: number,
    radius: number
  ): Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> {
    const out: Array<{ x: number; y: number; z: number; licht: NonNullable<import('@wov/shared').PrefabDef['light']> }> = [];
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      const def = findPrefabByHash(bucket.prefabHash);
      const licht = def?.light;
      if (!licht) continue;
      const n = bucket.matrices.length / 16;
      for (let i = 0; i < n; i++) {
        const px = bucket.matrices[i * 16 + 12]!;
        const pz = bucket.matrices[i * 16 + 14]!;
        const dx = px - x;
        const dz = pz - z;
        if (dx * dx + dz * dz > r2) continue;
        out.push({ x: px, y: bucket.matrices[i * 16 + 13]!, z: pz, licht });
      }
    }
    return out;
  }

  /** Enable collision once initPhysics() resolved; catches existing buckets up. */
  enablePhysics(): void {
    if (this.physicsEnabled) return;
    this.physicsEnabled = true;
    for (const bucket of this.buckets.values()) bucket.dirty = true;
  }

  /**
   * Move the collision window. Throttled by distance: the bodies only need
   * to exist around the player, and rebuilding them every frame is exactly
   * what makes this expensive.
   */
  setPlayerPosition(x: number, z: number): void {
    // ── Sprite-Fenster ZUERST und OHNE Physik-Gatter ────────────────
    // Die frühe Rückkehr bei !physicsEnabled unten ist für den
    // Kollisionspfad richtig (ohne Havok gibt es nichts zu bauen), für
    // das Sprite-Fenster wäre sie fatal: Solange Havok nicht steht,
    // erreichte die Spielerposition den EntityManager gar nicht, die
    // Fenstermitte bliebe auf (0,0) — und genau in dieser Phase steht der
    // Spieler beim Laden herum und schaut sich um.
    this.spielerBekannt = true;
    // Baeume und Buesche benutzen EINEN gemeinsamen Puffer fuer Bild und
    // Schatten. Die Auswahl folgt dem Spieler absichtlich nur in groben
    // Schritten: So bleibt die Grenze live, ohne beim Laufen pro Frame
    // saemtliche Vegetationsmaster neu auf die GPU zu schreiben.
    const vdx = x - this.vegetationsMitteX;
    const vdz = z - this.vegetationsMitteZ;
    if (
      !this.vegetationsMitteBekannt ||
      (this.vegetationsGrenzeM > 0 &&
        vdx * vdx + vdz * vdz >= VEGETATIONS_NEUPACK_M * VEGETATIONS_NEUPACK_M)
    ) {
      this.vegetationsMitteBekannt = true;
      this.vegetationsMitteX = x;
      this.vegetationsMitteZ = z;
      if (this.vegetationsGrenzeM > 0) this.markiereVegetationDirty();
    }
    const sdx = x - this.spriteMitteX;
    const sdz = z - this.spriteMitteZ;
    if (
      this.impostoren !== null &&
      sdx * sdx + sdz * sdz >= SPRITE_NEUPACK_M * SPRITE_NEUPACK_M
    ) {
      this.spriteMitteX = x;
      this.spriteMitteZ = z;
      // Nur die GESCHNITTENEN Buckets — nur die haben überhaupt eine
      // Sprite-Seite. Hier muss es `dirty` sein und nicht
      // `colliderDirty`: Die Zuteilung echt/Sprite ändert die
      // Renderpuffer, das ist der teure Pfad. Deshalb ist
      // SPRITE_NEUPACK_M mit 32 m fast dreimal so gross wie
      // COLLIDER_REBUILD_STEP.
      for (const bucket of this.buckets.values()) {
        if (bucket.dirty) continue;
        // `zellMaster` ist und bleibt nach PREFABNAME geschlüsselt (s.
        // rebuildBucketInstances: Override-Buckets nehmen den Zellschnitt nie).
        if (this.zellMaster.has(bucket.prefabName)) bucket.dirty = true;
      }
    }

    if (!this.physicsEnabled) return;
    const dx = x - this.colliderCenterX;
    const dz = z - this.colliderCenterZ;
    if (dx * dx + dz * dz < COLLIDER_REBUILD_STEP * COLLIDER_REBUILD_STEP) return;
    this.colliderCenterX = x;
    this.colliderCenterZ = z;
    // Nur Buckets colliderDirty markieren, die tatsächlich eine Instanz im
    // neuen Fenster (COLLIDER_RANGE + COLLIDER_REBUILD_STEP, grosszügig
    // genug für den Versatz seit der letzten Fenstermitte) haben — und NUR
    // colliderDirty, nicht dirty: Das Verschieben des Kollisionsfensters
    // ändert an den Renderdaten (Thin-Instance-Puffer) nichts, nur an der
    // Nah-Auswahl für die Physik. dirty triggert dagegen den vollen,
    // GPU-Upload-lastigen Instanz-Neuaufbau in rebuildBucketInstances —
    // beim Sprinten (alle 1,6 s ein neues Fenster) traf das bislang JEDEN
    // betroffenen Bucket, obwohl nur die Collider neu ausgewählt werden
    // mussten. s. flush()/rebuildBucketCollidersOnly().
    const grenze = COLLIDER_RANGE + COLLIDER_REBUILD_STEP;
    const r2 = grenze * grenze;
    for (const bucket of this.buckets.values()) {
      if (bucket.dirty || bucket.colliderDirty) continue;
      const mats = bucket.matrices;
      for (let i = 12; i < mats.length; i += 16) {
        const bx = mats[i]! - x;
        const bz = mats[i + 2]! - z;
        if (bx * bx + bz * bz <= r2) {
          bucket.colliderDirty = true;
          break;
        }
      }
    }
  }

  /** Das gemessene 100-FPS-Profil ein- oder ausschalten. */
  setHundertFpsProfil(an: boolean): void {
    if (an === this.hundertFpsProfil) return;
    this.hundertFpsProfil = an;
    // Beide Seiten jeder Familie neu schreiben. So stellt auch ein
    // Umschalten im laufenden Spiel die getrennten Master vollständig
    // wieder her, ohne Welt-Reload und ohne zweite Datenwahrheit.
    for (const bucket of this.buckets.values()) {
      if (FOLIAGE_HASHES.has(bucket.prefabHash) &&
          (bucket.prefabName.endsWith('Dick') || this.bucketNachPrefab(`${bucket.prefabName}Dick`))) {
        bucket.dirty = true;
      }
    }
  }

  /**
   * Sichtweite fuer Baeume und Buesche in Metern; 0 hebt die Begrenzung
   * auf. Der Neuaufbau laeuft ueber das bestehende Frame-Budget und gilt
   * fuer Farbbild UND Schatten, weil beide denselben Master verwenden.
   */
  setVegetationsGrenze(meter: number): void {
    const naechste = Number.isFinite(meter) ? Math.max(0, Math.round(meter)) : 0;
    if (naechste === this.vegetationsGrenzeM) return;
    this.vegetationsGrenzeM = naechste;
    this.markiereVegetationDirty();
  }

  private markiereVegetationDirty(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.mastersReady && FOLIAGE_HASHES.has(bucket.prefabHash)) bucket.dirty = true;
    }
  }

  /**
   * Läuft die Instanz-Tönung? Vorgabe `INSTANZ_TOENUNG_AN`; nur
   * `toenungSetzen()` verändert sie.
   */
  toenungAn = INSTANZ_TOENUNG_AN;

  /**
   * Die Instanz-Tönung zur LAUFZEIT umlegen — für A/B-Messungen.
   *
   * `__dbg.entities.toenungSetzen(false)` und wieder `true`, ohne den
   * Client neu zu laden. Der Grund ist nicht Bequemlichkeit: Auf dieser
   * Maschine messen mehrere Bauer gleichzeitig, die Systemlast schwankt
   * um den Faktor fünf, und zwei Messungen aus zwei Sitzungen sind
   * deshalb nicht vergleichbar. Im Wechsel innerhalb EINER Sitzung
   * gemessen ist der Unterschied der Tönung zuzuschreiben und nicht dem
   * Nachbarn.
   *
   * Zurück kommt, wie viele Buckets daraufhin neu gebaut werden — die
   * Zustandsgrösse, an der man sieht, dass der Schalter überhaupt etwas
   * bewirkt hat. Ohne sie sähe ein wirkungsloser Schalter genauso aus
   * wie ein wirksamer.
   */
  toenungSetzen(an: boolean): { an: boolean; buckets: number } {
    this.toenungAn = an;
    let n = 0;
    for (const bucket of this.buckets.values()) {
      if (!bucket.mastersReady) continue;
      bucket.dirty = true;
      n++;
    }
    return { an, buckets: n };
  }

  /** Diagnose fuer A/B-Messungen ueber window.__dbg.entities. */
  vegetationsGrenzeInfo(): {
    grenzeM: number;
    auswahlRadiusM: number;
    gesamt: number;
    sichtbar: number;
  } {
    let gesamt = 0;
    let sichtbar = 0;
    const radius = this.vegetationsGrenzeM > 0
      ? this.vegetationsGrenzeM + VEGETATIONS_NEUPACK_M
      : 0;
    const r2 = radius * radius;
    for (const bucket of this.buckets.values()) {
      if (!FOLIAGE_HASHES.has(bucket.prefabHash)) continue;
      const n = bucket.matrices.length / 16;
      gesamt += n;
      if (radius <= 0 || !this.vegetationsMitteBekannt) {
        sichtbar += n;
        continue;
      }
      for (let i = 12; i < bucket.matrices.length; i += 16) {
        const dx = bucket.matrices[i]! - this.vegetationsMitteX;
        const dz = bucket.matrices[i + 2]! - this.vegetationsMitteZ;
        if (dx * dx + dz * dz <= r2) sichtbar++;
      }
    }
    return { grenzeM: this.vegetationsGrenzeM, auswahlRadiusM: radius, gesamt, sichtbar };
  }

  /**
   * Mirror a bucket's NEARBY instances onto an invisible collision carrier.
   *
   * The carrier takes the RAW zdo matrices, not the per-master products: the
   * visible masters are one per GLB submesh with their own local offsets,
   * while collision wants a single simple shape at the prefab's origin.
   */
  private rebuildBucketColliders(bucket: StaticBucket, zdoMats: readonly Matrix[]): void {
    if (!this.physicsEnabled) return;
    if (this.colliderless.has(bucket.prefabName)) return;
    // Dungeon-Räume (Phase G) sind IMMER solide — ihre Flags sind 0n, weil
    // sie keine ZNetView-Prefabs sind; das Flag-Gate unten griffe nicht.
    const dungeonRoom = getRoomByHash(bucket.prefabHash) !== undefined;
    // Begehbare Bauwerke umgehen das Flag-Gatter aus DEMSELBEN Grund wie
    // Dungeon-Räume: Sie tragen nur PERSISTENT, und das steht nicht in
    // KOLLIDIERENDE_FLAGS. Ohne diese Ausnahme landeten sie in
    // `colliderless`, noch bevor die Netz-Zweige weiter unten je
    // erreicht wurden — gemessen am laufenden Client hatte deshalb auch
    // der Steinkreis gar keine Kollision, man lief mitten hindurch.
    const begehbar = BEGEHBAR_NAME.test(bucket.prefabName);
    // Nur solide Klassen bekommen überhaupt einen Körper. Die Regel steht
    // in `shared` und nicht mehr hier: Der Server muss dieselbe Menge
    // „fest" haben, sonst zieht seine Korrektur den Spieler durch etwas
    // hindurch, vor dem er im Bild steht.
    if (!istFesterKoerper(findPrefabByHash(bucket.prefabHash), bucket.prefabName, {
      dungeonRaum: dungeonRoom,
      begehbar,
    })) {
      this.colliderless.add(bucket.prefabName);
      return;
    }
    const masters = this.masterMeshes.get(bucket.masterKey);
    // Ein eigenes Kollisionsnetz aus der GLB (`_col`) ERSETZT die
    // Kollision des Prefabs vollständig — s. AssetManager-Kopf. Deshalb
    // reicht es auch allein: ein Prefab, das NUR aus `_col` besteht, hat
    // keine sichtbaren Master und trotzdem Kollision.
    const kollMasters = this.kollisionsMasters.get(bucket.masterKey);
    /*
      Eine Form aus der HANDTABELLE (`shared/src/kollision/
      formUebersteuerung.ts`) braucht überhaupt keine Geometrie — sie
      steht in der Zeile. Sie wird deshalb hier abgefragt und nicht erst
      unten in `kollisionsForm()`: Die grossen Büsche haben 4 426 bis
      8 133 Dreiecke, und `netzAusMastern()` kopierte davon bei jedem
      ersten Aufbau eines Buckets sämtliche Vertexpositionen zusammen,
      nur um sie an eine Funktion zu geben, die sie wegwirft.

      Sie steht auch VOR der Master-Abfrage: Ein Bucket, dessen Master
      noch nicht geladen sind, bekäme sonst keinen Körper, obwohl seine
      Form von keinem Master abhängt.
    */
    const handform = formUebersteuerung(bucket.prefabName);
    if (
      handform === null &&
      (!masters || masters.length === 0) &&
      (!kollMasters || kollMasters.length === 0)
    )
      return;

    // Kollisionseintrag je BUCKET (masterKey), nicht je Prefabname: Zwei
    // Buckets desselben Prefabs teilten sich sonst Träger UND Signatur und
    // bauten sich gegenseitig die Nah-Auswahl ab. Die Form ist dieselbe —
    // geteilt wird trotzdem nichts, weil `signature` je Auswahl gilt.
    let entry = this.colliders.get(bucket.masterKey);
    if (!entry) {
      const def = findPrefabByHash(bucket.prefabHash);
      /*
        Die FORM entscheidet `shared/src/kollision/formen.ts` — dieselbe
        Funktion, die der Server aufruft. Hier wird nur noch geliefert,
        was sie nicht selbst wissen kann: die zusammengelegte Geometrie,
        das Baum-Flag, der Dungeon-Raum und ob ein EIGENES Kollisionsnetz
        vorliegt.

        Ein eigenes Netz (`_col` aus der GLB oder die `…-collision.glb`
        des Speichers) ERSETZT die Kollision vollständig: gebacken wird
        nur aus ihm, die sichtbaren Master kollidieren dann nicht mehr.
        Genau das ist sein Zweck — eine Treppe, deren Kollision aus den
        gerenderten Stufen kommt, ist für die 0,4-m-Kapsel unbegehbar
        (Herleitung im AssetManager-Kopf), das `_col`-Netz legt die
        glatte Rampe darunter.

        Kommt daraus keine Geometrie zusammen, gilt der normale Weg mit
        den sichtbaren Mastern — deshalb das `??` und nicht ein `if`.
      */
      const stammartig = def ? (def.flags & PrefabFlag.TREE_BASE) !== 0n : false;
      const katalog = storeKollision(bucket.prefabName);
      const optionen = { stammartig, dungeonRaum: dungeonRoom };
      let form: KollisionsForm | null = handform;
      if (form === null) {
        const eigen = netzAusMastern(
          kollMasters ?? [],
          this.kollisionsLocals.get(bucket.masterKey) ?? []
        );
        const sicht = netzAusMastern(masters ?? [], this.masterLocals.get(bucket.masterKey) ?? []);
        form =
          (eigen
            ? kollisionsForm(eigen.positionen, eigen.indizes, bucket.prefabName, katalog, {
                ...optionen,
                eigenesNetz: true,
              })
            : null) ??
          (sicht
            ? kollisionsForm(sicht.positionen, sicht.indizes, bucket.prefabName, katalog, optionen)
            : null);
      }
      if (!form) {
        this.colliderless.add(bucket.prefabName);
        return;
      }
      const carrier = new Mesh(`col_${bucket.masterKey}`, this.scene);
      carrier.isVisible = false;
      carrier.isPickable = false;
      entry = { carrier, set: new StaticColliderSet(carrier, form, this.scene), signature: '' };
      this.colliders.set(bucket.masterKey, entry);
      this.colliderSpecs.set(bucket.masterKey, form);
    }

    // Keep only what is close enough to walk into. Translation lives at
    // matrix elements 12/13/14.
    const near: number[] = [];
    const r2 = COLLIDER_RANGE * COLLIDER_RANGE;
    for (let i = 0; i < zdoMats.length; i++) {
      const m = zdoMats[i]!.m;
      const dx = m[12]! - this.colliderCenterX;
      const dz = m[14]! - this.colliderCenterZ;
      if (dx * dx + dz * dz <= r2) near.push(i);
    }
    // Signatur der Auswahl: nur bei echter Änderung neu bauen.
    //
    // sync() verwirft die Havok-Bodies und legt sie neu an. Bei jedem
    // dirty-Bucket auszuführen hiess: Solange ZDO-Updates hereinkamen,
    // wurden die Kollisionskörper laufend zerstört und neu erzeugt — und
    // in genau diesen Lücken lief der Spieler durch Bäume hindurch
    // (gemessen: 0,37 m Abstand zu einem Stamm mit 0,79 m Radius). Das
    // HUD zeigte es als auseinanderlaufende Zähler "36 inst / 84 havok".
    let sig = `${near.length}`;
    for (let k = 0; k < near.length; k++) {
      const m = zdoMats[near[k]!]!.m;
      sig += `|${m[12]!.toFixed(2)},${m[14]!.toFixed(2)}`;
    }
    if (sig === entry.signature) return;
    entry.signature = sig;

    const data = new Float32Array(near.length * 16);
    for (let k = 0; k < near.length; k++) zdoMats[near[k]!]!.toArray(data, k * 16);
    entry.carrier.thinInstanceSetBuffer('matrix', data, 16, false);
    entry.set.sync();
    if (SHOW_COLLIDERS) entry.set.showDebug();
  }

  private applyStatic(u: ZDOEntityUpdate, prefabName: string, model: string | null): void {
    // Raum-Steinmaterial (ZDO-Member `steinKit`) entscheidet über den Bucket:
    // Nur so können zwei Kammern desselben Prefabs verschieden aussehen — ein
    // Bucket hat genau einen Satz Master und damit genau ein Material.
    const ueber = u.steinKit ?? '';
    const schluessel = bucketSchluessel(u.prefabHash, ueber);
    // Wechselt ein ZDO den Bucket (Override gekommen/gegangen), erst drüben
    // ausräumen — sonst stünde die Instanz in beiden.
    const alterBucket = this.bucketOf.get(u.key);
    if (alterBucket !== undefined && alterBucket !== schluessel) {
      this.ausBucketEntfernen(u.key);
    }
    let bucket = this.buckets.get(schluessel);
    if (!bucket) {
      bucket = {
        prefabName,
        prefabHash: u.prefabHash,
        schluessel,
        masterKey: ueber ? `${prefabName}#${ueber}` : prefabName,
        steinKitOverride: ueber,
        steinKitCfg: leseSteinKitOverride(ueber),
        indexOf: new Map(),
        matrices: [],
        dirty: false,
        colliderDirty: false,
        mastersReady: false,
      };
      this.buckets.set(schluessel, bucket);
      this.prepareMasters(bucket, model);
    }

    const world = composeZdoWorld(u, findPrefabByHash(u.prefabHash)?.localScale);
    // Umkreis-Index mitführen. Die Position wird aus der fertigen Matrix
    // gelesen (Translation liegt row-major auf 12/13/14) und nicht aus
    // `u.position`: Die lineare Suche las bislang genau diese Werte, und
    // die Matrix ist ein Float32Array — sie rundet. Aus derselben Quelle zu
    // lesen heisst, dass Index und alte Suche bitgleiche Werte liefern.
    const m = world.m;
    this.indexSetzen(u.key, prefabName, m[12]!, m[13]!, m[14]!);
    if (bucket.indexOf.has(u.key)) {
      const idx = bucket.indexOf.get(u.key)!;
      world.copyToArray(bucket.matrices, idx * 16);
    } else {
      bucket.indexOf.set(u.key, bucket.matrices.length / 16);
      // Umkehrindex MITFÜHREN. `removeZDO` schlägt den Bucket über
      // `bucketOf` nach — ohne diesen Eintrag findet es nichts und
      // entfernt still gar nichts. Statische Objekte waren dadurch
      // unlöschbar: Der Platzierungs-Geist des Editors blieb nach dem
      // Setzen auf dem neuen Bauwerk stehen (gemessen: der Bucket hielt
      // `edghost` UND `edplace-0`), und es sah aus, als würde doppelt
      // gesetzt. `applyDynamic` pflegt seinen Index längst — hier fehlte er.
      this.bucketOf.set(u.key, schluessel);
      world.toArray(bucket.matrices, bucket.matrices.length);
      this.staticCount++;
    }
    bucket.dirty = true;
  }

  private prepareMasters(bucketVorlage: StaticBucket, model: string | null): void {
    const schluessel = bucketVorlage.schluessel;
    if (this.pending.has(schluessel)) return;
    this.pending.add(schluessel);
    if (!model) {
      // no GLB in the export — nothing to instance (sprites come in Phase 5)
      return;
    }
    /*
      Das eigene Kollisionsnetz des Speichers — eine ZWEITE Datei.

      Der Altbestand trägt seines im Modell (`_col`-Mesh); der Speicher
      nennt es in `prefabs.json` als `…-collision.glb`, und in keiner
      seiner GLBs steckt ein `_col`-Knoten. Beide Wege enden hier in
      derselben Liste `kollision`, damit die Formableitung nur EINEN Fall
      kennt: „es gibt ein eigenes Netz" oder „es gibt keines".

      Betroffen sind vier Bauwerke (Treppe, Unterstand, Steg, Torbogen) —
      die 15 Höhenfelder mit `art: 'mesh'` bekommen ohnehin nie einen
      Körper (`istFesterStoreKoerper`). Geladen wird die zweite Datei
      also fast nie, und wenn, dann genau dort, wo eine Hüllbox den
      Durchgang zumauerte.
    */
    const netz = storeKollision(bucketVorlage.prefabName)?.netz;
    const laden =
      netz === undefined
        ? this.assets.getMasters(model)
        : Promise.all([
            this.assets.getMasters(model),
            this.assets.getKollisionsMasters(kollisionsModellPfad(netz)),
          ]).then(([a, b]) => [...a, ...b]);
    void laden.then((masters) => {
      const bucket = this.buckets.get(schluessel);
      if (!bucket || masters.length === 0) return;
      // E23: FOLIAGE wird nur über Wasser gestreut. Die gemeinsame Hülle
      // seiner Thin Instances darf deshalb nicht entscheiden, ob der ganze
      // Bestand ein zweites Mal im Unterwasser-Pass gezeichnet wird.
      if (FOLIAGE_HASHES.has(bucket.prefabHash)) {
        for (const master of masters) markiereAlsGestreuteLandschaft(master.mesh);
      }
      // ── Override-Bucket: EIGENE Master ───────────────────────────────
      //
      // `getMasters()` liefert je Modell dieselben Prototypen an alle
      // Aufrufer. Ein zweiter Bucket darf sie nicht mitbenutzen: Babylon
      // hängt die Instanzmatrizen an die GEOMETRY, nicht ans Mesh
      // (thinInstanceMesh.js:88 → mesh.js:1396) — beide Buckets
      // überschrieben sich also gegenseitig ihre Instanzen, samt Hülle.
      // Aus demselben Grund ist es NICHT `mesh.clone()`: Ein Klon reicht die
      // Geometry der Quelle einfach weiter (mesh.js:350).
      //
      // `zellMeshAusPrototyp()` ist der im Haus bereits bewiesene Weg (E19 c,
      // client/test/master-huelle.ts): eigene Geometry samt eigener Hülle,
      // die CPU-seitigen Typed Arrays werden geteilt — genau die
      // „Geometrie teilen, Puffer nicht"-Grenze, die hier gebraucht wird.
      // Own masters for an override bucket: thin-instance buffers live on the
      // GEOMETRY, so sharing it (clone included) would make two buckets
      // overwrite each other. zellMeshAusPrototyp gives an own geometry while
      // sharing the CPU-side vertex data.
      //
      // Die reinen Kollisionsnetze (`_col`, s. AssetManager-Kopf) werden
      // hier ABGETRENNT und NICHT geklont: Sie tragen nie Instanzen,
      // also gibt es auch nichts, was sich zwei Buckets überschreiben
      // könnten — und ein Klon kostete nur Speicher.
      const sichtbar = masters.filter((m) => !m.nurKollision);
      const kollision = masters.filter((m) => m.nurKollision);
      const meshes = bucket.steinKitOverride
        ? sichtbar.map((m, i) =>
            zellMeshAusPrototyp(m.mesh, `${bucket.masterKey}_${i}`, this.scene)
          )
        : sichtbar.map((m) => m.mesh);
      this.masterMeshes.set(bucket.masterKey, meshes);
      this.masterLocals.set(bucket.masterKey, sichtbar.map((m) => m.localMatrix));
      if (kollision.length > 0) {
        this.kollisionsMasters.set(bucket.masterKey, kollision.map((m) => m.mesh));
        this.kollisionsLocals.set(bucket.masterKey, kollision.map((m) => m.localMatrix));
      }
      this.weiseSteinMaterialZu(bucket, meshes);
      bucket.mastersReady = true;
      bucket.dirty = true; // rebuild with instances now
    });
  }

  /**
   * 1.0-Steingrab-Kit: das gebackene GLB-Material durch das konfigurierte
   * KI-Steinmaterial ersetzen. Nur Teile eines Kits mit `steinKit` — Bäume,
   * Requisiten und Räume anderer Kits bleiben unberührt. Das Material wird
   * beim PBRMaterial-Ctor automatisch vom Fackel-Pool erfasst.
   *
   * MISCHREIHENFOLGE (unten gewinnt): Kit-Vorgabe → Dokument → RoomDef →
   * PLATZIERTER Raum. Das Dokument steht in der Mitte, weil es „dieses Grab
   * sieht anders aus" sagt, der Raumtyp aber „diese Kammer sieht anders aus
   * als der Gang" — und das Feinere darf das Gröbere nicht verlieren. Zuunterst
   * die einzelne Platzierung: Sie meint GENAU DIESE Kammer, nicht ihren Typ.
   * Merge order (last wins): kit default → document → RoomDef → placed room.
   */
  private weiseSteinMaterialZu(
    bucket: StaticBucket,
    masters: readonly import('@babylonjs/core/Meshes/mesh').Mesh[]
  ): void {
    const kitCfg = getKitByPrefabHash(bucket.prefabHash)?.steinKit;
    if (!kitCfg) return;
    // Für den Dokumentwechsel merken — `prepareMasters` kommt nie wieder.
    this.steinMasters.set(bucket.schluessel, { bucket, masters: [...masters] });
    // Türen sind keine Räume → getRoomByHash undefined → kein Raum-Override.
    const merged = mergeSteinKit(
      mergeSteinKit(
        mergeSteinKit(kitCfg, this.dokumentSteinKit ?? undefined),
        getRoomByHash(bucket.prefabHash)?.steinKit
      ),
      bucket.steinKitCfg
    );
    const mat = this.holeSteinMaterial(merged);
    for (const m of masters) m.material = mat;
  }

  /**
   * Das Steinmaterial des betretenen Dokuments setzen (null = zurück auf die
   * Kit-Vorgabe) und ALLE schon geladenen Steinteile neu bemalen.
   *
   * Ohne dieses Nachziehen sähe das zweite Grab einer Sitzung aus wie das
   * erste: Die Master werden je prefabHash nur EINMAL geladen und bemalt,
   * und ein zweiter Ladevorgang kommt nie (`pending` wird nie geleert).
   * Without this re-paint the second barrow of a session would look like the
   * first — masters are loaded and painted exactly once per hash.
   */
  setzeDokumentSteinKit(cfg: Partial<SteinKitConfig> | null): void {
    const neu = cfg && Object.keys(cfg).length > 0 ? cfg : null;
    if (JSON.stringify(this.dokumentSteinKit) === JSON.stringify(neu)) return;
    this.dokumentSteinKit = neu;
    // ALLE Buckets, auch die mit Raum-Override und deren eigenen Klonen —
    // sonst bliebe die zweite Kammer desselben Prefabs beim Dokumentwechsel
    // auf ihrem alten Material stehen.
    for (const { bucket, masters } of this.steinMasters.values()) {
      this.weiseSteinMaterialZu(bucket, masters);
    }
  }

  /** Ein Steinmaterial je Konfiguration (Master sind sitzungs-gecacht). */
  private holeSteinMaterial(cfg: SteinKitConfig): PBRMaterial {
    const key = JSON.stringify(cfg);
    let mat = this.steinMaterials.get(key);
    if (!mat) {
      mat = erzeugeSteinKitMaterial(this.scene, `steinKit_${this.steinMaterials.size}`, cfg);
      this.steinMaterials.set(key, mat);
    }
    return mat;
  }

  /** bucket.matrices (flach) in Matrix-Objekte entpacken — von beiden
   *  Rebuild-Pfaden gebraucht, s. rebuildBucketInstances/-CollidersOnly. */
  private buildZdoMats(bucket: StaticBucket): Matrix[] {
    const count = bucket.matrices.length / 16;
    const zdoMats = new Array<Matrix>(count);
    for (let i = 0; i < count; i++) {
      zdoMats[i] = Matrix.FromArray(bucket.matrices, i * 16);
    }
    return zdoMats;
  }

  /**
   * Begrenzte Renderauswahl fuer FOLIAGE. Die rohen `bucket.matrices`
   * bleiben vollstaendig: Kollision, Interaktion und Weltzustand duerfen
   * von einer Grafikoption nicht veraendert werden.
   */
  private sichtbareVegetationsMatrizen(
    bucket: StaticBucket,
    zdoMats: readonly Matrix[]
  ): readonly Matrix[] {
    if (
      this.vegetationsGrenzeM <= 0 ||
      !this.vegetationsMitteBekannt ||
      !FOLIAGE_HASHES.has(bucket.prefabHash)
    ) return zdoMats;
    const radius = this.vegetationsGrenzeM + VEGETATIONS_NEUPACK_M;
    return vegetationsMatrizenImRadius(
      zdoMats,
      this.vegetationsMitteX,
      this.vegetationsMitteZ,
      radius
    );
  }

  /**
   * Expand the bucket's persistent zdoWorld store into thin-instance
   * buffers: instance = masterLocal × zdoWorld (row-major).
   *
   * Seit E19 c gibt es dafür ZWEI Wege — den alten Vollmaster für kleine
   * Buckets und den Zellschnitt für die dicke Vegetation, s.
   * zellSchnittTaugt(). Was beide teilen: dieselben zdoMats, dieselbe
   * Multiplikation, dieselbe Dreierfolge schreibeInstanzen(). Der
   * Kollisionspfad hängt unverändert an den ROHEN zdoMats und bleibt
   * prefabweise.
   */
  /**
   * ZDO-Schluessel (`userId:id`), deren Instanz gerade NICHT gezeichnet
   * werden soll.
   *
   * Gebraucht fuer die geoeffnete Truhe: Sie wird als echte, animierte
   * Kopie ueber `AssetManager.instantiate()` an dieselbe Stelle gesetzt.
   * Bliebe die Thin Instance daneben stehen, saehe man zwei Deckel.
   *
   * Bewusst eine MENGE und keine Matrixmanipulation: Ein direkt in den
   * Puffer geschriebener Nullwert waere beim naechsten Neuaufbau des
   * Buckets wieder weg (jede ZDO-Aenderung in der Naehe loest einen
   * aus). Ueber die Menge ueberlebt das Verbergen jeden Neuaufbau.
   *
   * Collider bleiben unberuehrt — man soll nicht durch eine offene
   * Truhe hindurchlaufen koennen.
   */
  private readonly verborgeneInstanzen = new Set<string>();

  /** Instanz ausblenden bzw. wieder zeigen. `zdoKey` ist `userId:id`. */
  setzeInstanzVerborgen(zdoKey: string, verborgen: boolean): void {
    const vorher = this.verborgeneInstanzen.has(zdoKey);
    if (vorher === verborgen) return;
    if (verborgen) this.verborgeneInstanzen.add(zdoKey);
    else this.verborgeneInstanzen.delete(zdoKey);
    for (const b of this.buckets.values()) {
      if (b.indexOf.has(zdoKey)) b.dirty = true;
    }
  }

  /**
   * Weltposition einer Instanz — der Aufrufer braucht sie, um die
   * animierte Kopie an dieselbe Stelle zu setzen.
   */
  instanzPosition(zdoKey: string): { x: number; y: number; z: number } | null {
    for (const b of this.buckets.values()) {
      const flach = b.indexOf.get(zdoKey);
      if (flach === undefined) continue;
      return { x: b.matrices[flach + 12]!, y: b.matrices[flach + 13]!, z: b.matrices[flach + 14]! };
    }
    return null;
  }

  /** Verborgene Instanzen aus der Renderliste nehmen. */
  private ohneVerborgene(
    bucket: StaticBucket,
    zdoMats: readonly Matrix[],
    renderMats: readonly Matrix[]
  ): readonly Matrix[] {
    if (this.verborgeneInstanzen.size === 0) return renderMats;
    const raus = new Set<Matrix>();
    for (const key of this.verborgeneInstanzen) {
      const flach = bucket.indexOf.get(key);
      if (flach === undefined) continue;
      const m = zdoMats[flach / 16];
      if (m) raus.add(m);
    }
    if (raus.size === 0) return renderMats;
    return renderMats.filter((m) => !raus.has(m));
  }

  private rebuildBucketInstances(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.masterKey);
    const locals = this.masterLocals.get(bucket.masterKey);
    if (!masters || !locals) return;

    const zdoMats = this.buildZdoMats(bucket);
    if (this.hundertFpsProfil && this.baueGefalteteBaumfamilie(bucket)) {
      // Collider bleiben prefabtreu: Die Dick-Variante behält ihre eigene
      // Geometrie. Nur der Renderpfad verwendet den normalen Master.
      this.rebuildBucketColliders(bucket, zdoMats);
      return;
    }
    const renderMats = this.ohneVerborgene(
      bucket,
      zdoMats,
      this.sichtbareVegetationsMatrizen(bucket, zdoMats)
    );
    // Der Zellschnitt (samt Sprite-Fernfeld) ist nach PREFABNAME geschlüsselt
    // — `zellMaster`, der Zell-Pool und der Impostor-Atlas. Ein Bucket mit
    // Raum-Steinmaterial teilt sich diesen Namen mit dem Bucket ohne Override
    // und würde ihm die Zellen wegräumen. Er nimmt deshalb immer den
    // Vollmaster: Es sind Dungeon-Räume, ein paar Dutzend Instanzen — der
    // Schnitt ist für gestreute Vegetation gebaut und griffe hier ohnehin nie.
    // Override buckets always take the full master: the cell cut is keyed by
    // prefab NAME and is meant for scattered vegetation, not dungeon rooms.
    if (!bucket.steinKitOverride && this.zellSchnittTaugt(masters, renderMats.length)) {
      this.baueZellMaster(bucket, masters, locals, renderMats);
    } else {
      this.baueVollMaster(bucket, masters, locals, renderMats);
    }

    this.rebuildBucketColliders(bucket, zdoMats);
  }

  private bucketNachPrefab(prefabName: string): StaticBucket | null {
    for (const bucket of this.buckets.values()) {
      if (bucket.prefabName === prefabName) return bucket;
    }
    return null;
  }

  /**
   * Faltet `<Baum>` und `<Baum>Dick` auf den normalen Render-Master.
   *
   * Die generierten Paare haben dieselbe Topologie und dieselben lokalen
   * Hüllmaße; die Dick-GLB unterscheidet sich nur in der Stammstärke. Die
   * ZDO-Weltmatrizen dürfen daher gemeinsam mit der lokalen Matrix des
   * normalen Modells instanziert werden. Stimmen Masterzahl oder
   * Indizes irgendwann nicht mehr überein, greift der sichere alte Weg.
   */
  private baueGefalteteBaumfamilie(ausloeser: StaticBucket): boolean {
    if (!FOLIAGE_HASHES.has(ausloeser.prefabHash)) return false;
    const basisName = ausloeser.prefabName.endsWith('Dick')
      ? ausloeser.prefabName.slice(0, -4)
      : ausloeser.prefabName;
    const dickName = `${basisName}Dick`;
    const basisBucket = this.bucketNachPrefab(basisName);
    const dickBucket = this.bucketNachPrefab(dickName);
    if (!basisBucket?.mastersReady || !dickBucket?.mastersReady) return false;

    const basisMasters = this.masterMeshes.get(basisName);
    const basisLocals = this.masterLocals.get(basisName);
    const dickMasters = this.masterMeshes.get(dickName);
    if (!basisMasters || !basisLocals || !dickMasters || basisMasters.length !== dickMasters.length) return false;
    for (let i = 0; i < basisMasters.length; i++) {
      if (basisMasters[i]!.getTotalIndices() !== dickMasters[i]!.getTotalIndices()) return false;
    }

    this.zellenAbbauen(basisName);
    this.zellenAbbauen(dickName);
    this.impostoren?.setzePrefab(basisName, null);
    this.impostoren?.setzePrefab(dickName, null);
    const basisMats = this.sichtbareVegetationsMatrizen(
      basisBucket,
      this.buildZdoMats(basisBucket)
    );
    const dickMats = this.sichtbareVegetationsMatrizen(
      dickBucket,
      this.buildZdoMats(dickBucket)
    );
    const count = basisMats.length + dickMats.length;
    for (let m = 0; m < basisMasters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = basisLocals[m]!;
      let ziel = 0;
      for (const world of basisMats) local.multiply(world).toArray(data, ziel++ * 16);
      for (const world of dickMats) local.multiply(world).toArray(data, ziel++ * 16);
      const puffer = count > 0 ? data : null;
      schreibeInstanzen(basisMasters[m]!, puffer);
      schreibeInstanzen(dickMasters[m]!, null);
      this.meldeVegetationsSchatten(basisBucket, basisMasters[m]!, puffer);
      this.meldeVegetationsSchatten(dickBucket, dickMasters[m]!, null);
    }
    return true;
  }

  /**
   * Darf dieser Bucket zellweise geschnitten werden?
   *
   * Drei Bedingungen, jede aus einem eigenen Grund:
   *  - Genug Instanzen (ZELL_SCHNITT_AB). Darunter lohnt der Schnitt
   *    nicht und würde nur Zeichenaufrufe vervielfachen.
   *  - Höchstens EIN Submesh je Prototyp. `VertexData.applyToMesh()`
   *    legt genau ein Submesh an; ein Prototyp mit MultiMaterial
   *    verlöre beim Kopieren seine Materialzuordnung. Nach dem
   *    Verschmelzen nach Material (AssetManager) ist das der Normalfall,
   *    aber verlassen will man sich darauf nicht.
   *  - Eine Szene. Der statische Pfad ist ohne Szene konstruierbar
   *    (client/test/entity-index.ts baut `new EntityManager(null,…)`),
   *    dort entsteht kein einziges Mesh.
   */
  private zellSchnittTaugt(masters: readonly Mesh[], anzahl: number): boolean {
    if (anzahl <= ZELL_SCHNITT_AB) return false;
    if (!this.scene) return false;
    for (const m of masters) {
      if (m.subMeshes && m.subMeshes.length > 1) return false;
    }
    return true;
  }

  /** Der Weg von D10: ein Master je Submesh trägt ALLE Instanzen. */
  private baueVollMaster(
    bucket: StaticBucket,
    masters: readonly Mesh[],
    locals: readonly Matrix[],
    zdoMats: readonly Matrix[]
  ): void {
    // Der Bucket kann geschrumpft sein (Instanzen entfernt) und vorher
    // geschnitten gewesen sein — dann tragen noch Zell-Master seine
    // Instanzen, und ohne diesen Abbau stünde jedes Objekt doppelt im
    // Bild.
    this.zellenAbbauen(bucket.prefabName);
    // Dasselbe für das Sprite-Fernfeld, aus demselben Grund: Ein
    // liegengebliebener Sprite-Beitrag zeichnete den Baum ein zweites
    // Mal. Der Vollmaster trägt IMMER alle Instanzen — Sprites gibt es
    // nur im geschnittenen Betrieb.
    this.impostoren?.setzePrefab(bucket.prefabName, null);
    const count = zdoMats.length;
    // Die Tönung hängt am MODELL, nicht am Prefabnamen: `PrefabDef.model`
    // sagt, aus welchem Bestand die Datei stammt (s. darfGetoentWerden).
    const modell = findPrefabByHash(bucket.prefabHash)?.model ?? null;
    for (let m = 0; m < masters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = locals[m]!;
      for (let i = 0; i < count; i++) {
        local.multiply(zdoMats[i]!).toArray(data, i * 16);
      }
      const puffer = count > 0 ? data : null;
      schreibeInstanzen(masters[m]!, puffer);
      // NACH schreibeInstanzen: `thinInstanceSetBuffer('matrix', …)` setzt
      // `instancesCount`, und der Farbpuffer wird gegen diese Zahl
      // gelesen. Umgekehrt stünde die Farbe für einen Moment gegen die
      // Instanzzahl des vorigen Aufbaus.
      const toenen = puffer !== null && darfGetoentWerden(masters[m]!, modell, this.toenungAn);
      schreibeToenung(masters[m]!, toenen ? zdoMats : null, null, toenen ? count : 0);
      this.meldeVegetationsSchatten(bucket, masters[m]!, puffer);
    }
  }

  /**
   * Der Zellschnitt (E19 c): die Instanzen eines Prefabs auf einen Master
   * je (Prototyp × 128-m-Zelle × Überlaufblock) verteilen.
   *
   * ── Was das bewirkt ──────────────────────────────────────────────
   * Gleich viele Instanzen, gleich viele Matrixmultiplikationen, nur
   * verteilt auf mehr und kleinere Puffer. Der Gewinn kommt
   * ausschliesslich daraus, dass die HÜLLEN klein werden und damit die
   * beiden vorhandenen Keulungen greifen, die bisher an der 425-m-Hülle
   * des Vollmasters wirkungslos abprallten: die Frustumprüfung im
   * Bildpass und die Entfernungsprüfung in Shadows.darfWerfen() für die
   * Werferliste. Gemessen auf der Insel erreichten je Kaskade nur 14–15 %
   * der 24.265 Vegetationsinstanzen die Schattenkarte — die übrigen 85 %
   * wurden eingereicht, transformiert und verworfen (E20).
   *
   * ── Was hier NICHT passiert ──────────────────────────────────────
   * `bucket.matrices` bleibt EINE flache Liste je Prefab. Vier Pfade
   * lesen sie indexbasiert (Swap-Remove in removeZDO, der Scan in
   * setPlayerPosition, naechstesInteragierbares, lichtquellen), und
   * client/test/entity-index.ts prüft genau dieses Layout. Der Schnitt
   * lebt allein im Renderpfad und wird bei jedem Neuaufbau frisch
   * gerechnet; es gibt keine zweite Wahrheit, die auseinanderlaufen
   * könnte.
   *
   * Ebenso bleibt der Umkreis-Index (INDEX_ZELLE_M = 32) unangetastet:
   * andere Zellgrösse, andere Gründe, anderer Lebenszyklus. Geteilt wird
   * nur `zellenSchluessel()`.
   */
  private baueZellMaster(
    bucket: StaticBucket,
    masters: readonly Mesh[],
    locals: readonly Matrix[],
    zdoMats: readonly Matrix[]
  ): void {
    // Die Prototypen zeichnen im Zellbetrieb nie selbst. Über
    // schreibeInstanzen(…, null) abschalten und nicht etwa über
    // setEnabled(false) allein: Sonst behielten sie ihren alten
    // Matrixpuffer samt 425-m-Hülle und blieben mit ihr in der
    // Werferliste stehen.
    for (const proto of masters) {
      if (proto.isEnabled() || proto.thinInstanceCount > 0) schreibeInstanzen(proto, null);
    }

    // Zellzuordnung aus DERSELBEN Quelle wie der Umkreis-Index: der
    // Translation der fertigen Weltmatrix (row-major auf 12/13/14). Nicht
    // aus u.position — die Matrix ist f32-gerundet, und zwei verschiedene
    // Quellen ergäben Grenzfälle, in denen eine Instanz in einer anderen
    // Zelle landet als ihr Indexeintrag.
    const proZelle = new Map<number, number[]>();
    for (let i = 0; i < zdoMats.length; i++) {
      const m = zdoMats[i]!.m;
      const schluessel = zellenSchluessel(
        Math.floor(m[12]! / RENDER_ZELLE_M),
        Math.floor(m[14]! / RENDER_ZELLE_M)
      );
      const liste = proZelle.get(schluessel);
      if (liste) liste.push(i);
      else proZelle.set(schluessel, [i]);
    }

    let zellen = this.zellMaster.get(bucket.prefabName);
    if (!zellen) this.zellMaster.set(bucket.prefabName, (zellen = new Map()));

    // s. baueVollMaster — dieselbe Quelle, damit ein Prefab im
    // geschnittenen und im ungeschnittenen Betrieb dieselbe Farbe trägt.
    const toenungsModell = findPrefabByHash(bucket.prefabHash)?.model ?? null;

    // ── Sprite-Fernfeld: gibt es fuer dieses Prefab einen Atlas? ─────
    // `melde()` baeckt beim ersten Mal (8 Ansichten, einmal je Sitzung
    // und Archetyp) und liefert danach sofort. Schlaegt das Backen fehl
    // oder ist das Prefab zu klein, bleibt `atlas` false — und dann
    // faellt JEDE Instanz auf die echte Darstellung zurueck, niemals auf
    // gar keine. Das ist der Fail-Soft, den Leitplanke 4 verlangt.
    //
    // `spielerBekannt` ist der zweite Riegel: Vor dem ersten
    // setPlayerPosition() steht die Fenstermitte auf (0,0), und ein
    // Spieler, der auf der Insel bei 10077/-18723 einloggt, saehe seinen
    // gesamten Wald als Sprites. Symptom waere "beim Start ist der halbe
    // Wald weg, nach dem ersten Schritt kommt er" — der Fehler, vor dem
    // die Analyse ausdruecklich warnt.
    const imp = this.impostoren;
    let atlas = false;
    if (imp !== null && this.spielerBekannt) {
      // `kennt()` spart den Aufbau der Master-Liste im Normalfall — der
      // Bucket wird bei jeder Spielerbewegung neu gebaut, das Backen
      // passiert aber genau einmal je Archetyp und Sitzung.
      atlas = imp.kennt(bucket.prefabName)
        ? imp.atlasBereit(bucket.prefabName)
        : imp.melde(bucket.prefabName, this.masterQuelle(bucket.prefabName));
    }
    const grenze = this.impostorGrenze;
    const spriteZellen = atlas ? new Map<number, Float32Array>() : null;
    const nah: number[] = [];
    const fern: number[] = [];

    for (const [schluessel, alleIndizes] of proZelle) {
      const cx = (schluessel >>> 16) - 0x8000;
      const cz = (schluessel & 0xffff) - 0x8000;
      // Die EINE Zuteilung. `zellLage` ist nur der billige Vorfilter
      // (ganz nah / ganz fern), `teileZelle` die Regel — beide aus
      // derselben Ungleichung abgeleitet, damit es keine zwei Wahrheiten
      // gibt. s. BaumImpostorKern.
      const lage = zellLage(cx, cz, RENDER_ZELLE_M, this.spriteMitteX, this.spriteMitteZ, grenze, atlas);
      teileZelle(
        alleIndizes,
        (i) => zdoMats[i]!.m[12]!,
        (i) => zdoMats[i]!.m[14]!,
        lage,
        this.spriteMitteX,
        this.spriteMitteZ,
        grenze,
        nah,
        fern
      );

      if (spriteZellen && fern.length > 0) {
        spriteZellen.set(schluessel, this.spriteDaten(bucket.prefabName, zdoMats, fern));
      }

      const indizes = nah;
      let bloecke = zellen.get(schluessel);
      if (!bloecke) {
        if (indizes.length === 0) continue; // reine Sprite-Zelle: kein Master
        zellen.set(schluessel, (bloecke = masters.map(() => [] as Mesh[])));
      }
      const gebraucht = Math.ceil(indizes.length / ZELL_MAX_INSTANZEN);
      for (let m = 0; m < masters.length; m++) {
        const local = locals[m]!;
        const reihe = bloecke[m]!;
        for (let b = 0; b < gebraucht; b++) {
          const von = b * ZELL_MAX_INSTANZEN;
          const bis = Math.min(von + ZELL_MAX_INSTANZEN, indizes.length);
          const data = new Float32Array((bis - von) * 16);
          for (let k = von; k < bis; k++) {
            local.multiply(zdoMats[indizes[k]!]!).toArray(data, (k - von) * 16);
          }
          let mesh = reihe[b];
          if (!mesh) {
            mesh = this.zellMeshHolen(bucket.prefabName, m, masters[m]!, schluessel, b);
            reihe[b] = mesh;
          }
          schreibeInstanzen(mesh, data);
          // Dieselbe Tönung wie im Vollmaster-Pfad, und aus derselben
          // Quelle: der Weltposition. Ein Baum darf seine Farbe nicht
          // ändern, nur weil er in eine Zelle gerutscht ist.
          const toenen = darfGetoentWerden(mesh, toenungsModell, this.toenungAn);
          schreibeToenung(mesh, toenen ? zdoMats : null, indizes.slice(von, bis), toenen ? bis - von : 0);
        }
        // Überzählige Blöcke (die Zelle ist dünner geworden — oder ihre
        // Instanzen sind ins Sprite-Feld gewandert) freigeben.
        for (let b = reihe.length - 1; b >= gebraucht; b--) {
          this.zellMeshFreigeben(bucket.prefabName, m, reihe[b]!);
          reihe.length = b;
        }
      }
      // Eine Zelle, die vollstaendig ins Sprite-Feld gewandert ist, haelt
      // jetzt nur noch leere Reihen — raus aus der Buchfuehrung, sonst
      // zaehlt zellStats() sie als lebende Zelle.
      if (indizes.length === 0) zellen.delete(schluessel);
    }

    // Leergelaufene Zellen: Puffer auf null, abgeschaltet, zurück in den
    // Pool. Nicht entsorgen — s. zellPool.
    for (const [schluessel, bloecke] of zellen) {
      if (proZelle.has(schluessel)) continue;
      for (let m = 0; m < bloecke.length; m++) {
        for (const mesh of bloecke[m]!) this.zellMeshFreigeben(bucket.prefabName, m, mesh);
      }
      zellen.delete(schluessel);
    }

    // Die Sprite-Beitraege dieses Prefabs VOLLSTAENDIG ersetzen — auch
    // wenn sie leer sind. Ein liegengebliebener Beitrag waere ein
    // DOPPELBILD (der Baum stuende echt und als Sprite zugleich), und das
    // ist genau der Fehlermodus, den Leitplanke 4 ausschliesst.
    this.impostoren?.setzePrefab(bucket.prefabName, spriteZellen);
  }

  /**
   * Instanzdaten fuer das Sprite-Feld: je Instanz x, y, z, Kartenbreite,
   * Kartenhoehe, Gierwinkel (Stride SPRITE_STRIDE).
   *
   * Die Kartenmasse kommen aus der gebackenen Atlaszeile (Modellmasse in
   * Metern) und werden mit der Instanzskalierung multipliziert — dieselbe
   * Quelle, aus der auch der Rahmen der Backkamera stammt. Waeren es zwei
   * Quellen, saesse der Sprite systematisch neben seinem Zwilling.
   */
  private spriteDaten(
    prefabName: string,
    zdoMats: readonly Matrix[],
    indizes: readonly number[]
  ): Float32Array {
    const masse = this.impostoren!.zeileVon(prefabName)!;
    const aus = new Float32Array(indizes.length * SPRITE_STRIDE);
    for (let k = 0; k < indizes.length; k++) {
      const m = zdoMats[indizes[k]!]!.m;
      const { yaw, sxz, sy } = yawUndSkala(m, 0);
      const o = k * SPRITE_STRIDE;
      aus[o] = m[12]!;
      aus[o + 1] = m[13]!;
      aus[o + 2] = m[14]!;
      aus[o + 3] = masse.breite * sxz;
      aus[o + 4] = masse.hoehe * sy;
      aus[o + 5] = yaw;
    }
    return aus;
  }

  /** Die Prototypen eines Prefabs als PrefabMaster-Paare — fuer den Backer. */
  private masterQuelle(prefabName: string): Array<{ mesh: Mesh; localMatrix: Matrix }> {
    const meshes = this.masterMeshes.get(prefabName) ?? [];
    const locals = this.masterLocals.get(prefabName) ?? [];
    const aus: Array<{ mesh: Mesh; localMatrix: Matrix }> = [];
    for (let i = 0; i < meshes.length && i < locals.length; i++) {
      aus.push({ mesh: meshes[i]!, localMatrix: locals[i]! });
    }
    return aus;
  }

  /**
   * Einen Zell-Master besorgen — aus dem Pool oder frisch.
   *
   * Der Name behält den Prototypnamen als PRÄFIX und bekommt die Zelle
   * als Suffix (`leaves_merged#78_-146`, Überlaufblöcke mit `_1`, `_2`).
   * Das ist kein Schmuck: Shadows.NIE_WERFEN ist auf `^` verankert
   * (clutter|sky|water|col_|avatar_…) und Shadows.KLEINZEUG bewusst
   * nicht; ein vorangestelltes Zellkürzel würde die eine Regel
   * stillschweigend aushebeln und die andere weiterhin treffen. Auch die
   * Diagnose in main.ts klassifiziert über Namenspräfixe.
   */
  private zellMeshHolen(
    prefabName: string,
    prototypIndex: number,
    proto: Mesh,
    zelle: number,
    block: number
  ): Mesh {
    const cx = (zelle >>> 16) - 0x8000;
    const cz = (zelle & 0xffff) - 0x8000;
    const name = `${proto.name}#${cx}_${cz}${block > 0 ? `_${block}` : ''}`;
    const frei = this.zellPool.get(`${prefabName}|${prototypIndex}`)?.pop();
    if (frei) {
      // Umbenennen ist gefahrlos: Der Schattengenerator merkt sich
      // Meshes über die Objektidentität, und die Namensregeln greifen
      // auf den unveränderten Präfix.
      frei.name = name;
      this.onMasterBelebt?.(frei);
      return frei;
    }
    return zellMeshAusPrototyp(proto, name, this.scene);
  }

  /**
   * Zell-Master leeren, abschalten und zur Wiederverwendung ablegen.
   *
   * Der Pool ist GEDECKELT (Review-Fund E19 c): Jeder Zell-Master haelt
   * eine eigene GPU-Kopie der Prototyp-Geometrie, und ohne Deckel wuchs
   * der Pool bis zum Sitzungsmaximum — jede je besuchte Zelle blieb als
   * GPU-Speicher liegen. 16 je (Prefab, Prototyp) deckt den Streaming-
   * Takt (Zellen kommen und gehen ringweise); was darueber liegt, wird
   * beim Schattensystem abgemeldet und entsorgt. Die Geometry ist je
   * Zelle EIGEN (zellMeshAusPrototyp), dispose gibt sie also wirklich
   * frei; das Material ist geteilt und bleibt (dispose(false, false)).
   */
  private zellMeshFreigeben(prefabName: string, prototypIndex: number, mesh: Mesh): void {
    schreibeInstanzen(mesh, null);
    const schluessel = `${prefabName}|${prototypIndex}`;
    const pool = this.zellPool.get(schluessel);
    if (!pool) {
      this.zellPool.set(schluessel, [mesh]);
      return;
    }
    if (pool.length >= ZELL_POOL_DECKEL) {
      this.onMasterEntsorgt?.(mesh);
      mesh.dispose(false, false);
      return;
    }
    // Auch GEPOOLTE Master abmelden (Review-Fund 18.08.): Abgeschaltete
    // Meshes kosten in der Werferliste nicht "nur einen Listenplatz" —
    // der Schattenpass iteriert sie je Kaskade. Ohne Abmeldung sammeln
    // sich bis zu DECKEL x Prefabs x Prototypen tote Eintraege. Der
    // Callback entsorgt nichts, er raeumt nur Listen; beim Reaktivieren
    // meldet onMasterBelebt -> meldeWerfer wieder an.
    this.onMasterEntsorgt?.(mesh);
    pool.push(mesh);
  }

  /** Alle Zell-Master eines Prefabs freigeben (Rückfall auf den Vollmaster). */
  private zellenAbbauen(prefabName: string): void {
    const zellen = this.zellMaster.get(prefabName);
    if (!zellen || zellen.size === 0) return;
    for (const bloecke of zellen.values()) {
      for (let m = 0; m < bloecke.length; m++) {
        for (const mesh of bloecke[m]!) this.zellMeshFreigeben(prefabName, m, mesh);
      }
    }
    zellen.clear();
  }

  /**
   * Diagnose des Zellschnitts — die Zahlen, an denen E19 c gemessen wird.
   *
   * `aktiv` ist die entscheidende: Sie sagt, wie viele Zeichenaufrufe der
   * Schnitt tatsächlich stellt. `frei` sind abgeschaltete Master im Pool;
   * sie stehen weiter in scene.meshes und in der Werferliste (Shadows
   * lässt abgeschaltete Meshes ungeprüft drin), kosten dort aber nur
   * einen Listenplatz — deshalb ist `werferAnzahl()` allein nach diesem
   * Umbau kein brauchbares Mass mehr.
   */
  zellStats(): {
    prefabs: number;
    zellen: number;
    master: number;
    aktiv: number;
    frei: number;
    /**
     * Das Sprite-Fernfeld — die zweite Haelfte derselben Rechnung.
     *
     * `aktiv` allein sagt seit dem Impostor-Umbau nicht mehr, wie teuer
     * die Vegetation ist: Was hier an Zell-Mastern fehlt, steht drueben
     * als `sprites.zellen` (Zeichenaufrufe) und `sprites.instanzen`.
     * Beide Zahlen gehoeren in dieselbe Momentaufnahme, sonst laesst sich
     * hinterher nicht sagen, welcher der beiden Hebel gezogen hat.
     * `zeilen`/`budget` zeigen, wie voll der Atlas ist; `abgelehnt` zaehlt
     * die Archetypen, die auf die echte Darstellung zurueckgefallen sind.
     */
    sprites: {
      zeilen: number;
      budget: number;
      atlasPx: number;
      abgelehnt: number;
      zellen: number;
      instanzen: number;
    } | null;
    /** Uebergabegrenze, gegen die zuletzt zugeteilt wurde (m). */
    spriteGrenze: number;
  } {
    let zellenGesamt = 0;
    let master = 0;
    let aktiv = 0;
    for (const zellen of this.zellMaster.values()) {
      zellenGesamt += zellen.size;
      for (const bloecke of zellen.values()) {
        for (const reihe of bloecke) {
          for (const mesh of reihe) {
            master++;
            if (mesh.isEnabled()) aktiv++;
          }
        }
      }
    }
    let frei = 0;
    for (const pool of this.zellPool.values()) frei += pool.length;
    return {
      prefabs: this.zellMaster.size,
      zellen: zellenGesamt,
      master,
      aktiv,
      frei,
      sprites: this.impostoren?.stats() ?? null,
      spriteGrenze: this.impostorGrenze,
    };
  }

  /**
   * Nur die Collider-Auswahl neu ausrechnen, ohne den teuren
   * Thin-Instance-Renderpuffer (Matrixmultiplikation je Submesh × Instanz
   * plus GPU-Upload) anzufassen — für colliderDirty-Buckets, deren
   * Renderdaten sich gar nicht geändert haben. s. setPlayerPosition().
   */
  private rebuildBucketCollidersOnly(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.masterKey);
    if (!masters) return;
    this.rebuildBucketColliders(bucket, this.buildZdoMats(bucket));
  }

  /**
   * Dynamische Entities pro Frame Richtung Server-Ziel gleiten
   * (exponentielle Annäherung, Halbwertszeit ~60 ms — glättet den
   * 50-ms-Sync-Takt, ohne spürbar nachzuhängen). Im Game-Loop aufrufen.
   */
  /** Diagnose: Prefab-Namen der aktiven dynamischen Entities. */
  dynamicList(): string[] {
    return [...this.dynamics.values()].map((d) => d.root.name || '?');
  }

  /**
   * Diagnose: Pose des ersten Dynamics, dessen Name den Teilstring trägt.
   *
   * `yaw` und `anim` sind für das Kampfsystem dazugekommen: Ob ein NPC
   * den Spieler ansieht und ob er zuschlägt, sind genau die beiden Werte,
   * die der Server über ZDO-Rotation und ANIM_MEMBER steuert — und ohne
   * sie lässt sich von aussen nicht nachprüfen, ob das ankommt. Ein
   * Bildschirmfoto beantwortet das nicht: Bei Nacht und aus zwanzig
   * Metern sieht ein drohend dastehender Riese aus wie ein wartender.
   */
  dynamicPose(
    name: string
  ): { pos: Vector3Like; rotX: number; yaw: number; anim: string | null; tempo: number } | null {
    for (const d of this.dynamics.values()) {
      if (!(d.root.name || '').includes(name)) continue;
      const p = d.root.position;
      const e = d.root.rotationQuaternion?.toEulerAngles();
      return {
        pos: { x: p.x, y: p.y, z: p.z },
        rotX: e?.x ?? 0,
        yaw: e?.y ?? 0,
        anim: d.anim ?? null,
        tempo: d.gang?.tempo ?? -1,
      };
    }
    return null;
  }

  updateDynamics(dt: number): void {
    const f = 1 - Math.exp(-dt / 0.09);
    for (const dyn of this.dynamics.values()) {
      const z = dyn.ziel;
      if (!z) continue;
      const g = dyn.gang;
      if (!g) {
        Vector3.LerpToRef(dyn.root.position, z.pos, f, dyn.root.position);
        if (dyn.root.rotationQuaternion) {
          Quaternion.SlerpToRef(dyn.root.rotationQuaternion, z.rot, f, dyn.root.rotationQuaternion);
        }
        continue;
      }
      // ── Prozeduraler Gang ─────────────────────────────────────────
      // Die BASIS gleitet zum Server-Ziel; das Tempo kommt aus ihrer
      // eigenen Bewegung, nicht aus den 50-ms-Sprüngen des Ziels.
      const vorherX = g.basisPos.x;
      const vorherZ = g.basisPos.z;
      Vector3.LerpToRef(g.basisPos, z.pos, f, g.basisPos);
      Quaternion.SlerpToRef(g.basisRot, z.rot, f, g.basisRot);
      const schritt = Math.hypot(g.basisPos.x - vorherX, g.basisPos.z - vorherZ);
      const tempoRoh = dt > 0 ? schritt / dt : 0;
      g.tempo += (tempoRoh - g.tempo) * Math.min(1, dt * 6);

      const bewegt = g.tempo > 0.3;
      // Schrittfrequenz wächst mit dem Tempo (Trab → Galopp); im Stand
      // bleibt ein langsames Atmen übrig.
      g.phase += dt * (bewegt ? 1.6 + g.tempo * 0.5 : 0.4) * Math.PI * 2;
      // |sin|: zwei Bodenkontakte pro Periode — das typische Auf-und-Ab
      // eines Vierbeiners statt eines schwebenden Sinus.
      const hub = bewegt
        ? Math.abs(Math.sin(g.phase)) * Math.min(0.05 + g.tempo * 0.02, 0.16)
        : 0;
      const nick = bewegt ? Math.sin(g.phase) * 0.06 : Math.sin(g.phase) * 0.012;
      dyn.root.position.set(g.basisPos.x, g.basisPos.y + hub, g.basisPos.z);
      if (dyn.root.rotationQuaternion) {
        Quaternion.FromEulerAnglesToRef(nick, 0, 0, GANG_NICK_TMP);
        g.basisRot.multiplyToRef(GANG_NICK_TMP, dyn.root.rotationQuaternion);
      }
    }
  }

  // ── Dynamic (instantiated hierarchies) ───────────────────────────

  private async applyDynamic(
    u: ZDOEntityUpdate,
    prefabName: string,
    model: string | null,
    animation?: string,
    belebt = false
  ): Promise<void> {
    // Bewegungszustand des Servers ('idle'/'walk') hat Vorrang vor der
    // festen Prefab-Animation: Routen-NPCs wechseln damit zur Laufzeit,
    // alle anderen Prefabs schicken kein `anim` und bleiben wie gehabt.
    const wunschAnim = u.anim ?? animation;
    let dyn = this.dynamics.get(u.key);
    if (!dyn) {
      let root: TransformNode | null = null;
      if (model) {
        root = await this.assets.instantiate(model, wunschAnim);
      }
      if (!root) {
        root = makePlaceholder(this.scene, prefabName);
      }
      if (this.dynamics.has(u.key)) {
        // lost the race — another update instantiated first
        this.assets.entsorgeAnimationen(root);
        // Ohne Material/Texturen — die teilt sich diese Instanz mit allen
        // anderen desselben Prefabs (s. removeZDO).
        root.dispose(false, false);
        return;
      }
      // GLB-Wurzeln heissen alle "__root__" — für Diagnose (dynamicList,
      // dynamicPose) den Prefab-Namen drauflegen.
      root.name = prefabName;
      dyn = { root, anim: wunschAnim };
      if (belebt) {
        dyn.gang = {
          basisPos: new Vector3(u.position.x, u.position.y, u.position.z),
          basisRot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
          // Phasen leicht streuen, damit eine Herde nicht im Gleichschritt wippt.
          phase: (getStableHash(u.key) & 0xff) * 0.1,
          tempo: 0,
        };
      }
      this.dynamics.set(u.key, dyn);
      this.dynamicCount++;
    } else if (wunschAnim && wunschAnim !== dyn.anim) {
      dyn.anim = wunschAnim;
      this.assets.wechsleAnimation(dyn.root, wunschAnim);
    }
    // Trefferpunkte → Prozent. Hier und nicht im Namensschild, weil an
    // dieser Stelle Wert und Prefabname ohnehin beide vorliegen.
    if (u.health !== undefined) dyn.leben = lebenAnteil(prefabName, u.health);
    // Interpolation statt hartem Setzen: ZDO-Updates kommen im Sync-Takt
    // (50 ms + Netz-Jitter) — direktes Setzen ließe Kreaturen und fremde
    // Spieler ruckeln. Ziel merken, updateDynamics() gleitet pro Frame hin.
    const ziel = {
      pos: new Vector3(u.position.x, u.position.y, u.position.z),
      rot: new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    };
    if (!dyn.ziel || Vector3.DistanceSquared(dyn.root.position, ziel.pos) > 30 * 30) {
      // Erstes Update oder Teleport (Dungeon, Admin): hart setzen statt
      // quer durch die Welt zu gleiten — auch die Gang-Basis.
      dyn.root.position.copyFrom(ziel.pos);
      dyn.root.rotationQuaternion = ziel.rot.clone();
      if (dyn.gang) {
        dyn.gang.basisPos.copyFrom(ziel.pos);
        dyn.gang.basisRot.copyFrom(ziel.rot);
        dyn.gang.tempo = 0;
      }
    }
    dyn.ziel = ziel;
    // Grundskalierung des Prefabs MIT der ZDO-Skalierung verrechnen.
    //
    // Statische Prefabs bekommen ihre localScale über composeZdoWorld; im
    // dynamischen Pfad stand hier nur die ZDO-Skalierung. Prefabs, deren
    // Modell nicht in Metern vorliegt, standen dadurch in Rohgröße da — die
    // Völva mit localScale 1.75 war einen Meter groß, weil ihr GLB (wie alles
    // aus dem Generator) auf Kantenlänge 1 normiert ist.
    //
    // Für alle bisherigen dynamischen Prefabs ist localScale 1, an ihnen
    // ändert sich damit nichts.
    const basis = findPrefabByHash(u.prefabHash)?.localScale ?? { x: 1, y: 1, z: 1 };
    const s = u.scale;
    const f =
      typeof s === 'number' ? { x: s, y: s, z: s } : s ? { x: s.x, y: s.y, z: s.z } : { x: 1, y: 1, z: 1 };
    dyn.root.scaling = new Vector3(basis.x * f.x, basis.y * f.y, basis.z * f.z);
  }

  // ── Location terrain leveling (F4) ───────────────────────────────

  private applyLocationLeveling(featureHash: number, position: { x: number; y: number; z: number }): void {
    const feature = getFeatureByHash(featureHash);
    if (!feature) return;
    const leveling = getTerrainLeveling(feature);
    if (!leveling) return;
    const affected = this.world.heightmaps.addTerrainModifier({
      x: position.x,
      z: position.z,
      targetHeight: f32(position.y + leveling.levelOffset),
      levelRadius: leveling.levelRadius,
      smoothRadius: leveling.smoothRadius,
      smoothPower: leveling.smoothPower,
      square: leveling.square,
    });
    this.terrain.rebuildZones(affected);
  }
}

/**
 * Weltmatrix einer Instanz.
 *
 * Die Skalierung stammt aus dem ZDO — ABER nur, wenn das Prefab eine
 * abweichende mitschickt (SYNC_INITIAL_SCALE). Fehlt sie, gilt die
 * localScale des Prefabs, nicht 1: Rock_3 und Rock_4 stehen im pkg mit
 * localScale 2 und wurden dadurch in halber Größe gerendert — ein
 * Felsbrocken, der nur 34 cm aus dem Boden ragte und im Gras unsichtbar
 * blieb.
 */
function composeZdoWorld(u: ZDOEntityUpdate, prefabScale?: Vector3Like): Matrix {
  const s = u.scale;
  const scaling =
    typeof s === 'number'
      ? new Vector3(s, s, s)
      : s
        ? new Vector3(s.x, s.y, s.z)
        : prefabScale
          ? new Vector3(prefabScale.x, prefabScale.y, prefabScale.z)
          : Vector3.One();
  return Matrix.Compose(
    scaling,
    new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    new Vector3(u.position.x, u.position.y, u.position.z)
  );
}

/** Small named box for dynamic entities without a model in the export. */
/**
 * Platzhalter-Materialien je Szene und Prefabname.
 *
 * Sie hängen nur an der FARBE, die aus dem Namen gerechnet wird — zwei
 * Platzhalter desselben Prefabs brauchen also kein zweites Material.
 * Wichtiger noch: Instanzen werden ohne ihr Material entsorgt (s.
 * removeZDO), ein frisch erzeugtes Material je Platzhalter bliebe sonst
 * bei jedem Entfernen liegen. Geteilt und gecacht kann das nicht
 * passieren.
 */
const platzhalterMaterialien = new WeakMap<Scene, Map<string, StandardMaterial>>();

function makePlaceholder(scene: Scene, name: string): TransformNode {
  const root = new TransformNode(`ph_${name}`, scene);
  const box = MeshBuilder.CreateBox(`ph_${name}_box`, { size: 0.7 }, scene);
  let cache = platzhalterMaterialien.get(scene);
  if (!cache) {
    cache = new Map();
    platzhalterMaterialien.set(scene, cache);
  }
  let mat = cache.get(name);
  if (!mat) {
    mat = new StandardMaterial(`ph_${name}_mat`, scene);
    const hue = (Array.from(name).reduce((a, c) => a + c.charCodeAt(0) * 31, 7) % 360) / 360;
    mat.diffuseColor = Color3.FromHSV(hue * 360, 0.45, 0.75);
    mat.specularColor = new Color3(0, 0, 0);
    cache.set(name, mat);
  }
  box.material = mat;
  box.position.y = 0.5;
  box.parent = root;
  return root;
}
