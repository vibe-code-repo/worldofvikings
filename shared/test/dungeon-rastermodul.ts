/**
 * G2 (Modul-Generierung 2.0) — Wächter über die Selbstbeschreibung der
 * StoneVault-Module.
 *
 * ── Warum dieser Test und nicht der Generator ────────────────────────
 * `gridEdges` ist eine ERKLÄRUNG über das GLB, keine Messung an ihm
 * (Risikoabschnitt der Konzeptnotiz). Wer `make-stonevault.py` ändert und
 * `eigeneDungeons.ts` vergisst, bekommt ab da eine Kantentafel, die etwas
 * behauptet, was im Modell nicht steht — und der Fehler fällt erst im
 * fertigen Grab auf, als Wand vor einer Öffnung. Dagegen steht hier die
 * einzige Grösse, die BEIDE Seiten kennen: die Connectors. Sie stehen in
 * derselben Datei wie die Erklärung und werden aus dem Modell exportiert.
 *
 * Deshalb ist die Kernprüfung eine Äquivalenz in beide Richtungen:
 * Jeder Connector liegt auf einer als `open` erklärten Aussenkante, und
 * jede als `open` erklärte Aussenkante trägt genau einen Connector. Eine
 * vergessene Wandkante ist damit kein stiller Vorgabewert mehr, sondern
 * ein roter Test — `gridModuleFromRoomDef` verlangt für jede waagerechte
 * Aussenkante eine Aussage.
 *
 * Der Generator wird hier NICHT angefasst; `tools/messe-stonevault-logik.ts`
 * bleibt gegen den heutigen Stand rot. G2 erklärt nur.
 */
import {
  DIRECTIONS,
  DUNGEONS_BY_NAME,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
  type EdgeState,
  type GridModule,
  type ModuleCell,
  type Quaternion,
  type RoomConnectionDef,
  type RoomDef,
  type Vector3,
} from '../src/index.js';
import { quatMulVec3 } from '../src/worldgen/Math3d.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Toleranz für Lagevergleiche. Grosszügiger als der Exportfehler, enger als ein Millimeter. */
const TOL = 1e-6;

const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
/** Die vier Gierungen des Kits — mehr gibt es im Raster nicht. */
const YAWS: readonly Quaternion[] = [
  IDENTITY,
  { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
  { x: 0, y: 1, z: 0, w: 0 },
  { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
];

const kit = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!kit) {
  console.error('FEHLER: Kit DG_StoneVault nicht gefunden.');
  process.exit(1);
}

const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));
function moduleOf(name: string): GridModule {
  const room = roomByName.get(name);
  if (!room) throw new Error(`Raum '${name}' fehlt im Kit`);
  return gridModuleFromRoomDef(room);
}

function cellAt(m: GridModule, ix: number, iz: number, level: number): ModuleCell {
  const cell = m.cells.find((c) => c.ix === ix && c.iz === iz && c.level === level);
  if (!cell) throw new Error(`${m.name}: Zelle (${ix},${iz},${level}) fehlt`);
  return cell;
}

