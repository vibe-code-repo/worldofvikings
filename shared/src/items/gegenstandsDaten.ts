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
 *    The base stock (shared/data/gegenstaende.json, `grundbestand.ts`) is NOT code: a working-copy entry with
 *    the same `id` replaces the base entry, but a spelling that only differs in case is refused.
 *  - `verworfen[]` carries reason CODES (translatable), never free text.
 *  - A broken file as a whole (no JSON, too large, wrong header, too many entries) is reported through
 *    `dateiFehler`; then `eintraege` is empty and the file must not be applied at all.
 *  - No expression, script or path field exists: every value is a number, an enum or a pattern string.
 */

import { ItemType, type ItemShared } from './ItemData.js';
import { istCodeItem, istCodeItemOhneSchreibung, replaceDataItems, setzeGrundItems } from './itemDefs.js';
import { STAT_IDS, type ItemStats } from './stats.js';
import type { Rezept } from './recipes.js';
import { NAME_MUSTER, UPLOAD_MODEL_PREFIX } from '../uploadedModelRegistry.js';
import { istEigenesModell } from '../prefabs.js';
import { PIECE_TABLES, TERRAIN_HIT_OPS } from './PieceTable.js';
import { ersetzeDatenTexte, repoText } from '../texte.js';
import grundDatei from '../../data/gegenstaende.json';

// ── Limits ─────────────────────────────────────────────────────────────
export const GEGENSTAENDE_VERSION = 1;
export const MAX_EINTRAEGE = 500;
/** 1 MB: 500 realistically filled entries (about 1.7 KB each when pretty-printed) fit; see the size test. */
export const MAX_DATEI_BYTES = 1024 * 1024;
export const MAX_TEXT_ZEICHEN = 200;
export const MAX_ZUTATEN = 20;
export const MAX_SCHADEN = 200;
export const MAX_ERNTE = 5;
export const MAX_STAPEL = 999;

/** Build tables a hand item may open (keys of `PIECE_TABLES`: hoe, cultivator, hammer). */
export const BAUTAFELN: readonly string[] = Object.keys(PIECE_TABLES);
/** Terrain operations a hit may trigger (keys of `TERRAIN_HIT_OPS`). */
export const TERRAIN_OPS: readonly string[] = Object.keys(TERRAIN_HIT_OPS);

/**
 * Until the client receives the data state (GD3) it only knows the baked-in base stock. An entry with a base id may
 * therefore differ from the base entry only in `ernte` (the server decides harvesting alone); everything else the
 * client reads (stack size, weight, durability, model, grip, symbol, values, recipe, names ...) would drift apart
 * from the server. GD3 sets this to `false`: that is the one line that lifts the lock.
 * Bis der Client den Datenstand bekommt (GD3), darf ein Grundgegenstand nur in `ernte` vom Grundstand abweichen.
 */
export const GRUNDWERTE_GESPERRT = true;

export const ID_MUSTER = /^[A-Z][A-Za-z0-9]{1,31}$/;
const SCHLUESSEL_MUSTER = /^inhalt\.[A-Za-z0-9._-]{1,80}$/;
const SYMBOL_MUSTER = /^[A-Za-z0-9_-]{1,64}$/;
const ZUTAT_MUSTER = /^[A-Za-z0-9_]{1,64}$/;
/**
 * Characters that are refused in texts, by Unicode category: control (Cc), format (Cf: zero-width, bidi
 * controls, soft hyphen, word joiner, BOM, tag characters), line/paragraph separators (Zl, Zp), lone
 * surrogates (Cs; a well-formed pair is one astral character and does not match under /u) and private
 * use (Co). NOT `\p{Cn}`: which code points are "unassigned" depends on the Unicode version of the engine,
 * and server and client must agree, so a newly assigned emoji must pass everywhere. Instead the
 * noncharacters (U+FDD0-FDEF and U+xFFFE/xFFFF of every plane) are listed, and so are the invisible ones
 * that are not in Cf: U+180E, U+FFFC, the Hangul fillers, the braille blank U+2800, variation selectors
 * U+FE00-FE0E and the tag/selector block U+E0000-E0FFF, the unassigned default-ignorables U+2065 and U+FFF0-FFF8, Mongolian selectors, Khmer inherent vowels and the grapheme joiner.
 * ZWNJ/ZWJ (U+200C/D) and VS16 (U+FE0F) are allowed only in context (`kontextOk`).
 * The text is DISCARDED (entry refused) instead of stripped: silently editing a name would show something
 * the author did not write. HTML in texts is allowed on purpose: the client only ever shows texts through
 * `textContent` (G3), never as markup, so `<b>` is just characters there.
 */
