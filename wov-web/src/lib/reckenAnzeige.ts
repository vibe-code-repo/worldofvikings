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
 * Was ein Platz zeigt: das Symbol des Stücks, solange es eines gibt und es
 * nicht geladen werden konnte (`fehlgeschlagen`), sonst die Glyphe des Platzes.
 */
export function symbolAnzeige(
  platz: Platz | 'waffe',
  stueck: Pick<Stueck, 'symbol'>,
  fehlgeschlagen: boolean,
): { art: 'bild'; src: string } | { art: 'glyphe'; zeichen: string } {
  if (stueck.symbol && !fehlgeschlagen) return { art: 'bild', src: stueck.symbol };
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

/** Minuten als „12 h 5 min“; unter einer Stunde nur Minuten. */
export function spielzeitText(minuten: number): string {
  const h = Math.floor(minuten / 60);
  const m = Math.floor(minuten % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/**
 * Die Felder, die das Spiel erst später liefert. Ein fehlendes Feld ergibt KEINE
 * Zeile (nicht „0“): Null Tode ist eine Aussage, ein fehlender Wert nicht.
 */
export function optionaleFelder(recke: Recke): OptionalesFeld[] {
  const felder: OptionalesFeld[] = [];
  if (recke.stufe !== undefined) felder.push({ schluessel: 'stufe', wert: String(recke.stufe) });
  if (recke.erfahrung !== undefined) {
    felder.push({ schluessel: 'erfahrung', wert: String(recke.erfahrung) });
  }
  if (recke.tode !== undefined) felder.push({ schluessel: 'tode', wert: String(recke.tode) });
  if (recke.spielzeitMinuten !== undefined) {
    felder.push({ schluessel: 'spielzeit', wert: spielzeitText(recke.spielzeitMinuten) });
  }
  return felder;
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
  if (roh === null || !/^[0-9]{1,12}$/.test(roh)) return null;
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
export function figurStuecke(recke: Pick<Recke, 'ausruestung' | 'waffe'>): Array<{ name: string }> {
  return ausruestungsZeilen(recke).flatMap((z) => (z.stueck ? [{ name: z.stueck.kennung }] : []));
}
