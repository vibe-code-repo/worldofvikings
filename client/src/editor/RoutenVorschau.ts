/**
 * RoutenVorschau — NPCs laufen ihre Route schon IM TESTFLUG ab.
 *
 * ── Warum es das gibt ────────────────────────────────────────────────
 * Gelaufen wird sonst nur auf dem Server (world/RoutenLaeufer.ts). Wer im
 * Testflug (`?offline=1&layout=editor`) eine Route zeichnete, sah also
 * nichts: erst Speichern, dann Server neu starten, dann online nachsehen.
 * Gestaltet wird aber im Testflug — dort muss auch das Ergebnis zu sehen
 * sein. Gemeldet als „wenn ich die Route zuweise, beginnt sie nicht zu
 * laufen".
 *
 * ── Warum die Mathematik nicht hier steht ────────────────────────────
 * Der Fortschritt entlang der Wegpunkte kommt aus `RoutenLauf`
 * (shared/worldlayout/routenlauf.ts) — exakt derselbe Code, den der
 * Server benutzt. Eine Vorschau, die anders rechnet als der Server, wäre
 * schlimmer als keine: Man gestaltete nach einem Bild, das die fertige
 * Welt nie zeigt. Hier bleibt nur das Client-Drumherum: Entwurf lesen,
 * Höhe aus dem Gelände, Instanz in der Szene nachführen, Gangart
 * umschalten.
 *
 * ── Grenzen (bewusst) ────────────────────────────────────────────────
 * - NUR im Editor-Testflug: main.ts legt diese Klasse ausschließlich im
 *   `?offline=1&layout=editor`-Zweig an. Online ist der Server zuständig,
 *   im normalen Offline-Spiel gibt es gar keine Platzierungen aus einem
 *   Entwurf.
 * - Die Vorschau schreibt NIE in den Entwurf zurück. Die gespeicherte
 *   Position einer Platzierung ist und bleibt ihr Startpunkt — sonst
 *   wanderte die Welt beim bloßen Zusehen davon.
 */

import { RoutenLauf, aggroSchritt, istNpcPrefab, type RouteDef } from '@wov/shared';

/** Derselbe Entwurf, den editor.html schreibt und der Testflug lädt. */
const ENTWURF_KEY = 'wov-editor-layout';

/**
 * Wie oft der Entwurf auf Änderungen abgeklopft wird (s). Der Editor
 * schreibt bei JEDER Mausbewegung eines Wegpunkts nach localStorage; ein
 * Abgleich je Frame wäre reine Verschwendung, 5 Hz ist schneller als
 * jedes Auge und billig genug (Vergleich des rohen JSON-Strings).
 */
const ABGLEICH_INTERVALL = 0.2;

interface EntwurfsPlatzierung {
  prefab: string;
  x: number;
  z: number;
  yaw?: number;
  scale?: number;
  route?: string;
}

interface Entwurf {
  placements?: EntwurfsPlatzierung[];
  routes?: RouteDef[];
}

/** Ein laufender NPC der Vorschau. */
interface Laeufer {
  lauf: RoutenLauf;
  /** Aktuelle Vorschau-Position (NICHT die des Entwurfs). */
  x: number;
  z: number;
  yaw: number;
  /** Zuletzt gezeichnete Gangart — Wechsel nur bei Änderung. */
  gangart: 'idle' | 'walk' | 'attack';
  /** Zur Wiedererkennung beim Abgleich. */
  prefab: string;
  routeId: string;
}

export interface RoutenVorschauCallbacks {
  /**
   * Platzierung `i` in der Szene setzen. main.ts leitet das an dieselbe
   * `zeige()` weiter, die auch statische Platzierungen zeichnet — gleicher
   * ZDO-Schlüssel `edplace-<i>`, also Nachführen statt Duplikat.
   */
  zeichne: (
    index: number,
    p: EntwurfsPlatzierung,
    x: number,
    z: number,
    yaw: number,
    anim: 'idle' | 'walk' | 'attack'
  ) => void;
  /**
   * Index der gerade GEGRIFFENEN Platzierung (−1 = keine).
   *
   * Regel: Was am Mauszeiger hängt, läuft nicht. Wer eine Platzierung
   * greift und zieht, will sie am Zeiger sehen und nicht gleichzeitig
   * weglaufen — sonst zöge man an einem Objekt, das sich unter der Hand
   * fortbewegt. Der Griff ist zugleich der Moment, in dem der Entwurf die
   * Wahrheit über die Position hält: Beim Loslassen steigt die Vorschau
   * an der neuen Stelle wieder ein.
   */
  gegriffen: () => number;
  /**
   * Wo der Spieler im Testflug steht (null = noch keine Welt).
   *
   * Nötig, weil Aggro etwas ist, das ZWISCHEN NPC und Spieler entsteht:
   * Ohne Gegenüber gibt es nichts zu entscheiden. Online liefert das der
   * Server aus den Peer-Positionen, hier ist es schlicht die Kamera.
   */
  spieler?: () => { x: number; z: number } | null;
  /** HUD-Meldung (nur beim Umschalten). */
  meldung?: (text: string) => void;
}

