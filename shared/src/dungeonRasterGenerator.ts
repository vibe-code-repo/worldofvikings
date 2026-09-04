/**
 * Rastergenerator des Modul-Kits — Meilenstein G3 der Konzeptnotiz
 * „Modul-Generierung 2.0-Logik“: die Abbildung Raster ↔ Welt.
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * G2 hat jedes Modul dazu gebracht, sich selbst zu beschreiben — in
 * MODUL-lokalen Zellen. Hier bekommt diese Beschreibung einen Ort in der
 * Welt: Welche Weltzelle belegt ein platziertes Modul, wo liegt die Mitte
 * einer Zellkante, und welche `PlacedRoom`-Pose gehört zu einer Zelle und
 * einer Gierung. Der eigentliche Generator (Zellmenge, Spannbaum,
 * Modulwahl, Versiegelung) entsteht darauf ab G4.
 *
 * ── Die eine Regel dieser Datei ──────────────────────────────────────
 * **Ganzzahlige Zellschlüssel sind die einzige Wahrheit; Weltkoordinaten
 * sind Ausgabe.** Jede Rückrichtung läuft über `Math.round`, nie über
 * einen Gleichheitsvergleich. Grund ist eine Messung, keine Vorsicht: Die
 * Zellmitten der heutigen Grundrisse driften bis 2,6 · 10⁻⁵ m vom
 * Sollraster (G1). Zwei Schlüssel für dieselbe Zelle wären zwei Räume in
 * einer.
 *
 * ── Warum z verschoben ist ───────────────────────────────────────────
 * Der Eingang des Kits steht auf `pos = (0,0,−1)`: Sein Eingangsconnector
 * sitzt auf der Südkante der Zelle und muss auf dem Ursprung landen, denn
 * dort hängt das ganze Grab (`placeStartRoom` im 1.0-Pfad). Zellmitten
 * liegen deshalb auf `(2i, 3,5e, 2j−1)` — der Schlüssel für z ist
 * `round((z+1)/2)`, nicht `round(z/2)`. Der Unterschied ist eine halbe
 * Zelle und fiele nirgends auf, weil alle Räume gleich falsch lägen.
 *
 * ── Warum die Ankerzelle die lokale Zelle (0,0,0) ist ────────────────
 * Der Pivot eines Moduls ist seine Bodenmitte — bei gerader Zellzahl
 * (Halle 2 × 2) liegt er ZWISCHEN vier Zellen und ist damit keine Zelle.
 * Als Anker taugt deshalb nur eine echte Zelle: die kanonisch erste
 * (`module.cells[0]`, lokal (0,0,0)). Die Pose folgt daraus, statt
 * umgekehrt. Nebenwirkung mit Ansage: Bei einem mehrzelligen Modul
 * verschiebt eine andere Gierung den Fussabdruck gegenüber demselben
 * Anker — wer eine Zellmenge sucht, fragt {@link moduleWorldCells} und
 * rät nicht.
 *
 * ── Sprache der Bezeichner ───────────────────────────────────────────
 * Neuer Code trägt englische Namen (Kit-Regel seit 27.08.); die deutschen
 * Namen der Nachbardateien bleiben, wo sie stehen.
 */
import {
  DIRECTION_VECTOR,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  directionFromVector,
  isHorizontal,
  type Direction,
  type GridModule,
} from './dungeonRasterModul.js';
import { quatMulVec3 } from './worldgen/Math3d.js';
import type { PlacedRoom, RoomDef } from './dungeons.js';
import type { Quaternion, Vector3 } from './types.js';

/** Kantenlänge einer Rasterzelle in Metern. Dieselbe Zahl wie im Modulformat. */
export const GRID_CELL_M = MODULE_CELL_M;

/** Höhe einer Ebene in Metern. Im Modulformat IST eine Ebene eine Zellhöhe. */
export const GRID_LEVEL_M = MODULE_LEVEL_M;

/**
 * Versatz der z-Achse in Metern: Zellmitten liegen auf `2j − 1`.
 *
 * Er ist keine Stilfrage, sondern folgt aus der Lage des Eingangs (s.
 * Dateikopf). Als benannte Konstante, damit die beiden Rechenrichtungen
 * ihn nicht getrennt tippen und auseinanderlaufen.
 */
export const GRID_Z_OFFSET_M = -1;

/**
 * Toleranz der Rückrechnung in Metern (Konzept S6).
 *
 * Die MODUL-lokale Seite bindet `gridModuleFromRoomDef` bereits auf
 * dieselbe Zahl. Neu ist hier die Verwandlung: Gierung, Ankerzelle und
 * die float32-Arithmetik von `quatMulVec3`. Gemessen bleibt die Drift
 * darunter um Grössenordnungen — die Grenze ist der Alarm, nicht das Mass.
 */
