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
import type { ItemStack, Inventory } from '@wov/shared';
import type { AssetManager } from '../engine/AssetManager';
import type { AvatarRig } from './AvatarRig';

export class Equipment {
  private _rightItem: ItemStack | null = null;
  private heldNode: TransformNode | null = null;
  /** Guards against a slow model load landing after the item was swapped. */
  private loadToken = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly inventory: Inventory,
    private readonly assets: AssetManager,
    private readonly avatar: AvatarRig
  ) {}

  get rightItem(): ItemStack | null {
    return this._rightItem;
  }

  /** Piece table key of the held item, or null when not in build mode. */
  get pieceTable(): string | null {
    return this._rightItem?.shared.pieceTable ?? null;
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
    if (this._rightItem === item) this.unequip();
    else this.equip(item);
  }

  equip(item: ItemStack): void {
    if (this._rightItem === item) return;
    if (this._rightItem) this._rightItem.equipped = false;
    this._rightItem = item;
    item.equipped = true;
    void this.refreshModel();
    this.emit();
  }

  unequip(): void {
    if (!this._rightItem) return;
    this._rightItem.equipped = false;
    this._rightItem = null;
    void this.refreshModel();
    this.emit();
  }

  /** C# Player.UseHotbarItem — index is 0-based here, 1-based in the original. */
  useHotbar(index: number): void {
    const item = this.inventory.hotbar()[index];
    if (item) this.toggle(item);
  }

  /** Drops the held item's model if the item left the inventory. */
  syncWithInventory(): void {
    if (this._rightItem && !this.inventory.all.includes(this._rightItem)) {
      this._rightItem = null;
      void this.refreshModel();
      this.emit();
    }
  }

  private async refreshModel(): Promise<void> {
    const token = ++this.loadToken;
    this.avatar.setHeldItem(null);
    this.heldNode?.dispose();
    this.heldNode = null;

    const model = this._rightItem?.shared.model;
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
    const shared = this._rightItem!.shared;
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
