/**
 * Item definitions. Values marked "verified" come from the MonoBehaviour dumps
 * under /root/Valheim_Client/extracted_assets/ — the rest are plausible
 * placeholders for fields nothing reads yet.
 *
 * Asset names are checked against assets/: sprites are lower_snake_case,
 * models are the PascalCase prefab name.
 */

import { ItemType, type ItemShared } from './ItemData.js';

/**
 * `Hammer.glb` is a 248-byte stub with zero meshes — the real geometry sits in
 * `Hammer_0.glb`. Same trap as the Boar/Greydwarf models (see prefabs.ts).
 * Noted here because the hammer will be added once build pieces exist.
 */

export const ITEM_DEFS: readonly ItemShared[] = [
  {
    // verified: $item_hoe, m_itemType 19, maxDurability 200, drain 1, stamina 5
    name: 'Hoe',
    label: 'Hacke (Hoe)',
    itemType: ItemType.Tool,
    icon: 'hoe',
    model: 'Hoe',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Hoe',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    // verified: $item_cultivator, tool with a piece table
    name: 'Cultivator',
    label: 'Pflug',
    itemType: ItemType.Tool,
    // There is no cultivator.png in the rip — only the bronze/iron variants.
    icon: 'cultivator_bronze',
    model: 'Cultivator',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Cultivator',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    // verified: $item_pickaxe_antler, m_itemType 14, no piece table,
    // m_spawnOnHitTerrain -> digg_v3. Digs through the attack path, not build
    // mode — that is why it has no piece table.
    name: 'PickaxeAntler',
    label: 'Geweihspitzhacke',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'pickaxe_antler',
    model: 'PickaxeAntler',
    maxStackSize: 1,
    weight: 3,
    spawnOnHitTerrain: 'digg',
    toolTier: 0,
    // Griff in der Faust, Kopf schräg nach vorne-oben (per Auge justiert).
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 4,
  },
  {
    // Kopfnotiz oben: Hammer.glb ist ein 248-Byte-Stub — Hammer_0.glb traegt
    // die echte Geometrie. Jetzt eingeloest: der Hammer baut (pieceTable).
    name: 'Hammer',
    label: 'Hammer',
    itemType: ItemType.Tool,
    icon: 'hammer',
    model: 'Hammer_0',
    maxStackSize: 1,
    weight: 2,
    pieceTable: 'Hammer',
    toolTier: 0,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 5,
  },
  {
    name: 'Wood',
    label: 'Holz',
    itemType: ItemType.Material,
    icon: 'wood',
    model: 'Wood',
    maxStackSize: 50,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'Stone',
    label: 'Stein',
    itemType: ItemType.Material,
    icon: 'stone',
    model: 'Stone',
    maxStackSize: 50,
    weight: 2,
    toolTier: 0,
  },
  // ── Phase-5-Nachzügler: Materialien für Loot, Pickups und Crafting.
  // Nur Items mit vorhandenem Sprite (assets/sprites, snake_case geprüft).
  {
    name: 'Flint',
    label: 'Feuerstein',
    itemType: ItemType.Material,
    icon: 'flint',
    model: 'Flint',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Resin',
    label: 'Harz',
    itemType: ItemType.Material,
    icon: 'resin',
    model: 'Resin',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Raspberry',
    label: 'Himbeeren',
    itemType: ItemType.Material,
    icon: 'raspberry',
    model: 'Raspberry',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Blueberries',
    label: 'Blaubeeren',
    itemType: ItemType.Material,
    icon: 'blueberries',
    model: 'Blueberries',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Mushroom',
    label: 'Pilz',
    itemType: ItemType.Material,
    icon: 'mushroom',
    model: 'Mushroom',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Thistle',
    label: 'Distel',
    itemType: ItemType.Material,
    icon: 'thistle',
    model: 'Thistle',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Dandelion',
    label: 'Löwenzahn',
    itemType: ItemType.Material,
    icon: 'dandelion',
    model: 'Dandelion',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Carrot',
    label: 'Karotte',
    itemType: ItemType.Material,
    icon: 'carrot',
    model: 'Carrot',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'RawMeat',
    label: 'Rohes Fleisch',
    itemType: ItemType.Material,
    icon: 'raw_meat',
    model: 'RawMeat',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Entrails',
    label: 'Gedärme',
    itemType: ItemType.Material,
    icon: 'entrails',
    model: 'Entrails',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Coins',
    label: 'Münzen',
    itemType: ItemType.Material,
    icon: 'coins',
    model: 'Coins',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'Amber',
    label: 'Bernstein',
    itemType: ItemType.Material,
    icon: 'amber',
    model: 'Amber',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'NeckTail',
    label: 'Neck-Schwanz',
    itemType: ItemType.Material,
    icon: 'necktail',
    model: 'NeckTail',
    maxStackSize: 50,
    weight: 0.5,
    toolTier: 0,
  },
  {
    name: 'TrophyDeer',
    label: 'Hirschtrophäe',
    itemType: ItemType.Material,
    icon: 'TrophyDeer',
    model: 'TrophyDeer',
    maxStackSize: 10,
    weight: 1.5,
    toolTier: 0,
  },
  {
    name: 'CookedMeat',
    label: 'Gebratenes Fleisch',
    itemType: ItemType.Material,
    icon: 'necktailgrilled',
    model: 'CookedMeat',
    maxStackSize: 20,
    weight: 1,
    toolTier: 0,
  },
  {
    // Einfache Nahkampfwaffe — Rezept: 6 Holz an keiner Station.
    name: 'Club',
    label: 'Keule',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'club',
    model: 'Club',
    maxStackSize: 1,
    weight: 2,
    toolTier: 0,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 100,
    useDurabilityDrain: 1,
    attackStamina: 6,
  },
  {
    name: 'HardAntler',
    label: 'Hartes Geweih',
    itemType: ItemType.Material,
    icon: 'HardAntler',
    model: 'HardAntler',
    maxStackSize: 20,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'TrophyEikthyr',
    label: 'Eikthyr-Trophäe',
    itemType: ItemType.Material,
    icon: 'TrophyEikthyr',
    model: 'Eikthyr_Trophy',
    maxStackSize: 5,
    weight: 2,
    toolTier: 0,
  },
  {
    name: 'AxeFlint',
    label: 'Feuersteinaxt',
    itemType: ItemType.TwoHandedWeapon,
    icon: 'axe_flint',
    model: 'AxeFlint',
    maxStackSize: 1,
    weight: 2.5,
    toolTier: 1,
    holdPosition: [0, -0.05, 0.12],
    holdRotation: [-1.9, 0, 0],
    maxDurability: 200,
    useDurabilityDrain: 1,
    attackStamina: 8,
  },
];

export const ITEMS_BY_NAME: ReadonlyMap<string, ItemShared> = new Map(
  ITEM_DEFS.map((d) => [d.name, d])
);

export function findItem(name: string): ItemShared | undefined {
  return ITEMS_BY_NAME.get(name);
}

/**
 * Essbares (Taste F): maxHP-Bonus und Wirkdauer — stark vereinfachtes
 * Valheim-Food-Modell (ein Slot statt drei, dazu 1 HP/s Regeneration).
 */
export const ESSEN: Record<string, { bonus: number; dauerSec: number }> = {
  CookedMeat: { bonus: 30, dauerSec: 480 },
  NeckTail: { bonus: 15, dauerSec: 300 },
  Blueberries: { bonus: 12, dauerSec: 300 },
  Carrot: { bonus: 12, dauerSec: 300 },
  Mushroom: { bonus: 10, dauerSec: 300 },
  Raspberry: { bonus: 8, dauerSec: 240 },
};