export const GRID_TOLERANCE_M = 1e-4;

/** Fehler des Rasterpfads. Eigene Klasse, damit ein Aufrufer ihn von einem Kit-Fehler trennen kann. */
export class DungeonRasterError extends Error {}

/**
 * Eine Rasterzelle. `i` läuft mit +x (Ost), `j` mit +z (Nord), `level`
 * mit +y. Nur ganze Zahlen — alles andere ist ein Programmfehler.
 */
export interface GridCell {
  readonly i: number;
  readonly j: number;
  readonly level: number;
}

/**
 * Die Zelle des Eingangsraums. Sie liegt auf `pos (0,0,−1)`; ihr
 * Eingangsconnector landet damit auf dem Ursprung des Grabs.
 */
export const ENTRANCE_CELL: GridCell = { i: 0, j: 0, level: 0 };

/** Gierung in ganzen Grad. Vier Werte, keine Spiegelung — mehr braucht das Kit nicht. */
export type Yaw = 0 | 90 | 180 | 270;

/** Die vier Gierungen in fester Reihenfolge (Determinismus-Falle: nie über ein `Set` iterieren). */
export const YAWS: readonly Yaw[] = [0, 90, 180, 270];

/**
 * Gierung als Quaternion.
 *
 * Getippt statt aus Sinus und Kosinus gerechnet: Die vier Werte sind
 * exakt darstellbar, und sie stehen buchstäblich so im Kit
 * (`KEINE_DREHUNG`, `VIERTEL_DREHUNG`, `HALBE_DREHUNG`,
 * `VIERTEL_DREHUNG_ZURUECK` in `eigeneDungeons.ts`). Ein `Math.sin` würde
 * dieselben Zahlen um ein paar Bits verfehlen und jede spätere
 * Byte-Gleichheit zur Glückssache machen.
 */
