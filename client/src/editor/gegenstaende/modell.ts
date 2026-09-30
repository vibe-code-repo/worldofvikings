/**
 * Item mask (Editor card EG2), the DOM-free model: form state <-> `GegenstandsEintrag`, new / change /
 * copy / remove, and the live check of one form.
 * Gegenstands-Maske (Editor-Karte EG2), das DOM-freie Modell: Formularzustand <-> Eintrag, neu, aendern,
 * kopieren, entfernen und die Pruefung eines Formulars.
 *
 * Nothing in here touches the DOM, the network or a registry, so a plain `tsx` run tests it.
 *
 * Validation is the SAME as the server's: `pruefeEintrag` (shared/src/items/gegenstandsDaten.ts) runs the
 * entry through the reader's core. On top of that this file checks what the reader would only clamp or fold
 * into one code (an empty name in ONE language, a number outside its range, half a vector), so the mask can
 * name the field and never lets the reader clamp a value behind the author's back. The ranges below repeat
 * the reader's limits; `client/test/editor-gegenstaende-modell.ts` pins them against the real reader.
 *
 * The id is the address of an item (save key): after the first save it can not change (`setzeId` refuses).
 * "Rename" only changes the texts; a new id comes only from `kopie`.
 */
import {
  ANIMATIONSSAETZE,
  GEGENSTANDS_TYPEN,
  ID_MUSTER,
  MAX_EINTRAEGE,
  MAX_ERNTE,
  MAX_STAPEL,
  MAX_ZUTATEN,
  SELTENHEITEN,
  pruefeEintrag,
  schreibeGegenstandsDatei,
  type Animationssatz,
  type GegenstandsEintrag,
  type GegenstandsTyp,
  type Seltenheit,
  type VerwerfGrund,
} from '@wov/shared/src/items/gegenstandsDaten.js';
import { STAT_IDS, type ItemStats } from '@wov/shared/src/items/stats.js';

export { ANIMATIONSSAETZE, GEGENSTANDS_TYPEN, SELTENHEITEN, STAT_IDS };

/** Reasons only the mask knows (the reader folds these into one code or clamps silently). */
export type LokalerGrund = 'name-fehlt' | 'zahl-ungueltig' | 'bereich' | 'ganzzahl' | 'vektor-unvollstaendig' | 'zutaten-fehlen' | 'zutat-fehlt';
export type Grund = VerwerfGrund | LokalerGrund;

export interface FeldFehler {
  /** Field id (`id`, `nameDe`, `skala`, `wert.damage`, `zutat.2.item` ...) or `allgemein`. */
  feld: string;
  code: Grund;
  min?: number;
  max?: number;
}

/** Every number is a string while it is typed; empty means "not set". */
export type Vektor3 = [string, string, string];

export interface ZutatFormular {
  item: string;
  menge: string;
}

export interface Formular {
  /** True until the entry has been saved once: only then the id can be typed. */
  neu: boolean;
  id: string;
  /** Keys of a loaded entry are kept; a new entry derives them from the id. */
  nameSchluessel: string | null;
  beschreibungSchluessel: string | null;
  nameDe: string;
  nameEn: string;
  beschreibungDe: string;
  beschreibungEn: string;
  typ: GegenstandsTyp;
  /** `hochgeladen/<U_Name>` or ''. */
  upload: string;
  skala: string;
  haltePosition: Vektor3;
  halteRotation: Vektor3;
  hiebVersatz: string;
  /** '' = not set. */
  animationsSatz: Animationssatz | '';
  symbol: string;
  stapel: string;
  gewicht: string;
  werte: Record<(typeof STAT_IDS)[number], string>;
  ernteBaum: string;
  ernteFels: string;
  haltbarkeitMax: string;
  haltbarkeitVerbrauch: string;
  haltbarkeitAusdauer: string;
  itemLevel: string;
  rarity: Seltenheit;
  /** False = the entry has no recipe. */
  hatRezept: boolean;
  rezeptMenge: string;
  zutaten: ZutatFormular[];
}

