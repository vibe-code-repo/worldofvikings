/**
 * `pnpm import:scene` — turns an authored scene bundle into `content/worlds/<id>.json`.
 *
 * ```bash
 * pnpm import:scene --scene <export>/SceneHierarchyObject/Village1.glb \
 *                   --world village1 --name "Village One"
 * pnpm import:scene --scene … --world … --name … --dry-run      # report only
 * pnpm import:scene --scene … --world … --name … --zone-root Environments
 * ```
 *
 * **What this is, and is not.** It takes placements a person authored by hand
 * and writes them down in the project's own format. It invents nothing: no
 * scatter, no noise, no rule that puts a tree somewhere (agent rule 16,
 * ADR-0021). Run twice over the same bundle it writes the same bytes.
 *
 * **What it does per run:**
 *
 * 1. Reads the prefab catalogues and indexes them by store file stem, which is
 *    the spelling a bundle node name folds onto.
 * 2. Walks the bundle top-down inside the zone roots, taking the highest node
 *    whose name is a known model as one instance (`scene-import.ts`).
 * 3. Mirrors x — the bundle's exporter negated it and the height field's did
 *    not — and splits each world matrix into position, YXZ Euler and scale.
 * 4. Writes the world file in exactly the formatting Prettier produces, so the
 *    editor can save over it without a whitespace diff (ADR-0017).
 * 5. Reports what it did *not* recognise, by name and weight. A bundle always
 *    contains models that never existed as their own file; those are for
 *    `pnpm import:scene-models`, and they must be visible, not lost.
 *
 * **Ground is carried over, not regenerated.** A zone's `terrain` block is
 * authored by hand — a height field, its splat maps and the order of its
 * layers, all of them measurements no bundle contains (ADR-0020). If the world
 * file being written already has one for a zone, it is copied into the new file
 * unchanged and named in the report. Without that, re-running this command
 * would silently take the ground out from under 1580 placements.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { CURRENT_WORLD_SCHEMA_VERSION, parseWorldDefinition } from '@wov/world-schema';
import type { TerrainDefinition, WorldDefinition } from '@wov/world-schema';
import { readGlb } from '../asset-pipeline/glb.js';
import { repoRoot } from './prefab-catalog.js';
import { loadPrefabStems } from './prefab-stems.js';
import type { SceneMiss, ZoneRule } from './scene-import.js';
import { DEFAULT_ZONES, scanScene, toEntities, toKebab } from './scene-import.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      'usage: tsx tooling/scripts/import-scene.ts --scene <bundle.glb> --world <id> ' +
        '--name <name> [--zone-root <node>] [--dry-run]\n',
    );
    process.exit(2);
  }
  return value;
}

const sceneFile = required('scene');
const worldId = required('world');
const worldName = required('name');
const zoneRoot = argument('zone-root');
const dryRun = process.argv.includes('--dry-run');

// ------------------------------------------------------- the prefab catalogue

const { byStem: prefabsByStem, ambiguous: ambiguousStems } = await loadPrefabStems(
  join(repoRoot, 'content', 'prefabs'),
);

// -------------------------------------------------------------------- the run

const zones: readonly ZoneRule[] =
  zoneRoot === undefined
    ? DEFAULT_ZONES
    : [{ id: toKebab(zoneRoot.split('/').at(-1) ?? zoneRoot), name: zoneRoot, roots: [zoneRoot] }];

process.stdout.write(`bundle:   ${sceneFile}\n`);
process.stdout.write(`prefabs:  ${String(prefabsByStem.size)} store names from content/prefabs/\n`);
if (ambiguousStems.length > 0) {
  process.stdout.write(
    `          ${String(ambiguousStems.length)} name(s) claimed by two catalogues, left unmatched: ` +
      `${ambiguousStems.join(', ')}\n`,
  );
}

const bundle = readGlb(await readFile(sceneFile));
const scan = scanScene(bundle.json, { zones, prefabsByStem });

const worldFile = join(repoRoot, 'content', 'worlds', `${worldId}.json`);

/**
 * The ground each zone already has, read back out of the file being replaced.
 *
 * A missing or unreadable file is not an error: the first import of a bundle
 * writes a world that has no ground yet. A file that exists but does not parse
 * *is* an error, because carrying nothing over from it would look like success.
 */
const terrainByZone = new Map<string, TerrainDefinition>();
let previous: string | undefined;
try {
  previous = await readFile(worldFile, 'utf8');
} catch {
  previous = undefined;
}
if (previous !== undefined) {
  const parsed = parseWorldDefinition(JSON.parse(previous));
  if (!parsed.ok) {
    process.stderr.write(`FAIL content/worlds/${worldId}.json: ${parsed.errors.join('; ')}\n`);
    process.exit(1);
  }
  for (const zone of parsed.world.zones) {
    if (zone.terrain !== undefined) {
      terrainByZone.set(zone.id, zone.terrain);
    }
  }
}

