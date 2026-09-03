/**
 * BLEIBT — Grundlage des Connector-Modul-Kits (DG_StoneVault),
 * Entscheidung 03.09.2026, s. `LEGACY.md`. / STAYS — the basis of the
 * connector module kit (DG_StoneVault), decision 2026-09-03, see
 * `LEGACY.md`. Raumbibliothek +
 * Connector-Grundriss; steht neben `client/src/editor/dungeon2/`
 * (design/ARCHITECTURE.md §1.1/§1.2, ZellenCanvas). Siehe `LEGACY.md`.
 * Room library + connector floorplan; stands beside
 * `client/src/editor/dungeon2/` (design/ARCHITECTURE.md §1.1/§1.2,
 * ZellenCanvas). See `LEGACY.md`.
 *
 * Grundriss eines Dungeon-Dokuments im Karteneditor — Etappe 2.
 *
 * Eigene Zeichenfläche im Viewport der Shell; die Weltkarten-Canvas wird
 * dafür ausgeblendet. Gezeichnet wird von oben: Räume als Rechtecke aus
 * `RoomDef.size`, Türen als Balken, Deko als Punkte, offene Connectors als
 * Marken mit Blickrichtung.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────
 * Gebaut wird ausschliesslich mit `attachRoom`, `removeRoom` und
 * `computeOpenConnections` aus `shared/src/dungeonGenerator.ts` — denselben
 * Funktionen, die Server, Generator und der F4-Editor benutzen. Seit
 * „flüssiges Bauen" laufen Anfügen und Kantenliste über `fuegeAnKante` und
 * `anbaubareKanten` (`shared/src/dungeonKanten.ts`); die sitzen auf genau
 * denselben drei und teilen sie sich mit dem F4-Editor. Eine
 * zweite Bau-Logik im Editor wäre die eine Sache, die dieses Vorhaben
 * ausdrücklich ausschliesst: Sie liefe beim ersten Sonderfall auseinander,
 * und der Unterschied zeigte sich erst im Spiel.
 *
 * ── Die Falle, die dieses Bild leicht falsch zeichnet ────────────────
 * `RoomDef.size` ist eine ORIENTIERTE Box, keine achsparallele.
 * `roomOverlapsLayout` dreht sie erst mit `PlacedRoom.rot`. Ein Grundriss,
 * der `size.x`/`size.z` ungedreht aufträgt, zeigt jeden um 90° gedrehten
 * Raum falsch herum — und die Connector-Marken passen dann nicht zu den
 * Rechtecken, was aussieht wie ein kaputtes Dokument.
 *
 * ── Ebenen ───────────────────────────────────────────────────────────
 * Mit `StoneVaultStairs` gibt es Ebenen wirklich: Die Treppe steht mit
 * ihrem Fuss auf y = 0 und gibt oben auf y = 3,5 wieder ab. Zwei
 * Stockwerke übereinander sind im Grundriss ein unlesbares Knäuel — der
 * Filter `ebene` blendet deshalb auf ein Stockwerk zurück.
 *
 * Zwei Feinheiten, die beide gemessen falsch waren, bevor sie hier
 * standen:
 *
 *  - Die Ebene wird NICHT gerundet. `Math.round(3.5)` ist 4, und im
 *    Auswahlfeld stand „Ebene y = 4" für ein Stockwerk, das im Kit
 *    überall 3,5 heisst. Gerastert wird stattdessen auf 0,1 m — genug
 *    gegen Fliesskomma-Rauschen, fein genug für das Ebenenmass des
 *    Modulformats.
 *  - Ein offener Connector wird nach SEINER EIGENEN Höhe einsortiert,
 *    nicht nach der seines Raums. Der obere Ausgang der Treppe gehört zu
 *    einem Raum auf y = 0 und läge sonst auf der unteren Ebene — genau
 *    dort, wo er nicht ist, und unsichtbar auf der Ebene, auf der man
 *    weiterbaut.
 *
 * ── Hülle: Innenmass ist nicht Zellmass ──────────────────────────────
 * `RoomDef.size` gibt bei den Modulzellen mit eingebauten Wänden das
 * INNENMASS an (1,4 statt 2 — Begründung bei `innenmassAchsen` in
 * `shared/src/dungeonRaster.ts`). Ungeprüft aufgetragen sieht ein
 * Korridor damit schmaler aus als die Zelle, die er belegt, und die
 * Zellen einer Kette berühren sich im Bild nicht. Gezeichnet wird
 * deshalb die belegte ZELLE, nicht die Kollisionshülle.
 */