const NICHTZEICHEN = ['\\u{fdd0}-\\u{fdef}', ...Array.from({ length: 17 }, (_, plane) => `\\u{${(plane * 0x10000 + 0xfffe).toString(16)}}\\u{${(plane * 0x10000 + 0xffff).toString(16)}}`)].join('');
const STEUERZEICHEN = new RegExp(
  `[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\p{Cs}\\p{Co}${NICHTZEICHEN}\\u2065\\ufff0-\\ufff8\\u180e\\ufffc\\u3164\\u115f\\u1160\\u2800\\ufe00-\\ufe0e\\u{e0000}-\\u{e0fff}\\u180b-\\u180d\\u17b4\\u17b5\\u034f]`,
  'u'
);
const JOINER_NACHBAR = /^[\p{L}\p{M}\p{Extended_Pictographic}]$/u;
const JOINER_VORGAENGER = /^[\p{L}\p{M}\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]$/u;
const EMOJI = /^\p{Extended_Pictographic}$/u;

/**
 * True if `v` has no refused character. ZWNJ/ZWJ pass when both neighbours are letters, marks or
 * pictographs (Persian, Devanagari, emoji sequences such as a man plus a sheaf of rice), and VS16 passes
 * directly after a pictograph. The soft hyphen U+00AD stays refused.
 */
function zeichenOk(v: string): boolean {
  const z = Array.from(v);
  let rest = '';
  for (let i = 0; i < z.length; i++) {
    const c = z[i];
    if (c === '\u200c' || c === '\u200d') {
      const vor = z[i - 1];
      const nach = z[i + 1];
      if (vor === undefined || nach === undefined || !JOINER_VORGAENGER.test(vor) || !JOINER_NACHBAR.test(nach)) return false;
    } else if (c === '\ufe0f') {
      const vor = z[i - 1];
      if (vor === undefined || !EMOJI.test(vor)) return false;
    } else {
      rest += c;
    }
  }
  return !STEUERZEICHEN.test(rest);
}
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

/** Reason codes of a discarded entry (all of them, for translation tables and tests). */
export const VERWERF_GRUENDE = [
  'eintrag-kein-objekt',
  'id-ungueltig',
  'id-doppelt',
  'id-code-kollision',
  'id-schreibung-code',
  'id-schreibung-doppelt',
  'schluessel-ungueltig',
  'typ-unbekannt',
  'slot-unbekannt',
  'modell-ungueltig',
  'symbol-ungueltig',
  'zahl-ungueltig',
  'werte-ungueltig',
  'feld-ungueltig',
  'rezept-ungueltig',
  'rezept-selbstbezug',
  'rezept-zutat-unbekannt',
  'rezept-zyklus',
  'texte-ungueltig',
  'texte-schluessel-fremd',
  'texte-name-fehlt',
  'grundwert-gesperrt',
  'eintrag-ungueltig',
  'zu-viele-eintraege',
] as const;
export type VerwerfGrund = typeof VERWERF_GRUENDE[number];

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
    /** `hochgeladen/<U_Name>` or null. Excludes `eigen`. */
    upload: string | null;
    /** Name of an own model (`istEigenesModell`, e.g. `Messer`) or null. Excludes `upload`. */
    eigen: string | null;
    skala: number;
    haltePosition: [number, number, number] | null;
    halteRotation: [number, number, number] | null;
    hiebVersatz: number | null;
    animationsSatz: Animationssatz | null;
  };
  /** Key into `PIECE_TABLES` (the item opens build mode), or null. */
  bautafel: string | null;
  /** Key into `TERRAIN_HIT_OPS` (a hit on the ground digs), or null. */
  terrain: string | null;
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
  /**
   * Ids of entries with a base id whose values differ from the base entry (beyond `ernte`): reading REPLACED them by the
   * base entry (keeping only their `ernte`), the file is not discarded and no other entry is lost. Callers warn loudly;
   * the admin route still refuses to SAVE such a file (422), so the author notices.
   */
  grundErsetzt: string[];
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

