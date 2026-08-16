import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { resolve, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

/** Game-Server (server/data/server.yml → server.port). Eigener Port — valheim-browser nutzt 2456. */
const GAME_SERVER_PORT = 2467;

/**
 * Speicherweg des Layout-Editors (Review-Punkt 13): POST /api/worldlayout
 * schreibt das Weltdokument direkt nach server/data/worldlayout.json —
 * dieselbe Datei, die der MCP-Server bearbeitet. Vorher lebte der Entwurf
 * nur im localStorage und musste von Hand exportiert und kopiert werden.
 *
 * ZUGANG: Der Dev-Server ist öffentlich erreichbar (Port 5274), deshalb
 * nimmt der Endpunkt NUR Anfragen von localhost und aus dem LAN entgegen.
 * Alles andere wird mit 403 abgewiesen — sonst könnte jeder im Internet
 * die Welt überschreiben.
 */
function worldLayoutSave(): Plugin {
  // Eigene Kopie der Instanz-Aufloesung statt Import: die Vite-Konfig kann
  // @wov/shared nicht laden (ESM-.js-Endungen im TS-Quellbaum, siehe den
  // Kommentar weiter unten beim Struktur-Check). Die Wahrheit steht in
  // shared/src/instanz.ts — Aenderungen dort hier mitziehen.
  const INSTANZ = (process.env.WOV_INSTANZ ?? 'dev').trim().toLowerCase();
  const ZIEL_NAME = `${INSTANZ}.json`;
  const ZIEL = resolve(CONFIG_DIR, '../server/data/welten', ZIEL_NAME);
  const erlaubt = (adresse: string | undefined): boolean => {
    if (!adresse) return false;
    const a = adresse.replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1' || /^10\.10\.10\./.test(a) || /^192\.168\./.test(a);
  };
  return {
    name: 'wov-worldlayout-save',
    configureServer(server) {
      server.middlewares.use('/api/worldlayout', (req, res) => {
        const antwort = (code: number, text: string): void => {
          res.statusCode = code;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: code === 200, message: text }));
        };
        if (!erlaubt(req.socket.remoteAddress ?? undefined)) {
          return antwort(403, 'Speichern nur aus dem lokalen Netz erlaubt');
        }
        if (req.method !== 'POST') return antwort(405, 'POST erwartet');
        let roh = '';
        req.on('data', (c: Buffer) => {
          roh += c.toString();
          if (roh.length > 4_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            // Struktur-Check statt sanitizeWorldLayout: Die Vite-Konfig kann
            // @wov/shared nicht laden (ESM-.js-Endungen im TS-Quellbaum) —
            // die STRENGE Prüfung läuft ohnehin im Browser mit exakt dem
            // Code, den auch der Server fährt, direkt vor dem Senden.
            // Hier geht es nur darum, keinen Müll auf die Platte zu legen.
            const sauber = JSON.parse(roh) as {
              version?: unknown;
              name?: unknown;
              regions?: unknown;
              placements?: unknown[];
            };
            const strukturOk =
              sauber.version === 1 &&
              typeof sauber.name === 'string' &&
              Array.isArray(sauber.regions) &&
              sauber.regions.every(
                (r) => r && typeof (r as { id?: unknown }).id === 'string' && (r as { shape?: unknown }).shape
              );
            if (!strukturOk) return antwort(400, 'Kein gültiges WorldLayout — verworfen');
            // Backup wie im MCP-Server: letzte 10 Stände bleiben liegen.
            if (existsSync(ZIEL)) {
              const stempel = new Date().toISOString().replace(/[:.]/g, '-');
              copyFileSync(ZIEL, `${ZIEL}.${stempel}.bak`);
              const dir = dirname(ZIEL);
              const alte = readdirSync(dir)
                .filter((f) => f.startsWith(`${ZIEL_NAME}.`) && f.endsWith('.bak'))
                .sort();
              while (alte.length > 10) unlinkSync(resolve(dir, alte.shift()!));
            }
            const tmp = `${ZIEL}.tmp`;
            writeFileSync(tmp, JSON.stringify(sauber, null, 2));
            renameSync(tmp, ZIEL);
            antwort(
              200,
              `Gespeichert: ${(sauber.regions as unknown[]).length} Region(en), ${sauber.placements?.length ?? 0} Platzierung(en)`
            );
          } catch (err) {
            antwort(400, `Fehler: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      });
    },
  };
}

/**
 * Server-Konsole für den Layout-Editor: streamt journalctl des wov-Servers
 * als Server-Sent-Events an /api/serverlog. Nur Dev-Server (systemd-Host);
 * Paket-Spam (type=…/Received packet) wird herausgefiltert, damit die
 * Konsole Weltereignisse zeigt statt 30-Hz-Input.
 */
function serverLog(): Plugin {
  return {
    name: 'wov-serverlog',
    configureServer(server) {
      server.middlewares.use('/api/serverlog', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const kind = spawn('journalctl', ['-fu', 'wov-server', '-n', '120', '--no-pager', '-o', 'short-iso']);
        const weiter = (chunk: Buffer): void => {
          for (const zeile of chunk.toString().split('\n')) {
            if (!zeile.trim()) continue;
            if (/Received packet|type=\d+ from/.test(zeile)) continue;
            res.write(`data: ${JSON.stringify(zeile)}\n\n`);
          }
        };
        kind.stdout.on('data', weiter);
        kind.stderr.on('data', weiter);
        kind.on('error', (err) => {
          res.write(`data: ${JSON.stringify(`[Konsole] journalctl nicht verfügbar: ${err.message}`)}\n\n`);
        });
        req.on('close', () => kind.kill());
      });
    },
  };
}

/**
 * Serves the project's own asset folder at /assets.
 * Fully swappable: just replace files in the folder — no rebuild needed.
 */
function assetFolder(dir: string, urlPrefix = '/assets/'): Plugin {
  const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  };
  const root = resolve(dir);
  return {
    name: 'asset-folder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(urlPrefix)) return next();
        const rel = decodeURIComponent(req.url.slice(urlPrefix.length).split('?')[0]);
        const file = normalize(resolve(root, rel));
        // Prevent path traversal outside the asset root
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * WebSocket proxy: intercepts upgrade requests on /ws and proxies them
 * to the game server (HMR upgrades stay untouched).
 */
function gameWsProxy(targetPort: number): Plugin {
  return {
    name: 'game-ws-proxy',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (req.url !== '/ws') return; // let Vite handle HMR upgrades

        wss.handleUpgrade(req, socket, head, (clientWs) => {
          const upstream = new WebSocket(`ws://127.0.0.1:${targetPort}`);
          upstream.binaryType = 'nodebuffer';

          const pendingToUpstream: Buffer[] = [];
          let upstreamReady = false;

          upstream.on('open', () => {
            upstreamReady = true;
            for (const msg of pendingToUpstream) upstream.send(msg);
            pendingToUpstream.length = 0;
          });

          clientWs.on('message', (data) => {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (upstreamReady) upstream.send(buf);
            else pendingToUpstream.push(buf);
          });

          upstream.on('message', (data) => {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(buf);
          });

          clientWs.on('close', () => upstream.close());
          upstream.on('close', () => clientWs.close());
          clientWs.on('error', () => upstream.close());
          upstream.on('error', () => clientWs.close());
        });
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [
    gameWsProxy(GAME_SERVER_PORT),
    assetFolder(resolve(CONFIG_DIR, '../assets')),
    serverLog(),
    worldLayoutSave(),
  ],
  build: {
    outDir: 'dist',
    target: 'esnext',
    // KOLLISION: Vite legt seine Bundles standardmäßig unter dist/assets/
    // ab — genau der URL-Präfix, unter dem das Spiel seine GLB/Texturen
    // erwartet (assetFolder-Plugin oben serviert /assets/ aus dem
    // Projektordner). Im Dev-Server fällt das nie auf, weil Vite Module
    // dort aus /src ausliefert; im Produktionsbuild überdecken sich beide.
    // Die Bundles bekommen deshalb einen eigenen Ordner.
    assetsDir: 'bundle',
    rollupOptions: {
      // Mehrseiten-Build: OHNE diese Liste baut Vite nur den Wurzel-
      // Einstieg index.html und lässt editor.html und karte.html
      // stillschweigend weg — im Dev-Server unsichtbar, weil der jede
      // Datei direkt ausliefert.
      input: {
        index: resolve(CONFIG_DIR, 'index.html'),
        editor: resolve(CONFIG_DIR, 'editor.html'),
        karte: resolve(CONFIG_DIR, 'karte.html'),
      },
    },
  },
  optimizeDeps: {
    // Havok ships as an Emscripten module that locates its own .wasm at
    // runtime. Pre-bundling it through esbuild rewrites those paths and the
    // import fails outright — hand it to the browser unprocessed instead.
    exclude: ['@babylonjs/havok'],
  },
  server: {
    // Eigener Dev-Port — valheim-browser nutzt 3000/5173
    port: 5274,
    host: true,
    // Vite blockt seit 5.x fremde Host-Header (DNS-Rebinding-Schutz). Der
    // Testserver wird über seinen Domainnamen aufgerufen, nicht über die IP,
    // und lief deshalb in "Blocked request. This host is not allowed."
    //
    // Hinter einem Reverse-Proxy (Nginx Proxy Manager) kommt der Host-Header
    // der URSPRÜNGLICHEN Anfrage an, nicht die Container-IP — die Domain des
    // Proxy-Eintrags muss also hier stehen. WOV_ALLOWED_HOSTS (kommagetrennt)
    // setzt die Liste, damit ein neuer Betriebsort keine Codeänderung braucht.
    allowedHosts: process.env.WOV_ALLOWED_HOSTS
      ? process.env.WOV_ALLOWED_HOSTS.split(',').map((h) => h.trim())
      : ['testserver.valheim.community', '.valheim.community', 'localhost'],
  },
});
