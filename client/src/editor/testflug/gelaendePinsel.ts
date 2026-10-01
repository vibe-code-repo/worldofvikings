/**
 * Terrain brush core of the offline flight (`Reiter „Gelände“`, card T2).
 * Pure and DOM-free: a stroke is a series of stamps on the hand-correction
 * layer `WorldLayout.heightDeltas` (T1). Nothing here touches a scene, the
 * draft or the network; `Testflug.ts` wires it, `GelaendeAktionen.ts` writes
 * the finished stroke into the draft.
 *
 * Reiterkern des Geländepinsels im Testflug: Ein Strich ist eine Folge von
 * Stempeln auf der Handkorrektur-Ebene `heightDeltas`. Rein und ohne DOM.
 *
 * ── Model ───────────────────────────────────────────────────────────
 * The ground has one vertex per integer world coordinate. Zone `zx`/`zz` and
 * the index `ry*64+rx` are exactly what `RegionGeo` derives for the same
 * vertex (`zoneUndIndex`, `shared/src/worldgen/RegionGeo.ts`; pinned against
 * the real geo in `client/test/gelaende-pinsel.ts`). A delta is a whole number
 * of centimetres; 0 means "no correction" and is not stored.
 *
 *  - anheben / absenken: every vertex inside the radius moves by
 *    `round(staerke · w)` cm (sign by tool), `w = (1 − (d/r)²)²`. The falloff
 *    is a FIXED curve (zero value and zero slope at the rim, no seam to the
 *    untouched ground); a slider for it would only add a knob nobody can judge
 *    without a picture. Strength is cm per stamp at the centre.
 *  - glaetten: every vertex moves towards the mean height of its 3×3
 *    neighbourhood by `w · min(1, staerke/25)` of the difference.
 *  - A stamp is refused as a whole under a lock circle (plinth or building,
 *    `gelaendeSperre.ts`), and the whole STROKE is refused, not shortened,
 *    when a value or a count would break the limits of `sanitize.ts`.
 *
 * ── One stroke = one Vorgang ────────────────────────────────────────
 * `Strich` applies each stamp to the live `DeltaKarte` at once (the ground is
 * rebuilt from it while the mouse is down) and remembers, per vertex, the value
 * BEFORE the stroke. `ende()` turns that into ONE `GelaendeVorgang` however
 * many frames the stroke ran; `invertiere` swaps before/after.
 */
import {
  HEIGHT_POINT_LIMIT,
  HEIGHT_ZONE_LIMIT,
  HOEHENKORREKTUR_DELTA_MAX_CM,
  heightProblem,
  sanitizeHeightDeltas,
  type ZoneHeightDelta,
} from '@wov/shared';

/** Vertices per zone axis (`Heightmap.ZONE_UNITS`). */
const ZONE = 64;
/** Zone coordinates the document allows (`HOEHENZONE_MAX` in sanitize.ts). */
const ZONEN_GRENZE = 2048;

export const RADIUS_MIN = 1;
export const RADIUS_MAX = 20;
export const RADIUS_START = 6;
export const STAERKE_MIN = 1;
export const STAERKE_MAX = 50;
export const STAERKE_START = 10;
/** Smoothing reaches full strength at this many cm per stamp. */
const GLAETTEN_VOLL = 25;

/** Stamps while moving are spaced this fraction of the radius apart … */
export const STEMPEL_ABSTAND_ANTEIL = 0.25;
/** … but never closer in time than this (each stamp rebuilds up to four zones). */
export const STEMPEL_MIN_MS = 60;
/** A held, motionless brush repeats its stamp at this interval. */
export const STEMPEL_HALTE_MS = 120;

export type Werkzeug = 'anheben' | 'absenken' | 'glaetten' | 'ebnen' | 'zuruecksetzen';

