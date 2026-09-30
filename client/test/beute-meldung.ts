/**
 * D5 — the loot and inventory messages reach the player translated. The server sends `@key` or `@key|{json}` in the
 * message field of InteractResult; every key it can send (`BEUTE_MELDUNG_SCHLUESSEL` in shared/src/beute.ts) must be
 * in BOTH catalogues, and the parameters fill the `{name}` placeholders (creature and item names translated).
 *
 * Run: npx tsx client/test/beute-meldung.ts
 */
import {
  BEUTE_MELDUNG_SCHLUESSEL,
  SERVER_MELDUNG_BEUTE_FREMD,
  SERVER_MELDUNG_INVENTAR_VOLL,
  serverMeldungAufgesammelt,
  serverMeldungBesiegt,
  serverMeldungVollRest,
  ersetzeDatenTexte,
  zerlegeServerMeldung,
} from '@wov/shared';
import de from '../src/i18n/katalog/de.json';
import en from '../src/i18n/katalog/en.json';

(globalThis as { document?: unknown }).document = { documentElement: {} };
const { GameI18n } = await import('../src/i18n/index.js');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const deutsch = new GameI18n('de');
const englisch = new GameI18n('en');
const katalogDe = de as Record<string, string>;
const katalogEn = en as Record<string, string>;

// 1. every key the server can send is in both catalogues
for (const [name, schluessel] of Object.entries(BEUTE_MELDUNG_SCHLUESSEL)) {
  check(`key ${name} = "${schluessel}" is in de and en (not empty)`, !!katalogDe[schluessel] && !!katalogEn[schluessel]);
}
check('the two constants without parameters are "@" + their key', SERVER_MELDUNG_BEUTE_FREMD === '@beute.fremd' && SERVER_MELDUNG_INVENTAR_VOLL === '@inventory.full');

// 2. the messages as the server builds them become text, in both languages, with no placeholder left over
const faelle: Array<[string, string, RegExp, RegExp]> = [
  ['besiegt Kuh', serverMeldungBesiegt('Kuh'), /^Kuh besiegt$/, /^Cow defeated$/],
  ['aufgesammelt 3 × RawMeat', serverMeldungAufgesammelt('RawMeat', 3, 0), /^Aufgesammelt: 3 × Rohes Fleisch$/, /^Picked up: 3 × Raw meat$/],
  ['aufgesammelt 1, Rest 2', serverMeldungAufgesammelt('RawMeat', 1, 2), /^Aufgesammelt: 1 × Rohes Fleisch, 2 liegen geblieben$/, /^Picked up: 1 × Raw meat, 2 left behind$/],
  ['voll mit Rest', serverMeldungVollRest('Wood', 7), /^Inventar voll, 7 × Holz liegen geblieben$/, /^Inventory full, 7 × Wood left behind$/],
  ['voll', SERVER_MELDUNG_INVENTAR_VOLL, /^Inventar voll$/, /^Inventory full$/],
  ['fremd', SERVER_MELDUNG_BEUTE_FREMD, /^Diese Beute gehört einem anderen Spieler$/, /^This loot belongs to another player$/],
];
for (const [label, meldung, reDe, reEn] of faelle) {
  const d = deutsch.serverMeldung(meldung);
  const e = englisch.serverMeldung(meldung);
  check(`${label}: de "${d}"`, reDe.test(d) && !d.includes('{'));
  check(`${label}: en "${e}"`, reEn.test(e) && !e.includes('{'));
}

// 3. the wire form is readable back, and damaged or hostile parameters never hide the message
const z = zerlegeServerMeldung(serverMeldungAufgesammelt('Stone', 4, 1));
check('the wire form splits into key and parameters', z?.schluessel === 'beute.aufgesammelt_teil' && z.parameter.item === 'Stone' && z.parameter.menge === 4 && z.parameter.rest === 1, JSON.stringify(z));
check('a plain text is not a message', zerlegeServerMeldung('Du bist gestorben') === null);
check('damaged parameters: the text shows with its placeholders, no crash', englisch.serverMeldung('@beute.besiegt|{kaputt') === '{kreatur} defeated', englisch.serverMeldung('@beute.besiegt|{kaputt'));
check('an unknown creature name is shown as sent', englisch.serverMeldung(serverMeldungBesiegt('Brandmarder')) === 'Brandmarder defeated');
check('a prototype name as parameter is no name (nothing leaks)', englisch.serverMeldung('@beute.besiegt|{"__proto__":{"kreatur":"x"},"kreatur":"Kuh"}') === 'Cow defeated');
check('an unknown key passes through', englisch.serverMeldung('@gibt.es.nicht|{"a":1}') === '@gibt.es.nicht|{"a":1}');

// 4. N2-a: the middle of the name chain `beute.name.*` -> `inhalt.item.*` -> as sent (the way of data items)
check('the item of the content texts is in neither beute.name.* nor is it a creature', !('beute.name.beispiel' in katalogDe) && !('beute.name.beispiel' in katalogEn));
check('a name only in inhalt.item.* (repo texts) is shown translated, de', deutsch.serverMeldung(serverMeldungAufgesammelt('beispiel', 2, 0)) === 'Aufgesammelt: 2 × Beispieltext', deutsch.serverMeldung(serverMeldungAufgesammelt('beispiel', 2, 0)));
check('a name only in inhalt.item.* (repo texts) is shown translated, en (not the German text, not the raw name)', /^Picked up: 2 × (?!beispiel$)(?!Beispieltext$)\S.*$/.test(englisch.serverMeldung(serverMeldungAufgesammelt('beispiel', 2, 0))), englisch.serverMeldung(serverMeldungAufgesammelt('beispiel', 2, 0)));
ersetzeDatenTexte({ de: new Map([['inhalt.item.datending', 'Datendings']]), en: new Map([['inhalt.item.datending', 'Data thing']]) });
check('a data item (data-text layer) is shown translated, de', deutsch.serverMeldung(serverMeldungBesiegt('datending')) === 'Datendings besiegt', deutsch.serverMeldung(serverMeldungBesiegt('datending')));
check('a data item (data-text layer) is shown translated, en', englisch.serverMeldung(serverMeldungVollRest('datending', 4)) === 'Inventory full, 4 × Data thing left behind', englisch.serverMeldung(serverMeldungVollRest('datending', 4)));
check('a name in no catalogue stays as sent', englisch.serverMeldung(serverMeldungAufgesammelt('Nirgendwo', 1, 0)) === 'Picked up: 1 × Nirgendwo');

// 5. N2-b: a number that is not finite is no parameter (1e999 reads as Infinity), the placeholder stays visible
const unendlich = zerlegeServerMeldung('@beute.aufgesammelt|{"item":"Stone","menge":1e999}');
check('Infinity is dropped from the parameters, the rest stays', !!unendlich && !('menge' in unendlich.parameter) && unendlich.parameter.item === 'Stone', JSON.stringify(unendlich));
check('a message with Infinity shows the placeholder, not "Infinity"', englisch.serverMeldung('@beute.aufgesammelt|{"item":"Stone","menge":1e999}') === 'Picked up: {menge} × Stone', englisch.serverMeldung('@beute.aufgesammelt|{"item":"Stone","menge":1e999}'));
check('-Infinity likewise', !('rest' in (zerlegeServerMeldung('@beute.aufgesammelt_teil|{"rest":-1e999}')?.parameter ?? { rest: 0 })));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
