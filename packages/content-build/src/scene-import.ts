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
import { isSceneEntityId, sceneEntityId } from '@wov/world-schema';
import type { EntityDefinition, WorldDefinition, ZoneDefinition } from '@wov/world-schema';
import { BACKDROP_MODELS } from './backdrop.js';
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
 *
 * **The order matters, and the more specific rule comes first.** A node claimed
 * by an earlier zone stops the later zone's walk, so `Environments/Background`
 * belongs to the village even though `Environments` as a whole belongs to the
 * surroundings.
 *
 * **Why the backdrop is village and not surroundings.** The game draws exactly
 * one zone — `playableZone` picks the one with ground under it (`world-scene.ts`)
 * — so an entity in `surroundings` is an entity nothing renders. A horizon in
 * the zone next door is a horizon nobody sees, and the whole point of a backdrop
 * is to be seen from the zone it is the backdrop *of*. Zone streaming will
 * change what "one zone" means; it will not change which zone this belongs to.
 *
 * **Why `Environments/Rocks` is *not* also moved, though it looks like it
 * should be.** Its 97 cliffs — with 3 more under `Environments Outside Village`
 * — are a ring around the tile: 64 of the 100 stand within 15 m of an edge of
 * the 300 m square, and in `surroundings`, which has no ground and is therefore
 * never the zone `playableZone` picks, they have never once been drawn.
 *
 * They are not moved because they do not stand on this zone's ground, and that
 * is measured rather than assumed: `pnpm seating --world village1 --zone
 * surroundings --prefab rock-cliff` says 81 of 100 sit within half a metre of
 * it, and two more rest on a neighbouring cliff, which counts. The other 17
 * hang 3.8 m to 27.2 m over everything the world file has, six of them in a row
 * over the north rim. 83 of 100 against a bar of 95 %.
 *
 * The resolution of the height field is **not** the reason, though ADR-0031
 * said it was and this comment used to repeat it. The 257² reduction, the full
 * 513² raster, the drawn adaptive tile and the modelling export's own raster
 * give the same 17 floating placements and answers within 1.5 m of each other,
 * and the export's raster matches the shipped one exactly. The cliffs lean on
 * ground outside this tile, which is a zone this repository has not imported —
 * not a surface it has approximated (ADR-0037).
 *
 * The placements are not wrong: they are byte-identical to the bundle. Snapping
 * them down would be inventing placement, which this importer does not do
 * (agent rule 16).
 */
export const DEFAULT_ZONES: readonly ZoneRule[] = [
  {
    id: 'village',
    name: 'Village',
    roots: ['Village/Village1', 'Environments/Background'],
  },
  { id: 'interiors', name: 'Village Interiors', roots: ['Village/Village Interiors'] },
  {
    id: 'surroundings',
    name: 'Surroundings',
    roots: ['Environments', 'Effects', 'Chest*'],
  },
];

/**
 * Bundle node names that mean a backdrop prefab, resolved against the catalogue.
 *
 * The **name list** half of the backdrop rule (`asset-pipeline/backdrop.ts`).
 * The scene import recognises a node by matching its name against store file
 * stems, and the backdrop models are the one group that is *not* cut out of the
 * bundle: they come from the export, where the two mountain panoramas are still
 * two files. So without an alias the shells are two nodes nothing knows, and the
 * world file would say the village has no horizon.
 *
 * Resolved against `byStem` rather than spelling prefab ids out here: the id is
 * the catalogue's to decide, and a backdrop that has not been imported yet
 * simply aliases nothing and is reported as an unmatched node — which is the
 * truth, and is what the report is for.
 */
