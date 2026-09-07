/**
 * Importing a scene bundle into a world file, as one function (ADR-0021,
 * ADR-0028, ADR-0033).
 *
 * `tooling/scripts/import-scene.ts` is `pnpm import:scene` and
 * `services/api/src/actions-routes.ts` is the editor's *World → Import scene
 * bundle…*; both of them call {@link importSceneBundle} and neither of them
 * decides anything of its own. That is the editor-parity rule (ADR-0033): the
 * command line and the editor are two front doors to one implementation, not
 * two implementations that happen to agree today.
 *
 * What the function does *not* do is print. It returns a {@link SceneImportResult}
 * — numbers and lists — and the caller renders it, as a report on a terminal or
 * as a panel in the editor.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from '@wov/world-schema';
import type { WorldDefinition } from '@wov/world-schema';
import { readGlb } from './glb.js';
import { loadPrefabStems } from './prefab-stems.js';
import {
  DEFAULT_ZONES,
  authoredEntities,
  carryOverAuthoredBlocks,
  countAuthoredOutsideZones,
  scanScene,
  toEntities,
  toKebab,
  withBackdropAliases,
  type SceneMiss,
  type ZoneRule,
} from './scene-import.js';

export interface SceneImportOptions {
  /** Absolute path of the bundle to read. The caller decides it is allowed. */
  readonly sceneFile: string;
  /** The world file to write: `<contentDir>/worlds/<worldId>.json`. */
  readonly worldId: string;
  readonly worldName: string;
  /** `content/` of a checkout, or the API's `CONTENT_DIR`. */
  readonly contentDir: string;
  /** One zone from one bundle root, instead of {@link DEFAULT_ZONES}. */
  readonly zoneRoot?: string | undefined;
  /** Report only; nothing is written. */
  readonly dryRun?: boolean;
  /**
   * How the world file is spelled on disk.
   *
   * Injected because the two callers format it with the same Prettier
   * configuration but reach it differently — the script through
   * `resolveConfig`, the API through its own JSON writer — and a world file
   * that comes back from the editor with a different indentation would show up
   * as a whitespace diff over 39 000 lines (ADR-0017).
   */
  readonly serialize?: (world: WorldDefinition) => string | Promise<string>;
}

/** One group of unmatched bundle nodes: what it would be called, and how many. */
export interface SceneMissGroup {
  readonly name: string;
  readonly count: number;
  readonly triangles: number;
  readonly zone: string;
}

export interface SceneImportZoneReport {
  readonly id: string;
  readonly entities: number;
  readonly prefabs: number;
}

/** Everything a caller can show about one run. Numbers, never sentences. */
export interface SceneImportReport {
  readonly sceneFile: string;
  readonly worldId: string;
  /** Store file names the prefab catalogues gave us to match against. */
  readonly knownStems: number;
  /** Stems two catalogues both claim; left unmatched on purpose. */
  readonly ambiguousStems: readonly string[];
  readonly zones: readonly SceneImportZoneReport[];
  readonly entities: number;
  readonly placedTriangles: number;
  readonly missedTriangles: number;
  /** Collision boxes and triggers, counted so their absence is explained. */
  readonly helpers: number;
  readonly misses: readonly SceneMissGroup[];
  readonly missedInstances: number;
  readonly ignoredRoots: readonly { readonly name: string; readonly meshNodes: number }[];
  /**
   * Nodes claimed as one prefab that hold recognisable meshes of their own.
   *
   * Not an error and not a drop — the claimed model may well contain all of
   * them — but the one mechanism by which this importer could lose something
   * without saying a word, so it says a word (`SceneInstance.swallowed`).
   */
  readonly swallowing: readonly {
    readonly path: string;
    readonly prefab: string;
    readonly names: readonly string[];
  }[];
  /** Zones whose authored ground was carried over from the previous file. */
  readonly groundCarried: readonly string[];
  /**
   * Per zone, the entities kept from the previous file because the bundle
   * never described them — a scattered field, a prop dropped in the editor
   * (ADR-0036). Zones that kept nothing are not listed.
   */
  readonly entitiesCarried: readonly { readonly zone: string; readonly entities: number }[];
  /**
   * Authored entities lost because their zone is not in the bundle any more.
   * Zero on every ordinary run; a number here is a deletion worth reading.
   */
  readonly entitiesDropped: number;
  /** `the world`, plus every zone whose authored light was carried over. */
  readonly lightingCarried: readonly string[];
  readonly dryRun: boolean;
}

export type SceneImportResult =
  | { readonly ok: true; readonly world: WorldDefinition; readonly report: SceneImportReport }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The default `JSON.stringify` spelling, when a caller names no other. */
function defaultSerialize(world: WorldDefinition): string {
  return `${JSON.stringify(world, null, 2)}\n`;
}

/**
 * Reads a bundle and writes `<contentDir>/worlds/<worldId>.json`.
 *
 * Ground, light and authored entities are **carried over, not regenerated**: a
 * bundle carries its own placements and nothing else, so the `terrain` and
 * `lighting` blocks of the file being replaced are copied into the new one
 * (ADR-0028), and so is every entity the import did not mint — a scattered
 * field, a prop dropped in the editor (ADR-0036). Without that, re-running the
 * import would silently take the ground out from under 5 248 placements and
 * then delete 4 032 of them.
 *
 * A previous file that exists but does not parse is an error rather than a
 * fresh start: carrying nothing over from it would look like success.
 */
