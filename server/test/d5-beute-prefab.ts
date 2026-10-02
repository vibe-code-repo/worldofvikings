/**
 * D5 (fault found on DEV 02.10.2026: loot is a placeholder box and E picks nothing up) — the server half and the
 * registry half of the fix, without assets:
 *  [1] Every item name that can end up on the ground (all of ITEM_DEFS, plus what the loot tables roll) gets a prefab with
 *      ITEM_DROP from `beutePrefabFuer`: its own prefab, or the neutral `BeuteStueck`.
 *  [2] `beuteDarstellung` of that prefab is a model on the list of own models, or the fallback chest, never "no model".
 *  [3] `BeuteAmBoden` lays the ZDO under exactly that prefab; the marker and the item stay as they were (the pick-up path knows loot by them).
 *  [4] An item with a prefab of its own keeps its own hash (RawMeat), an item without one (Messer, armour) gets the neutral hash.
 *
 * Run: npx tsx server/test/d5-beute-prefab.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BEUTE_PREFAB, BEUTE_RUECKFALL_MODELL, BEUTE_RUECKFALL_SKALA, EIGENE_MODELLE_SET, ITEM_DEFS, PrefabFlag,
  beuteDarstellung, beutePrefabFuer, findPrefabByHash, findPrefabByName, getStableHash,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { BEUTE_ITEM, BEUTE_MARKE, BeuteAmBoden } from '../src/spiel/BeuteAmBoden.js';
import { wuerfleDrop, wuerfleTruhe, ZWEIT_DROPS } from '../src/spiel/Beute.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  console.log(`  ${bedingung ? 'PASS' : 'FAIL'}  ${text}${detail ? ' — ' + detail : ''}`);
  if (!bedingung) fehler++;
};

// Names that can lie on the ground: every item (legeHin takes any item name) plus what the tables roll.
const namen = new Set<string>(ITEM_DEFS.map((i) => i.name));
const gewuerfelt = new Set<string>();
for (const k of ['Eikthyr', 'Greyling', 'Greydwarf', 'Boar', 'Deer', 'Kuh', 'Wolf', 'Huhn', 'Neck', 'Skeleton', 'Draugr']) {
  for (let i = 0; i < 400; i++) { const d = wuerfleDrop(k); if (d) gewuerfelt.add(d.name); }
}
for (const t of ['piece_chest_wood', 'forestcrypt_chest', 'sunkencrypt_chest', 'trollcave_chest', 'mountaincave_chest']) {
  for (let i = 0; i < 400; i++) { const d = wuerfleTruhe(t); if (d.name) gewuerfelt.add(d.name); }
}
for (const [n] of Object.values(ZWEIT_DROPS)) gewuerfelt.add(n);
pruefe(gewuerfelt.size >= 9, 'the loot tables roll at least 9 distinct names', [...gewuerfelt].join(','));
pruefe([...gewuerfelt].every((n) => namen.has(n)), 'every rolled name is an item', [...gewuerfelt].filter((n) => !namen.has(n)).join(','));

// [1] + [2]
let eigene = 0;
let neutrale = 0;
const schlecht: string[] = [];
for (const n of namen) {
  const p = beutePrefabFuer(n);
  const def = findPrefabByName(p);
  if (!def || (def.flags & PrefabFlag.ITEM_DROP) === 0n) { schlecht.push(`${n}: prefab ${p}`); continue; }
  if (p === BEUTE_PREFAB) neutrale++; else eigene++;
  const d = beuteDarstellung(def);
  const ok = EIGENE_MODELLE_SET.has(d.modell) && d.skala > 0 && d.skala <= 1;
  if (!ok) schlecht.push(`${n}: modell ${d.modell} x${d.skala}`);
}
pruefe(schlecht.length === 0, `all ${namen.size} item names resolve to an ITEM_DROP prefab and a listed model`, schlecht.slice(0, 5).join(' | '));
pruefe(eigene > 0 && neutrale > 0, 'both ways are used', `own prefab ${eigene}, neutral ${neutrale}`);
pruefe(BEUTE_RUECKFALL_MODELL === 'HolzTruhe' && EIGENE_MODELLE_SET.has('HolzTruhe'), 'the fallback model is the existing chest and is on the list');
pruefe(beuteDarstellung({ model: null }).modell === BEUTE_RUECKFALL_MODELL, 'a prefab without a model gets the fallback');
pruefe(BEUTE_RUECKFALL_SKALA >= 0.2 && BEUTE_RUECKFALL_SKALA <= 0.6 && beuteDarstellung({ model: null }).skala === BEUTE_RUECKFALL_SKALA, 'the fallback chest is drawn small (0.2 to 0.6 of its size)', String(BEUTE_RUECKFALL_SKALA));
pruefe(BEUTE_RUECKFALL_SKALA === 0.4 && beuteDarstellung({ model: null }).skala === 0.4, 'the fallback scale is 0.4, pinned to the value (a sight value, not a range)');
const neutralDef = findPrefabByName(BEUTE_PREFAB);
pruefe(neutralDef !== undefined && (neutralDef.flags & PrefabFlag.ITEM_DROP) !== 0n && (neutralDef.flags & PrefabFlag.PERSISTENT) === 0n, 'the neutral loot prefab is ITEM_DROP and NOT PERSISTENT (loot is never saved; the save mark is the second guard)');
pruefe(beuteDarstellung({ model: 'Wood' }).modell === BEUTE_RUECKFALL_MODELL, 'a model that is not on the list (Wood) gets the fallback');
pruefe(beuteDarstellung({ model: 'Messer' }).modell === 'Messer' && beuteDarstellung({ model: 'Messer' }).skala === 1, 'a listed own model is kept at scale 1');
pruefe(beutePrefabFuer('') === BEUTE_PREFAB && beutePrefabFuer('NichtDa') === BEUTE_PREFAB, 'empty and unknown names go neutral');
pruefe(beutePrefabFuer('Pickable_Flint') === BEUTE_PREFAB, 'a prefab that is not an ITEM_DROP (a pickable bush) is not used for loot');

// Z3 (N2): the model that is drawn really exists. The list of own models (`EIGENE_MODELLE_SET`) is the very list `beuteDarstellung`
// reads, so a test against it alone proves nothing about the file. `assets/manifest.json` is tracked and measured from the files
// (tools/asset-manifest.mjs, held against the disk by tools/test/manifest-vollstaendig.ts where the assets lie), so it is an
// independent witness that the CI has. The test against the files themselves stays in client/test/d5-beute-modelle.ts (assets).
interface ManifestModell { datei: string; huelle: { min: number[]; max: number[] }; breite: number; hoehe: number; tiefe: number }
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../assets/manifest.json'), 'utf8')) as { modelle: Record<string, ManifestModell | undefined> };
const imManifest = (modell: string): boolean => manifest.modelle[modell]?.datei === `${modell}.glb`;
const ohneDatei: string[] = [];
for (const n of namen) {
  const d = beuteDarstellung(findPrefabByName(beutePrefabFuer(n))!);
  if (!imManifest(d.modell)) ohneDatei.push(`${n} -> ${d.modell}`);
}
pruefe(ohneDatei.length === 0, `every model that loot of the ${namen.size} item names is drawn with has a measured file in the tracked manifest`, ohneDatei.slice(0, 5).join(' | '));
pruefe(imManifest(BEUTE_RUECKFALL_MODELL), 'the fallback model is in the manifest');
pruefe(!imManifest('GibtEsNicht') && !imManifest(''), 'control: a made-up model name is not in the manifest (the test can fail)');
// every prefab the server can lay loot under (own ITEM_DROP prefabs and the neutral one) resolves the same way
const dropNamen = new Set<string>([BEUTE_PREFAB, ...[...namen].map(beutePrefabFuer)]);
pruefe([...dropNamen].every((p) => { const def = findPrefabByName(p); return !!def && imManifest(beuteDarstellung(def).modell); }), `all ${dropNamen.size} loot prefabs resolve to a model with a file`, [...dropNamen].join(','));

// Z5 (N2): the scale 0.4 against the measured box of the chest (manifest value; the real file is measured in d5-beute-modelle.ts).
const truhe = manifest.modelle[BEUTE_RUECKFALL_MODELL]!;
pruefe(truhe.huelle.min[1] === 0, 'the chest has its origin on the floor (min y = 0)', String(truhe.huelle.min[1]));
pruefe(truhe.breite === 0.96 && truhe.hoehe === 0.605 && truhe.tiefe === 0.646, 'the chest box is 0.96 x 0.605 x 0.646 m (pinned: a new model file changes the scale question)', `${truhe.breite} x ${truhe.hoehe} x ${truhe.tiefe}`);
const skala = beuteDarstellung({ model: null }).skala;
pruefe(truhe.huelle.min[1] * skala >= -0.02, 'at the loot scale nothing sinks into the ground (min y x scale >= -0.02 m)', String(truhe.huelle.min[1] * skala));
const kante = Math.max(truhe.breite, truhe.hoehe, truhe.tiefe) * skala;
pruefe(kante >= 0.25 && kante <= 0.6, 'and the longest edge is between 0.25 and 0.6 m (seen, but no chest in the grass)', `${kante.toFixed(3)} m`);

// [3] + [4] with the real BeuteAmBoden on a real ZDOManager
const raum = new ZDOManager(1n);
const boden = new BeuteAmBoden();
const gelegt = boden.legeHin(raum, { x: 5, y: 1, z: 7 }, [
  { name: 'RawMeat', amount: 2 }, { name: 'Messer', amount: 1 }, { name: 'wildwarden_vest', amount: 1 }, { name: 'Coins', amount: 3 },
]);
pruefe(gelegt.length === 4 && boden.anzahlStuecke === 4, 'four pieces laid', `${gelegt.length}/${boden.anzahlStuecke}`);
const zdos = raum.getZDOByPrefab(getStableHash('RawMeat'));
pruefe(zdos.length === 1 && zdos[0]!.getString(BEUTE_ITEM) === 'RawMeat' && zdos[0]!.getInt(BEUTE_MARKE) === 1, 'RawMeat lies under its own prefab hash, marked as loot');
const neutral = raum.getZDOByPrefab(getStableHash(BEUTE_PREFAB));
pruefe(neutral.length === 2 && neutral.map((z) => z.getString(BEUTE_ITEM)).sort().join() === 'Messer,wildwarden_vest', 'Messer and the armour piece lie under the neutral prefab', neutral.map((z) => z.getString(BEUTE_ITEM)).join());
pruefe(neutral.every((z) => boden.istBeute(z) && boden.aufheben(z)?.amount === 1), 'the neutral pieces are loot and give their item on pick-up');
pruefe(neutral.every((z) => findPrefabByHash(z.prefabHash)?.name === BEUTE_PREFAB), 'the client can resolve the neutral hash to a prefab (else it would drop the ZDO)');
pruefe(raum.getZDOByPrefab(getStableHash('Coins')).length === 1, 'Coins lies under its own prefab');

console.log(fehler === 0 ? '\nd5-beute-prefab: OK' : `\nd5-beute-prefab: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
