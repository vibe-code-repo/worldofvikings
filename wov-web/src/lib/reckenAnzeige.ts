/**
 * Die Anzeigelogik der Rüstkammer, ohne DOM: was gezeigt wird und was nicht.
 *
 * Die Svelte-Dateien rufen nur diese Funktionen auf. So lässt sich festhalten,
 * ohne einen Browser, dass ein Symbol bei Fehlern auf die Glyphe zurückfällt,
 * dass Stufe, Tode und Spielzeit nur erscheinen, wenn das Spiel sie liefert,
 * und dass die Adressen stimmen.
 */

import type { MessageKey } from './i18n';
import { PLAETZE, type Platz, type Recke, type Stueck } from './recken';

/** Der Name einer Zeile für ein leeres Feld im Entwurf; hier die Glyphe je Platz. */
const GLYPHEN: Record<Platz | 'waffe', string> = {
  kopf: '⛑',
  halskette: '📿',
  schultern: '🛡',
  hemd: '🎽',
  unterarme: '🧤',
  haende: '✋',
  armreif: '⭕',
  ring1: '💍',
  ring2: '💍',
  hose: '👖',
  schuhe: '🥾',
  waffe: '⚔',
};

export const SLOT_SCHLUESSEL: Record<Platz | 'waffe', MessageKey> = {
  kopf: 'armory.slot.kopf',
  halskette: 'armory.slot.halskette',
  schultern: 'armory.slot.schultern',
  hemd: 'armory.slot.hemd',
  unterarme: 'armory.slot.unterarme',
  haende: 'armory.slot.haende',
  armreif: 'armory.slot.armreif',
  ring1: 'armory.slot.ring1',
  ring2: 'armory.slot.ring2',
  hose: 'armory.slot.hose',
  schuhe: 'armory.slot.schuhe',
  waffe: 'armory.slot.waffe',
};

export const SELTENHEIT_SCHLUESSEL: Record<Stueck['seltenheit'], MessageKey> = {
  common: 'armory.rarity.common',
  uncommon: 'armory.rarity.uncommon',
  rare: 'armory.rarity.rare',
  epic: 'armory.rarity.epic',
  legendary: 'armory.rarity.legendary',
};

export function glyphe(platz: Platz | 'waffe'): string {
  return GLYPHEN[platz];
}

/**
 * Was ein Platz zeigt. Mit Symbol ein Bild, dessen Ersatztext die Glyphe des
 * Platzes ist: Lädt das Bild nicht, steht die Glyphe da, ohne JavaScript und
 * ohne Inline-Handler (die Content-Security-Policy erlaubt keine). Ohne Symbol
 * steht die Glyphe selbst.
 */
export function symbolAnzeige(
  platz: Platz | 'waffe',
  stueck: Pick<Stueck, 'symbol'>,
): { art: 'bild'; src: string; alt: string } | { art: 'glyphe'; zeichen: string } {
  if (stueck.symbol) return { art: 'bild', src: stueck.symbol, alt: glyphe(platz) };
  return { art: 'glyphe', zeichen: glyphe(platz) };
}

/**
 * Der Anzeigename: der Katalogtext, wenn das Stück einen Schlüssel hat und der
 * Katalog ihn kennt (`uebersetze` liefert sonst `undefined`), sonst `name`.
 */
export function stueckName(
  stueck: Pick<Stueck, 'name' | 'textKey'>,
  uebersetze: (schluessel: string) => string | undefined,
): string {
  const text = stueck.textKey ? uebersetze(stueck.textKey) : undefined;
  return text && text.trim() !== '' ? text : stueck.name;
}

export interface Zeile {
  platz: Platz | 'waffe';
  stueck: Stueck | null;
}

/** Alle Plätze in fester Reihenfolge: erst die Waffe, dann der Körper von oben nach unten. */
export function ausruestungsZeilen(recke: Pick<Recke, 'ausruestung' | 'waffe'>): Zeile[] {
  return [
    { platz: 'waffe', stueck: recke.waffe },
    ...PLAETZE.map((platz) => ({ platz, stueck: recke.ausruestung[platz] ?? null })),
  ];
}

