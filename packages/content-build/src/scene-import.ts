/**
 * Turning a scene bundle into world entities: the decisions, as pure functions.
 *
 * A scene bundle is one large GLB that carries a *whole authored level* as a
 * node hierarchy — every house, wall and barrel already standing where a level
 * designer put it. This module reads that hierarchy and answers three questions
 * per node: is it world building at all, which prefab is it, and what transform
 * does it have in Babylon's coordinates.
 *
 * It is a **data import, not a generator** (ADR-0021, agent rule 16): nothing
 * here invents a placement. Every number in the output is a measurement of the
 * bundle, and two runs over the same bundle produce byte-identical output.
 *
 * The command that uses it is `tooling/scripts/import-scene.ts`; everything
 * here is a pure function so the rules can be tested without a 150 MB file.
 */
import type { WorldDefinition } from '@wov/world-schema';
import type { Gltf, GltfNode, Matrix4 } from './glb.js';
import { IDENTITY, multiply, nodeMatrix } from './glb.js';

// --------------------------------------------------------------- name mapping

/**
 * `SM_Env_StoneWall_01 (12)` → `sm-env-stonewall-01-12`.
 *
 * The same normalisation the prefab catalogue uses on file names, so a node
 * name and a store file name meet in one spelling.
 */
export function toKebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `Foo (3)` — the suffix a level editor appends when an object is duplicated. */
const DUPLICATE_PARENTHESIS = /\s*\(\d+\)\s*$/;
/** `Foo 1` — the other spelling of the same thing. */
const DUPLICATE_TRAILING = /\s+\d+$/;
/** `Foo_LOD0` — a level-of-detail suffix, which names a variant, not an object. */
const LEVEL_OF_DETAIL = /[_ ]?lod[_ ]?\d+$/i;
/** `Roof_SM_Bld_Preset_01` — an authored prefix in front of the model name. */
const MODEL_NAME = /(SM_[A-Za-z0-9_]+)/;

/**
 * Every id a node name could plausibly mean, most specific first.
 *
 * Order is the whole point: `SM_Prop_Log_02 1` must be tried as `…log-02-1`
 * before `…log-02`, because both may exist and the longer one is the exact
 * name. Only when nothing matches does the search fall back to a shorter form.
 */
export function nameCandidates(name: string): string[] {
  const found: string[] = [];
  const add = (value: string): void => {
    const key = toKebab(value);
    if (key !== '' && !found.includes(key)) {
      found.push(key);
    }
  };

  add(name);
  const withoutParenthesis = name.replace(DUPLICATE_PARENTHESIS, '');
  add(withoutParenthesis);
  const withoutTrailing = withoutParenthesis.replace(DUPLICATE_TRAILING, '');
  add(withoutTrailing);
  for (const value of [name, withoutParenthesis, withoutTrailing]) {
    add(value.replace(LEVEL_OF_DETAIL, ''));
  }
  for (const value of [withoutTrailing, withoutParenthesis]) {
    const match = MODEL_NAME.exec(value);
    if (match?.[1] !== undefined) {
      add(match[1]);
      add(match[1].replace(DUPLICATE_TRAILING, ''));
    }
  }
  return found;
}

/** The first candidate `known` has, or `null` when the name means nothing here. */
export function matchName<T>(name: string, known: ReadonlyMap<string, T>): T | null {
  for (const candidate of nameCandidates(name)) {
    const hit = known.get(candidate);
    if (hit !== undefined) {
      return hit;
    }
  }
  return null;
}

// ------------------------------------------------------------ transformations

/** Mirroring on x, as a column-major 4×4. Its own inverse. */
export const MIRROR_X: Matrix4 = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The same transform, seen in a frame whose x axis points the other way.
 *
 * The bundle's exporter negated x and the height field's exporter did not, so
 * the two disagree by exactly this until one of them is mirrored back. The
 * measurement that settles which way round it goes is in
 * `docs/world-format.md`: mirrored, 90.6 % of the props sit within 3 m of the
 * terrain under them; unmirrored, they are all outside the terrain entirely.
 *
 * Conjugation (`S·M·S`) rather than a left-multiplication, because the frame
 * changes, not the object: a rotation stays a rotation, and a mirrored scale
 * stays mirrored.
 */
export function mirrorX(matrix: Matrix4): Matrix4 {
  return multiply(MIRROR_X, multiply(matrix, MIRROR_X));
}

