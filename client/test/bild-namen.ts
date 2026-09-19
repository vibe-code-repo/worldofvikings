/**
 * Object names that other files look up by string.
 * Namen von Objekten, die andere Dateien per Zeichenkette suchen.
 *
 * Halb umbenannt ist das kein Absturz, sondern ein stilles Bildproblem: Die
 * Himmelskuppel wuerfe plötzlich Schatten, laege in der Refraktionsliste oder
 * fehlte im Strahlenpass; die Dungeon-Atmosphaere liesse die Aussen-SSAO an der
 * Kamera. Dieser Test haelt die Paare zusammen:
 *   [1] Laufzeit: die echte Kuppel traegt den Namen, den die Verbraucher suchen.
 *   [2] Quelltext: Erzeuger und Verbraucher nennen denselben Namen.
 *   [3] Alle Quelldateien unter client/src, shared/src, server/src, admin/src
 *       und tools: keine nennt einen der frueheren Namen.
 *   [4] Die fruehere Vorsilbe steht nur noch an den benannten Ausnahmestellen.
 */
import { readdirSync, readFileSync } from 'node:fs';
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
    verbraucher: [`${engineDir}PostProcessing.ts`, `${engineDir}WaterRefraction.ts`],
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
  // als Zeichenkette in einfachen oder doppelten Anfuehrungszeichen: Kommentare, die den Namen nennen, zaehlen nicht
  const wort = new RegExp(`['"]${p.name}['"]`);
  pruefe(wort.test(lies(p.erzeuger)), `${p.name}: Erzeuger ${p.erzeuger}`);
  for (const v of p.verbraucher) pruefe(wort.test(lies(v)), `${p.name}: Verbraucher ${v}`);
}
// Die Schattenregeln sind Ausdruecke, kein Wort — dort muss der Name als Alternative stehen.
const schatten = lies(`${engineDir}Shadows.ts`);
pruefe(/const NIE_WERFEN =\s*\/\^\([^)]*\bskyDome\|/.test(schatten), 'NIE_WERFEN nennt skyDome');
pruefe(/const NIE_EMPFANGEN = \/\^\([^)]*\bskyDome\|/.test(schatten), 'NIE_EMPFANGEN nennt skyDome');
pruefe(/n === 'skyDome'/.test(lies(`${engineDir}WaterRefraction.ts`)), 'WaterRefraction schliesst skyDome namentlich aus');

console.log('\n[3] Die frueheren Namen kommen in keiner Quelldatei mehr vor');
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

/** Alle Quelldateien der fuenf Wurzeln — kein Blick auf eine feste Dateiliste. */
const WURZELN = ['client/src', 'shared/src', 'server/src', 'admin/src', 'tools'] as const;
const QUELL_ENDUNGEN = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|py|sh|json|md)$/;
const UEBERSPRINGEN = new Set(['node_modules', 'dist', 'out', 'export', 'temp', '__pycache__', '.git']);
function quellen(rel: string, aus: string[] = []): string[] {
  for (const e of readdirSync(resolve(WURZEL, rel), { withFileTypes: true })) {
    if (UEBERSPRINGEN.has(e.name)) continue;
    const pfad = `${rel}/${e.name}`;
    if (e.isDirectory()) quellen(pfad, aus);
    else if (QUELL_ENDUNGEN.test(e.name)) aus.push(pfad);
  }
  return aus;
}
const alleQuellen = WURZELN.flatMap((w) => quellen(w));
pruefe(alleQuellen.length > 300, `${alleQuellen.length} Quelldateien unter ${WURZELN.join(', ')} gelesen`);
pruefe(alleQuellen.includes('client/src/entities/EntityManager.ts'), 'auch Dateien ausserhalb von engine/ sind dabei (entities/EntityManager.ts)');
const inhalte = new Map(alleQuellen.map((f) => [f, lies(f)] as const));
const alteNamen = [...inhalte].filter(([, text]) => frueher.some((n) => text.includes(n)));
pruefe(
  alteNamen.length === 0,
  `keine Quelldatei nennt einen der frueheren Namen${alteNamen.length ? ` (gefunden in: ${alteNamen.map(([f]) => f).join(', ')})` : ''}`
);

console.log('\n[4] Die fruehere Vorsilbe kommt nur an den benannten Ausnahmestellen vor');
// Jede Ausnahme nennt Datei und Grund; `zeile` schraenkt sie auf Zeilen ein, die diesem Muster
// entsprechen — ohne `zeile` ist die ganze Datei die benannte Stelle.
const SCHLUESSEL = new RegExp(`${VOR}-babylon-settings-v1`);
const ausnahmen: readonly { datei: string; grund: string; zeile?: RegExp }[] = [
  { datei: 'server/src/ServerKonfig.ts', grund: 'liest den alten Kartenmodus-Namen als Alias (eine Warnung)' },
  { datei: 'client/src/ui/Settings.ts', grund: 'STORAGE_KEY der gespeicherten Einstellungen (T22, zurueckgestellt)', zeile: SCHLUESSEL },
  { datei: 'tools/pw-gpu-diagnose.mjs', grund: 'liest den STORAGE_KEY', zeile: SCHLUESSEL },
  { datei: 'tools/dungeon2-e2e.mjs', grund: 'liest den STORAGE_KEY', zeile: SCHLUESSEL },
  { datei: 'tools/pw-dungeon2-playdev.mjs', grund: 'liest den STORAGE_KEY', zeile: SCHLUESSEL },
  { datei: 'tools/recover-textures.mjs', grund: 'liest die Umgebungsvariable des frueheren Namens weiter', zeile: new RegExp(`${VOR.toUpperCase()}_CLIENT`) },
  { datei: 'tools/README.md', grund: 'nennt diese Umgebungsvariable als veraltet', zeile: new RegExp(`${VOR.toUpperCase()}_CLIENT`) },
];
const vorsilbe = new RegExp(VOR, 'i');
const ausnahmeVon = new Map(ausnahmen.map((a) => [a.datei, a] as const));
const genutzt = new Set<string>();
const fremde: string[] = [];
for (const [datei, text] of inhalte) {
  if (!vorsilbe.test(text)) continue;
  const a = ausnahmeVon.get(datei);
  if (!a) {
    fremde.push(datei);
    continue;
  }
  genutzt.add(datei);
  if (a.zeile) {
    const falsch = text.split('\n').filter((z) => vorsilbe.test(z) && !a.zeile!.test(z));
    pruefe(falsch.length === 0, `${datei}: nur ${a.grund}${falsch.length ? ` (andere Zeile: ${falsch[0]!.trim().slice(0, 80)})` : ''}`);
  }
}
pruefe(fremde.length === 0, `Vorsilbe nur in benannten Dateien${fremde.length ? ` (zusaetzlich in: ${fremde.join(', ')})` : ''}`);
// Eine Ausnahme ohne Treffer ist keine mehr: sie gehoert dann aus der Liste gestrichen.
for (const a of ausnahmen) pruefe(genutzt.has(a.datei), `Ausnahme ${a.datei} wird gebraucht (${a.grund})`);

if (fehler > 0) {
  console.error(`\n${fehler} FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log('\nAlle Namens-Paare grün.');
