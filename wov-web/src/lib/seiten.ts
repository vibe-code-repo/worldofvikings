/**
 * Die Navigation — eine Quelle für Kopfleiste, Mobilleiste, Fuß und Sitemap.
 *
 * Vorher stand dieselbe Liste siebenmal als HTML in den Seiten und einmal in
 * `sitemap.xml`. Als am 21.08. die Karte dazukam, musste sie an neun Stellen
 * nachgetragen werden — genau die Sorte Arbeit, die man einmal vergisst und
 * dann monatelang nicht bemerkt. Ab hier: eine Zeile hier, überall sichtbar.
 *
 * Seit dem Sprachumbau stehen in `titel` und `kurz` keine Texte mehr, sondern
 * Katalogschlüssel. Der Typ ist `MessageKey`, nicht `string` — ein Tippfehler
 * im Schlüssel bricht damit `npm run check`, statt „undefined“ in die
 * Kopfleiste zu schreiben.
 *
 * `pfad` bleibt sprachlos (`/saga`, nicht `/de/saga`): Das Präfix hängt der
 * Leser an, über `localizedPath()`. Sonst stünde jede Adresse zweimal hier
 * und die Sitemap müsste raten, welche gemeint ist.
 */

import type { MessageKey } from './i18n';

export interface Seite {
  /** Adresse OHNE Sprachpräfix und ohne Endung, z. B. `/saga`. */
  pfad: string;
  /** Katalogschlüssel der Beschriftung in der Kopfleiste. */
  titel: MessageKey;
  /** Katalogschlüssel der kürzeren Beschriftung für die Mobilleiste. */
  kurz?: MessageKey;
  /** Symbol im Vorrat, ohne das Präfix `i-`. */
  ikone?: string;
  /** Trägt in der Kopfleiste die Marke „bald“. */
  bald?: boolean;
  /** Steht in der Sitemap (erstellen ist noindex). */
  indexieren?: boolean;
}

export const HAUPTNAV: Seite[] = [
  {
    pfad: '/',
    titel: 'seiten.hauptnav.halle.titel',
    kurz: 'seiten.hauptnav.halle.kurz',
    ikone: 'burg',
    indexieren: true,
  },
  {
    pfad: '/saga',
    titel: 'seiten.hauptnav.saga.titel',
    kurz: 'seiten.hauptnav.saga.kurz',
    ikone: 'buch',
    indexieren: true,
  },
  {
    pfad: '/karte',
    titel: 'seiten.hauptnav.karte.titel',
    kurz: 'seiten.hauptnav.karte.kurz',
    ikone: 'karte',
    indexieren: true,
  },
  // Ohne Symbol: Die Rüstkammer steht nicht in der Mobilleiste, und nur dort
  // werden Symbole gebraucht. Eines einzutragen, das es im Vorrat nicht gibt,
  // wäre ein leerer Kasten, der erst auffällt, wenn jemand sie dort einhängt.
  { pfad: '/ruestkammer', titel: 'seiten.hauptnav.ruestkammer.titel', indexieren: true },
  {
    pfad: '/ruhmeshalle',
    titel: 'seiten.hauptnav.ruhmeshalle.titel',
    kurz: 'seiten.hauptnav.ruhmeshalle.kurz',
    ikone: 'orden',
    indexieren: true,
  },
  {
    pfad: '/thing',
    titel: 'seiten.hauptnav.thing.titel',
    kurz: 'seiten.hauptnav.thing.kurz',
    ikone: 'leute',
    bald: true,
    indexieren: true,
  },
];

/**
 * Die Mobilleiste zeigt fünf Ziele, nicht sechs.
 *
 * In der Mitte sitzt der erhobene Fahrt-Knopf, links und rechts davon je
 * zwei. Was hier fehlt (Rüstkammer, Thing), steht im Fuß — eine Leiste mit
 * sieben Symbolen trifft auf 360 px niemand mehr mit dem Daumen. Das ist
 * zugleich die Antwort auf Roadmap H5.
 */
export const MOBILNAV: Seite[] = [
  HAUPTNAV[0], // Halle
  HAUPTNAV[1], // Saga
  HAUPTNAV[4], // Ruhmeshalle
  HAUPTNAV[2], // Karte
];

/** Wohin „Auf Fahrt gehen“ führt — die Charaktererstellung, nicht direkt ins Spiel. */
export const FAHRT = '/erstellen';

/** Alle Adressen (ohne Sprachpräfix), die in die Sitemap gehören. */
export const SITEMAP = HAUPTNAV.filter((s) => s.indexieren).map((s) => s.pfad);
