/**
 * The vegetation brush of the terrain tab, core: stamps along a stroke, the covering rule and the limit. DOM-free.
 *
 * Der Bewuchs-Pinsel des Gelände-Reiters, Kern: Stempel entlang eines Strichs, Abdeckungsregel und Grenze.
 *
 * A stroke lays circles `{x, z, r, nur?}` (`VegetationEntferntKreis`, V1) at a spacing of half the radius; a pointer
 * that jumps further than that between two events is filled in along the line, so a fast stroke leaves no gap. A circle
 * that an existing circle of the same kind (same `nur`) already covers completely is not laid: painting over the same
 * spot does not grow the list. At `VEGETATION_KREISE_MAX` circles nothing more is laid and the stroke says so.
 */
import {
  VEGETATION_KREISE_MAX,
  VEGETATION_RADIUS_MAX,
  VEGETATION_RADIUS_MIN,
  vegetationEntferntFehler,
  type VegetationEntferntKreis,
} from '@wov/shared';

/** Distance between two stamps as a fraction of the radius. */
export const VEG_STEMPEL_ANTEIL = 0.5;

/** Radius clamped to the limits of the field (V1). */
export const klemmeVegRadius = (r: number): number => Math.min(VEGETATION_RADIUS_MAX, Math.max(VEGETATION_RADIUS_MIN, r));

/** Distance between two stamps of a stroke with this radius. */
export const vegStempelAbstand = (r: number): number => klemmeVegRadius(r) * VEG_STEMPEL_ANTEIL;

/** Whole centimetres: the file stays short and a circle compares equal to itself after a round trip. */
const rundeCm = (v: number): number => Math.round(v * 100) / 100;

/** Same circle in every field (the key of undo). */
export const gleicherKreis = (a: VegetationEntferntKreis, b: VegetationEntferntKreis): boolean =>
  a.x === b.x && a.z === b.z && a.r === b.r && (a.nur ?? null) === (b.nur ?? null);

/** A stamp is skipped when at least this share of its area is already covered by circles of the same effect. */
export const ABDECKUNG_MIN = 0.95;

/** Fixed sample points of a circle (fractions of its radius): the middle, a ring at half, a ring near the rim. */
const PROBEN: ReadonlyArray<readonly [number, number]> = (() => {
  const p: Array<[number, number]> = [[0, 0]];
  for (const [anteil, n] of [[0.5, 8], [0.95, 16]] as const) {
    for (let i = 0; i < n; i++) p.push([anteil * Math.cos((2 * Math.PI * i) / n), anteil * Math.sin((2 * Math.PI * i) / n)]);
  }
  return p;
})();

/**
 * Is `neu` (almost) completely covered by circles of the same effect (same `nur`)? "Almost": at least 95 % of the
 * sample points of `neu` (the middle and two rings, 25 points) lie inside one of them. A hand that wobbles by half a
 * metre therefore does not grow the list on every pass, while a stamp that would clear a visible sliver is laid. A
 * circle for everything does not count for a trees-only one: undoing it would otherwise change what the trees-only
 * stroke showed.
 */
export function abgedeckt(vorhanden: readonly VegetationEntferntKreis[], neu: VegetationEntferntKreis): boolean {
  const nah = vorhanden.filter((k) => (k.nur ?? null) === (neu.nur ?? null) && Math.hypot(k.x - neu.x, k.z - neu.z) < k.r + neu.r);
  if (nah.length === 0) return false;
  let drin = 0;
  for (const [fx, fz] of PROBEN) {
    const x = neu.x + fx * neu.r;
    const z = neu.z + fz * neu.r;
    if (nah.some((k) => Math.hypot(x - k.x, z - k.z) <= k.r + 1e-9)) drin++;
  }
  return drin / PROBEN.length >= ABDECKUNG_MIN;
}

/**
 * The stamp points from the last stamp to `p`: one every `abstand`, the last one at most `abstand` before `p` is not
 * needed (the next event continues). Without a last stamp: just `p`.
 */
export function stempelEntlang(letzter: { x: number; z: number } | null, p: { x: number; z: number }, abstand: number): Array<{ x: number; z: number }> {
  if (!letzter) return [{ x: p.x, z: p.z }];
  const weg = Math.hypot(p.x - letzter.x, p.z - letzter.z);
  if (weg < abstand) return [];
  const n = Math.floor(weg / abstand);
  const punkte: Array<{ x: number; z: number }> = [];
  for (let i = 1; i <= n; i++) {
    const f = (i * abstand) / weg;
    punkte.push({ x: letzter.x + (p.x - letzter.x) * f, z: letzter.z + (p.z - letzter.z) * f });
  }
  return punkte;
}

export type StempelErgebnis = 'neu' | 'abgedeckt' | 'voll' | 'ungueltig';

/** One stroke: the circles it lays, checked against the circles that were there when it began. */
export class VegetationStrich {
  private readonly neu: VegetationEntferntKreis[] = [];
  private letzter: { x: number; z: number } | null = null;
  private vollGemeldet = false;
  private verworfenGemeldet = false;

  constructor(private readonly basis: readonly VegetationEntferntKreis[]) {}

  /** The circles of this stroke so far, in order. */
  get kreise(): readonly VegetationEntferntKreis[] {
    return this.neu;
  }

  /** `true` once the limit stopped a stamp of this stroke. */
  get voll(): boolean {
    return this.vollGemeldet;
  }

  /** `true` once a stamp of this stroke was refused for its position (outside the world frame, not a number). */
  get verworfen(): boolean {
    return this.verworfenGemeldet;
  }

  /** One stamp at a point. */
  stempel(x: number, z: number, radius: number, nurBaeume: boolean): StempelErgebnis {
    const kreis: VegetationEntferntKreis = nurBaeume
      ? { x: rundeCm(x), z: rundeCm(z), r: rundeCm(klemmeVegRadius(radius)), nur: 'baeume' }
      : { x: rundeCm(x), z: rundeCm(z), r: rundeCm(klemmeVegRadius(radius)) };
    if (vegetationEntferntFehler([kreis]).length > 0) {
      this.verworfenGemeldet = true;
      return 'ungueltig';
    }
    if (abgedeckt(this.basis, kreis) || abgedeckt(this.neu, kreis)) return 'abgedeckt';
    if (this.basis.length + this.neu.length >= VEGETATION_KREISE_MAX) {
      this.vollGemeldet = true;
      return 'voll';
    }
    this.neu.push(kreis);
    return 'neu';
  }

  /**
   * The pointer is at `p`: stamps along the line from the last stamp, every half radius. Returns how many circles were
   * laid and whether the limit stopped the stroke.
   */
  bewegeZu(p: { x: number; z: number }, radius: number, nurBaeume: boolean): { neu: number; voll: boolean } {
    let gelegt = 0;
    for (const s of stempelEntlang(this.letzter, p, vegStempelAbstand(radius))) {
      const e = this.stempel(s.x, s.z, radius, nurBaeume);
      this.letzter = s;
      if (e === 'neu') gelegt++;
      if (e === 'voll') break;
    }
    return { neu: gelegt, voll: this.vollGemeldet };
  }
}
