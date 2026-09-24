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
 * `layout_deploy` startet den wov-Server neu (systemd).
 *
 * ── Ein Schreiber: der Betriebsdienst ────────────────────────────────
 * Dieser Prozess liest und schreibt die Weltdatei NICHT selbst. Er spricht
 * mit dem Betriebsdienst (admin/): GET /api/worldlayout liefert Dokument
 * und Hash, jede Änderung geht als POST /api/worldlayout MIT diesem Hash
 * als Basis zurück. Hat der Editor (oder ein zweiter MCP-Aufruf) in der
 * Zwischenzeit gespeichert, antwortet der Betriebsdienst mit 409, und das
 * Werkzeug meldet es, statt die fremde Änderung zu überschreiben.
 *
 * Wo der Betriebsdienst steht, kommt aus derselben Umgebung wie bei seinen
 * anderen Kunden (client/vite.config.ts):
 *   WOV_ADMIN_URL           ganze Adresse; überschreibt alles Folgende
 *   WOV_ADMIN_ADRESSE/PORT  Vorgabe 127.0.0.1 : 2468 (im Betrieb setzt die
 *                           Unit die Adresse aus /etc/wov.env)
 *   WOV_ADMIN_TOKEN         das Vorschalter-Token direkt, sonst
 *   WOV_ADMIN_TOKEN_DATEI   Datei mit dem Token. Ohne Angabe gilt, was der
 *                           Rechner hat: server/data/admin.token im Checkout
 *                           (das legt `npm run dev` an, scripts/dev.mjs) und
 *                           danach /etc/wov-admin.token (Betrieb, root-only)
 * Leere Werte zählen als nicht gesetzt: `.mcp.json` reicht die Variablen
 * ungesetzt als leere Zeichenkette durch. Der Betriebsdienst lässt nur das
 * lokale Netz herein und verlangt das Token (Kopf x-wov-token).
 *
 * ── Schreiben nur in die Welt dieses Checkouts ────────────────────────
 * Die *_set/*_delete-Werkzeuge schreiben nur, wenn der angesprochene
 * Betriebsdienst die Weltdatei DIESES Checkouts verwaltet
 * (server/data/welten/<instanz>.json des Repos, in dem diese Datei liegt;
 * WOV_WURZEL wird NICHT gelesen). Der Dienst meldet in GET /api/worldlayout
 * die `weltKennung` (sha256 des realpath, kein Pfad); stimmt sie nicht oder
 * fehlt sie, oder zeigt die eigene Weltdatei (bzw. ein Ordner darüber) über
 * einen Symlink aus dem Checkout hinaus, verweigert das Werkzeug mit einer
 * Meldung, die den eigenen Pfad nennt. Lesen bleibt immer erlaubt.
 * WOV_MCP_FREMDE_WELT=1 hebt die Sperre auf, wenn eine fremde Welt bewusst
 * geschrieben werden soll. Grund: In einem Worktree auf wov-dev zeigt die
 * Vorgabe (127.0.0.1:2468) auf den DEV-Betriebsdienst, also auf Mikes
 * TABU-Spielstand.
 *
 * ── Gefahrlos ausprobieren ────────────────────────────────────────────
 * Einen eigenen Betriebsdienst auf dem Slot-Port starten (`WOV_WURZEL` =
 * dieser Checkout ist die Vorgabe, `WOV_ADMIN_PORT=248n`) und den
 * MCP-Server mit demselben WOV_ADMIN_PORT ansprechen. Auf einer Weltkopie
 * außerhalb des Checkouts (WOV_WURZEL auf ein Wegwerfverzeichnis,
 * WOV_ADMIN_PORT=0, eigene WOV_ADMIN_TOKEN_DATEI) braucht der MCP-Server
 * WOV_MCP_FREMDE_WELT=1. `probe.ts` legt stattdessen eine Kopie dieses
 * Servers in die Testwurzel: dort IST sie der eigene Checkout.
 *
 * `layout_deploy` verweigert die Arbeit, solange WOV_ADMIN_URL gesetzt ist:
 * Ein Neustart des lokalen wov-Servers lädt die Weltdatei DIESER Instanz,
 * nicht die des angesprochenen Betriebsdienstes — Teständerungen blieben
 * unsichtbar, und eine Erfolgsmeldung wäre falsch.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import {
  sanitizeWorldLayout,
  pruefeLayout,
  layoutKennung,
  RegionGeo,
  createGeo,
  getStableHash,
  BIOME_BY_NAME,
  FRAKTIONEN,
  NPC_ROLLEN,
  QUEST_ZUSTAENDE,
  type RegionDef,
  type ContinentDef,
  type RiverDef,
  type LakeDef,
  type RouteDef,
  type PlacementDef,
  type BiomeName,
} from '@wov/shared';
import { frischePlatzierungsId } from '@wov/shared/src/worldlayout/platzierungsId.js';
import { PLATZIERUNGEN_GRENZE } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { ID_RE } from '@wov/shared/src/worldlayout/platzierungsId.js';
import { mcp, ADMIN_URL, lade, schreibe, zusammenfassung } from './kern.js';

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
  id: z
    .string()
    .optional()
    .describe(
      'Stabile ID der Platzierung (a-z, 0-9, - und _, höchstens 64 Zeichen). Vorhanden: diese Platzierung wird ' +
        'ersetzt, ist sie neu, wird sie mit dieser ID angelegt. Fehlt sie: neue Platzierung mit frisch vergebener ID.'
    ),
  prefab: z.string().describe('Prefab-Name aus der Registry'),
  x: z.number(),
  z: z.number(),
  yaw: z.number().optional().describe('Drehung um die Hochachse in Radiant (Default 0)'),
  scale: z.number().optional().describe('Einheitliche Skalierung (Default 1)'),
  route: z.string().optional().describe('ID einer Route aus WorldLayout.routes'),
  einebnen: z.number().optional().describe('Radius in m, in dem der Untergrund eingeebnet wird'),
  npc: npcSchema.optional(),
});

mcp.tool('layout_get', 'Aktuelles WorldLayout als Zusammenfassung + JSON', {}, async () => {
  const { layout } = await lade();
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
  async () => {
    const befunde = pruefeLayout((await lade()).layout);
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
  async ({ region }) => {
    const { layout, hash } = await lade();
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
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('region_delete', 'Region löschen', { id: z.string() }, async ({ id }) => {
  const { layout, hash } = await lade();
  if (!layout.regions.some((r) => r.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannte Region: ${id}` }], isError: true };
  }
  const neu = { ...layout, regions: layout.regions.filter((r) => r.id !== id) };
  await schreibe(neu, hash);
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
  async ({ kontinent }) => {
    const { layout, hash } = await lade();
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
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'continent_delete',
  'Kontinent löschen. Regionen mit dieser continentId werden NICHT nachgezogen — ' +
    'die Zuordnung verwaist still, wie auch layout_pruefen es (noch) nicht meldet.',
  { id: z.string() },
  async ({ id }) => {
    const { layout, hash } = await lade();
    if (!layout.continents.some((k) => k.id === id)) {
      return { content: [{ type: 'text', text: `Unbekannter Kontinent: ${id}` }], isError: true };
    }
    const neu = { ...layout, continents: layout.continents.filter((k) => k.id !== id) };
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'river_set',
  'Fluss anlegen oder (bei vorhandener id) vollständig ersetzen.',
  { fluss: riverSchema },
  async ({ fluss }) => {
    const { layout, hash } = await lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      rivers: ersetzeNachId(layout.rivers, fluss as unknown as RiverDef),
    });
    if (!neu || !(neu.rivers ?? []).some((r) => r.id === fluss.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: Fluss übersteht sanitize nicht.' }], isError: true };
    }
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('river_delete', 'Fluss löschen', { id: z.string() }, async ({ id }) => {
  const { layout, hash } = await lade();
  if (!(layout.rivers ?? []).some((r) => r.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannter Fluss: ${id}` }], isError: true };
  }
  const neu = { ...layout, rivers: (layout.rivers ?? []).filter((r) => r.id !== id) };
  await schreibe(neu, hash);
  return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
});

mcp.tool(
  'lake_set',
  'See anlegen oder (bei vorhandener id) vollständig ersetzen.',
  { see: lakeSchema },
  async ({ see }) => {
    const { layout, hash } = await lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      lakes: ersetzeNachId(layout.lakes, see as unknown as LakeDef),
    });
    if (!neu || !(neu.lakes ?? []).some((l) => l.id === see.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: See übersteht sanitize nicht.' }], isError: true };
    }
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool('lake_delete', 'See löschen', { id: z.string() }, async ({ id }) => {
  const { layout, hash } = await lade();
  if (!(layout.lakes ?? []).some((l) => l.id === id)) {
    return { content: [{ type: 'text', text: `Unbekannter See: ${id}` }], isError: true };
  }
  const neu = { ...layout, lakes: (layout.lakes ?? []).filter((l) => l.id !== id) };
  await schreibe(neu, hash);
  return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
});

mcp.tool(
  'route_set',
  'Route anlegen oder (bei vorhandener id) vollständig ersetzen — Platzierungen ' +
    'verweisen per `route`-Feld darauf (siehe placement_set).',
  { route: routeSchema },
  async ({ route }) => {
    const { layout, hash } = await lade();
    const neu = sanitizeWorldLayout({
      ...layout,
      routes: ersetzeNachId(layout.routes, route as unknown as RouteDef),
    });
    if (!neu || !(neu.routes ?? []).some((r) => r.id === route.id)) {
      return { content: [{ type: 'text', text: 'Abgelehnt: Route übersteht sanitize nicht.' }], isError: true };
    }
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'route_delete',
  'Route löschen. Platzierungen, die per `route` darauf verwiesen, bleiben stehen — ' +
    'layout_pruefen meldet die verwaiste Referenz.',
  { id: z.string() },
  async ({ id }) => {
    const { layout, hash } = await lade();
    if (!(layout.routes ?? []).some((r) => r.id === id)) {
      return { content: [{ type: 'text', text: `Unbekannte Route: ${id}` }], isError: true };
    }
    const neu = { ...layout, routes: (layout.routes ?? []).filter((r) => r.id !== id) };
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gelöscht.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'placement_set',
  'Platzierung anlegen oder ersetzen. Mit `id` (die layout_get je Platzierung liefert) wird genau diese ' +
    'Platzierung ersetzt bzw. mit dieser ID angelegt; ohne `id` entsteht IMMER eine neue Platzierung mit frisch ' +
    'vergebener ID (auch im selben Meter wie eine bestehende). `ersetzeKennung` ist der veraltete Rückfall: die ' +
    'alte Kennung `Prefab@x,z` wird auf die eine Platzierung mit dieser Kennung aufgelöst.',
  { platzierung: placementSchema, ersetzeKennung: z.string().optional() },
  async ({ platzierung, ersetzeKennung }) => {
    const { layout, hash } = await lade();
    const bestehend = layout.placements ?? [];
    const fehler = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    let id = platzierung.id;
    let hinweis = '';
    if (id === undefined && ersetzeKennung !== undefined) {
      const treffer = bestehend.filter((p) => layoutKennung(p) === ersetzeKennung);
      if (treffer.length === 0) return fehler(`Abgelehnt: keine Platzierung mit der alten Kennung ${ersetzeKennung}.`);
      if (treffer.length > 1) {
        return fehler(
          `Abgelehnt: die alte Kennung ${ersetzeKennung} ist mehrdeutig (${treffer.map((p) => p.id).join(', ')}) — ` +
            'bitte die `id` angeben.'
        );
      }
      id = treffer[0]!.id;
      hinweis = ` Hinweis: Adressieren über die alte Kennung ist veraltet — die id dieser Platzierung ist ${id}.`;
    }
    if (id !== undefined && !ID_RE.test(id)) {
      return fehler('Abgelehnt: ungültige id (erlaubt: a-z, 0-9, - und _, höchstens 64 Zeichen, nicht mit - oder _ beginnen).');
    }
    // Eine NEUE Platzierung bekommt eine id mit Zufallsschwanz, nie die abgeleitete: `placement_delete` und ein
    // gleichartiges `placement_set` am selben Ort ergäben sonst dieselbe id, und der Spielserver hielte das für
    // dasselbe Objekt (samt Zustand, etwa Truheninhalt).
    const neueId = id ?? frischePlatzierungsId(layout, platzierung);
    const ersetzt = bestehend.some((p) => p.id === neueId);
    const ohne = bestehend.filter((p) => p.id !== neueId);
    // Der Sanitizer schneidet still bei PLATZIERUNGEN_GRENZE ab und liesse die
    // NEUE Platzierung wortlos fallen — die Meldung unten würde dann die
    // falsche Ursache nennen.
    if (ohne.length + 1 > PLATZIERUNGEN_GRENZE) {
      return fehler(`Abgelehnt: das Weltdokument nimmt höchstens ${PLATZIERUNGEN_GRENZE} Platzierungen auf.`);
    }
    const neu = sanitizeWorldLayout({
      ...layout,
      placements: [...ohne, { ...platzierung, id: neueId } as unknown as PlacementDef],
    });
    if (!neu || !(neu.placements ?? []).some((p) => p.id === neueId)) {
      return fehler('Abgelehnt: Platzierung übersteht sanitize nicht (Prefab/Position prüfen).');
    }
    await schreibe(neu, hash);
    return {
      content: [{
        type: 'text',
        text: `Gespeichert (id ${neueId}, ${ersetzt ? 'ersetzt' : 'neu angelegt'}).${hinweis}\n${zusammenfassung(neu)}`,
      }],
    };
  }
);

mcp.tool(
  'placement_delete',
  'Platzierung über ihre `id` löschen. Rückfall (veraltet): `prefab` + `x` + `z` lösen sich über die alte ' +
    'Kennung auf, aber nur, wenn genau EINE Platzierung so heißt — sonst wird abgelehnt und die ids werden genannt.',
  {
    id: z.string().optional(),
    prefab: z.string().optional(),
    x: z.number().optional(),
    z: z.number().optional(),
  },
  async ({ id, prefab, x, z: zz }) => {
    const { layout, hash } = await lade();
    const bestehend = layout.placements ?? [];
    const fehler = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    let ziel: string;
    let hinweis = '';
    if (id !== undefined) {
      ziel = id;
    } else if (prefab !== undefined && x !== undefined && zz !== undefined) {
      const kennung = layoutKennung({ prefab, x, z: zz });
      const treffer = bestehend.filter((p) => layoutKennung(p) === kennung);
      if (treffer.length === 0) return fehler(`Keine Platzierung mit Kennung ${kennung}`);
      if (treffer.length > 1) {
        return fehler(
          `Abgelehnt: die alte Kennung ${kennung} ist mehrdeutig (${treffer.map((p) => p.id).join(', ')}) — ` +
            'bitte die `id` angeben.'
        );
      }
      ziel = treffer[0]!.id!;
      hinweis = ` Hinweis: Adressieren über Prefab und Position ist veraltet — die id war ${ziel}.`;
    } else {
      return fehler('Abgelehnt: `id` angeben (oder, veraltet, `prefab` + `x` + `z`).');
    }
    const uebrig = bestehend.filter((p) => p.id !== ziel);
    if (uebrig.length === bestehend.length) return fehler(`Keine Platzierung mit id ${ziel}`);
    const neu = { ...layout, placements: uebrig };
    await schreibe(neu, hash);
    return {
      content: [{ type: 'text', text: `Platzierung gelöscht (id ${ziel}).${hinweis}\n${zusammenfassung(neu)}` }],
    };
  }
);

mcp.tool(
  'defaultSpawn_set',
  'Welt-Startpunkt setzen — greift, wenn die Fraktion des Spielers keinen eigenen ' +
    'Kontinent-Spawn hat (siehe continent_set).',
  { x: z.number(), z: z.number() },
  async ({ x, z: zz }) => {
    const { layout, hash } = await lade();
    const neu = sanitizeWorldLayout({ ...layout, defaultSpawn: [x, zz] });
    if (!neu || !neu.defaultSpawn) {
      return {
        content: [{ type: 'text', text: 'Abgelehnt: Koordinaten außerhalb der Karte (±40 km).' }],
        isError: true,
      };
    }
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'defaultSpawn_clear',
  'Welt-Startpunkt entfernen (Spawn fällt auf Ursprung/Kontinent-Spawn zurück).',
  {},
  async () => {
    const { layout, hash } = await lade();
    const ohneSpawn: Record<string, unknown> = { ...layout };
    delete ohneSpawn.defaultSpawn;
    const neu = sanitizeWorldLayout(ohneSpawn);
    if (!neu) {
      return { content: [{ type: 'text', text: 'Unerwartet abgelehnt.' }], isError: true };
    }
    await schreibe(neu, hash);
    return { content: [{ type: 'text', text: `Gespeichert.\n${zusammenfassung(neu)}` }] };
  }
);

mcp.tool(
  'layout_probe',
  'Weltprobe an Punkten: Biom und Höhe, wie der Spielserver sie rechnen wird (RegionGeo). punkte = [[x,z],…]',
  { punkte: z.array(z.tuple([z.number(), z.number()])).min(1).max(64), seed: z.string().optional() },
  async ({ punkte, seed }) => {
    const { layout } = await lade();
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
  async () => {
    // Zeigt dieser Prozess über WOV_ADMIN_URL auf einen eigens gestarteten
    // Betriebsdienst (Testkopie), würde ein echter Neustart trotzdem die
    // Weltdatei DIESER Instanz laden — die Teständerungen blieben
    // unsichtbar, und eine Erfolgsmeldung hier wäre schlicht falsch. Siehe
    // Kopfkommentar "Gefahrlos ausprobieren".
    if (process.env.WOV_ADMIN_URL) {
      return {
        content: [{
          type: 'text',
          text:
            `Verweigert: dieser Server arbeitet über WOV_ADMIN_URL auf ${ADMIN_URL}. ` +
            `Ein Neustart würde stattdessen die Weltdatei der lokalen Instanz laden — deine ` +
            `Teständerungen blieben unsichtbar. layout_deploy nur ohne WOV_ADMIN_URL aufrufen.`,
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

// ── Weltbau-Werkzeuge (M0a/M1/M2): jede Datei registriert sich selbst am `mcp` aus kern.ts ──
// (ESM wertet statische Importe vor dem Rumpf aus; die Reihenfolge ist fest.)
import './werkzeuge/vorgaenge.js'; // ops_apply, undo_last, world_diff
import './werkzeuge/katalog.js'; // catalog_search, uploads_list, style_guide
import './werkzeuge/sehen.js'; // map_render
import './werkzeuge/pruefen.js'; // world_check, world_diff, area_describe

const transport = new StdioServerTransport();
await mcp.connect(transport);
console.error(`[worldlayout-mcp] bereit — Betriebsdienst: ${ADMIN_URL}`);
