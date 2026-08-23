/**
 * Das Charakterfenster — Figur in der Mitte, Ausrüstungsslots ringsherum.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum die Figur eine eigene Szene bekommt
 * ════════════════════════════════════════════════════════════════════
 * Die Spielfigur steht in der Welt und wird von hinten gefilmt; sie im
 * Fenster zu zeigen hiesse, die Spielkamera umzuhängen — mitten im Spiel.
 * `CharakterVorschau` bringt eine eigene kleine Szene mit, die genau dafür
 * gebaut wurde (Charaktererstellung) und dieselben Teildateien lädt.
 *
 * Sie wird ERST BEIM ÖFFNEN angelegt und beim Schliessen wieder
 * weggeräumt. Ein zweiter WebGL-Kontext, der dauerhaft neben dem Spiel
 * läuft, kostet Bildzeit und Speicher — und das Fenster ist die meiste
 * Zeit zu. Der Preis dafür ist eine kurze Ladezeit beim Öffnen; die
 * Dateien liegen danach im Browser-Zwischenspeicher.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum das Fenster den Bildschirm NICHT abdunkelt
 * ════════════════════════════════════════════════════════════════════
 * Es soll neben dem Inventar stehen, damit man Gegenstände von dort auf
 * die Slots ziehen kann. Zwei bildschirmfüllende Abdunklungen
 * übereinander würden sich gegenseitig die Klicks wegnehmen. Deshalb
 * hängt hier nur das Fenster selbst im Bild, und die Anordnung
 * (nebeneinander oder mittig) setzt `setzePlatz()`.
 */

import {
  AUSRUESTUNG_SLOTS,
  type AusruestungsSlot,
  type ItemStack,
} from '@wov/shared';
import type { Equipment } from '../player/Equipment';
import { UI, panelStyle, slotStyle, titleStyle } from './theme';
import { itemVisual } from './Hotbar';

const SLOT = 52;
/** Zwischenraum zwischen Charakterfenster und Inventar. */
const LUECKE = 24;

/** Wo das Fenster steht, wenn beide Fenster offen sind. */
export type Platz = 'mitte' | 'links';

export class CharakterPanel {
  private readonly wurzel: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly spalteLinks: HTMLDivElement;
  private readonly spalteRechts: HTMLDivElement;
  private readonly unten: HTMLDivElement;
  private readonly leinwand: HTMLCanvasElement;
  private readonly ladehinweis: HTMLDivElement;
  private vorschau: import('./CharakterVorschau.js').CharakterVorschau | null = null;
  /** Verhindert, dass ein spätes Laden in ein längst geschlossenes Fenster fällt. */
  private oeffnungsZaehler = 0;

  constructor(
    private readonly equipment: () => Equipment | null,
    /**
     * Was die Figur im Fenster tragen soll: Aussehen-Slot → BLOSSER
     * Dateiname ohne Ordner und Endung (`R_LederBH`, `H_01`). Den Ordner
     * setzt `CharakterVorschau` über `teilPfad()` selbst — würde er hier
     * schon davorstehen, entstünde `wikingerin/wikingerin/…`.
     */
    private readonly aussehenTeile: () => Record<string, string | null>
  ) {
    this.wurzel = document.createElement('div');
    this.wurzel.id = 'charakter-fenster';
    this.wurzel.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:1000', 'display:none',
      'align-items:center', 'justify-content:center',
      `font-family:${UI.font}`,
      // KEIN Hintergrund und KEIN Mausfang: Das Inventar liegt daneben und
      // muss anklickbar bleiben.
      'pointer-events:none',
    ].join(';');

    this.panel = document.createElement('div');
    this.panel.style.cssText = panelStyle('440px') + ';pointer-events:auto';
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    const titel = document.createElement('div');
    titel.style.cssText = titleStyle();
    titel.textContent = 'Charakter';
    this.panel.appendChild(titel);

    // ── Mittelteil: Slots | Figur | Slots ────────────────────────────
    const reihe = document.createElement('div');
    reihe.style.cssText = 'display:flex;gap:12px;align-items:flex-start;justify-content:center';

    this.spalteLinks = document.createElement('div');
    this.spalteRechts = document.createElement('div');
    for (const sp of [this.spalteLinks, this.spalteRechts]) {
      sp.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    }

    const figurRahmen = document.createElement('div');
    figurRahmen.style.cssText = [
      'position:relative', 'width:170px', 'height:300px',
      `border:1px solid ${UI.borderDim}`, 'border-radius:4px',
      'background:rgba(10,8,4,.45)', 'overflow:hidden',
    ].join(';');
    this.leinwand = document.createElement('canvas');
    this.leinwand.style.cssText = 'width:100%;height:100%;display:block';
    figurRahmen.appendChild(this.leinwand);
    this.ladehinweis = document.createElement('div');
    this.ladehinweis.style.cssText =
      `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;` +
      `color:${UI.muted};font-size:13px`;
    this.ladehinweis.textContent = 'lädt …';
    figurRahmen.appendChild(this.ladehinweis);

    reihe.append(this.spalteLinks, figurRahmen, this.spalteRechts);
    this.panel.appendChild(reihe);

    this.unten = document.createElement('div');
    this.unten.style.cssText = 'display:flex;gap:8px;justify-content:center;margin-top:12px';
    this.panel.appendChild(this.unten);

