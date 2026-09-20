/**
 * The orientation display of the offline flight: where am I?
 * A small panel under the minimap (which already shows the own position and
 * view direction on the map); the lines come from `positionLines`.
 *
 * Die Orientierungsanzeige des Testflugs, unter der Minimap.
 */

/** Below the minimap: top 10 px + circle 230 px + clock bar 30 px + gap. */
const TOP_PX = 276;

/** The loading screen (`LoadingScreen`) sits at z-index 900; the banner above it. */
const BANNER_Z = 1000;
/** How long the banner stays after the loading screen is gone (the panel keeps the text). */
const BANNER_AFTER_LOAD_MS = 8000;

export class LageAnzeige {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private shown = '';
  private banner: HTMLDivElement | null = null;
  private sawLoading = false;

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
    this.retireBanner();
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

  /**
   * A persistent note below the lines (a refused jump), and the same text as a
   * banner ABOVE the loading screen: the screen covers the whole page for as
   * long as the terrain loads (minutes on a slow machine), and a note under it
   * is not there for the player. The banner goes a few seconds after the
   * loading screen has; the note stays.
   */
  setNotice(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = 'margin-top:4px;color:#ff9a8a;font-size:11px;white-space:normal';
    this.root.appendChild(d);

    const banner = document.createElement('div');
    banner.id = 'wov-lage-meldung';
    banner.style.cssText =
      `position:fixed;left:50%;top:32%;transform:translateX(-50%);z-index:${BANNER_Z};` +
      'width:min(520px,88vw);box-sizing:border-box;padding:14px 18px;text-align:center;' +
      'background:rgba(40,12,8,.94);border:2px solid #ff9a8a;border-radius:6px;' +
      'color:#ffe0d8;font:15px/1.5 Georgia,serif;pointer-events:none';
    const kopf = document.createElement('div');
    kopf.textContent = 'Sprung abgelehnt';
    kopf.style.cssText = 'font-weight:bold;font-size:17px;color:#ff9a8a;margin-bottom:6px';
    const zeile = document.createElement('div');
    zeile.textContent = text;
    const rat = document.createElement('div');
    rat.textContent = 'Die Figur steht am Ursprung. Tab schließen und in der Karte eine Stelle an Land wählen.';
    rat.style.cssText = 'margin-top:8px;font-size:13px;color:#e0c2b8';
    banner.append(kopf, zeile, rat);
    document.body.appendChild(banner);
    this.banner?.remove();
    this.banner = banner;
    this.sawLoading = document.getElementById('loading-screen') !== null;
  }

  /** Start the countdown once the loading screen has been seen and is gone. */
  private retireBanner(): void {
    if (!this.banner) return;
    const loading = document.getElementById('loading-screen') !== null;
    if (loading) {
      this.sawLoading = true;
      return;
    }
    if (!this.sawLoading) return;
    const banner = this.banner;
    this.banner = null;
    setTimeout(() => banner.remove(), BANNER_AFTER_LOAD_MS);
  }

  destroy(): void {
    this.banner?.remove();
    this.root.remove();
  }
}
