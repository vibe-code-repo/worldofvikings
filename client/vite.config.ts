import { defineConfig, type Plugin } from 'vite';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { createReadStream, existsSync, statSync } from 'fs';
import { resolve, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

/** Game-Server (server/data/server.yml → server.port). Eigener Port — valheim-browser nutzt 2456. */
const GAME_SERVER_PORT = 2467;

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
  ],
  build: {
    outDir: 'dist',
    target: 'esnext',
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
    allowedHosts: ['testserver.valheim.community', '.valheim.community', 'localhost'],
  },
});
