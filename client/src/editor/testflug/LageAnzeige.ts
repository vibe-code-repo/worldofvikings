/**
 * The orientation display of the offline flight: where am I?
 * A small panel under the minimap (which already shows the own position and
 * view direction on the map); the lines come from `positionLines`.
 *
 * Die Orientierungsanzeige des Testflugs, unter der Minimap.
 */

/** Below the minimap: top 10 px + circle 230 px + clock bar 30 px + gap. */
const TOP_PX = 276;

export class LageAnzeige {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private shown = '';

  constructor(hint: string) {
    this.root = document.createElement('div');
    this.root.id = 'wov-lage-anzeige';
    this.root.style.cssText =
      `position:fixed;top:${TOP_PX}px;right:10px;width:230px;box-sizing:border-box;` +
      'padding:6px 9px;background:rgba(8,14,18,.72);border:1px solid #8a6a34;' +
      'border-radius:4px;color:#e8e2d0;font:12px/1.45 monospace;' +
      'pointer-events:none;z-index:4;text-shadow:0 1px 2px #000';
    this.body = document.createElement('div');
    const hintEl = document.createElement('div');
    hintEl.textContent = hint;
    hintEl.style.cssText = 'margin-top:4px;color:#a99b78;font-size:11px';
    this.root.append(this.body, hintEl);
    document.body.appendChild(this.root);
  }

  /** Cheap to call every frame: the DOM is only touched when the text changes. */
  setLines(lines: readonly string[]): void {
    const text = lines.join('\n');
    if (text === this.shown) return;
    this.shown = text;
    this.body.replaceChildren(
      ...lines.map((l, i) => {
        const d = document.createElement('div');
        d.textContent = l;
        if (i === 0) d.style.cssText = 'font-weight:bold;color:#f0b662';
        return d;
      })
    );
  }

  destroy(): void {
    this.root.remove();
  }
}
