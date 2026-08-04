/**
 * Spawn-Panel des 3D-Testflugs — ein richtiges Editor-Interface:
 * durchsuchbare Liste ALLER platzierbaren Prefabs (Vegetation, Felsen,
 * Bauteile, freie Suche über die ganze Registry), dazu Drehung, Abstand
 * und Größe. Muster: DungeonEditor (reines DOM, Callback-Interface,
 * keine Socket-/Szenen-Kopplung).
 *
 * Bedienung im Testflug: B öffnet/schließt (Esc gibt den Cursor frei),
 * „Platzieren" bzw. Taste P setzt das Objekt vor dem Spieler; bei
 * gefangener Maus platziert auch der Linksklick.
 */
import { FOLIAGE, BAU_PREFABS, PREFABS_BY_NAME, EIGENE_MODELLE } from '@wov/shared';

export interface SpawnEinstellung {
  prefab: string;
  /** Radiant; null = zufällige Drehung je Platzierung. */
  yaw: number | null;
  /** Abstand vor dem Spieler in Metern. */
  abstand: number;
  scale: number;
}

export interface SpawnPanelCallbacks {
  platzieren: () => void;
  entferneLetztes: () => void;
  anzahl: () => number;
}

const KATEGORIEN: ReadonlyArray<{ name: string; namen: () => string[] }> = [
  // Zuerst, und damit die Vorgabe beim Öffnen: die kurze Liste der selbst
  // erzeugten Modelle. In den anderen Kategorien gehen sie zwischen
  // hunderten Einträgen unter (die Liste zeigt nur die ersten 80).
  // Nicht vorhandene Namen werden gefiltert, damit ein Eintrag ohne
  // passende GLB die Auswahl nicht mit einer toten Zeile verstopft.
  { name: 'Eigene Modelle', namen: () => EIGENE_MODELLE.filter((n) => PREFABS_BY_NAME.has(n)) },
  { name: 'Vegetation', namen: () => [...new Set(FOLIAGE.map((f) => f.prefabName))] },
  { name: 'Bauteile', namen: () => [...BAU_PREFABS] },
  {
    name: 'Alle (mit Modell)',
    namen: () => [...PREFABS_BY_NAME.values()].filter((d) => d.model).map((d) => d.name),
  },
];

export class SpawnPanel {
  /** Wird bei jeder Prefab-Wahl in der Liste gerufen (reaktiviert die Vorschau). */
  aufWahl: (() => void) | null = null;
  readonly einstellung: SpawnEinstellung = {
    prefab: localStorage.getItem('wov-editor-spawn-prefab') ?? 'Beech1',
    yaw: null,
    abstand: 4,
    scale: 1,
  };
  private readonly root: HTMLDivElement;
  private readonly liste: HTMLDivElement;
  private readonly zaehler: HTMLDivElement;
  private suchtext = '';
  private kategorie = 0;

  constructor(private readonly cb: SpawnPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:60px;right:12px;width:280px;max-height:80vh;overflow-y:auto;' +
      'background:rgba(18,22,31,0.94);border:1px solid #3a3325;border-radius:6px;padding:10px;' +
      'font-family:Georgia,serif;font-size:13px;color:#d8cfa8;z-index:900;display:none;';
    const titel = document.createElement('div');
    titel.textContent = '✦ Spawn-Editor';
    titel.style.cssText = 'font-size:15px;color:#e8d48a;margin-bottom:6px;';
    this.root.appendChild(titel);

    // Kategorie + Suche
    const kat = document.createElement('select');
    kat.style.cssText = this.feldStil();
    KATEGORIEN.forEach((k, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = k.name;
      kat.appendChild(o);
    });
    kat.onchange = () => {
      this.kategorie = Number(kat.value);
      this.listeFuellen();
    };
    this.root.appendChild(kat);

    const suche = document.createElement('input');
    suche.placeholder = 'Suchen … (z. B. beech, rock, wood)';
    suche.style.cssText = this.feldStil();
    let sucheTimer: number | null = null;
    suche.oninput = () => {
      this.suchtext = suche.value.trim().toLowerCase();
      if (sucheTimer !== null) window.clearTimeout(sucheTimer);
      sucheTimer = window.setTimeout(() => this.listeFuellen(), 150);
    };
    this.root.appendChild(suche);

    this.liste = document.createElement('div');
    this.liste.style.cssText =
      'max-height:220px;overflow-y:auto;border:1px solid #3a3325;border-radius:4px;margin:4px 0;';
    this.root.appendChild(this.liste);

    // Drehung
    this.root.appendChild(this.label('Drehung'));
    const drehZeile = document.createElement('div');
    drehZeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const dreh = document.createElement('input');
    dreh.type = 'range';
    dreh.min = '0';
    dreh.max = '360';
    dreh.value = '0';
    dreh.style.cssText = 'flex:1;';
    const drehWert = document.createElement('span');
    drehWert.textContent = 'zufällig';
    drehWert.style.cssText = 'width:58px;font-size:11px;';
    const zufall = document.createElement('input');
    zufall.type = 'checkbox';
    zufall.checked = true;
    const drehAktualisieren = (): void => {
      this.einstellung.yaw = zufall.checked ? null : (Number(dreh.value) * Math.PI) / 180;
      drehWert.textContent = zufall.checked ? 'zufällig' : `${dreh.value}°`;
    };
    dreh.oninput = () => {
      zufall.checked = false;
      drehAktualisieren();
    };
    zufall.onchange = drehAktualisieren;
    drehZeile.append(dreh, drehWert, zufall);
    this.root.appendChild(drehZeile);

    // Abstand + Größe
    this.root.appendChild(this.schieber('Abstand (m)', 2, 20, 4, 1, (v) => (this.einstellung.abstand = v)));
    this.root.appendChild(this.schieber('Größe', 0.2, 3, 1, 0.1, (v) => (this.einstellung.scale = v)));

    // Aktionen
    const aktionen = document.createElement('div');
    aktionen.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    aktionen.appendChild(this.knopf('Platzieren (P)', () => this.cb.platzieren()));
    aktionen.appendChild(this.knopf('↩ Letztes weg', () => {
      this.cb.entferneLetztes();
      this.aktualisiere();
    }));
    this.root.appendChild(aktionen);

    this.zaehler = document.createElement('div');
    this.zaehler.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    this.root.appendChild(this.zaehler);

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:4px;';
    tip.textContent = 'Bei gefangener Maus platziert auch der Linksklick. Esc gibt den Cursor frei.';
    this.root.appendChild(tip);

    document.body.appendChild(this.root);
    this.listeFuellen();
  }

