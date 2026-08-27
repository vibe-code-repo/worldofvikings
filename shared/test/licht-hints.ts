/**
 * Licht-Hints kommen wirklich an der Registry an.
 *
 * ── Warum das eine eigene Prüfung wert ist ───────────────────────────
 * Ein Prefab ohne `light` sieht aus wie ein Prefab, das nicht leuchten
 * soll. Es gibt keine Fehlermeldung, keinen fehlenden Eintrag, keine
 * kaputte Datei — es ist nur dunkel, und das ist im Dungeon der
 * Normalzustand.
 *
 * Genau so ist `CryptWallTorch` am 27.08.2026 durchgerutscht:
 * `LIGHT_HINTS` wurde nur beim Zusammenführen mit `prefabs.pkg`
 * angewandt, und die Fackel gibt es ausschliesslich in `HINT_DEFS`. Sie
 * stand an der Wand und leuchtete nicht; der LightPool meldete `0/16`,
 * und die Ursache lag drei Stationen davor.
 *
 * Lauf: npx tsx shared/test/licht-hints.ts   (aus dem Repo-Wurzel)
 */

import { LICHT_PREFAB_NAMEN, findPrefabByName } from '../src/prefabs.js';

let fehler = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    fehler++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('\nLicht-Hints:');
const ohneEintrag: string[] = [];
const ohneLicht: string[] = [];

for (const name of LICHT_PREFAB_NAMEN) {
  const def = findPrefabByName(name);
  if (!def) {
    ohneEintrag.push(name);
    continue;
  }
  if (!def.light) ohneLicht.push(name);
}

check(
  `alle ${LICHT_PREFAB_NAMEN.length} Licht-Hints haben ein Prefab`,
  ohneEintrag.length === 0,
  ohneEintrag.join(', ')
);
check(
  'und tragen ihr Licht auch in der Registry',
  ohneLicht.length === 0,
  ohneLicht.join(', ')
);

// Gegenprobe an der eigenen Wandfackel: Sie gibt es NUR in HINT_DEFS, und
// genau dieser Weg hat den Hint verloren.
const fackel = findPrefabByName('CryptWallTorch');
check('CryptWallTorch ist registriert', fackel !== undefined);
check(
  'CryptWallTorch leuchtet',
  !!fackel?.light,
  fackel?.light ? `Reichweite ${fackel.light.range} m` : 'kein light'
);

console.log(`\n${fehler === 0 ? 'ALLE PRUEFUNGEN GRUEN' : `${fehler} PRUEFUNG(EN) FEHLGESCHLAGEN`}`);
process.exit(fehler === 0 ? 0 : 1);
