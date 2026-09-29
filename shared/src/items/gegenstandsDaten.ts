/**
 * Items from data: format, sanitiser and registration (pure library, no `node:*`, runs in the client too).
 * Gegenstaende aus Daten: Format, Sanitizer und Registrierung (reine Bibliothek, auch im Client lauffaehig).
 *
 * The data file (shared/data/gegenstaende.json, working copy see gegenstandsArbeitskopie.ts) holds
 * hand items and materials. Server, client and editor all call `leseGegenstandsDatei` on the raw text,
 * so nobody trusts a file the other end has not sanitised.
 *
 * Rules that hold everywhere in here:
 *  - Only whitelisted fields are read (`Object.hasOwn`, never a prototype key); unknown fields are
 *    dropped and counted (`unbekannteFelder`).
 *  - Numbers must be finite and are clamped; a wrong type discards the entry.
 *  - Code items win: an entry whose `id` is a code item (incl. clothing and set parts) is discarded.
 *  - `verworfen[]` carries reason CODES (translatable), never free text.
 *  - A broken file as a whole (no JSON, too large, wrong header, too many entries) is reported through
 *    `dateiFehler`; then `eintraege` is empty and the file must not be applied at all.
 *  - No expression, script or path field exists: every value is a number, an enum or a pattern string.
 */

import { ItemType, type ItemShared } from './ItemData.js';
import { istCodeItem, istCodeItemOhneSchreibung, replaceDataItems } from './itemDefs.js';
import { STAT_IDS, type ItemStats } from './stats.js';
import type { Rezept } from './recipes.js';
import { NAME_MUSTER, UPLOAD_MODEL_PREFIX } from '../uploadedModelRegistry.js';
import { ersetzeDatenTexte, repoText } from '../texte.js';

// ── Limits ─────────────────────────────────────────────────────────────
export const GEGENSTAENDE_VERSION = 1;
export const MAX_EINTRAEGE = 500;
export const MAX_DATEI_BYTES = 256 * 1024;
export const MAX_TEXT_ZEICHEN = 200;
export const MAX_ZUTATEN = 20;
export const MAX_SCHADEN = 200;
export const MAX_ERNTE = 5;
export const MAX_STAPEL = 999;

export const ID_MUSTER = /^[A-Z][A-Za-z0-9]{1,31}$/;
const SCHLUESSEL_MUSTER = /^inhalt\.[A-Za-z0-9._-]{1,80}$/;
const SYMBOL_MUSTER = /^[A-Za-z0-9_-]{1,64}$/;
const ZUTAT_MUSTER = /^[A-Za-z0-9_]{1,64}$/;
/**
 * Characters that are refused in texts, by Unicode category: control (Cc), format (Cf: zero-width, bidi
 * controls, soft hyphen, word joiner, BOM, tag characters), line/paragraph separators (Zl, Zp), lone
 * surrogates (Cs; a well-formed pair is one astral character and does not match under /u), unassigned
 * (Cn, incl. U+FFFE/FFFF) and private use (Co). Category tables differ a little between engines, so the
 * invisible ones that are not in Cf are listed by hand: U+180E, U+FFFC, the Hangul fillers, the braille
 * blank U+2800, variation selectors, Mongolian selectors, Khmer inherent vowels and the grapheme joiner.
 * The text is DISCARDED (entry refused) instead of stripped: silently editing a name would show something
 * the author did not write. HTML in texts is allowed on purpose: the client only ever shows texts through
 * `textContent` (G3), never as markup, so `<b>` is just characters there.
 */
const STEUERZEICHEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Cn}\p{Co}\u180e\ufffc\u3164\u115f\u1160\u2800\ufe00-\ufe0f\u{e0100}-\u{e01ef}\u180b-\u180d\u17b4\u17b5\u034f]/u;
/** A name needs at least one letter or digit, else it is invisible or only punctuation. */
const SICHTBAR = /[\p{L}\p{N}]/u;

