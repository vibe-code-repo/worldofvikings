/**
 * Display name of an item. The one place the UI asks for a name, so the switch to translation
 * keys (T1) is a change here and not in every panel.
 * Anzeigename eines Gegenstands. Heute `label`; T1 stellt diese Funktion auf Schlüssel um.
 */
export function anzeigeName(item: { readonly label: string }): string {
  return item.label;
}
