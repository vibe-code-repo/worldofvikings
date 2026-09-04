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
import { DEFAULT_GENERATOR_SETTINGS } from './dungeonGenerator.js';
import type { DungeonGeneratorSettings } from './dungeonGenerator.js';
import {
  DIRECTIONS,
  DIRECTION_VECTOR,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  OPPOSITE_DIRECTION,
  directionFromVector,
  gridModuleFromRoomDef,
  isHorizontal,
  type Direction,
  type EdgeState,
  type GridModule,
} from './dungeonRasterModul.js';
import { hashPos, mische } from './dungeon2/hashing.js';
import { XorShiftRandom } from './worldgen/Random.js';
import { quatMul, quatMulVec3 } from './worldgen/Math3d.js';
import { MAX_DUNGEON_ROOMS } from './dungeons.js';
import type {
  DungeonDef,
  DungeonLayout,
  PlacedDoor,
  PlacedRoom,
  RoomDef,
} from './dungeons.js';
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

// ═════════════════════════════════════════════════════════════════════
// G4 — der Kern: Zellmenge, Spannbaum, Modulwahl, Versiegelung
//
// Ab hier wird ERZEUGT. Alles darüber ist Abbildung und Rückrechnung und
// bleibt frei von Zufall; alles darunter zieht aus einem Saatstrom.
//
// ── Die Reihenfolge ist der ganze Unterschied ────────────────────────
// Der 1.0-Generator wählt erst ein Modul und erfährt danach, was daneben
// liegt (`getRandomRoom` vor `testCollision`). Hier steht zuerst der
// GRAPH — welche Zellen es gibt und welche davon verbunden sind — und
// erst danach wird das Modul gesucht, das genau dieses Öffnungsmuster
// hat. „Öffnung ins Leere“ ist damit kein Prüfergebnis mehr, sondern ein
// Zustand, den die Datenstruktur nicht ausdrücken kann.
//
// ── Was G4 noch NICHT kann ───────────────────────────────────────────
// Nur Einzelzellen, eine Ebene, keine Schleifen, keine Türen. Halle
// (2 × 2) und Treppe (3 Zellen auf zwei Ebenen) bleiben liegen, bis das
// Kantenmodell sie in G6/G7 mit Stempeln trägt; Schleifen und Torbögen
// sind G5. Die Module sind trotzdem alle erklärt (G2) — G4 wählt aus den
// EINZELLIGEN, statt so zu tun, als gäbe es die anderen nicht.
// ═════════════════════════════════════════════════════════════════════

/**
 * Salz je Saatstrom (S1).
 *
 * Ein Strom je Phase, gemischt über `mische(seed, SALZ)` — nicht ein
 * gemeinsamer Strom für alles. Der Grund ist Pflege, nicht Reinheit: Ein
 * zusätzlicher Zug beim Wachsen verschöbe sonst jede spätere Modulwahl,
 * und ein Grundriss, der sich bei jeder Änderung komplett neu würfelt,
 * lässt sich nicht mit dem vorigen vergleichen. Vorbild ist
 * `dungeon2/hashing.ts` (W7).
 */
const SALT_GROWTH = 0x67726f77; // 'grow'
const SALT_MODULE = 0x6d6f6475; // 'modu'
const SALT_LOOP = 0x6c6f6f70; // 'loop'
const SALT_ARCHWAY = 0x61726368; // 'arch'
const SALT_ARCHWAY_TYPE = 0x61727479; // 'arty'

/** Die vier waagerechten Kanten — Boden und Decke wachsen in G4 nicht. */
const HORIZONTAL_DIRECTIONS: readonly Direction[] = DIRECTIONS.filter(isHorizontal);

/**
 * Gewicht der Richtung „geradeaus“ gegenüber jeder anderen (S2).
 *
 * Ohne Trägheit klumpt der Grundriss: Eine gleichverteilte Wahl aus vier
 * Richtungen erzeugt kompakte Flecken, keine Gänge. Der Wert ist bewusst
 * klein — er soll den Gang begünstigen, nicht erzwingen.
 */
const GROWTH_INERTIA = 3;

/**
 * Die Weltrichtung, in der der Eingangsport des Grabs zeigt.
 *
 * Sie ist keine Wahl: Der Eingangsconnector muss auf dem URSPRUNG landen
 * (dort hängt das ganze Grab), und der Ursprung ist die Nordkante der
 * Eingangszelle `(0,0,0)` — s. Dateikopf. Daraus folgt die Gierung des
 * Eingangsmoduls, und daraus, dass die Zelle nördlich des Eingangs für
 * immer leer bleibt: Dort geht es nach draussen.
 */
export const ENTRANCE_PORT_DIRECTION: Direction = 'n';

/**
 * Die beiden Regler aus Mikes Ergänzung vom 04.09.2026 (G5).
 *
 * Sie stehen NICHT in `DungeonGeneratorSettings`: Dort wohnen die
 * Schalter des 1.0-Pfads, und der liest diese beiden nie. Ein Feld, das
 * nur ein Pfad kennt, gehört zu diesem Pfad — sonst steht im Formular
 * bald ein Regler, der für 13 von 14 Kits nichts tut.
 *
 * Im Dokument heissen sie genauso (`DokumentGeneratorEinstellungen`), in
 * der Konzeptnotiz `schleifenAnteil` und `torbogenAnteil`. Der Bezeichner
 * ist englisch wie alles Neue seit dem 27.08. — dieselbe Übersetzung, die
 * aus `rasterKanten` `RoomDef.gridEdges` gemacht hat.
 * The two knobs from Mike's addendum: loops and archways.
 */
export interface GridTuning {
  /**
   * Anteil der Rasternachbarschaften ohne Baumkante, die zur Kante
   * werden (0…1).
   *
   * Vorgabe 0,35 statt der 0,12 der ursprünglichen Konzeptnotiz. Der
   * Grund steht in Mikes Ergänzung: Jede Nachbarschaft, die zur Kante
   * wird, ist ein DURCHGANG statt einer Doppelwand — der Regler ist
   * damit unmittelbar die Antwort auf „zu verwinkelt“.
   */
  readonly loopFraction: number;
  /**
   * Anteil der Verbindungen, die einen Torbogen bekommen (0…1).
   *
   * Die Zahl gilt am RAUMÜBERGANG (Gang → Zelle, Halleneingang); zwischen
   * zwei Gangzellen entsteht nie ein Bogen, zwischen zwei Raumzellen nur
   * halb so oft — zwei offene Zellen nebeneinander sind ein Raum, und ein
   * Rahmen mitten darin ist genau die „viele Bögen“-Beobachtung.
   */
  readonly archwayFraction: number;
}

/** Vorgaben der beiden Regler (Konzeptnotiz, Mikes Ergänzung 04.09.2026). */
export const DEFAULT_GRID_TUNING: GridTuning = {
  loopFraction: 0.35,
  archwayFraction: 0.25,
};

/**
 * Wie oft ein Bogen zwischen zwei RAUMzellen entsteht, gemessen an
 * {@link GridTuning.archwayFraction}.
 *
 * Nicht 1: Zwei offene Zellen nebeneinander lesen sich als ein Raum, und
 * ein Rahmen mitten darin ist keine Schwelle, sondern die Zwischenwand,
 * über die Mike sich beklagt hat. Nicht 0: Ein Bogen dort ist nicht
 * falsch, nur seltener richtig.
 */
const ARCHWAY_ROOM_TO_ROOM = 0.5;

/** Alles, was der Rasterpfad an Einstellungen liest. */
export type GridSettings = DungeonGeneratorSettings & GridTuning;

