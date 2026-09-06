/**
 * `pnpm terrain-surface` — set how a zone's ground layers behave, from the
 * command line, into a world file (ADR-0032).
 *
 * ```bash
 * pnpm terrain-surface --world village1 --zone village \
 *   --layer 1 --metallic 0.85 --smoothness 0.1 --normal-scale 1.5
 * pnpm terrain-surface --world village1 --zone village --layer 0 --metallic none
 * pnpm terrain-surface --world village1 --zone village --flat-normals on
 * pnpm terrain-surface --world village1 --zone village --show
 * ```
 *
 * **Why a command as well as a panel.** Editor parity: everything a script
 * writes into a world file has to be something an author can reach in the
 * editor, and the only way to keep that true is to make them the same code. So
 * this calls `updateTerrainSurface` from `@wov/editor-core` — the very command
 * the ground panel dispatches — and writes the document it produced. A value
 * that this refuses is a value the panel refuses, in the same words.
 *
 * **What it deliberately cannot do.** Add a layer, change a texture, move the
 * tile. Those have an asset and an import behind them (ADR-0020); this is the
 * four numbers and the one switch that are a *look*.
 *
 * **Which world file it writes.** `CONTENT_DIR`, exactly as the API reads it,
 * and the checkout's own `content/` when it is unset — the same rule
 * `pnpm scatter` follows, and for the same reason.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  applyCommand,
  createDocument,
  serializeDocument,
  updateTerrainSurface,
  type TerrainSurfacePatch,
} from '@wov/editor-core';
import { parseWorldDefinition } from '@wov/world-schema';
import { repoRoot } from './prefab-catalog.js';
import { resolveContentDir } from './scatter-paths.js';

const USAGE = `usage: tsx tooling/scripts/terrain-surface.ts --world <id> --zone <id>
       [--layer <index> [--metallic <0…1|none>] [--smoothness <0…1|none>]
                        [--normal-scale <0…8|none>]]
       [--flat-normals on|off] [--show] [--dry-run]
`;

function fail(message: string): never {
  process.stderr.write(`FAIL ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);

function value(flag: string): string | undefined {
  const index = argv.indexOf(`--${flag}`);
  if (index === -1) {
    return undefined;
  }
  const next = argv[index + 1];
  return next === undefined || next.startsWith('--') ? '' : next;
}

function required(flag: string): string {
  const found = value(flag);
  if (found === undefined || found === '') {
    process.stderr.write(USAGE);
    fail(`--${flag} is required`);
  }
  return found;
}

/**
 * One surface number: a value in range, or `none` to take the field back out.
 *
 * `none` and not `0`, because they are different things: a layer with
 * `metallic: 0` states that it is dielectric, and a layer without the field
 * states nothing. They render the same today and the smaller file is the one
 * that stays readable.
 */
function surfaceNumber(flag: string, high: number): number | null | undefined {
  const text = value(flag);
  if (text === undefined) {
    return undefined;
  }
  if (text === 'none' || text === '') {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > high) {
    fail(`--${flag} must be a number from 0 to ${String(high)}, or "none", got "${text}"`);
  }
  return parsed;
}

const dryRun = argv.includes('--dry-run');
const show = argv.includes('--show');
const worldId = required('world');
const zoneId = required('zone');
const contentDir = resolveContentDir(process.env['CONTENT_DIR'], join(repoRoot, 'content'));

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
const terrain = zone.terrain;
if (terrain === undefined) {
  fail(`zone "${zoneId}" has no terrain`);
}

/** Prints the layer table, which is also what `--show` is for. */
function report(layers: readonly Record<string, unknown>[], facetted: boolean): void {
  process.stdout.write(
    `${'#'.padEnd(3)}${'texture'.padEnd(40)}${'metal'.padStart(7)}` +
      `${'smooth'.padStart(8)}${'normal'.padStart(8)}\n`,
  );
  layers.forEach((layer, index) => {
    const number = (key: string): string => {
      const found = layer[key];
      return typeof found === 'number' ? found.toFixed(2) : '–';
    };
    process.stdout.write(
      `${String(index).padEnd(3)}${String(layer['texture']).padEnd(40)}` +
        `${number('metallic').padStart(7)}${number('smoothness').padStart(8)}` +
        `${number('normalScale').padStart(8)}\n`,
    );
  });
  process.stdout.write(`facetted ground: ${facetted ? 'on' : 'off'}\n`);
}

if (show) {
  report(
    (terrain.layers ?? []) as unknown as Record<string, unknown>[],
    terrain.flatNormals === true,
  );
  process.exit(0);
}

const layerText = value('layer');
const facets = value('flat-normals');
if (facets !== undefined && facets !== 'on' && facets !== 'off') {
  fail(`--flat-normals must be "on" or "off", got "${facets}"`);
}
if (layerText === undefined && facets === undefined) {
  process.stderr.write(USAGE);
  fail('nothing to change: give --layer or --flat-normals');
}

const patch: TerrainSurfacePatch = {};
for (const [field, flag, high] of [
  ['metallic', 'metallic', 1],
  ['smoothness', 'smoothness', 1],
  ['normalScale', 'normal-scale', 8],
] as const) {
  const given = surfaceNumber(flag, high);
  if (given !== undefined) {
    // A field that was not asked about must stay *absent* from the patch, not
    // be present as `undefined`: absent means "leave it alone" and `null` means
    // "take it out", and the two are different edits.
    (patch as Record<string, number | null>)[field] = given;
  }
}

if (layerText !== undefined && Object.keys(patch).length === 0) {
  fail('--layer needs at least one of --metallic, --smoothness or --normal-scale');
}

const layerIndex = layerText === undefined ? undefined : Number(layerText);
if (layerIndex !== undefined && (!Number.isInteger(layerIndex) || layerIndex < 0)) {
  fail(`--layer must be a whole layer number, got "${String(layerText)}"`);
}

const command = updateTerrainSurface(zoneId, {
  ...(layerIndex === undefined ? {} : { layers: [{ index: layerIndex, patch }] }),
  ...(facets === undefined ? {} : { flatNormals: facets === 'on' }),
});

const applied = applyCommand(createDocument(world), command);
if (!applied.ok) {
  fail(applied.error);
}
const serialized = serializeDocument(applied.value.document);
if (!serialized.ok) {
  fail(`the changed world does not satisfy the world schema: ${serialized.errors.join('; ')}`);
}

const changed = serialized.world.zones.find((candidate) => candidate.id === zoneId)?.terrain;
report(
  (changed?.layers ?? []) as unknown as Record<string, unknown>[],
  changed?.flatNormals === true,
);

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

process.stdout.write(dryRun ? '\ndry run: nothing was written\n' : `\nwrote ${worldFile}\n`);
