/**
 * Holds the "toene" (audio) and "symbole" (UI images) sections of
 * `assets/manifest.json` (Bauer B1, 2026-09-28) against the real disk
 * inventory: every recording under `assets/store/audio/` and every image
 * under `assets/store/ui/` must have an entry, and no entry may point at
 * a file that no longer exists.
 *
 * Same pattern as `tools/test/manifest-vollstaendig.ts` (there for
 * `assets/models/`), kept as its own file: models check themselves
 * against `manifest.modelle`, audio and UI images against
 * `manifest.toene`/`manifest.symbole` — two sections `tools/asset-
 * manifest.mjs` now writes in addition (same merge-not-replace rule, see
 * there). A separate test so a missing store doesn't drag the model
 * check down with it (and the other way round): `assets/store` and
 * `assets/models` are two independent sub-trees of `assets/` that can be
 * missing from a machine on their own.
 *
 *   npx tsx tools/test/manifest-ton-symbole.ts
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const AUDIO_DIR = join(ROOT, 'assets/store/audio');
const UI_DIR = join(ROOT, 'assets/store/ui');
const MANIFEST_PATH = join(ROOT, 'assets/manifest.json');

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

check(
  'assets/manifest.json exists (npx tsx tools/asset-manifest.mjs writes it)',
  existsSync(MANIFEST_PATH)
);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

/** Every file under `base` with one of `extensions`, recursively, relative to `base`. */
function filesWithExtension(base: string, extensions: readonly string[], prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(base, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesWithExtension(base, extensions, rel));
    else if (extensions.some((e) => entry.name.toLowerCase().endsWith(e))) out.push(rel);
  }
  return out;
}

/**
 * Check one section (audio or UI images) against its disk inventory —
 * the same approach as `manifest-vollstaendig.ts`, just parameterised
 * over directory, extension and field name.
 *
 * SKIPPED if the whole directory is missing (`assets/store` is not part
 * of the repository, see there). A FAILURE if only individual files are
 * missing — that is exactly what this check is for.
 */
function checkSection(name: string, dir: string, extension: string, field: 'toene' | 'symbole'): void {
  if (!existsSync(dir)) {
    console.log(`SKIPPED (${name}): ${dir} is missing — assets/ is not part of the repository.`);
    return;
  }

  const diskFiles = filesWithExtension(dir, [extension]).sort();
  const diskStems = new Set(diskFiles.map((f) => f.slice(0, -extension.length)));
  const section = (manifest[field] ?? {}) as Record<string, { datei: string }>;
  const sectionStems = new Set(Object.keys(section));

  const carriedOver: string[] = manifest[`${field}Uebernommen`] ?? [];
  const carriedOverSet = new Set(carriedOver);
  const count: number = manifest[`${field}Anzahl`] ?? Object.keys(section).length;

  check(
    `${name}: manifest.${field}Anzahl matches the number of entries`,
    count === sectionStems.size,
    `${field}Anzahl=${count} entries=${sectionStems.size}`
  );
  check(
    `${name}: measured entries (count − carried over) cover the disk inventory exactly`,
    count - carriedOver.length === diskFiles.length,
    `manifest=${count}−${carriedOver.length} disk=${diskFiles.length}`
  );

  const carriedOverWithoutEntry = carriedOver.filter((stem) => !sectionStems.has(stem));
  check(
    `${name}: every carried-over name has an entry`,
    carriedOverWithoutEntry.length === 0,
    carriedOverWithoutEntry.join(', ')
  );

  const carriedOverButPresent = carriedOver.filter((stem) => diskStems.has(stem));
  check(
    `${name}: no carried-over entry for a file that is present here (section is stale)`,
    carriedOverButPresent.length === 0,
    carriedOverButPresent.join(', ')
  );

  const missingFromSection = diskFiles
    .map((f) => f.slice(0, -extension.length))
    .filter((stem) => !sectionStems.has(stem));
  check(
    `${name}: every file under ${dir.slice(ROOT.length + 1)}/ has a manifest entry`,
    missingFromSection.length === 0,
    missingFromSection.slice(0, 10).join(', ')
  );

  const dangling: string[] = [];
  for (const [stem, entry] of Object.entries(section)) {
    if (carriedOverSet.has(stem)) continue;
    if (!diskStems.has(stem) || !existsSync(join(dir, entry.datei))) {
      dangling.push(`${stem} -> ${entry.datei}`);
    }
  }
  check(
    `${name}: no measured entry points at a missing file (${carriedOver.length} carried-over excluded)`,
    dangling.length === 0,
    dangling.join(', ')
  );
}

checkSection('Audio', AUDIO_DIR, '.ogg', 'toene');
checkSection('UI images', UI_DIR, '.png', 'symbole');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\n=== MANIFEST AUDIO/UI — COMPLETENESS: ALL PASSED ===');
process.exit(0);
