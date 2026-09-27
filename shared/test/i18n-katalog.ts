/**
 * Vollstaendigkeitstest der Uebersetzungskataloge (Karte M1).
 *
 * Prueft zwei Orte:
 *  - client/src/i18n/katalog/{de,en}.json  (Namensraeume spiel-, editor- und
 *    testflug-Praefix, heute nur bestehende, unpraefigierte Spiel-Schluessel)
 *  - shared/data/texte/{de,en}.json        (Namensraum "inhalt", gemeinsam
 *    fuer Client, Server und Webseite ueber shared/src/texte.ts)
 *
 * Je Katalogpaar (de/en):
 *  1. exakt dieselben Schluessel (keiner fehlt, keiner ist ueberzaehlig)
 *  2. dieselben Platzhalter {name} je Schluessel in beiden Sprachen
 *  3. keine leeren Texte
 *  4. keine doppelten Schluessel IM ROHTEXT (JSON.parse wuerde einen
 *     doppelten Schluessel stillschweigend durch den letzten ersetzen)
 *  5. stabil sortiert und 2-Leerzeichen-formatiert (git-freundlich)
 *
 * Zusaetzlich, ortsuebergreifend:
 *  6. keine Namensraum-Ueberschneidung: kein Client-Schluessel beginnt mit
 *     "inhalt.", und jeder shared-Schluessel beginnt mit "inhalt." und
 *     besteht je Punktabschnitt nur aus [a-z0-9_]
 *
 * Run: npx tsx shared/test/i18n-katalog.ts   (von der Repo-Wurzel)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

interface Katalog {
  readonly ort: string;
  readonly dePfad: string;
  readonly enPfad: string;
  /** Jeder Schluessel muss dieses Muster erfuellen (Zeichenregel je Namensraum). */
  readonly schluesselMuster: RegExp;
  readonly schluesselErlaubtHinweis: string;
}

const KATALOGE: readonly Katalog[] = [
  {
    ort: 'client',
    dePfad: resolve(REPO_ROOT, 'client/src/i18n/katalog/de.json'),
    enPfad: resolve(REPO_ROOT, 'client/src/i18n/katalog/en.json'),
    // Bestehende Schluessel wurden nicht umbenannt (unnoetiger Diff). Neue
    // Schluessel sollen editor.*/testflug.* tragen (T0a); "inhalt." bleibt
    // dem shared-Katalog vorbehalten (Pruefung 6 unten).
    schluesselMuster: /^[a-zA-Z][a-zA-Z0-9_.-]*$/,
    schluesselErlaubtHinweis: 'Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich',
  },
  {
    ort: 'shared (inhalt.*)',
    dePfad: resolve(REPO_ROOT, 'shared/data/texte/de.json'),
    enPfad: resolve(REPO_ROOT, 'shared/data/texte/en.json'),
    // Verbindlich fuer Spielinhalte (Karte M1, Punkt 2): jeder Punktabschnitt
    // nur [a-z0-9_], kein Grossbuchstabe, kein Bindestrich.
    schluesselMuster: /^inhalt(\.[a-z0-9_]+)+$/,
    schluesselErlaubtHinweis: 'inhalt.<bereich>.<id>, id nur [a-z0-9_]',
  },
];

function leseRoh(pfad: string): string {
  return readFileSync(pfad, 'utf-8');
}

/** Schluessel aus dem ROHTEXT einer flachen, 2-Leerzeichen eingerueckten JSON-Datei. */
function rohSchluessel(text: string): string[] {
  const zeile = /^ {2}"((?:[^"\\]|\\.)*)":/gm;
  const gefunden: string[] = [];
  let treffer: RegExpExecArray | null;
  while ((treffer = zeile.exec(text))) {
    gefunden.push(JSON.parse(`"${treffer[1]}"`));
  }
  return gefunden;
}

function kanonisch(obj: Record<string, string>): string {
  const sortiert: Record<string, string> = {};
  for (const schluessel of Object.keys(obj).sort()) sortiert[schluessel] = obj[schluessel];
  return `${JSON.stringify(sortiert, null, 2)}\n`;
}

function platzhalter(wert: string): string[] {
  const gefunden = new Set<string>();
  for (const treffer of wert.matchAll(/\{([^}]+)\}/g)) gefunden.add(treffer[1]);
  return [...gefunden].sort();
}

const alleClientSchluessel = new Set<string>();
const alleSharedSchluessel = new Set<string>();