/** Ranges of the reader (`saubereEintrag`), for the numeric fields; `ganz` = whole numbers only. */
export const BEREICHE: Record<string, { min: number; max: number; ganz?: true }> = {
  skala: { min: 0.05, max: 5 },
  haltePosition: { min: -2, max: 2 },
  halteRotation: { min: -2 * Math.PI, max: 2 * Math.PI },
  hiebVersatz: { min: 0, max: 1.5 },
  stapel: { min: 1, max: MAX_STAPEL, ganz: true },
  gewicht: { min: 0, max: 1000 },
  'wert.damage': { min: 0, max: 200 },
  'wert.armor': { min: 0, max: 1000 },
  'wert.strength': { min: 0, max: 1000 },
  'wert.vitality': { min: 0, max: 1000 },
  'wert.agility': { min: 0, max: 1000 },
  ernteBaum: { min: 0, max: MAX_ERNTE, ganz: true },
  ernteFels: { min: 0, max: MAX_ERNTE, ganz: true },
  haltbarkeitMax: { min: 1, max: 10000 },
  haltbarkeitVerbrauch: { min: 0, max: 100 },
  haltbarkeitAusdauer: { min: 0, max: 100 },
  itemLevel: { min: 1, max: 100, ganz: true },
  rezeptMenge: { min: 1, max: 999, ganz: true },
  zutatMenge: { min: 1, max: 999, ganz: true },
};

// ── Form <-> entry ─────────────────────────────────────────────────────

const leerVektor = (): Vektor3 => ['', '', ''];

export function leeresFormular(): Formular {
  return {
    neu: true,
    id: '',
    nameSchluessel: null,
    beschreibungSchluessel: null,
    nameDe: '',
    nameEn: '',
    beschreibungDe: '',
    beschreibungEn: '',
    typ: 'einhaendigWaffe',
    upload: '',
    skala: '',
    haltePosition: leerVektor(),
    halteRotation: leerVektor(),
    hiebVersatz: '',
    animationsSatz: '',
    symbol: '',
    stapel: '',
    gewicht: '',
    werte: { damage: '', armor: '', strength: '', vitality: '', agility: '' },
    ernteBaum: '',
    ernteFels: '',
    haltbarkeitMax: '',
    haltbarkeitVerbrauch: '',
    haltbarkeitAusdauer: '',
    itemLevel: '',
    rarity: 'common',
    hatRezept: false,
    rezeptMenge: '',
    zutaten: [],
  };
}

const alsText = (n: number | undefined | null): string => (n === undefined || n === null ? '' : String(n));
const vektorText = (v: [number, number, number] | null): Vektor3 => (v === null ? leerVektor() : [String(v[0]), String(v[1]), String(v[2])]);

/** The form of a saved entry (`neu` is false: its id is fixed). */
export function eintragZuFormular(e: GegenstandsEintrag): Formular {
  const name = Object.hasOwn(e.texte, e.nameSchluessel) ? e.texte[e.nameSchluessel] : {};
  const beschr = e.beschreibungSchluessel !== null && Object.hasOwn(e.texte, e.beschreibungSchluessel) ? e.texte[e.beschreibungSchluessel] : {};
  const f = leeresFormular();
  f.neu = false;
  f.id = e.id;
  f.nameSchluessel = e.nameSchluessel;
  f.beschreibungSchluessel = e.beschreibungSchluessel;
  f.nameDe = name.de ?? '';
  f.nameEn = name.en ?? '';
  f.beschreibungDe = beschr.de ?? '';
  f.beschreibungEn = beschr.en ?? '';
  f.typ = e.typ;
  f.upload = e.modell.upload ?? '';
  f.skala = e.modell.skala === 1 ? '' : String(e.modell.skala);
  f.haltePosition = vektorText(e.modell.haltePosition);
  f.halteRotation = vektorText(e.modell.halteRotation);
  f.hiebVersatz = alsText(e.modell.hiebVersatz);
  f.animationsSatz = e.modell.animationsSatz ?? '';
  f.symbol = e.symbol ?? '';
  f.stapel = String(e.stapel);
  f.gewicht = String(e.gewicht);
  for (const s of STAT_IDS) f.werte[s] = alsText(e.werte[s]);
  f.ernteBaum = alsText(e.ernte.baum);
  f.ernteFels = alsText(e.ernte.fels);
  f.haltbarkeitMax = alsText(e.haltbarkeit.max);
  f.haltbarkeitVerbrauch = alsText(e.haltbarkeit.verbrauch);
  f.haltbarkeitAusdauer = alsText(e.haltbarkeit.ausdauer);
  f.itemLevel = String(e.itemLevel);
  f.rarity = e.rarity;
  if (e.rezept) {
    f.hatRezept = true;
    f.rezeptMenge = String(e.rezept.menge);
    f.zutaten = e.rezept.zutaten.map((z) => ({ item: z.item, menge: String(z.menge) }));
  }
  return f;
}

