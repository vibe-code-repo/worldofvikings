/**
 * Player inventory — 1:1 model of the reference implementation's `Inventory`.
 *
 * Deliberately a FLAT LIST with a grid position per item, not a 2D array. That
 * is how the original stores it (list + grid position per item), and it keeps
 * three things simple: stacking (scan for a matching partial stack), the
 * hotbar (just the items with gridY === 0), and serialization (no holes to
 * encode).
 *
 * Player grid is 8×4, so row 0 gives the 8 hotbar slots.
 */

import {
  canStack,
  topFirst,
  type ItemShared,
  type ItemStack,
  type SavedItemStack,
} from './ItemData.js';
import { findItem } from './itemDefs.js';
import './grundbestand.js'; // makes the base stock known wherever an inventory is used

export const INVENTORY_WIDTH = 8;
export const INVENTORY_HEIGHT = 4;
/** Hotbar is row 0 of the inventory. */
export const HOTBAR_SIZE = INVENTORY_WIDTH;

/**
 * While on, `load` keeps stacks whose name resolves to no definition (as raw data in `verwahrt`, written back by
 * `serialize`) instead of dropping them. The item watch switches it on at a start without a usable last good state:
 * then it cannot tell which data items the working copy lost, so nothing unknown may vanish until it is confirmed.
 */
/** Upper bound for a stack amount when nothing better is known (bounds the over-stack split loop too). */
export const STAPEL_OBERGRENZE = 9999;
// 9999 is ten times the largest data stack (`MAX_STAPEL` = 999 in gegenstandsDaten.ts) and 200 times the largest code
// stack (50 in itemDefs.ts): a legitimate stack never gets near it, so only damage is above, and one bound keeps
// the split loop short.

/**
 * Largest amount that is repaired and split. 1e9 is far below 2^53 (about 9e15, where whole numbers stop being exact
 * and `stack - 9999` would return the same number), and some 30 000 times more than the grid can ever hold
 * (32 cells x 999). An amount above it is not arithmetic any more but damage: it is kept whole, untouched, unsplit.
 */
export const MENGE_REPARIERBAR_MAX = 1e9;

/**
 * The one repair of a saved stack of a KNOWN item, used by `load`, `holeVerwahrteZurueck` and `unpackContainer`.
 * Returns `null` only for what cannot be repaired: an amount that is not a finite number from 1 to `MENGE_REPARIERBAR_MAX` (that stack
 * stays kept raw, never dropped, never in the grid). Everything else is brought into range and flagged `repariert`
 * (the caller warns): amount rounded down (never cut: an amount over the maximum is split by `teileUeberstapel`, what
 * finds no cell is kept), quality a whole number from 1, durability finite and not negative, and at most the item's
 * own maximum if it has one. No value is invented: without a maximum a missing or broken durability stays missing.
 */
/** An amount that counts as held: a finite number of at least 1 (what the repair would keep, whatever its size). */
export const mengeGueltig = (menge: unknown): menge is number => typeof menge === 'number' && Number.isFinite(menge) && menge >= 1;

export function repariereStapel(s: SavedItemStack, shared: ItemShared): { stack: SavedItemStack; repariert: boolean } | null {
  if (!mengeGueltig(s.stack) || s.stack > MENGE_REPARIERBAR_MAX) return null;
  const stack = Math.floor(s.stack);
  const quality = typeof s.quality === 'number' && Number.isFinite(s.quality) ? Math.max(1, Math.floor(s.quality)) : 1;
  const max = shared.maxDurability;
  let durability: number | undefined = typeof s.durability === 'number' && Number.isFinite(s.durability) ? Math.max(0, s.durability) : max;
  if (durability !== undefined && max !== undefined) durability = Math.min(durability, max);
  const repariert = stack !== s.stack || quality !== s.quality || durability !== s.durability;
  return { stack: { ...s, stack, quality, durability: durability as number }, repariert };
}

