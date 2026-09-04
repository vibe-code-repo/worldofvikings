/**
 * E3 — Wächter über `roomDefForHall` in `shared/src/moduleRegistry.ts`.
 *
 * ── Was hier eigentlich geprüft wird ─────────────────────────────────
 * E1 hat die GEOMETRIE eines Saals geschlossen (Quader, Pfeiler, Masse),
 * E2 schreibt sie als GLB. Beides ist für den Generator unsichtbar: Er
 * sieht von einem Modul nur die `RoomDef` — Hülle, Connectors, Kanten.
 * Wer einen Saal zur Laufzeit anlegt und dabei die RoomDef nur „ungefähr“
 * trifft, bekommt keinen Fehler, sondern einen Grundriss, in dem der
 * Nachbar um einen Meter versetzt steht. `gridModuleFromRoomDef` ist die
 * einzige Stelle, die das MERKT — sie verlangt für jede waagerechte
 * Aussenkante eine Aussage (`shared/src/dungeonRasterModul.ts`) und wirft
 * bei jeder Lücke.
 *
 * ── Warum der Kern ein Vergleich mit dem KIT ist, keine Nachrechnung ─
 * Ein Test, der die Connectorstellen selbst noch einmal aus cx/cz
 * ausrechnete, schriebe die Behauptung des Moduls ein zweites Mal auf und
 * bewiese nichts. Die fünf ausgelieferten Säle sind dagegen von Hand
 * getippt, gegen Blender gemessen und im Spiel gelaufen: Sie sind die
 * unabhängige Wahrheit. `roomDefForHall(name, cx, cz, weight)` muss sie
 * FELD FÜR FELD reproduzieren — Hülle, Zahl und Reihenfolge der
 * Connectors, jede Lage, jede Drehung, jedes Flag. Weicht die Funktion
 * an einer Stelle ab, ist es genau die Stelle, an der ein generierter
 * Saal sich anders verhielte als ein gebauter.
 *
 * ── Warum die Rot-Zuerst-Probe 4×3 ist und nicht 4×4 ─────────────────
 * 4×3 ist RECHTECKIG und trifft damit beide Fälle, in denen sich ein
 * Vorzeichenfehler verstecken kann: gerade Zellzahl (Pivot zwischen den
 * Zellen) auf der einen Achse, ungerade (Pivot in einer Zellmitte) auf
 * der anderen. Ein quadratischer Saal wäre punktsymmetrisch — eine
 * vertauschte x/z-Achse fiele dort nicht auf.
 *
 * Läuft rein rechnerisch: kein `assets/`, kein Blender, keine GPU.
 */
import {
  DUNGEONS_BY_NAME,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  gridModuleFromRoomDef,
  isHorizontal,
  DIRECTIONS,
  type Direction,
  type RoomDef,
} from '../src/index.js';
import { GRID_M, HEIGHT_M } from '../src/hallenGeometrie.js';
import { roomDefForHall } from '../src/moduleRegistry.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('E3 — Saal-RoomDef aus dem Editor (shared/src/moduleRegistry.ts)\n');

// ---------------------------------------------------------------------------
// 1. Das Raster der Geometrie IST das Raster des Moduls
//
// `roomDefForHall` rechnet die Hülle aus dem Kachelmass des GLB-Bauteils
// (`GRID_M`, `HEIGHT_M`), der Generator misst sie am Modulraster
// (`MODULE_CELL_M`, `MODULE_LEVEL_M`). Solange beide Zahlen gleich sind,
// ist das eine Vereinfachung; gingen sie auseinander, wäre es eine still
// falsche Hülle. Deshalb steht die Gleichheit hier als eigener Zeuge.
// ---------------------------------------------------------------------------
{
  check(GRID_M === MODULE_CELL_M, `GRID_M ${GRID_M} ≠ MODULE_CELL_M ${MODULE_CELL_M}`);
  check(HEIGHT_M === MODULE_LEVEL_M, `HEIGHT_M ${HEIGHT_M} ≠ MODULE_LEVEL_M ${MODULE_LEVEL_M}`);
  console.log(`  Raster  Zelle ${GRID_M} m, Ebene ${HEIGHT_M} m — Geometrie und Modulformat gleich`);
}

