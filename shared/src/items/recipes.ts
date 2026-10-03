/**
 * Crafting recipes: the type. Recipes belong to the items and are part of the data file
 * (shared/data/gegenstaende.json); there is no station yet, all of them are hand recipes.
 */

export interface Rezept {
  /** Ergebnis-Item (itemDefs-Name). */
  ergebnis: string;
  menge: number;
  zutaten: ReadonlyArray<{ item: string; menge: number }>;
}

/**
 * Empty on purpose: the six base recipes live in shared/data/gegenstaende.json (field `rezept`) and are read
 * through `datenRezepte()`. The name stays so that `handleCraft` (WovServer.ts) keeps compiling; it finds
 * nothing here and falls back to `datenRezepte()`.
 * Absichtlich leer: die sechs Grundrezepte stehen in der Datendatei.
 */
export const REZEPTE: readonly Rezept[] = [];
