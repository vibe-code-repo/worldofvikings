/**
 * Height fields: reading one out of a glTF model, thinning it, and writing a
 * clean grid back out (ADR-0020).
 *
 * The height field export is a regular grid of `n × n` vertices in metres, and
 * it arrives with two problems the renderer cannot work around. Its `TEXCOORD_0`
 * is all zeros, so every ground texture would sample one texel; and at 513²
 * vertices — 524 288 triangles, 14 MB — one tile costs more than the rest of the
 * scene put together.
 *
 * Both are fixed by *rebuilding* the grid rather than editing the container:
 * take every second row and column, emit positions, UVs and indices in plain
 * row-major order, and compute normals from the neighbouring heights. That is
 * why this module sits next to `glb.ts` instead of inside it — `glb.ts` is
 * explicit that it touches the container and never the geometry, and this does
 * the opposite.
 *
 * Everything here is a pure function over plain arrays: same input, same bytes.
 */
import { walkNodes, type Glb, type Gltf } from '@wov/content-build';

/**
 * A regular grid of heights, row-major: `heights[row * columns + column]`.
 *
 * `columns` runs along x, `rows` along z, both starting at `originX` / `originZ`
 * with a constant step. Nothing here assumes a square grid or an integer step —
 * both are measured off the file (agent rule: measure, do not assume).
 */
export interface HeightGrid {
  readonly columns: number;
  readonly rows: number;
  readonly originX: number;
  readonly originZ: number;
  readonly stepX: number;
  readonly stepZ: number;
  readonly heights: Float32Array;
}

/** `[min, max]` per axis, in metres. */
export interface HeightGridBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** The hull of a grid: the tile's extent in x and z, and the height range. */
export function gridBounds(grid: HeightGrid): HeightGridBounds {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const height of grid.heights) {
    minY = Math.min(minY, height);
    maxY = Math.max(maxY, height);
  }
  return {
    min: [grid.originX, minY, grid.originZ],
    max: [
      grid.originX + grid.stepX * (grid.columns - 1),
      maxY,
      grid.originZ + grid.stepZ * (grid.rows - 1),
    ],
  };
}

/** `[width, depth]` of the tile in metres — the world file's `size`. */
export function gridSize(grid: HeightGrid): [number, number] {
  return [grid.stepX * (grid.columns - 1), grid.stepZ * (grid.rows - 1)];
}

/** Reads a float VEC3 accessor out of the binary chunk, honouring its stride. */
function readVec3(glb: Glb, accessorIndex: number, label: string): Float32Array {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (accessor?.bufferView === undefined || accessor.componentType !== 5126) {
    throw new Error(`${label}: POSITION is not a float VEC3 in the buffer`);
  }
  const view = glb.json.bufferViews?.[accessor.bufferView];
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view?.byteStride ?? 12;
  const out = new Float32Array(accessor.count * 3);
  for (let index = 0; index < accessor.count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[index * 3 + axis] = glb.bin.readFloatLE(start + index * stride + axis * 4);
    }
  }
  return out;
}

/**
 * The distinct values of one axis, in ascending order, with the spacing they
 * are on.
 *
 * A grid step of `300 / 512` is a binary fraction and therefore exact in
 * `float32`, which is why the values can be compared and indexed directly. A
 * source that is *not* on an exact grid would fail the regularity check below
 * rather than be quietly rounded onto one.
 */
function axisValues(values: Float32Array, stride: number, offset: number): number[] {
  const seen = new Set<number>();
  for (let index = offset; index < values.length; index += stride) {
    // `+ 0` folds -0 onto 0: the exporter writes -0 for the first column, and
    // a Set would otherwise be fine but the sort below would not be stable.
    seen.add((values[index] ?? 0) + 0);
  }
  return [...seen].sort((a, b) => a - b);
}

