/**
 * Ein gemeinsamer Test: Landet ein Tastendruck gerade in einem Feld, in dem getippt wird?
 * Dann sind Buchstaben Text und lösen weder Spiel- noch Testflug-Tasten aus (K, I, V, B, H,
 * WASD, …). DOM-frei gebaut: Es sieht nur `tagName`, `type` und `isContentEditable` an,
 * damit der Test ohne Browser läuft.
 *
 * Text fields swallow letters; Checkbox, Range, Button and the like do not, so the
 * shortcuts keep working with those focused.
 */

/** Eingabearten, in denen keine Buchstaben getippt werden. */
const KEINE_TEXTEINGABE: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'color',
]);

/** Ist `ziel` ein Element, in dem Tasten Eingabe sind? */
export function istTexteingabeElement(ziel: unknown): boolean {
  if (typeof ziel !== 'object' || ziel === null) return false;
  const el = ziel as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const art = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
  return !KEINE_TEXTEINGABE.has(art);
}

/** Tastendruck (oder Ereignis) mit Ziel: tippt der Spieler gerade in ein Feld? */
export function istTexteingabeAktiv(e: { readonly target: unknown }): boolean {
  return istTexteingabeElement(e.target);
}
