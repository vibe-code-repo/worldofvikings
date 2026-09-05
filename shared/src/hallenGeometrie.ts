/**
 * Die Geometrie eines StoneVault-Saals — in TypeScript, ohne Blender.
 *
 * ── Warum es diese Datei gibt ────────────────────────────────────────
 * Ein Saal ist geschlossene Arithmetik: `hall_module()` in
 * `tools/elements/blender/make-stonevault.py` ruft nur `boden_decke()`
 * und `pillar()`, und beide legen ausschliesslich achsenparallele Quader
 * an. Daraus folgt B = 2 + 16·cx·cz + 3·P Quader, 12·B Dreiecke und
 * 24·B Ecken — gegen alle fünf ausgelieferten GLBs exakt geprüft, nicht
 * ungefähr. Ein Saal braucht deshalb kein Blender, und das ist gut so:
 * `wov-dev` hat keins, 4 GB RAM und zwei Kerne.
 *
 * ── Was diese Datei NICHT tut ────────────────────────────────────────
 * Sie schreibt nichts, liest nichts und kennt weder Babylon noch `node:`.
 * Sie beschreibt einen Saal als Liste von Quadern; wer daraus eine GLB
 * macht, steht anderswo (E2). Der Grund ist `shared/package.json`:
 * „Jedes Modul in shared/src ist reine Daten oder reine Funktionen" —
 * `sideEffects: false` ist eine Zusage, die auch dieses Modul hält.
 *
 * ── Wortgetreue Portierung, nicht Nachbau ────────────────────────────
 * Reihenfolge der Quader, Kachelmass, Fugenbreite, Nahtschluss-Masse und
 * die x-Negation am Ende sind aus dem Python übernommen, damit das
 * Erzeugnis dem Blender-Erzeugnis zahlengleich ist und nicht bloss
 * ähnlich. Wo unten eine Zahl steht, steht sie auch dort.
 *
 * Faithful port of box/boden_decke/pillar/pillar_positions/hall_module
 * from make-stonevault.py — pure arithmetic, no IO, no engine.
 */

/** Ein Punkt im Bauraum (Blender: z ist oben). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Ein achsenparalleler Quader: Mittelpunkt (cx, cy, cz), Kanten (sx, sy, sz). */
export interface Box {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
}

/** Ein fertiger Saal: Quaderliste plus die daraus folgenden Kennzahlen. */
export interface HallGeometry {
  readonly cellsX: number;
  readonly cellsZ: number;
  /** Pfeilerraster in Metern (Abstand zwischen zwei Pfeilerreihen). */
  readonly raster: number;
  readonly boxes: readonly Box[];
  /** Pfeilerstellen im Bauraum, x bereits negiert (siehe `mirrorX`). */
  readonly pillars: readonly Vec3[];
  /** Grundfläche in Metern. */
  readonly sizeX: number;
  readonly sizeZ: number;
  /** 12 je Quader — flach schattiert, also zwei Dreiecke je Seitenfläche. */
  readonly triangles: number;
  /** 24 je Quader — flach schattiert, also vier eigene Ecken je Seitenfläche. */
  readonly vertices: number;
}

export interface HallOptions {
  /**
   * Abstand zwischen zwei Pfeilerreihen, gemessen vom Rand her. Muss ein
   * Vielfaches von `GRID_M` sein. Vorgabe `GRID_M`: jede innere Zellecke
   * trägt einen Pfeiler.
   */
  readonly raster?: number;
  /**
   * Pfeilerstellen von Hand — überschreibt `pillarPositions`. Wie im
   * Python (`hall_module(..., pillars=…)`) für Sonderfälle gedacht, nicht
   * für den Regelbetrieb.
   */
  readonly pillars?: readonly (readonly [number, number])[];
}

