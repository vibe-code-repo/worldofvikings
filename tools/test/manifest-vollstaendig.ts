/**
 * Hält assets/manifest.json (F2, Roadmap) gegen den echten Plattenbestand
 * fest: jedes .glb unter assets/models/ muss einen Eintrag haben, und kein
 * Eintrag darf auf eine Datei zeigen, die es nicht (mehr) gibt. Ohne diesen
 * Test veraltet das Manifest lautlos — ein neuer Baum ohne Eintrag oder ein
 * gelöschtes Modell mit Leiche im Manifest fällt sonst niemandem auf, bis
 * ein Werkzeug sich auf falsche Zahlen verlässt.
 *
 * Baut die Prüflogik selbst NICHT nach: liest nur, was
 * tools/asset-manifest.mjs bereits geschrieben hat, und vergleicht die
 * Dateinamen. Die Messwerte (Hüllbox, Dreiecke, …) selbst prüft dieser Test
 * nicht — dafür müsste er dieselbe glTF-Mathematik ein zweites Mal
 * schreiben, und genau das soll ein Test nie tun.
 *
 *   npx tsx tools/test/manifest-vollstaendig.ts
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..', '..');
const MODELLE_DIR = join(WURZEL, 'assets/models');
const MANIFEST_PFAD = join(WURZEL, 'assets/manifest.json');

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

check(
  'assets/manifest.json existiert (npx tsx tools/asset-manifest.mjs erzeugt es)',
  existsSync(MANIFEST_PFAD)
);
if (fehler > 0) {
  // Ohne Datei ist jeder weitere Zugriff ein Absturz statt eines Befunds.
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PFAD, 'utf8'));
/**
 * Alle GLB unter assets/models/, AUCH in Unterordnern — Pfade relativ
 * zum Modellordner.
 *
 * Hier stand ein flaches readdirSync, genau wie im Erzeuger. Solange
 * jede Figur eine Datei war, stimmte das. Seit die Wikingerin in
 * Einzelteile zerlegt ist (assets/models/wikingerin/), meldete der Test
 * alle 24 Teile als "zeigt auf eine fehlende Datei" — obwohl die
 * Dateien da waren und der Manifest-Eintrag stimmte. Verglichen wurde
 * ein Stamm mit Ordner ("wikingerin/H_01") gegen eine Liste ohne.
 */
function alleGlb(praefix = ''): string[] {
  const aus: string[] = [];
  for (const eintrag of readdirSync(join(MODELLE_DIR, praefix), { withFileTypes: true })) {
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) aus.push(...alleGlb(rel));
    else if (eintrag.name.endsWith('.glb')) aus.push(rel);
  }
  return aus;
}

const dateiListe = alleGlb().sort();
const dateiStaemme = new Set(dateiListe.map((f) => f.slice(0, -4)));
const manifestStaemme = new Set(Object.keys(manifest.modelle));

check(
  'manifest.anzahl stimmt mit der Dateizahl unter assets/models/ überein',
  manifest.anzahl === dateiListe.length,
  `manifest=${manifest.anzahl} Platte=${dateiListe.length}`
);

const fehlendImManifest = dateiListe
  .map((f) => f.slice(0, -4))
  .filter((stamm) => !manifestStaemme.has(stamm));
check(
  'jedes .glb unter assets/models/ hat einen Manifest-Eintrag',
  fehlendImManifest.length === 0,
  fehlendImManifest.join(', ')
);

const dangelnd: string[] = [];
for (const [stamm, eintrag] of Object.entries(manifest.modelle) as [string, { datei: string }][]) {
  if (!dateiStaemme.has(stamm) || !existsSync(join(MODELLE_DIR, eintrag.datei))) {
    dangelnd.push(`${stamm} -> ${eintrag.datei}`);
  }
}
check('kein Manifest-Eintrag zeigt auf eine fehlende Datei', dangelnd.length === 0, dangelnd.join(', '));

// Stichprobe der Pflichtfelder (Roadmap F2: "je Modell mindestens …") — nicht
// die Werte selbst, nur dass sie überhaupt geschrieben wurden.
const PFLICHTFELDER = ['datei', 'bytes', 'huelle', 'breite', 'hoehe', 'tiefe', 'dreiecke', 'materialien', 'bilder', 'animationen', 'meshlos', 'foliage'];
let unvollstaendig = 0;
for (const [stamm, eintrag] of Object.entries(manifest.modelle) as [string, Record<string, unknown>][]) {
  const fehlend = PFLICHTFELDER.filter((feld) => !(feld in eintrag));
  if (fehlend.length > 0) {
    unvollstaendig++;
    console.error(`  ${stamm}: fehlende Felder ${fehlend.join(', ')}`);
  }
}
check('jeder Manifest-Eintrag trägt alle Pflichtfelder', unvollstaendig === 0, `${unvollstaendig} unvollständig`);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== MANIFEST-VOLLSTAENDIGKEIT: ALL PASSED ===');
process.exit(0);
