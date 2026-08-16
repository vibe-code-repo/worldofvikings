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

/**
 * Chunk-Koordinate → Map-Schluessel als ZAHL statt `${cx},${cz}`.
 *
 * Die drei Chunk-Raster unten werden je Vertex mehrfach abgefragt (bis zu
 * 16.900-mal pro Zone allein fuer das Regionsfeld). Ein Vorlagenstring legt
 * dafuer jedes Mal eine frische Zeichenkette an, die der Hash der Map dann
 * auch noch durchlaufen muss — gemessen ein spuerbarer Anteil der Zonenzeit
 * und obendrein Muell fuer den Sammler. Die Zahl ist eindeutig, solange
 * |Chunk| < 2^20 bleibt, also bis ±1,07 Milliarden Meter Weltkoordinate.
 */
const RASTER_VERSATZ = 1 << 20;
const rasterSchluessel = (cx: number, cz: number): number =>
  (cx + RASTER_VERSATZ) * (1 << 21) + (cz + RASTER_VERSATZ);

/**
 * Vorzerlegte Form fuer die heisse Abfrage.
 *
 * `signedDistance` liest bei jedem Aufruf `shape.points[i]` — ein Array aus
 * Arrays, also zwei Zeigerspruenge je Ecke — und rechnet Kantenvektor und
 * Laengenquadrat jedes Mal neu. Bei 30-Ecken-Polygonen und mehreren
 * Kandidaten je Punkt sind das die teuersten Zeilen der ganzen
 * Weltgenerierung (Messung: 56 % der Zonenzeit). Hier stehen dieselben
 * Zahlen flach in einem Float64Array, einmal beim Kompilieren gerechnet.
 *
 * ⚠ Die Arithmetik in `abstandZu` muss Operation fuer Operation die von
 * `signedDistance` bleiben — Server und Client rechnen dieselbe Welt, eine
 * abweichende Klammerung waere schon ein Auseinanderlaufen.
 */
interface FormDaten {
  readonly kreis: boolean;
  /** Kreis: Mittelpunkt und Radius. */
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /** Polygon: je Kante xi, zi, zj, dx, dz, len2 (Reihenfolge wie die Schleife). */
  readonly kanten: Float64Array;
  readonly kantenZahl: number;
}

function zerlege(shape: RegionShape): FormDaten {
  if (shape.kind === 'circle') {
    return {
      kreis: true,
      x: shape.x,
      z: shape.z,
      radius: shape.radius,
      kanten: new Float64Array(0),
      kantenZahl: 0,
    };
  }
  const pts = shape.points;
  const n = pts.length;
  const kanten = new Float64Array(n * 6);
  // Gleiche Paarbildung wie die Originalschleife (i, j = i-1 zyklisch).
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, zi] = pts[i]!;
    const [xj, zj] = pts[j]!;
    const o = i * 6;
    kanten[o] = xi!;
    kanten[o + 1] = zi!;
    kanten[o + 2] = zj!;
    kanten[o + 3] = xj! - xi!;
    kanten[o + 4] = zj! - zi!;
    kanten[o + 5] = (xj! - xi!) * (xj! - xi!) + (zj! - zi!) * (zj! - zi!);
  }
  return { kreis: false, x: 0, z: 0, radius: 0, kanten, kantenZahl: n };
}

/** Wie `signedDistance`, nur auf der vorzerlegten Form. Bit-gleich. */
function abstandZu(f: FormDaten, x: number, z: number): number {
  if (f.kreis) return f.radius - Math.hypot(x - f.x, z - f.z);
  const k = f.kanten;
  let minDist2 = Infinity;
  let innen = false;
  for (let i = 0; i < f.kantenZahl; i++) {
    const o = i * 6;
    const xi = k[o]!;
    const zi = k[o + 1]!;
    const zj = k[o + 2]!;
    const dx = k[o + 3]!;
    const dz = k[o + 4]!;
    const len2 = k[o + 5]!;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - xi) * dx + (z - zi) * dz) / len2)) : 0;
    const px = xi + t * dx - x;
    const pz = zi + t * dz - z;
    const d2 = px * px + pz * pz;
    if (d2 < minDist2) minDist2 = d2;
    if (zi > z !== zj > z && x < (dx * (z - zi)) / dz + xi) innen = !innen;
  }
  const d = Math.sqrt(minDist2);
  return innen ? d : -d;
}