/** Position, Euler rotation and scale, the three fields an entity carries. */
export interface Transform {
  readonly position: [number, number, number];
  /** Radians, applied Y then X then Z — Babylon's `TransformNode.rotation`. */
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Splits a world matrix into what `EntityDefinition` can hold.
 *
 * **The Euler convention is not a choice made here.** `apps/editor` writes an
 * entity's rotation into `TransformNode.rotation`, and Babylon composes that
 * as yaw-pitch-roll — `R = Ry(y)·Rx(x)·Rz(z)`, in radians. Extracting anything
 * else would put every tilted rock in the bundle at a wrong angle, so this
 * inverts exactly that product. `docs/world-format.md` states it as the format
 * rule, and `scene-import.test.ts` proves the round trip.
 *
 * A negative determinant means the authored transform mirrors the model. That
 * is kept, as a negative x scale, because it is what the level says — dropping
 * it would silently turn every mirrored house the right way round.
 */
export function decompose(matrix: Matrix4): Transform {
  const column = (index: number): [number, number, number] => [
    matrix[index * 4] ?? 0,
    matrix[index * 4 + 1] ?? 0,
    matrix[index * 4 + 2] ?? 0,
  ];
  const [ax, ay, az] = column(0);
  const [bx, by, bz] = column(1);
  const [cx, cy, cz] = column(2);

  const lengths: [number, number, number] = [
    Math.hypot(ax, ay, az),
    Math.hypot(bx, by, bz),
    Math.hypot(cx, cy, cz),
  ];
  // The determinant of the upper 3×3: negative means the basis is left-handed,
  // i.e. the transform includes a mirroring.
  const determinant =
    ax * (by * cz - bz * cy) - bx * (ay * cz - az * cy) + cx * (ay * bz - az * by);
  const scale: [number, number, number] =
    determinant < 0 ? [-lengths[0], lengths[1], lengths[2]] : lengths;

  // Row-major 3×3 rotation, with the scale (mirroring included) divided out.
  const r = (row: number, col: number): number => {
    const length = scale[col] ?? 1;
    return length === 0 ? 0 : (matrix[col * 4 + row] ?? 0) / length;
  };

  const sinX = clamp(-r(1, 2), -1, 1);
  const x = Math.asin(sinX);
  // cos(x) is 0 exactly when the object looks straight up or down; y and z then
  // describe the same turn and only their sum is defined. Putting all of it in
  // y is the usual choice and keeps the round trip exact.
  const gimbalLocked = Math.abs(sinX) > 1 - 1e-9;
  const y = gimbalLocked ? Math.atan2(sinX * r(0, 1), r(0, 0)) : Math.atan2(r(0, 2), r(2, 2));
  const z = gimbalLocked ? 0 : Math.atan2(r(1, 0), r(1, 1));

  return {
    position: [matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0],
    rotation: [x, y, z],
    scale,
  };
}

/** `Ry(y)·Rx(x)·Rz(z)` with a scale and a translation — the inverse of {@link decompose}. */
export function compose(transform: Transform): Matrix4 {
  const [x, y, z] = transform.rotation;
  const [sx, sy, sz] = transform.scale;
  const [cxr, sxr] = [Math.cos(x), Math.sin(x)];
  const [cyr, syr] = [Math.cos(y), Math.sin(y)];
  const [czr, szr] = [Math.cos(z), Math.sin(z)];

  // R = Ry·Rx·Rz, written out row by row.
  const rotation: number[][] = [
    [cyr * czr + syr * sxr * szr, -cyr * szr + syr * sxr * czr, syr * cxr],
    [cxr * szr, cxr * czr, -sxr],
    [-syr * czr + cyr * sxr * szr, syr * szr + cyr * sxr * czr, cyr * cxr],
  ];
  const scales = [sx, sy, sz];

  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      out[col * 4 + row] = (rotation[row]?.[col] ?? 0) * (scales[col] ?? 1);
    }
  }
  out[12] = transform.position[0];
  out[13] = transform.position[1];
  out[14] = transform.position[2];
  out[15] = 1;
  return out;
}

// ------------------------------------------------------------------- the scan

/** One zone of the world, and the bundle subtrees it is built from. */
export interface ZoneRule {
  readonly id: string;
  readonly name: string;
  /**
   * Node paths, `/`-separated, matched against the bundle hierarchy. A final
   * `*` matches the rest of that name — the five treasure chests are five
   * root nodes whose names differ only in a suffix.
   */
  readonly roots: readonly string[];
}

