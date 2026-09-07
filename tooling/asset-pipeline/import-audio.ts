/**
 * Imports the sound clips this phase needs from a private export into the
 * private asset store, and writes their manifest rows (ADR-0015, ADR-0054).
 *
 * ```bash
 * pnpm import:audio --source ~/assets/export/audio --store ~/assets/store
 * pnpm import:audio --source … --store … --dry-run   # report, write nothing
 * ```
 *
 * What one run does:
 *
 * 1. **Hash the export.** Every file in `--source` is read once and indexed by
 *    the SHA-256 of its bytes. Nothing is matched by name; see `audio-clips.ts`
 *    for why that is the whole point, not an implementation detail.
 * 2. **Take the allow-list, and only it.** A clip whose hash is not in the
 *    export is *named and counted*, never quietly skipped: a run that produced
 *    30 of 44 clips and said "done" is exactly the failure this reports.
 * 3. **Re-encode** with `ffmpeg` to Opus at 48 kHz — mono for one-shots and
 *    emitter loops, stereo for the two beds — stripping every source tag on the
 *    way. Two clips are also cut to length, because a bed's cost is the decoded
 *    PCM it holds for the whole session, not its download.
 * 4. **Write** the clip into the store under its new name, one shared silent
 *    placeholder into `assets/placeholders/audio/`, and one manifest row per
 *    clip with provenance that states acoustic facts and admits the rest.
 * 5. **Report** per group and in total, and fail over the size budget.
 *
 * **Deterministic and idempotent.** Same export, same bytes out, same manifest:
 * `libopus` is deterministic for fixed arguments, the rows are written with
 * stable key order, and `generatedAt` is only touched when the asset list really
 * changed. Re-running over an unchanged export rewrites nothing of substance.
 *
 * **It does not own the whole manifest.** Rows other importers wrote are carried
 * over for as long as the store still holds their files — `manifest-merge.ts`
 * explains why the store is a second source of truth, ADR-0023 why it became one.
 *
 * **Requires `ffmpeg` on the importer's machine.** That is a store-side tool
 * like the private export itself: a clean clone never runs this command, and
 * `pnpm dev` does not need it (agent rule 18).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_HASH_PREFIX,
  ASSET_MANIFEST_FILE_NAME,
  CURRENT_ASSET_MANIFEST_VERSION,
  UNDETERMINED_LICENSE,
  assetIdFromPath,
  isAudioAssetPath,
  parseAssetManifest,
} from '@wov/asset-system/manifest';
import type { AssetEntry } from '@wov/asset-system/manifest';
import {
  AUDIO_CLIPS,
  AUDIO_IMPORT_BUDGET_BYTES,
  audioClipGroup,
  audioClipOrigin,
  ffmpegArgumentsFor,
} from './audio-clips.js';
import { mergeOwnedEntries } from './manifest-merge.js';
import { SILENCE_SECONDS, silentWav } from './silent-wav.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const assetsDir = join(repoRoot, 'assets');
const manifestFile = join(assetsDir, ASSET_MANIFEST_FILE_NAME);

/** One shared stand-in for every private clip; see ADR-0054. */
const AUDIO_PLACEHOLDER = 'placeholders/audio/silence.wav';

/** The set these clips belong to, worded as the other private sets are. */
const AUDIO_SET = 'private asset collection — audio set';

/** What can honestly be said about who made them. */
const AUDIO_AUTHOR = 'unconfirmed — third-party pack, licence review open';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = argument(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      'usage: tsx tooling/asset-pipeline/import-audio.ts ' +
        '--source <export> --store <store> [--dry-run]\n',
    );
    process.exit(2);
  }
  return value;
}

const sourceDir = resolve(required('source'));
const storeDir = resolve(required('store'));
const dryRun = process.argv.includes('--dry-run');

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Every file under a directory, as absolute paths. */
async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files.sort();
}

