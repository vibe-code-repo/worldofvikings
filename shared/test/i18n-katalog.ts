/**
 * Vollstaendigkeitstest der Uebersetzungskataloge (Karte M1, gehaertet in N1).
 *
 * Prueft zwei Orte:
 *  - client/src/i18n/katalog/{de,en}.json  (Namensraeume spiel-, editor- und
 *    testflug-Praefix, heute nur bestehende, unpraefigierte Spiel-Schluessel)
 *  - shared/data/texte/{de,en}.json        (Namensraum "inhalt", gemeinsam
 *    fuer Client, Server und Webseite ueber shared/src/texte.ts)
 *
 * Je Katalogpaar (de/en):
 *  0. gueltiges JSON, ein flaches Objekt, nicht leer (kaputte Eingaben werden
 *     als FAIL-Zeile gemeldet statt den Testlauf abstuerzen zu lassen — N1/F6)
 *  0b. jeder Wert ist ein String (N1/F6)
 *  1. exakt dieselben Schluessel (keiner fehlt, keiner ist ueberzaehlig)
 *  2. dieselben Platzhalter {name} je Schluessel in beiden Sprachen
 *  3. keine leeren Texte, auch keine nur aus unsichtbaren Zeichen
 *     (Zero-Width-Space/-Joiner, BOM) bestehenden (N1/F6)
 *  4. keine doppelten Schluessel IM ROHTEXT (JSON.parse wuerde einen
 *     doppelten Schluessel stillschweigend durch den letzten ersetzen)
 *  5. stabil sortiert und 2-Leerzeichen-formatiert (git-freundlich)
 *
 * Zusaetzlich, ortsuebergreifend:
 *  6. keine Namensraum-Ueberschneidung: kein Client-Schluessel beginnt mit
 *     "inhalt.", und jeder shared-Schluessel beginnt mit "inhalt." und
 *     besteht je Punktabschnitt nur aus [a-z0-9_]
 *
 * Und, unabhaengig von den Katalogdateien, `shared/src/texte.ts`
 * (`inhaltText`) selbst (N1/F2, F3):
 *  7. Prototyp-Namen als Schluessel (`constructor`, `__proto__`, `toString`,
 *     `hasOwnProperty`, `valueOf`) liefern den echten Katalogwert bzw. den
 *     Schluessel zurueck, nie eine geerbte Funktion/[object Object]
 *  8. eine unbekannte oder fehlende Sprache (`fr`, `undefined`, `toString`,
 *     `__proto__`) faellt auf Deutsch zurueck, ohne zu werfen
 *  9. der Beispieleintrag `inhalt.item.beispiel` liefert in de und en den
 *     erwarteten Text (das ist derselbe Aufruf, den `GameI18n.tInhalt()` im
 *     Client macht, s. `client/test/menu-i18n.ts` fuer die Verdrahtung)
 *
 * Run: npx tsx shared/test/i18n-katalog.ts   (von der Repo-Wurzel)
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inhaltText } from '../src/texte.js';

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

/** Nach dem Trimmen bleiben auch unsichtbare Zeichen ohne echten Text uebrig. */
function istSichtbarLeer(wert: string): boolean {
  return wert.replace(/[​‌‍﻿]/g, '').trim() === '';
}

/** Parst den Rohtext defensiv: ungueltiges JSON oder ein Nicht-Objekt wird zur FAIL-Zeile, nicht zum Absturz. */
function parseKatalog(text: string): { obj: Record<string, unknown> | null; fehler: string | null } {
  let geparst: unknown;
  try {
    geparst = JSON.parse(text);
  } catch (fehler) {
    return { obj: null, fehler: fehler instanceof Error ? fehler.message : String(fehler) };
  }
  if (geparst === null || typeof geparst !== 'object' || Array.isArray(geparst)) {
    const art = geparst === null ? 'null' : Array.isArray(geparst) ? 'Array' : typeof geparst;
    return { obj: null, fehler: `kein flaches JSON-Objekt (${art})` };
  }
  return { obj: geparst as Record<string, unknown>, fehler: null };
}

/** Werte, die keine Strings sind (Zahl, null, Objekt, Array, verschachtelt, …). */
function nichtStringWerte(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([, wert]) => typeof wert !== 'string')
    .map(([schluessel, wert]) => {
      const art = wert === null ? 'null' : Array.isArray(wert) ? 'Array' : typeof wert;
      return `${schluessel} (${art})`;
    });
}

const alleClientSchluessel = new Set<string>();
const alleSharedSchluessel = new Set<string>();

