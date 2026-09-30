/**
 * Loot tables: the numbers are frozen, and the two old faults are closed (card "Folgen Tod und Beute").
 *
 * No server, no port. `server/src/spiel/Beute.ts` holds the tables and the dice; the tables are not exported,
 * so the test reads them through the dice with SCRIPTED random values:
 *  [1] KREATUR_DROPS: per creature and row the item, min, max and chance. A row is found by failing the rows
 *      before it (random above their chance) and passing it (random = chance, exactly on the limit; chance
 *      + 1e-9 must fail); the amount by random 0 (= min) and 1 - 1e-12 (= max). Rows behind a chance-1 row
 *      cannot be reached; the test lists them as such (Greydwarf, Deer: a balance fact, not changed here).
 *  [2] TRUHEN: per chest pattern all rows (item, min, max), read the same way through the row index.
 *  [3] pickableItem: every pickable prefab that the spawn and scatter data name (vegetation, feature pieces,
 *      features) gives the frozen item; BlueberryBush gives Blueberries (it gave Raspberry before).
 *  [4] wuerfleTruhe('') and other names that match no pattern give an empty loot, never a throw.
 *
 * Run: npx tsx server/test/beute-daten.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PREFAB_DEFS, PrefabFlag, findItem } from '@wov/shared';
import { pickableItem, wuerfleDrop, wuerfleTruhe, ZWEIT_DROPS } from '../src/spiel/Beute.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const echtesRandom = Math.random;
/** Runs `f` with Math.random answering `werte` in order; more calls than values is an error (counts as a finding). */
function mitWerten<T>(werte: number[], f: () => T): { ergebnis: T; verbraucht: number } {
  let i = 0;
  Math.random = () => {
    if (i >= werte.length) throw new Error(`more random calls than the ${werte.length} scripted values`);
    return werte[i++]!;
  };
  try {
    return { ergebnis: f(), verbraucht: i };
  } finally {
    Math.random = echtesRandom;
  }
}
const OBEN = 1 - 1e-12;

// ── [1] KREATUR_DROPS ────────────────────────────────────────────────
type Zeile = [item: string, min: number, max: number, chance: number];
/** The frozen table (same numbers as KREATUR_DROPS in Beute.ts). */
const DROPS: Record<string, Zeile[]> = {
  Eikthyr: [['HardAntler', 3, 3, 1]],
  Greyling: [['Resin', 1, 1, 1]],
  Greydwarf: [['Wood', 1, 2, 1], ['Resin', 1, 1, 0.5], ['Stone', 1, 1, 0.5]],
  Boar: [['RawMeat', 1, 2, 1]],
  Deer: [['RawMeat', 1, 2, 1], ['TrophyDeer', 1, 1, 0.5]],
  Kuh: [['RawMeat', 2, 3, 1]],
  Wolf: [['RawMeat', 1, 2, 1]],
  Huhn: [['RawMeat', 1, 1, 1]],
  Neck: [['NeckTail', 1, 1, 0.75]],
  Skeleton: [['Coins', 2, 5, 0.6]],
  Draugr: [['Entrails', 1, 2, 1]],
};
/** Rows that no dice roll reaches: a row with chance 1 before them always wins. */
const UNERREICHBAR: Record<string, number[]> = { Greydwarf: [1, 2], Deer: [1] };

function drop(k: string, werte: number[]): { name: string; amount: number } | null {
  return mitWerten(werte, () => wuerfleDrop(k)).ergebnis;
}

console.log('\n[1] KREATUR_DROPS read through the dice');
for (const [kreatur, zeilen] of Object.entries(DROPS)) {
  const unerreichbar = UNERREICHBAR[kreatur] ?? [];
  zeilen.forEach(([item, min, max, chance], j) => {
    // rows before j fail: random above their chance (a chance-1 row cannot fail: then row j is unreachable)
    const davor = zeilen.slice(0, j).map((z) => (z[3] >= 1 ? 0 : Math.min(OBEN, z[3] + 1e-9)));
    if (unerreichbar.includes(j)) {
      const r = drop(kreatur, [...davor, 0, 0]);
      check(`${kreatur} row ${j} (${item}) is unreachable: a chance-1 row before it wins`, r !== null && r.name !== item, JSON.stringify(r));
      return;
    }
    const auf = mitWerten([...davor, chance, 0], () => wuerfleDrop(kreatur));
    check(`${kreatur} row ${j}: ${item} at random = chance ${chance}, min ${min}`,
      auf.ergebnis?.name === item && auf.ergebnis.amount === min && auf.verbraucht === j + 2, JSON.stringify(auf.ergebnis));
    const oben = drop(kreatur, [...davor, chance, OBEN]);
    check(`${kreatur} row ${j}: max ${max}`, oben?.name === item && oben.amount === max, JSON.stringify(oben));
    if (chance < 1) {
      // just above the chance the row fails; the rest of the rows all fail too (or none is left) -> no drop
      const rest = zeilen.slice(j + 1).map((z) => (z[3] >= 1 ? 0 : Math.min(OBEN, z[3] + 1e-9)));
      const aus = drop(kreatur, [...davor, chance + 1e-9, ...rest, 0]);
      check(`${kreatur} row ${j}: chance ${chance} is the limit (random just above it fails the row)`, aus === null || aus.name !== item, JSON.stringify(aus));
    }
  });
}
check('a creature without a table drops nothing (Coins, "", huhn, "Huhn ")',
  ['Coins', '', 'huhn', 'Huhn '].every((k) => drop(k, [0, 0, 0]) === null));