function constantStep(values: readonly number[], axis: string, label: string): number {
  if (values.length < 2) {
    throw new Error(`${label}: only ${String(values.length)} distinct ${axis} value(s)`);
  }
  const first = values[1] as number;
  const zero = values[0] as number;
  const step = first - zero;
  for (let index = 1; index < values.length; index += 1) {
    const expected = zero + step * index;
    const actual = values[index] as number;
    // A relative tolerance, because the values come out of float32: a 300 m
    // tile's last column is allowed to be a few ULPs off the ideal multiple.
    if (Math.abs(actual - expected) > Math.abs(step) * 1e-3) {
      throw new Error(
        `${label}: ${axis} values are not on a constant step ` +
          `(expected ${String(expected)}, got ${String(actual)})`,
      );
    }
  }
  return step;
}

/**
 * Reads a regular height grid out of a model.
 *
 * The vertex *order* in the file is not assumed to be anything: every position
 * is placed into the grid by its own coordinates, and a cell that ends up
 * empty or claimed twice is an error. The height field export orders its
 * vertices in a way that is neither row-major nor a Morton curve, and guessing
 * wrong would tilt the whole tile without failing.
 *
 * @throws when the model is not one regular, completely filled grid.
 */
export function readHeightGrid(glb: Glb, label: string): HeightGrid {
  const positions: Float32Array[] = [];
  walkNodes(glb.json, (node, matrix) => {
    if (node.mesh === undefined) {
      return;
    }
    for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      const accessorIndex = primitive.attributes['POSITION'];
      if (accessorIndex === undefined) {
        throw new Error(`${label}: a primitive has no POSITION`);
      }
      const local = readVec3(glb, accessorIndex, label);
      // Only a translation and a scale can survive as a grid, and the height
      // field export uses neither — but transform anyway rather than assume.
      const world = new Float32Array(local.length);
      for (let index = 0; index < local.length; index += 3) {
        const x = local[index] ?? 0;
        const y = local[index + 1] ?? 0;
        const z = local[index + 2] ?? 0;
        world[index] =
          (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0);
        world[index + 1] =
          (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0);
        world[index + 2] =
          (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0);
      }
      positions.push(world);
    }
  });

  if (positions.length !== 1) {
    throw new Error(
      `${label}: expected exactly one mesh primitive, found ${String(positions.length)}`,
    );
  }
  const vertices = positions[0] as Float32Array;

  const xs = axisValues(vertices, 3, 0);
  const zs = axisValues(vertices, 3, 2);
  const columns = xs.length;
  const rows = zs.length;
  if (columns * rows !== vertices.length / 3) {
    throw new Error(
      `${label}: ${String(vertices.length / 3)} vertices are not a ` +
        `${String(columns)} x ${String(rows)} grid`,
    );
  }

  const stepX = constantStep(xs, 'x', label);
  const stepZ = constantStep(zs, 'z', label);
  const originX = xs[0] as number;
  const originZ = zs[0] as number;

  const heights = new Float32Array(columns * rows).fill(Number.NaN);
  for (let index = 0; index < vertices.length; index += 3) {
    const column = Math.round(((vertices[index] ?? 0) - originX) / stepX);
    const row = Math.round(((vertices[index + 2] ?? 0) - originZ) / stepZ);
    const cell = row * columns + column;
    if (!Number.isNaN(heights[cell] as number)) {
      throw new Error(`${label}: two vertices claim grid cell ${String(column)},${String(row)}`);
    }
    heights[cell] = vertices[index + 1] ?? 0;
  }
  for (let cell = 0; cell < heights.length; cell += 1) {
    if (Number.isNaN(heights[cell] as number)) {
      throw new Error(`${label}: grid cell ${String(cell)} has no vertex`);
    }
  }

  return { columns, rows, originX, originZ, stepX, stepZ, heights };
}

/**
 * The ground height at `[x, z]`, interpolated across the cell it falls in.
 *
 * Bilinear rather than nearest: at 1.17 m between vertices, a nearest-vertex
 * answer would put a scattered tuft of grass up to 40 cm above or below the
 * triangle it stands on, which on the village slopes is a tuft floating in the
 * air. A point outside the grid is clamped to its edge rather than refused —
 * the caller is scattering over a region it already believes is on the tile,
 * and a rejection there would be a crash instead of a placement.
 *
 * This is not the renderer's ground query (ADR-0014): the renderer raycasts
 * against the tile it drew. This reads the same numbers off the same file
 * before either exists, which is what an offline authoring tool has.
 */