/** A typed number: '' = not set, anything else parsed as is (a bad text becomes NaN and is reported by `pruefeFormular`). */
const zahlOderUndef = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));
const vektorAus = (v: Vektor3): [number, number, number] | null =>
  v.every((x) => x.trim() === '') ? null : [Number(v[0]), Number(v[1]), Number(v[2])];

export const standardNameSchluessel = (id: string): string => `inhalt.gegenstand.${id}.name`;
export const standardBeschreibungSchluessel = (id: string): string => `inhalt.gegenstand.${id}.beschreibung`;

/**
 * The entry a form stands for. It is NOT checked: a typed bad number is `NaN`, a half vector has `NaN` in it.
 * A description key exists only while a description text does; unset numbers are the reader's defaults.
 */
export function formularZuEintrag(f: Formular): GegenstandsEintrag {
  const nameSchluessel = f.nameSchluessel ?? standardNameSchluessel(f.id);
  const hatBeschreibung = f.beschreibungDe !== '' || f.beschreibungEn !== '';
  const beschreibungSchluessel = hatBeschreibung ? (f.beschreibungSchluessel ?? standardBeschreibungSchluessel(f.id)) : null;
  const texte: GegenstandsEintrag['texte'] = { [nameSchluessel]: { de: f.nameDe, en: f.nameEn } };
  if (beschreibungSchluessel !== null) {
    const b: { de?: string; en?: string } = {};
    if (f.beschreibungDe !== '') b.de = f.beschreibungDe;
    if (f.beschreibungEn !== '') b.en = f.beschreibungEn;
    texte[beschreibungSchluessel] = b;
  }
  const werte: ItemStats = {};
  for (const s of STAT_IDS) {
    const n = zahlOderUndef(f.werte[s]);
    if (n !== undefined) werte[s] = n;
  }
  const ernte: GegenstandsEintrag['ernte'] = {};
  const baum = zahlOderUndef(f.ernteBaum);
  const fels = zahlOderUndef(f.ernteFels);
  if (baum !== undefined) ernte.baum = baum;
  if (fels !== undefined) ernte.fels = fels;
  const haltbarkeit: GegenstandsEintrag['haltbarkeit'] = {};
  const hMax = zahlOderUndef(f.haltbarkeitMax);
  const hVerbrauch = zahlOderUndef(f.haltbarkeitVerbrauch);
  const hAusdauer = zahlOderUndef(f.haltbarkeitAusdauer);
  if (hMax !== undefined) haltbarkeit.max = hMax;
  if (hVerbrauch !== undefined) haltbarkeit.verbrauch = hVerbrauch;
  if (hAusdauer !== undefined) haltbarkeit.ausdauer = hAusdauer;
  return {
    id: f.id,
    nameSchluessel,
    beschreibungSchluessel,
    typ: f.typ,
    slot: 'hand',
    modell: {
      upload: f.upload === '' ? null : f.upload,
      skala: zahlOderUndef(f.skala) ?? 1,
      haltePosition: vektorAus(f.haltePosition),
      halteRotation: vektorAus(f.halteRotation),
      hiebVersatz: zahlOderUndef(f.hiebVersatz) ?? null,
      animationsSatz: f.animationsSatz === '' ? null : f.animationsSatz,
    },
    symbol: f.symbol === '' ? null : f.symbol,
    stapel: zahlOderUndef(f.stapel) ?? 1,
    gewicht: zahlOderUndef(f.gewicht) ?? 1,
    werte,
    ernte,
    haltbarkeit,
    itemLevel: zahlOderUndef(f.itemLevel) ?? 1,
    rarity: f.rarity,
    rezept: f.hatRezept
      ? { menge: zahlOderUndef(f.rezeptMenge) ?? 1, zutaten: f.zutaten.map((z) => ({ item: z.item, menge: zahlOderUndef(z.menge) ?? NaN })) }
      : null,
    texte,
  };
}

// ── Id, copy, list ─────────────────────────────────────────────────────

/** True while the id can still be typed. */
export const idAenderbar = (f: Formular): boolean => f.neu;

/** Sets the id of a NEW entry; a saved entry keeps its id (the same form comes back). */
export function setzeId(f: Formular, id: string): Formular {
  return f.neu ? { ...f, id } : f;
}

