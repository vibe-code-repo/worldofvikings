/**
 * Prüft, ob die Spielverbindung (/ws) steht — lokal am Vite-Dev-Server und
 * über den öffentlichen Reverse-Proxy. Meldet für jede URL, ob der
 * WebSocket-Upgrade durchkommt und ob der Server antwortet.
 *
 * Aufruf: node tools/ws-check.mjs [url ...]
 */
import { WebSocket } from 'ws';

const URLS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ws://127.0.0.1:5273/ws', 'wss://testserver.valheim.community/ws'];

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

for (const url of URLS) {
  const r = await pruefe(url);
  console.log(`${r.ok ? '✓' : '✗'} ${r.url.padEnd(46)} ${r.hinweis}`);
}
process.exit(0);
