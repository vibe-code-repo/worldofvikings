#!/usr/bin/env node
/**
 * Der EINE Ursprung, hier ohne nginx nachgebildet.
 *
 * `which nginx` findet auf dieser Maschine nichts (Bauer "Ein Ursprung
 * im Container", 12.09.2026) — der Nachweis für `deploy/nginx/wov-lab.conf`
 * braucht trotzdem einen echten HTTP-Server, gegen den Playwright fahren
 * kann. Dieses Skript bildet GENAU dieselben Wege nach, mit
 * `node:http`/`node:net`, ohne eine neue Abhängigkeit (kein `http-proxy`,
 * kein Express) — dieselbe Handvoll Zeilen, die auch
 * `client/vite.config.ts` (`gameWsProxy`, `assetHandler`) schon benutzt.
 *
 * Wenn auf dem Zielcontainer wirklich nginx installiert ist, gehört
 * DORT die echte Datei geprüft (`nginx -t`), nicht dieser Ersatz — er
 * ist der Ersatz für eine Maschine ohne nginx, keine zweite Wahrheit
 * über die Regeln von `wov-lab.conf`.
 *
 *   node tools/dev-ursprung.mjs
 *
 * Umgebungsvariablen (alle optional, Vorgaben passen zu einem frischen
 * `npm run dev` auf den STANDARD-Ports; ein Worktree mit eigenen Ports
 * setzt sie):
 *
 *   WOV_URSPRUNG_PORT     eigener Port dieses Servers (Vorgabe 8090)
 *   WOV_CLIENT_PORT       Vite-Dev-Server, Ziel von /play/ und /editor/ (5274)
 *   WOV_SPIEL_PORT        Spielserver, Ziel von /api/accounts/ und /ws (2467)
 *   WOV_ADMIN_ADRESSE     Betriebsdienst-Host, Ziel von /api/ (127.0.0.1)
 *   WOV_ADMIN_PORT        Betriebsdienst-Port (2468)
 *   WOV_ADMIN_TOKEN_DATEI Token-Datei für x-wov-token (/etc/wov-admin.token,
 *                         fehlt sie, bleibt der Kopf einfach weg — /api/
 *                         antwortet dann mit 401, wie im echten Betrieb)
 *   WOV_WEBSEITE_DIR      wov-web-Build, Ziel von / (Vorgabe: wov-web/build
 *                         neben diesem Projekt)
 *   WOV_ASSETS_DIR        Ziel von /assets/ (Vorgabe: assets/ im Projekt)
 */
import http from 'node:http';
import net from 'node:net';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(fileURLToPath(import.meta.url), '../..');

const PORT = Number(process.env.WOV_URSPRUNG_PORT ?? 8090);
const CLIENT_PORT = Number(process.env.WOV_CLIENT_PORT ?? 5274);
const SPIEL_PORT = Number(process.env.WOV_SPIEL_PORT ?? 2467);
const ADMIN_ADRESSE = process.env.WOV_ADMIN_ADRESSE ?? '127.0.0.1';
const ADMIN_PORT = Number(process.env.WOV_ADMIN_PORT ?? 2468);
const ADMIN_TOKEN_DATEI = process.env.WOV_ADMIN_TOKEN_DATEI ?? '/etc/wov-admin.token';
const WEBSEITE_DIR = resolve(process.env.WOV_WEBSEITE_DIR ?? resolve(WURZEL, 'wov-web/build'));
const ASSETS_DIR = resolve(process.env.WOV_ASSETS_DIR ?? resolve(WURZEL, 'assets'));

function adminToken() {
  try {
    return readFileSync(ADMIN_TOKEN_DATEI, 'utf-8').trim();
  } catch {
    return '';
  }
}
const ADMIN_TOKEN = adminToken();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
};

/** Statische Datei ausliefern — mit demselben Ausbruchsschutz wie assetHandler in vite.config.ts. */
function sendeDatei(res, root, datei) {
  const abs = normalize(resolve(root, datei.replace(/^\/+/, '')));
  if (!abs.startsWith(root + sep) && abs !== root) {
    res.writeHead(404).end('Not found');
    return false;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) return false;
  res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(abs).pipe(res);
  return true;
}

