/**
 * Liefert den PRODUKTIONSBUILD des Clients aus — als Gegenstueck zum
 * Dev-Server, aber mit demselben Umfeld wie wov-live.
 *
 * WARUM ES DAS BRAUCHT: `vite preview` fuehrt die Plugins aus
 * client/vite.config.ts NICHT aus. Die haengen alle in `configureServer`,
 * das nur der Dev-Server aufruft. Unter `vite preview` fehlen deshalb
 * genau die zwei Dinge, ohne die das Spiel gar nicht erst startet:
 *
 *   - /assets/  (GLB, Texturen) — kommt vom assetFolder-Plugin
 *   - /ws       (Spielserver)   — kommt vom gameWsProxy-Plugin
 *
 * Auf wov-live macht beides nginx. Auf wov-bau laeuft kein nginx, also
 * macht es dieses Skript. Damit misst das fps-Benchmark gegen das
 * Artefakt, das ein Spieler wirklich bekommt, statt gegen unminifizierte
 * Dev-Module.
 *
 * Aufruf:  node tools/wov-preview-server.mjs [--port 5280] [--spielport 2467]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(WURZEL, 'client/dist');
const ASSETS = resolve(WURZEL, 'assets');

const arg = (name, standard) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const PORT = Number(arg('port', 5280));
const SPIELPORT = Number(arg('spielport', 2467));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
};

/** Liefert eine Datei aus, wenn sie unterhalb von `wurzel` liegt. */
function datei(res, wurzel, relativ) {
  const pfad = normalize(resolve(wurzel, relativ));
  // Pfadausbruch verhindern — sonst laesst sich jede Datei der Maschine holen.
  if (!pfad.startsWith(wurzel) || !existsSync(pfad) || !statSync(pfad).isFile()) return false;
  res.setHeader('Content-Type', MIME[extname(pfad).toLowerCase()] ?? 'application/octet-stream');
  // Kein Caching: Das Benchmark laeuft mehrfach gegen wechselnde Builds,
  // ein Browser-Cache wuerde alte Bundles messen.
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(pfad).pipe(res);
  return true;
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

  if (url.startsWith('/assets/')) {
    if (datei(res, ASSETS, url.slice('/assets/'.length))) return;
    res.statusCode = 404;
    return res.end('Not found');
  }

  const rel = url === '/' ? 'index.html' : url.slice(1);
  if (datei(res, DIST, rel)) return;

  // Mehrseiten-Build: /editor, /karte ohne .html sollen trotzdem greifen.
  if (!extname(rel) && datei(res, DIST, `${rel}.html`)) return;

  res.statusCode = 404;
  res.end('Not found');
});

/**
 * WebSocket-Weiterleitung auf den Spielserver. Roh auf TCP-Ebene: Der
 * Upgrade-Handshake und alle Frames werden unveraendert durchgereicht,
 * damit hier keine zweite WebSocket-Implementierung mitmisst.
 */
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  const oben = connect(SPIELPORT, '127.0.0.1', () => {
    const kopf =
      `GET ${req.url} HTTP/1.1\r\n` +
      Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n') +
      '\r\n\r\n';
    oben.write(kopf);
    if (head?.length) oben.write(head);
    socket.pipe(oben);
    oben.pipe(socket);
  });
  oben.on('error', () => socket.destroy());
  socket.on('error', () => oben.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[wov-preview] dist=${DIST}`);
  console.log(`[wov-preview] assets=${ASSETS}`);
  console.log(`[wov-preview] http://0.0.0.0:${PORT}  ws -> 127.0.0.1:${SPIELPORT}`);
});
