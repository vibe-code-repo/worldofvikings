/**
 * Name helpers shared by the handshake and the admin name lookup.
 *
 * One place decides when two player names count as the same, so the guest
 * rule ("no account name") and `admin add <Name>` cannot drift apart.
 * Limit: this folds case and Unicode composition (NFC) only. Look-alikes
 * across scripts (Cyrillic "А" for "A") are NOT folded.
 */

/** Name of every editor connection: fixed by the server, never taken from the client. */
export const EDITOR_NAME = 'Editor';

/** Comparison key: NFC, trimmed, lower case. */
export function namenSchluessel(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/**
 * A handful of code points that render as blank or near-blank but sit
 * outside \p{Cc}/\p{Cf}/\p{Zl}/\p{Zp} and so slip past the check below:
 * U+3164 Hangul Filler, U+115F/U+1160 Hangul Choseong/Jungseong Filler and
 * U+FFA0 Halfwidth Hangul Filler are category Lo (letters, not format
 * characters, because Hangul fillers must combine like syllables); U+2800
 * Braille Pattern Blank is category So; U+034F Combining Grapheme Joiner is
 * category Mn. All six were used in Pruefung 3 (gast-pruef3) to smuggle an
 * invisible extra character onto the end of "Editor" and get a name that
 * reads as the reserved one. Look-alikes across scripts (Cyrillic "Е" for
 * Latin "E") are a different, larger problem (homoglyphs) and are out of
 * scope here — see C3 in Pruefung 2 §3 / Pruefung 3 §1.
 */
const UNSICHTBARE_ZEICHEN = /[ㅤ⠀͏ᅟᅠﾠ]/u;

/** Control, format (zero-width, BOM, joiners), line/paragraph separator and the invisible outliers above. */
export function nameHatSteuerzeichen(name: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name) || UNSICHTBARE_ZEICHEN.test(name);
}

/** Spellings to look up in a store that only folds ASCII case (SQLite NOCASE). */
export function namenVarianten(name: string): string[] {
  const nfc = name.normalize('NFC').trim();
  return [...new Set([nfc, nfc.toLowerCase(), nfc.toUpperCase()])];
}
