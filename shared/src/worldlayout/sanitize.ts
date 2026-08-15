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
  NPC_NAME_MAX,
  NPC_STUFE_MAX,
  NPC_STUFE_MIN,
  istFraktion,
  istNpcRolle,
  istQuestZustand,
  type NpcDef,
} from '../npc.js';
import {
  BIOME_BY_NAME,
  LAYOUT_MAX_EXTENT,
  ROUTE_DEFAULT_SPEED,
  ROUTE_MAX_PAUSE,
  WORLD_LAYOUT_VERSION,
  type Wegpunkt,
  type BiomeName,
  type ContinentDef,
  type RegionDef,
  type RegionShape,
  type PlacementDef,
  type RiverDef,
  type LakeDef,
  type RouteDef,
  type WorldLayout,
} from './types.js';

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const MAX_REGIONS = 512;
const MAX_CONTINENTS = 32;
const MAX_POLYGON_POINTS = 512;
const MAX_KURATIERT = 256;
const MAX_ROUTEN = 256;

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

/**
 * NPC-Angaben einer Platzierung.
 *
 * Unbekannte Fraktionen/Rollen/Quest-Zustände werden WEGGELASSEN und
 * nicht auf einen Standardwert gezwungen: Fehlt das Feld, greift die
 * Prefab-Vorgabe (`loeseNpcAuf`) — und die ist bei einem Tippfehler mit
 * Sicherheit näher an der Absicht als ein hart gesetztes 'neutral'.
 *
 * Bleibt nichts übrig, kommt `undefined` zurück und das Feld fehlt im
 * Dokument. Das hält den Round-Trip stabil: Ein Eintrag ohne `npc` darf
 * durch den Sanitizer keinen bekommen, sonst wüchse jede Speicherung des
 * Weltdokuments um 158 leere Blöcke.
 */
function sanitizeNpc(input: unknown): NpcDef | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const o = input as Record<string, unknown>;
  const npc: {
    name?: string;
    rolle?: NpcDef['rolle'];
    fraktion?: NpcDef['fraktion'];
    stufe?: number;
    quest?: NpcDef['quest'];
  } = {};
  // Leere Zeichenkette heisst „kein eigener Name" — als Feld gespeichert
  // wäre sie ein Namensschild ohne Text.
  if (typeof o.name === 'string') {
    const name = o.name.trim().slice(0, NPC_NAME_MAX);
    if (name.length > 0) npc.name = name;
  }
  if (istNpcRolle(o.rolle)) npc.rolle = o.rolle;
  if (istFraktion(o.fraktion)) npc.fraktion = o.fraktion;
  if (o.stufe !== undefined) {
    // Anders als bei Fraktion/Rolle wird hier GEKLEMMT: Eine Stufe ist ein
    // Zahlenstrahl, „120" meint erkennbar „so hoch wie es geht". Nur
    // Unsinn (NaN, Text) fällt heraus.
    const stufe = Math.round(klemm(o.stufe, NPC_STUFE_MIN, NPC_STUFE_MAX, NaN));
    if (Number.isFinite(stufe)) npc.stufe = stufe;
  }
  if (istQuestZustand(o.quest)) npc.quest = o.quest;
  return Object.keys(npc).length > 0 ? npc : undefined;
}

/**
 * Alte Biomnamen auf die heutigen abbilden.
 *
 * `meadows` heisst seit 08/2026 `grassland` (siehe BiomeName). Ein
 * Weltdokument ist die Arbeit des Nutzers und darf durch eine
 * Umbenennung nicht unlesbar werden — deshalb wird der alte Name hier
 * still angenommen und auf den neuen umgeschrieben. Beim naechsten
 * Speichern steht der neue drin; wer eine alte Datei behaelt, verliert
 * nichts.
 *
 * Die Tabelle bleibt bestehen, auch wenn irgendwann kein Dokument mehr
 * `meadows` enthaelt: Sie kostet nichts und ist die einzige Stelle, an
 * der man spaeter nachsehen kann, wie ein Biom frueher hiess.
 */
const ALTE_BIOMNAMEN: ReadonlyMap<string, BiomeName> = new Map([['meadows', 'grassland']]);