/** Target height range of the level tool (metres, absolute ground height); the layer itself is limited to ±100 m of correction. */
export const ZIEL_MIN = -200;
export const ZIEL_MAX = 2000;
/** A correction is removed completely where the falloff is at least this (reset tool); the rim fades out. */
const ZURUECK_VOLL = 0.5;

export interface Aenderung {
  zx: number;
  zz: number;
  /** Flat index `ry*64+rx` inside the zone. */
  index: number;
  /** Delta in cm before / after. */
  alt: number;
  neu: number;
}

export interface GelaendeVorgang {
  vorgangId: string;
  aenderungen: Aenderung[];
}

const UMKEHR_MARKE = '~';

/** The Vorgang that takes `v` back: before and after swapped, id with / without a leading `~`. */
export function invertiere(v: GelaendeVorgang): GelaendeVorgang {
  return {
    vorgangId: v.vorgangId.startsWith(UMKEHR_MARKE) ? v.vorgangId.slice(UMKEHR_MARKE.length) : UMKEHR_MARKE + v.vorgangId,
    aenderungen: v.aenderungen.map((a) => ({ ...a, alt: a.neu, neu: a.alt })),
  };
}

/** Zone and flat index of the vertex at integer world position (`RegionGeo.zoneUndIndex`). */
export function punktVon(wx: number, wz: number): { zx: number; zz: number; index: number } {
  const halb = ZONE / 2;
  const zx = Math.floor((wx + halb) / ZONE);
  const zz = Math.floor((wz + halb) / ZONE);
  const rx = wx - (zx * ZONE - halb);
  const ry = wz - (zz * ZONE - halb);
  return { zx, zz, index: ry * ZONE + rx };
}

const zonenNummer = (zx: number, zz: number): number => (zx + ZONEN_GRENZE) * (2 * ZONEN_GRENZE + 1) + (zz + ZONEN_GRENZE);
const punktNummer = (zx: number, zz: number, index: number): number => zonenNummer(zx, zz) * (ZONE * ZONE) + index;
/** Inverse of `punktNummer`. */
const punktAusNummer = (nr: number): { zx: number; zz: number; index: number } => {
  const index = nr % (ZONE * ZONE);
  const zone = (nr - index) / (ZONE * ZONE);
  const breite = 2 * ZONEN_GRENZE + 1;
  return { zx: Math.floor(zone / breite) - ZONEN_GRENZE, zz: (zone % breite) - ZONEN_GRENZE, index };
};

/**
 * The hand-correction layer in memory: cm per vertex, sparse. Doubles as the
 * live lookup of the ground (`gelaendeGeo.ts` reads `deltaM` from it), so it is
 * keyed by numbers, not strings — it is asked once per vertex of every zone build.
 */
export class DeltaKarte {
  private readonly punkte = new Map<number, number>();
  private readonly zonen = new Map<number, number>();

  get punktzahl(): number {
    return this.punkte.size;
  }
  get zonenzahl(): number {
    return this.zonen.size;
  }

  /** Delta in cm; 0 where there is none. */
  delta(zx: number, zz: number, index: number): number {
    return this.punkte.get(punktNummer(zx, zz, index)) ?? 0;
  }

  /** Delta in metres, the same f32 rounding as `HoehenKorrekturField.delta`. */
  deltaM(zx: number, zz: number, index: number): number {
    const cm = this.punkte.get(punktNummer(zx, zz, index));
    return cm === undefined ? 0 : Math.fround(cm * 0.01);
  }

  setze(zx: number, zz: number, index: number, cm: number): void {
    const nr = punktNummer(zx, zz, index);
    const zone = zonenNummer(zx, zz);
    const da = this.punkte.has(nr);
    if (cm === 0) {
      if (!da) return;
      this.punkte.delete(nr);
      const n = (this.zonen.get(zone) ?? 1) - 1;
      if (n <= 0) this.zonen.delete(zone);
      else this.zonen.set(zone, n);
      return;
    }
    this.punkte.set(nr, cm);
    if (!da) this.zonen.set(zone, (this.zonen.get(zone) ?? 0) + 1);
  }