/** A free id derived from `id`: `<id>Kopie`, `<id>Kopie2`, ... (at most 32 characters, matches `ID_MUSTER`). */
export function freieId(id: string, belegt: ReadonlySet<string>): string {
  const belegtKlein = new Set([...belegt].map((x) => x.toLowerCase()));
  // A copy of a copy counts on from the same base: `HolzaxtKopie` -> `HolzaxtKopie2`, not `HolzaxtKopieKopie`.
  const ohneKopie = id.replace(/Kopie\d*$/, '');
  const gewaehlt = /^[A-Z][A-Za-z0-9]*$/.test(ohneKopie) ? ohneKopie : id;
  const basis = /^[A-Z][A-Za-z0-9]*$/.test(gewaehlt) ? gewaehlt : 'Gegenstand';
  for (let n = 1; n < 10_000; n++) {
    const endung = n === 1 ? 'Kopie' : `Kopie${n}`;
    const kandidat = `${basis.slice(0, Math.max(1, 32 - endung.length))}${endung}`;
    if (ID_MUSTER.test(kandidat) && !belegtKlein.has(kandidat.toLowerCase())) return kandidat;
  }
  return 'Gegenstand';
}

/** A copy of the form as a NEW entry: new id, keys derived from it again, texts and values copied. */
export function kopie(f: Formular, liste: readonly GegenstandsEintrag[]): Formular {
  const id = freieId(f.id, new Set(liste.map((e) => e.id)));
  return {
    ...f,
    haltePosition: [...f.haltePosition],
    halteRotation: [...f.halteRotation],
    werte: { ...f.werte },
    zutaten: f.zutaten.map((z) => ({ ...z })),
    neu: true,
    id,
    nameSchluessel: null,
    beschreibungSchluessel: null,
  };
}

/** The list with `eintrag` in place of the entry `alteId` (or appended when `alteId` is null or unknown). */
export function mitEintrag(liste: readonly GegenstandsEintrag[], alteId: string | null, eintrag: GegenstandsEintrag): GegenstandsEintrag[] {
  const i = alteId === null ? -1 : liste.findIndex((e) => e.id === alteId);
  if (i < 0) return [...liste, eintrag];
  const neu = [...liste];
  neu[i] = eintrag;
  return neu;
}

export const ohneEintrag = (liste: readonly GegenstandsEintrag[], id: string): GegenstandsEintrag[] => liste.filter((e) => e.id !== id);

/** The other entries for `pruefeEintrag`: the list WITHOUT the entry being edited. */
export const andereOhne = (liste: readonly GegenstandsEintrag[], id: string | null): GegenstandsEintrag[] =>
  id === null ? [...liste] : liste.filter((e) => e.id !== id);

/** The text of the whole document, byte for byte what the route writes (`schreibeGegenstandsDatei`). */
export const dokumentText = (liste: readonly GegenstandsEintrag[]): string => schreibeGegenstandsDatei(liste);

// ── Check ──────────────────────────────────────────────────────────────

/** Which field a reader reason belongs to; what has no single field goes to `allgemein`. */
const GRUND_FELD: Record<VerwerfGrund, string> = {
  'eintrag-kein-objekt': 'allgemein',
  'id-ungueltig': 'id',
  'id-doppelt': 'id',
  'id-code-kollision': 'id',
  'id-schreibung-code': 'id',
  'id-schreibung-doppelt': 'id',
  'schluessel-ungueltig': 'id',
  'typ-unbekannt': 'typ',
  'slot-unbekannt': 'allgemein',
  'modell-ungueltig': 'modell',
  'symbol-ungueltig': 'symbol',
  'zahl-ungueltig': 'allgemein',
  'werte-ungueltig': 'werte',
  'feld-ungueltig': 'allgemein',
  'rezept-ungueltig': 'rezept',
  'rezept-selbstbezug': 'rezept',
  'rezept-zutat-unbekannt': 'rezept',
  'rezept-zyklus': 'rezept',
  'texte-ungueltig': 'nameDe',
  'texte-schluessel-fremd': 'allgemein',
  'texte-name-fehlt': 'nameDe',
  'eintrag-ungueltig': 'allgemein',
  'zu-viele-eintraege': 'allgemein',
};

const istEndlich = (n: number): boolean => Number.isFinite(n);

