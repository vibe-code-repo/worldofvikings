/**
 * G3 (Modul-Generierung 2.0) — Wächter über die Abbildung Raster ↔ Welt.
 *
 * ── Warum dieser Test ────────────────────────────────────────────────
 * Der Rastergenerator rechnet in ganzen Zellschlüsseln; Weltkoordinaten
 * sind nur Ausgabe. Genau dazwischen sitzen die beiden Fallen, die die
 * Konzeptnotiz als „Determinismus-Fallen“ führt:
 *
 *  • **Die z-Achse ist verschoben.** Der Eingang steht auf `pos (0,0,−1)`,
 *    Zellmitten liegen also auf `(2i, 3,5e, 2j−1)` — der Schlüssel ist
 *    `round((z+1)/2)`, nicht `round(z/2)`. Entwurf 2 der Vorarbeit hatte
 *    hier `round(z/2)` stehen; der Fehler ist eine halbe Zelle und fällt
 *    in keiner Zählung auf, weil alle Räume gleich falsch liegen.
 *  • **Schlüssel entstehen durch Runden, nie durch Gleichheit.** Gemessen
 *    wurde eine Drift der Zellmitten bis 2,6 · 10⁻⁵ m (G1). Ein
 *    Gleichheitsvergleich auf Weltkoordinaten liefert deshalb irgendwann
 *    zwei Schlüssel für dieselbe Zelle — und damit zwei Räume in einer.
 *
 * Die dritte Prüfung ist der Zeuge aus S6: Nach jeder Platzierung muss
 * `localToGlobal` JEDES Connectors auf der erwarteten Kantenmitte landen
 * (1e-4). G2 bindet die MODUL-lokale Seite bereits auf dieselbe Toleranz;
 * neu in G3 ist die Verwandlung — Gierung, Ankerzelle, und die
 * float32-Arithmetik von `quatMulVec3`. Ohne diesen Zeugen fiele eine
 * um 90° verdrehte Gierungstafel erst als Wand vor einer Öffnung auf.
 *
 * Der Generator selbst entsteht erst in G4; hier wird nur gerechnet.
 */
import {
  DIRECTIONS,
  DIRECTION_VECTOR,
  OPPOSITE_DIRECTION,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
  type GridModule,
} from '../src/dungeonRasterModul.js';
import {
  ENTRANCE_CELL,
  GRID_CELL_M,
  GRID_LEVEL_M,
  GRID_TOLERANCE_M,
  YAWS,
  assertConnectorsOnEdges,
  cellKey,
  cellToWorld,
  compareCells,
  edgeCenterWorld,
  moduleWorldCells,
  moduleWorldPorts,
  neighbourCell,
  placeModule,
  rotateDirection,
  worldToCell,
  yawQuaternion,
  type GridCell,
  type Yaw,
} from '../src/dungeonRasterGenerator.js';
import { DUNGEONS_BY_NAME } from '../src/dungeons.js';
import type { RoomDef } from '../src/dungeons.js';
import type { Quaternion, Vector3 } from '../src/types.js';
import { quatMul, quatMulVec3 } from '../src/worldgen/Math3d.js';

let failures = 0;
const check = (condition: boolean, text: string): void => {
  if (!condition) {
    failures++;
    console.error(`  FEHLER: ${text}`);
  }
};

/** Abstand zweier Punkte — der einzige Vergleich, den dieser Test auf Weltmassen führt. */
function dist(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const kit = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!kit) {
  console.error('FEHLER: Kit DG_StoneVault nicht gefunden.');
  process.exit(1);
}
const roomByName = new Map<string, RoomDef>(kit.rooms.map((r) => [r.name, r]));
function defOf(name: string): RoomDef {
  const room = roomByName.get(name);
  if (!room) throw new Error(`Raum '${name}' fehlt im Kit`);
  return room;
}
function moduleOf(name: string): GridModule {
  return gridModuleFromRoomDef(defOf(name));
}

/** Die Zellmodule des Kits — der Verschluss hat keinen Fussabdruck und wird hier nicht platziert. */
const CELL_MODULES = [
  'StoneVaultEntry',
  'StoneVaultCell',
  'StoneVaultCorridor',
  'StoneVaultCorner',
  'StoneVaultJunction',
  'StoneVaultHall',
  'StoneVaultHallLarge',
  'StoneVaultHallLong',
  'StoneVaultStairs',
] as const;