function hashOf(bytes: Uint8Array): string {
  return `${ASSET_HASH_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Runs a command and resolves with its exit code and captured stderr. */
function run(command: string, args: readonly string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      resolveRun({ code: code ?? -1, stderr });
    });
  });
}

/** The encoded file's duration in seconds, measured rather than assumed. */
async function durationOf(file: string): Promise<number> {
  const probe = spawn('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  let out = '';
  probe.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  const code = await new Promise<number>((resolveProbe, rejectProbe) => {
    probe.on('error', rejectProbe);
    probe.on('close', (value) => {
      resolveProbe(value ?? -1);
    });
  });
  const seconds = Number.parseFloat(out.trim());
  return code === 0 && Number.isFinite(seconds) ? seconds : 0;
}

// ------------------------------------------------------------------- ffmpeg

for (const tool of ['ffmpeg', 'ffprobe']) {
  const probe = await run(tool, ['-version']).catch(() => ({ code: -1, stderr: '' }));
  if (probe.code !== 0) {
    fail(
      `FAIL ${tool} is not on PATH. pnpm import:audio re-encodes the private export and ` +
        `needs it; a clean clone never runs this command (agent rule 18).`,
    );
  }
}

// ---------------------------------------------------------------- the export

const sourceFiles = (await listFiles(sourceDir).catch(() => {
  fail(`FAIL --source ${sourceDir} cannot be read`);
})) as string[];

const audioSources = sourceFiles.filter((file) => isAudioAssetPath(file));
/** Source file by content hash. First one wins; a duplicate is reported. */
const byHash = new Map<string, string>();
let duplicates = 0;
for (const file of audioSources) {
  const hash = hashOf(await readFile(file));
  if (byHash.has(hash)) {
    duplicates += 1;
    continue;
  }
  byHash.set(hash, file);
}

process.stdout.write(
  `source ${String(audioSources.length)} audio file(s), ` +
    `${String(byHash.size)} distinct by content` +
    (duplicates > 0 ? ` (${String(duplicates)} byte-identical duplicate(s))` : '') +
    `\n`,
);

// ------------------------------------------------------------- the encoding

interface Encoded {
  readonly entry: AssetEntry;
  readonly group: string;
}

const encoded: Encoded[] = [];
const notInExport: string[] = [];

for (const clip of AUDIO_CLIPS) {
  const source = byHash.get(clip.sourceHash);
  if (source === undefined) {
    notInExport.push(clip.path);
    continue;
  }
  const target = join(storeDir, clip.path);
  if (!dryRun) {
    await mkdir(dirname(target), { recursive: true });
    const result = await run('ffmpeg', ffmpegArgumentsFor(clip, source, target));
    if (result.code !== 0) {
      fail(`FAIL encoding ${clip.path}: ${result.stderr.trim()}`);
    }
  }
  const exists = await stat(target).catch(() => undefined);
  if (exists === undefined) {
    // Only reachable in a dry run against a store that has never been written.
    process.stdout.write(`  would encode ${clip.path}\n`);
    continue;
  }
  const bytes = await readFile(target);
  encoded.push({
    group: audioClipGroup(clip.path),
    entry: {
      id: assetIdFromPath(clip.path),
      path: clip.path,
      kind: 'audio',
      bytes: bytes.byteLength,
      hash: hashOf(bytes),
      origin: audioClipOrigin({ profile: clip.profile, seconds: await durationOf(target) }),
      source: AUDIO_SET,
      author: AUDIO_AUTHOR,
      license: UNDETERMINED_LICENSE,
      redistributable: false,
      visibility: 'private',
      placeholder: AUDIO_PLACEHOLDER,
    },
  });
}

if (notInExport.length > 0) {
  process.stderr.write(
    `FAIL ${String(notInExport.length)} of ${String(AUDIO_CLIPS.length)} clip(s) are not in ` +
      `${sourceDir} — matched by content, so a renamed file is still found and a changed ` +
      `one is deliberately not:\n`,
  );
  for (const path of notInExport) {
    process.stderr.write(`       absent ${path}\n`);
  }
  process.exit(1);
}

// ------------------------------------------------------------- the placeholder

const placeholder = silentWav();
if (!dryRun) {
  await mkdir(join(assetsDir, dirname(AUDIO_PLACEHOLDER)), { recursive: true });
  await writeFile(join(assetsDir, AUDIO_PLACEHOLDER), placeholder);
}

const placeholderEntry: AssetEntry = {
  id: assetIdFromPath(AUDIO_PLACEHOLDER),
  path: AUDIO_PLACEHOLDER,
  kind: 'audio',
  bytes: placeholder.byteLength,
  hash: hashOf(placeholder),
  origin:
    `Generated by tooling/asset-pipeline/import-audio.ts: ${String(SILENCE_SECONDS)} s of ` +
    `16-bit PCM silence at 48 kHz, mono. One shared stand-in for every private clip, ` +
    `because a sound has no hull to get wrong (ADR-0054).`,
  source: 'World of Vikings asset pipeline',
  author: 'World of Vikings contributors',
  license: 'CC0-1.0',
  redistributable: true,
  visibility: 'public',
};

// ---------------------------------------------------------------- the budget

const totalBytes = encoded.reduce((sum, item) => sum + item.entry.bytes, 0);
const perGroup = new Map<string, { count: number; bytes: number }>();
for (const item of encoded) {
  const current = perGroup.get(item.group) ?? { count: 0, bytes: 0 };
  perGroup.set(item.group, { count: current.count + 1, bytes: current.bytes + item.entry.bytes });
}
for (const [group, totals] of [...perGroup].sort()) {
  process.stdout.write(
    `  ${group.padEnd(12)} ${String(totals.count).padStart(3)} clip(s)  ` +
      `${(totals.bytes / 1024).toFixed(1).padStart(8)} KB\n`,
  );
}
process.stdout.write(
  `  ${'total'.padEnd(12)} ${String(encoded.length).padStart(3)} clip(s)  ` +
    `${(totalBytes / 1024).toFixed(1).padStart(8)} KB\n`,
);

if (totalBytes > AUDIO_IMPORT_BUDGET_BYTES) {
  fail(
    `FAIL ${(totalBytes / 1024).toFixed(1)} KB of audio exceeds the ` +
      `${String(AUDIO_IMPORT_BUDGET_BYTES / 1024)} KB budget`,
  );
}

// -------------------------------------------------------------- the manifest

const existing = await readFile(manifestFile, 'utf8').catch(() => {
  fail(`FAIL assets/${ASSET_MANIFEST_FILE_NAME} is missing`);
});
const parsed = parseAssetManifest(JSON.parse(existing as string));
if (!parsed.ok) {
  fail(`FAIL assets/${ASSET_MANIFEST_FILE_NAME}: ${parsed.errors.join(' | ')}`);
}

const produced = [...encoded.map((item) => item.entry), placeholderEntry];
const storePaths = new Set(
  (await listFiles(storeDir).catch(() => [] as string[])).map((file) =>
    file
      .slice(storeDir.length + 1)
      .split('\\')
      .join('/'),
  ),
);
const merged = mergeOwnedEntries(parsed.manifest.assets, produced, (path) => storePaths.has(path));

// `mergeOwnedEntries` sorts by path and the manifest on disk is stored sorted,
// so a value comparison is enough to tell "nothing changed" from "rewrite it".
// Without this every run would put a fresh `generatedAt` into a pull request.
const unchanged = JSON.stringify(merged.assets) === JSON.stringify(parsed.manifest.assets);

if (dryRun) {
  process.stdout.write(
    `DRY  ${String(produced.length)} row(s) would be written, ` +
      `${String(merged.dropped.length)} dropped\n`,
  );
  process.exit(0);
}

if (!unchanged) {
  await writeFile(
    manifestFile,
    `${JSON.stringify(
      {
        manifestVersion: CURRENT_ASSET_MANIFEST_VERSION,
        generatedAt: new Date().toISOString(),
        assets: merged.assets,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

process.stdout.write(
  `OK   ${String(encoded.length)} clip(s) into ${storeDir}, ` +
    `${String(merged.assets.length)} manifest row(s)` +
    (unchanged ? ' (unchanged)' : '') +
    `\n`,
);
