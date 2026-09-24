/**
 * beschreiben.ts — Ortsbeschreibung für die KI (area_describe): Höhe, Hang,
 * Wasser, Biome, Region, Wald, Objekte, nächste Route und Zone an einem Punkt.
 *
 * Reine Funktion über `GeoLese` (die Höhen-/Biom-Abfragen der Geo) und das
 * WorldLayout-Dokument; Proben auf einem Raster von höchstens 64 × 64.
 *
 * Location description for the AI: height, slope, water, biomes, region,
 * forest, objects, nearest route and zone around a point.
 */
import type { WorldLayout } from '../worldlayout/types.js';
import { Biome } from '../types.js';
import { WATER_LEVEL } from '../worldgen/Heightmap.js';
import { ZONE_SIZE } from '../constants.js';
import { BESCHREIBEN_RADIUS_MAX, NAECHSTE_OBJEKTE_MAX } from './grenzen.js';
import { BereichFehler, type HoehenFeld } from './pruefungen.js';
import { huellenAufloeser, type HuellenAufloeser } from './huelle.js';

export interface GeoLese extends HoehenFeld {
  getBiome(x: number, z: number): number;
  getForestFactor(x: number, z: number): number;
  /** Nur die Layout-Geo kennt Regionen. */
  regionAt?(x: number, z: number): {
    id: string;
    biome: string;
    tier?: number;
    forestDensity?: number;
    bewuchsDichte?: number;
    waldKoernung?: number;
    abstandFaktor?: number;
    nester?: number;
    vegetation?: readonly string[];
  } | null;
}

export interface OrtsBeschreibung {
  mitte: { x: number; z: number };
  radius: number;
  proben: number;
  hoehe: { min: number; max: number; mittel: number };
  hangMaxGrad: number;
  wasserAnteil: number;
  biome: Record<string, number>;
  region: {
    id: string;
    biome: string;
    tier?: number;
    forestDensity?: number;
    bewuchsDichte?: number;
    waldKoernung?: number;
    abstandFaktor?: number;
    nester?: number;
    vegetation?: readonly string[];
  } | null;
  wald: number;
  objekte: {
    anzahl: number;
    naechste: Array<{ id: string; prefab: string; x: number; z: number; abstand: number; fest: boolean | null }>;
  };
  naechsteRoute: { id: string; abstand: number; punkt: { x: number; z: number } } | null;
  zone: { x: number; z: number; objekte: number };
  text: string;
}

const rund = (n: number, s = 100): number => Math.round(n * s) / s;

/** Kürzester Abstand Punkt–Strecke samt Fußpunkt. */
function aufStrecke(
  px: number,
  pz: number,
  a: readonly [number, number],
  b: readonly [number, number]
): { abstand: number; x: number; z: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2));
  const x = a[0] + dx * t;
  const z = a[1] + dz * t;
  return { abstand: Math.hypot(px - x, pz - z), x, z };
}

