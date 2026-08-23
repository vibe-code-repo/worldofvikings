/**
 * Die Navigation — eine Quelle für Kopfleiste, Mobilleiste, Fuß und Sitemap.
 *
 * Vorher stand dieselbe Liste siebenmal als HTML in den Seiten und einmal in
 * `sitemap.xml`. Als am 21.08. die Karte dazukam, musste sie an neun Stellen
 * nachgetragen werden — genau die Sorte Arbeit, die man einmal vergisst und
 * dann monatelang nicht bemerkt. Ab hier: eine Zeile hier, überall sichtbar.
 */

export interface Seite {
  /** Adresse ohne Endung. nginx liefert sowohl /saga als auch /saga.html. */
  pfad: string;
  /** Beschriftung in der Kopfleiste. */
  titel: string;
  /** Kürzere Beschriftung für die Mobilleiste. */
  kurz?: string;
  /** Symbol im Vorrat, ohne das Präfix `i-`. */
  ikone?: string;
  /** Trägt in der Kopfleiste die Marke „bald“. */
  bald?: boolean;
  /** Steht in der Sitemap (erstellen.html ist noindex). */
  indexieren?: boolean;
}

export const HAUPTNAV: Seite[] = [
  { pfad: '/', titel: 'Halle', kurz: 'Halle', ikone: 'burg', indexieren: true },
  { pfad: '/saga', titel: 'Die Saga', kurz: 'Saga', ikone: 'buch', indexieren: true },
  { pfad: '/karte', titel: 'Die Karte', kurz: 'Karte', ikone: 'karte', indexieren: true },
  // Ohne Symbol: Die Rüstkammer steht nicht in der Mobilleiste, und nur dort
  // werden Symbole gebraucht. Eines einzutragen, das es im Vorrat nicht gibt,
  // wäre ein leerer Kasten, der erst auffällt, wenn jemand sie dort einhängt.
  { pfad: '/ruestkammer', titel: 'Rüstkammer', indexieren: true },
  { pfad: '/ruhmeshalle', titel: 'Ruhmeshalle', kurz: 'Ruhm', ikone: 'orden', indexieren: true },
  {
    pfad: '/thing',
    titel: 'Das Thing',
    kurz: 'Thing',
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

/** Alle Adressen, die in die Sitemap gehören. */
export const SITEMAP = HAUPTNAV.filter((s) => s.indexieren).map((s) => s.pfad);
