/**
 * Kern des WorldLayout-MCP: Betriebsdienst-Zugang, Schreibsperre und der
 * gemeinsame `mcp`-Server. `server.ts` und jede Datei unter `werkzeuge/`
 * importieren von hier, nie voneinander (kein Importkreis).
 *
 * Steht im selben Ordner wie `server.ts`, weil `CHECKOUT_WURZEL` relativ
 * zu dieser Datei gerechnet wird (`../../`). Erklärung zu Betriebsdienst,
 * Token und Schreibsperre: Kopfkommentar von `server.ts`.
 *
 * Core of the worldlayout MCP: admin-service access, write guard and the
 * shared `mcp` server instance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, layoutBounds, type WorldLayout } from '@wov/shared';
import { instanzName, weltArbeitsOrdner, weltDatei } from '@wov/shared/src/instanz.js';

// Der Betriebsdienst ist der einzige Schreiber der Weltdatei — dieser
// Prozess redet nur mit ihm, siehe Kopfkommentar. Aus layoutDatei.ts kommt
// nur die Zahl der Platzierungs-Obergrenze, keine Lese- oder Schreibfunktion.
export const ADMIN_URL = (
  process.env.WOV_ADMIN_URL ||
  `http://${process.env.WOV_ADMIN_ADRESSE || '127.0.0.1'}:${process.env.WOV_ADMIN_PORT || 2468}`
).replace(/\/+$/, '');
// Dieselbe Quelle wie der Proxy in client/vite.config.ts: das Token, das
// `npm run dev` im Checkout anlegt (scripts/dev.mjs, gitignored), sonst das
// des Betriebs. Ein ausdrücklich gesetztes WOV_ADMIN_TOKEN_DATEI gilt allein.
const ADMIN_TOKEN_DATEIEN = process.env.WOV_ADMIN_TOKEN_DATEI
  ? [process.env.WOV_ADMIN_TOKEN_DATEI]
  : [fileURLToPath(new URL('../../server/data/admin.token', import.meta.url)), '/etc/wov-admin.token'];

// Geschrieben wird nur in die Weltdatei DIESES Checkouts. Der Betriebsdienst
// meldet mit jedem GET, welche Datei er verwaltet (`weltKennung`, sha256 des
// realpath, kein Pfad); schreibe() vergleicht sie mit der Kennung der eigenen
// Datei (Wurzel: der Checkout, in dem diese Datei liegt; Instanz über
// shared/src/instanz.ts). Ohne diese Sperre schriebe ein Agent in einem
// Worktree per Vorgabe (127.0.0.1:2468) in die DEV-Welt.
//
// Die Wurzel ist FEST der Checkout dieser Datei. `WOV_WURZEL` (die Wurzel-
// Übersteuerung des Betriebsdienstes) wird hier nicht gelesen: aus einem
// Nutzerprofil käme sie ohne jede Bestätigung, und `/opt/worldofvikings` als
// „eigene" Welt hebelte die Sperre aus. Wer eine fremde Welt will, setzt
// WOV_MCP_FREMDE_WELT=1 — ausdrücklich, für diesen einen Start.
export const CHECKOUT_WURZEL = fileURLToPath(new URL('../../', import.meta.url));
const FREMDE_WELT_ERLAUBT = process.env.WOV_MCP_FREMDE_WELT === '1';
const wurzelEnv = process.env.WOV_WURZEL;
const wurzelEnvAbweichend = (): boolean => {
  try {
    return realpathSync(wurzelEnv!) !== realpathSync(CHECKOUT_WURZEL);
  } catch {
    return true;
  }
};
if (wurzelEnv && !FREMDE_WELT_ERLAUBT && wurzelEnvAbweichend()) {
  console.error(
    `[worldlayout-mcp] WOV_WURZEL=${wurzelEnv} wird ignoriert: geschrieben wird nur in die Welt ` +
      `dieses Checkouts (${CHECKOUT_WURZEL}). Eine fremde Welt braucht WOV_MCP_FREMDE_WELT=1.`
  );
}
const kennungVon = (datei: string): string => createHash('sha256').update(realpathSync(datei)).digest('hex');
/** Kennung aus der letzten Antwort des Betriebsdienstes (die Adresse ist je Prozess fest). */
let verwalteteWeltKennung: string | undefined;

