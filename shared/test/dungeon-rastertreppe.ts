/**
 * G7 (Modul-Generierung 2.0) — Wächter über die Treppe: senkrechte
 * Kante, zwei Ebenen, gesperrte Gegenebene.
 *
 * ── Warum die Treppe einen eigenen Test bekommt ───────────────────────
 * Sie ist das einzige Modul des Kits, das eine EBENE wechselt, das
 * einzige mit `wallPartial`-Flanken und das einzige, das drei Zellen auf
 * `e` UND dieselben drei auf `e+1` belegt. Jede dieser drei Eigenschaften
 * fällt in keiner der bisherigen Zählungen auf:
 *  • Ein Kantenmodell mit n/o/s/w erklärt den Ebenenwechsel zu Nichts —
 *    die Treppenspitze hinge im Graphen an nichts, und eine
 *    BFS-Erreichbarkeit über ALLE Zellen gemeinsam sähe das nicht, weil
 *    eine gut vernetzte Ebene 0 die Zahl trägt. Deshalb wird hier je
 *    Ebene geprüft.
 *  • Bliebe die Gegenebene frei, wüchse ein Grundriss durch den
 *    Treppenlauf. Ein Loch im Boden wirft keine Ausnahme.
 *  • Gegen eine `wallPartial`-Flanke ist eine Platte NÖTIG (der Keil
 *    deckt die Kante nicht über die volle Ebenenhöhe), gegen eine volle
 *    Wand wäre sie eine der 531 aus dem G1-Befund. Die Tafel unterscheidet
 *    das, die Zählung „0 Platten in belegten Zellen" allein nicht.
 *
 * Der Steigungswächter (`shared/test/dungeon-raster.ts`) bleibt
 * ausdrücklich unangetastet: Er rechnet 30,3° aus den Connectors und ist
 * die Gegenprobe dazu, dass an der Geometrie der Treppe nichts verändert
 * wurde, während ihre LOGIK gebaut wird.
 *
 * Aufruf: `npx tsx shared/test/dungeon-rastertreppe.ts`
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
  ENTRANCE_CELL,
  YAWS,
  assertConnectorsOnEdges,
  cellKey,
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

/** Dieselbe Stichprobe wie G1/G4/G5/G6 — die Zahlen bleiben vergleichbar. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const HORIZONTAL: readonly Direction[] = DIRECTIONS.filter(isHorizontal);

/**
 * Das Ebenenmodul des Kits, aus der Erklärung gesucht statt beim Namen
 * genannt: mehrzellig auf MEHR ALS EINER Ebene. Ein Kit mit einer zweiten
 * Treppe bekäme sie sonst nie zu sehen.
 */
const stairsDef = kit.rooms.find((r) => {
  if (r.endCap || r.entrance) return false;
  const m = gridModuleFromRoomDef(r);
  return m.cells.length > 1 && m.levels > 1;
});
if (!stairsDef) {
  console.error('Das Kit hat kein Modul über zwei Ebenen — G7 hätte nichts zu prüfen.');
  process.exit(1);
}
const stairs = gridModuleFromRoomDef(stairsDef);

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

console.log('=== G7: die Treppe und die Ebenen ===\n');

