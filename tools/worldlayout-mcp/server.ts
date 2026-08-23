/**
 * WorldLayout-MCP-Server (Phase 5b des Kartengenerierungs-Umbaus; seit B8
 * auf dem Datenmodell mit Kontinenten/Fluessen/Seen/Routen/Progressions-
 * stufe/Bewuchsreglern).
 *
 * KI-gestützter Weltbau: exponiert das WorldLayout-Dokument
 * (server/data/welten/<instanz>.json) als MCP-Tools, damit eine KI im Gespräch
 * Regionen, Kontinente, Flüsse, Seen, Routen und Platzierungen anlegen,
 * ändern und die Welt veröffentlichen kann — dieselbe Datei, die auch der
 * grafische Editor (editor.html) bearbeitet.
 *
 * Start (stdio):   npx tsx tools/worldlayout-mcp/server.ts
 * Claude-Code-Anbindung (.mcp.json im Projekt):
 *   { "mcpServers": { "worldlayout": {
 *       "command": "npx", "args": ["tsx", "tools/worldlayout-mcp/server.ts"],
 *       "cwd": "/root/worldofvikings" } } }
 *
 * Jede Änderung läuft durch sanitizeWorldLayout — die KI kann das Dokument
 * nicht in einen Zustand bringen, den der Spielserver ablehnen würde.
 * `layout_deploy` schreibt atomar und startet den wov-Server neu (systemd).
 *
 * ── Gefahrlos ausprobieren ────────────────────────────────────────────
 * Ohne weitere Angabe schreiben die *_set/*_delete-Werkzeuge in
 * server/data/welten/<instanz>.json — bei WOV_INSTANZ=dev (Standard) also
 * in Mikes TABU-Spielstand. Zum Erproben stattdessen auf eine Kopie
 * zeigen:
 *
 *   cp server/data/welten/dev.json /tmp/layout-probe.json
 *   WOV_LAYOUT_PFAD=/tmp/layout-probe.json npx tsx tools/worldlayout-mcp/server.ts
 *
 * `layout_deploy` verweigert die Arbeit, solange WOV_LAYOUT_PFAD gesetzt
 * ist: Ein echter Neustart würde ohnehin die ECHTE Instanzdatei laden, und
 * Teständerungen an der Kopie blieben unsichtbar — das wäre eine falsche
 * Erfolgsmeldung. `probe.ts` fährt automatisch gegen eine eigene
 * /tmp-Kopie, siehe dort.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeWorldLayout,
  pruefeLayout,
  layoutBounds,
  layoutKennung,
  RegionGeo,
  createGeo,
  getStableHash,
  BIOME_BY_NAME,
  FRAKTIONEN,
  NPC_ROLLEN,
  QUEST_ZUSTAENDE,
  type WorldLayout,
  type RegionDef,
  type ContinentDef,
  type RiverDef,
  type LakeDef,
  type RouteDef,
  type PlacementDef,
  type BiomeName,
} from '@wov/shared';
import { weltDatei } from '@wov/shared/src/instanz.js';
// Sicherung mit Rotation und atomares Schreiben standen hier bis Block
// A/16 ein zweites Mal im Quelltext — dieselbe Logik wie im Speicherweg
// des Editors, nur mit anderer Fehlerbehandlung. Jetzt gibt es genau eine
// Stelle, die das Weltdokument schreibt. Direktimport am Barrel vorbei,
// weil layoutDatei.ts node:fs zieht und der Barrel in den Client-Bundle
// geht (siehe Kopfkommentar dort).
import { layoutLesen, layoutSchreiben } from '@wov/shared/src/worldlayout/layoutDatei.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Die echte Weltdatei der Instanz — Referenz fuer die layout_deploy-Bremse unten. */
const ECHTER_LAYOUT_PFAD = weltDatei(WURZEL);
/**
 * WOV_LAYOUT_PFAD ueberschreibt das Ziel — fuers Erproben gegen eine Kopie
 * unter /tmp, siehe Kopfkommentar. Ohne die Variable unveraendert die
 * echte Instanzdatei.
 */
