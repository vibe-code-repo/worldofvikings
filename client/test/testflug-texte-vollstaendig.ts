/**
 * T0a Vollstaendigkeitstest: Testflug, SpawnPanel und der Upload-Dialog
 * (GegenstandsKatalog.ts) sollen KEINE deutschen Klartext-Literale mehr
 * enthalten, die ins DOM gehen (textContent, title, placeholder, Meldungen)
 * -- alles davon laeuft seit T0a ueber `client/src/editor/i18n.ts` (`t()`).
 *
 * Zwei Pruefungen:
 *  1. Ein einfacher Scanner findet String-/Template-Literale mit deutschen
 *     Markern (Umlaute/ß oder typische deutsche Woerter) in den T0a-Dateien
 *     -- Kommentarzeilen, Blockkommentare und console.*-Aufrufe zaehlen
 *     nicht (Konsolen-/Log-Zeilen duerfen deutsch bleiben, s. Karte). Der
 *     Upload-Dialog in GegenstandsKatalog.ts ist nur der Abschnitt zwischen
 *     den Markern "U1: Modell-Upload" und "private get speicherArt" -- der
 *     Rest der Datei ist T0b.
 *  2. Jeder verwendete Uebersetzungsschluessel (Literal, ob als `t('...')`-
 *     Aufruf oder als Tabellenwert wie in `BewuchsStufe.ts`s
 *     `STUFE_NAME_SCHLUESSEL`) muss in de.json UND en.json existieren --
 *     ein Tippfehler im Schluessel faellt damit auf (Mutationsnachweis im
 *     Bericht, nicht als bleibender Testcode: ein `testflug.spawn.title`
 *     statt `testflug.spawn.titel` in SpawnPanel.ts machte Pruefung 2 rot).
 *
 * Run: npx tsx client/test/testflug-texte-vollstaendig.ts   (aus client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLIENT_ROOT, '..');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

// ── 1. Geltungsbereich (Karte T0a) ─────────────────────────────────────

const TESTFLUG_DIR = resolve(CLIENT_ROOT, 'src/editor/testflug');
const TESTFLUG_DATEINAMEN = [
  'BewuchsQuellen.ts',
  'BewuchsStufe.ts',
  'InselwahlPanel.ts',
  'LageAnzeige.ts',
  'LocalStoragePersistenz.ts',
  'OpsPersistenz.ts',
  'Testflug.ts',
  'TestflugAktionen.ts',
  'TestflugKontext.ts',
  'TestflugPersistenz.ts',
  'greifen.ts',
  'inselwahl.ts',
  'ruecksprung.ts',
  'sockel.ts',
  'vorschauZeichnen.ts',
];
const SPAWN_PANEL = resolve(CLIENT_ROOT, 'src/editor/SpawnPanel.ts');
const GEGENSTANDS_KATALOG = resolve(CLIENT_ROOT, 'src/editor/GegenstandsKatalog.ts');
const DE_KATALOG = resolve(CLIENT_ROOT, 'src/i18n/katalog/de.json');
const EN_KATALOG = resolve(CLIENT_ROOT, 'src/i18n/katalog/en.json');

/**
 * Nur der Upload-Dialog: zwei Abschnitte, keiner durchgehend — dazwischen
 * liegt "Hauptteil: Liste links, Vorschau rechts", der allgemeine Katalog
 * (T0b), den derselbe Bauabschnitt der Klasse mit aufbaut.
 *  A. die Zeile "U1: Modell-Upload" bis "Hauptteil: Liste links" (Formular).
 *  B. "hochladenStatusSchreiben" bis "private get speicherArt" (Vorschau,
 *     Hochladen, Grundskala-PATCH).
 */
function schnitt(text: string, startMarke: string, endMarke: string): string {
  const start = text.indexOf(startMarke);
  const ende = text.indexOf(endMarke);
  if (start < 0 || ende < 0 || ende <= start) {
    throw new Error(`Marken nicht gefunden ("${startMarke}" … "${endMarke}") — GegenstandsKatalog.ts umgebaut?`);
  }
  return text.slice(start, ende);
}
function uploadDialogAbschnitt(text: string): string {
  return (
    schnitt(text, 'U1: Modell-Upload', 'Hauptteil: Liste links, Vorschau rechts') +
    '\n' +
    schnitt(text, 'private hochladenStatusSchreiben', 'private get speicherArt')
  );
}

