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
 * The ground height at a **world** `[x, z]`, for a grid placed as a world tile.
 *
 * A tile occupies the world rectangle from `position` to `position + size`, and
 * the grid inside it is stretched over exactly that rectangle. The grid's own
 * origin is *not* the tile's corner and must not be treated as one: a raster
 * rebuilt by {@link buildHeightFieldGlb} starts at 0, while the modelling
 * export's own raster of the same ground is centred and starts at −150. Both
 * are the same 300 m tile, and mapping through the rectangle is what makes them
 * answer alike — the two agree to 2.3 cm across the village.
 *
 * Subtracting `position` and then letting {@link heightAt} add the grid origin
 * back reads a centred raster 150 m off its corner. That is the shape of a
 * silent error rather than a crash: every answer is a real height from a real
 * part of the tile, just the wrong part, and a scatter run over the village put
 * 4 032 tufts of grass 47 m into the air and exited 0. `heightSamples` was
 * introduced (ADR-0032) precisely so a tool may be handed a raster that is not
 * the drawn tile, so the frames stopped being guaranteed to match on that day.
 *
 * @param position the tile's world placement; `y` is not used here, a caller
 *   adds it to the result the way it adds it to everything else on the tile.
 * @param size `[width, depth]` of the tile in metres.
 */
export function heightAtOnTile(
  grid: HeightGrid,
  x: number,
  z: number,
  position: readonly [number, number, number],
  size: readonly [number, number],
): number {
  const spanX = grid.stepX * (grid.columns - 1);
  const spanZ = grid.stepZ * (grid.rows - 1);
  const width = size[0];
  const depth = size[1];
  // A degenerate tile would divide by zero; read it at its own origin instead,
  // which is the same answer `heightAt` gives for a value that is not a number.
  const alongX = width === 0 ? 0 : (x - position[0]) / width;
  const alongZ = depth === 0 ? 0 : (z - position[2]) / depth;
  return heightAt(grid, grid.originX + alongX * spanX, grid.originZ + alongZ * spanZ);
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
 * The same ground read with its two horizontal axes swapped: the height at
 * `(x, z)` of the result is the height at `(z, x)` of the source.
 *
 * **Why a height field needs this at all.** The modelling export writes its
 * raster and its scene placements in two different frames, and the difference
 * is one reflection. The import already absorbs half of it — a placed model is
 * mirrored in x on the way in — and the ground was left as it came, which
 * leaves the pair a quarter turn apart. Nothing about the files says so: the
 * raster is square, the tile is square, and a wrongly turned ground is a
 * perfectly plausible landscape that simply is not the one the props were
 * placed on.
 *
 * It was measured, not guessed (ADR-0059). For each of the eight ways to turn
 * or mirror a square raster, 374 authored placements from 34 families of flat
 * ground dressing were seated on it, and the spread of each family about its
 * own median taken. Seven of the eight give a mean absolute deviation of
 * 0.28–0.76 m. One gives **0.068 m**: this one. The cliff ring of ADR-0037 —
 * 100 placements that were never scattered onto, so they cannot have been
 * fitted to the ground being tested — goes from 81 of 100 standing on the
 * ground to **100 of 100** under the same swap.
 *
 * A pure index swap, so a square raster keeps its bytes and only changes which
 * of them answers where. Origin and step travel with their axis, so a
 * non-square or unevenly stepped grid transposes correctly too.
 */
export function transposeGrid(grid: HeightGrid): HeightGrid {
  const columns = grid.rows;
  const rows = grid.columns;
  const heights = new Float32Array(grid.heights.length);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // The new (column, row) reads x from the source's z and z from its x.
      heights[row * columns + column] = grid.heights[column * grid.columns + row] ?? 0;
    }
  }
  return {
    columns,
    rows,
    originX: grid.originZ,
    originZ: grid.originX,
    stepX: grid.stepZ,
    stepZ: grid.stepX,
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

// ------------------------------------------------------- adaptive resolution

/**
 * A finished tile as buffers, whatever grid it came from.
 *
 * A grid is not enough to describe an adaptive tile: its vertices are no longer
 * `rows × columns` and its triangles are no longer two per cell. So the writer
 * takes this instead, and {@link gridMesh} turns a plain grid into one.
 */
export interface TerrainMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: HeightGridBounds;
}

/** A plain grid as a mesh: the same four buffers it always produced. */
export function gridMesh(grid: HeightGrid): TerrainMesh {
  return {
    positions: gridPositions(grid),
    normals: gridNormals(grid),
    uvs: gridUvs(grid),
    indices: gridIndices(grid),
    bounds: gridBounds(grid),
  };
}