/**
 * The zones a bundle is split into, and everything that is therefore left out.
 *
 * The list is an allow-list on purpose: a bundle also contains the user
 * interface, the characters, dialogue, cut scenes, cameras, lights and audio
 * emitters, and none of those is world data. Naming what is *taken* means a
 * node type nobody thought about ends up in the report rather than in the file.
 */
export const DEFAULT_ZONES: readonly ZoneRule[] = [
  { id: 'village', name: 'Village', roots: ['Village/Village1'] },
  { id: 'interiors', name: 'Village Interiors', roots: ['Village/Village Interiors'] },
  {
    id: 'surroundings',
    name: 'Surroundings',
    roots: ['Environments', 'Effects', 'Chest*'],
  },
];

/**
 * Materials a box carries when it is a collision volume or a trigger rather
 * than something to look at. Combined with "twelve triangles and no texture",
 * this is what tells an invisible barrier from a crate.
 */
const HELPER_MATERIALS: ReadonlySet<string> = new Set(['Cube', 'Lit', 'DefaultMaterial']);
const HELPER_TRIANGLES = 12;

/** One placed prefab: the node the search stopped at, and where it stands. */
export interface SceneInstance {
  readonly node: number;
  readonly name: string;
  readonly path: string;
  readonly zone: string;
  readonly prefab: string;
  readonly triangles: number;
  /** World matrix in the bundle's own coordinates, before mirroring. */
  readonly matrix: Matrix4;
}

/** A mesh the search reached without recognising it. Reported, never dropped. */
export interface SceneMiss {
  readonly node: number;
  readonly name: string;
  readonly path: string;
  readonly zone: string;
  readonly triangles: number;
  readonly materials: readonly string[];
}

export interface SceneScan {
  readonly instances: readonly SceneInstance[];
  readonly misses: readonly SceneMiss[];
  /** Collision boxes and triggers, counted so their absence is explained. */
  readonly helpers: number;
  /** Bundle roots no zone rule claims, with the mesh nodes they hold. */
  readonly ignoredRoots: readonly { readonly name: string; readonly meshNodes: number }[];
}

/** A reader over one bundle's node hierarchy, so nothing is walked twice. */
class SceneGraph {
  readonly nodes: readonly GltfNode[];
  private readonly meshTriangles: readonly number[];
  private readonly subtreeMeshCache = new Map<number, boolean>();

  constructor(private readonly json: Gltf) {
    this.nodes = json.nodes ?? [];
    this.meshTriangles = (json.meshes ?? []).map((mesh) =>
      mesh.primitives.reduce((total, primitive) => {
        const source =
          primitive.indices !== undefined
            ? json.accessors?.[primitive.indices]
            : json.accessors?.[primitive.attributes['POSITION'] ?? -1];
        return total + Math.floor((source?.count ?? 0) / 3);
      }, 0),
    );
  }

  roots(): readonly number[] {
    return this.json.scenes?.[this.json.scene ?? 0]?.nodes ?? [];
  }

  children(index: number): readonly number[] {
    return this.nodes[index]?.children ?? [];
  }

  name(index: number): string {
    return this.nodes[index]?.name ?? `<${String(index)}>`;
  }

  /** Triangles in this node's own mesh, or 0 when it has none. */
  triangles(index: number): number {
    const mesh = this.nodes[index]?.mesh;
    return mesh === undefined ? 0 : (this.meshTriangles[mesh] ?? 0);
  }

  subtreeTriangles(index: number): number {
    let total = this.triangles(index);
    for (const child of this.children(index)) {
      total += this.subtreeTriangles(child);
    }
    return total;
  }

  subtreeMeshNodes(index: number): number {
    let total = this.nodes[index]?.mesh === undefined ? 0 : 1;
    for (const child of this.children(index)) {
      total += this.subtreeMeshNodes(child);
    }
    return total;
  }

  /** Whether anything under this node draws. A pure container is not an entity. */
  hasMesh(index: number): boolean {
    const cached = this.subtreeMeshCache.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const result =
      this.nodes[index]?.mesh !== undefined ||
      this.children(index).some((child) => this.hasMesh(child));
    this.subtreeMeshCache.set(index, result);
    return result;
  }

  materialsOf(index: number): string[] {
    const mesh = this.nodes[index]?.mesh;
    if (mesh === undefined) {
      return [];
    }
    return (this.json.meshes?.[mesh]?.primitives ?? []).map((primitive) =>
      primitive.material === undefined
        ? '<none>'
        : (this.json.materials?.[primitive.material]?.name ?? '<unnamed>'),
    );
  }

