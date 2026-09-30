/**
 * Editor card EG2: the text of the confirmation dialog (`bestaetigungsInhalt`), DOM-free.
 * Editor-Karte EG2: der Satz des Bestaetigungsdialogs, DOM-frei gebaut und hier geprueft.
 *
 * Mike's rule (29.09.): a deleted item vanishes for good after a confirmation, also every copy in inventories and
 * chests; the dialog says WHICH items, HOW MANY, and that it is FINAL, in both languages. The counts come from the
 * 409 answer of the route (`entfernt` + `entferntOhneId`); the answer is fed through the real API client here.
 *
 *  [1] one item: count, name and id, "endgueltig" / "permanently", inventories and chests
 *  [2] several items: count = named ids + unreadable entries, every name in the sentence
 *  [3] a 409 answer of the route, through `speichere`, into the dialog text (both lists counted)
 *  [4] overwriting a broken working file: says why and that a backup stays; no removal count
 *  [5] buttons: the destructive answer is named as such, "cancel" exists, both languages
 *  [6] N1 finding 2: every name stands ONCE (list, not sentence), more than ten = ten lines + "and N more",
 *      the count stays right, raw ids are shortened to 40 characters and control / bidi characters are made visible
 *  [7] N1 finding 6: the dialog before removing an item that other recipes need: names each dependent once, same limits
 *
 * Run: npx tsx test/editor-gegenstaende-dialog.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { speichere } from '../src/editor/gegenstaende/api';
import { abhaengigkeitsInhalt, bestaetigungsInhalt, sichtbarKuerzen, type BestaetigungInfo, type Uebersetzer } from '../src/editor/gegenstaende/texte';

let fehler = 0;
function check(name: string, ok: boolean, zusatz = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && zusatz ? ` (${zusatz})` : ''}`);
  if (!ok) fehler++;
}

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KATALOG = {
  de: JSON.parse(readFileSync(resolve(CLIENT, 'src/i18n/katalog/de.json'), 'utf-8')) as Record<string, string>,
  en: JSON.parse(readFileSync(resolve(CLIENT, 'src/i18n/katalog/en.json'), 'utf-8')) as Record<string, string>,
};
const uebersetzer = (sprache: 'de' | 'en'): Uebersetzer => (key, vars = {}) =>
  KATALOG[sprache][key].replace(/\{([^}]+)\}/g, (tok, n: string) => (Object.hasOwn(vars, n) ? String(vars[n]) : tok));
const ENDGUELTIG = { de: 'endgültig', en: 'permanently' } as const;
const NAMEN: Record<string, string> = { Holzaxt: 'Holzaxt', Feder: 'Feather', Zweig: 'Zweig' };
const name = (id: string): string | null => (Object.hasOwn(NAMEN, id) ? NAMEN[id] : null);

console.log('\n[1] Ein Gegenstand:');
for (const sprache of ['de', 'en'] as const) {
  const info: BestaetigungInfo = { art: 'entfernen', entfernt: ['Feder'], entferntOhneId: [] };
  const inhalt = bestaetigungsInhalt(info, name, uebersetzer(sprache));
  const alles = `${inhalt.titel} ${inhalt.satz}`;
  check(`${sprache}: Anzahl 1 im Satz, Name und Kennung in der Liste`, inhalt.satz.includes('1') && inhalt.punkte.join('|').includes('Feather (Feder)'), inhalt.satz);
  check(`${sprache}: "${ENDGUELTIG[sprache]}" im Satz und im Titel`, inhalt.satz.includes(ENDGUELTIG[sprache]) && inhalt.titel.includes(ENDGUELTIG[sprache]), alles);
  check(`${sprache}: nennt Inventare und Truhen`, sprache === 'de' ? /Inventaren und Truhen/.test(inhalt.satz) : /inventories and chests/.test(inhalt.satz));
  check(`${sprache}: keine offenen Platzhalter`, !/\{[a-z]+\}/.test(alles));
  check(`${sprache}: eine Zeile je Gegenstand`, inhalt.punkte.length === 1 && inhalt.punkte[0] === 'Feather (Feder)');
}

console.log('\n[2] Mehrere Gegenstaende:');
for (const sprache of ['de', 'en'] as const) {
  const info: BestaetigungInfo = { art: 'entfernen', entfernt: ['Holzaxt', 'Feder', 'Unbekannt'], entferntOhneId: ['#4', '#7'] };
  const inhalt = bestaetigungsInhalt(info, name, uebersetzer(sprache));
  check(`${sprache}: Anzahl 5 = 3 Kennungen + 2 Eintraege ohne Kennung`, inhalt.satz.includes('5'), inhalt.satz);
  check(`${sprache}: jeder Name steht in der Liste`, ['Holzaxt', 'Feather (Feder)', 'Unbekannt', '#4', '#7'].every((n) => inhalt.punkte.some((p) => p.includes(n))), JSON.stringify(inhalt.punkte));
  check(`${sprache}: "${ENDGUELTIG[sprache]}" steht im Satz`, inhalt.satz.includes(ENDGUELTIG[sprache]));
  check(`${sprache}: Name = Kennung wird nur einmal gezeigt, unbekannte Kennung allein`, inhalt.punkte[0] === 'Holzaxt' && inhalt.punkte[2] === 'Unbekannt', JSON.stringify(inhalt.punkte));
  check(`${sprache}: Zeile fuer den Eintrag ohne Kennung nennt die Position`, inhalt.punkte.length === 5 && inhalt.punkte[3].includes('#4') && inhalt.punkte[4].includes('#7'));
}

console.log('\n[3] Antwort 409 der Route -> Dialogtext:');
{
  const antwort = {
    ok: false,
    fehler: 'brauchtBestaetigung',
    brauchtBestaetigung: true,
    entfernt: ['Holzaxt', 'Zweig'],
    entferntOhneId: ['#3'],
    hash: 'a'.repeat(64),
    message: 'egal',
  };
  const erg = await speichere({ fetcher: async () => new Response(JSON.stringify(antwort), { status: 409, headers: { 'content-type': 'application/json' } }) }, [], 'b'.repeat(64));
  check('der Client macht daraus `bestaetigung` mit beiden Listen', erg.art === 'bestaetigung' && erg.info.art === 'entfernen' && erg.info.entfernt.join() === 'Holzaxt,Zweig' && erg.info.entferntOhneId.join() === '#3', JSON.stringify(erg));
  if (erg.art === 'bestaetigung') {
    for (const sprache of ['de', 'en'] as const) {
      const inhalt = bestaetigungsInhalt(erg.info, name, uebersetzer(sprache));
      check(`${sprache}: Anzahl 3, beide Namen, Eintrag ohne Kennung, "${ENDGUELTIG[sprache]}"`, inhalt.satz.includes('3') && ['Holzaxt', 'Zweig', '#3'].every((n) => inhalt.punkte.some((p) => p.includes(n))) && inhalt.satz.includes(ENDGUELTIG[sprache]), inhalt.satz);
    }
  }
  const kaputt = await speichere({ fetcher: async () => new Response(JSON.stringify({ ok: false, fehler: 'alter-stand-kaputt', brauchtBestaetigung: true, dateiFehler: 'datei-kein-json', hash: 'c'.repeat(64) }), { status: 409 }) }, [], 'd'.repeat(64));
  check('alter-stand-kaputt wird als eigene Art erkannt', kaputt.art === 'bestaetigung' && kaputt.info.art === 'alter-stand-kaputt' && kaputt.info.dateiFehler === 'datei-kein-json', JSON.stringify(kaputt));
}

console.log('\n[4] Kaputte Arbeitsdatei ersetzen:');
for (const sprache of ['de', 'en'] as const) {
  const inhalt = bestaetigungsInhalt({ art: 'alter-stand-kaputt', entfernt: [], entferntOhneId: [], dateiFehler: 'datei-kein-json' }, name, uebersetzer(sprache));
  check(`${sprache}: nennt den Grund (kein JSON) und die Sicherung`, inhalt.satz.includes(KATALOG[sprache]['editor.gegenstand.route.datei_kein_json']) && (sprache === 'de' ? /Sicherung/.test(inhalt.satz) : /backup/.test(inhalt.satz)), inhalt.satz);
  check(`${sprache}: keine Liste von Gegenstaenden`, inhalt.punkte.length === 0);
  check(`${sprache}: unbekannter Dateifehler wird trotzdem genannt`, bestaetigungsInhalt({ art: 'alter-stand-kaputt', entfernt: [], entferntOhneId: [], dateiFehler: 'neu-und-fremd' }, name, uebersetzer(sprache)).satz.includes('neu-und-fremd'));
}

console.log('\n[5] Knoepfe:');
for (const sprache of ['de', 'en'] as const) {
  const inhalt = bestaetigungsInhalt({ art: 'entfernen', entfernt: ['Feder'], entferntOhneId: [] }, name, uebersetzer(sprache));
  check(`${sprache}: der Knopf zum Loeschen sagt "${ENDGUELTIG[sprache]}" / entfernen, Abbrechen ist ein anderer Text`, inhalt.bestaetigen.length > 3 && inhalt.abbrechen.length > 3 && inhalt.bestaetigen !== inhalt.abbrechen && inhalt.bestaetigen.toLowerCase().includes(ENDGUELTIG[sprache]), `${inhalt.bestaetigen} / ${inhalt.abbrechen}`);
}

const vorkommen = (heu: string, nadel: string): number => heu.split(nadel).length - 1;
const alleText = (i: { satz: string; punkte: string[]; weitere: string | null }): string => [i.satz, ...i.punkte, i.weitere ?? ''].join('\n');

console.log('\n[6] Jeder Name einmal, gekuerzt, sichtbar:');
for (const sprache of ['de', 'en'] as const) {
  {
    const info: BestaetigungInfo = { art: 'entfernen', entfernt: ['Holzaxt', 'Feder', 'Zweig'], entferntOhneId: [] };
    const inhalt = bestaetigungsInhalt(info, name, uebersetzer(sprache));
    const text = alleText(inhalt);
    check(`${sprache}: jeder Name steht genau EINMAL im ganzen Dialog (Satz + Liste)`, ['Holzaxt', 'Feather (Feder)', 'Zweig'].every((n) => vorkommen(text, n) === 1), text);
    check(`${sprache}: der Satz nennt keinen Namen, nur die Anzahl`, !['Holzaxt', 'Feather', 'Zweig'].some((n) => inhalt.satz.includes(n)) && inhalt.satz.includes('3'), inhalt.satz);
    check(`${sprache}: bis zehn Eintraege keine "weitere"-Zeile`, inhalt.weitere === null);
  }
  {
    const doppelt = bestaetigungsInhalt({ art: 'entfernen', entfernt: ['Holzaxt', 'Holzaxt', 'Zweig'], entferntOhneId: [] }, name, uebersetzer(sprache));
    check(`${sprache}: dieselbe Kennung zweimal im 409 wird einmal gezaehlt und gezeigt`, doppelt.punkte.length === 2 && doppelt.satz.includes('2'), JSON.stringify(doppelt.punkte));
  }
  {
    const ids = Array.from({ length: 25 }, (_, i) => `Item${String(i).padStart(2, '0')}`);
    const inhalt = bestaetigungsInhalt({ art: 'entfernen', entfernt: ids, entferntOhneId: ['#a', '#b', '#c'] }, () => null, uebersetzer(sprache));
    check(`${sprache}: 28 Eintraege: die ersten 10 in der Liste`, inhalt.punkte.length === 10 && inhalt.punkte[0] === 'Item00' && inhalt.punkte[9] === 'Item09', JSON.stringify(inhalt.punkte));
    check(`${sprache}: 28 Eintraege: die Gesamtzahl 28 im Satz`, inhalt.satz.includes('28'), inhalt.satz);
    check(`${sprache}: 28 Eintraege: "und 18 weitere"`, inhalt.weitere !== null && inhalt.weitere.includes('18') && !/\{[a-z]+\}/.test(inhalt.weitere), String(inhalt.weitere));
    check(`${sprache}: Eintrag 11 steht nirgends im Dialog`, !alleText(inhalt).includes('Item10'));
    const genau10 = bestaetigungsInhalt({ art: 'entfernen', entfernt: ids.slice(0, 10), entferntOhneId: [] }, () => null, uebersetzer(sprache));
    const elf = bestaetigungsInhalt({ art: 'entfernen', entfernt: ids.slice(0, 11), entferntOhneId: [] }, () => null, uebersetzer(sprache));
    check(`${sprache}: genau 10 = keine weitere-Zeile, 11 = "und 1 weitere"`, genau10.weitere === null && elf.weitere !== null && elf.weitere.includes('1') && elf.punkte.length === 10);
  }
  {
    const lang = 'K'.repeat(100_000);
    const inhalt = bestaetigungsInhalt({ art: 'entfernen', entfernt: [], entferntOhneId: [lang] }, () => null, uebersetzer(sprache));
    check(`${sprache}: eine 100000 Zeichen lange Roh-Kennung wird auf 40 gekuerzt`, inhalt.punkte.length === 1 && inhalt.punkte[0].includes('K'.repeat(40)) && !inhalt.punkte[0].includes('K'.repeat(41)) && inhalt.punkte[0].length < 200, String(inhalt.punkte[0].length));
    const lang2 = bestaetigungsInhalt({ art: 'entfernen', entfernt: [lang], entferntOhneId: [] }, () => null, uebersetzer(sprache));
    check(`${sprache}: auch eine lange Kennung in \`entfernt\` wird gekuerzt`, lang2.punkte[0].length <= 41);
  }
  {
    const bidi = 'Ab‮cd​ef\u0000gh\nij';
    const inhalt = bestaetigungsInhalt({ art: 'entfernen', entfernt: [], entferntOhneId: [bidi] }, () => null, uebersetzer(sprache));
    const z = inhalt.punkte[0];
    check(`${sprache}: Umkehr-, Nullbreiten-, Steuerzeichen und Zeilenumbruch sind sichtbar ersetzt`, !/[‮​\u0000\n]/.test(z) && z.includes('<U+202E>') && z.includes('<U+200B>') && z.includes('<U+0000>') && z.includes('<U+000A>'), JSON.stringify(z));
    check(`${sprache}: das Sichtbare bleibt sichtbar (Buchstaben davor und dahinter)`, z.includes('Ab') && z.includes('ij'));
  }
}
check('sichtbarKuerzen: exakt 40 Zeichen bleiben ganz, 41 bekommen "…"', sichtbarKuerzen('a'.repeat(40)) === 'a'.repeat(40) && sichtbarKuerzen('a'.repeat(41)) === `${'a'.repeat(40)}…`);
check('sichtbarKuerzen: ein Emoji zaehlt als ein Zeichen (kein halbes Paar am Schnitt)', sichtbarKuerzen('😀'.repeat(41)) === `${'😀'.repeat(40)}…`);
check('sichtbarKuerzen: ein einzelnes Ersatzzeichen (kaputtes Paar) wird sichtbar', sichtbarKuerzen('a\uD800b').includes('<U+D800>'));

console.log('\n[7] Vor dem Entfernen eines Gegenstands, den Rezepte brauchen:');
for (const sprache of ['de', 'en'] as const) {
  const inhalt = abhaengigkeitsInhalt('Zweig', ['Holzaxt', 'Feder'], name, uebersetzer(sprache));
  const text = alleText(inhalt);
  check(`${sprache}: nennt den Gegenstand und die Anzahl 2`, inhalt.satz.includes('Zweig') && inhalt.satz.includes('2'), inhalt.satz);
  check(`${sprache}: jeder abhaengige Gegenstand steht einmal, mit Namen`, vorkommen(text, 'Holzaxt') === 1 && vorkommen(text, 'Feather (Feder)') === 1, text);
  check(`${sprache}: Abbrechen und ein eigener Knopf zum Mitentfernen`, inhalt.abbrechen === uebersetzer(sprache)('editor.gegenstand.bestaetigung.abbrechen') && inhalt.bestaetigen !== inhalt.abbrechen && inhalt.bestaetigen.length > 8);
  check(`${sprache}: keine offenen Platzhalter`, !/\{[a-z]+\}/.test(text) && !/\{[a-z]+\}/.test(inhalt.titel + inhalt.bestaetigen));
  const eins = abhaengigkeitsInhalt('Zweig', ['Holzaxt'], name, uebersetzer(sprache));
  check(`${sprache}: ein einziger Abhaengiger: Einzahl-Satz mit 1`, eins.satz.includes('1') && eins.satz !== inhalt.satz);
  const viele = abhaengigkeitsInhalt('Zweig', Array.from({ length: 15 }, (_, i) => `Item${i}`), () => null, uebersetzer(sprache));
  check(`${sprache}: 15 Abhaengige = 10 Zeilen + "weitere", Gesamtzahl 15 im Satz`, viele.punkte.length === 10 && viele.weitere !== null && viele.weitere.includes('5') && viele.satz.includes('15'));
  const lang = abhaengigkeitsInhalt('Zweig', ['K'.repeat(5000)], () => null, uebersetzer(sprache));
  check(`${sprache}: eine sehr lange Kennung wird gekuerzt`, lang.punkte[0].length <= 41);
}

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