/** Steuerung des Rasterpfads. */
export interface GridGeneratorOptions {
  /**
   * Verletzte Selbstprüfung als Ausnahme statt als Rückfall.
   *
   * Vorgabe `false` = Serverbetrieb: Ein Programmfehler darf kein Grab
   * verhindern, er fällt deterministisch auf Eingang + Platten zurück
   * (Vorbild `dungeon2/generator.ts:1383-1399`). Tests setzen `true` und
   * bekommen die Meldung statt eines stillen Ein-Zellen-Grabs.
   */
  readonly strict?: boolean;
}

/** Eine Zelle des fertigen Plans. */
export interface GridPlanCell {
  readonly cell: GridCell;
  /** Name des gewählten Moduls (`RoomDef.name`). */
  readonly module: string;
  readonly yaw: Yaw;
  /** BFS-Tiefe ab dem Eingang; `placeOrder` ist das plus 1. */
  readonly depth: number;
  /** Graphkanten dieser Zelle in Weltrichtung, kanonisch sortiert. */
  readonly edges: readonly Direction[];
  /** Beim Eingangsraum die Richtung nach draussen, sonst null. */
  readonly entrancePort: Direction | null;
}

/** Eine Versiegelung: die offene Kante, vor die eine Platte gesetzt wird. */
export interface GridSeal {
  /** Die Zelle, deren Kante versiegelt wird — die Platte liegt im Nachbarn. */
  readonly cell: GridCell;
  readonly direction: Direction;
}

/**
 * Eine Kante zwischen zwei Zellen, in KANONISCHER Form: die Zelle mit dem
 * kleineren Schlüssel plus die Richtung zur anderen.
 *
 * Der ganze Grund für den Typ: `(A, n)` und `(B, s)` sind dieselbe Kante.
 * Wer beide Schreibweisen nebeneinander stehen lässt, zieht dieselbe
 * Kante zweimal und bekommt zwei verschiedene Antworten — die
 * Determinismus-Falle der Konzeptnotiz, nur eine Ebene tiefer als die
 * `Set`-Iteration.
 */
export interface GridEdge {
  readonly cell: GridCell;
  readonly direction: Direction;
}

/** Eine Graphkante mit Torbogen: dieselbe Kante plus das gewählte Türprefab. */
export interface GridArchway extends GridEdge {
  /** Prefabname aus `def.doorTypes`. */
  readonly door: string;
}

/**
 * Der fertige Plan: was wo steht, bevor daraus Weltkoordinaten werden.
 *
 * Er ist die prüfbare Zwischenstufe. Ein Layout allein sagt nicht mehr,
 * welche Nachbarschaft ABSICHT (Graphkante) und welche nur Berührung war
 * — genau die Auskunft, die dem 1.0-Pfad fehlt.
 */
export interface GridPlan {
  /** BFS-Reihenfolge ab dem Eingang; `cells[0]` ist der Eingang. */
  readonly cells: readonly GridPlanCell[];
  /** Kanonisch: in Zellreihenfolge, je Zelle in {@link DIRECTIONS}-Reihenfolge. */
  readonly seals: readonly GridSeal[];
  /**
   * S4 — die Kanten, die NICHT aus dem Spannbaum stammen.
   *
   * Sie stehen getrennt, obwohl sie in `cells[].edges` längst enthalten
   * sind: „Wie viele Schleifen hat dieser Grundriss?“ ist die Abnahmezahl
   * des Meilensteins, und sie aus Kantenzahl minus Zellzahl plus 1
   * zurückzurechnen ginge nur, solange der Graph zusammenhängend ist.
   */
  readonly loops: readonly GridEdge[];
  /** S8 — die Graphkanten mit Torbogen, kanonisch sortiert. */
  readonly archways: readonly GridArchway[];
}

/**
 * Kanonische Form einer Kante: die kleinere Zelle zuerst.
 *
 * Sie ist der Schlüssel, aus dem später gewürfelt wird — deshalb muss sie
 * von der Seite unabhängig sein, von der aus man auf die Kante schaut.
 */
export function canonicalEdge(cell: GridCell, direction: Direction): GridEdge {
  const other = neighbourCell(cell, direction);
  return compareCells(cell, other) <= 0
    ? { cell, direction }
    : { cell: other, direction: OPPOSITE_DIRECTION[direction] };
}

/** Kanonische Ordnung von Kanten: erst die Zelle, dann {@link DIRECTIONS}. */
export function compareEdges(a: GridEdge, b: GridEdge): number {
  return (
    compareCells(a.cell, b.cell) ||
    DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction)
  );
}

/** Zeichenkette einer kanonischen Kante — für Mengen und Meldungen. */
export function edgeKey(edge: GridEdge): string {
  return `${cellKey(edge.cell)}#${edge.direction}`;
}

/**
 * Der Wurf für eine Kante: eine Zahl in [0,1), abgeleitet aus dem
 * kanonischen Kantenschlüssel — OHNE Zug aus einem Saatstrom (Konzept
 * S1/S8, Vorbild `dungeon2/hashing.ts` W8).
 *
 * Das ist der Unterschied, um den es in diesem Meilenstein geht: Ein Zug
 * aus dem Strom hinge an der Reihenfolge, in der die Kanten besucht
 * werden. Eine zusätzliche Zelle, eine andere `Map`-Einfügung, und alle
 * Türen dahinter verschieben sich. `hashPos` hängt nur an der Kante.
 *
 * Die Richtung reist in der Ebenenstelle mit (`level * 6 + Index`) —
 * das ist eine Bijektion auf die ganzen Zahlen und braucht deshalb keine
 * vierte Koordinate, die `hashPos` nicht hat.
 */
function edgeRoll(edge: GridEdge, seed: number, salt: number): number {
  const index = DIRECTIONS.indexOf(edge.direction);
  const mixed = edge.cell.level * DIRECTIONS.length + index;
  return hashPos(edge.cell.i, edge.cell.j, mixed, mische(seed, salt)) / 0x1_0000_0000;
}

/**
 * Wählt aus einer Kantenliste deterministisch aus — je Kante mit ihrer
 * eigenen Wahrscheinlichkeit, unabhängig von der Reihenfolge der Eingabe.
 *
 * Die Ausgabe ist kanonisch sortiert und doppelte Schreibweisen derselben
 * Kante sind zusammengefasst. Beides ist keine Kosmetik: Eine Liste, die
 * in der Eingabereihenfolge zurückkäme, machte den ganzen Aufwand mit
 * {@link edgeRoll} wieder zunichte, sobald jemand sie ausgibt.
 */
export function selectEdges(
  edges: Iterable<GridEdge>,
  seed: number,
  salt: number,
  chance: (edge: GridEdge) => number
): GridEdge[] {
  const seen = new Set<string>();
  const chosen: GridEdge[] = [];
  for (const raw of edges) {
    const edge = canonicalEdge(raw.cell, raw.direction);
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    const p = chance(edge);
    if (p > 0 && edgeRoll(edge, seed, salt) < p) chosen.push(edge);
  }
  return chosen.sort(compareEdges);
}

