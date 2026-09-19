/**
 * Data-set references: no dangling prefab references in the dungeon data,
 * and environment names that stay paired between the code literals, the
 * dungeon mapping and the data set.
 *
 * Deutsch: Verweise zwischen den Datendateien und Umgebungsnamen zwischen
 * Code-Literalen, Dungeon-Zuordnung und Datensatz. Beides fällt bei einem
 * Fehler still um, nicht laut — deshalb hier die Wache.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * 1. Room furnishing (`roomPiecesData.json`) is looked up by room name and
 *    returns an EMPTY furnishing for an unknown name; door and furnishing
 *    prefabs are looked up by name in `prefabData.json`. A prefab removed
 *    from one file and left in another shows up nowhere — until a dungeon
 *    is materialised. `randomSpawns[].childViews` are INDICES into the
 *    room's `netViews`, so removing a net view without remapping them
 *    silently points them at a neighbour.
 * 2. `environment.ts` looks an environment up by name (`byName.get`) and,
 *    when the name is missing from `envData.json`, silently keeps the
 *    hand-tuned values (and appends the data record as a second, same-named
 *    weather). A half-done rename therefore changes the look without a
 *    single error. This test forces literal, dungeon mapping and data set
 *    to move together.
 *
 * Removed names are pinned by HASH, not spelled out, so the test does not
 * reintroduce the strings it guards against.
 *
 * Run: npx tsx shared/test/daten-verweise.ts   (from the repo root)
 */

import { getStableHash } from '../src/hash.js';
import * as environmentModule from '../src/environment.js';
import { ENVIRONMENTS, findEnvironment } from '../src/environment.js';
import { DUNGEONS, interiorEnvironment } from '../src/dungeons.js';
import envData from '../src/envData.json';
import prefabData from '../src/prefabData.json';
import roomPiecesData from '../src/roomPiecesData.json';
import dungeonsData from '../src/dungeonsData.json';

let fehler = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    fehler++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** First `n` entries of a list, for readable failure details. */
const zeige = (liste: readonly unknown[], n = 4): string =>
  liste.slice(0, n).map((x) => String(x)).join('; ') + (liste.length > n ? ` … (+${liste.length - n})` : '');

// ── 1. Dungeon data: no dangling references ─────────────────────────────

/** Prefab hashes removed from the data (two door prefabs of the sunken-crypt kit). */
const ENTFERNTE_PREFAB_HASHES: readonly number[] = [-647334815, 1631935371];
/** Hash of the environment name removed in favour of a neutral one. */
const ENTFERNTER_UMGEBUNGS_HASH = -1917477233;

interface NetView {
  prefabName: string;
  prefabHash: number;
}
interface RoomEntry {
  netViews: NetView[];
  randomSpawns: { childViews: number[] }[];
}
interface DungeonEntry {
  name: string;
  doorTypes: { prefabName: string; prefabHash: number }[];
  rooms: { name: string }[];
}

const RAEUME = roomPiecesData.rooms as unknown as Record<string, RoomEntry>;
const KITS = dungeonsData.dungeons as unknown as DungeonEntry[];
const PREFAB_NAMEN = new Set((prefabData.prefabs as { name: string }[]).map((p) => p.name));

