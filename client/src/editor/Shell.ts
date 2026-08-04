/**
 * EditorShell — das Layout-Gerüst des World-of-Vikings-Editors.
 *
 * Ein moderner Editor-Rahmen mit benannten Andockplätzen, damit künftige
 * Werkzeuge (Höhen-Paint, Fluss-Splines, Kontinent-Verwaltung, …) nur noch
 * Inhalte registrieren statt Layout zu bauen:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ Werkzeugleiste (toolbarGruppe)               │
 *   ├──────────┬───────────────────────────────────┤
 *   │ Seiten-  │                                   │
 *   │ leiste   │  Viewport (Canvas-Ebenen)         │
 *   │ (sektion)│                                   │
 *   │          ├───────────────────────────────────┤
 *   │          │ Konsole (andockbar, ziehbar,      │
 *   │          │ minimier-/maximierbar)            │
 *   ├──────────┴───────────────────────────────────┤
 *   │ Statusleiste: Meldung (links) · Koordinaten  │
 *   └──────────────────────────────────────────────┘
 *
 * Meldung und Koordinaten sind getrennte Elemente — Fehlertexte werden
 * nicht mehr von jeder Mausbewegung überschrieben (Review-Punkt 20).
 */

export const THEME = {
  hintergrund: '#0b0e14',
  flaeche: '#12161f',
  feld: '#0d1420',
  rand: '#3a3325',
  text: '#d8cfa8',
  akzent: '#e8d48a',
  gedimmt: '#9a8f6a',
  fehler: '#d98a6a',
  ok: '#9fb18f',
} as const;

const KONSOLE_MIN = 26;
const KONSOLE_STANDARD = 160;

export class EditorShell {
  readonly viewport: HTMLDivElement;
  private readonly toolbar: HTMLDivElement;
  private readonly seitenleiste: HTMLDivElement;
  private readonly meldungEl: HTMLDivElement;
  private readonly koordinatenEl: HTMLDivElement;
  private readonly konsole: HTMLDivElement;
  private readonly konsoleLog: HTMLDivElement;
  private readonly konsoleTitel: HTMLSpanElement;
  private readonly mitte: HTMLDivElement;
  private konsoleHoehe = KONSOLE_STANDARD;
  private meldungTimer: number | null = null;
  /** Von der Shell gerufen, wenn sich die Viewport-Größe ändert. */
  aufResize: (() => void) | null = null;

  constructor(titel: string) {
    document.body.style.cssText = `margin:0;height:100vh;overflow:hidden;background:${THEME.hintergrund};` +
      `font-family:Georgia,serif;color:${THEME.text};`;
    const wurzel = document.createElement('div');
    wurzel.style.cssText = 'display:flex;flex-direction:column;height:100vh;';
    document.body.appendChild(wurzel);

    // ── Werkzeugleiste ──────────────────────────────────────────────
    this.toolbar = document.createElement('div');
    this.toolbar.style.cssText =
      `display:flex;align-items:center;gap:14px;padding:6px 12px;background:${THEME.flaeche};` +
      `border-bottom:1px solid ${THEME.rand};flex:0 0 auto;`;
    const marke = document.createElement('div');
    marke.textContent = titel;
    marke.style.cssText = `font-size:15px;color:${THEME.akzent};margin-right:6px;white-space:nowrap;`;
    this.toolbar.appendChild(marke);
    wurzel.appendChild(this.toolbar);

    // ── Mittelteil: Seitenleiste + (Viewport über Konsole) ──────────
    const reihe = document.createElement('div');
    reihe.style.cssText = 'display:flex;flex:1;min-height:0;';
    wurzel.appendChild(reihe);

    this.seitenleiste = document.createElement('div');
    this.seitenleiste.style.cssText =
      `width:300px;min-width:300px;overflow-y:auto;background:${THEME.flaeche};` +
      `border-right:1px solid ${THEME.rand};font-size:13px;line-height:1.5;`;
    reihe.appendChild(this.seitenleiste);

    this.mitte = document.createElement('div');
    this.mitte.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';
    reihe.appendChild(this.mitte);

    this.viewport = document.createElement('div');
    this.viewport.style.cssText = 'flex:1;position:relative;min-height:0;';
    this.mitte.appendChild(this.viewport);

    // ── Konsole (andockbar unten, Höhe ziehbar) ─────────────────────
    this.konsole = document.createElement('div');
    this.konsole.style.cssText =
      `flex:0 0 ${KONSOLE_STANDARD}px;display:flex;flex-direction:column;min-height:${KONSOLE_MIN}px;` +
      `background:rgba(8,10,15,0.96);border-top:1px solid ${THEME.rand};font-size:11px;`;
    const griff = document.createElement('div');
    griff.style.cssText = 'height:5px;cursor:ns-resize;background:transparent;flex:0 0 auto;';
    const kopf = document.createElement('div');
    kopf.style.cssText =
      `display:flex;align-items:center;gap:8px;padding:1px 8px;background:${THEME.flaeche};` +
      'flex:0 0 auto;user-select:none;';
    this.konsoleTitel = document.createElement('span');
    this.konsoleTitel.textContent = 'Server-Konsole (wov-server)';
    this.konsoleTitel.style.cssText = `color:${THEME.akzent};flex:1;`;
    const knopf = (text: string, tip: string, cb: () => void): HTMLSpanElement => {
      const k = document.createElement('span');
      k.textContent = text;
      k.title = tip;
      k.style.cssText = `cursor:pointer;color:${THEME.gedimmt};padding:0 4px;`;
      k.onclick = cb;
      return k;
    };
    kopf.append(
      this.konsoleTitel,
      knopf('▁', 'Minimieren', () => this.setzeKonsoleHoehe(KONSOLE_MIN)),
      knopf('◫', 'Standardhöhe', () => this.setzeKonsoleHoehe(KONSOLE_STANDARD)),
      knopf('⬒', 'Volle Höhe', () => this.setzeKonsoleHoehe(this.mitte.clientHeight))
    );
    this.konsoleLog = document.createElement('div');
    this.konsoleLog.style.cssText =
      `flex:1;overflow-y:auto;padding:2px 8px;font-family:ui-monospace,monospace;color:${THEME.ok};` +
      'white-space:pre-wrap;min-height:0;';
    this.konsole.append(griff, kopf, this.konsoleLog);
    this.mitte.appendChild(this.konsole);

    // Ziehen am Griff: Konsole stufenlos zwischen minimiert und voller
    // Editor-Höhe (der Viewport schrumpft mit, flex regelt den Rest).
    let ziehStart: { y: number; hoehe: number } | null = null;
    griff.addEventListener('pointerdown', (e) => {
      ziehStart = { y: e.clientY, hoehe: this.konsoleHoehe };
      griff.setPointerCapture(e.pointerId);
    });
    griff.addEventListener('pointermove', (e) => {
      if (!ziehStart) return;
      this.setzeKonsoleHoehe(ziehStart.hoehe + (ziehStart.y - e.clientY));
    });
    griff.addEventListener('pointerup', () => {
      ziehStart = null;
    });

    // ── Statusleiste ────────────────────────────────────────────────
    const status = document.createElement('div');
    status.style.cssText =
      `display:flex;justify-content:space-between;padding:2px 10px;background:${THEME.flaeche};` +
      `border-top:1px solid ${THEME.rand};font-size:12px;flex:0 0 auto;`;
    this.meldungEl = document.createElement('div');
    this.meldungEl.style.cssText = `color:${THEME.gedimmt};`;
    this.koordinatenEl = document.createElement('div');
    this.koordinatenEl.style.cssText = `color:${THEME.gedimmt};font-family:ui-monospace,monospace;`;
    status.append(this.meldungEl, this.koordinatenEl);
    wurzel.appendChild(status);

    window.addEventListener('resize', () => this.aufResize?.());
  }