export const GEGENSTANDS_TYPEN = ['einhaendigWaffe', 'zweihaendigWaffe', 'werkzeug', 'material'] as const;
export type GegenstandsTyp = typeof GEGENSTANDS_TYPEN[number];
export const ANIMATIONSSAETZE = ['sword', 'staff', 'spear'] as const;
export type Animationssatz = typeof ANIMATIONSSAETZE[number];
/** Same names and values as `Rarity` of the item tooltip (shared/src/items/stats.ts there). */
export const SELTENHEITEN = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Seltenheit = typeof SELTENHEITEN[number];

/** Reason codes of a broken file as a whole. */
export type DateiFehler =
  | 'datei-kein-json'
  | 'datei-zu-gross'
  | 'datei-kopf-falsch'
  | 'datei-version-unbekannt'
  | 'datei-zu-viele-eintraege';

/** Reason codes of a discarded entry. */
export type VerwerfGrund =
  | 'eintrag-kein-objekt'
  | 'id-ungueltig'
  | 'id-doppelt'
  | 'id-code-kollision'
  | 'id-schreibung-code'
  | 'id-schreibung-doppelt'
  | 'schluessel-ungueltig'
  | 'typ-unbekannt'
  | 'slot-unbekannt'
  | 'modell-ungueltig'
  | 'symbol-ungueltig'
  | 'zahl-ungueltig'
  | 'werte-ungueltig'
  | 'feld-ungueltig'
  | 'rezept-ungueltig'
  | 'rezept-selbstbezug'
  | 'rezept-zutat-unbekannt'
  | 'rezept-zyklus'
  | 'texte-ungueltig'
  | 'texte-schluessel-fremd'
  | 'texte-name-fehlt';

export interface GegenstandsText {
  de?: string;
  en?: string;
}

/** A sanitised entry: every optional field of the file is resolved to a value or an explicit null. */
export interface GegenstandsEintrag {
  id: string;
  nameSchluessel: string;
  beschreibungSchluessel: string | null;
  typ: GegenstandsTyp;
  slot: 'hand';
  modell: {
    /** `hochgeladen/<U_Name>` or null. */
    upload: string | null;
    skala: number;
    haltePosition: [number, number, number] | null;
    halteRotation: [number, number, number] | null;
    hiebVersatz: number | null;
    animationsSatz: Animationssatz | null;
  };
  /** Sprite name in assets/sprites/, or null (two-letter fallback). */
  symbol: string | null;
  stapel: number;
  gewicht: number;
  werte: ItemStats;
  ernte: { baum?: number; fels?: number };
  haltbarkeit: { max?: number; verbrauch?: number; ausdauer?: number };
  itemLevel: number;
  rarity: Seltenheit;
  rezept: { menge: number; zutaten: Array<{ item: string; menge: number }> } | null;
  texte: Record<string, GegenstandsText>;
}

export interface VerworfenerEintrag {
  /** Position in the file. */
  index: number;
  /** The id if it is a well-formed one, else null. */
  id: string | null;
  grund: VerwerfGrund;
}

export interface GegenstandsLesung {
  /** True if the file as a whole is usable (`dateiFehler === null`); single entries may still be discarded. */
  ok: boolean;
  dateiFehler: DateiFehler | null;
  eintraege: GegenstandsEintrag[];
  verworfen: VerworfenerEintrag[];
  /** Number of fields that were dropped because they are not on the whitelist. */
  unbekannteFelder: number;
}

// ── Sanitiser ──────────────────────────────────────────────────────────

class Verwerfen extends Error {
  constructor(readonly grund: VerwerfGrund) {
    super(grund);
  }
}

type Roh = Record<string, unknown>;

function istObjekt(v: unknown): v is Roh {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nimm(o: Roh, schluessel: string): unknown {
  return Object.hasOwn(o, schluessel) ? o[schluessel] : undefined;
}

function zaehleUnbekannte(o: Roh, erlaubt: readonly string[], z: { n: number }): void {
  for (const k of Object.keys(o)) if (!erlaubt.includes(k)) z.n++;
}

function klemme(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function zahl(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Verwerfen('zahl-ungueltig');
  return klemme(v, min, max);
}

function ganz(v: unknown, min: number, max: number): number | undefined {
  const n = zahl(v, min, max);
  return n === undefined ? undefined : klemme(Math.round(n), min, max);
}

function vektor(v: unknown, grenze: number): [number, number, number] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length !== 3) throw new Verwerfen('modell-ungueltig');
  const a = v.map((x) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Verwerfen('modell-ungueltig');
    return klemme(x, -grenze, grenze);
  });
  return [a[0], a[1], a[2]];
}

