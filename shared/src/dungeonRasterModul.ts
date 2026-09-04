/**
 * Modulerklärung des Rastergenerators (Meilenstein G2 der Konzeptnotiz
 * „Modul-Generierung 2.0-Logik“).
 *
 * ── Wofür ────────────────────────────────────────────────────────────
 * Der 1.0-Generator wählt erst ein Modul und erfährt danach, was daneben
 * liegt. Er hat kein Konzept „Rasterzelle belegt“, er reagiert nur auf
 * Connectors — und an der eingebauten Wand eines Korridors gibt es keinen
 * Connector. Ergebnis, über 40 Saaten gemessen: jede dritte Abschluss-
 * platte steht im Körper des Nachbarmoduls.
 *
 * Damit ein Generator das VORHER wissen kann, muss jedes Modul sich
 * selbst beschreiben: Wie viele Zellen belegt es, auf wie vielen Ebenen,
 * und was ist an jeder seiner sechs Zellkanten — Durchgang, Wand, oder
 * eine Wand, die die Kante nur zum Teil deckt. Genau das leistet
 * {@link gridModuleFromRoomDef}. Sie ist rein und liest nur die
 * Kit-Definition; sie erzeugt nichts und ändert nichts.
 *
 * ── Warum sechs Kanten und nicht vier ────────────────────────────────
 * Ein Kantenmodell mit n/o/s/w erklärt median 32 senkrechte Nachbar-
 * schaften je Grundriss zu Nichts (gemessen: 1328 gestapelte Zellpaare
 * über 40 Saaten, bis zu 6 Ebenen). Boden und Decke sind deshalb
 * gleichberechtigte Kanten. Ihre Vorgabe ist `wall`: Ein Ebenenwechsel
 * muss ERKLÄRT werden, sonst wächst ein Grundriss durch den Boden.
 *
 * ── Warum drei Zustände und nicht zwei ───────────────────────────────
 * `wallPartial` ist kein Feinschliff, sondern der Unterschied zwischen
 * 531 überflüssigen und 414 nötigen Platten. Die Wände von Korridor,
 * Ecke und Abzweig laufen über die volle Ebenenhöhe (−0,25 … 3,75,
 * `make-stonevault.py:56-59`) — dagegen darf nie eine Platte gesetzt
 * werden. Die Flanken der Treppe sind Keile, die mit dem Lauf steigen
 * (`:483-491`) und die Kante je Ebene nur zum Teil decken — dort muss
 * eine Platte gesetzt werden.
 *
 * ── Warum die Funktion wirft statt zu raten ──────────────────────────
 * `gridEdges` ist eine ERKLÄRUNG über das GLB, keine Messung an ihm.
 * Ein stiller Vorgabewert `wall` für jede nicht genannte Aussenkante
 * sähe genauso aus wie eine bewusste Wand — und ein vergessener Eintrag
 * fiele erst im fertigen Grab auf. Deshalb verlangt diese Funktion für
 * JEDE waagerechte Aussenkante eine Aussage (Connector oder
 * `gridEdges`) und meldet jeden Widerspruch als Fehler. Der Preis ist,
 * dass ein neues Modul ohne Erklärung nicht durchrutscht — das ist der
 * Zweck.
 *
 * ── Sprache der Bezeichner ───────────────────────────────────────────
 * Neu angelegter Code trägt englische Namen; die deutschen Namen der
 * Nachbardateien (`verschlussAchse`, `MODUL_ZELLE_HOEHE_M`) bleiben, wo
 * sie stehen. Die Vokabeln der Konzeptnotiz übersetzen sich eins zu eins:
 * offen → `open`, wand → `wall`, wandTeilweise → `wallPartial`,
 * oben/unten → `up`/`down`, Ost → `e`.
 */
import { MODUL_ZELLE_HOEHE_M, verschlussAchse } from './dungeonRaster.js';
import { quatMulVec3 } from './worldgen/Math3d.js';
import type { RoomDef } from './dungeons.js';
import type { Vector3 } from './types.js';

/** Kantenlänge einer Rasterzelle in Metern (Modul-Format v0). */
export const MODULE_CELL_M = 2;