/**
 * Deterministischer Zufall für die Driftprobe. Ein fester Strom statt
 * `Math.random`, damit ein roter Lauf sich wiederholen lässt.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n1) Zellmitte, Schlüssel und die Rundreise');
// ─────────────────────────────────────────────────────────────────────
{
  // Die Formel selbst, an drei getippten Stellen — sonst prüft die
  // Rundreise nur, dass Hin- und Rückweg dieselbe (falsche) Formel teilen.
  check(
    dist(cellToWorld(ENTRANCE_CELL), { x: 0, y: 0, z: -1 }) < 1e-9,
    `Eingangszelle liegt auf ${JSON.stringify(cellToWorld(ENTRANCE_CELL))}, erwartet (0,0,−1)`
  );
  check(
    dist(cellToWorld({ i: 3, j: -2, level: 4 }), { x: 6, y: 14, z: -5 }) < 1e-9,
    `Zelle (3,−2,4) liegt auf ${JSON.stringify(cellToWorld({ i: 3, j: -2, level: 4 }))}, erwartet (6,14,−5)`
  );
  check(
    dist(cellToWorld({ i: -1, j: 1, level: 1 }), { x: -2, y: GRID_LEVEL_M, z: 1 }) < 1e-9,
    'Zelle (−1,1,1) verfehlt (−2, 3.5, 1)'
  );

  // Die Falle aus Entwurf 2: `round(z/2)` liefert für z = −1 die Zelle 0
  // und für z = 1 die Zelle 1 — beides sähe richtig aus. Erst z = −3
  // trennt die Formeln: `round((z+1)/2)` = −1, `round(z/2)` = −2 (bzw. −1,
  // je nach Rundungsrichtung). Deshalb steht die Probe hier ausdrücklich.
  check(worldToCell({ x: 0, y: 0, z: -3 }).j === -1, 'z = −3 muss Zellreihe −1 sein');
  check(worldToCell({ x: 0, y: 0, z: 1 }).j === 1, 'z = 1 muss Zellreihe 1 sein');

  // Rundreise über den ganzen Block: 41 × 41 Zellen auf 6 Ebenen.
  let block = 0;
  const seen = new Set<string>();
  for (let level = 0; level < 6; level++) {
    for (let j = -20; j <= 20; j++) {
      for (let i = -20; i <= 20; i++) {
        const cell: GridCell = { i, j, level };
        const back = worldToCell(cellToWorld(cell));
        if (back.i !== i || back.j !== j || back.level !== level) {
          check(false, `Rundreise verfehlt: ${cellKey(cell)} → ${cellKey(back)}`);
        }
        // Der Schlüssel ist die einzige Wahrheit — er muss eineindeutig sein.
        const k = cellKey(cell);
        if (seen.has(k)) check(false, `Schlüssel ${k} doppelt vergeben`);
        seen.add(k);
        block++;
      }
    }
  }
  console.log(`  ${block} Zellen über 6 Ebenen, Rundreise und Schlüssel eineindeutig`);

  // Rundreise MIT Drift: 10 000 Zellen, deren Weltpunkt um bis zu einer
  // knappen halben Zelle verschoben ist. Bestünde der Schlüssel aus einem
  // Gleichheitsvergleich, wäre hier alles rot.
  const rnd = makeRandom(0x5f3759df);
  let drifted = 0;
  let maxDrift = 0;
  for (let n = 0; n < 10000; n++) {
    const cell: GridCell = {
      i: Math.floor(rnd() * 81) - 40,
      j: Math.floor(rnd() * 81) - 40,
      level: n % 6,
    };
    // Bis ±0,9 m in x/z (Zelle 2 m) und ±1,5 m in y (Ebene 3,5 m): weit
    // mehr als die gemessenen 2,6 · 10⁻⁵ m, aber noch eindeutig.
    const world = cellToWorld(cell);
    const noisy: Vector3 = {
      x: world.x + (rnd() * 2 - 1) * 0.9,
      y: world.y + (rnd() * 2 - 1) * 1.5,
      z: world.z + (rnd() * 2 - 1) * 0.9,
    };
    const back = worldToCell(noisy);
    if (back.i !== cell.i || back.j !== cell.j || back.level !== cell.level) {
      check(false, `Drift-Rundreise verfehlt: ${cellKey(cell)} → ${cellKey(back)}`);
    }
    maxDrift = Math.max(maxDrift, dist(world, noisy));
    drifted++;
  }
  console.log(`  ${drifted} verrauschte Zellen (Drift bis ${maxDrift.toFixed(3)} m) treffen ihren Schlüssel`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n2) Kantenmitten und Nachbarzellen');
// ─────────────────────────────────────────────────────────────────────
{
  let edges = 0;
  for (let level = 0; level < 3; level++) {
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const cell: GridCell = { i, j, level };
        for (const d of DIRECTIONS) {
          const nb = neighbourCell(cell, d);
          // Kantenmitte = Mittelwert zweier Zellmitten (Konzept, Algorithmus).
          const mid: Vector3 = {
            x: (cellToWorld(cell).x + cellToWorld(nb).x) / 2,
            y: (cellToWorld(cell).y + cellToWorld(nb).y) / 2,
            z: (cellToWorld(cell).z + cellToWorld(nb).z) / 2,
          };
          const got = edgeCenterWorld(cell, d);
          if (dist(got, mid) > 1e-9) {
            check(false, `Kantenmitte ${cellKey(cell)}/${d}: ${JSON.stringify(got)} statt ${JSON.stringify(mid)}`);
          }
          // Dieselbe Kante von der anderen Seite — sonst hätte jede Kante
          // zwei Orte und die Versiegelung zwei Wahrheiten (Ursache 5).
          const mirror = edgeCenterWorld(nb, OPPOSITE_DIRECTION[d]);
          if (dist(got, mirror) > 1e-9) {
            check(false, `Kante ${cellKey(cell)}/${d} liegt von der Gegenseite woanders`);
          }
          if (cellKey(neighbourCell(nb, OPPOSITE_DIRECTION[d])) !== cellKey(cell)) {
            check(false, `Nachbar von Nachbar ist nicht die Ausgangszelle (${cellKey(cell)}, ${d})`);
          }
          edges++;
        }
      }
    }
  }
  // Der halbe Abstand ist die Kantenlänge/Ebenenhöhe — getippt, damit ein
  // vertauschtes 2 ↔ 3,5 hier auffällt und nicht erst im Grab.
  check(
    Math.abs(edgeCenterWorld(ENTRANCE_CELL, 'n').z - (cellToWorld(ENTRANCE_CELL).z + GRID_CELL_M / 2)) < 1e-9,
    'waagerechte Kantenmitte liegt nicht eine halbe Zelle vor der Zellmitte'
  );
  check(
    Math.abs(edgeCenterWorld(ENTRANCE_CELL, 'up').y - (cellToWorld(ENTRANCE_CELL).y + GRID_LEVEL_M / 2)) < 1e-9,
    'senkrechte Kantenmitte liegt nicht eine halbe Ebene über der Zellmitte'
  );
  console.log(`  ${edges} Kanten: Mitte = Mittelwert, beidseitig derselbe Ort`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n3) Die vier Gierungen');
// ─────────────────────────────────────────────────────────────────────
{
  check(YAWS.length === 4, `${YAWS.length} Gierungen, erwartet 4`);
  // 180° muss dieselbe Drehung sein wie `HALBE_DREHUNG` des Kits, sonst
  // steht der Eingang verkehrt herum im Grab.
  const half = yawQuaternion(180);
  check(
    dist(quatMulVec3(half, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: -1 }) < 1e-6,
    '180° dreht +z nicht auf −z'
  );
  check(
    dist(quatMulVec3(yawQuaternion(90), { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 }) < 1e-6,
    '90° dreht Nord nicht auf Ost'
  );
  check(
    dist(quatMulVec3(yawQuaternion(0), { x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 }) < 1e-9,
    '0° ist keine Ruhelage'
  );

  for (const yaw of YAWS) {
    for (const d of DIRECTIONS) {
      const r = rotateDirection(d, yaw);
      // Senkrechte Kanten überleben jede Gierung unverändert — sonst
      // vertauschte eine Drehung Boden und Decke.
      if (!isHorizontal(d)) {
        check(r === d, `Gierung ${yaw}° verdreht ${d} zu ${r}`);
        continue;
      }
      check(isHorizontal(r), `Gierung ${yaw}° macht aus ${d} die senkrechte Kante ${r}`);
      // Die Drehung darf die Kante nicht auf sich selbst falten: vier
      // verschiedene Richtungen bleiben vier verschiedene.
      const back = rotateDirection(r, (360 - yaw) % 360 as Yaw);
      check(back === d, `Gierung ${yaw}° ist nicht umkehrbar: ${d} → ${r} → ${back}`);
    }
  }
  console.log('  4 Gierungen, waagerecht umkehrbar, senkrecht unberührt');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n4) Die Eingangszelle');
// ─────────────────────────────────────────────────────────────────────
{
  const entry = moduleOf('StoneVaultEntry');
  const placed = placeModule(ENTRANCE_CELL, 180, entry);

  check(placed.room === 'StoneVaultEntry', `Raumname '${placed.room}'`);
  check(
    dist(placed.pos, { x: 0, y: 0, z: -1 }) < 1e-9,
    `Eingang steht auf ${JSON.stringify(placed.pos)}, erwartet (0,0,−1)`
  );
  // Drehungsgleichheit, nicht Komponentengleichheit: q und −q sind
  // dieselbe Drehung, und der 1.0-Pfad liefert die andere Vorzeichenwahl.
  check(
    dist(quatMulVec3(placed.rot, { x: 0, y: 0, z: 1 }), { x: 0, y: 0, z: -1 }) < 1e-6 &&
      dist(quatMulVec3(placed.rot, { x: 1, y: 0, z: 0 }), { x: -1, y: 0, z: 0 }) < 1e-6,
    `Eingang ist nicht um 180° gedreht (rot = ${JSON.stringify(placed.rot)})`
  );

  // Der Eingangsconnector des Kits landet auf dem Ursprung — das ist die
  // Verankerung des ganzen Grabs (`placeStartRoom` im 1.0-Pfad).
  const def = defOf('StoneVaultEntry');
  const entrance = def.connections.find((c) => c.entrance);
  check(entrance !== undefined, 'StoneVaultEntry hat keinen Eingangsconnector');
  if (entrance) {
    const world = {
      x: placed.pos.x + quatMulVec3(placed.rot, entrance.localPos).x,
      y: placed.pos.y + quatMulVec3(placed.rot, entrance.localPos).y,
      z: placed.pos.z + quatMulVec3(placed.rot, entrance.localPos).z,
    };
    check(
      dist(world, { x: 0, y: 0, z: 0 }) < GRID_TOLERANCE_M,
      `Eingangsconnector landet auf ${JSON.stringify(world)}, erwartet den Ursprung`
    );
  }

  // Er zeigt nach Norden — der Eingangsport gehört zur Kante zwischen
  // (0,0,0) und (0,1,0), nicht nach Süden ins Gelände.
  const ports = moduleWorldPorts(ENTRANCE_CELL, 180, entry);
  const anchorPort = ports.find((p) => p.entrance);
  check(anchorPort !== undefined, 'kein Eingangsport in der Rückrechnung');
  if (anchorPort) {
    check(anchorPort.direction === 'n', `Eingangsport zeigt nach ${anchorPort.direction}, erwartet n`);
    check(
      dist(anchorPort.edgeCenter, { x: 0, y: 0, z: 0 }) < 1e-9,
      `Eingangskante liegt auf ${JSON.stringify(anchorPort.edgeCenter)}`
    );
  }
  check(ports.length === 4, `${ports.length} Ports am Eingang, erwartet 4`);
  console.log('  Eingang: pos (0,0,−1), 180°, Connector auf dem Ursprung, Port nach Norden');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n5) Rückrechnung jedes Connectors auf die Kantenmitte');
// ─────────────────────────────────────────────────────────────────────
{
  const anchors: readonly GridCell[] = [
    { i: 0, j: 0, level: 0 },
    { i: 5, j: -7, level: 2 },
    { i: -13, j: 11, level: 5 },
    { i: -1, j: -1, level: 1 },
  ];
  let checked = 0;
  let worst = -1;
  let worstWhere = '';
  for (const name of CELL_MODULES) {
    const def = defOf(name);
    const m = moduleOf(name);
    for (const yaw of YAWS) {
      for (const anchor of anchors) {
        const placed = placeModule(anchor, yaw, m);
        const ports = moduleWorldPorts(anchor, yaw, m);
        check(
          ports.length === def.connections.length,
          `${name}: ${ports.length} Ports, aber ${def.connections.length} Connectors`
        );
        for (const port of ports) {
          const c = def.connections[port.connector]!;
          // Der Zeuge aus S6, gerechnet wie im Client: erst drehen, dann
          // verschieben (`localToGlobal`).
          const rotated = quatMulVec3(placed.rot, c.localPos);
          const world: Vector3 = {
            x: placed.pos.x + rotated.x,
            y: placed.pos.y + rotated.y,
            z: placed.pos.z + rotated.z,
          };
          const drift = dist(world, port.edgeCenter);
          if (drift > worst) {
            worst = drift;
            worstWhere = `${name} @${yaw}° ${cellKey(anchor)} Connector ${port.connector}`;
          }
          if (drift >= GRID_TOLERANCE_M) {
            check(false, `${name} @${yaw}°: Connector ${port.connector} driftet ${drift.toExponential(2)} m`);
          }

          // Die Blickrichtung des Connectors muss die Portrichtung sein —
          // sonst zeigt ein Durchgang in die Nachbarzelle einer anderen Kante.
          const globalRot: Quaternion = quatMul(c.localRot, placed.rot);
          const look = quatMulVec3(globalRot, { x: 0, y: 0, z: 1 });
          const want = DIRECTION_VECTOR[port.direction];
          if (dist(look, want) > 1e-5) {
            check(false, `${name} @${yaw}°: Connector ${port.connector} blickt nicht nach ${port.direction}`);
          }

          // Und die Kantenmitte muss die Kante zwischen Port-Zelle und
          // deren Nachbarn sein — die Brücke zurück ins Ganzzahlige.
          const expected = edgeCenterWorld(port.cell, port.direction);
          if (dist(expected, port.edgeCenter) > 1e-9) {
            check(false, `${name} @${yaw}°: Port ${port.connector} nennt eine fremde Kantenmitte`);
          }
          checked++;
        }
      }
    }
  }
  console.log(
    `  ${checked} Connectors über ${CELL_MODULES.length} Module × 4 Gierungen × ${anchors.length} Ankerzellen`
  );
  // 0 ist hier das erwartete Ergebnis, nicht ein nicht gemessener Wert:
  // Zellmitten und Connectorlagen sind ganze Zahlen bzw. Vielfache von
  // 3,5, und die float32-Rundung von `quatMulVec3` fällt bei diesen
  // Beträgen exakt auf. Die Grenze 1e-4 ist der Alarm für den Tag, an dem
  // sich das Kit unter der Erklärung wegbewegt.
  console.log(`  grösste Drift ${worst.toExponential(2)} m (Grenze ${GRID_TOLERANCE_M}) bei ${worstWhere}`);
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n6) Belegte Zellen');
// ─────────────────────────────────────────────────────────────────────
{
  const anchor: GridCell = { i: 4, j: -2, level: 1 };
  for (const name of CELL_MODULES) {
    const m = moduleOf(name);
    for (const yaw of YAWS) {
      const cells = moduleWorldCells(anchor, yaw, m);
      check(cells.length === m.cells.length, `${name} @${yaw}°: ${cells.length} statt ${m.cells.length} Zellen`);
      const keys = new Set(cells.map(cellKey));
      check(keys.size === cells.length, `${name} @${yaw}°: Zelle doppelt belegt`);
      // Kanonisch sortiert (Ebene, j, i) — die Reihenfolge ist Teil des
      // Determinismusversprechens, nicht Geschmack.
      for (let n = 1; n < cells.length; n++) {
        if (compareCells(cells[n - 1]!, cells[n]!) >= 0) {
          check(false, `${name} @${yaw}°: Zellen nicht kanonisch sortiert`);
          break;
        }
      }
      // Die Ankerzelle gehört immer dazu — sie IST die lokale Zelle (0,0,0).
      check(keys.has(cellKey(anchor)), `${name} @${yaw}°: Ankerzelle nicht belegt`);
      // Jede belegte Zelle liegt auf der Ebene ihrer lokalen Ebene: eine
      // Gierung dreht um y und darf niemals die Ebene wechseln.
      const levels = new Set(cells.map((c) => c.level));
      check(
        levels.size === m.levels,
        `${name} @${yaw}°: ${levels.size} Ebenen belegt, das Modul erklärt ${m.levels}`
      );
    }
  }
  // Die Treppe ist der einzige Fall mit zwei Ebenen — und der einzige, in
  // dem eine Gierung den Fussabdruck wirklich dreht (1 × 3 statt 1 × 1).
  const stairs = moduleWorldCells(ENTRANCE_CELL, 0, moduleOf('StoneVaultStairs'));
  const stairs90 = moduleWorldCells(ENTRANCE_CELL, 90, moduleOf('StoneVaultStairs'));
  check(stairs.length === 6, `Treppe belegt ${stairs.length} Zellen, erwartet 6`);
  check(
    new Set(stairs.map((c) => `${c.i}|${c.j}`)).size === 3,
    'Treppe belegt nicht drei Grundflächen auf zwei Ebenen'
  );
  check(
    new Set(stairs.map((c) => c.i)).size === 1 && new Set(stairs90.map((c) => c.j)).size === 1,
    'Gierung 90° dreht den Treppenlauf nicht von der z- auf die x-Achse'
  );
  const hall = moduleWorldCells(ENTRANCE_CELL, 0, moduleOf('StoneVaultHall'));
  check(hall.length === 4, `Halle belegt ${hall.length} Zellen, erwartet 4`);
  /*
    Der lange Saal (2 × 4) ist der erste Stempel mit ungleichen Achsen —
    unter 90° muss aus 2 breit / 4 tief genau 4 breit / 2 tief werden.
    Ohne diese Probe könnte eine Gierung den Fussabdruck still quer zum
    eigenen Grundriss legen, und auffallen würde es erst im Spiel, wo
    zwei Räume ineinander stehen.
  */
  const lang0 = moduleWorldCells(ENTRANCE_CELL, 0, moduleOf('StoneVaultHallLong'));
  const lang90 = moduleWorldCells(ENTRANCE_CELL, 90, moduleOf('StoneVaultHallLong'));
  const spanne = (cs: readonly { i: number; j: number }[]) => ({
    x: new Set(cs.map((c) => c.i)).size,
    z: new Set(cs.map((c) => c.j)).size,
  });
  const s0 = spanne(lang0);
  const s90 = spanne(lang90);
  check(lang0.length === 8, `Langer Saal belegt ${lang0.length} Zellen, erwartet 8`);
  check(s0.x === 2 && s0.z === 4, `Langer Saal 0°: ${s0.x}×${s0.z}, erwartet 2×4`);
  check(s90.x === 4 && s90.z === 2, `Langer Saal 90°: ${s90.x}×${s90.z}, erwartet 4×2`);
  const gross = moduleWorldCells(ENTRANCE_CELL, 0, moduleOf('StoneVaultHallLarge'));
  check(gross.length === 9, `Grosser Saal belegt ${gross.length} Zellen, erwartet 9`);
  console.log('  Fussabdrücke: keine Doppelbelegung, kanonisch sortiert, Ebenenzahl gehalten');
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n7) Der Wächter greift');
// ─────────────────────────────────────────────────────────────────────
{
  const def = defOf('StoneVaultCell');
  const m = gridModuleFromRoomDef(def);
  // Eine Kit-Geometrie, die sich unter der Erklärung wegbewegt hat: das
  // Modul kennt die alte Lage, der Raum die neue.
  const moved: RoomDef = {
    ...def,
    connections: def.connections.map((c, i) =>
      i === 0 ? { ...c, localPos: { ...c.localPos, x: c.localPos.x + 0.5 } } : c
    ),
  };
  let threw = false;
  try {
    assertConnectorsOnEdges(moved, ENTRANCE_CELL, 0, m);
  } catch {
    threw = true;
  }
  check(threw, 'verschobener Connector wird nicht bemerkt');

  // Und der unveränderte Raum darf nicht werfen — sonst wäre der Wächter
  // nur ein Alarm ohne Aussage.
  let ok = true;
  try {
    for (const name of CELL_MODULES) {
      for (const yaw of YAWS) assertConnectorsOnEdges(defOf(name), { i: 2, j: 3, level: 4 }, yaw, moduleOf(name));
    }
  } catch (e) {
    ok = false;
    check(false, `Wächter wirft am unveränderten Kit: ${(e as Error).message}`);
  }
  if (ok) console.log('  verschobener Connector wirft, unverändertes Kit nicht');
}

console.log(failures === 0 ? '\nOK — Raster und Welt decken sich' : `\n${failures} FEHLER`);
process.exit(failures > 0 ? 1 : 0);