function pruefeZahl(feld: string, bereichsId: string, s: string, aus: FeldFehler[]): void {
  if (s.trim() === '') return;
  const n = Number(s);
  const b = BEREICHE[bereichsId];
  if (!istEndlich(n)) {
    aus.push({ feld, code: 'zahl-ungueltig' });
  } else if (b.ganz && !Number.isInteger(n)) {
    aus.push({ feld, code: 'ganzzahl' });
  } else if (n < b.min || n > b.max) {
    aus.push({ feld, code: 'bereich', min: b.min, max: b.max });
  }
}

function pruefeVektor(feld: string, v: Vektor3, aus: FeldFehler[]): void {
  const gefuellt = v.filter((x) => x.trim() !== '').length;
  if (gefuellt === 0) return;
  if (gefuellt < 3) {
    aus.push({ feld, code: 'vektor-unvollstaendig' });
    return;
  }
  const vorher = aus.length;
  for (const x of v) pruefeZahl(feld, feld, x, aus);
  // One message per vector is enough.
  if (aus.length > vorher + 1) aus.length = vorher + 1;
}

/** What the mask itself sees in a form (no reader involved): empty names, unparsable or out-of-range numbers, half vectors. */
export function lokaleFehler(f: Formular): FeldFehler[] {
  const aus: FeldFehler[] = [];
  if (f.nameDe.trim() === '') aus.push({ feld: 'nameDe', code: 'name-fehlt' });
  if (f.nameEn.trim() === '') aus.push({ feld: 'nameEn', code: 'name-fehlt' });
  pruefeZahl('skala', 'skala', f.skala, aus);
  pruefeVektor('haltePosition', f.haltePosition, aus);
  pruefeVektor('halteRotation', f.halteRotation, aus);
  pruefeZahl('hiebVersatz', 'hiebVersatz', f.hiebVersatz, aus);
  pruefeZahl('stapel', 'stapel', f.stapel, aus);
  pruefeZahl('gewicht', 'gewicht', f.gewicht, aus);
  for (const s of STAT_IDS) pruefeZahl(`wert.${s}`, `wert.${s}`, f.werte[s], aus);
  pruefeZahl('ernteBaum', 'ernteBaum', f.ernteBaum, aus);
  pruefeZahl('ernteFels', 'ernteFels', f.ernteFels, aus);
  pruefeZahl('haltbarkeitMax', 'haltbarkeitMax', f.haltbarkeitMax, aus);
  pruefeZahl('haltbarkeitVerbrauch', 'haltbarkeitVerbrauch', f.haltbarkeitVerbrauch, aus);
  pruefeZahl('haltbarkeitAusdauer', 'haltbarkeitAusdauer', f.haltbarkeitAusdauer, aus);
  pruefeZahl('itemLevel', 'itemLevel', f.itemLevel, aus);
  if (f.hatRezept) {
    pruefeZahl('rezeptMenge', 'rezeptMenge', f.rezeptMenge, aus);
    if (f.zutaten.length === 0) aus.push({ feld: 'rezept', code: 'zutaten-fehlen' });
    if (f.zutaten.length > MAX_ZUTATEN) aus.push({ feld: 'rezept', code: 'bereich', min: 1, max: MAX_ZUTATEN });
    f.zutaten.forEach((z, i) => {
      if (z.item.trim() === '') aus.push({ feld: `zutat.${i}.item`, code: 'zutat-fehlt' });
      if (z.menge.trim() === '') aus.push({ feld: `zutat.${i}.menge`, code: 'zahl-ungueltig' });
      else pruefeZahl(`zutat.${i}.menge`, 'zutatMenge', z.menge, aus);
    });
  }
  return aus;
}

/**
 * All problems of a form, per field. `andere` = the other entries of the document (without this one).
 * The reader's own check (`pruefeEintrag`) runs only when the mask found nothing itself: with a `NaN` in the
 * entry it could only repeat the same complaint under a coarser code.
 */
export function pruefeFormular(f: Formular, andere: readonly GegenstandsEintrag[]): FeldFehler[] {
  const lokal = lokaleFehler(f);
  if (lokal.length > 0) return lokal;
  const gruende = pruefeEintrag(formularZuEintrag(f), andere);
  return gruende.map((code) => ({ feld: GRUND_FELD[code], code }));
}

/** True while nothing stands against saving. */
export const kannSpeichern = (f: Formular, andere: readonly GegenstandsEintrag[]): boolean => pruefeFormular(f, andere).length === 0;

/** The most entries a document holds, for the "new" button. */
export const MAX_GEGENSTAENDE = MAX_EINTRAEGE;
