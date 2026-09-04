/**
 * G5 (Modul-Generierung 2.0) — Wächter über Schleifen und Torbögen.
 *
 * ── Warum diese beiden Dinge einen eigenen Test bekommen ─────────────
 * G4 baut einen BAUM: genau eine Verbindung zwischen je zwei Zellen, und
 * jede Rasternachbarschaft, die keine Kante ist, wird zur Wand. Das ist
 * korrekt und trotzdem genau Mikes Befund vom 04.09.2026 — „viele
 * Zwischenwände und Bögen, das macht die Räume sehr verwinkelt“. G5
 * dreht daran zwei Regler:
 *
 *  • **Schleifen** (`loopFraction`, Konzept: `schleifenAnteil`, Vorgabe
 *    0,35). Jede Nachbarschaft, die zur Kante wird, ist ein Durchgang
 *    STATT einer Doppelwand. Der Regler ist damit unmittelbar die Antwort
 *    auf „zu verwinkelt“ — und seine Wirkung ist zählbar, nicht gefühlt.
 *  • **Torbögen** (`archwayFraction`, Konzept: `torbogenAnteil`, Vorgabe
 *    0,25). Sie hängen nicht mehr an jeder Verbindung, sondern bevorzugt
 *    an Raumübergängen; zwischen zwei Gangzellen nie.
 *
 * ── Die Fehlerarten, die hier auffallen sollen ───────────────────────
 *  • Eine Schleifenkante, die im Grab KEIN Durchgang ist (Modul nicht
 *    offen) — sie sähe im Graphen wie eine Verbindung aus und wäre eine
 *    Wand. Genau die Klasse, die G4 abgeschafft hat und die ein zweiter
 *    Kantensatz wieder einschleppen kann.
 *  • Ein Torbogen auf einer Kante, die gar keine Verbindung ist — ein
 *    Rahmen vor einer Wand.
 *  • Ein Türsatz, der an der Iterationsreihenfolge hängt. Er fiele nie
 *    auf: Dasselbe Grab, andere Bögen, und beide Läufe sähen richtig aus.
 *    Deshalb wird er über eine VERTAUSCHTE Eingabe geprüft, nicht über
 *    zwei Läufe derselben Reihenfolge.
 *
 * Aufruf: `npx tsx shared/test/dungeon-rasterschleifen.ts`
 */
import {
  DIRECTIONS,
  OPPOSITE_DIRECTION,
  directionFromVector,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
  type EdgeState,
} from '../src/dungeonRasterModul.js';
import {
  DEFAULT_GRID_TUNING,
  canonicalEdge,
  cellKey,
  compareEdges,
  edgeCenterWorld,
  generateGridLayout,
  moduleWorldEdgeStates,
  neighbourCell,
  planArchways,
  planGridDungeon,
  selectEdges,
  type GridEdge,
  type GridPlan,
} from '../src/dungeonRasterGenerator.js';
import { DUNGEONS_BY_NAME, sanitizeGeneratorEinstellungen } from '../src/dungeons.js';
import { quatMulVec3 } from '../src/worldgen/Math3d.js';
import type { DungeonDef, RoomDef } from '../src/dungeons.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

const KIT = 'DG_StoneVault';
const found = DUNGEONS_BY_NAME.get(KIT);
if (!found) {
  console.error(`Kit '${KIT}' nicht gefunden`);
  process.exit(1);
}
const kit: DungeonDef = found;
const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));
const WALL = kit.rooms.find((r) => r.endCap)?.name ?? '';

/** Dieselbe Stichprobe wie in G1/G4 — die Zahlen bleiben vergleichbar. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const HORIZONTAL: readonly Direction[] = DIRECTIONS.filter(isHorizontal);

/**
 * Trägt das Modul dieser Zelle eine eingebaute VOLLE Wand? Dann ist die
 * Zelle ein Gang (Korridor, Ecke, Abzweig), sonst ein Raum.
 *
 * Abgeleitet aus der Modulerklärung (G2), nicht aus einer Namensliste:
 * Eine Liste im Test wäre eine zweite Wahrheit neben der im Generator,
 * und beide gingen beim nächsten Modul auseinander. Boden und Decke
 * zählen nicht mit — sie sind bei JEDEM Modul `wall`.
 */
