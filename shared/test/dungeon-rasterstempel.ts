/**
 * G6 (Modul-Generierung 2.0) — Wächter über den Stempel: die Halle als
 * 2 × 2 Zellen.
 *
 * ── Warum ein mehrzelliges Modul einen eigenen Test bekommt ───────────
 * G4 und G5 kennen nur Module, die genau eine Zelle belegen. Für die
 * sind drei Aussagen dasselbe: „das Modul“, „seine Zelle“ und „seine
 * Kanten“. Bei einem Stempel fallen sie auseinander — ein Raum, vier
 * Zellen, acht Ports auf acht verschiedenen Nachbarzellen. Jede Stelle
 * im Generator, die bisher `cells[0]` gelesen hat, ist damit eine Falle,
 * und keine davon fällt in einer Zählung auf: Ein um eine Zelle
 * versetzter Fussabdruck erzeugt weder eine Ausnahme noch eine
 * Doppelbelegung, er baut nur die Halle einen Meter neben ihre eigenen
 * Türen.
 *
 * ── Die Fehlerarten, die hier auffallen sollen ───────────────────────
 *  • **Eine getippte Porttafel.** „Nord-West-Port liegt auf Zelle 2“ ist
 *    unter einer Gierung richtig und unter den anderen drei falsch.
 *    Deshalb wird JEDER Port aus der Rückrechnung geholt
 *    (`moduleWorldPorts`) und gegen die Kantenmitte der Zelle geprüft,
 *    die er laut Rückrechnung trägt — und das in allen vier Gierungen.
 *  • **Der Anker als Fussabdruck missverstanden.** Die Ankerzelle ist
 *    die lokale Zelle (0,0,0); bei gerader Zellzahl wandert sie mit der
 *    Gierung durch die vier Ecken. Wer sie für „die Zelle des Raums“
 *    hält, belegt drei Zellen zu wenig.
 *  • **Die Kantentafel am Stempel vergessen.** Die acht Ports der Halle
 *    sind offen. Steht davor die eingebaute Wand eines Nachbarn, darf
 *    dort KEINE Platte stehen (Zeile 3) — sonst sind die 531 Platten
 *    aus dem G1-Befund zurück, nur an einem neuen Modul.
 *
 * Aufruf: `npx tsx shared/test/dungeon-rasterstempel.ts`
 */
import {
  DIRECTIONS,
  OPPOSITE_DIRECTION,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
  type EdgeState,
} from '../src/dungeonRasterModul.js';
import {
  DEFAULT_GRID_TUNING,
  YAWS,
  assertConnectorsOnEdges,
  cellKey,
  edgeCenterWorld,
  generateGridLayout,
  moduleWorldCells,
  moduleWorldEdgeStates,
  moduleWorldPorts,
  neighbourCell,
  planGridDungeon,
  type GridCell,
  type GridPlan,
} from '../src/dungeonRasterGenerator.js';
import { DUNGEONS_BY_NAME } from '../src/dungeons.js';
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

/** Dieselbe Stichprobe wie G1/G4/G5 — die Zahlen bleiben vergleichbar. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const HORIZONTAL: readonly Direction[] = DIRECTIONS.filter(isHorizontal);

/**
 * Der Stempel des Kits, aus der Modulerklärung gesucht statt beim Namen
 * genannt: mehrzellig auf EINER Ebene. Die Treppe (3 Zellen, 2 Ebenen)
 * fällt damit heraus — sie ist G7.
 */
const stampDef = kit.rooms.find((r) => {
  if (r.endCap || r.entrance) return false;
  const m = gridModuleFromRoomDef(r);
  return m.cells.length > 1 && m.levels === 1;
});
if (!stampDef) {
  console.error('Das Kit hat kein mehrzelliges Modul auf einer Ebene — G6 hätte nichts zu stempeln.');
  process.exit(1);
}
const stamp = gridModuleFromRoomDef(stampDef);

/** Kantenzustände einer Planzelle, über ihren Raum und dessen Rückrechnung. */
function statesOf(plan: GridPlan): Map<string, Record<Direction, EdgeState>> {
  const out = new Map<string, Record<Direction, EdgeState>>();
  for (const room of plan.rooms) {
    const rd = roomByName.get(room.module);
    if (!rd) throw new Error(`Modul '${room.module}' nicht im Kit`);
    for (const [key, rec] of moduleWorldEdgeStates(room.cell, room.yaw, gridModuleFromRoomDef(rd))) {
      out.set(key, rec);
    }
  }
  return out;
}

