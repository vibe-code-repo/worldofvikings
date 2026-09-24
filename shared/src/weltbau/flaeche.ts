/**
 * flaeche.ts — kleine 2D-Geometrie für die Weltprüfung: gedrehte Rechtecke
 * (Grundflächen), Schnittfläche, Abstand Punkt–Fläche. DOM-frei,
 * deterministisch, ohne Abhängigkeit.
 *
 * Small 2D geometry for the world check: rotated rectangles (footprints),
 * intersection area, point-to-polygon distance.
 */

export interface Punkt {
  x: number;
  z: number;
}

/** Konvexes Polygon, gegen den Uhrzeigersinn (positive Fläche im x/z-System). */
export type Polygon = readonly Punkt[];

/**
 * Drehung um die Hochachse wie in Babylon (`rotation.y = yaw`, linkshändig):
 * `x' = x·cos + z·sin`, `z' = −x·sin + z·cos`.
 */
export function drehe(lx: number, lz: number, yaw: number): Punkt {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/**
 * Rechteck um `(mitteX, mitteZ)` (lokal, schon mit Skalierung) mit den
 * Halbkanten `halbX`/`halbZ`, um `yaw` gedreht und nach `(x, z)` gesetzt.
 */
export function rechteck(
  x: number,
  z: number,
  yaw: number,
  mitteX: number,
  mitteZ: number,
  halbX: number,
  halbZ: number
): Polygon {
  const lokal: ReadonlyArray<readonly [number, number]> = [
    [mitteX - halbX, mitteZ - halbZ],
    [mitteX + halbX, mitteZ - halbZ],
    [mitteX + halbX, mitteZ + halbZ],
    [mitteX - halbX, mitteZ + halbZ],
  ];
  return lokal.map(([lx, lz]) => {
    const p = drehe(lx, lz, yaw);
    return { x: x + p.x, z: z + p.z };
  });
}

/** Fläche (immer ≥ 0). */
export function polygonFlaeche(p: Polygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

/** Schwerpunkt der Ecken (für ein Polygon ohne Fläche der Mittelwert). */
export function eckenMitte(p: Polygon): Punkt {
  let sx = 0;
  let sz = 0;
  for (const q of p) {
    sx += q.x;
    sz += q.z;
  }
  return { x: sx / p.length, z: sz / p.length };
}

/** Achsparallele Hülle: `[minX, minZ, maxX, maxZ]`. */
export function huelleVon(p: Polygon): readonly [number, number, number, number] {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const q of p) {
    if (q.x < a) a = q.x;
    if (q.z < b) b = q.z;
    if (q.x > c) c = q.x;
    if (q.z > d) d = q.z;
  }
  return [a, b, c, d];
}

/** Schnitt zweier konvexer Polygone (Sutherland–Hodgman), leer wenn sie sich nicht berühren. */
export function schneide(subjekt: Polygon, klinge: Polygon): Polygon {
  let aus: Punkt[] = subjekt.slice();
  for (let i = 0; i < klinge.length && aus.length > 0; i++) {
    const a = klinge[i];
    const b = klinge[(i + 1) % klinge.length];
    const innen = (p: Punkt): number => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
    const eingang = aus;
    aus = [];
    for (let j = 0; j < eingang.length; j++) {
      const p = eingang[j];
      const q = eingang[(j + 1) % eingang.length];
      const dp = innen(p);
      const dq = innen(q);
      if (dp >= 0) aus.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        aus.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return aus;
}

/** Liegt der Punkt in (oder auf) dem konvexen Polygon? */
export function punktInPolygon(pt: Punkt, p: Polygon): boolean {
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    if ((b.x - a.x) * (pt.z - a.z) - (b.z - a.z) * (pt.x - a.x) < 0) return false;
  }
  return true;
}

/** Kürzester Abstand vom Punkt zur Polygonfläche (0 innen). */
export function abstandZuPolygon(pt: Punkt, p: Polygon): number {
  if (punktInPolygon(pt, p)) return 0;
  let best = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / l2));
    const d = Math.hypot(pt.x - (a.x + dx * t), pt.z - (a.z + dz * t));
    if (d < best) best = d;
  }
  return best;
}
