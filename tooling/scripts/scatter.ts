/**
 * `pnpm scatter` — one scatter run, from the command line, into a world file.
 *
 * ```bash
 * pnpm scatter --world village1 --zone village --region 60,60,240,240 \
 *   --prefab vegetation-grass-short-clump-1:3,vegetation-bush-1a2:1 \
 *   --density 40 --seed 7 --min-distance 0.6 --scale 0.8,1.4 \
 *   --keep-out sm-bld,path-wood-plank --keep-out-margin 0.4
 * pnpm scatter … --dry-run       # count and report, write nothing
 * ```
 *
 * **Why a command as well as a panel.** The scatter tool lives in the editor
 * (spec §12), and this is the same tool with its buttons taken off: it calls
 * `planScatter` from `@wov/editor-core`, the very function the panel calls, and
 * applies the result through the same `addEntities` command. That is what makes
 * a run in the pull request reproducible — a reviewer re-runs this line and
 * gets the same file, without a browser, a GPU or a mouse.
 *
 * **Nothing is generated at play time.** The output is entities in
 * `content/worlds/<id>.json`, sorted, in a section of their own at the end of
 * the zone. The seed is how a person repeats the gesture, not how the world is
 * stored (ADR-0025, agent rules 16 and 17).
 *
 * **Where the ground comes from.** The zone's own height field, read out of the
 * asset store and sampled between its vertices, so a tuft stands on the slope
 * rather than at y = 0. Set `WOV_ASSET_STORE` (or `--store`) to say where that
 * store is; the default is `<repo>/../asset-store`, a sibling of the checkout
 * that names nobody's machine. Without a store the run refuses rather than
 * laying a field of grass on an invented flat plane.
 *
 * **Which world file it writes.** `CONTENT_DIR`, exactly as the API reads it
 * (`services/api/src/config.ts`), and the checkout's own `content/` when it is
 * unset. The two used to disagree: a shell pointed at a throwaway copy for the
 * API would still have had a scatter run edit the committed village.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  applyCommand,
  createDocument,
  planScatter,
  scatterCommand,
  serializeDocument,
  footprintsOf,
  type Rect,
  type ScatterRegion,
  type WeightedPrefab,
} from '@wov/editor-core';
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import type { PrefabDefinition } from '@wov/world-schema';
import { readGlb } from '../asset-pipeline/glb.js';
import { heightAt, readHeightGrid } from '../asset-pipeline/height-field.js';
import { repoRoot } from './prefab-catalog.js';
import { resolveContentDir, resolveStoreRoot } from './scatter-paths.js';

const USAGE = `usage: tsx tooling/scripts/scatter.ts --world <id> --zone <id>
       --region x0,z0,x1,z1 --prefab <id>[:weight][,<id>[:weight]…]
       --density <per 100 m²> --seed <whole number>
       [--scale low,high] [--yaw low,high] [--min-distance <m>] [--maximum <n>]
       [--polygon x,z x,z x,z] [--exclude x0,z0,x1,z1]…
       [--keep-out <prefab substring>[,…]] [--keep-out-margin <m>]
       [--store <path>] [--dry-run]
`;

function fail(message: string): never {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);

/** All values given for one flag, in order. A flag may repeat. */
function values(flag: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${flag}`) {
      continue;
    }
    const rest: string[] = [];
    for (let ahead = index + 1; ahead < argv.length; ahead += 1) {
      const value = argv[ahead];
      if (value === undefined || value.startsWith('--')) {
        break;
      }
      rest.push(value);
    }
    found.push(rest.join(' '));
  }
  return found;
}

function value(flag: string): string | undefined {
  return values(flag)[0];
}

function required(flag: string): string {
  const found = value(flag);
  if (found === undefined || found === '') {
    process.stderr.write(USAGE);
    fail(`--${flag} is required`);
  }
  return found;
}

/** `a,b,c` or `a b c` as numbers, with the flag named when one is not one. */
function numbers(flag: string, text: string, count: number): number[] {
  const parts = text
    .split(/[\s,]+/)
    .filter((part) => part !== '')
    .map(Number);
  if (parts.length !== count || parts.some((part) => !Number.isFinite(part))) {
    fail(`--${flag} needs ${String(count)} numbers, got "${text}"`);
  }
  return parts;
}

const dryRun = argv.includes('--dry-run');
const worldId = required('world');
const zoneId = required('zone');
const seedText = required('seed');
const seed = Number(seedText);
if (!Number.isInteger(seed) || seed < 0) {
  fail(`--seed must be a whole number, zero or greater, got "${seedText}"`);
}
const density = Number(required('density'));
const rect = numbers('region', required('region'), 4) as unknown as Rect;
const scale = value('scale') === undefined ? undefined : numbers('scale', value('scale') ?? '', 2);
const yaw = value('yaw') === undefined ? undefined : numbers('yaw', value('yaw') ?? '', 2);
const minimumDistance = value('min-distance') === undefined ? 0 : Number(value('min-distance'));
const maximum = value('maximum') === undefined ? undefined : Number(value('maximum'));
const keepOutMargin = value('keep-out-margin') === undefined ? 0 : Number(value('keep-out-margin'));
const keepOut = (value('keep-out') ?? '').split(/[\s,]+/).filter((pattern) => pattern !== '');
const storeRoot = resolveStoreRoot(
  value('store'),
  process.env['WOV_ASSET_STORE'],
  join(repoRoot, '..', 'asset-store'),
);
/*
 * The same `CONTENT_DIR` the API honours (`services/api/src/config.ts`).
 *
 * `pnpm smoke` points the API at a throwaway copy of `content/` so the tests
 * can save real world files without touching the repository; a scatter run in
 * the same shell used to ignore that and edit the committed village instead.
 */
const contentDir = resolveContentDir(process.env['CONTENT_DIR'], join(repoRoot, 'content'));

// --------------------------------------------------------------- the prefabs

const catalogue = new Map<string, PrefabDefinition>();
for (const fileName of ['base.json', 'imported.json']) {
  const file = join(contentDir, 'prefabs', fileName);
  const parsed = parsePrefabCatalog(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.ok) {
    fail(`${file}: ${parsed.errors.join('; ')}`);
  }
  for (const prefab of parsed.catalog.prefabs) {
    catalogue.set(prefab.id, prefab);
  }
}

/**
 * The prefab a person meant.
 *
 * An exact id wins. Otherwise the group prefixes are tried, so the short name
 * a level designer says out loud — `grass-short-clump-1` — reaches
 * `vegetation-grass-short-clump-1` without the command line spelling out a
 * folder the catalogue already knows.
 */
function resolvePrefab(name: string): string {
  if (catalogue.has(name)) {
    return name;
  }
  for (const prefix of ['vegetation-', 'environment-']) {
    if (catalogue.has(`${prefix}${name}`)) {
      return `${prefix}${name}`;
    }
  }
  return fail(`no prefab "${name}" in content/prefabs/`);
}

const prefabs: WeightedPrefab[] = required('prefab')
  .split(/[\s,]+/)
  .filter((part) => part !== '')
  .map((part) => {
    const [name, weightText] = part.split(':');
    const weight = weightText === undefined ? 1 : Number(weightText);
    if (!Number.isFinite(weight) || weight <= 0) {
      fail(`"${part}" has no usable weight; write it as <prefab>:<positive number>`);
    }
    return { prefab: resolvePrefab(name ?? ''), weight };
  });

// ----------------------------------------------------------------- the world

const worldFile = join(contentDir, 'worlds', `${worldId}.json`);
const parsedWorld = parseWorldDefinition(JSON.parse(await readFile(worldFile, 'utf8')));
if (!parsedWorld.ok) {
  fail(`${worldFile}: ${parsedWorld.errors.join('; ')}`);
}
const world = parsedWorld.world;
const zone = world.zones.find((candidate) => candidate.id === zoneId);
if (zone === undefined) {
  fail(`world "${worldId}" has no zone "${zoneId}"`);
}

// ---------------------------------------------------------------- the ground

const terrain = zone.terrain;
if (terrain === undefined) {
  fail(
    `zone "${zoneId}" has no terrain, so there is no ground to stand anything on; ` +
      'scatter into a zone with a height field',
  );
}
// `heightSamples` when the world names one: the drawn tile may be adaptive and
// therefore not a grid at all (ADR-0032), and a scatter run needs a grid to
// interpolate between. Falling back to the height field keeps every world that
// predates the field working unchanged.
const samplesPath = terrain.heightSamples ?? terrain.heightField;
const heightFieldFile = join(storeRoot, samplesPath);
let grid;
try {
  grid = readHeightGrid(readGlb(await readFile(heightFieldFile)), samplesPath);
} catch (error) {
  fail(
    `${heightFieldFile}: ${error instanceof Error ? error.message : String(error)}` +
      ' — set --store or WOV_ASSET_STORE to the asset store holding this height field',
  );
}
// The height field is a tile placed at `terrain.position`; the grid inside it
// starts at its own origin, so a world coordinate is read at the difference.
const groundAt = (x: number, z: number): number =>
  terrain.position[1] + heightAt(grid, x - terrain.position[0], z - terrain.position[2]);

// -------------------------------------------------------------- the keep-outs

const excludes: Rect[] = values('exclude').map(
  (text) => numbers('exclude', text, 4) as unknown as Rect,
);
const fromEntities = footprintsOf(zone.entities, catalogue, keepOut, { margin: keepOutMargin });
const region: ScatterRegion = {
  rect,
  ...(value('polygon') === undefined
    ? {}
    : {
        polygon: chunkPairs(
          (value('polygon') ?? '')
            .split(/[\s,]+/)
            .filter((part) => part !== '')
            .map(Number),
        ),
      }),
  exclude: [...excludes, ...fromEntities],
};

function chunkPairs(flat: readonly number[]): readonly (readonly [number, number])[] {
  if (flat.length < 6 || flat.length % 2 !== 0 || flat.some((part) => !Number.isFinite(part))) {
    return fail('--polygon needs at least three x,z pairs of finite numbers');
  }
  const pairs: [number, number][] = [];
  for (let index = 0; index < flat.length; index += 2) {
    pairs.push([flat[index] ?? 0, flat[index + 1] ?? 0]);
  }
  return pairs;
}

// ---------------------------------------------------------------- the scatter

const options = {
  region,
  prefabs,
  density,
  seed,
  minimumDistance,
  heightAt: groundAt,
  ...(scale === undefined ? {} : { scale: [scale[0], scale[1]] as [number, number] }),
  ...(yaw === undefined ? {} : { yawDegrees: [yaw[0], yaw[1]] as [number, number] }),
  ...(maximum === undefined ? {} : { maximum }),
};

const planned = planScatter(options);
if (!planned.ok) {
  fail(planned.error);
}

process.stdout.write(`world:    ${worldFile}, zone "${zoneId}"\n`);
process.stdout.write(`store:    ${storeRoot}\n`);
process.stdout.write(
  `region:   ${rect.map((side) => side.toFixed(1)).join(', ')} — ` +
    `${planned.value.usableArea.toFixed(0)} m² usable of ` +
    `${((rect[2] - rect[0]) * (rect[3] - rect[1])).toFixed(0)} m²\n`,
);
process.stdout.write(
  `keep-out: ${String(excludes.length)} given, ${String(fromEntities.length)} from entities` +
    `${keepOut.length === 0 ? '' : ` matching ${keepOut.join(', ')}`}\n`,
);
process.stdout.write(
  `density:  ${String(density)} per 100 m² → ${String(planned.value.requested)} asked for, ` +
    `${String(planned.value.entities.length)} placed, ` +
    `${String(planned.value.crowdedOut)} crowded out by the ${String(minimumDistance)} m spacing\n`,
);

const perPrefab = new Map<string, number>();
for (const entity of planned.value.entities) {
  perPrefab.set(entity.prefab, (perPrefab.get(entity.prefab) ?? 0) + 1);
}
for (const [prefab, count] of [...perPrefab].sort()) {
  process.stdout.write(`  ${prefab.padEnd(40)} ${String(count).padStart(6)}\n`);
}

const built = scatterCommand(zoneId, options);
if (!built.ok) {
  fail(built.error);
}
const applied = applyCommand(createDocument(world), built.value.command);
if (!applied.ok) {
  fail(`${applied.error} — a run with this seed is already in the world file`);
}
const serialized = serializeDocument(applied.value.document);
if (!serialized.ok) {
  fail(`the scattered world does not satisfy the world schema: ${serialized.errors.join('; ')}`);
}

if (!dryRun) {
  const prettierOptions = await resolveConfig(worldFile);
  await writeFile(
    worldFile,
    await format(JSON.stringify(serialized.world), {
      ...prettierOptions,
      filepath: worldFile,
      parser: 'json',
    }),
    'utf8',
  );
}

const total = serialized.world.zones.reduce((sum, candidate) => sum + candidate.entities.length, 0);
process.stdout.write(
  dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote ${worldFile} (${String(total)} entities in the world)\n`,
);
