/**
 * Item model — mirrors the original's item data and shared per-type data.
 *
 * Reference: the original item-drop component
 *
 * The split matters: `ItemShared` exists once per item type (name, icon,
 * stack size, what the tool does), `ItemStack` exists once per inventory slot
 * (how many, how worn, where in the grid). The reference shares one shared-data
 * instance across every stack of that type; we do the same by referencing the
 * definition object rather than copying it.
 */

/**
 * Item type, as in the original. Only the values we actually use are listed —
 * the original has 24 (and skips 8).
 */
export const enum ItemType {
  Material = 1,
  TwoHandedWeapon = 14,
  Tool = 19,
}

import type { AppearancePolicy } from '../appearanceVisibility.js';
import type { ArmorBodyPolicy } from '../armorCompatibility.js';

/** Shared, immutable definition of an item type. */
export interface ItemShared extends AppearancePolicy, ArmorBodyPolicy {
  readonly vfxProfile?: 'emberrage_red';
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
   * cultivator, hammer) — the original's build-piece list.
   */
  pieceTable?: string;
  /**
   * Terrain operation triggered on hit, for tools that do NOT use a piece
   * table — the original's spawn-on-terrain-hit field. This is how the pickaxe digs.
   */
  spawnOnHitTerrain?: string;
  /** Tool tier — which rocks/trees this can damage. Unused so far. */
  toolTier: number;

  /**
   * In welchen Ausrüstungsslot dieser Gegenstand gehört
   * (shared/ausruestung.ts). Fehlt das Feld, geht er in die HAND — so
   * verhalten sich alle Werkzeuge und Waffen wie bisher, ohne dass ihre
   * Einträge angefasst werden mussten.
   */
  ausruestung?: string;

  /**
   * Kennung des sichtbaren Rüstungsteils (shared/aussehen.ts), das beim
   * Anlegen an der Figur erscheint.
   *
   * WARUM NICHT `model`: `model` ist das Ding, das man in der HAND hält
   * (eine Axt, ein Hammer) und als eigenes Objekt in die Szene kommt. Ein
   * Kleidungsstück ist etwas anderes — es wird auf das SKELETT der Figur
   * gezogen und teilt sich deren Gelenkliste. Beides in ein Feld zu
   * pressen hiesse, an der Ladestelle raten zu müssen, was gemeint ist.
   */
  ruestungsteil?: string;

  /**
   * Where the model sits in the hand, as [x, y, z] metres and [x, y, z]
   * radians relative to the hand node.
   *
   * The reference attaches tools by an `attach` transform inside the prefab (Hoe.glb
   * has one at z −0.6 with its own rotation). Reproducing that chain exactly
   * would mean walking the GLB node hierarchy at load time; a per-item offset
   * is simpler and good enough, at the cost of being eyeballed rather than
   * derived. Defaults to identity.
   */
  holdPosition?: readonly [number, number, number];
  holdRotation?: readonly [number, number, number];
  /**
   * Griffversatz waehrend eines Hiebs, in Metern entlang der Laengsachse
   * der Waffe (Modell-+Y, von der Faust zur Spitze). Positiv = das Modell
   * rutscht in Richtung Spitze durch die Faust, die Hand greift also
   * naeher am unteren Ende.
   *
   * WARUM: Lange Stangenwaffen werden in Ruhe weit oben gefasst, damit ihr
   * unteres Ende neben der Figur am Boden aufsteht — der Ursprung liegt
   * darum gut einen Meter ueber dem Ende. In der beidhaendigen Hiebkette
   * liegen die Haende aber in Brusthoehe, und derselbe Meter Schaft faehrt
   * dann durch Rumpf und Beine. Statt fuer den Hieb ein zweites Modell mit
   * anderem Ursprung zu halten, verschiebt der Halter die Waffe fuer die
   * Dauer des Hiebs entlang ihrer eigenen Achse. Fehlt das Feld (Schwert,
   * Werkzeuge), aendert sich nichts.
   */
  holdOffsetStrike?: number;
  /**
   * Animationssatz der Figur beim Halten: `sword` einhaendig (Vorgabe),
   * `staff` beidhaendig (Katana-Kette und beidarmige Ruheschicht),
   * `spear` einhaendig aufrecht getragen, Ende am Boden (eigene Ruhepose).
   */
  animationSet?: 'sword' | 'staff' | 'spear';

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
  /** Grid position. Row 0 is the hotbar. */
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
 * Top-first placement — weapons, tools, shields and misc fill from the top
 * row down, everything else from the bottom up. That is why a picked-up hoe
 * lands in the hotbar instead of somewhere in the back of the inventory.
 */
export function topFirst(shared: ItemShared): boolean {
  return shared.itemType === ItemType.Tool || shared.itemType === ItemType.TwoHandedWeapon;
}

/** Two stacks may merge only if type and quality match (as in the original). */
export function canStack(a: ItemStack, b: ItemShared, quality: number): boolean {
  return a.shared.name === b.name && a.quality === quality && a.stack < b.maxStackSize;
}
