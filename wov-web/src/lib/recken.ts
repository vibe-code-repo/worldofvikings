/**
 * Der Recke, wie ihn `/api/recken.json` liefert.
 *
 * Bis der Spielserver einen echten Endpunkt hat (Roadmap H6), liegt dort eine
 * statische Datei mit erfundenen Recken. Das Format ist dasselbe — der Umbau
 * hier ändert daran nichts, und die Typen unten sind der Vertrag, gegen den
 * beide Seiten arbeiten.
 */

import type { MessageKey } from './i18n';

export interface Ausruestungsstueck {
  name: string;
  bild: string;
  guete: number;
}

export interface Recke {
  id: string;
  name: string;
  beiname: string;
  sippe: string;
  welt: string;
  stufe: number;
  tode: number;
  spielzeit_stunden: number;
  zuletzt_gesehen: string;
  erschaffen: string;
  werte: { leben: number; ausdauer: number; eitr: number; traglast: number };
  fertigkeiten: Array<{ name: string; stufe: number }>;
  bosse: Array<{ name: string; erlegt: boolean }>;
  biome: string[];
  trophaeen: string[];
  ausruestung: Record<string, Ausruestungsstueck | undefined>;
}

/**
 * Die Tafeln der Ruhmeshalle.
 *
 * Eine neue Rangliste kostet einen Eintrag hier und keine neue Funktion —
 * dieselbe Idee wie in der alten `ruhmeshalle.js`, nur getypt.
 *
 * `titel` und `spalte` tragen seit dem Sprachumbau Katalogschlüssel statt
 * Texten. `zeigen()` bleibt sprachlos: Was es zurückgibt, sind Zahlen und
 * Einheitenzeichen („12 / 5“, „340 h“), und die sind in beiden Sprachen
 * dieselben.
 */
export interface Tafel {
  id: string;
  titel: MessageKey;
  /** Katalogschlüssel der Überschrift der Wertespalte. */
  spalte: MessageKey;
  wert: (r: Recke) => number;
  zeigen: (r: Recke) => string;
  grossIstBesser: boolean;
}

export const TAFELN: Tafel[] = [
  {
    id: 'rang',
    titel: 'recken.tafel.rang.titel',
    spalte: 'recken.tafel.rang.spalte',
    wert: (r) => r.stufe,
    zeigen: (r) => String(r.stufe),
    grossIstBesser: true,
  },
  {
    id: 'waechter',
    titel: 'recken.tafel.waechter.titel',
    spalte: 'recken.tafel.waechter.spalte',
    wert: (r) => r.bosse.filter((b) => b.erlegt).length,
    zeigen: (r) => `${r.bosse.filter((b) => b.erlegt).length} / ${r.bosse.length}`,
    grossIstBesser: true,
  },
  {
    id: 'fahrt',
    titel: 'recken.tafel.fahrt.titel',
    spalte: 'recken.tafel.fahrt.spalte',
    wert: (r) => r.spielzeit_stunden,
    zeigen: (r) => `${r.spielzeit_stunden} h`,
    grossIstBesser: true,
  },
  {
    id: 'hel',
    titel: 'recken.tafel.hel.titel',
    spalte: 'recken.tafel.hel.spalte',
    wert: (r) => r.tode,
    zeigen: (r) => String(r.tode),
    grossIstBesser: false,
  },
];
