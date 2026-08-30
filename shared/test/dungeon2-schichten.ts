/**
 * Schichtentest fuer den Dungeon-Generator 2.0: die harte Grenze aus
 * `design/ARCHITECTURE.md` §1.1 wird durch einen Dauertest erzwungen, nicht
 * durch Disziplin. `shared/src/dungeon2/**` darf keine Engine, kein DOM, keine
 * Uhr und keinen Zufall ausserhalb des gesetzten Rng enthalten.
 * Layer test for dungeon generator 2.0: the hard boundary from
 * `design/ARCHITECTURE.md` §1.1 is enforced by a permanent test, not by
 * discipline. `shared/src/dungeon2/**` must not contain any engine, any DOM,
 * any clock, and no randomness outside the seeded rng.
 *
 *   npx tsx test/dungeon2-schichten.ts
 *
 * AP0 (`design/ARCHITECTURE.md`, Umfang 2) sollte diese Datei anlegen und hat
 * es nicht getan (siehe AP1-AP4-Berichte: "AP0 ist weiterhin nicht
 * gelaufen"). Sie wird hier nachgeholt, weil der Arbeitsauftrag zu AP5 sie
 * ausdruecklich verlangt ("Schichtentest NEGATIV geprueft"). Diese Datei
 * ersetzt AP0s Umfang 2 vollstaendig; faellt AP0 irgendwann nach, findet sie
 * hier schon eine fertige, negativ geprüfte Fassung vor.
 * AP0 (`design/ARCHITECTURE.md`, scope 2) was supposed to create this file
 * and did not (see the AP1-AP4 reports: "AP0 has still not run"). It is
 * caught up here because the AP5 work order explicitly demands it
 * ("layer test, NEGATIVELY verified"). This file fully replaces AP0's scope
 * 2; if AP0 is ever run belatedly, it will find a finished, negatively
 * verified version already in place.
 *
 * Verbotene Muster / forbidden patterns (`ARCHITECTURE.md` §1.1, AP0, W6):
 *   - Import-Spezifizierer, die mit `@babylonjs/` oder `node:` beginnen
 *     (`import ... from '@babylonjs/core'`, `require('node:fs')`, ...)
 *   - die Bezeichner `window` und `document`
 *   - `Math.random`, `Date.now`, `performance.now`
 *   - `Math.sin`, `Math.cos` (W6: Trigonometrie ist nicht Bit-treu zwischen
 *     Engines; alle Positions-Hashes muessen durch `hashing.ts` gehen)
 *   - `insideUnitCircle` (die eine bekannte trigonometrische Falle in
 *     `XorShiftRandom`, siehe W6)
 *
 * ZWEI GETRENNTE PRUEFUNGEN, aus gutem Grund / TWO SEPARATE CHECKS, for good
 * reason:
 *
 *   1. Import-Spezifizierer werden auf dem ROHEN Quelltext gesucht (eigene
 *      Regex fuer `from '...'` / `require('...')` / `import('...')`). Ein
 *      Import-Pfad IST eine Zeichenkette — wuerde man erst alle
 *      Zeichenketten entfernen (wie unten fuer Schritt 2), wuerde genau der
 *      Pfad verschwinden, den dieser Test fangen soll. Das waere ein Test,
 *      der nie etwas findet, weil er sein eigenes Beweismittel wegwirft.
 *      Import specifiers are searched in the RAW source (a dedicated regex
 *      for `from '...'` / `require('...')` / `import('...')`). An import
 *      path IS a string literal — stripping all string literals first (as
 *      step 2 does) would erase exactly the path this check is meant to
 *      catch. That would be a test that never finds anything because it
 *      throws away its own evidence.
 *   2. Bezeichner/Aufrufe (`window`, `Date.now`, ...) werden erst geprueft,
 *      NACHDEM Kommentare und Zeichenketten entfernt wurden. Grund: die
 *      Pflicht-Kommentare dieses Vorhabens NENNEN diese verbotenen Muster
 *      woertlich (siehe `generator.ts` Kopf: "kein `Math.random`, keine
 *      Uhr..."), damit ein spaeterer Leser die Regel am Modul findet. Ein
 *      Scanner, der Kommentare mitliest, faerbt jede Datei mit einem
 *      korrekten Kommentar rot — das war AP1s ausdrueckliche Warnung an AP0.
 *      Identifiers/calls (`window`, `Date.now`, ...) are checked only AFTER
 *      comments and string literals have been removed. Reason: this
 *      project's mandatory bilingual comments literally NAME these forbidden
 *      patterns (see `generator.ts`'s header: "no `Math.random`, no
 *      clock..."), so a later reader finds the rule right on the module. A
 *      scanner that reads comments too would paint every file with a correct
 *      comment red — this was AP1's explicit warning to AP0.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Die zwei Scanner / the two scanners
// ─────────────────────────────────────────────────────────────────────────────

interface Fund {
  readonly muster: string;
  readonly zeile: number;
  readonly ausschnitt: string;
}

/** Zeilennummer (1-basiert) einer Zeichenposition. / Line number (1-based) of a char offset. */
function zeileVon(quelltext: string, position: number): number {
  let zeile = 1;
  for (let i = 0; i < position && i < quelltext.length; i++) {
    if (quelltext[i] === '\n') zeile++;
  }
  return zeile;
}

