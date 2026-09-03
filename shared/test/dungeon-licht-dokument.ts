/**
 * Rot-Test — „Grundbeleuchtung" je DUNGEON-DOKUMENT (1.0).
 * Red test — per-DOCUMENT base brightness (1.0 format).
 *
 *   npx tsx shared/test/dungeon-licht-dokument.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * VOR DER UMSETZUNG ROT: `DungeonDocument.ambientLicht` und
 * `ambientLichtVon()` existieren noch nicht (Annahme dieses Tests) — der
 * Import selbst ist damit schon der rote Befund.
 *
 * Erwartet wird, im Muster von `steinKit`/`props` (additiv):
 *   - `DungeonDocument.ambientLicht?: number` — Grundhelligkeit, 0..3.
 *     Fehlend heisst „wie bisher" (Wirkung 1); der Sanitizer ERFINDET das
 *     Feld nicht, sonst waere ein Altdokument nach dem Laden ein anderes.
 *   - `sanitizeDungeonDocument` klemmt auf [0, 3] und nimmt NUR endliche
 *     Zahlen an — Text, NaN und Unendlich lassen das Feld ungesetzt statt
 *     das Dokument ungueltig zu machen (dieselbe Milde wie bei 2.0).
 *   - `ambientLichtVon(doc)` — die EINE Stelle, an der aus „fehlt" eine 1
 *     wird. Ohne sie stuende der Ersatzwert an jeder Aufrufstelle neu und
 *     driftete dort auseinander, wo ihn niemand ansieht.
 *   - `DUNGEON_DOCUMENT_VERSION` 4 → 5.
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Geprueft wird:
 *  1. 2.5 laeuft unveraendert durch (der Bereich geht ausdruecklich UEBER 1
 *     hinaus — heller als die Umgebung ist ein gueltiger Wunsch).
 *  2. 9 wird auf 3 geklemmt, -1 auf 0. 0 bleibt 0 und faellt NICHT auf die
 *     Vorgabe zurueck — stockdunkel ist eine Angabe, kein fehlendes Feld.
 *  3. 'abc' (und NaN/Infinity) werden verworfen: Dokument bleibt gueltig,
 *     Feld bleibt ungesetzt.
 *  4. Ein Altdokument OHNE das Feld laeuft byte-gleich weiter.
 *  5. `ambientLichtVon` liefert 1 beim fehlenden Feld, sonst den Wert.
 *  6. Die Dokumentfassung steht auf 5.
 */

import {
  DUNGEONS_BY_NAME,
  generateDungeonLayout,
  sanitizeDungeonDocument,
  DUNGEON_DOCUMENT_VERSION,
  // ANNAHME dieses Tests (s. o.) — existiert vor der Umsetzung noch nicht.
  // ASSUMPTION of this test — does not exist yet before implementation.
  ambientLichtVon,
} from '../src/index.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

// ── Grunddokument (DG_Steingrab, wie in den anderen Sanitizer-Tests) ──────

const kit = DUNGEONS_BY_NAME.get('DG_Steingrab')!;
const layout = generateDungeonLayout(kit, 7);
const basisDoc = {
  version: DUNGEON_DOCUMENT_VERSION,
  id: 'test-licht-1',
  name: 'Testgrab',
  base: 'DG_Steingrab',
  mode: 'generated' as const,
  seed: 7,
  zoneSize: 64,
  layout,
};

/** Kurzform: rohes Dokument mit `ambientLicht` saeubern. */
function mitLicht(wert: unknown) {
  return sanitizeDungeonDocument(
    JSON.parse(JSON.stringify({ ...basisDoc, ambientLicht: wert }))
  );
}

// ── 0. Dokumentfassung ────────────────────────────────────────────────────

console.log('Dokumentfassung:');
// Bewusst die nackte Zahl statt der Konstante — gegen die Konstante
// geprueft waere die Zeile immer wahr und bezeugte nichts (g8-Muster).
check('DUNGEON_DOCUMENT_VERSION ist 5', DUNGEON_DOCUMENT_VERSION === 5, String(DUNGEON_DOCUMENT_VERSION));

