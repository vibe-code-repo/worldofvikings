/**
 * RegionGeo — layoutgetriebene Weltgenerierung (Phase 2 des
 * Kartengenerierungs-Umbaus).
 *
 * Erweitert GeoManager und ersetzt genau drei Dinge:
 *
 *  1. `getBiome`: kommt aus dem Regionen-Distanzfeld statt aus der radialen
 *     Formel — außerhalb aller Regionen ist offener Ozean.
 *  2. `getBaseHeight`: regionsbasierte Basis (Plateau je Region + dasselbe
 *     kontinentale Perlin-Detail wie im Original, aber OHNE Weltrand,
 *     Zentrums-Deckel und Kanal-Radialgates) mit Küsten-Falloff und
 *     Grenz-Blend zwischen benachbarten/überlappenden Regionen.
 *  3. `generate`: No-op — die radiale Seen-/Fluss-/Bachgenerierung entfällt
 *     (Boot in Sekunden; Designer-Flüsse folgen später als Layout-Inhalt).
 *
 * ALLE Biomhöhenfunktionen (Meadows/Mountain/…) erben unverändert und
 * laufen über `this.getBaseHeight` auf der neuen Basis — das Perlin-Detail
 * innerhalb einer Region ist damit exakt das des Originals. Der
 * 64-m-Eckbiom-Blend der Heightmap und der Client-Splat bleiben unberührt.
 */

import { GeoManager, type GeoManagerSettings } from './GeoManager.js';
import { perlinNoise } from './Perlin.js';
import { smoothStep, lerp } from './Mathf.js';
import { Biome } from '../types.js';
import {
  BIOME_BY_NAME,
  DEFAULT_BASE_LEVEL,
  RegionField,
  type FieldSample,
  type RegionDef,
  type WorldLayout,
} from '../worldlayout/index.js';

const f32 = Math.fround;

/** Basis des offenen Ozeans (normiert; ×200 = −56 m — segelbar, kein Abgrund). */
const OZEAN_BASIS = -0.28;
/** Ab dieser Basis gilt ein Punkt als Ozean-BIOM (wie die radiale Formel). */
const OZEAN_SCHWELLE = 0.02;
/** Amplitude der Küstenlinien-Verzerrung (m) — macht Ränder organisch. */
const KUESTEN_RAUSCHEN = 110;

export class RegionGeo extends GeoManager {
  private feld!: RegionField;
  readonly layout: WorldLayout;

  // 1-Eintrag-Memo: Die Heightmap wertet pro Vertex bis zu 4 Eckbiome an
  // DERSELBEN Position aus — jede davon ruft getBaseHeight. Ohne Memo
  // liefe das Distanzfeld vierfach (Muster: cachedGridKey im GeoManager).
  private memoX = Number.NaN;
  private memoY = Number.NaN;
  private memoBase = 0;

  constructor(worldSeed: number, settings: GeoManagerSettings | undefined, layout: WorldLayout) {
    // Der Basis-Konstruktor ruft postWorldInit() (Detail-Offsets) und das
    // hier überschriebene generate() — der No-op darf keine eigenen Felder
    // anfassen, `feld` entsteht erst danach.
    super(worldSeed, settings);
    this.layout = layout;
    this.feld = new RegionField(layout);
  }

  /** Radiale Seen/Flüsse/Bäche entfallen im Layout-Modus vollständig. */
  protected override generate(): void {
    // bewusst leer — siehe Klassenkommentar; KEINE Feldzugriffe (s. ctor).
  }

  override getBiome(wx: number, wy: number): Biome {
    const s = this.feld.sample(wx, wy);
    if (!s.regionA) return Biome.Ocean;
    // Wie im Original entscheidet unterhalb der Schwelle das Wasser — so
    // bleiben Buchten und der Falloff-Saum Ozean-Biom (Strand-Rendering,
    // Ozeantiefe, Fisch-Spawns).
    if (this.getBaseHeight(wx, wy) <= OZEAN_SCHWELLE) return Biome.Ocean;
    return BIOME_BY_NAME.get(s.regionA.biome) ?? Biome.Meadows;
  }

  override getBaseHeight(wx: number, wy: number): number {
    if (wx === this.memoX && wy === this.memoY) return this.memoBase;
    const s = this.feld.sample(wx, wy);
    const basis = this.basisAus(s, wx, wy);
    this.memoX = wx;
    this.memoY = wy;
    this.memoBase = basis;
    return basis;
  }

