/**
 * catalog_search: 20 festgelegte Suchanfragen gegen die echten Katalogdaten.
 * Jeder zurückgegebene Name muss in PREFABS_BY_NAME oder in der (Test-)Upload-
 * Registry stehen; jede Anfrage liefert mindestens einen Treffer, außer den
 * zwei absichtlich leeren. Dazu fünf Stichproben der Maße gegen Katalog bzw.
 * Manifest.
 *
 * Lauf: npx tsx shared/test/weltbau-katalog.ts   (aus shared/)
 */
import { readFileSync } from 'node:fs';
import { PREFABS_BY_NAME } from '../src/prefabs.js';
import { STORE_KATALOG_NACH_PREFAB } from '../src/storeKatalogDaten.js';
import { storeKollision } from '../src/storeKollisionDaten.js';
import { boundsNachWeltraum } from '../src/storeKatalog.js';
import type { UploadedModelEntry } from '../src/uploadedModelRegistry.js';
import { baueKatalog, sucheKatalog, normalisiere, KatalogFehler, type KatalogAbfrage } from '../src/weltbau/katalog.js';
import { leseManifest } from '../src/weltbau/manifest.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const upload = (name: string, art: 'fest' | 'durchlaessig', b: number, h: number, t: number): UploadedModelEntry => ({
  name,
  anzeigename: `Anzeige ${name}`,
  bytes: 1000,
  dreiecke: 100,
  meshes: 1,
  materialien: 1,
  bilder: 0,
  fehlendeTexturen: false,
  breite: b,
  hoehe: h,
  tiefe: t,
  kollisionsart: art,
  hatKollisionsnetz: false,
  kollisionsnetzAbgelehnt: false,
  hochgeladenVon: 'test',
  zeitpunkt: '2026-09-23T00:00:00Z',
});
const UPLOADS = [upload('U_Testhaus', 'fest', 6, 4, 5), upload('U_Testbusch', 'durchlaessig', 1.5, 1.2, 1.5), upload('U_Testfass', 'durchlaessig', 0.8, 1, 0.8)];
const MANIFEST_TEXT = readFileSync(new URL('../../assets/manifest.json', import.meta.url), 'utf-8');
const manifest = leseManifest(MANIFEST_TEXT);

const t0 = performance.now();
const katalog = baueKatalog({ manifest, uploads: UPLOADS });
const msBau = performance.now() - t0;
pruefe('Katalog gebaut (≥ 500 Einträge)', katalog.length >= 500, `${katalog.length} Einträge in ${Math.round(msBau)} ms`);
pruefe('Namen eindeutig', new Set(katalog.map((e) => e.name)).size === katalog.length);
const uploadNamen = new Set(UPLOADS.map((u) => u.name));
const bekannt = (n: string): boolean => PREFABS_BY_NAME.has(n) || uploadNamen.has(n);
const erfunden = katalog.filter((e) => e.quelle !== 'upload' && !PREFABS_BY_NAME.has(e.name));
pruefe('Alle Nicht-Upload-Einträge stehen in PREFABS_BY_NAME', erfunden.length === 0, erfunden.slice(0, 3).map((e) => e.name).join(','));
pruefe('Alle drei Quellen kommen vor', ['store', 'eigen', 'upload'].every((q) => katalog.some((e) => e.quelle === q)));

const anfragen: Array<[string, KatalogAbfrage, boolean]> = [
  ['haus', { text: 'haus' }, true],
  ['fass', { text: 'fass' }, true],
  ['Fässer (Umlaut)', { text: 'Fässer' }, true],
  ['baum', { text: 'baum' }, true],
  ['fels', { text: 'fels' }, true],
  ['truhe', { text: 'truhe' }, true],
  ['fest=true', { fest: true }, true],
  ['fest=false', { fest: false }, true],
  ['breiteMax=2', { breiteMax: 2 }, true],
  ['hoeheMax=1', { hoeheMax: 1 }, true],
  ['biom=blackforest', { biom: 'blackforest' }, true],
  ['biom=grassland text=tree', { biom: 'grassland', text: 'tree' }, true],
  ['quelle=upload', { quelle: ['upload'] }, true],
  ['quelle=eigen', { quelle: ['eigen'] }, true],
  ['quelle=store gruppe=Vegetation', { quelle: ['store'], gruppe: 'Vegetation' }, true],
  ['gruppe=Gebäude untergruppe=Haus', { gruppe: 'Gebäude', untergruppe: 'Haus' }, true],
  ['breiteMin=10 fest', { breiteMin: 10, fest: true }, true],
  ['text zwei Wörter', { text: 'vegetation tree' }, true],
  ['Unsinnswort', { text: 'qxzvwyk' }, false],
  ['breiteMax=0,001', { breiteMax: 0.001 }, false],
];
let leer = 0;
let mitTreffer = 0;
for (const [name, a, erwartetTreffer] of anfragen) {
  const r = sucheKatalog(katalog, { ...a, limit: 50 });
  const unbekannt = r.treffer.filter((e) => !bekannt(e.name));
  const passt = unbekannt.length === 0 && (erwartetTreffer ? r.gesamt >= 1 : true);
  if (r.gesamt >= 1) mitTreffer++;
  else leer++;
  pruefe(`Suche "${name}"`, passt && r.treffer.length <= 50, `${r.gesamt} Treffer${unbekannt.length ? `, UNBEKANNT ${unbekannt[0]!.name}` : ''}`);
}
pruefe('20 Anfragen: 0 erfundene Namen, ≥ 1 Treffer bei 18/20, genau 2 leere', anfragen.length === 20 && mitTreffer === 18 && leer === 2, `${mitTreffer} mit Treffer, ${leer} leer`);