// ── Masse (alle aus make-stonevault.py) ─────────────────────────────────
/** Rastermass / Zellbreite. */
export const GRID_M = 2.0;
/** Raumhöhe: Bodenoberkante bis Deckenunterkante. */
export const HEIGHT_M = 3.5;
/** Plattendicke von Boden und Decke. */
export const SLAB_M = 0.25;
/** Kachelmass der Bodenplatten — bleibt 0,5, damit das Muster über Zellgrenzen läuft. */
const TILE_M = GRID_M / 4;
/** Fugenbreite zwischen zwei Bodenplatten. */
const JOINT_M = 0.03;
/** Trägerplatte unter den Bodenplatten: hält das Aussenmass und schliesst die Fugen. */
const CARRIER_M = 0.05;

/*
  NAHTSCHLUSS (03.09.2026, aus dem Python übernommen).

  Warum die Pfeiler nicht bei 0 und 3,5 enden: Ein Deckel exakt auf der
  Plattenfläche läge koplanar AUF ihr und flimmerte von oben und unten.
  Deshalb stecken Pfeiler 1 cm INNERHALB der Platten (EINSTICH). Für die
  Dichtheit ist das gleichwertig — abzudichten ist die Fuge bei z = 0
  bzw. z = 3,5, und davor steht dann Material statt Luft.
*/
const WALL_BOTTOM = -SLAB_M; // -0,25: Unterkante der Bodenplatte
const WALL_TOP = HEIGHT_M + SLAB_M; //  3,75: Oberkante der Deckenplatte
const INSET = 0.01;
const IN_BOTTOM = WALL_BOTTOM + INSET; // -0,24
const IN_TOP = WALL_TOP - INSET; //  3,74
const IN_H = IN_TOP - IN_BOTTOM; //  3,98
const IN_CZ = (IN_BOTTOM + IN_TOP) / 2; //  1,75

/** Spannweite in Metern, ab der Pfeiler stehen. */
export const PILLAR_SPAN_M = 4.0;
/** Schaft, quadratisch. */
const PILLAR_SHAFT_M = 0.5;
/** Fuss und Kämpfer, etwas breiter als der Schaft. */
const PILLAR_FOOT_M = 0.7;
/** Höhe von Fuss bzw. Kämpfer. */
const PILLAR_FOOT_H = 0.25;

// ── Ecken und Flächen eines Quaders ─────────────────────────────────────
/**
 * Die sechs Seitenflächen über acht Ecken, Indexreihenfolge wie `QUADS`
 * im Python. Für einen achsenparallelen Quader zeigen sie bereits alle
 * nach aussen — `normals_make_consistent(inside=False)` ist an einem
 * Saal folglich wirkungslos, und die 24·B Ecken der GLBs beweisen
 * nebenbei, dass auch `remove_doubles` nichts zusammenlegt.
 */
export const BOX_QUADS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 2],
  [4, 6, 7, 5],
  [0, 4, 5, 1],
  [2, 3, 7, 6],
  [0, 2, 6, 4],
  [1, 5, 7, 3],
];

/*
  Vorzeichen der acht Ecken in AUSGABEREIHENFOLGE.

  Blender legt sie als `for dx in (-1,1) for dy in (-1,1) for dz in (-1,1)`
  an — und `aufbereiten()` negiert die x-Koordinate erst DANACH, ohne die
  Flächenwicklung anzufassen. Ecke 0 liegt also im fertigen Modul auf der
  +x-Seite. Wer statt dessen wieder mit -x anfinge, bekäme dieselben acht
  Punkte in anderer Reihenfolge — und damit eine nach aussen gedrehte
  Wicklung. Das negative signierte Volumen, an dem die Vorspiegelung
  hängt (der Client dreht sie über Babylons `__root__` zurück), wäre weg,
  ohne dass sich ein einziger Punkt verschöbe. Deshalb steht die
  Spiegelung hier in der Reihenfolge und nicht als zweiter Durchlauf.
*/
const CORNER_SIGNS: readonly Vec3[] = (() => {
  const s: Vec3[] = [];
  for (const dx of [1, -1]) {
    for (const dy of [-1, 1]) {
      for (const dz of [-1, 1]) s.push({ x: dx, y: dy, z: dz });
    }
  }
  return s;
})();

