/**
 * Nimmt Screenshots entgegen, die ein Browser auf einem ANDEREN Rechner
 * erzeugt hat (playwright-gpu läuft auf echter Grafikhardware, aber sein
 * Dateisystem ist von hier nicht erreichbar).
 *
 * Die Seite schickt ihr Canvas als Data-URL per POST hierher, das Bild landet
 * lokal in screenshots/. Damit lassen sich Vergleichsbilder auf einer GPU
 * erzeugen, statt sie unter SwiftShader zu erwarten.
 *
 *   node tools/shot-upload-server.mjs [port]
 *   POST /upload?name=beispiel.png   Body: data:image/png;base64,…
 */
import { createServer } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PORT = Number(process.argv[2] ?? 8099);
const OUT = 'screenshots';
mkdirSync(OUT, { recursive: true });

createServer((req, res) => {
  // Der Browser lädt die Seite von :5273 und postet hierher — ohne diese
  // Header blockt die Same-Origin-Policy die Antwort.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST') return res.writeHead(405).end('nur POST');

  const url = new URL(req.url, 'http://x');
  const name = (url.searchParams.get('name') ?? 'shot.png').replace(/[^\w.@-]/g, '_');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const komma = body.indexOf(',');
    const b64 = komma > -1 && body.startsWith('data:') ? body.slice(komma + 1) : body;
    const ziel = join(OUT, name);
    writeFileSync(ziel, Buffer.from(b64, 'base64'));
    console.log(`${ziel}  ${(b64.length * 0.75 / 1024).toFixed(0)} KB`);
    res.writeHead(200).end('ok');
  });
}).listen(PORT, '0.0.0.0', () => console.log(`Upload-Server auf :${PORT} → ${OUT}/`));