function edgeAt(m: GridModule, ix: number, iz: number, level: number, d: Direction): EdgeState {
  return cellAt(m, ix, iz, level).edges[d];
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n1) Fussabdruck, Ebenen, Anker');
// ─────────────────────────────────────────────────────────────────────
{
  const expected: Record<string, readonly [number, number, number]> = {
    // Innenmass 1,4 zählt wie das volle Rastermass 2 — die eingebaute
    // Wand liegt INNERHALB der Zelle, sie verkleinert den Fussabdruck nicht.
    StoneVaultEntry: [1, 1, 1],
    StoneVaultCell: [1, 1, 1],
    StoneVaultCorridor: [1, 1, 1],
    StoneVaultCorner: [1, 1, 1],
    StoneVaultJunction: [1, 1, 1],
    StoneVaultHall: [2, 2, 1],
    // Drei Zellen Lauf auf ZWEI Ebenen: die obere Ebene ist Luftraum,
    // gehört aber zum Modul (Konzept S3) — sonst wächst ein zweiter Ast
    // in die Treppenspitze hinein.
    StoneVaultStairs: [1, 3, 2],
  };
  for (const [name, [x, z, level]] of Object.entries(expected)) {
    const m = moduleOf(name);
    check(m.cellsX === x, `${name}: cellsX ${m.cellsX}, erwartet ${x}`);
    check(m.cellsZ === z, `${name}: cellsZ ${m.cellsZ}, erwartet ${z}`);
    check(m.levels === level, `${name}: levels ${m.levels}, erwartet ${level}`);
    check(
      m.cells.length === x * z * level,
      `${name}: ${m.cells.length} Zellen, erwartet ${x * z * level}`
    );
    check(!m.endCap, `${name}: darf kein Verschlussmodul sein`);
  }
  console.log(`  ${Object.keys(expected).length} Zellmodule mit erwartetem Fussabdruck`);

  // Die Wand belegt KEINE Zelle: 0,3 m quer in der Kantenebene. Wer sie
  // als Zelle führte, hielte jede versiegelte Kante für belegt.
  const wall = moduleOf('StoneVaultWall');
  check(wall.endCap, 'StoneVaultWall: muss Verschlussmodul sein');
  check(wall.cells.length === 0, `StoneVaultWall: ${wall.cells.length} Zellen, erwartet 0`);
  check(wall.ports.length === 0, `StoneVaultWall: ${wall.ports.length} Ports, erwartet 0`);
  check(wall.anchor === null, 'StoneVaultWall: kein Anker');

  // Der Anker ist der Eingangsconnector — an ihm hängt G3 den Grundriss
  // auf (Raum 0 landet auf pos (0,0,−1), Rotation 180°).
  const entry = moduleOf('StoneVaultEntry');
  check(entry.anchor !== null, 'StoneVaultEntry: Anker fehlt');
  check(
    entry.anchor?.direction === 's',
    `StoneVaultEntry: Anker zeigt nach ${entry.anchor?.direction}, erwartet s`
  );
  for (const name of ['StoneVaultCell', 'StoneVaultCorridor', 'StoneVaultHall', 'StoneVaultStairs']) {
    check(moduleOf(name).anchor === null, `${name}: darf keinen Anker haben`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Connector ⇔ offene Aussenkante (beide Richtungen)');
// ─────────────────────────────────────────────────────────────────────
{
  let ports = 0;
  let openEdges = 0;
  for (const room of kit.rooms) {
    const m = gridModuleFromRoomDef(room);
    if (m.endCap) continue;

    // Hinrichtung: jeder Connector sitzt auf genau einer Zellkante, und
    // die ist als `open` erklärt.
    check(
      m.ports.length === room.connections.length,
      `${m.name}: ${m.ports.length} Ports aus ${room.connections.length} Connectors`
    );
    for (const p of m.ports) {
      ports++;
      const c = room.connections[p.connector]!;
      const cell = m.cells[p.cell]!;
      check(
        cell.edges[p.direction] === 'open',
        `${m.name}: Connector ${p.connector} liegt auf Kante ${p.direction} der Zelle ` +
          `(${cell.ix},${cell.iz},${cell.level}), die als '${cell.edges[p.direction]}' erklärt ist`
      );
      check(
        !cell.interior[p.direction],
        `${m.name}: Connector ${p.connector} liegt auf einer INNENkante — dort kann nie ein Nachbar andocken`
      );
      // Der geometrische Zeuge: die zurückgerechnete Kantenmitte muss die
      // Connectorlage treffen. Sonst hat sich das Modell unter der
      // Erklärung wegbewegt.
      const dist = Math.hypot(
        p.localEdgeCenter.x - c.localPos.x,
        p.localEdgeCenter.y - c.localPos.y,
        p.localEdgeCenter.z - c.localPos.z
      );
      check(
        dist < TOL,
        `${m.name}: Connector ${p.connector} liegt ${dist.toExponential(2)} m neben der Kantenmitte`
      );
    }

    // Rückrichtung: keine offene Aussenkante ohne Connector. Genau das
    // wäre die „Öffnung ins Leere", die der Generator nie bemerkt.
    for (const cell of m.cells) {
      for (const d of DIRECTIONS) {
        if (!isHorizontal(d) || cell.interior[d]) continue;
        if (cell.edges[d] !== 'open') continue;
        openEdges++;
        const hits = m.ports.filter((p) => m.cells[p.cell] === cell && p.direction === d);
        check(
          hits.length === 1,
          `${m.name}: Zelle (${cell.ix},${cell.iz},${cell.level}) ist nach ${d} offen erklärt, ` +
            `trägt aber ${hits.length} Connectors`
        );
      }
    }
  }
  check(ports === openEdges, `${ports} Ports gegen ${openEdges} offene Aussenkanten`);
  console.log(`  ${ports} Connectors, ${openEdges} offene Aussenkanten — deckungsgleich`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Zellmitten auf (2i, 3,5e, 2j−1)');
// ─────────────────────────────────────────────────────────────────────
{
  // Der Eingang ist der Nullpunkt des Rasters: `placeStartRoom` setzt ihn
  // auf pos (0,0,−1) mit 180°, damit sein Eingangsconnector auf (0,0,0)
  // landet. Deshalb 2j−1 und nicht 2j — der Fehler aus Entwurf 2.
  const entry = moduleOf('StoneVaultEntry');
  const center = entry.cells[0]!.localCenter;
  const world = { x: 0 + center.x, y: 0 + center.y, z: -1 + center.z };
  check(
    Math.abs(world.x - 2 * 0) < TOL &&
      Math.abs(world.y - MODULE_LEVEL_M * 0) < TOL &&
      Math.abs(world.z - (2 * 0 - 1)) < TOL,
    `Eingangszelle landet auf (${world.x}, ${world.y}, ${world.z}), erwartet (0, 0, −1)`
  );

  // Und allgemein: hängt man ein Modul mit EINER Zelle ins Raster, müssen
  // ALLE seine Zellen im Raster liegen — für jede der vier Gierungen. Ein
  // Modul mit gerader Zellzahl (die Halle) sitzt dabei mit seinem Pivot
  // zwischen den Zellen; genau dort bricht eine naive Rundung.
  let checked = 0;
  for (const room of kit.rooms) {
    const m = gridModuleFromRoomDef(room);
    if (m.endCap) continue;
    for (const yaw of YAWS) {
      for (const [i, j, level] of [
        [0, 0, 0],
        [3, -2, 1],
        [-7, 11, 5],
      ] as const) {
        // Ankerzelle 0 soll auf (2i, 3,5e, 2j−1) liegen; daraus folgt pos.
        const first = m.cells[0]!;
        const rotated0 = quatMulVec3(yaw, first.localCenter);
        const pos = {
          x: 2 * i - rotated0.x,
          y: MODULE_LEVEL_M * level - rotated0.y,
          z: 2 * j - 1 - rotated0.z,
        };
        for (const cell of m.cells) {
          const g = quatMulVec3(yaw, cell.localCenter);
          const wx = pos.x + g.x;
          const wy = pos.y + g.y;
          const wz = pos.z + g.z;
          const di = Math.abs(wx - Math.round(wx / MODULE_CELL_M) * MODULE_CELL_M);
          const de = Math.abs(wy - Math.round(wy / MODULE_LEVEL_M) * MODULE_LEVEL_M);
          const dj = Math.abs(wz - (Math.round((wz + 1) / MODULE_CELL_M) * MODULE_CELL_M - 1));
          checked++;
          check(
            di < 1e-4 && de < 1e-4 && dj < 1e-4,
            `${m.name}: Zelle (${cell.ix},${cell.iz},${cell.level}) landet auf ` +
              `(${wx.toFixed(4)}, ${wy.toFixed(4)}, ${wz.toFixed(4)}) — Abweichung ` +
              `(${di.toExponential(1)}, ${de.toExponential(1)}, ${dj.toExponential(1)})`
          );
        }
      }
    }
  }
  console.log(`  ${checked} Zellmitten über 4 Gierungen und 3 Ankerzellen im Raster`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Eingebaute Wände: Korridor, Ecke, Abzweig');
// ─────────────────────────────────────────────────────────────────────
{
  // Diese drei tragen ihre Wände über die VOLLE Ebenenhöhe
  // (−0,25 … 3,75, make-stonevault.py:56-59). Genau darauf beruht Zeile 3
  // der Versiegelungstafel: gegen `wall` wird KEINE Platte gesetzt — die
  // 531 überflüssigen Platten des Befunds.
  const fullWalls: Record<string, readonly Direction[]> = {
    StoneVaultCorridor: ['e', 'w'],
    // Ost, nicht West: G11 hat die Erklärung beider Module in x
    // gespiegelt, weil Blender-Ost −x ist und sich die doppelte
    // x-Negation (Skript + Babylon `__root__`) aufhebt. Gemessen am GLB
    // von `tools/stonevault-kantensonde.ts`.
    StoneVaultCorner: ['s', 'e'],
    StoneVaultJunction: ['e'],
  };
  for (const [name, walled] of Object.entries(fullWalls)) {
    const m = moduleOf(name);
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d)) continue;
      const want: EdgeState = walled.includes(d) ? 'wall' : 'open';
      check(
        edgeAt(m, 0, 0, 0, d) === want,
        `${name}: Kante ${d} ist '${edgeAt(m, 0, 0, 0, d)}', erwartet '${want}'`
      );
    }
  }
  console.log('  Korridor e/w, Ecke s/e, Abzweig e tragen volle Wände');

  // Die offenen Füller haben KEINE eingebaute Wand — vier freie Kanten.
  for (const name of ['StoneVaultEntry', 'StoneVaultCell']) {
    const m = moduleOf(name);
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d)) continue;
      check(edgeAt(m, 0, 0, 0, d) === 'open', `${name}: Kante ${d} ist nicht offen`);
    }
  }
  // Die Halle ebenso, auf allen acht Aussenkanten.
  const hall = moduleOf('StoneVaultHall');
  let hallEdges = 0;
  for (const cell of hall.cells) {
    for (const d of DIRECTIONS) {
      if (!isHorizontal(d) || cell.interior[d]) continue;
      hallEdges++;
      check(
        cell.edges[d] === 'open',
        `StoneVaultHall: Aussenkante ${d} an (${cell.ix},${cell.iz}) ist '${cell.edges[d]}'`
      );
    }
  }
  check(hallEdges === 8, `StoneVaultHall: ${hallEdges} Aussenkanten, erwartet 8`);
  console.log('  Zelle, Eingang und Halle ohne eingebaute Wand');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Die Treppe: zwei Ebenen, Keilflanken, senkrechte Kante');
// ─────────────────────────────────────────────────────────────────────
{
  const t = moduleOf('StoneVaultStairs');
  check(t.levels === 2 && t.cells.length === 6, `Treppe: ${t.cells.length} Zellen auf ${t.levels} Ebenen`);
  for (const level of [0, 1]) {
    const count = t.cells.filter((c) => c.level === level).length;
    check(count === 3, `Treppe: Ebene ${level} hat ${count} Zellen, erwartet 3`);
  }

  // Die Flanken sind Keile, die mit dem Lauf steigen (:483-491) — sie
  // decken die Kante je Ebene nur zum Teil. Deshalb `wallPartial` und
  // nicht `wall`: Zeile 4 der Tafel setzt dort weiter eine Platte, und
  // genau das hält die 414 Platten gegen die Treppe in der Klasse „nötig".
  let flanks = 0;
  for (const cell of t.cells) {
    for (const d of ['e', 'w'] as const) {
      flanks++;
      check(
        cell.edges[d] === 'wallPartial',
        `Treppe: Flanke ${d} an (${cell.ix},${cell.iz},${cell.level}) ist '${cell.edges[d]}', erwartet wallPartial`
      );
    }
  }
  check(flanks === 12, `Treppe: ${flanks} Flankenkanten, erwartet 12`);

  // Genau zwei Ports: unten Süd auf Ebene 0, oben Nord auf Ebene 1.
  check(t.ports.length === 2, `Treppe: ${t.ports.length} Ports, erwartet 2`);
  const bottom = t.ports.find((p) => p.direction === 's');
  const top = t.ports.find((p) => p.direction === 'n');
  check(bottom !== undefined && t.cells[bottom.cell]!.level === 0 && t.cells[bottom.cell]!.iz === 0,
    'Treppe: unterer Port sitzt nicht auf der Südzelle der Ebene 0');
  check(top !== undefined && t.cells[top.cell]!.level === 1 && t.cells[top.cell]!.iz === 2,
    'Treppe: oberer Port sitzt nicht auf der Nordzelle der Ebene 1');

  // Die senkrechte Kante: genau EINE Oberkante und EINE Unterkante sind
  // offen, und beide sind zwei Seiten derselben Innenkante. Ohne sie
  // hinge die Treppenspitze im Graphen an nichts — der Fund, der laut
  // Konzept in keiner Zählung auffällt, sondern erst in der Sackgasse.
  const openUp = t.cells.filter((c) => c.edges.up === 'open');
  const openDown = t.cells.filter((c) => c.edges.down === 'open');
  check(openUp.length === 1, `Treppe: ${openUp.length} offene Oberkanten, erwartet 1`);
  check(openDown.length === 1, `Treppe: ${openDown.length} offene Unterkanten, erwartet 1`);
  if (openUp.length === 1 && openDown.length === 1) {
    const upCell = openUp[0]!;
    const downCell = openDown[0]!;
    check(
      upCell.ix === downCell.ix && upCell.iz === downCell.iz && upCell.level + 1 === downCell.level,
      `Treppe: offene Ober-/Unterkante liegen nicht übereinander ` +
        `((${upCell.ix},${upCell.iz},${upCell.level}) / (${downCell.ix},${downCell.iz},${downCell.level}))`
    );
    check(
      upCell.level === 0 && upCell.iz === 2,
      `Treppe: der Ebenenwechsel sitzt auf (${upCell.ix},${upCell.iz},${upCell.level}), erwartet (0,2,0)`
    );
    check(upCell.interior.up && downCell.interior.down, 'Treppe: der Ebenenwechsel ist keine Innenkante');
  }
  console.log('  Treppe: 6 Zellen, 12 Keilflanken, 2 Ports, 1 senkrechte Kante');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Boden und Decke sind Wand — ausser bei der Treppe');
// ─────────────────────────────────────────────────────────────────────
{
  // Vorgabe aus dem Konzept (S0). Sie ist der Grund, warum ein Grundriss
  // nicht durch den Boden wächst: Ein Ebenenwechsel muss ERKLÄRT werden.
  let vertical = 0;
  let open = 0;
  for (const room of kit.rooms) {
    const m = gridModuleFromRoomDef(room);
    for (const cell of m.cells) {
      for (const d of ['up', 'down'] as const) {
        vertical++;
        if (cell.edges[d] === 'open') {
          open++;
          check(
            m.name === 'StoneVaultStairs',
            `${m.name}: Zelle (${cell.ix},${cell.iz},${cell.level}) ist nach ${d} offen — nur die Treppe darf das`
          );
        } else {
          check(
            cell.edges[d] === 'wall',
            `${m.name}: Zelle (${cell.ix},${cell.iz},${cell.level}) hat ${d} = '${cell.edges[d]}', erwartet wall`
          );
        }
      }
    }
  }
  check(open === 2, `${open} offene senkrechte Kanten im Kit, erwartet 2`);
  console.log(`  ${vertical} senkrechte Kanten, davon ${open} offen (beide an der Treppe)`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Vollständigkeit und Widerspruch schlagen fehl');
// ─────────────────────────────────────────────────────────────────────
{
  // Die Erklärung ist nur so viel wert, wie sie erzwungen wird. Diese
  // drei Fälle sind der Grund, warum `gridModuleFromRoomDef` wirft statt
  // still ein `wall` einzusetzen: Ein vergessener Eintrag sähe sonst
  // genauso aus wie eine bewusste Wand.
  const v = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
  const conn = (localPos: Vector3, localRot: Quaternion): RoomConnectionDef => ({
    type: 'cellEdge',
    entrance: false,
    allowDoor: true,
    doorOnlyIfOtherAlsoAllowsDoor: false,
    localPos,
    localRot,
  });
  const roomDef = (
    connections: readonly RoomConnectionDef[],
    gridEdges?: RoomDef['gridEdges']
  ): RoomDef => ({
    name: 'TestModul',
    hash: 0,
    divider: false,
    endCap: false,
    endCapPrio: 0,
    entrance: false,
    faceCenter: false,
    minPlaceOrder: 0,
    perimeter: false,
    size: v(2, MODULE_LEVEL_M, 2),
    theme: 1,
    weight: 1,
    pos: v(0, 0, 0),
    rot: IDENTITY,
    connections,
    ...(gridEdges ? { gridEdges } : {}),
  });
  const NORTH = conn(v(0, 0, 1), IDENTITY);
  const expectThrow = (room: RoomDef, what: string): void => {
    try {
      gridModuleFromRoomDef(room);
      check(false, `${what}: hätte werfen müssen`);
    } catch {
      /* erwartet */
    }
  };

  // (a) Drei Aussenkanten ohne Connector und ohne Erklärung.
  expectThrow(roomDef([NORTH]), 'unerklärte Aussenkante');

  // (b) Widerspruch: eine EINZELZEILE behauptet eine Wand genau dort, wo
  //     ein Connector sitzt.
  expectThrow(
    roomDef([NORTH], [
      { cell: { ix: 0, iz: 0, level: 0 }, edges: ['n'], state: 'wall' },
      { edges: ['e', 's', 'w'], state: 'wall' },
    ]),
    'Wand über einem Connector'
  );

  // (b2) Die Fläche darf denselben Namen tragen, ohne den Ausgang
  //      zuzumauern — sonst müsste die Treppe ihre zwölf Flanken einzeln
  //      aufzählen, nur weil zwei Kanten desselben Namens Ausgänge sind.
  try {
    const m = gridModuleFromRoomDef(roomDef([NORTH], [{ edges: ['n', 'e', 's', 'w'], state: 'wall' }]));
    check(m.cells[0]!.edges.n === 'open', 'Aussenhaut-Regel mauert den Ausgang zu');
    check(m.cells[0]!.edges.e === 'wall', 'Aussenhaut-Regel greift nicht');
  } catch (e) {
    check(false, `Aussenhaut-Regel über einem Ausgang wirft: ${(e as Error).message}`);
  }

  // (c) Vollständig und widerspruchsfrei — muss durchgehen.
  const good = roomDef([NORTH], [{ edges: ['e', 's', 'w'], state: 'wall' }]);
  try {
    const m = gridModuleFromRoomDef(good);
    check(m.cells[0]!.edges.n === 'open', 'Testmodul: Nordkante nicht offen');
    check(m.cells[0]!.edges.s === 'wall', 'Testmodul: Südkante nicht wall');
  } catch (e) {
    check(false, `vollständiges Testmodul wirft trotzdem: ${(e as Error).message}`);
  }

  // (d) Einseitige Innenkante: oben offen, die Gegenseite bleibt Wand.
  //     Ein solcher Ebenenwechsel wäre eine Einbahnstrasse durch Stein.
  const twoLevel: RoomDef = {
    ...roomDef([NORTH, conn(v(0, MODULE_LEVEL_M, 1), IDENTITY)], [
      { edges: ['e', 's', 'w'], state: 'wall' },
      { cell: { ix: 0, iz: 0, level: 0 }, edges: ['up'], state: 'open' },
    ]),
    size: v(2, 2 * MODULE_LEVEL_M, 2),
  };
  expectThrow(twoLevel, 'einseitige senkrechte Innenkante');
  console.log('  fünf Wächterfälle greifen');
}

console.log(failures === 0 ? '\nOK — alle Module erklären sich vollständig' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