  private setzeKonsoleHoehe(px: number): void {
    this.konsoleHoehe = Math.min(this.mitte.clientHeight, Math.max(KONSOLE_MIN, px));
    this.konsole.style.flex = `0 0 ${this.konsoleHoehe}px`;
    this.aufResize?.();
  }

  /** Werkzeugleisten-Gruppe (mit Trenner) — für Erweiterungen. */
  toolbarGruppe(): HTMLDivElement {
    if (this.toolbar.childElementCount > 1) {
      const trenner = document.createElement('div');
      trenner.style.cssText = `width:1px;align-self:stretch;background:${THEME.rand};`;
      this.toolbar.appendChild(trenner);
    }
    const gruppe = document.createElement('div');
    gruppe.style.cssText = 'display:flex;align-items:center;gap:6px;';
    this.toolbar.appendChild(gruppe);
    return gruppe;
  }

  /** Einklappbare Seitenleisten-Sektion — für Erweiterungen. */
  sektion(titel: string, offen = true): HTMLDivElement {
    const details = document.createElement('details');
    details.open = offen;
    details.style.cssText = `border-bottom:1px solid ${THEME.rand};`;
    const kopf = document.createElement('summary');
    kopf.textContent = titel;
    kopf.style.cssText =
      `padding:5px 12px;cursor:pointer;color:${THEME.akzent};font-size:12px;user-select:none;` +
      'list-style:none;';
    const inhalt = document.createElement('div');
    inhalt.style.cssText = 'padding:4px 12px 10px;';
    details.append(kopf, inhalt);
    this.seitenleiste.appendChild(details);
    return inhalt;
  }

  /** Meldung links in der Statusleiste (mit Standzeit, überlebt Mausbewegung). */
  meldung(text: string, fehler = false): void {
    this.meldungEl.textContent = text;
    this.meldungEl.style.color = fehler ? THEME.fehler : THEME.gedimmt;
    if (this.meldungTimer !== null) window.clearTimeout(this.meldungTimer);
    this.meldungTimer = window.setTimeout(() => {
      this.meldungEl.textContent = '';
    }, 6000);
  }

  /** Koordinatenanzeige rechts — unabhängig von Meldungen. */
  koordinaten(text: string): void {
    this.koordinatenEl.textContent = text;
  }

  /** Zeile in die Server-Konsole (Puffer 400, Auto-Scroll). */
  konsoleZeile(text: string): void {
    const zeile = document.createElement('div');
    zeile.textContent = text;
    if (/error|Error|FAIL/.test(text)) zeile.style.color = THEME.fehler;
    else if (/\[WoV\]|WorldLayout|Platzierungen/.test(text)) zeile.style.color = THEME.akzent;
    this.konsoleLog.appendChild(zeile);
    while (this.konsoleLog.childElementCount > 400) this.konsoleLog.firstElementChild?.remove();
    this.konsoleLog.scrollTop = this.konsoleLog.scrollHeight;
  }

  konsoleStatus(text: string): void {
    this.konsoleTitel.textContent = text;
  }
}