export function yawQuaternion(yaw: Yaw): Quaternion {
  switch (yaw) {
    case 0:
      return { x: 0, y: 0, z: 0, w: 1 };
    case 90:
      return { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    case 180:
      return { x: 0, y: 1, z: 0, w: 0 };
    case 270:
      return { x: 0, y: -Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  }
}

/**
 * Richtung unter einer Gierung.
 *
 * Abgeleitet statt getippt: Eine Tafel `{0: {n:'n',…}, 90: {n:'e',…}}`
 * wäre eine zweite Wahrheit über dieselbe Drehung, und ein Dreher darin
 * fiele erst als Wand vor einer Öffnung auf. Hier dreht dieselbe
 * Funktion, die auch die Connectors dreht.
 */
export function rotateDirection(d: Direction, yaw: Yaw): Direction {
  const turned = directionFromVector(quatMulVec3(yawQuaternion(yaw), DIRECTION_VECTOR[d]));
  if (turned === null) {
    // Unerreichbar, solange `yawQuaternion` nur um y dreht — die Meldung
    // ist für den Tag, an dem jemand eine fünfte Gierung erfindet.
    throw new DungeonRasterError(`Gierung ${yaw}° dreht Richtung '${d}' auf keine Rasterachse.`);
  }
  return turned;
}

/** Ganzzahliger Schlüssel einer Zelle. Kanonisch (Ebene, j, i) — dieselbe Ordnung wie {@link compareCells}. */
export function cellKey(cell: GridCell): string {
  return `${cell.level}|${cell.j}|${cell.i}`;
}

/**
 * Kanonische Ordnung: Ebene, dann j, dann i.
 *
 * Sie ist Teil des Determinismusversprechens, nicht Geschmack. Jede Liste
 * von Zellen und Kanten wird so sortiert, damit die Ausgabe nicht an der
 * Einfügereihenfolge einer `Map` hängt.
 */
export function compareCells(a: GridCell, b: GridCell): number {
  return a.level - b.level || a.j - b.j || a.i - b.i;
}

/** Die Nachbarzelle über eine der sechs Kanten. */
export function neighbourCell(cell: GridCell, d: Direction): GridCell {
  const u = DIRECTION_VECTOR[d];
  return { i: cell.i + u.x, j: cell.j + u.z, level: cell.level + u.y };
}

/** Zellmitte in Weltkoordinaten: `(2i, 3,5e, 2j − 1)`. y ist die Bodenoberkante der Ebene. */
export function cellToWorld(cell: GridCell): Vector3 {
  return {
    x: cell.i * GRID_CELL_M,
    y: cell.level * GRID_LEVEL_M,
    z: cell.j * GRID_CELL_M + GRID_Z_OFFSET_M,
  };
}

/**
 * Weltpunkt → Zelle. Der Rückweg, und der Grund, warum diese Datei
 * existiert: Er RUNDET. Ein Punkt bis zu einer knappen halben Zelle
 * neben der Mitte gehört noch zu ihr.
 */
export function worldToCell(pos: Vector3): GridCell {
  return {
    i: Math.round(pos.x / GRID_CELL_M),
    j: Math.round((pos.z - GRID_Z_OFFSET_M) / GRID_CELL_M),
    level: Math.round(pos.y / GRID_LEVEL_M),
  };
}

/**
 * Mitte einer Zellkante in Weltkoordinaten — der Mittelwert der beiden
 * Zellmitten. Genau dort sitzen alle `cellEdge`-Connectors, und genau
 * dort liegt eine Versiegelungsplatte.
 */
export function edgeCenterWorld(cell: GridCell, d: Direction): Vector3 {
  const c = cellToWorld(cell);
  const u = DIRECTION_VECTOR[d];
  const half = isHorizontal(d) ? GRID_CELL_M / 2 : GRID_LEVEL_M / 2;
  return { x: c.x + u.x * half, y: c.y + u.y * half, z: c.z + u.z * half };
}

/** Eine Öffnung eines platzierten Moduls, zurückgerechnet auf Zelle und Kante. */
export interface GridPort {
  /** Index in `RoomDef.connections` — die Rückverbindung zur Kit-Definition. */
  readonly connector: number;
  /** Die Weltzelle, in der die Öffnung sitzt. */
  readonly cell: GridCell;
  /** Die Kante dieser Zelle, in Weltrichtung. */
  readonly direction: Direction;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
  /** Kantenmitte in Weltkoordinaten — identisch mit `edgeCenterWorld(cell, direction)`. */
  readonly edgeCenter: Vector3;
}

/**
 * Pose eines Moduls, dessen lokale Zelle (0,0,0) auf `cell` liegt.
 *
 * Zwei Zeilen, aber die Reihenfolge ist der ganze Punkt: Erst steht fest,
 * WELCHE Zelle das Modul trägt, dann folgt daraus die Weltpose — nicht
 * umgekehrt. Der 1.0-Generator geht den anderen Weg und hat deshalb kein
 * Konzept „Zelle belegt“.
 */
function modulePose(cell: GridCell, yaw: Yaw, module: GridModule): { pos: Vector3; rot: Quaternion } {
  if (module.endCap || module.cells.length === 0) {
    throw new DungeonRasterError(
      `Modul '${module.name}' hat keinen Fussabdruck — ein Verschluss wird auf eine KANTE gelegt, nicht in eine Zelle.`
    );
  }
  const rot = yawQuaternion(yaw);
  const anchorLocal = module.cells[0]!.localCenter;
  const turned = quatMulVec3(rot, anchorLocal);
  const world = cellToWorld(cell);
  return {
    pos: { x: world.x - turned.x, y: world.y - turned.y, z: world.z - turned.z },
    rot,
  };
}

/** Lokaler Punkt → Weltpunkt unter einer Modulpose (`localToGlobal`, nur der Ortsanteil). */
function toWorld(local: Vector3, pos: Vector3, rot: Quaternion): Vector3 {
  const turned = quatMulVec3(rot, local);
  return { x: pos.x + turned.x, y: pos.y + turned.y, z: pos.z + turned.z };
}

/**
 * Saat für die Deko-Varianten, aus der Position abgeleitet.
 *
 * Bewusst dieselbe Rechnung wie im 1.0-Pfad (`roomSeed`,
 * `dungeonGenerator.ts`, nach DungeonGenerator.cpp:595) — zwei Wege dürfen
 * denselben Raum am selben Ort nicht verschieden dekorieren. Kopiert statt
 * importiert, weil `dungeonGenerator.ts` in diesem Meilenstein nicht
 * angefasst wird; der Ausgleich ist diese Notiz.
 */
function roomSeed(pos: Vector3): number {
  return (
    (Math.imul(Math.trunc(pos.x), 4271) +
      Math.imul(Math.trunc(pos.y), 9187) +
      Math.imul(Math.trunc(pos.z), 2134)) |
    0
  );
}

/**
 * Platziert ein Modul so, dass seine lokale Zelle (0,0,0) auf `cell`
 * liegt, und liefert die fertige `PlacedRoom`-Zeile des Layouts.
 *
 * `placeOrder` bleibt vorgabegemäss 0: Die Reihenfolge ist BFS-Tiefe ab
 * dem Eingang und steht erst in S9 fest, wenn alle Zellen stehen. Wer sie
 * kennt, reicht sie hier durch.
 */
export function placeModule(
  cell: GridCell,
  yaw: Yaw,
  module: GridModule,
  placeOrder = 0
): PlacedRoom {
  const { pos, rot } = modulePose(cell, yaw, module);
  return { room: module.name, pos, rot, placeOrder, seed: roomSeed(pos) };
}

/**
 * Die Weltzellen, die ein so platziertes Modul belegt — kanonisch
 * sortiert.
 *
 * Abgeleitet über die Zellmitten und `worldToCell`, nicht über eine
 * Drehtafel auf den Indizes: Damit ist die Zellmenge dieselbe Aussage wie
 * die Geometrie, und ein Fehler in der Gierung fällt hier auf statt in
 * der Belegungsprüfung des Generators.
 */
export function moduleWorldCells(cell: GridCell, yaw: Yaw, module: GridModule): GridCell[] {
  const { pos, rot } = modulePose(cell, yaw, module);
  const cells = module.cells.map((c) => worldToCell(toWorld(c.localCenter, pos, rot)));
  return cells.sort(compareCells);
}

/**
 * Die Öffnungen eines so platzierten Moduls, zurückgerechnet auf
 * Weltzelle und Weltkante.
 *
 * Auch hier gilt: Die Kantenmitte kommt aus der ZELLE (`edgeCenterWorld`),
 * nicht aus dem Connector. So ist sie ganzzahlig verankert, und die
 * Abweichung des echten Connectors davon ist eine messbare Grösse — der
 * Zeuge aus S6, s. {@link assertConnectorsOnEdges}.
 */
export function moduleWorldPorts(cell: GridCell, yaw: Yaw, module: GridModule): GridPort[] {
  const { pos, rot } = modulePose(cell, yaw, module);
  return module.ports.map((port) => {
    const home = module.cells[port.cell]!;
    const worldCell = worldToCell(toWorld(home.localCenter, pos, rot));
    const direction = rotateDirection(port.direction, yaw);
    return {
      connector: port.connector,
      cell: worldCell,
      direction,
      entrance: port.entrance,
      allowDoor: port.allowDoor,
      edgeCenter: edgeCenterWorld(worldCell, direction),
    };
  });
}

/**
 * Der Zeuge aus S6: Nach jeder Platzierung muss `localToGlobal` jedes
 * Connectors auf der erwarteten Kantenmitte landen.
 *
 * Warum das nicht doppelt gemoppelt ist, obwohl G2 die Modul-lokale Lage
 * schon auf 1e-4 bindet: G2 prüft die ERKLÄRUNG gegen das Kit, hier wird
 * die VERWANDLUNG geprüft — Ankerzelle, Gierung, float32. Eine um 90°
 * verdrehte Gierungstafel käme durch G2 anstandslos durch und stünde erst
 * im Grab als Wand vor einer Öffnung.
 *
 * Wirft statt zu melden: Eine Verletzung ist ein Programmfehler, kein
 * Datenfall (Konzept S10).
 */
export function assertConnectorsOnEdges(
  def: RoomDef,
  cell: GridCell,
  yaw: Yaw,
  module: GridModule
): void {
  const { pos, rot } = modulePose(cell, yaw, module);
  const ports = moduleWorldPorts(cell, yaw, module);
  if (ports.length !== def.connections.length) {
    throw new DungeonRasterError(
      `Raum '${def.name}' hat ${def.connections.length} Connectors, das Modul '${module.name}' erklärt ${ports.length} Ports.`
    );
  }
  for (const port of ports) {
    const c = def.connections[port.connector];
    if (!c) {
      throw new DungeonRasterError(
        `Modul '${module.name}': Port nennt Connector ${port.connector}, den '${def.name}' nicht hat.`
      );
    }
    const world = toWorld(c.localPos, pos, rot);
    const drift = Math.hypot(
      world.x - port.edgeCenter.x,
      world.y - port.edgeCenter.y,
      world.z - port.edgeCenter.z
    );
    if (!(drift < GRID_TOLERANCE_M)) {
      throw new DungeonRasterError(
        `Raum '${def.name}' in Zelle ${cellKey(cell)} bei ${yaw}°: Connector ${port.connector} landet auf ` +
          `(${world.x}, ${world.y}, ${world.z}), erwartet die Kantenmitte ` +
          `(${port.edgeCenter.x}, ${port.edgeCenter.y}, ${port.edgeCenter.z}) — Drift ${drift.toExponential(3)} m.`
      );
    }
  }
}
