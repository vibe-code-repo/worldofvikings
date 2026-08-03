/**
 * Validierung untrusted Layout-Dokumente (Editor-Upload, MCP, Disk) — nach
 * dem Muster von sanitizeDungeonDocument: klemmen statt werfen, Unbekanntes
 * verwerfen, nie eine Exception nach außen. Rückgabe null = unbrauchbar.
 *
 * Bewusst nur SYNTAKTISCH: Ob ein kuratierter Vegetations-/Location-/
 * Spawn-Name existiert, entscheidet der Server am Verwendungsort (die
 * Tabellen leben dort und ändern sich unabhängig vom Schema).
 */

import {
  BIOME_BY_NAME,
  LAYOUT_MAX_EXTENT,
  WORLD_LAYOUT_VERSION,
  type BiomeName,
  type ContinentDef,
  type RegionDef,
  type RegionShape,
  type WorldLayout,
} from './types.js';

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const MAX_REGIONS = 512;
const MAX_CONTINENTS = 32;
const MAX_POLYGON_POINTS = 512;
const MAX_KURATIERT = 256;

function klemm(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function koordinate(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > LAYOUT_MAX_EXTENT) return null;
  // Auf Millimeter runden — stabilisiert JSON-Roundtrips und Kompilierung.
  return Math.round(n * 1000) / 1000;
}

function sanitizeShape(input: unknown): RegionShape | null {
  if (typeof input !== 'object' || input === null) return null;
  const s = input as Record<string, unknown>;
  if (s.kind === 'circle') {
    const x = koordinate(s.x);
    const z = koordinate(s.z);
    const radius = klemm(s.radius, 8, 50_000, NaN);
    if (x === null || z === null || !Number.isFinite(radius)) return null;
    return { kind: 'circle', x, z, radius };
  }
  if (s.kind === 'polygon' && Array.isArray(s.points)) {
    if (s.points.length < 3 || s.points.length > MAX_POLYGON_POINTS) return null;
    const points: [number, number][] = [];
    for (const p of s.points) {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const x = koordinate(p[0]);
      const z = koordinate(p[1]);
      if (x === null || z === null) return null;
      points.push([x, z]);
    }
    // Entartete Polygone (Fläche ~0) verwerfen — Schnürsenkel-Formel.
    let flaeche2 = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, z1] = points[i]!;
      const [x2, z2] = points[(i + 1) % points.length]!;
      flaeche2 += x1 * z2 - x2 * z1;
    }
    if (Math.abs(flaeche2) < 2 * 64) return null; // < 64 m² ist kein Gebiet
    return { kind: 'polygon', points };
  }
  return null;
}

function sanitizeNamen(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: string[] = [];
  for (const n of input) {
    if (typeof n !== 'string' || n.length === 0 || n.length > 64) continue;
    if (!out.includes(n)) out.push(n);
    if (out.length >= MAX_KURATIERT) break;
  }
  return out;
}

function sanitizeRegion(input: unknown, bekannteIds: Set<string>): RegionDef | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id) || bekannteIds.has(r.id)) return null;
  if (typeof r.biome !== 'string' || !BIOME_BY_NAME.has(r.biome as BiomeName)) return null;
  const shape = sanitizeShape(r.shape);
  if (!shape) return null;
  const region: RegionDef = {
    id: r.id,
    biome: r.biome as BiomeName,
    shape,
    edgeFalloff: klemm(r.edgeFalloff, 16, 5000, 300),
  };
  if (typeof r.continentId === 'string' && ID_RE.test(r.continentId)) {
    region.continentId = r.continentId;
  }
  if (r.baseLevel !== undefined) region.baseLevel = klemm(r.baseLevel, 0.03, 0.6, 0.22);
  if (r.heightScale !== undefined) region.heightScale = klemm(r.heightScale, 0, 4, 1);
  if (r.forestDensity !== undefined) region.forestDensity = klemm(r.forestDensity, 0, 2, 1);
  const vegetation = sanitizeNamen(r.vegetation);
  if (vegetation) region.vegetation = vegetation;
  const locations = sanitizeNamen(r.locations);
  if (locations) region.locations = locations;
  const spawns = sanitizeNamen(r.spawns);
  if (spawns) region.spawns = spawns;
  return region;
}

export function sanitizeWorldLayout(input: unknown): WorldLayout | null {
  if (typeof input !== 'object' || input === null) return null;
  const d = input as Record<string, unknown>;
  if (d.version !== WORLD_LAYOUT_VERSION) return null;
  if (typeof d.name !== 'string' || d.name.length === 0 || d.name.length > 128) return null;
  const detailSeed =
    typeof d.detailSeed === 'string' && d.detailSeed.length > 0 && d.detailSeed.length <= 64
      ? d.detailSeed
      : 'wov';

  const continents: ContinentDef[] = [];
  if (Array.isArray(d.continents)) {
    const ids = new Set<string>();
    for (const c of d.continents.slice(0, MAX_CONTINENTS)) {
      if (typeof c !== 'object' || c === null) continue;
      const k = c as Record<string, unknown>;
      if (typeof k.id !== 'string' || !ID_RE.test(k.id) || ids.has(k.id)) continue;
      if (typeof k.name !== 'string' || k.name.length === 0 || k.name.length > 128) continue;
      ids.add(k.id);
      const kontinent: ContinentDef = { id: k.id, name: k.name };
      if (k.faction === 'saxon' || k.faction === 'viking' || k.faction === 'neutral') {
        kontinent.faction = k.faction;
      }
      continents.push(kontinent);
    }
  }

  const regions: RegionDef[] = [];
  if (Array.isArray(d.regions)) {
    const ids = new Set<string>();
    for (const r of d.regions.slice(0, MAX_REGIONS)) {
      const region = sanitizeRegion(r, ids);
      if (!region) continue;
      ids.add(region.id);
      regions.push(region);
    }
  }

  return {
    version: WORLD_LAYOUT_VERSION,
    name: d.name,
    detailSeed,
    continents,
    regions,
  };
}