/** Set by hand (tests, old callers). Servers do not use it: they ask with `fordereVerwahrenAn`. */
let unbekannteVerwahren = false;
/** How many holders (servers of this process) need the keeping on right now. */
let verwahrenHalter = 0;
export function setzeUnbekannteVerwahren(an: boolean): void {
  unbekannteVerwahren = an;
}
/**
 * PROCESS-WIDE on purpose: `Inventory.load` and `unpackContainer` ask this one question for every inventory of the
 * process, whichever server asked for the keeping. One production process runs one game server; only tests start
 * several, and the counter makes sure that one stopping server takes back only its own request.
 */
export function unbekannteWerdenVerwahrt(): boolean {
  return unbekannteVerwahren || verwahrenHalter > 0;
}
/**
 * Asks for the keeping to be on until the returned function is called (once; calling it again does nothing). The keeping
 * is off only when nobody asks any more, so one server stopping cannot switch it off under another one in the same process.
 */
export function fordereVerwahrenAn(): () => void {
  verwahrenHalter++;
  let frei = false;
  return () => {
    if (frei) return;
    frei = true;
    verwahrenHalter--;
  };
}

export class Inventory {
  private items: ItemStack[] = [];
  /** Stacks without a definition kept on purpose (see `setzeUnbekannteVerwahren`); not part of `all`. */
  private verwahrt: SavedItemStack[] = [];
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

  /** The kept stacks without a definition. */
  get verwahrte(): readonly SavedItemStack[] {
    return this.verwahrt;
  }

  /**
   * An independent copy with everything that decides what fits: the stacks (same cells, same values, nothing repaired or
   * moved) and the kept raw stacks, which own their cells. For asking "would this fit?" without touching the real one;
   * a copy through `serialize`/`load` would lose the kept stacks (when keeping is off) and could change cells.
   */
  kopie(): Inventory {
    const k = new Inventory(this.width, this.height);
    k.items = this.items.map((it) => ({ ...it }));
    k.verwahrt = this.verwahrt.map((v) => ({ ...v }));
    return k;
  }

