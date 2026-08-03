/**
 * dump-envsetup — extract Valheim's real EnvSetup lighting values.
 *
 * shared/src/environment.ts reproduces Valheim's EnvSetup/EnvMan STRUCTURE
 * and TIMING from verified sources, but its colour numbers are hand-tuned
 * approximations. This tool replaces them with ground truth from the local
 * AssetRipper export — the same route that produced the verified clutter
 * table (zonesystem_typetree.json / clutter_render_info.json).
 *
 *   node tools/dump-envsetup.mjs <export-dir> [--out shared/src/envData.json]
 *
 * <export-dir> is anything containing the exported EnvSetup assets, e.g.
 *   tools/assetripper/export/ExportedProject/Assets
 * Point it as deep as you like; the whole tree is walked.
 *
 * EnvSetup objects are Unity ScriptableObjects, so AssetRipper writes them
 * either as Unity YAML (`.asset`) or as JSON, depending on export settings,
 * and it may or may not keep Unity's `m_` field prefix. The parser below is
 * deliberately shape-tolerant rather than assuming one layout: it locates
 * each field by name (case-insensitive, `m_` optional) and accepts both a
 * bare number and an {r,g,b} triple. Run with --verbose to see exactly
 * which files matched and which fields were missing.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const COLOR_FIELDS = [
  'fogColorMorning', 'fogColorDay', 'fogColorEvening', 'fogColorNight',
  'fogColorSunMorning', 'fogColorSunDay', 'fogColorSunEvening', 'fogColorSunNight',
  'sunColorMorning', 'sunColorDay', 'sunColorEvening', 'sunColorNight',
  'ambColorDay', 'ambColorNight',
];
const FLOAT_FIELDS = [
  'fogDensityMorning', 'fogDensityDay', 'fogDensityEvening', 'fogDensityNight',
  'lightIntensityDay', 'lightIntensityNight', 'sunAngle',
  // Wind: EnvMan.UpdateWind lerps the gust strength between these two per
  // weather, so they are what makes a storm feel different from a clear day.
  'windMin', 'windMax',
  'rainCloudAlpha',
];
const BOOL_FIELDS = [
  'alwaysDark',
  // Wet/cold drive precipitation and (later) the freezing debuff.
  'isWet', 'isCold', 'isColdAtNight', 'isFreezing', 'isFreezingAtNight',
];

/** Marker fields: a file needs these to count as an EnvSetup. */
const MARKERS = ['fogColorDay', 'ambColorDay', 'sunColorDay'];

const SCAN_EXT = /\.(asset|yaml|yml|json|txt|prefab)$/i;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // unreadable dir — skip, don't abort the whole scan
  }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(path, out);
    else if (SCAN_EXT.test(name) && st.size < 4_000_000) out.push(path);
  }
  return out;
}

/** `m_FogColorDay` / `fogColorDay` / `"FogColorDay"` → one regex per field. */
function fieldPattern(field) {
  // allow an optional m_ prefix and any casing of the first character
  return new RegExp(`["']?(?:m_)?${field}["']?\\s*[:=]\\s*`, 'i');
}

function findValueAfter(text, field) {
  const m = fieldPattern(field).exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length, m.index + m[0].length + 400);
}

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

function parseColor(text, field) {
  const tail = findValueAfter(text, field);
  if (tail === null) return null;
  // {r: 0.1, g: 0.2, b: 0.3, a: 1}  |  {"R":0.1,"G":0.2,"B":0.3}
  const rgb = new RegExp(
    `\\{[^}]*?\\br["']?\\s*[:=]\\s*(${NUM})[^}]*?\\bg["']?\\s*[:=]\\s*(${NUM})[^}]*?\\bb["']?\\s*[:=]\\s*(${NUM})`,
    'i'
  ).exec(tail);
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  }
  // bare array form: [0.1, 0.2, 0.3]
  const arr = new RegExp(`\\[\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})`).exec(tail);
  if (arr) return { r: +arr[1], g: +arr[2], b: +arr[3] };
  return null;
}

function parseFloat_(text, field) {
  const tail = findValueAfter(text, field);
  if (tail === null) return null;
  const m = new RegExp(`^\\s*(${NUM})`).exec(tail);
  return m ? +m[1] : null;
}

