/**
 * Werkzeuge zum Sehen: map_render (Kartenbild ohne GPU). world_check und
 * area_describe kommen von einer eigenen Karte und werden hier ergänzt.
 */
import { z } from 'zod';
import { mcp, lade, meldungVon } from '../kern.js';
import { KARTEN_EBENEN, KARTE_PIXEL } from '@wov/shared/src/weltbau/karte.js';
import { rendereKarte, weltBereich } from '../karten.js';
import { huellenAufloeser } from '@wov/shared/src/weltbau/huelle.js';
import type { Grundflaeche } from '@wov/shared/src/weltbau/karte.js';

const huellen = huellenAufloeser();
/** Grundfläche je Prefab aus der Hülle (unskaliert, um den Ursprung); unbekannte Prefabs bleiben Punkte. */
const flaecheVon = (prefab: string): { flaeche: Grundflaeche; fest: boolean } | undefined => {
  const h = huellen(prefab);
  return h ? { flaeche: { art: 'rechteck', halbX: h.halbX, halbZ: h.halbZ }, fest: h.fest } : undefined;
};

const bereichSchema = z.union([
  z.object({ minX: z.number(), minZ: z.number(), maxX: z.number(), maxZ: z.number() }),
  z.object({ x: z.number(), z: z.number(), radius: z.number().positive() }),
]);

mcp.registerTool(
  'map_render',
  {
    description:
      'Kartenbild (PNG) eines Ausschnitts der Welt, ohne GPU: Gelände in den Farben des Editors, dazu Ebenen ' +
      '(wasser = Flüsse/Seen des Dokuments, platzierungen, routen, regionen, raster, befunde). ' +
      'bereich = {minX,minZ,maxX,maxZ} oder {x,z,radius} in Metern; ohne bereich die ganze Welt. ' +
      'pixel = längste Bildkante (128|256|512|1024, Vorgabe 512). x wächst nach rechts, z nach unten. ' +
      'Platzierungen erscheinen mit ihrer Grundfläche (Hülle des Prefabs), unbekannte Prefabs als Punkt. ' +
      'befunde = Befunde aus world_check (rot/gelb mit x,z werden gezeichnet; Art frist/hinweis oder ohne Koordinate nur gezählt), nur bei Bereich ≤ 512 m. Nur lesend.',
    inputSchema: {
      bereich: bereichSchema.optional(),
      pixel: z.union(KARTE_PIXEL.map((p) => z.literal(p)) as [z.ZodLiteral<number>, z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]).optional(),
      ebenen: z.array(z.enum(KARTEN_EBENEN as unknown as [string, ...string[]])).max(KARTEN_EBENEN.length).optional(),
      befunde: z
        .array(z.object({ schwere: z.string().optional(), x: z.number().optional(), z: z.number().optional() }).passthrough())
        .max(500)
        .optional(),
    },
  },
  async ({ bereich, pixel, ebenen, befunde }) => {
    try {
      const { layout } = await lade();
      const r = rendereKarte(layout, { bereich: bereich ?? weltBereich(layout), pixel, ebenen, befunde, flaeche: flaecheVon });
      return {
        content: [
          { type: 'text' as const, text: r.text },
          { type: 'image' as const, data: r.png.toString('base64'), mimeType: 'image/png' },
        ],
      };
    } catch (e) {
      const text = e instanceof Error ? e.message : meldungVon({ fehler: String(e) });
      return { isError: true, content: [{ type: 'text' as const, text: `map_render: ${text}` }] };
    }
  }
);
