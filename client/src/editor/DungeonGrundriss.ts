/**
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
 * Funktionen, die Server, Generator und der F4-Editor benutzen. Eine
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
 * Heute liegt alles auf y = 0, das Kit hat keine Treppe. Der Filter ist
 * trotzdem schon da: Sobald es Ebenen gibt, überlagern sich zwei
 * Stockwerke im Bild zu einem unlesbaren Knäuel, und das ist der Moment,
 * in dem man ihn braucht — nicht danach.
 */
import {
  DUNGEONS_BY_NAME,
  attachRoom,
  computeOpenConnections,
  removeRoom,
  type DungeonDocument,
  type OpenConnection,
  type PlacedRoom,
  type Quaternion,
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
  schrift: '#e8d9b8',
} as const;

/** Ein Punkt in Weltkoordinaten des Dungeons. */
interface Punkt {
  x: number;
  z: number;
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

export interface GrundrissRueckrufe {
  /** Kurzmeldung in der Shell. */
  meldung(text: string, fehler?: boolean): void;
  /** Auswahl hat sich geändert — die Seitenleiste zeichnet sich neu. */
  auswahlGeaendert(): void;
}

export class DungeonGrundriss {
  private readonly canvas: HTMLCanvasElement;
  private doc: DungeonDocument | null = null;
  private offene: OpenConnection[] = [];
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

  /** Ebenen, auf denen wirklich Räume stehen — Futter für den Filter. */
  get ebenen(): number[] {
    const s = new Set<number>();
    for (const r of this.doc?.layout.rooms ?? []) s.add(Math.round(r.pos.y));
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

  /** Raum an eine offene Verbindung anfügen (dieselbe Funktion wie F4). */
  fuegeAn(connIndex: number, raumName: string): boolean {
    const doc = this.doc;
    const conn = this.offene[connIndex];
    if (!doc || !conn) return false;
    const ergebnis = attachRoom(doc.layout, doc.base, conn, raumName);
    if (!ergebnis.ok) {
      this.cb.meldung(ergebnis.reason ?? 'Raum passt hier nicht', true);
      return false;
    }
    // `attachRoom` RECHNET nur und veraendert nichts — anhaengen ist Sache
    // des Aufrufers (so steht es dort auch im Kommentar). Ohne diese Zeile
    // meldet der Editor „angefuegt" und nichts passiert: Der Raum wird
    // geprueft, passend gedreht, und dann fallen gelassen.
    doc.layout.rooms.push(ergebnis.placed);
    // Von Hand gebaut heisst „custom": Ein `generated`-Dokument wird beim
    // naechsten Materialisieren aus Seed und Regeln neu erzeugt, und der
    // angefuegte Raum waere spurlos weg. Dieselbe Zeile steht im F4-Editor.
    doc.mode = 'custom';
    this.aktualisiereOffene();
    this.zeichne();
    this.cb.auswahlGeaendert();
    this.cb.meldung(`${raumName} angefügt — ${doc.layout.rooms.length} Räume`);
    return true;
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
  }

  /** Maßstab und Mitte so wählen, dass der ganze Grundriss ins Bild passt. */
  passeEin(): void {
    const rooms = this.doc?.layout.rooms ?? [];
    if (rooms.length === 0) return;
    const def = DUNGEONS_BY_NAME.get(this.doc!.base);
    const byName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of rooms) {
      const rd = byName.get(r.room);
      if (!rd) continue;
      for (const p of ecken(r.pos, r.rot, rd.size)) {
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
    return this.ebene === null || Math.round(r.pos.y) === this.ebene;
  }

  private waehleBei(px: number, py: number): void {
    const doc = this.doc;
    if (!doc) return;
    const welt = this.zuWelt(px, py);
    const def = DUNGEONS_BY_NAME.get(doc.base);
    const byName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);
    // Von hinten nach vorn: Was zuletzt gezeichnet wurde, liegt oben und
    // soll zuerst getroffen werden.
    for (let i = doc.layout.rooms.length - 1; i >= 0; i--) {
      const r = doc.layout.rooms[i]!;
      if (!this.sichtbarAufEbene(r)) continue;
      const rd = byName.get(r.room);
      if (!rd) continue;
      if (imPolygon(welt, ecken(r.pos, r.rot, rd.size))) {
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

    const def = DUNGEONS_BY_NAME.get(doc.base);
    const byName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);

    doc.layout.rooms.forEach((r, i) => {
      if (!this.sichtbarAufEbene(r)) return;
      const rd = byName.get(r.room);
      if (!rd) return;
      const ecks = ecken(r.pos, r.rot, rd.size).map((p) => this.zuBild(p));
      ctx.beginPath();
      ctx.moveTo(ecks[0]!.x, ecks[0]!.y);
      for (const p of ecks.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = i === this.gewaehlt ? FARBE.raumGewaehlt : FARBE.raum;
      ctx.fill();
      ctx.strokeStyle = rd.entrance ? FARBE.eingang : FARBE.raumRand;
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
      const raum = doc.layout.rooms[c.roomIndex];
      if (raum && !this.sichtbarAufEbene(raum)) continue;
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
  }

  private zeichneRaster(ctx: CanvasRenderingContext2D, breite: number, hoehe: number): void {
    // Raster im 4-m-Takt des Kits — es sagt beim Hinsehen, ob ein Teil
    // wirklich auf dem Raster sitzt.
    const schritt = 4 * this.zoom;
    if (schritt < 6) return;
    ctx.strokeStyle = FARBE.raster;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const linksWelt = this.zuWelt(0, 0);
    const startX = Math.ceil(linksWelt.x / 4) * 4;
    const startZ = Math.ceil(linksWelt.z / 4) * 4;
    for (let x = startX; ; x += 4) {
      const b = this.zuBild({ x, z: 0 });
      if (b.x > breite) break;
      ctx.moveTo(b.x, 0);
      ctx.lineTo(b.x, hoehe);
    }
    for (let z = startZ; ; z += 4) {
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