function parseBool(text, field) {
  const tail = findValueAfter(text, field);
  if (tail === null) return null;
  const m = /^\s*(true|false|1|0)/i.exec(tail);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === 'true' || v === '1';
}

function parseName(text, path) {
  const tail = findValueAfter(text, 'name');
  if (tail !== null) {
    const m = /^\s*["']?([^"'\r\n,}]+)/.exec(tail);
    if (m && m[1].trim()) return m[1].trim();
  }
  // fall back to the file name without extension
  return path.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '');
}

function extract(text, path) {
  for (const marker of MARKERS) {
    if (!fieldPattern(marker).test(text)) return null;
  }
  const env = { name: parseName(text, path) };
  const missing = [];
  for (const f of COLOR_FIELDS) {
    const v = parseColor(text, f);
    if (v) env[f] = v;
    else missing.push(f);
  }
  for (const f of FLOAT_FIELDS) {
    const v = parseFloat_(text, f);
    if (v !== null) env[f] = v;
    else missing.push(f);
  }
  for (const f of BOOL_FIELDS) {
    const v = parseBool(text, f);
    env[f] = v === null ? false : v;
  }
  return { env, missing };
}

// ── structured JSON path (EnvMan dumps) ─────────────────────────────
//
// The regex scanner above assumes ONE EnvSetup per file, which holds for
// AssetRipper's ScriptableObject exports. A raw EnvMan dump is the other
// shape: a single object carrying all 23 environments nested under
// m_environments, plus the biome weather tables and the timing constants.
// Feeding that to the regex scanner would smear fields across weathers —
// the first m_fogColorDay in the file would win for every one of them. So
// when a file parses as JSON and looks like an EnvMan, read it properly.

/** `m_windMin` → `windMin`, tolerating both spellings. */
function pick(obj, field) {
  const v = obj[`m_${field}`];
  return v === undefined ? obj[field] : v;
}

function colorFrom(v) {
  if (!v || typeof v !== 'object') return null;
  const { r, g, b } = v;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  return { r, g, b }; // alpha is carried in the dump but unused by EnvSetup
}

function envFromObject(o) {
  const name = pick(o, 'name');
  if (typeof name !== 'string' || !name) return null;
  const env = { name };
  for (const f of COLOR_FIELDS) {
    const c = colorFrom(pick(o, f));
    if (c) env[f] = c;
  }
  for (const f of FLOAT_FIELDS) {
    const v = pick(o, f);
    if (typeof v === 'number') env[f] = v;
  }
  for (const f of BOOL_FIELDS) {
    const v = pick(o, f);
    // Unity writes bools as 0/1 in these dumps.
    if (typeof v === 'boolean') env[f] = v;
    else if (typeof v === 'number') env[f] = v !== 0;
  }
  return env;
}

/** Biome weather tables — EnvMan.m_biomes, the input to SelectWeightedEnvironment. */
function biomesFromObject(root) {
  const list = pick(root, 'biomes');
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const b of list) {
    const entries = pick(b, 'environments');
    if (!Array.isArray(entries)) continue;
    const biome = pick(b, 'biome');
    if (typeof biome !== 'number') continue;
    out.push({
      biome,
      name: typeof pick(b, 'name') === 'string' ? pick(b, 'name') : String(biome),
      environments: entries
        .map((e) => ({
          environment: pick(e, 'environment'),
          weight: typeof pick(e, 'weight') === 'number' ? pick(e, 'weight') : 1,
          ashlandsOverride: !!pick(e, 'ashlandsOverride'),
          deepnorthOverride: !!pick(e, 'deepnorthOverride'),
        }))
        .filter((e) => typeof e.environment === 'string' && e.environment),
    });
  }
  return out.length ? out : null;
}