/** Quaternion-Inverse (Einheitsquaternion) — wie im 1.0-Pfad. */
function quatInverse(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Die Gierung, unter der die lokale +z-Achse eines Moduls nach `d` zeigt. */
function yawForOutward(d: Direction): Yaw {
  for (const yaw of YAWS) if (rotateDirection('n', yaw) === d) return yaw;
  throw new DungeonRasterError(`Keine Gierung bildet die Vorderseite auf '${d}' ab.`);
}

/**
 * Liegt die ganze Zelle im Wachstumsraum? (S2, eigene Zonenregel.)
 *
 * Ausdrücklich NICHT `isInsideZone` des 1.0-Pfads: Der prüft die
 * GESCHRUMPFTE Hülle (1,4 statt 2) und rechnet in y um `pos.y` statt ab
 * der Bodenfläche. Beides ist dort begründet und hier falsch — eine
 * Rasterzelle ist 2 m breit und 3,5 m hoch, egal was ihre Hülle behauptet.
 */
function cellInsideZone(cell: GridCell, zoneHalf: number): boolean {
  const c = cellToWorld(cell);
  const half = GRID_CELL_M / 2;
  return (
    c.x - half >= -zoneHalf &&
    c.x + half <= zoneHalf &&
    c.z - half >= -zoneHalf &&
    c.z + half <= zoneHalf &&
    c.y >= -zoneHalf &&
    c.y + GRID_LEVEL_M <= zoneHalf
  );
}

/** Eine Zelle während des Wachstums. */
interface GrowthCell {
  readonly cell: GridCell;
  readonly key: string;
  /** Richtung ZUM Elter — null beim Eingang. Grundlage der Trägheit. */
  readonly toParent: Direction | null;
  /** Graphkanten (in G4 ausschliesslich Spannbaumkanten). */
  readonly edges: Set<Direction>;
  readonly entrance: boolean;
}

/**
 * Die Kanten, die für diese Zelle FREI bleiben müssen.
 *
 * ── Warum es diese Forderung überhaupt gibt ──────────────────────────
 * Das Kit hat kein Modul mit genau einer Öffnung. Eine Zelle vom Grad 1
 * bekommt deshalb zwangsläufig eine Öffnung mehr, als der Graph verlangt
 * — und die muss auf FELS zeigen, damit die Tafel dort eine Platte setzt.
 * Zeigte sie auf einen belegten Nachbarn, stünden zwei Räume aneinander,
 * ohne dass man durchkommt: genau Mikes Befund vom 04.09.2026.
 *
 * Beim Eingang gilt dasselbe für alle vier Kanten: Sein Modul ist gesetzt
 * (es ist der einzige Raum mit `entrance`) und hat vier Öffnungen. Was
 * dort nicht Graphkante ist, muss Fels sein.
 *
 * Die Forderung wird beim WACHSEN eingehalten, nicht beim Modulwählen —
 * dort wäre sie nicht mehr erfüllbar, sondern nur noch feststellbar.
 */
function requiredFreeDirections(cell: GrowthCell): readonly Direction[] {
  if (cell.entrance) return HORIZONTAL_DIRECTIONS.filter((d) => !cell.edges.has(d));
  if (cell.edges.size !== 1) return [];
  const only = HORIZONTAL_DIRECTIONS.find((d) => cell.edges.has(d));
  return only === undefined ? [] : [OPPOSITE_DIRECTION[only]];
}

/**
 * S2 — Zellmenge und Spannbaum in einem Durchgang.
 *
 * Jede angenommene Zelle bringt ihre Anhängekante mit; die Kantenmenge
 * IST damit der Spannbaum, und Erreichbarkeit ist Bauergebnis statt
 * Nachkontrolle. Abgelehnt wird eine Zelle nur aus drei Gründen: belegt,
 * ausserhalb der Zone, oder sie nähme einem Nachbarn (oder sich selbst)
 * die Pflichtkante aus {@link requiredFreeDirections}.
 */
function growCells(
  seed: number,
  target: number,
  zoneHalf: number,
  bounded: boolean
): Map<string, GrowthCell> {
  const rng = new XorShiftRandom(mische(seed, SALT_GROWTH));
  const cells = new Map<string, GrowthCell>();
  const entrance: GrowthCell = {
    cell: ENTRANCE_CELL,
    key: cellKey(ENTRANCE_CELL),
    toParent: null,
    edges: new Set<Direction>(),
    entrance: true,
  };
  cells.set(entrance.key, entrance);

  // Die Zelle hinter dem Eingangsport ist für immer gesperrt: Dort geht
  // es nach draussen. Ein Raum darin wäre ein Zimmer im Zugangsstollen.
  const blocked = cellKey(neighbourCell(ENTRANCE_CELL, ENTRANCE_PORT_DIRECTION));

  /** Darf an `parent` in Richtung `d` eine Zelle wachsen? */
  const mayGrow = (parent: GrowthCell, d: Direction): boolean => {
    const candidate = neighbourCell(parent.cell, d);
    const key = cellKey(candidate);
    if (key === blocked || cells.has(key)) return false;
    if (bounded && !cellInsideZone(candidate, zoneHalf)) return false;
    // Die neue Zelle ist ein Blatt: Ihre Fortsetzung geradeaus muss frei
    // bleiben, damit sie ihre überzählige Öffnung auf Fels legen kann.
    if (cells.has(cellKey(neighbourCell(candidate, d)))) return false;
    // Und kein bereits stehender Nachbar darf durch sie seine Pflichtkante
    // verlieren. `nd` zeigt von der neuen Zelle zum Nachbarn, die
    // Gegenrichtung vom Nachbarn auf die neue Zelle.
    for (const nd of HORIZONTAL_DIRECTIONS) {
      if (nd === OPPOSITE_DIRECTION[d]) continue; // der Elter, er bekommt die Kante
      const other = cells.get(cellKey(neighbourCell(candidate, nd)));
      if (!other) continue;
      if (requiredFreeDirections(other).includes(OPPOSITE_DIRECTION[nd])) return false;
    }
    return true;
  };

  // Die Wachstumsfront: Zellen, die noch eine freie Richtung haben
  // könnten. Ein Array und kein `Set` — die Ziehreihenfolge ist Teil des
  // Saatvertrags, und `Set`-Iteration ist die erste Determinismus-Falle
  // der Konzeptnotiz.
  const frontier: string[] = [entrance.key];
  while (cells.size < target && frontier.length > 0) {
    const pick = rng.rangeInt(0, frontier.length);
    const current = cells.get(frontier[pick]!)!;
    const options = HORIZONTAL_DIRECTIONS.filter((d) => mayGrow(current, d));
    if (options.length === 0) {
      // Von hier aus geht nichts mehr. Theoretisch könnte sich das noch
      // drehen — verliert ein Nachbar mit dem zweiten Grad seine
      // Pflichtkante, wäre wieder Platz. Die Front holt ihn nicht zurück:
      // Eine Front, die nur schrumpft, ist die einfachere Aussage, und die
      // verpasste Gelegenheit kostet keine Zelle (die Zellzahl trifft
      // `maxRooms` über 40 Saaten exakt).
      frontier.splice(pick, 1);
      continue;
    }
    // Richtungsträgheit: geradeaus (die Gegenrichtung zum Elter) wiegt
    // schwerer als die Abzweigungen.
    const straight = current.toParent === null ? null : OPPOSITE_DIRECTION[current.toParent];
    const weight = (d: Direction): number => (d === straight ? GROWTH_INERTIA : 1);
    let roll = rng.rangeInt(0, options.reduce((n, d) => n + weight(d), 0));
    let chosen = options[options.length - 1]!;
    for (const d of options) {
      roll -= weight(d);
      if (roll < 0) {
        chosen = d;
        break;
      }
    }
    const child = neighbourCell(current.cell, chosen);
    const childKey = cellKey(child);
    current.edges.add(chosen);
    cells.set(childKey, {
      cell: child,
      key: childKey,
      toParent: OPPOSITE_DIRECTION[chosen],
      edges: new Set<Direction>([OPPOSITE_DIRECTION[chosen]]),
      entrance: false,
    });
    frontier.push(childKey);
  }
  return cells;
}

/**
 * S4 — Schleifen: aus den übrigen Rasternachbarschaften wird ein Anteil
 * zur Kante ergänzt.
 *
 * ── Warum das gefahrlos ist ──────────────────────────────────────────
 * Eine zusätzliche Kante kann eine Zelle nur in einen HÖHEREN Öffnungsgrad
 * heben, und für jeden Grad ab 2 hat das Kit genau ein Modul. Nur der
 * Grad 1 braucht eine überzählige Öffnung (das Kit hat kein Modul mit
 * einer), und die Pflichtkante dafür hat das Wachstum bereits freigehalten
 * — eine Schleife nimmt sie nicht weg, sie macht sie überflüssig.
 *
 * ── Warum die Nachbarn des Eingangs nie in Frage kommen ──────────────
 * Neben dem Eingang steht nichts, was nicht sein Kind ist: `mayGrow`
 * lässt dort keine Zelle zu, weil `requiredFreeDirections` für den
 * Eingang ALLE kantenlosen Seiten freihält (sein Modul hat vier
 * Öffnungen). Der Fall braucht deshalb keinen Sonderzweig.
 *
 * Der Rückgabewert sind die ergänzten Kanten — die Abnahmezahl des
 * Meilensteins, und der einzige Weg, sie später noch von den
 * Spannbaumkanten zu unterscheiden.
 */
function addLoopEdges(
  cells: Map<string, GrowthCell>,
  seed: number,
  fraction: number
): GridEdge[] {
  if (!(fraction > 0)) return [];
  // Kanonisch sortiert statt in `Map`-Einfügereihenfolge. Für das
  // ERGEBNIS ist das gleichgültig (jede Kante würfelt für sich), für die
  // Beweisbarkeit nicht: Eine Kandidatenliste, deren Reihenfolge an der
  // Einfügung hängt, wäre bei der nächsten Änderung wieder eine Falle.
  const ordered = [...cells.values()].sort((a, b) => compareCells(a.cell, b.cell));
  const candidates: GridEdge[] = [];
  for (const c of ordered) {
    for (const d of HORIZONTAL_DIRECTIONS) {
      if (c.edges.has(d)) continue;
      if (!cells.has(cellKey(neighbourCell(c.cell, d)))) continue;
      candidates.push(canonicalEdge(c.cell, d));
    }
  }
  const chosen = selectEdges(candidates, seed, SALT_LOOP, () => fraction);
  for (const edge of chosen) {
    const a = cells.get(cellKey(edge.cell));
    const b = cells.get(cellKey(neighbourCell(edge.cell, edge.direction)));
    if (!a || !b) throw new DungeonRasterError(`Schleifenkante ${edgeKey(edge)} hat keine zwei Zellen.`);
    a.edges.add(edge.direction);
    b.edges.add(OPPOSITE_DIRECTION[edge.direction]);
  }
  return chosen;
}

/** Bitmaske einer Kantenmenge — n/o/s/w in der Reihenfolge von {@link DIRECTIONS}. */
function directionMask(dirs: Iterable<Direction>): number {
  let mask = 0;
  for (const d of dirs) {
    const bit = HORIZONTAL_DIRECTIONS.indexOf(d);
    if (bit >= 0) mask |= 1 << bit;
  }
  return mask;
}

/** Alle vier waagerechten Kanten offen. */
const ALL_HORIZONTAL_MASK = (1 << HORIZONTAL_DIRECTIONS.length) - 1;

function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m !== 0; m >>= 1) n += m & 1;
  return n;
}