function isCorridorModule(room: string): boolean {
  const rd = roomByName.get(room);
  if (!rd) throw new Error(`Raum '${room}' nicht im Kit`);
  return gridModuleFromRoomDef(rd).cells.some((c) => HORIZONTAL.some((d) => c.edges[d] === 'wall'));
}

/**
 * Die Kantenzustände JEDER belegten Weltzelle, aus der Modulerklärung
 * (G2) über die Räume des Plans.
 *
 * Bis G5 stand hier `cells[0]` — für ein einzelliges Modul ist das die
 * ganze Wahrheit. Mit dem Stempel aus G6 nicht mehr: Die vier Zellen
 * einer Halle haben verschiedene Aussenkanten, und `cells[0]` erklärte
 * drei davon falsch (jede Innenkante sähe wie eine Aussenkante aus).
 * Gefragt wird deshalb je RAUM und über dieselbe Rückrechnung, mit der
 * der Generator die Module in die Welt legt.
 */
function statesOf(plan: GridPlan): Map<string, Record<Direction, EdgeState>> {
  const out = new Map<string, Record<Direction, EdgeState>>();
  for (const room of plan.rooms) {
    const rd = roomByName.get(room.module);
    if (!rd) throw new Error(`Raum '${room.module}' nicht im Kit`);
    for (const [key, rec] of moduleWorldEdgeStates(room.cell, room.yaw, gridModuleFromRoomDef(rd))) {
      out.set(key, rec);
    }
  }
  return out;
}

/**
 * Zyklen, die ein mehrzelliger Raum schon in sich trägt (G6).
 *
 * Eine 2 × 2-Halle hat vier Innenkanten zwischen vier Zellen — als Graph
 * gelesen ist das ein Ring, also ein Zyklus, den keine Schleife gezogen
 * hat. Ohne diesen Term behauptete die Prüfung „Baum plus Schleifen" einen
 * Fehler, wo nur ein Raum steht.
 */
function stampCycles(plan: GridPlan): number {
  const roomOf = new Map(plan.cells.map((c) => [cellKey(c.cell), c.room]));
  let inner = 0;
  for (const c of plan.cells) {
    for (const d of c.edges) {
      if (roomOf.get(cellKey(neighbourCell(c.cell, d))) === c.room) inner++;
    }
  }
  // Σ je Raum (Innenkanten − (Zellen − 1)); über alle Räume summiert ist
  // der Abzug genau `Zellen − Räume`.
  return inner / 2 - (plan.cells.length - plan.rooms.length);
}

/**
 * Kann diese Zelle auf dieser Kante überhaupt noch einen Durchgang
 * bekommen?
 *
 * Für eine EINZELzelle immer: Ihr Modul wird erst nach dem Kantenausbau
 * gewählt (S5) und fügt sich jedem Muster. Bei einem mehrzelligen Raum
 * steht das Modul schon fest, bevor die Nachbarn wachsen — die Halle ist
 * dann auf allen acht Aussenkanten offen, die Treppe (G7) nur an ihren
 * zwei Enden.
 */
function mayOpen(
  plan: GridPlan,
  states: Map<string, Record<Direction, EdgeState>>,
  cell: GridPlan['cells'][number],
  d: Direction
): boolean {
  if (plan.rooms[cell.room]!.cells.length === 1) return true;
  return states.get(cellKey(cell.cell))![d] === 'open';
}

/**
 * Doppelwände: Nachbarschaften zwischen zwei belegten Zellen, die KEIN
 * Durchgang sind — und beide Seiten hätten einer werden können.
 *
 * Die zweite Hälfte des Satzes kommt mit G7 dazu, und sie ist keine
 * Bequemlichkeit: An einer Treppenflanke steht die Wand des NACHBARN
 * allein (die Flanke selbst ist ein Keil, `wallPartial`), es sind also
 * keine zwei Wände. Mitgezählt wäre sie eine Zwischenwand, die kein
 * Schleifenregler je entfernen kann — der Anteil wüchse mit jeder Treppe
 * scheinbar schlechter, obwohl sich nichts verschlechtert hat.
 */
function doubleWalls(plan: GridPlan): number {
  const states = statesOf(plan);
  const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
  let n = 0;
  for (const c of plan.cells) {
    for (const d of HORIZONTAL) {
      if (c.edges.includes(d)) continue;
      const other = cellAt.get(cellKey(neighbourCell(c.cell, d)));
      if (!other) continue;
      if (!mayOpen(plan, states, c, d)) continue;
      if (!mayOpen(plan, states, other, OPPOSITE_DIRECTION[d])) continue;
      n++;
    }
  }
  return n / 2; // jede Nachbarschaft wird von beiden Seiten gezählt
}

