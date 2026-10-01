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
 * name the field: a value TYPED into the form is never clamped behind the author's back. A hand-written file is
 * different: the reader clamps and drops what it loads, and the next save writes the clamped text. That is not
 * hidden: `vereinheitlichung` finds it at load (banner) and the first save asks once. The ranges below repeat
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
  MAX_TEXT_ZEICHEN,
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

/** `Array.isArray` without its `any[]`: a list of anything, typed `unknown` (the mask allows no expression of type `any`). */
export const istListe = (v: unknown): v is readonly unknown[] => Array.isArray(v);

/** Longest text (UTF-16 units, as the reader counts): the reader's own constant, not a copy. */
export const TEXT_MAX = MAX_TEXT_ZEICHEN;

/** Reasons only the mask knows (the reader folds these into one code or clamps silently; the four `text-*` ones name what `texte-ungueltig` hides). */
export type LokalerGrund = 'name-fehlt' | 'text-zeilenumbruch' | 'text-steuerzeichen' | 'text-zu-lang' | 'text-ohne-zeichen' | 'zahl-ungueltig' | 'bereich' | 'ganzzahl' | 'vektor-unvollstaendig' | 'zutaten-fehlen' | 'zutat-fehlt';
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
 * `basis` = the saved entry the form edits (null for a new one): a field of the entry the form does not know
 * (a field a later version of the data file adds) is carried over unchanged, also inside `modell` and `rezept`.
 */
export function formularZuEintrag(f: Formular, basis: GegenstandsEintrag | null = null): GegenstandsEintrag {
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
    ...basis,
    id: f.id,
    nameSchluessel,
    beschreibungSchluessel,
    typ: f.typ,
    slot: 'hand',
    modell: {
      ...basis?.modell,
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
      ? { ...basis?.rezept, menge: zahlOderUndef(f.rezeptMenge) ?? 1, zutaten: f.zutaten.map((z) => ({ item: z.item, menge: zahlOderUndef(z.menge) ?? NaN })) }
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

/** Ids of the entries whose recipe uses `id` as an ingredient (list order). */
export const verwender = (liste: readonly GegenstandsEintrag[], id: string): string[] =>
  liste.filter((e) => e.id !== id && e.rezept !== null && e.rezept.zutaten.some((z) => z.item === id)).map((e) => e.id);

/**
 * Everything that would stop working if `id` were removed: the users of `id`, then their users, and so on
 * (the reader drops an entry whose ingredient is gone, and then the ones that need that entry). Direct users
 * come first. Never contains `id` itself.
 */
export function abhaengige(liste: readonly GegenstandsEintrag[], id: string): string[] {
  const aus: string[] = [];
  const gesehen = new Set<string>([id]);
  let front = [id];
  while (front.length > 0) {
    const naechste: string[] = [];
    for (const x of front) {
      for (const u of verwender(liste, x)) {
        if (gesehen.has(u)) continue;
        gesehen.add(u);
        aus.push(u);
        naechste.push(u);
      }
    }
    front = naechste;
  }
  return aus;
}

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
  // The mask names the field itself (`textGrund`); if the reader still finds it, no single field is known.
  'texte-ungueltig': 'allgemein',
  'texte-schluessel-fremd': 'allgemein',
  'texte-name-fehlt': 'nameDe',
  'eintrag-ungueltig': 'allgemein',
  'zu-viele-eintraege': 'allgemein',
};

const istEndlich = (n: number): boolean => Number.isFinite(n);

// ── Texts, per field ───────────────────────────────────────────────────

/** Line breaks the reader refuses as control / separator characters; named on their own so the author knows the cause. */
const ZEILENUMBRUCH = /[\n\r\u0085\u2028\u2029]/;

/** Ids of the four text fields (`FeldFehler.feld`) with the kind of text they hold. */
export const TEXTFELDER = [
  { feld: 'nameDe', art: 'name' },
  { feld: 'nameEn', art: 'name' },
  { feld: 'beschreibungDe', art: 'beschreibung' },
  { feld: 'beschreibungEn', art: 'beschreibung' },
] as const;
export type TextArt = (typeof TEXTFELDER)[number]['art'];

/** True if the reader keeps `wert` as the name / description of an otherwise fine entry. The reader is the judge, not a copy of its rules. */
function leserNimmtText(art: TextArt, wert: string): boolean {
  const f = leeresFormular();
  f.id = 'Probe';
  f.nameDe = 'a';
  f.nameEn = 'a';
  if (art === 'name') f.nameDe = wert;
  else f.beschreibungDe = wert;
  return !pruefeEintrag(formularZuEintrag(f), []).includes('texte-ungueltig');
}

/**
 * Why a text is not allowed, or null. Order: too long, line break, then whatever the reader refuses (control /
 * invisible characters; for a name also "no letter or digit at all"). Empty is fine here (a missing name is `name-fehlt`).
 */
export function textGrund(art: TextArt, wert: string): 'text-zu-lang' | 'text-zeilenumbruch' | 'text-steuerzeichen' | 'text-ohne-zeichen' | null {
  if (wert === '') return null;
  if (wert.length > MAX_TEXT_ZEICHEN) return 'text-zu-lang';
  if (ZEILENUMBRUCH.test(wert)) return 'text-zeilenumbruch';
  if (leserNimmtText(art, wert)) return null;
  // Refused although short and single-line: a stray character, or (name only) nothing readable at all.
  return art === 'name' && leserNimmtText(art, `${wert}a`) ? 'text-ohne-zeichen' : 'text-steuerzeichen';
}

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
  const wertVon: Record<string, string> = { nameDe: f.nameDe, nameEn: f.nameEn, beschreibungDe: f.beschreibungDe, beschreibungEn: f.beschreibungEn };
  for (const { feld, art } of TEXTFELDER) {
    const wert = wertVon[feld];
    if (art === 'name' && wert.trim() === '') {
      aus.push({ feld, code: 'name-fehlt' });
      continue;
    }
    const grund = textGrund(art, wert);
    if (grund !== null) aus.push({ feld, code: grund, max: MAX_TEXT_ZEICHEN });
  }
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

// ── What the next save would change in a loaded file ───────────────────

/** What the next save would write differently from what a hand-written file holds: ids of entries, and keys at file level. */
export interface Vereinheitlichung {
  /** Ids of the entries whose canonical text differs from the file's (a clamped value, a dropped field, a missing default). */
  ids: string[];
  /** The file holds a key beside `version` and `gegenstaende` (the writer drops it). */
  dateiebene: boolean;
}

export const keineVereinheitlichung = (): Vereinheitlichung => ({ ids: [], dateiebene: false });

/** True when saving would leave the file as it is, field for field. */
export const istUnveraendert = (v: Vereinheitlichung): boolean => v.ids.length === 0 && !v.dateiebene;

/** A JSON value as one string with the keys of every object sorted: equal for equal content, whatever the key order. */
function sortiertJson(v: unknown): string {
  const sortiert = (x: unknown): unknown =>
    istListe(x)
      ? x.map(sortiert)
      : x !== null && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, w]) => [k, sortiert(w)]))
        : x;
  return JSON.stringify(sortiert(v));
}

const istJsonObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !istListe(v);

/**
 * Compares the raw text of the file with the canonical text of what the reader made of it (`eintraege`, the text
 * `schreibeGegenstandsDatei` would write), entry by entry, field by field, and at file level. Key order and spacing do
 * not count; a clamped number, a dropped unknown field, a default that is missing in the file do. Entries the reader
 * discards are not listed here (the load banner names them). Never throws: a text that is no document gives "nothing".
 */
export function vereinheitlichung(rohtext: string, eintraege: readonly GegenstandsEintrag[]): Vereinheitlichung {
  const aus = keineVereinheitlichung();
  let roh: unknown;
  let kanon: unknown;
  try {
    const a: unknown = JSON.parse(rohtext);
    const b: unknown = JSON.parse(schreibeGegenstandsDatei(eintraege));
    roh = a;
    kanon = b;
  } catch {
    return aus;
  }
  if (!istJsonObjekt(roh) || !istJsonObjekt(kanon)) return aus;
  aus.dateiebene = Object.keys(roh).some((k) => k !== 'version' && k !== 'gegenstaende');
  const rohListe = istListe(roh.gegenstaende) ? roh.gegenstaende : [];
  const kanonListe = istListe(kanon.gegenstaende) ? kanon.gegenstaende : [];
  for (const k of kanonListe) {
    if (!istJsonObjekt(k) || typeof k.id !== 'string') continue;
    const r = rohListe.find((x) => istJsonObjekt(x) && x.id === k.id);
    if (r !== undefined && sortiertJson(r) !== sortiertJson(k)) aus.ids.push(k.id);
  }
  return aus;
}

/** The most entries a document holds, for the "new" button. */
export const MAX_GEGENSTAENDE = MAX_EINTRAEGE;
