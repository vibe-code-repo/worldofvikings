/**
 * EntityManager (Phase 2) — maps ZDO updates to the scene.
 *
 * Static ZDOs (trees, rocks, building pieces, …) become THIN INSTANCES in
 * per-prefab buckets (the only sane way to render Valheim's vegetation
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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import {
  PrefabFlag,
  findPrefabByHash,
  isRenderable,
  getFeatureByHash,
  getRoomByHash,
  getStableHash,
  getTerrainLeveling,
  FOLIAGE_HASHES,
  lebenAnteil,
} from '@wov/shared';
import type { NpcEinordnung } from '@wov/shared';
import { buildMeshCollider, deriveCollider, StaticColliderSet } from '../engine/Physics';

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
/**
 * Prefabs, die statt eines Hüllquaders ihre exakte Oberfläche als
 * Kollision bekommen — Findlinge, Erzbrocken, Abbaufelsen.
 *
 * Erfasst die 15 gespawnten Felsklassen: Rock_3/4, Rock_4_plains,
 * rock1..4_* (mountain/heath/coast/forest/copper), rock_mistlands1,
 * MineRock_Tin, MineRock_Obsidian, silvervein.
 */
const FELS_KOLLISION = /^(rock|minerock|silvervein|copperore|tinore|obsidian|stone)/i;
/**
 * Obergrenze für die exakte Fels-Kollision. Die Felsen des Exports liegen
 * bei 196 bis rund 800 Dreiecken; 4000 lässt Luft nach oben, ohne dass
 * ein unerwartet feines Modell die Physik sprengt. Darüber bleibt es beim
 * Hüllquader.
 */
const FELS_MAX_DREIECKE = 4000;

/**
 * Bauwerke, durch die man hindurchgehen können muss.
 *
 * Für sie gilt dasselbe wie für Dungeon-Räume: Ein Hüllquader wäre fatal,
 * weil er den Durchgang massiv macht — beim Steinkreis stünde man vor einer
 * unsichtbaren Wand statt zwischen den Steinen. Deshalb ist die exakte
 * Kollision hier NICHT ans Dreiecksbudget gebunden (der Steinkreis hat
 * 11.362), und wenn sie nicht zustande kommt, bleibt das Prefab lieber ganz
 * ohne Kollision als mit einer Box.
 *
 * Bezahlbar ist das aus demselben Grund wie bei den Felsen: Die Shape wird
 * über alle Instanzen geteilt (StaticColliderSet), pro Instanz entstehen nur
 * Transform und Body.
 */
// Steinkreis wieder mit drin (16.08.2026): Ohne den Eintrag bekaeme er
// die uebliche Box statt exakter Mesh-Kollision, und man stuende vor dem
// Durchgang statt hindurchzugehen — genau der Fall, den der Kommentar
// weiter oben als Begruendung fuer BEGEHBAR anfuehrt.
const BEGEHBAR = /^(Grabhuegel|Steinkreis)/i;


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
 * Welche Prefab-KLASSEN den Spieler blockieren.
 *
 * Das ist die eigentliche Regel des Originals: Unity entscheidet über
 * Layer, und Character.cs nimmt genau die soliden davon —
 *   s_groundRayMask = LayerMask.GetMask("Default", "static_solid",
 *       "Default_small", "piece", "terrain", "blocker", "vehicle")
 * (Character.cs:518). Die Layer-Zuordnung je Prefab liegt nicht im Export
 * (die Prefab-Roots fehlen, nur Sub-Meshes wurden extrahiert), also bilden
 * die Flags dieselbe Einteilung ab.
 *
 * Vorher hing die Auswahl an der GEOMETRIE ("alles über 0,5 m"). Genau
 * daher kamen die riesigen Kollisionsboxen um Äste und Deko: Ein liegender
 * Ast ist gross, aber in Valheim läuft man hindurch, weil er auf keinem
 * soliden Layer liegt.
 */
const COLLIDING_FLAGS =
  PrefabFlag.TREE_BASE |      // grosse, fällbare Bäume
  // Kleine Bäume, Stümpfe, Felsen und Klippen tragen in den Originaldaten
  // NICHT TREE_BASE, sondern DESTRUCTIBLE — TREE_BASE ist den fällbaren
  // Bäumen mit Umfall-Animation vorbehalten. Ohne dieses Flag lief man
  // durch Beech_small1/2, FirTree_small und stubbe hindurch.
  PrefabFlag.DESTRUCTIBLE |
  PrefabFlag.TREE_LOG |       // gefällte Stämme
  PrefabFlag.MINE_ROCK_5 |    // abbaubare Felsen
  PrefabFlag.PIECE |          // Bauteile
  PrefabFlag.WEAR_N_TEAR |    // Gebautes mit Abnutzung
  PrefabFlag.DOOR |
  PrefabFlag.BED |
  PrefabFlag.CHAIR |
  PrefabFlag.CONTAINER |
  PrefabFlag.CRAFTING_STATION |
  PrefabFlag.COOKING_STATION |
  PrefabFlag.SMELTER |
  PrefabFlag.FIREPLACE |
  PrefabFlag.ITEM_STAND |
  PrefabFlag.ARMOR_STAND;