function maskDirections(mask: number): Direction[] {
  return HORIZONTAL_DIRECTIONS.filter((_, i) => (mask & (1 << i)) !== 0);
}

/** Ein Modul in einer Gierung, mit dem Öffnungsmuster, das es damit anbietet. */
interface ModuleOption {
  readonly def: RoomDef;
  readonly module: GridModule;
  readonly yaw: Yaw;
  /** Offene Kanten in WELTrichtung, als Bitmaske. */
  readonly open: number;
  readonly weight: number;
}

/**
 * Alle einzelligen Module des Kits in allen vier Gierungen.
 *
 * Einzellig und einstöckig, weil G4 keine Stempel kennt (Halle, Treppe →
 * G6/G7). Ohne Eingangsraum, wie im 1.0-Pfad: `entrance` ist eine ROLLE,
 * und ein Kit, das seinen Eingang auch als Füller setzte, hätte nach dem
 * Start genau einen Raum weniger zur Auswahl.
 *
 * Vier Gierungen, keine Spiegelung: Die Ecke deckt über 90°/180°/270°
 * alle vier angrenzenden Paare ab, der Abzweig alle vier Wandseiten, der
 * Korridor beide Achsen. Es bleibt kein Muster übrig, für das eine
 * Spiegelung nötig wäre.
 */
function cellModuleOptions(def: DungeonDef): ModuleOption[] {
  const options: ModuleOption[] = [];
  for (const room of def.rooms) {
    if (room.endCap || room.entrance) continue;
    const module = gridModuleFromRoomDef(room);
    if (module.cells.length !== 1 || module.levels !== 1) continue;
    const cell = module.cells[0]!;
    for (const yaw of YAWS) {
      const open = directionMask(
        HORIZONTAL_DIRECTIONS.filter((d) => cell.edges[d] === 'open').map((d) => rotateDirection(d, yaw))
      );
      options.push({ def: room, module, yaw, open, weight: Math.max(1, Math.round(room.weight)) });
    }
  }
  return options;
}

/**
 * S5 — die Öffnungsmuster, die für ein verlangtes Muster zugelassen sind.
 *
 * Ab Grad 2 ist es genau das Muster selbst: Das Kit hat für jedes davon
 * ein Modul (4 → Zelle, 3 → Abzweig, 2 gegenüber → Korridor, 2 angrenzend
 * → Ecke), und eine Öffnung mehr wäre eine, die niemand verlangt hat.
 *
 * Grad 1 hat im Kit keine Entsprechung — es gibt kein Modul mit genau
 * einer Öffnung. Zugelassen sind deshalb die beiden Muster, die die
 * Konzeptnotiz nennt (S5): die durchgehende Achse (Korridor) und die
 * vollständig offene Zelle. Die ECKE liesse sich ebenso einsetzen und ist
 * absichtlich nicht dabei — ein Knick, hinter dem eine Platte steht,
 * liest sich als Bauunfall, ein Gangstumpf und eine Kammer nicht.
 *
 * Grad 0 gibt es nur für ein Grab aus einer einzigen Zelle.
 */
function allowedOpenMasks(mask: number): number[] {
  const grad = popcount(mask);
  if (grad >= 2) return [mask];
  if (grad === 1) {
    const only = maskDirections(mask)[0]!;
    return [mask | directionMask([OPPOSITE_DIRECTION[only]]), ALL_HORIZONTAL_MASK];
  }
  return [ALL_HORIZONTAL_MASK];
}

/**
 * Wählt Modul und Gierung für ein Öffnungsmuster.
 *
 * Zwei Bedingungen, und die zweite ist die wichtige:
 *  1. Jede Graphkante muss offen sein — sonst wäre eine Verbindung im
 *     Graphen im Grab eine Wand.
 *  2. Jede ÜBERZÄHLIGE Öffnung muss auf Fels zeigen. Dort setzt die Tafel
 *     eine Platte; auf einen belegten Nachbarn gerichtet wäre sie eine
 *     Öffnung, durch die man nicht kommt.
 *
 * Findet sich kein zugelassenes Muster, wird die Bedingung gelockert
 * (irgendein Modul mit möglichst wenig Überzähligem) — nicht aus Kulanz,
 * sondern damit ein Kit mit anderer Modulliste nicht am ersten Grad-3-Fall
 * scheitert. Bleibt auch das leer, ist es ein Programmfehler und die
 * Selbstprüfung übernimmt.
 */
