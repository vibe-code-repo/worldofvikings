/**
 * Routen-Editor des 3D-Testflugs (Taste R) — NPC-Wegpunkte ZEICHNEN statt
 * Koordinatenpaare ins Layout-JSON zu tippen.
 *
 * Die Route selbst ist längst Schema (shared/worldlayout/types.ts,
 * `RouteDef`), der Server läuft sie ab (RoutenLaeufer.ts). Was fehlte, war
 * der Weg dorthin: Bisher musste man die Wegpunkte in Weltkoordinaten
 * kennen — im Testflug sieht man das Gelände, kann aber nicht darauf
 * zeigen.
 *
 * Bedienung (nur im Testflug `?offline=1&layout=editor`):
 *   R            öffnet/schließt dieses Panel (gibt die Maus frei)
 *   ✎-Knopf      schaltet den ZEICHEN-Modus der gewählten Route scharf;
 *                jeder Klick aufs Gelände hängt einen Wegpunkt an
 *   Klick nah    an einem Wegpunkt der gewählten Route: greifen + ziehen
 *   ↩ / 🗑       letzten Punkt zurücknehmen / ganze Route löschen
 *
 * Zwei bewusste Abgrenzungen:
 *   - Geschrieben wird in DENSELBEN localStorage-Entwurf wie die
 *     Platzierungen (`wov-editor-layout`), im Feld `routes` und exakt in
 *     dem Format, das `sanitizeWorldLayout` durchlässt (ID-Muster,
 *     [x,z]-Paare, mode, geklemmte speed). Jeder Schreibvorgang ist ein
 *     Lesen-Ändern-Schreiben des GANZEN Dokuments — fremde Felder
 *     (regions, placements …) bleiben unangetastet.
 *   - Zeichnen und Prefab-Platzieren schließen einander aus: main.ts
 *     beendet beim Start des Zeichnens den Platzier-Modus des SpawnPanels
 *     und umgekehrt. Sonst setzte ein Klick gleichzeitig einen Wegpunkt
 *     UND einen Baum.
 */
import type { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ROUTE_DEFAULT_SPEED, ROUTE_MAX_PAUSE, wegpunktPause } from '@wov/shared';

/** Derselbe Entwurf, den editor.html schreibt und der Testflug lädt. */
const ENTWURF_KEY = 'wov-editor-layout';

/**
 * ID-Muster der Sanitisierung (shared/worldlayout/sanitize.ts). Hier
 * bewusst DUPLIZIERT statt importiert: Die Konstante ist dort nicht
 * exportiert, und eine Route, die das Muster verletzt, wird beim Laden
 * STILL verworfen — der Editor muss sie also selbst abweisen, solange man
 * sie noch korrigieren kann.
 */
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/** Wie `sanitize.ts` klemmt: alles darüber wäre ein Teleport, nicht eine Route. */
const SPEED_MIN = 0.2;
const SPEED_MAX = 10;

/** Obergrenze der Sanitisierung je Route (MAX_POLYGON_POINTS). */
const MAX_PUNKTE = 512;

/**
 * Wegpunkt im Entwurf: `[x, z]` läuft durch, `[x, z, pause]` hält dort
 * `pause` Sekunden an — dieselbe Form wie `Wegpunkt` im Schema, nur
 * veränderlich (der Editor schreibt hinein).
 */
export type EntwurfsPunkt = [number, number] | [number, number, number];

/** Route im Entwurf — Feld-für-Feld das `RouteDef`-Schema. */
export interface EntwurfsRoute {
  id: string;
  points: EntwurfsPunkt[];
  mode: 'loop' | 'pingpong';
  speed: number;
}

interface EntwurfsPlatzierung {
  prefab: string;
  x: number;
  z: number;
  route?: string;
}

interface Entwurf {
  routes?: EntwurfsRoute[];
  placements?: EntwurfsPlatzierung[];
}

export interface RoutenEditorCallbacks {
  /** Geländehöhe — Marker und Linie sollen auf dem Boden liegen. */
  bodenHoehe: (x: number, z: number) => number;
  /** HUD-Meldung (hud.meldung). */
  meldung: (text: string) => void;
  /**
   * Index der zuletzt gegriffenen Platzierung im Entwurf, −1 = keine.
   * Das ist `auswahlIndex` aus main.ts — der Zuweis-Knopf arbeitet auf
   * genau der Platzierung, die der Nutzer eben angeklickt hat.
   */
  gewaehltePlatzierung: () => number;
  /**
   * Der Zeichen-Modus wird scharf: main.ts beendet daraufhin den
   * Platzier-Modus des SpawnPanels. Ohne diese Absprache setzte EIN Klick
   * gleichzeitig einen Wegpunkt und ein Prefab.
   */
  aufZeichenStart?: () => void;