function text(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_TEXT_ZEICHEN || STEUERZEICHEN.test(v)) {
    throw new Verwerfen('texte-ungueltig');
  }
  return v;
}

function pruefeEintrag(roh: unknown, z: { n: number }): GegenstandsEintrag {
  if (!istObjekt(roh)) throw new Verwerfen('eintrag-kein-objekt');
  zaehleUnbekannte(
    roh,
    ['id', 'nameSchluessel', 'beschreibungSchluessel', 'typ', 'slot', 'modell', 'symbol', 'stapel', 'gewicht',
      'werte', 'ernte', 'haltbarkeit', 'itemLevel', 'rarity', 'rezept', 'texte'],
    z
  );

  const id = nimm(roh, 'id');
  if (typeof id !== 'string' || !ID_MUSTER.test(id)) throw new Verwerfen('id-ungueltig');
  if (istCodeItem(id)) throw new Verwerfen('id-code-kollision');
  // Same name apart from case (`MESSER` next to `Messer`): confusable, so it is refused as well.
  if (istCodeItemOhneSchreibung(id)) throw new Verwerfen('id-schreibung-code');

  const praefix = `inhalt.gegenstand.${id}.`;
  const nameSchluessel = nimm(roh, 'nameSchluessel');
  if (typeof nameSchluessel !== 'string' || !SCHLUESSEL_MUSTER.test(nameSchluessel) || !nameSchluessel.startsWith(praefix)) {
    throw new Verwerfen('schluessel-ungueltig');
  }
  const beschr = nimm(roh, 'beschreibungSchluessel');
  if (beschr !== undefined && beschr !== null
      && (typeof beschr !== 'string' || !SCHLUESSEL_MUSTER.test(beschr) || !beschr.startsWith(praefix) || beschr === nameSchluessel)) {
    throw new Verwerfen('schluessel-ungueltig');
  }
  const beschreibungSchluessel = typeof beschr === 'string' ? beschr : null;

  const typ = nimm(roh, 'typ');
  if (typeof typ !== 'string' || !(GEGENSTANDS_TYPEN as readonly string[]).includes(typ)) throw new Verwerfen('typ-unbekannt');
  const slot = nimm(roh, 'slot');
  if (slot !== undefined && slot !== 'hand') throw new Verwerfen('slot-unbekannt');

  // Model
  const modellRoh = nimm(roh, 'modell');
  const modell: GegenstandsEintrag['modell'] = {
    upload: null, skala: 1, haltePosition: null, halteRotation: null, hiebVersatz: null, animationsSatz: null,
  };
  if (modellRoh !== undefined && modellRoh !== null) {
    if (!istObjekt(modellRoh)) throw new Verwerfen('modell-ungueltig');
    zaehleUnbekannte(modellRoh, ['upload', 'skala', 'haltePosition', 'halteRotation', 'hiebVersatz', 'animationsSatz'], z);
    const upload = nimm(modellRoh, 'upload');
    if (upload !== undefined && upload !== null) {
      if (typeof upload !== 'string' || !upload.startsWith(UPLOAD_MODEL_PREFIX)) throw new Verwerfen('modell-ungueltig');
      // The name behind the prefix must match the upload name pattern; that also rules out `..` and `/`.
      if (!NAME_MUSTER.test(upload.slice(UPLOAD_MODEL_PREFIX.length))) throw new Verwerfen('modell-ungueltig');
      modell.upload = upload;
    }
    modell.skala = zahl(nimm(modellRoh, 'skala'), 0.05, 5) ?? 1;
    modell.haltePosition = vektor(nimm(modellRoh, 'haltePosition'), 2);
    modell.halteRotation = vektor(nimm(modellRoh, 'halteRotation'), 2 * Math.PI);
    modell.hiebVersatz = zahl(nimm(modellRoh, 'hiebVersatz'), 0, 1.5) ?? null;
    const satz = nimm(modellRoh, 'animationsSatz');
    if (satz !== undefined && satz !== null) {
      if (typeof satz !== 'string' || !(ANIMATIONSSAETZE as readonly string[]).includes(satz)) throw new Verwerfen('modell-ungueltig');
      modell.animationsSatz = satz as Animationssatz;
    }
  }

  const symbolRoh = nimm(roh, 'symbol');
  if (symbolRoh !== undefined && symbolRoh !== null && (typeof symbolRoh !== 'string' || !SYMBOL_MUSTER.test(symbolRoh))) {
    throw new Verwerfen('symbol-ungueltig');
  }
  const symbol = typeof symbolRoh === 'string' ? symbolRoh : null;

  const stapel = ganz(nimm(roh, 'stapel'), 1, MAX_STAPEL) ?? 1;
  const gewicht = zahl(nimm(roh, 'gewicht'), 0, 1000) ?? 1;

  // Attribute values
  const werte: ItemStats = {};
  const werteRoh = nimm(roh, 'werte');
  if (werteRoh !== undefined && werteRoh !== null) {
    if (!istObjekt(werteRoh)) throw new Verwerfen('werte-ungueltig');
    zaehleUnbekannte(werteRoh, STAT_IDS, z);
    for (const s of STAT_IDS) {
      const w = zahl(nimm(werteRoh, s), 0, s === 'damage' ? MAX_SCHADEN : 1000);
      if (w !== undefined) werte[s] = w;
    }
  }

  // Harvest levels
  const ernte: GegenstandsEintrag['ernte'] = {};
  const ernteRoh = nimm(roh, 'ernte');
  if (ernteRoh !== undefined && ernteRoh !== null) {
    if (!istObjekt(ernteRoh)) throw new Verwerfen('feld-ungueltig');
    zaehleUnbekannte(ernteRoh, ['baum', 'fels'], z);
    const baum = ganz(nimm(ernteRoh, 'baum'), 0, MAX_ERNTE);
    const fels = ganz(nimm(ernteRoh, 'fels'), 0, MAX_ERNTE);
    if (baum !== undefined) ernte.baum = baum;
    if (fels !== undefined) ernte.fels = fels;
  }

  // Durability levers
  const haltbarkeit: GegenstandsEintrag['haltbarkeit'] = {};
  const haltRoh = nimm(roh, 'haltbarkeit');
  if (haltRoh !== undefined && haltRoh !== null) {
    if (!istObjekt(haltRoh)) throw new Verwerfen('feld-ungueltig');
    zaehleUnbekannte(haltRoh, ['max', 'verbrauch', 'ausdauer'], z);
    const max = zahl(nimm(haltRoh, 'max'), 1, 10000);
    const verbrauch = zahl(nimm(haltRoh, 'verbrauch'), 0, 100);
    const ausdauer = zahl(nimm(haltRoh, 'ausdauer'), 0, 100);
    if (max !== undefined) haltbarkeit.max = max;
    if (verbrauch !== undefined) haltbarkeit.verbrauch = verbrauch;
    if (ausdauer !== undefined) haltbarkeit.ausdauer = ausdauer;
  }

  const itemLevel = ganz(nimm(roh, 'itemLevel'), 1, 100) ?? 1;
  const seltenRoh = nimm(roh, 'rarity');
  if (seltenRoh !== undefined && (typeof seltenRoh !== 'string' || !(SELTENHEITEN as readonly string[]).includes(seltenRoh))) {
    throw new Verwerfen('feld-ungueltig');
  }
  const rarity = (seltenRoh ?? 'common') as Seltenheit;

  // Recipe (existence of the ingredients is checked later, when all entries are known)
  let rezept: GegenstandsEintrag['rezept'] = null;
  const rezeptRoh = nimm(roh, 'rezept');
  if (rezeptRoh !== undefined && rezeptRoh !== null) {
    if (!istObjekt(rezeptRoh)) throw new Verwerfen('rezept-ungueltig');
    zaehleUnbekannte(rezeptRoh, ['menge', 'zutaten'], z);
    const menge = ganz(nimm(rezeptRoh, 'menge'), 1, 999) ?? 1;
    const zutatenRoh = nimm(rezeptRoh, 'zutaten');
    if (!Array.isArray(zutatenRoh) || zutatenRoh.length < 1 || zutatenRoh.length > MAX_ZUTATEN) throw new Verwerfen('rezept-ungueltig');
    const zutaten: Array<{ item: string; menge: number }> = [];
    for (const zr of zutatenRoh) {
      if (!istObjekt(zr)) throw new Verwerfen('rezept-ungueltig');
      zaehleUnbekannte(zr, ['item', 'menge'], z);
      const item = nimm(zr, 'item');
      if (typeof item !== 'string' || !ZUTAT_MUSTER.test(item)) throw new Verwerfen('rezept-ungueltig');
      if (item === id) throw new Verwerfen('rezept-selbstbezug');
      if (zutaten.some((x) => x.item === item)) throw new Verwerfen('rezept-ungueltig');
      const m = ganz(nimm(zr, 'menge'), 1, 999);
      if (m === undefined) throw new Verwerfen('rezept-ungueltig');
      zutaten.push({ item, menge: m });
    }
    rezept = { menge, zutaten };
  }

  // Texts of the entry: only its own two keys, only de/en
  const texte: Record<string, GegenstandsText> = {};
  const texteRoh = nimm(roh, 'texte');
  if (texteRoh !== undefined && texteRoh !== null) {
    if (!istObjekt(texteRoh)) throw new Verwerfen('texte-ungueltig');
    for (const k of Object.keys(texteRoh)) {
      if (k !== nameSchluessel && k !== beschreibungSchluessel) throw new Verwerfen('texte-schluessel-fremd');
    }
    for (const k of [nameSchluessel, beschreibungSchluessel]) {
      if (k === null || !Object.hasOwn(texteRoh, k)) continue;
      const t = texteRoh[k];
      if (!istObjekt(t)) throw new Verwerfen('texte-ungueltig');
      zaehleUnbekannte(t, ['de', 'en'], z);
      const de = nimm(t, 'de');
      const en = nimm(t, 'en');
      const eintrag: GegenstandsText = {};
      if (de !== undefined) eintrag.de = text(de);
      if (en !== undefined) eintrag.en = text(en);
      texte[k] = eintrag;
    }
  }
  const nameText = Object.hasOwn(texte, nameSchluessel) ? texte[nameSchluessel] : undefined;
  if (!nameText || !nameText.de?.trim() || !nameText.en?.trim()) throw new Verwerfen('texte-name-fehlt');
  if (!SICHTBAR.test(nameText.de) || !SICHTBAR.test(nameText.en)) throw new Verwerfen('texte-ungueltig');

  return {
    id, nameSchluessel, beschreibungSchluessel, typ: typ as GegenstandsTyp, slot: 'hand', modell,
    symbol, stapel, gewicht, werte, ernte, haltbarkeit, itemLevel, rarity, rezept, texte,
  };
}