function chooseModule(
  options: readonly ModuleOption[],
  mask: number,
  freeMask: number,
  rng: XorShiftRandom
): ModuleOption {
  const fits = (o: ModuleOption): boolean =>
    (o.open & mask) === mask && (o.open & ~mask & ~freeMask) === 0;
  const allowed = allowedOpenMasks(mask);
  let candidates = options.filter((o) => allowed.includes(o.open) && fits(o));
  if (candidates.length === 0) {
    const rest = options.filter(fits);
    if (rest.length > 0) {
      const best = Math.min(...rest.map((o) => popcount(o.open & ~mask)));
      candidates = rest.filter((o) => popcount(o.open & ~mask) === best);
    }
  }
  if (candidates.length === 0) {
    throw new DungeonRasterError(
      `Kein Modul für das Öffnungsmuster [${maskDirections(mask).join(',')}] ` +
        `mit freien Kanten [${maskDirections(freeMask).join(',')}].`
    );
  }
  let roll = rng.rangeInt(0, candidates.reduce((n, o) => n + o.weight, 0));
  for (const o of candidates) {
    roll -= o.weight;
    if (roll < 0) return o;
  }
  return candidates[candidates.length - 1]!;
}

/** Kantenzustände eines platzierten Moduls, in WELTrichtungen. */
function worldEdgeStates(module: GridModule, yaw: Yaw): Record<Direction, EdgeState> {
  const cell = module.cells[0];
  if (!cell) throw new DungeonRasterError(`Modul '${module.name}' hat keine Zelle.`);
  const out = {} as Record<Direction, EdgeState>;
  for (const d of DIRECTIONS) out[rotateDirection(d, yaw)] = cell.edges[d];
  return out;
}

/**
 * Ist diese Zelle ein GANG?
 *
 * Antwort aus der Modulerklärung, nicht aus einer Namensliste: Ein Gang
 * ist ein Modul mit mindestens einer eingebauten vollen Wand (Korridor,
 * Ecke, Abzweig). Zelle, Halle und Eingang haben keine — sie sind Räume.
 *
 * Boden und Decke zählen ausdrücklich nicht mit: Sie sind bei JEDEM Modul
 * `wall` (Vorgabe aus S0), und wer sie mitzählte, erklärte das ganze Kit
 * zum Gangsystem.
 */
function isCorridorModule(module: GridModule): boolean {
  return module.cells.some((c) => HORIZONTAL_DIRECTIONS.some((d) => c.edges[d] === 'wall'));
}

/**
 * S8 — welche Graphkanten einen Torbogen bekommen.
 *
 * ── Eine reine Funktion, und zwar mit Absicht ────────────────────────
 * Sie bekommt die fertigen Planzellen und würfelt aus dem kanonischen
 * Kantenschlüssel ({@link edgeRoll}), nicht aus dem Saatstrom. Damit ist
 * die Antwort unabhängig davon, in welcher Reihenfolge die Zellen
 * hereinkommen — und genau das lässt sich prüfen, indem man die Liste
 * vertauscht. Ein Strom-Zug an dieser Stelle wäre nicht falsch, aber
 * unbeweisbar.
 *
 * ── Die Regel aus Mikes Ergänzung ────────────────────────────────────
 *  • Gang ↔ Gang: nie. Ein Rahmen mitten im Gang ist die „Zwischenwand“,
 *    über die er sich beklagt hat.
 *  • Gang ↔ Raum (und Halleneingang): volle `fraction` — das ist der
 *    Übergang, an dem ein Rahmen etwas erzählt.
 *  • Raum ↔ Raum: halb so oft. Zwei offene Zellen nebeneinander sind ein
 *    Raum; ein Bogen darin trennt, was zusammengehört.
 *
 * `allowDoor: false` fällt auf BEIDEN Seiten heraus. Der 1.0-Pfad fragt
 * nur die eine Seite (plus `doorOnlyIfOtherAlsoAllowsDoor`); hier wäre
 * das schlechter, weil „die eine Seite“ die kanonisch kleinere Zelle ist
 * — eine Tür, deren Existenz an der Zellnummerierung hängt.
 */
export function planArchways(
  def: DungeonDef,
  cells: readonly GridPlanCell[],
  seed: number,
  fraction: number
): GridArchway[] {
  if (!(fraction > 0) || def.doorTypes.length === 0) return [];
  const byName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));

  /** Öffnungen aller Zellen, nachschlagbar über (Zelle, Weltrichtung). */
  const portAt = new Map<string, { port: GridPort; room: RoomDef; corridor: boolean }>();
  for (const c of cells) {
    const room = byName.get(c.module);
    if (!room) throw new DungeonRasterError(`Modul '${c.module}' steht nicht im Kit '${def.name}'.`);
    const module = gridModuleFromRoomDef(room);
    const corridor = isCorridorModule(module);
    for (const port of moduleWorldPorts(c.cell, c.yaw, module)) {
      portAt.set(edgeKey({ cell: port.cell, direction: port.direction }), { port, room, corridor });
    }
  }

  /** Die Türtypen, die zu einem Kopplungstyp passen — wie `placeDoors` im 1.0-Pfad. */
  const doorTypesFor = (type: string) => def.doorTypes.filter((dt) => dt.connectionType === type);

  const sides = (edge: GridEdge) => {
    const a = portAt.get(edgeKey(edge));
    const other = neighbourCell(edge.cell, edge.direction);
    const b = portAt.get(edgeKey({ cell: other, direction: OPPOSITE_DIRECTION[edge.direction] }));
    return a && b ? { a, b } : null;
  };

  const chance = (edge: GridEdge): number => {
    const both = sides(edge);
    if (!both) return 0; // keine Öffnung auf einer Seite — dort kommt kein Rahmen hin
    const { a, b } = both;
    if (!a.port.allowDoor || !b.port.allowDoor) return 0;
    const type = a.room.connections[a.port.connector]?.type;
    if (type === undefined || doorTypesFor(type).length === 0) return 0;
    if (a.corridor && b.corridor) return 0;
    return a.corridor === b.corridor ? fraction * ARCHWAY_ROOM_TO_ROOM : fraction;
  };

  const graphEdges: GridEdge[] = [];
  for (const c of cells) {
    for (const d of c.edges) graphEdges.push(canonicalEdge(c.cell, d));
  }

  return selectEdges(graphEdges, seed, SALT_ARCHWAY, chance).map((edge) => {
    const both = sides(edge)!;
    const type = both.a.room.connections[both.a.port.connector]!.type;
    const options = doorTypesFor(type);
    // Eigener Salzwert für die AUSWAHL: Käme sie aus demselben Wurf wie
    // die Entscheidung, hinge der Typ an der Schwelle — bei einem
    // kleineren `torbogenAnteil` stünde plötzlich überall derselbe Bogen.
    const pick = options.length === 1
      ? options[0]!
      : options[Math.min(options.length - 1, Math.floor(edgeRoll(edge, seed, SALT_ARCHWAY_TYPE) * options.length))]!;
    return { cell: edge.cell, direction: edge.direction, door: pick.prefabName };
  });
}

/**
 * S2…S8 — der ganze Plan: Zellmenge, Spannbaum, Schleifen, BFS-Ordnung,
 * Modulwahl, Versiegelung, Torbögen. Rein: gleiche Eingabe, gleicher Plan.
 */
