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
  WaterField,
  UFER_MAX,
  PlateauField,
  PLATEAU_RAND_MAX,
  type FieldSample,
  type PlateauProbe,
  type RegionDef,
  type WorldLayout,
} from '../worldlayout/index.js';

const f32 = Math.fround;

/** Basis des offenen Ozeans (normiert; ×200 = −56 m — segelbar, kein Abgrund). */
const OZEAN_BASIS = -0.28;
/** Ab dieser Basis gilt ein Punkt als Ozean-BIOM (wie die radiale Formel). */
const OZEAN_SCHWELLE = 0.02;
/** Wasserlinie in Metern (Heightmap.WATER_LEVEL). */
const WASSERLINIE_M = 30;
/** Amplitude der Küstenlinien-Verzerrung (m) — macht Ränder organisch. */
const KUESTEN_RAUSCHEN = 110;

export class RegionGeo extends GeoManager {
  private feld!: RegionField;
  private wasser!: WaterField;
  private plateaus!: PlateauField;
  readonly layout: WorldLayout;
  /** Zielhöhe je Sockel-Platte (Platten-Index → Meter), lazy gemessen. */
  private readonly plateauZiele = new Map<number, number>();
  /** Reentranz-Sperre: Die Zielhöhen-Messung läuft selbst durch
   *  getBiomeHeight und darf dabei keinen Sockel anwenden. */
  private plateauMessung = false;

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
    this.wasser = new WaterField(layout);
    this.plateaus = new PlateauField(layout);
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

  /**
   * Flüsse und Seen ins Gelände schneiden — auf der FERTIGEN Biomhöhe
   * (Meter), nicht auf der Basis.
   *
   * Erster Anlauf war das Carving in getBaseHeight; die Biomfunktionen
   * verstärken jede Basisänderung aber massiv (Mountain verdoppelt sie und
   * addiert einen Neigungsterm aus Nachbarproben) — gemessen wurde eine
   * 23-m-Kante pro 2 m Schritt statt einer Böschung. Das Original macht es
   * genauso: `addRivers` läuft INNERHALB der Biomhöhe kurz vor dem
   * Feinschliff. Das Biom bleibt unberührt, Wasser entsteht dadurch, dass
   * der Boden unter die Wasserlinie fällt.
   */
  override getBiomeHeight(
    biome: Biome,
    wx: number,
    wy: number,
    preGeneration = false
  ): { height: number; mask: number } {
    let r = super.getBiomeHeight(biome, wx, wy, preGeneration);
    const w = this.wasser.probe(wx, wy);
    if (w.abstand !== Infinity) {
      const sohle = WASSERLINIE_M - w.tiefe;
      if (r.height > sohle) {
        // Uferbreite aus der SCHNITTTIEFE: ~3 m Weg je 1 m Höhenunterschied
        // (etwa 18°). Eine feste Breite ergab an hohem Ufer eine Wand — je
        // tiefer der Einschnitt, desto weiter muss der Hang auslaufen.
        const schnitt = r.height - sohle;
        const ufer = Math.min(UFER_MAX, Math.max(25, schnitt * 3));
        const anteil =
          w.abstand <= w.halbbreite
            ? 1
            : smoothStep(w.halbbreite + ufer, w.halbbreite, w.abstand);
        if (anteil > 0) r = { height: f32(r.height + (sohle - r.height) * anteil), mask: r.mask };
      }
    }
    // Platzierungs-Sockel (`einebnen`) NACH dem Wasser-Carving: Innerhalb
    // des Radius wird das Gelände auf die Höhe des Plattenmittelpunkts
    // gezogen, außen läuft eine Böschung aus — sonst durchstoßen Bodenwellen
    // große Bauwerke (Grabhügel). Nach dem Wasser, damit der Sockel auch am
    // Flussufer gewinnt und das Bauwerk trocken steht.
    if (!this.plateauMessung) {
      const p = this.plateaus.probe(wx, wy);
      if (p) {
        const ziel = this.plateauHoehe(p);
        // Böschungsbreite aus dem HÖHENUNTERSCHIED, wie beim Ufer: ~2,5 m
        // Weg je 1 m Differenz (~22°) — eine feste Breite ergäbe an
        // steilen Hängen eine Wand, im Flachen eine unnötig breite Narbe.
        const diff = Math.abs(r.height - ziel);
        const rand = Math.min(PLATEAU_RAND_MAX, Math.max(4, diff * 2.5));
        const anteil =
          p.abstand <= p.radius ? 1 : smoothStep(p.radius + rand, p.radius, p.abstand);
        if (anteil > 0) r = { height: f32(lerp(r.height, ziel, anteil)), mask: r.mask };
      }
    }
    return r;
  }

  /**
   * Zielhöhe eines Sockels: die UNGEEBNETE Geländehöhe am Plattenmittelpunkt
   * (inklusive Wasser-Carving). Genau dort setzt der Server die Platzierung
   * per getGroundHeight ab — Platte und Bauwerk treffen sich also exakt,
   * ohne dass je eine Höhe gespeichert würde. Lazy mit Cache: Die Messung
   * kostet eine volle Biomhöhen-Auswertung und gilt für jeden Vertex der
   * Platte gleichermaßen.
   */
  private plateauHoehe(p: PlateauProbe): number {
    const cached = this.plateauZiele.get(p.index);
    if (cached !== undefined) return cached;
    this.plateauMessung = true;
    const biome = this.getBiome(p.x, p.z);
    const h = this.getBiomeHeight(biome, p.x, p.z).height;
    this.plateauMessung = false;
    this.plateauZiele.set(p.index, h);
    return h;
  }