console.log('=== G6: die Halle als 2×2-Stempel ===\n');

// ─────────────────────────────────────────────────────────────────────
console.log(`1) '${stampDef.name}' erklärt sich als 2×2 mit acht Ports`);
{
  check(stamp.cellsX === 2 && stamp.cellsZ === 2, `Fussabdruck ${stamp.cellsX}×${stamp.cellsZ}, erwartet 2×2`);
  check(stamp.levels === 1, `${stamp.levels} Ebenen, erwartet 1`);
  check(stamp.cells.length === 4, `${stamp.cells.length} Zellen, erwartet 4`);
  check(stamp.ports.length === 8, `${stamp.ports.length} Ports, erwartet 8`);
  for (const c of stamp.cells) {
    const outer = HORIZONTAL.filter((d) => !c.interior[d]);
    check(outer.length === 2, `Zelle (${c.ix},${c.iz}) hat ${outer.length} Aussenkanten, erwartet 2`);
    for (const d of outer) {
      check(c.edges[d] === 'open', `Zelle (${c.ix},${c.iz}): Aussenkante ${d} ist '${c.edges[d]}', erwartet 'open'`);
    }
    for (const d of HORIZONTAL.filter((x) => c.interior[x])) {
      check(c.edges[d] === 'open', `Zelle (${c.ix},${c.iz}): Innenkante ${d} ist '${c.edges[d]}' statt 'open'`);
    }
    check(c.edges.up === 'wall' && c.edges.down === 'wall', `Zelle (${c.ix},${c.iz}): Boden/Decke nicht 'wall'`);
  }
  console.log(`  ${stamp.cellsX}×${stamp.cellsZ}×${stamp.levels}, ${stamp.cells.length} Zellen, ${stamp.ports.length} Ports, je 2 Aussenkanten`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Alle acht Ports aus der Rückrechnung, in allen vier Gierungen');
// Der Kern des Meilensteins: KEINE getippte Tafel. Für jede Gierung und
// mehrere Ankerzellen wird der Fussabdruck aus `moduleWorldCells` und die
// Ports aus `moduleWorldPorts` geholt — und beides muss zueinander passen.
{
  const anchors: GridCell[] = [
    { i: 0, j: 0, level: 0 },
    { i: 3, j: -2, level: 0 },
    { i: -4, j: 5, level: 1 },
    { i: 7, j: 7, level: -1 },
  ];
  for (const anchor of anchors) {
    for (const yaw of YAWS) {
      const cells = moduleWorldCells(anchor, yaw, stamp);
      const keys = new Set(cells.map(cellKey));
      check(cells.length === 4 && keys.size === 4, `Anker ${cellKey(anchor)} @${yaw}°: ${keys.size} verschiedene Zellen, erwartet 4`);
      // Ein 2×2-Block: zwei i-Werte, zwei j-Werte, eine Ebene.
      const is = new Set(cells.map((c) => c.i));
      const js = new Set(cells.map((c) => c.j));
      const ls = new Set(cells.map((c) => c.level));
      check(
        is.size === 2 && js.size === 2 && ls.size === 1 &&
          Math.max(...is) - Math.min(...is) === 1 && Math.max(...js) - Math.min(...js) === 1,
        `Anker ${cellKey(anchor)} @${yaw}°: der Fussabdruck ist kein zusammenhängender 2×2-Block`
      );
      check(keys.has(cellKey(anchor)), `Anker ${cellKey(anchor)} @${yaw}°: die Ankerzelle liegt nicht im Fussabdruck`);
      check(cells[0]!.level === anchor.level, `Anker ${cellKey(anchor)} @${yaw}°: der Stempel wechselt die Ebene`);

      const ports = moduleWorldPorts(anchor, yaw, stamp);
      check(ports.length === 8, `Anker ${cellKey(anchor)} @${yaw}°: ${ports.length} Ports, erwartet 8`);
      const perDirection = new Map<Direction, number>();
      const outside = new Set<string>();
      for (const p of ports) {
        check(keys.has(cellKey(p.cell)), `Port ${p.connector} @${yaw}° sitzt auf Zelle ${cellKey(p.cell)} ausserhalb des Fussabdrucks`);
        check(isHorizontal(p.direction), `Port ${p.connector} @${yaw}° zeigt nach ${p.direction} statt waagerecht`);
        const nb = neighbourCell(p.cell, p.direction);
        check(!keys.has(cellKey(nb)), `Port ${p.connector} @${yaw}° zeigt auf die eigene Zelle ${cellKey(nb)} — das ist eine Innenkante`);
        outside.add(cellKey(nb));
        perDirection.set(p.direction, (perDirection.get(p.direction) ?? 0) + 1);
        const soll = edgeCenterWorld(p.cell, p.direction);
        check(
          Math.hypot(p.edgeCenter.x - soll.x, p.edgeCenter.y - soll.y, p.edgeCenter.z - soll.z) < 1e-9,
          `Port ${p.connector} @${yaw}°: Kantenmitte weicht von der Zellkante ab`
        );
      }
      check(outside.size === 8, `Anker ${cellKey(anchor)} @${yaw}°: die acht Ports treffen nur ${outside.size} verschiedene Nachbarzellen`);
      for (const d of HORIZONTAL) {
        check(perDirection.get(d) === 2, `Anker ${cellKey(anchor)} @${yaw}°: ${perDirection.get(d) ?? 0} Ports nach ${d}, erwartet 2`);
      }
      // Der Zeuge aus S6: jeder Connector landet real auf seiner Kantenmitte.
      let threw = '';
      try {
        assertConnectorsOnEdges(stampDef, anchor, yaw, stamp);
      } catch (e) {
        threw = String(e);
      }
      check(threw === '', `Anker ${cellKey(anchor)} @${yaw}°: ${threw}`);
    }
  }
  console.log(`  ${anchors.length} Anker × 4 Gierungen: 4 Zellen, 8 Ports, 8 verschiedene Nachbarzellen, je 2 pro Seite`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Der Generator stempelt Hallen — und lässt sie sich abschalten');
{
  let seedsWithHall = 0;
  let halls = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const n = plan.rooms.filter((r) => r.module === stampDef.name).length;
    halls += n;
    if (n > 0) seedsWithHall++;
  }
  check(seedsWithHall >= 10, `Halle nur in ${seedsWithHall} von ${SEEDS.length} Saaten, verlangt sind ≥ 10`);
  let ohne = 0;
  for (const seed of SEEDS) {
    ohne += planGridDungeon(kit, seed, { hallFraction: 0 }).rooms.filter((r) => r.module === stampDef.name).length;
  }
  check(ohne === 0, `hallFraction 0 stempelt trotzdem ${ohne} Hallen`);
  console.log(
    `  40 Saaten: ${halls} Hallen in ${seedsWithHall} Grundrissen (Vorgabe ${DEFAULT_GRID_TUNING.hallFraction}); mit 0 keine einzige`
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Fussabdruck und Zellzuordnung: keine Zelle doppelt, keine verwaist');
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const seen = new Map<string, number>();
    plan.rooms.forEach((room, index) => {
      const rd = roomByName.get(room.module);
      check(rd !== undefined, `Saat ${seed}: Modul '${room.module}' steht nicht im Kit`);
      if (!rd) return;
      const footprint = moduleWorldCells(room.cell, room.yaw, gridModuleFromRoomDef(rd));
      check(
        JSON.stringify(footprint) === JSON.stringify(room.cells),
        `Saat ${seed}: Raum ${index} ('${room.module}') führt einen anderen Fussabdruck als die Rückrechnung`
      );
      for (const c of room.cells) {
        const key = cellKey(c);
        check(!seen.has(key), `Saat ${seed}: Zelle ${key} ist von Raum ${seen.get(key)} und ${index} belegt`);
        seen.set(key, index);
      }
    });
    check(seen.size === plan.cells.length, `Saat ${seed}: ${seen.size} belegte Zellen, aber ${plan.cells.length} Planzellen`);
    for (const c of plan.cells) {
      const room = plan.rooms[c.room];
      check(room !== undefined, `Saat ${seed}: Zelle ${cellKey(c.cell)} zeigt auf Raum ${c.room}, den es nicht gibt`);
      if (!room) continue;
      check(
        room.cells.some((x) => cellKey(x) === cellKey(c.cell)),
        `Saat ${seed}: Zelle ${cellKey(c.cell)} gehört laut Plan zu Raum ${c.room}, steht aber nicht in dessen Fussabdruck`
      );
      check(room.module === c.module && room.yaw === c.yaw, `Saat ${seed}: Zelle ${cellKey(c.cell)} und ihr Raum sind sich über Modul/Gierung uneins`);
    }
    // Und die Zellzahl bleibt die Bedeutung von `maxRooms` — auch wenn ein
    // Stempel vier Zellen auf einmal belegt.
    check(
      Math.abs(plan.cells.length - kit.maxRooms) <= 1,
      `Saat ${seed}: ${plan.cells.length} Zellen, erwartet ${kit.maxRooms} ± 1`
    );
  }
  console.log(`  40 Saaten: Fussabdruck = Rückrechnung, keine Zelle doppelt, Zellzahl = maxRooms ± 1`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Die Kantentafel gilt am Stempel wie an der Einzelzelle');
// Die Kernforderung des Meilensteins: Eine unverbundene Hallenkante, vor
// der die eingebaute Wand eines Nachbarn steht, bekommt KEINE Platte
// (Zeile 3). Gegen Fels bekommt sie genau eine (Zeile 5).
{
  let gegenWand = 0;
  let gegenFels = 0;
  let durchgaenge = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const states = statesOf(plan);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    const sealed = new Set(plan.seals.map((s) => `${cellKey(s.cell)}#${s.direction}`));
    for (const room of plan.rooms) {
      if (room.module !== stampDef.name) continue;
      for (const c of room.cells) {
        const mine = states.get(cellKey(c))!;
        for (const d of HORIZONTAL) {
          if (mine[d] !== 'open') continue;
          const key = `${cellKey(c)}#${d}`;
          const host = cellAt.get(cellKey(c))!;
          const nb = cellAt.get(cellKey(neighbourCell(c, d)));
          if (host.edges.includes(d)) {
            durchgaenge++;
            check(!sealed.has(key), `Saat ${seed}: Platte auf dem Durchgang ${key} der Halle`);
            continue;
          }
          if (!nb) {
            gegenFels++;
            check(sealed.has(key), `Saat ${seed}: Hallenkante ${key} zeigt auf Fels und ist unversiegelt`);
            continue;
          }
          const facing = states.get(cellKey(nb.cell))![OPPOSITE_DIRECTION[d]];
          if (facing === 'wall') {
            gegenWand++;
            const back = `${cellKey(nb.cell)}#${OPPOSITE_DIRECTION[d]}`;
            check(!sealed.has(key), `Saat ${seed}: Platte auf ${key} — dort steht schon die Wand von '${nb.module}'`);
            check(!sealed.has(back), `Saat ${seed}: Platte auf ${back} vor der eingebauten Wand`);
          } else if (facing === 'wallPartial') {
            check(sealed.has(key), `Saat ${seed}: Hallenkante ${key} gegen eine Teilwand ohne Platte`);
          } else {
            check(false, `Saat ${seed}: Hallenkante ${key} steht offen gegen die offene Kante von '${nb.module}' ohne Durchgang`);
          }
        }
      }
    }
  }
  check(gegenWand > 0, 'keine einzige Hallenkante gegen einen wand-Nachbarn — die Zeile 3 der Tafel bleibt ungeprüft');
  console.log(`  40 Saaten: ${durchgaenge} Hallendurchgänge, ${gegenFels} Kanten gegen Fels (je 1 Platte), ${gegenWand} gegen eine eingebaute Wand (0 Platten)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Die G4/G5-Invarianten halten auch mit Stempeln');
{
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const states = statesOf(plan);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    const sealed = new Set(plan.seals.map((s) => `${cellKey(s.cell)}#${s.direction}`));
    // Jede Graphkante ist beidseitig ein Durchgang.
    for (const c of plan.cells) {
      for (const d of c.edges) {
        check(states.get(cellKey(c.cell))![d] === 'open', `Saat ${seed}: Graphkante ${cellKey(c.cell)}#${d} ist im Modul keine Öffnung`);
        const nb = cellAt.get(cellKey(neighbourCell(c.cell, d)));
        check(nb !== undefined && nb.edges.includes(OPPOSITE_DIRECTION[d]), `Saat ${seed}: Graphkante ${cellKey(c.cell)}#${d} ist einseitig`);
      }
    }
    // Keine Platte im Körper eines Nachbarn.
    for (const s of plan.seals) {
      const behind = cellAt.get(cellKey(neighbourCell(s.cell, s.direction)));
      check(
        behind === undefined,
        `Saat ${seed}: Platte auf ${cellKey(s.cell)}#${s.direction} liegt im Körper von '${behind?.module}'`
      );
    }
    // Keine offene Kante ohne Durchgang, Platte oder Wand gegenüber.
    for (const c of plan.cells) {
      for (const d of HORIZONTAL) {
        if (states.get(cellKey(c.cell))![d] !== 'open') continue;
        if (c.edges.includes(d) || c.entrancePort === d) continue;
        const nb = cellAt.get(cellKey(neighbourCell(c.cell, d)));
        const facing = nb ? states.get(cellKey(nb.cell))![OPPOSITE_DIRECTION[d]] : null;
        check(
          sealed.has(`${cellKey(c.cell)}#${d}`) || facing === 'wall',
          `Saat ${seed}: Kante ${cellKey(c.cell)}#${d} ist offen, unversiegelt und ohne Wand gegenüber`
        );
      }
    }
    // 100 % erreichbar, über die Graphkanten.
    const start = plan.cells[0]!.cell;
    const seen = new Set<string>([cellKey(start)]);
    const queue: GridCell[] = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const d of cellAt.get(cellKey(cur))!.edges) {
        const nb = neighbourCell(cur, d);
        if (seen.has(cellKey(nb))) continue;
        seen.add(cellKey(nb));
        queue.push(nb);
      }
    }
    check(seen.size === plan.cells.length, `Saat ${seed}: ${plan.cells.length - seen.size} Zellen unerreichbar`);
  }
  console.log('  40 Saaten: 0 Platten in belegten Zellen, 0 einseitige Kanten, 0 unversorgte Öffnungen, 100 % erreichbar');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Kein Torbogen in der Halle, Determinismus bleibt');
// Ein Rahmen zwischen zwei Zellen DESSELBEN Raums wäre genau die
// Zwischenwand, über die Mike sich beklagt hat — nur als Bogen.
{
  let inHall = 0;
  let atHall = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const roomOf = new Map(plan.cells.map((c) => [cellKey(c.cell), c.room]));
    for (const arch of plan.archways) {
      const a = roomOf.get(cellKey(arch.cell));
      const b = roomOf.get(cellKey(neighbourCell(arch.cell, arch.direction)));
      if (a !== undefined && a === b) inHall++;
      const modules = [a, b].map((x) => (x === undefined ? '' : plan.rooms[x]!.module));
      if (modules.includes(stampDef.name)) atHall++;
    }
  }
  check(inHall === 0, `${inHall} Torbögen zwischen zwei Zellen desselben Raums`);
  for (const seed of [1, 7, 2123721695]) {
    const a = JSON.stringify(generateGridLayout(kit, seed));
    const b = JSON.stringify(generateGridLayout(kit, seed));
    check(a === b, `Saat ${seed}: zwei Läufe liefern verschiedene Layouts`);
  }
  console.log(`  0 Torbögen in einem Raum, ${atHall} an einem Halleneingang; 3 Saaten zweimal byte-gleich`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n8) Die Selbstprüfung S10 läuft durch — kein stiller Rückfall');
// Die wichtigste Prüfung dieses Tests, und die am leichtesten zu
// übersehende: `generateGridLayout` fängt jede verletzte Selbstprüfung ab
// und liefert das Ein-Zellen-Grab. Ohne `strict` sähen alle Blöcke oben
// die PLÄNE (die entstehen davor) und alle Vergleiche das Rückfallgrab —
// beides grün, und trotzdem käme im Spiel nichts an.
{
  let raeume = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    let threw = '';
    let layout;
    try {
      layout = generateGridLayout(kit, seed, undefined, { strict: true });
    } catch (e) {
      threw = String(e);
    }
    check(threw === '', `Saat ${seed}: ${threw}`);
    if (!layout) continue;
    raeume += layout.rooms.length;
    check(
      layout.rooms.length === plan.rooms.length + plan.seals.length,
      `Saat ${seed}: ${layout.rooms.length} Zeilen im Layout, erwartet ${plan.rooms.length} Räume + ${plan.seals.length} Platten`
    );
    check(
      layout.rooms.filter((r) => r.room === stampDef.name).length ===
        plan.rooms.filter((r) => r.module === stampDef.name).length,
      `Saat ${seed}: die Zahl der Hallen im Layout weicht vom Plan ab`
    );
  }
  console.log(`  40 Saaten streng erzeugt: ${raeume} Layout-Zeilen, keine einzige Ausnahme`);
}

console.log(failures === 0 ? '\nOK — der Stempel hält seine Kanten' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