export function planGridDungeon(
  def: DungeonDef,
  seed: number,
  settingsIn?: Partial<GridSettings>
): GridPlan {
  const settings = {
    ...DEFAULT_GENERATOR_SETTINGS,
    ...DEFAULT_GRID_TUNING,
    ...def.generatorEinstellungen,
    ...settingsIn,
  };
  // Geklemmt, obwohl der Dokument-Sanitizer das schon tut: Ein Aufruf aus
  // einem Konsolenbefehl oder einem Test geht nicht durch ihn hindurch,
  // und ein Anteil über 1 machte aus `selectEdges` stillschweigend ein
  // „alles“.
  const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  const loopFraction = clamp01(settings.loopFraction);
  // `doorsEnabled` bleibt der Hauptschalter des 1.0-Pfads — zwei Schalter
  // für dieselbe Sache liefen sonst auseinander.
  const archwayFraction = settings.doorsEnabled ? clamp01(settings.archwayFraction) : 0;
  // `maxRooms` heisst im Rasterpfad ZELLZAHL, nicht Wachstumsversuche —
  // die Bedeutung wechselt mit dem Pfad, s. Verträge der Konzeptnotiz.
  const target = Math.max(1, Math.min(MAX_DUNGEON_ROOMS, Math.trunc(def.maxRooms)));
  const cells = growCells(seed, target, settings.zoneSize * 0.5, settings.zoneBounded);

  // ── S4: Schleifen VOR dem BFS ──────────────────────────────────────
  // Sie sind Graphkanten wie alle anderen: Sie kürzen Wege ab und ändern
  // damit die BFS-Tiefe und die Ausgabereihenfolge. Nachträglich ergänzt
  // wären sie Kanten zweiter Klasse — und `placeOrder` behauptete eine
  // Tiefe, die im Grab niemand zurücklegen muss.
  const loops = addLoopEdges(cells, seed, loopFraction);

  // ── BFS ab dem Eingang (S9) ────────────────────────────────────────
  // Die Ausgabereihenfolge ist Teil des Formats: `placeOrder` ist die
  // BFS-Tiefe + 1, wie im 1.0-Pfad der Startraum auf 1 landet.
  const depth = new Map<string, number>([[cellKey(ENTRANCE_CELL), 0]]);
  const order: GrowthCell[] = [];
  const queue: GrowthCell[] = [];
  const start = cells.get(cellKey(ENTRANCE_CELL));
  if (!start) throw new DungeonRasterError('Die Eingangszelle fehlt in der Zellmenge.');
  queue.push(start);
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const d of DIRECTIONS) {
      if (!current.edges.has(d)) continue;
      const nb = cells.get(cellKey(neighbourCell(current.cell, d)));
      if (!nb || depth.has(nb.key)) continue;
      depth.set(nb.key, (depth.get(current.key) ?? 0) + 1);
      queue.push(nb);
    }
  }
  if (order.length !== cells.size) {
    throw new DungeonRasterError(
      `${cells.size - order.length} von ${cells.size} Zellen hängen nicht am Spannbaum.`
    );
  }

  // ── S5: Modulwahl ──────────────────────────────────────────────────
  const rng = new XorShiftRandom(mische(seed, SALT_MODULE));
  const options = cellModuleOptions(def);
  const entranceDef = def.rooms.find((r) => r.entrance);
  if (!entranceDef) throw new DungeonRasterError(`Kit '${def.name}' hat keinen Eingangsraum.`);
  const entranceModule = gridModuleFromRoomDef(entranceDef);
  const anchor = entranceModule.anchor;
  if (!anchor) throw new DungeonRasterError(`'${entranceDef.name}' hat keinen Eingangsconnector.`);
  // Die Gierung folgt aus der Forderung, dass der Eingangsconnector auf
  // dem Ursprung landet — sie wird abgeleitet, nicht getippt.
  const entranceYaw = YAWS.find(
    (yaw) => rotateDirection(anchor.direction, yaw) === ENTRANCE_PORT_DIRECTION
  );
  if (entranceYaw === undefined) {
    throw new DungeonRasterError(
      `Keine Gierung dreht den Eingangsport von '${entranceDef.name}' nach ${ENTRANCE_PORT_DIRECTION}.`
    );
  }

  const planCells: GridPlanCell[] = [];
  const states = new Map<string, Record<Direction, EdgeState>>();
  for (const c of order) {
    const mask = directionMask(c.edges);
    const freeMask = directionMask(
      HORIZONTAL_DIRECTIONS.filter((d) => !cells.has(cellKey(neighbourCell(c.cell, d))))
    );
    const chosen = c.entrance
      ? { def: entranceDef, module: entranceModule, yaw: entranceYaw }
      : chooseModule(options, mask, freeMask, rng);
    states.set(c.key, worldEdgeStates(chosen.module, chosen.yaw));
    planCells.push({
      cell: c.cell,
      module: chosen.def.name,
      yaw: chosen.yaw,
      depth: depth.get(c.key) ?? 0,
      edges: DIRECTIONS.filter((d) => c.edges.has(d)),
      entrancePort: c.entrance ? ENTRANCE_PORT_DIRECTION : null,
    });
  }

  // ── S7: Versiegelung nach Kantentafel ──────────────────────────────
  //
  //   offen | offen, Graphkante   → Durchgang
  //   offen | offen, keine Kante  → je eine Platte pro Seite
  //   offen | wand                → KEINE Platte (die Wand des Nachbarn IST die Wand)
  //   offen | wandTeilweise       → Platte auf der offenen Seite
  //   offen | fels                → eine Platte
  //   wand / wandTeilweise        → nichts
  //
  // Zeile 3 ist der Grund für den ganzen Umbau: Sie schafft die 531
  // Platten ab, die heute im Körper von Korridor, Ecke und Abzweig
  // stehen. Zeile 4 hält die 414 gegen die Treppe — deren Flanke ist ein
  // Keil und deckt die Kante nicht über die volle Ebenenhöhe.
  const seals: GridSeal[] = [];
  for (let i = 0; i < order.length; i++) {
    const c = order[i]!;
    const mine = states.get(c.key)!;
    for (const d of DIRECTIONS) {
      if (mine[d] !== 'open') continue; // Zeile 6
      if (c.edges.has(d)) continue; // Zeile 1: Durchgang
      if (planCells[i]!.entrancePort === d) continue; // führt nach draussen
      const other = cells.get(cellKey(neighbourCell(c.cell, d)));
      if (!other) {
        seals.push({ cell: c.cell, direction: d }); // Zeile 5: Fels
        continue;
      }
      const facing = states.get(other.key)![OPPOSITE_DIRECTION[d]];
      // Zeile 3: nichts. Zeile 2 und 4: Platte auf DIESER Seite; die
      // Gegenseite entscheidet für sich, und in Zeile 2 stehen beide
      // Rücken an Rücken um die Kantenebene.
      if (facing !== 'wall') seals.push({ cell: c.cell, direction: d });
    }
  }

  // ── S8: Torbögen ───────────────────────────────────────────────────
  // Zuletzt, weil die Regel die MODULE der beiden Seiten braucht (Gang
  // oder Raum) — die stehen erst nach S5 fest.
  const archways = planArchways(def, planCells, seed, archwayFraction);

  return { cells: planCells, seals, loops, archways };
}

/**
 * Die Pose einer Abschlussplatte auf einer Zellkante.
 *
 * Dieselbe Rechnung wie `calculateRoomPosRot` im 1.0-Pfad, nur ohne
 * Suchlauf: Der Connector der Platte landet auf der Kantenmitte, und ihre
 * Vorderseite (lokal +z, die Reliefseite) schaut IN die Zelle, die sie
 * abschliesst. Ihr 0,3-m-Körper liegt damit hinter der Kante — in der
 * Nachbarzelle, die nach der Tafel frei ist.
 */