/** Die Werte eines Stücks als Zeilen, nur die, die es hat und die nicht null sind. */
export function stueckWerte(stueck: Pick<Stueck, 'werte'>): Array<[string, number]> {
  return Object.entries(stueck.werte).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && e[1] !== 0,
  );
}

export interface OptionalesFeld {
  schluessel: 'stufe' | 'erfahrung' | 'tode' | 'spielzeit';
  wert: string;
}

/** Eine Zahl mit den Tausendertrennern der Sprache. */
export function zahlText(n: number, sprache: string = 'de'): string {
  return new Intl.NumberFormat(sprache).format(n);
}

/** Minuten als „12 h 5 min“; unter einer Stunde nur Minuten. */
export function spielzeitText(minuten: number, sprache: string = 'de'): string {
  const h = Math.floor(minuten / 60);
  const m = Math.floor(minuten % 60);
  return h > 0 ? `${zahlText(h, sprache)} h ${m} min` : `${m} min`;
}

/** Der übersetzte Klassenname (`armory.klasse.<id>`); unbekannt bleibt die Kennung, leer bleibt leer. */
export function klassenName(klasse: string, katalog: Record<string, string>): string {
  const text = Object.hasOwn(katalog, `armory.klasse.${klasse}`)
    ? katalog[`armory.klasse.${klasse}`]
    : undefined;
  return text ?? klasse;
}

/** Der Zähler der Liste in der richtigen Zahlform („1 Recke“, „2 Recken“). */
export function zaehlerText(
  n: number,
  katalog: Record<string, string>,
  sprache: string = 'de',
  mindestens = false,
): string {
  if (mindestens)
    return (katalog['armory.list.count_min'] ?? '{n}').replace('{n}', zahlText(n, sprache));
  const vorlage = katalog[n === 1 ? 'armory.list.count_one' : 'armory.list.count_other'] ?? '{n}';
  return vorlage.replace('{n}', zahlText(n, sprache));
}

/**
 * Die Felder, die das Spiel erst später liefert. Ein fehlendes Feld ergibt KEINE
 * Zeile (nicht „0“): Null Tode ist eine Aussage, ein fehlender Wert nicht.
 */
export function optionaleFelder(recke: Recke, sprache: string = 'de'): OptionalesFeld[] {
  const felder: OptionalesFeld[] = [];
  if (recke.stufe !== undefined)
    felder.push({ schluessel: 'stufe', wert: zahlText(recke.stufe, sprache) });
  if (recke.erfahrung !== undefined) {
    felder.push({ schluessel: 'erfahrung', wert: zahlText(recke.erfahrung, sprache) });
  }
  if (recke.tode !== undefined)
    felder.push({ schluessel: 'tode', wert: zahlText(recke.tode, sprache) });
  if (recke.spielzeitMinuten !== undefined) {
    felder.push({ schluessel: 'spielzeit', wert: spielzeitText(recke.spielzeitMinuten, sprache) });
  }
  return felder;
}

/**
 * Der übersetzte Fertigkeitsname: der Server liefert den Schlüssel `fertigkeit.<id>`. Fehlt er im Katalog (oder ist es
 * gar kein solcher Schlüssel), steht der Rückfalltext da, nie der rohe Schlüssel.
 */
export function fertigkeitName(
  name: string,
  katalog: Record<string, string>,
  rueckfall: string,
): string {
  const text =
    name.startsWith('fertigkeit.') && Object.hasOwn(katalog, name) ? katalog[name] : undefined;
  return text !== undefined && text.trim() !== '' ? text : rueckfall;
}

/** Fertigkeiten, höchste zuerst; ohne Fertigkeiten (fehlt oder leer) gibt es keine Tafel. */
export function fertigkeitenListe(recke: Recke): Array<{ name: string; stufe: number }> {
  return [...(recke.fertigkeiten ?? [])].sort((a, b) => b.stufe - a.stufe);
}

/* ---------------------------------------------------------- Adressen */