  /**
   * Makes this layer equal to `neu` IN PLACE (the live view of the ground keeps
   * pointing at this object) and returns what changed, `alt` = before, `neu` = after.
   */
  abgleichenMit(neu: DeltaKarte): Aenderung[] {
    const aus: Aenderung[] = [];
    for (const [nr, cm] of this.punkte) {
      const soll = neu.punkte.get(nr) ?? 0;
      if (soll !== cm) aus.push({ ...punktAusNummer(nr), alt: cm, neu: soll });
    }
    for (const [nr, cm] of neu.punkte) {
      if (!this.punkte.has(nr)) aus.push({ ...punktAusNummer(nr), alt: 0, neu: cm });
    }
    for (const a of aus) this.setze(a.zx, a.zz, a.index, a.neu);
    return aus;
  }

  /** The layer of a (sanitised) document. */
  static ausZonen(zonen: readonly ZoneHeightDelta[] | undefined): DeltaKarte {
    const karte = new DeltaKarte();
    for (const z of zonen ?? []) {
      for (const zeile of z.r) {
        const teile = zeile.split('|');
        if (teile.length !== 3) continue;
        const ry = Number(teile[0]);
        const rx = teile[1]!.length > 0 ? teile[1]!.split(',') : [];
        const d = teile[2]!.length > 0 ? teile[2]!.split(',') : [];
        const n = Math.min(rx.length, d.length);
        for (let k = 0; k < n; k++) karte.setze(z.zx, z.zz, ry * ZONE + Number(rx[k]), Number(d[k]));
      }
    }
    return karte;
  }

  /**
   * Back to the document form, in the sanitizer's canonical order (zones by
   * `zx`,`zz`; rows by `ry`; columns by `rx`), so that
   * `sanitizeHeightDeltas(karte.alsZonen())` returns it unchanged.
   */
  alsZonen(): ZoneHeightDelta[] {
    const jeZone = new Map<number, Map<number, [number, number][]>>();
    const koordinaten = new Map<number, [number, number]>();
    const zw = 2 * ZONEN_GRENZE + 1;
    for (const [nr, cm] of this.punkte) {
      const index = nr % (ZONE * ZONE);
      const zone = (nr - index) / (ZONE * ZONE);
      if (!koordinaten.has(zone)) koordinaten.set(zone, [Math.floor(zone / zw) - ZONEN_GRENZE, (zone % zw) - ZONEN_GRENZE]);
      let zeilen = jeZone.get(zone);
      if (!zeilen) jeZone.set(zone, (zeilen = new Map()));
      const ry = Math.floor(index / ZONE);
      let liste = zeilen.get(ry);
      if (!liste) zeilen.set(ry, (liste = []));
      liste.push([index % ZONE, cm]);
    }
    const aus: ZoneHeightDelta[] = [];
    for (const [zone, zeilen] of jeZone) {
      const [zx, zz] = koordinaten.get(zone)!;
      const r = [...zeilen.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ry, liste]) => {
          liste.sort((a, b) => a[0] - b[0]);
          return `${ry}|${liste.map((p) => p[0]).join(',')}|${liste.map((p) => p[1]).join(',')}`;
        });
      aus.push({ zx, zz, r });
    }
    return aus.sort((a, b) => a.zx - b.zx || a.zz - b.zz);
  }
}

/** Height falloff of the brush: 1 in the middle, 0 with zero slope at the rim. */
export function falloff(d: number, radius: number): number {
  if (d >= radius) return 0;
  const s = d / radius;
  const q = 1 - s * s;
  return q * q;
}

/**
 * How far a stamp REALLY reaches: raise and lower move a vertex by `round(staerke · w)` cm, which is 0
 * where `w < 0.5/staerke`, so a weak stamp is narrower than its radius (strength 1: 54 % of it). The
 * preview circle and the lock use this radius, so the circle shows what the stroke changes. Smoothing,
 * levelling and resetting depend on the ground / the layer and keep the full radius.
 */