import {
  DUNGEONS_BY_NAME,
  MODUL_WANDDICKE_M,
  anbaubareKanten,
  computeOpenConnections,
  fuegeAnKante,
  innenmassAchsen,
  removeRoom,
  schliesseOffeneKanten,
  type AnbaubareKante,
  type DungeonDocument,
  type KantenSchlussErgebnis,
  type OpenConnection,
  type PlacedRoom,
  type Quaternion,
  type RoomDef,
  type Vector3,
} from '@wov/shared';

/** Randabstand des Grundrisses zur Zeichenfläche, in Pixeln. */
const RAND_PX = 48;
/** Kleinster und grösster Maßstab (Pixel je Meter). */
const ZOOM_MIN = 1.5;
const ZOOM_MAX = 40;

const FARBE = {
  grund: '#14100b',
  raster: '#241d14',
  raum: 'rgba(190,160,110,.10)',
  raumRand: '#8a6a34',
  raumGewaehlt: 'rgba(255,210,130,.22)',
  eingang: '#5aa34a',
  tuer: '#c8a24a',
  deko: '#ff8c3a',
  offen: '#e05a3a',
  /** Zugemauerte Kante — anbaubar, aber kein Loch (s. `anbaubareKanten`). */
  wandKante: '#e0a03a',
  schrift: '#e8d9b8',
} as const;

/** Ein Punkt in Weltkoordinaten des Dungeons. */
interface Punkt {
  x: number;
  z: number;
}

/**
 * Kits, die im 2-m-Modulraster gebaut sind (`modulFormat.md`), statt im
 * 4-m-Raster von `dungeonRaster.ts`.
 *
 * Eine Liste und kein Feld am `DungeonDef`, weil `DungeonDef` die
 * dreizehn geparsten Vorlagen-Kits mitträgt: Ein neues Pflichtfeld dort
 * hiesse dreizehn Einträge zu erfinden, die niemand nachgemessen hat.
 * Wenn ein zweites Modulkit dazukommt, steht es hier — eine Zeile, und
 * sie wird vom Test mitgeführt.
 */
const MODULKITS: ReadonlySet<string> = new Set(['DG_StoneVault']);

/** Rastermass des Kits in Metern — 2 m im Modulformat, sonst 4 m. */
export function rasterVonBasis(base: string): number {
  return MODULKITS.has(base) ? 2 : 4;
}

/**
 * Die Fläche, die ein Raum im Bild BELEGT — nicht seine Kollisionshülle.
 *
 * Bei einer Modulzelle mit eingebauten Wänden (`StoneVaultCorridor`,
 * `-Corner`, `-Junction`, `-Stairs`) gibt `size` das Innenmass an: 1,4 m
 * statt der 2 m, die die Zelle im Raster belegt. Die fehlenden 0,6 m sind
 * genau zwei Wanddicken, und `innenmassAchsen` sagt, auf welchen Achsen
 * das der Fall ist — dieselbe Auskunft, mit der `pruefeRaumRaster` die
 * Ausnahme prüft. Ohne diese Korrektur wirken Gänge und Ecken schmaler
 * als sie sind, und eine Zellkette berührt sich im Bild nicht.
 */
export function zeichenHuelle(raum: RoomDef, raster: number): Vector3 {
  const innen = innenmassAchsen(raum, raster);
  return {
    x: innen.includes('x') ? raum.size.x + 2 * MODUL_WANDDICKE_M : raum.size.x,
    y: raum.size.y,
    z: innen.includes('z') ? raum.size.z + 2 * MODUL_WANDDICKE_M : raum.size.z,
  };
}

/**
 * Die Ebene, auf der ein y-Wert liegt — auf 0,1 m gerastert.
 *
 * Nicht `Math.round`: Das Ebenenmass des Modulformats ist 3,5, und
 * gerundet stünde im Auswahlfeld „Ebene y = 4" für ein Stockwerk, das
 * überall sonst 3,5 heisst.
 */