// ---------------------------------------------------------------------------
// 2. Die Rot-Zuerst-Probe: 4×3 läuft durch `gridModuleFromRoomDef`
//
// Ohne `roomDefForHall` gibt es nichts, was hier hineingereicht werden
// könnte; mit einer unvollständigen RoomDef wirft die Funktion. Beides ist
// rot, und zwar mit verschiedenen Meldungen.
// ---------------------------------------------------------------------------
{
  const def = roomDefForHall('Gen_StoneVaultHall4x3', 4, 3, 0.5);
  check(def.size.x === 8, `4×3: size.x ${def.size.x} statt 8`);
  check(def.size.y === 3.5, `4×3: size.y ${def.size.y} statt 3.5`);
  check(def.size.z === 6, `4×3: size.z ${def.size.z} statt 6`);
  check(def.weight === 0.5, `4×3: weight ${def.weight} statt 0.5`);
  check(def.nurManuell === true, '4×3: nurManuell fehlt — der Saal wäre Generator-Material');
  check(def.gridEdges === undefined, '4×3: gridEdges gesetzt — ein Saal braucht keins');

  const m = gridModuleFromRoomDef(def);
  check(m.cellsX === 4, `4×3: cellsX ${m.cellsX} statt 4`);
  check(m.cellsZ === 3, `4×3: cellsZ ${m.cellsZ} statt 3`);
  check(m.levels === 1, `4×3: levels ${m.levels} statt 1`);
  check(m.cells.length === 12, `4×3: ${m.cells.length} Zellen statt 12`);
  check(!m.endCap, '4×3: als Verschluss gelesen');
  check(m.anchor === null, '4×3: trägt einen Ankerport — ein Saal ist kein Eingangsraum');

  // Alle 14 Randkanten offen — 2·(4+3). Gezählt statt behauptet: Die Zahl
  // ist die Abnahme des Meilensteins.
  let rand = 0;
  let offen = 0;
  for (const cell of m.cells) {
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d) || cell.interior[d]) continue;
      rand++;
      if (cell.edges[d] === 'open') offen++;
      else check(false, `4×3: Randkante ${d} an (${cell.ix},${cell.iz}) ist '${cell.edges[d]}'`);
    }
  }
  check(rand === 14, `4×3: ${rand} Randkanten statt 14`);
  check(offen === 14, `4×3: ${offen} offene Randkanten statt 14`);
  check(m.ports.length === 14, `4×3: ${m.ports.length} Ports statt 14`);

  // Innenkanten: waagerecht Durchgang (EIN Raum), senkrecht Wand (eine Ebene).
  let innen = 0;
  for (const cell of m.cells) {
    for (const d of DIRECTIONS) {
      if (!cell.interior[d]) continue;
      innen++;
      check(
        cell.edges[d] === 'open',
        `4×3: Innenkante ${d} an (${cell.ix},${cell.iz}) ist '${cell.edges[d]}'`
      );
    }
    check(cell.edges.up === 'wall', `4×3: Deckenkante an (${cell.ix},${cell.iz}) offen`);
    check(cell.edges.down === 'wall', `4×3: Bodenkante an (${cell.ix},${cell.iz}) offen`);
  }
  // 2·(waagerechte Nachbarpaare) = 2·(3·3 + 4·2) = 34.
  check(innen === 34, `4×3: ${innen} waagerechte Innenkantenseiten statt 34`);

  // Jeder Port sitzt auf der Kantenmitte, die sein Connector nennt — der
  // Zeuge gegen eine um eine halbe Zelle versetzte Connectorreihe.
  for (const p of m.ports) {
    const c = def.connections[p.connector]!;
    const gleich =
      Math.abs(p.localEdgeCenter.x - c.localPos.x) < 1e-9 &&
      Math.abs(p.localEdgeCenter.y - c.localPos.y) < 1e-9 &&
      Math.abs(p.localEdgeCenter.z - c.localPos.z) < 1e-9;
    check(
      gleich,
      `4×3: Port ${p.connector} liegt auf (${p.localEdgeCenter.x},${p.localEdgeCenter.z}), ` +
        `sein Connector auf (${c.localPos.x},${c.localPos.z})`
    );
  }

  console.log(
    `  4×3     ${def.size.x}×${def.size.z} m, ${def.connections.length} Connectors, ` +
      `${m.cells.length} Zellen, ${offen}/${rand} Randkanten offen, levels ${m.levels}`
  );
}

// ---------------------------------------------------------------------------
// 3. Der Muster-Zeuge: die fünf ausgelieferten Säle Feld für Feld
//
// Verglichen wird gegen die RoomDefs, die im Kit stehen — inklusive
// `hash`, denn der Hash ist die Netz- und Persistenz-Kennung: Ein Saal,
// dessen Hash anders gerechnet würde, verlöre beim Laden seinen Raum.
// `nurManuell` ist der EINE erlaubte Unterschied (Bestandsräume tragen es
// nicht, Registry-Module tragen es immer) und wird deshalb ausgeklammert
// und getrennt geprüft.
// ---------------------------------------------------------------------------
const kit = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!kit) {
  console.error('FEHLER: Kit DG_StoneVault nicht gefunden.');
  process.exit(1);
}
const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));

/** Die fünf gebauten Säle mit ihren gemessenen Zellzahlen und Gewichten. */
const HALLEN: readonly (readonly [string, number, number, number])[] = [
  ['StoneVaultHall', 2, 2, 1],
  ['StoneVaultHallLarge', 3, 3, 1],
  ['StoneVaultHallLong', 2, 4, 1],
  ['StoneVaultHallGrand', 4, 4, 0.5],
  ['StoneVaultHallVast', 6, 6, 0.25],
];

/** Ohne `nurManuell` — der einzige Unterschied, der erlaubt ist. */
function ohneFlag(def: RoomDef): Record<string, unknown> {
  const { nurManuell: _weg, ...rest } = def as RoomDef & { nurManuell?: boolean };
  return rest as unknown as Record<string, unknown>;
}