  private feldStil(): string {
    return 'width:100%;background:#0d1420;color:#d8cfa8;border:1px solid #3a3325;padding:4px;margin:2px 0;box-sizing:border-box;';
  }

  private label(text: string): HTMLDivElement {
    const l = document.createElement('div');
    l.textContent = text;
    l.style.cssText = 'font-size:11px;color:#9a8f6a;margin-top:6px;';
    return l;
  }

  private knopf(text: string, cb: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'flex:1;padding:6px;background:#1d2431;color:#d8cfa8;border:1px solid #3a3325;border-radius:4px;cursor:pointer;font-family:inherit;';
    b.onclick = cb;
    return b;
  }

  private schieber(
    name: string,
    min: number,
    max: number,
    start: number,
    schritt: number,
    setz: (v: number) => void
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.appendChild(this.label(name));
    const zeile = document.createElement('div');
    zeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    const s = document.createElement('input');
    s.type = 'range';
    s.min = String(min);
    s.max = String(max);
    s.step = String(schritt);
    s.value = String(start);
    s.style.cssText = 'flex:1;';
    const wert = document.createElement('span');
    wert.textContent = String(start);
    wert.style.cssText = 'width:36px;font-size:11px;';
    s.oninput = () => {
      setz(Number(s.value));
      wert.textContent = s.value;
    };
    zeile.append(s, wert);
    wrap.appendChild(zeile);
    return wrap;
  }

  private listeFuellen(): void {
    this.liste.innerHTML = '';
    const alle = KATEGORIEN[this.kategorie]!.namen();
    const treffer = (this.suchtext
      ? alle.filter((n) => n.toLowerCase().includes(this.suchtext))
      : alle
    ).slice(0, 80);
    for (const name of treffer) {
      const zeile = document.createElement('div');
      zeile.textContent = name;
      zeile.style.cssText =
        'padding:2px 6px;cursor:pointer;' +
        (name === this.einstellung.prefab ? 'background:#243044;color:#e8d48a;' : '');
      zeile.onclick = () => {
        this.einstellung.prefab = name;
        localStorage.setItem('wov-editor-spawn-prefab', name);
        this.aufWahl?.();
        this.listeFuellen();
      };
      this.liste.appendChild(zeile);
    }
    const gesamt = this.suchtext ? alle.filter((n) => n.toLowerCase().includes(this.suchtext)).length : alle.length;
    if (gesamt > treffer.length) {
      const mehr = document.createElement('div');
      mehr.textContent = `… und ${gesamt - treffer.length} weitere — Suche verfeinern`;
      mehr.style.cssText = 'padding:2px 6px;color:#9a8f6a;font-style:italic;';
      this.liste.appendChild(mehr);
    }
    if (treffer.length === 0) {
      const leer = document.createElement('div');
      leer.textContent = 'keine Treffer';
      leer.style.cssText = 'padding:4px 6px;color:#9a8f6a;';
      this.liste.appendChild(leer);
    }
  }

  aktualisiere(): void {
    this.zaehler.textContent = `${this.cb.anzahl()} Platzierung(en) im Entwurf — Prefab: ${this.einstellung.prefab}`;
  }

  toggle(): boolean {
    const sichtbar = this.root.style.display === 'none';
    this.root.style.display = sichtbar ? 'block' : 'none';
    if (sichtbar) this.aktualisiere();
    return sichtbar;
  }

  get istOffen(): boolean {
    return this.root.style.display !== 'none';
  }
}