/** Timing constants. The C# field defaults are overridden in the prefab. */
function timingFromObject(root) {
  const out = {};
  for (const f of [
    'environmentDuration',
    'windPeriodDuration',
    'windTransitionDuration',
    // Weather cross-fade, and the slower fade of the wet look on top of it.
    'transitionDuration',
    'wetTransitionDuration',
    'dayLengthSec',
  ]) {
    const v = pick(root, f);
    if (typeof v === 'number') out[f] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Returns { envs, biomes, timing } for an EnvMan-shaped JSON, else null.
 */
function extractEnvMan(text) {
  if (!/^\s*\{/.test(text)) return null;
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const list = pick(root, 'environments');
  if (!Array.isArray(list) || list.length === 0) return null;
  const envs = list.map(envFromObject).filter(Boolean);
  if (envs.length === 0) return null;
  return { envs, biomes: biomesFromObject(root), timing: timingFromObject(root) };
}

// ── main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'shared/src/envData.json';
// Guard the outIdx < 0 case: `outIdx + 1` would be 0 and silently swallow
// the first positional argument, i.e. the export dir itself.
const roots = args.filter((a, i) => !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));

if (roots.length === 0) {
  console.error('usage: node tools/dump-envsetup.mjs <export-dir> [--out file] [--verbose]');
  console.error('  e.g. node tools/dump-envsetup.mjs tools/assetripper/export');
  process.exit(2);
}

const files = [];
for (const root of roots) {
  try {
    statSync(root);
  } catch {
    console.error(`[dump-envsetup] not found: ${root}`);
    process.exit(2);
  }
  walk(root, files);
}
console.log(`[dump-envsetup] scanning ${files.length} candidate files…`);

const found = [];
let partial = 0;
/** Biome tables / timing, from whichever EnvMan dump carried the most weathers. */
let envMan = null;
for (const path of files) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  // An EnvMan dump holds every weather at once — take that route first.
  const man = extractEnvMan(text);
  if (man) {
    if (!envMan || man.envs.length > envMan.envs.length) envMan = { ...man, path };
    for (const env of man.envs) {
      const missing = [...COLOR_FIELDS, ...FLOAT_FIELDS].filter((f) => !(f in env));
      found.push({ path, env, missing });
      if (missing.length) partial++;
      if (verbose) {
        console.log(
          `  ${missing.length ? 'PARTIAL' : 'OK     '} ${env.name.padEnd(22)} ${relative('.', path)} (EnvMan)` +
            (missing.length ? `\n            missing: ${missing.join(', ')}` : '')
        );
      }
    }
    continue;
  }
  const hit = extract(text, path);
  if (!hit) continue;
  found.push({ path, ...hit });
  if (hit.missing.length) partial++;
  if (verbose) {
    console.log(
      `  ${hit.missing.length ? 'PARTIAL' : 'OK     '} ${hit.env.name.padEnd(22)} ${relative('.', path)}` +
        (hit.missing.length ? `\n            missing: ${hit.missing.join(', ')}` : '')
    );
  }
}

if (found.length === 0) {
  console.error(
    '[dump-envsetup] no EnvSetup assets found.\n' +
      '  The scan needs files containing fogColorDay + ambColorDay + sunColorDay\n' +
      '  (with or without Unity\'s m_ prefix). Check that the AssetRipper export\n' +
      '  actually contains ScriptableObjects, and re-run with --verbose.'
  );
  process.exit(1);
}

// De-duplicate by name, preferring the most complete extraction.
const best = new Map();
for (const f of found) {
  const prev = best.get(f.env.name);
  if (!prev || f.missing.length < prev.missing.length) best.set(f.env.name, f);
}

const envs = [...best.values()]
  .sort((a, b) => a.env.name.localeCompare(b.env.name))
  .map((f) => f.env);

const payload = {
  comment:
    'Generated by tools/dump-envsetup.mjs from the local AssetRipper export. ' +
    'Ground truth for shared/src/environment.ts — do not hand-edit.',
  generatedFrom: roots,
  count: envs.length,
  environments: envs,
};
// Only an EnvMan dump carries these; a per-asset export leaves them out and
// environment.ts falls back to its own table.
if (envMan?.biomes) payload.biomes = envMan.biomes;
if (envMan?.timing) payload.timing = envMan.timing;
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(
  `[dump-envsetup] wrote ${envs.length} environments to ${outPath}` +
    (partial ? ` (${partial} file(s) had missing fields — re-run with --verbose)` : '')
);
console.log(`  names: ${envs.map((e) => e.name).join(', ')}`);
console.log(
  '\nNext: wire envData.json into shared/src/environment.ts (same pattern as\n' +
    'prefabData.json in prefabs.ts) so the extracted values override the\n' +
    'hand-tuned ENVIRONMENTS table.'
);
