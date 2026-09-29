import { inhaltText } from '../texte.js';

/**
 * Display name of an item. The one place the UI asks for a name.
 * Anzeigename eines Gegenstands: mit `textKey` (Set-Teile, Namensraum `inhalt.item.*`) der Text aus dem
 * gemeinsamen Katalog in der gewünschten Sprache (Rückfall Deutsch, dann der Schlüssel, siehe
 * `inhaltText`), sonst `label`. `textKey` ist bewusst nur hier als optionales Feld beschrieben, nicht an
 * `ItemShared`: die Karte, die die Schlüssel setzt, darf das Feld selbst anlegen.
 */
export function anzeigeName(item: { readonly label: string; readonly textKey?: string }, sprache?: string): string {
  return item.textKey ? inhaltText(item.textKey, sprache) : item.label;
}
