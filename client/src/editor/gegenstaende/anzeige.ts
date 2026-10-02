/**
 * Item mask (Editor card EG2, N4): the type of every text that may reach the screen, and the only ways to make one.
 * DOM-free (texte.ts imports it, and a test runs texte.ts without a browser).
 * Gegenstands-Maske (EG2, N4): der Typ jedes Textes, der auf den Bildschirm darf, und die einzigen Wege, einen zu bauen.
 *
 * `Anzeigetext` is a string with a brand. A plain `string` (a file value, a name, a status of the server) is NOT one and
 * cannot be passed where the mask shows text: the type check refuses it. An `Anzeigetext` comes from exactly these:
 *  - `tA` / `t` of the catalogue (`editor.gegenstand.*`);
 *  - `sichtbarKuerzen` (a raw value, shortened, every invisible or reordering character shown as `<U+XXXX>`);
 *  - `zahlText` (a number), `zier` (one of a few punctuation literals) and `fuege` (joins Anzeigetexte);
 *  - `kuerzeHart` (a hard cap on an Anzeigetext).
 * Nothing else casts to it (`client/test/editor-gegenstaende-texte.ts` reads that off the syntax tree).
 */
import type { TranslationKey, TranslationVars } from '../../i18n';
import { t } from '../i18n';

export type Anzeigetext = string & { readonly __anzeige: true };

/** Punctuation that is no text: the only literals `zier` takes. */
export type Zierrat = '(' | ')' | '#' | '?' | '…' | ': ' | ' ' | '';
/** What `fuege` puts between its parts. */
export type Trenner = ' ' | ', ' | '; ' | ': ' | '';

/** The catalogue text of `key`, in the current language. */
export const tA = (key: TranslationKey, vars?: TranslationVars): Anzeigetext => t(key, vars) as Anzeigetext;

export const zier = (z: Zierrat): Anzeigetext => z as Anzeigetext;
export const zahlText = (n: number): Anzeigetext => String(n) as Anzeigetext;
export const fuege = (trenner: Trenner, ...teile: readonly Anzeigetext[]): Anzeigetext => teile.join(trenner) as Anzeigetext;

/**
 * Cuts `text` to at most `max` UTF-16 units. A cut never splits a surrogate pair; the end mark "…" is part of the
 * `max` (the result is never longer than `max`, for every `max >= 0`: at 0 it is empty).
 */
export function kuerzeHart(text: Anzeigetext, max: number): Anzeigetext {
  if (text.length <= max) return text;
  if (max <= 0) return '' as Anzeigetext; // not even the end mark fits
  let ende = max - 1;
  const letzte = text.charCodeAt(ende - 1);
  if (ende > 0 && letzte >= 0xd800 && letzte <= 0xdbff) ende--; // the cut would leave a lone high surrogate
  return `${text.slice(0, ende)}…` as Anzeigetext;
}

/** Longest run of one id / name shown in a dialog; a hand-written id can be any length. */
export const MAX_KENNUNG_ANZEIGE = 40;

/**
 * Every `Default_Ignorable_Code_Point` as inclusive ranges. Source: Unicode 17.0 `DerivedCoreProperties.txt`
 * (Default_Ignorable_Code_Point), read from the engine's tables (ICU of Node 22, Unicode 17.0) on 01.10.2026; the
 * ranges are the same in Unicode 15.1 and 16.0. The test checks every range at both ends and throughout.
 */
export const DEFAULT_IGNORABLE: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];
/**
 * Not default-ignorable, but they draw as blanks (or only modify the sign before them) in common fonts: MUSICAL SYMBOL
 * NULL NOTEHEAD, TIFINAGH CONSONANT JOINER, KHITAN SMALL SCRIPT FILLER and the Egyptian hieroglyph block after the format
 * controls (U+13430 .. U+1343F are format, `Cf`, and caught by rule): mirror, the blanks and lost signs, the "damaged"
 * modifiers, up to the end of the run (U+13440 .. U+1345F). Inclusive ranges, like `DEFAULT_IGNORABLE`.
 */
export const WEITERE_LEERE: ReadonlyArray<readonly [number, number]> = [
  [0x1d159, 0x1d159],
  [0x2d7f, 0x2d7f],
  [0x13440, 0x1345f],
  [0x16fe4, 0x16fe4],
];

/**
 * Characters that would hide or reorder text, by Unicode rule and not one by one: control, format (bidi, zero-width),
 * line / paragraph separators, surrogates, private use, noncharacters, every `Default_Ignorable_Code_Point` (the list
 * above, and the engine's own property as a second net), and the look-alike blanks the rules do not cover (braille
 * blank, object replacement).
 */
const UNSICHTBAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Noncharacter_Code_Point}\p{Default_Ignorable_Code_Point}⠀￼]/u;
/** Spaces other than the plain one (no-break, ideographic, en / em ...): they look like nothing in a name. */
const ANDERES_LEER = /\p{Zs}/u;

export const istUnsichtbar = (c: string): boolean => {
  const cp = c.codePointAt(0) ?? 0;
  return UNSICHTBAR.test(c) || (c !== ' ' && ANDERES_LEER.test(c)) || DEFAULT_IGNORABLE.some(([von, bis]) => cp >= von && cp <= bis) || WEITERE_LEERE.some(([von, bis]) => cp >= von && cp <= bis);
};

/**
 * Text of a raw id or name for a dialog: at most `max` characters (then "…"), and every control / bidi /
 * invisible character shown as `<U+XXXX>` instead of acting. Only for showing, never for matching.
 */
export function sichtbarKuerzen(roh: string, max = MAX_KENNUNG_ANZEIGE): Anzeigetext {
  const zeichen = Array.from(roh);
  const kurz = zeichen
    .slice(0, max)
    .map((c) => (istUnsichtbar(c) ? `<U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}>` : c))
    .join('');
  return (zeichen.length > max ? `${kurz}…` : kurz) as Anzeigetext;
}
