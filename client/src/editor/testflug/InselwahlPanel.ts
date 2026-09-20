/**
 * Island pick of the editor: a list of the islands (regions) with their
 * placement counts and a button "In 3D betreten" that opens the offline
 * flight on the island's centre. The list itself is `islandList`; this file
 * is only the window around it.
 *
 * Insel-Wahl im Editor: Liste der Inseln mit Knopf „In 3D betreten“.
 */
import type { RegionDef, WorldLayout } from '@wov/shared';
import { F, M, SCHRIFT, beiUeberfahren, el, knopf, luecke, schwebendStil, stil, zierTitel } from '../design';
import { heightSourcesFor, islandRows, islandSearchAsync, searchMessage } from './inselwahl';

export interface InselwahlHost {
  /** The current draft, sanitised; null when it is unusable. */
  layout(): WorldLayout | null;
  /**
   * Open the flight's tab NOW. It is called inside the click, before the
   * search: a pop-up is only allowed right after the click, and a search of a
   * few seconds must not use that time up. Null (and a message from the
   * host) when the browser blocks the tab.
   */
  oeffneTab(): Window | null;
  /** Point the tab at the flight on this world point. */
  betreten(x: number, z: number, was: string, tab: Window): void;
  meldung(text: string, fehler?: boolean): void;
}

export class InselwahlPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private open = false;

  constructor(private readonly host: InselwahlHost) {
    this.root = el(
      'div',
      schwebendStil({
        position: 'fixed',
        top: `${M.kopfHoehe + 8}px`,
        right: '16px',
        width: '360px',
        'max-height': `calc(100vh - ${M.kopfHoehe + M.fussHoehe + 24}px)`,
        display: 'none',
        'flex-direction': 'column',
        'z-index': '60',
        overflow: 'hidden',
      })
    );
    this.root.id = 'wov-inselwahl';
    const kopf = el(
      'div',
      stil({ display: 'flex', 'align-items': 'center', gap: '8px', padding: '10px 12px 4px' })
    );
    kopf.append(zierTitel('Inselwahl', 14), luecke(), knopf('Schließen', () => this.close(), { art: 'leise', hoehe: 26 }));
    const hinweis = el(
      'div',
      stil({ padding: '0 12px 8px', 'font-size': '11px', color: F.gedimmt2, 'line-height': '1.4' }),
      'Öffnet den Testflug mit dem Entwurf auf der Inselmitte. Oder: Zeiger über die Karte, Taste T — dann direkt an dieser Stelle.'
    );
    this.list = el('div', stil({ overflow: 'auto', padding: '0 6px 8px' }));
    this.root.append(kopf, hinweis, this.list);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  close(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  /** Rebuild the rows from the current draft and show the window. */
  show(): void {
    const layout = this.host.layout();
    this.list.replaceChildren();
    if (!layout || layout.regions.length === 0) {
      this.list.appendChild(
        el('div', stil({ padding: '12px', color: F.gedimmt, 'font-size': '12.5px' }), 'Der Entwurf hat keine Regionen — zeichne zuerst eine Insel.')
      );
    } else {
      // The rows need no heights (only counts); the jump target is computed on click.
      for (const e of islandRows(layout)) this.list.appendChild(this.row(layout, e.id, e));
    }
    this.open = true;
    this.root.style.display = 'flex';
  }

  /**
   * Search the target stepwise (the page stays alive; at most `SEARCH_BUDGET_MS`),
   * then point the tab at it — or close it and say why not.
   */
  private async suche(layout: WorldLayout, region: RegionDef, id: string, tab: Window): Promise<void> {
    const quellen = heightSourcesFor(layout);
    const r = await islandSearchAsync(layout, region, quellen.ground, quellen.estimate);
    if (tab.closed) return; // the player closed the tab meanwhile: nothing to open
    const hinweis = searchMessage(id, r);
    if (!r.target) {
      tab.close();
      if (hinweis) this.host.meldung(hinweis.text, hinweis.error);
      return;
    }
    this.host.betreten(r.target.x, r.target.z, id, tab);
    this.close();
    if (hinweis) this.host.meldung(hinweis.text, hinweis.error);
  }

  private row(
    layout: WorldLayout,
    id: string,
    e: { biome: string; continent: string | null; placements: number }
  ): HTMLDivElement {
    const row = el(
      'div',
      stil({ display: 'flex', 'align-items': 'center', gap: '8px', padding: '6px 8px', 'border-radius': `${M.radiusKlein}px` })
    );
    beiUeberfahren(row, { background: F.erhoben });
    const text = el('div', stil({ display: 'flex', 'flex-direction': 'column', gap: '1px', 'min-width': '0' }));
    text.append(
      el('span', stil({ 'font-size': '12.5px', color: F.text, 'font-weight': '500' }), id),
      el(
        'span',
        stil({ 'font-size': '11px', color: F.gedimmt2 }),
        [e.biome, e.continent].filter(Boolean).join(' · ')
      )
    );
    const zahl = el(
      'span',
      stil({ 'font-family': SCHRIFT.mono, 'font-size': '10.5px', color: F.gedimmt3, 'white-space': 'nowrap' }),
      e.placements === 1 ? '1 Platzierung' : `${e.placements} Platzierungen`
    );
    const go: HTMLButtonElement = knopf(
      'In 3D betreten',
      () => {
        const region = layout.regions.find((r) => r.id === id);
        if (!region) return;
        const tab = this.host.oeffneTab();
        if (!tab) return;
        go.textContent = 'Suche …';
        go.disabled = true;
        void this.suche(layout, region, id, tab)
          .catch((fehler: unknown) => {
            tab.close();
            this.host.meldung(`Die Suche ist fehlgeschlagen: ${String(fehler)}`, true);
          })
          .finally(() => {
          go.textContent = 'In 3D betreten';
          go.disabled = false;
        });
      },
      { hoehe: 26 }
    );
    row.append(text, luecke(), zahl, go);
    return row;
  }
}