/** Ein Checkout unter `wov-worktrees/`: Aufgaben-Worktrees dürfen die Arbeitskopie der DEV-Welt nicht mitbenutzen. */
function istAufgabenWorktree(): boolean {
  try {
    return `${realpathSync(CHECKOUT_WURZEL)}${sep}`.includes(`${sep}wov-worktrees${sep}`);
  } catch {
    return false;
  }
}

/**
 * Wirft, wenn der angesprochene Betriebsdienst nicht die Arbeitskopie der Welt dieses Checkouts verwaltet.
 *
 * Die Arbeitskopie liegt seit K5.7 unter `WOV_WELT_VERZEICHNIS` (Vorgabe /var/lib/wov/welten), nicht im
 * Checkout. Damit ein Worktree die DEV-Welt nicht über den Vorgabeordner mitbenutzt (beide lösen sich auf
 * dieselbe Datei auf, die Kennungen wären gleich), verlangt ein Checkout unter `wov-worktrees/` ein
 * eigenes `WOV_WELT_VERZEICHNIS`. Ein Symlink auf der Datei oder als Weltordner, der hinauszeigt, macht
 * eine fremde Datei zur „eigenen“ und wird verweigert.
 */
export function pruefeEigeneWelt(): void {
  if (FREMDE_WELT_ERLAUBT) return;
  const eigene = weltDatei(CHECKOUT_WURZEL, instanzName());
  const ordner = weltArbeitsOrdner();
  const ordnerGesetzt = (process.env.WOV_WELT_VERZEICHNIS ?? '').trim() !== '';
  let eigeneKennung: string | undefined;
  let ausserhalb = false;
  const ohneEigenenOrdner = !ordnerGesetzt && istAufgabenWorktree();
  if (!ohneEigenenOrdner) {
    try {
      const echt = realpathSync(eigene);
      const ordnerEcht = realpathSync(ordner);
      // Ein Symlink (auf der Datei oder als Weltordner), der hinauszeigt, machte die fremde Datei zur
      // „eigenen“: beide lösen sich auf dasselbe Ziel auf. Ein Symlink in einem Elternordner bleibt erlaubt.
      if (!lstatSync(ordner).isSymbolicLink() && echt.startsWith(ordnerEcht + sep)) eigeneKennung = kennungVon(echt);
      else ausserhalb = true;
    } catch {
      /* die eigene Datei fehlt: nichts passt */
    }
  }
  if (eigeneKennung !== undefined && eigeneKennung === verwalteteWeltKennung) return;
  const grund = ohneEigenenOrdner
    ? 'Dieser Checkout liegt unter wov-worktrees/, WOV_WELT_VERZEICHNIS ist nicht gesetzt: er würde die Arbeitskopie der DEV-Welt mitbenutzen. Setze WOV_WELT_VERZEICHNIS auf ein eigenes Verzeichnis (für MCP und Betriebsdienst gleich).'
    : ausserhalb
      ? 'Die Arbeitskopie der Welt (oder ihr Ordner) ist ein Symlink, der aus dem Weltverzeichnis hinauszeigt.'
      : verwalteteWeltKennung === undefined
        ? 'Er meldet keine weltKennung (älterer Dienst?).'
        : eigeneKennung === undefined
          ? 'Die Arbeitskopie der Welt existiert nicht.'
          : 'Seine weltKennung passt nicht zu dieser Datei (WOV_WELT_VERZEICHNIS bei MCP und Betriebsdienst gleich?).';
  throw new Error(
    `Nichts gespeichert: Der Betriebsdienst auf ${ADMIN_URL} verwaltet nicht die Weltdatei dieses Checkouts ` +
      `(${eigene}). ${grund} Starte einen eigenen Betriebsdienst auf deinem Slot-Port und setze ` +
      `WOV_ADMIN_PORT/WOV_ADMIN_URL, oder setze WOV_MCP_FREMDE_WELT=1, wenn du bewusst eine fremde Welt ` +
      `schreiben willst. Lesen bleibt erlaubt.`
  );
}