export async function importSceneBundle(options: SceneImportOptions): Promise<SceneImportResult> {
  const { byStem: prefabsByStem, ambiguous } = await loadPrefabStems(
    join(options.contentDir, 'prefabs'),
  );

  const zones: readonly ZoneRule[] =
    options.zoneRoot === undefined || options.zoneRoot === ''
      ? DEFAULT_ZONES
      : [
          {
            id: toKebab(options.zoneRoot.split('/').at(-1) ?? options.zoneRoot),
            name: options.zoneRoot,
            roots: [options.zoneRoot],
          },
        ];

  const bundle = readGlb(await readFile(options.sceneFile));
  // The backdrop models are the one group not cut out of the bundle, so the two
  // mountain shells are matched by name list rather than by store stem
  // (`withBackdropAliases`, `backdrop.ts`). It happens here, inside the shared
  // function, so the editor's import places the horizon exactly as the command
  // line does (ADR-0031, ADR-0033).
  const scan = scanScene(bundle.json, {
    zones,
    prefabsByStem: withBackdropAliases(prefabsByStem),
  });

  const worldFile = join(options.contentDir, 'worlds', `${options.worldId}.json`);
  let authored: WorldDefinition | undefined;
  let previous: string | undefined;
  try {
    previous = await readFile(worldFile, 'utf8');
  } catch {
    previous = undefined;
  }
  if (previous !== undefined) {
    const parsed = parseWorldDefinition(JSON.parse(previous));
    if (!parsed.ok) {
      return {
        ok: false,
        errors: [`the world "${options.worldId}" already on disk is broken`, ...parsed.errors],
      };
    }
    authored = parsed.world;
  }

  const counters = new Map<string, number>();
  const world: WorldDefinition = carryOverAuthoredBlocks(
    {
      schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
      id: options.worldId,
      name: options.worldName,
      zones: zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        entities: toEntities(
          scan.instances.filter((instance) => instance.zone === zone.id),
          counters,
        ),
      })),
    },
    authored,
  );

  // The importer writes content that `pnpm validate:content` will check, so it
  // checks it here first: a broken importer must fail now, not in a pull request.
  const validation = parseWorldDefinition(world);
  if (!validation.ok) {
    return {
      ok: false,
      errors: ['the imported world does not satisfy the world schema', ...validation.errors],
    };
  }

  if (options.dryRun !== true) {
    const serialize = options.serialize ?? defaultSerialize;
    await writeFile(worldFile, await serialize(world), 'utf8');
  }

  return {
    ok: true,
    world,
    report: reportOf(options, scan, world, authored, ambiguous, prefabsByStem.size),
  };
}

/** `Foo (3)` and `Foo 3` are the same model twice; the group is what it is called. */
function missKey(miss: SceneMiss): string {
  return toKebab(miss.name.replace(/\s*\(\d+\)$/, '').replace(/\s+\d+$/, ''));
}

function reportOf(
  options: SceneImportOptions,
  scan: ReturnType<typeof scanScene>,
  world: WorldDefinition,
  authored: WorldDefinition | undefined,
  ambiguousStems: readonly string[],
  knownStems: number,
): SceneImportReport {
  const groups = new Map<string, { count: number; triangles: number; zone: string }>();
  for (const miss of scan.misses) {
    const key = missKey(miss);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { count: 1, triangles: miss.triangles, zone: miss.zone });
    } else {
      group.count += 1;
    }
  }

  return {
    sceneFile: options.sceneFile,
    worldId: options.worldId,
    knownStems,
    ambiguousStems,
    zones: world.zones.map((zone) => ({
      id: zone.id,
      entities: zone.entities.length,
      prefabs: new Set(zone.entities.map((entity) => entity.prefab)).size,
    })),
    entities: world.zones.reduce((sum, zone) => sum + zone.entities.length, 0),
    placedTriangles: scan.instances.reduce((sum, instance) => sum + instance.triangles, 0),
    missedTriangles: scan.misses.reduce((sum, miss) => sum + miss.triangles, 0),
    helpers: scan.helpers,
    missedInstances: scan.misses.length,
    misses: [...groups]
      .sort((left, right) => right[1].count - left[1].count)
      .map(([name, group]) => ({ name, ...group })),
    ignoredRoots: [...scan.ignoredRoots].sort((left, right) => right.meshNodes - left.meshNodes),
    swallowing: scan.swallowing,
    groundCarried: world.zones
      .filter((zone) => zone.terrain !== undefined)
      .map((zone) => zone.id)
      .sort(),
    // Counted on the *written* world rather than on the previous one, so the
    // number is what the file now holds and not what the function intended.
    entitiesCarried: world.zones
      .map((zone) => ({ zone: zone.id, entities: authoredEntities(zone).length }))
      .filter((zone) => zone.entities > 0),
    entitiesDropped: countAuthoredOutsideZones(world, authored),
    lightingCarried: [
      ...(world.lighting !== undefined ? ['the world'] : []),
      ...world.zones
        .filter((zone) => zone.lighting !== undefined)
        .map((zone) => zone.id)
        .sort(),
    ],
    dryRun: options.dryRun === true,
  };
}