for (const katalog of KATALOGE) {
  console.log(`\n── ${katalog.ort} ──`);

  const deRohText = leseRoh(katalog.dePfad);
  const enRohText = leseRoh(katalog.enPfad);

  const { obj: deObj, fehler: deFehler } = parseKatalog(deRohText);
  const { obj: enObj, fehler: enFehler } = parseKatalog(enRohText);
  check(`${katalog.ort}: de.json ist gueltiges JSON (flaches Objekt)`, deFehler === null, deFehler ?? '');
  check(`${katalog.ort}: en.json ist gueltiges JSON (flaches Objekt)`, enFehler === null, enFehler ?? '');
  if (!deObj || !enObj) {
    check(`${katalog.ort}: weitere Pruefungen (Schluessel, Platzhalter, Formatierung)`, false,
      'uebersprungen, JSON ungueltig');
    continue;
  }

  check(`${katalog.ort}: de-Katalog ist nicht leer`, Object.keys(deObj).length > 0);
  check(`${katalog.ort}: en-Katalog ist nicht leer`, Object.keys(enObj).length > 0);

  const deNichtString = nichtStringWerte(deObj);
  const enNichtString = nichtStringWerte(enObj);
  check(`${katalog.ort}: alle de-Werte sind ein String`, deNichtString.length === 0, deNichtString.join(', '));
  check(`${katalog.ort}: alle en-Werte sind ein String`, enNichtString.length === 0, enNichtString.join(', '));

  // Weitere Pruefungen nur auf den tatsaechlich string-wertigen Eintraegen,
  // sonst wuerde z. B. `wert.trim()` auf einer Zahl abstuerzen. Ein
  // Nicht-String-Wert ist oben bereits als eigene FAIL-Zeile gemeldet.
  const de = Object.fromEntries(
    Object.entries(deObj).filter((eintrag): eintrag is [string, string] => typeof eintrag[1] === 'string')
  );
  const en = Object.fromEntries(
    Object.entries(enObj).filter((eintrag): eintrag is [string, string] => typeof eintrag[1] === 'string')
  );

  // 4. keine doppelten Schluessel im Rohtext
  const deRoh = rohSchluessel(deRohText);
  const enRoh = rohSchluessel(enRohText);
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

  // 3. keine leeren Texte (inkl. nur unsichtbarer Zeichen)
  const leerDe = Object.entries(de).filter(([, wert]) => istSichtbarLeer(wert)).map(([k]) => k);
  const leerEn = Object.entries(en).filter(([, wert]) => istSichtbarLeer(wert)).map(([k]) => k);
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
  check(`${katalog.ort}: de.json ist kanonisch sortiert/formatiert`, deRohText === kanonisch(de));
  check(`${katalog.ort}: en.json ist kanonisch sortiert/formatiert`, enRohText === kanonisch(en));

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

// 7./8./9. inhaltText() selbst: Prototyp-Namen, Sprachrueckfall, Beispieleintrag (N1/F2, F3)
console.log('\n── inhaltText() ──');
const prototypSchluessel = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
for (const schluessel of prototypSchluessel) {
  const wert = inhaltText(schluessel, 'de');
  check(`inhaltText('${schluessel}', 'de') liefert Text, keinen Prototyp-Treffer`,
    typeof wert === 'string' && wert === schluessel, `Ergebnis: ${JSON.stringify(wert)} (${typeof wert})`);
}

const sprachRueckfaelle: (string | undefined)[] = ['fr', undefined, 'toString', '__proto__'];
for (const sprache of sprachRueckfaelle) {
  let wert: string | undefined;
  let warf = false;
  try {
    wert = inhaltText('inhalt.item.beispiel', sprache);
  } catch {
    warf = true;
  }
  check(`inhaltText(..., ${JSON.stringify(sprache)}) wirft nicht und faellt auf Deutsch zurueck`,
    !warf && wert === 'Beispieltext', warf ? 'hat geworfen' : `Ergebnis: ${JSON.stringify(wert)}`);
}

check("inhaltText('inhalt.item.beispiel', 'de') liefert den deutschen Beispieltext",
  inhaltText('inhalt.item.beispiel', 'de') === 'Beispieltext');
check("inhaltText('inhalt.item.beispiel', 'en') liefert den englischen Beispieltext",
  inhaltText('inhalt.item.beispiel', 'en') === 'Example text');
check("inhaltText('inhalt.item.unbekannt', 'de') faellt auf den Schluessel selbst zurueck",
  inhaltText('inhalt.item.unbekannt', 'de') === 'inhalt.item.unbekannt');

console.log('');
if (failures === 0) {
  console.log('=== ALLE I18N-KATALOG-TESTS BESTANDEN ===');
} else {
  console.error(`=== ${failures} I18N-KATALOG-TEST(S) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