/** Leeres Ergebnis fuer offenen Ozean — konstant, wird nie beschrieben. */
const FELD_LEER: FieldSample = {
  regionA: null,
  distA: -Infinity,
  indexA: -1,
  regionB: null,
  distB: -Infinity,
  indexB: -1,
};

export class RegionField {
  /** Zelle → bis zu MAX_KANDIDATEN Regions-Indizes (+1; 0 = frei). */
  private readonly chunks = new Map<number, Uint16Array>();
  private readonly regions: readonly RegionDef[];
  /** Vorzerlegte Formen, Index-gleich zu `regions`. */
  private readonly formen: FormDaten[];
  /**
   * 1-Eintrag-Memo. RegionGeo fragt DENSELBEN Punkt viermal ab (Basis,
   * Kuestenrauschen und zweimal Nestfaktor ueber landBasis) — gemessen
   * 4,0 Abfragen je Vertex, von denen drei dieselbe Antwort bekommen.
   * Beim Verfehlen entsteht ein NEUES Ergebnisobjekt, damit ein Aufrufer,
   * der ein aelteres Sample noch haelt, es unveraendert weiterlesen kann.
   */
  private memoX = Number.NaN;
  private memoZ = Number.NaN;
  private memo: FieldSample = FELD_LEER;

  constructor(layout: WorldLayout) {
    this.regions = layout.regions;
    this.formen = this.regions.map((r) => zerlege(r.shape));
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
    const key = rasterSchluessel(cx, cz);
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
    if (wx === this.memoX && wz === this.memoZ) return this.memo;
    const s = this.berechne(wx, wz);
    this.memoX = wx;
    this.memoZ = wz;
    this.memo = s;
    return s;
  }