  /**
   * The stacks the client may show: the grid, exactly what `countOf` counts. NOT the kept stacks (they are part of the
   * saved state only: a kept stack of a known item, e.g. the part of a huge amount that found no cell, would
   * otherwise show up at the client as a real stack that the server does not count).
   */
  syncStapel(): SavedItemStack[] {
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

  /** Takes over the whole content (stacks and kept stacks) of `von`, e.g. a staged copy after a successful change. */
  uebernimm(von: Inventory): void {
    const k = von.kopie();
    this.items = k.items;
    this.verwahrt = k.verwahrt;
    this.emit();
  }

  /**
   * An inventory from a saved state that keeps raw stacks whatever the keep switch says (so a copy made from a save, to be
   * changed and written back, never drops a stack without a definition).
   */
  static ausSpeicherstand(saved: readonly SavedItemStack[], width = INVENTORY_WIDTH, height = INVENTORY_HEIGHT): Inventory {
    const inv = new Inventory(width, height);
    inv.loadMit(saved, true);
    return inv;
  }

  /** Keeps a stack raw (a chest list that has no cell left for it, or an unusable one). */
  verwahreStapel(s: SavedItemStack): void {
    this.verwahrt.push({ ...s });
  }

  /** Drops the kept stacks of these names for good; returns how many stacks went. */
  verwahrteEntfernen(namen: ReadonlySet<string>): number {
    const vorher = this.verwahrt.length;
    this.verwahrt = this.verwahrt.filter((s) => !namen.has(s.name));
    return vorher - this.verwahrt.length;
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
   * Returns how many did NOT fit (0 on full success) — same semantics as the original.
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
    // Over the stacks themselves, not the grid cells: a stack is counted and removed the same way, wherever it lies.
    for (const stack of [...this.items]) {
      if (rest <= 0) break;
      if (stack.shared.name !== name) continue;
      const nehmen = Math.min(rest, stack.stack);
      this.removeItem(stack, nehmen);
      rest -= nehmen;
    }
    return rest <= 0;
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
    if (!target && this.zelleBelegt(x, y)) return false; // the cell of a kept raw stack is not free

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

  /** Finds an empty slot — top-down for tools/weapons, bottom-up else. */
  private findEmptySlot(fromTop: boolean): [number, number] | null {
    const rows = fromTop
      ? [...Array(this.height).keys()]
      : [...Array(this.height).keys()].reverse();
    for (const y of rows) {
      for (let x = 0; x < this.width; x++) {
        if (!this.zelleBelegt(x, y)) return [x, y];
      }
    }
    return null;
  }

  /** A cell is taken by a stack of `items` or by a kept raw stack (which the grid does not show, but which owns its cell). */
  private zelleBelegt(x: number, y: number): boolean {
    return this.itemAt(x, y) !== null || this.verwahrt.some((s) => s.gridX === x && s.gridY === y);
  }

  /**
   * Resolves every stack's `shared` reference by name again. Needed after the data items were replaced
   * (`replaceDataItems`): a stack keeps the object it was created with, so without this it would go on
   * showing and using the old definition. A name that no longer resolves keeps its old object (the
   * caller removes such stacks on purpose, see the item watch).
   */
  rebind(): void {
    for (const it of this.items) {
      const neu = findItem(it.shared.name);
      if (neu) it.shared = neu;
    }
    this.holeVerwahrteZurueck();
    this.teileUeberstapel('rebind');
    this.emit();
  }

  /**
   * Kept raw stacks whose name resolves to a definition again come back into `items` as plain stacks (checked, never equipped; online players do not have
   * to log in again). The stack keeps its cell if it is free, else it takes a free one; without a free cell it stays
   * kept (nothing is lost) and the next `rebind` tries again.
   */
  private holeVerwahrteZurueck(): void {
    for (const s of [...this.verwahrt]) {
      const shared = findItem(s.name);
      if (!shared) continue;
      const r = repariereStapel(s, shared);
      if (!r) {
        // A raw stack without a usable amount: it stays kept as it is, nothing is lost and nothing unusable enters the grid.
        console.warn(`[Inventory] rebind: kept ${s.name} is unusable (stack ${String(s.stack)}), it stays kept`);
        continue;
      }
      if (r.repariert) console.warn(`[Inventory] rebind: kept ${s.name} repaired (stack ${String(s.stack)} -> ${r.stack.stack}, durability ${String(s.durability)} -> ${r.stack.durability}, quality ${String(s.quality)} -> ${r.stack.quality})`);
      this.verwahrt = this.verwahrt.filter((v) => v !== s);
      let slot: [number, number] | null = null;
      const imRaster =
        Number.isInteger(s.gridX) && Number.isInteger(s.gridY) && s.gridX >= 0 && s.gridY >= 0 && s.gridX < this.width && s.gridY < this.height;
      if (imRaster && !this.zelleBelegt(s.gridX, s.gridY)) slot = [s.gridX, s.gridY];
      else slot = this.findEmptySlot(topFirst(shared));
      if (!slot) {
        this.verwahrt.push(s);
        console.warn(`[Inventory] rebind: kept ${s.name} x${s.stack} has no free slot, it stays kept`);
        continue;
      }
      this.items.push({ shared, stack: r.stack.stack, durability: r.stack.durability, quality: r.stack.quality, gridX: slot[0], gridY: slot[1], equipped: false });
    }
  }

  /**
   * A stack over its maximum is split onto free slots (same sum, same weight, no duplicates); if none is free the
   * excess stays with a warning (nothing is lost). One function for `rebind` (new definitions) and `load` (saved
   * state with a maximum that shrank since).
   */
  private teileUeberstapel(wo: string): void {
    for (const it of [...this.items]) {
      const max = it.shared.maxStackSize;
      while (max >= 1 && it.stack > max) {
        const slot = this.findEmptySlot(topFirst(it.shared));
        if (!slot) {
          console.warn(`[Inventory] ${wo}: ${it.shared.name} x${it.stack} over the maximum ${max}, no free slot, the excess stays`);
          break;
        }
        it.stack -= max;
        this.items.push({ ...it, stack: max, gridX: slot[0], gridY: slot[1], equipped: false });
      }
    }
    // A stack that stays over the maximum for lack of cells still holds at most STAPEL_OBERGRENZE; what is above goes
    // to the kept stacks (nothing is cut), and the next `rebind` brings it back when a cell is free.
    for (const it of this.items) {
      if (it.stack <= STAPEL_OBERGRENZE) continue;
      const rest = it.stack - STAPEL_OBERGRENZE;
      console.warn(`[Inventory] ${wo}: ${it.shared.name} x${it.stack} over ${STAPEL_OBERGRENZE}, ${rest} kept apart`);
      it.stack = STAPEL_OBERGRENZE;
      this.verwahrt.push({ name: it.shared.name, stack: rest, durability: it.durability, quality: it.quality, gridX: it.gridX, gridY: it.gridY, equipped: false });
    }
  }

  serialize(): SavedItemStack[] {
    return [...this.items.map((it) => ({
      name: it.shared.name,
      stack: it.stack,
      durability: it.durability,
      quality: it.quality,
      gridX: it.gridX,
      gridY: it.gridY,
      equipped: it.equipped,
    })), ...this.verwahrt];
  }

  /** Unknown item names are dropped rather than failing the whole load (kept raw while `setzeUnbekannteVerwahren`). */
  load(saved: readonly SavedItemStack[]): void {
    this.loadMit(saved, unbekannteWerdenVerwahrt());
  }

  private loadMit(saved: readonly SavedItemStack[], unbekannteBehalten: boolean): void {
    this.items = [];
    this.verwahrt = [];
    // First pass: what is kept raw (unknown names, amounts that cannot be repaired), so every kept cell is known
    // before any stack is placed, whatever the order of the list.
    const bekannte: { shared: ItemShared; stack: SavedItemStack }[] = [];
    for (const s of saved) {
      const shared = findItem(s.name);
      if (!shared) {
        if (unbekannteBehalten) this.verwahrt.push({ ...s });
        continue;
      }
      const r = repariereStapel(s, shared);
      if (!r) {
        console.warn(`[Inventory] load: ${s.name} is unusable (stack ${String(s.stack)}), it is kept`);
        this.verwahrt.push({ ...s });
        continue;
      }
      if (r.repariert) console.warn(`[Inventory] load: ${s.name} repaired (stack ${String(s.stack)} -> ${r.stack.stack}, durability ${String(s.durability)} -> ${r.stack.durability}, quality ${String(s.quality)} -> ${r.stack.quality})`);
      bekannte.push({ shared, stack: r.stack });
    }
    for (const { shared, stack: s } of bekannte) {
      // A cell outside the grid, not a whole number or already taken (by a stack or a kept raw one) gets a free one;
      // without a free cell the stack is kept.
      let gridX = s.gridX;
      let gridY = s.gridY;
      const imRaster = Number.isInteger(gridX) && Number.isInteger(gridY) && gridX >= 0 && gridY >= 0 && gridX < this.width && gridY < this.height;
      if (!imRaster || this.zelleBelegt(gridX, gridY)) {
        const slot = this.findEmptySlot(topFirst(shared));
        if (!slot) {
          console.warn(`[Inventory] load: ${s.name} x${s.stack} has no cell and no free slot, it is kept`);
          this.verwahrt.push({ ...s });
          continue;
        }
        [gridX, gridY] = slot;
      }
      this.items.push({ shared, stack: s.stack, durability: s.durability, quality: s.quality, gridX, gridY, equipped: s.equipped === true });
    }
    this.teileUeberstapel('load');
    this.emit();
  }
}