/**
 * `/` — die vorgerenderte Webseite. Bildet `try_files $uri $uri.html
 * $uri/ =404` aus wov-lab.conf nach (trailingSlash: 'never' im Adapter,
 * s. svelte.config.js): `/saga` UND `/saga.html` sollen funktionieren.
 */
function bediene(req, res, pfad) {
  if (pfad === '/' || pfad === '') {
    if (sendeDatei(res, WEBSEITE_DIR, '/index.html')) return;
    res.writeHead(404).end('Not found');
    return;
  }
  if (sendeDatei(res, WEBSEITE_DIR, pfad)) return;
  if (sendeDatei(res, WEBSEITE_DIR, pfad + '.html')) return;
  if (sendeDatei(res, WEBSEITE_DIR, pfad.replace(/\/$/, '') + '/index.html')) return;
  res.writeHead(404).end('Not found');
}

/** HTTP-Proxy ohne fremde Abhängigkeit — dieselbe Handhabung wie der Admin-Proxy in vite.config.ts. */
function proxyHttp(req, res, { host, port, pfad, zusatzKoepfe }) {
  const ziel = http.request(
    { host, port, method: req.method, path: pfad, headers: { ...req.headers, ...zusatzKoepfe } },
    (antwort) => {
      res.writeHead(antwort.statusCode ?? 502, antwort.headers);
      antwort.pipe(res);
    },
  );
  ziel.on('error', (err) => {
    console.error(`[dev-ursprung] Proxy-Fehler zu ${host}:${port}${pfad}:`, err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end('Bad Gateway');
  });
  req.pipe(ziel);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const pfad = url.pathname;
  const suche = url.search;

  // Reihenfolge spiegelt wov-lab.conf NICHT als Prioritätsregel — sie
  // steht hier nur, weil eine sequenzielle if-Kette eine ordnen MUSS.
  // Der längste Treffer gewinnt genau wie bei nginx: /api/accounts/ wird
  // VOR /api/ geprüft. /api/*.json (Webseite) und /assets/ (erst Webseite,
  // dann Spiel) bilden nach, dass eine REGEX- bzw. Fallback-location in
  // nginx gegen jede Präfix-location gewinnt — hier als expliziter
  // Vorrang-Zweig VOR der jeweiligen Alternative.
  if (pfad === '/editor' || pfad === '/play') {
    res.writeHead(301, { location: pfad + '/' }).end();
    return;
  }
  if (pfad === '/editor/') {
    proxyHttp(req, res, { host: '127.0.0.1', port: CLIENT_PORT, pfad: '/play/editor.html' + suche });
    return;
  }
  if (pfad.startsWith('/play/')) {
    proxyHttp(req, res, { host: '127.0.0.1', port: CLIENT_PORT, pfad: pfad + suche });
    return;
  }
  // Statische Daten der Webseite unter /api/ (wov-web/static/api/*.json,
  // z. B. welt.json) — flach, OHNE Unterordner, s. wov-lab.conf. Muss vor
  // /api/accounts/ und /api/ geprüft werden: ohne diesen Zweig läuft
  // /api/welt.json in den Betriebsdienst (Herkunft.ts) statt in die
  // Webseite. Ein fehlender Treffer liefert ehrlich 404, statt an den
  // Betriebsdienst durchzufallen — genau wie die REGEX-location in nginx.
  const apiJsonTreffer = pfad.match(/^\/api\/([^/]+\.json)$/);
  if (apiJsonTreffer) {
    if (!sendeDatei(res, WEBSEITE_DIR, '/api/' + apiJsonTreffer[1])) {
      res.writeHead(404).end('Not found');
    }
    return;
  }
  if (pfad.startsWith('/api/accounts/')) {
    proxyHttp(req, res, {
      host: '127.0.0.1',
      port: SPIEL_PORT,
      pfad: pfad.replace(/^\/api\/accounts\//, '/accounts/') + suche,
    });
    return;
  }
  // Bare /accounts/, ohne /api-Anteil: der eingebaute Anmeldedialog des
  // Spiel-Clients (client/src/ui/Anmeldung.ts, Bauer "Anmeldung") ruft
  // genau das auf, weil er denselben Ursprung wie die Webseite teilt und
  // der Spielserver selbst nur `/accounts/...` kennt. Ohne diesen Zweig
  // fiele die Anfrage auf `bediene()` (die Webseite) und liefe in ein
  // 404 statt ein Konto — derselbe fehlende Block wie in
  // deploy/nginx/wov-lab.conf, hier fuer die lokale Ursprung-Probe
  // nachgezogen.
  if (pfad.startsWith('/accounts/')) {
    proxyHttp(req, res, { host: '127.0.0.1', port: SPIEL_PORT, pfad: pfad + suche });
    return;
  }
  if (pfad.startsWith('/api/')) {
    proxyHttp(req, res, {
      host: ADMIN_ADRESSE,
      port: ADMIN_PORT,
      pfad: pfad + suche,
      zusatzKoepfe: ADMIN_TOKEN ? { 'x-wov-token': ADMIN_TOKEN } : {},
    });
    return;
  }
  if (pfad.startsWith('/assets/')) {
    // Erst die Webseite (wov-web/build/assets/ — Schriften, Wappen-/
    // Held-Bilder, Karten-Vorschauen, appearance.json), dann das Spiel:
    // beide teilen sich denselben URL-Präfix, s. wov-lab.conf.
    if (sendeDatei(res, WEBSEITE_DIR, pfad)) return;
    if (!sendeDatei(res, ASSETS_DIR, pfad.slice('/assets/'.length))) {
      res.writeHead(404).end('Not found');
    }
    return;
  }
  bediene(req, res, pfad);
});

/**
 * WebSocket-Anfragen: /ws (Spielserver) und alles unter /play/ (Vites
 * eigenes HMR). Statt ein Nachrichtenprotokoll nachzubauen, wird der
 * rohe TCP-Socket weitergereicht — genau das, was ein Reverse-Proxy auf
 * Byte-Ebene ohnehin tut, und ohne jede Abhängigkeit auf `ws`.
 */
server.on('upgrade', (req, clientSocket, kopf) => {
  const pfad = (req.url ?? '/').split('?')[0];
  const ziel = pfad === '/ws' ? { host: '127.0.0.1', port: SPIEL_PORT } : { host: '127.0.0.1', port: CLIENT_PORT };

  const zielSocket = net.connect(ziel.port, ziel.host, () => {
    const kopfzeilen = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    zielSocket.write(`${req.method} ${req.url} HTTP/1.1\r\n${kopfzeilen}\r\n\r\n`);
    if (kopf?.length) zielSocket.write(kopf);
    zielSocket.pipe(clientSocket);
    clientSocket.pipe(zielSocket);
  });
  zielSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => zielSocket.destroy());
});

server.listen(PORT, () => {
  console.log(`[dev-ursprung] http://127.0.0.1:${PORT}`);
  console.log(`  /            -> ${WEBSEITE_DIR}`);
  console.log(`  /play/       -> 127.0.0.1:${CLIENT_PORT}`);
  console.log(`  /editor/     -> 127.0.0.1:${CLIENT_PORT}/play/editor.html`);
  console.log(`  /api/*.json  -> ${WEBSEITE_DIR}/api/ (statische Daten der Webseite)`);
  console.log(`  /api/accounts/ -> 127.0.0.1:${SPIEL_PORT}/accounts/`);
  console.log(`  /accounts/   -> 127.0.0.1:${SPIEL_PORT}/accounts/ (fuer den eingebauten Anmeldedialog)`);
  console.log(`  /api/        -> ${ADMIN_ADRESSE}:${ADMIN_PORT}${ADMIN_TOKEN ? '' : ' (KEIN Token gefunden — 401 zu erwarten)'}`);
  console.log(`  /assets/     -> ${WEBSEITE_DIR}/assets/, sonst ${ASSETS_DIR}`);
  console.log(`  /ws          -> 127.0.0.1:${SPIEL_PORT}`);
});