  private basisAus(s: FieldSample, wx: number, wy: number): number {
    if (!s.regionA) return f32(OZEAN_BASIS + this.detail(wx, wy) * 0.08);

    // Küstenlinie organisch verzerren: Die Distanz bekommt ein
    // niederfrequentes Rauschen, bevor der Falloff greift — gerade Polygon-
    // kanten werden zu Buchten und Landzungen. Skaliert mit dem Falloff,
    // damit schmale Säume nicht überzeichnet werden.
    const rausch =
      (perlinNoise((wx + this.offset2) * 0.004, (wy + this.offset2) * 0.004) - 0.5) *
      Math.min(KUESTEN_RAUSCHEN, s.regionA.edgeFalloff * 0.6);

    let land = this.landBasis(s.regionA, wx, wy);
    let unionDist = s.distA;

    if (s.regionB) {
      // Grenz-Blend zweier Regionen — Overlay auf Untergrund UND zwei
      // aneinanderstoßende Länder mit EINER Formel: Gewicht der Z-HÖHEREN
      // Region über ihre EIGENE Randdistanz. Tief in ihr = 1, an ihrem
      // Rand = 0.5, weit außerhalb = 0 — von beiden Seiten stetig. Eine
      // Differenz-Formel (distA − distB) war der erste Anlauf und wählte
      // in Overlays den tiefer-innen liegenden UNTERGRUND (gemessen:
      // Gebirgs-Overlay auf −12,8 m statt +120 m).
      const oben = s.indexA > s.indexB ? s.regionA : s.regionB;
      const unten = oben === s.regionA ? s.regionB : s.regionA;
      const obenDist = oben === s.regionA ? s.distA : s.distB;
      const t = smoothStep(-oben.edgeFalloff, oben.edgeFalloff, obenDist);
      land = lerp(this.landBasis(unten, wx, wy), this.landBasis(oben, wx, wy), t);
      if (s.distB > unionDist) unionDist = s.distB;
    }

    // Küsten-Falloff: bei −falloff voller Ozeanboden, bei +falloff volles
    // Land. Die Wasserlinie (0.15) liegt damit knapp außerhalb der
    // gezeichneten Form — das Polygon IST die Landfläche.
    const f = s.regionA.edgeFalloff;
    const t = smoothStep(-f, f, unionDist + rausch);
    const ozean = OZEAN_BASIS + this.detail(wx, wy) * 0.08;
    return f32(lerp(ozean, land, t));
  }

  /** Regionsbasis: Plateau + kontinentales Perlin-Detail des Originals. */
  private landBasis(region: RegionDef, wx: number, wy: number): number {
    const plateau = region.baseLevel ?? DEFAULT_BASE_LEVEL.get(region.biome) ?? 0.22;
    const amplitude = region.heightScale ?? 1;
    // Detail um seinen Erwartungswert zentrieren, damit das Plateau die
    // MITTLERE Höhe der Region ist und heightScale nur die Streuung regelt.
    return plateau + (this.detail(wx, wy) - 0.16) * amplitude;
  }

  /**
   * Das kontinentale Detail-Rauschen des Originals (getBaseHeight-Kern) —
   * OHNE Weltrand-Absenkung, Zentrums-Deckel und Kanal-Radialgates: Diese
   * drei hingen an der Distanz zum Weltmittelpunkt und würden in einer
   * wachsenden Designer-Welt an festen Weltpositionen Artefakte stanzen.
   */
  private detail(wx: number, wy: number): number {
    const dwx = wx + 100000.0 + this.offset0;
    const dwy = wy + 100000.0 + this.offset1;
    let n = 0.0;
    n += perlinNoise(dwx * 0.002 * 0.5, dwy * 0.002 * 0.5) * perlinNoise(dwx * 0.003 * 0.5, dwy * 0.003 * 0.5);
    n += perlinNoise(dwx * 0.002, dwy * 0.002) * perlinNoise(dwx * 0.003, dwy * 0.003) * n * 0.9;
    n += perlinNoise(dwx * 0.005, dwy * 0.005) * perlinNoise(dwx * 0.01, dwy * 0.01) * 0.5 * n;
    return n - 0.07;
  }

  /** Wald-Dichte je Region übersteuerbar (forestDensity 0 = kahl … 2 = dicht). */
  override getForestFactor(x: number, z: number): number {
    const faktor = super.getForestFactor(x, z);
    const s = this.feld.sample(x, z);
    const dichte = s.regionA?.forestDensity;
    if (dichte === undefined) return faktor;
    // Original: < 1.15 gilt als Wald. Die Dichte verschiebt den Faktor um
    // bis zu ±0.6 — bei 0 verschwindet Wald praktisch, bei 2 ist fast
    // alles bewaldet; 1 lässt das globale Muster unangetastet.
    return f32(Math.max(0, faktor - (dichte - 1) * 0.6));
  }

  /** Kuratierung/Diagnose: Region an einer Weltposition (null = See). */
  regionAt(wx: number, wy: number): RegionDef | null {
    const s = this.feld.sample(wx, wy);
    return s.regionA && s.distA > -s.regionA.edgeFalloff ? s.regionA : null;
  }

  /** Diagnose/Tests. */
  get fieldChunkCount(): number {
    return this.feld.chunkCount;
  }
}