/** True if `start` can reach itself through recipe ingredients that are data items. */
function liegtImZyklus(start: string, karte: ReadonlyMap<string, GegenstandsEintrag>): boolean {
  const besucht = new Set<string>();
  const stapel = [...(karte.get(start)?.rezept?.zutaten ?? [])].map((x) => x.item);
  while (stapel.length > 0) {
    const name = stapel.pop() as string;
    if (name === start) return true;
    if (besucht.has(name)) continue;
    besucht.add(name);
    const e = karte.get(name);
    if (e?.rezept) for (const x of e.rezept.zutaten) stapel.push(x.item);
  }
  return false;
}

/**
 * Reads and sanitises the text of a data file. Never throws.
 * Liest und saeubert den Text einer Gegenstandsdatei. Wirft nie.
 */
export function leseGegenstandsDatei(text: string): GegenstandsLesung {
  const kaputt = (dateiFehler: DateiFehler): GegenstandsLesung =>
    ({ ok: false, dateiFehler, eintraege: [], verworfen: [], unbekannteFelder: 0 });
  if (typeof text !== 'string') return kaputt('datei-kein-json');
  if (text.length > MAX_DATEI_BYTES || new TextEncoder().encode(text).length > MAX_DATEI_BYTES) return kaputt('datei-zu-gross');
  let wurzel: unknown;
  try {
    wurzel = JSON.parse(text);
  } catch {
    return kaputt('datei-kein-json');
  }
  if (!istObjekt(wurzel)) return kaputt('datei-kopf-falsch');
  const version = nimm(wurzel, 'version');
  const liste = nimm(wurzel, 'gegenstaende');
  if (typeof version !== 'number' || !Array.isArray(liste)) return kaputt('datei-kopf-falsch');
  if (version !== GEGENSTAENDE_VERSION) return kaputt('datei-version-unbekannt');
  if (liste.length > MAX_EINTRAEGE) return kaputt('datei-zu-viele-eintraege');

  const z = { n: 0 };
  zaehleUnbekannte(wurzel, ['version', 'gegenstaende'], z);
  const verworfen: VerworfenerEintrag[] = [];
  const karte = new Map<string, GegenstandsEintrag>();
  const kleinIds = new Set<string>();
  liste.forEach((roh, index) => {
    const idRoh = istObjekt(roh) ? nimm(roh, 'id') : undefined;
    const idOk = typeof idRoh === 'string' && ID_MUSTER.test(idRoh) ? idRoh : null;
    try {
      const e = pruefeEintrag(roh, z);
      if (karte.has(e.id)) throw new Verwerfen('id-doppelt');
      if (kleinIds.has(e.id.toLowerCase())) throw new Verwerfen('id-schreibung-doppelt');
      kleinIds.add(e.id.toLowerCase());
      karte.set(e.id, e);
    } catch (fehler) {
      if (!(fehler instanceof Verwerfen)) throw fehler;
      verworfen.push({ index, id: idOk, grund: fehler.grund });
    }
  });

  // Recipes across entries: ingredients must exist, no cycles. Dropping an entry can orphan others, so repeat.
  const indexVon = new Map<string, number>();
  liste.forEach((roh, i) => {
    const id = istObjekt(roh) ? nimm(roh, 'id') : undefined;
    if (typeof id === 'string' && !indexVon.has(id)) indexVon.set(id, i);
  });
  const wirf = (id: string, grund: VerwerfGrund): void => {
    karte.delete(id);
    verworfen.push({ index: indexVon.get(id) ?? -1, id, grund });
  };
  for (let geaendert = true; geaendert;) {
    geaendert = false;
    for (const e of [...karte.values()]) {
      if (e.rezept?.zutaten.some((x) => !istCodeItem(x.item) && !karte.has(x.item))) {
        wirf(e.id, 'rezept-zutat-unbekannt');
        geaendert = true;
      }
    }
    if (geaendert) continue;
    // Find every cycle member first, then drop them together (dropping one would hide the rest of the cycle).
    const imZyklus = [...karte.values()].filter((e) => liegtImZyklus(e.id, karte));
    for (const e of imZyklus) {
      wirf(e.id, 'rezept-zyklus');
      geaendert = true;
    }
  }

  // Map order is the order of the first valid occurrence, which is the file order.
  const eintraege = [...karte.values()];
  return { ok: true, dateiFehler: null, eintraege, verworfen, unbekannteFelder: z.n };
}