// Filter wirken wirklich.
const nurFest = sucheKatalog(katalog, { fest: true, limit: 50 });
pruefe('fest=true: alle Treffer fest', nurFest.treffer.every((e) => e.fest));
const schmal = sucheKatalog(katalog, { breiteMax: 2, limit: 50 });
pruefe('breiteMax=2: alle Treffer ≤ 2 m, Einträge ohne Maß ausgeschlossen', schmal.treffer.every((e) => e.breite !== null && e.breite <= 2));
const up = sucheKatalog(katalog, { quelle: ['upload'] });
pruefe('quelle=upload: genau die 3 Test-Uploads', up.gesamt === 3 && up.treffer.every((e) => uploadNamen.has(e.name)));
const testhaus = up.treffer.find((e) => e.name === 'U_Testhaus');
pruefe('Upload-Maße und Kollisionsart exakt', testhaus?.breite === 6 && testhaus.hoehe === 4 && testhaus.tiefe === 5 && testhaus.fest && !up.treffer.find((e) => e.name === 'U_Testbusch')!.fest);
pruefe('Umlaute: „Fässer“ und „faesser“ gleich', sucheKatalog(katalog, { text: 'Fässer' }).gesamt === sucheKatalog(katalog, { text: 'faesser' }).gesamt && normalisiere('Fässer') === 'faesser');
pruefe('Groß-/Kleinschreibung egal', sucheKatalog(katalog, { text: 'HAUS' }).gesamt === sucheKatalog(katalog, { text: 'haus' }).gesamt);
const seite1 = sucheKatalog(katalog, { text: 'baum', limit: 5 });
const seite2 = sucheKatalog(katalog, { text: 'baum', limit: 5, start: 5 });
pruefe('Blättern: start=5 liefert andere Treffer', seite1.treffer.length === 5 && seite2.treffer.every((e) => !seite1.treffer.some((x) => x.name === e.name)));

// Fehlerfälle.
const wirft = (a: KatalogAbfrage): string => {
  try {
    sucheKatalog(katalog, a);
    return '';
  } catch (f) {
    return f instanceof KatalogFehler ? f.message : `falscher Fehlertyp: ${String(f)}`;
  }
};
pruefe('Unbekanntes Biom: Fehler mit der Liste der gültigen', /Unbekanntes Biom "lava".*grassland/.test(wirft({ biom: 'lava' })));
pruefe('limit 51 abgelehnt', wirft({ limit: 51 }) !== '');
pruefe('limit 0 abgelehnt', wirft({ limit: 0 }) !== '');

// Laufzeit einer Suche.
const t1 = performance.now();
for (let i = 0; i < 100; i++) sucheKatalog(katalog, { text: 'haus' });
const msSuche = (performance.now() - t1) / 100;
pruefe('Suche unter 20 ms', msSuche < 20, `${msSuche.toFixed(2)} ms je Suche`);

// Fünf Stichproben der Maße.
const store = katalog.filter((e) => e.quelle === 'store' && e.huelleQuelle !== 'keine');
const proben: string[] = [];
for (const e of store.filter((_, i) => i % Math.floor(store.length / 3) === 0).slice(0, 3)) {
  const eintrag = STORE_KATALOG_NACH_PREFAB.get(e.name)!;
  const kollision = storeKollision(e.name);
  const kiste = kollision?.art === 'box' ? kollision.box : undefined;
  const b = boundsNachWeltraum(kiste ?? eintrag.bounds!);
  const passt = e.breite === Math.round((b.max[0] - b.min[0]) * 1e4) / 1e4 && e.hoehe === Math.round((b.max[1] - b.min[1]) * 1e4) / 1e4 && e.tiefe === Math.round((b.max[2] - b.min[2]) * 1e4) / 1e4;
  pruefe(`Stichprobe Store ${e.name}: Maße = Katalog (nach boundsNachWeltraum)`, passt, `${e.breite}×${e.tiefe}×${e.hoehe}`);
  proben.push(e.name);
}
const eigen = katalog.filter((e) => e.quelle === 'eigen' && e.huelleQuelle === 'manifest').slice(0, 2);
pruefe('Manifest liefert eigene Modelle mit Maßen', eigen.length === 2 && manifest.size > 100, `${manifest.size} Manifest-Einträge`);
for (const e of eigen) {
  const m = manifest.get(e.name)!;
  pruefe(`Stichprobe Manifest ${e.name}: Maße = Manifest`, e.breite === Math.round(m.breite * 1e4) / 1e4 && e.hoehe === Math.round(m.hoehe * 1e4) / 1e4 && e.tiefe === Math.round(m.tiefe * 1e4) / 1e4, `${e.breite}×${e.tiefe}×${e.hoehe}`);
}

// Ohne Manifest: eigene Modelle ohne Maße, nichts erfunden.
const ohne = baueKatalog({ uploads: UPLOADS });
const ohneEigen = ohne.filter((e) => e.quelle === 'eigen');
pruefe('Ohne Manifest: eigene Modelle haben huelleQuelle "keine" und Maße null', ohneEigen.length > 0 && ohneEigen.every((e) => e.huelleQuelle === 'keine' && e.breite === null));

// Manifest-Leser.
pruefe('leseManifest: kaputtes JSON → leer', leseManifest('{kaputt').size === 0);
pruefe('leseManifest: Eintrag ohne Maße wird übersprungen', leseManifest('{"modelle":{"A":{"datei":"A.glb"},"B":{"breite":1,"hoehe":2,"tiefe":3}}}').size === 1);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