/** Adresse der Liste; Standardwerte (leere Suche, Seite 1) bleiben weg. */
export function listenAdresse(basis: string, q: string, seite: number): string {
  const teile: string[] = [];
  if (q !== '') teile.push(`q=${encodeURIComponent(q)}`);
  if (seite > 1) teile.push(`seite=${seite}`);
  return teile.length ? `${basis}?${teile.join('&')}` : basis;
}

export function profilAdresse(basis: string, id: number): string {
  return `${basis}?reck=${encodeURIComponent(String(id))}`;
}

/** `?reck=` als gültige Charakter-Id oder null. */
export function reckenIdAus(roh: string | null): number | null {
  // Positive Ganzzahl im sicheren Bereich (höchstens 2^53 - 1, 16 Stellen), ohne führende Null.
  if (roh === null || !/^[1-9][0-9]{0,15}$/.test(roh)) return null;
  const n = Number(roh);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Zeitstempel in ms als ISO-Text für `datumKurz` und `vorWieLange`. */
export function isoVon(ms: number): string {
  return new Date(ms).toISOString();
}

/** Der Rahmen eines Platzes (`.guete-1…4` aus wov.css) nach Seltenheit. */
export function seltenheitStufe(s: Stueck['seltenheit']): 1 | 2 | 3 | 4 {
  switch (s) {
    case 'uncommon':
      return 2;
    case 'rare':
      return 3;
    case 'epic':
    case 'legendary':
      return 4;
    default:
      return 1;
  }
}

/** Die angelegten Stücke als Kennungen, wie `planFuerRecke` sie für die Figur braucht. */
export function figurStuecke(
  recke: Pick<Recke, 'ausruestung' | 'waffe'>,
): Array<{ kennung: string }> {
  return ausruestungsZeilen(recke).flatMap((z) =>
    z.stueck ? [{ kennung: z.stueck.kennung }] : [],
  );
}

/** Warum der Spielserver nichts lieferte: Start, Drossel oder sonst ein Ausfall. */
export type FehlerArt = 'start' | 'limit' | 'aus';

/**
 * 503 (der Spielserver bereitet die Kammer noch vor) und 429 (Drossel) sind
 * vorübergehend und bekommen einen eigenen, ehrlichen Hinweis; alles andere
 * (Netzfehler, Zeitlimit, 5xx, kaputte Antwort) ist ein Ausfall.
 */
export function fehlerArt(status: number): FehlerArt {
  if (status === 503) return 'start';
  if (status === 429) return 'limit';
  return 'aus';
}

export const KAMMER_FEHLER: Record<FehlerArt, MessageKey> = {
  start: 'armory.state.warming',
  limit: 'armory.state.limit',
  aus: 'armory.state.error',
};

export const HALLE_FEHLER: Record<FehlerArt, MessageKey> = {
  start: 'hall_of_fame.state.warming',
  limit: 'hall_of_fame.state.limit',
  aus: 'hall_of_fame.state.error',
};

/**
 * „Zuletzt gespielt“ für Zeitstempel, die der Server auf volle Stunden rundet:
 * nie Minuten, sondern „in der letzten Stunde“, „vor N Stunden“, „vor N Tagen“.
 * Zeitstempel in der Zukunft (Uhrenabweichung) zählen als „in der letzten Stunde“.
 */
export function zuletztText(
  ms: number,
  jetzt: number,
  katalog: Record<string, string>,
  sprache: string = 'de',
): string {
  const stunden = Math.floor((jetzt - ms) / 3_600_000);
  if (stunden < 1) return katalog['armory.zuletzt.now'] ?? '';
  const tage = Math.floor(stunden / 24);
  const einheit = tage >= 1 ? tage : stunden;
  const schluessel =
    tage >= 1
      ? einheit === 1
        ? 'armory.zuletzt.day_one'
        : 'armory.zuletzt.day_other'
      : einheit === 1
        ? 'armory.zuletzt.hour_one'
        : 'armory.zuletzt.hour_other';
  return (katalog[schluessel] ?? '{n}').replace('{n}', zahlText(einheit, sprache));
}