export function wirkRadius(werkzeug: Werkzeug, radius: number, staerke: number): number {
  if (werkzeug !== 'anheben' && werkzeug !== 'absenken') return radius;
  const w = 0.5 / Math.max(staerke, 0.5);
  return radius * Math.sqrt(1 - Math.sqrt(w));
}

export interface StempelEingabe {
  x: number;
  z: number;
  radius: number;
  /** cm per stamp at the centre. */
  staerke: number;
  werkzeug: Werkzeug;
  /** Current ground height at an integer vertex (read by `glaetten` and `ebnen`). */
  hoehe: (wx: number, wz: number) => number;
  /** Target ground height in metres (only `ebnen`; without a finite value a level stamp changes nothing). */
  ziel?: number;
  /**
   * Level only: height and correction of each vertex the FIRST time this stroke touched it. With it a vertex never
   * moves further than the distance it had to the target at that time, however long the brush is held (see `ebnen`).
   * Without it (pure stamps in tests) there is no cap.
   */
  anker?: Map<number, { h: number; c: number }>;
}

/** The height the pipette takes from the ground at a point: metres, whole centimetres (what the target field shows). */
export function pipette(hoehe: (x: number, z: number) => number, x: number, z: number): number {
  return klemmeZiel(hoehe(x, z));
}

/** Target height clamped to the range of the tool, in whole centimetres; a non-number becomes 0. */
export function klemmeZiel(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return Math.round(Math.min(ZIEL_MAX, Math.max(ZIEL_MIN, h)) * 100) / 100;
}

/**
 * What one stamp would change (only vertices whose value differs), in a fixed
 * order (rows, then columns). Does not modify `karte`.
 */
export function berechneStempel(karte: DeltaKarte, e: StempelEingabe): Aenderung[] {
  const r = e.radius;
  const x0 = Math.ceil(e.x - r);
  const x1 = Math.floor(e.x + r);
  const z0 = Math.ceil(e.z - r);
  const z1 = Math.floor(e.z + r);
  const aus: Aenderung[] = [];
  const glaetten = e.werkzeug === 'glaetten';
  const ebnen = e.werkzeug === 'ebnen';
  if (ebnen && !(typeof e.ziel === 'number' && Number.isFinite(e.ziel))) return [];
  // One block of heights (with a one-vertex border) so that the 3×3 mean reads each vertex once and
  // sees the state BEFORE this stamp for every vertex.
  const breite = x1 - x0 + 3;
  const hoehen = glaetten ? new Float64Array(breite * (z1 - z0 + 3)) : null;
  if (hoehen) {
    for (let iz = z0 - 1; iz <= z1 + 1; iz++) {
      for (let ix = x0 - 1; ix <= x1 + 1; ix++) hoehen[(iz - z0 + 1) * breite + (ix - x0 + 1)] = e.hoehe(ix, iz);
    }
  }
  const vorzeichen = e.werkzeug === 'absenken' ? -1 : 1;
  const k = Math.min(1, e.staerke / GLAETTEN_VOLL);
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const w = falloff(Math.hypot(ix - e.x, iz - e.z), r);
      if (w <= 0) continue;
      let zuwachs: number;
      if (ebnen) {
        // Pull the vertex towards the target by the falloff; in the middle (w = 1) it lands on the target.
        const hJetzt = e.hoehe(ix, iz);
        zuwachs = Math.round((e.ziel! - hJetzt) * 100 * w);
        if (e.anker) {
          // The ground does not always follow 1 cm of correction with 1 cm of height (the slope of a plinth blends
          // the corrected height against the slab and gets wider the further it is from it): a stamp that only
          // looks at the visible height would pile up correction without end. So the correction of a vertex may
          // move from where this stroke found it towards the target, by at most the distance it had then — it
          // settles, never overshoots, and what is stored stays bounded however long the brush is held.
          const { zx, zz, index } = punktVon(ix, iz);
          const nr = punktNummer(zx, zz, index);
          const cJetzt = karte.delta(zx, zz, index);
          let anker = e.anker.get(nr);
          if (!anker) e.anker.set(nr, (anker = { h: hJetzt, c: cJetzt }));
          const gesamt = Math.round((e.ziel! - anker.h) * 100);
          const rel = Math.min(Math.max(cJetzt + zuwachs - anker.c, Math.min(0, gesamt)), Math.max(0, gesamt));
          zuwachs = anker.c + rel - cJetzt;
        }
      } else if (e.werkzeug === 'zuruecksetzen') {
        // Take the correction away; fully where the falloff is ≥ ZURUECK_VOLL, fading to the rim (no step at the edge).
        // At least 1 cm per stamp, so a held brush finishes: rounding would otherwise stall at the rim (A6).
        const { zx, zz, index } = punktVon(ix, iz);
        const alt = karte.delta(zx, zz, index);
        if (alt === 0) continue;
        const weg = Math.min(Math.abs(alt), Math.max(1, Math.round(Math.abs(alt) * Math.min(1, w / ZURUECK_VOLL))));
        zuwachs = -Math.sign(alt) * weg;
      } else if (hoehen) {
        let summe = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) summe += hoehen[(iz - z0 + 1 + dz) * breite + (ix - x0 + 1 + dx)]!;
        }
        const mitte = hoehen[(iz - z0 + 1) * breite + (ix - x0 + 1)]!;
        zuwachs = Math.round((summe / 9 - mitte) * 100 * k * w);
      } else {
        zuwachs = vorzeichen * Math.round(e.staerke * w);
      }
      if (zuwachs === 0) continue;
      const { zx, zz, index } = punktVon(ix, iz);
      const alt = karte.delta(zx, zz, index);
      aus.push({ zx, zz, index, alt, neu: alt + zuwachs });
    }
  }
  return aus;
}

