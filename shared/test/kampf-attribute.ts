/**
 * Combat core K1: item attributes, formulas and the set value table (pure, no server).
 *
 * Proves, with numbers:
 *  1. WAFFEN_SCHADEN is gone: every weapon of the old table carries the SAME number as `stats.damage`
 *     (the old table is repeated here as a literal on purpose); everything else falls back to the fist (4).
 *  2. Without gear every formula returns the old value bit for bit (damage in, damage out, maximum health, swing cost).
 *  3. Each attribute does exactly what the formula says (armor K/(K+R) with the calibration point, minimum 1;
 *     strength; vitality; agility with its floor); the wolf bite (8) against bare / Plainhide / full class set.
 *  4. Set table: every equippable set part has values, no value row without a part, male == female (one row),
 *     full class set = armor 40 = K, main attribute 10, secondary 5, Plainhide = armor 8 and no primary values.
 *
 * Run: npx tsx shared/test/kampf-attribute.ts
 */
import {
  ITEM_DEFS, findItem, REGLER, KEINE_WERTE, FAUST_SCHADEN, STAT_IDS, RESERVIERTE_STAT_IDS,
  summiereWerte, eingehenderSchaden, ausgehenderNahkampfSchaden, lebensmaximum, schlagKosten, waffenSchaden,
  SET_WERTE, SET_TEILE, werteFuerRuestungsteil, type StatId,
} from '../src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const nah = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ── 1. Old weapon table == stats.damage ───────────────────────────
console.log('\n[1] WAFFEN_SCHADEN dissolved, same numbers');
const ALT: Record<string, number> = { '': 4, SwordNorth: 12, Staff: 10, Spear: 11, Club: 12, AxeFlint: 15, PickaxeAntler: 8, Hoe: 2, Cultivator: 2 };
for (const [name, alt] of Object.entries(ALT)) {
  const def = name === '' ? undefined : findItem(name);
  check(`${name || 'fist'}: ${alt}`, waffenSchaden(def?.stats) === alt, `now ${waffenSchaden(def?.stats)}`);
  if (name !== '') check(`${name} carries stats.damage`, def?.stats?.damage === alt);
}
check('fist constant is 4', FAUST_SCHADEN === 4);
const fremd = ITEM_DEFS.filter((d) => !(d.name in ALT));
check('every item outside the old table falls back to 4 (as `?? 4` did)', fremd.every((d) => d.stats?.damage === undefined && waffenSchaden(d.stats) === 4), `${fremd.length} items`);

// ── 2. Bit-identical without gear ─────────────────────────────────
console.log('\n[2] No gear = old numbers, bit for bit');
const ohne = summiereWerte([]);
check('sum of nothing is all zero', STAT_IDS.every((id) => ohne[id] === 0) && ohne.armor === KEINE_WERTE.armor);
check('parts without values add nothing', summiereWerte([undefined, {}]).armor === 0);
const schaeden = [0.5, 1, 4, 8, 12, 15, 33.3, 1000];
check('incoming damage unchanged (=== old `health - damage`)', schaeden.every((d) => eingehenderSchaden(d, ohne.armor) === d));
check('outgoing melee damage unchanged for every old weapon', Object.values(ALT).every((b) => ausgehenderNahkampfSchaden(b, ohne.strength) === b));
check('maximum health 100 (+ food) unchanged', [0, 10, 25].every((e) => lebensmaximum(ohne.vitality, e) === 100 + e));
check('swing cost 8 unchanged', schlagKosten(ohne.agility) === 8);
check('reserved id intellect is not an evaluated attribute', !(STAT_IDS as readonly string[]).includes('intellect') && RESERVIERTE_STAT_IDS[0] === 'intellect');

// ── 3. Formulas ───────────────────────────────────────────────────
console.log('\n[3] Formulas with numbers (K=40, s=0.01, v=2, a=0.02, floor 50 %)');
check('regler proposal', REGLER.K === 40 && REGLER.s === 0.01 && REGLER.v === 2 && REGLER.a === 0.02 && REGLER.schlagkostenUntergrenze === 0.5);
check('armor K halves: 8 -> 4', eingehenderSchaden(8, REGLER.K) === 4);
check('armor 8 (Plainhide): 8*40/48', nah(eingehenderSchaden(8, 8), 8 * 40 / 48), `${eingehenderSchaden(8, 8)}`);
check('armor 20: 8*40/60', nah(eingehenderSchaden(8, 20), 8 * 40 / 60));
check('diminishing: 80 armor -> 8*40/120, never 0', nah(eingehenderSchaden(8, 80), 8 * 40 / 120) && eingehenderSchaden(8, 1e9) >= 1);
check('minimum 1: blow of 3 with 400 armor -> 1', eingehenderSchaden(3, 400) === 1);
check('a different K really changes the result (regler is read)', nah(eingehenderSchaden(8, 40, { ...REGLER, K: 80 }), 8 * 80 / 120));
check('strength 10: 12 -> 13 (12*1.10=13.2, rounded)', ausgehenderNahkampfSchaden(12, 10) === 13);
check('strength 10: 15 -> 17 (16.5 rounds up)', ausgehenderNahkampfSchaden(15, 10) === 17);
check('strength 50: 12 -> 18', ausgehenderNahkampfSchaden(12, 50) === 18);
check('vitality 10: 100 + 20', lebensmaximum(10, 0) === 120 && lebensmaximum(10, 25) === 145);
check('agility 10: 8*(1-0.2) = 6.4', nah(schlagKosten(10), 6.4), `${schlagKosten(10)}`);
check('agility floor: 100 agility -> 4 (50 %)', schlagKosten(100) === 4 && schlagKosten(25) === 4);
check('agility 24 is just above the floor: 4.16', nah(schlagKosten(24), 4.16));

