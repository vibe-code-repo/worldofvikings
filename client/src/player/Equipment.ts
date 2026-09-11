/**
 * What the player currently holds — Unity `Humanoid` equipment slots, reduced
 * to the one slot we need.
 *
 * C# reference: Humanoid.cs EquipItem/UnequipItem/ToggleEquipped,
 * Player.cs UseHotbarItem, Humanoid.SetupEquipment.
 *
 * Two original rules are kept:
 *  - A Tool occupies BOTH hands (Humanoid.EquipItem, Tool branch), so there is
 *    exactly one held item.
 *  - Equipping an item whose definition has a piece table puts the player into
 *    build mode; equipping anything else leaves it. That is the whole
 *    mechanism by which the hoe opens its build menu.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import {
  SLOT_VORGABE,
  slotDef,
  type AusruestungsSlot,
  type ItemStack,
  type Inventory,
} from '@wov/shared';
import type { AssetManager } from '../engine/AssetManager';
import type { AvatarRig } from './AvatarRig';

export class Equipment {
  /**
   * Slot → angelegter Gegenstand.
   *
   * Der Gegenstand BLEIBT dabei im Inventar und wird nur als `equipped`
   * markiert — genau wie bisher beim Werkzeug in der Hand. Ihn aus dem
   * Raster zu nehmen waere die naheliegende Geste, ginge hier aber
   * schief: Das Inventar ist server-autoritativ (InventorySync), und ein
   * clientseitiger Griff hinein liefe beim naechsten Abgleich auseinander.
   */
  private readonly slots = new Map<AusruestungsSlot, ItemStack>();
  private heldNode: TransformNode | null = null;
  /** Der Halter der gehaltenen Waffe (fuer Effekte, die mit der Klinge mitgehen). */
  get gehalten(): TransformNode | null {
    return this.heldNode;
  }
  /** Guards against a slow model load landing after the item was swapped. */
  private loadToken = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly inventory: Inventory,
    private readonly assets: AssetManager,
    private readonly avatar: AvatarRig
  ) {}

  /**
   * Was in der Hand liegt. Bleibt als eigener Name bestehen, weil ein gutes
   * Dutzend Stellen (Bauen, Angriff, Hotbar, HUD) danach fragt — die Hand
   * ist jetzt schlicht einer von mehreren Slots.
   */
  get rightItem(): ItemStack | null {
    return this.slots.get('waffe') ?? null;
  }

  /** Was in einem bestimmten Slot liegt. */
  imSlot(slot: AusruestungsSlot): ItemStack | null {
    return this.slots.get(slot) ?? null;
  }

  /** Alle belegten Slots — fuer das Charakterfenster. */
  get belegung(): ReadonlyMap<AusruestungsSlot, ItemStack> {
    return this.slots;
  }

  /**
   * Wohin gehoert dieser Gegenstand? Ohne Angabe in die Hand (siehe
   * SLOT_VORGABE) — so bleiben Hammer, Axt und Hacke unveraendert.
   */
  slotFuer(item: ItemStack): AusruestungsSlot {
    const s = item.shared.ausruestung;
    return (slotDef(s)?.id ?? SLOT_VORGABE) as AusruestungsSlot;
  }

  /**
   * Die sichtbaren Ruestungsteile aus der aktuellen Belegung, als
   * Aussehen-Slot → Teilkennung. Genau das schickt der Client an den
   * Server und legt es an die eigene Figur.
   */
  aussehen(): Record<string, string> {
    const teile: Record<string, string> = {};
    for (const [slot, item] of this.slots) {
      const def = slotDef(slot);
      if (def?.teilSlot && item.shared.ruestungsteil) {
        teile[def.teilSlot] = item.shared.ruestungsteil;
      }
    }
    return teile;
  }

  /** Piece table key of the held item, or null when not in build mode. */
  get pieceTable(): string | null {
    return this.rightItem?.shared.pieceTable ?? null;
  }

  /** C# Player.InPlaceMode. */
  get inPlaceMode(): boolean {
    return this.pieceTable !== null;
  }

  onChanged(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** C# Humanoid.ToggleEquipped — equipping the held item unequips it. */
  toggle(item: ItemStack): void {
    const slot = this.slotFuer(item);
    if (this.slots.get(slot) === item) this.unequip(slot);
    else this.equip(item);
  }

  /** Legt den Gegenstand in SEINEN Slot; was dort lag, wird abgelegt. */
  equip(item: ItemStack, slot: AusruestungsSlot = this.slotFuer(item)): void {
    if (this.slots.get(slot) === item) return;
    // Derselbe Gegenstand kann nicht in zwei Slots liegen (zwei Ringe
    // waeren zwei Gegenstaende, nicht einer in zwei Slots).
    for (const [s, i] of this.slots) if (i === item) this.slots.delete(s);
    const vorher = this.slots.get(slot);
    if (vorher) vorher.equipped = false;
    this.slots.set(slot, item);
    item.equipped = true;
    if (slot === 'waffe') void this.refreshModel();
    this.emit();
  }

  unequip(slot: AusruestungsSlot = 'waffe'): void {
    const item = this.slots.get(slot);
    if (!item) return;
    item.equipped = false;
    this.slots.delete(slot);
    if (slot === 'waffe') void this.refreshModel();
    this.emit();
  }

  /** C# Player.UseHotbarItem — index is 0-based here, 1-based in the original. */
  useHotbar(index: number): void {
    const item = this.inventory.hotbar()[index];
    if (item) this.toggle(item);
  }

  /** Drops the held item's model if the item left the inventory. */
  syncWithInventory(): void {
    let handBetroffen = false;
    let geaendert = false;
    for (const [slot, item] of [...this.slots]) {
      if (this.inventory.all.includes(item)) continue;
      this.slots.delete(slot);
      geaendert = true;
      if (slot === 'waffe') handBetroffen = true;
    }
    if (!geaendert) return;
    if (handBetroffen) void this.refreshModel();
    this.emit();
  }

  private async refreshModel(): Promise<void> {
    const token = ++this.loadToken;
    this.avatar.setHeldItem(null);
    this.heldNode?.dispose();
    this.heldNode = null;

    const model = this.rightItem?.shared.model;
    if (!model) return;

    const node = await this.assets.instantiate(model);
    // Another equip happened while this was loading — throw the result away.
    if (token !== this.loadToken || !node) {
      node?.dispose();
      return;
    }
    // The hold offset goes on a wrapper, not on the model itself: the GLB
    // import puts its own rotationQuaternion on the root node, and in Babylon
    // a set rotationQuaternion makes the Euler `rotation` a no-op. Wrapping
    // keeps both transforms intact and composable.
    const shared = this.rightItem!.shared;
    const holder = new TransformNode('heldItem', node.getScene());
    const [px, py, pz] = shared.holdPosition ?? [0, 0, 0];
    const [rx, ry, rz] = shared.holdRotation ?? [0, 0, 0];
    holder.position.set(px, py, pz);
    holder.rotation.set(rx, ry, rz);
    node.parent = holder;

    this.heldNode = holder;
    this.avatar.setHeldItem(holder);
  }

  dispose(): void {
    this.loadToken++;
    this.avatar.setHeldItem(null);
    this.heldNode?.dispose();
    this.heldNode = null;
  }
}