  private berechne(wx: number, wz: number): FieldSample {
    const cx = Math.floor(wx / FIELD_CHUNK_SIZE);
    const cz = Math.floor(wz / FIELD_CHUNK_SIZE);
    const zellen = this.chunks.get(rasterSchluessel(cx, cz));
    if (!zellen) return FELD_LEER;
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
      const sd = abstandZu(this.formen[ri]!, wx, wz);
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
  private readonly chunks = new Map<number, number[]>();
  private readonly stuecke: WasserStueck[] = [];
  /** 1-Eintrag-Memo — siehe RegionField: An einer Biomkante fragt die
   *  Heightmap denselben Vertex viermal ab (einmal je Eckbiom). */
  private memoX = Number.NaN;
  private memoZ = Number.NaN;
  private memo: WasserProbe = WASSER_KEIN;

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
        const key = rasterSchluessel(cx, cz);
        const liste = this.chunks.get(key);
        if (liste) liste.push(index);
        else this.chunks.set(key, [index]);
      }
    }
  }

  /** Nächster Wasserlauf am Punkt (kleinster Abstand ZUM BETTRAND). */
  probe(wx: number, wz: number): WasserProbe {
    if (wx === this.memoX && wz === this.memoZ) return this.memo;
    const p = this.berechne(wx, wz);
    this.memoX = wx;
    this.memoZ = wz;
    this.memo = p;
    return p;
  }

  private berechne(wx: number, wz: number): WasserProbe {
    if (this.stuecke.length === 0) return WASSER_KEIN;
    const liste = this.chunks.get(
      rasterSchluessel(Math.floor(wx / FIELD_CHUNK_SIZE), Math.floor(wz / FIELD_CHUNK_SIZE))
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

/**
 * PlateauField — Nachschlagewerk für Platzierungs-Sockel (`einebnen`).
 *
 * Gleiche Bauart wie WaterField: Chunk-Raster über die Platten, damit eine
 * Abfrage nur die Sockel in der Nähe prüft. Geliefert wird die reine
 * GEOMETRIE (Abstand zum Mittelpunkt, voll geebneter Radius) plus der
 * Platten-Index — die ZIELHÖHE rechnet RegionGeo, weil nur dort die
 * Geländehöhe bekannt ist (sie wird bewusst nie gespeichert, damit der
 * Sockel jeder Höhenänderung des Layouts folgt, wie die Platzierung selbst).
 */
export interface PlateauProbe {
  /** Abstand zum Plattenmittelpunkt in Metern. */
  abstand: number;
  /** Radius, innerhalb dessen das Gelände voll eingeebnet wird. */
  radius: number;
  /** Mittelpunkt — dort misst RegionGeo die Zielhöhe. */
  x: number;
  z: number;
  /** Stabiler Index der Platte — Schlüssel für den Zielhöhen-Cache. */
  index: number;
}

/** Größte Böschungsbreite, die RegionGeo erzeugt — Reichweite des Index. */
export const PLATEAU_RAND_MAX = 64;

export class PlateauField {
  private readonly chunks = new Map<number, number[]>();
  /** null = totgelegte Platte (entfernt) — der Index bleibt vergeben,
   *  weil die Chunk-Listen Indizes speichern (siehe entferne()). */
  private readonly platten: ({ x: number; z: number; radius: number } | null)[] = [];
  /** 1-Eintrag-Memo wie bei WaterField. ACHTUNG: Dieses Feld ist als
   *  einziges zur Laufzeit veraenderlich (Editor-Testflug) — lege() und
   *  entferne() muessen das Memo verwerfen, sonst zeigt der Sockel eine
   *  Abfrage lang noch den alten Stand. */
  private memoX = Number.NaN;
  private memoZ = Number.NaN;
  private memo: PlateauProbe | null = null;

  constructor(layout: WorldLayout) {
    for (const p of layout.placements ?? []) {
      if (p.einebnen && p.einebnen > 0) this.lege(p.x, p.z, p.einebnen);
    }
  }

  /**
   * Platte anlegen — beim Kompilieren UND zur Laufzeit: Der Editor-Testflug
   * muss eine neue Platzierung SOFORT planieren können, ohne die komplette
   * Geo (Regionsfeld, Wasserindex) neu zu bauen. Nachrücken ist billig,
   * weil nur die wenigen berührten Chunks einen Eintrag bekommen.
   */
  lege(x: number, z: number, radius: number): void {
    this.memoX = Number.NaN;
    const index = this.platten.push({ x, z, radius }) - 1;
    const reichweite = radius + PLATEAU_RAND_MAX + FIELD_CELL_SIZE;
    const cx0 = Math.floor((x - reichweite) / FIELD_CHUNK_SIZE);
    const cx1 = Math.floor((x + reichweite) / FIELD_CHUNK_SIZE);
    const cz0 = Math.floor((z - reichweite) / FIELD_CHUNK_SIZE);
    const cz1 = Math.floor((z + reichweite) / FIELD_CHUNK_SIZE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = rasterSchluessel(cx, cz);
        const liste = this.chunks.get(key);
        if (liste) liste.push(index);
        else this.chunks.set(key, [index]);
      }
    }
  }

  /**
   * Platte am Mittelpunkt totlegen (Editor: Platzierung gelöscht oder
   * verschoben). Bewusst KEIN Umbau der Chunk-Listen: Sie speichern
   * Indizes, Nachrücken würde alle folgenden verschieben — der tote
   * Eintrag wird in probe() einfach übersprungen. true = getroffen.
   */
  entferne(x: number, z: number): boolean {
    for (let i = this.platten.length - 1; i >= 0; i--) {
      const pl = this.platten[i];
      if (pl && Math.abs(pl.x - x) < 0.05 && Math.abs(pl.z - z) < 0.05) {
        this.platten[i] = null;
        this.memoX = Number.NaN;
        return true;
      }
    }
    return false;
  }

  /** Diagnose/Tests: Anzahl der lebenden Sockel-Platten. */
  get plattenAnzahl(): number {
    return this.platten.reduce((n, pl) => (pl ? n + 1 : n), 0);
  }

  /** Nächste Platte am Punkt (kleinster Abstand ZUM PLATTENRAND). */
  probe(wx: number, wz: number): PlateauProbe | null {
    if (wx === this.memoX && wz === this.memoZ) return this.memo;
    const p = this.berechne(wx, wz);
    this.memoX = wx;
    this.memoZ = wz;
    this.memo = p;
    return p;
  }

  private berechne(wx: number, wz: number): PlateauProbe | null {
    if (this.platten.length === 0) return null;
    const liste = this.chunks.get(
      rasterSchluessel(Math.floor(wx / FIELD_CHUNK_SIZE), Math.floor(wz / FIELD_CHUNK_SIZE))
    );
    if (!liste) return null;
    let beste: PlateauProbe | null = null;
    let bestRand = Infinity;
    for (const i of liste) {
      const pl = this.platten[i];
      if (!pl) continue;
      const dist = Math.hypot(wx - pl.x, wz - pl.z);
      const rand = dist - pl.radius;
      if (rand < bestRand) {
        bestRand = rand;
        beste = { abstand: dist, radius: pl.radius, x: pl.x, z: pl.z, index: i };
      }
    }
    return bestRand <= PLATEAU_RAND_MAX ? beste : null;
  }
}
