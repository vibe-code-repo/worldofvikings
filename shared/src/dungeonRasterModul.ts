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
import type { PlacedRoom, RoomDef } from './dungeons.js';
import type { Quaternion, Vector3 } from './types.js';

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


// ---------------------------------------------------------------------------
// Raster ↔ Welt — und die Kantentafel über ein ganzes Layout
//
// ── Warum das HIER steht und nicht im Rastergenerator ────────────────
// Bis G8 lebten Zellschlüssel und Rückrechnung in
// `dungeonRasterGenerator.ts`. Mit G9 braucht sie auch `attachRoom` in
// `dungeonGenerator.ts` — und jene Datei darf den Rastergenerator nicht
// importieren, weil der sie selbst importiert (`generateDungeonLayout`
// für die Nicht-Rasterkits). Ein Ringschluss zwischen beiden wäre eine
// Zeitbombe: Er läuft unter `tsx` und fällt erst im gebündelten Client
// um, wenn eine der beiden Dateien zufällig zuerst ausgewertet wird.
//
// Die Aussage „welche Zelle ist das“ gehört ohnehin zur Modulerklärung
// und nicht zum Generator: Sie ist rein, kennt keine Saat und keine
// Einstellung. `dungeonRasterGenerator.ts` reicht die Namen unverändert
// weiter, damit kein Aufrufer etwas merkt.
// ---------------------------------------------------------------------------

/**
 * Versatz der z-Achse in Metern: Zellmitten liegen auf `2j − 1`.
 *
 * Er ist keine Stilfrage, sondern folgt aus der Lage des Eingangs (s.
 * Dateikopf). Als benannte Konstante, damit die beiden Rechenrichtungen
 * ihn nicht getrennt tippen und auseinanderlaufen.
 */
export const GRID_Z_OFFSET_M = -1;

/**
 * Eine Rasterzelle. `i` läuft mit +x (Ost), `j` mit +z (Nord), `level`
 * mit +y. Nur ganze Zahlen — alles andere ist ein Programmfehler.
 */
export interface GridCell {
  readonly i: number;
  readonly j: number;
  readonly level: number;
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
    x: cell.i * MODULE_CELL_M,
    y: cell.level * MODULE_LEVEL_M,
    z: cell.j * MODULE_CELL_M + GRID_Z_OFFSET_M,
  };
}

/**
 * Weltpunkt → Zelle. Der Rückweg, und der Grund, warum diese Datei
 * existiert: Er RUNDET. Ein Punkt bis zu einer knappen halben Zelle
 * neben der Mitte gehört noch zu ihr.
 */
