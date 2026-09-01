/**
 * AP15.3 — die 2D-Draufsicht des Zellgitters (Dungeon Generator 2.0).
 *
 * Zeichnet die Zellen EINER wählbaren Ebene: `ZellenArt` farbcodiert, die
 * Bodenhöhe als Tonwert + Zahl, die Wandkanten aus der symmetrischen
 * `wandZwischen()`-Ableitung als Striche an den Zellrändern, Türen und
 * Deko-Anker als Marker. Pan/Zoom sind 1:1 aus dem LEGACY-`DungeonGrundriss.ts`
 * übernommen (Rad-Zoom um den Zeiger, Ziehen mit der RECHTEN/MITTLEREN Maustaste
 * — die LINKE gehört dem Werkzeug).
 *
 * DIE EINE BAU-LOGIK (Kopfkommentar `DungeonGrundriss.ts`): Diese Canvas baut
 * KEINE Zellen selbst. Sie ruft `zellenAufbauen()` aus `shared/dungeon2/cells.ts`
 * und zeichnet dessen Ergebnis. Jede Änderung geht über die Werkzeuge ins
 * Dokument und kommt über `setzeLayout()` als neues Gitter zurück — es gibt
 * keine zweite Wahrheit über „welche Zelle wo".
 *
 * AP15.3 — the 2D top-down view of the cell grid. Draws the cells of ONE chosen
 * storey; pan/zoom taken 1:1 from the legacy floor plan (wheel zoom around the
 * pointer, drag with the RIGHT/MIDDLE button — the LEFT belongs to the tool).
 * THE ONE BUILD LOGIC: this canvas builds no cells itself; it calls
 * `zellenAufbauen()` and draws the result.
 */

import { dungeon2 } from '@wov/shared';
import { F, SCHRIFT } from '../design';
import {
  bildZuWelt,
  einpassen,
  kanteBei,
  sichtbaresFenster,
  weltZuBild,
  zelleBei,
  zoomUmZeiger,
  type KantePos,
  type Sicht,
  type ZellPos,
} from './cellCanvasMath';

const ZELLE_M = dungeon2.ZELLE_M;
const KANTE = dungeon2.KANTE;
const KANTEN = dungeon2.KANTEN;
const ZELLEN_ART = dungeon2.ZELLEN_ART;

type DungeonLayout2 = dungeon2.DungeonLayout2;
type Zelle = dungeon2.Zelle;
type ZellenGitter = dungeon2.ZellenGitter;
type Kante = dungeon2.Kante;

const ZOOM_MIN = 1.5;
const ZOOM_MAX = 40;
const RAND_PX = 48;
/** Höchste Bodenstufe für die Ton-Skala (eine Ebene). / Top step for the tone scale. */
const BODEN_SKALA = Math.round(dungeon2.EBENE_M / dungeon2.HOEHEN_SCHRITT_M);

/** Auflösung eines Klicks: auf eine Zelle oder auf eine Kante. */
/** Click resolution: onto a cell or onto an edge. */
export type PickModus = 'zelle' | 'kante';

/** Was der Zeiger gerade überschwebt. / What the pointer currently hovers. */
export interface HoverInfo {
  readonly zelle: ZellPos;
  readonly kante: KantePos;
  readonly pickModus: PickModus;
}

/**
 * Ein andockbares Werkzeug. Die Canvas kennt nur diese Schnittstelle, nicht die
 * einzelnen Werkzeuge — genau ein Werkzeug ist aktiv (`setzeWerkzeug`), und die
 * Canvas leitet Klicks je nach `pickModus` an `onZelleKlick` oder `onKanteKlick`.
 * A dockable tool. The canvas knows only this interface; exactly one tool is
 * active, and clicks are routed by `pickModus`.
 */
export interface ZellWerkzeug {
  readonly pickModus: PickModus;
  /** true = beim Ziehen mit gedrückter Maustaste wiederholt auslösen (Pinsel). */
  /** true = repeat while dragging with the button held (brush). */
  readonly ziehMalen?: boolean;
  onZelleKlick?(pos: ZellPos): void;
  onKanteKlick?(pos: KantePos): void;
  onHover?(info: HoverInfo | null): void;
}

export interface CellCanvasRueckrufe {
  /** Statuszeile (für die spätere Andockung, AP15.7). / Status line. */
  meldung?(text: string, fehler?: boolean): void;
}

