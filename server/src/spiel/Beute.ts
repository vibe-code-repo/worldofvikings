/**
 * Loot: what a picked-up object, a killed creature and an opened chest give.
 *
 * The tables and their dice. Moved here unchanged from `../WovServer.ts`
 * (refactoring I1, step 0b), so that the modules in this folder can use them
 * without importing `WovServer.ts`. This file imports nothing.
 */

/** Pickable-Prefab → Inventar-Item (Namen aus shared/items/itemDefs). */
function pickableItem(prefabName: string): { name: string; amount: number } | null {
  const MAP: Array<[RegExp, string, number]> = [
    [/branch/i, 'Wood', 1],
    [/^Pickable_Stone/i, 'Stone', 1],
    [/flint/i, 'Flint', 1],
    [/mushroom/i, 'Mushroom', 1],
    [/(raspberry|berry)/i, 'Raspberry', 1],
    [/blueberr/i, 'Blueberries', 1],
    [/thistle/i, 'Thistle', 1],
    [/dandelion/i, 'Dandelion', 1],
    [/seedcarrot|carrot/i, 'Carrot', 1],
    [/wood/i, 'Wood', 1],
  ];
  for (const [re, name, amount] of MAP) {
    if (re.test(prefabName)) return { name, amount };
  }
  // Fallback: Prefabname direkt versuchen (ItemDrop-Prefabs heißen wie ihr Item).
  return { name: prefabName, amount: 1 };
}

/**
 * Kreaturen-Drops (nah am Original, beschränkt auf existierende itemDefs).
 * Format: [Item, min, max, Chance 0..1].
 */
const KREATUR_DROPS: Record<string, Array<[string, number, number, number]>> = {
  Eikthyr: [['HardAntler', 3, 3, 1]],
  Greyling: [['Resin', 1, 1, 1]],
  Greydwarf: [['Wood', 1, 2, 1], ['Resin', 1, 1, 0.5], ['Stone', 1, 1, 0.5]],
  Boar: [['RawMeat', 1, 2, 1]],
  Deer: [['RawMeat', 1, 2, 1], ['TrophyDeer', 1, 1, 0.5]],
  // B9: meat is the only animal drop the item table knows (no leather or pelt
  // item exists yet). The cow is the big animal (1.5 m at the shoulder, 2.9 m
  // long), so one more than the boar; the wolf drops what the boar drops.
  Kuh: [['RawMeat', 2, 3, 1]],
  Wolf: [['RawMeat', 1, 2, 1]],
  // B9.6: same reason — no Feathers item exists in itemDefs.ts (only a
  // decorative ITEM_DROP prefab of that name, not a carriable item), so the
  // hen drops meat too. It is the smallest animal in the table (0.26 m),
  // smaller than the boar's drop: exactly 1, always (chance 1, min=max=1).
  Huhn: [['RawMeat', 1, 1, 1]],
  Neck: [['NeckTail', 1, 1, 0.75]],
  Skeleton: [['Coins', 2, 5, 0.6]],
  Draugr: [['Entrails', 1, 2, 1]],
};

/** Zweit-Drop mit fester Chance (Trophäen). */
const ZWEIT_DROPS: Record<string, [string, number]> = {
  Eikthyr: ['TrophyEikthyr', 1],
};

function wuerfleDrop(kreatur: string): { name: string; amount: number } | null {
  const tabelle = KREATUR_DROPS[kreatur];
  if (!tabelle) return null;
  for (const [item, min, max, chance] of tabelle) {
    if (Math.random() <= chance) {
      return { name: item, amount: min + ((Math.random() * (max - min + 1)) | 0) };
    }
  }
  return null;
}

/** Truhen-Beute nach Truhentyp (Prefabname), sonst Meadows-Basis. */
const TRUHEN: Array<[RegExp, Array<[string, number, number]>]> = [
  [/forestcrypt/i, [['Coins', 5, 20], ['Amber', 1, 3], ['Flint', 2, 4]]],
  [/sunkencrypt/i, [['Coins', 10, 30], ['Amber', 2, 4], ['Entrails', 1, 2]]],
  [/trollcave/i, [['Coins', 10, 30], ['Amber', 1, 4], ['Wood', 5, 10]]],
  [/mountaincave/i, [['Coins', 10, 25], ['Amber', 2, 5]]],
  [/./, [['Coins', 2, 10], ['Flint', 1, 3], ['Wood', 3, 8], ['Raspberry', 3, 6]]],
];

function wuerfleTruhe(prefabName: string): { name: string; amount: number } {
  const tabelle = TRUHEN.find(([re]) => re.test(prefabName))![1];
  const [item, min, max] = tabelle[(Math.random() * tabelle.length) | 0]!;
  return { name: item, amount: min + ((Math.random() * (max - min + 1)) | 0) };
}

export { pickableItem, wuerfleDrop, wuerfleTruhe, ZWEIT_DROPS };
