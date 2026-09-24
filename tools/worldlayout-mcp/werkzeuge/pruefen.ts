/**
 * Prüf-Werkzeuge des WorldLayout-MCP: world_check, world_diff, area_describe.
 *
 * Dünne Hülle um die reinen Funktionen in shared/src/weltbau/ — die Logik
 * (und ihre Typprüfung) liegt dort. Diese Datei liest nur (`lade()`), sie
 * schreibt nie. Die Geo wird je Dokument-Hash einmal gebaut und gehalten.
 *
 * Check tools: thin wrapper over the pure functions in shared/src/weltbau/;
 * read-only.
 */
import { z } from 'zod';
import { createGeo, getStableHash, RegionGeo, sanitizeWorldLayout, type WorldLayout } from '@wov/shared';
import { pruefeWelt, BereichFehler, ALLE_PRUEFUNGEN } from '@wov/shared/src/weltbau/pruefungen.js';
import { diffLayouts } from '@wov/shared/src/weltbau/diff.js';
import { beschreibeOrt, type GeoLese } from '@wov/shared/src/weltbau/beschreiben.js';
import { BESCHREIBEN_RADIUS_MAX, BESCHREIBEN_RADIUS_VORGABE } from '@wov/shared/src/weltbau/grenzen.js';
import { waehleDiffBasis } from '@wov/shared/src/weltbau/diffBasis.js';
import { mcp, lade, sitzungsBasis } from '../kern.js';
import { vorgangsStapel } from './vorgaenge.js';
import { huellenFuerAufruf } from './huellen.js';

type Antwort = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (kopf: string, daten: unknown): Antwort => ({
  content: [{ type: 'text', text: `${kopf}\n\n${JSON.stringify(daten)}` }],
});
const fehler = (text: string): Antwort => ({ content: [{ type: 'text', text }], isError: true });

/** Die Geo des zuletzt gelesenen Dokuments; höchstens eine Instanz. */
let geoCache: { hash: string; geo: RegionGeo } | undefined;
function geoFuer(layout: WorldLayout, hash: string): RegionGeo {
  if (geoCache?.hash !== hash) {
    const geo = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout });
    if (!(geo instanceof RegionGeo)) throw new Error('Layout-Geo erwartet');
    geoCache = { hash, geo };
  }
  return geoCache.geo;
}

const bereichSchema = z
  .union([
    z.object({ x: z.number(), z: z.number(), radius: z.number() }),
    z.object({ minX: z.number(), minZ: z.number(), maxX: z.number(), maxZ: z.number() }),
  ])
  .describe('Kreis {x, z, radius} oder Rechteck {minX, minZ, maxX, maxZ} in Welt-Metern; Kante höchstens 512 m');

mcp.registerTool(
  'world_check',
  {
    description:
      'Weltprüfung eines Bereichs (nur lesen): überlappende feste Grundflächen, Objekte im Wasser, ' +
      'zu steile Hänge, Häuser ohne erreichbaren Eingang, Routen durch feste Körper, Objektbudget je 64-m-Zone. ' +
      'Antwort: Ampel (gruen/gelb/rot), Zähler und Befunde mit Koordinate. Die Grenzwerte (Hang 30°/45°, ' +
      'Gebäude-Höhenspanne 0,4/1,5 m, Zone 40/80 Objekte) sind Vorgaben und über `grenzen` änderbar. ' +
      'Hausmodelle ohne Türangabe: „Eingang geschätzt“ (gelb). Frist 15 s und Kappen (64 Routen, 2 Mio. Stützpunkte): ' +
      'wird sie überschritten, kommt ein TEILBERICHT mit dem Stand je Prüfung (nie still weniger geprüft).',
    inputSchema: {
      bereich: bereichSchema,
      pruefungen: z.array(z.enum(ALLE_PRUEFUNGEN as [string, ...string[]])).optional().describe('Vorgabe: alle'),
      grenzen: z
        .object({
          hangGradGelb: z.number().optional(),
          hangGradRot: z.number().optional(),
          spanneGelb: z.number().optional(),
          spanneRot: z.number().optional(),
          zoneObjekteGelb: z.number().optional(),
          zoneObjekteRot: z.number().optional(),
        })
        .optional(),
      von: z.tuple([z.number(), z.number()]).optional().describe('Startpunkt der Wegsuche für „Haus ohne Eingang“'),
    },
  },
  async ({ bereich, pruefungen, grenzen, von }): Promise<Antwort> => {
    try {
      const { layout, hash } = await lade();
      const t0 = performance.now();
      const geo = geoFuer(layout, hash);
      const e = pruefeWelt(layout, geo, bereich, {
        pruefungen: pruefungen as never,
        huellen: huellenFuerAufruf(),
        grenzen,
        von,
      });
      const ms = Math.round(performance.now() - t0);
      const ampel = e.ampel === 'gruen' ? 'GRÜN' : e.ampel === 'gelb' ? 'GELB' : 'ROT';
      const nichts = e.nichtPruefbar.length > 0 ? `, ${e.nichtPruefbar.length} Prefab(s) ohne Hülle` : '';
      const teil = e.teilweise ? ` — TEILBERICHT: ${e.hinweis}` : '';
      return ok(
        `world_check: ${ampel} (${e.zaehler.rot} rot, ${e.zaehler.gelb} gelb) in ${ms} ms, ${e.objekte} Objekte${nichts}${teil}`,
        { ...e, ms }
      );
    } catch (f) {
      return fehler(f instanceof BereichFehler ? f.message : `world_check: ${(f as Error).message}`);
    }
  }
);