const counters = new Map<string, number>();
const world: WorldDefinition = {
  schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
  id: worldId,
  name: worldName,
  zones: zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    entities: toEntities(
      scan.instances.filter((instance) => instance.zone === zone.id),
      counters,
    ),
    ...(terrainByZone.has(zone.id) ? { terrain: terrainByZone.get(zone.id) } : {}),
  })),
};

// The importer writes content that `pnpm validate:content` will check, so it
// checks it here first: a broken importer must fail now, not in a pull request.
const validation = parseWorldDefinition(world);
if (!validation.ok) {
  process.stderr.write('FAIL the imported world does not satisfy the world schema\n');
  for (const message of validation.errors) {
    process.stderr.write(`       ${message}\n`);
  }
  process.exit(1);
}

if (!dryRun) {
  const prettierOptions = await resolveConfig(worldFile);
  await writeFile(
    worldFile,
    await format(JSON.stringify(world), {
      ...prettierOptions,
      filepath: worldFile,
      parser: 'json',
    }),
    'utf8',
  );
}

// ----------------------------------------------------------------- the report

process.stdout.write('\n  zone           entities  prefabs\n');
for (const zone of world.zones) {
  const used = new Set(zone.entities.map((entity) => entity.prefab));
  process.stdout.write(
    `  ${zone.id.padEnd(14)} ${String(zone.entities.length).padStart(8)} ${String(used.size).padStart(8)}\n`,
  );
}
const allPrefabs = new Set(scan.instances.map((instance) => instance.prefab));
process.stdout.write(
  `  ${'total'.padEnd(14)} ${String(scan.instances.length).padStart(8)} ${String(allPrefabs.size).padStart(8)}\n`,
);

const matchedTriangles = scan.instances.reduce((sum, instance) => sum + instance.triangles, 0);
const missedTriangles = scan.misses.reduce((sum, miss) => sum + miss.triangles, 0);
process.stdout.write(
  `\n  triangles placed: ${String(matchedTriangles)} of ${String(matchedTriangles + missedTriangles)} ` +
    `(${(((matchedTriangles || 1) / (matchedTriangles + missedTriangles || 1)) * 100).toFixed(1)} %)\n`,
);
process.stdout.write(`  collision boxes and triggers left out: ${String(scan.helpers)}\n`);
if (terrainByZone.size > 0) {
  process.stdout.write(
    `  ground carried over from the previous file: ${[...terrainByZone.keys()].sort().join(', ')}\n`,
  );
}
if (scan.ignoredRoots.length > 0) {
  process.stdout.write('\n  bundle roots no zone claims (not world data):\n');
  for (const root of [...scan.ignoredRoots].sort((a, b) => b.meshNodes - a.meshNodes)) {
    process.stdout.write(`    ${String(root.meshNodes).padStart(5)} mesh node(s)  ${root.name}\n`);
  }
}

/**
 * Misses grouped by the name they would have as a store file, because that is
 * the unit `pnpm import:scene-models` works in: one new model per group, not
 * one per instance.
 */
const missGroups = new Map<string, { count: number; triangles: number; example: SceneMiss }>();
for (const miss of scan.misses) {
  const key = toKebab(miss.name.replace(/\s*\(\d+\)$/, '').replace(/\s+\d+$/, ''));
  const group = missGroups.get(key);
  if (group === undefined) {
    missGroups.set(key, { count: 1, triangles: miss.triangles, example: miss });
  } else {
    group.count += 1;
  }
}

process.stdout.write(
  `\n  unmatched: ${String(scan.misses.length)} instance(s) under ${String(missGroups.size)} name(s), ` +
    `${String(missedTriangles)} triangles\n`,
);
for (const [name, group] of [...missGroups].sort((a, b) => b[1].count - a[1].count).slice(0, 30)) {
  process.stdout.write(
    `    ${String(group.count).padStart(4)}x ${name.padEnd(38)} ${String(group.triangles).padStart(7)} tri  ${group.example.zone}\n`,
  );
}
if (missGroups.size > 30) {
  process.stdout.write(`    … and ${String(missGroups.size - 30)} more name(s)\n`);
}

process.stdout.write(
  dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote content/worlds/${worldId}.json (${String(world.zones.reduce((sum, zone) => sum + zone.entities.length, 0))} entities)\n`,
);