export type StempelErgebnis =
  /** Applied; `geaendert` are the vertices that moved (for the rebuild). */
  | { art: 'ok'; geaendert: Aenderung[] }
  /** A lock circle lies under the brush: nothing changed, the stroke goes on. */
  | { art: 'gesperrt' }
  /** A limit would break: the WHOLE stroke was put back (`zurueckgenommen`), the stroke is dead until it ends. */
  | { art: 'grenze'; grund: GrenzGrund; zurueckgenommen: Aenderung[] }
  /** The stroke was refused earlier; further stamps are ignored. */
  | { art: 'abgelehnt' };

export type GrenzGrund = 'wert' | 'punkte' | 'zonen';

/** One stroke of the brush: many stamps, ONE Vorgang. */
export class Strich {
  /** First value (cm) per vertex before this stroke, with its coordinates. */
  private readonly vorher = new Map<number, Aenderung>();
  private tot: GrenzGrund | null = null;
  private beendet = false;
  /** Level: what each vertex was when this stroke first touched it (`StempelEingabe.anker`). */
  private readonly anker = new Map<number, { h: number; c: number }>();

  constructor(
    private readonly karte: DeltaKarte,
    readonly vorgangId: string
  ) {}

  /** Why the stroke was refused, or `null`. */
  get abgelehnt(): GrenzGrund | null {
    return this.tot;
  }

  stempel(e: StempelEingabe, gesperrt: boolean): StempelErgebnis {
    if (this.tot || this.beendet) return { art: 'abgelehnt' };
    if (gesperrt) return { art: 'gesperrt' };
    const aenderungen = berechneStempel(this.karte, e.werkzeug === 'ebnen' ? { ...e, anker: this.anker } : e);
    for (const a of aenderungen) {
      const nr = punktNummer(a.zx, a.zz, a.index);
      if (!this.vorher.has(nr)) this.vorher.set(nr, { ...a, neu: a.alt });
      this.karte.setze(a.zx, a.zz, a.index, a.neu);
    }
    const grund = this.grenzeGerissen(aenderungen);
    if (grund) {
      this.tot = grund;
      return { art: 'grenze', grund, zurueckgenommen: this.zuruecknehmen() };
    }
    return { art: 'ok', geaendert: aenderungen };
  }

