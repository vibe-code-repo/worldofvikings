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
 * **Where the work happens.** In `@wov/content-build`, not here. This file is
 * the command line around `importSceneBundle` — arguments in, a report out —
 * and the editor's *World → Import scene bundle…* calls the same function
 * through the API (ADR-0033). A rule added here instead of in the package would
 * be a rule the editor does not have.
 *
 * **Ground, light and authored entities are carried over, not regenerated**
 * (ADR-0028, ADR-0036). A `terrain` or `lighting` block in the world file being
 * written is copied into the new file unchanged, and so is every entity the
 * importer did not mint — a scattered field, a prop placed in the editor. All
 * three are named in the report, so a re-import that changes nothing is a run
 * that says it changed nothing.
 */
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { importSceneBundle } from '@wov/content-build';
import type { WorldDefinition } from '@wov/world-schema';
import { repoRoot } from './repo-root.js';

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
const contentDir = join(repoRoot, 'content');
const worldFile = join(contentDir, 'worlds', `${worldId}.json`);

process.stdout.write(`bundle:   ${sceneFile}\n`);

const result = await importSceneBundle({
  sceneFile,
  worldId,
  worldName,
  contentDir,
  zoneRoot: argument('zone-root'),
  dryRun: process.argv.includes('--dry-run'),
  // Exactly the formatting Prettier produces, so the editor can save over the
  // file without a whitespace diff (ADR-0017).
  serialize: async (world: WorldDefinition) =>
    format(JSON.stringify(world), {
      ...(await resolveConfig(worldFile)),
      filepath: worldFile,
      parser: 'json',
    }),
});

if (!result.ok) {
  process.stderr.write('FAIL the scene import did not finish\n');
  for (const message of result.errors) {
    process.stderr.write(`       ${message}\n`);
  }
  process.exit(1);
}

const { report } = result;

process.stdout.write(`prefabs:  ${String(report.knownStems)} store names from content/prefabs/\n`);
if (report.ambiguousStems.length > 0) {
  process.stdout.write(
    `          ${String(report.ambiguousStems.length)} name(s) claimed by two catalogues, ` +
      `left unmatched: ${report.ambiguousStems.join(', ')}\n`,
  );
}

process.stdout.write('\n  zone           entities  prefabs\n');
for (const zone of report.zones) {
  process.stdout.write(
    `  ${zone.id.padEnd(14)} ${String(zone.entities).padStart(8)} ` +
      `${String(zone.prefabs).padStart(8)}\n`,
  );
}
process.stdout.write(`  ${'total'.padEnd(14)} ${String(report.entities).padStart(8)}\n`);

const allTriangles = report.placedTriangles + report.missedTriangles;
process.stdout.write(
  `\n  triangles placed: ${String(report.placedTriangles)} of ${String(allTriangles)} ` +
    `(${(((report.placedTriangles || 1) / (allTriangles || 1)) * 100).toFixed(1)} %)\n`,
);
process.stdout.write(`  collision boxes and triggers left out: ${String(report.helpers)}\n`);
if (report.groundCarried.length > 0) {
  process.stdout.write(
    `  ground carried over from the previous file: ${report.groundCarried.join(', ')}\n`,
  );
}
if (report.lightingCarried.length > 0) {
  process.stdout.write(
    `  lighting carried over from the previous file: ${report.lightingCarried.join(', ')}\n`,
  );
}
if (report.entitiesCarried.length > 0) {
  process.stdout.write(
    '  authored entities kept (scattered or placed by hand): ' +
      `${report.entitiesCarried
        .map((zone) => `${zone.zone} ${String(zone.entities)}`)
        .join(', ')}\n`,
  );
}
if (report.entitiesDropped > 0) {
  process.stdout.write(
    `  authored entities DROPPED with zones the bundle no longer has: ${String(
      report.entitiesDropped,
    )}\n`,
  );
}
if (report.ignoredRoots.length > 0) {
  process.stdout.write('\n  bundle roots no zone claims (not world data):\n');
  for (const root of report.ignoredRoots) {
    process.stdout.write(`    ${String(root.meshNodes).padStart(5)} mesh node(s)  ${root.name}\n`);
  }
}

process.stdout.write(
  `\n  unmatched: ${String(report.missedInstances)} instance(s) under ` +
    `${String(report.misses.length)} name(s), ${String(report.missedTriangles)} triangles\n`,
);
for (const group of report.misses.slice(0, 30)) {
  process.stdout.write(
    `    ${String(group.count).padStart(4)}x ${group.name.padEnd(38)} ` +
      `${String(group.triangles).padStart(7)} tri  ${group.zone}\n`,
  );
}
if (report.misses.length > 30) {
  process.stdout.write(`    … and ${String(report.misses.length - 30)} more name(s)\n`);
}

process.stdout.write(
  report.dryRun
    ? '\ndry run: nothing was written\n'
    : `\nwrote content/worlds/${worldId}.json (${String(report.entities)} entities)\n`,
);