// ── Translation into the game ──────────────────────────────────────────

function itemTypVon(typ: GegenstandsTyp): ItemType {
  if (typ === 'material') return ItemType.Material;
  if (typ === 'werkzeug') return ItemType.Tool;
  return ItemType.TwoHandedWeapon;
}

/** German name: the repo catalog wins, then the entry's own text, then the key itself. */
function labelVon(e: GegenstandsEintrag): string {
  return repoText(e.nameSchluessel, 'de') ?? (Object.hasOwn(e.texte, e.nameSchluessel) ? e.texte[e.nameSchluessel].de : undefined) ?? e.nameSchluessel;
}

/**
 * `ItemShared` of an entry. `name = id`, `label` is the German fallback, the client shows
 * `inhaltText(nameSchluessel, language)`. `toolTier` stays 0 (unused); harvesting reads `ernte`.
 */
export function gegenstandZuItem(e: GegenstandsEintrag): ItemShared {
  const m = e.modell;
  const stufe = { itemLevel: e.itemLevel, rarity: e.rarity };
  return {
    name: e.id,
    label: labelVon(e),
    itemType: itemTypVon(e.typ),
    icon: e.symbol ?? '',
    model: m.upload,
    maxStackSize: e.stapel,
    weight: e.gewicht,
    stats: { ...e.werte },
    toolTier: 0,
    ...(m.haltePosition ? { holdPosition: m.haltePosition } : {}),
    ...(m.halteRotation ? { holdRotation: m.halteRotation } : {}),
    ...(m.hiebVersatz !== null ? { holdOffsetStrike: m.hiebVersatz } : {}),
    ...(m.animationsSatz ? { animationSet: m.animationsSatz } : {}),
    ...(e.haltbarkeit.max !== undefined ? { maxDurability: e.haltbarkeit.max } : {}),
    ...(e.haltbarkeit.verbrauch !== undefined ? { useDurabilityDrain: e.haltbarkeit.verbrauch } : {}),
    ...(e.haltbarkeit.ausdauer !== undefined ? { attackStamina: e.haltbarkeit.ausdauer } : {}),
    ernte: { ...e.ernte },
    modellSkala: m.skala,
    nameSchluessel: e.nameSchluessel,
    datenItem: true,
    ...stufe,
  };
}

