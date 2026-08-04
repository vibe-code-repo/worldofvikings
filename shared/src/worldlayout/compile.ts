/**
 * RegionField — das kompilierte Laufzeitformat eines WorldLayouts.
 *
 * Kernfrage der Laufzeit ist „welche Region(en) betreffen diesen Punkt, und
 * wie weit ist er von ihrem Rand entfernt?" — pro Heightmap-Zone 16.900-mal.
 * Ein naiver Scan über alle Regionen × Polygonkanten wäre dafür zu teuer.
 *
 * Aufteilung:
 *  - Der KANDIDATEN-Index ist gerastert: 1024-m-Chunks à 32×32 Zellen
 *    (32 m). Jede Zelle merkt sich bis zu 4 Regionen, die dort relevant
 *    sein können (inkl. Falloff-Rand + Sicherheitsmarge). Chunks ohne
 *    Eintrag = offener Ozean — leere See kostet weder Zeit noch Speicher,
 *    die Karte kann unbegrenzt wachsen.
 *  - Die DISTANZ selbst wird pro Abfrage ANALYTISCH gegen die 1–4
 *    Kandidaten-Formen gerechnet (Kreis: r−|p−c|; Polygon: minimale
 *    Kantendistanz, Vorzeichen per Even-Odd). Dadurch ist das Höhenfeld
 *    glatt — ein gerastertes Distanzfeld hätte 32-m-Terrassen in jede
 *    Küste gestanzt.
 *
 * Auswahlregel (Z-Ordnung): Unter allen Kandidaten mit signedDist > 0
 * gewinnt der SPÄTESTE im Layout (Overlay überdeckt Untergrund); liegt der
 * Punkt in keiner Region, gewinnt die nächstgelegene. Der Zweitplatzierte
 * wird mitgeliefert — RegionGeo blendet damit Grenzen ohne Höhenklippen.
 */

import {
  shapeBounds,
  type RegionDef,
  type RegionShape,
  type WorldLayout,
} from './types.js';

export const FIELD_CHUNK_SIZE = 1024;
export const FIELD_CELL_SIZE = 32;
const CELLS = FIELD_CHUNK_SIZE / FIELD_CELL_SIZE; // 32
const MAX_KANDIDATEN = 4;
/**
 * Sicherheitsmarge um jede Region: Zelldiagonale + Grundpuffer + die
 * maximale Küstenrausch-Amplitude von RegionGeo (±110 m verschieben die
 * effektive Randdistanz). Zu knapp bemessen "ploppt" am Feldende Land aus
 * dem Ozean — gemessen als 6,8-m-Kante im Phase-2-Test.
 */
const MARGE = 256;

export interface FieldSample {
  /** Gewinner nach Z-Regel; null = offener Ozean (keine Region in Reichweite). */
  regionA: RegionDef | null;
  /** Vorzeichenbehaftete Randdistanz von regionA (>0 = innen), Meter. */
  distA: number;
  /** Z-Index (Layout-Position) von regionA — für Blend-Reihenfolgen. */
  indexA: number;
  /** Zweitplatzierter für Grenz-Blends (null, wenn keiner in Reichweite). */
  regionB: RegionDef | null;
  distB: number;
  indexB: number;
}

/** Vorzeichenbehaftete Distanz zum Formrand: >0 innen, <0 außen (Meter). */
export function signedDistance(shape: RegionShape, x: number, z: number): number {
  if (shape.kind === 'circle') {
    return shape.radius - Math.hypot(x - shape.x, z - shape.z);
  }
  const pts = shape.points;
  let minDist2 = Infinity;
  let innen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]!;
    const [xj, zj] = pts[j]!;
    // Punkt-zu-Segment-Distanz (Quadrat, Wurzel erst am Ende).
    const dx = xj - xi;
    const dz = zj - zi;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - xi) * dx + (z - zi) * dz) / len2)) : 0;
    const px = xi + t * dx - x;
    const pz = zi + t * dz - z;
    const d2 = px * px + pz * pz;
    if (d2 < minDist2) minDist2 = d2;
    // Even-Odd-Kreuzungstest für das Vorzeichen.
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) innen = !innen;
  }
  const d = Math.sqrt(minDist2);
  return innen ? d : -d;
}