// the second drop with a fixed chance (trophies): paid out in WovServer.ts through ZWEIT_DROPS
{
  const zw = Object.entries(ZWEIT_DROPS);
  check('ZWEIT_DROPS is frozen: exactly Eikthyr -> TrophyEikthyr x1', zw.length === 1 && zw[0]![0] === 'Eikthyr'
    && zw[0]![1][0] === 'TrophyEikthyr' && zw[0]![1][1] === 1, JSON.stringify(ZWEIT_DROPS));
  check('the trophy item exists', findItem('TrophyEikthyr') !== undefined);
}

// ── [2] TRUHEN ───────────────────────────────────────────────────────
console.log('\n[2] TRUHEN read through the dice');
const TRUHEN: Array<[name: string, zeilen: Array<[string, number, number]>]> = [
  ['TreasureChest_forestcrypt', [['Coins', 5, 20], ['Amber', 1, 3], ['Flint', 2, 4]]],
  ['TreasureChest_sunkencrypt', [['Coins', 10, 30], ['Amber', 2, 4], ['Entrails', 1, 2]]],
  ['TreasureChest_trollcave', [['Coins', 10, 30], ['Amber', 1, 4], ['Wood', 5, 10]]],
  ['TreasureChest_mountaincave', [['Coins', 10, 25], ['Amber', 2, 5]]],
  ['piece_chest_wood', [['Coins', 2, 10], ['Flint', 1, 3], ['Wood', 3, 8], ['Raspberry', 3, 6]]],
  ['x', [['Coins', 2, 10], ['Flint', 1, 3], ['Wood', 3, 8], ['Raspberry', 3, 6]]],
];
for (const [prefab, zeilen] of TRUHEN) {
  zeilen.forEach(([item, min, max], i) => {
    const wahl = (i + 0.5) / zeilen.length; // the middle of the row's slice
    const unten = mitWerten([wahl, 0], () => wuerfleTruhe(prefab));
    const oben = mitWerten([wahl, OBEN], () => wuerfleTruhe(prefab)).ergebnis;
    check(`${prefab} row ${i}: ${item} ${min}..${max}`,
      unten.ergebnis.name === item && unten.ergebnis.amount === min && oben.name === item && oben.amount === max && unten.verbraucht === 2,
      `${JSON.stringify(unten.ergebnis)} / ${JSON.stringify(oben)}`);
  });
  const zuViel = mitWerten([OBEN, 0], () => wuerfleTruhe(prefab)).ergebnis;
  check(`${prefab}: the highest random value picks the last row, not one past it`, zuViel.name === zeilen[zeilen.length - 1]![0], JSON.stringify(zuViel));
}
// the first matching pattern wins
{
  const r = mitWerten([0, 0], () => wuerfleTruhe('forestcrypt_sunkencrypt_trollcave')).ergebnis;
  check('a name that matches several patterns takes the first pattern (forestcrypt: Coins 5)', r.name === 'Coins' && r.amount === 5, JSON.stringify(r));
}

// ── [3] pickableItem ─────────────────────────────────────────────────
console.log('\n[3] pickableItem for every pickable prefab of the spawn and scatter data');
const PFLUECKBAR = PrefabFlag.PICKABLE | PrefabFlag.PICKABLE_ITEM | PrefabFlag.ITEM_DROP;
const daten = new Set<string>();
const sammle = (v: unknown): void => {
  if (typeof v === 'string') daten.add(v);
  else if (Array.isArray(v)) v.forEach(sammle);
  else if (v && typeof v === 'object') Object.values(v).forEach(sammle);
};
for (const datei of ['featurePiecesData', 'vegetationData', 'featuresData']) {
  sammle(JSON.parse(readFileSync(resolve(import.meta.dirname, `../../shared/src/${datei}.json`), 'utf8')));
}
const namen = PREFAB_DEFS.filter((d) => (d.flags & PFLUECKBAR) !== 0n && daten.has(d.name)).map((d) => d.name).sort();
/**
 * The frozen answer per prefab. What is not a real item (`findItem` unknown) falls back to the prefab name, as
 * before: the pickup then hands out nothing, but the object is gone (not changed here).
 * The only changed line of this card: BlueberryBush -> Blueberries (was Raspberry).
 */