/**
 * Findet Import-/Require-Spezifizierer, die mit einem verbotenen Prefix
 * beginnen. Arbeitet auf dem ROHEN Text (siehe Begruendung oben).
 * Finds import/require specifiers starting with a forbidden prefix. Works on
 * the RAW text (see rationale above).
 */
function findeVerboteneSpezifizierer(quelltext: string): Fund[] {
  const funde: Fund[] = [];
  // `from '...'` / `from "..."`, `require('...')`, `import('...')` — die drei
  // Wege, in TypeScript/ESM einen Modulpfad zu benennen.
  // `from '...'` / `from "..."`, `require('...')`, `import('...')` — the
  // three ways to name a module path in TypeScript/ESM.
  const muster = /(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(quelltext)) !== null) {
    const pfad = treffer[1]!;
    if (pfad.startsWith('@babylonjs/') || pfad === '@babylonjs' || pfad.startsWith('node:')) {
      funde.push({ muster: `Import '${pfad}'`, zeile: zeileVon(quelltext, treffer.index), ausschnitt: treffer[0] });
    }
  }
  return funde;
}

/**
 * Entfernt Kommentare und Zeichenketten (inkl. Template-Literale), Zeilen-
 * umbrueche bleiben erhalten, damit Zeilennummern stimmen. Ein einfacher
 * Zeichen-Automat statt Regex, weil Regex bei verschachtelten
 * Escape-Sequenzen leicht falsch liegt.
 * Removes comments and string literals (incl. template literals); line
 * breaks are preserved so line numbers stay correct. A simple character
 * automaton instead of regex, because regex easily gets nested escape
 * sequences wrong.
 */