/** Bei jedem Aufruf frisch gelesen: Ein erst später angelegtes Token soll ohne Neustart greifen. */
function adminToken(): string {
  const direkt = process.env.WOV_ADMIN_TOKEN?.trim();
  if (direkt) return direkt;
  for (const datei of ADMIN_TOKEN_DATEIEN) {
    try {
      const t = readFileSync(datei, 'utf-8').trim();
      if (t) return t;
    } catch {
      /* nächste Datei, sonst die Meldung unten */
    }
  }
  throw new Error(
    `Kein Token für den Betriebsdienst: weder WOV_ADMIN_TOKEN noch ${ADMIN_TOKEN_DATEIEN.join(' / ')} ist lesbar ` +
      `(läuft \`npm run dev\` in diesem Checkout, oder WOV_ADMIN_TOKEN_DATEI setzen).`
  );
}

export async function adminAnfrage(
  methode: 'GET' | 'POST' | 'PATCH',
  leib?: unknown,
  pfad = '/api/worldlayout'
): Promise<{ status: number; daten: Record<string, unknown> }> {
  // Vor dem try: ein fehlendes Token ist keine „nicht erreichbar"-Meldung wert.
  const token = adminToken();
  let antwort: Response;
  try {
    antwort = await fetch(`${ADMIN_URL}${pfad}`, {
      method: methode,
      headers: {
        'x-wov-token': token,
        ...(leib !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: leib !== undefined ? JSON.stringify(leib) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (fehler) {
    throw new Error(
      `Betriebsdienst ${ADMIN_URL} nicht erreichbar: ${(fehler as Error).message} — läuft er, und stimmen ` +
        `WOV_ADMIN_URL bzw. WOV_ADMIN_ADRESSE/WOV_ADMIN_PORT?`
    );
  }
  let daten: Record<string, unknown> = {};
  try {
    daten = (await antwort.json()) as Record<string, unknown>;
  } catch {
    /* kein JSON — der Statuscode sagt genug */
  }
  return { status: antwort.status, daten };
}

export const meldungVon = (daten: Record<string, unknown>): string =>
  String(daten.message ?? daten.fehler ?? 'keine Meldung');

/** Das Dokument beim ersten Lesen dieses Prozesses — Basis für world_diff („seit Sitzungsbeginn“). */
let ersterStand: WorldLayout | undefined;
export const sitzungsBasis = (): WorldLayout | undefined => ersterStand;

/** Dokument UND Hash, aus einer einzigen Antwort — der Hash ist die Basis für das spätere Schreiben. */
export async function lade(): Promise<{ layout: WorldLayout; hash: string }> {
  const { status, daten } = await adminAnfrage('GET');
  if (status !== 200) throw new Error(`Betriebsdienst: GET /api/worldlayout -> ${status}: ${meldungVon(daten)}`);
  verwalteteWeltKennung = typeof daten.weltKennung === 'string' ? daten.weltKennung : undefined;
  const layout = sanitizeWorldLayout(daten.layout);
  if (!layout || typeof daten.hash !== 'string') {
    throw new Error('Betriebsdienst lieferte kein gültiges Weltdokument mit Hash');
  }
  ersterStand ??= layout;
  return { layout, hash: daten.hash };
}

/**
 * Schreibt über den Betriebsdienst, mit dem beim Lesen erhaltenen Hash als
 * Basis. Ein Fehler (auch 409) wirft — der Aufrufer meldet ihn als
 * Werkzeugfehler, statt ihn zu verschlucken und trotzdem „Gespeichert" zu
 * sagen.
 */
export async function schreibe(layout: WorldLayout, basis: string): Promise<void> {
  pruefeEigeneWelt();
  const { status, daten } = await adminAnfrage('POST', { ...layout, basis });
  if (status === 200) return;
  if (status === 409) {
    throw new Error(
      'Nichts gespeichert: Das Weltdokument hat sich seit dem Lesen geändert (Editor oder ein anderer ' +
        'Aufruf hat gespeichert). Bitte layout_get aufrufen und die Änderung erneut machen.'
    );
  }
  throw new Error(`Nichts gespeichert: Betriebsdienst antwortet ${status}: ${meldungVon(daten)}`);
}

/** Kompakte Zusammenfassung fürs Gespräch statt des vollen Dokuments. */
export function zusammenfassung(layout: WorldLayout): string {
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

export const mcp = new McpServer({ name: 'worldlayout', version: '1.0.0' });
