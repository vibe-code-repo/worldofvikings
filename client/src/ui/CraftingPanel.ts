/**
 * CraftingPanel (Phase 5, Basis) — Taste C: Freihand-Rezepte aus
 * shared/items/recipes.ts. Reines Client-Crafting (das Inventar lebt
 * clientseitig); geprüft wird gegen countOf, Zutaten gehen per
 * removeByName raus. Gestaltung wie SettingsPanel (Leder/Bronze).
 */
import { REZEPTE, findItem, type Inventory } from '@wov/shared';

export class CraftingPanel {
  private readonly root: HTMLDivElement;
  private readonly liste: HTMLDivElement;
  private visible = false;

  constructor(
    private readonly inventory: () => Inventory | null,
    private readonly meldung: (text: string) => void
  ) {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;' +
      'background:rgba(10,8,4,.55);font-family:Georgia,"Times New Roman",serif';
    root.addEventListener('click', (e) => {
      if (e.target === root) this.hide();
    });
    const panel = document.createElement('div');
    panel.style.cssText =
      'width:min(380px,90vw);background:linear-gradient(180deg,#3a2f22,#241c14);' +
      'border:2px solid #8a6a34;border-radius:6px;padding:20px 24px 16px;color:#e8d9b8;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.6)';
    const titel = document.createElement('div');
    titel.textContent = 'Herstellen';
    titel.style.cssText =
      'font-size:22px;letter-spacing:.06em;color:#f2c86a;text-align:center;margin-bottom:12px;text-shadow:0 1px 2px #000';
    panel.appendChild(titel);
    this.liste = document.createElement('div');
    panel.appendChild(this.liste);
    root.appendChild(panel);
    document.body.appendChild(root);
    this.root = root;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';
    this.fuellen();
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
  }

  private fuellen(): void {
    const inv = this.inventory();
    this.liste.textContent = '';
    if (!inv) return;
    for (const r of REZEPTE) {
      const def = findItem(r.ergebnis);
      if (!def) continue;
      const machbar = r.zutaten.every((z) => inv.countOf(z.item) >= z.menge);
      const zeile = document.createElement('div');
      zeile.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;padding:6px 4px;' +
        'border-bottom:1px solid rgba(138,106,52,.35);gap:8px';
      const info = document.createElement('div');
      const kosten = r.zutaten
        .map((z) => `${z.menge}× ${findItem(z.item)?.label ?? z.item}`)
        .join(', ');
      info.innerHTML =
        `<div style="color:#f2c86a">${def.label}</div>` +
        `<div style="font-size:12px;color:${machbar ? '#a8916a' : '#7a5b4a'}">${kosten}</div>`;
      zeile.appendChild(info);
      const btn = document.createElement('button');
      btn.textContent = 'Herstellen';
      btn.disabled = !machbar;
      btn.style.cssText =
        'background:linear-gradient(180deg,#5a4626,#3a2f22);border:1px solid #8a6a34;' +
        `color:${machbar ? '#f2c86a' : '#6a5a3a'};border-radius:4px;font-family:inherit;` +
        `font-size:13px;padding:5px 12px;cursor:${machbar ? 'pointer' : 'default'}`;
      btn.addEventListener('click', () => {
        const jetzt = this.inventory();
        if (!jetzt) return;
        if (!r.zutaten.every((z) => jetzt.countOf(z.item) >= z.menge)) return;
        for (const z of r.zutaten) jetzt.removeByName(z.item, z.menge);
        jetzt.addItem(def, r.menge);
        this.meldung(`Hergestellt: ${def.label}`);
        this.fuellen();
      });
      zeile.appendChild(btn);
      this.liste.appendChild(zeile);
    }
  }
}
