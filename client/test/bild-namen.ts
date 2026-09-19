/**
 * Object names that other files look up by string.
 * Namen von Objekten, die andere Dateien per Zeichenkette suchen.
 *
 * Halb umbenannt ist das kein Absturz, sondern ein stilles Bildproblem: Die
 * Himmelskuppel wuerfe plötzlich Schatten, laege in der Refraktionsliste oder
 * fehlte im Strahlenpass; die Dungeon-Atmosphaere liesse die Aussen-SSAO an der
 * Kamera. Dieser Test haelt die Paare zusammen:
 *   [1] Laufzeit: die echte Kuppel traegt den Namen, den die Verbraucher suchen.
 *   [2] Quelltext: Erzeuger und Verbraucher nennen denselben Namen, und keine
 *       Datei nennt einen der frueheren Namen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { WATER_LEVEL } from '@wov/shared';
import { SkyDome } from '../src/engine/SkyDome';
import { gehoertHinein } from '../src/engine/WaterRefraction';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (bedingung) {
    console.log(`  ✓ ${text}`);
  } else {
    fehler++;
    console.log(`  ✗ ${text}`);
  }
}

const WURZEL = resolve(import.meta.dirname, '../..');
const lies = (p: string): string => readFileSync(resolve(WURZEL, p), 'utf8');

console.log('[1] Laufzeit: die Kuppel heisst so, wie die Verbraucher sie suchen');
const engine = new NullEngine();
const scene = new Scene(engine);
const himmel = new SkyDome(scene);
const gefunden = scene.getMeshByName('skyDome');
pruefe(gefunden !== null, `getMeshByName('skyDome') findet die Kuppel (${gefunden?.name ?? 'null'})`);
pruefe(gefunden === himmel.mesh, 'es ist genau das Mesh der Klasse');
pruefe(scene.getMaterialByName('skyDomeMat') !== null, 'getMaterialByName(\'skyDomeMat\') findet das Material');
himmel.mesh.position.y = WATER_LEVEL - 100;
himmel.mesh.computeWorldMatrix(true);
pruefe(!gehoertHinein(himmel.mesh), 'die echte Kuppel steht nicht in der Refraktionsliste');
himmel.dispose();
scene.dispose();
engine.dispose();

console.log('\n[2] Quelltext: Erzeuger und Verbraucher nennen denselben Namen');
const engineDir = 'client/src/engine/';
const paare: readonly { name: string; erzeuger: string; verbraucher: readonly string[] }[] = [
  {
    name: 'skyDome',
    erzeuger: `${engineDir}SkyDome.ts`,
    verbraucher: [`${engineDir}PostProcessing.ts`, `${engineDir}Shadows.ts`, `${engineDir}WaterRefraction.ts`],
  },
  { name: 'wovSSAO', erzeuger: `${engineDir}PostProcessing.ts`, verbraucher: [`${engineDir}DungeonAtmosphere.ts`] },
  { name: 'wovTaa', erzeuger: `${engineDir}PostProcessing.ts`, verbraucher: [] },
  { name: 'wovPost', erzeuger: `${engineDir}PostProcessing.ts`, verbraucher: [] },
  { name: 'wovSunShafts', erzeuger: `${engineDir}PostProcessing.ts`, verbraucher: [] },
  { name: 'wovMotionBlur', erzeuger: `${engineDir}PostProcessing.ts`, verbraucher: [] },
  { name: 'farDof', erzeuger: `${engineDir}FarDof.ts`, verbraucher: [] },
  { name: 'WaterPlugin', erzeuger: `${engineDir}WaterPlugin.ts`, verbraucher: [] },
];
for (const p of paare) {
  const wort = new RegExp(`(^|[^A-Za-z0-9_])${p.name}([^A-Za-z0-9_]|$)`);
  pruefe(wort.test(lies(p.erzeuger)), `${p.name}: Erzeuger ${p.erzeuger}`);
  for (const v of p.verbraucher) pruefe(wort.test(lies(v)), `${p.name}: Verbraucher ${v}`);
}
// Die Schattenregeln sind Ausdruecke, kein Wort — dort muss der Name als Alternative stehen.
const schatten = lies(`${engineDir}Shadows.ts`);
pruefe(/const NIE_WERFEN =\s*\/\^\([^)]*\bskyDome\|/.test(schatten), 'NIE_WERFEN nennt skyDome');
pruefe(/const NIE_EMPFANGEN = \/\^\([^)]*\bskyDome\|/.test(schatten), 'NIE_EMPFANGEN nennt skyDome');
pruefe(/n === 'skyDome'/.test(lies(`${engineDir}WaterRefraction.ts`)), 'WaterRefraction schliesst skyDome namentlich aus');

console.log('\n[3] Die frueheren Namen kommen nirgends mehr vor');
// Die fruehere Vorsilbe wird zusammengesetzt, damit diese Datei sie nicht selbst traegt.
const VOR = ['valhe', 'im'].join('');
const frueher = [
  'Sky',
  'SkyMat',
  'SkyCubemap',
  'Dof',
  'Taa',
  'SSAO',
  'Post',
  'SunShafts',
  'MotionBlur',
  'Water',
].flatMap((n) => [`${VOR}${n}`, `${VOR[0]!.toUpperCase()}${VOR.slice(1)}${n}`, `${VOR.toUpperCase()}${n.toUpperCase()}`]);
const dateien = [
  ...['PostProcessing', 'Shadows', 'Lighting', 'DungeonAtmosphere', 'WaterPlugin', 'WaterRefraction', 'Terrain', 'SkyDome', 'FarDof'].map(
    (n) => `${engineDir}${n}.ts`
  ),
  'shared/src/lookProfil.ts',
  'client/test/taa-reihenfolge.ts',
  'client/test/wasser-refraktion.ts',
  'tools/pw-sky-verify.mjs',
  'Docs/07-Grafik-Konzept.md',
];
for (const f of dateien) {
  const inhalt = lies(f);
  const treffer = frueher.filter((n) => inhalt.includes(n));
  pruefe(treffer.length === 0, `${f} ohne frueheren Namen${treffer.length ? ` (gefunden: ${treffer.join(', ')})` : ''}`);
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log('\nAlle Namens-Paare grün.');
