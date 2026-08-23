/**
 * Datums- und Zeitformate der Seite.
 *
 * Übernommen aus dem alten `assets/js/shell.js`. Was dort ausserdem stand,
 * ist hier ersatzlos entfallen:
 *
 *  - `sicher()` — das Escapen von Text, der in innerHTML landete. Svelte
 *    setzt Text als Text ein; eine Escape-Funktion, die man von Hand aufrufen
 *    muss, ist eine Funktion, die man irgendwann vergisst. Das ist der
 *    Sicherheitsgewinn dieses Umbaus, nicht bloss weniger Schreibarbeit.
 *  - `navMarkieren()` — welcher Punkt der offene ist, weiss die Kopfleiste
 *    jetzt aus der Adresse ($page), statt es nach dem Laden nachzutragen.
 *
 * ── Warum die Sprache hier ein Parameter ist und kein Katalogeintrag ──
 * „vor 3 Stunden“ hat im Deutschen vier Wortformen und im Englischen zwei,
 * und beide Listen wären im Katalog genau die Sorte Eintrag, die niemand
 * pflegt. `Intl.RelativeTimeFormat` kennt sie bereits — für jede Sprache,
 * die der Browser kennt, nicht nur für die zwei, die diese Seite hat.
 * Der Vorgabewert `'de'` hält Aufrufer grün, die noch keine Sprache
 * durchreichen.
 */

import { type Locale, DEFAULT_LOCALE } from './i18n';

/** BCP-47-Kennung je Sprache — `Intl` will ein Gebiet, nicht nur die Sprache. */
const INTL: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

/** Datum als „14. August 2026“ — die Saga liest sich besser ohne ISO-Ziffern. */
export function datumLang(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleDateString(INTL[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Datum mit Uhrzeit, für den Stand der Weltkarte. */
export function datumZeit(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleString(INTL[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Datum ohne Monatsnamen — „14.8.2026“ bzw. „14/08/2026“. */
export function datumKurz(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleDateString(INTL[locale]);
}

/** „vor 3 Stunden“ für zuletzt-gesehen-Angaben. */
export function vorWieLange(iso: string, locale: Locale = DEFAULT_LOCALE): string {
  const sekunden = (Date.now() - new Date(iso).getTime()) / 1000;
  const stufen: Array<[number, Intl.RelativeTimeFormatUnit, number]> = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [2592000, 'day', 86400],
    [31536000, 'month', 2592000],
  ];
  const fmt = new Intl.RelativeTimeFormat(INTL[locale], { numeric: 'auto' });
  for (const [grenze, einheit, teiler] of stufen) {
    if (sekunden < grenze) {
      return fmt.format(-Math.max(1, Math.floor(sekunden / teiler)), einheit);
    }
  }
  return fmt.format(-Math.max(1, Math.floor(sekunden / 31536000)), 'year');
}

/**
 * Holt JSON und wirft bei allem, was keine 200 ist.
 *
 * `cache: 'no-cache'` heisst nicht „nicht zwischenspeichern“, sondern
 * „vor der Benutzung nachfragen“ — der Browser darf die Datei behalten, muss
 * aber prüfen, ob sie noch stimmt. Für Weltstatus und Ruhmestafel ist genau
 * das richtig: Sie ändern sich, aber selten.
 */
export async function holeJson<T>(pfad: string): Promise<T> {
  const antwort = await fetch(pfad, { cache: 'no-cache' });
  if (!antwort.ok) throw new Error(`${pfad}: HTTP ${antwort.status}`);
  return (await antwort.json()) as T;
}