export class RoutenVorschau {
  /** Läufer je Platzierungs-Index. */
  private readonly laeufer = new Map<number, Laeufer>();
  /** Roher Entwurfs-Text des letzten Abgleichs — Änderungserkennung. */
  private letzterText = '';
  /**
   * Der Entwurf des letzten Abgleichs, schon geparst. Zwischen zwei
   * Abgleichen zeichnet die Vorschau damit ein stabiles Bild, und der
   * Parse-Aufwand fällt nur beim Abgleich an — nicht je NPC und Frame.
   */
  private entwurf: Entwurf | null = null;
  private seitAbgleich = ABGLEICH_INTERVALL;
  private an = true;
  /** Griff des letzten Frames — für die Erkennung von „losgelassen". */
  private letzterGriff = -1;
  /**
   * Stehende (routenlose) NPCs, die gerade jemanden ansehen.
   *
   * Gebraucht wird das nur für den ÜBERGANG zurück: Solange Aggro
   * anliegt, zeichnet die Vorschau sie ohnehin jeden Frame. Läuft der
   * Spieler weg, muss die Figur EINMAL auf ihren gespeicherten Winkel und
   * `idle` zurückgesetzt werden — sonst bliebe sie für immer in der
   * Schlagbewegung stehen, obwohl niemand mehr da ist.
   */
  private stehendeAggro = new Map<number, { x: number; z: number }>();

  constructor(private readonly cb: RoutenVorschauCallbacks) {}

  get istAn(): boolean {
    return this.an;
  }

  /**
   * Vorschau an/aus (Knopf im Routen-Panel, Vorgabe AN).
   *
   * Beim Ausschalten kehren alle NPCs auf ihren GESPEICHERTEN Platz
   * zurück: Genau dort stehen sie im Entwurf, genau dort setzt der Server
   * sie beim nächsten Start hin — „AUS" zeigt also die Welt so, wie sie
   * gespeichert ist. Ein Haufen NPCs, die irgendwo auf halber Strecke
   * einfrieren, zeigte gar nichts.
   */
  setzeAn(an: boolean): void {
    if (an === this.an) return;
    this.an = an;
    if (!an) this.zurueckAufStart();
    else this.erzwingeAbgleich(); // beim Einschalten sofort neu einsteigen
    this.cb.meldung?.(
      an ? 'Routen-Vorschau AN — NPCs laufen ihre Route' : 'Routen-Vorschau AUS — NPCs stehen auf ihrem gespeicherten Platz'
    );
  }

  /**
   * Alle Läufer vergessen und neu aufbauen. Nötig, wenn sich die INDIZES
   * verschieben (eine Platzierung gelöscht): `edplace-3` ist danach ein
   * anderes Objekt, ein weiterlaufender Läufer schöbe das falsche herum.
   */
  ruecksetzen(): void {
    this.laeufer.clear();
    this.erzwingeAbgleich();
  }

  /** Nächstes update() liest den Entwurf neu, egal wie alt der letzte ist. */
  private erzwingeAbgleich(): void {
    this.letzterText = '';
    this.seitAbgleich = ABGLEICH_INTERVALL;
  }

  /**
   * Wo eine Platzierung gerade zu SEHEN ist (null: läuft nicht, dann gilt
   * ihr Eintrag im Entwurf). main.ts greift danach: Angeklickt wird, was
   * man sieht — sonst müsste man auf den unsichtbaren Startpunkt eines
   * längst weitergelaufenen NPCs zielen.
   */
  positionVon(index: number): { x: number; z: number } | null {
    const l = this.laeufer.get(index);
    return l ? { x: l.x, z: l.z } : null;
  }