const LAYOUT_PFAD = process.env.WOV_LAYOUT_PFAD
  ? resolve(process.env.WOV_LAYOUT_PFAD)
  : ECHTER_LAYOUT_PFAD;

function lade(): WorldLayout {
  return layoutLesen(LAYOUT_PFAD);
}

function schreibe(layout: WorldLayout): void {
  // Anders als vorher bricht ein Fehler beim Sichern den Vorgang ab,
  // statt ihn nur zu protokollieren und trotzdem zu schreiben: Wenn die
  // Sicherung nicht angelegt werden kann, ist das genau der Moment, in
  // dem man sie hinterher gebraucht hätte.
  layoutSchreiben(LAYOUT_PFAD, layout);
}

/** Kompakte Zusammenfassung fürs Gespräch statt des vollen Dokuments. */
function zusammenfassung(layout: WorldLayout): string {
  const b = layoutBounds(layout);
  const zeilen = layout.regions.map((r) => {
    const form =
      r.shape.kind === 'circle'
        ? `Kreis @(${r.shape.x}, ${r.shape.z}) r=${r.shape.radius}`
        : `Polygon ${r.shape.points.length} Punkte`;
    const kur = [
      r.vegetation ? `veg:${r.vegetation.length}` : '',
      r.locations ? `loc:${r.locations.length}` : '',
      r.spawns ? `spawn:${r.spawns.length}` : '',
    ].filter(Boolean).join(' ');
    const regler = [
      r.tier !== undefined ? `tier:${r.tier}` : '',
      r.bewuchsDichte !== undefined ? `bewuchsDichte:${r.bewuchsDichte}` : '',
      r.waldKoernung !== undefined ? `waldKoernung:${r.waldKoernung}` : '',
      r.abstandFaktor !== undefined ? `abstandFaktor:${r.abstandFaktor}` : '',
      r.nester !== undefined ? `nester:${r.nester}` : '',
    ].filter(Boolean).join(' ');
    return (
      `- ${r.id} [${r.biome}] ${form}, falloff ${r.edgeFalloff}` +
      `${kur ? ` (${kur})` : ''}${regler ? ` {${regler}}` : ''}`
    );
  });
  // Nur belegte Felder nennen — eine Welt ohne Flüsse soll nicht mit
  // "0 Fluesse" Platz in der Zusammenfassung verschwenden.
  const teile = [
    `${layout.continents.length} Kontinent(e)`,
    layout.placements?.length ? `${layout.placements.length} Platzierung(en)` : '',
    layout.rivers?.length ? `${layout.rivers.length} Fluss/Flüsse` : '',
    layout.lakes?.length ? `${layout.lakes.length} See(n)` : '',
    layout.routes?.length ? `${layout.routes.length} Route(n)` : '',
    layout.defaultSpawn ? `Spawn @(${layout.defaultSpawn[0]}, ${layout.defaultSpawn[1]})` : '',
  ].filter(Boolean);
  return (
    `Welt "${layout.name}" — ${layout.regions.length} Region(en), ${teile.join(', ')}, ` +
    `Bbox x ${b.minX}…${b.maxX}, z ${b.minZ}…${b.maxZ}\n` +
    zeilen.join('\n')
  );
}

// Biomnamen NICHT von Hand aufgezählt, sondern aus BIOME_BY_NAME (der
// Laufzeit-Entsprechung von BiomeName) abgeleitet — genau eine von Hand
// gepflegte Kopie ist es, die bei der Umbenennung meadows → grassland
// zurückblieb und seither 'grassland' als "unbekanntes Biom" ablehnte.
const BIOME_NAMEN = [...BIOME_BY_NAME.keys()] as [BiomeName, ...BiomeName[]];

const npcSchema = z.object({
  name: z.string().optional().describe('Anzeigename im Namensschild; leer = Prefab-Name'),
  rolle: z.enum([...NPC_ROLLEN]).optional(),
  fraktion: z.enum([...FRAKTIONEN]).optional(),
  stufe: z.number().optional().describe('1–99, wie in der Klammer hinter dem Namen'),
  quest: z.enum([...QUEST_ZUSTAENDE]).optional().describe('nur sinnvoll bei rolle "quest"'),
});

