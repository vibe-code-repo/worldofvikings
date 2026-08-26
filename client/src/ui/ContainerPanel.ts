/**
 * ContainerPanel (Roadmap F1) — Truhen-UI: zwei Raster nebeneinander,
 * links das eigene Inventar, rechts der Truheninhalt. Folgt bewusst dem
 * Muster von InventoryPanel.ts (gleiche Theme-Bausteine, gleiche
 * Slot-Optik) statt einer zweiten Gestaltung.
 *
 * ANDERS ALS InventoryPanel: kein Ziehen zwischen Slots, sondern Klick =
 * ganzen Stapel auf die andere Seite verschieben. InventoryPanel.moveTo
 * ist rein client-seitiges Umsortieren (keine Netzwirkung); eine Truhe
 * dagegen ändert echten Bestand auf ZWEI Seiten (Server-Inventar UND
 * Truhen-ZDO) und MUSS deshalb über den Server laufen (Duplikat-/
 * Verlust-Sicherheit, s. WovServer.handleContainerAction). Ein Klick ist
 * die einfachste Geste, die verlustfrei genau einen serverautoritativen
 * Vorgang auslöst; Teilmengen ziehen wäre eine spätere Erweiterung,
 * keine Voraussetzung für "Truhen sind echte Behälter".
 *
 * Server ist hier die einzige Quelle der Wahrheit für den Truheninhalt:
 * `zeigeInhalt()` ersetzt ihn IMMER vollständig aus dem letzten
 * ContainerSync, es gibt keinen optimistischen lokalen Vorgriff.
 */
import type { Inventory, ItemStack } from '@wov/shared';
import { CONTAINER_WIDTH, INVENTORY_WIDTH } from '@wov/shared';
import { UI, overlayStyle, panelStyle, slotStyle, titleStyle } from './theme';
import { itemVisual } from './Hotbar';
import type { GameI18n } from '../i18n';

const SLOT = 56;
const GAP = 4;

export class ContainerPanel {
  private readonly root: HTMLDivElement;
  private readonly eigenesGrid: HTMLDivElement;
  private readonly truheGrid: HTMLDivElement;
  private visible = false;
  private zdo: { userId: string; id: number } | null = null;
  private truhe: Inventory | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  /**
   * Wird gerufen, wenn das Fenster schliesst — daran haengt die
   * Deckel-Animation (s. entities/OffeneTruhe.ts).
   *
   * Bewusst HIER und nicht an den fuenf `hide()`-Aufrufen in main.ts:
   * Das Fenster schliesst auch von sich aus (Klick daneben, Escape),
   * und ein vergessener Aufrufer liesse einen offenen Deckel im Feld
   * stehen, den nichts mehr zumacht.
   */
  onGeschlossen: (() => void) | null = null;

  constructor(
    private readonly eigenesInventar: Inventory,
    /** Server-Aktion: 0 = aus der Truhe nehmen, 1 = hineinlegen. */
    private readonly aufAktion: (
      zdoUserId: string,
      zdoId: number,
      richtung: 0 | 1,
      itemName: string,
      amount: number
    ) => void,
    private readonly i18n: GameI18n
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
    title.style.cssText = titleStyle();
    panel.appendChild(title);

    const spalten = document.createElement('div');
    spalten.style.cssText = 'display:flex;gap:20px;align-items:flex-start';
    panel.appendChild(spalten);

    const [eigeneSpalte, eigenesGrid, eigenesLabel] = this.bauSpalte(INVENTORY_WIDTH);
    const [truheSpalte, truheGrid, truheLabel] = this.bauSpalte(CONTAINER_WIDTH);
    spalten.appendChild(eigeneSpalte);
    spalten.appendChild(truheSpalte);
    this.eigenesGrid = eigenesGrid;
    this.truheGrid = truheGrid;

    const hint = document.createElement('div');
    hint.style.cssText = `margin-top:10px;text-align:center;font-size:12px;color:${UI.muted};opacity:.75`;
    panel.appendChild(hint);

    document.body.appendChild(root);
    this.root = root;

    // Eigenes Inventar kann sich AUCH aendern, waehrend die Truhe offen
    // ist (Ernten, Craften nebenbei) — die linke Spalte bleibt live.
    this.unsubscribe.push(this.eigenesInventar.onChanged(() => this.render()));
    this.unsubscribe.push(this.i18n.onChange(() => {
      title.textContent = this.i18n.t('container.title');
      eigenesLabel.textContent = this.i18n.t('container.inventory');
      truheLabel.textContent = this.i18n.t('container.chest');
      hint.textContent = this.i18n.t('container.hint');
      this.render();
    }));
  }

