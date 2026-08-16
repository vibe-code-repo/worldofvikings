import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { resolve, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

/** Game-Server (server/data/server.yml → server.port). Eigener Port — valheim-browser nutzt 2456. */
const GAME_SERVER_PORT = 2467;

/**
 * Betriebsdienst (admin/src/main.ts). Dieselben Umgebungsvariablen wie
 * dort, damit /etc/wov.env die einzige Stelle bleibt, an der die Adresse
 * steht. Der Rückfall auf 127.0.0.1 trifft nur den Fall „npm run dev von
 * Hand, ohne Unit" — im Betrieb setzt die Unit WOV_ADMIN_ADRESSE.
 */
const ADMIN_ADRESSE = process.env.WOV_ADMIN_ADRESSE ?? '127.0.0.1';
const ADMIN_PORT = Number(process.env.WOV_ADMIN_PORT ?? 2468);
const ADMIN_TOKEN_DATEI = process.env.WOV_ADMIN_TOKEN_DATEI ?? '/etc/wov-admin.token';

/**
 * Der Token des Betriebsdienstes, EINMAL beim Start gelesen.
 *
 * Er wird bewusst hier gelesen und nicht pro Anfrage: Der Dev-Server
 * läuft als derselbe Nutzer wie der Betriebsdienst und darf die Datei
 * (0600) lesen; ein Fehler soll beim Start auffallen, nicht erst beim
 * ersten Speicherversuch. Fehlt die Datei, bleibt der Proxy trotzdem
 * bestehen — der Betriebsdienst antwortet dann mit 401, und im Editor
 * steht ein verständlicher Satz statt eines toten Knopfs.
 */
function adminToken(): string {
  try {
    return readFileSync(ADMIN_TOKEN_DATEI, 'utf-8').trim();
  } catch {
    console.warn(`[vite] ${ADMIN_TOKEN_DATEI} nicht lesbar — /api/* wird der Betriebsdienst mit 401 abweisen.`);
    return '';
  }
}
const ADMIN_TOKEN = adminToken();

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

    /**
     * /api/* geht an den Betriebsdienst (admin/src/main.ts, Port 2468).
     *
     * ── Warum ein Proxy statt zweier Plugins (Block A/16) ────────────
     * Hier standen bis Block A/16 zwei Middleware-Plugins: der
     * Speicherweg des Editors (POST /api/worldlayout) und die
     * Server-Konsole (GET /api/serverlog). Beide lebten damit NUR,
     * solange dieser Entwicklungsserver lief — auf live liefert nginx
     * einen statischen Build aus, und der Editor konnte dort nicht
     * speichern. Die Endpunkte sind deshalb in den Betriebsdienst
     * gezogen, der auf BEIDEN Containern läuft; hier bleibt nur noch die
     * Weiterleitung. Auf live macht nginx dasselbe
     * (deploy/nginx-live.conf, location /api/).
     *
     * Nebenwirkung, die man kennen sollte: Der Dev-Server braucht ab
     * jetzt einen laufenden wov-admin. Ohne ihn antwortet /api/* mit
     * ECONNREFUSED statt still nicht zu existieren — was die ehrlichere
     * Fehlermeldung ist als ein Speicherknopf, der auf live nichts tut.
     */
    proxy: {
      '/api/': {
        target: `http://${ADMIN_ADRESSE}:${ADMIN_PORT}`,
        // Der Betriebsdienst wertet den Host-Kopf nicht aus; ihn
        // umzuschreiben würde nur die Herkunft im Journal verwischen.
        changeOrigin: false,
        // Die Server-Konsole ist ein Server-Sent-Events-Strom. Ohne
        // abgeschaltete Pufferung sammelt der Proxy Zeilen, bis genug
        // beisammen ist — die Konsole bliebe minutenlang leer.
        // (`selfHandleResponse: false` ist die Vorgabe und pipet direkt.)
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Der Token wird SERVERSEITIG gesetzt — genau deshalb taucht
            // er im Browser nie auf. Das war schon vorher das Prinzip,
            // nur setzte damals das Plugin gar keinen, weil es selbst
            // schrieb.
            if (ADMIN_TOKEN) proxyReq.setHeader('x-wov-token', ADMIN_TOKEN);
            // setHeader ÜBERSCHREIBT, und das ist der Punkt: Ein vom
            // Browser mitgeschickter X-Forwarded-For darf nicht
            // durchrutschen, sonst könnte sich jeder eine erlaubte
            // Adresse ausdenken und am Herkunfts-Riegel des
            // Betriebsdienstes vorbeigehen. Die Option `xfwd: true` hängt
            // stattdessen an — deshalb wird sie hier NICHT benutzt.
            proxyReq.setHeader('x-forwarded-for', (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''));
          });
        },
      },
    },
  },
});