  /** Bewegungsschritt (aus scene.onBeforeRenderObservable des Testflugs). */
  update(deltaSec: number): void {
    if (!this.an) return;
    const griff = this.cb.gegriffen();
    if (griff !== this.letzterGriff) {
      this.griffWechsel(this.letzterGriff, griff);
      this.letzterGriff = griff;
    }
    this.seitAbgleich += deltaSec;
    if (this.seitAbgleich >= ABGLEICH_INTERVALL) {
      this.seitAbgleich = 0;
      this.abgleich();
    }
    if (this.laeufer.size === 0) return;

    const spieler = this.cb.spieler?.() ?? null;
    const ziele = spieler ? [spieler] : [];

    for (const [index, l] of this.laeufer) {
      // Gegriffen: eingefroren. Gezeichnet wird die Platzierung in diesem
      // Frame ohnehin von der Zieh-Logik in main.ts (sie hängt am Zeiger) —
      // zwei Quellen für dieselbe Position wären ein Zerren.
      if (index === griff) continue;
      const p = this.platzierung(index);

      // KAMPF SCHLÄGT SPAZIERGANG — dieselbe Vorfahrtsregel wie auf dem
      // Server (dort über RoutenLaeufer.gesperrt). Wer jemanden ins Auge
      // gefasst hat, läuft nicht weiter, sondern dreht sich hin.
      const w = p ? aggroSchritt(p.prefab, l.x, l.z, ziele, deltaSec) : null;
      if (w && p) {
        // Auch das Nachsetzen gehört in die Vorschau: `aggroSchritt`
        // liefert die neue Position mit, und wer sie hier verwirft, sieht
        // im Testflug einen Wächter, der drohend stehen bleibt, während
        // er im Spiel losgeht.
        l.x = w.x;
        l.z = w.z;
        l.yaw = w.yaw;
        l.gangart = w.anim;
        this.cb.zeichne(index, p, l.x, l.z, l.yaw, w.anim);
        continue;
      }

      const s = l.lauf.schritt(l.x, l.z, deltaSec);
      if (!s.bewegt) {
        // Standposten (Ein-Punkt-Route) oder angekommen: stehen, idle.
        this.setzeGangart(l, index, 'idle');
        continue;
      }
      l.x = s.x;
      l.z = s.z;
      l.yaw = s.yaw;
      l.gangart = 'walk';
      if (p) this.cb.zeichne(index, p, l.x, l.z, l.yaw, 'walk');
    }

    this.stehendeAggroSchritt(griff, ziele, deltaSec);
  }

  /**
   * Aggro für NPCs OHNE Route.
   *
   * Die stehen nicht in `laeufer` — sie haben keinen Laufzustand und
   * werden sonst einmal statisch gezeichnet und nie wieder angefasst.
   * Genau die will man aber im Testflug prüfen: Surtr und die Furlocs im
   * Dorf stehen auf ihrem Platz, ohne je eine Route bekommen zu haben.
   * Ohne diesen Durchgang zeigte die Vorschau Aggro nur bei Wandernden.
   */
  private stehendeAggroSchritt(
    griff: number,
    ziele: readonly { x: number; z: number }[],
    deltaSec: number
  ): void {
    const platzierungen = this.entwurf?.placements;
    if (!platzierungen) return;
    for (let i = 0; i < platzierungen.length; i++) {
      if (i === griff || this.laeufer.has(i)) continue;
      const p = platzierungen[i];
      // `istNpcPrefab` hält Bäume und Steine aus der Rechnung; ohne die
      // Abkürzung liefe `aggroSchritt` über jede Platzierung der Welt.
      if (!istNpcPrefab(p.prefab)) continue;
      // Ein Wächter ohne Route hat keinen Laufzustand — seine Verfolgung
      // braucht trotzdem ein Gedächtnis, sonst startete er in jedem Bild
      // neu an seinem Startpunkt und käme nie vom Fleck. Der ENTWURF
      // bleibt dabei unangetastet (s. Kopfkommentar): Gemerkt wird nur
      // hier, und beim Abbruch fällt er auf seinen Startpunkt zurück.
      const jetzt = this.stehendeAggro.get(i) ?? { x: p.x, z: p.z };
      const w = aggroSchritt(p.prefab, jetzt.x, jetzt.z, ziele, deltaSec);
      if (w) {
        this.stehendeAggro.set(i, { x: w.x, z: w.z });
        this.cb.zeichne(i, p, w.x, w.z, w.yaw, w.anim);
      } else if (this.stehendeAggro.delete(i)) {
        // Einmal zurück auf Startpunkt, gespeicherten Winkel und `idle`.
        this.cb.zeichne(i, p, p.x, p.z, p.yaw ?? 0, 'idle');
      }
    }
  }

  /**
   * Griff aufgenommen oder losgelassen.
   *
   * Beim GREIFEN hält der NPC an (Gangart idle) und bleibt stehen, wo er
   * ist — kein Rücksprung auf den gespeicherten Startpunkt, sonst
   * entwischte er im Moment des Anklickens.
   *
   * Beim LOSLASSEN führt der Entwurf: Die Zieh-Logik hat dort die neue
   * Position hineingeschrieben, dort steht die Platzierung jetzt, und dort
   * steigt der Lauf wieder ein (am nächstgelegenen Wegpunkt). Der Entwurf
   * wird dafür sofort neu gelesen statt erst beim nächsten Takt — sonst
   * liefe der NPC bis zu 0,2 s lang von der alten Stelle weiter.
   */
  private griffWechsel(vorher: number, jetzt: number): void {
    if (jetzt >= 0) {
      const l = this.laeufer.get(jetzt);
      if (l) this.setzeGangart(l, jetzt, 'idle');
      return;
    }
    if (vorher < 0) return;
    this.erzwingeAbgleich();
    this.abgleich();
    const l = this.laeufer.get(vorher);
    const p = this.platzierung(vorher);
    if (!l || !p) return;
    l.x = p.x;
    l.z = p.z;
    l.lauf.einstieg(p.x, p.z);
  }

