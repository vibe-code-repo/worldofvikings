/**
 * Kontext-Werkzeuge des WorldLayout-MCP: catalog_search, uploads_list,
 * style_guide (Ressource) und style_guide_get (Rückfall für Clients ohne
 * Ressourcen). Nur lesen.
 *
 * Dünne Hülle um shared/src/weltbau/{katalog,stil,manifest}.ts; die Datei
 * liest nur `assets/manifest.json` und `assets/hochgeladen/registry.json`
 * dieses Checkouts und das Weltdokument (`lade()`, nur für „platziert“).
 *
 * Context tools: catalogue search, upload list, style guide; read-only.
 */
import { z } from 'zod';
import { BIOME_BY_NAME } from '@wov/shared';
import { baueKatalog, sucheKatalog, KatalogFehler, KATALOG_LIMIT_MAX, KATALOG_LIMIT_VORGABE, type KatalogEintrag } from '@wov/shared/src/weltbau/katalog.js';
import { erzeugeStilfuehrer } from '@wov/shared/src/weltbau/stil.js';
import { mcp, lade } from '../kern.js';
import { leseManifestDatei, leseUploads } from './uploads.js';

type Antwort = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (kopf: string, daten: unknown): Antwort => ({
  content: [{ type: 'text', text: `${kopf}\n\n${JSON.stringify(daten)}` }],
});
const fehler = (text: string): Antwort => ({ content: [{ type: 'text', text }], isError: true });

/** Der Index wird beim ersten Aufruf gebaut und nur neu, wenn sich die Upload-Liste ändert. */
let katalogCache: { schluessel: string; katalog: KatalogEintrag[]; hinweise: string[] } | undefined;
function katalog(): { katalog: KatalogEintrag[]; hinweise: string[] } {
  const uploads = leseUploads();
  const schluessel = JSON.stringify(uploads.eintraege.map((u) => [u.name, u.zeitpunkt, u.kollisionsart, u.breite, u.hoehe, u.tiefe]));
  if (katalogCache?.schluessel !== schluessel) {
    const m = leseManifestDatei();
    const hinweise = [m.hinweis, uploads.hinweis].filter((h): h is string => h !== undefined);
    katalogCache = { schluessel, katalog: baueKatalog({ manifest: m.manifest, uploads: uploads.eintraege }), hinweise };
  }
  return katalogCache;
}

mcp.registerTool(
  'catalog_search',
  {
    description:
      'Sucht setzbare Prefabs (nur lesen). `name` eines Treffers ist GENAU der Prefab-Name, den ops_apply annimmt; ' +
      'andere Namen lehnt ops_apply ab. Filter: text (Teilwort, ohne Groß-/Kleinschreibung und Umlaute, über Name/Gruppe/Untergruppe), ' +
      'gruppe, untergruppe, fest (blockiert die Spielfigur), Breite/Höhe in Metern, biom (wo die Vegetation dieses Modell erzeugt), ' +
      `quelle (store, eigen, upload). Höchstens ${KATALOG_LIMIT_MAX} Treffer je Aufruf (Vorgabe ${KATALOG_LIMIT_VORGABE}), weiter mit start. ` +
      'Maße mit huelleQuelle "keine" sind unbekannt (null) — nicht raten.',
    inputSchema: {
      text: z.string().optional(),
      gruppe: z.string().optional(),
      untergruppe: z.string().optional(),
      fest: z.boolean().optional(),
      breiteMin: z.number().optional(),
      breiteMax: z.number().optional(),
      hoeheMax: z.number().optional(),
      biom: z.string().optional().describe(`eines von ${[...BIOME_BY_NAME.keys()].join(', ')}`),
      quelle: z.array(z.enum(['store', 'eigen', 'upload'])).optional(),
      limit: z.number().int().optional(),
      start: z.number().int().optional(),
    },
  },
  async (a): Promise<Antwort> => {
    try {
      const t0 = performance.now();
      const { katalog: k, hinweise } = katalog();
      const r = sucheKatalog(k, a);
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      const kopf =
        `catalog_search: ${r.gesamt} Treffer, ${r.treffer.length} ausgegeben ab ${r.start} (${ms} ms)` +
        (hinweise.length > 0 ? ` — Hinweis: ${hinweise.join('; ')}` : '');
      return ok(kopf, { gesamt: r.gesamt, start: r.start, treffer: r.treffer });
    } catch (f) {
      return fehler(f instanceof KatalogFehler ? f.message : `catalog_search: ${(f as Error).message}`);
    }
  }
);

mcp.registerTool(
  'uploads_list',
  {
    description:
      'Listet die hochgeladenen Modelle dieses Checkouts (nur lesen, aus assets/hochgeladen/registry.json): Maße, ' +
      'Kollisionsart (fest/durchlaessig), Dreiecke und wie oft das Modell im aktuellen Weltdokument platziert ist. ' +
      'Fehlt der Ordner, ist die Liste leer (kein Fehler).',
    inputSchema: { name: z.string().optional().describe('nur dieses Modell (Prefab-Name, U_…)') },
  },
  async ({ name }): Promise<Antwort> => {
    try {
      const u = leseUploads();
      const { layout } = await lade();
      const platziert = new Map<string, number>();
      for (const p of layout.placements ?? []) platziert.set(p.prefab, (platziert.get(p.prefab) ?? 0) + 1);
      const modelle = u.eintraege
        .filter((m) => name === undefined || m.name === name)
        .map((m) => ({
          name: m.name,
          anzeigename: m.anzeigename,
          breite: m.breite,
          hoehe: m.hoehe,
          tiefe: m.tiefe,
          kollisionsart: m.kollisionsart,
          dreiecke: m.dreiecke,
          hatKollisionsnetz: m.hatKollisionsnetz,
          zeitpunkt: m.zeitpunkt,
          hochgeladenVon: m.hochgeladenVon,
          platziert: platziert.get(m.name) ?? 0,
        }));
      if (name !== undefined && modelle.length === 0) return fehler(`uploads_list: kein Upload mit dem Namen "${name}".`);
      return ok(
        `uploads_list: ${modelle.length} Modell(e)${u.hinweis ? ` — ${u.hinweis}` : ''}`,
        { anzahl: modelle.length, modelle, ...(u.hinweis ? { hinweis: u.hinweis } : {}) }
      );
    } catch (f) {
      return fehler(`uploads_list: ${(f as Error).message}`);
    }
  }
);

const STIL_URI = 'wov://weltbau/style_guide';

mcp.registerResource(
  'style_guide',
  STIL_URI,
  { title: 'Stilführer Weltbau', description: 'Regeln und Maße für den Weltbau (aus dem Code erzeugt, Vorschläge markiert)', mimeType: 'text/markdown' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: erzeugeStilfuehrer() }] })
);

mcp.registerTool(
  'style_guide_get',
  {
    description: `Der Stilführer für den Weltbau als Text (dieselbe Quelle wie die Ressource ${STIL_URI}, für Clients ohne Ressourcen). Nur lesen.`,
    inputSchema: {},
  },
  async (): Promise<Antwort> => {
    try {
      return { content: [{ type: 'text', text: erzeugeStilfuehrer() }] };
    } catch (f) {
      return fehler(`style_guide_get: ${(f as Error).message}`);
    }
  }
);