const regionSchema = z.object({
  id: z.string().describe('Kleinbuchstaben/Ziffern/Bindestrich, eindeutig'),
  biome: z.enum(BIOME_NAMEN),
  shape: z.union([
    z.object({ kind: z.literal('circle'), x: z.number(), z: z.number(), radius: z.number() }),
    z.object({ kind: z.literal('polygon'), points: z.array(z.tuple([z.number(), z.number()])).min(3) }),
  ]),
  edgeFalloff: z.number().optional().describe('Küsten-Falloff in m (Default 300)'),
  baseLevel: z.number().optional().describe('Basis-Plateau, normiert (Default je Biom)'),
  heightScale: z.number().optional().describe('Amplitudenfaktor des Perlin-Details (Default 1)'),
  continentId: z.string().optional(),
  tier: z.number().optional().describe(
    'Progressionsstufe 0–5 (Ersatz der Weltzentrums-Distanz) — höhere Stufen filtert der ' +
      'Server aus den Locations dieser Region heraus. Ohne Angabe keine Beschränkung.'
  ),
  forestDensity: z.number().optional().describe('Verschiebt den Waldfaktor — WO Wald ist (Default 1)'),
  bewuchsDichte: z.number().optional().describe(
    'Stückzahl-Faktor je Streueintrag — WIE VIELE Bäume auf der Waldfläche stehen (Default 1)'
  ),
  waldKoernung: z.number().optional().describe(
    'Körnung des Waldfaktor-Feldes — wie GROSS zusammenhängende Waldflächen werden, ' +
      '<1 vergrößert sie (Default 1)'
  ),
  abstandFaktor: z.number().optional().describe(
    'Faktor auf den Mindestabstand aller Streueinträge — wirksamster Dichteregler, geht ' +
      'quadratisch in die Fläche ein (Default 1)'
  ),
  nester: z.number().optional().describe(
    'Nadelwald-Nester: Stärke der Binnenvariation, moduliert Baumabstand UND ' +
      'Geländeamplitude zugleich (Default 0 = aus)'
  ),
  nesterKoernung: z.number().optional().describe('Körnung der Nester (Default 1 ≈ 300-m-Flecken)'),
  vegetation: z.array(z.string()).optional().describe('exklusive Vegetationsliste (Prefab-Namen)'),
  locations: z.array(z.string()).optional(),
  spawns: z.array(z.string()).optional(),
});

const continentSchema = z.object({
  id: z.string(),
  name: z.string(),
  faction: z.enum(['saxon', 'viking', 'neutral']).optional(),
  spawn: z.tuple([z.number(), z.number()]).optional().describe('Startpunkt dieser Fraktion [x, z]'),
});

const riverSchema = z.object({
  id: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])).min(2).describe('Verlauf [x, z] in Metern'),
  width: z.number().describe('Bettbreite in Metern'),
  depth: z.number().optional().describe('Wie tief unter die Wasserlinie das Bett reicht (Default 6)'),
});

const lakeSchema = z.object({
  id: z.string(),
  x: z.number(),
  z: z.number(),
  radius: z.number(),
  depth: z.number().optional().describe('Default 8'),
});

const wegpunktSchema = z.union([
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]).describe('[x, z, Pause in s]'),
]);

const routeSchema = z.object({
  id: z.string(),
  points: z.array(wegpunktSchema).min(1).describe('mindestens ein Wegpunkt (= Standposten)'),
  mode: z.enum(['loop', 'pingpong']),
  speed: z.number().optional().describe('m/s, Default 1.5'),
});

const placementSchema = z.object({
  prefab: z.string().describe('Prefab-Name aus der Registry'),
  x: z.number(),
  z: z.number(),
  yaw: z.number().optional().describe('Drehung um die Hochachse in Radiant (Default 0)'),
  scale: z.number().optional().describe('Einheitliche Skalierung (Default 1)'),
  route: z.string().optional().describe('ID einer Route aus WorldLayout.routes'),
  einebnen: z.number().optional().describe('Radius in m, in dem der Untergrund eingeebnet wird'),
  npc: npcSchema.optional(),
});