export function withBackdropAliases(
  byStem: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const merged = new Map(byStem);
  for (const model of BACKDROP_MODELS) {
    const prefab = byStem.get(model.stem);
    if (prefab === undefined) {
      continue;
    }
    for (const node of model.nodes) {
      merged.set(toKebab(node), prefab);
    }
  }
  return merged;
}

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
  const collect = (index: number, zone: ZoneRule, from: number): void => {
    // A subtree an earlier zone already claimed is that zone's, and the walk
    // stops here. This is what lets one zone rule sit inside another's: without
    // it `Environments` would collect `Environments/Background` a second time,
    // and the village's horizon would also stand in the surroundings — every
    // shell, dome and cloud placed twice.
    if (index !== from && claimed.has(index)) {
      return;
    }
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
      collect(child, zone, from);
    }
  };

  for (const zone of options.zones) {
    for (const [index, path] of [...paths].sort((a, b) => a[0] - b[0])) {
      if (!zone.roots.some((pattern) => matchesRoot(path, pattern))) {
        continue;
      }
      claimed.add(index);
      collect(index, zone, index);
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
        // The id namespace the carry-over reads back on the next run
        // (`@wov/world-schema/entity-ids`, ADR-0036): minting it anywhere but
        // there is how the two halves drift apart.
        id: sceneEntityId(instance.prefab, next),
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
 * An entity the last scene import wrote, and therefore the bundle's to replace.
 *
 * The whole rule is one id shape, declared once in `@wov/world-schema`: the
 * import mints `<prefab>_0001`, and every other minter stays out of that
 * namespace on purpose (ADR-0036).
 */
export function isImportedEntity(entity: EntityDefinition): boolean {
  return isSceneEntityId(entity.id, entity.prefab);
}

/** Everything in a zone that the scene import did not put there. */
export function authoredEntities(zone: ZoneDefinition | undefined): readonly EntityDefinition[] {
  return (zone?.entities ?? []).filter((entity) => !isImportedEntity(entity));
}

/**
 * Puts back the parts of a world file the bundle does not describe.
 *
 * A scene bundle carries placements and nothing else. The ground under them
 * (ADR-0020), the light over them (ADR-0024) and every entity that was *not*
 * in the bundle — a scattered field (ADR-0025), a prop dropped in the editor —
 * are authored *into the world file*, so rewriting the file from the bundle,
 * which is what `pnpm import:scene` does, would throw all three away.
 *
 * That is not a hypothetical: the documented way to regenerate this repository's
 * content is store import → prefabs → scene import, and running it on a village
 * that had an evening gave back a village lit like a showroom, with nothing
 * failing and nothing said. The 4 032 scattered plants went the same way, and
 * getting them back meant re-running three commands from a document — a step
 * whose omission also has no symptom until somebody looks at the picture.
 *
 * **What is replaced, and what is kept.** An entity whose id says the import
 * minted it ({@link isImportedEntity}) is the bundle's: the fresh list stands
 * in for it, so a placement the bundle no longer has really does disappear.
 * Everything else is authored and survives, in the order the previous file had
 * it, appended after the bundle's own entities — which is the order the village
 * already has on disk, so a re-import that changes nothing writes the same
 * bytes (ADR-0036).
 *
 * Keyed by zone id and never by position: a bundle that gained or lost a zone
 * must not hand one zone's ground to another. A zone the bundle no longer has
 * is dropped with its authored blocks, because the fresh world is the list of
 * zones that exist; {@link countAuthoredOutsideZones} is how the caller can say
 * out loud how much authored work that costs.
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
      const kept = authoredEntities(was);
      return {
        ...zone,
        ...(kept.length > 0 ? { entities: [...zone.entities, ...kept] } : {}),
        ...(was?.terrain !== undefined ? { terrain: was.terrain } : {}),
        ...(was?.lighting !== undefined ? { lighting: was.lighting } : {}),
      };
    }),
  };
}

/**
 * How many authored entities stand in zones the fresh world does not have.
 *
 * They are dropped — the fresh world is the list of zones that exist — and a
 * loss that large has to be a number in the report rather than a surprise in a
 * diff.
 */
export function countAuthoredOutsideZones(
  fresh: WorldDefinition,
  previous: WorldDefinition | undefined,
): number {
  if (previous === undefined) {
    return 0;
  }
  const kept = new Set(fresh.zones.map((zone) => zone.id));
  return previous.zones
    .filter((zone) => !kept.has(zone.id))
    .reduce((sum, zone) => sum + authoredEntities(zone).length, 0);
}