/** Die acht Ecken eines Quaders in Ausgabereihenfolge (siehe `CORNER_SIGNS`). */
export function boxVertices(box: Box): Vec3[] {
  const hx = box.sx / 2;
  const hy = box.sy / 2;
  const hz = box.sz / 2;
  return CORNER_SIGNS.map((s) => ({
    x: box.cx + s.x * hx,
    y: box.cy + s.y * hy,
    z: box.cz + s.z * hz,
  }));
}

// ── Bauteile ────────────────────────────────────────────────────────────
/** Achsenparalleler Quader mittig (cx, cy, cz) — das `box()` des Python. */
function pushBox(
  out: Box[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number
): void {
  out.push({ cx, cy, cz, sx, sy, sz });
}

/**
 * Boden- und Deckenplatte einer sizeX × sizeZ grossen Grundfläche.
 *
 * Der Boden ist keine Platte, sondern eine Trägerplatte mit 0,5-Kacheln
 * darauf: Die Fugen sollen Fugen sein und keine Löcher, und das
 * Aussenmass muss trotzdem exakt bleiben. Die beiden Masse sind seit der
 * Hallen-Vorlage getrennt — ein einziges G hätte jede rechteckige Halle
 * zu einem Sonderfall gemacht.
 */
function floorAndCeiling(out: Box[], sizeX: number, sizeZ: number): void {
  const hx = sizeX / 2;
  const hz = sizeZ / 2;
  // Trägerplatte unten, volle Fläche.
  pushBox(out, 0, 0, -SLAB_M + CARRIER_M / 2, sizeX, sizeZ, CARRIER_M);
  // Platten von z = -0,20 bis z = 0.
  const nx = Math.round(sizeX / TILE_M);
  const nz = Math.round(sizeZ / TILE_M);
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < nz; iy++) {
      pushBox(
        out,
        -hx + (ix + 0.5) * TILE_M,
        -hz + (iy + 0.5) * TILE_M,
        -(SLAB_M - CARRIER_M) / 2,
        TILE_M - JOINT_M,
        TILE_M - JOINT_M,
        SLAB_M - CARRIER_M
      );
    }
  }
  // Deckenplatte: Unterseite exakt bei z = HEIGHT_M, volle Fläche.
  pushBox(out, 0, 0, HEIGHT_M + SLAB_M / 2, sizeX, sizeZ, SLAB_M);
}

/**
 * Ein Stützpfeiler auf (cx, cy): Schaft, Fuss, Kämpfer. Er steckt oben
 * und unten in den Platten — derselbe Nahtschluss wie bei den
 * Innenwänden, damit an Boden und Decke keine koplanaren Flächen
 * entstehen.
 */
function pillar(out: Box[], cx: number, cy: number): void {
  pushBox(out, cx, cy, IN_CZ, PILLAR_SHAFT_M, PILLAR_SHAFT_M, IN_H);
  pushBox(
    out,
    cx,
    cy,
    (IN_BOTTOM + PILLAR_FOOT_H) / 2,
    PILLAR_FOOT_M,
    PILLAR_FOOT_M,
    PILLAR_FOOT_H - IN_BOTTOM
  );
  pushBox(
    out,
    cx,
    cy,
    (HEIGHT_M - PILLAR_FOOT_H + IN_TOP) / 2,
    PILLAR_FOOT_M,
    PILLAR_FOOT_M,
    IN_TOP - HEIGHT_M + PILLAR_FOOT_H
  );
}

