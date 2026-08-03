/**
 * Player inventory — 1:1 model of Unity `Inventory` (assembly_valheim/Inventory.cs).
 *
 * Deliberately a FLAT LIST with a grid position per item, not a 2D array. That
 * is how the original stores it (`List<ItemData>` + `m_gridPos`), and it keeps
 * three things simple: stacking (scan for a matching partial stack), the
 * hotbar (just the items with gridY === 0), and serialization (no holes to
 * encode).
 *
 * Player grid is 8×4 (Humanoid.cs:67), so row 0 gives the 8 hotbar slots.
 */

import {
  canStack,
  topFirst,
  type ItemShared,
  type ItemStack,
  type SavedItemStack,
} from './ItemData.js';
import { findItem } from './itemDefs.js';

export const INVENTORY_WIDTH = 8;
export const INVENTORY_HEIGHT = 4;
/** Hotbar is row 0 of the inventory — C# Inventory.GetHotbar. */
export const HOTBAR_SIZE = INVENTORY_WIDTH;

export class Inventory {
  private items: ItemStack[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly width = INVENTORY_WIDTH,
    readonly height = INVENTORY_HEIGHT
  ) {}

  /** Subscribe to changes; returns an unsubscriber. */
  onChanged(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get all(): readonly ItemStack[] {
    return this.items;
  }

  itemAt(x: number, y: number): ItemStack | null {
    return this.items.find((i) => i.gridX === x && i.gridY === y) ?? null;
  }

  /** Row 0, indexed by column. Empty slots are null. */
  hotbar(): (ItemStack | null)[] {
    const row: (ItemStack | null)[] = new Array(HOTBAR_SIZE).fill(null);
    for (const it of this.items) if (it.gridY === 0 && it.gridX < HOTBAR_SIZE) row[it.gridX] = it;
    return row;
  }

  totalWeight(): number {
    let w = 0;
    for (const it of this.items) w += it.shared.weight * it.stack;
    return w;
  }

  /**
   * Adds `amount` items, filling partial stacks first, then empty slots.
   * Returns how many did NOT fit (0 on full success) — C# AddItem semantics.
   */
  addItem(shared: ItemShared, amount = 1, quality = 1): number {
    let left = amount;

    if (shared.maxStackSize > 1) {
      for (const it of this.items) {
        if (left <= 0) break;
        if (!canStack(it, shared, quality)) continue;
        const room = shared.maxStackSize - it.stack;
        const take = Math.min(room, left);
        it.stack += take;
        left -= take;
      }
    }

    while (left > 0) {
      const slot = this.findEmptySlot(topFirst(shared));
      if (!slot) break;
      const take = Math.min(shared.maxStackSize, left);
      this.items.push({
        shared,
        stack: take,
        durability: shared.maxDurability ?? 100,
        quality,
        gridX: slot[0],
        gridY: slot[1],
        equipped: false,
      });
      left -= take;
    }

    if (left !== amount) this.emit();
    return left;
  }

  /** Removes `amount` (default: the whole stack). */
  removeItem(item: ItemStack, amount = item.stack): void {
    item.stack -= amount;
    if (item.stack <= 0) {
      const i = this.items.indexOf(item);
      if (i >= 0) this.items.splice(i, 1);
    }
    this.emit();
  }

  /** Total count of an item type across all stacks. */
  /**
   * Menge eines Items namensweise entfernen (Crafting-Zutaten). Liefert
   * false ohne Änderung, wenn nicht genug vorhanden ist.
   */
  removeByName(name: string, amount: number): boolean {
    if (this.countOf(name) < amount) return false;
    let rest = amount;
    for (let y = 0; y < this.height && rest > 0; y++) {
      for (let x = 0; x < this.width && rest > 0; x++) {
        const stack = this.itemAt(x, y);
        if (!stack || stack.shared.name !== name) continue;
        const nehmen = Math.min(rest, stack.stack);
        this.removeItem(stack, nehmen);
        rest -= nehmen;
      }
    }
    return true;
  }

  countOf(name: string): number {
    let n = 0;
    for (const it of this.items) if (it.shared.name === name) n += it.stack;
    return n;
  }

  /**
   * Moves `item` to (x, y): merges onto a compatible stack, otherwise swaps
   * with whatever sits there. Returns false if the target is out of bounds.
   */
  moveTo(item: ItemStack, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const target = this.itemAt(x, y);

    if (target === item) return true;

    if (target && canStack(target, item.shared, item.quality)) {
      const room = item.shared.maxStackSize - target.stack;
      const take = Math.min(room, item.stack);
      target.stack += take;
      item.stack -= take;
      if (item.stack <= 0) {
        const i = this.items.indexOf(item);
        if (i >= 0) this.items.splice(i, 1);
      }
      this.emit();
      return true;
    }

    if (target) {
      target.gridX = item.gridX;
      target.gridY = item.gridY;
    }
    item.gridX = x;
    item.gridY = y;
    this.emit();
    return true;
  }

  /** C# Inventory.FindEmptySlot — top-down for tools/weapons, bottom-up else. */
  private findEmptySlot(fromTop: boolean): [number, number] | null {
    const rows = fromTop
      ? [...Array(this.height).keys()]
      : [...Array(this.height).keys()].reverse();
    for (const y of rows) {
      for (let x = 0; x < this.width; x++) {
        if (!this.itemAt(x, y)) return [x, y];
      }
    }
    return null;
  }

  serialize(): SavedItemStack[] {
    return this.items.map((it) => ({
      name: it.shared.name,
      stack: it.stack,
      durability: it.durability,
      quality: it.quality,
      gridX: it.gridX,
      gridY: it.gridY,
      equipped: it.equipped,
    }));
  }

  /** Unknown item names are dropped rather than failing the whole load. */
  load(saved: readonly SavedItemStack[]): void {
    this.items = [];
    for (const s of saved) {
      const shared = findItem(s.name);
      if (!shared) continue;
      this.items.push({
        shared,
        stack: s.stack,
        durability: s.durability,
        quality: s.quality,
        gridX: s.gridX,
        gridY: s.gridY,
        equipped: s.equipped,
      });
    }
    this.emit();
  }
}