function withTuning(loopFraction: number, archwayFraction: number) {
  return { loopFraction, archwayFraction };
}

console.log('=== G5: Schleifen und Torbögen ===\n');

// ─────────────────────────────────────────────────────────────────────
console.log('1) Der Sanitizer klemmt beide Regler auf 0…1');
// Sie kommen aus einem Dokument und damit von aussen. Ein ungeklemmter
// Wert baute ein Grab, das beim nächsten Laden anders beschrieben wäre,
// als es gebaut wurde — dieselbe Begründung wie bei `maxRooms`.
{
  check(
    sanitizeGeneratorEinstellungen({ loopFraction: 2 })?.loopFraction === 1,
    'loopFraction 2 wird nicht auf 1 geklemmt'
  );
  check(
    sanitizeGeneratorEinstellungen({ archwayFraction: -0.5 })?.archwayFraction === 0,
    'archwayFraction −0,5 wird nicht auf 0 geklemmt'
  );
  check(
    sanitizeGeneratorEinstellungen({ loopFraction: 0.35 })?.loopFraction === 0.35,
    'loopFraction 0,35 überlebt den Sanitizer nicht unverändert'
  );
  // 0 ist ein GÜLTIGER Wert (keine Schleifen) und ausdrücklich etwas
  // anderes als „fehlt" — dieselbe Falle wie bei `ambientLicht`.
  check(
    sanitizeGeneratorEinstellungen({ loopFraction: 0 })?.loopFraction === 0,
    'loopFraction 0 fällt weg statt zu bleiben'
  );
  check(
    sanitizeGeneratorEinstellungen({ loopFraction: 'viel' }) === undefined,
    'unlesbare loopFraction wird nicht verworfen'
  );
  check(
    sanitizeGeneratorEinstellungen({ archwayFraction: Number.NaN }) === undefined,
    'NaN als archwayFraction wird nicht verworfen'
  );
  console.log('  0…1 geklemmt, 0 bleibt, Unlesbares fällt weg');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Schleifenanteil im Zielband');
// Der Regler sagt: Anteil der Nachbarschaften OHNE Baumkante, die zur
// Kante werden. Gemessen wird über alle 40 Saaten zusammen — je Saat
// sind es zu wenige Ziehungen für eine Aussage.
{
  let loops = 0;
  let walls = 0;
  let cycles = 0;
  let stamps = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    loops += plan.loops.length;
    walls += doubleWalls(plan);
    stamps += stampCycles(plan);
    const edges = plan.cells.reduce((n, c) => n + c.edges.length, 0) / 2;
    cycles += edges - (plan.cells.length - 1);
  }
  const share = loops / (loops + walls);
  check(loops > 0, 'keine einzige Schleife über 40 Saaten');
  check(
    share >= 0.3 && share <= 0.4,
    `Schleifenanteil ${(share * 100).toFixed(1)} %, erwartet 30…40 % (Vorgabe ${DEFAULT_GRID_TUNING.loopFraction})`
  );
  check(
    cycles === loops + stamps,
    `${cycles} Zyklen, aber ${loops} Schleifenkanten + ${stamps} Stempelringe — kein Baum + Schleifen + Stempel`
  );
  console.log(
    `  40 Saaten: ${loops} Schleifen, ${walls} verbleibende Doppelwände, ` +
      `Anteil ${(share * 100).toFixed(1)} %, ${cycles} Zyklen (davon ${stamps} aus Stempeln)`
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Schleifen brechen die G4-Invarianten nicht');
// Eine zusätzliche Kante ändert das Öffnungsmuster einer Zelle — und
// damit ihr Modul. Wäre die Kante nur im Graphen und nicht im Modul,
// stünde im Grab eine Wand, wo der Graph einen Durchgang meldet.
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const occupied = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    const states = statesOf(plan);
    for (const c of plan.cells) {
      const mine = states.get(cellKey(c.cell))!;
      const open = HORIZONTAL.filter((d) => mine[d] === 'open');
      for (const d of c.edges) {
        check(mine[d] === 'open', `Saat ${seed}: Zelle ${cellKey(c.cell)} — Graphkante ${d} ist im Modul keine Öffnung`);
        const nb = occupied.get(cellKey(neighbourCell(c.cell, d)));
        check(
          nb !== undefined && nb.edges.includes(OPPOSITE_DIRECTION[d]),
          `Saat ${seed}: Kante ${cellKey(c.cell)}→${d} ist einseitig`
        );
      }
      // Und die Gegenrichtung: jede überzählige Öffnung zeigt auf Fels
      // ODER auf die eingebaute Wand des Nachbarn (Zeile 3 der Tafel).
      // Der zweite Fall entsteht erst mit dem Stempel aus G6 — die Halle
      // hat acht Öffnungen und keine Wahl, wo sie sie hinlegt. Was sie
      // NICHT geben darf, ist zwei offene Kanten ohne Durchgang: Dort
      // stünden zwei Platten Rücken an Rücken in fremden Zellen.
      for (const d of open) {
        if (c.edges.includes(d) || c.entrancePort === d) continue;
        const nb = occupied.get(cellKey(neighbourCell(c.cell, d)));
        if (!nb) continue;
        check(
          states.get(cellKey(nb.cell))![OPPOSITE_DIRECTION[d]] === 'wall',
          `Saat ${seed}: Zelle ${cellKey(c.cell)} ist nach ${d} offen, dort steht '${nb.module}' ohne Kante und ohne Wand`
        );
      }
    }
    // Keine Platte in einer belegten Zelle (Zeile 2 der Tafel bleibt leer).
    for (const s of plan.seals) {
      check(
        !occupied.has(cellKey(neighbourCell(s.cell, s.direction))),
        `Saat ${seed}: Platte auf ${cellKey(s.cell)}#${s.direction} liegt im Körper eines Nachbarn`
      );
    }
    // Erreichbarkeit bleibt 100 % — mit Schleifen erst recht.
    const seen = new Set<string>([cellKey(plan.cells[0]!.cell)]);
    const queue = [plan.cells[0]!.cell];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of occupied.get(cellKey(cur))!.edges) {
        const nb = neighbourCell(cur, d);
        if (seen.has(cellKey(nb))) continue;
        seen.add(cellKey(nb));
        queue.push(nb);
      }
    }
    check(seen.size === plan.cells.length, `Saat ${seed}: ${plan.cells.length - seen.size} Zellen unerreichbar`);
  }
  console.log('  40 Saaten: jede Schleifenkante ist beidseitig offen, 0 Platten in belegten Zellen, 100 % erreichbar');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Torbögen nur auf Graphkanten, nie zwischen zwei Gangzellen');
