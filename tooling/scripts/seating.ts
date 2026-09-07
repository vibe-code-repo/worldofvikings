/**
 * `pnpm seating` — how far the placements of a zone stand above their ground.
 *
 * ```bash
 * pnpm seating --world village1 --zone surroundings --prefab rock-cliff
 * pnpm seating --world village1 --zone village --ground village --list 20
 * ```
 *
 * **Why this is a command and not a paragraph in a pull request.** The scene
 * import copies the bundle's placements and never moves anything (agent rule
 * 16), so whether a group of them may be drawn is a question about numbers:
 * do they touch the ground this repository ships? That question has been asked
 * twice about the same 100 cliffs and answered wrongly twice — once about a
 * bounding box instead of the model, and once about the height field's
 * resolution, which turned out to be worth 1.5 m against a 27 m gap (ADR-0036).
 * This asks it the same way every time.
 *
 * **What it measures.** For every entity it takes the model's *own* vertices in
 * the frame the game puts them in, applies the entity's transform, and reports
 * the smallest `point y − ground under that point`. A model box would be
 * cheaper and is what the first attempt used; on a tilted rock its lowest
 * corner is nowhere near the geometry, which is how a cliff resting on a slope
 * came out floating 29 m.
 *
 * **Against which ground.** Both of them, always: the regular `heightSamples`
 * raster a tool interpolates and the adaptive tile the player actually stands
 * on (ADR-0032). Printing the two side by side is the only way a claim like
 * "the ground is the approximation" can be checked instead of repeated.
 *
 * Nothing is written. This reads a world file and reports; moving a placement
 * is a decision for a person and an ADR.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compose, readGlb } from '@wov/content-build';
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import type { EntityDefinition, PrefabDefinition } from '@wov/world-schema';
import { heightAtOnTile, readHeightGrid } from '../asset-pipeline/height-field.js';
import {
  modelPoints,
  readTriangleField,
  seatingOf,
  surfaceUnder,
  type Seating,
} from '../asset-pipeline/seating.js';
import { repoRoot } from './repo-root.js';
import { resolveContentDir, resolveStoreRoot } from './scatter-paths.js';

const USAGE = `usage: tsx tooling/scripts/seating.ts --world <id> --zone <id>
       [--prefab <substring>] [--ground <zone id>] [--seated <m>] [--list <n>]
       [--store <path>]
`;

function fail(message: string): never {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
function value(flag: string): string | undefined {
  const index = argv.indexOf(`--${flag}`);
  const found = index === -1 ? undefined : argv[index + 1];
  return found === undefined || found.startsWith('--') ? undefined : found;
}
function required(flag: string): string {
  const found = value(flag);
  if (found === undefined || found === '') {
    process.stderr.write(USAGE);
    fail(`--${flag} is required`);
  }
  return found;
}

const worldId = required('world');
const zoneId = required('zone');
const filter = value('prefab') ?? '';
const listCount = Number(value('list') ?? '20');
/**
 * How close counts as standing on the ground.
 *
 * Half a metre by default, which is not a taste: it is roughly the height a
 * blade of the village's grass reaches, so a gap under it is a gap the ground
 * cover closes. Anything larger is a shadow that starts in mid-air.
 */
const seatedWithin = Number(value('seated') ?? '0.5');
if (!Number.isFinite(seatedWithin) || seatedWithin < 0) {
  fail(`--seated must be a distance in metres, got "${value('seated') ?? ''}"`);
}

const storeRoot = resolveStoreRoot(
  value('store'),
  process.env['WOV_ASSET_STORE'],
  join(repoRoot, '..', 'asset-store'),
);
const contentDir = resolveContentDir(process.env['CONTENT_DIR'], join(repoRoot, 'content'));

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

/**
 * The zone whose ground is measured against.
 *
 * It defaults to the first zone that has one, because the question this command
 * exists for is asked about zones that have *no* ground of their own: the game
 * draws one zone and an entity in any other is an entity nothing renders, so
 * "would this stand up if it were moved?" is a question about the drawn zone's
 * tile (ADR-0031).
 */
const groundZoneId = value('ground');
const groundZone =
  groundZoneId === undefined
    ? world.zones.find((candidate) => candidate.terrain !== undefined)
    : world.zones.find((candidate) => candidate.id === groundZoneId);
const terrain = groundZone?.terrain;
if (groundZone === undefined || terrain === undefined) {
  fail(
    groundZoneId === undefined
      ? `world "${worldId}" has no zone with a terrain block to measure against`
      : `zone "${groundZoneId}" has no terrain block`,
  );
}

// ---------------------------------------------------------------- the ground

async function readStore(path: string): Promise<Buffer> {
  try {
    return await readFile(join(storeRoot, path));
  } catch (error) {
    return fail(
      `${join(storeRoot, path)}: ${error instanceof Error ? error.message : String(error)}` +
        ' — set --store or WOV_ASSET_STORE to the asset store holding this world',
    );
  }
}

const samplesPath = terrain.heightSamples ?? terrain.heightField;
const grid = readHeightGrid(readGlb(await readStore(samplesPath)), samplesPath);
/** The raster, read through the tile rectangle and clamped at its rim. */
const samplesAt = (x: number, z: number): number =>
  terrain.position[1] + heightAtOnTile(grid, x, z, terrain.position, terrain.size);