/** An enum field: undefined/null = not set; a value outside the list discards the entry. */
function auswahl(v: unknown, erlaubt: readonly string[]): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !erlaubt.includes(v)) throw new Verwerfen('feld-ungueltig');
  return v;
}

function text(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_TEXT_ZEICHEN || !zeichenOk(v)) {
    throw new Verwerfen('texte-ungueltig');
  }
  return v;
}

/** Counter of one read: unknown fields; `streng` = a deviating base entry is discarded; else replaced and listed in `ersetzt`. */
interface Zaehler { n: number; streng?: boolean; ersetzt?: string[]; ohneGrund?: boolean }

function saubereEintrag(roh: unknown, z: Zaehler): GegenstandsEintrag {
  if (!istObjekt(roh)) throw new Verwerfen('eintrag-kein-objekt');
  zaehleUnbekannte(
    roh,
    ['id', 'nameSchluessel', 'beschreibungSchluessel', 'typ', 'slot', 'modell', 'bautafel', 'terrain', 'symbol', 'stapel', 'gewicht',
      'werte', 'ernte', 'haltbarkeit', 'itemLevel', 'rarity', 'rezept', 'texte'],
    z
  );

  const id = nimm(roh, 'id');
  if (typeof id !== 'string' || !ID_MUSTER.test(id)) throw new Verwerfen('id-ungueltig');
  if (istCodeItem(id)) throw new Verwerfen('id-code-kollision');
  // Same name apart from case (`MESSER` next to `Messer`): confusable, so it is refused as well.
  if (istCodeItemOhneSchreibung(id)) throw new Verwerfen('id-schreibung-code');
  // Same for the base stock: the exact id replaces the base entry, a different spelling of it is refused.
  if (grundKlein.has(id.toLowerCase()) && !grundIds.has(id)) throw new Verwerfen('id-schreibung-code');

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
    upload: null, eigen: null, skala: 1, haltePosition: null, halteRotation: null, hiebVersatz: null, animationsSatz: null,
  };
  if (modellRoh !== undefined && modellRoh !== null) {
    if (!istObjekt(modellRoh)) throw new Verwerfen('modell-ungueltig');
    zaehleUnbekannte(modellRoh, ['upload', 'eigen', 'skala', 'haltePosition', 'halteRotation', 'hiebVersatz', 'animationsSatz'], z);
    const upload = nimm(modellRoh, 'upload');
    if (upload !== undefined && upload !== null) {
      if (typeof upload !== 'string' || !upload.startsWith(UPLOAD_MODEL_PREFIX)) throw new Verwerfen('modell-ungueltig');
      // The name behind the prefix must match the upload name pattern; that also rules out `..` and `/`.
      if (!NAME_MUSTER.test(upload.slice(UPLOAD_MODEL_PREFIX.length))) throw new Verwerfen('modell-ungueltig');
      modell.upload = upload;
    }
    const eigen = nimm(modellRoh, 'eigen');
    if (eigen !== undefined && eigen !== null) {
      // Only a model of the whitelist; an upload and an own model exclude each other.
      if (typeof eigen !== 'string' || !istEigenesModell(eigen) || modell.upload !== null) throw new Verwerfen('modell-ungueltig');
      modell.eigen = eigen;
    }
    modell.skala = zahl(nimm(modellRoh, 'skala'), 0.05, 5) ?? 1;
    modell.haltePosition = vektor(nimm(modellRoh, 'haltePosition'), 2);
    modell.halteRotation = vektor(nimm(modellRoh, 'halteRotation'), 2 * Math.PI);
    // null = "not set", as the writer emits it
    const versatz = nimm(modellRoh, 'hiebVersatz');
    modell.hiebVersatz = versatz === null ? null : zahl(versatz, 0, 1.5) ?? null;
    const satz = nimm(modellRoh, 'animationsSatz');
    if (satz !== undefined && satz !== null) {
      if (typeof satz !== 'string' || !(ANIMATIONSSAETZE as readonly string[]).includes(satz)) throw new Verwerfen('modell-ungueltig');
      modell.animationsSatz = satz as Animationssatz;
    }
  }

  const bautafel = auswahl(nimm(roh, 'bautafel'), BAUTAFELN);
  const terrain = auswahl(nimm(roh, 'terrain'), TERRAIN_OPS);

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

  const eintrag: GegenstandsEintrag = {
    id, nameSchluessel, beschreibungSchluessel, typ: typ as GegenstandsTyp, slot: 'hand', modell,
    bautafel, terrain, symbol, stapel, gewicht, werte, ernte, haltbarkeit, itemLevel, rarity, rezept, texte,
  };
  if (GRUNDWERTE_GESPERRT && grundIds.has(id) && !z.ohneGrund) {
    const grundEintrag = grundEintraege.find((g) => g.id === id);
    const ohneErnte = (e: GegenstandsEintrag): string => JSON.stringify({ ...e, ernte: null });
    if (grundEintrag && ohneErnte(grundEintrag) !== ohneErnte(eintrag)) {
      if (z.streng || !z.ersetzt) throw new Verwerfen('grundwert-gesperrt');
      // Reading never loses anything: the base entry stands in (own `ernte` kept), the caller warns.
      z.ersetzt.push(id);
      // A deep copy: changing the replaced entry never touches the base stock. A copy without its own `ernte` inherits the
      // harvest of the base entry (an axe must keep felling trees); a copy WITH one keeps it (the one field a copy may change).
      // "Has its own ernte" means the field is THERE (an explicit empty `ernte: {}` is a deliberate "this item harvests nothing"
      // and is kept); only a missing (or null) field inherits.
      const eigeneErnte = ernteRoh !== undefined && ernteRoh !== null;
      return { ...structuredClone(grundEintrag), ernte: { ...(eigeneErnte ? eintrag.ernte : grundEintrag.ernte) } };
    }
  }
  return eintrag;
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

