import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { resolve, normalize, extname, dirname, sep } from 'path';
import { fileURLToPath } from 'url';

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Game-Server (server/data/server.yml → server.port). Eigener Port — 2456 ist
 * belegt.
 *
 * Über `WOV_SPIEL_PORT` überschreibbar, und `WOV_CLIENT_PORT` verschiebt den
 * Dev-Server selbst. Beides braucht der Ende-zu-Ende-Lauf des Dungeon-
 * Generators 2.0 (`tools/dungeon2-e2e.mjs`): Er startet einen EIGENEN
 * Spielserver auf dieser Maschine und darf dabei weder den DEV-Spielserver
 * (2467) noch dessen Vite (5274) verdrängen. Ohne die zwei Variablen müsste
 * man dafür diese Datei anfassen — und würde sie irgendwann so committen.
 * Overridable via `WOV_SPIEL_PORT` / `WOV_CLIENT_PORT`. The dungeon 2.0
 * end-to-end run needs both: it starts its OWN game server on this machine and
 * must displace neither the DEV game server nor its Vite.
 */
const GAME_SERVER_PORT = Number(process.env.WOV_SPIEL_PORT ?? 2467);
const CLIENT_PORT = Number(process.env.WOV_CLIENT_PORT ?? 5274);

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
 * Die Ausliefer-Regel für /assets/ — als eigene Funktion, damit ein Test
 * sie fahren kann, ohne einen Vite-Server hochzuziehen.
 *
 * Warum herausgezogen (E7): Der Dev-Server muss ausser `assets/models/`
 * jetzt auch `assets/generiert/` ausliefern — den Ordner, in den der
 * Spielserver die zur Laufzeit gebauten Säle schreibt (`Gen_`-Präfix,
 * s. `client/src/engine/AssetManager.ts`). Er tut das ohne eine einzige
 * neue Zeile, weil die Wurzel hier der GANZE `assets`-Ordner ist und
 * nicht `assets/models`. Genau das ist aber eine Zusage, die man
 * versehentlich zurücknehmen kann (ein Präfix enger fassen, eine
 * Endungsliste einführen) — und sie bräche dann nichts, was ein
 * bestehender Test misst: die alten Modelle lägen weiter richtig. Der
 * Zeuge dafür steht in `client/test/gen-basis-laden.ts` und fährt DIESE
 * Funktion, nicht eine Nachbildung davon.
 *
 * Serves the project's own asset folder at /assets — including
 * assets/generiert/, the runtime-built modules. Extracted so a test can
 * drive the real rule instead of a copy of it.
 */
export function assetHandler(dir: string, urlPrefix = '/assets/') {
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
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (!req.url || !req.url.startsWith(urlPrefix)) return next();
    const rel = decodeURIComponent(req.url.slice(urlPrefix.length).split('?')[0]);
    const file = normalize(resolve(root, rel));
    /*
      Ausbruch aus dem Asset-Ordner verhindern.

      Der Trennstrich gehört dazu, und zwar seit E7 nicht mehr nur der
      Ordnung halber: `startsWith(root)` liess `/assets/../assets-neben/x`
      durch, weil `…/assets-neben/x` als Zeichenkette mit `…/assets`
      beginnt. Solange unter `assets/` nur von Hand gepflegte Modelle
      lagen, war das eine Theorie. Ab jetzt schreibt der SERVER Dateien
      dorthin, und deren Namen kommen aus einer Netzanfrage — der Pfad
      ist damit die Stelle, an der eine Erlaubnisliste hängt, und keine
      Stelle, an der ein Zeichenkettenvergleich reicht.

      Path traversal guard: the separator matters — "…/assets-x" also
      startsWith "…/assets".
    */
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(file).pipe(res);
  };
}

/**
 * Serves the project's own asset folder at /assets.
 * Fully swappable: just replace files in the folder — no rebuild needed.
 */
function assetFolder(dir: string, urlPrefix = '/assets/'): Plugin {
  return {
    name: 'asset-folder',
    configureServer(server) {
      server.middlewares.use(assetHandler(dir, urlPrefix));
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
        // Prüfstand des Dungeon-Generators 2.0 (client/src/dungeon2Preview.ts).
        // Er steht hier, WEIL der Kommentar oben es sagt: ohne Eintrag baut
        // Vite die Seite stillschweigend nicht, und im Dev-Server fällt das
        // nie auf.
        // Test bench of dungeon generator 2.0 — without an entry Vite silently
        // omits the page, which never shows up on the dev server.
        dungeon2: resolve(CONFIG_DIR, 'dungeon2.html'),
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
    // Eigener Dev-Port — 3000/5173 sind die üblichen Vorbelegungen
    port: CLIENT_PORT,
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
      : ['.world-of-vikings.com', 'localhost'],

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
      /*
       * Konto-API des SPIELSERVERS (server/src/konto/KontoApi.ts).
       *
       * Muss vor '/api/' stehen? Nein — sie liegt bewusst auf einem
       * eigenen Praefix. '/api/' fuehrt zum Betriebsdienst auf 2468, und
       * genau daran ist die erste Fassung gescheitert: /api/konto/... kam
       * dort an und bekam 404. Zwei verschiedene Dienste unter einem
       * Praefix zu sortieren waere eine Falle fuer jeden, der spaeter eine
       * Regel dazwischenschiebt.
       *
       * Ohne diese Zeilen ist die Anmeldung auf world-of-vikings.com gegen
       * das Testgestade nicht erreichbar — der Vite-Server beantwortet
       * alles, was er nicht kennt, mit der Client-Seite.
       */
      '/accounts/': {
        target: `http://127.0.0.1:${GAME_SERVER_PORT}`,
        changeOrigin: false,
      },
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
