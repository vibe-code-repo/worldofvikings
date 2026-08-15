/**
 * Phase 1 — minimal DOM overlay (FPS, position, time). Replaced by Babylon
 * GUI in Phase 5 (Docs/03-Rendering-und-Engine.md).
 */
/** Fadenkreuz im Normalzustand — `s_whiteHalfAlpha` des Originals. */
const FK_NORMAL = 'rgba(255,255,255,.5)';
/** Fadenkreuz auf einem Ziel — `Color.yellow`, also voll deckend. */
const FK_ZIEL = 'rgba(255,255,0,1)';

export class Hud {
  private readonly el: HTMLDivElement;
  private readonly fadenkreuz: HTMLDivElement;
  /** Ob das Fadenkreuz gerade auf einem Objekt steht (Gelbfärbung). */
  private aufZiel = false;
  private acc = 0;

  constructor() {
    this.fadenkreuz = this.baueFadenkreuz();
    this.el = document.createElement('div');
    // Diagnosetext nach UNTEN RECHTS.
    //
    // Er stand bis hierher oben links und damit genau dort, wo in jedem
    // Spiel die eigenen Werte stehen — die Ecke, auf die der Blick im
    // Kampf zuerst fällt. Die gehört jetzt den Lebens- und
    // Ausdauerbalken (s. setVitals); der Text ist Werkzeug, kein Spiel und
    // zieht sich in die Ecke zurück, die sonst leer bleibt.
    //
    // Unten rechts ist die einzige freie: oben rechts sitzt die Minimap,
    // unten mittig die Hotbar, oben mittig Pointer-Lock-Hinweis und
    // Bildschirmmeldung. `text-align:right` wäre falsch — der Text ist
    // eine Tabelle aus Zeilen unterschiedlicher Länge, und rechtsbündig
    // gesetzt fransen ihre Anfänge aus.
    //
    // Die 76 px Abstand nach unten sind gemessen, nicht geschätzt: Die
    // Hotbar ist 52 px hoch und sitzt 16 px über dem Rand. Mit den 8 px
    // dieses Randes stiess der Kasten bei 1280 px Breite 107 px weit in
    // sie hinein, und weil die Hotbar auf z-index 900 liegt, verschwanden
    // die untersten Diagnosezeilen dahinter. Der Kasten wächst nach OBEN,
    // die Unterkante bleibt deshalb frei — bei jeder Fensterbreite.
    this.el.style.cssText =
      'position:fixed;bottom:76px;right:8px;color:#fff;font:12px monospace;' +
      'background:rgba(0,0,0,.45);padding:6px 10px;border-radius:4px;white-space:pre;' +
      'text-align:left;pointer-events:none;z-index:4';
    document.body.appendChild(this.el);

    const hint = document.createElement('div');
    // F9 nur nennen, wenn es die Taste auch gibt: Der Babylon-Inspector
    // steckt seit dem Bundle-Schnitt nur noch im Dev-Server (main.ts, F9).
    hint.textContent =
      'Klicken für Maussteuerung — WASD laufen, Shift rennen' +
      (import.meta.env.DEV ? ', F9 Inspector' : '');
    hint.style.cssText =
      'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);color:#ddd;' +
      'font:13px sans-serif;background:rgba(0,0,0,.45);padding:6px 12px;border-radius:4px;pointer-events:none';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 12000);
  }

  /**
   * Fadenkreuz in der Bildmitte — die Richtung, in die die Figur losläuft.
   *
   * Aussehen nach dem Original: `Hud.UpdateCrosshair` färbt das Fadenkreuz
   * mit `s_whiteHalfAlpha`, also Weiss bei halber Deckkraft, und schaltet
   * auf Gelb, sobald etwas Anvisiertes einen Namen hat. Die Gelbfärbung
   * fehlt hier noch; sie bräuchte die Anbindung an ObjectLabels.
   *
   * Sichtbar nur bei gefangener Maus. Ohne Pointer-Lock steht ein echter
   * Mauszeiger im Bild, und zwei konkurrierende Zeiger verwirren mehr, als
   * das Fadenkreuz nützt. Weil Menüs (Inventar, Karte, Einstellungen) den
   * Lock ohnehin lösen, blendet sich das Fadenkreuz dort von selbst aus —
   * dasselbe Verhalten wie im Original, nur ohne eigene Verdrahtung.
   */
  private baueFadenkreuz(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;' +
      `border-radius:50%;background:${FK_NORMAL};` +
      // Dunkler Saum, damit der Punkt auch vor hellem Himmel oder Schnee
      // stehenbleibt — ohne ihn verschwindet er dort völlig.
      'box-shadow:0 0 0 1px rgba(0,0,0,.45);' +
      'pointer-events:none;display:none;z-index:5';
    document.body.appendChild(el);
    const zeige = () => {
      el.style.display = document.pointerLockElement ? 'block' : 'none';
    };
    document.addEventListener('pointerlockchange', zeige);
    zeige();
    return el;
  }

  /**
   * Fadenkreuz einfärben: gelb, sobald etwas anvisiert ist.
   *
   * Genau die Regel des Originals — dort hängt sie am Namen des
   * anvisierten Objekts, hier am Prefabnamen (siehe Anvisiert.ts). Die
   * Prüfung auf Änderung spart das Schreiben ins DOM in jedem Frame.
   */
  setAnvisiert(ziel: string | null): void {
    const auf = ziel !== null;
    if (auf === this.aufZiel) return;
    this.aufZiel = auf;
    this.fadenkreuz.style.background = auf ? FK_ZIEL : FK_NORMAL;
  }

  private healthEl: HTMLDivElement | null = null;
  private staminaEl: HTMLDivElement | null = null;

  /**
   * Lebens- und Ausdauerbalken der eigenen Figur — OBEN LINKS.
   *
   * Beide Werte kommen fertig vom Server (PacketType.PlayerState, Leben
   * bereits als Prozent von `maxHealth`, das der Essens-Buff anhebt).
   * Dieselbe Zahl geht an das eigene Namensschild über dem Kopf; es gibt
   * bewusst nur diese eine Quelle.
   *
   * Leben liegt ÜBER Ausdauer, nicht darunter: Gelesen wird von oben nach
   * unten, und die Frage „lebe ich noch" kommt vor „kann ich noch
   * rennen". Der Ausdauerbalken bleibt daneben stehen, weil er nur
   * zusammen mit dem Lebensbalken etwas aussagt — wer beide trennt,
   * schaut im Kampf in zwei Ecken.
   */
  setVitals(health: number, stamina = 100): void {
    if (!this.healthEl) {
      const balken = (top: string, farbe: string): HTMLDivElement => {
        const rahmen = document.createElement('div');
        rahmen.style.cssText =
          `position:fixed;top:${top};left:14px;width:190px;height:14px;` +
          'background:rgba(0,0,0,.55);border:1px solid #8a6a34;border-radius:4px;pointer-events:none;z-index:4';
        const el = document.createElement('div');
        el.style.cssText =
          `height:100%;width:100%;background:${farbe};border-radius:3px;transition:width .2s`;
        rahmen.appendChild(el);
        document.body.appendChild(rahmen);
        return el;
      };
      this.healthEl = balken('14px', 'linear-gradient(180deg,#c33,#801515)');
      this.staminaEl = balken('32px', 'linear-gradient(180deg,#e6c860,#8a6a1a)');
    }
    this.healthEl.style.width = `${Math.max(0, Math.min(100, health))}%`;
    if (this.staminaEl) this.staminaEl.style.width = `${Math.max(0, Math.min(100, stamina))}%`;
  }

  private meldungEl: HTMLDivElement | null = null;
  private meldungTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Kurzlebige Bildschirmmeldung (Serverantworten wie "Dungeon betreten",
   * Valheims MessageHud.TopLeft-Äquivalent). Ersetzt eine noch stehende
   * Meldung statt zu stapeln.
   */
  meldung(text: string): void {
    if (!this.meldungEl) {
      this.meldungEl = document.createElement('div');
      this.meldungEl.style.cssText =
        'position:fixed;top:48px;left:50%;transform:translateX(-50%);color:#ffe9b0;' +
        'font:15px sans-serif;background:rgba(0,0,0,.55);padding:6px 14px;' +
        'border-radius:4px;pointer-events:none;z-index:6';
      document.body.appendChild(this.meldungEl);
    }
    this.meldungEl.textContent = text;
    this.meldungEl.style.display = 'block';
    if (this.meldungTimer) clearTimeout(this.meldungTimer);
    this.meldungTimer = setTimeout(() => {
      if (this.meldungEl) this.meldungEl.style.display = 'none';
    }, 4000);
  }

  update(dt: number, fps: number, text: string): void {
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.el.textContent = `${fps.toFixed(0)} fps\n${text}`;
  }
}