/**
 * Klassen, die NIE blockieren, auch wenn sie zufällig eines der obigen
 * Flags mitführen: Aufsammelbares ist im Original ein Trigger, Pflanzen
 * und Item-Drops laufen einem durch.
 */
const NEVER_COLLIDING_FLAGS =
  PrefabFlag.PICKABLE | PrefabFlag.PICKABLE_ITEM | PrefabFlag.ITEM_DROP | PrefabFlag.PLANT;

/**
 * Weiche Vegetation, durch die man läuft, obwohl sie DESTRUCTIBLE ist.
 *
 * Büsche, Sträucher und herumliegende Äste sind zerstörbar, aber kein
 * Hindernis — in Valheim entscheidet darüber der Layer, den unser Export
 * nicht enthält (die Prefab-Roots fehlen). Der Name ist hier der
 * verlässlichste verfügbare Ersatz; er trifft AshlandsBranch1-3, Bush01,
 * RaspberryBush, shrub_2 und Verwandte, während Beech_small, FirTree_small,
 * stubbe und alle Felsen solide bleiben.
 */
const SOFT_VEGETATION = /bush|shrub|branch|berry|seed|shoot|sapling|vines|flower|grass/i;

/** ?showcolliders=1 — zeichnet die Kollisionsformen als Drahtgitter. */
const SHOW_COLLIDERS =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('showcolliders');

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
 * Übernommen vom Vorbild: Valheims InstanceRenderer bündelt höchstens
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

