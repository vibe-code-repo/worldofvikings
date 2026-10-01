// Hilfsprozess für `ruestkammerSsr.test.ts`: startet den gebauten Handler von
// wov-web auf Port 0 und meldet den Port auf stdout. `WOV_GAME_API` kommt vom Test.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const handlerPfad = process.argv[2];
let handler = (_req, res) => {
  res.writeHead(503).end();
};
const server = http.createServer((req, res) =>
  handler(req, res, () => res.writeHead(404).end('next')),
);
await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
const port = server.address().port;
// Der Handler liest ORIGIN beim Laden; der Port steht erst nach `listen`.
process.env.ORIGIN = `http://127.0.0.1:${port}`;
({ handler } = await import(pathToFileURL(handlerPfad).href));
console.log(`PORT ${port}`);