    const fuss = document.createElement('div');
    fuss.style.cssText = `color:${UI.muted};font-size:12px;margin-top:12px;text-align:center;line-height:1.5`;
    fuss.innerHTML =
      'Gegenstand aus dem Inventar auf einen Slot ziehen · Klick auf einen belegten Slot legt ab<br>K schliesst · I öffnet das Inventar daneben';
    this.panel.appendChild(fuss);

    this.wurzel.appendChild(this.panel);
    document.body.appendChild(this.wurzel);
  }

  get isVisible(): boolean {
    return this.wurzel.style.display === 'flex';
  }

  /**
   * Mittig oder nach links gerückt (wenn das Inventar daneben steht).
   * Verschoben wird über `translate`, nicht über die Ausrichtung: Die
   * Figur soll beim Öffnen des Inventars sichtbar zur Seite gehen und
   * nicht springen.
   */
  setzePlatz(platz: Platz): void {
    this.panel.style.transition = 'transform .15s ease';
    if (platz !== 'links') {
      this.panel.style.transform = 'translateX(0)';
      return;
    }
    // Aus der EIGENEN Breite rechnen statt einer festen Zahl: Beide
    // Fenster sind mittig ausgerichtet, also muss jedes um seine halbe
    // Breite plus den halben Zwischenraum zur Seite. Eine geratene Zahl
    // (erst -240 px) liess sie bei 1600 px Fensterbreite ueberlappen —
    // und waere bei jeder Aenderung am Inhalt wieder falsch.
    const versatz = this.panel.offsetWidth / 2 + LUECKE / 2;
    this.panel.style.transform = `translateX(${-Math.round(versatz)}px)`;
  }

  toggle(): void {
    if (this.isVisible) this.hide();
    else this.show();
  }

  show(): void {
    this.wurzel.style.display = 'flex';
    this.zeichne();
    void this.starteVorschau();
  }

  hide(): void {
    this.wurzel.style.display = 'none';
    // Szene abräumen: ein zweiter WebGL-Kontext neben dem Spiel kostet
    // Bildzeit, und niemand sieht ihn, solange das Fenster zu ist.
    this.oeffnungsZaehler++;
    this.vorschau?.dispose();
    this.vorschau = null;
    this.ladehinweis.style.display = 'flex';
  }

  private async starteVorschau(): Promise<void> {
    if (this.vorschau) {
      await this.ziehePassendAn();
      return;
    }
    const marke = ++this.oeffnungsZaehler;
    try {
      const mod = await import('./CharakterVorschau.js');
      if (marke !== this.oeffnungsZaehler) return; // inzwischen geschlossen
      this.vorschau = new mod.CharakterVorschau(this.leinwand);
      await this.vorschau.ladeKoerper();
      if (marke !== this.oeffnungsZaehler) {
        this.vorschau.dispose();
        this.vorschau = null;
        return;
      }
      await this.ziehePassendAn();
      this.ladehinweis.style.display = 'none';
    } catch (e) {
      console.warn('[charakter] Vorschau nicht verfuegbar:', e);
      this.ladehinweis.textContent = 'Vorschau nicht verfügbar';
    }
  }

  /** Der Figur im Fenster anziehen, was die Ausrüstung sagt. */
  private async ziehePassendAn(): Promise<void> {
    if (!this.vorschau) return;
    for (const [slot, datei] of Object.entries(this.aussehenTeile())) {
      await this.vorschau.setze(slot, datei);
    }
  }

  /** Neu zeichnen — nach jeder Änderung an der Ausrüstung. */
  zeichne(): void {
    if (!this.isVisible) return;
    const eq = this.equipment();
    this.spalteLinks.replaceChildren();
    this.spalteRechts.replaceChildren();
    this.unten.replaceChildren();

    for (const def of AUSRUESTUNG_SLOTS) {
      const zelle = this.baueSlot(def.id, def.name, eq?.imSlot(def.id) ?? null);
      const ziel =
        def.seite === 'links' ? this.spalteLinks : def.seite === 'rechts' ? this.spalteRechts : this.unten;
      ziel.appendChild(zelle);
    }
    void this.ziehePassendAn();
  }

  private baueSlot(id: AusruestungsSlot, name: string, item: ItemStack | null): HTMLDivElement {
    const zelle = document.createElement('div');
    zelle.style.cssText = slotStyle(SLOT, item !== null);
    // DAS Attribut, an dem der Einwurf aus dem Inventar erkennt, dass hier
    // ein Ausrüstungsslot liegt (siehe InventoryPanel.aufFremdesZiel).
    zelle.dataset.slot = id;
    zelle.title = item ? `${item.shared.label} — Klick legt ab` : name;

    if (item) {
      zelle.appendChild(itemVisual(item));
      zelle.style.cursor = 'pointer';
      zelle.addEventListener('pointerdown', () => {
        this.equipment()?.unequip(id);
      });
    } else {
      const beschriftung = document.createElement('div');
      beschriftung.style.cssText =
        `font-size:10px;color:${UI.muted};text-align:center;line-height:1.1;padding:2px`;
      beschriftung.textContent = name;
      zelle.appendChild(beschriftung);
    }
    return zelle;
  }

  dispose(): void {
    this.oeffnungsZaehler++;
    this.vorschau?.dispose();
    this.wurzel.remove();
  }
}