/**
 * Erste Abweichung als PFAD, oder null.
 *
 * Bewusst nicht `JSON.stringify(a) === JSON.stringify(b)`: Die RoomDefs des
 * Kits entstehen aus `{ ...r, hash }` und tragen `hash` deshalb als LETZTES
 * Feld, eine getippte Definition hätte es vorn. Ein Zeichenkettenvergleich
 * meldete das als Unterschied — und das wäre ein Fehlalarm über die
 * Reihenfolge der Schlüssel, an der nichts hängt. Was WIRKLICH hängt, ist
 * die Reihenfolge der `connections` (der Index IST die Kennung eines
 * Connectors); Arrays werden deshalb der Reihe nach verglichen.
 */
function ersteAbweichung(a: unknown, b: unknown, pfad = ''): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${pfad}: Array gegen Nicht-Array`;
    if (a.length !== b.length) return `${pfad}: ${a.length} Einträge gegen ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = ersteAbweichung(a[i], b[i], `${pfad}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join(',') !== kb.join(','))
      return `${pfad}: Felder {${ka.join(',')}} gegen {${kb.join(',')}}`;
    for (const k of ka) {
      const d = ersteAbweichung(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${pfad}.${k}`
      );
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${pfad}: ${String(a)} gegen ${String(b)}`;
}

console.log('\n  Muster-Vergleich gegen die ausgelieferten Säle');
for (const [name, cx, cz, weight] of HALLEN) {
  const soll = roomByName.get(name);
  if (!soll) {
    check(false, `${name} fehlt im Kit`);
    continue;
  }
  const ist = roomDefForHall(name, cx, cz, weight);
  const abweichung = ersteAbweichung(ohneFlag(ist), soll as unknown);
  check(abweichung === null, `${name}: erzeugte RoomDef weicht ab — ${abweichung}`);
  check(ist.nurManuell === true, `${name}: erzeugte RoomDef ohne nurManuell`);
  check(
    (soll as RoomDef & { nurManuell?: boolean }).nurManuell === undefined,
    `${name}: BESTANDSraum trägt nurManuell — Golden und M3 wären ab hier verschoben`
  );
  const m = gridModuleFromRoomDef(ist);
  console.log(
    `    ${name.padEnd(22)} ${cx}×${cz}  ${ist.connections.length} Connectors, ` +
      `Hülle ${ist.size.x}×${ist.size.z} m, ${m.cells.length} Zellen`
  );
}

// ---------------------------------------------------------------------------
// 4. Ein Fussabdruck, den es nicht gibt, ist ein Fehler und keine Zahl
//
// Die Klemmen des Formulars (2…8 Zellen, Raster, Dreiecksdeckel) sitzen
// im Server (E5). Was hier gehalten wird, ist enger und älter: Ein
// halbzelliger oder leerer Saal hat keine Geometrie, und `size` wäre
// eine Hülle, die auf keinem Raster liegt — `gridModuleFromRoomDef` würfe
// dann erst zwei Schritte später, mit einer Meldung über die Hülle statt
// über das Argument.
// ---------------------------------------------------------------------------
{
  const schlecht: readonly (readonly [string, number, number])[] = [
    ['null Zellen in x', 0, 3],
    ['null Zellen in z', 3, 0],
    ['negative Zellzahl', -2, 3],
    ['halbe Zelle', 2.5, 3],
  ];
  for (const [was, cx, cz] of schlecht) {
    let geworfen = false;
    try {
      roomDefForHall('Gen_StoneVaultHallX', cx, cz, 1);
    } catch {
      geworfen = true;
    }
    check(geworfen, `${was} (${cx}×${cz}) läuft durch statt zu werfen`);
  }
  console.log(`\n  ${schlecht.length} ungültige Fussabdrücke werfen`);
}

// ---------------------------------------------------------------------------
// 5. Ein einzelliger Saal ist gültig — und seine vier Kanten sind offen
//
// Nicht Zierde: Der 1×1-Fall ist der einzige ohne Innenkante, und er
// belegt, dass die Randkanten nicht aus „was keine Innenkante ist“
// abgeleitet werden, sondern aus wirklich gesetzten Connectors.
// ---------------------------------------------------------------------------
{
  const def = roomDefForHall('Gen_StoneVaultHall1x1', 1, 1, 1);
  const m = gridModuleFromRoomDef(def);
  check(def.connections.length === 4, `1×1: ${def.connections.length} Connectors statt 4`);
  check(m.cells.length === 1, `1×1: ${m.cells.length} Zellen statt 1`);
  const c0 = m.cells[0]!;
  for (const d of ['n', 'e', 's', 'w'] as readonly Direction[]) {
    check(c0.edges[d] === 'open', `1×1: Kante ${d} ist '${c0.edges[d]}'`);
    check(!c0.interior[d], `1×1: Kante ${d} gilt als Innenkante`);
  }
  console.log('  1×1     vier offene Randkanten, keine Innenkante');
}

console.log(
  failures === 0
    ? '\nOK — die erzeugte Saal-RoomDef ist von einer gebauten nicht zu unterscheiden'
    : `\n${failures} FEHLER`
);
process.exit(failures > 0 ? 1 : 0);
