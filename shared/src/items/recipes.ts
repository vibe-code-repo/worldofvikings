/**
 * Crafting-Rezepte (Phase 5, Basis) — Werte nah am Original (Recipe-Dumps),
 * aber nur für Items, die in itemDefs existieren. Stationen (Werkbank)
 * folgen später; alle Basisrezepte sind Freihand-Rezepte wie im Original
 * vor der ersten Werkbank.
 */

export interface Rezept {
  /** Ergebnis-Item (itemDefs-Name). */
  ergebnis: string;
  menge: number;
  zutaten: ReadonlyArray<{ item: string; menge: number }>;
}

export const REZEPTE: readonly Rezept[] = [
  {
    ergebnis: 'Hammer',
    menge: 1,
    zutaten: [
      { item: 'Wood', menge: 3 },
      { item: 'Stone', menge: 2 },
    ],
  },
  { ergebnis: 'Club', menge: 1, zutaten: [{ item: 'Wood', menge: 6 }] },
  {
    ergebnis: 'AxeFlint',
    menge: 1,
    zutaten: [
      { item: 'Wood', menge: 4 },
      { item: 'Flint', menge: 6 },
    ],
  },
  { ergebnis: 'Hoe', menge: 1, zutaten: [{ item: 'Wood', menge: 5 }, { item: 'Stone', menge: 2 }] },
  {
    ergebnis: 'PickaxeAntler',
    menge: 1,
    zutaten: [
      { item: 'Wood', menge: 10 },
      { item: 'Stone', menge: 6 },
    ],
  },
  {
    ergebnis: 'Cultivator',
    menge: 1,
    zutaten: [
      { item: 'Wood', menge: 5 },
      { item: 'Flint', menge: 2 },
    ],
  },
];
