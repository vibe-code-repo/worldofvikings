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
 */

/** Datum als „14. August 2026“ — die Saga liest sich besser ohne ISO-Ziffern. */
export function datumLang(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Datum mit Uhrzeit, für den Stand der Weltkarte. */
export function datumZeit(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** „vor 3 Stunden“ für zuletzt-gesehen-Angaben. */
export function vorWieLange(iso: string): string {
  const sekunden = (Date.now() - new Date(iso).getTime()) / 1000;
  const stufen: Array<[number, string, string, number]> = [
    [60, 'Sekunde', 'Sekunden', 1],
    [3600, 'Minute', 'Minuten', 60],
    [86400, 'Stunde', 'Stunden', 3600],
    [2592000, 'Tag', 'Tagen', 86400],
  ];
  for (const [grenze, ein, viele, teiler] of stufen) {
    if (sekunden < grenze) {
      const n = Math.max(1, Math.floor(sekunden / teiler));
      return `vor ${n} ${n === 1 ? ein : viele}`;
    }
  }
  return 'vor längerer Zeit';
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
