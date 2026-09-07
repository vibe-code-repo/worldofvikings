/**
 * Seating: how far a placed model stands above, or sinks into, the ground.
 *
 * The scene import never moves anything (agent rule 16), so the only way to
 * answer "may these placements be drawn?" is to measure them. This module is
 * that measurement, as pure functions over plain arrays, so the answer is a
 * number somebody else can reproduce rather than an impression from a
 * screenshot.
 *
 * Two things make the naive version wrong, and both are why this exists at all:
 *
 * - **A model box is not a model.** A transformed box always reaches below the
 *   geometry inside it, and on a tilted, unevenly scaled rock its lowest corner
 *   is metres from any vertex. Measured on the village cliff ring, the box
 *   answer and the vertex answer disagree about whether at least seven of the
 *   100 are standing on the ground at all (ADR-0036).
 * - **The ground is not one number.** The height under a 12 m rock varies by
 *   metres across its own footprint, so the gap has to be the *minimum over the
 *   model's own points* of `point y − ground under that point`, not the gap at
 *   the entity's origin.
 *
 * The ground query is injected rather than fixed: a caller measures against the
 * regular `heightSamples` grid (`height-field.ts`), against the drawn adaptive
 * tile ({@link readTriangleField}), or against anything else it can express as
 * a function of `x` and `z`, and can therefore compare rasters instead of
 * trusting one.
 */
import { walkNodes, type Glb, type Matrix4 } from '@wov/content-build';

// --------------------------------------------------------------- reading a glb

/** Reads a float accessor out of the binary chunk, honouring its stride. */
function readFloats(
  glb: Glb,
  accessorIndex: number,
  components: number,
  label: string,
): Float32Array {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (accessor?.bufferView === undefined || accessor.componentType !== 5126) {
    throw new Error(`${label}: accessor ${String(accessorIndex)} is not a float in the buffer`);
  }
  const view = glb.json.bufferViews?.[accessor.bufferView];
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view?.byteStride ?? components * 4;
  const out = new Float32Array(accessor.count * components);
  for (let index = 0; index < accessor.count; index += 1) {
    for (let axis = 0; axis < components; axis += 1) {
      out[index * components + axis] = glb.bin.readFloatLE(start + index * stride + axis * 4);
    }
  }
  return out;
}

