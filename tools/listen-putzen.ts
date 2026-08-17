/**
 * Kuratierungslisten gegen die Whitelist putzen.
 *
 * Ein Name, den `EIGENE_MODELLE` nicht kennt, wird nie gestreut — er
 * steht dann nur da und wartet darauf, jemanden zu verwirren. Genau so
 * steckt GrabhuegelMeadows in der Live-Welt.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { EIGENE_MODELLE_SET } from '@wov/shared';

const p = process.argv[2] ?? 'server/data/welten/dev.json';
const j = JSON.parse(readFileSync(p, 'utf8')) as { regions: Array<{ id?: string; vegetation?: string[] }> };
const entfernt = new Map<string, number>();
for (const r of j.regions) {
  if (!Array.isArray(r.vegetation)) continue;
  r.vegetation = r.vegetation.filter((n) => {
    if (EIGENE_MODELLE_SET.has(n)) return true;
    entfernt.set(n, (entfernt.get(n) ?? 0) + 1);
    return false;
  });
}
writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
console.log(`unbekannte Namen entfernt: ${[...entfernt.values()].reduce((a, b) => a + b, 0)}`);
for (const [n, k] of [...entfernt].sort()) console.log(`   ${n} (${k}×)`);
