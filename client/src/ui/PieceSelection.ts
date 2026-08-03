/**
 * Build menu — the mode picker of the equipped tool.
 *
 * C# reference: Hud.TogglePieceSelection / UpdatePieceList / OnLeftClickPiece.
 * Opened with the right mouse button, closed with RMB or Escape; while it is
 * open the original blocks placement entirely (Player.UpdatePlacement returns
 * early on Hud.IsPieceSelectionVisible).
 *
 * The original lays pieces out on a 15×6 grid with category tabs because the
 * hammer has hundreds of them. A hoe has five modes, so this is a single row.
 *
 * Opened and closed with Tab (main.ts), not with the right mouse button as in
 * the original — see PlacementController.update for why. While it is open the
 * pointer lock is handed back, so a mode is picked by clicking its tile; the
 * wheel does the same without moving the mouse. The selection survives closing
 * the menu — the strip under the hotbar shows which mode is live.
 */

import type { PlacementController } from '../player/PlacementController';
import type { InputManager } from '../engine/InputManager';
import { UI, panelStyle, slotStyle } from './theme';

const SLOT = 64;

export class PieceSelection {
  private readonly root: HTMLDivElement;
  private readonly row: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly activeLabel!: HTMLDivElement;
  private readonly unsubscribe: Array<() => void> = [];
  /** Last rendered (open, selected) pair — render() runs every frame. */
  private rendered = '';

  constructor(
    private readonly placement: PlacementController,
    private readonly input?: InputManager
  ) {
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:80px', 'transform:translateX(-50%)',
      'z-index:950', 'display:none',
      `font-family:${UI.font}`,
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = panelStyle('auto') + ';padding:12px 16px 10px';
    root.appendChild(panel);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px';
    panel.appendChild(row);
    this.row = row;

    const label = document.createElement('div');
    label.style.cssText = `margin-top:8px;text-align:center;font-size:13px;color:${UI.gold};min-height:1em`;
    panel.appendChild(label);
    this.label = label;

    const hint = document.createElement('div');
    hint.textContent = 'Tasten 1-5 wählen · Mausrad blättert · Linksklick/Tab/Esc schließt';
    hint.style.cssText = `margin-top:2px;text-align:center;font-size:11px;color:${UI.muted};opacity:.7`;
    panel.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;

    // Which mode is live, also with the menu closed — otherwise the only way to
    // tell is to swing the tool and look at the ground.
    const active = document.createElement('div');
    active.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:74px', 'transform:translateX(-50%)',
      'z-index:900', 'display:none', 'pointer-events:none',
      `font-family:${UI.font}`, 'font-size:12px', `color:${UI.gold}`,
      'text-shadow:0 1px 3px #000',
    ].join(';');
    document.body.appendChild(active);
    this.activeLabel = active;

    this.unsubscribe.push(this.placement.onChanged(() => this.render()));
    // Escape closes it, like the original.
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape' && this.placement.menuOpen) {
        this.placement.menuOpen = false;
        this.render();
      }
    };
    window.addEventListener('keydown', onKey);
    this.unsubscribe.push(() => window.removeEventListener('keydown', onKey));

    this.render();
  }

  /**
   * Pick a mode and go straight back to playing — C# OnLeftClickPiece hides the
   * window after picking. Must run inside a user gesture (mousedown or keydown)
   * because of the pointer-lock request at the end.
   */
  pick(name: string): void {
    this.placement.selectPiece(name);
    this.placement.closeMenu();
    this.render();
    this.input?.captureFromGesture();
  }

  render(): void {
    const pieces = this.placement.pieces;
    const open = this.placement.menuOpen && pieces.length > 0;
    const selected = this.placement.selectedPiece;

    // The main loop calls this every frame; rebuilding the tiles each time
    // would churn the DOM (and restart the icon loads) for nothing.
    const radius = this.placement.effectiveRadius;
    const key = `${open}|${selected?.name ?? ''}|${radius.toFixed(2)}|${pieces.map((p) => p.name).join(',')}`;
    if (key === this.rendered) return;
    this.rendered = key;

    this.root.style.display = open ? 'block' : 'none';

    // Mode readout under the hotbar: visible whenever a tool with modes is
    // held, hidden while the menu itself is up.
    const showActive = !open && pieces.length > 0 && selected !== null;
    this.activeLabel.style.display = showActive ? 'block' : 'none';
    // Kept up to date even while hidden, so closing the menu shows the mode
    // that was just picked rather than the previous one.
    if (selected) {
      this.activeLabel.textContent = `Modus: ${selected.label} · Radius ${radius.toFixed(1)} m (Mausrad)`;
    }

    if (!open) return;

    this.row.replaceChildren();

    for (const [i, piece] of pieces.entries()) {
      const active = piece.name === selected?.name;
      const cell = document.createElement('div');
      cell.style.cssText = slotStyle(SLOT, active);
      cell.style.cursor = 'pointer';
      cell.title = piece.label;

      // Same corner number as the hotbar slots — 1-8 pick a mode while the
      // menu is open (main.ts), so the key has to be visible on the tile.
      if (i < 8) {
        const key = document.createElement('div');
        key.textContent = String(i + 1);
        key.style.cssText = `position:absolute;top:1px;left:3px;font-size:10px;color:${UI.muted};text-shadow:0 1px 2px #000`;
        cell.appendChild(key);
      }

      const img = document.createElement('img');
      img.src = `/assets/sprites/${piece.icon}.png`;
      img.alt = piece.label;
      img.draggable = false;
      img.style.cssText = 'width:76%;height:76%;object-fit:contain';
      img.addEventListener('error', () => {
        img.style.display = 'none';
        cell.textContent = piece.label.slice(0, 2);
      });
      cell.appendChild(img);

      // Bound to mousedown, not click: taking the pointer lock back has to
      // happen inside the mousedown gesture itself or Gecko refuses it. On a
      // click handler the lock never came back, so the next click into the
      // world only re-captured the mouse instead of using the tool.
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        this.pick(piece.name);
      });
      cell.addEventListener('mouseenter', () => {
        this.label.textContent = piece.label;
      });
      this.row.appendChild(cell);
    }

    this.label.textContent = selected?.label ?? '';
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.root.remove();
    this.activeLabel.remove();
  }
}