/** The entries that use the upload (`U_Name` or `hochgeladen/U_Name`). For "remove upload" warnings. */
export function gegenstaendeMitUpload(liste: readonly GegenstandsEintrag[], uploadName: string): GegenstandsEintrag[] {
  const voll = uploadName.startsWith(UPLOAD_MODEL_PREFIX) ? uploadName : UPLOAD_MODEL_PREFIX + uploadName;
  return liste.filter((e) => e.modell.upload === voll);
}

// ── Registration ───────────────────────────────────────────────────────

let rezepteDaten: readonly Rezept[] = [];

/**
 * Recipes of the data items (a separate list; the code recipes in recipes.ts stay as they are and never
 * use data items). Read it at the moment of use: `wendeGegenstandsDatenAn` swaps the whole list.
 */
export function datenRezepte(): readonly Rezept[] {
  return rezepteDaten;
}

/** Recipes of the sanitised entries, in entry order. */
export function rezepteAus(eintraege: readonly GegenstandsEintrag[]): Rezept[] {
  return eintraege.flatMap((e) => (e.rezept
    ? [{ ergebnis: e.id, menge: e.rezept.menge, zutaten: e.rezept.zutaten.map((x) => ({ item: x.item, menge: x.menge })) }]
    : []));
}

/** The text layer of the entries, ready for `ersetzeDatenTexte`. */
export function datenTexteAus(eintraege: readonly GegenstandsEintrag[]): { de: Map<string, string>; en: Map<string, string> } {
  const de = new Map<string, string>();
  const en = new Map<string, string>();
  for (const e of eintraege) {
    for (const [k, t] of Object.entries(e.texte)) {
      if (t.de) de.set(k, t.de);
      if (t.en) en.set(k, t.en);
    }
  }
  return { de, en };
}

/**
 * Makes the sanitised entries the game's data state: items (`findItem`, `ITEMS_BY_NAME`), the text layer
 * behind `inhaltText` and `datenRezepte()`, all replaced as a whole. Everything is built first; if that
 * throws, nothing has changed. Call with `[]` to remove all data items.
 */
export function wendeGegenstandsDatenAn(eintraege: readonly GegenstandsEintrag[]): void {
  const items = eintraege.map(gegenstandZuItem);
  const texte = datenTexteAus(eintraege);
  const rezepte = rezepteAus(eintraege);
  replaceDataItems(items); // throws on a collision before anything is swapped
  ersetzeDatenTexte(texte);
  rezepteDaten = rezepte;
}