const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export class RegionField {
  /** Zelle → bis zu MAX_KANDIDATEN Regions-Indizes (+1; 0 = frei). */
  private readonly chunks = new Map<string, Uint16Array>();
  private readonly regions: readonly RegionDef[];

  constructor(layout: WorldLayout) {
    this.regions = layout.regions;
    this.compile();
  }

  /** Anzahl kompilierter Chunks — Diagnose/Tests. */
  get chunkCount(): number {
    return this.chunks.size;
  }

  private compile(): void {
    // Je Region: betroffene Chunks markieren und ihre Zellen-Kandidaten
    // auffüllen. Die Reichweite ist edgeFalloff + Marge — weiter draußen
    // beeinflusst die Region weder Biom noch Höhe.
    for (let ri = 0; ri < this.regions.length; ri++) {
      const region = this.regions[ri]!;
      const reichweite = region.edgeFalloff + MARGE;
      const b = shapeBounds(region.shape);
      const cx0 = Math.floor((b.minX - reichweite) / FIELD_CHUNK_SIZE);
      const cx1 = Math.floor((b.maxX + reichweite) / FIELD_CHUNK_SIZE);
      const cz0 = Math.floor((b.minZ - reichweite) / FIELD_CHUNK_SIZE);
      const cz1 = Math.floor((b.maxZ + reichweite) / FIELD_CHUNK_SIZE);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          this.fuelleChunk(cx, cz, ri, reichweite);
        }
      }
    }
  }

  private fuelleChunk(cx: number, cz: number, ri: number, reichweite: number): void {
    const region = this.regions[ri]!;
    const key = chunkKey(cx, cz);
    let zellen = this.chunks.get(key);
    for (let iz = 0; iz < CELLS; iz++) {
      for (let ix = 0; ix < CELLS; ix++) {
        const x = cx * FIELD_CHUNK_SIZE + (ix + 0.5) * FIELD_CELL_SIZE;
        const z = cz * FIELD_CHUNK_SIZE + (iz + 0.5) * FIELD_CELL_SIZE;
        if (signedDistance(region.shape, x, z) <= -reichweite) continue;
        if (!zellen) {
          zellen = new Uint16Array(CELLS * CELLS * MAX_KANDIDATEN);
          this.chunks.set(key, zellen);
        }
        const o = (iz * CELLS + ix) * MAX_KANDIDATEN;
        for (let k = 0; k < MAX_KANDIDATEN; k++) {
          if (zellen[o + k] === 0) {
            zellen[o + k] = ri + 1;
            break;
          }
          // Voll: den Z-niedrigsten (frühesten) Kandidaten verdrängen —
          // spätere Regionen überdecken laut Regel ohnehin.
          if (k === MAX_KANDIDATEN - 1) {
            let minK = 0;
            for (let m = 1; m < MAX_KANDIDATEN; m++) {
              if (zellen[o + m]! < zellen[o + minK]!) minK = m;
            }
            if (zellen[o + minK]! < ri + 1) zellen[o + minK] = ri + 1;
          }
        }
      }
    }
  }

  /**
   * Kandidaten am Punkt abfragen und die Z-Regel EXAKT auswerten.
   * Wiederverwendetes Ergebnisobjekt vermeiden wir bewusst — die Aufrufer
   * (Heightmap-Bau) halten Samples nicht über den Aufruf hinaus.
   */
  sample(wx: number, wz: number): FieldSample {
    const cx = Math.floor(wx / FIELD_CHUNK_SIZE);
    const cz = Math.floor(wz / FIELD_CHUNK_SIZE);
    const zellen = this.chunks.get(chunkKey(cx, cz));
    if (!zellen) {
      return { regionA: null, distA: -Infinity, indexA: -1, regionB: null, distB: -Infinity, indexB: -1 };
    }
    const ix = Math.min(CELLS - 1, Math.max(0, Math.floor((wx - cx * FIELD_CHUNK_SIZE) / FIELD_CELL_SIZE)));
    const iz = Math.min(CELLS - 1, Math.max(0, Math.floor((wz - cz * FIELD_CHUNK_SIZE) / FIELD_CELL_SIZE)));
    const o = (iz * CELLS + ix) * MAX_KANDIDATEN;

    let aIdx = -1;
    let aDist = -Infinity;
    let bIdx = -1;
    let bDist = -Infinity;
    for (let k = 0; k < MAX_KANDIDATEN; k++) {
      const stored = zellen[o + k]!;
      if (stored === 0) break;
      const ri = stored - 1;
      const sd = signedDistance(this.regions[ri]!.shape, wx, wz);
      const gewinnt =
        aIdx === -1
          ? true
          : sd > 0 && aDist > 0
            ? ri > aIdx // beide innen: Z-Ordnung entscheidet
            : sd > 0
              ? true // innen schlägt außen
              : aDist > 0
                ? false
                : sd > aDist; // beide außen: näher gewinnt
      if (gewinnt) {
        bIdx = aIdx;
        bDist = aDist;
        aIdx = ri;
        aDist = sd;
      } else if (
        bIdx === -1 ||
        (sd > 0 && bDist > 0 ? ri > bIdx : sd > 0 ? true : bDist > 0 ? false : sd > bDist)
      ) {
        bIdx = ri;
        bDist = sd;
      }
    }
    return {
      regionA: aIdx >= 0 ? this.regions[aIdx]! : null,
      distA: aDist,
      indexA: aIdx,
      regionB: bIdx >= 0 ? this.regions[bIdx]! : null,
      distB: bDist,
      indexB: bIdx,
    };
  }
}

