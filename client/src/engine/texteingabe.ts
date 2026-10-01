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
  const el = ziel as { tagName?: unknown; type?: unknown; isContentEditable?: unknown; closest?: unknown };
  if (el.isContentEditable === true) return true;
  // Kind eines contenteditable-Elements (z. B. ein <b> im Eingabefeld).
  if (typeof el.closest === 'function' && (el as { closest: (s: string) => unknown }).closest('[contenteditable]:not([contenteditable="false"])')) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const art = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
  return !KEINE_TEXTEINGABE.has(art);
}

/** Das Element mit dem Fokus der Seite (Attrappe im Test: `document.activeElement`). */
function fokusElement(): unknown {
  return typeof document === 'undefined' ? null : (document as { activeElement?: unknown }).activeElement;
}

/**
 * Tastendruck (oder Ereignis) mit Ziel: tippt der Spieler gerade in ein Feld? Gilt das Ziel des
 * Ereignisses ODER das Element mit dem Fokus der Seite (ein Ereignis kann auf Fenster/Canvas
 * landen, obwohl der Fokus im Feld liegt).
 *
 * `keyup` filtern wir bewusst NICHT: Wurde eine Taste im Spiel gedrückt und wandert der Fokus
 * danach ins Feld, muss das `keyup` im Feld die Taste noch loslassen, sonst bliebe sie gedrückt
 * (Figur läuft weiter). Gesperrt wird nur das Drücken.
 */
export function istTexteingabeAktiv(e: { readonly target: unknown }): boolean {
  return istTexteingabeElement(e.target) || istTexteingabeElement(fokusElement());
}

/** Hat gerade ein Textfeld den Fokus? (für das Mausrad, das kein Ziel-Feld hat) */
export function istTexteingabeFokus(): boolean {
  return istTexteingabeElement(fokusElement());
}