export function worldToCell(pos: Vector3): GridCell {
  return {
    i: Math.round(pos.x / MODULE_CELL_M),
    j: Math.round((pos.z - GRID_Z_OFFSET_M) / MODULE_CELL_M),
    level: Math.round(pos.y / MODULE_LEVEL_M),
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
  const half = isHorizontal(d) ? MODULE_CELL_M / 2 : MODULE_LEVEL_M / 2;
  return { x: c.x + u.x * half, y: c.y + u.y * half, z: c.z + u.z * half };
}


// ---------------------------------------------------------------------------
// Die Kantentafel über ein Layout — die eine Regel für Generator UND Editor
// ---------------------------------------------------------------------------

/** Eine Zelle eines PLATZIERTEN Moduls, in Weltzellen und Weltrichtungen. */
export interface PlacedGridCell {
  readonly cell: GridCell;
  readonly edges: Readonly<Record<Direction, EdgeState>>;
}

/** Eine Öffnung eines platzierten Moduls, zurückgerechnet auf Zelle und Kante. */
export interface PlacedGridPort {
  /** Index in `RoomDef.connections` — die Rückverbindung zur Kit-Definition. */
  readonly connector: number;
  readonly cell: GridCell;
  readonly direction: Direction;
  readonly entrance: boolean;
  readonly allowDoor: boolean;
}

/** Ein Eintrag der Tafel: die Zelle, ihre Kanten und der Raum, dem sie gehört. */
export interface GridTableCell extends PlacedGridCell {
  /** Index in `layout.rooms`. */
  readonly roomIndex: number;
}

/** Zellschlüssel → Zustand. Alles, was die Tafel über ein Layout weiss. */
export type GridEdgeTable = ReadonlyMap<string, GridTableCell>;

/**
 * Eine Weltrichtung aus einer lokalen — über die PLATZIERUNGSDREHUNG.
 *
 * Bewusst über dieselbe Quaternionen-Rechnung wie die Connectors und
 * nicht über eine Gierungstabelle: Ein platzierter Raum trägt sein
 * `rot` als Quaternion, und der Editor kennt keine Gierung in Grad. Eine
 * Drehung, die auf keine Rasterachse fällt (irgendein Winkel aus einem
 * von Hand verbogenen Dokument), gibt `null` — die Aufrufer behandeln
 * so einen Raum dann wie „nicht im Raster“ statt ihn falsch einzuordnen.
 */
function worldDirection(d: Direction, rot: Quaternion): Direction | null {
  return directionFromVector(quatMulVec3(rot, DIRECTION_VECTOR[d]));
}

function toWorldPoint(local: Vector3, pos: Vector3, rot: Quaternion): Vector3 {
  const r = quatMulVec3(rot, local);
  return { x: pos.x + r.x, y: pos.y + r.y, z: pos.z + r.z };
}

/**
 * Die Weltzellen eines platzierten Moduls samt ihren Kantenzuständen.
 *
 * Verschlussplatten (`endCap`) haben keine Zelle und liefern eine leere
 * Liste — wer sie als Zelle führte, hielte jede versiegelte Kante für
 * belegt und verböte danach jeden Anbau an eine zugemauerte Kante.
 */
export function placedGridCells(
  module: GridModule,
  pos: Vector3,
  rot: Quaternion
): PlacedGridCell[] {
  const out: PlacedGridCell[] = [];
  for (const c of module.cells) {
    const edges = {} as Record<Direction, EdgeState>;
    let vollstaendig = true;
    for (const d of DIRECTIONS) {
      const w = worldDirection(d, rot);
      if (w === null) {
        vollstaendig = false;
        break;
      }
      edges[w] = c.edges[d];
    }
    if (!vollstaendig) continue;
    out.push({ cell: worldToCell(toWorldPoint(c.localCenter, pos, rot)), edges });
  }
  return out;
}

/** Die Öffnungen eines platzierten Moduls, auf Weltzelle und Weltkante zurückgerechnet. */
export function placedGridPorts(
  module: GridModule,
  pos: Vector3,
  rot: Quaternion
): PlacedGridPort[] {
  const out: PlacedGridPort[] = [];
  for (const p of module.ports) {
    const d = worldDirection(p.direction, rot);
    const cell = module.cells[p.cell];
    if (d === null || !cell) continue;
    out.push({
      connector: p.connector,
      cell: worldToCell(toWorldPoint(cell.localCenter, pos, rot)),
      direction: d,
      entrance: p.entrance,
      allowDoor: p.allowDoor,
    });
  }
  return out;
}

/**
 * Die Modulerklärungen eines Kits, einmal je Name.
 *
 * `gridModuleFromRoomDef` ist rein, aber nicht gratis: Sie legt für jede
 * Zelle sechs Kanten an und prüft jeden Connector. `attachRoom` läuft im
 * Editor bei jedem Tastendruck — ohne diesen Zwischenschritt rechnete es
 * die Erklärung aller acht Module bei jedem Aufruf neu.
 */
export function gridModulesOfKit(rooms: readonly RoomDef[]): Map<string, GridModule> {
  const out = new Map<string, GridModule>();
  for (const r of rooms) {
    try {
      out.set(r.name, gridModuleFromRoomDef(r));
    } catch {
      // Ein Kit ohne Rastererklärung ist kein Fehler — es geht dann
      // schlicht nicht über den Rasterpfad. Werfen hiesse, dass der
      // Editor an einem Fremdkit gar nicht mehr öffnete.
      continue;
    }
  }
  return out;
}

/**
 * Die Kantentafel eines Layouts: Welche Zelle gehört wem, und was steht
 * an ihren sechs Kanten.
 *
 * Doppelt belegte Zellen gewinnt der ZULETZT eingetragene Raum nicht —
 * der erste bleibt stehen. Sonst verschwände eine Doppelbelegung aus der
 * Tafel, und genau sie soll {@link gridPlacementConflict} finden.
 */
export function gridEdgeTable(
  rooms: readonly Pick<PlacedRoom, 'room' | 'pos' | 'rot'>[],
  modules: ReadonlyMap<string, GridModule>
): GridEdgeTable {
  const out = new Map<string, GridTableCell>();
  rooms.forEach((r, roomIndex) => {
    const module = modules.get(r.room);
    if (!module || module.endCap) return;
    for (const c of placedGridCells(module, r.pos, r.rot)) {
      const k = cellKey(c.cell);
      if (out.has(k)) continue;
      out.set(k, { ...c, roomIndex });
    }
  });
  return out;
}

/**
 * Verstösst diese Platzierung gegen die Kantentafel? Klartext oder `null`.
 *
 * ── Die Regel, in beide Richtungen gelesen ───────────────────────────
 * Die Tafel aus S7 der Konzeptnotiz sagt für ein Kantenpaar, was dort
 * hingehört. Zwei Paarungen sind kein Bauzustand, sondern ein Fehler:
 *
 *   offen | wand   → eine Öffnung vor einer eingebauten Wand
 *   wand  | offen  → eine eingebaute Wand vor einer Öffnung
 *
 * Das IST Mikes Befund vom 04.09.2026, einmal von jeder Seite. Der
 * Rastergenerator kann beides gar nicht erzeugen (`chooseModule` lässt
 * eine überzählige Öffnung nur auf Fels zeigen); der Handbau konnte es
 * bis heute, weil `attachRoom` allein Hüllen prüfte — und die Hülle
 * eines Moduls ist auf jeder Achse mit eingebauter Wand um 0,6 m zu
 * klein.
 *
 * `wallPartial` steht ausdrücklich NICHT in der Liste: Gegen eine
 * Treppenflanke setzt die Tafel eine Platte (Zeile 4), die Kante ist
 * also versorgt.
 *
 * ── Und die Belegung ─────────────────────────────────────────────────
 * Zwei Räume in derselben Zelle sind der zweite Fehler, den die Hülle
 * durchlässt: Ein Stempel deckt vier Zellen, seine Hülle aber nur die
 * geschrumpfte Mitte. Geprüft wird deshalb an der Zelle, nicht am Körper.
 */
export function gridPlacementConflict(
  table: GridEdgeTable,
  candidate: readonly PlacedGridCell[]
): string | null {
  const eigene = new Set(candidate.map((c) => cellKey(c.cell)));
  for (const c of candidate) {
    const hier = cellKey(c.cell);
    const besetzt = table.get(hier);
    if (besetzt) return `Zelle ${hier} ist schon von Raum ${besetzt.roomIndex} belegt`;
    for (const d of DIRECTIONS) {
      const nachbar = neighbourCell(c.cell, d);
      // Kanten INNERHALB derselben Platzierung entscheidet das Modul
      // selbst — dort kann von aussen nichts anstossen.
      if (eigene.has(cellKey(nachbar))) continue;
      const gegenueber = table.get(cellKey(nachbar));
      if (!gegenueber) continue;
      const dort = gegenueber.edges[OPPOSITE_DIRECTION[d]];
      if (c.edges[d] === 'open' && dort === 'wall') {
        return `Öffnung ${hier}#${d} stiesse auf die eingebaute Wand von Raum ${gegenueber.roomIndex}`;
      }
      if (c.edges[d] === 'wall' && dort === 'open') {
        return `eingebaute Wand ${hier}#${d} stünde vor der Öffnung von Raum ${gegenueber.roomIndex}`;
      }
    }
  }
  return null;
}

/**
 * Braucht diese Kante nach der Tafel eine Platte?
 *
 * Die Ja/Nein-Fassung der Zeilen 1 bis 6 für eine EINZELNE Kante — das,
 * was der Editor beim Schliessen fragt. Der Generator stellt dieselbe
 * Frage über seinen Plan, wo er zusätzlich weiss, welche Nachbarschaft
 * eine Graphkante ist; im Editor gibt es keinen Graphen, dort IST ein
 * Paar aus zwei Öffnungen der Durchgang.
 *
 * Senkrechte Kanten sind ausgenommen: Das Kit hat keine Bodenplatte, und
 * die einzigen offenen Boden- und Deckenkanten des Kits liegen INNERHALB
 * der Treppe (ihre beiden Ebenen). Eine Platte gäbe es dort weder zu
 * setzen noch zu brauchen.
 */
export function gridEdgeNeedsSeal(
  table: GridEdgeTable,
  cell: GridCell,
  direction: Direction
): boolean {
  if (!isHorizontal(direction)) return false;
  const hier = table.get(cellKey(cell));
  if (!hier || hier.edges[direction] !== 'open') return false; // Zeile 6
  const gegenueber = table.get(cellKey(neighbourCell(cell, direction)));
  if (!gegenueber) return true; // Zeile 5: Fels
  const dort = gegenueber.edges[OPPOSITE_DIRECTION[direction]];
  if (dort === 'open') return false; // Zeile 1: Durchgang
  if (dort === 'wall') return false; // Zeile 3: die fremde Wand IST die Wand
  return true; // Zeile 4: Teilwand — die Flanke deckt die Kante nicht ganz
}