  // ── Entwurf ↔ Läufer abgleichen ────────────────────────────────────

  /**
   * Live auf Änderungen reagieren: Wegpunkt gesetzt/gezogen, Route
   * zugewiesen oder gelöst, Tempo/Modus verstellt — alles landet im
   * localStorage-Entwurf, hier wird es übernommen. Ohne Neuladen, weil
   * genau das der Sinn der Vorschau ist.
   */
  private abgleich(): void {
    const text = localStorage.getItem(ENTWURF_KEY) ?? '';
    if (text === this.letzterText) return;
    this.letzterText = text;
    let dok: Entwurf | null = null;
    try {
      const roh = JSON.parse(text || 'null') as Entwurf | null;
      dok = roh && typeof roh === 'object' ? roh : null;
    } catch {
      dok = null;
    }
    this.entwurf = dok;
    const platzierungen = dok?.placements ?? [];
    const routen = new Map<string, RouteDef>();
    for (const r of dok?.routes ?? []) {
      if (r && typeof r.id === 'string' && Array.isArray(r.points)) routen.set(r.id, r);
    }

    for (let i = 0; i < platzierungen.length; i++) {
      const p = platzierungen[i]!;
      const route = p.route ? routen.get(p.route) : undefined;
      const alt = this.laeufer.get(i);
      // Keine (oder eine leere/unbekannte) Route: Der NPC bleibt STEHEN,
      // wo er gerade ist, und schaltet auf idle — dieselbe Regel wie beim
      // Server, der eine unbekannte Kennung still ignoriert.
      if (!route || route.points.length === 0) {
        if (alt) {
          this.laeufer.delete(i);
          this.cb.zeichne(i, p, alt.x, alt.z, alt.yaw, 'idle');
        }
        continue;
      }
      // Derselbe NPC auf derselben Route: Lauf weiterführen, nur die
      // Route-Daten austauschen (gezogener Wegpunkt, neues Tempo …).
      if (alt && alt.prefab === p.prefab && alt.routeId === p.route) {
        alt.lauf.setzeRoute(route, alt.x, alt.z);
        continue;
      }
      // Neu (oder Index gewandert): am gespeicherten Platz einsteigen.
      this.laeufer.set(i, {
        lauf: new RoutenLauf(route, p.x, p.z),
        x: p.x,
        z: p.z,
        yaw: p.yaw ?? 0,
        gangart: 'idle',
        prefab: p.prefab,
        routeId: p.route!,
      });
    }
    // Platzierungen, die es nicht mehr gibt.
    for (const index of [...this.laeufer.keys()]) {
      if (index >= platzierungen.length) this.laeufer.delete(index);
    }
  }

  /** Gangart nur bei WECHSEL zeichnen — sonst flackert der Clip-Neustart. */
  private setzeGangart(l: Laeufer, index: number, gangart: 'idle' | 'walk'): void {
    if (l.gangart === gangart) return;
    l.gangart = gangart;
    const p = this.platzierung(index);
    if (p) this.cb.zeichne(index, p, l.x, l.z, l.yaw, gangart);
  }

  /** Alle NPCs auf ihren gespeicherten Platz zurücksetzen (Vorschau AUS). */
  private zurueckAufStart(): void {
    for (const index of this.laeufer.keys()) {
      const p = this.platzierung(index);
      if (p) this.cb.zeichne(index, p, p.x, p.z, p.yaw ?? 0, 'idle');
    }
    this.laeufer.clear();
    // Auch die Verfolger ohne Route zurückholen: Ihr Gedächtnis lebt nur
    // hier, und ohne das Leeren stünden sie beim nächsten Einschalten
    // dort, wo sie den Spieler zuletzt gejagt haben — die Vorschau „AUS"
    // soll die Welt zeigen, wie sie GESPEICHERT ist.
    for (const index of this.stehendeAggro.keys()) {
      const p = this.platzierung(index);
      if (p) this.cb.zeichne(index, p, p.x, p.z, p.yaw ?? 0, 'idle');
    }
    this.stehendeAggro.clear();
  }

  private platzierung(index: number): EntwurfsPlatzierung | null {
    return this.entwurf?.placements?.[index] ?? null;
  }
}