/**
 * Höhe einer Ebene in Metern. Dieselbe Zahl wie die lichte Zellhöhe: Im
 * Modulformat IST eine Ebene eine Zellhöhe (s. `MODUL_ZELLE_HOEHE_M`),
 * anders als im 4-m-Kit, wo der Ebenensprung 8 m misst.
 */
export const MODULE_LEVEL_M = MODUL_ZELLE_HOEHE_M;

/**
 * Toleranz für Lagevergleiche in Metern. Die gemessene Drift der
 * Zellmitten geht bis 2,6 · 10⁻⁵ m; Modul-LOKALE Masse sind getippt und
 * daher exakt, hier reicht Rundungsrauschen.
 */
const TOLERANCE_M = 1e-4;

/**
 * Dreiwertiger Zustand einer Zellkante.
 *
 * `open` — dort sitzt ein Connector, die Kante kann ein Durchgang werden.
 * `wall` — eine Wand über die volle Ebenenhöhe ist ins GLB gebaut.
 * `wallPartial` — eine Wand ist da, deckt die Kante aber nicht ganz.
 */
export type EdgeState = 'open' | 'wall' | 'wallPartial';

/** Die sechs Kanten einer Zelle — vier waagerecht, plus Boden und Decke. */
export type Direction = 'n' | 'e' | 's' | 'w' | 'up' | 'down';

/**
 * Feste Reihenfolge der Richtungen. Kantenlisten werden überall in dieser
 * Reihenfolge durchlaufen — Determinismus-Falle aus dem Konzept: Wer über
 * eine `Set`-Iteration geht, bekommt irgendwann einen anderen Grundriss
 * aus derselben Saat.
 */
export const DIRECTIONS: readonly Direction[] = ['n', 'e', 's', 'w', 'up', 'down'];

