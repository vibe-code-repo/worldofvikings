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
 *
 * Run: npx tsx test/editor-gegenstaende-dialog.ts   (from client/, cwd as in scripts/kern/client.mjs)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { speichere } from '../src/editor/gegenstaende/api';
import { bestaetigungsInhalt, type BestaetigungInfo, type Uebersetzer } from '../src/editor/gegenstaende/texte';

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
  check(`${sprache}: Anzahl 1 und Name im Satz`, inhalt.satz.includes('1') && inhalt.satz.includes('Feather (Feder)'), inhalt.satz);
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
  check(`${sprache}: jeder Name steht im Satz`, ['Holzaxt', 'Feather (Feder)', 'Unbekannt', '#4', '#7'].every((n) => inhalt.satz.includes(n)), inhalt.satz);
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
      check(`${sprache}: Anzahl 3, beide Namen, Eintrag ohne Kennung, "${ENDGUELTIG[sprache]}"`, inhalt.satz.includes('3') && inhalt.satz.includes('Holzaxt') && inhalt.satz.includes('Zweig') && inhalt.satz.includes('#3') && inhalt.satz.includes(ENDGUELTIG[sprache]), inhalt.satz);
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

console.log(fehler === 0 ? '\nalles gruen' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