function sealPose(
  cell: GridCell,
  direction: Direction,
  plate: RoomDef
): { pos: Vector3; rot: Quaternion } {
  const conn = plate.connections[0];
  if (!conn) throw new DungeonRasterError(`Abschluss '${plate.name}' hat keinen Connector.`);
  const rot = quatMul(
    yawQuaternion(yawForOutward(OPPOSITE_DIRECTION[direction])),
    quatInverse(conn.localRot)
  );
  const centre = edgeCenterWorld(cell, direction);
  const arm = quatMulVec3(rot, conn.localPos);
  return { pos: { x: centre.x - arm.x, y: centre.y - arm.y, z: centre.z - arm.z }, rot };
}

/**
 * S9 — Plan zu `DungeonLayout`.
 *
 * Reihenfolge: Eingang, dann BFS ab dem Eingang, Platten zuletzt. Sie ist
 * kein Geschmack, sondern Teil des Formats — `layout.props[].roomIndex`
 * zeigt auf diese Liste, und `placeOrder` ist die BFS-Tiefe + 1 (der
 * 1.0-Pfad setzt den Startraum ebenso auf 1).
 */
export function layoutFromPlan(def: DungeonDef, plan: GridPlan): DungeonLayout {
  const byName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  const rooms: PlacedRoom[] = plan.cells.map((c) => {
    const rd = byName.get(c.module);
    if (!rd) throw new DungeonRasterError(`Modul '${c.module}' steht nicht im Kit '${def.name}'.`);
    return placeModule(c.cell, c.yaw, gridModuleFromRoomDef(rd), c.depth + 1);
  });
  const plate = def.rooms.find((r) => r.endCap);
  if (!plate && plan.seals.length > 0) {
    throw new DungeonRasterError(`Kit '${def.name}' hat keinen Abschluss für ${plan.seals.length} Kanten.`);
  }
  const depthOf = new Map<string, number>(plan.cells.map((c) => [cellKey(c.cell), c.depth]));
  for (const seal of plan.seals) {
    const { pos, rot } = sealPose(seal.cell, seal.direction, plate!);
    rooms.push({
      room: plate!.name,
      pos,
      rot,
      // Wie im 1.0-Pfad: Ein Abschluss erbt den Platz seiner Kante plus 1.
      placeOrder: (depthOf.get(cellKey(seal.cell)) ?? 0) + 2,
      seed: roomSeed(pos),
    });
  }

  // ── Torbögen (S8) ──────────────────────────────────────────────────
  // Ein Torbogen ist KEIN Raum: Er liegt in der Kopplungsebene zwischen
  // zwei Zellen, dort, wo sonst ein Wandmodul stünde — dieselbe Stelle,
  // an die `placeDoors` im 1.0-Pfad setzt.
  const cellAt = new Map<string, GridPlanCell>(plan.cells.map((c) => [cellKey(c.cell), c]));
  const doors: PlacedDoor[] = plan.archways.map((arch) => {
    const host = cellAt.get(cellKey(arch.cell));
    if (!host) throw new DungeonRasterError(`Torbogen auf ${edgeKey(arch)} steht an keiner Zelle.`);
    const rd = byName.get(host.module);
    if (!rd) throw new DungeonRasterError(`Modul '${host.module}' steht nicht im Kit '${def.name}'.`);
    const port = moduleWorldPorts(host.cell, host.yaw, gridModuleFromRoomDef(rd)).find(
      (p) => cellKey(p.cell) === cellKey(arch.cell) && p.direction === arch.direction
    );
    if (!port) throw new DungeonRasterError(`'${host.module}' hat keine Öffnung auf ${edgeKey(arch)}.`);
    const conn = rd.connections[port.connector];
    if (!conn) throw new DungeonRasterError(`'${host.module}' hat keinen Connector ${port.connector}.`);
    const doorDef = def.doorTypes.find((dt) => dt.prefabName === arch.door);
    if (!doorDef) throw new DungeonRasterError(`Kit '${def.name}' kennt den Torbogen '${arch.door}' nicht.`);
    return {
      prefabName: doorDef.prefabName,
      prefabHash: doorDef.prefabHash,
      // Die KANTENMITTE, nicht die zurückgerechnete Connector-Position:
      // Sie ist ganzzahlig verankert (die eine Regel dieser Datei), und
      // dass der Connector dort liegt, ist mit 1e-4 verbürgt
      // (`assertConnectorsOnEdges`). Zwei Rechenwege für denselben Punkt
      // wären zwei Punkte, sobald einer von beiden driftet.
      pos: edgeCenterWorld(arch.cell, arch.direction),
      // Wie `localToGlobal` im 1.0-Pfad. Alle Drehungen hier sind reine
      // Gierungen um dieselbe Achse und vertauschbar; die Reihenfolge
      // steht trotzdem so da, damit ein Kit mit gekippten Connectors
      // nicht stillschweigend anders herum gerechnet wird.
      rot: quatMul(conn.localRot, yawQuaternion(host.yaw)),
    };
  });

  // `props` bleibt leer: Deko setzt der Generator grundsätzlich nicht,
  // das ist Sache des Editors.
  return { rooms, doors, props: [] };
}

/**
 * S10 — die Selbstprüfung.
 *
 * Sie prüft, was die Tafel verspricht, und zwar am fertigen Plan statt an
 * den Zwischenständen: keine doppelt belegte Zelle, jede Graphkante
 * beidseitig offen, 100 % Erreichbarkeit ab dem Eingang, jede Platte in
 * einer freien Zelle (oder gegen eine Teilwand, oder Rücken an Rücken mit
 * der Platte der Gegenseite — Zeile 2 der Tafel), und jeder Connector auf
 * seiner Kantenmitte.
 *
 * Eine Verletzung ist ein PROGRAMMFEHLER, kein Datenfall: Sie wirft. Was
 * der Aufrufer daraus macht, entscheidet {@link generateGridLayout}.
 */