// ── 4. Set value table ────────────────────────────────────────────
console.log('\n[4] Set value table');
const zeilen = Object.entries(SET_WERTE).flatMap(([familie, teile]) => Object.keys(teile).map((key) => `${familie}/${key}`));
const teilAdressen = new Set(SET_TEILE.map((t) => `${t.familie}/${t.key}`));
check('every equippable set part has values', SET_TEILE.every((t) => werteFuerRuestungsteil(t.id) !== undefined), `${SET_TEILE.length} parts`);
check('no value row without a part', zeilen.every((z) => teilAdressen.has(z)), zeilen.filter((z) => !teilAdressen.has(z)).join(','));
check('every row belongs to a part (count)', zeilen.length === teilAdressen.size, `${zeilen.length} rows, ${teilAdressen.size} addresses`);
check('every item def of a set part carries the stats of its row',
  SET_TEILE.every((t) => findItem(t.item)?.stats === werteFuerRuestungsteil(t.id)));
const paare = SET_TEILE.filter((t) => t.id.includes('_male_'));
check('male and female parts share the very same values', paare.length > 0 && paare.every((m) => {
  const w = SET_TEILE.find((t) => t.id === m.id.replace('_male_', '_female_'));
  return !!w && werteFuerRuestungsteil(w.id) === werteFuerRuestungsteil(m.id);
}), `${paare.length} pairs`);
check('every value is a non-negative finite number of a known attribute', zeilen.every((z) => {
  const [f, k] = z.split('/') as [string, string];
  return Object.entries(SET_WERTE[f]![k]!).every(([id, v]) => (STAT_IDS as readonly string[]).includes(id) && Number.isFinite(v) && v >= 0);
}));
check('set parts carry no weapon damage', zeilen.every((z) => { const [f, k] = z.split('/') as [string, string]; return SET_WERTE[f]![k]!.damage === undefined; }));

const KLASSEN: Record<string, { haupt: StatId; neben: StatId }> = {
  ironward: { haupt: 'strength', neben: 'vitality' },
  wildwarden: { haupt: 'vitality', neben: 'agility' },
  ashenveil: { haupt: 'vitality', neben: 'strength' },
  seidraven: { haupt: 'vitality', neben: 'agility' },
  emberrage: { haupt: 'vitality', neben: 'strength' },
  gravethorn: { haupt: 'strength', neben: 'agility' },
  crowshade: { haupt: 'agility', neben: 'strength' },
};
function satz(familie: string, geschlecht?: 'male' | 'female') {
  return SET_TEILE.filter((t) => t.familie === familie && (geschlecht === undefined || t.id.includes(`_${geschlecht}_`)));
}
for (const [familie, { haupt, neben }] of Object.entries(KLASSEN)) {
  for (const g of familie === 'ironward' || familie === 'wildwarden' || familie === 'ashenveil' ? [undefined] : (['male', 'female'] as const)) {
    const summe = summiereWerte(satz(familie, g).map((t) => werteFuerRuestungsteil(t.id)));
    check(`${familie}${g ? ' ' + g : ''}: 7 parts, armor 40 = K, ${haupt} 10, ${neben} 5, nothing else`,
      satz(familie, g).length === 7 && summe.armor === REGLER.K && summe[haupt] === 10 && summe[neben] === 5
      && STAT_IDS.every((id) => [ 'armor', haupt, neben ].includes(id) || summe[id] === 0),
      JSON.stringify(summe));
  }
}
const plain = summiereWerte(satz('plainhide', 'male').map((t) => werteFuerRuestungsteil(t.id)));
check('Plainhide: 5 parts, armor 8, no primary attributes', satz('plainhide', 'male').length === 5 && plain.armor === 8 && plain.strength + plain.vitality + plain.agility === 0, JSON.stringify(plain));

// ── 5. Worked example: wolf bite 8 ────────────────────────────────
console.log('\n[5] Wolf bite 8: bare / Plainhide / full class set');
const klasse = summiereWerte(satz('ironward').map((t) => werteFuerRuestungsteil(t.id)));
const b = [eingehenderSchaden(8, ohne.armor), eingehenderSchaden(8, plain.armor), eingehenderSchaden(8, klasse.armor)];
console.log(`      ${b.map((x) => +x.toFixed(2)).join(' / ')}`);
check('8 / 6.67 / 4', b[0] === 8 && Math.abs(b[1]! - 6.67) < 0.005 && b[2] === 4);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