for (const katalog of KATALOGE) {
  console.log(`\n── ${katalog.ort} ──`);

  const deText = leseRoh(katalog.dePfad);
  const enText = leseRoh(katalog.enPfad);
  const de = JSON.parse(deText) as Record<string, string>;
  const en = JSON.parse(enText) as Record<string, string>;

  // 4. keine doppelten Schluessel im Rohtext
  const deRoh = rohSchluessel(deText);
  const enRoh = rohSchluessel(enText);
  check(`${katalog.ort}: de hat keine doppelten Schluessel im Rohtext`, deRoh.length === Object.keys(de).length,
    `${deRoh.length} Zeilen vs. ${Object.keys(de).length} eindeutige Schluessel`);
  check(`${katalog.ort}: en hat keine doppelten Schluessel im Rohtext`, enRoh.length === Object.keys(en).length,
    `${enRoh.length} Zeilen vs. ${Object.keys(en).length} eindeutige Schluessel`);

  // 1. exakt dieselben Schluessel
  const deKeys = Object.keys(de).sort();
  const enKeys = Object.keys(en).sort();
  const nurDe = deKeys.filter((k) => !(k in en));
  const nurEn = enKeys.filter((k) => !(k in de));
  check(`${katalog.ort}: kein Schluessel fehlt in en`, nurDe.length === 0, nurDe.join(', '));
  check(`${katalog.ort}: kein Schluessel ist ueberzaehlig in en`, nurEn.length === 0, nurEn.join(', '));

  // 3. keine leeren Texte
  const leerDe = Object.entries(de).filter(([, wert]) => wert.trim() === '').map(([k]) => k);
  const leerEn = Object.entries(en).filter(([, wert]) => wert.trim() === '').map(([k]) => k);
  check(`${katalog.ort}: de hat keine leeren Texte`, leerDe.length === 0, leerDe.join(', '));
  check(`${katalog.ort}: en hat keine leeren Texte`, leerEn.length === 0, leerEn.join(', '));

  // 2. gleiche Platzhalter je Schluessel
  const platzhalterAbweichungen: string[] = [];
  for (const schluessel of deKeys) {
    if (!(schluessel in en)) continue;
    const dePh = platzhalter(de[schluessel]);
    const enPh = platzhalter(en[schluessel]);
    if (JSON.stringify(dePh) !== JSON.stringify(enPh)) {
      platzhalterAbweichungen.push(`${schluessel}: de=[${dePh}] en=[${enPh}]`);
    }
  }
  check(`${katalog.ort}: Platzhalter stimmen je Schluessel ueberein`, platzhalterAbweichungen.length === 0,
    platzhalterAbweichungen.join(' | '));

  // 5. stabil sortiert und formatiert
  check(`${katalog.ort}: de.json ist kanonisch sortiert/formatiert`, deText === kanonisch(de));
  check(`${katalog.ort}: en.json ist kanonisch sortiert/formatiert`, enText === kanonisch(en));

  // Zeichenregel je Namensraum
  const ungueltigDe = deKeys.filter((k) => !katalog.schluesselMuster.test(k));
  const ungueltigEn = enKeys.filter((k) => !katalog.schluesselMuster.test(k));
  check(`${katalog.ort}: de-Schluessel erfuellen die Zeichenregel (${katalog.schluesselErlaubtHinweis})`,
    ungueltigDe.length === 0, ungueltigDe.join(', '));
  check(`${katalog.ort}: en-Schluessel erfuellen die Zeichenregel (${katalog.schluesselErlaubtHinweis})`,
    ungueltigEn.length === 0, ungueltigEn.join(', '));

  for (const k of deKeys) (katalog.ort === 'client' ? alleClientSchluessel : alleSharedSchluessel).add(k);
}

// 6. keine Namensraum-Ueberschneidung zwischen Client und shared
console.log('\n── Namensraum-Grenze ──');
const clientMitInhalt = [...alleClientSchluessel].filter((k) => k.startsWith('inhalt.'));
check('kein Client-Schluessel traegt den Namensraum inhalt.* (dem shared-Katalog vorbehalten)',
  clientMitInhalt.length === 0, clientMitInhalt.join(', '));
const sharedOhneInhalt = [...alleSharedSchluessel].filter((k) => !k.startsWith('inhalt.'));
check('jeder shared-Schluessel traegt den Namensraum inhalt.*',
  sharedOhneInhalt.length === 0, sharedOhneInhalt.join(', '));

console.log('');
if (failures === 0) {
  console.log('=== ALLE I18N-KATALOG-TESTS BESTANDEN ===');
} else {
  console.error(`=== ${failures} I18N-KATALOG-TEST(S) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