export function beschreibeOrt(
  layout: WorldLayout,
  geo: GeoLese,
  x: number,
  z: number,
  radius: number,
  huellen: HuellenAufloeser = huellenAufloeser()
): OrtsBeschreibung {
  if (![x, z, radius].every(Number.isFinite) || !(radius > 0)) {
    throw new BereichFehler('area_describe: x, z und radius müssen endliche Zahlen sein, radius > 0.');
  }
  if (radius > BESCHREIBEN_RADIUS_MAX) {
    throw new BereichFehler(`area_describe: Radius ${radius} m zu groß, zulässig höchstens ${BESCHREIBEN_RADIUS_MAX} m.`);
  }
  const n = 64;
  const schritt = Math.max(1, (2 * radius) / (n - 1));
  const hoehen = new Map<string, number>();
  const biome = new Map<string, number>();
  let min = Infinity;
  let max = -Infinity;
  let summe = 0;
  let nass = 0;
  let wald = 0;
  let proben = 0;
  const schluessel = (i: number, j: number): string => `${i},${j}`;
  const halb = Math.floor(radius / schritt);
  for (let i = -halb; i <= halb; i++) {
    for (let j = -halb; j <= halb; j++) {
      const px = x + i * schritt;
      const pz = z + j * schritt;
      if (Math.hypot(px - x, pz - z) > radius) continue;
      const h = geo.getHeight(px, pz);
      hoehen.set(schluessel(i, j), h);
      proben++;
      summe += h;
      if (h < min) min = h;
      if (h > max) max = h;
      if (h < WATER_LEVEL) nass++;
      wald += geo.getForestFactor(px, pz);
      const name = Biome[geo.getBiome(px, pz)] ?? String(geo.getBiome(px, pz));
      biome.set(name, (biome.get(name) ?? 0) + 1);
    }
  }
  let steil = 0;
  for (const [key, h] of hoehen) {
    const [i, j] = key.split(',').map(Number);
    for (const nb of [hoehen.get(schluessel(i + 1, j)), hoehen.get(schluessel(i, j + 1))]) {
      if (nb !== undefined) steil = Math.max(steil, Math.abs(nb - h) / schritt);
    }
  }

  const abstaende = (layout.placements ?? [])
    .map((p) => ({ p, abstand: Math.hypot(p.x - x, p.z - z) }))
    .filter((e) => e.abstand <= radius)
    .sort((a, b) => a.abstand - b.abstand || (a.p.id ?? '').localeCompare(b.p.id ?? ''));

  let route: OrtsBeschreibung['naechsteRoute'] = null;
  for (const r of layout.routes ?? []) {
    const pts = r.points;
    const strecken: Array<[readonly [number, number], readonly [number, number]]> = [];
    if (pts.length === 1) strecken.push([[pts[0][0], pts[0][1]], [pts[0][0], pts[0][1]]]);
    for (let i = 0; i + 1 < pts.length; i++) strecken.push([[pts[i][0], pts[i][1]], [pts[i + 1][0], pts[i + 1][1]]]);
    if (r.mode === 'loop' && pts.length > 2) {
      strecken.push([[pts[pts.length - 1][0], pts[pts.length - 1][1]], [pts[0][0], pts[0][1]]]);
    }
    for (const [a, b] of strecken) {
      const t = aufStrecke(x, z, a, b);
      if (route === null || t.abstand < route.abstand) {
        route = { id: r.id, abstand: rund(t.abstand), punkt: { x: rund(t.x), z: rund(t.z) } };
      }
    }
  }

  const zx = Math.floor(x / ZONE_SIZE);
  const zz = Math.floor(z / ZONE_SIZE);
  const zoneObjekte = (layout.placements ?? []).filter(
    (p) => Math.floor(p.x / ZONE_SIZE) === zx && Math.floor(p.z / ZONE_SIZE) === zz
  ).length;

  const biomeAnteil: Record<string, number> = {};
  for (const [name, c] of [...biome.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    biomeAnteil[name] = rund(c / proben, 1000);
  }
  const region = geo.regionAt?.(x, z) ?? null;
  const ergebnis: OrtsBeschreibung = {
    mitte: { x, z },
    radius,
    proben,
    hoehe: { min: rund(min), max: rund(max), mittel: rund(summe / proben) },
    hangMaxGrad: rund((Math.atan(steil) * 180) / Math.PI),
    wasserAnteil: rund(nass / proben, 1000),
    biome: biomeAnteil,
    region,
    wald: rund(wald / proben, 1000),
    objekte: {
      anzahl: abstaende.length,
      naechste: abstaende.slice(0, NAECHSTE_OBJEKTE_MAX).map(({ p, abstand }) => ({
        id: p.id ?? '',
        prefab: p.prefab,
        x: p.x,
        z: p.z,
        abstand: rund(abstand),
        fest: huellen(p.prefab)?.fest ?? null,
      })),
    },
    naechsteRoute: route,
    zone: { x: zx, z: zz, objekte: zoneObjekte },
    text: '',
  };
  ergebnis.text =
    `(${x}, ${z}) r=${radius} m: Höhe ${ergebnis.hoehe.min}…${ergebnis.hoehe.max} m (Ø ${ergebnis.hoehe.mittel}), ` +
    `Hang bis ${ergebnis.hangMaxGrad}°, Wasser ${Math.round(ergebnis.wasserAnteil * 100)} %, ` +
    `Region ${region?.id ?? 'offene See'}, ${abstaende.length} Objekt(e), ` +
    `Zone (${zx}, ${zz}) mit ${zoneObjekte}`;
  return ergebnis;
}
