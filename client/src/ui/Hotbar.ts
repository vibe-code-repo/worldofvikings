/**
 * Hotbar — the 8 slots of inventory row 0 (C# Inventory.GetHotbar,
 * HotkeyBar.cs). Keys 1-8 equip/unequip, matching ZInput's Hotbar1..Hotbar8.
 *
 * Plain DOM like the rest of the UI; see ui/theme.ts for why.
 */

import type { Inventory, ItemStack } from '@wov/shared';
import { HOTBAR_SIZE } from '@wov/shared';
import type { Equipment } from '../player/Equipment';
import { UI, slotStyle } from './theme';

const SLOT = 52;

export class Hotbar {
  private readonly root: HTMLDivElement;
  private readonly cells: HTMLDivElement[] = [];
  private readonly unsubscribe: Array<() => void> = [];

  constructor(
    private readonly inventory: Inventory,
    private readonly equipment: Equipment
  ) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
      'display:flex', 'gap:4px', 'z-index:900',
      `font-family:${UI.font}`, 'pointer-events:none',
    ].join(';');

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = document.createElement('div');
      cell.style.cssText = slotStyle(SLOT, false);
      cell.style.pointerEvents = 'auto';
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => this.equipment.useHotbar(i));

      const key = document.createElement('div');
      key.textContent = String(i + 1);
      key.style.cssText = `position:absolute;top:1px;left:3px;font-size:10px;color:${UI.muted};text-shadow:0 1px 2px #000`;
      cell.appendChild(key);

      root.appendChild(cell);
      this.cells.push(cell);
    }

    document.body.appendChild(root);
    this.root = root;

    this.unsubscribe.push(this.inventory.onChanged(() => this.render()));
    this.unsubscribe.push(this.equipment.onChanged(() => this.render()));
    this.render();
  }

  private render(): void {
    const items = this.inventory.hotbar();
    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const item = items[i];
      const active = item != null && item === this.equipment.rightItem;

      // Rebuild only the content, keep the slot-number badge (first child).
      while (cell.childNodes.length > 1) cell.removeChild(cell.lastChild!);
      cell.style.cssText = slotStyle(SLOT, active);
      cell.style.pointerEvents = 'auto';
      cell.style.cursor = 'pointer';

      if (item) cell.appendChild(itemVisual(item));
    }
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.root.remove();
  }
}

/** Icon plus stack count, shared with the inventory grid. */
export function itemVisual(item: ItemStack): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center';

  const img = document.createElement('img');
  img.src = `/assets/sprites/${item.shared.icon}.png`;
  img.alt = item.shared.label;
  img.draggable = false;
  img.style.cssText = 'width:80%;height:80%;object-fit:contain;image-rendering:auto';
  // A missing sprite should not leave a broken-image glyph in the slot.
  img.addEventListener('error', () => {
    img.style.display = 'none';
    const fallback = document.createElement('div');
    fallback.textContent = item.shared.label.slice(0, 2);
    fallback.style.cssText = `font-size:16px;color:${UI.text}`;
    wrap.appendChild(fallback);
  });
  wrap.appendChild(img);

  if (item.stack > 1) {
    const n = document.createElement('div');
    n.textContent = String(item.stack);
    n.style.cssText = `position:absolute;right:3px;bottom:1px;font-size:12px;color:${UI.text};text-shadow:0 1px 3px #000`;
    wrap.appendChild(n);
  }
  return wrap;
}