/** The shared core of reading: sanitises every entry, then the cross-entry checks. `z` counts unknown fields. */
function verarbeiteListe(liste: readonly unknown[], z: Zaehler): { eintraege: GegenstandsEintrag[]; verworfen: VerworfenerEintrag[] } {
  const verworfen: VerworfenerEintrag[] = [];
  const karte = new Map<string, GegenstandsEintrag>();
  const kleinIds = new Set<string>();
  const indexVon = new Map<string, number>();
  liste.forEach((roh, index) => {
    // Nothing below may throw out of here: a live object (getter, proxy) is refused like any other bad entry.
    let idOk: string | null = null;
    try {
      const idRoh = istObjekt(roh) ? nimm(roh, 'id') : undefined;
      idOk = typeof idRoh === 'string' && ID_MUSTER.test(idRoh) ? idRoh : null;
      const e = saubereEintrag(roh, z);
      if (karte.has(e.id)) throw new Verwerfen('id-doppelt');
      if (kleinIds.has(e.id.toLowerCase())) throw new Verwerfen('id-schreibung-doppelt');
      kleinIds.add(e.id.toLowerCase());
      karte.set(e.id, e);
      indexVon.set(e.id, index);
    } catch (fehler) {
      verworfen.push({ index, id: idOk, grund: fehler instanceof Verwerfen ? fehler.grund : 'eintrag-ungueltig' });
    }
  });

  // A base entry that is INVALID in the file (any reason; a second entry of an id that is already there stays discarded) is replaced by the base entry and reported in
  // `ersetzt`, like a deviating one: a broken base copy never costs the whole file, and the editor can heal it (a PUT
  // without it, or the reset). Not in strict mode (`pruefeEintrag` asks about ONE entry and wants the real reason).
  if (z.ersetzt && !z.streng && !z.ohneGrund) {
    const uebrig: VerworfenerEintrag[] = [];
    for (const v of verworfen) {
      const grund = v.id === null || karte.has(v.id) ? undefined : grundEintraege.find((g) => g.id === v.id);
      if (!grund || v.id === null) {
        uebrig.push(v);
        continue;
      }
      karte.set(v.id, structuredClone(grund));
      z.ersetzt.push(v.id);
    }
    verworfen.length = 0;
    verworfen.push(...uebrig);
  }

  // Recipes across entries: ingredients must exist, no cycles. Dropping an entry can orphan others, so repeat.
  const wirf = (id: string, grund: VerwerfGrund): void => {
    karte.delete(id);
    verworfen.push({ index: indexVon.get(id) ?? -1, id, grund });
  };
  for (let geaendert = true; geaendert;) {
    geaendert = false;
    for (const e of [...karte.values()]) {
      if (e.rezept?.zutaten.some((x) => !istCodeItem(x.item) && !grundIds.has(x.item) && !karte.has(x.item))) {
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
  return { eintraege, verworfen };
}

/**
 * Reads and sanitises the text of a data file. Never throws. `ohneGrundsperre` reads a FILE AS IT IS, without comparing base
 * entries with the base stock baked into this build and without replacing invalid ones: used for older repo states (the basis of
 * the working copy, the history) and for the repo file itself, which are compared as written.
 * Liest und saeubert den Text einer Gegenstandsdatei. Wirft nie.
 */
export function leseGegenstandsDatei(text: string, optionen: { ohneGrundsperre?: boolean } = {}): GegenstandsLesung {
  const kaputt = (dateiFehler: DateiFehler): GegenstandsLesung =>
    ({ ok: false, dateiFehler, eintraege: [], verworfen: [], unbekannteFelder: 0, grundErsetzt: [] });
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

  const z: Zaehler = { n: 0, ersetzt: [], ...(optionen.ohneGrundsperre ? { ohneGrund: true } : {}) };
  zaehleUnbekannte(wurzel, ['version', 'gegenstaende'], z);
  const { eintraege, verworfen } = verarbeiteListe(liste, z);
  return { ok: true, dateiFehler: null, eintraege, verworfen, unbekannteFelder: z.n, grundErsetzt: z.ersetzt ?? [] };
}

/**
 * Live check of ONE entry in the context of the others (collision, case, ingredients, cycles). Uses the
 * same core as `leseGegenstandsDatei`, so both always give the same reason. `andere` are the other,
 * already sanitised entries WITHOUT the one being checked (when editing, leave the old version out).
 * Returns the reason codes for `eintrag` (empty = it would be accepted).
 */
export function pruefeEintrag(eintrag: unknown, andere: readonly GegenstandsEintrag[]): VerwerfGrund[] {
  if (andere.length + 1 > MAX_EINTRAEGE) return ['zu-viele-eintraege'];
  // Strict: the live check of the editor reports a deviating base entry (the reader would replace it silently).
  const { verworfen } = verarbeiteListe([...andere, eintrag], { n: 0, streng: true });
  return verworfen.filter((v) => v.index === andere.length).map((v) => v.grund);
}

export class GegenstandsSchreibFehler extends Error {
  constructor(readonly code: 'datei-zu-viele-eintraege' | 'datei-zu-gross') {
    super(code);
    this.name = 'GegenstandsSchreibFehler';
  }
}

/**
 * The canonical text of a data file: fixed field order, 2-space indent, one newline at the end, unset
 * fields left out. The inverse of `leseGegenstandsDatei` for sanitised entries, and the same bytes for the
 * same entries whatever order the keys had in the input. Throws `GegenstandsSchreibFehler` instead of
 * returning a text the reader would refuse as a whole (more than 500 entries, more than `MAX_DATEI_BYTES`).
 */
export function schreibeGegenstandsDatei(eintraege: readonly GegenstandsEintrag[]): string {
  if (eintraege.length > MAX_EINTRAEGE) throw new GegenstandsSchreibFehler('datei-zu-viele-eintraege');
  const ordne = (e: GegenstandsEintrag): Roh => {
    const m = e.modell;
    const o: Roh = { id: e.id, nameSchluessel: e.nameSchluessel };
    if (e.beschreibungSchluessel !== null) o.beschreibungSchluessel = e.beschreibungSchluessel;
    o.typ = e.typ;
    o.slot = e.slot;
    const modell: Roh = {};
    if (m.upload !== null) modell.upload = m.upload;
    if (m.eigen !== null) modell.eigen = m.eigen;
    if (m.skala !== 1) modell.skala = m.skala;
    if (m.haltePosition !== null) modell.haltePosition = m.haltePosition;
    if (m.halteRotation !== null) modell.halteRotation = m.halteRotation;
    if (m.hiebVersatz !== null) modell.hiebVersatz = m.hiebVersatz;
    if (m.animationsSatz !== null) modell.animationsSatz = m.animationsSatz;
    if (Object.keys(modell).length > 0) o.modell = modell;
    if (e.bautafel !== null) o.bautafel = e.bautafel;
    if (e.terrain !== null) o.terrain = e.terrain;
    if (e.symbol !== null) o.symbol = e.symbol;
    o.stapel = e.stapel;
    o.gewicht = e.gewicht;
    const werte: Roh = {};
    for (const s of STAT_IDS) if (Object.hasOwn(e.werte, s) && e.werte[s] !== undefined) werte[s] = e.werte[s];
    if (Object.keys(werte).length > 0) o.werte = werte;
    const ernte: Roh = {};
    if (e.ernte.baum !== undefined) ernte.baum = e.ernte.baum;
    if (e.ernte.fels !== undefined) ernte.fels = e.ernte.fels;
    // An empty `ernte` is written only where it DIFFERS from the base entry's (a deliberate "harvests nothing" on an item that
    // harvests in the base): reading must not mistake it for a missing field and inherit the base harvest.
    const grundErnte = grundEintraege.find((g) => g.id === e.id)?.ernte;
    const grundHatErnte = grundErnte !== undefined && Object.keys(grundErnte).length > 0;
    if (Object.keys(ernte).length > 0 || grundHatErnte) o.ernte = ernte;
    const haltbarkeit: Roh = {};
    if (e.haltbarkeit.max !== undefined) haltbarkeit.max = e.haltbarkeit.max;
    if (e.haltbarkeit.verbrauch !== undefined) haltbarkeit.verbrauch = e.haltbarkeit.verbrauch;
    if (e.haltbarkeit.ausdauer !== undefined) haltbarkeit.ausdauer = e.haltbarkeit.ausdauer;
    if (Object.keys(haltbarkeit).length > 0) o.haltbarkeit = haltbarkeit;
    o.itemLevel = e.itemLevel;
    o.rarity = e.rarity;
    if (e.rezept) {
      o.rezept = { menge: e.rezept.menge, zutaten: e.rezept.zutaten.map((x) => ({ item: x.item, menge: x.menge })) };
    }
    const texte: Roh = {};
    for (const k of [e.nameSchluessel, e.beschreibungSchluessel]) {
      if (k === null || !Object.hasOwn(e.texte, k)) continue;
      const t = e.texte[k];
      const eintrag: Roh = {};
      if (t.de !== undefined) eintrag.de = t.de;
      if (t.en !== undefined) eintrag.en = t.en;
      texte[k] = eintrag;
    }
    o.texte = texte;
    return o;
  };
  const text = `${JSON.stringify({ version: GEGENSTAENDE_VERSION, gegenstaende: eintraege.map(ordne) }, null, 2)}\n`;
  // Never write what the reader would refuse as a whole.
  if (new TextEncoder().encode(text).length > MAX_DATEI_BYTES) throw new GegenstandsSchreibFehler('datei-zu-gross');
  return text;
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
 * `inhaltText(textKey, language)` (`textKey` = the entry's `nameSchluessel`). `toolTier` stays 0 (unused); harvesting reads `ernte`.
 */
export function gegenstandZuItem(e: GegenstandsEintrag): ItemShared {
  const m = e.modell;
  const stufe = { itemLevel: e.itemLevel, rarity: e.rarity };
  return {
    name: e.id,
    label: labelVon(e),
    itemType: itemTypVon(e.typ),
    icon: e.symbol ?? '',
    model: m.eigen ?? m.upload,
    maxStackSize: e.stapel,
    weight: e.gewicht,
    stats: { ...e.werte },
    toolTier: 0,
    ...(e.bautafel !== null ? { pieceTable: e.bautafel } : {}),
    ...(e.terrain !== null ? { spawnOnHitTerrain: e.terrain } : {}),
    ...(m.haltePosition ? { holdPosition: m.haltePosition } : {}),
    ...(m.halteRotation ? { holdRotation: m.halteRotation } : {}),
    ...(m.hiebVersatz !== null ? { holdOffsetStrike: m.hiebVersatz } : {}),
    ...(m.animationsSatz ? { animationSet: m.animationsSatz } : {}),
    ...(e.haltbarkeit.max !== undefined ? { maxDurability: e.haltbarkeit.max } : {}),
    ...(e.haltbarkeit.verbrauch !== undefined ? { useDurabilityDrain: e.haltbarkeit.verbrauch } : {}),
    ...(e.haltbarkeit.ausdauer !== undefined ? { attackStamina: e.haltbarkeit.ausdauer } : {}),
    ernte: { ...e.ernte },
    modellSkala: m.skala,
    textKey: e.nameSchluessel,
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

// The base stock (the 29 items that used to be code). `grundbestand.ts` registers it when the module loads;
// until then it is empty, which only the sanitiser of `grundbestand.ts` itself ever sees.
let grundEintraege: readonly GegenstandsEintrag[] = [];
let grundIds: ReadonlySet<string> = new Set();
let grundKlein: ReadonlySet<string> = new Set();

/** Registers the base stock. Called once by `grundbestand.ts`; not part of the public surface. */
export function setzeGrundbestand(eintraege: readonly GegenstandsEintrag[]): void {
  grundEintraege = eintraege;
  grundIds = new Set(eintraege.map((e) => e.id));
  grundKlein = new Set(eintraege.map((e) => e.id.toLowerCase()));
  setzeGrundItems(eintraege.map(gegenstandZuItem));
}

/** The base stock entries (file order). */
export function grundbestandEintraege(): readonly GegenstandsEintrag[] {
  return grundEintraege;
}

/** True if `id` is an id of the base stock (exact spelling). */
export function istGrundItem(id: string): boolean {
  return grundIds.has(id);
}

/**
 * The entries plus every base entry they do not replace: a base id can never be missing. A working-copy entry
 * with a base id wins over the base entry (same id, own values). Base entries come first, in file order (an override keeps the place of its base entry).
 */
export function mitGrundbestand(eintraege: readonly GegenstandsEintrag[]): GegenstandsEintrag[] {
  const eigene = new Map(eintraege.map((e) => [e.id, e] as const));
  // An own entry with a base id takes the place of the base entry: the order (craft list, `ITEMS_BY_NAME`) never changes.
  return [...grundEintraege.map((g) => eigene.get(g.id) ?? g), ...eintraege.filter((e) => !grundIds.has(e.id))];
}

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
 * throws, nothing has changed. The base stock is always part of it (`mitGrundbestand`), so `[]` leaves exactly the
 * base stock and a base id can never disappear.
 */
export function wendeGegenstandsDatenAn(eintraege: readonly GegenstandsEintrag[]): void {
  eintraege = mitGrundbestand(eintraege);
  const items = eintraege.map(gegenstandZuItem);
  const texte = datenTexteAus(eintraege);
  const rezepte = rezepteAus(eintraege);
  replaceDataItems(items); // throws on a collision before anything is swapped
  ersetzeDatenTexte(texte);
  rezepteDaten = rezepte;
}

// ── Base stock (baked in) ──────────────────────────────────────────────
// The 29 items that used to be code live in shared/data/gegenstaende.json. They are read and applied HERE, at the
// end of this module, so that whoever imports the sanitiser (server, client, editor, tests) also has the base stock:
// a separate module would need this one and be needed by it. `grundbestand.ts` only re-exports the result.
// Die 29 ehemaligen Code-Gegenstaende werden hier am Modulende gelesen und angewendet (kein Importzyklus).

/** The ids the base stock must hold, in file order (the order of the craft list and of `ITEMS_BY_NAME`'s data part). */
export const GRUNDBESTAND_IDS: readonly string[] = [
  'Hammer', 'Club', 'AxeFlint', 'Hoe', 'PickaxeAntler', 'Cultivator',
  'Messer', 'Wood', 'Stone', 'Flint', 'Resin', 'Raspberry', 'Blueberries', 'Mushroom', 'Thistle', 'Dandelion',
  'Carrot', 'RawMeat', 'Entrails', 'Coins', 'Amber', 'NeckTail', 'TrophyDeer', 'CookedMeat', 'HardAntler',
  'TrophyEikthyr', 'SwordNorth', 'Staff', 'Spear',
];

/**
 * Reads the baked-in file. A broken or reduced repo file is a build error, never a runtime state: this throws if the
 * sanitiser reports a file error, discards an entry, drops an unknown field, or if the ids are not exactly
 * `GRUNDBESTAND_IDS`.
 */
function ladeGrundbestand(): readonly GegenstandsEintrag[] {
  const lesung = leseGegenstandsDatei(JSON.stringify(grundDatei));
  if (!lesung.ok) throw new Error(`[grundbestand] shared/data/gegenstaende.json is unusable: ${lesung.dateiFehler}`);
  if (lesung.verworfen.length > 0) {
    throw new Error(`[grundbestand] shared/data/gegenstaende.json has discarded entries: ${lesung.verworfen.map((v) => `${v.id ?? `#${v.index}`}:${v.grund}`).join(', ')}`);
  }
  if (lesung.unbekannteFelder > 0) throw new Error(`[grundbestand] shared/data/gegenstaende.json has ${lesung.unbekannteFelder} unknown fields`);
  const ids = lesung.eintraege.map((e) => e.id);
  if (JSON.stringify(ids) !== JSON.stringify(GRUNDBESTAND_IDS)) {
    throw new Error(`[grundbestand] shared/data/gegenstaende.json must hold exactly ${GRUNDBESTAND_IDS.length} base ids in order, got: ${ids.join(', ')}`);
  }
  return lesung.eintraege;
}

/** The sanitised base entries (file order). */
export const GRUNDBESTAND: readonly GegenstandsEintrag[] = ladeGrundbestand();

setzeGrundbestand(GRUNDBESTAND);
wendeGegenstandsDatenAn([]);
