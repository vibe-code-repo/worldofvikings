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

/**
 * Die Reihenfolge ist die des Entwurfs „Rune & Iron“: Ruhmeshalle, Karte,
 * Wiki, Saga, Rüstkammer, Thing. Die Halle steht weiter vorn in der Liste,
 * erscheint in der Kopfleiste aber NICHT als eigener Punkt — dort führt das
 * Wappen dorthin (siehe Kopf.svelte). Aus der Liste nehmen kann man sie
 * trotzdem nicht: `SITEMAP` und `MOBILNAV` hängen daran, und `/` fiele sonst
 * still aus der Sitemap.
 */
export const HAUPTNAV: Seite[] = [
  {
    pfad: '/',
    titel: 'pages.main_nav.hall.title',
    kurz: 'pages.main_nav.hall.short',
    ikone: 'burg',
    indexieren: true,
  },
  {
    pfad: '/ruhmeshalle',
    titel: 'pages.main_nav.hall_of_fame.title',
    kurz: 'pages.main_nav.hall_of_fame.short',
    ikone: 'orden',
    indexieren: true,
  },
  {
    pfad: '/karte',
    titel: 'pages.main_nav.map.title',
    kurz: 'pages.main_nav.map.short',
    ikone: 'karte',
    indexieren: true,
  },
  /*
    Das Wiki trägt KEINE Marke „bald“. Die Seite steht, sie ist vorgerendert
    und sie hat Inhalt; dass ihre Einträge noch wachsen, sagt der Kasten auf
    der Seite selbst („Im Aufbau.“). Eine Marke in der Leiste heisst hier:
    diese Seite gibt es noch nicht — das wäre für das Wiki schlicht falsch.
  */
  {
    pfad: '/wiki',
    titel: 'pages.main_nav.wiki.title',
    kurz: 'pages.main_nav.wiki.short',
    ikone: 'buch',
    indexieren: true,
  },
  {
    pfad: '/saga',
    titel: 'pages.main_nav.saga.title',
    kurz: 'pages.main_nav.saga.short',
    ikone: 'buch',
    indexieren: true,
  },
  // Ohne Symbol: Die Rüstkammer steht nicht in der Mobilleiste, und nur dort
  // werden Symbole gebraucht. Eines einzutragen, das es im Vorrat nicht gibt,
  // wäre ein leerer Kasten, der erst auffällt, wenn jemand sie dort einhängt.
  { pfad: '/ruestkammer', titel: 'pages.main_nav.armory.title', indexieren: true },
  {
    pfad: '/thing',
    titel: 'pages.main_nav.thing.title',
    kurz: 'pages.main_nav.thing.short',
    ikone: 'leute',
    bald: true,
    indexieren: true,
  },
];

/**
 * Ein Eintrag der Hauptnavigation, über seinen Pfad geholt.
 *
 * Vorher stand in `MOBILNAV` `HAUPTNAV[4] // Ruhmeshalle`. Das war eine
 * stille Falle: Ein neuer Punkt weiter oben — genau das ist mit dem Wiki
 * passiert — verschiebt jeden Index, und die Mobilleiste hätte dann
 * wortlos vier andere Ziele gezeigt. Ein falscher Pfad hier wirft dagegen
 * beim Bauen, weil dieses Modul beim Vorrendern ausgeführt wird.
 */
function eintrag(pfad: string): Seite {
  const s = HAUPTNAV.find((e) => e.pfad === pfad);
  if (!s) throw new Error(`seiten.ts: kein HAUPTNAV-Eintrag für ${pfad}`);
  return s;
}

/**
 * Die Mobilleiste zeigt vier Ziele plus den Fahrt-Knopf, nicht alle sieben.
 *
 * In der Mitte sitzt der erhobene Fahrt-Knopf, links und rechts davon je
 * zwei. Was hier fehlt (Rüstkammer, Wiki, Thing), steht im Fuß — eine Leiste
 * mit sieben Symbolen trifft auf 360 px niemand mehr mit dem Daumen. Das ist
 * zugleich die Antwort auf Roadmap H5.
 */
export const MOBILNAV: Seite[] = [
  eintrag('/'),
  eintrag('/saga'),
  eintrag('/ruhmeshalle'),
  eintrag('/karte'),
];

/**
 * Was die Mobilleiste nicht zeigt, muss der Fuß zeigen.
 *
 * Unterhalb von 880 px ist die Kopfleiste ausgeblendet (wov.css). Ohne diese
 * Liste wären Rüstkammer, Wiki und Thing auf dem Handy von keiner Seite aus
 * erreichbar — der schlanke Fußbalken des Entwurfs hat die alten
 * Linkspalten abgelöst, aber nicht deren Aufgabe.
 */
export const FUSSNAV: Seite[] = HAUPTNAV.filter(
  (s) => !MOBILNAV.includes(s) && s.pfad !== '/',
);

/** Wohin „Auf Fahrt gehen“ führt — die Charaktererstellung, nicht direkt ins Spiel. */
export const FAHRT = '/erstellen';
/** Ändern, wenn der Editor neue statische Routenmodule oder Modelle erhält. */
export const FAHRT_STAND = '20260912-druidenstab-spielgriff';

/** Alle Adressen (ohne Sprachpräfix), die in die Sitemap gehören. */
export const SITEMAP = HAUPTNAV.filter((s) => s.indexieren).map((s) => s.pfad);