mcp.registerTool(
  'world_diff',
  {
    description:
      'Was hat sich geändert? Vergleicht das aktuelle Weltdokument (nur lesen) mit dem Stand beim ersten Lesen dieser ' +
      'Sitzung (gegen "sitzung", Vorgabe), mit dem Stand vor dem letzten Vorgang ("vorgang"), vor einem bestimmten Vorgang ({vorgang: id}) oder mit einem übergebenen Dokument. Zählt neu/geändert/entfernt/verschoben ' +
      'je Sammlung und sagt, ob das Gelände betroffen ist (wirkt dann erst nach Neustart). ' +
      'Die Sitzungsbasis geht beim Neustart des MCP-Prozesses verloren.',
    inputSchema: {
      gegen: z
        .union([z.literal('sitzung'), z.literal('vorgang'), z.object({ vorgang: z.string() }), z.object({ layout: z.unknown() })])
        .optional()
        .describe('"sitzung" (Vorgabe), "vorgang" (vor dem letzten ops_apply), { vorgang: "<id>" } oder { layout: <WorldLayout-Dokument> }'),
    },
  },
  async ({ gegen }): Promise<Antwort> => {
    try {
      const { layout } = await lade();
      const w = waehleDiffBasis(gegen, {
        sitzung: sitzungsBasis,
        oberster: () => vorgangsStapel.oberster(),
        finde: (id) => vorgangsStapel.finde(id),
        bereinige: (roh) => sanitizeWorldLayout(roh),
      });
      if ('fehler' in w) return fehler(`world_diff: ${w.fehler}`);
      const d = diffLayouts(w.basis, layout);
      return ok(`world_diff: ${d.text}`, d);
    } catch (f) {
      return fehler(`world_diff: ${(f as Error).message}`);
    }
  }
);

mcp.registerTool(
  'area_describe',
  {
    description:
      'Beschreibt einen Ort (nur lesen): Höhe (min/max/mittel), größter Hang, Wasseranteil, Biome, Region mit Reglern, ' +
      'Waldfaktor, Objekte im Radius (die nächsten 50), nächste Route und die 64-m-Zone.',
    inputSchema: {
      x: z.number(),
      z: z.number(),
      radius: z
        .number()
        .optional()
        .describe(`Meter, höchstens ${BESCHREIBEN_RADIUS_MAX}, Vorgabe ${BESCHREIBEN_RADIUS_VORGABE}`),
    },
  },
  async ({ x, z: zz, radius }): Promise<Antwort> => {
    try {
      const { layout, hash } = await lade();
      const t0 = performance.now();
      const b = beschreibeOrt(layout, geoFuer(layout, hash) as unknown as GeoLese, x, zz, radius ?? BESCHREIBEN_RADIUS_VORGABE, huellenFuerAufruf());
      const ms = Math.round(performance.now() - t0);
      return ok(`area_describe: ${b.text} (${ms} ms)`, { ...b, ms });
    } catch (f) {
      return fehler(f instanceof BereichFehler ? f.message : `area_describe: ${(f as Error).message}`);
    }
  }
);