// „Nur auf Graphkanten" ist die eine Aussage, die man dem fertigen
// Layout ansehen muss — deshalb wird die Tür aus ihrer POSE auf eine
// Zellkante zurückgerechnet und nicht aus dem Plan abgelesen.
{
  let doors = 0;
  let onLoops = 0;
  const kinds = new Map<string, number>();
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const layout = generateGridLayout(kit, seed);
    const byKey = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    const loopKeys = new Set(plan.loops.map((e) => `${cellKey(e.cell)}#${e.direction}`));
    check(
      layout.doors.length === plan.archways.length,
      `Saat ${seed}: ${layout.doors.length} Türen im Layout, ${plan.archways.length} im Plan`
    );
    for (const door of layout.doors) {
      doors++;
      // Welche Zellkante trägt diese Tür?
      let hit: { key: string; direction: Direction } | null = null;
      for (const c of plan.cells) {
        for (const d of HORIZONTAL) {
          const e = edgeCenterWorld(c.cell, d);
          if (Math.hypot(e.x - door.pos.x, e.y - door.pos.y, e.z - door.pos.z) < 1e-6) {
            hit = { key: cellKey(c.cell), direction: d };
          }
        }
        if (hit) break;
      }
      check(hit !== null, `Saat ${seed}: Tür auf ${JSON.stringify(door.pos)} liegt auf keiner Zellkante`);
      if (!hit) continue;
      const host = byKey.get(hit.key)!;
      check(
        host.edges.includes(hit.direction),
        `Saat ${seed}: Tür auf ${hit.key}#${hit.direction} steht auf einer Kante ohne Durchgang`
      );
      const other = byKey.get(cellKey(neighbourCell(host.cell, hit.direction)));
      check(other !== undefined, `Saat ${seed}: Tür auf ${hit.key}#${hit.direction} hat keinen Nachbarn`);
      if (!other) continue;
      const a = isCorridorModule(host.module);
      const b = isCorridorModule(other.module);
      check(!(a && b), `Saat ${seed}: Torbogen zwischen zwei Gangzellen (${host.module}/${other.module})`);
      kinds.set(`${a ? 'Gang' : 'Raum'}→${b ? 'Gang' : 'Raum'}`, (kinds.get(`${a ? 'Gang' : 'Raum'}→${b ? 'Gang' : 'Raum'}`) ?? 0) + 1);
      // Die Blickrichtung des Rahmens muss auf der Kante stehen.
      const forward = directionFromVector(quatMulVec3(door.rot, { x: 0, y: 0, z: 1 }));
      check(
        forward === hit.direction || forward === OPPOSITE_DIRECTION[hit.direction],
        `Saat ${seed}: Torbogen auf ${hit.key}#${hit.direction} schaut nach ${forward}`
      );
      const canon = canonicalEdge(host.cell, hit.direction);
      if (loopKeys.has(`${cellKey(canon.cell)}#${canon.direction}`)) onLoops++;
    }
  }
  check(doors > 0, 'kein einziger Torbogen über 40 Saaten');
  // Der Punkt aus der Konzeptnotiz: Schleifenkanten bekamen im 1.0-Pfad
  // strukturell NIE einen Rahmen (`placeEndCaps` verlässt den Fall über
  // `continue`, ohne Eintrag in `doorConnections`).
  check(onLoops > 0, 'kein Torbogen auf einer Schleifenkante — genau die Lücke des 1.0-Pfads');
  console.log(
    `  ${doors} Torbögen, davon ${onLoops} auf Schleifenkanten; Arten: ` +
      [...kinds].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Der Türsatz hängt nicht an der Iterationsreihenfolge');
// Die Türwahl läuft über `hashPos(kanonischer Kantenschlüssel)` und
// NICHT über den Saatstrom — genau damit diese Vertauschung nichts
// ändert. Ein Strom-Zug an derselben Stelle bräche hier.
{
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = planGridDungeon(kit, seed);
    const vorwaerts = planArchways(kit, plan.rooms, plan.cells, seed, DEFAULT_GRID_TUNING.archwayFraction);
    const rueckwaerts = planArchways(
      kit,
      [...plan.rooms].reverse(),
      [...plan.cells].reverse(),
      seed,
      DEFAULT_GRID_TUNING.archwayFraction
    );
    check(
      JSON.stringify(vorwaerts) === JSON.stringify(rueckwaerts),
      `Saat ${seed}: vertauschte Zellreihenfolge liefert einen anderen Türsatz`
    );
    check(
      JSON.stringify(vorwaerts) === JSON.stringify(plan.archways),
      `Saat ${seed}: der Plan trägt einen anderen Türsatz als die reine Funktion`
    );
  }
  // Und dieselbe Aussage eine Ebene tiefer, an der Auswahl selbst.
  const edges: GridEdge[] = [];
  for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) {
      edges.push(canonicalEdge({ i, j, level: 0 }, 'n'));
      edges.push(canonicalEdge({ i, j, level: 0 }, 'e'));
    }
  }
  const gerade = selectEdges(edges, 4711, 1, () => 0.5);
  const verdreht = selectEdges([...edges].reverse(), 4711, 1, () => 0.5);
  check(
    JSON.stringify(gerade) === JSON.stringify(verdreht),
    'selectEdges liefert bei vertauschter Eingabe eine andere Menge'
  );
  check(
    JSON.stringify(gerade) === JSON.stringify([...gerade].sort(compareEdges)),
    'selectEdges liefert unsortiert — die Ausgabe hinge an der Eingabereihenfolge'
  );
  console.log(`  10 Saaten vertauscht: gleicher Türsatz; ${gerade.length} von ${edges.length} Kanten bei 50 %`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Weniger Doppelwände — Mikes Ergänzung als Zahl');
// „Innerhalb der Räume werden aktuell viele Zwischenwände verwendet, das
// macht die Räume sehr verwinkelt." Jede Schleifenkante ist eine
// Zwischenwand weniger; das ist der ganze Zweck der hohen Vorgabe 0,35.
{
  let ohne = 0;
  let mit = 0;
  for (const seed of SEEDS) {
    ohne += doubleWalls(planGridDungeon(kit, seed, withTuning(0, 0)));
    mit += doubleWalls(planGridDungeon(kit, seed, withTuning(DEFAULT_GRID_TUNING.loopFraction, 0)));
  }
  check(mit < ohne, `Doppelwände sinken nicht: ${ohne} ohne Schleifen, ${mit} mit`);
  check(
    mit <= ohne * 0.75,
    `Doppelwände sinken nur von ${ohne} auf ${mit} — bei 35 % Schleifen wäre ~${Math.round(ohne * 0.65)} zu erwarten`
  );
  console.log(`  40 Saaten: ${ohne} Doppelwände ohne Schleifen → ${mit} mit Vorgabe (−${(100 - (mit / ohne) * 100).toFixed(1)} %)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Die Regler-Enden und der Determinismus');
{
  for (const seed of [1, 7, 2123721695]) {
    const a = JSON.stringify(generateGridLayout(kit, seed));
    const b = JSON.stringify(generateGridLayout(kit, seed));
    check(a === b, `Saat ${seed}: zwei Läufe liefern verschiedene Layouts`);
  }
  // loopFraction 0 = der G4-Stand: ein Baum, keine Schleife.
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = planGridDungeon(kit, seed, withTuning(0, 0));
    const edges = plan.cells.reduce((n, c) => n + c.edges.length, 0) / 2;
    check(plan.loops.length === 0, `Saat ${seed}: loopFraction 0 erzeugt ${plan.loops.length} Schleifen`);
    check(
      edges === plan.cells.length - 1 + stampCycles(plan),
      `Saat ${seed}: loopFraction 0 ist kein Baum + Stempelringe (${edges} Kanten, ${stampCycles(plan)} Ringe)`
    );
    check(plan.archways.length === 0, `Saat ${seed}: archwayFraction 0 erzeugt ${plan.archways.length} Torbögen`);
    // loopFraction 1 = jede Nachbarschaft ist ein Durchgang.
    const voll = planGridDungeon(kit, seed, withTuning(1, 0));
    check(doubleWalls(voll) === 0, `Saat ${seed}: loopFraction 1 lässt ${doubleWalls(voll)} Doppelwände stehen`);
  }
  // `doorsEnabled: false` muss weiter gelten — es ist die Einstellung,
  // die der 1.0-Pfad kennt, und zwei Schalter für dieselbe Sache wären
  // die nächste Gelegenheit zum Auseinanderlaufen.
  const stumm = generateGridLayout(kit, 1, { doorsEnabled: false });
  check(stumm.doors.length === 0, `doorsEnabled: false liefert ${stumm.doors.length} Türen`);
  // Und die Regler wirken überhaupt: andere Zahl, anderes Grab.
  const x = JSON.stringify(generateGridLayout(kit, 1, withTuning(0, 0)));
  const y = JSON.stringify(generateGridLayout(kit, 1, withTuning(0.35, 0.25)));
  check(x !== y, 'die Regler ändern das Layout nicht');
  console.log('  0 → Baum ohne Bögen, 1 → keine Doppelwand, doorsEnabled: false → keine Tür');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n8) Türen und Platten stossen sich nicht');
// Eine Tür sitzt in der Kantenebene, eine Platte auch. Stünden beide auf
// derselben Kante, wäre der Rahmen zugemauert.
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const layout = generateGridLayout(kit, seed);
    const sealPositions = layout.rooms.filter((r) => r.room === WALL).map((r) => r.pos);
    for (const door of layout.doors) {
      const clash = sealPositions.some(
        (p) => Math.hypot(p.x - door.pos.x, p.y - door.pos.y, p.z - door.pos.z) < 0.5
      );
      check(!clash, `Saat ${seed}: Torbogen auf ${JSON.stringify(door.pos)} steht in einer Abschlussplatte`);
    }
    check(
      new Set(plan.archways.map((a) => `${cellKey(a.cell)}#${a.direction}`)).size === plan.archways.length,
      `Saat ${seed}: zwei Torbögen auf derselben Kante`
    );
  }
  console.log('  40 Saaten: kein Torbogen in einer Platte, keine Kante doppelt berahmt');
}

console.log(failures === 0 ? '\nOK — Schleifen und Torbögen halten ihre Regeln' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