const ERWARTET: Array<[string, string]> = [
  ['BlueberryBush', 'Blueberries'],
  ['CloudberryBush', 'Raspberry'],
  ['Pickable_Ashstone', 'Pickable_Ashstone'],
  ['Pickable_Branch', 'Wood'],
  ['Pickable_Charredskull', 'Pickable_Charredskull'],
  ['Pickable_Dandelion', 'Dandelion'],
  ['Pickable_DolmenTreasure', 'Pickable_DolmenTreasure'],
  ['Pickable_DragonEgg', 'Pickable_DragonEgg'],
  ['Pickable_DvergrLantern', 'Pickable_DvergrLantern'],
  ['Pickable_DvergrStein', 'Pickable_DvergrStein'],
  ['Pickable_Fiddlehead', 'Pickable_Fiddlehead'],
  ['Pickable_Flint', 'Flint'],
  ['Pickable_ForestCryptRandom', 'Pickable_ForestCryptRandom'],
  ['Pickable_ForestCryptRemains01', 'Pickable_ForestCryptRemains01'],
  ['Pickable_ForestCryptRemains02', 'Pickable_ForestCryptRemains02'],
  ['Pickable_ForestCryptRemains03', 'Pickable_ForestCryptRemains03'],
  ['Pickable_MeatPile', 'Pickable_MeatPile'],
  ['Pickable_MoltenCoreStand', 'Pickable_MoltenCoreStand'],
  ['Pickable_MountainRemains01_buried', 'Pickable_MountainRemains01_buried'],
  ['Pickable_Mushroom', 'Mushroom'],
  ['Pickable_Mushroom_JotunPuffs', 'Mushroom'],
  ['Pickable_Mushroom_Magecap', 'Mushroom'],
  ['Pickable_Mushroom_yellow', 'Mushroom'],
  ['Pickable_Pot_Shard', 'Pickable_Pot_Shard'],
  ['Pickable_SeedCarrot', 'Carrot'],
  ['Pickable_SeedTurnip', 'Pickable_SeedTurnip'],
  ['Pickable_SmokePuff', 'Pickable_SmokePuff'],
  ['Pickable_Stone', 'Stone'],
  ['Pickable_StoneRock', 'Stone'],
  ['Pickable_SulfurRock', 'Pickable_SulfurRock'],
  ['Pickable_Swordpiece2', 'Pickable_Swordpiece2'],
  ['Pickable_Swordpiece3', 'Pickable_Swordpiece3'],
  ['Pickable_Tar', 'Pickable_Tar'],
  ['Pickable_TarBig', 'Pickable_TarBig'],
  ['Pickable_Thistle', 'Thistle'],
  ['Pickable_VoltureEgg', 'Pickable_VoltureEgg'],
  ['RaspberryBush', 'Raspberry'],
  ['VineAsh', 'VineAsh'],
  ['goblin_totempole', 'goblin_totempole'],
];
check(`the data name exactly the ${ERWARTET.length} frozen pickable prefabs (a new one must be added here)`,
  namen.join(',') === ERWARTET.map((e) => e[0]).join(','), `${namen.length} found: ${namen.filter((n) => !ERWARTET.some((e) => e[0] === n)).join(',')}`);
for (const [prefab, item] of ERWARTET) {
  const r = pickableItem(prefab);
  check(`${prefab} -> ${item} x1`, r?.name === item && r.amount === 1, JSON.stringify(r));
}
check('blueberries: BlueberryBush gives the item Blueberries, and that item exists', pickableItem('BlueberryBush')?.name === 'Blueberries' && findItem('Blueberries') !== undefined);
check('raspberries stay raspberries: RaspberryBush gives Raspberry, and that item exists', pickableItem('RaspberryBush')?.name === 'Raspberry' && findItem('Raspberry') !== undefined);
check('a blueberry name in any case or with a suffix gives Blueberries, a raspberry one Raspberry',
  ['blueberrybush', 'BLUEBERRYBUSH', 'Pickable_Blueberry_2'].every((n) => pickableItem(n)?.name === 'Blueberries')
  && ['raspberrybush', 'Pickable_Raspberry_2'].every((n) => pickableItem(n)?.name === 'Raspberry'));

// ── [4] no throw for a chest without a name ──────────────────────────
console.log('\n[4] wuerfleTruhe never throws: no pattern, no loot');
for (const name of ['', '\n', 'a\nb']) {
  let r: { name: string; amount: number } | null = null;
  let wirft = '';
  const zaehler = mitWerten([0, 0, 0, 0], () => {
    try { r = wuerfleTruhe(name); } catch (e) { wirft = String(e); }
  });
  check(`wuerfleTruhe(${JSON.stringify(name)}) does not throw`, wirft === '', wirft);
  if (name === '' || name === '\n') {
    check(`wuerfleTruhe(${JSON.stringify(name)}) is an empty loot (name '', amount 0) and rolls no dice`,
      r !== null && (r as { name: string }).name === '' && (r as { amount: number }).amount === 0 && zaehler.verbraucht === 0, JSON.stringify(r));
    check(`the empty loot is no item: findItem('') is unknown, so the chest stays empty`, findItem('') === undefined);
  }
}
{
  const r = mitWerten([0, 0], () => wuerfleTruhe('UnbekanntesPrefab_42')).ergebnis;
  check('an unknown but non-empty name takes the base row (Coins 2, as before)', r.name === 'Coins' && r.amount === 2, JSON.stringify(r));
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