/** The steepest of the two triangles of one source cell, in degrees. */
function cellSlope(grid: HeightGrid, column: number, row: number): number {
  const at = (c: number, r: number): number => grid.heights[r * grid.columns + c] ?? 0;
  const h00 = at(column, row);
  const h10 = at(column + 1, row);
  const h01 = at(column, row + 1);
  const h11 = at(column + 1, row + 1);
  // Two triangles, each a plane: the gradient of a plane through three heights
  // is the slope of that triangle, and the steeper of the two is the cell's.
  const first = Math.hypot((h10 - h00) / grid.stepX, (h01 - h00) / grid.stepZ);
  const second = Math.hypot((h11 - h01) / grid.stepX, (h11 - h10) / grid.stepZ);
  return (Math.atan(Math.max(first, second)) * 180) / Math.PI;
}

/**
 * What share of a grid's triangle area stands steeper than `degrees`.
 *
 * The number the thinning costs: a 513² tile has 7 % of its cells past 60°, a
 * 257² one has a quarter fewer, because two neighbouring cliff cells averaged
 * into one are a ramp. Reported by the importer so the loss is a figure in the
 * log rather than a claim in a commit message.
 */
export function steepShare(grid: HeightGrid, degrees: number): number {
  let steep = 0;
  const cells = (grid.columns - 1) * (grid.rows - 1);
  for (let row = 0; row < grid.rows - 1; row += 1) {
    for (let column = 0; column < grid.columns - 1; column += 1) {
      if (cellSlope(grid, column, row) > degrees) {
        steep += 1;
      }
    }
  }
  return cells === 0 ? 0 : steep / cells;
}

/** What {@link adaptiveMesh} built, and what it cost. */
export interface AdaptiveMesh extends TerrainMesh {
  /** Coarse cells kept at the source resolution. */
  readonly steepCells: number;
  /** Coarse cells in the tile altogether. */
  readonly coarseCells: number;
  readonly vertices: number;
  readonly triangles: number;
}

/**
 * One mesh, coarse where the ground is gentle and full resolution where it is
 * not (ADR-0032).
 *
 * Thinning 513² to 257² is what makes the village affordable, and it is also
 * what rounds the cliffs off: a quarter of the faces past 60° stop being past
 * 60°, because two cliff cells averaged into one are a ramp. Keeping the whole
 * tile at 513² costs four times the triangles for ground that is flat almost
 * everywhere — on the village tile, 7 % of it is steep.
 *
 * So the coarse cell is the unit: a coarse cell whose source triangles all stand
 * below `minSlopeDegrees` is emitted as two triangles, and one that has a steep
 * triangle anywhere in it is emitted at the source resolution.
 *
 * **The seam is the whole problem.** A fine cell against a coarse one puts a
 * vertex halfway along an edge the coarse triangle draws straight — a
 * T-junction, and a T-junction is a hairline of background showing through the
 * ground, moving as the camera moves. The fix is not a stitching strip but the
 * cheapest correct thing: a fine vertex that sits on the boundary **between** a
 * steep cell and a gentle one is placed on the straight edge, at the average of
 * the two coarse heights, instead of at its own. It gives up the height it knew
 * exactly where nobody can see it — on the last centimetres before a coarse
 * triangle takes over — and the two edges then coincide.
 *
 * Normals are accumulated from the triangles actually emitted rather than
 * derived from the grid, because at a seam those are two different answers and
 * only one of them matches what is drawn.
 */