/**
 * WaterField — Nachschlagewerk für Flüsse und Seen.
 *
 * Gleiche Bauart wie RegionField: ein Chunk-Raster über die Segmente,
 * damit eine Abfrage nur die wenigen Wasserläufe in der Nähe prüft statt
 * aller. Geliefert wird die reine GEOMETRIE (Abstand zur Wasserachse,
 * halbe Bettbreite, Tiefe) — die Böschung rechnet RegionGeo, weil nur
 * dort die Landhöhe bekannt ist: Ein tiefer Einschnitt braucht ein
 * breiteres Ufer, sonst steht die Wand senkrecht.
 */
export interface WasserProbe {
  /** Abstand zur Wasserachse in Metern; Infinity = kein Wasser in der Nähe. */
  abstand: number;
  /** Halbe Bettbreite (Fluss) bzw. Radius (See). */
  halbbreite: number;
  /** Bett-Tiefe unter der Wasserlinie in Metern. */
  tiefe: number;
}

const WASSER_KEIN: WasserProbe = { abstand: Infinity, halbbreite: 0, tiefe: 0 };
/** Größte Uferbreite, die RegionGeo erzeugen kann — Reichweite des Index. */
export const UFER_MAX = 200;

interface WasserStueck {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  halbbreite: number;
  tiefe: number;
}

export class WaterField {
  private readonly chunks = new Map<string, number[]>();
  private readonly stuecke: WasserStueck[] = [];

  constructor(layout: WorldLayout) {
    for (const fluss of layout.rivers ?? []) {
      const tiefe = fluss.depth ?? 6;
      for (let i = 0; i + 1 < fluss.points.length; i++) {
        const [ax, az] = fluss.points[i]!;
        const [bx, bz] = fluss.points[i + 1]!;
        this.lege({ ax, az, bx, bz, halbbreite: fluss.width / 2, tiefe });
      }
    }
    for (const see of layout.lakes ?? []) {
      this.lege({
        ax: see.x, az: see.z, bx: see.x, bz: see.z,
        halbbreite: see.radius, tiefe: see.depth ?? 8,
      });
    }
  }

  get stueckAnzahl(): number {
    return this.stuecke.length;
  }

  private lege(st: WasserStueck): void {
    const index = this.stuecke.push(st) - 1;
    const reichweite = st.halbbreite + UFER_MAX + FIELD_CELL_SIZE;
    const cx0 = Math.floor((Math.min(st.ax, st.bx) - reichweite) / FIELD_CHUNK_SIZE);
    const cx1 = Math.floor((Math.max(st.ax, st.bx) + reichweite) / FIELD_CHUNK_SIZE);
    const cz0 = Math.floor((Math.min(st.az, st.bz) - reichweite) / FIELD_CHUNK_SIZE);
    const cz1 = Math.floor((Math.max(st.az, st.bz) + reichweite) / FIELD_CHUNK_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${cx},${cz}`;
        const liste = this.chunks.get(key);
        if (liste) liste.push(index);
        else this.chunks.set(key, [index]);
      }
    }
  }

  /** Nächster Wasserlauf am Punkt (kleinster Abstand ZUM BETTRAND). */
  probe(wx: number, wz: number): WasserProbe {
    if (this.stuecke.length === 0) return WASSER_KEIN;
    const liste = this.chunks.get(
      `${Math.floor(wx / FIELD_CHUNK_SIZE)},${Math.floor(wz / FIELD_CHUNK_SIZE)}`
    );
    if (!liste) return WASSER_KEIN;
    let beste = WASSER_KEIN;
    let bestRand = Infinity;
    for (const i of liste) {
      const st = this.stuecke[i]!;
      // Punkt-zu-Segment-Abstand (bei Seen ist a == b, also Punktabstand).
      const dx = st.bx - st.ax;
      const dz = st.bz - st.az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((wx - st.ax) * dx + (wz - st.az) * dz) / len2)) : 0;
      const px = st.ax + t * dx - wx;
      const pz = st.az + t * dz - wz;
      const dist = Math.hypot(px, pz);
      const rand = dist - st.halbbreite;
      if (rand < bestRand) {
        bestRand = rand;
        beste = { abstand: dist, halbbreite: st.halbbreite, tiefe: st.tiefe };
      }
    }
    return bestRand <= UFER_MAX ? beste : WASSER_KEIN;
  }
}
