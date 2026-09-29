/**
 * Item level and rarity of every item, in ONE table (Mike 27.09.2026, concept table B2).
 * Itemlevel und Seltenheit aller Gegenstände in EINER Tabelle.
 *
 * The raw items are keyed by item name, the armor parts by set family (like `setWerte.ts`, and for the
 * same reason: the set files belong to the armor pipeline and stay untouched). `itemDefs.ts` merges
 * both into `ItemShared.itemLevel` / `ItemShared.rarity` and refuses to build an item without an entry.
 *
 *  - materials, food, trophies, simple tools, starter armor: level 1, common
 *  - first weapons (club, antler pickaxe): level 2, common
 *  - crafted weapons (flint axe, north sword, staff, spear): level 5, common
 *  - class sets: level 10, rare; Plainhide (starter set): level 1, common
 *  - Eikthyr trophy: level 10, uncommon
 *
 * The tooltip shows the level only for equippable items and tools/weapons, never for materials.
 */
import { istRarity, type Rarity } from './stats.js';
import { SET_TEILE } from './setWerte.js';

export interface ItemStufe {
  readonly itemLevel: number;
  readonly rarity: Rarity;
}

const gewoehnlich = (itemLevel: number): ItemStufe => ({ itemLevel, rarity: 'common' });

/** Raw items by item name (`ItemShared.name`), including the two leather starter pieces. */
export const ITEM_STUFEN: Readonly<Record<string, ItemStufe>> = {
  // Simple tools
  Messer: gewoehnlich(1),
  Hoe: gewoehnlich(1),
  Cultivator: gewoehnlich(1),
  Hammer: gewoehnlich(1),
  // First weapons
  Club: gewoehnlich(2),
  PickaxeAntler: gewoehnlich(2),
  // Crafted weapons
  AxeFlint: gewoehnlich(5),
  SwordNorth: gewoehnlich(5),
  Staff: gewoehnlich(5),
  Spear: gewoehnlich(5),
  // Materials, food, trophies
  Wood: gewoehnlich(1),
  Stone: gewoehnlich(1),
  Flint: gewoehnlich(1),
  Resin: gewoehnlich(1),
  Raspberry: gewoehnlich(1),
  Blueberries: gewoehnlich(1),
  Mushroom: gewoehnlich(1),
  Thistle: gewoehnlich(1),
  Dandelion: gewoehnlich(1),
  Carrot: gewoehnlich(1),
  RawMeat: gewoehnlich(1),
  Entrails: gewoehnlich(1),
  Coins: gewoehnlich(1),
  Amber: gewoehnlich(1),
  NeckTail: gewoehnlich(1),
  CookedMeat: gewoehnlich(1),
  HardAntler: gewoehnlich(1),
  TrophyDeer: gewoehnlich(1),
  TrophyEikthyr: { itemLevel: 10, rarity: 'uncommon' },
  // Leather starter pieces (no set family)
  LederBH: gewoehnlich(1),
  LederShorts: gewoehnlich(1),
};

const KLASSENSET: ItemStufe = { itemLevel: 10, rarity: 'rare' };

/** Armor parts by set family (the family part of `SET_TEILE`). */
export const SET_STUFEN: Readonly<Record<string, ItemStufe>> = {
  plainhide: gewoehnlich(1),
  ironward: KLASSENSET,
  wildwarden: KLASSENSET,
  ashenveil: KLASSENSET,
  seidraven: KLASSENSET,
  emberrage: KLASSENSET,
  gravethorn: KLASSENSET,
  crowshade: KLASSENSET,
};

const STUFE_JE_RUESTUNGSTEIL: ReadonlyMap<string, ItemStufe> = new Map(
  SET_TEILE.flatMap((t) => {
    const stufe = SET_STUFEN[t.familie];
    return stufe ? [[t.id, stufe] as const] : [];
  })
);

/** Level and rarity of an armor part by its appearance id; undefined for parts of an unknown family. */
export function stufeFuerRuestungsteil(id: string): ItemStufe | undefined {
  return STUFE_JE_RUESTUNGSTEIL.get(id);
}

/** Level and rarity of an item nobody has rated: the plainest possible item. */
export const STUFE_RUECKFALL: ItemStufe = { itemLevel: 1, rarity: 'common' };

export type StufenQuelle = 'tabelle' | 'eigen' | 'rueckfall';

/**
 * Level and rarity of one definition, never throwing:
 *  1. code items: the explicit entry (`ITEM_STUFEN` by name, `SET_STUFEN` by armor part);
 *  2. data items (`datenItem`) carry their own optional `itemLevel` / `rarity`; used when valid
 *     (integer >= 1, known rarity);
 *  3. otherwise `STUFE_RUECKFALL` (the caller warns once). A test makes sure that no CODE item
 *     ever lands here (`shared/test/item-stufen.ts`).
 */
export function loeseStufe(
  def: { readonly name: string; readonly ruestungsteil?: string },
  eigen?: { readonly itemLevel?: unknown; readonly rarity?: unknown },
): { stufe: ItemStufe; quelle: StufenQuelle } {
  const tabelle = Object.hasOwn(ITEM_STUFEN, def.name)
    ? ITEM_STUFEN[def.name]
    : def.ruestungsteil ? stufeFuerRuestungsteil(def.ruestungsteil) : undefined;
  if (tabelle) return { stufe: tabelle, quelle: 'tabelle' };
  const level = eigen?.itemLevel;
  if (typeof level === 'number' && Number.isInteger(level) && level >= 1 && istRarity(eigen?.rarity)) {
    return { stufe: { itemLevel: level, rarity: eigen.rarity }, quelle: 'eigen' };
  }
  return { stufe: STUFE_RUECKFALL, quelle: 'rueckfall' };
}
