/**
 * Item model — mirrors Unity `ItemDrop.ItemData` / `ItemData.SharedData`.
 *
 * C# reference: assembly_valheim/ItemDrop.cs
 *
 * The split matters: `ItemShared` exists once per item type (name, icon,
 * stack size, what the tool does), `ItemStack` exists once per inventory slot
 * (how many, how worn, where in the grid). Valheim shares the SharedData
 * instance across every stack of that type; we do the same by referencing the
 * definition object rather than copying it.
 */

/**
 * C# ItemDrop.ItemData.ItemType. Only the values we actually use are listed —
 * the original has 24 (and skips 8).
 */
export const enum ItemType {
  Material = 1,
  TwoHandedWeapon = 14,
  Tool = 19,
}

/** Shared, immutable definition of an item type. */
export interface ItemShared {
  /** Prefab name, also the stacking key. Matches shared/src/prefabData.json. */
  name: string;
  /** Display name. */
  label: string;
  itemType: ItemType;
  /** File in assets/sprites/, without ".png". */
  icon: string;
  /** GLB in assets/models/, without ".glb". Null for icon-only items. */
  model: string | null;
  maxStackSize: number;
  weight: number;
  /**
   * Key into PIECE_TABLES. Set on tools that enter build mode (hoe,
   * cultivator, hammer) — C# ItemData.SharedData.m_buildPieces.
   */
  pieceTable?: string;
  /**
   * Terrain operation triggered on hit, for tools that do NOT use a piece
   * table — C# m_spawnOnHitTerrain. This is how the pickaxe digs.
   */
  spawnOnHitTerrain?: string;
  /** C# m_toolTier — which rocks/trees this can damage. Unused so far. */
  toolTier: number;

  /**
   * Where the model sits in the hand, as [x, y, z] metres and [x, y, z]
   * radians relative to the hand node.
   *
   * Valheim attaches tools by an `attach` transform inside the prefab (Hoe.glb
   * has one at z −0.6 with its own rotation). Reproducing that chain exactly
   * would mean walking the GLB node hierarchy at load time; a per-item offset
   * is simpler and good enough, at the cost of being eyeballed rather than
   * derived. Defaults to identity.
   */
  holdPosition?: readonly [number, number, number];
  holdRotation?: readonly [number, number, number];

  // Cost levers. Deliberately unused in the first pass (see the plan): the
  // fields exist so enabling stamina/durability later is a local change.
  maxDurability?: number;
  useDurabilityDrain?: number;
  attackStamina?: number;
}

/** One inventory slot. */
export interface ItemStack {
  shared: ItemShared;
  stack: number;
  durability: number;
  quality: number;
  /** Grid position. Row 0 is the hotbar — C# ItemData.m_gridPos. */
  gridX: number;
  gridY: number;
  equipped: boolean;
}

/** Serialized form (world save / network). Resolved via ITEMS_BY_NAME. */
export interface SavedItemStack {
  name: string;
  stack: number;
  durability: number;
  quality: number;
  gridX: number;
  gridY: number;
  equipped: boolean;
}

/**
 * C# Inventory.TopFirst — weapons, tools, shields and misc fill from the top
 * row down, everything else from the bottom up. That is why a picked-up hoe
 * lands in the hotbar instead of somewhere in the back of the inventory.
 */
export function topFirst(shared: ItemShared): boolean {
  return shared.itemType === ItemType.Tool || shared.itemType === ItemType.TwoHandedWeapon;
}

/** Two stacks may merge only if type and quality match (C# Inventory.AddItem). */
export function canStack(a: ItemStack, b: ItemShared, quality: number): boolean {
  return a.shared.name === b.name && a.quality === quality && a.stack < b.maxStackSize;
}