const field = readTriangleField(
  readGlb(await readStore(terrain.heightField)),
  terrain.heightField,
  terrain.position,
);
/** The drawn tile itself, which simply has no answer beyond its own edge. */
const tileAt = (x: number, z: number): number | undefined => surfaceUnder(field, x, z);

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

const points = new Map<string, Float32Array>();
async function pointsOf(prefabId: string): Promise<Float32Array | undefined> {
  const cached = points.get(prefabId);
  if (cached !== undefined) {
    return cached;
  }
  const prefab = catalogue.get(prefabId);
  if (prefab?.asset === undefined) {
    return undefined;
  }
  const read = modelPoints(readGlb(await readStore(prefab.asset)), prefab.asset);
  points.set(prefabId, read);
  return read;
}

// ----------------------------------------------------------- the measurement

interface Row {
  readonly entity: EntityDefinition;
  readonly samples: Seating;
  readonly tile: Seating;
}

const chosen = zone.entities.filter((entity) => entity.prefab.includes(filter));
if (chosen.length === 0) {
  fail(`zone "${zoneId}" has no entity whose prefab contains "${filter}"`);
}

const rows: Row[] = [];
const unmeasured: string[] = [];
for (const entity of chosen) {
  const model = await pointsOf(entity.prefab);
  if (model === undefined || model.length === 0) {
    unmeasured.push(entity.prefab);
    continue;
  }
  const matrix = compose({
    position: [entity.position[0], entity.position[1], entity.position[2]],
    rotation: entity.rotation ?? [0, 0, 0],
    scale: entity.scale ?? [1, 1, 1],
  });
  rows.push({
    entity,
    samples: seatingOf(model, matrix, samplesAt),
    tile: seatingOf(model, matrix, tileAt),
  });
}

// ------------------------------------------------------------------ the report

function say(text: string): void {
  process.stdout.write(`${text}\n`);
}

function summarise(label: string, gaps: readonly number[]): void {
  const measured = gaps.filter((gap) => Number.isFinite(gap));
  const floating = measured.filter((gap) => gap > seatedWithin).length;
  const badly = measured.filter((gap) => gap > 3).length;
  const seated = measured.length - floating;
  const share = measured.length === 0 ? 0 : (seated / measured.length) * 100;
  say(
    `  ${label.padEnd(34)} seated ${String(seated).padStart(4)}/${String(measured.length).padEnd(4)} ` +
      `(${share.toFixed(1)} %)   over ${seatedWithin.toFixed(1)} m: ${String(floating).padStart(3)}   ` +
      `over 3 m: ${String(badly).padStart(3)}   ` +
      `worst ${Math.max(...measured)
        .toFixed(2)
        .padStart(7)} m   ` +
      `deepest ${Math.min(...measured)
        .toFixed(2)
        .padStart(8)} m`,
  );
}

say(
  `${String(rows.length)} placement(s) of zone "${zoneId}" against the ground of zone ` +
    `"${groundZone.id}"${filter === '' ? '' : `, prefab contains "${filter}"`}`,
);
say('');
say('gap = the smallest (model point y − ground under it); negative means sunk in');
summarise(
  `vs. ${samplesPath.split('/').at(-1) ?? samplesPath}`,
  rows.map((row) => row.samples.gap),
);
summarise(
  `vs. ${terrain.heightField.split('/').at(-1) ?? terrain.heightField}`,
  rows.map((row) => row.tile.gap),
);

const hidden = rows.filter((row) => row.tile.visible < 0.05).length;
const shares = rows.map((row) => row.tile.visible).sort((a, b) => a - b);
const median = shares[Math.floor(shares.length / 2)] ?? 0;
say('');
say(
  `on the drawn tile: median ${(median * 100).toFixed(0)} % of a model's points are above the ` +
    `ground; ${String(hidden)} of ${String(rows.length)} show less than 5 % of themselves`,
);
const offGround = rows.filter((row) => row.tile.offGround > 0).length;
if (offGround > 0) {
  say(`${String(offGround)} placement(s) reach past the edge of the tile`);
}
if (unmeasured.length > 0) {
  say(`${String(unmeasured.length)} placement(s) had no model in the store and were skipped`);
}

const worst = [...rows].sort((a, b) => b.tile.gap - a.tile.gap).slice(0, Math.max(0, listCount));
if (worst.length > 0 && (worst[0]?.tile.gap ?? 0) > seatedWithin) {
  say('');
  say(`the ${String(worst.length)} highest-standing placements:`);
  for (const row of worst) {
    say(
      `  ${row.entity.id.padEnd(42)} x=${row.entity.position[0].toFixed(1).padStart(6)} ` +
        `z=${row.entity.position[2].toFixed(1).padStart(6)}   ` +
        `tile ${row.tile.gap.toFixed(2).padStart(7)} m   raster ${row.samples.gap.toFixed(2).padStart(7)} m   ` +
        `shows ${(row.tile.visible * 100).toFixed(0).padStart(3)} %`,
    );
  }
}
