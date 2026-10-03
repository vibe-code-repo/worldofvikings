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
import { Biome, BiomeArea, BIOME_BY_NAME } from '@wov/shared';
import { BIOME_COLOR, BIOME_ORDER, BIOME_LABEL, biomLabel, legendenZeilen, setzeLegendenNamen, treeKindAt, BIOME_INHALT, BIOME_TREE_DENSITY, BIOME_TREES } from '../src/ui/worldmap/MapPalette';
import { BIOM_TON } from '../src/editor/design';
import { biomTon, BIOME_FARBE } from '../src/editor/biome';
import { REGION_VORLAGEN, vorlagenName } from '../src/editor/regionsWerkzeuge';

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
check('unknown biome bit gets the dash, None its own label', biomLabel(99999, 'en') === '—' && biomLabel(Biome.None, 'en') === BIOME_LABEL[Biome.None]);
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

// ── Greyglen shows the same map values as grassland (copy until its own content follows) ──
check('tree kinds = grassland', JSON.stringify(BIOME_TREES[Biome.Greyglen]) === JSON.stringify(BIOME_TREES[Biome.Meadows]));
check('tree density = grassland', BIOME_TREE_DENSITY[Biome.Greyglen] === BIOME_TREE_DENSITY[Biome.Meadows]);
check('content text = grassland', BIOME_INHALT[Biome.Greyglen] === BIOME_INHALT[Biome.Meadows]);
let baumGleich = true;
let baumMitBaum = 0;
for (const ff of [0, 0.4, 0.9, 1.1, 1.3, 2]) {
  for (const hoehe of [1, 40, 160]) {
    for (const area of [BiomeArea.Edge, BiomeArea.Median, BiomeArea.Everything]) {
      const a = treeKindAt(Biome.Greyglen, area, ff, hoehe);
      const b = treeKindAt(Biome.Meadows, area, ff, hoehe);
      if (a !== b) baumGleich = false;
      if (a !== null) baumMitBaum++;
    }
  }
}
check('treeKindAt(greyglen) = treeKindAt(grassland) over a grid, with trees on part of it', baumGleich && baumMitBaum > 0, String(baumMitBaum));

// ── Legend rows in the language ──
const legEn = legendenZeilen('en');
const legDe = legendenZeilen('de');
check('legend row for greyglen in en and de', legEn.find((z) => z.biome === Biome.Greyglen)?.name === 'Greyglen' && legDe.find((z) => z.biome === Biome.Greyglen)?.name === 'Grauklamm');
check('legend rows follow BIOME_ORDER with the map colour', legEn.length === BIOME_ORDER.length && legEn.every((z, i) => z.biome === BIOME_ORDER[i] && z.farbe === BIOME_COLOR[z.biome]));
check('legend of the other biomes is the same in both languages', legEn.filter((z) => z.biome !== Biome.Greyglen).every((z, i) => z.name === legDe.filter((x) => x.biome !== Biome.Greyglen)[i]!.name));

// ── Language switch at runtime: the legend names are set again ──
const felder = BIOME_ORDER.map(() => ({ textContent: null as string | null }));
setzeLegendenNamen(felder, 'de');
const iGrau = BIOME_ORDER.indexOf(Biome.Greyglen);
check('legend names set in de', felder[iGrau]!.textContent === 'Grauklamm' && felder.every((x) => x.textContent));
setzeLegendenNamen(felder, 'en');
check('after the switch to en the names are new', felder[iGrau]!.textContent === 'Greyglen');
setzeLegendenNamen(felder.slice(0, 2), 'de');
check('too few fields are tolerated', felder[0]!.textContent === biomLabel(BIOME_ORDER[0]!, 'de') && felder[iGrau]!.textContent === 'Greyglen');

// ── Preset names in the language ──
check('preset name en/de through the key', vorlage !== undefined && vorlagenName(vorlage, 'en') === 'Greyglen' && vorlagenName(vorlage, 'de') === 'Grauklamm');
check('presets without a key keep their fixed name', REGION_VORLAGEN.filter((v) => !v.nameSchluessel).every((v) => vorlagenName(v, 'en') === v.name));

// ── Places no import reaches in plain Node (engine, renderer, DOM): read the source ──
const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const quelle = (rel: string): string => readFileSync(resolve(WURZEL, rel), 'utf8');
check('terrain fallback colour: greyglen row = grassland row',
  /\[Biome\.Meadows\]:\s*(\[[^\]]+\]),[\s\S]*\[Biome\.Greyglen\]:\s*\1,/.test(quelle('client/src/engine/Terrain.ts')));
check('web map renderer has a greyglen colour and name',
  /\[Biome\.Greyglen\]:\s*\[78, 116, 110\]/.test(quelle('tools/weltkarte-rendern.ts'))
  && /\[Biome\.Greyglen\]:\s*inhaltText\('inhalt\.biom\.greyglen'/.test(quelle('tools/weltkarte-rendern.ts')));
const weltkarte = quelle('client/src/ui/WorldMap.ts');
check('world map: legend rows and tooltip get the game language, never a literal', weltkarte.includes('legendenZeilen(this.i18n.language)') && weltkarte.includes('biomLabel(biome, this.i18n.language)') && !weltkarte.includes('BIOME_LABEL[') && !/(legendenZeilen|biomLabel)\([^)]*'(de|en)'/.test(weltkarte));
const editorQuelle = quelle('client/src/editor/editorMain.ts');
{
  const m = /private uebersetzeChrome\(\): void \{[\s\S]*?\n  \}/.exec(weltkarte);
  check('world map: the legend collects its name fields', weltkarte.includes('legendenNamen.push(name)') && weltkarte.includes('this.legendenNamen = legendenNamen'));
  check('world map: uebersetzeChrome sets the legend names again in the game language', m !== null && m[0].includes('setzeLegendenNamen(this.legendenNamen, this.i18n.language)'));
}
check('editor: button and message both use vorlagenName in the editor language, no raw v.name',
  (editorQuelle.match(/vorlagenName\(v, editorI18nInstance\(\)\.language\)/g) ?? []).length === 2 && !/\bv\.name\b/.test(editorQuelle));

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nbiom-greyglen-karte: alle Pruefungen gruen');
