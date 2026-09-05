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
 * ── Was seit F5 anders ist ───────────────────────────────────────────
 * Ein Eintrag ohne Datei war bis dahin immer ein Fehlschlag. Das setzt
 * voraus, dass die laufende Maschine ALLE Modelle hat — und genau das
 * gilt hier nicht mehr: Die drei Dungeon-Arbeitsbäume teilen sich per
 * Symlink 36 GLB, das Manifest beschreibt über 200. Der Test war deshalb
 * rot, ohne dass etwas kaputt war, und ein roter Dauertest wird in kurzer
 * Zeit ignoriert (dieselbe Erfahrung wie am 23.08.2026 mit dem fehlenden
 * `assets/`-Ordner, s. unten).
 *
 * Die Unterscheidung kann der Test nicht selbst treffen — auf der Platte
 * sieht ein Teilbestand aus wie ein gelöschtes Modell. Also sagt sie das
 * Manifest: `tools/asset-manifest.mjs` führt jeden Eintrag, den es in
 * diesem Lauf NICHT messen konnte, unter `uebernommen` auf. Ist die Liste
 * leer, hat der Lauf den vollen Bestand gesehen, und ein Eintrag ohne
 * Datei ist wieder das, was er immer war: eine Leiche.
 *
 * Dafür prüft der Test die Liste in der Gegenrichtung mit: Ein Name, der
 * unter `uebernommen` steht, obwohl die Datei hier LIEGT, heisst, dass
 * das Manifest seit dem letzten Lauf veraltet ist.
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

/**
 * Liegen die Modelldateien ueberhaupt vor?
 *
 * `assets/` steht in `.gitignore` (nur `manifest.json` ist ausgenommen) --
 * 516 Dateien, 210 MB, die Mike bewusst ausserhalb des Repos sichert. Ein
 * frischer Checkout, wie ihn GitHub Actions macht, hat sie also NIE.
 *
 * Ohne diese Unterscheidung pruefte der Test dort nicht den Quelltext,
 * sondern den Umfang des Checkouts -- und war rot, ohne dass etwas kaputt
 * war (beobachtet am 23.08.2026, drei Tests gleichzeitig).
 *
 * FEHLT DER ORDNER GANZ, wird uebersprungen. FEHLEN EINZELNE DATEIEN
 * DARIN, bleibt es ein Fehlschlag -- genau dafuer ist die Pruefung da.
 */
if (!existsSync(MODELLE_DIR)) {
  console.log(`UEBERSPRUNGEN: ${MODELLE_DIR} fehlt -- assets/ liegt nicht im Repo.`);
  process.exit(0);
}

const dateiListe = alleGlb().sort();
const dateiStaemme = new Set(dateiListe.map((f) => f.slice(0, -4)));
const manifestStaemme = new Set(Object.keys(manifest.modelle));

/**
 * Einträge, die der letzte Lauf nicht messen konnte, weil die Datei auf
 * jener Maschine fehlte. Fehlt das Feld ganz, stammt das Manifest von vor
 * F5 — dann galt „alles gemessen", und `[]` ist die richtige Lesart.
 */
const uebernommen: string[] = manifest.uebernommen ?? [];
const uebernommenSet = new Set(uebernommen);

check(
  'manifest.anzahl stimmt mit der Zahl der Einträge überein',
  manifest.anzahl === manifestStaemme.size,
  `anzahl=${manifest.anzahl} Einträge=${manifestStaemme.size}`
);

check(
  'gemessene Einträge (anzahl − uebernommen) decken den Plattenbestand genau',
  manifest.anzahl - uebernommen.length === dateiListe.length,
  `manifest=${manifest.anzahl}−${uebernommen.length} Platte=${dateiListe.length}`
);

const uebernommenOhneEintrag = uebernommen.filter((stamm) => !manifestStaemme.has(stamm));
check(
  'jeder übernommene Name hat auch einen Eintrag',
  uebernommenOhneEintrag.length === 0,
  uebernommenOhneEintrag.join(', ')
);

// Gegenrichtung: liegt die Datei hier, hätte der letzte Lauf sie messen
// müssen. Steht sie trotzdem unter `uebernommen`, ist das Manifest alt.
const uebernommenObwohlDa = uebernommen.filter((stamm) => dateiStaemme.has(stamm));
check(
  'kein übernommener Eintrag zu einer Datei, die hier liegt (Manifest veraltet)',
  uebernommenObwohlDa.length === 0,
  uebernommenObwohlDa.join(', ')
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
  // Ein übernommener Eintrag SOLL auf eine hier fehlende Datei zeigen —
  // das ist seine Aussage, nicht sein Fehler.
  if (uebernommenSet.has(stamm)) continue;
  if (!dateiStaemme.has(stamm) || !existsSync(join(MODELLE_DIR, eintrag.datei))) {
    dangelnd.push(`${stamm} -> ${eintrag.datei}`);
  }
}
check(
  `kein gemessener Manifest-Eintrag zeigt auf eine fehlende Datei (${uebernommen.length} übernommene ausgenommen)`,
  dangelnd.length === 0,
  dangelnd.join(', ')
);

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
