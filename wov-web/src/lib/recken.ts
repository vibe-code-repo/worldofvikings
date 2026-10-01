/**
 * Der Recke, wie ihn die Rüstkammer des Spielservers liefert
 * (`GET /accounts/armory`, `GET /accounts/armory/:id`).
 *
 * ── Positivliste ──────────────────────────────────────────────────────
 * Die Normalisierer unten setzen jedes Feld einzeln aus der Antwort. Es gibt
 * kein „kopiere alles“: Schickt ein Server fälschlich einen Kontonamen, eine
 * Position oder ein Inventar mit, erreicht es weder die Seite noch das HTML.
 * Das ist dieselbe Regel wie auf dem Server (Armory.ts), ein zweites Mal an
 * der Stelle, an der gerendert wird.
 *
 * Was das Spiel (noch) nicht kennt — Stufe, Erfahrung, Tode, Spielzeit,
 * Fertigkeiten —, steht nur als optionales Feld da und wird nur angezeigt,
 * wenn der Server es schickt. Beiname, Sippe, Trophäen und Ähnliches gibt es
 * nicht mehr: Sie waren erfunden.
 */

import type { MessageKey } from './i18n';

export type Seltenheit = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const SELTENHEITEN: readonly Seltenheit[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

/** Die elf Körperplätze; die Waffe steht getrennt (`Recke.waffe`). */
export const PLAETZE = [
  'kopf',
  'halskette',
  'schultern',
  'hemd',
  'unterarme',
  'haende',
  'armreif',
  'ring1',
  'ring2',
  'hose',
  'schuhe',
] as const;

export type Platz = (typeof PLAETZE)[number];

export type WertId = 'damage' | 'armor' | 'strength' | 'vitality' | 'agility';

const WERT_IDS: readonly WertId[] = ['damage', 'armor', 'strength', 'vitality', 'agility'];

export interface Aussehen {
  figur: string;
  frisur: string;
  haarfarbe: string;
  augenfarbe: string;
}

/** Ein Listeneintrag: nur der Charaktername, nie etwas vom Konto. */
export interface ReckenEintrag {
  id: number;
  name: string;
  klasse: string;
  aussehen: Aussehen;
  /** ms seit 1970. */
  erstellt: number;
  /** ms seit 1970; null = noch nie gespielt. */
  zuletztGespielt: number | null;
}

export interface Stueck {
  kennung: string;
  name: string;
  /** Katalogschlüssel des Namens (`inhalt.item.*`); sonst gilt `name`. */
  textKey?: string;
  seltenheit: Seltenheit;
  itemStufe: number;
  qualitaet: number;
  werte: Partial<Record<WertId, number>>;
  /** `/assets/sprites/<icon>.png` oder null. */
  symbol: string | null;
}

export interface Werte {
  damage: number;
  armor: number;
  strength: number;
  vitality: number;
  agility: number;
  lebenMax: number;
  nahkampfSchaden: number;
}

export interface Recke extends ReckenEintrag {
  ausruestung: Partial<Record<Platz, Stueck>>;
  waffe: Stueck | null;
  werte: Werte;
  /** Profiltext, nur beim Avatar des Kontos. */
  profil?: string;
  /** Kommen später aus dem Spiel; fehlen sie, zeigt die Seite nichts davon. */
  stufe?: number;
  erfahrung?: number;
  tode?: number;
  spielzeitMinuten?: number;
  fertigkeiten?: Array<{ name: string; stufe: number }>;
}

export interface ReckenListe {
  eintraege: ReckenEintrag[];
  seite: number;
  seitenGroesse: number;
  gesamt: number;
  seiten: number;
}

/* ------------------------------------------------------ Normalisierer */

type Roh = Record<string, unknown>;

function istObjekt(v: unknown): v is Roh {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function zahl(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Ein Zeitstempel in ms, den `Date` noch darstellen kann; sonst gilt er als unlesbar. */
function zeit(v: unknown): number | null {
  const z = zahl(v);
  return z !== null && Math.abs(z) <= 8.64e15 ? z : null;
}

function nichtNegativ(v: unknown): number | undefined {
  const z = zahl(v);
  return z !== null && z >= 0 ? z : undefined;
}

/** Nur der Pfad, den der Spielclient auch lädt; alles andere wird zu „kein Symbol“. */
const SYMBOL_MUSTER = /^\/assets\/sprites\/[A-Za-z0-9_-]{1,64}\.png$/;

export function pruefeSymbol(v: unknown): string | null {
  return typeof v === 'string' && SYMBOL_MUSTER.test(v) ? v : null;
}

function aussehenAus(v: unknown): Aussehen | null {
  if (!istObjekt(v)) return null;
  const figur = text(v.figur, 40);
  const frisur = text(v.frisur, 80);
  const haarfarbe = text(v.haarfarbe, 40);
  const augenfarbe = text(v.augenfarbe, 40);
  if (!figur || !frisur || !haarfarbe || !augenfarbe) return null;
  return { figur, frisur, haarfarbe, augenfarbe };
}

export function normalisiereEintrag(v: unknown): ReckenEintrag | null {
  if (!istObjekt(v)) return null;
  const id = zahl(v.id);
  const name = text(v.name, 60);
  const klasse = text(v.klasse, 40);
  const aussehen = aussehenAus(v.aussehen);
  const erstellt = zeit(v.erstellt);
  if (id === null || !Number.isSafeInteger(id) || id <= 0) return null;
  if (!name || !klasse || !aussehen || erstellt === null) return null;
  return {
    id,
    name,
    klasse,
    aussehen,
    erstellt,
    zuletztGespielt: zeit(v.zuletztGespielt),
  };
}

function stueckAus(v: unknown): Stueck | null {
  if (!istObjekt(v)) return null;
  const kennung = text(v.kennung, 80);
  const name = text(v.name, 120);
  if (!kennung || !name) return null;
  const werte: Partial<Record<WertId, number>> = {};
  if (istObjekt(v.werte)) {
    for (const id of WERT_IDS) {
      const w = zahl(v.werte[id]);
      if (w !== null) werte[id] = w;
    }
  }
  const stueck: Stueck = {
    kennung,
    name,
    seltenheit: SELTENHEITEN.find((s) => s === v.seltenheit) ?? 'common',
    itemStufe: zahl(v.itemStufe) ?? 1,
    qualitaet: zahl(v.qualitaet) ?? 0,
    werte,
    symbol: pruefeSymbol(v.symbol),
  };
  const key = text(v.textKey, 120);
  if (key) stueck.textKey = key;
  return stueck;
}

function werteAus(v: unknown): Werte {
  const r: Roh = istObjekt(v) ? v : {};
  return {
    damage: zahl(r.damage) ?? 0,
    armor: zahl(r.armor) ?? 0,
    strength: zahl(r.strength) ?? 0,
    vitality: zahl(r.vitality) ?? 0,
    agility: zahl(r.agility) ?? 0,
    lebenMax: zahl(r.lebenMax) ?? 0,
    nahkampfSchaden: zahl(r.nahkampfSchaden) ?? 0,
  };
}

export function normalisiereRecke(v: unknown): Recke | null {
  const eintrag = normalisiereEintrag(v);
  if (!eintrag || !istObjekt(v)) return null;
  const ausruestung: Partial<Record<Platz, Stueck>> = {};
  if (istObjekt(v.ausruestung)) {
    for (const platz of PLAETZE) {
      const s = stueckAus(v.ausruestung[platz]);
      if (s) ausruestung[platz] = s;
    }
  }
  const recke: Recke = {
    ...eintrag,
    ausruestung,
    waffe: stueckAus(v.waffe),
    werte: werteAus(v.werte),
  };
  const profil = text(v.profil, 1000);
  if (profil) recke.profil = profil;
  const stufe = nichtNegativ(v.stufe);
  if (stufe !== undefined) recke.stufe = stufe;
  const erfahrung = nichtNegativ(v.erfahrung);
  if (erfahrung !== undefined) recke.erfahrung = erfahrung;
  const tode = nichtNegativ(v.tode);
  if (tode !== undefined) recke.tode = tode;
  const minuten = nichtNegativ(v.spielzeitMinuten);
  if (minuten !== undefined) recke.spielzeitMinuten = minuten;
  if (Array.isArray(v.fertigkeiten)) {
    const f: Array<{ name: string; stufe: number }> = [];
    for (const roh of v.fertigkeiten) {
      if (!istObjekt(roh)) continue;
      const name = text(roh.name, 60);
      const s = nichtNegativ(roh.stufe);
      if (name && s !== undefined) f.push({ name, stufe: s });
    }
    recke.fertigkeiten = f;
  }
  return recke;
}

export function normalisiereListe(v: unknown): ReckenListe | null {
  if (!istObjekt(v) || !Array.isArray(v.eintraege)) return null;
  const eintraege: ReckenEintrag[] = [];
  for (const roh of v.eintraege) {
    const e = normalisiereEintrag(roh);
    if (e) eintraege.push(e);
  }
  const seite = zahl(v.seite);
  const seiten = zahl(v.seiten);
  const gesamt = zahl(v.gesamt);
  const groesse = zahl(v.seitenGroesse);
  if (seite === null || seiten === null || gesamt === null || groesse === null) return null;
  return {
    eintraege,
    seite: Math.max(1, Math.floor(seite)),
    seiten: Math.max(1, Math.floor(seiten)),
    gesamt: Math.max(0, Math.floor(gesamt)),
    seitenGroesse: Math.max(1, Math.floor(groesse)),
  };
}

/* ------------------------------------------------------ Ruhmeshalle */

/**
 * Die Tafeln der Ruhmeshalle — nur solche mit echter Quelle. Rang, Wächter,
 * Spielzeit und Tode fehlen, bis das Spiel sie erfasst; die Seite sagt das.
 */
export interface Tafel {
  id: string;
  titel: MessageKey;
  /** Katalogschlüssel der Überschrift der Wertespalte. */
  spalte: MessageKey;
  /** Sortierwert (größer = weiter oben); null = steht nicht auf der Tafel. */
  wert: (r: ReckenEintrag) => number | null;
}

export const TAFELN: Tafel[] = [
  {
    id: 'aktiv',
    titel: 'hall_of_fame.board.active.title',
    spalte: 'hall_of_fame.board.active.column',
    wert: (r) => r.zuletztGespielt,
  },
];

/** Die Zeilen einer Tafel: absteigend nach Wert, ohne Einträge ohne Wert. */
export function tafelZeilen(
  tafel: Tafel,
  eintraege: readonly ReckenEintrag[],
): Array<{ eintrag: ReckenEintrag; wert: number }> {
  const zeilen: Array<{ eintrag: ReckenEintrag; wert: number }> = [];
  for (const eintrag of eintraege) {
    const wert = tafel.wert(eintrag);
    if (wert !== null) zeilen.push({ eintrag, wert });
  }
  return zeilen.sort((a, b) => b.wert - a.wert || a.eintrag.id - b.eintrag.id);
}