export function ebeneVon(y: number): number {
  return Math.round(y * 10) / 10;
}

/**
 * Vier Ecken der GEDREHTEN Grundfläche eines Raums, in Dungeon-Koordinaten.
 *
 * Ausgelagert, weil dieselbe Rechnung an drei Stellen gebraucht wird
 * (Zeichnen, Treffertest, Ausdehnung) und ein vierter Nachbau der
 * Quaternion-Drehung genau der Fehler wäre, vor dem der Kopfkommentar
 * warnt.
 */
function ecken(pos: Vector3, rot: Quaternion, size: Vector3): Punkt[] {
  const hx = size.x / 2;
  const hz = size.z / 2;
  return [
    [+hx, +hz],
    [+hx, -hz],
    [-hx, -hz],
    [-hx, +hz],
  ].map(([ex, ez]) => {
    const d = dreheY(rot, { x: ex!, y: 0, z: ez! });
    return { x: pos.x + d.x, z: pos.z + d.z };
  });
}

/** Einen Vektor mit einem Quaternion drehen (q · v · q⁻¹). */
function dreheY(q: Quaternion, v: Vector3): Vector3 {
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * w + iw * -x + iy * -z - iz * -y,
    y: iy * w + iw * -y + iz * -x - ix * -z,
    z: iz * w + iw * -z + ix * -y - iy * -x,
  };
}

/**
 * Radius der Kantenmarke in METERN — nicht in Pixeln.
 *
 * In Weltmass, weil der Treffertest sonst vom Maßstab abhinge: Beim
 * Herauszoomen läge eine Kante hinter jedem zweiten Pixel, beim
 * Hineinzoomen träfe man sie nie. 0,6 m ist knapp ein Drittel einer
 * Modulzelle (2 m) — nah genug, dass zwei benachbarte Kanten sich nicht
 * überlappen, weit genug, dass man ohne Zielen trifft.
 */
export const KANTEN_RADIUS_M = 0.6;

/**
 * Liegt ein Punkt auf der Marke einer anbaubaren Kante?
 *
 * Reine Funktion und exportiert, weil sie ohne Canvas prüfbar sein muss
 * (`client/test/dungeon-grundriss-kanten.ts`) — und weil die 3D-Ansicht
 * dieselbe Frage stellt, nur mit einem Strahl statt mit einem Pixel.
 * Gerechnet wird in der Draufsicht (x/z); die Höhe filtert vorher der
 * Ebenenfilter, genau wie beim Zeichnen der Marken.
 */
export function trifftKante(
  welt: Punkt,
  kante: { pos: Vector3 },
  radius = KANTEN_RADIUS_M
): boolean {
  const dx = welt.x - kante.pos.x;
  const dz = welt.z - kante.pos.z;
  return dx * dx + dz * dz <= radius * radius;
}

export interface GrundrissRueckrufe {
  /** Kurzmeldung in der Shell. */
  meldung(text: string, fehler?: boolean): void;
  /** Auswahl hat sich geändert — die Seitenleiste zeichnet sich neu. */
  auswahlGeaendert(): void;
  /**
   * Eine Kantenmarke wurde angeklickt — `idx` zählt in `anbaubare`, also in
   * DERSELBEN Liste wie der erste Parameter von `fuegeAn`.
   *
   * Optional, damit ältere Aufrufer nicht brechen: Wer ihn nicht setzt,
   * bekommt das Verhalten von vorher — dort gab es an einer Marke nichts
   * zu treffen, und der Klick fiel auf den Raum darunter durch.
   */
  connectorAngeklickt?(idx: number): void;
}

