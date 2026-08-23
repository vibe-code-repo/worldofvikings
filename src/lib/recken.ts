/**
 * Der Recke, wie ihn `/api/recken.json` liefert.
 *
 * Bis der Spielserver einen echten Endpunkt hat (Roadmap H6), liegt dort eine
 * statische Datei mit erfundenen Recken. Das Format ist dasselbe — der Umbau
 * hier ändert daran nichts, und die Typen unten sind der Vertrag, gegen den
 * beide Seiten arbeiten.
 */

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
 */
export interface Tafel {
  id: string;
  titel: string;
  /** Überschrift der Wertespalte. */
  spalte: string;
  wert: (r: Recke) => number;
  zeigen: (r: Recke) => string;
  grossIstBesser: boolean;
}

export const TAFELN: Tafel[] = [
  {
    id: 'rang',
    titel: 'Runenrang',
    spalte: 'Rang',
    wert: (r) => r.stufe,
    zeigen: (r) => String(r.stufe),
    grossIstBesser: true,
  },
  {
    id: 'waechter',
    titel: 'Bezwungene Wächter',
    spalte: 'Wächter',
    wert: (r) => r.bosse.filter((b) => b.erlegt).length,
    zeigen: (r) => `${r.bosse.filter((b) => b.erlegt).length} / ${r.bosse.length}`,
    grossIstBesser: true,
  },
  {
    id: 'fahrt',
    titel: 'Zeit auf Fahrt',
    spalte: 'Stunden',
    wert: (r) => r.spielzeit_stunden,
    zeigen: (r) => `${r.spielzeit_stunden} h`,
    grossIstBesser: true,
  },
  {
    id: 'hel',
    titel: 'Selten gefallen',
    spalte: 'Fahrten nach Hel',
    wert: (r) => r.tode,
    zeigen: (r) => String(r.tode),
    grossIstBesser: false,
  },
];