export function heightAt(grid: HeightGrid, x: number, z: number): number {
  const column = clamp((x - grid.originX) / grid.stepX, grid.columns - 1);
  const row = clamp((z - grid.originZ) / grid.stepZ, grid.rows - 1);
  const column0 = Math.min(Math.floor(column), Math.max(0, grid.columns - 2));
  const row0 = Math.min(Math.floor(row), Math.max(0, grid.rows - 2));
  const column1 = Math.min(column0 + 1, grid.columns - 1);
  const row1 = Math.min(row0 + 1, grid.rows - 1);
  const alongX = column - column0;
  const alongZ = row - row0;

  const at = (c: number, r: number): number => grid.heights[r * grid.columns + c] ?? 0;
  const front = at(column0, row0) + (at(column1, row0) - at(column0, row0)) * alongX;
  const back = at(column0, row1) + (at(column1, row1) - at(column0, row1)) * alongX;
  return front + (back - front) * alongZ;
}

function clamp(value: number, high: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, high)) : 0;
}

/**
 * Keeps every `factor`-th row and column, so `513² → 257²` at factor 2.
 *
 * Sampling, not averaging: the kept vertices are the source's own heights, so
 * the thinned tile still touches the original surface at every vertex it has.
 * Averaging would round off exactly the ridges a player stands on and would
 * make the collision mesh disagree with the source by a smoothed amount
 * everywhere instead of by an interpolation error between samples.
 *
 * @throws unless `factor` divides `columns - 1` and `rows - 1`, because a
 * remainder would silently drop the far edge of the tile.
 */
export function thinGrid(grid: HeightGrid, factor: number): HeightGrid {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`thinning factor must be a positive integer, got ${String(factor)}`);
  }
  if ((grid.columns - 1) % factor !== 0 || (grid.rows - 1) % factor !== 0) {
    throw new Error(
      `a ${String(grid.columns)} x ${String(grid.rows)} grid cannot be thinned by ${String(factor)} ` +
        'without losing its far edge',
    );
  }
  if (factor === 1) {
    return grid;
  }

  const columns = (grid.columns - 1) / factor + 1;
  const rows = (grid.rows - 1) / factor + 1;
  const heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      heights[row * columns + column] =
        grid.heights[row * factor * grid.columns + column * factor] ?? 0;
    }
  }

  return {
    columns,
    rows,
    originX: grid.originX,
    originZ: grid.originZ,
    stepX: grid.stepX * factor,
    stepZ: grid.stepZ * factor,
    heights,
  };
}

/**
 * Per-vertex normals from the neighbouring heights (central differences).
 *
 * For a surface `y = f(x, z)` the normal is `(-∂f/∂x, 1, -∂f/∂z)` normalised.
 * On a regular grid that is exact and needs no triangle walk, so it is both
 * cheaper and smoother than averaging face normals — and, because it depends
 * only on the heights, it cannot disagree with the triangle winding.
 */
export function gridNormals(grid: HeightGrid): Float32Array {
  const { columns, rows, stepX, stepZ, heights } = grid;
  const normals = new Float32Array(columns * rows * 3);
  const at = (column: number, row: number): number =>
    heights[
      Math.min(rows - 1, Math.max(0, row)) * columns + Math.min(columns - 1, Math.max(0, column))
    ] ?? 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // At the border the clamped neighbour is the vertex itself, which halves
      // the span — so divide by the distance actually used.
      const left = Math.max(0, column - 1);
      const right = Math.min(columns - 1, column + 1);
      const back = Math.max(0, row - 1);
      const front = Math.min(rows - 1, row + 1);
      const dx = (at(right, row) - at(left, row)) / ((right - left) * stepX);
      const dz = (at(column, front) - at(column, back)) / ((front - back) * stepZ);
      const length = Math.hypot(dx, 1, dz);
      const index = (row * columns + column) * 3;
      normals[index] = -dx / length;
      normals[index + 1] = 1 / length;
      normals[index + 2] = -dz / length;
    }
  }
  return normals;
}