/**
 * Die inneren Zellecken im Abstand `raster` — leer, solange beide
 * Spannweiten <= PILLAR_SPAN_M.
 *
 * Warum überhaupt Pfeiler: Die Deckenplatte trägt sich als Bauteil
 * beliebig weit — das Auge nicht. Ein 6 × 6 m grosser Saal mit frei
 * schwebender Steindecke liest sich als Halle aus Pappe.
 *
 * Warum auf Zellecken: Die Durchgänge liegen auf den Zellkanten-MITTEN.
 * Ein Pfeiler auf einer Zellecke steht deshalb nie in einem Weg — und
 * genau dagegen steht die Klemme unten. Ein Raster, das kein Vielfaches
 * der Zellbreite ist, setzte Pfeiler in die Durchgänge, und das fiele
 * erst im fertigen Grab auf.
 *
 * Warum ab 8 m ein gröberes Raster sinnvoll ist: eine Reihe alle 2 m
 * ergäbe im 12 × 12 m grossen Saal 25 Pfeiler, also einen Wald statt
 * eines Saals — der Saal ist ja gerade dafür da, dass es EINMAL weit ist.
 */
export function pillarPositions(
  cellsX: number,
  cellsZ: number,
  raster: number = GRID_M
): (readonly [number, number])[] {
  const schritt = Math.round(raster / GRID_M);
  if (schritt < 1 || Math.abs(schritt * GRID_M - raster) > 1e-6) {
    throw new Error(`Pfeilerraster ${raster} ist kein Vielfaches von ${GRID_M}`);
  }
  const sx = cellsX * GRID_M;
  const sz = cellsZ * GRID_M;
  if (Math.max(sx, sz) <= PILLAR_SPAN_M + 1e-6) return [];
  const xs: number[] = [];
  for (let i = schritt; i < cellsX; i += schritt) xs.push(i * GRID_M - sx / 2);
  const zs: number[] = [];
  for (let i = schritt; i < cellsZ; i += schritt) zs.push(i * GRID_M - sz / 2);
  const stellen: (readonly [number, number])[] = [];
  for (const x of xs) {
    for (const z of zs) stellen.push([x, z]);
  }
  return stellen;
}

/**
 * Ein Saal aus cellsX × cellsZ Zellen: Boden + Decke, keine Wände,
 * Pivot Bodenmitte. EINE Funktion für alle Säle des Kits — mit einer
 * Funktion je Grösse wären es fast gleiche Funktionen, die beim nächsten
 * Nahtschluss einzeln nachzuziehen sind.
 */
export function buildHall(
  cellsX: number,
  cellsZ: number,
  options: HallOptions = {}
): HallGeometry {
  if (!Number.isInteger(cellsX) || !Number.isInteger(cellsZ) || cellsX < 1 || cellsZ < 1) {
    throw new Error(`Zellzahl muss ganz und >= 1 sein (${cellsX} x ${cellsZ})`);
  }
  const raster = options.raster ?? GRID_M;
  const sizeX = cellsX * GRID_M;
  const sizeZ = cellsZ * GRID_M;

  const boxes: Box[] = [];
  floorAndCeiling(boxes, sizeX, sizeZ);
  const stellen = options.pillars ?? pillarPositions(cellsX, cellsZ, raster);
  for (const [cx, cy] of stellen) pillar(boxes, cx, cy);

  /*
    x-Negation zum Schluss, wie `aufbereiten()` es tut: alle
    Steingrab-Module haben negatives signiertes Volumen, also in x
    vorgespiegelte Geometrie ohne Winding-Flip. Die Wicklung bleibt
    unberührt — sie steckt in `CORNER_SIGNS`, nicht hier.
  */
  for (const b of boxes) b.cx = -b.cx;
  const pillars: Vec3[] = stellen.map(([cx, cy]) => ({ x: -cx, y: cy, z: IN_CZ }));

  return {
    cellsX,
    cellsZ,
    raster,
    boxes,
    pillars,
    sizeX,
    sizeZ,
    triangles: 12 * boxes.length,
    vertices: 24 * boxes.length,
  };
}