/** Reads an index accessor, whatever integer width it was written in. */
function readIndices(glb: Glb, accessorIndex: number, label: string): Uint32Array {
  const accessor = glb.json.accessors?.[accessorIndex];
  if (accessor?.bufferView === undefined) {
    throw new Error(`${label}: index accessor ${String(accessorIndex)} is not in the buffer`);
  }
  const view = glb.json.bufferViews?.[accessor.bufferView];
  const start = (view?.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Uint32Array(accessor.count);
  for (let index = 0; index < accessor.count; index += 1) {
    if (accessor.componentType === 5125) {
      out[index] = glb.bin.readUInt32LE(start + index * 4);
    } else if (accessor.componentType === 5123) {
      out[index] = glb.bin.readUInt16LE(start + index * 2);
    } else if (accessor.componentType === 5121) {
      out[index] = glb.bin.readUInt8(start + index);
    } else {
      throw new Error(
        `${label}: index componentType ${String(accessor.componentType)} is not an integer`,
      );
    }
  }
  return out;
}

/** `matrix * (x, y, z, 1)`, for a column-major 4×4. */
export function transform(
  matrix: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    (matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    (matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z + (matrix[14] ?? 0),
  ];
}

/**
 * Every vertex of a model, in the frame the *game* puts it in.
 *
 * The glTF loader parents an instantiated model under a `__root__` that carries
 * Babylon's handedness conversion, and the entity's own transform composes on
 * top of that (`apps/game/src/world-scene.ts`). The net effect of that root on a
 * position is a mirror in x, so a measurement that reads the file's own
 * coordinates measures a model the player never sees — and for a rock tilted
 * about z it is off by metres, not by a sign nobody notices.
 *
 * `worldBounds` in `@wov/content-build` deliberately reads accessor `min`/`max`
 * instead; that is a hull, and a hull is the thing this module exists not to
 * measure.
 */
export function modelPoints(glb: Glb, label: string): Float32Array {
  const chunks: Float32Array[] = [];
  let total = 0;
  walkNodes(glb.json, (node, matrix) => {
    if (node.mesh === undefined) {
      return;
    }
    for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      const accessorIndex = primitive.attributes['POSITION'];
      if (accessorIndex === undefined) {
        continue;
      }
      const local = readFloats(glb, accessorIndex, 3, label);
      const world = new Float32Array(local.length);
      for (let index = 0; index < local.length; index += 3) {
        const [x, y, z] = transform(
          matrix,
          local[index] ?? 0,
          local[index + 1] ?? 0,
          local[index + 2] ?? 0,
        );
        world[index] = -x;
        world[index + 1] = y;
        world[index + 2] = z;
      }
      chunks.push(world);
      total += world.length;
    }
  });
  const all = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}

// ------------------------------------------------- an irregular ground surface

/**
 * A triangle mesh with a uniform grid over x/z, so a vertical query only looks
 * at the triangles that can possibly answer it.
 *
 * The village's drawn ground is one *adaptive* tile (ADR-0032) — dense where
 * the ground bends, sparse where it does not — so it is not a grid and
 * `readHeightGrid` refuses it. This is how the tile a player actually stands on
 * gets asked the same question the regular raster is asked.
 */
export interface TriangleField {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly minX: number;
  readonly minZ: number;
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  /** Triangle start offsets per cell, row-major. */
  readonly buckets: readonly (readonly number[])[];
}

/**
 * Reads a model as a queryable surface, offset into world space.
 *
 * @param offset where the tile stands — the world file's `terrain.position`.
 * The ground keeps the file's own coordinates otherwise: `createTerrain` clears
 * the loader's root before parenting it, so the tile is *not* mirrored the way
 * a placed model is ({@link modelPoints}).
 * @param cell the index cell size in metres. It only trades memory for query
 * time; nothing about the answer depends on it.
 */
export function readTriangleField(
  glb: Glb,
  label: string,
  offset: readonly [number, number, number] = [0, 0, 0],
  cell = 4,
): TriangleField {
  if (!(cell > 0)) {
    throw new Error(`${label}: index cell must be positive, got ${String(cell)}`);
  }
  const points: number[] = [];
  const indices: number[] = [];
  walkNodes(glb.json, (node, matrix) => {
    if (node.mesh === undefined) {
      return;
    }
    for (const primitive of glb.json.meshes?.[node.mesh]?.primitives ?? []) {
      const accessorIndex = primitive.attributes['POSITION'];
      if (accessorIndex === undefined || primitive.indices === undefined) {
        continue;
      }
      const local = readFloats(glb, accessorIndex, 3, label);
      const base = points.length / 3;
      for (let index = 0; index < local.length; index += 3) {
        const [x, y, z] = transform(
          matrix,
          local[index] ?? 0,
          local[index + 1] ?? 0,
          local[index + 2] ?? 0,
        );
        points.push(x + offset[0], y + offset[1], z + offset[2]);
      }
      for (const value of readIndices(glb, primitive.indices, label)) {
        indices.push(base + value);
      }
    }
  });
  if (indices.length === 0) {
    throw new Error(`${label}: no indexed triangles to stand on`);
  }

  const positions = new Float32Array(points);
  const triangles = new Uint32Array(indices);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let at = 0; at < positions.length; at += 3) {
    minX = Math.min(minX, positions[at] ?? 0);
    maxX = Math.max(maxX, positions[at] ?? 0);
    minZ = Math.min(minZ, positions[at + 2] ?? 0);
    maxZ = Math.max(maxZ, positions[at + 2] ?? 0);
  }
  const columns = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);
  for (let at = 0; at + 2 < triangles.length; at += 3) {
    let lowX = Infinity;
    let highX = -Infinity;
    let lowZ = Infinity;
    let highZ = -Infinity;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = (triangles[at + corner] ?? 0) * 3;
      lowX = Math.min(lowX, positions[vertex] ?? 0);
      highX = Math.max(highX, positions[vertex] ?? 0);
      lowZ = Math.min(lowZ, positions[vertex + 2] ?? 0);
      highZ = Math.max(highZ, positions[vertex + 2] ?? 0);
    }
    const firstColumn = Math.max(0, Math.floor((lowX - minX) / cell));
    const lastColumn = Math.min(columns - 1, Math.floor((highX - minX) / cell));
    const firstRow = Math.max(0, Math.floor((lowZ - minZ) / cell));
    const lastRow = Math.min(rows - 1, Math.floor((highZ - minZ) / cell));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        buckets[row * columns + column]?.push(at);
      }
    }
  }

  return { positions, indices: triangles, minX, minZ, cell, columns, rows, buckets };
}