// ─────────────────────────────────────────────────────────────────────
console.log(`1) '${stairsDef.name}' erklärt zwei Ebenen, zwei Ports und eine senkrechte Kante`);
{
  check(stairs.levels === 2, `${stairs.levels} Ebenen, erwartet 2`);
  check(stairs.cells.length === 6, `${stairs.cells.length} Zellen, erwartet 6`);
  check(stairs.ports.length === 2, `${stairs.ports.length} Ports, erwartet 2`);
  const portLevels = new Set(stairs.ports.map((p) => stairs.cells[p.cell]!.level));
  check(portLevels.size === 2, `beide Ports liegen auf Ebene ${[...portLevels].join('/')} — erwartet zwei verschiedene`);
  // Genau EIN senkrechter Durchgang: der Punkt, an dem der Lauf y = 3,5
  // überschreitet. Zwei wären zwei Löcher im Boden, keiner eine
  // Treppenspitze, die im Graphen an nichts hängt.
  let vertical = 0;
  let partial = 0;
  for (const c of stairs.cells) {
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d) && c.edges[d] === 'open') vertical++;
      if (isHorizontal(d) && !c.interior[d] && c.edges[d] === 'wallPartial') partial++;
    }
  }
  check(vertical === 2, `${vertical} offene senkrechte Kanten (2 Seiten einer Kante), erwartet 2`);
  const portEdges = stairs.ports.length;
  const outerEdges = stairs.cells.reduce(
    (n, c) => n + HORIZONTAL.filter((d) => !c.interior[d]).length,
    0
  );
  check(
    partial === outerEdges - portEdges,
    `${partial} Keilflanken, erwartet ${outerEdges - portEdges} (jede Aussenkante ausser den beiden Ports)`
  );
  console.log(
    `  ${stairs.cellsX}×${stairs.cellsZ}×${stairs.levels}, ${stairs.cells.length} Zellen, ` +
      `${stairs.ports.length} Ports auf 2 Ebenen, 1 senkrechte Kante, ${partial} Keilflanken`
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Rückrechnung: drei Zellen auf e, dieselben drei auf e+1');
{
  const anchors: GridCell[] = [
    { i: 0, j: 0, level: 0 },
    { i: 3, j: -2, level: 0 },
    { i: -4, j: 5, level: 1 },
    { i: 7, j: 7, level: -1 },
  ];
  for (const anchor of anchors) {
    for (const yaw of YAWS) {
      const cells = moduleWorldCells(anchor, yaw, stairs);
      check(cells.length === 6, `Anker ${cellKey(anchor)} @${yaw}°: ${cells.length} Zellen, erwartet 6`);
      const levels = [...new Set(cells.map((c) => c.level))].sort((a, b) => a - b);
      check(
        levels.length === 2 && levels[1]! - levels[0]! === 1,
        `Anker ${cellKey(anchor)} @${yaw}°: Ebenen ${levels.join('/')}, erwartet zwei benachbarte`
      );
      // Die Gegenebene ist keine andere Fläche, sondern DIESELBE: sonst
      // stünde der Luftraum über dem Lauf woanders als der Lauf.
      const unten = cells.filter((c) => c.level === levels[0]).map((c) => `${c.i}|${c.j}`).sort();
      const oben = cells.filter((c) => c.level === levels[1]).map((c) => `${c.i}|${c.j}`).sort();
      check(
        unten.length === 3 && oben.join(',') === unten.join(','),
        `Anker ${cellKey(anchor)} @${yaw}°: obere Ebene [${oben.join(' ')}] deckt die untere [${unten.join(' ')}] nicht`
      );
      const ports = moduleWorldPorts(anchor, yaw, stairs);
      check(ports.length === 2, `Anker ${cellKey(anchor)} @${yaw}°: ${ports.length} Ports`);
      check(
        new Set(ports.map((p) => p.cell.level)).size === 2,
        `Anker ${cellKey(anchor)} @${yaw}°: beide Ports auf derselben Ebene`
      );
      for (const p of ports) {
        const keys = new Set(cells.map(cellKey));
        check(keys.has(cellKey(p.cell)), `Port ${p.connector} @${yaw}° sitzt ausserhalb des Fussabdrucks`);
        check(!keys.has(cellKey(neighbourCell(p.cell, p.direction))), `Port ${p.connector} @${yaw}° zeigt in den eigenen Körper`);
      }
      let threw = '';
      try {
        assertConnectorsOnEdges(stairsDef, anchor, yaw, stairs);
      } catch (e) {
        threw = String(e);
      }
      check(threw === '', `Anker ${cellKey(anchor)} @${yaw}°: ${threw}`);
    }
  }
  console.log(`  ${anchors.length} Anker × 4 Gierungen: 3 + 3 Zellen deckungsgleich, 2 Ports auf 2 Ebenen`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Der Generator baut Treppen — und lässt sie sich abschalten');
{
  let seedsWithStairs = 0;
  let total = 0;
  for (const seed of SEEDS) {
    const n = planGridDungeon(kit, seed).rooms.filter((r) => r.module === stairsDef.name).length;
    total += n;
    if (n > 0) seedsWithStairs++;
  }
  check(seedsWithStairs >= 5, `Treppe nur in ${seedsWithStairs} von ${SEEDS.length} Saaten, verlangt sind ≥ 5`);
  let ohne = 0;
  for (const seed of SEEDS) {
    ohne += planGridDungeon(kit, seed, { stairFraction: 0 }).rooms.filter((r) => r.module === stairsDef.name).length;
  }
  check(ohne === 0, `stairFraction 0 baut trotzdem ${ohne} Treppen`);
  console.log(
    `  40 Saaten: ${total} Treppen in ${seedsWithStairs} Grundrissen (Vorgabe ${DEFAULT_GRID_TUNING.stairFraction}); mit 0 keine einzige`
  );
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Beide Ebenen belegt — die Gegenebene ist gesperrt, nicht leer');
{
  let treppen = 0;
  let ebenenPaare = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    plan.rooms.forEach((room, index) => {
      if (room.module !== stairsDef.name) return;
      treppen++;
      check(room.cells.length === 6, `Saat ${seed}: Treppe ${index} belegt ${room.cells.length} Zellen, erwartet 6`);
      const levels = [...new Set(room.cells.map((c) => c.level))].sort((a, b) => a - b);
      check(levels.length === 2, `Saat ${seed}: Treppe ${index} steht auf ${levels.length} Ebene(n)`);
      if (levels.length !== 2) return;
      ebenenPaare++;
      const unten = room.cells.filter((c) => c.level === levels[0]).map((c) => `${c.i}|${c.j}`).sort();
      const oben = room.cells.filter((c) => c.level === levels[1]).map((c) => `${c.i}|${c.j}`).sort();
      check(
        oben.join(',') === unten.join(','),
        `Saat ${seed}: Treppe ${index} deckt die Gegenebene nicht — unten [${unten.join(' ')}], oben [${oben.join(' ')}]`
      );
      // Und jede der sechs Zellen gehört im Plan auch wirklich dieser
      // Treppe: Eine „gesperrte" Zelle, die kein Raum führt, wäre ein Loch,
      // in das der nächste Ast hineinwächst.
      for (const c of room.cells) {
        const at = cellAt.get(cellKey(c));
        check(
          at !== undefined && at.room === index,
          `Saat ${seed}: Zelle ${cellKey(c)} der Treppe ${index} gehört im Plan zu Raum ${at?.room ?? 'keinem'}`
        );
      }
    });
  }
  check(treppen > 0, 'keine einzige Treppe über 40 Saaten — die Prüfung liefe ins Leere');
  console.log(`  ${treppen} Treppen, alle mit 3 + 3 deckungsgleichen Zellen auf zwei Ebenen (${ebenenPaare} Ebenenpaare)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Boden und Decke sind Kantenzustände — die senkrechte Kante gehört der Treppe');
{
  let senkrecht = 0;
  let gestapelt = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const states = statesOf(plan);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    for (const c of plan.cells) {
      const oben = cellAt.get(cellKey(neighbourCell(c.cell, 'up')));
      if (oben) gestapelt++;
      for (const d of DIRECTIONS.filter((x) => !isHorizontal(x))) {
        const nb = cellAt.get(cellKey(neighbourCell(c.cell, d)));
        const mine = states.get(cellKey(c.cell))![d];
        if (c.edges.includes(d)) {
          senkrecht++;
          check(mine === 'open', `Saat ${seed}: senkrechte Graphkante ${cellKey(c.cell)}#${d} ist '${mine}'`);
          check(
            nb !== undefined && nb.room === c.room,
            `Saat ${seed}: senkrechte Graphkante ${cellKey(c.cell)}#${d} verlässt ihren Raum`
          );
          check(
            plan.rooms[c.room]!.module === stairsDef.name,
            `Saat ${seed}: senkrechte Graphkante in '${plan.rooms[c.room]!.module}' statt in einer Treppe`
          );
          continue;
        }
        // Kein Durchgang: dann muss die Kante beidseitig zu sein. Ein
        // gestapeltes Paar mit offener Decke ohne Kante wäre ein Loch.
        check(mine !== 'open', `Saat ${seed}: ${cellKey(c.cell)}#${d} ist offen, aber keine Graphkante`);
      }
    }
  }
  check(senkrecht > 0, 'keine einzige senkrechte Graphkante — die Ebenen hängen nicht zusammen');
  console.log(`  40 Saaten: ${gestapelt} gestapelte Zellpaare, ${senkrecht / 2} senkrechte Durchgänge (alle in einer Treppe)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) BFS-Erreichbarkeit je Ebene GETRENNT');
// Der Grund für diesen Block steht im Dateikopf: Eine gemeinsame Zählung
// über alle Zellen wird von einer gut vernetzten Ebene 0 getragen. Hier
// wird jede Ebene für sich zerlegt — und jede waagerecht zusammenhängende
// Insel muss entweder den Eingang enthalten oder über eine senkrechte
// Kante betreten werden.
{
  const proEbene = new Map<number, { zellen: number; inseln: number }>();
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    // (a) global: 100 %
    const seen = new Set<string>([cellKey(ENTRANCE_CELL)]);
    const queue: GridCell[] = [ENTRANCE_CELL];
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

    // (b) je Ebene: alle Zellen der Ebene erreicht
    const levels = [...new Set(plan.cells.map((c) => c.cell.level))].sort((a, b) => a - b);
    for (const level of levels) {
      const hier = plan.cells.filter((c) => c.cell.level === level);
      const erreicht = hier.filter((c) => seen.has(cellKey(c.cell))).length;
      check(
        erreicht === hier.length,
        `Saat ${seed}, Ebene ${level}: ${hier.length - erreicht} von ${hier.length} Zellen unerreichbar`
      );
      // (c) waagerechte Inseln dieser Ebene
      const offen = new Set(hier.map((c) => cellKey(c.cell)));
      let inseln = 0;
      while (offen.size > 0) {
        inseln++;
        const startKey = [...offen][0]!;
        const insel: string[] = [startKey];
        offen.delete(startKey);
        const stack = [cellAt.get(startKey)!.cell];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          for (const d of cellAt.get(cellKey(cur))!.edges) {
            if (!isHorizontal(d)) continue;
            const nk = cellKey(neighbourCell(cur, d));
            if (!offen.has(nk)) continue;
            offen.delete(nk);
            insel.push(nk);
            stack.push(cellAt.get(nk)!.cell);
          }
        }
        const hatEingang = insel.includes(cellKey(ENTRANCE_CELL));
        const hatTreppe = insel.some((k) => cellAt.get(k)!.edges.some((d) => !isHorizontal(d)));
        check(
          hatEingang || hatTreppe,
          `Saat ${seed}, Ebene ${level}: eine Insel aus ${insel.length} Zellen ohne Eingang und ohne senkrechte Kante`
        );
      }
      const bisher = proEbene.get(level) ?? { zellen: 0, inseln: 0 };
      proEbene.set(level, { zellen: bisher.zellen + hier.length, inseln: bisher.inseln + inseln });
    }
  }
  const zeilen = [...proEbene].sort((a, b) => a[0] - b[0]).map(([e, v]) => `e${e}: ${v.zellen} Zellen / ${v.inseln} Inseln`);
  console.log(`  40 Saaten, je Ebene 100 % erreicht — ${zeilen.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) 0 Platten in belegten Zellen — ausser gegen eine Keilflanke');
{
  let platten = 0;
  let gegenTeilwand = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const states = statesOf(plan);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    for (const s of plan.seals) {
      platten++;
      const behind = cellAt.get(cellKey(neighbourCell(s.cell, s.direction)));
      if (!behind) continue; // Zeile 5 der Tafel: Fels, der Regelfall
      const facing = states.get(cellKey(behind.cell))![OPPOSITE_DIRECTION[s.direction]];
      check(
        facing === 'wallPartial',
        `Saat ${seed}: Platte auf ${cellKey(s.cell)}#${s.direction} liegt im Körper von '${behind.module}' (Kante '${facing}')`
      );
      if (facing === 'wallPartial') gegenTeilwand++;
    }
  }
  console.log(`  40 Saaten: ${platten} Platten, davon ${gegenTeilwand} gegen eine Keilflanke, 0 gegen einen anderen Körper`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n8) 0 Treppen mit unversorgtem Anschluss');
// „Unversorgt" heisst dasselbe wie in der Messzelle (`treppenProblem`):
// eine Öffnung ohne Partner und ohne Abschluss. Zusätzlich verlangt G7
// mehr, als die Metrik zählt: Beide Enden einer Treppe sollen BEGEHBAR
// sein. Eine Treppe, die man hinaufsteigt, um oben vor einer Platte zu
// stehen, ist im Grab ein Bauunfall — sie fällt in keiner Zählung auf.
{
  let anschluesse = 0;
  let durchgaenge = 0;
  for (const seed of SEEDS) {
    const plan = planGridDungeon(kit, seed);
    const states = statesOf(plan);
    const cellAt = new Map(plan.cells.map((c) => [cellKey(c.cell), c]));
    const sealed = new Set(plan.seals.map((s) => `${cellKey(s.cell)}#${s.direction}`));
    for (const room of plan.rooms) {
      if (room.module !== stairsDef.name) continue;
      const rd = roomByName.get(room.module)!;
      for (const port of moduleWorldPorts(room.cell, room.yaw, gridModuleFromRoomDef(rd))) {
        anschluesse++;
        const host = cellAt.get(cellKey(port.cell));
        check(host !== undefined, `Saat ${seed}: Treppenport auf ${cellKey(port.cell)} steht an keiner Planzelle`);
        if (!host) continue;
        const key = `${cellKey(port.cell)}#${port.direction}`;
        const nb = cellAt.get(cellKey(neighbourCell(port.cell, port.direction)));
        const facing = nb ? states.get(cellKey(nb.cell))![OPPOSITE_DIRECTION[port.direction]] : null;
        check(
          host.edges.includes(port.direction) || sealed.has(key) || facing === 'wall',
          `Saat ${seed}: Treppenanschluss ${key} ist offen, unversiegelt und ohne Wand gegenüber`
        );
        if (host.edges.includes(port.direction)) durchgaenge++;
      }
    }
  }
  check(
    anschluesse > 0 && durchgaenge === anschluesse,
    `${anschluesse - durchgaenge} von ${anschluesse} Treppenanschlüssen enden vor einer Wand statt in einem Raum`
  );
  console.log(`  ${anschluesse} Treppenanschlüsse, alle ${durchgaenge} als Durchgang versorgt`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n9) Streng erzeugt, deterministisch, Zellzahl gehalten');
{
  let zeilen = 0;
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
    zeilen += layout.rooms.length;
    check(
      layout.rooms.length === plan.rooms.length + plan.seals.length,
      `Saat ${seed}: ${layout.rooms.length} Layout-Zeilen, erwartet ${plan.rooms.length} Räume + ${plan.seals.length} Platten`
    );
    check(
      Math.abs(plan.cells.length - kit.maxRooms) <= 1,
      `Saat ${seed}: ${plan.cells.length} Zellen, erwartet ${kit.maxRooms} ± 1`
    );
    // Jede Treppe steht auf der Bodenoberkante ihrer Ebene — ein Modul
    // zwischen zwei Ebenen wäre eine Stufe, die nirgends ankommt.
    for (const p of layout.rooms) {
      check(
        Math.abs(p.pos.y / 3.5 - Math.round(p.pos.y / 3.5)) < 1e-9,
        `Saat ${seed}: '${p.room}' steht auf y = ${p.pos.y}, keiner Ebenenhöhe`
      );
    }
  }
  for (const seed of [1, 7, 2123721695]) {
    const a = JSON.stringify(generateGridLayout(kit, seed));
    const b = JSON.stringify(generateGridLayout(kit, seed));
    check(a === b, `Saat ${seed}: zwei Läufe liefern verschiedene Layouts`);
  }
  console.log(`  40 Saaten streng erzeugt: ${zeilen} Layout-Zeilen, keine Ausnahme; 3 Saaten zweimal byte-gleich`);
}

console.log(failures === 0 ? '\nOK — die Treppe hält ihre Ebenen' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