interface StaticBucket {
  prefabName: string;
  /** Same value as the map key — the collider derivation needs the def. */
  prefabHash: number;
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
  private readonly buckets = new Map<number, StaticBucket>();
  private readonly bucketOf = new Map<string, number>();
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
  /** Prefab hashes whose render prep is already in flight. */
  private readonly pending = new Set<number>();
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
      void this.applyDynamic(u, def.name, def.model, def.animation, belebt);
    } else {
      this.applyStatic(u, def.name, def.model);
    }
  }

  removeZDO(key: string): void {
    this.npcs.delete(key);
    // Vor dem Bucket-Abbau: Der Index steht unabhängig davon, ob der Bucket
    // die Instanz noch kennt — ein Eintrag, der ihn überlebt, wäre ein
    // Geisterobjekt unter dem Fadenkreuz.
    this.indexEntfernen(key);
    const bucketHash = this.bucketOf.get(key);
    if (bucketHash !== undefined) {
      const bucket = this.buckets.get(bucketHash);
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
    // COLLIDING_FLAGS. Ohne diese Ausnahme landeten sie unten in
    // `colliderless`, noch bevor die BEGEHBAR-Zweige weiter unten je
    // erreicht wurden — gemessen am laufenden Client hatte deshalb auch
    // der Steinkreis gar keine Kollision, man lief mitten hindurch.
    const begehbarePruefungUmgehen = BEGEHBAR.test(bucket.prefabName);
    // Nur solide Klassen bekommen überhaupt einen Körper — s. COLLIDING_FLAGS.
    if (!dungeonRoom && !begehbarePruefungUmgehen) {
      const def = findPrefabByHash(bucket.prefabHash);
      const flags = def?.flags ?? 0n;
      const solide =
        (flags & COLLIDING_FLAGS) !== 0n &&
        (flags & NEVER_COLLIDING_FLAGS) === 0n &&
        !SOFT_VEGETATION.test(bucket.prefabName);
      if (!solide) {
        this.colliderless.add(bucket.prefabName);
        return;
      }
    }
    const masters = this.masterMeshes.get(bucket.prefabName);
    if (!masters || masters.length === 0) return;

    let entry = this.colliders.get(bucket.prefabName);
    if (!entry) {
      const def = findPrefabByHash(bucket.prefabHash);
      // Trees get a trunk capsule, everything else its bounding box — see
      // deriveCollider() for why a box is wrong around a crown.
      // Dungeon-Räume bekommen die EXAKTE Mesh-Geometrie: eine Box würde
      // das begehbare Innere massiv machen (buildMeshCollider).
      const treeLike = def ? (def.flags & PrefabFlag.TREE_BASE) !== 0n : false;
      // FELSEN bekommen ebenfalls die exakte Oberfläche.
      //
      // Ein Findling ist unregelmässig und liegt schräg im Hang; sein
      // Hüllquader steht als unsichtbare Wand weit davor, und man rennt
      // dagegen, bevor man den Stein überhaupt berührt. Gemeldet als:
      // "Rock_4 hat eine sehr grosse Box, man läuft erstmal gegen eine
      // unsichtbare Wand — es sollte wie Terrain behandelt werden, nur
      // die reine Oberfläche."
      //
      // Bezahlbar ist das, weil die SHAPE zwischen allen Instanzen
      // geteilt wird (siehe StaticColliderSet): Rock_4 hat 196 Dreiecke,
      // rock4_copper 272 — einmal trianguliert, dann tragen alle 84
      // Instanzen dieselbe Form. Nur Transform und Body existieren pro
      // Instanz, und das ist bei der Box nicht anders.
      //
      // Die Obergrenze schützt vor Ausreissern: Was auch immer künftig
      // unter den Namensfilter fällt, darf die Physik nicht sprengen —
      // dann bleibt es bei der Box.
      const felsig = FELS_KOLLISION.test(bucket.prefabName);
      const dreiecke = felsig
        ? masters.reduce((s, m) => s + (m.getTotalIndices() / 3 || 0), 0)
        : 0;
      const begehbar = BEGEHBAR.test(bucket.prefabName);
      const exakt = dungeonRoom || begehbar || (felsig && dreiecke <= FELS_MAX_DREIECKE);
      const locals = this.masterLocals.get(bucket.prefabName) ?? [];
      // `buildMeshCollider` gibt null zurück, wenn keine Geometrie
      // zusammenkommt. Für Felsen ist die Hüllform dann immer noch besser
      // als GAR KEINE Kollision — bei Dungeon-Räumen dagegen wäre eine Box
      // fatal (sie machte das begehbare Innere massiv), dort bleibt es
      // beim bisherigen Verhalten.
      const spec =
        (exakt ? buildMeshCollider(bucket.prefabName, masters, locals, this.scene) : null) ??
        (dungeonRoom || begehbar ? null : deriveCollider(masters, locals, treeLike));
      if (!spec) {
        this.colliderless.add(bucket.prefabName);
        return;
      }
      const carrier = new Mesh(`col_${bucket.prefabName}`, this.scene);
      carrier.isVisible = false;
      carrier.isPickable = false;
      entry = { carrier, set: new StaticColliderSet(carrier, spec, this.scene), signature: '' };
      this.colliders.set(bucket.prefabName, entry);
      this.colliderSpecs.set(bucket.prefabName, spec);
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
    let bucket = this.buckets.get(u.prefabHash);
    if (!bucket) {
      bucket = {
        prefabName,
        prefabHash: u.prefabHash,
        indexOf: new Map(),
        matrices: [],
        dirty: false,
        colliderDirty: false,
        mastersReady: false,
      };
      this.buckets.set(u.prefabHash, bucket);
      this.prepareMasters(u.prefabHash, prefabName, model);
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
      this.bucketOf.set(u.key, u.prefabHash);
      world.toArray(bucket.matrices, bucket.matrices.length);
      this.staticCount++;
    }
    bucket.dirty = true;
  }

  private prepareMasters(prefabHash: number, prefabName: string, model: string | null): void {
    if (this.pending.has(prefabHash)) return;
    this.pending.add(prefabHash);
    if (!model) {
      // no GLB in the export — nothing to instance (sprites come in Phase 5)
      return;
    }
    void this.assets.getMasters(model).then((masters) => {
      const bucket = this.buckets.get(prefabHash);
      if (!bucket || masters.length === 0) return;
      // E23: FOLIAGE wird nur über Wasser gestreut. Die gemeinsame Hülle
      // seiner Thin Instances darf deshalb nicht entscheiden, ob der ganze
      // Bestand ein zweites Mal im Unterwasser-Pass gezeichnet wird.
      if (FOLIAGE_HASHES.has(prefabHash)) {
        for (const master of masters) markiereAlsGestreuteLandschaft(master.mesh);
      }
      this.masterMeshes.set(prefabName, masters.map((m) => m.mesh));
      this.masterLocals.set(prefabName, masters.map((m) => m.localMatrix));
      bucket.mastersReady = true;
      bucket.dirty = true; // rebuild with instances now
    });
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
  private rebuildBucketInstances(bucket: StaticBucket): void {
    const masters = this.masterMeshes.get(bucket.prefabName);
    const locals = this.masterLocals.get(bucket.prefabName);
    if (!masters || !locals) return;

    const zdoMats = this.buildZdoMats(bucket);
    if (this.zellSchnittTaugt(masters, zdoMats.length)) {
      this.baueZellMaster(bucket, masters, locals, zdoMats);
    } else {
      this.baueVollMaster(bucket, masters, locals, zdoMats);
    }

    this.rebuildBucketColliders(bucket, zdoMats);
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
    for (let m = 0; m < masters.length; m++) {
      const data = new Float32Array(count * 16);
      const local = locals[m]!;
      for (let i = 0; i < count; i++) {
        local.multiply(zdoMats[i]!).toArray(data, i * 16);
      }
      schreibeInstanzen(masters[m]!, count > 0 ? data : null);
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
    const masters = this.masterMeshes.get(bucket.prefabName);
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