export class DungeonGrundriss {
  private readonly canvas: HTMLCanvasElement;
  private doc: DungeonDocument | null = null;
  private offene: OpenConnection[] = [];
  /** Offene UND verwandete Kanten — die Anfügen-Liste der Seitenleiste. */
  private anbaubareListe: AnbaubareKante[] = [];
  /** Pixel je Meter. */
  private zoom = 8;
  /** Mitte des Bildes in Dungeon-Koordinaten. */
  private mitte: Punkt = { x: 0, z: 0 };
  private gewaehlt = -1;
  /** Nur Räume dieser Ebene zeigen; null = alle. */
  private ebene: number | null = null;
  private zieht: { x: number; y: number } | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly cb: GrundrissRueckrufe
  ) {
    const c = document.createElement('canvas');
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;cursor:crosshair;z-index:2';
    viewport.appendChild(c);
    this.canvas = c;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Um den Zeiger zoomen, nicht um die Bildmitte: Sonst wandert die
      // Stelle, die man betrachtet, bei jedem Radschritt aus dem Bild.
      const vor = this.zuWelt(e.offsetX, e.offsetY);
      this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
      const nach = this.zuWelt(e.offsetX, e.offsetY);
      this.mitte.x += vor.x - nach.x;
      this.mitte.z += vor.z - nach.z;
      this.zeichne();
    });
    c.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.waehleBei(e.offsetX, e.offsetY);
      this.zieht = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => {
      this.zieht = null;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.zieht) return;
      this.mitte.x -= (e.clientX - this.zieht.x) / this.zoom;
      this.mitte.z -= (e.clientY - this.zieht.y) / this.zoom;
      this.zieht = { x: e.clientX, y: e.clientY };
      this.zeichne();
    });
  }

  get sichtbar(): boolean {
    return this.canvas.style.display !== 'none';
  }

  zeige(an: boolean): void {
    this.canvas.style.display = an ? 'block' : 'none';
    if (an) this.zeichne();
  }

  get dokument(): DungeonDocument | null {
    return this.doc;
  }

  get gewaehlterRaum(): number {
    return this.gewaehlt;
  }

  get offeneVerbindungen(): readonly OpenConnection[] {
    return this.offene;
  }

  /**
   * Die Kanten, an denen sich anbauen lässt — offene UND zugemauerte.
   *
   * Bewusst NEBEN `offeneVerbindungen` und nicht statt dessen: Gezeichnet
   * und gezählt werden die wirklich OFFENEN Kanten (ein Loch ist ein Loch,
   * eine Wand nicht), angeboten wird die längere Liste. Ein einziger
   * Getter für beides hiesse, im Kopf des Dokuments „7 offen" zu melden,
   * wo sechs davon zugemauert sind.
   */
  get anbaubare(): readonly AnbaubareKante[] {
    return this.anbaubareListe;
  }

  /**
   * Ebenen, auf denen wirklich etwas steht — Futter für den Filter.
   *
   * Die offenen Connectors zählen MIT, und das ist der Fall, für den der
   * Filter überhaupt existiert: Solange nur die Treppe steht, liegt jeder
   * Raum auf y = 0, und die obere Ebene gäbe es in dieser Liste nicht —
   * das Feld erschiene erst, nachdem man dort schon gebaut hat. Genau
   * dann braucht man es aber nicht mehr.
   */
  get ebenen(): number[] {
    const s = new Set<number>();
    for (const r of this.doc?.layout.rooms ?? []) s.add(ebeneVon(r.pos.y));
    for (const c of this.offene) s.add(ebeneVon(c.pos.y));
    return [...s].sort((a, b) => a - b);
  }

  setzeEbene(y: number | null): void {
    this.ebene = y;
    this.zeichne();
  }

  /** Ein Dokument übernehmen und einpassen. */
  setzeDokument(doc: DungeonDocument | null): void {
    this.doc = doc;
    this.gewaehlt = -1;
    this.ebene = null;
    this.aktualisiereOffene();
    this.passeEin();
    this.zeichne();
    this.cb.auswahlGeaendert();
  }

  /**
   * Raum an eine anbaubare Kante anfügen (dieselbe Funktion wie F4).
   *
   * `connIndex` zählt in `anbaubare`, nicht in `offeneVerbindungen`: Die
   * offenen Kanten stehen dort vorn und behalten ihre Plätze, dahinter
   * kommen die verwandeten. Ist die gewählte Kante eine Wand, fällt sie —
   * aber erst, wenn feststeht, dass der neue Raum passt. Die Reihenfolge
   * macht `fuegeAnKante` in `@wov/shared`; hier daneben steht nur, was
   * DIESER Editor zusätzlich nachziehen muss.
   *
   * `kanteIndex` ist die Ausrichtung: WELCHE Kante des neuen Raums an der
   * offenen Kante hängt (Index in `RoomDef.connections`). Ohne ihn nimmt
   * `attachRoom` den ersten kollisionsfreien eigenen Connector — bei einer
   * Zelle mit vier gleichwertigen Kanten entscheidet dann die Reihenfolge
   * in `eigeneDungeons.ts`, in welche Richtung ein Gang weiterläuft.
   *
   * `undefined` ist dabei nicht dasselbe wie −1 oder 0: `attachRoom`
   * unterscheidet „nicht gesetzt" (altes Verhalten) von „gesetzt, aber
   * unpassend" (Fehlermeldung). Durchgereicht wird deshalb genau der Wert,
   * den der Aufrufer gibt.
   */
  fuegeAn(connIndex: number, raumName: string, kanteIndex?: number): boolean {
    const doc = this.doc;
    const conn = this.anbaubareListe[connIndex];
    if (!doc || !conn) return false;
    const ergebnis = fuegeAnKante(doc.layout, doc.base, conn, raumName, kanteIndex);
    if (!ergebnis.ok) {
      this.cb.meldung(ergebnis.reason, true);
      return false;
    }
    // Fiel eine Wand, rutschen die Indizes hinter ihr — auch der der
    // Auswahl. Ohne diese drei Zeilen zeigte der markierte Raum nach dem
    // Anfügen auf seinen Nachbarn, und „Raum entfernen" träfe den
    // Falschen.
    if (conn.wandIndex !== undefined) {
      if (this.gewaehlt === conn.wandIndex) this.gewaehlt = -1;
      else if (this.gewaehlt > conn.wandIndex) this.gewaehlt--;
    }
    // Von Hand gebaut heisst „custom": Ein `generated`-Dokument wird beim
    // naechsten Materialisieren aus Seed und Regeln neu erzeugt, und der
    // angefuegte Raum waere spurlos weg. Dieselbe Zeile steht im F4-Editor.
    doc.mode = 'custom';
    this.aktualisiereOffene();
    this.zeichne();
    this.cb.auswahlGeaendert();
    this.cb.meldung(
      ergebnis.wandErsetzt
        ? `Wand ersetzt, ${raumName} angefügt — ${doc.layout.rooms.length} Räume`
        : `${raumName} angefügt — ${doc.layout.rooms.length} Räume`
    );
    return true;
  }

  /**
   * Alle offenen Kanten zumauern — ausser dem Eingang.
   *
   * Die Rechnung steht in `schliesseOffeneKanten` (`@wov/shared`), damit
   * der F4-Editor im Spiel dieselbe benutzt. Hier daneben steht nur, was
   * DIESER Editor zusätzlich tun muss: `mode` umstellen, die Liste der
   * offenen Kanten neu ziehen und neu zeichnen.
   *
   * `mode = 'custom'` wie bei `fuegeAn`: Ein `generated`-Dokument wird beim
   * nächsten Materialisieren aus Seed und Regeln neu gebaut, und die eben
   * gesetzten Wände wären spurlos weg.
   *
   * Rückwärts geht es über „Raum entfernen": Eine Wand ist ein Raum wie
   * jeder andere, und ihn zu entfernen gibt die Kante wieder frei. Das ist
   * der Weg zum Weiterbauen an einem schon geschlossenen Grab.
   */
  schliesseKanten(): KantenSchlussErgebnis {
    const doc = this.doc;
    if (!doc) return { gesetzt: 0, offenGeblieben: 0 };
    const ergebnis = schliesseOffeneKanten(doc.layout, doc.base);
    if (ergebnis.gesetzt > 0) {
      doc.mode = 'custom';
      this.aktualisiereOffene();
      this.zeichne();
      this.cb.auswahlGeaendert();
    }
    return ergebnis;
  }

  entferne(index: number): boolean {
    const doc = this.doc;
    if (!doc) return false;
    // Anders als `attachRoom` veraendert `removeRoom` das Layout selbst —
    // es raeumt auch Tueren und Deko des Raums weg und schiebt die
    // Deko-Indizes nach. Hier also NICHTS nachtragen.
    const ergebnis = removeRoom(doc.layout, doc.base, index);
    if (!ergebnis.ok) {
      this.cb.meldung(ergebnis.reason ?? 'Raum lässt sich nicht entfernen', true);
      return false;
    }
    doc.mode = 'custom';
    if (this.gewaehlt === index) this.gewaehlt = -1;
    else if (this.gewaehlt > index) this.gewaehlt--;
    this.aktualisiereOffene();
    this.zeichne();
    this.cb.auswahlGeaendert();
    return true;
  }

  private aktualisiereOffene(): void {
    this.offene = this.doc ? computeOpenConnections(this.doc.layout, this.doc.base) : [];
    // IMMER zusammen mit `offene` neu ziehen: `wandIndex` zeigt in ein
    // Layout, dessen Indizes nach jedem `removeRoom` rutschen. Eine Liste,
    // die einen Arbeitsgang überlebt, zeigt auf den falschen Raum.
    this.anbaubareListe = this.doc ? anbaubareKanten(this.doc.layout, this.doc.base) : [];
  }

  /** Maßstab und Mitte so wählen, dass der ganze Grundriss ins Bild passt. */
  passeEin(): void {
    const rooms = this.doc?.layout.rooms ?? [];
    if (rooms.length === 0) return;
    const masse = this.raumMasse();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of rooms) {
      const rd = masse.get(r.room);
      if (!rd) continue;
      for (const p of ecken(r.pos, r.rot, rd.huelle)) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    if (!Number.isFinite(minX)) return;
    this.mitte = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    const { breite, hoehe } = this.groesse();
    const passt = Math.min(
      (breite - 2 * RAND_PX) / Math.max(1, maxX - minX),
      (hoehe - 2 * RAND_PX) / Math.max(1, maxZ - minZ)
    );
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, passt));
  }

  private groesse(): { breite: number; hoehe: number } {
    return { breite: this.viewport.clientWidth || 800, hoehe: this.viewport.clientHeight || 600 };
  }

  private zuBild(p: Punkt): { x: number; y: number } {
    const { breite, hoehe } = this.groesse();
    return {
      x: breite / 2 + (p.x - this.mitte.x) * this.zoom,
      y: hoehe / 2 + (p.z - this.mitte.z) * this.zoom,
    };
  }

  private zuWelt(px: number, py: number): Punkt {
    const { breite, hoehe } = this.groesse();
    return {
      x: this.mitte.x + (px - breite / 2) / this.zoom,
      z: this.mitte.z + (py - hoehe / 2) / this.zoom,
    };
  }

  private sichtbarAufEbene(r: PlacedRoom): boolean {
    return this.ebene === null || ebeneVon(r.pos.y) === this.ebene;
  }

  /**
   * Sichtbarkeit eines offenen Connectors — nach SEINER Höhe, nicht nach
   * der seines Raums. Der obere Ausgang der Treppe gehört zu einem Raum
   * auf y = 0; nach dem Raum sortiert läge er auf der unteren Ebene und
   * fehlte auf der oberen, auf der man weiterbaut.
   *
   * Der Raum, an dem ein Connector hängt, hat dabei GAR KEIN Gewicht: Ein
   * Connector auf der Ebene, die gerade gezeigt wird, ist ein
   * Arbeitspunkt, egal wo sein Raum steht.
   */
  private connectorAufEbene(c: OpenConnection): boolean {
    return this.ebene === null || ebeneVon(c.pos.y) === this.ebene;
  }

  /**
   * Raumdefinition und Zeichenfläche je Raumnamen des Kits.
   *
   * An einer Stelle gerechnet, weil dieselbe Auskunft an drei Stellen
   * gebraucht wird (Einpassen, Treffertest, Zeichnen) — und weil die
   * Innenmass-Korrektur genau dann still auseinanderliefe, wenn eine der
   * drei sie vergisst: Man klickte auf einen Raum und träfe daneben.
   */
  private raumMasse(): Map<string, { def: RoomDef; huelle: Vector3 }> {
    const doc = this.doc;
    const def = doc ? DUNGEONS_BY_NAME.get(doc.base) : undefined;
    const raster = rasterVonBasis(doc?.base ?? '');
    return new Map(
      (def?.rooms ?? []).map((r) => [r.name, { def: r, huelle: zeichenHuelle(r, raster) }])
    );
  }

  /**
   * Einen Raum per Index auswählen — das Gegenstück zum Klick im Bild.
   *
   * Gebraucht von der 3D-Ansicht: Dort klickt man auf das Modul, und beide
   * Ansichten müssen danach DENSELBEN Raum markiert zeigen. Ein Index
   * ausserhalb der Liste (oder −1) hebt die Auswahl auf, statt zu werfen —
   * ein Klick ins Leere ist kein Fehler.
   */
  waehle(index: number): void {
    const anzahl = this.doc?.layout.rooms.length ?? 0;
    const neu = index >= 0 && index < anzahl ? index : -1;
    if (neu === this.gewaehlt) return;
    this.gewaehlt = neu;
    this.zeichne();
    this.cb.auswahlGeaendert();
  }

  /**
   * Treffertest — KANTEN ZUERST, dann Räume.
   *
   * Die Reihenfolge ist der ganze Punkt: Eine Kantenmarke liegt immer auf
   * dem Rand eines Raums und damit im Zweifel auch in seinem Polygon. Erst
   * die Räume zu prüfen hiesse, dass eine Marke nie getroffen wird — sie
   * wäre gezeichnet, aber unerreichbar, und der Klick markierte
   * stattdessen den Nachbarn.
   *
   * Genommen wird die NÄCHSTE Kante im Radius, nicht die erste: Zwei
   * Marken können sich am Rand ihrer Radien überlappen, und dann ist die
   * gemeinte die, die näher liegt. Bei Gleichstand gewinnt der kleinere
   * Index — dieselbe Kante, die die Seitenleiste vorbelegt.
   */
  private waehleBei(px: number, py: number): void {
    const doc = this.doc;
    if (!doc) return;
    const welt = this.zuWelt(px, py);

    if (this.cb.connectorAngeklickt) {
      let besterIdx = -1;
      let besterAbstand = Infinity;
      this.anbaubareListe.forEach((k, idx) => {
        if (!this.connectorAufEbene(k)) return;
        if (!trifftKante(welt, k)) return;
        const d = (welt.x - k.pos.x) ** 2 + (welt.z - k.pos.z) ** 2;
        if (d < besterAbstand) {
          besterAbstand = d;
          besterIdx = idx;
        }
      });
      if (besterIdx >= 0) {
        this.cb.connectorAngeklickt(besterIdx);
        return;
      }
    }

    const masse = this.raumMasse();
    // Von hinten nach vorn: Was zuletzt gezeichnet wurde, liegt oben und
    // soll zuerst getroffen werden.
    for (let i = doc.layout.rooms.length - 1; i >= 0; i--) {
      const r = doc.layout.rooms[i]!;
      if (!this.sichtbarAufEbene(r)) continue;
      const rd = masse.get(r.room);
      if (!rd) continue;
      if (imPolygon(welt, ecken(r.pos, r.rot, rd.huelle))) {
        this.gewaehlt = this.gewaehlt === i ? -1 : i;
        this.zeichne();
        this.cb.auswahlGeaendert();
        return;
      }
    }
    this.gewaehlt = -1;
    this.zeichne();
    this.cb.auswahlGeaendert();
  }

  zeichne(): void {
    const { breite, hoehe } = this.groesse();
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== breite * dpr || this.canvas.height !== hoehe * dpr) {
      this.canvas.width = breite * dpr;
      this.canvas.height = hoehe * dpr;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = FARBE.grund;
    ctx.fillRect(0, 0, breite, hoehe);

    this.zeichneRaster(ctx, breite, hoehe);

    const doc = this.doc;
    if (!doc) {
      ctx.fillStyle = FARBE.schrift;
      ctx.font = '14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Kein Dungeon geladen — links einen auswählen.', breite / 2, hoehe / 2);
      return;
    }

    const masse = this.raumMasse();

    doc.layout.rooms.forEach((r, i) => {
      if (!this.sichtbarAufEbene(r)) return;
      const rd = masse.get(r.room);
      if (!rd) return;
      const ecks = ecken(r.pos, r.rot, rd.huelle).map((p) => this.zuBild(p));
      ctx.beginPath();
      ctx.moveTo(ecks[0]!.x, ecks[0]!.y);
      for (const p of ecks.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = i === this.gewaehlt ? FARBE.raumGewaehlt : FARBE.raum;
      ctx.fill();
      ctx.strokeStyle = rd.def.entrance ? FARBE.eingang : FARBE.raumRand;
      ctx.lineWidth = i === this.gewaehlt ? 2.5 : 1;
      ctx.stroke();

      if (this.zoom >= 6) {
        const m = this.zuBild({ x: r.pos.x, z: r.pos.z });
        ctx.fillStyle = FARBE.schrift;
        ctx.font = '10px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i), m.x, m.y + 3);
      }
    });

    // Türen: kurzer Balken quer zur Durchgangsrichtung.
    ctx.strokeStyle = FARBE.tuer;
    ctx.lineWidth = 3;
    for (const t of doc.layout.doors) {
      const dir = dreheY(t.rot, { x: 1, y: 0, z: 0 });
      const a = this.zuBild({ x: t.pos.x - dir.x * 1.6, z: t.pos.z - dir.z * 1.6 });
      const b = this.zuBild({ x: t.pos.x + dir.x * 1.6, z: t.pos.z + dir.z * 1.6 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Deko: kleine Punkte. Sie sind das, was man beim Bauen zuletzt setzt,
    // und im Grundriss nur zur Orientierung.
    ctx.fillStyle = FARBE.deko;
    for (const p of doc.layout.props) {
      const b = this.zuBild({ x: p.pos.x, z: p.pos.z });
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Offene Connectors: Marke mit Blickrichtung nach draussen. Sie sind
    // der eigentliche Arbeitspunkt — hier wächst der Dungeon weiter.
    for (const c of this.offene) {
      if (!this.connectorAufEbene(c)) continue;
      const b = this.zuBild({ x: c.pos.x, z: c.pos.z });
      const dir = dreheY(c.rot, { x: 0, y: 0, z: 1 });
      ctx.strokeStyle = FARBE.offen;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + dir.x * 12, b.y + dir.z * 12);
      ctx.stroke();
    }

    // Zugemauerte Kanten: dieselbe Marke in Bernstein statt Rot. Sie sind
    // ANKLICKBAR (s. `waehleBei`) und stehen in der Anfügen-Liste — ohne
    // Marke wäre das ein Treffer auf etwas Unsichtbares, und ein
    // geschlossenes Grab sähe aus, als ginge es nirgends weiter.
    for (const k of this.anbaubareListe) {
      if (k.wandIndex === undefined) continue;
      if (!this.connectorAufEbene(k)) continue;
      const b = this.zuBild({ x: k.pos.x, z: k.pos.z });
      ctx.strokeStyle = FARBE.wandKante;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private zeichneRaster(ctx: CanvasRenderingContext2D, breite: number, hoehe: number): void {
    // Raster im Takt DIESES Kits — es sagt beim Hinsehen, ob ein Teil
    // wirklich auf dem Raster sitzt. Ein 4-m-Netz unter einem 2-m-Modulkit
    // beantwortet genau diese Frage nicht mehr: Jede zweite Zellkante
    // läge zwischen den Linien und sähe versetzt aus, obwohl sie sitzt.
    const takt = rasterVonBasis(this.doc?.base ?? '');
    const schritt = takt * this.zoom;
    if (schritt < 6) return;
    ctx.strokeStyle = FARBE.raster;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const linksWelt = this.zuWelt(0, 0);
    const startX = Math.ceil(linksWelt.x / takt) * takt;
    const startZ = Math.ceil(linksWelt.z / takt) * takt;
    for (let x = startX; ; x += takt) {
      const b = this.zuBild({ x, z: 0 });
      if (b.x > breite) break;
      ctx.moveTo(b.x, 0);
      ctx.lineTo(b.x, hoehe);
    }
    for (let z = startZ; ; z += takt) {
      const b = this.zuBild({ x: 0, z });
      if (b.y > hoehe) break;
      ctx.moveTo(0, b.y);
      ctx.lineTo(breite, b.y);
    }
    ctx.stroke();
  }
}

/** Punkt-in-Polygon (Strahlverfahren) — für den Treffertest auf Räume. */
function imPolygon(p: Punkt, poly: Punkt[]): boolean {
  let drin = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      drin = !drin;
    }
  }
  return drin;
}