/**
 * The height of the surface at `[x, z]`, or `undefined` where there is none.
 *
 * The *highest* triangle wins, because a surface may fold back over itself and
 * the thing a model stands on is the top one. `undefined` rather than a clamped
 * edge value: outside the tile there is no ground, and answering with the rim's
 * height would turn "this placement is off the map" into a plausible number.
 */
export function surfaceUnder(field: TriangleField, x: number, z: number): number | undefined {
  const column = Math.floor((x - field.minX) / field.cell);
  const row = Math.floor((z - field.minZ) / field.cell);
  if (column < 0 || row < 0 || column >= field.columns || row >= field.rows) {
    return undefined;
  }
  let best: number | undefined;
  for (const at of field.buckets[row * field.columns + column] ?? []) {
    const a = (field.indices[at] ?? 0) * 3;
    const b = (field.indices[at + 1] ?? 0) * 3;
    const c = (field.indices[at + 2] ?? 0) * 3;
    const ax = field.positions[a] ?? 0;
    const az = field.positions[a + 2] ?? 0;
    const bx = field.positions[b] ?? 0;
    const bz = field.positions[b + 2] ?? 0;
    const cx = field.positions[c] ?? 0;
    const cz = field.positions[c + 2] ?? 0;
    const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (area === 0) {
      continue;
    }
    const first = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / area;
    const second = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / area;
    const third = 1 - first - second;
    // A hair of slack, so a point exactly on a shared edge belongs to a
    // triangle rather than to neither of them.
    if (first < -1e-6 || second < -1e-6 || third < -1e-6) {
      continue;
    }
    const y =
      first * (field.positions[a + 1] ?? 0) +
      second * (field.positions[b + 1] ?? 0) +
      third * (field.positions[c + 1] ?? 0);
    if (best === undefined || y > best) {
      best = y;
    }
  }
  return best;
}

// ------------------------------------------------------------- the measurement

/** What one placement's relationship to the ground looks like, in metres. */
export interface Seating {
  /**
   * The smallest `point y − ground` over the model's own points: positive means
   * the whole model hangs that far above the ground, negative means it is that
   * far into it. This is the number "does it float?" is about.
   */
  readonly gap: number;
  /** The largest `point y − ground`: how far the model rises out of the ground. */
  readonly relief: number;
  /** Share of the model's points that are above the ground, 0 to 1. */
  readonly visible: number;
  /** Points whose `[x, z]` has no ground under it at all. */
  readonly offGround: number;
}

/**
 * Measures one placed model against a ground query.
 *
 * @param points the model's own vertices in the game's frame ({@link modelPoints}).
 * @param matrix the entity's transform — `compose` in `@wov/content-build` turns
 * a world file's `position` / `rotation` / `scale` into one.
 * @param groundAt the ground height at a world `[x, z]`, or `undefined` where
 * the model hangs off the edge of it.
 */
export function seatingOf(
  points: Float32Array,
  matrix: Matrix4,
  groundAt: (x: number, z: number) => number | undefined,
): Seating {
  let gap = Infinity;
  let relief = -Infinity;
  let above = 0;
  let measured = 0;
  let offGround = 0;
  for (let index = 0; index + 2 < points.length; index += 3) {
    const [x, y, z] = transform(
      matrix,
      points[index] ?? 0,
      points[index + 1] ?? 0,
      points[index + 2] ?? 0,
    );
    const ground = groundAt(x, z);
    if (ground === undefined) {
      offGround += 1;
      continue;
    }
    const here = y - ground;
    measured += 1;
    if (here < gap) {
      gap = here;
    }
    if (here > relief) {
      relief = here;
    }
    if (here > 0) {
      above += 1;
    }
  }
  if (measured === 0) {
    return { gap: Number.NaN, relief: Number.NaN, visible: 0, offGround };
  }
  return { gap, relief, visible: above / measured, offGround };
}
