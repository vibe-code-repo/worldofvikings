/**
 * WorldLayout-MCP-Server (Phase 5b des Kartengenerierungs-Umbaus).
 *
 * KI-gestützter Weltbau: exponiert das WorldLayout-Dokument
 * (server/data/worldlayout.json) als MCP-Tools, damit eine KI im Gespräch
 * Regionen anlegen, ändern und die Welt veröffentlichen kann — dieselbe
 * Datei, die auch der grafische Editor (editor.html) bearbeitet.
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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeWorldLayout,
  layoutBounds,
  RegionGeo,
  createGeo,
  getStableHash,
  type WorldLayout,
  type RegionDef,
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
const LAYOUT_PFAD = weltDatei(WURZEL);

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
    return `- ${r.id} [${r.biome}] ${form}, falloff ${r.edgeFalloff}${kur ? ` (${kur})` : ''}`;
  });
  return (
    `Welt "${layout.name}" — ${layout.regions.length} Region(en), ` +
    `Bbox x ${b.minX}…${b.maxX}, z ${b.minZ}…${b.maxZ}\n` +
    zeilen.join('\n')
  );
}

const regionSchema = z.object({
  id: z.string().describe('Kleinbuchstaben/Ziffern/Bindestrich, eindeutig'),
  biome: z.enum(['meadows', 'blackforest', 'swamp', 'mountain', 'plains', 'mistlands', 'ashlands', 'deepnorth']),
  shape: z.union([
    z.object({ kind: z.literal('circle'), x: z.number(), z: z.number(), radius: z.number() }),
    z.object({ kind: z.literal('polygon'), points: z.array(z.tuple([z.number(), z.number()])).min(3) }),
  ]),
  edgeFalloff: z.number().optional().describe('Küsten-Falloff in m (Default 300)'),
  baseLevel: z.number().optional(),
  heightScale: z.number().optional(),
  forestDensity: z.number().optional(),
  continentId: z.string().optional(),
  vegetation: z.array(z.string()).optional().describe('exklusive Vegetationsliste (Prefab-Namen)'),
  locations: z.array(z.string()).optional(),
  spawns: z.array(z.string()).optional(),
});

const mcp = new McpServer({ name: 'worldlayout', version: '1.0.0' });

mcp.tool('layout_get', 'Aktuelles WorldLayout als Zusammenfassung + JSON', {}, () => {
  const layout = lade();
  return {
    content: [{ type: 'text', text: `${zusammenfassung(layout)}\n\n${JSON.stringify(layout)}` }],
  };
});

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
    execFileSync('systemctl', ['restart', 'wov-server'], { timeout: 30000 });
    return {
      content: [{ type: 'text', text: 'wov-server neu gestartet — die Welt lädt das aktuelle Layout (Boot dauert je nach Placement einige Minuten).' }],
    };
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
console.error(`[worldlayout-mcp] bereit — Dokument: ${LAYOUT_PFAD}`);