/** Richtung → achsparalleler Einheitsvektor in MODUL-lokalen Koordinaten. */
export const DIRECTION_VECTOR: Readonly<Record<Direction, Vector3>> = {
  n: { x: 0, y: 0, z: 1 },
  e: { x: 1, y: 0, z: 0 },
  s: { x: 0, y: 0, z: -1 },
  w: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

/** Gegenrichtung — die andere Seite derselben Kante. */
export const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = {
  n: 's',
  s: 'n',
  e: 'w',
  w: 'e',
  up: 'down',
  down: 'up',
};

/** Waagerecht sind die vier Himmelsrichtungen; oben/unten sind es nicht. */
export function isHorizontal(d: Direction): boolean {
  return d !== 'up' && d !== 'down';
}

/**
 * Achsparalleler Vektor → Richtungsname, oder null.
 *
 * Gerundet statt verglichen: Ein Quaternion-Produkt in float32 trifft die
 * 1 nicht exakt, und ein Gleichheitsvergleich auf Kantenrichtungen ist
 * genau die Falle, gegen die das ganze Modul gebaut ist.
 */
export function directionFromVector(v: Vector3): Direction | null {
  const x = Math.round(v.x);
  const y = Math.round(v.y);
  const z = Math.round(v.z);
  for (const d of DIRECTIONS) {
    const u = DIRECTION_VECTOR[d];
    if (u.x === x && u.y === y && u.z === z) return d;
  }
  return null;
}

/**
 * Ein Eintrag der additiven Kantenerklärung am `RoomDef`.
 *
 * Zwei Formen, und der Unterschied ist Absicht:
 *
 *  • **Ohne `cell`** — die Aussage über die AUSSENHAUT des Moduls: „jede
 *    Kante dieser Richtung, an der weder ein Ausgang noch eine eigene
 *    Zeile steht“. Sie überschreibt weder einen Connector noch eine
 *    Innenkante. Ohne diese Form wären die Treppenflanken zwölf
 *    gleichlautende Zeilen, in denen ein Tippfehler nicht auffiele.
 *  • **Mit `cell`** — die Aussage über GENAU DIESE Kante. Sie gilt auch
 *    für eine Innenkante (so erklärt die Treppe ihren Ebenenwechsel) und
 *    ist ein Fehler, wenn dort ein Connector sitzt.
 *
 * Innerhalb einer Form überschreibt der spätere Eintrag den früheren; über
 * die Formen hinweg gewinnt immer die Einzelzeile, egal wo sie steht — sonst
 * hinge die Bedeutung einer Ausnahme an ihrer Zeilennummer.
 */
export interface GridEdgeDef {
  /** Lokale Zellindizes (x-Reihe, z-Reihe, Ebene). Fehlt sie: alle Zellen. */
  readonly cell?: { readonly ix: number; readonly iz: number; readonly level: number };
  /** Kanten, für die der Zustand gilt. */
  readonly edges: readonly Direction[];
  readonly state: EdgeState;
}

/** Eine Öffnung des Moduls: der Connector, seine Zelle und seine Kante. */
export interface ModulePort {
  /** Index in `RoomDef.connections` — die Rückverbindung zur Kit-Definition. */
  readonly connector: number;
  /** Index in {@link GridModule.cells}. */
  readonly cell: number;
  readonly direction: Direction;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
  /**
   * Kantenmitte in MODUL-lokalen Koordinaten. Sie ist die Sollstelle des
   * Connectors und damit der Zeuge gegen eine Kit-Geometrie, die sich
   * unter der Erklärung wegbewegt (Konzept S6).
   */
  readonly localEdgeCenter: Vector3;
}

/** Eine Zelle des Moduls mit ihren sechs Kanten. */
export interface ModuleCell {
  /** Lokaler Zellindex in x-Richtung, 0 … cellsX−1. */
  readonly ix: number;
  /** Lokaler Zellindex in z-Richtung, 0 … cellsZ−1. */
  readonly iz: number;
  /** Lokale Ebene, 0 … levels−1. */
  readonly level: number;
  /**
   * Zellmitte in MODUL-lokalen Koordinaten (Pivot = Bodenmitte des
   * Moduls). y ist die BODENoberkante der Ebene, nicht die halbe Höhe —
   * `roomBodyFromFloor` gilt für dieses Kit.
   */
  readonly localCenter: Vector3;
  readonly edges: Readonly<Record<Direction, EdgeState>>;
  /**
   * Führt die Kante zu einer anderen Zelle DESSELBEN Moduls? Dort kann
   * von aussen nichts anstossen — die Versiegelung überspringt solche
   * Kanten, und die Prüfung „offene Kante braucht einen Connector“ gilt
   * dort nicht.
   */
  readonly interior: Readonly<Record<Direction, boolean>>;
}

/** Die vollständige Selbstbeschreibung eines Rastermoduls. */
export interface GridModule {
  readonly name: string;
  /** Zellen in lokaler x-Richtung. */
  readonly cellsX: number;
  /** Zellen in lokaler z-Richtung. */
  readonly cellsZ: number;
  readonly levels: number;
  /** Kanonisch sortiert nach (level, iz, ix) — s. Determinismus-Falle im Konzept. */
  readonly cells: readonly ModuleCell[];
  readonly ports: readonly ModulePort[];
  /**
   * Verschlussmodul (`endCap`, dünner als eine Zelle): Es belegt KEINE
   * Zelle, es legt sich in die Kantenebene. Wer es als Zelle führte,
   * hielte jede versiegelte Kante für belegt.
   */
  readonly endCap: boolean;
  /**
   * Der Ankerport — der Eingangsconnector, an dem der Grundriss aufhängt.
   * Nur der Eingangsraum hat einen; bei allen anderen null.
   */
  readonly anchor: ModulePort | null;
}

function fail(name: string, text: string): never {
  throw new Error(`Rastermodul '${name}': ${text}`);
}

/** Ganzes Vielfaches, oder null. Rundet und prüft die Rundung nach. */
function multipleOf(value: number, step: number): number | null {
  const n = Math.round(value / step);
  return Math.abs(value - n * step) < TOLERANCE_M ? n : null;
}

/**
 * Leitet aus einer Kit-Raumdefinition die Rasterbeschreibung ab.
 *
 * Abgeleitet (nicht getippt) werden Fussabdruck, Ebenen und alle `open`-
 * Kanten; getippt (`RoomDef.gridEdges`) werden nur die Zustände, die
 * im GLB stecken und an keiner Datenstruktur hängen: `wall` und
 * `wallPartial`. Wirft bei jeder Lücke und jedem Widerspruch — die
 * Begründung steht im Kopf dieser Datei.
 */
export function gridModuleFromRoomDef(room: RoomDef): GridModule {
  // ── Verschluss zuerst: er hat keinen Fussabdruck ────────────────────
  //
  // `verschlussAchse` ist die bestehende, eng gefasste Regel aus
  // `dungeonRaster.ts` (endCap + genau ein Connector + genau eine dünne
  // Achse, Connector quer darauf). Sie hier wiederzuverwenden statt „0,3
  // ist dünn“ zu tippen hält die beiden Aussagen zusammen.
  if (verschlussAchse(room, MODULE_CELL_M) !== null) {
    return {
      name: room.name,
      cellsX: 0,
      cellsZ: 0,
      levels: 0,
      cells: [],
      ports: [],
      endCap: true,
      anchor: null,
    };
  }

  // ── Fussabdruck ────────────────────────────────────────────────────
  //
  // `size` lügt auf jeder Achse mit eingebauter Wand bewusst um 0,6 m:
  // 1,4 statt 2 hält den Abschluss der Nachbarzelle von der Hülle fern
  // (Begründung an `StoneVaultCorridor`). Für den Fussabdruck zählt
  // deshalb das RASTERmass, nicht die Hülle — `max(size, 2)` macht aus
  // dem Innenmass wieder die ganze Zelle.
  const cellsX = multipleOf(Math.max(room.size.x, MODULE_CELL_M), MODULE_CELL_M);
  const cellsZ = multipleOf(Math.max(room.size.z, MODULE_CELL_M), MODULE_CELL_M);
  const levels = multipleOf(room.size.y, MODULE_LEVEL_M);
  if (cellsX === null || cellsZ === null || levels === null || levels < 1) {
    fail(
      room.name,
      `Hülle ${room.size.x}×${room.size.y}×${room.size.z} liegt nicht auf dem Raster ` +
        `(${MODULE_CELL_M} m in x/z, ${MODULE_LEVEL_M} m in y).`
    );
  }

  // ── Zellen anlegen, Innenkanten markieren ──────────────────────────
  interface Draft {
    ix: number;
    iz: number;
    level: number;
    localCenter: Vector3;
    edges: Record<Direction, EdgeState>;
    interior: Record<Direction, boolean>;
    /** Kanten, über die `gridEdges` eine Aussage getroffen hat. */
    declared: Set<Direction>;
    /** Kanten, auf denen ein Connector sitzt (Index in `ports`). */
    port: Map<Direction, number>;
  }

  const draft: Draft[] = [];
  const byKey = new Map<string, number>();
  const key = (ix: number, iz: number, level: number): string => `${ix}|${iz}|${level}`;
  for (let level = 0; level < levels; level++) {
    for (let iz = 0; iz < cellsZ; iz++) {
      for (let ix = 0; ix < cellsX; ix++) {
        byKey.set(key(ix, iz, level), draft.length);
        draft.push({
          ix,
          iz,
          level,
          // Der Pivot liegt in der Bodenmitte des Moduls, die Zellen
          // liegen also symmetrisch darum. Bei gerader Zellzahl (Halle)
          // sitzt der Pivot ZWISCHEN den Zellen — genau deshalb steht
          // hier (n−1)/2 und keine Ganzzahlrechnung.
          localCenter: {
            x: (ix - (cellsX - 1) / 2) * MODULE_CELL_M,
            y: level * MODULE_LEVEL_M,
            z: (iz - (cellsZ - 1) / 2) * MODULE_CELL_M,
          },
          edges: { n: 'wall', e: 'wall', s: 'wall', w: 'wall', up: 'wall', down: 'wall' },
          interior: { n: false, e: false, s: false, w: false, up: false, down: false },
          declared: new Set<Direction>(),
          port: new Map<Direction, number>(),
        });
      }
    }
  }

  for (const cell of draft) {
    for (const d of DIRECTIONS) {
      const u = DIRECTION_VECTOR[d];
      const neighbour = byKey.get(key(cell.ix + u.x, cell.iz + u.z, cell.level + u.y));
      if (neighbour === undefined) continue;
      cell.interior[d] = true;
      // Waagerechte Innenkanten sind Durchgang: Ein mehrzelliges Modul
      // ist EIN Raum, seine Zellen hängen zusammen. Senkrechte NICHT —
      // gestapelte Zellen eines Moduls sind der Luftraum über einer
      // Treppe, und der ist nur dort begehbar, wo der Lauf ihn kreuzt.
      if (isHorizontal(d)) cell.edges[d] = 'open';
    }
  }

  // ── Ports aus den Connectors ableiten ──────────────────────────────
  const ports: ModulePort[] = [];
  for (let i = 0; i < room.connections.length; i++) {
    const c = room.connections[i]!;
    // Die Connectordrehung zeigt aus dem Modul HINAUS (Kit-Konvention),
    // die lokale +z-Achse ist die Blickrichtung.
    const d = directionFromVector(quatMulVec3(c.localRot, { x: 0, y: 0, z: 1 }));
    if (d === null || !isHorizontal(d)) {
      fail(
        room.name,
        `Connector ${i} zeigt nicht in eine der vier Himmelsrichtungen — ` +
          `senkrechte Durchgänge kennt das Modulformat nicht.`
      );
    }
    // Die Zelle hinter dem Connector: eine halbe Zelle entgegen seiner
    // Blickrichtung. Der Connector sitzt auf der KANTE, nicht auf der
    // Hüllfläche (die liegt bei eingebauten Wänden 0,3 m weiter innen).
    const u = DIRECTION_VECTOR[d];
    const mx = c.localPos.x - (u.x * MODULE_CELL_M) / 2;
    const mz = c.localPos.z - (u.z * MODULE_CELL_M) / 2;
    const ix = multipleOf(mx + ((cellsX - 1) / 2) * MODULE_CELL_M, MODULE_CELL_M);
    const iz = multipleOf(mz + ((cellsZ - 1) / 2) * MODULE_CELL_M, MODULE_CELL_M);
    const level = multipleOf(c.localPos.y, MODULE_LEVEL_M);
    const hit =
      ix === null || iz === null || level === null ? undefined : byKey.get(key(ix, iz, level));
    if (hit === undefined) {
      fail(
        room.name,
        `Connector ${i} auf (${c.localPos.x}, ${c.localPos.y}, ${c.localPos.z}) liegt auf keiner ` +
          `Zellkante des ${cellsX}×${cellsZ}×${levels}-Fussabdrucks.`
      );
    }
    const cell = draft[hit]!;
    if (cell.interior[d]) {
      fail(
        room.name,
        `Connector ${i} sitzt auf der INNENkante ${d} der Zelle ` +
          `(${cell.ix},${cell.iz},${cell.level}) — dort kann nie ein Nachbar andocken.`
      );
    }
    if (cell.port.has(d)) {
      fail(
        room.name,
        `Zelle (${cell.ix},${cell.iz},${cell.level}) trägt zwei Connectors auf Kante ${d} ` +
          `(${cell.port.get(d)} und ${i}).`
      );
    }
    cell.edges[d] = 'open';
    cell.port.set(d, ports.length);
    ports.push({
      connector: i,
      cell: hit,
      direction: d,
      entrance: c.entrance,
      allowDoor: c.allowDoor,
      localEdgeCenter: {
        x: cell.localCenter.x + (u.x * MODULE_CELL_M) / 2,
        y: cell.localCenter.y,
        z: cell.localCenter.z + (u.z * MODULE_CELL_M) / 2,
      },
    });
  }

  // ── Die getippte Erklärung darüberlegen ────────────────────────────
  //
  // NACH den Ports, weil beide Formen sich auf sie beziehen: Die
  // Aussenhaut-Regel lässt einen Ausgang stehen, die Einzelzeile
  // widerspricht ihm. Zuerst die Einzelzeilen — sie sind die genauere
  // Aussage und dürfen von der Fläche nicht zugedeckt werden.
  const perCell = new Set<string>();
  for (const entry of room.gridEdges ?? []) {
    if (entry.cell === undefined) continue;
    const hit = byKey.get(key(entry.cell.ix, entry.cell.iz, entry.cell.level));
    if (hit === undefined) {
      fail(
        room.name,
        `gridEdges nennt Zelle (${entry.cell.ix},${entry.cell.iz},${entry.cell.level}), ` +
          `die es bei ${cellsX}×${cellsZ}×${levels} nicht gibt.`
      );
    }
    const cell = draft[hit]!;
    for (const d of entry.edges) {
      if (cell.port.has(d) && entry.state !== 'open') {
        fail(
          room.name,
          `Widerspruch an Zelle (${cell.ix},${cell.iz},${cell.level}), Kante ${d}: gridEdges sagt ` +
            `'${entry.state}', dort sitzt aber Connector ${cell.port.get(d)}.`
        );
      }
      cell.edges[d] = entry.state;
      cell.declared.add(d);
      perCell.add(`${cell.ix}|${cell.iz}|${cell.level}|${d}`);
    }
  }
  for (const entry of room.gridEdges ?? []) {
    if (entry.cell !== undefined) continue;
    for (const cell of draft) {
      for (const d of entry.edges) {
        // Innenkanten und Ausgänge bleiben stehen: Die Fläche beschreibt,
        // was AUSSEN und ZU ist, nicht was das Modul zusammenhält.
        if (cell.interior[d] || cell.port.has(d)) continue;
        if (perCell.has(`${cell.ix}|${cell.iz}|${cell.level}|${d}`)) continue;
        cell.edges[d] = entry.state;
        cell.declared.add(d);
      }
    }
  }

  // ── Vollständigkeit und Widerspruchsfreiheit ───────────────────────
  for (const cell of draft) {
    for (const d of DIRECTIONS) {
      if (isHorizontal(d) && !cell.interior[d]) {
        // Jede waagerechte Aussenkante entscheidet über eine Platte.
        // Schweigen ist deshalb keine Aussage, sondern eine Lücke.
        if (!cell.declared.has(d) && !cell.port.has(d)) {
          fail(
            room.name,
            `Zelle (${cell.ix},${cell.iz},${cell.level}) sagt nichts über ihre Aussenkante ${d} — ` +
              `entweder ein Connector oder ein gridEdges-Eintrag.`
          );
        }
        // Eine offene Aussenkante ohne Connector wäre eine Öffnung, an
        // der nie ein Nachbar andocken kann: die „Öffnung ins Leere“.
        if (cell.edges[d] === 'open' && !cell.port.has(d)) {
          fail(
            room.name,
            `Zelle (${cell.ix},${cell.iz},${cell.level}) erklärt die Aussenkante ${d} als offen, ` +
              `trägt dort aber keinen Connector.`
          );
        }
      }
      // Innenkanten haben zwei Seiten in DERSELBEN Erklärung — sie müssen
      // übereinstimmen. Ein einseitig geöffneter Ebenenwechsel wäre eine
      // Einbahnstrasse durch Stein, und niemand zählt ihn.
      if (cell.interior[d]) {
        const u = DIRECTION_VECTOR[d];
        const other = draft[byKey.get(key(cell.ix + u.x, cell.iz + u.z, cell.level + u.y))!]!;
        if (other.edges[OPPOSITE_DIRECTION[d]] !== cell.edges[d]) {
          fail(
            room.name,
            `Innenkante zwischen (${cell.ix},${cell.iz},${cell.level}) und ` +
              `(${other.ix},${other.iz},${other.level}) ist einseitig erklärt: ` +
              `${d} = '${cell.edges[d]}', ` +
              `${OPPOSITE_DIRECTION[d]} = '${other.edges[OPPOSITE_DIRECTION[d]]}'.`
          );
        }
      }
    }
  }

  const cells: ModuleCell[] = draft.map((cell) => ({
    ix: cell.ix,
    iz: cell.iz,
    level: cell.level,
    localCenter: cell.localCenter,
    edges: { ...cell.edges },
    interior: { ...cell.interior },
  }));

  return {
    name: room.name,
    cellsX,
    cellsZ,
    levels,
    cells,
    ports,
    endCap: false,
    anchor: ports.find((p) => p.entrance) ?? null,
  };
}