  private grenzeGerissen(aenderungen: readonly Aenderung[]): GrenzGrund | null {
    for (const a of aenderungen) if (Math.abs(a.neu) > HOEHENKORREKTUR_DELTA_MAX_CM) return 'wert';
    if (this.karte.punktzahl > HEIGHT_POINT_LIMIT) return 'punkte';
    if (this.karte.zonenzahl > HEIGHT_ZONE_LIMIT) return 'zonen';
    return null;
  }

  /** Puts every vertex touched by this stroke back to its value before the stroke; returns what moved (for the rebuild). */
  private zuruecknehmen(): Aenderung[] {
    const aus: Aenderung[] = [];
    for (const v of this.vorher.values()) {
      const jetzt = this.karte.delta(v.zx, v.zz, v.index);
      if (jetzt !== v.alt) aus.push({ zx: v.zx, zz: v.zz, index: v.index, alt: jetzt, neu: v.alt });
      this.karte.setze(v.zx, v.zz, v.index, v.alt);
    }
    this.vorher.clear();
    return aus;
  }

  /** Ends the stroke: the ONE Vorgang of all stamps, or `null` when nothing changed (or the stroke was refused). */
  ende(): GelaendeVorgang | null {
    if (this.tot) return null;
    this.beendet = true;
    const aenderungen: Aenderung[] = [];
    for (const v of this.vorher.values()) {
      const neu = this.karte.delta(v.zx, v.zz, v.index);
      if (neu !== v.alt) aenderungen.push({ zx: v.zx, zz: v.zz, index: v.index, alt: v.alt, neu });
    }
    if (aenderungen.length === 0) return null;
    aenderungen.sort((a, b) => a.zx - b.zx || a.zz - b.zz || a.index - b.index);
    return { vorgangId: this.vorgangId, aenderungen };
  }

  /** Abandons the stroke (e.g. Esc before the mouse goes up): puts everything back; returns what moved. */
  verwerfen(): Aenderung[] {
    this.beendet = true;
    return this.zuruecknehmen();
  }
}

/**
 * Applies a Vorgang to a layer: stands only if every vertex still has the
 * `alt` value the writer saw (all or nothing), and only within the limits.
 * Used for the draft and for undo (`invertiere`).
 */
export function wendeVorgang(karte: DeltaKarte, v: GelaendeVorgang): { ok: true } | { ok: false; grund: 'konflikt' | GrenzGrund } {
  for (const a of v.aenderungen) if (karte.delta(a.zx, a.zz, a.index) !== a.alt) return { ok: false, grund: 'konflikt' };
  const sicherung = v.aenderungen.map((a) => ({ a, alt: a.alt }));
  for (const a of v.aenderungen) karte.setze(a.zx, a.zz, a.index, a.neu);
  let grund: GrenzGrund | null = null;
  if (v.aenderungen.some((a) => Math.abs(a.neu) > HOEHENKORREKTUR_DELTA_MAX_CM)) grund = 'wert';
  else if (karte.punktzahl > HEIGHT_POINT_LIMIT) grund = 'punkte';
  else if (karte.zonenzahl > HEIGHT_ZONE_LIMIT) grund = 'zonen';
  if (grund) {
    for (const s of sicherung) karte.setze(s.a.zx, s.a.zz, s.a.index, s.alt);
    return { ok: false, grund };
  }
  return { ok: true };
}

/**
 * The layer of a raw draft field; `null` when the field is not usable as it is
 * (not a list, invalid entries, over the limits): then nothing may be painted
 * over it, because writing it back would silently cut what the sanitizer drops.
 */
