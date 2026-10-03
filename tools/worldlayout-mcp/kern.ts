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
import { PROTOCOL_VERSION, PROTOKOLL_KOPF } from '@wov/shared/src/protokollVersion.js';
import { fileURLToPath } from 'node:url';
import { sanitizeWorldLayout, layoutBounds, type WorldLayout } from '@wov/shared';
import { instanzName, weltArbeitsOrdner, weltDatei } from '@wov/shared/src/instanz.js';
import { heightResponseMessage } from '@wov/shared/src/worldlayout/heightMessages.js';
import { lockCount, lockMessage } from '@wov/shared/src/worldlayout/lockMessages.js';

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

/**
 * Wirft, wenn dieser MCP nicht schreiben darf.
 *
 * 1. Geschrieben wird nur, wenn `WOV_ADMIN_URL` AUSDRUECKLICH gesetzt ist. Ohne sie gaelte die Vorgabe-Adresse
 *    (127.0.0.1:2468 = der DEV-Betriebsdienst), und ein MCP aus irgendeinem Checkout schriebe in die DEV-Welt.
 *    Die Sperre richtet sich also nach dem ZIEL, nicht nach dem Ort des Checkouts (frueher galt eine Ausnahme nur
 *    unter `wov-worktrees/`; ein Checkout unter /var/tmp war ungeschuetzt). Lesen bleibt ohne die Variable erlaubt.
 * 2. Der angesprochene Betriebsdienst muss die Arbeitskopie der Welt DIESES Checkouts verwalten
 *    (`weltKennung`, sha256 des realpath). Die Arbeitskopie liegt unter `WOV_WELT_VERZEICHNIS` (nur wenn
 *    ausdruecklich gesetzt, absolut) oder unter `<Checkout>/server/data/welten-arbeit`: jeder Checkout hat also
 *    seine eigene, und die Kennung des DEV-Dienstes (`/var/lib/wov/welten/dev.json`) passt zu keinem Checkout.
 *    Ein Symlink auf der Datei oder als Weltordner, der hinauszeigt, macht eine fremde Datei zur „eigenen“
 *    und wird verweigert.
 */