  /**
   * Nadelwald-Nester: 0 (offen) bis 1 (dichtes Nest) an dieser Stelle.
   *
   * Ein EIGENES Feld, bewusst nicht der Waldfaktor. Der beschreibt, wo
   * ueberhaupt Wald steht; die Nester beschreiben, wo er dicht und dunkel
   * ist. Beides aus derselben Quelle zu speisen hiesse, dass der Wald zum
   * Rand hin gleichmaessig ausduennt — was fehlt, ist die Binnenstruktur:
   * geschlossene Partien mitten im Bestand.
   *
   * Dieselbe Zahl moduliert den Baumabstand (streuung.ts) UND die
   * Gelaendeamplitude (landBasis). Genau das bindet Bewuchs und
   * Landschaft aneinander: Der dunkle Wald liegt im kupierten Gelaende.
   *
   * Der Versatz 31337 haelt das Feld von `detail()` und dem Waldfaktor
   * fern — ohne ihn laegen Nester, Huegel und Waldflecken uebereinander
   * und das Muster wuerde sichtbar.
   */
  nestFaktor(wx: number, wy: number): number {
    const s = this.feld.sample(wx, wy);
    const staerke = s.regionA?.nester ?? 0;
    if (staerke <= 0) return 0;
    const k = f32((s.regionA?.nesterKoernung ?? 1) * 0.0032);
    const n = perlinNoise(f32((wx + 31337) * k), f32((wy - 31337) * k));
    // Perlin liegt um 0.5; auf 0..1 spreizen und mit der Staerke wichten.
    // Die Potenz 1.6 macht aus weichen Wellen abgegrenzte NESTER — ohne
    // sie waere es ein gleichmaessiger Verlauf ohne Kern.
    // Schwelle und Potenz bestimmen, WIE VIEL der Region Nest ist.
    // Gemessen: (0.42 / 1.6) ergab 9 % — zu wenig, um als "eingestreut"
    // wahrgenommen zu werden. (0.36 / 1.25) trifft rund ein Viertel, und
    // das ist die Groessenordnung, in der man beim Durchqueren mehrfach
    // in den dunklen Bestand geraet.
    const nest = Math.pow(Math.max(0, Math.min(1, (n - 0.36) / 0.40)), 1.25);
    return f32(nest * staerke);
  }

  /** Regionsbasis: Plateau + kontinentales Perlin-Detail des Originals. */
  private landBasis(region: RegionDef, wx: number, wy: number): number {
    const plateau = region.baseLevel ?? DEFAULT_BASE_LEVEL.get(region.biome) ?? 0.22;
    // Im Nadelwald-Nest wird das Gelände bewegter — bis zum Doppelten der
    // Amplitude. Das ist der zweite Teil der Kopplung: Der dunkle Wald
    // liegt nicht auf der Wiese, er liegt im kupierten Gelände. Ohne
    // `nester` (Vorgabe 0) bleibt es exakt beim alten Wert.
    const amplitude = (region.heightScale ?? 1) * (1 + this.nestFaktor(wx, wy));
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

  /**
   * Wald je Region übersteuerbar — in Menge UND Körnung.
   *
   * `waldKoernung` skaliert die ORTSKOORDINATEN, bevor das Perlin-Feld
   * abgefragt wird. Kleiner Wert = das Feld wird auseinandergezogen =
   * grössere zusammenhängende Wälder (und ebenso grössere Lichtungen).
   * Bei 1 bleibt es beim globalen Muster von 250 m Wellenlänge.
   *
   * Die Region wird an der UNSKALIERTEN Stelle bestimmt — sie liegt ja
   * dort, wo gefragt wurde; nur das Rauschen darin wird gedehnt.
   */
  override getForestFactor(x: number, z: number): number {
    const s = this.feld.sample(x, z);
    const koernung = s.regionA?.waldKoernung;
    const faktor =
      koernung === undefined || koernung === 1
        ? super.getForestFactor(x, z)
        : super.getForestFactor(f32(x * koernung), f32(z * koernung));
    const dichte = s.regionA?.forestDensity;
    if (dichte === undefined) return faktor;
    // Original: < 1.15 gilt als Wald. Die Dichte verschiebt den Faktor um
    // bis zu ±0.6 — bei 0 verschwindet Wald praktisch, bei 2 ist fast
    // alles bewaldet; 1 lässt das globale Muster unangetastet.
    return f32(Math.max(0, faktor - (dichte - 1) * 0.6));
  }

  /**
   * Editor-Testflug: Sockel live nachrücken, ohne die Geo neu zu
   * kompilieren — der Nutzer muss das Planieren SOFORT sehen, nicht erst
   * nach dem Neuladen. Die Zielhöhe der neuen Platte wird wie immer lazy
   * als UNGEEBNETE Mittelpunkthöhe gemessen (plateauHoehe): Live-Pfad,
   * Neuladen und Server ergeben deshalb exakt dieselbe Höhe, egal wann
   * die Platte dazukam. Die Heightmap-Zonen im Umkreis muss der Aufrufer
   * selbst verwerfen (HeightmapProvider.invalidateArea) — die Geo kennt
   * die Caches ihrer Konsumenten nicht.
   */
  sockelEinfuegen(x: number, z: number, radius: number): void {
    this.plateaus.lege(x, z, radius);
  }

  /** Gegenstück zu sockelEinfuegen; true = dort lag eine Platte. Der
   *  Zielhöhen-Cache des toten Index wird nie wieder abgefragt (Indizes
   *  werden nicht wiederverwendet) — stehen lassen ist billiger. */
  sockelEntfernen(x: number, z: number): boolean {
    return this.plateaus.entferne(x, z);
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

  /** Diagnose/Tests: Anzahl der Wasser-Segmente (Flüsse + Seen). */
  get waterPieceCount(): number {
    return this.wasser.stueckAnzahl;
  }
}
