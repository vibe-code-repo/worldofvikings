/**
 * Rastergenerator des Modul-Kits — Meilensteine G3…G7 der Konzeptnotiz
 * „Modul-Generierung 2.0-Logik“.
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * G2 hat jedes Modul dazu gebracht, sich selbst zu beschreiben — in
 * MODUL-lokalen Zellen. Hier bekommt diese Beschreibung einen Ort in der
 * Welt: Welche Weltzelle belegt ein platziertes Modul, wo liegt die Mitte
 * einer Zellkante, und welche `PlacedRoom`-Pose gehört zu einer Zelle und
 * einer Gierung (G3). Darauf steht der Generator selbst: Zellmenge,
 * Spannbaum, Modulwahl und Versiegelung (G4), Schleifen und Torbögen
 * (G5), der Stempel — EIN Modul über MEHRERE Zellen (G6) — und die
 * Treppe, EIN Modul über mehrere EBENEN (G7).
 *
 * ── Raum und Zelle sind seit G6 zweierlei ────────────────────────────
 * Bis G5 waren sie dasselbe: ein Modul, eine Zelle, eine Kantentafel.
 * Der Stempel trennt sie. Der GRAPH läuft weiter auf Zellen (auch die
 * vier Zellen einer Halle sind untereinander verbunden — man kann
 * zwischen ihnen gehen), die PLATZIERUNG läuft auf Räumen. Wer die
 * beiden verwechselt, baut die Halle viermal übereinander oder legt sie
 * eine Zelle neben ihre eigenen Türen; beides wirft keine Ausnahme.
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
import { DEFAULT_GENERATOR_SETTINGS, generateDungeonLayout } from './dungeonGenerator.js';
import type { DungeonGeneratorSettings } from './dungeonGenerator.js';
import {
  DIRECTIONS,
  DIRECTION_VECTOR,
  GRID_Z_OFFSET_M,
  MODULE_CELL_M,
  MODULE_LEVEL_M,
  OPPOSITE_DIRECTION,
  cellKey,
  cellToWorld,
  compareCells,
  directionFromVector,
  edgeCenterWorld,
  gridModuleFromRoomDef,
  isHorizontal,
  neighbourCell,
  worldToCell,
  type Direction,
  type EdgeState,
  type GridCell,
  type GridModule,
} from './dungeonRasterModul.js';
/**
 * Die Raster-Weltabbildung steht seit G9 in `dungeonRasterModul.ts` —
 * `attachRoom` braucht sie, und `dungeonGenerator.ts` darf diese Datei
 * nicht importieren (sie importiert jene). Weitergereicht wird sie hier
 * unter denselben Namen, damit kein Aufrufer und kein Test etwas merkt.
 */
export {
  GRID_Z_OFFSET_M,
  cellKey,
  cellToWorld,
  compareCells,
  edgeCenterWorld,
  neighbourCell,
  worldToCell,
  type GridCell,
};
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
// ── Zwei Arten von Stempel ───────────────────────────────────────────
// Die Halle (2 × 2, eine Ebene) und die Treppe (3 Zellen auf ZWEI Ebenen)
// werden beide VOR dem Kantenausbau reserviert (S3), statt aus einem
// Öffnungsmuster gewählt zu werden. Sie unterscheiden sich in dem, was
// ihre Aussenhaut zulässt: Die Halle ist auf allen acht Aussenkanten
// offen und lässt sich deshalb in irgendeinen freien 2 × 2-Block legen.
// Die Treppe hat genau ZWEI Öffnungen, alles andere ist Keilflanke
// (`wallPartial`) — ihre Lage ist damit nicht gesucht, sondern bestimmt,
// und weil ihr fernes Ende sonst zugemauert würde, bringt sie ihre
// Landezelle mit. Die drei Zellen ihrer Gegenebene sind gesperrt, weil sie
// sie SELBST belegt: Der Luftraum über dem Lauf gehört zur Treppe.
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
const SALT_STAMP = 0x7374616d; // 'stam'
const SALT_STAMP_PICK = 0x73747069; // 'stpi'
const SALT_STAMP_YAW = 0x73747961; // 'stya'
const SALT_STAMP_BLOCK = 0x7374626c; // 'stbl'
const SALT_STAIR = 0x73746169; // 'stai'
const SALT_STAIR_PICK = 0x7374706b; // 'stpk'
const SALT_STAIR_SIDE = 0x73747364; // 'stsd'

/**
 * Die vier waagerechten Kanten.
 *
 * Gewachsen wird nur waagerecht — auch mit G7. Die Ebene wechselt man
 * nicht, indem eine Zelle nach oben wächst, sondern indem eine TREPPE
 * gesetzt wird, die beide Ebenen zugleich belegt. Ein senkrechter
 * Wachstumsschritt hätte kein Modul, das ihn trüge.
 */
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
  /**
   * Anteil der wachsenden Zellen, an denen statt einer Einzelzelle ein
   * STEMPEL versucht wird (0…1) — G6, in der Konzeptnotiz `hallAnteil`.
   *
   * Ein Versuch, keine Zusage: Der Stempel braucht vier freie Zellen im
   * Block und einen freien Kranz darum (s. {@link growCells}). Die Zahl
   * ist deshalb bewusst höher als der Anteil der Hallen, der am Ende im
   * Grundriss steht.
   *
   * Warum überhaupt selten: Die Halle belegt die vierfache Fläche einer
   * Zelle. Ein hoher Wert macht aus der Krypta eine Halle mit Gängen
   * daran statt aus Gängen eine Krypta mit Sälen — dieselbe Begründung
   * wie beim `weight: 1` der Halle im Kit.
   */
  readonly hallFraction: number;
  /**
   * Anteil der wachsenden Zellen, an denen eine TREPPE versucht wird
   * (0…1) — G7, in der Konzeptnotiz `treppenAnteil`.
   *
   * Ein eigener Regler neben {@link hallFraction}, obwohl beides Stempel
   * sind: Die Treppe kostet sechs Zellen plus die Landezelle, sperrt eine
   * ganze Gegenebene und ist das einzige Modul, das den Grundriss in die
   * Höhe zieht. Wer weniger Treppenhaus und mehr Saal will (oder
   * umgekehrt), müsste sonst beides zugleich verstellen.
   *
   * Die Zahl ist ein VERSUCH, keine Zusage: Die Treppe braucht sechs
   * freie Zellen auf zwei Ebenen, einen freien Kranz darum und eine
   * freie Landezelle am oberen Ende (s. {@link growCells}). Deshalb liegt
   * sie deutlich über dem Anteil der Treppen, der am Ende im Grundriss
   * steht.
   */
  readonly stairFraction: number;
}

