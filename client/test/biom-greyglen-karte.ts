/**
 * Map, editor and preset entries of the `greyglen` biome (bit 128): colours, display names
 * through translation keys, region preset.
 * Karten-, Editor- und Vorlagen-Eintraege des Bioms `greyglen`.
 *
 *   npx tsx client/test/biom-greyglen-karte.ts   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Biome, BIOME_BY_NAME } from '@wov/shared';
import { BIOME_COLOR, BIOME_ORDER, BIOME_LABEL, biomLabel, BIOME_INHALT, BIOME_TREE_DENSITY, BIOME_TREES } from '../src/ui/worldmap/MapPalette';
import { BIOM_TON } from '../src/editor/design';
import { biomTon, BIOME_FARBE } from '../src/editor/biome';
import { REGION_VORLAGEN } from '../src/editor/regionsWerkzeuge';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const g = BIOME_COLOR[Biome.Greyglen];
check('map colour exists', Array.isArray(g) && g.length === 3);
const nachbarn = [Biome.Meadows, Biome.BlackForest, Biome.Mistlands, Biome.Swamp, Biome.Plains, Biome.Mountain, Biome.DeepNorth, Biome.AshLands, Biome.Ocean];
const abstaende = nachbarn.map((b) => [Biome[b], dist(g, BIOME_COLOR[b])] as const);
console.log('     RGB distances: ' + abstaende.map(([n, d]) => `${n} ${d.toFixed(0)}`).join(', '));
check('map colour clearly distinct from every other biome (RGB distance >= 35)', abstaende.every(([, d]) => d >= 35));
check('cool grey-green: blue >= red and green is the largest channel', g[2] >= g[0] && g[1] > g[0] && g[1] > g[2]);
check('legend contains greyglen once', BIOME_ORDER.filter((b) => b === Biome.Greyglen).length === 1);
check('every legend biome has colour, label, content, density and trees',
  BIOME_ORDER.every((b) => BIOME_COLOR[b] && BIOME_LABEL[b] && BIOME_INHALT[b] !== undefined && BIOME_TREE_DENSITY[b] !== undefined && BIOME_TREES[b]));
check('label de/en through the key', biomLabel(Biome.Greyglen, 'de') === 'Grauklamm' && biomLabel(Biome.Greyglen, 'en') === 'Greyglen');
check('other labels unchanged', biomLabel(Biome.Meadows, 'en') === 'Wiesen' && biomLabel(Biome.DeepNorth, 'de') === 'Tiefer Norden');

const ton = BIOM_TON['greyglen'];
check('editor tone exists', ton !== undefined && ton.length === 2);
check('editor tone is used by the region list', biomTon('greyglen')[0] === ton![0] && BIOME_FARBE['greyglen'] === ton![1]);
check('editor tones are distinct from grassland', ton![0] !== BIOM_TON['grassland']![0] && ton![1] !== BIOM_TON['grassland']![1]);
check('every authoring biome has an editor tone', [...BIOME_BY_NAME.keys()].every((n) => BIOM_TON[n] !== undefined));

const vorlage = REGION_VORLAGEN.find((v) => v.werte.biome === 'greyglen');
check('region preset for greyglen exists', vorlage !== undefined);
check('preset name comes from the key', vorlage?.nameSchluessel === 'inhalt.biom.greyglen' && vorlage.name === 'Grauklamm');
check('preset ids are unique', new Set(REGION_VORLAGEN.map((v) => v.id)).size === REGION_VORLAGEN.length);

// ── Places no import reaches in plain Node (engine, renderer, DOM): read the source ──
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const quelle = (rel: string): string => readFileSync(resolve(WURZEL, rel), 'utf8');
check('terrain fallback colour: greyglen row = grassland row',
  /\[Biome\.Meadows\]:\s*(\[[^\]]+\]),[\s\S]*\[Biome\.Greyglen\]:\s*\1,/.test(quelle('client/src/engine/Terrain.ts')));
check('web map renderer has a greyglen colour and name',
  /\[Biome\.Greyglen\]:\s*\[78, 116, 110\]/.test(quelle('tools/weltkarte-rendern.ts'))
  && /\[Biome\.Greyglen\]:\s*inhaltText\('inhalt\.biom\.greyglen'/.test(quelle('tools/weltkarte-rendern.ts')));
const weltkarte = quelle('client/src/ui/WorldMap.ts');
check('world map labels go through biomLabel (no fixed label table access)', weltkarte.includes('biomLabel(') && !weltkarte.includes('BIOME_LABEL['));
check('editor preset button uses the name key', /v\.nameSchluessel \? inhaltText\(v\.nameSchluessel/.test(quelle('client/src/editor/editorMain.ts')));

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nbiom-greyglen-karte: alle Pruefungen gruen');