  /** True for a box that is a collision volume or trigger, not scenery. */
  isHelper(index: number): boolean {
    const mesh = this.nodes[index]?.mesh;
    if (mesh === undefined || this.triangles(index) !== HELPER_TRIANGLES) {
      return false;
    }
    const materials = this.materialsOf(index);
    if (materials.length === 0 || !materials.every((name) => HELPER_MATERIALS.has(name))) {
      return false;
    }
    // A textured box is a crate. An untextured one is a barrier.
    return !(this.json.meshes?.[mesh]?.primitives ?? []).some((primitive) => {
      const material =
        primitive.material === undefined ? undefined : this.json.materials?.[primitive.material];
      const pbr = material?.['pbrMetallicRoughness'] as Record<string, unknown> | undefined;
      return pbr?.['baseColorTexture'] !== undefined;
    });
  }
}

/** Whether a `/`-separated node path matches a zone rule root. */
export function matchesRoot(path: readonly string[], pattern: string): boolean {
  const wanted = pattern.split('/');
  if (wanted.length !== path.length) {
    return false;
  }
  return wanted.every((segment, index) => {
    const actual = path[index] ?? '';
    return segment.endsWith('*') ? actual.startsWith(segment.slice(0, -1)) : actual === segment;
  });
}

export interface SceneScanOptions {
  readonly zones: readonly ZoneRule[];
  /** Store file stem (`sm-env-stonewall-01`) to prefab id, from `content/prefabs/`. */
  readonly prefabsByStem: ReadonlyMap<string, string>;
}

/**
 * Finds every prefab instance in a bundle, zone by zone.
 *
 * The search is **top-down and stops at the first hit**: the highest node whose
 * name is a known model is one instance, and its whole subtree belongs to it.
 * That is what makes a house one entity rather than its eighty planks, and it
 * is why a bundle of 6 900 nodes becomes a world file of a few thousand.
 *
 * A node that draws but is not recognised ends the search too — as a miss, so
 * the report can name it. Silently walking into it would scatter a chest into
 * its lid and its body.
 */
export function scanScene(json: Gltf, options: SceneScanOptions): SceneScan {
  const graph = new SceneGraph(json);
  const instances: SceneInstance[] = [];
  const misses: SceneMiss[] = [];
  let helpers = 0;

  const worldMatrices = new Map<number, Matrix4>();
  const paths = new Map<number, string[]>();
  const walk = (index: number, parentMatrix: Matrix4, parentPath: readonly string[]): void => {
    if (worldMatrices.has(index)) {
      // glTF forbids a node with two parents; a bundle is not obliged to obey.
      return;
    }
    const node = graph.nodes[index];
    if (node === undefined) {
      return;
    }
    const matrix = multiply(parentMatrix, nodeMatrix(node));
    const path = [...parentPath, graph.name(index)];
    worldMatrices.set(index, matrix);
    paths.set(index, path);
    for (const child of graph.children(index)) {
      walk(child, matrix, path);
    }
  };
  for (const root of graph.roots()) {
    walk(root, IDENTITY, []);
  }

  const claimed = new Set<number>();
  const collect = (index: number, zone: ZoneRule): void => {
    if (!graph.hasMesh(index)) {
      return;
    }
    const name = graph.name(index);
    const path = (paths.get(index) ?? [name]).join('/');
    const prefab = matchName(name, options.prefabsByStem);
    if (prefab !== null) {
      instances.push({
        node: index,
        name,
        path,
        zone: zone.id,
        prefab,
        triangles: graph.subtreeTriangles(index),
        matrix: worldMatrices.get(index) ?? IDENTITY,
      });
      return;
    }
    if (graph.nodes[index]?.mesh !== undefined) {
      if (graph.isHelper(index)) {
        helpers += 1;
        return;
      }
      misses.push({
        node: index,
        name,
        path,
        zone: zone.id,
        triangles: graph.subtreeTriangles(index),
        materials: graph.materialsOf(index),
      });
      return;
    }
    for (const child of graph.children(index)) {
      collect(child, zone);
    }
  };

  for (const zone of options.zones) {
    for (const [index, path] of [...paths].sort((a, b) => a[0] - b[0])) {
      if (!zone.roots.some((pattern) => matchesRoot(path, pattern))) {
        continue;
      }
      claimed.add(index);
      collect(index, zone);
    }
  }

  // A bundle root is "ignored" only when nothing under it was taken. Naming the
  // roots rather than the nodes keeps the report to a screen: it says *user
  // interface, characters, cut scenes* were left out, with the weight of each,
  // instead of listing four thousand nodes.
  const holdsSomethingTaken = (index: number): boolean =>
    claimed.has(index) || graph.children(index).some(holdsSomethingTaken);
  const ignoredRoots = graph
    .roots()
    .filter((index) => graph.hasMesh(index) && !holdsSomethingTaken(index))
    .map((index) => ({ name: graph.name(index), meshNodes: graph.subtreeMeshNodes(index) }));

  return { instances, misses, helpers, ignoredRoots };
}

