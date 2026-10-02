/**
 * Item mask (Editor card EG2, N4): the ONLY place where text enters the DOM, and the typed twins of the design helpers
 * that take text. Everything takes an `Anzeigetext` (anzeige.ts); a raw `string` is a type error.
 * `client/test/editor-gegenstaende-texte.ts` reads off the syntax tree that no other file of the mask assigns to a text
 * property, writes HTML, asks `confirm`/`alert`/`prompt`, or calls the design helpers with a text of its own.
 * Gegenstands-Maske (EG2, N4): die einzige Stelle, an der Text ins DOM kommt, und die getypten Gegenstuecke der Design-Helfer.
 */
import { el, knopf, zierTitel } from '../design';
import type { Anzeigetext } from './anzeige';

/** The one place a text goes into a node (`textContent`, never HTML). */
export function setzeText(knoten: { textContent: string | null }, text: Anzeigetext): void {
  knoten.textContent = text;
}

/** `el` with a text, which has to be an `Anzeigetext`. */
export function elT<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: Anzeigetext): HTMLElementTagNameMap[K] {
  const n = el(tag, css);
  if (text !== undefined) setzeText(n, text);
  return n;
}

type KnopfOptionen = NonNullable<Parameters<typeof knopf>[2]>;

/** `knopf` with an `Anzeigetext` label (and title). */
export function knopfT(text: Anzeigetext, bei: () => void, o: Omit<KnopfOptionen, 'titel'> & { titel?: Anzeigetext } = {}): HTMLButtonElement {
  return knopf(text, bei, o);
}

/** `zierTitel` with an `Anzeigetext`. */
export function zierTitelT(text: Anzeigetext, groesse: number): ReturnType<typeof zierTitel> {
  return zierTitel(text, groesse);
}

/** The browser's yes/no question; the text has to be an `Anzeigetext`. */
export function frageBestaetigen(frage: Anzeigetext): boolean {
  return window.confirm(frage);
}
