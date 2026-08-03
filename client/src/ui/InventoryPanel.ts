/**
 * Inventory overlay — the 8×4 grid from Humanoid.cs:67, opened with I.
 * (Tab belongs to the tool menu here; see PieceSelection.)
 *
 * Drag & drop uses pointer events rather than HTML5 drag-and-drop: the latter
 * needs a drag image and fires inconsistently over a WebGL canvas, and we want
 * the dragged icon to follow the cursor exactly.
 *
 * Dropping onto a slot delegates to Inventory.moveTo, which merges compatible
 * stacks and swaps otherwise — same rule as the original.
 */

import type { Inventory, ItemStack } from '@wov/shared';
import type { Equipment } from '../player/Equipment';
import { UI, overlayStyle, panelStyle, slotStyle, titleStyle } from './theme';
import { itemVisual } from './Hotbar';

const SLOT = 56;
const GAP = 4;

export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly weightLabel: HTMLDivElement;
  private visible = false;
  private readonly unsubscribe: Array<() => void> = [];
  /** Item being dragged, plus the floating icon that follows the cursor. */
  private drag: { item: ItemStack; ghost: HTMLDivElement } | null = null;

  constructor(
    private readonly inventory: Inventory,
    private readonly equipment: Equipment
  ) {
    const root = document.createElement('div');
    root.style.cssText = overlayStyle();
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });

    const panel = document.createElement('div');
    panel.style.cssText = panelStyle('auto');
    root.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = 'Inventar';
    title.style.cssText = titleStyle();
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid',
      `grid-template-columns:repeat(${inventory.width},${SLOT}px)`,
      `gap:${GAP}px`,
    ].join(';');
    panel.appendChild(grid);
    this.grid = grid;

    const weight = document.createElement('div');
    weight.style.cssText = `margin-top:12px;text-align:center;font-size:13px;color:${UI.muted}`;
    panel.appendChild(weight);
    this.weightLabel = weight;

    const hint = document.createElement('div');
    hint.textContent = 'Ziehen zum Umsortieren · Klick zum Ausrüsten · I/Esc schließt';
    hint.style.cssText = `margin-top:6px;text-align:center;font-size:12px;color:${UI.muted};opacity:.75`;
    panel.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;

    // Drag is tracked on the document so it survives leaving a slot.
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);

    this.unsubscribe.push(this.inventory.onChanged(() => this.render()));
    this.unsubscribe.push(this.equipment.onChanged(() => this.render()));
    this.render();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    // The pointer lock is NOT released here: main.ts reports the open menu to
    // the InputManager, which owns the lock. Releasing it behind that owner's
    // back looks like a browser-forced unlock and triggers Gecko's cooldown,
    // after which the lock cannot be taken back for over a second.
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.cancelDrag();
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  private render(): void {
    if (!this.visible) return;
    this.grid.replaceChildren();

    for (let y = 0; y < this.inventory.height; y++) {
      for (let x = 0; x < this.inventory.width; x++) {
        const item = this.inventory.itemAt(x, y);
        const active = item != null && item === this.equipment.rightItem;
        const cell = document.createElement('div');
        cell.style.cssText = slotStyle(SLOT, active);
        // Row 0 is the hotbar — mark it so the mapping is visible.
        if (y === 0) cell.style.borderColor = active ? UI.gold : UI.border;

        if (item) {
          cell.appendChild(itemVisual(item));
          cell.style.cursor = 'grab';
          cell.addEventListener('pointerdown', (e) => this.startDrag(e, item));
          cell.addEventListener('dblclick', () => this.equipment.toggle(item));
        }
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        this.grid.appendChild(cell);
      }
    }

    this.weightLabel.textContent = `Gewicht ${this.inventory.totalWeight().toFixed(1)}`;
  }

  private startDrag(e: PointerEvent, item: ItemStack): void {
    e.preventDefault();
    const ghost = itemVisual(item);
    ghost.style.cssText = [
      'position:fixed', 'width:48px', 'height:48px',
      'pointer-events:none', 'z-index:1100', 'opacity:.85',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    document.body.appendChild(ghost);
    this.drag = { item, ghost };
    this.moveGhost(e.clientX, e.clientY);
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.drag) this.moveGhost(e.clientX, e.clientY);
  };

  private moveGhost(x: number, y: number): void {
    if (!this.drag) return;
    this.drag.ghost.style.left = `${x - 24}px`;
    this.drag.ghost.style.top = `${y - 24}px`;
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    const { item } = this.drag;
    this.cancelDrag();

    // elementFromPoint rather than the event target: the ghost sits under the
    // cursor, and the pointer may be released outside any slot.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest<HTMLElement>('[data-x][data-y]');
    if (!cell) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    this.inventory.moveTo(item, x, y);
  };

  private cancelDrag(): void {
    this.drag?.ghost.remove();
    this.drag = null;
  }

  dispose(): void {
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    for (const off of this.unsubscribe) off();
    this.cancelDrag();
    this.root.remove();
  }
}