/**
 * Two triangles per cell, wound so the front face is the one the normal points
 * out of (glTF: counter-clockwise in a right-handed frame).
 *
 * `gridNormals` derives its normals from the heights alone, so a wrong winding
 * here would show as a tile lit from inside rather than as a compile error —
 * `height-field.test.ts` therefore checks the emitted cross products.
 */
export function gridIndices(grid: HeightGrid): Uint32Array {
  const { columns, rows } = grid;
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let out = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices[out] = a;
      indices[out + 1] = c;
      indices[out + 2] = d;
      indices[out + 3] = a;
      indices[out + 4] = d;
      indices[out + 5] = b;
      out += 6;
    }
  }
  return indices;
}

/**
 * `[u, v]` per vertex, spanning the whole tile once.
 *
 * One repeat over the tile, not one per metre: how often a *texture* repeats is
 * the world file's `tileSize` and the renderer's business (ADR-0020). Baking a
 * repeat count into the model would fix the ground's scale at import time.
 */
export function gridUvs(grid: HeightGrid): Float32Array {
  const { columns, rows } = grid;
  const uvs = new Float32Array(columns * rows * 2);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = (row * columns + column) * 2;
      uvs[index] = column / (columns - 1);
      uvs[index + 1] = row / (rows - 1);
    }
  }
  return uvs;
}

/** `[x, y, z]` per vertex in the grid's own space, row-major. */
export function gridPositions(grid: HeightGrid): Float32Array {
  const { columns, rows, originX, originZ, stepX, stepZ, heights } = grid;
  const positions = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const vertex = row * columns + column;
      positions[vertex * 3] = originX + column * stepX;
      positions[vertex * 3 + 1] = heights[vertex] ?? 0;
      positions[vertex * 3 + 2] = originZ + row * stepZ;
    }
  }
  return positions;
}

/**
 * Builds a complete, self-contained GLB from a grid: positions, normals, UVs,
 * indices and one plain material.
 *
 * Written from scratch rather than by editing the source container, because
 * every buffer in it changes anyway — and a file assembled here has exactly
 * one primitive, one buffer and no leftover accessor, which is what makes the
 * output byte-identical for identical input.
 *
 * The origin is **not** moved: the tile keeps the coordinates the export gave
 * it, so a file spanning `0…300 m` still spans `0…300 m`. Where the tile stands
 * is `terrain.position` in the world file (`docs/world-format.md`).
 */
export function buildHeightFieldGlb(name: string, grid: HeightGrid): Glb {
  const positions = gridPositions(grid);
  const normals = gridNormals(grid);
  const uvs = gridUvs(grid);
  const indices = gridIndices(grid);
  const bounds = gridBounds(grid);

  const views: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  const parts: Buffer[] = [];
  let offset = 0;

  /** Appends one buffer view, four-byte aligned, and returns its index. */
  const push = (bytes: Buffer, target: number): number => {
    const padding = (4 - (offset % 4)) % 4;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      offset += padding;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    parts.push(bytes);
    offset += bytes.length;
    return views.length - 1;
  };

  // Written out explicitly little-endian rather than handed over as the typed
  // array's own memory: glTF fixes the byte order, a typed array uses the
  // host's, and the file must be identical on every machine.
  const floats = (values: Float32Array): Buffer => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    return bytes;
  };
  const uints = (values: Uint32Array): Buffer => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
    return bytes;
  };

  const positionView = push(floats(positions), 34962);
  const normalView = push(floats(normals), 34962);
  const uvView = push(floats(uvs), 34962);
  const indexView = push(uints(indices), 34963);

  const vertexCount = grid.columns * grid.rows;
  const json: Gltf = {
    asset: { version: '2.0', generator: 'World of Vikings asset pipeline' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [
      {
        name,
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    materials: [
      { name: 'terrain', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } },
    ],
    accessors: [
      {
        bufferView: positionView,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
        min: [...bounds.min],
        max: [...bounds.max],
      },
      { bufferView: normalView, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: uvView, componentType: 5126, count: vertexCount, type: 'VEC2' },
      { bufferView: indexView, componentType: 5125, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };

  return { json, bin: Buffer.concat(parts) };
}