function entferneKommentareUndZeichenketten(quelltext: string): string {
  let ergebnis = '';
  let i = 0;
  const n = quelltext.length;
  while (i < n) {
    const c = quelltext[i]!;
    const c2 = i + 1 < n ? quelltext[i + 1]! : '';
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && quelltext[j] !== '\n') j++;
      ergebnis += ' '.repeat(j - i);
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n - 1 && !(quelltext[j] === '*' && quelltext[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      for (let k = i; k < j; k++) ergebnis += quelltext[k] === '\n' ? '\n' : ' ';
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const anfuehrung = c;
      let j = i + 1;
      while (j < n && quelltext[j] !== anfuehrung) {
        if (quelltext[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      for (let k = i; k < j; k++) ergebnis += quelltext[k] === '\n' ? '\n' : ' ';
      i = j;
      continue;
    }
    ergebnis += c;
    i++;
  }
  return ergebnis;
}

/**
 * Findet verbotene Bezeichner/Aufrufe im bereits bereinigten Text
 * (Kommentare und Zeichenketten weg).
 * Finds forbidden identifiers/calls in the already-cleaned text (comments
 * and string literals removed).
 */
function findeVerboteneBezeichner(bereinigt: string): Fund[] {
  const muster: readonly [string, RegExp][] = [
    ['window', /\bwindow\b/g],
    ['document', /\bdocument\b/g],
    ['Math.random', /\bMath\.random\b/g],
    ['Date.now', /\bDate\.now\b/g],
    ['performance.now', /\bperformance\.now\b/g],
    ['Math.sin', /\bMath\.sin\b/g],
    ['Math.cos', /\bMath\.cos\b/g],
    ['insideUnitCircle', /\binsideUnitCircle\b/g],
  ];
  const funde: Fund[] = [];
  for (const [name, regex] of muster) {
    let treffer: RegExpExecArray | null;
    while ((treffer = regex.exec(bereinigt)) !== null) {
      funde.push({ muster: name, zeile: zeileVon(bereinigt, treffer.index), ausschnitt: treffer[0] });
    }
  }
  return funde;
}

/** Beide Pruefungen zusammen, wie sie auch auf echten Dateien laufen. / Both checks together, as run on real files. */
function scanneQuelltext(quelltext: string): Fund[] {
  return [...findeVerboteneSpezifizierer(quelltext), ...findeVerboteneBezeichner(entferneKommentareUndZeichenketten(quelltext))];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Selbsttest des Scanners an synthetischen Fixturen — NEGATIV geprueft
//    Scanner self-test on synthetic fixtures — NEGATIVELY verified
// ─────────────────────────────────────────────────────────────────────────────
//
// Diese Fixturen sind kein echter Quelltext, sondern Reizmuster: je eine
// Zeile, die genau EIN verbotenes Muster enthaelt, und eine Gegenprobe, die
// dasselbe Wort nur in einem Kommentar oder einer Zeichenkette nennt. Laeuft
// die erste rot und die zweite gruen, misst der Scanner tatsaechlich Code,
// nicht Text.
// These fixtures are not real source but stimulus patterns: one line each
// that contains exactly ONE forbidden pattern, plus a counter-check that
// names the same word only inside a comment or a string. If the first is red
// and the second is green, the scanner is actually measuring code, not text.

const POSITIV_FIXTUREN: readonly [string, string][] = [
  ['@babylonjs Import', `import { Vector3 } from '@babylonjs/core';\n`],
  ['@babylonjs Import (doppelte Anfuehrung)', `import { Scene } from "@babylonjs/core/scene";\n`],
  ['node: Import', `import { readFileSync } from 'node:fs';\n`],
  ['node: require', `const fs = require('node:fs');\n`],
  ['dynamischer node: Import', `const mod = await import('node:path');\n`],
  ['window-Bezeichner', `export function f(): number { return window.innerWidth; }\n`],
  ['document-Bezeichner', `export function f(): void { document.title = 'x'; }\n`],
  ['Math.random', `export function f(): number { return Math.random(); }\n`],
  ['Date.now', `export function f(): number { return Date.now(); }\n`],
  ['performance.now', `export function f(): number { return performance.now(); }\n`],
  ['Math.sin', `export function f(x: number): number { return Math.sin(x); }\n`],
  ['Math.cos', `export function f(x: number): number { return Math.cos(x); }\n`],
  ['insideUnitCircle', `export function f(r: { insideUnitCircle(): number }): number { return r.insideUnitCircle(); }\n`],
];

for (const [name, quelltext] of POSITIV_FIXTUREN) {
  const funde = scanneQuelltext(quelltext);
  pruefe(`Scanner findet: ${name}`, funde.length > 0, `0 Funde in: ${quelltext.trim()}`);
}

const NEGATIV_FIXTUREN: readonly [string, string][] = [
  [
    'Bilingualer Pflichtkommentar nennt die Verbote woertlich (Muster aus generator.ts)',
    `/**\n * Dieses Modul ist rein: kein Babylon, kein DOM, kein \`node:\`, kein\n` +
      ` * \`Math.random\`, keine \`Date.now\`, keine \`performance.now\`, keine\n` +
      ` * \`Math.sin\`/\`Math.cos\`, keine \`insideUnitCircle\`, kein \`window\`,\n` +
      ` * kein \`document\`.\n */\n` +
      `export function tut_nichts(): void {}\n`,
  ],
  [
    'Zeilenkommentar nennt Math.random',
    `// Math.random darf hier nicht stehen / Math.random must not appear here\nexport const x = 1;\n`,
  ],
  [
    'Zeichenkette nennt window/document als Fehlertext',
    `export function f(): string { return "window und document sind hier nur Text"; }\n`,
  ],
  [
    'Template-Literal nennt Date.now als Fehlertext',
    'export function f(name: string): string { return `Date.now() ist fuer ${name} verboten`; }\n',
  ],
  [
    '@babylonjs nur als Wort in einem Kommentar, kein Import',
    `// Ersetzt eine fruehere @babylonjs-Abhaengigkeit vollstaendig.\nexport const y = 2;\n`,
  ],
];

for (const [name, quelltext] of NEGATIV_FIXTUREN) {
  const funde = scanneQuelltext(quelltext);
  pruefe(
    `Scanner faerbt NICHT rot bei: ${name}`,
    funde.length === 0,
    `${funde.length} Funde: ${funde.map((f) => f.muster).join(', ')}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Der eigentliche Schichtentest: alle Dateien unter shared/src/dungeon2/**
//    The actual layer test: all files under shared/src/dungeon2/**
// ─────────────────────────────────────────────────────────────────────────────

const DUNGEON2_QUELLE = join(import.meta.dirname, '..', 'src', 'dungeon2');

function alleTsDateien(verzeichnis: string): string[] {
  const ergebnis: string[] = [];
  for (const eintrag of readdirSync(verzeichnis).sort()) {
    const pfad = join(verzeichnis, eintrag);
    const info = statSync(pfad);
    if (info.isDirectory()) {
      ergebnis.push(...alleTsDateien(pfad));
    } else if (eintrag.endsWith('.ts')) {
      ergebnis.push(pfad);
    }
  }
  return ergebnis;
}

const dateien = alleTsDateien(DUNGEON2_QUELLE);
pruefe('shared/src/dungeon2/ enthaelt .ts-Dateien zum Scannen', dateien.length > 0, `gefunden: ${dateien.length}`);

let gesamtFunde = 0;
let ersterVerstoss = '';
for (const pfad of dateien) {
  const quelltext = readFileSync(pfad, 'utf-8');
  const funde = scanneQuelltext(quelltext);
  gesamtFunde += funde.length;
  if (funde.length > 0 && ersterVerstoss === '') {
    ersterVerstoss = `${pfad}:${funde[0]!.zeile} — ${funde[0]!.muster} ("${funde[0]!.ausschnitt}")`;
  }
}
pruefe(
  `shared/src/dungeon2/** (${dateien.length} Dateien) enthaelt keine verbotenen Muster`,
  gesamtFunde === 0,
  ersterVerstoss
);

// Gegenprobe zur Kommentar-Falle: der ROHE Text der echten Dateien MUSS
// Treffer fuer `node:` und "Babylon" enthalten (die Pflichtkommentare nennen
// sie woertlich) — sonst waere die vorige Pruefung nur gruen, weil niemand
// je etwas geschrieben hat, das gefiltert werden musste.
// Counter-check for the comment trap: the RAW text of the real files MUST
// contain hits for `node:` and "Babylon" (the mandatory comments name them
// literally) — otherwise the previous check would only be green because
// nobody ever wrote anything that needed filtering.
{
  let rohTrefferNode = 0;
  let rohTrefferBabylon = 0;
  for (const pfad of dateien) {
    const quelltext = readFileSync(pfad, 'utf-8');
    if (quelltext.includes('node:')) rohTrefferNode++;
    if (quelltext.toLowerCase().includes('babylon')) rohTrefferBabylon++;
  }
  pruefe(
    'Gegenprobe: die echten Dateien nennen `node:` woertlich in Kommentaren (die Bereinigung hat also etwas zu tun)',
    rohTrefferNode > 0,
    `0 Treffer ueber ${dateien.length} Dateien — verdaechtig, siehe AP1-Warnung an AP0`
  );
  pruefe(
    'Gegenprobe: die echten Dateien nennen "Babylon" woertlich in Kommentaren',
    rohTrefferBabylon > 0,
    `0 Treffer ueber ${dateien.length} Dateien`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ergebnis / result
// ─────────────────────────────────────────────────────────────────────────────

console.log(`dungeon2-schichten: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