  /**
   * „In die Welt speichern" — schreibt den Entwurf in die Serverdatei.
   *
   * Der Knopf gehoert hierher, weil hier gezeichnet wird: Bisher lag er
   * NUR im Karten-Editor (editor.html), und wer im Testflug eine Route zog,
   * sah seinen NPC nie laufen — der Server hatte den Entwurf nie gesehen.
   * Gemeldet als „wenn ich die Route zuweise, beginnt sie nicht zu laufen".
   */
  aufSpeichern?: () => void;

  /**
   * Umschalter „Vorschau an/aus" — ob die Routen-NPCs schon im Testflug
   * laufen (RoutenVorschau). Vorgabe AN: Der Regelfall ist „ich zeichne
   * und will sehen, was passiert". Ausschalten braucht, wer beim Bauen
   * Ruhe im Bild will oder eine Platzierung dort greifen möchte, wo sie
   * gespeichert ist.
   */
  aufVorschau?: (an: boolean) => void;
}

export class RoutenEditor {
  private readonly root: HTMLDivElement;
  private readonly liste: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly platzZeile: HTMLDivElement;
  private readonly idFeld: HTMLInputElement;
  private readonly modusWahl: HTMLSelectElement;
  private readonly tempoRegler: HTMLInputElement;
  private readonly tempoWert: HTMLSpanElement;
  private readonly zeichenKnopf: HTMLButtonElement;
  private readonly vorschauKnopf: HTMLButtonElement;
  private readonly punktListe: HTMLDivElement;
  private readonly pauseFeld: HTMLInputElement;

  /** ID der gerade bearbeiteten Route (null = keine gewählt). */
  private gewaehlt: string | null = null;
  /** Wegpunkt, dessen Pause das Feld bearbeitet (−1 = keiner). */
  private gewaehlterPunkt = -1;
  /** Hängt der nächste Geländeklick einen Wegpunkt an? */
  private zeichnet = false;
  /** Laufen die NPCs schon im Testflug? Vorgabe AN (s. aufVorschau). */
  private vorschau = true;