export class CellCanvas {
  private readonly canvas: HTMLCanvasElement;
  private layout: DungeonLayout2 | null = null;
  private gitter: ZellenGitter = { zellen: new Map() };
  private ebene = 0;

  private zoom = 8;
  private mitteX = 0;
  private mitteZ = 0;

  /** Rechte/mittlere Taste zieht das Bild. / Right/middle button pans. */
  private zieht: { x: number; y: number } | null = null;
  /** Linke Taste ist unten (Werkzeug malt). / Left button down (tool paints). */
  private maltLinks = false;
  private hover: HoverInfo | null = null;
  /** Zuletzt ausgelöste Position beim Ziehmalen (Entprellung). / Last painted key. */
  private letzterMalKey = '';

  private werkzeug: ZellWerkzeug | null = null;
  /** Vorschau-Fußabdruck (Stempelpalette). / Preview footprint. */
  private vorschau: readonly { x: number; z: number }[] | null = null;

  // Handler-Referenzen für ein sauberes dispose(). / Handler refs for dispose().
  private readonly aufRad: (e: WheelEvent) => void;
  private readonly aufRunter: (e: MouseEvent) => void;
  private readonly aufBewegung: (e: MouseEvent) => void;
  private readonly aufHoch: () => void;
  private readonly aufMenue: (e: Event) => void;
  private readonly aufRaus: () => void;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly cb: CellCanvasRueckrufe = {}
  ) {
    const c = document.createElement('canvas');
    // Koexistenz über display:block/none wie der Grundriss neben der Weltkarte.
    // Coexistence via display:block/none like the floor plan next to the map.
    c.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:none;cursor:crosshair;z-index:2';
    viewport.appendChild(c);
    this.canvas = c;

    this.aufRad = (e) => {
      e.preventDefault();
      const z = zoomUmZeiger(this.sicht(), e.offsetX, e.offsetY, e.deltaY > 0 ? 0.88 : 1.14, ZOOM_MIN, ZOOM_MAX);
      this.zoom = z.zoom;
      this.mitteX = z.mitteX;
      this.mitteZ = z.mitteZ;
      this.zeichne();
    };
    this.aufRunter = (e) => {
      if (e.button === 0) {
        this.maltLinks = true;
        this.letzterMalKey = '';
        this.loeseAus(e.offsetX, e.offsetY);
      } else {
        // Rechte/mittlere Taste: Bild ziehen. / Right/middle: pan.
        this.zieht = { x: e.clientX, y: e.clientY };
      }
    };
    this.aufBewegung = (e) => {
      if (this.zieht) {
        this.mitteX -= (e.clientX - this.zieht.x) / this.zoom;
        this.mitteZ -= (e.clientY - this.zieht.y) / this.zoom;
        this.zieht = { x: e.clientX, y: e.clientY };
        this.zeichne();
        return;
      }
      // Hover nur, wenn der Zeiger über der Canvas ist. / Hover only over canvas.
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (px < 0 || py < 0 || px > r.width || py > r.height) return;
      this.aktualisiereHover(px, py);
      if (this.maltLinks && this.werkzeug?.ziehMalen) this.loeseAus(px, py);
    };
    this.aufHoch = () => {
      this.zieht = null;
      this.maltLinks = false;
    };
    this.aufMenue = (e) => e.preventDefault();
    this.aufRaus = () => {
      this.hover = null;
      this.werkzeug?.onHover?.(null);
      this.zeichne();
    };

    c.addEventListener('wheel', this.aufRad, { passive: false });
    c.addEventListener('mousedown', this.aufRunter);
    c.addEventListener('contextmenu', this.aufMenue);
    c.addEventListener('mouseleave', this.aufRaus);
    window.addEventListener('mousemove', this.aufBewegung);
    window.addEventListener('mouseup', this.aufHoch);
  }

  // ── Öffentliche Steuerung / public control ────────────────────────────────

  get sichtbar(): boolean {
    return this.canvas.style.display !== 'none';
  }

  zeige(an: boolean): void {
    this.canvas.style.display = an ? 'block' : 'none';
    if (an) this.zeichne();
  }

  /** Ein Layout übernehmen, Gitter neu ausrollen, einpassen und zeichnen. */
  /** Adopt a layout, roll out the grid, fit and draw. */
  setzeLayout(layout: DungeonLayout2 | null): void {
    this.layout = layout;
    this.baueGitter();
    const ebenen = this.ebenen();
    if (!ebenen.includes(this.ebene)) this.ebene = ebenen[0] ?? 0;
    this.passeEin();
    this.zeichne();
  }

  /**
   * Nur das Gitter aus dem aktuellen Layout neu ausrollen (nach einem Eingriff)
   * — OHNE Einpassen, damit der Blick beim Malen nicht springt.
   * Re-roll the grid from the current layout after an edit — WITHOUT refitting,
   * so the view does not jump while painting.
   */
  aktualisiere(layout: DungeonLayout2 | null): void {
    this.layout = layout;
    this.baueGitter();
    this.zeichne();
  }

  private baueGitter(): void {
    this.gitter = this.layout ? dungeon2.zellenAufbauen(this.layout) : { zellen: new Map() };
  }

  /** Ebenen, auf denen wirklich Zellen stehen. / Storeys that actually carry cells. */
  ebenen(): number[] {
    const s = new Set<number>();
    for (const z of this.gitter.zellen.values()) s.add(z.ebene);
    return [...s].sort((a, b) => a - b);
  }

  get aktuelleEbene(): number {
    return this.ebene;
  }

  setzeEbene(ebene: number): void {
    this.ebene = ebene;
    this.zeichne();
  }

  /** Das aktive Werkzeug festlegen (genau eines). / Set the active tool. */
  setzeWerkzeug(w: ZellWerkzeug | null): void {
    this.werkzeug = w;
    this.canvas.style.cursor = w ? 'crosshair' : 'default';
  }

  /** Einen Vorschau-Fußabdruck zeichnen (Stempelpalette) oder löschen. */
  /** Draw a preview footprint (stamp palette) or clear it. */
  setzeVorschau(zellen: readonly { x: number; z: number }[] | null): void {
    this.vorschau = zellen;
    this.zeichne();
  }

  passeEin(): void {
    const zellen = [...this.gitter.zellen.values()].filter((z) => z.ebene === this.ebene);
    let fenster: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
    if (zellen.length > 0) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const z of zellen) {
        minX = Math.min(minX, z.x);
        maxX = Math.max(maxX, z.x);
        minZ = Math.min(minZ, z.z);
        maxZ = Math.max(maxZ, z.z);
      }
      fenster = { minX, maxX, minZ, maxZ };
    }
    const { breite, hoehe } = this.groesse();
    const fit = einpassen(fenster, breite, hoehe, RAND_PX, ZOOM_MIN, ZOOM_MAX, {
      zoom: this.zoom,
      mitteX: this.mitteX,
      mitteZ: this.mitteZ,
    });
    this.zoom = fit.zoom;
    this.mitteX = fit.mitteX;
    this.mitteZ = fit.mitteZ;
  }

  dispose(): void {
    this.canvas.removeEventListener('wheel', this.aufRad);
    this.canvas.removeEventListener('mousedown', this.aufRunter);
    this.canvas.removeEventListener('contextmenu', this.aufMenue);
    this.canvas.removeEventListener('mouseleave', this.aufRaus);
    window.removeEventListener('mousemove', this.aufBewegung);
    window.removeEventListener('mouseup', this.aufHoch);
    this.canvas.remove();
  }

  // ── Interna / internals ───────────────────────────────────────────────────

  private sicht(): Sicht {
    const { breite, hoehe } = this.groesse();
    return { zoom: this.zoom, mitteX: this.mitteX, mitteZ: this.mitteZ, breite, hoehe };
  }

  private groesse(): { breite: number; hoehe: number } {
    return { breite: this.viewport.clientWidth || 800, hoehe: this.viewport.clientHeight || 600 };
  }

  /** Einen Zeiger-Klick an das aktive Werkzeug weiterreichen. */
  /** Forward a pointer click to the active tool. */
  private loeseAus(px: number, py: number): void {
    const w = this.werkzeug;
    if (!w) return;
    const s = this.sicht();
    if (w.pickModus === 'kante') {
      const k = kanteBei(s, px, py, this.ebene);
      const key = `k${k.x}|${k.z}|${k.kante}`;
      if (w.ziehMalen && key === this.letzterMalKey) return;
      this.letzterMalKey = key;
      w.onKanteKlick?.(k);
    } else {
      const z = zelleBei(s, px, py, this.ebene);
      const key = `z${z.x}|${z.z}`;
      if (w.ziehMalen && key === this.letzterMalKey) return;
      this.letzterMalKey = key;
      w.onZelleKlick?.(z);
    }
  }

  private aktualisiereHover(px: number, py: number): void {
    const s = this.sicht();
    const modus = this.werkzeug?.pickModus ?? 'zelle';
    this.hover = {
      zelle: zelleBei(s, px, py, this.ebene),
      kante: kanteBei(s, px, py, this.ebene),
      pickModus: modus,
    };
    this.werkzeug?.onHover?.(this.hover);
    this.zeichne();
  }

  // ── Zeichnen / drawing ────────────────────────────────────────────────────

  private zellFarbe(art: number): string | null {
    switch (art) {
      case ZELLEN_ART.Boden:
        return F.karte;
      case ZELLEN_ART.Treppe:
        return F.erhobenAktiv;
      case ZELLEN_ART.Schacht:
        return F.feld;
      case ZELLEN_ART.Wasser:
        return F.wasserFlaeche;
      default:
        return null; // Leer / Fels: nicht füllen
    }
  }

  /** Bild-Rechteck einer Zelle. / Screen rectangle of a cell. */
  private zellRechteck(x: number, z: number): { x: number; y: number; b: number; h: number } {
    const a = weltZuBild(this.sicht(), x * ZELLE_M, z * ZELLE_M);
    const b = weltZuBild(this.sicht(), (x + 1) * ZELLE_M, (z + 1) * ZELLE_M);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), b: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  /** Bild-Endpunkte einer Zellkante. / Screen endpoints of a cell edge. */
  private kantePunkte(x: number, z: number, kante: Kante): [{ x: number; y: number }, { x: number; y: number }] {
    const s = this.sicht();
    const x0 = x * ZELLE_M;
    const x1 = (x + 1) * ZELLE_M;
    const z0 = z * ZELLE_M;
    const z1 = (z + 1) * ZELLE_M;
    switch (kante) {
      case KANTE.Nord:
        return [weltZuBild(s, x0, z1), weltZuBild(s, x1, z1)];
      case KANTE.Sued:
        return [weltZuBild(s, x0, z0), weltZuBild(s, x1, z0)];
      case KANTE.Ost:
        return [weltZuBild(s, x1, z0), weltZuBild(s, x1, z1)];
      default:
        return [weltZuBild(s, x0, z0), weltZuBild(s, x0, z1)];
    }
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
    ctx.fillStyle = F.grund;
    ctx.fillRect(0, 0, breite, hoehe);

    this.zeichneRaster(ctx, breite, hoehe);

    if (!this.layout) {
      ctx.fillStyle = F.gedimmt;
      ctx.font = `14px ${SCHRIFT.text}`;
      ctx.textAlign = 'center';
      ctx.fillText('Kein Layout geladen.', breite / 2, hoehe / 2);
      return;
    }

    const fenster = sichtbaresFenster(this.sicht());
    const beschriften = this.zoom >= 7;

    // 1) Zellflächen + Bodenton. / cell faces + floor tone.
    for (let x = fenster.minX; x <= fenster.maxX; x++) {
      for (let z = fenster.minZ; z <= fenster.maxZ; z++) {
        const zelle = dungeon2.zelleImGitter(this.gitter, x, z, this.ebene);
        if (zelle === undefined) continue;
        const farbe = this.zellFarbe(zelle.art);
        if (farbe === null) continue;
        const r = this.zellRechteck(x, z);
        ctx.fillStyle = farbe;
        ctx.fillRect(r.x, r.y, r.b, r.h);
        // Bodenhöhe als heller Schleier: höher = heller. / height as a light veil.
        const anteil = Math.max(0, Math.min(1, zelle.boden / BODEN_SKALA));
        if (anteil > 0) {
          ctx.globalAlpha = 0.06 + anteil * 0.32;
          ctx.fillStyle = F.textHell;
          ctx.fillRect(r.x, r.y, r.b, r.h);
          ctx.globalAlpha = 1;
        }
        if (beschriften && zelle.boden !== 0) {
          ctx.fillStyle = F.text;
          ctx.font = `10px ${SCHRIFT.mono}`;
          ctx.textAlign = 'center';
          ctx.fillText(String(zelle.boden), r.x + r.b / 2, r.y + r.h / 2 + 3);
        }
      }
    }

    // 2) Wände aus der symmetrischen Ableitung. / walls from symmetric derivation.
    ctx.strokeStyle = F.textHell;
    ctx.lineWidth = 2;
    for (let x = fenster.minX; x <= fenster.maxX; x++) {
      for (let z = fenster.minZ; z <= fenster.maxZ; z++) {
        const zelle = dungeon2.zelleImGitter(this.gitter, x, z, this.ebene);
        if (zelle === undefined || !dungeon2.offen(zelle.art)) continue;
        for (const kante of KANTEN) {
          const n = dungeon2.nachbarZelle(x, z, kante);
          const nachbar = dungeon2.zelleOderLeer(this.gitter, n.x, n.z, this.ebene);
          if (!dungeon2.wandZwischen(zelle, nachbar)) continue;
          const [a, b] = this.kantePunkte(x, z, kante);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // 3) Türen: kurzer Querbalken auf der Kante. / doors: short bar on the edge.
    ctx.strokeStyle = F.akzentHell;
    ctx.lineWidth = 4;
    for (const t of this.layout.tueren) {
      if (t.ebene !== this.ebene) continue;
      const [a, b] = this.kantePunkte(t.x, t.z, t.kante);
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * 0.25, a.y + (b.y - a.y) * 0.25);
      ctx.lineTo(a.x + (b.x - a.x) * 0.75, a.y + (b.y - a.y) * 0.75);
      ctx.stroke();
    }

    // 4) Deko-Anker: kleiner Punkt in der Zellmitte. / anchors: small dot.
    ctx.fillStyle = F.akzentLicht;
    for (const anker of this.layout.anker) {
      if (anker.ebene !== this.ebene) continue;
      const m = weltZuBild(this.sicht(), (anker.x + 0.5) * ZELLE_M, (anker.z + 0.5) * ZELLE_M);
      ctx.beginPath();
      ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5) Vorschau-Fußabdruck (Stempel). / preview footprint (stamp).
    if (this.vorschau) {
      ctx.fillStyle = F.akzent;
      ctx.globalAlpha = 0.22;
      for (const c of this.vorschau) {
        const r = this.zellRechteck(c.x, c.z);
        ctx.fillRect(r.x, r.y, r.b, r.h);
      }
      ctx.globalAlpha = 1;
    }

    // 6) Hover-Hervorhebung. / hover highlight.
    this.zeichneHover(ctx);
  }

  private zeichneHover(ctx: CanvasRenderingContext2D): void {
    if (!this.hover) return;
    if (this.hover.pickModus === 'kante') {
      const k = this.hover.kante;
      const [a, b] = this.kantePunkte(k.x, k.z, k.kante);
      ctx.strokeStyle = F.akzent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      const r = this.zellRechteck(this.hover.zelle.x, this.hover.zelle.z);
      ctx.fillStyle = F.wahlFlaeche;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(r.x, r.y, r.b, r.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = F.wahlRand;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.b, r.h);
    }
  }

  private zeichneRaster(ctx: CanvasRenderingContext2D, breite: number, hoehe: number): void {
    const schritt = ZELLE_M * this.zoom;
    if (schritt < 6) return;
    ctx.strokeStyle = F.randLeise;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const s = this.sicht();
    const linksOben = bildZuWelt(s, 0, 0);
    const startX = Math.ceil(linksOben.wx / ZELLE_M) * ZELLE_M;
    const startZ = Math.ceil(linksOben.wz / ZELLE_M) * ZELLE_M;
    for (let x = startX; ; x += ZELLE_M) {
      const b = weltZuBild(s, x, 0);
      if (b.x > breite) break;
      ctx.moveTo(b.x, 0);
      ctx.lineTo(b.x, hoehe);
    }
    for (let z = startZ; ; z += ZELLE_M) {
      const b = weltZuBild(s, 0, z);
      if (b.y > hoehe) break;
      ctx.moveTo(0, b.y);
      ctx.lineTo(breite, b.y);
    }
    ctx.stroke();
  }
}