const mcp = new McpServer({ name: 'worldlayout', version: '1.0.0' });

mcp.tool('layout_get', 'Aktuelles WorldLayout als Zusammenfassung + JSON', {}, () => {
  const layout = lade();
  return {
    content: [{ type: 'text', text: `${zusammenfassung(layout)}\n\n${JSON.stringify(layout)}` }],
  };
});

mcp.tool(
  'layout_pruefen',
  'Inhaltliche Prüfung (dieselbe wie der Editor-Prüfbericht seit B1): unbekannte ' +
    'Vegetations-/Location-/Spawn-Namen, Fremdmodelle, unbekannte Routenverweise, ' +
    'NPC-Angaben an einem Prefab ohne Vorgabe, fehlender Startpunkt.',
  {},
  () => {
    const befunde = pruefeLayout(lade());
    if (befunde.length === 0) {
      return { content: [{ type: 'text', text: 'Keine Befunde.' }] };
    }
    const zeilen = befunde.map((b) => `[${b.art}] ${b.wo}: ${b.text}`);
    return { content: [{ type: 'text', text: `${befunde.length} Befund(e):\n${zeilen.join('\n')}` }] };
  }
);

mcp.tool(
  'region_set',
  'Region anlegen oder (bei vorhandener id) vollständig ersetzen. Z-Ordnung: neue Regionen liegen oben.',
  { region: regionSchema },
  ({ region }) => {
    const layout = lade();
    const ohne = layout.regions.filter((r) => r.id !== region.id);
    const neu = sanitizeWorldLayout({
      ...layout,
      regions: [...ohne, region as unknown as RegionDef],
    });
    if (!neu || !neu.regions.some((r) => r.id === region.id)) {
      return {
        content: [{ type: 'text', text: 'Abgelehnt: Region übersteht sanitize nicht (Form/Werte prüfen).' }],
        isError: true,
      };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('region_delete', 'Region löschen', { id: z.string() }, ({ id }) => {
  const layout = lade();
  if (!layout.regions.some((r) => r.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannte Region: ${id}` }], isError: true };
  }
  const neu = { ...layout, regions: layout.regions.filter((r) => r.id !== id) };
  schreibe(neu);
  return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
});

/** Eintrag mit gleicher `id` ersetzen (oder anhängen) — Muster von region_set. */
function ersetzeNachId<T extends { id: string }>(liste: readonly T[] | undefined, eintrag: T): T[] {
  return [...(liste ?? []).filter((e) => e.id !== eintrag.id), eintrag];
}

mcp.tool(
  'continent_set',
  'Kontinent anlegen oder (bei vorhandener id) vollständig ersetzen.',
  { kontinent: continentSchema },
  ({ kontinent }) => {
    const layout = lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      continents: ersetzeNachId(layout.continents, kontinent as unknown as ContinentDef),
    });
    if (!neu || !neu.continents.some((k) => k.id === kontinent.id)) {
      return {
        content: [{ type: 'text', text: 'Abgelehnt: Kontinent übersteht sanitize nicht.' }],
        isError: true,
      };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'continent_delete',
  'Kontinent löschen. Regionen mit dieser continentId werden NICHT nachgezogen — ' +
    'die Zuordnung verwaist still, wie auch layout_pruefen es (noch) nicht meldet.',
  { id: z.string() },
  ({ id }) => {
    const layout = lade();
    if (!layout.continents.some((k) => k.id === id)) {
      return { content: [{ type: 'text', text: `Unbekannter Kontinent: ${id}` }], isError: true };
    }
    const neu = { ...layout, continents: layout.continents.filter((k) => k.id !== id) };
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'river_set',
  'Fluss anlegen oder (bei vorhandener id) vollständig ersetzen.',
  { fluss: riverSchema },
  ({ fluss }) => {
    const layout = lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      rivers: ersetzeNachId(layout.rivers, fluss as unknown as RiverDef),
    });
    if (!neu || !(neu.rivers ?? []).some((r) => r.id === fluss.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: Fluss übersteht sanitize nicht.' }], isError: true };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('river_delete', 'Fluss löschen', { id: z.string() }, ({ id }) => {
  const layout = lade();
  if (!(layout.rivers ?? []).some((r) => r.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannter Fluss: ${id}` }], isError: true };
  }
  const neu = { ...layout, rivers: (layout.rivers ?? []).filter((r) => r.id !== id) };
  schreibe(neu);
  return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
});

mcp.tool(
  'lake_set',
  'See anlegen oder (bei vorhandener id) vollständig ersetzen.',
  { see: lakeSchema },
  ({ see }) => {
    const layout = lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      lakes: ersetzeNachId(layout.lakes, see as unknown as LakeDef),
    });
    if (!neu || !(neu.lakes ?? []).some((l) => l.id === see.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: See übersteht sanitize nicht.' }], isError: true };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('lake_delete', 'See löschen', { id: z.string() }, ({ id }) => {
  const layout = lade();
  if (!(layout.lakes ?? []).some((l) => l.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannter See: ${id}` }], isError: true };
  }
  const neu = { ...layout, lakes: (layout.lakes ?? []).filter((l) => l.id !== id) };
  schreibe(neu);
  return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
});

mcp.tool(
  'route_set',
  'Route anlegen oder (bei vorhandener id) vollständig ersetzen — Platzierungen ' +
    'verweisen per `route`-Feld darauf (siehe placement_set).',
  { route: routeSchema },
  ({ route }) => {
    const layout = lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      routes: ersetzeNachId(layout.routes, route as unknown as RouteDef),
    });
    if (!neu || !(neu.routes ?? []).some((r) => r.id === route.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: Route übersteht sanitize nicht.' }], isError: true };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'route_delete',
  'Route löschen. Platzierungen, die per `route` darauf verwiesen, bleiben stehen — ' +
    'layout_pruefen meldet die verwaiste Referenz.',
  { id: z.string() },
  ({ id }) => {
    const layout = lade();
    if (!(layout.routes ?? []).some((r) => r.id === id)) {
      return { content: [{ type: 'text', text: `Unbekannte Route: ${id}` }], isError: true };
    }
    const neu = { ...layout, routes: (layout.routes ?? []).filter((r) => r.id !== id) };
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'placement_set',
  'Platzierung anlegen oder (bei identischem Prefab + auf den Meter gerundeter Position ' +
    '— layoutKennung, wie der Server sie einer ZDO zuordnet) ersetzen.',
  { platzierung: placementSchema },
  ({ platzierung }) => {
    const layout = lade();
    const kennung = layoutKennung(platzierung);
    const ohne = (layout.placements ?? []).filter((p) => layoutKennung(p) !== kennung);
    const neu = sanitizeWorldLayout({
      ...layout,
      placements: [...ohne, platzierung as unknown as PlacementDef],
    });
    if (!neu || !(neu.placements ?? []).some((p) => layoutKennung(p) === kennung)) {
      return {
        content: [{
          type: 'text',
          text: 'Abgelehnt: Platzierung übersteht sanitize nicht (Prefab/Position prüfen).',
        }],
        isError: true,
      };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert (${kennung}).\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'placement_delete',
  'Platzierung(en) an Prefab + Position löschen — trifft ALLE Einträge mit derselben ' +
    'layoutKennung (auf den Meter gerundet teilen sie sich die Kennung, siehe types.ts).',
  { prefab: z.string(), x: z.number(), z: z.number() },
  ({ prefab, x, z: zz }) => {
    const layout = lade();
    const kennung = layoutKennung({ prefab, x, z: zz });
    const bestehend = layout.placements ?? [];
    const uebrig = bestehend.filter((p) => layoutKennung(p) !== kennung);
    if (uebrig.length === bestehend.length) {
      return { content: [{ type: 'text', text: `Keine Platzierung mit Kennung ${kennung}` }], isError: true };
    }
    const neu = { ...layout, placements: uebrig };
    schreibe(neu);
    const anzahl = bestehend.length - uebrig.length;
    return {
      content: [{
        type: 'text',
        text: `${anzahl} Platzierung(en) gelöscht (${kennung}).\n${zusammenfassung(neu)}`,
      }],
    };
  }
);

mcp.tool(
  'defaultSpawn_set',
  'Welt-Startpunkt setzen — greift, wenn die Fraktion des Spielers keinen eigenen ' +
    'Kontinent-Spawn hat (siehe continent_set).',
  { x: z.number(), z: z.number() },
  ({ x, z: zz }) => {
    const layout = lade();
    const neu = sanitizeWorldLayout({ ...layout, defaultSpawn: [x, zz] });
    if (!neu || !neu.defaultSpawn) {
      return {
        content: [{ type: 'text', text: 'Abgelehnt: Koordinaten außerhalb der Karte (±40 km).' }],
        isError: true,
      };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'defaultSpawn_clear',
  'Welt-Startpunkt entfernen (Spawn fällt auf Ursprung/Kontinent-Spawn zurück).',
  {},
  () => {
    const layout = lade();
    const ohneSpawn: Record<string, unknown> = { ...layout };
    delete ohneSpawn.defaultSpawn;
    const neu = sanitizeWorldLayout(ohneSpawn);
    if (!neu) {
      return { content: [{ type: 'text', text: 'Unerwartet abgelehnt.' }], isError: true };
    }
    schreibe(neu);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'layout_probe',
  'Weltprobe an Punkten: Biom und Höhe, wie der Spielserver sie rechnen wird (RegionGeo). punkte = [[x,z],…]',
  { punkte: z.array(z.tuple([z.number(), z.number()])).min(1).max(64), seed: z.string().optional() },
  ({ punkte, seed }) => {
    const layout = lade();
    const geo = createGeo({ mode: 'layout', worldSeed: getStableHash(seed ?? layout.detailSeed), layout });
    const zeilen = punkte.map(([x, zz]) => {
      const region = geo instanceof RegionGeo ? geo.regionAt(x, zz)?.id ?? 'offene See' : '?';
      return `(${x}, ${zz}): Höhe ${geo.getHeight(x, zz).toFixed(1)} m, Biom ${geo.getBiome(x, zz)}, Region ${region}`;
    });
    return { content: [{ type: 'text', text: zeilen.join('\n') }] };
  }
);

mcp.tool(
  'layout_deploy',
  'Welt veröffentlichen: Dokument ist bereits gespeichert — startet den wov-Server neu, damit die Layout-Welt sie lädt. ACHTUNG: wirft alle Spieler kurz aus dem Spiel.',
  {},
  () => {
    // Läuft dieser Prozess über WOV_LAYOUT_PFAD gegen eine Testkopie, würde
    // ein echter Neustart trotzdem die ECHTE Instanzdatei laden — die
    // Teständerungen blieben unsichtbar, und eine Erfolgsmeldung hier wäre
    // schlicht falsch. Siehe Kopfkommentar "Gefahrlos ausprobieren".
    if (LAYOUT_PFAD !== ECHTER_LAYOUT_PFAD) {
      return {
        content: [{
          type: 'text',
          text:
            `Verweigert: dieser Server arbeitet über WOV_LAYOUT_PFAD auf ${LAYOUT_PFAD}. ` +
            `Ein Neustart würde stattdessen ${ECHTER_LAYOUT_PFAD} laden — deine Teständerungen ` +
            `blieben unsichtbar. layout_deploy nur ohne WOV_LAYOUT_PFAD aufrufen.`,
        }],
        isError: true,
      };
    }
    execFileSync('systemctl', ['restart', 'wov-server'], { timeout: 30000 });
    return {
      content: [{ type: 'text', text: 'wov-server neu gestartet — die Welt lädt das aktuelle Layout (Boot ~2 s, seit die Locations entfallen sind).' }],
    };
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
console.error(`[worldlayout-mcp] bereit — Dokument: ${LAYOUT_PFAD}`);