export function adaptiveMesh(
  grid: HeightGrid,
  factor: number,
  minSlopeDegrees: number,
): AdaptiveMesh {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`thinning factor must be a positive integer, got ${String(factor)}`);
  }
  if ((grid.columns - 1) % factor !== 0 || (grid.rows - 1) % factor !== 0) {
    throw new Error(
      `a ${String(grid.columns)} x ${String(grid.rows)} grid cannot be thinned by ` +
        `${String(factor)} without losing its far edge`,
    );
  }
  if (!Number.isFinite(minSlopeDegrees) || minSlopeDegrees < 0 || minSlopeDegrees >= 90) {
    throw new Error(`the steep-slope threshold must be 0…90°, got ${String(minSlopeDegrees)}`);
  }

  const coarseColumns = (grid.columns - 1) / factor;
  const coarseRows = (grid.rows - 1) / factor;
  const steep = new Uint8Array(coarseColumns * coarseRows);
  for (let cellRow = 0; cellRow < coarseRows; cellRow += 1) {
    for (let cellColumn = 0; cellColumn < coarseColumns; cellColumn += 1) {
      let found = false;
      for (let row = cellRow * factor; row < (cellRow + 1) * factor && !found; row += 1) {
        for (let column = cellColumn * factor; column < (cellColumn + 1) * factor; column += 1) {
          if (cellSlope(grid, column, row) > minSlopeDegrees) {
            found = true;
            break;
          }
        }
      }
      steep[cellRow * coarseColumns + cellColumn] = found ? 1 : 0;
    }
  }
  const inside = (cellColumn: number, cellRow: number): boolean =>
    cellColumn >= 0 && cellRow >= 0 && cellColumn < coarseColumns && cellRow < coarseRows;
  const isSteep = (cellColumn: number, cellRow: number): boolean =>
    inside(cellColumn, cellRow) && steep[cellRow * coarseColumns + cellColumn] === 1;
  /**
   * True when the cell on the other side of an edge draws it as one straight
   * line, so a fine vertex on that edge has to lie on it.
   *
   * A cell *outside* the tile draws nothing, so the tile's own border keeps its
   * full detail — snapping there would round off every cliff that runs into the
   * edge of the world, to match a neighbour that does not exist.
   */
  const drawnCoarse = (cellColumn: number, cellRow: number): boolean =>
    inside(cellColumn, cellRow) && !isSteep(cellColumn, cellRow);

  const heightAtGrid = (column: number, row: number): number =>
    grid.heights[row * grid.columns + column] ?? 0;

  /**
   * The height a vertex is emitted with.
   *
   * On a seam — a fine vertex lying on a coarse edge whose other side is a
   * coarse cell — it is the straight line between the two coarse corners, so
   * the two edges coincide and no hairline opens.
   */
  const emittedHeight = (column: number, row: number): number => {
    const onColumnLine = column % factor === 0;
    const onRowLine = row % factor === 0;
    if (onColumnLine && onRowLine) {
      return heightAtGrid(column, row);
    }
    if (onColumnLine) {
      // A vertical coarse edge; the cells left and right of it decide.
      const cellColumn = column / factor;
      const cellRow = Math.floor(row / factor);
      if (!drawnCoarse(cellColumn - 1, cellRow) && !drawnCoarse(cellColumn, cellRow)) {
        return heightAtGrid(column, row);
      }
      const low = heightAtGrid(column, cellRow * factor);
      const high = heightAtGrid(column, (cellRow + 1) * factor);
      return low + ((high - low) * (row - cellRow * factor)) / factor;
    }
    if (onRowLine) {
      const cellRow = row / factor;
      const cellColumn = Math.floor(column / factor);
      if (!drawnCoarse(cellColumn, cellRow - 1) && !drawnCoarse(cellColumn, cellRow)) {
        return heightAtGrid(column, row);
      }
      const low = heightAtGrid(cellColumn * factor, row);
      const high = heightAtGrid((cellColumn + 1) * factor, row);
      return low + ((high - low) * (column - cellColumn * factor)) / factor;
    }
    return heightAtGrid(column, row);
  };

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const indexBySource = new Map<number, number>();
  const width = grid.stepX * (grid.columns - 1);
  const depth = grid.stepZ * (grid.rows - 1);

  const vertexAt = (column: number, row: number): number => {
    const key = row * grid.columns + column;
    const known = indexBySource.get(key);
    if (known !== undefined) {
      return known;
    }
    const next = positions.length / 3;
    const x = grid.originX + column * grid.stepX;
    const z = grid.originZ + row * grid.stepZ;
    positions.push(x, emittedHeight(column, row), z);
    uvs.push((column * grid.stepX) / width, (row * grid.stepZ) / depth);
    indexBySource.set(key, next);
    return next;
  };

  /** Two triangles over one cell, wound as `gridIndices` winds them. */
  const quad = (column: number, row: number, span: number): void => {
    const topLeft = vertexAt(column, row);
    const topRight = vertexAt(column + span, row);
    const bottomLeft = vertexAt(column, row + span);
    const bottomRight = vertexAt(column + span, row + span);
    indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
  };

  let steepCells = 0;
  for (let cellRow = 0; cellRow < coarseRows; cellRow += 1) {
    for (let cellColumn = 0; cellColumn < coarseColumns; cellColumn += 1) {
      const column = cellColumn * factor;
      const row = cellRow * factor;
      if (!isSteep(cellColumn, cellRow)) {
        quad(column, row, factor);
        continue;
      }
      steepCells += 1;
      for (let inner = 0; inner < factor; inner += 1) {
        for (let across = 0; across < factor; across += 1) {
          quad(column + across, row + inner, 1);
        }
      }
    }
  }

  const positionArray = Float32Array.from(positions);
  const indexArray = Uint32Array.from(indices);
  return {
    positions: positionArray,
    normals: meshNormals(positionArray, indexArray),
    uvs: Float32Array.from(uvs),
    indices: indexArray,
    bounds: meshBounds(positionArray),
    steepCells,
    coarseCells: coarseColumns * coarseRows,
    vertices: positionArray.length / 3,
    triangles: indexArray.length / 3,
  };
}