/**
 * Vorgaben der Regler (Konzeptnotiz, Mikes Ergänzung 04.09.2026).
 *
 * `hallFraction` ist gemessen und nicht geschätzt: Über die 40 Saaten der
 * Stichprobe ergeben 0,02 → 14 Hallen in 14 Saaten, 0,08 → 69 in 36,
 * 0,20 → 159 in 40. Die Abnahme des Meilensteins verlangt „Halle in ≥ 10
 * von 40"; 0,08 hält das mit Abstand und lässt den Gang-Anteil bei
 * 73,7 % — weit über der Dichtegrenze von 40 % aus den Risiken.
 *
 * `stairFraction` ebenso, über dieselben 40 Saaten (G7): 0,02 → 21
 * Treppen in 17 Saaten, 0,04 → 41 in 25, 0,06 → 60 in 36, 0,10 → 84 in
 * 40. Verlangt ist „Treppe in ≥ 5 von 40"; 0,04 hält das mit grossem
 * Abstand und ergibt rund EINEN Lauf je Grundriss. Höher ist die Krypta
 * ein Treppenhaus: Ein Lauf kostet sechs der sechzig Zellen, bei 0,10
 * sind 21 % der Fläche Treppe und der Gang-Anteil fällt von 64,8 % auf
 * 54,9 %.
 */
