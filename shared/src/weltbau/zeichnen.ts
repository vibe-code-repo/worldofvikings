/**
 * Kleine Rasterfunktionen für die Weltkarte (map_render): Linie, gedrehtes
 * Rechteck, Kreis, Kreuz, Umriss. Alles auf einem RGBA-Puffer, reine CPU-Arbeit
 * ohne DOM und ohne Abhängigkeit, damit dieselbe Rechnung im Test und im
 * MCP-Prozess läuft. Koordinaten sind Bildpunkte (x nach rechts, y nach unten,
 * Pixelmitte bei +0,5).
 */

export type Farbe = readonly [number, number, number];

/** RGBA-Puffer mit Breite und Höhe. */
export class Leinwand {
  readonly daten: Uint8Array;
  constructor(
    readonly breite: number,
    readonly hoehe: number
  ) {
    if (!Number.isInteger(breite) || !Number.isInteger(hoehe) || breite < 1 || hoehe < 1) {
      throw new Error(`Leinwand: ungueltige Groesse ${breite}x${hoehe}`);
    }
    this.daten = new Uint8Array(breite * hoehe * 4);
  }

  /** Farbe mit Deckkraft (0..1) auf einen Bildpunkt legen; außerhalb wird nichts gezeichnet. */
  punkt(x: number, y: number, f: Farbe, deckung = 1): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.breite || iy >= this.hoehe) return;
    const o = (iy * this.breite + ix) * 4;
    const d = this.daten;
    if (deckung >= 1) {
      d[o] = f[0];
      d[o + 1] = f[1];
      d[o + 2] = f[2];
    } else {
      d[o] = d[o] + (f[0] - d[o]) * deckung;
      d[o + 1] = d[o + 1] + (f[1] - d[o + 1]) * deckung;
      d[o + 2] = d[o + 2] + (f[2] - d[o + 2]) * deckung;
    }
    d[o + 3] = 255;
  }

  lies(x: number, y: number): [number, number, number] {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.breite || iy >= this.hoehe) return [0, 0, 0];
    const o = (iy * this.breite + ix) * 4;
    return [this.daten[o], this.daten[o + 1], this.daten[o + 2]];
  }

  /** Linie (Bresenham) mit Strichbreite in Pixeln (1 = ein Pixel). */
  linie(x0: number, y0: number, x1: number, y1: number, f: Farbe, breite = 1): void {
    // Auf das Bild (mit Rand für die Strichbreite) beschneiden, sonst kostet eine Linie von
    // weit außerhalb Millionen Schritte (Liang–Barsky).
    const rand = breite + 1;
    let t0 = 0;
    let t1 = 1;
    const ddx = x1 - x0;
    const ddy = y1 - y0;
    const p = [-ddx, ddx, -ddy, ddy];
    const q = [x0 + rand, this.breite + rand - x0, y0 + rand, this.hoehe + rand - y0];
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) return;
      } else {
        const t = q[k] / p[k];
        if (p[k] < 0) {
          if (t > t1) return;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return;
          if (t < t1) t1 = t;
        }
      }
    }
    let ax = Math.floor(x0 + t0 * ddx);
    let ay = Math.floor(y0 + t0 * ddy);
    const bx = Math.floor(x0 + t1 * ddx);
    const by = Math.floor(y0 + t1 * ddy);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let fehler = dx + dy;
    const r = Math.max(0, Math.floor((breite - 1) / 2));
    // Schutz gegen absurd lange Linien außerhalb des Bildes: an den Bildrand klemmen.
    const grenze = (dx + Math.abs(dy)) * 2 + 4;
    for (let n = 0; n < grenze; n++) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) this.punkt(ax + i, ay + j, f);
      if (ax === bx && ay === by) break;
      const e2 = 2 * fehler;
      if (e2 >= dy) {
        fehler += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        fehler += dx;
        ay += sy;
      }
    }
  }

  /** Gefülltes Rechteck aus vier Ecken (konvex, beliebig gedreht). */
  polygonFuellen(ecken: ReadonlyArray<readonly [number, number]>, f: Farbe, deckung = 1): void {
    if (ecken.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const e of ecken) {
      if (e[1] < minY) minY = e[1];
      if (e[1] > maxY) maxY = e[1];
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.hoehe - 1, Math.floor(maxY));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let k = 0; k < ecken.length; k++) {
        const a = ecken[k];
        const b = ecken[(k + 1) % ecken.length];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
          xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k]));
        const xb = Math.min(this.breite, Math.round(xs[k + 1]));
        for (let x = xa; x < xb; x++) this.punkt(x, y, f, deckung);
      }
    }
  }

  /** Umriss eines Polygons (geschlossen). */
  polygonUmriss(ecken: ReadonlyArray<readonly [number, number]>, f: Farbe, breite = 1): void {
    for (let k = 0; k < ecken.length; k++) {
      const a = ecken[k];
      const b = ecken[(k + 1) % ecken.length];
      this.linie(a[0], a[1], b[0], b[1], f, breite);
    }
  }

  /** Gefüllter Kreis um (cx, cy). */
  kreis(cx: number, cy: number, r: number, f: Farbe, deckung = 1): void {
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.hoehe - 1, Math.ceil(cy + r));
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.breite - 1, Math.ceil(cx + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.punkt(x, y, f, deckung);
      }
    }
  }

  /** Kreisumriss (Ring von einem Pixel Dicke). */
  ring(cx: number, cy: number, r: number, f: Farbe): void {
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.hoehe - 1, Math.ceil(cy + r + 1));
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.breite - 1, Math.ceil(cx + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (Math.abs(d - r) <= 0.75) this.punkt(x, y, f);
      }
    }
  }

  /** Kreuz (Diagonalen) mit Halbgröße h. */
  kreuz(cx: number, cy: number, h: number, f: Farbe, breite = 1): void {
    this.linie(cx - h, cy - h, cx + h, cy + h, f, breite);
    this.linie(cx - h, cy + h, cx + h, cy - h, f, breite);
  }
}

/**
 * Vier Ecken eines um (cx, cz) mit `yaw` (Radiant, um die Hochachse, wie im
 * Dokument) gedrehten Rechtecks mit den Halbkanten halbX/halbZ, in Weltmetern.
 * Konvention wie eine Drehung um Y: lokal (lx, lz) → Welt
 * (cx + lx·cos + lz·sin, cz − lx·sin + lz·cos).
 */
export function gedrehtesRechteck(
  cx: number,
  cz: number,
  halbX: number,
  halbZ: number,
  yaw: number
): Array<[number, number]> {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lokal: Array<[number, number]> = [
    [-halbX, -halbZ],
    [halbX, -halbZ],
    [halbX, halbZ],
    [-halbX, halbZ],
  ];
  return lokal.map(([lx, lz]) => [cx + lx * c + lz * s, cz - lx * s + lz * c]);
}
