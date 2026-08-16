/**
 * Prüft, ob die Spielverbindung (/ws) steht — lokal am Vite-Dev-Server und,
 * wenn man sie mitgibt, über den öffentlichen Reverse-Proxy. Meldet für jede
 * URL, ob der WebSocket-Upgrade durchkommt und ob der Server antwortet.
 *
 * Aufruf: node tools/ws-check.mjs [url ...]
 *
 * Exit-Code 0 nur, wenn ALLE geprüften URLs in Ordnung sind. Bis 08/2026
 * endete die Datei mit einem festen process.exit(0) — sie sah dadurch aus wie
 * eine Prüfung, taugte aber in keinem Skript als Bedingung, weil sie auch
 * nach lauter '✗' erfolgreich zurückkam. Wer sie als Tor benutzen will,
 * braucht den echten Code.
 */
import { WebSocket } from 'ws';

// Vorgabe ist NUR der lokale Vite-Dev-Server (client/vite.config.ts: port
// 5274, Plugin gameWsProxy auf /ws). Der öffentliche Name unterscheidet sich
// je Instanz — er steht in WOV_ALLOWED_HOSTS und gehört auf die
// Kommandozeile, nicht in eine Vorgabe, die auf dem falschen Container
// stillschweigend fehlschlägt.
const URLS = process.argv.slice(2).length ? process.argv.slice(2) : ['ws://127.0.0.1:5274/ws'];

function pruefe(url) {
  return new Promise((fertig) => {
    // Selbstsigniertes Zertifikat auf dem Testserver — hier bewusst erlaubt.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 10000 });
    let offen = false;
    const timer = setTimeout(() => {
      ws.terminate();
      fertig({ url, ok: offen, hinweis: offen ? 'offen, keine Daten' : 'Zeitüberschreitung' });
    }, 12000);

    ws.on('open', () => {
      offen = true;
    });
    ws.on('message', (data) => {
      clearTimeout(timer);
      ws.close();
      fertig({ url, ok: true, hinweis: `Antwort erhalten (${data.length} Bytes)` });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      fertig({ url, ok: false, hinweis: `${err.code ?? ''} ${err.message}`.trim() });
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      if (!offen) fertig({ url, ok: false, hinweis: `geschlossen vor dem Öffnen (Code ${code})` });
    });
  });
}

let fehler = 0;
for (const url of URLS) {
  const r = await pruefe(url);
  if (!r.ok) fehler++;
  console.log(`${r.ok ? '✓' : '✗'} ${r.url.padEnd(46)} ${r.hinweis}`);
}

// Ohne dieses exit bliebe der Prozess an offenen Timern und Sockets hängen;
// mit dem Zähler ist er zugleich das, wonach er aussieht.
process.exit(fehler === 0 ? 0 : 1);
