/**
 * Holds the "toene" (audio) and "symbole" (UI images) sections of
 * `assets/manifest.json` (Bauer B1, 2026-09-28) against the real disk
 * inventory: every recording under `assets/store/audio/` and every image
 * under `assets/store/ui/` must have an entry, no entry may point at a
 * file that no longer exists, every entry carries its required fields,
 * and — for a sample of entries — the MEASURED VALUES (duration,
 * channels, sample rate, width, height) match a second, independent
 * read of the file header, not merely "some number is present".
 *
 * The value check reads Ogg/OpusHead and PNG/IHDR itself, from
 * scratch, instead of calling into `tools/asset-manifest.mjs` (Review
 * N1, 2026-09-29): a test that shares its measuring code with the
 * generator would agree with a wrong number for the same reason the
 * generator produced it — it would not catch a bug in that code, only
 * a bug in the DATA (a stale field, a bad merge, a hand-edited value).
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
 * Independent re-read of an Ogg/Opus file's technical data — duration
 * (seconds), channel count and sample rate — straight from the Ogg page
 * headers and the `OpusHead` packet (RFC 3533 / RFC 7845). Written fresh
 * for this test, not shared with `tools/asset-manifest.mjs`'s own
 * parser (see file header).
 */
function readOggOpus(path: string): { dauer: number; kanaele: string; abtastrate: number } {
  const buf = readFileSync(path);
  let offset = 0;
  let channels: number | null = null;
  let preSkip = 0;
  let sampleRate: number | null = null;
  let lastGranule = 0n;
  let pageIndex = 0;
  while (offset < buf.length) {
    if (buf.toString('ascii', offset, offset + 4) !== 'OggS') {
      throw new Error(`${path}: no Ogg page header at byte ${offset}`);
    }
    const granule = buf.readBigInt64LE(offset + 6);
    const segmentCount = buf.readUInt8(offset + 26);
    const segmentTable = buf.subarray(offset + 27, offset + 27 + segmentCount);
    let payloadLength = 0;
    for (const b of segmentTable) payloadLength += b;
    const payloadStart = offset + 27 + segmentCount;
    if (pageIndex === 0) {
      const head = buf.subarray(payloadStart, payloadStart + Math.min(19, payloadLength));
      if (head.toString('ascii', 0, 8) !== 'OpusHead') {
        throw new Error(`${path}: first Ogg page is not OpusHead`);
      }
      channels = head.readUInt8(9);
      preSkip = head.readUInt16LE(10);
      sampleRate = head.readUInt32LE(12);
    }
    lastGranule = granule;
    pageIndex++;
    offset = payloadStart + payloadLength;
  }
  if (channels === null || sampleRate === null) throw new Error(`${path}: no OpusHead found`);
  const dauer = Number(lastGranule - BigInt(preSkip)) / 48000;
  return {
    dauer,
    kanaele: channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels}-kanalig`,
    abtastrate: sampleRate,
  };
}

/** Independent re-read of a PNG's width/height from its IHDR chunk. */
function readPng(path: string): { breite: number; hoehe: number } {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${path}: no PNG signature or missing IHDR`);
  }
  return { breite: buf.readUInt32BE(16), hoehe: buf.readUInt32BE(20) };
}

/**
 * Sample a handful of entries per section and check their measured
 * values against the independent re-read above — not just "a number is
 * present" (that alone lets a corrupted value like `dauer: 0.001` pass
 * silently).
 */
function checkValues(name: string, dir: string, field: 'toene' | 'symbole', sampleStems: readonly string[]): void {
  const section = (manifest[field] ?? {}) as Record<string, Record<string, unknown>>;
  for (const stem of sampleStems) {
    const entry = section[stem];
    if (!entry) {
      check(`${name} value sample ${stem}: entry exists`, false, 'missing from manifest');
      continue;
    }
    const path = join(dir, entry.datei as string);
    if (field === 'toene') {
      const measured = readOggOpus(path);
      check(
        `${name} ${stem}: dauer matches an independent re-read`,
        Math.abs((entry.dauer as number) - measured.dauer) < 0.05,
        `manifest=${entry.dauer} reread=${measured.dauer.toFixed(3)}`
      );
      check(
        `${name} ${stem}: kanaele matches`,
        entry.kanaele === measured.kanaele,
        `manifest=${entry.kanaele} reread=${measured.kanaele}`
      );
      check(
        `${name} ${stem}: abtastrate matches`,
        entry.abtastrate === measured.abtastrate,
        `manifest=${entry.abtastrate} reread=${measured.abtastrate}`
      );
    } else {
      const measured = readPng(path);
      check(
        `${name} ${stem}: breite matches an independent re-read`,
        entry.breite === measured.breite,
        `manifest=${entry.breite} reread=${measured.breite}`
      );
      check(
        `${name} ${stem}: hoehe matches an independent re-read`,
        entry.hoehe === measured.hoehe,
        `manifest=${entry.hoehe} reread=${measured.hoehe}`
      );
    }
  }
}

/** Fields every entry of a section must carry (Bauer B1 N1, missing before). */
const REQUIRED_FIELDS: Record<'toene' | 'symbole', readonly string[]> = {
  toene: ['datei', 'bytes', 'hash', 'dauer', 'kanaele', 'abtastrate'],
  symbole: ['datei', 'bytes', 'hash', 'breite', 'hoehe'],
};

function checkRequiredFields(name: string, field: 'toene' | 'symbole'): void {
  const section = (manifest[field] ?? {}) as Record<string, Record<string, unknown>>;
  let incomplete = 0;
  for (const [stem, entry] of Object.entries(section)) {
    const missing = REQUIRED_FIELDS[field].filter((f) => !(f in entry));
    if (missing.length > 0) {
      incomplete++;
      console.error(`  ${stem}: missing field(s) ${missing.join(', ')}`);
    }
  }
  check(`${name}: every entry carries all required fields`, incomplete === 0, `${incomplete} incomplete`);
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

  checkRequiredFields(name, field);

  /*
    Sample five stems spread across the sorted disk listing (not just
    the first few, which would all sit in the same folder) — measured,
    not carried-over, entries only: a carried-over entry describes a
    file this machine does not have, so there is nothing here to
    re-read.
  */
  const measurable = diskFiles.map((f) => f.slice(0, -extension.length)).filter((s) => !carriedOverSet.has(s));
  const sample: string[] = [];
  for (let i = 0; i < 5 && i < measurable.length; i++) {
    sample.push(measurable[Math.floor((i * measurable.length) / 5)]!);
  }
  checkValues(name, dir, field, sample);
}

checkSection('Audio', AUDIO_DIR, '.ogg', 'toene');
checkSection('UI images', UI_DIR, '.png', 'symbole');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\n=== MANIFEST AUDIO/UI — COMPLETENESS: ALL PASSED ===');
process.exit(0);