function selfCheck(def: DungeonDef, plan: GridPlan): void {
  const byName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
  const cells = new Map<string, GridPlanCell>();
  for (const c of plan.cells) {
    const key = cellKey(c.cell);
    if (cells.has(key)) throw new DungeonRasterError(`Zelle ${key} ist doppelt belegt.`);
    cells.set(key, c);
  }

  const states = new Map<string, Record<Direction, EdgeState>>();
  for (const c of plan.cells) {
    const rd = byName.get(c.module);
    if (!rd) throw new DungeonRasterError(`Modul '${c.module}' steht nicht im Kit '${def.name}'.`);
    const module = gridModuleFromRoomDef(rd);
    // Der Zeuge aus S6: Die Kit-Geometrie darf sich unter der Erklärung
    // nicht wegbewegen.
    assertConnectorsOnEdges(rd, c.cell, c.yaw, module);
    states.set(cellKey(c.cell), worldEdgeStates(module, c.yaw));
  }

  for (const c of plan.cells) {
    const mine = states.get(cellKey(c.cell))!;
    for (const d of c.edges) {
      if (mine[d] !== 'open') {
        throw new DungeonRasterError(
          `Zelle ${cellKey(c.cell)}: Graphkante ${d} ist im Modul '${c.module}' '${mine[d]}'.`
        );
      }
      const other = cells.get(cellKey(neighbourCell(c.cell, d)));
      if (!other || !other.edges.includes(OPPOSITE_DIRECTION[d])) {
        throw new DungeonRasterError(`Zelle ${cellKey(c.cell)}: Graphkante ${d} ist einseitig.`);
      }
    }
  }

  // Erreichbarkeit — der Punkt, an dem „Spannbaum“ von einer Absicht zu
  // einer geprüften Aussage wird.
  const seen = new Set<string>([cellKey(ENTRANCE_CELL)]);
  const queue: GridCell[] = [ENTRANCE_CELL];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of cells.get(cellKey(cur))?.edges ?? []) {
      const nb = neighbourCell(cur, d);
      if (seen.has(cellKey(nb))) continue;
      seen.add(cellKey(nb));
      queue.push(nb);
    }
  }
  if (seen.size !== plan.cells.length) {
    throw new DungeonRasterError(
      `${plan.cells.length - seen.size} von ${plan.cells.length} Zellen sind vom Eingang aus unerreichbar.`
    );
  }

  const sealed = new Set<string>();
  for (const seal of plan.seals) {
    const key = `${cellKey(seal.cell)}#${seal.direction}`;
    if (sealed.has(key)) throw new DungeonRasterError(`Zwei Platten auf derselben Kante ${key}.`);
    sealed.add(key);
    const host = cells.get(cellKey(seal.cell));
    if (!host) throw new DungeonRasterError(`Platte auf ${key} steht an keiner Zelle.`);
    if (states.get(cellKey(seal.cell))![seal.direction] !== 'open') {
      throw new DungeonRasterError(`Platte auf ${key} steht vor einer Wand statt vor einer Öffnung.`);
    }
    if (host.edges.includes(seal.direction)) {
      throw new DungeonRasterError(`Platte auf ${key} steht vor einem Durchgang.`);
    }
    const behind = cells.get(cellKey(neighbourCell(seal.cell, seal.direction)));
    if (!behind) continue; // Zeile 5: Fels — der Regelfall
    const facing = states.get(cellKey(behind.cell))![OPPOSITE_DIRECTION[seal.direction]];
    // Zeile 4 (Teilwand) und Zeile 2 (Rücken an Rücken) sind die beiden
    // Fälle, in denen ein Plattenkörper in einer belegten Zelle liegen
    // DARF. Alles andere ist der Befund von G1.
    if (facing !== 'wallPartial' && facing !== 'open') {
      throw new DungeonRasterError(
        `Platte auf ${key} liegt im Körper von '${behind.module}' (Kante '${facing}').`
      );
    }
  }

  // Und die Gegenrichtung: keine offene Kante ohne Durchgang und ohne Platte.
  for (const c of plan.cells) {
    const mine = states.get(cellKey(c.cell))!;
    for (const d of DIRECTIONS) {
      if (mine[d] !== 'open' || c.edges.includes(d) || c.entrancePort === d) continue;
      if (!sealed.has(`${cellKey(c.cell)}#${d}`)) {
        throw new DungeonRasterError(`Zelle ${cellKey(c.cell)}: Kante ${d} ist offen und unversiegelt.`);
      }
    }
  }

  // ── S8: Torbögen und Schleifen ─────────────────────────────────────
  // Ein Rahmen auf einer Kante ohne Durchgang wäre ein Torbogen vor einer
  // Wand — im Grab dasselbe Bild wie Mikes Befund, nur andersherum.
  const framed = new Set<string>();
  for (const arch of plan.archways) {
    const key = edgeKey(arch);
    if (framed.has(key)) throw new DungeonRasterError(`Zwei Torbögen auf derselben Kante ${key}.`);
    framed.add(key);
    const host = cells.get(cellKey(arch.cell));
    if (!host || !host.edges.includes(arch.direction)) {
      throw new DungeonRasterError(`Torbogen auf ${key} steht auf keiner Graphkante.`);
    }
    // Beide Schreibweisen prüfen: `sealed` ist EINSEITIG (die Zelle, vor
    // deren Öffnung die Platte steht), `key` kanonisch. Nur die eine
    // Seite zu fragen hiesse, die Hälfte der Fälle zu übersehen.
    const back = `${cellKey(neighbourCell(arch.cell, arch.direction))}#${OPPOSITE_DIRECTION[arch.direction]}`;
    if (sealed.has(key) || sealed.has(back)) {
      throw new DungeonRasterError(`Torbogen und Platte auf derselben Kante ${key}.`);
    }
  }
  // Und die Schleifen: Sie MÜSSEN in den Kanten der beiden Zellen stehen
  // — eine Schleife, die nur in der Liste steht, wäre eine Zahl ohne
  // Grundriss dahinter.
  for (const loop of plan.loops) {
    const a = cells.get(cellKey(loop.cell));
    const b = cells.get(cellKey(neighbourCell(loop.cell, loop.direction)));
    if (!a?.edges.includes(loop.direction) || !b?.edges.includes(OPPOSITE_DIRECTION[loop.direction])) {
      throw new DungeonRasterError(`Schleifenkante ${edgeKey(loop)} ist im Grundriss kein Durchgang.`);
    }
  }
}

/**
 * Der deterministische Rückfall (S10).
 *
 * Eingang plus Platten auf allen Kanten ausser dem Eingangsport — ein
 * winziges, aber vollständiges und begehbares Grab. Bewusst OHNE Saat:
 * Ein Neu-Würfeln nach einem Programmfehler wäre der Determinismusbruch,
 * den der ganze Pfad vermeiden soll (Vorbild `dungeon2/generator.ts`).
 */
export function fallbackGridLayout(def: DungeonDef): DungeonLayout {
  const entranceDef = def.rooms.find((r) => r.entrance);
  if (!entranceDef) throw new DungeonRasterError(`Kit '${def.name}' hat keinen Eingangsraum.`);
  const module = gridModuleFromRoomDef(entranceDef);
  const anchor = module.anchor;
  if (!anchor) throw new DungeonRasterError(`'${entranceDef.name}' hat keinen Eingangsconnector.`);
  const yaw = YAWS.find((y) => rotateDirection(anchor.direction, y) === ENTRANCE_PORT_DIRECTION);
  if (yaw === undefined) throw new DungeonRasterError(`Eingangsport von '${entranceDef.name}' passt auf keine Gierung.`);
  const states = worldEdgeStates(module, yaw);
  const plan: GridPlan = {
    cells: [
      {
        cell: ENTRANCE_CELL,
        module: entranceDef.name,
        yaw,
        depth: 0,
        edges: [],
        entrancePort: ENTRANCE_PORT_DIRECTION,
      },
    ],
    seals: DIRECTIONS.filter((d) => states[d] === 'open' && d !== ENTRANCE_PORT_DIRECTION).map((d) => ({
      cell: ENTRANCE_CELL,
      direction: d,
    })),
    // Eine einzelne Zelle hat keine Nachbarn — also weder eine Schleife
    // noch eine Kante, auf die ein Torbogen gehörte.
    loops: [],
    archways: [],
  };
  return layoutFromPlan(def, plan);
}

/**
 * Der Rasterpfad: aus Kit und Saat ein `DungeonLayout` — Format
 * unverändert, Weg neu.
 *
 * `generateDungeonLayout` bleibt unangetastet; welcher Weg für ein Kit
 * gilt, entscheidet ab G8 ein Verteiler. Bis dahin ruft nur an, wer den
 * neuen Weg ausdrücklich will (Messskript, Tests).
 */
export function generateGridLayout(
  def: DungeonDef,
  seed: number,
  settingsIn?: Partial<GridSettings>,
  options?: GridGeneratorOptions
): DungeonLayout {
  try {
    const plan = planGridDungeon(def, seed, settingsIn);
    selfCheck(def, plan);
    return layoutFromPlan(def, plan);
  } catch (error) {
    if (options?.strict) throw error;
    return fallbackGridLayout(def);
  }
}