function abschnittVerweise(): void {
  console.log('\n1. Dungeon data references');

  const netViews = Object.values(RAEUME).flatMap((r) => r.netViews);
  const tueren = KITS.flatMap((k) => k.doorTypes);

  const namenOhneDef: string[] = [];
  for (const [raum, r] of Object.entries(RAEUME)) {
    for (const v of r.netViews) if (!PREFAB_NAMEN.has(v.prefabName)) namenOhneDef.push(`${raum} → ${v.prefabName}`);
  }
  check(
    'every net view of every room names a prefab that prefabData.json defines',
    namenOhneDef.length === 0,
    `${netViews.length} net views, ${namenOhneDef.length} dangling${namenOhneDef.length ? `: ${zeige(namenOhneDef)}` : ''}`
  );

  const tuerenOhneDef = KITS.flatMap((k) =>
    k.doorTypes.filter((t) => !PREFAB_NAMEN.has(t.prefabName)).map((t) => `${k.name} → ${t.prefabName}`)
  );
  check(
    'every door type of every kit names a prefab that prefabData.json defines',
    tuerenOhneDef.length === 0,
    `${tueren.length} door types, ${tuerenOhneDef.length} dangling${tuerenOhneDef.length ? `: ${zeige(tuerenOhneDef)}` : ''}`
  );

  const hashAbweichung = [...netViews, ...tueren].filter((v) => v.prefabHash !== getStableHash(v.prefabName));
  check(
    'stored prefab hashes equal the stable hash of the prefab name',
    hashAbweichung.length === 0,
    `${netViews.length + tueren.length} references, ${hashAbweichung.length} differ`
  );

  const ohneRaumEintrag = KITS.flatMap((k) => k.rooms.filter((r) => !(r.name in RAEUME)).map((r) => `${k.name} → ${r.name}`));
  check(
    'every room of a parsed kit has a furnishing entry (else it silently stays empty)',
    ohneRaumEintrag.length === 0,
    `${KITS.reduce((n, k) => n + k.rooms.length, 0)} rooms, ${ohneRaumEintrag.length} without${ohneRaumEintrag.length ? `: ${zeige(ohneRaumEintrag)}` : ''}`
  );

  const ausserhalb: string[] = [];
  let gruppen = 0;
  for (const [raum, r] of Object.entries(RAEUME)) {
    for (const s of r.randomSpawns) {
      gruppen++;
      for (const i of s.childViews) {
        if (!Number.isInteger(i) || i < 0 || i >= r.netViews.length) ausserhalb.push(`${raum}: ${i} of ${r.netViews.length}`);
      }
    }
  }
  check(
    'every randomSpawns.childViews index points at an existing net view of its room',
    ausserhalb.length === 0,
    `${gruppen} groups, ${ausserhalb.length} out of range${ausserhalb.length ? `: ${zeige(ausserhalb)}` : ''}`
  );

  // Removed prefabs: by hash, in every place a hash or a name can sit.
  const verbliebene: string[] = [];
  for (const h of ENTFERNTE_PREFAB_HASHES) {
    for (const p of prefabData.prefabs as { name: string; oldHash: number }[]) {
      if (p.oldHash === h || getStableHash(p.name) === h) verbliebene.push(`prefabData: ${p.name}`);
    }
    for (const [raum, r] of Object.entries(RAEUME)) {
      for (const v of r.netViews) if (v.prefabHash === h || getStableHash(v.prefabName) === h) verbliebene.push(`${raum}: ${v.prefabName}`);
    }
    for (const k of KITS) {
      for (const t of k.doorTypes) if (t.prefabHash === h || getStableHash(t.prefabName) === h) verbliebene.push(`${k.name}: ${t.prefabName}`);
    }
  }
  check(
    'the two removed door prefabs are gone from prefab, room and kit data',
    verbliebene.length === 0,
    verbliebene.length ? zeige(verbliebene) : `${ENTFERNTE_PREFAB_HASHES.length} hashes, 0 left`
  );

  const sunken = KITS.find((k) => k.name === 'DG_SunkenCrypt');
  check(
    'the kit that carried the door still exists, now without door types',
    sunken !== undefined && sunken.doorTypes.length === 0,
    sunken ? `${sunken.rooms.length} rooms, ${sunken.doorTypes.length} door types` : 'kit missing'
  );
}

// ── 2. Environment names: literal ↔ dungeon mapping ↔ data set ───────────

/**
 * Pre-existing drift, NOT fixed here: fixing it would change the look
 * (the hand-tuned values would be replaced by data values). These two
 * literals name weathers the data set does not carry under that name, so
 * their biome weather gets no data overlay. Named exceptions: the test
 * fails when one of them starts existing in the data set, so the entry
 * cannot rot.
 *   ENV_ASH_RAIN = 'Ashrain'          data set: Ashlands_ashrain
 *   ENV_MISTLANDS = 'Mistlands_dark'  data set: Mistlands_clear / _rain / _thunder
 */
const BEKANNTE_DRIFT: ReadonlySet<string> = new Set(['ENV_ASH_RAIN', 'ENV_MISTLANDS']);

/**
 * Hand-tuned weathers that live only in `environment.ts` by design (their
 * source comments say so); they must exist in ENVIRONMENTS but not in the
 * data set.
 */