  private bauSpalte(spalten: number): [HTMLDivElement, HTMLDivElement, HTMLDivElement] {
    const spalte = document.createElement('div');
    spalte.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px';
    const label = document.createElement('div');
    label.style.cssText = `font-size:13px;color:${UI.muted};letter-spacing:.04em`;
    spalte.appendChild(label);
    const grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid',
      `grid-template-columns:repeat(${spalten},${SLOT}px)`,
      `gap:${GAP}px`,
    ].join(';');
    spalte.appendChild(grid);
    return [spalte, grid, label];
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Ist DIESE Truhe gerade angezeigt? (main.ts braucht das nicht mehr,
   *  s. Kopfkommentar — bleibt als Hilfe für spätere Aufrufer stehen.) */
  zeigtTruhe(userId: string, id: number): boolean {
    return this.zdo !== null && this.zdo.userId === userId && this.zdo.id === id;
  }

  /**
   * Neuer Stand vom Server (direkte Antwort auf Interact ODER auf eine
   * eigene ContainerAction, s. PacketType.ContainerSync) — öffnet die
   * Truhe, falls noch zu, und ersetzt in jedem Fall den angezeigten
   * Inhalt vollständig.
   */
  zeigeInhalt(userId: string, id: number, truhe: Inventory): void {
    this.zdo = { userId, id };
    this.truhe = truhe;
    this.visible = true;
    this.root.style.display = 'flex';
    this.render();
  }

  hide(): void {
    const warOffen = this.visible;
    this.visible = false;
    this.root.style.display = 'none';
    this.zdo = null;
    this.truhe = null;
    if (warOffen) this.onGeschlossen?.();
  }

  private render(): void {
    if (!this.visible) return;
    this.eigenesGrid.replaceChildren();
    this.truheGrid.replaceChildren();

    this.fuelleGrid(this.eigenesGrid, this.eigenesInventar, 1);
    if (this.truhe) this.fuelleGrid(this.truheGrid, this.truhe, 0);
  }

  private fuelleGrid(grid: HTMLDivElement, inv: Inventory, richtung: 0 | 1): void {
    for (let y = 0; y < inv.height; y++) {
      for (let x = 0; x < inv.width; x++) {
        const item = inv.itemAt(x, y);
        const cell = document.createElement('div');
        cell.style.cssText = slotStyle(SLOT, false);
        if (item) {
          cell.appendChild(itemVisual(item));
          cell.style.cursor = 'pointer';
          cell.title = this.i18n.t('container.move', {
            item: item.shared.label,
            amount: item.stack,
          });
          cell.addEventListener('click', () => this.verschiebe(item, richtung));
        }
        grid.appendChild(cell);
      }
    }
  }

  private verschiebe(item: ItemStack, richtung: 0 | 1): void {
    if (!this.zdo) return;
    // Ganzer Stapel, EIN Server-Aufruf — die Antwort (ContainerSync)
    // ersetzt beide Raster, sobald sie ankommt. Kein optimistisches
    // Vorwegnehmen hier: passt der Stapel nicht vollständig (Zielseite
    // voll), soll der Server das entscheiden, nicht die Anzeige.
    this.aufAktion(this.zdo.userId, this.zdo.id, richtung, item.shared.name, item.stack);
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.root.remove();
  }
}