export function karteAusEntwurf(roh: unknown): DeltaKarte | null {
  if (roh === undefined) return new DeltaKarte();
  if (!Array.isArray(roh) || heightProblem(roh) !== null) return null;
  return DeltaKarte.ausZonen(sanitizeHeightDeltas(roh, false));
}

/**
 * When the next stamp is due. The first stamp of a stroke is always due;
 * afterwards one per `radius/4` metres of travel, at most one per `STEMPEL_MIN_MS`,
 * and — motionless — one per `STEMPEL_HALTE_MS`.
 */
export class StempelTakt {
  private letzte: { x: number; z: number; t: number } | null = null;

  faellig(x: number, z: number, radius: number, jetztMs: number): boolean {
    const l = this.letzte;
    if (l) {
      const dt = jetztMs - l.t;
      const weg = Math.hypot(x - l.x, z - l.z);
      const abstand = Math.max(0.5, radius * STEMPEL_ABSTAND_ANTEIL);
      const faellig = weg >= abstand ? dt >= STEMPEL_MIN_MS : dt >= STEMPEL_HALTE_MS;
      if (!faellig) return false;
    }
    this.letzte = { x, z, t: jetztMs };
    return true;
  }
}

/** `[` / `]` change the radius; on a German keyboard those need AltGr, so `-`/`+` (and the number pad) work too. Returns −1, 0 or +1. */
export function radiusSchritt(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): -1 | 0 | 1 {
  if (e.metaKey) return 0;
  // `e.key` is the character the layout produced, whatever modifier made it: AltGr (Windows: ctrl+alt,
  // Linux: neither), Option on a Mac (alt alone). Only a Ctrl WITHOUT Alt is a shortcut (browser zoom).
  if (e.ctrlKey && !e.altKey) return 0;
  if (e.key === '[' || e.key === '-' || e.code === 'NumpadSubtract') return -1;
  if (e.key === ']' || e.key === '+' || e.code === 'NumpadAdd') return 1;
  return 0;
}

/** World position of a changed vertex. */
export function punktWelt(a: { zx: number; zz: number; index: number }): { x: number; z: number } {
  return { x: a.zx * ZONE - ZONE / 2 + (a.index % ZONE), z: a.zz * ZONE - ZONE / 2 + Math.floor(a.index / ZONE) };
}

/** The text of the target field as a target height: `null` = empty or not a number (no target). */
export function zielAusText(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? klemmeZiel(n) : null;
}

/** The pipette key (H, „Höhe“): free in the flight; Ctrl/Alt/Meta make it a shortcut of something else. */
export function istPipetteTaste(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * What a key press means for the history: the step, and whether the browser's own reaction is stopped.
 * Only with the terrain tab open and not while typing in a field; a held key (repeat) is swallowed without a step.
 */
export function verlaufEntscheid(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean },
  reiterOffen: boolean,
  imFeld: boolean
): { aktion: 'rueckgaengig' | 'wiederholen' | null; verhindern: boolean } {
  if (!reiterOffen || imFeld) return { aktion: null, verhindern: false };
  const a = verlaufTaste(e);
  if (!a) return { aktion: null, verhindern: false };
  return { aktion: e.repeat ? null : a, verhindern: true };
}

/**
 * Ctrl/Cmd+Z takes the last stroke back, Ctrl/Cmd+Y and Ctrl/Cmd+Shift+Z put it in again. `e.key` (the
 * character of the layout), never while Alt is held (AltGr on a German keyboard is Ctrl+Alt).
 */
export function verlaufTaste(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): 'rueckgaengig' | 'wiederholen' | null {
  if ((!e.ctrlKey && !e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'wiederholen' : 'rueckgaengig';
  if (k === 'y' && !e.shiftKey) return 'wiederholen';
  return null;
}

export const klemmeRadius = (r: number): number => Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, Math.round(r)));
export const klemmeStaerke = (s: number): number => Math.min(STAERKE_MAX, Math.max(STAERKE_MIN, Math.round(s)));