// -------------------------------------------------------------- world writing

/** Rounds for the file, and turns `-0` back into `0` so a diff stays stable. */
export function round(value: number, digits: number): number {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
}

/** How precisely each field is written: millimetres, ~0.001°, 0.01 % of scale. */
export const POSITION_DIGITS = 3;
export const ROTATION_DIGITS = 5;
export const SCALE_DIGITS = 4;

export interface EntityRecord {
  readonly id: string;
  readonly prefab: string;
  readonly position: [number, number, number];
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
}

/**
 * Instances of one zone as entities, mirrored, decomposed and numbered.
 *
 * `counters` is shared across zones so an id is unique in the whole world, not
 * only in its zone: `<prefab>_0007` then names one thing no matter which zone
 * a later edit moves it to.
 */
export function toEntities(
  instances: readonly SceneInstance[],
  counters: Map<string, number>,
): EntityRecord[] {
  return [...instances]
    .sort((left, right) => left.node - right.node)
    .map((instance) => {
      const transform = decompose(mirrorX(instance.matrix));
      const next = (counters.get(instance.prefab) ?? 0) + 1;
      counters.set(instance.prefab, next);
      return {
        id: `${instance.prefab}_${String(next).padStart(4, '0')}`,
        prefab: instance.prefab,
        position: transform.position.map((value) => round(value, POSITION_DIGITS)) as [
          number,
          number,
          number,
        ],
        rotation: transform.rotation.map((value) => round(value, ROTATION_DIGITS)) as [
          number,
          number,
          number,
        ],
        scale: transform.scale.map((value) => round(value, SCALE_DIGITS)) as [
          number,
          number,
          number,
        ],
      };
    });
}

// ------------------------------------------------------- authored, not imported

/**
 * Puts back the parts of a world file the bundle does not describe.
 *
 * A scene bundle carries placements and nothing else. The ground under them
 * (ADR-0020) and the light over them (ADR-0024) are authored *into the world
 * file*, by the terrain import and by hand — so rewriting the file from the
 * bundle, which is what `pnpm import:scene` does, would throw both away.
 *
 * That is not a hypothetical: the documented way to regenerate this repository's
 * content is store import → prefabs → scene import, and running it on a village
 * that had an evening gave back a village lit like a showroom, with nothing
 * failing and nothing said. The scatter runs are the deliberate exception —
 * they are re-run afterwards, because a scatter is a *command over entities*
 * and the entities are exactly what the import replaces (ADR-0025).
 *
 * Keyed by zone id and never by position: a bundle that gained or lost a zone
 * must not hand one zone's ground to another. A zone the bundle no longer has
 * is dropped with its authored blocks, because the fresh world is the list of
 * zones that exist.
 */
export function carryOverAuthoredBlocks(
  fresh: WorldDefinition,
  previous: WorldDefinition | undefined,
): WorldDefinition {
  if (previous === undefined) {
    return fresh;
  }
  const before = new Map(previous.zones.map((zone) => [zone.id, zone]));
  // Key order is spelled out rather than spread, because the output is a file a
  // person reads: a village's `zones` array is 39 000 lines, and a `lighting`
  // block appended after it is a block nobody will ever scroll to.
  const { zones: _zones, ...head } = fresh;
  return {
    ...head,
    ...(previous.lighting !== undefined ? { lighting: previous.lighting } : {}),
    zones: fresh.zones.map((zone) => {
      const was = before.get(zone.id);
      return {
        ...zone,
        ...(was?.terrain !== undefined ? { terrain: was.terrain } : {}),
        ...(was?.lighting !== undefined ? { lighting: was.lighting } : {}),
      };
    }),
  };
}