/**
 * Per-vertex normals accumulated from the triangles that use them.
 *
 * Area-weighted, because the cross product of two edges is twice the triangle's
 * area: a large gentle triangle should have more say in a shared vertex than a
 * sliver. Not normalising per triangle first is what does that, for free.
 */
export function meshNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const a = (indices[index] ?? 0) * 3;
    const b = (indices[index + 1] ?? 0) * 3;
    const c = (indices[index + 2] ?? 0) * 3;
    const abx = (positions[b] ?? 0) - (positions[a] ?? 0);
    const aby = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const abz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const acx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const acy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const acz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [a, b, c]) {
      normals[vertex] = (normals[vertex] ?? 0) + nx;
      normals[vertex + 1] = (normals[vertex + 1] ?? 0) + ny;
      normals[vertex + 2] = (normals[vertex + 2] ?? 0) + nz;
    }
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(
      normals[vertex] ?? 0,
      normals[vertex + 1] ?? 0,
      normals[vertex + 2] ?? 0,
    );
    if (length === 0) {
      normals[vertex + 1] = 1;
      continue;
    }
    normals[vertex] = (normals[vertex] ?? 0) / length;
    normals[vertex + 1] = (normals[vertex + 1] ?? 0) / length;
    normals[vertex + 2] = (normals[vertex + 2] ?? 0) / length;
  }
  return normals;
}

/** How far a finished tile stands from the grid it was built out of. */
export interface GridAgreement {
  /** Mesh vertices standing exactly on a source grid node. */
  readonly nodes: number;
  /** Of those, the ones carrying that node's authored height unchanged. */
  readonly exact: number;
  /** The largest `|mesh height − authored sample|` over those nodes, in metres. */
  readonly maxDelta: number;
  /** Mesh vertices that sit between grid nodes, so the grid has no sample for them. */
  readonly offGrid: number;
}

/**
 * Where a tile and the raster it came from disagree, and by how much.
 *
 * A tool that has no renderer reads the raster; the player stands on the tile.
 * The two are the same ground only as far as this says they are, so the number
 * belongs in the import log and in a test rather than in a claim.
 *
 * Only vertices that land on a source grid node are compared — between nodes
 * the tile is an interpolation and the raster has nothing to compare against.
 * A coarse tile keeps every node it emits, so `exact` is expected to be all of
 * them; the seam vertices of {@link adaptiveMesh} are the deliberate exception,
 * and this is what bounds them.
 */
export function meshVsGrid(mesh: TerrainMesh, grid: HeightGrid): GridAgreement {
  let nodes = 0;
  let exact = 0;
  let offGrid = 0;
  let maxDelta = 0;
  // A node is "hit" when the vertex is within a thousandth of a step of it,
  // which is float32 noise rather than a tolerance on the geometry.
  const slack = 1e-3;
  for (let index = 0; index + 2 < mesh.positions.length; index += 3) {
    const column = ((mesh.positions[index] ?? 0) - grid.originX) / grid.stepX;
    const row = ((mesh.positions[index + 2] ?? 0) - grid.originZ) / grid.stepZ;
    const nearColumn = Math.round(column);
    const nearRow = Math.round(row);
    if (
      Math.abs(column - nearColumn) > slack ||
      Math.abs(row - nearRow) > slack ||
      nearColumn < 0 ||
      nearRow < 0 ||
      nearColumn >= grid.columns ||
      nearRow >= grid.rows
    ) {
      offGrid += 1;
      continue;
    }
    nodes += 1;
    const delta = Math.abs(
      (mesh.positions[index + 1] ?? 0) - (grid.heights[nearRow * grid.columns + nearColumn] ?? 0),
    );
    if (delta === 0) {
      exact += 1;
    }
    maxDelta = Math.max(maxDelta, delta);
  }
  return { nodes, exact, maxDelta, offGrid };
}

/** The hull of a position buffer. */
function meshBounds(positions: Float32Array): HeightGridBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis] ?? 0;
      min[axis] = Math.min(min[axis] as number, value);
      max[axis] = Math.max(max[axis] as number, value);
    }
  }
  return { min, max };
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
  return buildTerrainGlb(name, gridMesh(grid));
}

/**
 * The same writer, for a tile whose vertices are not a rectangular grid — an
 * adaptive one (see {@link adaptiveMesh}).
 */
export function buildTerrainGlb(name: string, mesh: TerrainMesh): Glb {
  const { positions, normals, uvs, indices, bounds } = mesh;

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

  const vertexCount = positions.length / 3;
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
