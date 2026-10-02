/**
 * D5 — the model table of loot, against the files on disk (needs assets; skipped in CI without them).
 *
 * For every item name that can lie on the ground: prefab with ITEM_DROP (own or neutral), and the model the client would load
 * (own model, or the fallback chest) exists as a `.glb` under `assets/models`. Prints the table name -> prefab -> model.
 *
 * Run: npx tsx client/test/d5-beute-modelle.ts   (from the repo root)
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ITEM_DEFS, PrefabFlag, beuteDarstellung, beutePrefabFuer, findPrefabByName } from '@wov/shared';

const wurzel = resolve(import.meta.dirname, '../..');
let fehler = 0;
const zeilen: string[] = [];
const gruppen = new Map<string, string[]>();
for (const it of ITEM_DEFS) {
  const p = beutePrefabFuer(it.name);
  const def = findPrefabByName(p);
  const dar = def ? beuteDarstellung(def) : null;
  const datei = dar ? resolve(wurzel, 'assets/models', `${dar.modell}.glb`) : '';
  const ok = !!def && (def.flags & PrefabFlag.ITEM_DROP) !== 0n && !!dar && existsSync(datei);
  if (!ok) { fehler++; console.log(`  FAIL  ${it.name}: prefab ${p}, model ${dar?.modell}, file ${datei}`); }
  const schluessel = `${p} -> ${dar?.modell} x${dar?.skala}`;
  gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), it.name]);
}
for (const [k, v] of gruppen) zeilen.push(`${k}: ${v.length} items (${v.slice(0, 6).join(', ')}${v.length > 6 ? ', ...' : ''})`);
console.log(zeilen.join('\n'));
console.log(`  ${ITEM_DEFS.length} item names checked`);
console.log(fehler === 0 ? '\nd5-beute-modelle: OK' : `\nd5-beute-modelle: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