export function pruefeEigeneWelt(): void {
  if ((process.env.WOV_ADMIN_URL ?? '').trim() === '') {
    throw new Error(
      'Nichts gespeichert: WOV_ADMIN_URL ist nicht gesetzt. Dieser MCP schreibt nur, wenn die Adresse des ' +
        'Betriebsdienstes ausdruecklich gesetzt ist (die Vorgabe-Adresse waere der DEV-Betriebsdienst). Starte einen ' +
        'eigenen Betriebsdienst auf deinem Slot-Port und setze WOV_ADMIN_URL=http://127.0.0.1:248n. Lesen bleibt erlaubt.'
    );
  }
  if (FREMDE_WELT_ERLAUBT) return;
  const eigene = weltDatei(CHECKOUT_WURZEL, instanzName());
  const ordner = weltArbeitsOrdner(CHECKOUT_WURZEL);
  let eigeneKennung: string | undefined;
  let ausserhalb = false;
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
  if (eigeneKennung !== undefined && eigeneKennung === verwalteteWeltKennung) return;
  const grund = ausserhalb
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
        [PROTOKOLL_KOPF]: String(PROTOCOL_VERSION),
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
export async function lade(locale = process.env.WOV_LANGUAGE ?? 'de'): Promise<{ layout: WorldLayout; hash: string }> {
  const { status, daten } = await adminAnfrage('GET');
  if (status === 422) {
    const hoehenText = heightResponseMessage(daten, locale);
    throw new Error(hoehenText ?? `Betriebsdienst: GET /api/worldlayout -> ${status}: ${meldungVon(daten)}`);
  }
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
 * Was aus dem Schreiben für die LAUFENDE Welt wurde, als Satz für die KI: 200 heißt „live angewendet“,
 * 202 heißt „geschrieben, aber NICHT angewendet“ mit `grund` und `detail` (Geländeänderung, Spielserver aus,
 * Bestätigung nötig …). Ohne diesen Satz hielte die KI eine nicht angewendete Änderung für wirksam.
 */
export function wirkungsHinweis(status: number, daten: Record<string, unknown>, locale = process.env.WOV_LANGUAGE ?? 'de'): string {
  const hoehenText = heightResponseMessage(daten, locale);
  const gesperrt = lockCount(daten);
  if (status === 202) {
    const grund = typeof daten.grund === 'string' ? daten.grund : 'unbekannt';
    const detail = typeof daten.detail === 'string' && daten.detail ? `: ${daten.detail}` : '';
    // Z3 N2: Bei `bestaetigung-noetig` trägt der Text der Antwort die Löschsperre schon (Katalog); sonst kommt die offene Sperre dazu.
    const sperre = grund === 'bestaetigung-noetig' ? lockMessage('lock.pending', {}, locale) : gesperrt > 0 ? lockMessage('lock.open', { count: gesperrt }, locale) : '';
    return `${hoehenText ? `\n${hoehenText}` : ''}\nACHTUNG: geschrieben, aber im laufenden Spiel NICHT angewendet (grund: ${grund}${detail}).${sperre ? `\n${sperre}` : ''}`;
  }
  if (daten.angewendet !== true) return '';
  // Z5a: angewendet, aber ein Grabstein hat ein Neusetzen verschluckt (Objekt gelöscht, derselbe Eintrag wieder da).
  const zaehler = daten.zaehler && typeof daten.zaehler === 'object' ? (daten.zaehler as Record<string, unknown>) : {};
  const zurueck = Number(zaehler.zurueck);
  // Z3 N2: Steht eine Löschsperre offen, ist „angewendet“ nicht die ganze Wahrheit: die gesperrten Objekte stehen weiter.
  const sperre = gesperrt > 0 ? `\n${lockMessage('lock.applied', { count: gesperrt }, locale)}` : '';
  if (Number.isFinite(zurueck) && zurueck > 0) {
    const detail = typeof daten.detail === 'string' && daten.detail ? ` (${daten.detail})` : '';
    return `\nIm laufenden Spiel angewendet, ABER ${zurueck} Neusetzen von einem gelöschten Objekt zurückgehalten${detail}: das Objekt steht nicht wieder da.${sperre}`;
  }
  return gesperrt > 0 ? sperre : '\nIm laufenden Spiel angewendet.';
}

/**
 * Schreibt über den Betriebsdienst, mit dem beim Lesen erhaltenen Hash als
 * Basis. Ein Fehler (auch 409) wirft — der Aufrufer meldet ihn als
 * Werkzeugfehler, statt ihn zu verschlucken und trotzdem „Gespeichert" zu
 * sagen.
 */
export async function schreibe(layout: WorldLayout, basis: string, locale = process.env.WOV_LANGUAGE ?? 'de'): Promise<string> {
  pruefeEigeneWelt();
  const { status, daten } = await adminAnfrage('POST', { ...layout, basis });
  // 202 (K5.0): geschrieben, aber vom laufenden Spielserver nicht (gleich) angewendet — die Datei steht.
  if (status === 200 || status === 202) return wirkungsHinweis(status, daten, locale);
  if (status === 409) {
    throw new Error(
      'Nichts gespeichert: Das Weltdokument hat sich seit dem Lesen geändert (Editor oder ein anderer ' +
        'Aufruf hat gespeichert). Bitte layout_get aufrufen und die Änderung erneut machen.'
    );
  }
  if (status === 422) {
    const hoehenText = heightResponseMessage(daten, locale);
    if (hoehenText) throw new Error(hoehenText);
  }
  // N4: 422 `ungueltig` mit der Liste `fehlerhaft` ({ id, feld, wert }): Platzierungen mit Tippfehlern. Die KI bekommt die
  // Liste wörtlich, damit sie die Einträge korrigiert und noch einmal sendet.
  if (status === 422 && Array.isArray(daten.fehlerhaft) && daten.fehlerhaft.length > 0) {
    const zeilen = (daten.fehlerhaft as { id?: unknown; feld?: unknown; wert?: unknown }[]).slice(0, 40).map((f) => `  - ${String(f.id)}: ${String(f.feld)} = ${JSON.stringify(f.wert)}`);
    const alle = Number(daten.anzahlFehlerhaft);
    throw new Error(
      `Nichts gespeichert: ${Number.isFinite(alle) ? alle : zeilen.length} Fehler in Platzierungen (Feld und gelesener Wert). Bitte korrigieren und erneut senden:\n${zeilen.join('\n')}`
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
