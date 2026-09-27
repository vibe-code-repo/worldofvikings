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

/** Control, format (zero-width, BOM, joiners) and line/paragraph separator characters. */
export function nameHatSteuerzeichen(name: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name);
}

/** Spellings to look up in a store that only folds ASCII case (SQLite NOCASE). */
export function namenVarianten(name: string): string[] {
  const nfc = name.normalize('NFC').trim();
  return [...new Set([nfc, nfc.toLowerCase(), nfc.toUpperCase()])];
}