/** Blockkommentare, Zeilenkommentare und console.*-Aufrufe zaehlen nicht (Log-Zeilen duerfen deutsch bleiben). */
function nurCode(text: string): string {
  let ohne = text.replace(/\/\*[\s\S]*?\*\//g, '');
  ohne = ohne
    .split('\n')
    .map((zeile) => {
      const idx = zeile.indexOf('//');
      return idx >= 0 ? zeile.slice(0, idx) : zeile;
    })
    .join('\n');
  // Jede console.*-Zeile ist im Bestand ein Einzeiler (Handbefund T0a) —
  // bis zum Zeilenende reicht, ein mehrzeiliger Aufruf wuerde hier als
  // FUND auffallen und muesste dann eigens behandelt werden.
  ohne = ohne.replace(/console\.(log|warn|error|info)\([^\n]*/g, '');
  return ohne;
}

// ── 2. Scanner: deutsche Literale ──────────────────────────────────────

const DEUTSCHE_MARKER = /[äöüÄÖÜß]/;
const DEUTSCHE_WOERTER =
  /\b(der|die|das|und|nicht|ist|wird|kein|keine|bei|für|mit|auf|zum|zur|eine|einen|einer|noch|schon|über|unter|oder|als|wenn|bitte|gewählt|ausgewählt|gespeichert|geladen|hinzugefügt|entfernt|abgesetzt|gegriffen|platziert|sichtbar)\b/i;
/** Reine Bezeichner (Katalogschluessel wie 'testflug.platziert', Aufzaehlungswerte wie 'fehler', CSS-Werte): keine Prosa. */
const NUR_BEZEICHNER = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

/** `${…}`-Einsetzungen (bis zu einer Klammerebene tief) aus einem Template-Literal entfernen -- das ist Code (oft mit deutschen Bezeichnernamen), keine Prosa. */
function ohneEinsetzungen(inhalt: string): string {
  return inhalt.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
}

/** Alle String-/Template-Literalinhalte mit einem deutschen Marker, ausser reinen Bezeichnern. */
function deutscheLiterale(text: string): string[] {
  const treffer: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inhalt = m[2];
    if (NUR_BEZEICHNER.test(inhalt)) continue;
    const geprueft = m[1] === '`' ? ohneEinsetzungen(inhalt) : inhalt;
    if (DEUTSCHE_MARKER.test(geprueft) || DEUTSCHE_WOERTER.test(geprueft)) treffer.push(inhalt);
  }
  return treffer;
}

const gefundeneJeDatei = new Map<string, string[]>();
for (const name of TESTFLUG_DATEINAMEN) {
  const pfad = resolve(TESTFLUG_DIR, name);
  gefundeneJeDatei.set(pfad, deutscheLiterale(nurCode(readFileSync(pfad, 'utf-8'))));
}
gefundeneJeDatei.set(SPAWN_PANEL, deutscheLiterale(nurCode(readFileSync(SPAWN_PANEL, 'utf-8'))));
gefundeneJeDatei.set(
  `${GEGENSTANDS_KATALOG} (Upload-Dialog)`,
  deutscheLiterale(nurCode(uploadDialogAbschnitt(readFileSync(GEGENSTANDS_KATALOG, 'utf-8'))))
);

console.log('── 1. Deutsche Literale im T0a-Geltungsbereich ──');
let gesamtFunde = 0;
for (const [pfad, funde] of gefundeneJeDatei) {
  gesamtFunde += funde.length;
  check(`${relative(REPO_ROOT, pfad)}: keine deutschen Literale`, funde.length === 0, funde.slice(0, 5).join(' | '));
}
console.log(`  (${gesamtFunde} Fund(e) insgesamt)`);

// ── 3. Jeder verwendete Schluessel existiert in de UND en ──────────────

function katalogSchluessel(pfad: string): Set<string> {
  return new Set(Object.keys(JSON.parse(readFileSync(pfad, 'utf-8')) as Record<string, string>));
}
const deSchluessel = katalogSchluessel(DE_KATALOG);
const enSchluessel = katalogSchluessel(EN_KATALOG);

/** Schluesselartige Literale im Namensraum testflug./editor. -- Argument von `t('...')` oder Tabellenwert (z. B. BewuchsStufe.ts). */
function verwendeteSchluessel(text: string): string[] {
  const treffer = new Set<string>();
  const re = /['"`]((?:testflug|editor)\.[a-zA-Z0-9_.]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) treffer.add(m[1]);
  return [...treffer];
}

console.log('\n── 2. Verwendete Schluessel existieren in de und en ──');
const alleVerwendeten = new Set<string>();
for (const name of TESTFLUG_DATEINAMEN) {
  for (const s of verwendeteSchluessel(nurCode(readFileSync(resolve(TESTFLUG_DIR, name), 'utf-8')))) alleVerwendeten.add(s);
}
for (const s of verwendeteSchluessel(nurCode(readFileSync(SPAWN_PANEL, 'utf-8')))) alleVerwendeten.add(s);
for (const s of verwendeteSchluessel(nurCode(uploadDialogAbschnitt(readFileSync(GEGENSTANDS_KATALOG, 'utf-8'))))) alleVerwendeten.add(s);

const fehlendInDe = [...alleVerwendeten].filter((s) => !deSchluessel.has(s)).sort();
const fehlendInEn = [...alleVerwendeten].filter((s) => !enSchluessel.has(s)).sort();
check(`${alleVerwendeten.size} verwendete Schluessel existieren alle in de.json`, fehlendInDe.length === 0, fehlendInDe.join(', '));
check(`${alleVerwendeten.size} verwendete Schluessel existieren alle in en.json`, fehlendInEn.length === 0, fehlendInEn.join(', '));

console.log('');
if (failures === 0) {
  console.log('=== ALLE T0A-TEXT-PRUEFUNGEN BESTANDEN ===');
} else {
  console.error(`=== ${failures} T0A-TEXT-PRUEFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