// ── 1. Gueltiger Wert bleibt erhalten ─────────────────────────────────────

console.log('\nGueltige Werte:');
check('2.5 laeuft unveraendert durch', mitLicht(2.5)?.ambientLicht === 2.5, String(mitLicht(2.5)?.ambientLicht));
check('1 laeuft unveraendert durch', mitLicht(1)?.ambientLicht === 1, String(mitLicht(1)?.ambientLicht));
check(
  '0 bleibt 0 (kein Rueckfall auf die Vorgabe)',
  mitLicht(0)?.ambientLicht === 0,
  String(mitLicht(0)?.ambientLicht)
);
check('3 (Obergrenze) laeuft unveraendert durch', mitLicht(3)?.ambientLicht === 3, String(mitLicht(3)?.ambientLicht));

// ── 2. Klemmen ────────────────────────────────────────────────────────────

console.log('\nKlemmen auf [0, 3]:');
check('9 wird auf 3 geklemmt', mitLicht(9)?.ambientLicht === 3, String(mitLicht(9)?.ambientLicht));
check('-1 wird auf 0 geklemmt', mitLicht(-1)?.ambientLicht === 0, String(mitLicht(-1)?.ambientLicht));

// ── 3. Unbrauchbares wird verworfen, nicht ersetzt ────────────────────────

console.log('\nUnbrauchbare Angaben:');
// Beschriftung ueber `String(...)`, NICHT ueber `JSON.stringify`: NaN und
// Infinity werden dort beide zu "null", und zwei rote Zeilen mit demselben
// Namen sagen einem nicht, welcher Fall gefallen ist.
const KAPUTT: [string, unknown][] = [
  ['abc', 'abc'],
  ['null', null],
  ['{}', {}],
  ['[]', []],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
];
for (const [name, kaputt] of KAPUTT) {
  const s = mitLicht(kaputt);
  check(`${name} macht das Dokument NICHT ungueltig`, s !== null);
  check(
    `${name} laesst das Feld ungesetzt`,
    s !== null && s.ambientLicht === undefined,
    String(s?.ambientLicht)
  );
}

// ── 4. Altdokument ohne das Feld laeuft byte-gleich weiter ────────────────

console.log('\nAltdokument ohne ambientLicht (props-Muster):');
const altSauber = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc)));
check('Altdokument bleibt gueltig', altSauber !== null);
check(
  'ambientLicht bleibt weg, wird nicht erfunden',
  altSauber !== null && altSauber.ambientLicht === undefined,
  String(altSauber?.ambientLicht)
);
const nochmal = sanitizeDungeonDocument(JSON.parse(JSON.stringify(basisDoc)));
check(
  'Altdokument saeubert sich byte-gleich (kein neues Feld, keine Umsortierung)',
  JSON.stringify(nochmal) === JSON.stringify(altSauber)
);
check(
  'Das gesaeuberte Altdokument traegt das Feld auch im JSON nicht',
  !JSON.stringify(altSauber).includes('ambientLicht'),
  JSON.stringify(altSauber).slice(0, 80)
);

// ── 5. ambientLichtVon: die EINE Stelle fuer den Ersatzwert ───────────────

console.log('\nambientLichtVon:');
check('fehlendes Feld -> 1', altSauber !== null && ambientLichtVon(altSauber) === 1, String(altSauber && ambientLichtVon(altSauber)));
const hell = mitLicht(2.5);
check('gesetztes Feld -> der Wert', hell !== null && ambientLichtVon(hell) === 2.5, String(hell && ambientLichtVon(hell)));
const dunkel = mitLicht(0);
check('0 -> 0, nicht 1', dunkel !== null && ambientLichtVon(dunkel) === 0, String(dunkel && ambientLichtVon(dunkel)));

// ── 6. Rundlauf durch JSON ────────────────────────────────────────────────

console.log('\nJSON hin und zurueck:');
const rund = sanitizeDungeonDocument(JSON.parse(JSON.stringify(hell)));
check('2.5 ueberlebt Speichern/Laden', rund?.ambientLicht === 2.5, String(rund?.ambientLicht));

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAlle Grundbeleuchtungs-Pruefungen gruen.');
