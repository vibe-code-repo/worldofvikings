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
 * B3 (Nachbesserung Pruefung 4): `\p{Default_Ignorable_Code_Point}` statt
 * einer festen Liste. Die alte Sechserliste (Hangul-Fuellzeichen, das
 * Combining Grapheme Joiner, Braille Pattern Blank) hat in Pruefung 4 noch
 * Luecken gezeigt: U+FE00–FE0F (Variantenselektoren), U+E0100… (VS17+),
 * U+17B4/U+17B5 (Khmer, unsichtbar) und U+180B–180F (mongolische FVS) kamen
 * weiterhin durch, alle Default_Ignorable. Die Unicode-Eigenschaft deckt
 * das automatisch ab (in Node geprueft: 034F, 115F, 1160, 3164, FFA0, 17B4,
 * 180B, FE0F und E0100), NUR U+2800 Braille Pattern Blank NICHT — es ist
 * unsichtbar, aber nicht als default-ignorable eingestuft, deshalb bleibt
 * es als eigener Zusatz stehen. Alle genannten Zeichen wurden in Pruefung
 * 3/4 (gast-pruef3, Pruefung 4 §2.3) genutzt, um eine unsichtbare
 * Erweiterung an "Editor" oder einen Kontonamen zu haengen und trotzdem
 * wie der reservierte bzw. fremde Name auszusehen. Nebenwirkung: das
 * Combining Grapheme Joiner (U+034F) wird jetzt auch MITTEN in einem Namen
 * abgewiesen, nicht nur am Ende — bei europaeischen Namen kommt es
 * praktisch nicht vor. Look-alikes across scripts (Cyrillic "Е" for Latin
 * "E") sind ein anderes, groesseres Problem (Homoglyphe) und bleiben
 * ausserhalb dieses Umfangs — s. C3 in Pruefung 2 §3 / Pruefung 3 §1.
 */
const UNSICHTBARE_ZEICHEN = /[\p{Default_Ignorable_Code_Point}⠀]/u;

/** Control, format (zero-width, BOM, joiners), line/paragraph separator and the invisible outliers above. */
export function nameHatSteuerzeichen(name: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name) || UNSICHTBARE_ZEICHEN.test(name);
}

/** Spellings to look up in a store that only folds ASCII case (SQLite NOCASE). */
export function namenVarianten(name: string): string[] {
  const nfc = name.normalize('NFC').trim();
  return [...new Set([nfc, nfc.toLowerCase(), nfc.toUpperCase()])];
}