function biomNameMigrieren(input: unknown): BiomeName | null {
  if (typeof input !== 'string') return null;
  const neu = ALTE_BIOMNAMEN.get(input);
  if (neu) return neu;
  return BIOME_BY_NAME.has(input as BiomeName) ? (input as BiomeName) : null;
}

function sanitizeRegion(input: unknown, bekannteIds: Set<string>): RegionDef | null {
  if (typeof input !== 'object' || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id) || bekannteIds.has(r.id)) return null;
  const biome = biomNameMigrieren(r.biome);
  if (biome === null) return null;
  const shape = sanitizeShape(r.shape);
  if (!shape) return null;
  const region: RegionDef = {
    id: r.id,
    biome,
    shape,
    edgeFalloff: klemm(r.edgeFalloff, 16, 5000, 300),
  };
  if (typeof r.continentId === 'string' && ID_RE.test(r.continentId)) {
    region.continentId = r.continentId;
  }
  if (r.baseLevel !== undefined) region.baseLevel = klemm(r.baseLevel, 0.03, 0.6, 0.22);
  if (r.heightScale !== undefined) region.heightScale = klemm(r.heightScale, 0, 4, 1);
  if (r.tier !== undefined) region.tier = Math.round(klemm(r.tier, 0, 5, 0));
  if (r.forestDensity !== undefined) region.forestDensity = klemm(r.forestDensity, 0, 2, 1);
  if (r.bewuchsDichte !== undefined) region.bewuchsDichte = klemm(r.bewuchsDichte, 0.1, 4, 1);
  if (r.waldKoernung !== undefined) region.waldKoernung = klemm(r.waldKoernung, 0.2, 3, 1);
  if (r.abstandFaktor !== undefined) region.abstandFaktor = klemm(r.abstandFaktor, 0.3, 2, 1);
  if (r.nester !== undefined) region.nester = klemm(r.nester, 0, 1, 0);
  if (r.nesterKoernung !== undefined) region.nesterKoernung = klemm(r.nesterKoernung, 0.2, 3, 1);
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
      if (Array.isArray(k.spawn) && k.spawn.length === 2) {
        const sx = koordinate(k.spawn[0]);
        const sz = koordinate(k.spawn[1]);
        if (sx !== null && sz !== null) kontinent.spawn = [sx, sz];
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

  const placements: PlacementDef[] = [];
  if (Array.isArray(d.placements)) {
    for (const p of d.placements.slice(0, 2000)) {
      if (typeof p !== 'object' || p === null) continue;
      const o = p as Record<string, unknown>;
      if (typeof o.prefab !== 'string' || o.prefab.length === 0 || o.prefab.length > 64) continue;
      const x = koordinate(o.x);
      const z = koordinate(o.z);
      if (x === null || z === null) continue;
      const eintrag: PlacementDef = { prefab: o.prefab, x, z };
      // Nur die SCHREIBWEISE prüfen, nicht die Existenz der Route: Ob es
      // sie gibt, meldet pruefeLayout — wie bei `continentId` an der
      // Region hängt die Auflösung am Verwendungsort, nicht am Schema.
      if (typeof o.route === 'string' && ID_RE.test(o.route)) eintrag.route = o.route;
      if (o.yaw !== undefined) eintrag.yaw = klemm(o.yaw, -Math.PI * 2, Math.PI * 2, 0);
      if (o.scale !== undefined) eintrag.scale = klemm(o.scale, 0.2, 5, 1);
      if (o.einebnen !== undefined) {
        // Wie beim Kreis-Radius: Unsinn verwerfen statt auf einen Wert zu
        // klemmen — ein erfundener Sockel wäre schlimmer als keiner.
        const r = klemm(o.einebnen, 1, 100, NaN);
        if (Number.isFinite(r)) eintrag.einebnen = Math.round(r * 10) / 10;
      }
      const npc = sanitizeNpc(o.npc);
      if (npc) eintrag.npc = npc;
      placements.push(eintrag);
    }
  }

  const rivers: RiverDef[] = [];
  if (Array.isArray(d.rivers)) {
    for (const r of d.rivers.slice(0, 256)) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) continue;
      if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length > MAX_POLYGON_POINTS) continue;
      const points: [number, number][] = [];
      let ok = true;
      for (const p of o.points) {
        if (!Array.isArray(p) || p.length !== 2) { ok = false; break; }
        const x = koordinate(p[0]);
        const z = koordinate(p[1]);
        if (x === null || z === null) { ok = false; break; }
        points.push([x, z]);
      }
      if (!ok) continue;
      const fluss: RiverDef = { id: o.id, points, width: klemm(o.width, 4, 400, 30) };
      if (o.depth !== undefined) fluss.depth = klemm(o.depth, 1, 60, 6);
      rivers.push(fluss);
    }
  }

  const lakes: LakeDef[] = [];
  if (Array.isArray(d.lakes)) {
    for (const l of d.lakes.slice(0, 256)) {
      if (typeof l !== 'object' || l === null) continue;
      const o = l as Record<string, unknown>;
      if (typeof o.id !== 'string' || !ID_RE.test(o.id)) continue;
      const x = koordinate(o.x);
      const z = koordinate(o.z);
      if (x === null || z === null) continue;
      const see: LakeDef = { id: o.id, x, z, radius: klemm(o.radius, 8, 5000, 200) };
      if (o.depth !== undefined) see.depth = klemm(o.depth, 1, 60, 8);
      lakes.push(see);
    }
  }

  const routes: RouteDef[] = [];
  if (Array.isArray(d.routes)) {
    const ids = new Set<string>();
    for (const r of d.routes.slice(0, MAX_ROUTEN)) {
      if (typeof r !== 'object' || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.id !== 'string' || !ID_RE.test(o.id) || ids.has(o.id)) continue;
      if (!Array.isArray(o.points) || o.points.length < 1 || o.points.length > MAX_POLYGON_POINTS) continue;
      // Zwei Formen, eine Bedeutung: [x, z] läuft durch, [x, z, pause]
      // wartet dort. Das dritte Element ist die einzige Abweichung vom
      // alten Format — bestehende Dokumente kommen unverändert durch, und
      // ein Punkt ohne Pause wird auch wieder OHNE drittes Element
      // geschrieben (stabiler Round-Trip).
      const points: Wegpunkt[] = [];
      let ok = true;
      for (const p of o.points) {
        if (!Array.isArray(p) || p.length < 2 || p.length > 3) { ok = false; break; }
        const x = koordinate(p[0]);
        const z = koordinate(p[1]);
        if (x === null || z === null) { ok = false; break; }
        // Unsinn (NaN, negativ, Text) heißt „keine Pause": Ein Punkt, an
        // dem der NPC nicht wartet, ist die harmlose Annahme — dafür die
        // ganze Route zu verwerfen wäre unverhältnismäßig.
        const pause = p.length === 3 ? klemm(p[2], 0, ROUTE_MAX_PAUSE, 0) : 0;
        points.push(pause > 0 ? [x, z, Math.round(pause * 1000) / 1000] : [x, z]);
      }
      if (!ok) continue;
      ids.add(o.id);
      // Unbekannter Modus → 'loop': Eine Runde ist die harmlosere Annahme,
      // der NPC bleibt in jedem Fall auf seinen Wegpunkten.
      const route: RouteDef = { id: o.id, points, mode: o.mode === 'pingpong' ? 'pingpong' : 'loop' };
      // Obergrenze 10 m/s: schneller als ein sprintender Spieler wäre keine
      // Route mehr, sondern ein Teleport zwischen den Sync-Takten.
      if (o.speed !== undefined) route.speed = klemm(o.speed, 0.2, 10, ROUTE_DEFAULT_SPEED);
      routes.push(route);
    }
  }

  let defaultSpawn: readonly [number, number] | undefined;
  if (Array.isArray(d.defaultSpawn) && d.defaultSpawn.length === 2) {
    const sx = koordinate(d.defaultSpawn[0]);
    const sz = koordinate(d.defaultSpawn[1]);
    if (sx !== null && sz !== null) defaultSpawn = [sx, sz];
  }

  return {
    version: WORLD_LAYOUT_VERSION,
    name: d.name,
    detailSeed,
    continents,
    regions,
    ...(placements.length > 0 ? { placements } : {}),
    ...(defaultSpawn ? { defaultSpawn } : {}),
    ...(rivers.length > 0 ? { rivers } : {}),
    ...(lakes.length > 0 ? { lakes } : {}),
    ...(routes.length > 0 ? { routes } : {}),
  };
}
