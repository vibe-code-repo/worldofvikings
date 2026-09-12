/**
 * Startet Server, Client UND den Betriebsdienst (admin) parallel im
 * Vordergrund — die Variante ohne systemd, z. B. wenn man alle drei Logs in
 * einem Terminal sehen will. Für den Dauerbetrieb stattdessen:
 * systemctl start wov.target
 *
 * Getting-started (2026-09-12): "git clone && npm install && npm run dev"
 * soll ohne Zugangsdaten und ohne vorbereitete Dateien laufen. Zwei Dinge
 * fehlen einem frischen Klon, die auf einem eingerichteten Container schon
 * da sind, und beide werden HIER geregelt, nicht in den drei Workspaces:
 *
 *  1. Der Betriebsdienst (admin/) braucht ein Token. Auf einem betriebenen
 *     Container legt ein Operator es unter /etc/wov-admin.token ab; hier
 *     gibt es keinen Operator. Also zeigt WOV_ADMIN_TOKEN_DATEI für alle
 *     drei Kindprozesse auf server/data/admin.token (Teil des Checkouts,
 *     gitignored) — admin/src/main.ts erzeugt dort sein eigenes
 *     Zufallstoken, wenn die Datei fehlt, und client/vite.config.ts liest
 *     dieselbe Datei für den Proxy-Header. Wer WOV_ADMIN_TOKEN_DATEI
 *     bereits selbst gesetzt hat (z. B. um /etc/wov-admin.token lokal
 *     nachzustellen), wird hier nicht überschrieben.
 *
 *  2. assets/models fehlt komplett (siehe .gitignore: assets/* ist bewusst
 *     nicht im Repo). Ohne sie liefe der Client zwar — nur ohne ein
 *     einziges Modell. Bevor die drei Prozesse starten, holt dieses
 *     Skript deshalb das Asset-Paket (tools/assets-paket.mjs), falls
 *     assets/models fehlt, und baut danach die abgeleiteten Ordner
 *     (assets/store-lab, assets/generiert), falls die fehlen. Ein
 *     Fehlschlag hier (kein Release veröffentlicht, kein Netz) bricht
 *     "npm run dev" NICHT ab — er endet mit einer klaren Meldung, und der
 *     Client startet trotzdem, nur ohne Modelle (derselbe Zustand, den
 *     WOV_OHNE_MODELLE in den Tests ohnehin kennt).
 *
 * ── Getting started (2026-09-12): "git clone && npm install && npm run
 * dev" is meant to work without credentials and without any file prepared
 * ahead of time. Two things are missing on a fresh clone that already
 * exist on a provisioned container, and both are handled HERE rather than
 * in the three workspaces — see the German paragraphs above for the full
 * reasoning: (1) the admin token file defaults to server/data/admin.token
 * instead of /etc/wov-admin.token, generated on first run; (2) the asset
 * package is fetched automatically when assets/models is missing, and a
 * failure to fetch it (no release published yet, no network) is a warning,
 * not a hard stop — the client still starts, just without models.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ── 1. Asset-Paket, falls es fehlt ───────────────────────────────────────

function assetsVorbereiten() {
  const modelle = resolve(WURZEL, 'assets/models');
  if (!existsSync(modelle)) {
    console.log('[dev] assets/models fehlt — hole das Asset-Paket (tools/assets-paket.mjs holen) …');
    const ergebnis = spawnSync(process.execPath, [resolve(WURZEL, 'tools/assets-paket.mjs'), 'holen'], {
      stdio: 'inherit',
      cwd: WURZEL,
    });
    if (ergebnis.status !== 0) {
      console.warn(
        '[dev] Asset-Paket konnte nicht geholt werden — Spiel startet trotzdem, nur ohne Modelle. ' +
          'Siehe Meldung oben; manuell nachholen mit: npm run assets:holen'
      );
    }
  }

  const storeLab = resolve(WURZEL, 'assets/store-lab');
  const generiert = resolve(WURZEL, 'assets/generiert');
  if (existsSync(resolve(WURZEL, 'assets/store')) && (!existsSync(storeLab) || !existsSync(generiert))) {
    console.log('[dev] assets/store-lab oder assets/generiert fehlt — bereite die Store-Vegetation auf …');
    for (const script of ['store:aufbereiten', 'store:boden']) {
      const ergebnis = spawnSync(npm, ['run', script], { stdio: 'inherit', cwd: WURZEL });
      if (ergebnis.status !== 0) {
        console.warn(`[dev] "npm run ${script}" ist fehlgeschlagen — Spiel startet trotzdem, siehe Meldung oben.`);
        break;
      }
    }
  }

  // assets/appearance.json — die Charaktererstellung der Webseite
  // (wov-web /erstellen, /konto) liest diese Datei unter /assets/appearance.json.
  // Sie braucht KEIN Modell und KEIN heruntergeladenes Paket, nur
  // shared/src/aussehen.ts (tools/aussehen-json.mjs) — deshalb hier immer
  // erzeugt, wenn sie fehlt, unabhaengig davon, ob das Asset-Paket da ist.
  // Ohne sie zeigt der Charaktereditor der Webseite leere Auswahllisten
  // ("assets/appearance.json nicht erreichbar"), obwohl Server und Client
  // selbst laengst spielbereit sind — ein Lueckenfund aus der Ein-Ursprung-
  // Probe (lab/install-integration, 12.09.2026), nicht aus einem der drei
  // gemergten Zweige einzeln.
  if (!existsSync(resolve(WURZEL, 'assets/appearance.json'))) {
    console.log('[dev] assets/appearance.json fehlt — erzeuge die Aussehen-Listen für die Webseite …');
    const ergebnis = spawnSync(npm, ['run', 'aussehen:json'], { stdio: 'inherit', cwd: WURZEL });
    if (ergebnis.status !== 0) {
      console.warn('[dev] "npm run aussehen:json" ist fehlgeschlagen — der Charaktereditor der Webseite bleibt ohne Auswahllisten.');
    }
  }
}

assetsVorbereiten();

// ── 2. Server, Client und Admin parallel starten ─────────────────────────

// Vorgabe server/data/admin.token statt /etc/wov-admin.token — siehe
// Kopfkommentar. Ein bereits gesetztes WOV_ADMIN_TOKEN_DATEI (z. B. um den
// Betriebsfall lokal nachzustellen) bleibt unangetastet.
const adminTokenDatei = process.env.WOV_ADMIN_TOKEN_DATEI ?? resolve(WURZEL, 'server/data/admin.token');
const kindUmgebung = { ...process.env, WOV_ADMIN_TOKEN_DATEI: adminTokenDatei };

const tasks = [
  { name: 'server', script: 'dev:server' },
  { name: 'client', script: 'dev:client' },
  { name: 'admin', script: 'dev:admin' },
];

const children = tasks.map(({ name, script }) => {
  const child = spawn(npm, ['run', script], { stdio: 'inherit', cwd: WURZEL, env: kindUmgebung });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`[${name}] beendet (code=${code} signal=${signal}) — fahre alles herunter`);
    shutdown(code ?? 1);
  });
  return child;
});

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
