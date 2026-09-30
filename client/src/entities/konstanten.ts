/**
 * Constants and two pure helpers of the entity layer: collision window, rebuild
 * budgets, the cell sizes of the index and of the render cut, the cell key and
 * the radius filter of the vegetation. Nothing here touches a scene.
 * SHOW_COLLIDERS reads the page address once, when the module is loaded.
 * Moved verbatim out of EntityManager.ts.
 */

import { PrefabFlag } from '@wov/shared';

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
 * Kantenlänge einer Zone des Originals (64 m) — bewusst feiner,
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
 * Zone des Originals (64): gross genug, dass ein
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
 * Übernommen vom Vorbild: Dessen Instanz-Renderer bündelt höchstens
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
// Revision nach dem Vergleichsprojekt) — ferne Zellen werden nicht kleiner
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

export {
  DYNAMIC_FLAGS,
  f32,
  COLLIDER_RANGE,
  REBUILD_BUDGET_MS,
  SCHWUNG_RESERVE_M,
  COLLIDER_REBUILD_STEP,
  VEGETATIONS_NEUPACK_M,
  SHOW_COLLIDERS,
  INDEX_ZELLE_M,
  zellenSchluessel,
  RENDER_ZELLE_M,
  ZELL_MAX_INSTANZEN,
  ZELL_SCHNITT_AB,
  SPRITE_NEUPACK_M,
  ZELL_POOL_DECKEL,
};