const NUR_IM_CODE: ReadonlySet<string> = new Set(['ENV_KLAR_COMIC', 'ENV_VILLAGE']);

function abschnittUmgebungen(): void {
  console.log('\n2. Environment names');

  const datensatz = new Set((envData.environments as { name: string }[]).map((e) => e.name));
  const literale = Object.entries(environmentModule as Record<string, unknown>).filter(
    (e): e is [string, string] => e[0].startsWith('ENV_') && typeof e[1] === 'string'
  );
  check('the ENV_* literals are found (test is not vacuous)', literale.length >= 10, `${literale.length} literals`);

  const gepaart = literale.filter(([k]) => !BEKANNTE_DRIFT.has(k) && !NUR_IM_CODE.has(k));
  const fehlend = gepaart.filter(([, v]) => !datensatz.has(v));
  check(
    'every ENV_* literal exists in envData.json (named exceptions aside)',
    fehlend.length === 0,
    `${gepaart.length} checked${fehlend.length ? `; missing: ${zeige(fehlend.map(([k, v]) => `${k}='${v}'`))}` : ''}`
  );

  const literalWerte = new Map(literale);
  for (const k of BEKANNTE_DRIFT) {
    const v = literalWerte.get(k);
    check(
      `named drift ${k} is still drift (absent from envData.json, present in ENVIRONMENTS)`,
      v !== undefined && !datensatz.has(v) && findEnvironment(v) !== undefined,
      v === undefined ? 'literal missing' : `'${v}'`
    );
  }
  for (const k of NUR_IM_CODE) {
    const v = literalWerte.get(k);
    check(
      `code-only weather ${k} exists in ENVIRONMENTS and not in envData.json`,
      v !== undefined && !datensatz.has(v) && findEnvironment(v) !== undefined,
      v === undefined ? 'literal missing' : `'${v}'`
    );
  }

  const kitNamen = DUNGEONS.map((d) => d.name);
  const ohneDaten = kitNamen.map((n) => [n, interiorEnvironment(n)] as const).filter(([, env]) => !datensatz.has(env));
  check(
    'the interior environment of every dungeon kit exists in envData.json',
    ohneDaten.length === 0,
    `${kitNamen.length} kits${ohneDaten.length ? `; missing: ${zeige(ohneDaten.map(([n, e]) => `${n} → ${e}`))}` : ''}`
  );

  const biomeRefs = (envData.biomes as { environments: { environment: string }[] }[]).flatMap((b) =>
    b.environments.map((e) => e.environment)
  );
  const biomeOhne = biomeRefs.filter((n) => !datensatz.has(n));
  check(
    'every weather named in the biome tables of envData.json exists there',
    biomeOhne.length === 0,
    `${biomeRefs.length} references${biomeOhne.length ? `; missing: ${zeige(biomeOhne)}` : ''}`
  );

  const gleichnamig = new Map<string, number>();
  for (const e of ENVIRONMENTS) gleichnamig.set(e.name, (gleichnamig.get(e.name) ?? 0) + 1);
  const doppelt = [...gleichnamig].filter(([, n]) => n > 1).map(([name]) => name);
  check(
    'no two weathers in ENVIRONMENTS share a name (a half-done rename appends a second one)',
    doppelt.length === 0,
    doppelt.length ? zeige(doppelt) : `${ENVIRONMENTS.length} weathers`
  );

  check(
    'the removed environment name is gone from ENVIRONMENTS and envData.json',
    !ENVIRONMENTS.some((e) => getStableHash(e.name) === ENTFERNTER_UMGEBUNGS_HASH) &&
      ![...datensatz].some((n) => getStableHash(n) === ENTFERNTER_UMGEBUNGS_HASH)
  );

  const kopfFelder = Object.keys(envData).sort().join(',');
  check(
    'envData.json carries no source-path metadata (only comment, count, environments, biomes, timing)',
    kopfFelder === 'biomes,comment,count,environments,timing',
    kopfFelder
  );
}

abschnittVerweise();
abschnittUmgebungen();

console.log(fehler === 0 ? '\nall checks passed' : `\n${fehler} check(s) failed`);
process.exit(fehler === 0 ? 0 : 1);