  /** Marker- und Linien-Meshes der aktuellen Darstellung. */
  private sicht: Mesh[] = [];
  private readonly matAktiv: StandardMaterial;
  private readonly matStart: StandardMaterial;
  private readonly matRuhend: StandardMaterial;
  private readonly matPause: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly cb: RoutenEditorCallbacks
  ) {
    // Leuchtfarben ohne Beleuchtung: Die Marker sollen auch im Schatten
    // und nachts lesbar sein — sie sind Werkzeug, nicht Weltinhalt.
    this.matAktiv = this.leuchtMaterial('routeAktiv', new Color3(0.95, 0.78, 0.25));
    this.matStart = this.leuchtMaterial('routeStart', new Color3(0.35, 0.95, 0.45));
    this.matRuhend = this.leuchtMaterial('routeRuhend', new Color3(0.35, 0.55, 0.85));
    // Haltepunkte in Rot und dicker: Beim Blick von oben soll man ohne
    // Klicken sehen, WO der NPC stehenbleibt — die Pause ist am Ergebnis
    // sonst nur an einem wartenden NPC zu erkennen.
    this.matPause = this.leuchtMaterial('routePause', new Color3(0.95, 0.35, 0.3));

    this.root = document.createElement('div');
    // Links, damit sich Routen- und Spawn-Panel (rechts) nicht überdecken —
    // beim Zuweisen sind beide gleichzeitig offen.
    this.root.style.cssText =
      'position:fixed;top:60px;left:12px;width:290px;max-height:80vh;overflow-y:auto;' +
      'background:rgba(18,22,31,0.94);border:1px solid #3a3325;border-radius:6px;padding:10px;' +
      'font-family:Georgia,serif;font-size:13px;color:#d8cfa8;z-index:900;display:none;';
    // Wie im SpawnPanel: Klicks und Rad gehören dem Panel, nicht dem Spiel
    // (die Spiel-Handler hängen auf window/document und liefen im Bubbling
    // sonst mit — ein Klick auf „Route löschen" setzte sonst zugleich einen
    // Wegpunkt). pointerup/mouseup bleiben frei, damit ein auf dem Canvas
    // begonnener Zieh-Vorgang sein window-pointerup noch bekommt.
    for (const typ of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
      this.root.addEventListener(typ, (e) => e.stopPropagation());
    }
    this.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    const titel = document.createElement('div');
    titel.textContent = '⤳ Routen-Editor';
    titel.style.cssText = 'font-size:15px;color:#e8d48a;margin-bottom:6px;';
    this.root.appendChild(titel);

    this.liste = document.createElement('div');
    this.liste.style.cssText =
      'max-height:150px;overflow-y:auto;overscroll-behavior:contain;' +
      'border:1px solid #3a3325;border-radius:4px;margin:4px 0;';
    this.root.appendChild(this.liste);

    this.root.appendChild(this.knopfZeile([this.knopf('+ Neue Route', () => this.neueRoute())]));
    this.root.appendChild(
      this.knopfZeile([this.knopf('💾 In die Welt speichern', () => this.cb.aufSpeichern?.())])
    );
    // Vorschau-Schalter oben, gleich unter dem Speichern-Knopf: Er gilt für
    // ALLE Routen, nicht für die gerade gewählte — er gehört deshalb nicht
    // in den Detailblock darunter.
    this.vorschauKnopf = this.knopf('▶ Vorschau: AN', () => this.vorschauUmschalten());
    this.root.appendChild(this.knopfZeile([this.vorschauKnopf]));

    // ── Gewählte Route ────────────────────────────────────────────────
    this.detail = document.createElement('div');
    this.detail.style.cssText = 'border-top:1px solid #3a3325;margin-top:8px;padding-top:6px;';
    this.root.appendChild(this.detail);

    this.detail.appendChild(this.label('Kennung (ID)'));
    this.idFeld = document.createElement('input');
    this.idFeld.style.cssText = this.feldStil();
    // Erst beim Verlassen/Enter umbenennen: Bei jedem Tastendruck wäre die
    // ID zwischendurch ungültig („route-" ohne Endziffer) oder doppelt.
    this.idFeld.onchange = () => this.umbenennen(this.idFeld.value);
    this.idFeld.onkeydown = (e) => {
      if (e.key === 'Enter') this.idFeld.blur();
    };
    this.detail.appendChild(this.idFeld);

    this.detail.appendChild(this.label('Modus'));
    this.modusWahl = document.createElement('select');
    this.modusWahl.style.cssText = this.feldStil();
    for (const [wert, text] of [
      ['loop', 'loop — im Kreis (letzter → erster)'],
      ['pingpong', 'pingpong — hin und zurück'],
    ] as const) {
      const o = document.createElement('option');
      o.value = wert;
      o.textContent = text;
      this.modusWahl.appendChild(o);
    }
    this.modusWahl.onchange = () => {
      this.aendereRoute((r) => {
        r.mode = this.modusWahl.value === 'pingpong' ? 'pingpong' : 'loop';
      });
    };
    this.detail.appendChild(this.modusWahl);

    this.detail.appendChild(this.label('Tempo (m/s)'));
    const tempoZeile = document.createElement('div');
    tempoZeile.style.cssText = 'display:flex;gap:6px;align-items:center;';
    this.tempoRegler = document.createElement('input');
    this.tempoRegler.type = 'range';
    this.tempoRegler.min = String(SPEED_MIN);
    this.tempoRegler.max = String(SPEED_MAX);
    this.tempoRegler.step = '0.1';
    this.tempoRegler.value = String(ROUTE_DEFAULT_SPEED);
    this.tempoRegler.style.cssText = 'flex:1;';
    this.tempoWert = document.createElement('span');
    this.tempoWert.textContent = String(ROUTE_DEFAULT_SPEED);
    this.tempoWert.style.cssText = 'width:32px;font-size:11px;';
    this.tempoRegler.oninput = () => {
      const v = Number(this.tempoRegler.value);
      this.tempoWert.textContent = v.toFixed(1);
      this.aendereRoute((r) => {
        r.speed = Math.round(v * 10) / 10;
      });
    };
    tempoZeile.append(this.tempoRegler, this.tempoWert);
    this.detail.appendChild(tempoZeile);

    // ── Wegpunkte mit ihren Pausen ───────────────────────────────────
    // Die Liste zeigt die Pausen MIT an („3 · 12/−4 · 5 s"): Wer wissen
    // will, wo sein NPC stehenbleibt, soll nicht jeden Punkt einzeln
    // anklicken müssen.
    this.detail.appendChild(this.label('Wegpunkte (Klick wählt)'));
    this.punktListe = document.createElement('div');
    this.punktListe.style.cssText =
      'max-height:110px;overflow-y:auto;overscroll-behavior:contain;' +
      'border:1px solid #3a3325;border-radius:4px;margin:2px 0;font-size:11px;';
    this.detail.appendChild(this.punktListe);

    this.detail.appendChild(this.label('Pause am gewählten Punkt (s)'));
    this.pauseFeld = document.createElement('input');
    this.pauseFeld.type = 'number';
    this.pauseFeld.min = '0';
    this.pauseFeld.max = String(ROUTE_MAX_PAUSE);
    this.pauseFeld.step = '0.5';
    this.pauseFeld.value = '0';
    this.pauseFeld.style.cssText = this.feldStil();
    // `change` statt `input`: Beim Tippen von „12" wäre der Zwischenstand
    // „1" schon eine gültige Pause und liefe in der Vorschau sofort los.
    this.pauseFeld.onchange = () => this.setzePause(Number(this.pauseFeld.value));
    this.pauseFeld.onkeydown = (e) => {
      if (e.key === 'Enter') this.pauseFeld.blur();
    };
    this.detail.appendChild(this.pauseFeld);

    this.zeichenKnopf = this.knopf('✎ Wegpunkte setzen', () => this.zeichnenUmschalten());
    this.detail.appendChild(this.knopfZeile([this.zeichenKnopf]));
    this.detail.appendChild(
      this.knopfZeile([
        this.knopf('↩ Punkt zurück', () => this.letztenPunktWeg()),
        this.knopf('🗑 Route löschen', () => this.routeLoeschen()),
      ])
    );

    // ── Zuweisung an eine Platzierung ────────────────────────────────
    const zuTitel = this.label('Platzierung → Route');
    zuTitel.style.borderTop = '1px solid #3a3325';
    zuTitel.style.paddingTop = '6px';
    this.root.appendChild(zuTitel);
    this.platzZeile = document.createElement('div');
    this.platzZeile.style.cssText = 'font-size:11px;color:#9a8f6a;margin-bottom:4px;';
    this.root.appendChild(this.platzZeile);
    this.root.appendChild(
      this.knopfZeile([
        this.knopf('→ zuweisen', () => this.zuweisen(true)),
        this.knopf('× lösen', () => this.zuweisen(false)),
      ])
    );

    const tip = document.createElement('div');
    tip.style.cssText = 'font-size:10px;color:#9a8f6a;margin-top:6px;';
    tip.textContent =
      'Zeichnen: Route wählen, ✎ drücken, dann aufs Gelände klicken — jeder Klick hängt ' +
      'einen Wegpunkt an (V = Baumodus gibt die Übersicht von oben). Ein Punkt der ' +
      'gewählten Route lässt sich anfassen und verschieben. Zuweisen: Platzierung im ' +
      'Spawn-Editor (B) anklicken, dann hier „→ zuweisen". Die NPCs laufen sofort mit ' +
      '(Vorschau); gegriffene Platzierungen halten an.';
    this.root.appendChild(tip);

    document.body.appendChild(this.root);
    this.aktualisiere();
  }

  // ── Bausteine (Stil wie SpawnPanel) ────────────────────────────────

  private leuchtMaterial(name: string, farbe: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.emissiveColor = farbe;
    m.disableLighting = true;
    return m;
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
      'flex:1;padding:6px;background:#1d2431;color:#d8cfa8;border:1px solid #3a3325;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;';
    b.onclick = () => {
      cb();
      // Fokus abgeben — ein fokussierter Knopf feuert sonst später auf
      // Enter/Leertaste erneut (Muster aus dem SpawnPanel).
      b.blur();
    };
    return b;
  }

  private knopfZeile(knoepfe: HTMLElement[]): HTMLDivElement {
    const z = document.createElement('div');
    z.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
    z.append(...knoepfe);
    return z;
  }

  // ── Entwurf lesen/schreiben ────────────────────────────────────────

  /**
   * Lesen-Ändern-Schreiben auf dem GANZEN Dokument: Der Entwurf gehört
   * auch den Regionen, Flüssen und Platzierungen — nur `routes` anfassen.
   */
  private lese(): Entwurf | null {
    try {
      const roh = JSON.parse(localStorage.getItem(ENTWURF_KEY) ?? 'null') as Entwurf | null;
      if (!roh || typeof roh !== 'object') return null;
      if (!Array.isArray(roh.routes)) roh.routes = [];
      return roh;
    } catch {
      return null;
    }
  }

  private schreibe(dok: Entwurf): void {
    // Leeres `routes` wieder entfernen: sanitize lässt das Feld ohnehin
    // weg, und ein leeres Array im Entwurf sähe nach „es gab mal Routen" aus.
    if (dok.routes && dok.routes.length === 0) delete dok.routes;
    localStorage.setItem(ENTWURF_KEY, JSON.stringify(dok));
  }

  /** Alle Routen des Entwurfs (leer, wenn es keinen Entwurf gibt). */
  private routen(): EntwurfsRoute[] {
    return this.lese()?.routes ?? [];
  }

  private aktuelle(): EntwurfsRoute | null {
    return this.routen().find((r) => r.id === this.gewaehlt) ?? null;
  }

  /** Gewählte Route im Entwurf ändern und speichern. */
  private aendereRoute(fn: (r: EntwurfsRoute) => void): void {
    const dok = this.lese();
    const route = dok?.routes?.find((r) => r.id === this.gewaehlt);
    if (!dok || !route) return;
    fn(route);
    this.schreibe(dok);
    this.aktualisiere();
  }

  // ── Routen anlegen/ändern ──────────────────────────────────────────

  /**
   * Vorgabe-ID nach dem Muster der Sanitisierung: `route-1`, `route-2`, …
   * Kleinbuchstaben und Ziffern, erstes Zeichen alphanumerisch — genau
   * das, was ID_RE verlangt.
   */
  private freieId(): string {
    const belegt = new Set(this.routen().map((r) => r.id));
    for (let i = 1; i <= 999; i++) {
      const kandidat = `route-${i}`;
      if (!belegt.has(kandidat)) return kandidat;
    }
    return `route-${Date.now()}`;
  }

  private neueRoute(): void {
    const dok = this.lese();
    if (!dok) {
      this.cb.meldung('Kein Editor-Entwurf geladen — Routen brauchen ein Layout');
      return;
    }
    const route: EntwurfsRoute = {
      id: this.freieId(),
      points: [],
      mode: 'loop',
      speed: ROUTE_DEFAULT_SPEED,
    };
    dok.routes = [...(dok.routes ?? []), route];
    this.schreibe(dok);
    this.gewaehlt = route.id;
    // Direkt scharf: Wer „Neue Route" drückt, will Punkte setzen.
    this.zeichnet = true;
    this.cb.aufZeichenStart?.();
    this.aktualisiere();
    this.cb.meldung(`Route ${route.id} angelegt — jetzt Wegpunkte ins Gelände klicken`);
  }

  private umbenennen(eingabe: string): void {
    const route = this.aktuelle();
    if (!route) return;
    const neu = eingabe.trim().toLowerCase();
    if (neu === route.id) return;
    if (!ID_RE.test(neu)) {
      // Nicht stillschweigend zurechtbiegen: Eine automatisch reparierte ID
      // wäre eine andere als die getippte, und Zuweisungen zeigten ins Leere.
      this.cb.meldung('Ungültige Kennung — erlaubt sind a–z, 0–9, - und _ (Anfang alphanumerisch)');
      this.aktualisiere();
      return;
    }
    const dok = this.lese();
    if (!dok?.routes) return;
    if (dok.routes.some((r) => r.id === neu)) {
      this.cb.meldung(`Kennung ${neu} ist schon vergeben`);
      this.aktualisiere();
      return;
    }
    const alt = route.id;
    const ziel = dok.routes.find((r) => r.id === alt);
    if (!ziel) return;
    ziel.id = neu;
    // Zuweisungen mitziehen — sonst zeigte jede Platzierung nach dem
    // Umbenennen auf eine Route, die es nicht mehr gibt (der Server
    // ignoriert das still, der NPC bliebe einfach stehen).
    for (const p of dok.placements ?? []) {
      if (p.route === alt) p.route = neu;
    }
    this.schreibe(dok);
    this.gewaehlt = neu;
    this.aktualisiere();
    this.cb.meldung(`Route ${alt} heißt jetzt ${neu}`);
  }

  private routeLoeschen(): void {
    const route = this.aktuelle();
    const dok = this.lese();
    if (!route || !dok?.routes) return;
    dok.routes = dok.routes.filter((r) => r.id !== route.id);
    // Verwaiste Verweise gleich mit aufräumen: Ein NPC ohne Route bleibt
    // stehen — besser als ein Verweis auf eine gelöschte Kennung.
    for (const p of dok.placements ?? []) {
      if (p.route === route.id) delete p.route;
    }
    this.schreibe(dok);
    this.gewaehlt = null;
    this.zeichnet = false;
    this.aktualisiere();
    this.cb.meldung(`Route ${route.id} gelöscht`);
  }

  private letztenPunktWeg(): void {
    const route = this.aktuelle();
    if (!route || route.points.length === 0) return;
    this.aendereRoute((r) => {
      r.points = r.points.slice(0, -1);
    });
    this.cb.meldung(`Wegpunkt zurückgenommen (${route.points.length - 1} übrig)`);
  }

  private zeichnenUmschalten(): void {
    if (!this.aktuelle()) {
      this.cb.meldung('Erst eine Route wählen oder anlegen');
      return;
    }
    this.zeichnet = !this.zeichnet;
    if (this.zeichnet) this.cb.aufZeichenStart?.();
    this.aktualisiere();
    this.cb.meldung(
      this.zeichnet
        ? 'Wegpunkte setzen AN — Klick ins Gelände hängt an, ✎ oder Esc beendet'
        : 'Wegpunkte setzen AUS'
    );
  }

  /**
   * Pause des gewählten Wegpunkts setzen. 0 löscht das dritte Element
   * wieder — ein `[x, z, 0]` im Dokument wäre Rauschen, und die
   * Sanitisierung schriebe es ohnehin als `[x, z]` zurück.
   */
  private setzePause(sekunden: number): void {
    const route = this.aktuelle();
    const i = this.gewaehlterPunkt;
    if (!route || i < 0 || !route.points[i]) {
      this.cb.meldung('Erst einen Wegpunkt in der Liste wählen');
      this.aktualisiere();
      return;
    }
    const wert = Number.isFinite(sekunden)
      ? Math.min(ROUTE_MAX_PAUSE, Math.max(0, Math.round(sekunden * 10) / 10))
      : 0;
    this.aendereRoute((r) => {
      const p = r.points[i];
      if (!p) return;
      r.points[i] = wert > 0 ? [p[0], p[1], wert] : [p[0], p[1]];
    });
    this.cb.meldung(
      wert > 0
        ? `Wegpunkt ${i + 1}: Pause ${wert} s`
        : `Wegpunkt ${i + 1}: keine Pause — der NPC läuft durch`
    );
  }

  private vorschauUmschalten(): void {
    this.vorschau = !this.vorschau;
    this.cb.aufVorschau?.(this.vorschau);
    this.aktualisiere();
  }

  private zuweisen(setzen: boolean): void {
    const index = this.cb.gewaehltePlatzierung();
    const dok = this.lese();
    const platz = dok?.placements?.[index];
    if (!dok || index < 0 || !platz) {
      this.cb.meldung('Keine Platzierung gewählt — im Spawn-Editor (B) eine anklicken');
      return;
    }
    if (setzen) {
      const route = this.aktuelle();
      if (!route) {
        this.cb.meldung('Erst eine Route in der Liste wählen');
        return;
      }
      platz.route = route.id;
      this.schreibe(dok);
      this.cb.meldung(`${platz.prefab} läuft jetzt ${route.id}`);
    } else {
      if (platz.route === undefined) {
        this.cb.meldung(`${platz.prefab} hat keine Route`);
        return;
      }
      delete platz.route;
      this.schreibe(dok);
      this.cb.meldung(`${platz.prefab} steht wieder still`);
    }
    this.aktualisiere();
  }

  // ── Von main.ts gerufene Schnittstelle ─────────────────────────────

  get istOffen(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Hängt der nächste Geländeklick einen Wegpunkt an? */
  get istZeichenModus(): boolean {
    return this.zeichnet && this.istOffen && this.aktuelle() !== null;
  }

  toggle(): boolean {
    const sichtbar = this.root.style.display === 'none';
    this.root.style.display = sichtbar ? 'block' : 'none';
    if (!sichtbar) this.zeichnet = false;
    this.aktualisiere();
    return sichtbar;
  }

  /** Zeichnen beenden (Esc, Rechtsklick, Start einer Prefab-Platzierung). */
  beendeZeichnen(): void {
    if (!this.zeichnet) return;
    this.zeichnet = false;
    this.aktualisiere();
  }

  /** Wegpunkt anhängen (Klick aufs Gelände im Zeichen-Modus). */
  punktSetzen(x: number, z: number): void {
    const route = this.aktuelle();
    if (!route) return;
    if (route.points.length >= MAX_PUNKTE) {
      this.cb.meldung(`Route voll — ${MAX_PUNKTE} Wegpunkte sind das Maximum`);
      return;
    }
    // Dezimeter-Raster wie bei den Platzierungen; die Sanitisierung rundet
    // ohnehin auf Millimeter, der Wert kommt also unverändert durch.
    const punkt: EntwurfsPunkt = [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
    this.aendereRoute((r) => {
      r.points = [...r.points, punkt];
    });
    // Der frisch gesetzte Punkt ist der gewählte: Wer eine Pause eintragen
    // will, meint fast immer den, den er eben geklickt hat.
    this.gewaehlterPunkt = route.points.length;
    this.aktualisiere();
    this.cb.meldung(
      `Wegpunkt ${route.points.length + 1} @ (${punkt[0]}, ${punkt[1]}) — ${route.id}`
    );
  }

  /**
   * Index des Wegpunkts der GEWÄHLTEN Route in Griffweite, sonst −1.
   * Nur die gewählte Route ist anfassbar: Sonst zöge man beim Nachbessern
   * ständig an einer fremden Runde, die zufällig darunter liegt.
   *
   * Ein Treffer wählt den Punkt zugleich aus (Pausenfeld): Diese Abfrage
   * IST der Griff des Nutzers — main.ts ruft sie nur aus dem pointerdown.
   */
  punktUnter(x: number, z: number, radius = 3): number {
    const route = this.aktuelle();
    if (!route || this.zeichnet) return -1;
    let best = -1;
    let bestD = radius;
    route.points.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[1] - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && best !== this.gewaehlterPunkt) {
      this.gewaehlterPunkt = best;
      this.aktualisiere();
    }
    return best;
  }

  /** Gegriffenen Wegpunkt verschieben (pointermove). */
  punktVerschieben(index: number, x: number, z: number): void {
    this.aendereRoute((r) => {
      const alt = r.points[index];
      if (!alt) return;
      const nx = Math.round(x * 10) / 10;
      const nz = Math.round(z * 10) / 10;
      // Die Pause bleibt am Punkt: Verschieben ist ein ORTSwechsel, kein
      // neuer Wegpunkt — sonst verlöre jedes Nachbessern die Wartezeit.
      const pause = wegpunktPause(alt);
      r.points[index] = pause > 0 ? [nx, nz, pause] : [nx, nz];
    });
  }

  /** Kennung der gewählten Route (für Meldungen in main.ts). */
  get gewaehlteId(): string | null {
    return this.gewaehlt;
  }

  // ── Anzeige ────────────────────────────────────────────────────────

  /** Liste, Detailfelder und die 3D-Darstellung an den Entwurf angleichen. */
  aktualisiere(): void {
    const routen = this.routen();
    if (this.gewaehlt && !routen.some((r) => r.id === this.gewaehlt)) this.gewaehlt = null;

    this.liste.innerHTML = '';
    if (routen.length === 0) {
      const leer = document.createElement('div');
      leer.textContent = 'noch keine Route';
      leer.style.cssText = 'padding:4px 6px;color:#9a8f6a;';
      this.liste.appendChild(leer);
    }
    for (const r of routen) {
      const zeile = document.createElement('div');
      zeile.textContent = `${r.id} — ${r.points.length} Pkt, ${r.mode}, ${r.speed.toFixed(1)} m/s`;
      const aktiv = r.id === this.gewaehlt;
      zeile.style.cssText =
        'padding:2px 6px;cursor:pointer;font-size:12px;' +
        (aktiv ? 'background:#243044;color:#e8d48a;' : '');
      zeile.onclick = () => {
        // Routenwechsel beendet das Zeichnen: Sonst hingen die nächsten
        // Klicks an einer Route, die man nur ansehen wollte.
        if (this.gewaehlt !== r.id) this.zeichnet = false;
        this.gewaehlt = r.id;
        this.aktualisiere();
      };
      this.liste.appendChild(zeile);
    }

    const route = this.aktuelle();
    if (!route || this.gewaehlterPunkt >= route.points.length) this.gewaehlterPunkt = -1;
    this.detail.style.opacity = route ? '1' : '0.45';
    this.idFeld.value = route?.id ?? '';
    this.idFeld.disabled = !route;
    this.modusWahl.value = route?.mode ?? 'loop';
    this.modusWahl.disabled = !route;
    this.tempoRegler.value = String(route?.speed ?? ROUTE_DEFAULT_SPEED);
    this.tempoRegler.disabled = !route;
    this.tempoWert.textContent = (route?.speed ?? ROUTE_DEFAULT_SPEED).toFixed(1);
    this.zeichenKnopf.textContent = this.zeichnet ? '✎ Wegpunkte setzen: AN' : '✎ Wegpunkte setzen';
    this.zeichenKnopf.style.background = this.zeichnet ? '#3a4a2a' : '#1d2431';
    this.vorschauKnopf.textContent = this.vorschau ? '▶ Vorschau: AN' : '⏸ Vorschau: AUS';
    this.vorschauKnopf.style.background = this.vorschau ? '#3a4a2a' : '#1d2431';

    this.punktListe.innerHTML = '';
    if (route && route.points.length === 0) {
      const leer = document.createElement('div');
      leer.textContent = 'noch kein Wegpunkt';
      leer.style.cssText = 'padding:3px 6px;color:#9a8f6a;';
      this.punktListe.appendChild(leer);
    }
    (route?.points ?? []).forEach((p, i) => {
      const pause = wegpunktPause(p);
      const zeile = document.createElement('div');
      zeile.textContent = `${i + 1} · ${p[0]}/${p[1]}` + (pause > 0 ? ` · ${pause} s` : '');
      const gewaehlt = i === this.gewaehlterPunkt;
      zeile.style.cssText =
        'padding:2px 6px;cursor:pointer;' +
        (pause > 0 ? 'color:#e8917a;' : '') +
        (gewaehlt ? 'background:#243044;' : '');
      zeile.onclick = () => {
        this.gewaehlterPunkt = i;
        this.aktualisiere();
      };
      this.punktListe.appendChild(zeile);
    });
    const gewaehltPunkt = route?.points[this.gewaehlterPunkt];
    this.pauseFeld.disabled = !gewaehltPunkt;
    this.pauseFeld.value = String(gewaehltPunkt ? wegpunktPause(gewaehltPunkt) : 0);

    const index = this.cb.gewaehltePlatzierung();
    const platz = this.lese()?.placements?.[index];
    this.platzZeile.textContent =
      index >= 0 && platz
        ? `gewählt: ${platz.prefab} #${index} — Route: ${platz.route ?? 'keine'}`
        : 'keine Platzierung gewählt (im Spawn-Editor eine anklicken)';

    this.zeichneSicht(routen);
  }

  /**
   * Marker und Linien neu bauen.
   *
   * Bewusst „alles wegwerfen und neu": Eine Route hat Dutzende Punkte und
   * ändert sich nur auf Klick — inkrementelles Nachführen wäre mehr Code
   * als Nutzen. Sichtbar ist die Darstellung nur bei offenem Panel; sonst
   * stünden goldene Pfosten in jedem Screenshot des Testflugs.
   */
  private zeichneSicht(routen: EntwurfsRoute[]): void {
    for (const m of this.sicht) m.dispose();
    this.sicht = [];
    if (!this.istOffen) return;

    for (const route of routen) {
      const aktiv = route.id === this.gewaehlt;
      route.points.forEach((punkt, i) => {
        const [x, z] = punkt;
        const pause = wegpunktPause(punkt);
        // Pfosten statt Kugel: von oben (Baumodus, bis 120 m) ist der
        // Kreis zu sehen, von unten die Stange — beides ohne Zusatzmesh.
        // Haltepunkte sind dicker und höher, damit sie sich schon aus der
        // Übersicht von Durchlaufpunkten unterscheiden.
        const marker = MeshBuilder.CreateCylinder(
          `routePunkt-${route.id}-${i}`,
          {
            diameter: (aktiv ? 2 : 1.4) * (pause > 0 ? 1.6 : 1),
            height: pause > 0 ? 3.6 : 2.4,
            tessellation: 12,
          },
          this.scene
        );
        marker.position.set(x, this.cb.bodenHoehe(x, z) + (pause > 0 ? 1.8 : 1.2), z);
        marker.material =
          pause > 0 ? this.matPause : i === 0 ? this.matStart : aktiv ? this.matAktiv : this.matRuhend;
        marker.isPickable = false;
        this.sicht.push(marker);
      });

      const bahn = this.bahnPunkte(route);
      if (bahn.length >= 2) {
        const linie = MeshBuilder.CreateLines(`routeLinie-${route.id}`, { points: bahn }, this.scene);
        // LinesMesh ist immer einen Pixel breit — genau richtig für die
        // Übersicht aus 120 m, wo eine echte Bandbreite verschwände.
        linie.color = aktiv ? new Color3(0.95, 0.78, 0.25) : new Color3(0.35, 0.55, 0.85);
        linie.isPickable = false;
        this.sicht.push(linie);
      }
    }
  }

  /**
   * Stützpunkte der Linie: jeder Abschnitt wird alle paar Meter abgetastet
   * und auf die Geländehöhe gesetzt — eine gerade Verbindung zwischen zwei
   * Wegpunkten verschwände über jeder Kuppe im Boden.
   */
  private bahnPunkte(route: EntwurfsRoute): Vector3[] {
    const punkte = route.points;
    if (punkte.length < 2) return [];
    // loop schließt den Kreis, pingpong endet am letzten Punkt (der NPC
    // läuft dieselbe Strecke zurück — eine zweite Linie zeigte nichts Neues).
    const kette = route.mode === 'loop' ? [...punkte, punkte[0]!] : punkte;
    const SCHRITT = 4;
    const HOEHE = 0.6; // Abstand über Grund, sonst frisst ihn die Kachel
    const out: Vector3[] = [];
    for (let i = 0; i < kette.length - 1; i++) {
      const [ax, az] = kette[i]!;
      const [bx, bz] = kette[i + 1]!;
      const laenge = Math.hypot(bx - ax, bz - az);
      const stufen = Math.max(1, Math.ceil(laenge / SCHRITT));
      for (let s = 0; s < stufen; s++) {
        const t = s / stufen;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        out.push(new Vector3(x, this.cb.bodenHoehe(x, z) + HOEHE, z));
      }
    }
    const [ex, ez] = kette[kette.length - 1]!;
    out.push(new Vector3(ex, this.cb.bodenHoehe(ex, ez) + HOEHE, ez));
    return out;
  }
}