export const DEFAULT_GRID_TUNING: GridTuning = {
  loopFraction: 0.35,
  archwayFraction: 0.25,
  hallFraction: 0.08,
  stairFraction: 0.04,
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

/**
 * Ein platziertes Modul: ein RAUM, nicht eine Zelle.
 *
 * Die Unterscheidung entsteht mit G6. Bis dahin waren beide dasselbe —
 * jedes Modul belegte genau eine Zelle, und `GridPlanCell` konnte für
 * sich stehen. Ein Stempel (die Halle, 2 × 2) trägt vier Zellen und
 * genau EINE `PlacedRoom`-Zeile; wer weiter je Zelle ein Modul setzte,
 * baute die Halle viermal übereinander.
 */
export interface GridPlanRoom {
  /**
   * Die ANKERZELLE — dort liegt die lokale Zelle (0,0,0) des Moduls.
   * Bei gerader Zellzahl wandert sie mit der Gierung durch die Ecken des
   * Fussabdrucks; wer eine Zellmenge braucht, liest {@link cells}.
   */
  readonly cell: GridCell;
  /** Name des gewählten Moduls (`RoomDef.name`). */
  readonly module: string;
  readonly yaw: Yaw;
  /** Kleinste BFS-Tiefe seiner Zellen; `placeOrder` ist das plus 1. */
  readonly depth: number;
  /**
   * Alle belegten Weltzellen, kanonisch sortiert — aus
   * {@link moduleWorldCells} zurückgerechnet, nie getippt. Genau das ist
   * die Forderung des Meilensteins: Eine Tafel „Port 3 liegt auf Zelle 2“
   * stimmt unter einer Gierung und schweigt unter den anderen drei.
   */
  readonly cells: readonly GridCell[];
}

/** Eine Zelle des fertigen Plans. */
export interface GridPlanCell {
  readonly cell: GridCell;
  /** Name des Moduls, das diese Zelle trägt (`RoomDef.name`). */
  readonly module: string;
  readonly yaw: Yaw;
  /** BFS-Tiefe ab dem Eingang; `placeOrder` ist das plus 1. */
  readonly depth: number;
  /**
   * Graphkanten dieser Zelle in Weltrichtung, kanonisch sortiert.
   *
   * Die Innenkanten eines Stempels stehen mit drin: Die vier Zellen einer
   * Halle sind untereinander begehbar, und wer sie hier wegliesse, müsste
   * jede Auswertung (Versiegelung, Erreichbarkeit, Doppelwandzählung) um
   * einen Sonderfall erweitern, den es geometrisch nicht gibt.
   */
  readonly edges: readonly Direction[];
  /** Beim Eingangsraum die Richtung nach draussen, sonst null. */
  readonly entrancePort: Direction | null;
  /** Index des Raums in {@link GridPlan.rooms}, der diese Zelle trägt. */
  readonly room: number;
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
  /**
   * Die platzierten Module in BFS-Reihenfolge ab dem Eingang;
   * `rooms[0]` ist der Eingang. Ein Stempel steht hier EINMAL, seine
   * Zellen stehen viermal in {@link cells}.
   */
  readonly rooms: readonly GridPlanRoom[];
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
 * Derselbe Wurf für eine ZELLE statt einer Kante (S1/S3).
 *
 * Der Grund ist derselbe wie bei {@link edgeRoll} und in diesem
 * Meilenstein noch handfester: Ob an einer Stelle eine Halle steht, darf
 * nicht davon abhängen, als wievielte Zelle sie gewachsen ist. Käme der
 * Wurf aus dem Wachstumsstrom, verschöbe ein einziger zusätzlicher
 * Versuch jede spätere Halle — und ein Regler auf 0 lieferte einen
 * anderen Grundriss als der G5-Stand, obwohl er nichts stempelt.
 */
function cellRoll(cell: GridCell, seed: number, salt: number): number {
  return hashPos(cell.i, cell.j, cell.level, mische(seed, salt)) / 0x1_0000_0000;
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
  /** Richtung ZUM Elter — null beim Eingang und in einem Stempel. Grundlage der Trägheit. */
  readonly toParent: Direction | null;
  /** Graphkanten (Spannbaum, Stempel-Innenkanten, ab S4 auch Schleifen). */
  readonly edges: Set<Direction>;
  readonly entrance: boolean;
  /** Index in {@link GrowthResult.stamps}, wenn diese Zelle zu einem Stempel gehört. */
  readonly stamp: number | null;
  /**
   * Die Weltrichtungen, in denen diese Zelle überhaupt noch eine
   * Graphkante bekommen KANN — `null` heisst „jede waagerechte“.
   *
   * Bis G6 brauchte es das Feld nicht: Eine Einzelzelle wählt ihr Modul
   * erst NACH dem Kantenausbau (S5) und kann sich jedem Muster fügen, und
   * die Halle ist auf allen acht Aussenkanten offen. Die Treppe ist das
   * erste Modul, dessen Aussenhaut fast ganz zu ist: Sie hat genau zwei
   * Öffnungen, alles andere ist Keilflanke. Ohne diese Menge wüchse ein
   * Gang an ihre Flanke und der Graph behauptete einen Durchgang, wo im
   * GLB eine Wand steht — genau Mikes Befund, nur an einem neuen Modul.
   */
  readonly open: ReadonlySet<Direction> | null;
}

/** Ein reservierter Stempel: ein mehrzelliges Modul mit seinem Platz (S3). */
interface GrowthStamp {
  readonly def: RoomDef;
  readonly module: GridModule;
  /** Zelle, auf der die lokale Zelle (0,0,0) liegt — aus der Rückrechnung gesucht. */
  readonly anchor: GridCell;
  readonly yaw: Yaw;
  /** Die belegten Weltzellen, kanonisch sortiert. */
  readonly cells: readonly GridCell[];
}

/**
 * Ein gefundener Platz für einen Stempel — und was er sonst noch belegt.
 *
 * `landing` ist der Unterschied zwischen Saal und Treppe: Der Saal steht
 * für sich, die Treppe bringt die Zelle an ihrem fernen Ende mit. Ohne
 * sie endete jeder zweite Lauf oben vor einer Abschlussplatte.
 */
interface StampSpot {
  readonly stamp: GrowthStamp;
  /** Die mitreservierte Zelle und die Richtung von ihr ZUM Stempel. */
  readonly landing: { readonly cell: GridCell; readonly from: Direction } | null;
}

interface GrowthResult {
  readonly cells: Map<string, GrowthCell>;
  readonly stamps: readonly GrowthStamp[];
}

/** Ein mehrzelliges Modul, das als Stempel in Frage kommt. */
interface StampOption {
  readonly def: RoomDef;
  readonly module: GridModule;
}

/**
 * Die Stempel des Kits (S3) — mehrzellig, EINE Ebene, Aussenhaut ganz
 * offen.
 *
 * Gesucht, nicht beim Namen genannt: Ein Kit mit einem zweiten Saal
 * bekäme ihn sonst nie zu sehen. Die drei Bedingungen sind allerdings
 * eng, und jede hat einen Grund:
 *  • **mehrzellig** — einzellige Module wählt S5 über das Öffnungsmuster;
 *    ein Stempel wird VOR dem Kantenausbau reserviert.
 *  • **eine Ebene** — die Treppe belegt drei Zellen auf zwei Ebenen und
 *    sperrt die Gegenebene. Das ist G7 und nicht dasselbe Problem.
 *  • **Aussenhaut ganz offen** — nur dann ist die Gierung für den PLATZ
 *    gleichgültig, und der Stempel lässt sich reservieren, bevor
 *    feststeht, wo seine Nachbarn liegen. Ein Saal mit eingebauter Wand
 *    müsste seine Gierung schon beim Wachsen aus der Nachbarschaft
 *    ableiten — ein eigener Meilenstein, kein Zusatz hier.
 */
function stampModuleOptions(def: DungeonDef): StampOption[] {
  const out: StampOption[] = [];
  for (const room of def.rooms) {
    if (room.endCap || room.entrance) continue;
    const module = gridModuleFromRoomDef(room);
    if (module.cells.length <= 1 || module.levels !== 1) continue;
    const openSkin = module.cells.every((c) =>
      HORIZONTAL_DIRECTIONS.every((d) => c.interior[d] || c.edges[d] === 'open')
    );
    if (!openSkin) continue;
    out.push({ def: room, module });
  }
  return out;
}

/**
 * Die EBENENwechsler des Kits (S3/G7) — mehrzellig über mehr als eine
 * Ebene, mit genau zwei Öffnungen auf zwei verschiedenen Ebenen.
 *
 * Auch hier gesucht statt beim Namen genannt. Die Bedingungen sind eng,
 * und jede steht für eine Eigenschaft, auf die sich {@link growCells}
 * verlässt:
 *  • **mehr als eine Ebene** — sonst ist es ein Saal und gehört zu
 *    {@link stampModuleOptions}.
 *  • **genau zwei Ports** — die Treppe wird an EINEM Ende angehängt und
 *    bringt ihr anderes Ende als Landezelle mit. Bei drei Öffnungen wäre
 *    nicht mehr entschieden, welche davon das „andere Ende“ ist.
 *  • **Ports auf verschiedenen Ebenen** — ein zweistöckiges Modul, das
 *    unten hinein- und unten wieder hinausführt, wechselt keine Ebene;
 *    seine obere Zellreihe wäre reiner Luftraum.
 *  • **eine senkrechte Innenkante offen** — der Punkt, an dem der Lauf die
 *    Ebenengrenze überschreitet. Ohne ihn hinge die Treppenspitze im
 *    Graphen an nichts, und das fällt in keiner Zählung auf, sondern erst,
 *    wenn eine Figur oben in der Sackgasse steht.
 */
function stairModuleOptions(def: DungeonDef): StampOption[] {
  const out: StampOption[] = [];
  for (const room of def.rooms) {
    if (room.endCap || room.entrance) continue;
    const module = gridModuleFromRoomDef(room);
    if (module.cells.length <= 1 || module.levels < 2) continue;
    if (module.ports.length !== 2) continue;
    const levels = new Set(module.ports.map((p) => module.cells[p.cell]!.level));
    if (levels.size !== 2) continue;
    const climbs = module.cells.some((c) =>
      DIRECTIONS.some((d) => !isHorizontal(d) && c.interior[d] && c.edges[d] === 'open')
    );
    if (!climbs) continue;
    out.push({ def: room, module });
  }
  return out;
}

/**
 * Die Kanten eines platzierten Stempels, getrennt nach innen und aussen.
 *
 * `inner` sind seine GRAPHkanten: Die Zellen eines Stempels hängen
 * zusammen, und bei der Treppe gehört der Ebenenwechsel dazu. `outer`
 * sind die Richtungen, in denen von aussen noch etwas andocken kann.
 *
 * Beides kommt aus {@link moduleWorldEdgeStates} und
 * {@link moduleWorldCells}, nicht aus einer Fallunterscheidung „Halle
 * waagerecht, Treppe auch senkrecht“: Eine getippte Regel stimmte für das
 * eine Modul und schwiege beim nächsten.
 */
function stampEdges(
  anchor: GridCell,
  yaw: Yaw,
  module: GridModule
): { inner: Map<string, Set<Direction>>; outer: Map<string, Set<Direction>> } {
  const cells = moduleWorldCells(anchor, yaw, module);
  const footprint = new Set(cells.map(cellKey));
  const states = moduleWorldEdgeStates(anchor, yaw, module);
  const inner = new Map<string, Set<Direction>>();
  const outer = new Map<string, Set<Direction>>();
  for (const cell of cells) {
    const key = cellKey(cell);
    const rec = states.get(key);
    if (!rec) throw new DungeonRasterError(`Modul '${module.name}' erklärt die Zelle ${key} nicht.`);
    const inside = new Set<Direction>();
    const outside = new Set<Direction>();
    for (const d of DIRECTIONS) {
      if (rec[d] !== 'open') continue;
      if (footprint.has(cellKey(neighbourCell(cell, d)))) inside.add(d);
      else outside.add(d);
    }
    inner.set(key, inside);
    outer.set(key, outside);
  }
  return { inner, outer };
}

/**
 * Die Ausdehnung eines Stempels in Weltzellen unter einer Gierung —
 * gemessen an der Rückrechnung, nicht aus `cellsX`/`cellsZ` getippt.
 *
 * Der Unterschied fällt erst bei einem nicht quadratischen Stempel auf:
 * Unter 90° tauschen x und z die Rollen, und eine getippte Zeile stünde
 * dann quer zum eigenen Fussabdruck.
 */
function stampExtent(module: GridModule, yaw: Yaw): { sx: number; sz: number } {
  const probe = moduleWorldCells({ i: 0, j: 0, level: 0 }, yaw, module);
  const is = probe.map((c) => c.i);
  const js = probe.map((c) => c.j);
  return {
    sx: Math.max(...is) - Math.min(...is) + 1,
    sz: Math.max(...js) - Math.min(...js) + 1,
  };
}

/** Alle achsparallelen Blöcke `sx × sz`, die `cell` enthalten — kanonisch geordnet. */
function blocksContaining(cell: GridCell, sx: number, sz: number): GridCell[][] {
  const out: GridCell[][] = [];
  for (let oz = 0; oz < sz; oz++) {
    for (let ox = 0; ox < sx; ox++) {
      const block: GridCell[] = [];
      for (let dz = 0; dz < sz; dz++) {
        for (let dx = 0; dx < sx; dx++) {
          block.push({ i: cell.i - ox + dx, j: cell.j - oz + dz, level: cell.level });
        }
      }
      out.push(block.sort(compareCells));
    }
  }
  return out;
}

/**
 * Die Ankerzelle, mit der ein Modul unter `yaw` GENAU diesen Block
 * belegt — oder null.
 *
 * Gesucht statt gerechnet, und das ist der Kern des Meilensteins: Der
 * Anker ist die lokale Zelle (0,0,0), und die wandert bei gerader
 * Zellzahl mit der Gierung durch die vier Ecken. Eine Formel dafür wäre
 * eine zweite Wahrheit neben {@link moduleWorldCells}; hier wird
 * dieselbe Rückrechnung befragt, die später den Fussabdruck liefert.
 */
function stampAnchorFor(block: readonly GridCell[], yaw: Yaw, module: GridModule): GridCell | null {
  const want = block.map(cellKey).join(',');
  for (const candidate of block) {
    if (moduleWorldCells(candidate, yaw, module).map(cellKey).join(',') === want) return candidate;
  }
  return null;
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
  // Ein Stempel fordert nichts frei. Beim Saal, weil die Tafel jede seiner
  // acht offenen Kanten versorgt — gegen Fels mit einer Platte, gegen die
  // eingebaute Wand eines Nachbarn mit gar nichts (Zeile 3). Bei der
  // Treppe, weil ihre Aussenhaut bis auf die zwei Enden Keilflanke ist
  // (Zeile 6: gar nichts) und beide Enden beim Setzen einen Durchgang
  // bekommen — der eine zum Elter, der andere zur Landezelle. Keiner von
  // beiden hat ein „überzähliges" Loch, das auf Fels zeigen müsste.
  if (cell.stamp !== null) return [];
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
  bounded: boolean,
  stampOptions: readonly StampOption[],
  hallFraction: number,
  stairOptions: readonly StampOption[],
  stairFraction: number
): GrowthResult {
  const rng = new XorShiftRandom(mische(seed, SALT_GROWTH));
  const cells = new Map<string, GrowthCell>();
  const stamps: GrowthStamp[] = [];
  const entrance: GrowthCell = {
    cell: ENTRANCE_CELL,
    key: cellKey(ENTRANCE_CELL),
    toParent: null,
    edges: new Set<Direction>(),
    entrance: true,
    stamp: null,
    open: null,
  };
  cells.set(entrance.key, entrance);

  // Die Zelle hinter dem Eingangsport ist für immer gesperrt: Dort geht
  // es nach draussen. Ein Raum darin wäre ein Zimmer im Zugangsstollen.
  const blocked = cellKey(neighbourCell(ENTRANCE_CELL, ENTRANCE_PORT_DIRECTION));

  /** Ist die Zelle noch zu haben — leer, nicht der Zugangsstollen, in der Zone? */
  const isFree = (cell: GridCell): boolean => {
    const key = cellKey(cell);
    if (key === blocked || cells.has(key)) return false;
    return !bounded || cellInsideZone(cell, zoneHalf);
  };

  /**
   * Nähme eine neue Zelle auf `cell` einem stehenden Nachbarn seine
   * Pflichtkante? `except` ist der Elter — er BEKOMMT die Kante.
   */
  const stealsRequired = (cell: GridCell, except: string | null): boolean => {
    for (const nd of HORIZONTAL_DIRECTIONS) {
      const other = cells.get(cellKey(neighbourCell(cell, nd)));
      if (!other || other.key === except) continue;
      if (requiredFreeDirections(other).includes(OPPOSITE_DIRECTION[nd])) return true;
    }
    return false;
  };

  /** Darf an `parent` in Richtung `d` eine Zelle wachsen? */
  const mayGrow = (parent: GrowthCell, d: Direction): boolean => {
    // Ein Stempel wächst nur aus seinen eigenen Öffnungen heraus. Die
    // Treppe hat davon zwei, alles andere an ihr ist Keilflanke.
    if (parent.open !== null && !parent.open.has(d)) return false;
    const candidate = neighbourCell(parent.cell, d);
    if (!isFree(candidate)) return false;
    // Die neue Zelle ist ein Blatt: Ihre Fortsetzung geradeaus muss frei
    // bleiben, damit sie ihre überzählige Öffnung auf Fels legen kann.
    if (cells.has(cellKey(neighbourCell(candidate, d)))) return false;
    // Und kein bereits stehender Nachbar darf durch sie seine Pflichtkante
    // verlieren.
    return !stealsRequired(candidate, parent.key);
  };

  /**
   * S3 — der Stempelversuch an der Zelle, die gerade wachsen würde.
   *
   * ── Warum ein Kranz frei sein muss ─────────────────────────────────
   * Jede Aussenkante des Stempels ist offen. Stünde beim Setzen schon ein
   * Nachbar daran, hätte niemand geprüft, ob dessen Kante dazu passt —
   * genau die Reihenfolge („erst das Modul, dann die Nachbarschaft"), die
   * der ganze Umbau abschafft. Umgekehrt ist eine Zelle, die SPÄTER
   * daneben wächst, unbedenklich: Sie wählt ihr Modul nach S5, und dort
   * darf eine überzählige Öffnung nur auf Fels zeigen — gegen den Stempel
   * steht danach immer eine eingebaute Wand (Zeile 3 der Tafel).
   *
   * Der einzige erlaubte Nachbar im Kranz ist der Elter: Er bekommt die
   * Anhängekante und ist damit ein Durchgang, keine stumme Berührung.
   *
   * Die Vorbedingung von `mayGrow` gilt weiter — der Versuch läuft an
   * einer Richtung, die dort schon durchgekommen ist. Für einen Stempel
   * ist das strenger als nötig (er braucht kein freies „geradeaus"),
   * kostet aber nur Gelegenheiten und lässt die Ziehreihenfolge des
   * Wachstums unverändert. Ein eigener Auswahlweg für Stempel wäre ein
   * zweiter Saatvertrag neben dem bestehenden.
   */
  const tryStamp = (parent: GrowthCell, toChild: Direction): StampSpot | null => {
    if (stampOptions.length === 0 || !(hallFraction > 0)) return null;
    const child = neighbourCell(parent.cell, toChild);
    if (cellRoll(child, seed, SALT_STAMP) >= hallFraction) return null;
    const option =
      stampOptions[
        Math.min(
          stampOptions.length - 1,
          Math.floor(cellRoll(child, seed, SALT_STAMP_PICK) * stampOptions.length)
        )
      ]!;
    // Über das Ziel hinaus wird nicht gestempelt: `maxRooms` bedeutet im
    // Rasterpfad ZELLZAHL, und vier auf einmal reissen die Bilanz sonst
    // um bis zu drei Zellen auf.
    if (cells.size + option.module.cells.length > target) return null;
    const yaw = YAWS[Math.min(YAWS.length - 1, Math.floor(cellRoll(child, seed, SALT_STAMP_YAW) * YAWS.length))]!;
    const { sx, sz } = stampExtent(option.module, yaw);
    const blocks = blocksContaining(child, sx, sz);
    const start = Math.min(
      blocks.length - 1,
      Math.floor(cellRoll(child, seed, SALT_STAMP_BLOCK) * blocks.length)
    );
    for (let n = 0; n < blocks.length; n++) {
      const block = blocks[(start + n) % blocks.length]!;
      const inBlock = new Set(block.map(cellKey));
      let ok = true;
      for (const c of block) {
        const key = cellKey(c);
        if (key === blocked || cells.has(key)) ok = false;
        else if (bounded && !cellInsideZone(c, zoneHalf)) ok = false;
        if (!ok) break;
      }
      if (!ok) continue;
      for (const c of block) {
        for (const d of HORIZONTAL_DIRECTIONS) {
          const key = cellKey(neighbourCell(c, d));
          if (inBlock.has(key)) continue;
          const other = cells.get(key);
          if (other !== undefined && other !== parent) ok = false;
          if (!ok) break;
        }
        if (!ok) break;
      }
      if (!ok) continue;
      const anchor = stampAnchorFor(block, yaw, option.module);
      if (anchor === null) continue;
      // Der Saal bringt nichts mit: Seine Aussenhaut ist ganz offen, jede
      // seiner Kanten versorgt die Tafel (gegen Fels mit einer Platte,
      // gegen eine eingebaute Nachbarwand mit gar nichts).
      return { stamp: { def: option.def, module: option.module, anchor, yaw, cells: block }, landing: null };
    }
    return null;
  };

  /**
   * S3/G7 — der Treppenversuch an der Zelle, die gerade wachsen würde.
   *
   * ── Was hier anders ist als beim Saal ──────────────────────────────
   * Die Halle ist auf allen Aussenkanten offen; ihre Gierung ist für den
   * PLATZ deshalb gleichgültig, und sie lässt sich in irgendeinen freien
   * 2 × 2-Block legen. Die Treppe hat genau zwei Öffnungen. Ihre Lage ist
   * damit nicht gesucht, sondern BESTIMMT: Einer ihrer beiden Ports muss
   * auf der Zelle sitzen, die gerade wachsen würde, und zum Elter
   * zurückschauen. Beide Ports kommen dafür in Frage — über den unteren
   * betreten führt sie hinauf, über den oberen hinunter.
   *
   * ── Warum die Landezelle mitreserviert wird ────────────────────────
   * Am fernen Ende steht sonst nach der Kantentafel eine Platte (Zeile 5,
   * Fels). Im Graphen ist das tadellos — im Grab steigt man eine Treppe
   * hinauf und steht vor einer Wand. Der Meilenstein verlangt „0 Treppen
   * mit unversorgtem Anschluss“; versorgt heisst hier BEGEHBAR, nicht
   * zugemauert. Die Landezelle ist deshalb Teil des Versuchs: Findet sich
   * kein Platz für sie, wird die Treppe nicht gebaut.
   *
   * ── Warum der Kranz auch hier frei sein muss ───────────────────────
   * Dieselbe Begründung wie beim Saal, s. {@link growCells}: Ein Nachbar,
   * der beim Setzen schon dastand, hat nie geprüft, ob seine Kante zur
   * Keilflanke passt. Wer SPÄTER daneben wächst, wählt sein Modul nach S5
   * und kehrt der Flanke eine eingebaute Wand zu.
   */
  const tryStairs = (parent: GrowthCell, toChild: Direction): StampSpot | null => {
    if (stairOptions.length === 0 || !(stairFraction > 0)) return null;
    const child = neighbourCell(parent.cell, toChild);
    if (cellRoll(child, seed, SALT_STAIR) >= stairFraction) return null;
    const option =
      stairOptions[
        Math.min(
          stairOptions.length - 1,
          Math.floor(cellRoll(child, seed, SALT_STAIR_PICK) * stairOptions.length)
        )
      ]!;
    // Sechs Zellen und die Landezelle: `maxRooms` heisst im Rasterpfad
    // ZELLZAHL, und ein Lauf, der die Bilanz sprengt, wird nicht gebaut.
    if (cells.size + option.module.cells.length + 1 > target) return null;

    const back = OPPOSITE_DIRECTION[toChild];
    // Alle Lagen, in denen ein Port auf `child` sitzt und zum Elter
    // zurückschaut — über die Rückrechnung gesucht, nicht gerechnet: Die
    // Ankerzelle ist die lokale Zelle (0,0,0) und wandert mit der
    // Gierung. Die Verschiebung darf man abziehen, weil die Abbildung
    // Anker → Weltzellen eine reine Verschiebung ist.
    const probeAnchor: GridCell = { i: 0, j: 0, level: 0 };
    const spots: { anchor: GridCell; yaw: Yaw; far: GridPort }[] = [];
    for (const yaw of YAWS) {
      const probe = moduleWorldPorts(probeAnchor, yaw, option.module);
      for (const near of probe) {
        if (near.direction !== back) continue;
        const anchor: GridCell = {
          i: child.i - near.cell.i,
          j: child.j - near.cell.j,
          level: child.level - near.cell.level,
        };
        const ports = moduleWorldPorts(anchor, yaw, option.module);
        const here = ports.find((q) => q.connector === near.connector);
        const far = ports.find((q) => q.connector !== near.connector);
        if (!here || !far) continue;
        if (cellKey(here.cell) !== cellKey(child) || here.direction !== back) continue;
        spots.push({ anchor, yaw, far });
      }
    }
    if (spots.length === 0) return null;
    const start = Math.min(
      spots.length - 1,
      Math.floor(cellRoll(child, seed, SALT_STAIR_SIDE) * spots.length)
    );
    for (let n = 0; n < spots.length; n++) {
      const spot = spots[(start + n) % spots.length]!;
      const block = moduleWorldCells(spot.anchor, spot.yaw, option.module);
      if (!block.every(isFree)) continue;
      const inBlock = new Set(block.map(cellKey));
      let ok = true;
      for (const c of block) {
        for (const d of HORIZONTAL_DIRECTIONS) {
          const key = cellKey(neighbourCell(c, d));
          if (inBlock.has(key)) continue;
          const other = cells.get(key);
          if (other !== undefined && other !== parent) ok = false;
          if (!ok) break;
        }
        if (!ok) break;
      }
      if (!ok) continue;
      const landing = neighbourCell(spot.far.cell, spot.far.direction);
      if (inBlock.has(cellKey(landing)) || !isFree(landing)) continue;
      // Die Landezelle ist ein Blatt wie jede frisch gewachsene: geradeaus
      // muss frei bleiben, sonst hat ihre überzählige Öffnung kein Fels.
      if (cells.has(cellKey(neighbourCell(landing, spot.far.direction)))) continue;
      // Und sie darf den Lauf NUR am Port berühren — sonst stünde sie mit
      // einer offenen Kante an einer Keilflanke, ohne dass eine Graphkante
      // das erklärt.
      const touches = HORIZONTAL_DIRECTIONS.filter((d) =>
        inBlock.has(cellKey(neighbourCell(landing, d)))
      ).length;
      if (touches !== 1) continue;
      if (stealsRequired(landing, null)) continue;
      return {
        stamp: { def: option.def, module: option.module, anchor: spot.anchor, yaw: spot.yaw, cells: block },
        landing: { cell: landing, from: OPPOSITE_DIRECTION[spot.far.direction] },
      };
    }
    return null;
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

    // ── S3: erst der Saal, dann die Treppe, dann die Einzelzelle ─────
    // Die Reihenfolge ist ein Saatvertrag, keine Rangordnung: Stünde die
    // Treppe voran, verschöbe sich mit ihrem Regler auch jede Halle.
    const spot = tryStamp(current, chosen) ?? tryStairs(current, chosen);
    if (spot !== null) {
      const { stamp } = spot;
      const index = stamps.length;
      stamps.push(stamp);
      // Innen- und Aussenkanten aus der Rückrechnung, nicht aus einer
      // Fallunterscheidung je Modul: Die Innenkanten sind Graphkanten
      // (die Zellen EINES Raums hängen zusammen, bei der Treppe über die
      // Ebenengrenze hinweg), die Aussenkanten sind das, woran später noch
      // etwas andocken darf.
      const { inner, outer } = stampEdges(stamp.anchor, stamp.yaw, stamp.module);
      for (const c of stamp.cells) {
        const key = cellKey(c);
        cells.set(key, {
          cell: c,
          key,
          // Ein Saal hat keine Laufrichtung — die Trägheit gilt für
          // Gänge, und aus vier Ecken gleichzeitig gibt es kein
          // „geradeaus".
          toParent: null,
          edges: new Set<Direction>(inner.get(key)),
          entrance: false,
          stamp: index,
          open: outer.get(key) ?? new Set<Direction>(),
        });
      }
      cells.get(childKey)!.edges.add(OPPOSITE_DIRECTION[chosen]);
      for (const c of stamp.cells) frontier.push(cellKey(c));
      if (spot.landing !== null) {
        const landingKey = cellKey(spot.landing.cell);
        cells.set(landingKey, {
          cell: spot.landing.cell,
          key: landingKey,
          toParent: spot.landing.from,
          edges: new Set<Direction>([spot.landing.from]),
          entrance: false,
          stamp: null,
          open: null,
        });
        // Und die Gegenseite: Das ferne Ende des Laufs ist damit ein
        // Durchgang und keine Kante gegen Fels.
        cells
          .get(cellKey(neighbourCell(spot.landing.cell, spot.landing.from)))!
          .edges.add(OPPOSITE_DIRECTION[spot.landing.from]);
        frontier.push(landingKey);
      }
      continue;
    }

    cells.set(childKey, {
      cell: child,
      key: childKey,
      toParent: OPPOSITE_DIRECTION[chosen],
      edges: new Set<Direction>([OPPOSITE_DIRECTION[chosen]]),
      entrance: false,
      stamp: null,
      open: null,
    });
    frontier.push(childKey);
  }
  return { cells, stamps };
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
      if (c.open !== null && !c.open.has(d)) continue;
      const other = cells.get(cellKey(neighbourCell(c.cell, d)));
      if (!other) continue;
      // Beide Seiten müssen die Kante tragen können. Eine Schleife auf
      // eine Keilflanke wäre ein Durchgang durch eine Wand — dieselbe
      // Falle wie beim Wachsen, nur eine Phase später.
      if (other.open !== null && !other.open.has(OPPOSITE_DIRECTION[d])) continue;
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

/**
 * Die Kantenzustände eines platzierten Moduls, je Weltzelle und in
 * WELTrichtungen.
 *
 * Bis G5 war das eine Zeile: ein Modul, eine Zelle, `cells[0]`. Mit dem
 * Stempel ist genau diese Zeile die Falle — die vier Zellen einer Halle
 * haben VERSCHIEDENE Aussenkanten, und `cells[0]` beschreibt nur eine
 * davon. Deshalb liefert die Funktion eine Tafel über alle Zellen, und
 * die Zuordnung Zelle → Weltzelle kommt aus derselben Rückrechnung wie
 * der Fussabdruck ({@link moduleWorldCells}), nicht aus einer zweiten
 * Rechnung, die daneben liegen könnte.
 */
export function moduleWorldEdgeStates(
  cell: GridCell,
  yaw: Yaw,
  module: GridModule
): Map<string, Record<Direction, EdgeState>> {
  const { pos, rot } = modulePose(cell, yaw, module);
  const out = new Map<string, Record<Direction, EdgeState>>();
  for (const c of module.cells) {
    const rec = {} as Record<Direction, EdgeState>;
    for (const d of DIRECTIONS) rec[rotateDirection(d, yaw)] = c.edges[d];
    out.set(cellKey(worldToCell(toWorld(c.localCenter, pos, rot))), rec);
  }
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
 *
 * ── Warum Räume UND Zellen hereinkommen (G6) ─────────────────────────
 * Die Öffnungen gehören dem RAUM (ein Stempel hat acht, verteilt auf
 * vier Zellen), die Durchgänge der ZELLE. Beides aus derselben Liste zu
 * lesen hiesse, die Halle viermal zu befragen — und dreimal mit der
 * falschen Ankerzelle. Ihre Innenkanten fallen dabei von selbst heraus:
 * Dort sitzt kein Connector, also findet {@link planArchways} keine
 * Öffnung und setzt keinen Rahmen. Ein Bogen mitten in einem Saal wäre
 * genau die Zwischenwand aus Mikes Befund.
 */
export function planArchways(
  def: DungeonDef,
  rooms: readonly GridPlanRoom[],
  cells: readonly GridPlanCell[],
  seed: number,
  fraction: number
): GridArchway[] {
  if (!(fraction > 0) || def.doorTypes.length === 0) return [];
  const byName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));

  /** Öffnungen aller Räume, nachschlagbar über (Zelle, Weltrichtung). */
  const portAt = new Map<string, { port: GridPort; room: RoomDef; corridor: boolean }>();
  for (const r of rooms) {
    const room = byName.get(r.module);
    if (!room) throw new DungeonRasterError(`Modul '${r.module}' steht nicht im Kit '${def.name}'.`);
    const module = gridModuleFromRoomDef(room);
    const corridor = isCorridorModule(module);
    for (const port of moduleWorldPorts(r.cell, r.yaw, module)) {
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
  const hallFraction = clamp01(settings.hallFraction);
  const stairFraction = clamp01(settings.stairFraction);
  // `maxRooms` heisst im Rasterpfad ZELLZAHL, nicht Wachstumsversuche —
  // die Bedeutung wechselt mit dem Pfad, s. Verträge der Konzeptnotiz.
  const target = Math.max(1, Math.min(MAX_DUNGEON_ROOMS, Math.trunc(def.maxRooms)));
  const { cells, stamps } = growCells(
    seed,
    target,
    settings.zoneSize * 0.5,
    settings.zoneBounded,
    stampModuleOptions(def),
    hallFraction,
    stairModuleOptions(def),
    stairFraction
  );

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
  const planRooms: GridPlanRoom[] = [];
  /** Stempelindex → Raumindex. Ein Stempel wird EINMAL zum Raum, nicht je Zelle. */
  const roomOfStamp = new Map<number, number>();
  const states = new Map<string, Record<Direction, EdgeState>>();

  /** Trägt den Raum ein und legt die Kantentafel aller seiner Zellen ab. */
  const addRoom = (cell: GridCell, yaw: Yaw, module: GridModule, name: string, atDepth: number): number => {
    const index = planRooms.length;
    planRooms.push({
      cell,
      module: name,
      yaw,
      depth: atDepth,
      // Aus der Rückrechnung, nicht aus dem Stempelvermerk: So steht im
      // Plan dieselbe Zellmenge, die `placeModule` gleich in die Welt legt.
      cells: moduleWorldCells(cell, yaw, module),
    });
    for (const [key, rec] of moduleWorldEdgeStates(cell, yaw, module)) states.set(key, rec);
    return index;
  };

  for (const c of order) {
    let roomIndex: number;
    if (c.stamp !== null) {
      const known = roomOfStamp.get(c.stamp);
      if (known === undefined) {
        const st = stamps[c.stamp]!;
        // BFS-Reihenfolge: Die erste erreichte Zelle des Stempels gibt
        // seine Tiefe — sie ist die flachste, alles andere wäre eine
        // Tiefe, die im Grab niemand zurücklegen muss.
        roomIndex = addRoom(st.anchor, st.yaw, st.module, st.def.name, depth.get(c.key) ?? 0);
        roomOfStamp.set(c.stamp, roomIndex);
      } else {
        roomIndex = known;
      }
    } else {
      const mask = directionMask(c.edges);
      const freeMask = directionMask(
        HORIZONTAL_DIRECTIONS.filter((d) => !cells.has(cellKey(neighbourCell(c.cell, d))))
      );
      const chosen = c.entrance
        ? { def: entranceDef, module: entranceModule, yaw: entranceYaw }
        : chooseModule(options, mask, freeMask, rng);
      roomIndex = addRoom(c.cell, chosen.yaw, chosen.module, chosen.def.name, depth.get(c.key) ?? 0);
    }
    const room = planRooms[roomIndex]!;
    planCells.push({
      cell: c.cell,
      module: room.module,
      yaw: room.yaw,
      depth: depth.get(c.key) ?? 0,
      edges: DIRECTIONS.filter((d) => c.edges.has(d)),
      entrancePort: c.entrance ? ENTRANCE_PORT_DIRECTION : null,
      room: roomIndex,
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
    const mine = states.get(cellKey(c.cell))!;
    for (const d of DIRECTIONS) {
      if (mine[d] !== 'open') continue; // Zeile 6
      if (c.edges.has(d)) continue; // Zeile 1: Durchgang
      if (planCells[i]!.entrancePort === d) continue; // führt nach draussen
      const other = cells.get(cellKey(neighbourCell(c.cell, d)));
      if (!other) {
        seals.push({ cell: c.cell, direction: d }); // Zeile 5: Fels
        continue;
      }
      const facing = states.get(cellKey(other.cell))![OPPOSITE_DIRECTION[d]];
      // Zeile 3: nichts. Zeile 2 und 4: Platte auf DIESER Seite; die
      // Gegenseite entscheidet für sich, und in Zeile 2 stehen beide
      // Rücken an Rücken um die Kantenebene.
      if (facing !== 'wall') seals.push({ cell: c.cell, direction: d });
    }
  }

  // ── S8: Torbögen ───────────────────────────────────────────────────
  // Zuletzt, weil die Regel die MODULE der beiden Seiten braucht (Gang
  // oder Raum) — die stehen erst nach S5 fest.
  const archways = planArchways(def, planRooms, planCells, seed, archwayFraction);

  return { rooms: planRooms, cells: planCells, seals, loops, archways };
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
  // Je RAUM eine Zeile, nicht je Zelle: Ein Stempel steht einmal in der
  // Welt, auch wenn er vier Zellen belegt.
  const rooms: PlacedRoom[] = plan.rooms.map((r) => {
    const rd = byName.get(r.module);
    if (!rd) throw new DungeonRasterError(`Modul '${r.module}' steht nicht im Kit '${def.name}'.`);
    return placeModule(r.cell, r.yaw, gridModuleFromRoomDef(rd), r.depth + 1);
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
    const at = cellAt.get(cellKey(arch.cell));
    if (!at) throw new DungeonRasterError(`Torbogen auf ${edgeKey(arch)} steht an keiner Zelle.`);
    // Die Öffnung gehört dem RAUM: Bei einem Stempel liegt sie auf einer
    // anderen Zelle als seiner Ankerzelle, und `moduleWorldPorts` will
    // den Anker.
    const host = plan.rooms[at.room];
    if (!host) throw new DungeonRasterError(`Torbogen auf ${edgeKey(arch)} zeigt auf Raum ${at.room}, den es nicht gibt.`);
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
  plan.rooms.forEach((r, index) => {
    const rd = byName.get(r.module);
    if (!rd) throw new DungeonRasterError(`Modul '${r.module}' steht nicht im Kit '${def.name}'.`);
    const module = gridModuleFromRoomDef(rd);
    // Der Zeuge aus S6: Die Kit-Geometrie darf sich unter der Erklärung
    // nicht wegbewegen.
    assertConnectorsOnEdges(rd, r.cell, r.yaw, module);
    // Und der Zeuge, den G6 dazustellt: Der Fussabdruck des Raums MUSS
    // die Zellmenge sein, die im Plan steht. Ein Stempel, der um eine
    // Zelle danebenliegt, erzeugt weder eine Ausnahme noch eine
    // Doppelbelegung — er baut nur den Saal neben seine eigenen Türen.
    const footprint = moduleWorldCells(r.cell, r.yaw, module);
    if (footprint.map(cellKey).join(',') !== r.cells.map(cellKey).join(',')) {
      throw new DungeonRasterError(
        `Raum ${index} ('${r.module}'): Fussabdruck [${r.cells.map(cellKey).join(' ')}] ` +
          `passt nicht zur Rückrechnung [${footprint.map(cellKey).join(' ')}].`
      );
    }
    for (const c of footprint) {
      const at = cells.get(cellKey(c));
      if (!at || at.room !== index) {
        throw new DungeonRasterError(
          `Raum ${index} ('${r.module}') belegt Zelle ${cellKey(c)}, die im Plan zu Raum ${at?.room ?? 'keinem'} gehört.`
        );
      }
    }
    for (const [key, rec] of moduleWorldEdgeStates(r.cell, r.yaw, module)) states.set(key, rec);
  });
  for (const c of plan.cells) {
    if (!states.has(cellKey(c.cell))) {
      throw new DungeonRasterError(`Zelle ${cellKey(c.cell)} trägt keinen Raum.`);
    }
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

  // Und die Gegenrichtung: keine offene Kante ohne Durchgang und ohne
  // Platte — ES SEI DENN, gegenüber steht eine eingebaute Wand.
  //
  // Diese Ausnahme IST Zeile 3 der Kantentafel, und sie wird erst mit G6
  // erreichbar: Bis dahin durfte eine überzählige Öffnung nur auf Fels
  // zeigen (S5 lässt für eine Einzelzelle nichts anderes zu), und dort
  // steht immer eine Platte. Der Stempel hat acht Öffnungen und keine
  // Wahl — wächst später eine Gangzelle daneben, kehrt sie ihre
  // eingebaute Wand hierher. Eine Platte davor wäre genau eine der 531
  // aus dem G1-Befund.
  for (const c of plan.cells) {
    const mine = states.get(cellKey(c.cell))!;
    for (const d of DIRECTIONS) {
      if (mine[d] !== 'open' || c.edges.includes(d) || c.entrancePort === d) continue;
      if (sealed.has(`${cellKey(c.cell)}#${d}`)) continue;
      const behind = cells.get(cellKey(neighbourCell(c.cell, d)));
      const facing = behind ? states.get(cellKey(behind.cell))![OPPOSITE_DIRECTION[d]] : null;
      if (facing === 'wall') continue;
      throw new DungeonRasterError(
        `Zelle ${cellKey(c.cell)}: Kante ${d} ist offen und unversiegelt (gegenüber '${facing ?? 'fels'}').`
      );
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
  const states = moduleWorldEdgeStates(ENTRANCE_CELL, yaw, module).get(cellKey(ENTRANCE_CELL));
  if (!states) throw new DungeonRasterError(`'${entranceDef.name}' belegt die Eingangszelle nicht.`);
  const plan: GridPlan = {
    rooms: [
      {
        cell: ENTRANCE_CELL,
        module: entranceDef.name,
        yaw,
        depth: 0,
        cells: moduleWorldCells(ENTRANCE_CELL, yaw, module),
      },
    ],
    cells: [
      {
        cell: ENTRANCE_CELL,
        module: entranceDef.name,
        yaw,
        depth: 0,
        edges: [],
        entrancePort: ENTRANCE_PORT_DIRECTION,
        room: 0,
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
 * gilt, entscheidet seit G8 {@link erzeugeLayoutFuerKit}. Diese Funktion
 * hier ruft nur an, wer den neuen Weg AUSDRÜCKLICH will (Tests,
 * Messzellen) — im Betrieb geht alles über den Verteiler.
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

/**
 * Der Verteiler (S-Vertrag der Konzeptnotiz, G8): aus Kit und Saat ein
 * Layout — über den Rasterpfad oder über den 1.0-Pfad.
 *
 * ── Warum es genau EINE solche Stelle geben muss ─────────────────────
 * Zwei Erzeugungswege nebeneinander sind dauerhafte Pflege, und die
 * Konzeptnotiz nennt unter „Risiken" den Präzedenzfall dafür, was
 * passiert, wenn die Entscheidung an mehreren Stellen fällt:
 * `roomOverlapsLayout` gegen `testCollision` — zwei Fassungen derselben
 * Regel, die auseinandergelaufen sind, weil der Editor seine eigene
 * hatte. Deshalb entscheidet hier eine Zeile, und Server
 * (`DungeonManager.createGenerated`), Editor (`neuesDungeonDokument`) und
 * Messzelle (`tools/messe-stonevault-logik.ts`) rufen sie an, statt selbst
 * zu wählen.
 *
 * ── Warum der Schalter am KIT hängt und nicht am Aufrufer ────────────
 * Dieselbe Begründung wie bei `DungeonDef.generatorEinstellungen`: Welcher
 * Weg für ein Kit gilt, ist eine Eigenschaft seiner Module (2-m-Zellen,
 * Kantenerklärung), keine Laune des Aufrufers. Am Aufrufer wäre sie genau
 * dort vergessen worden, wo niemand hinsieht.
 *
 * ── Was `settings` bedeutet ──────────────────────────────────────────
 * `Partial<GridSettings>` ist die Vereinigung beider Welten
 * (`DungeonGeneratorSettings` + {@link GridTuning}). Der 1.0-Pfad liest
 * die vier Rasterregler nie — sie fallen dort als unbekannte Felder durch
 * die Zusammenführung und ändern nichts. Umgekehrt liest der Rasterpfad
 * `zoneSize` und `doorsEnabled` sehr wohl. Ein eigener Parametersatz je
 * Pfad zwänge jeden Aufrufer, den Schalter selbst zu kennen — und das ist
 * genau das, was dieser Verteiler abschafft.
 *
 * `maxRooms` reist wie im 1.0-Pfad über eine `def`-Kopie und WECHSELT
 * dabei die Bedeutung: Wachstumsversuche dort, Zellzahl hier.
 *
 * Der Name ist DEUTSCH und bricht damit bewusst die Regel „Neues
 * englisch": Er steht so in der Konzeptnotiz (Verträge, „ein Verteiler
 * `erzeugeLayoutFuerKit(def, seed, settings)`") und wurde von der
 * Messzelle schon vor dem Bau unter diesem Namen angekündigt. Ihn beim
 * Einbau umzubenennen hiesse, die eine Stelle umzutaufen, auf die alle
 * Notizen zeigen.
 * The distributor: kit + seed to layout, over the grid path or the 1.0
 * path. The kit's `gridGeneration` field decides; this is the only place
 * where that decision is made.
 */
export function erzeugeLayoutFuerKit(
  def: DungeonDef,
  seed: number,
  settings?: Partial<GridSettings>,
  options?: GridGeneratorOptions
): DungeonLayout {
  if (def.gridGeneration) return generateGridLayout(def, seed, settings, options);
  return generateDungeonLayout(def, seed, settings);
}
