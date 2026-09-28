import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

async function body(req: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return text;
}

function validLayout(): Record<string, unknown> {
  return { version: 1, name: 'MCP height reader test', detailSeed: 'x', continents: [], regions: [] };
}

function problemResponse(): Record<string, unknown> {
  return {
    ok: false,
    message: 'ungueltig',
    heightProblem: {
      reason: 'invalid',
      zonen: 1,
      punkte: 1,
      zoneLimit: 10,
      pointLimit: 20,
      fehlerhaftHoehe: [{ zone: '0,0', feld: 'r[0]', wert: 'kaputt' }],
    },
    fehlerhaftHoehe: [{ zone: '0,0', feld: 'r[0]', wert: 'kaputt' }],
    anzahlFehlerhaftHoehe: 1,
    fehlerhaft: [{ id: 'haus-1', feld: 'yaw', wert: 'abc' }],
    anzahlFehlerhaft: 1,
  };
}

function assert(name: string, ok: boolean, detail = ''): void {
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
}

async function expectRejects(name: string, fn: () => Promise<unknown>, re: RegExp): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const msg = (err as Error).message;
    assert(name, re.test(msg), msg);
    return msg;
  }
  throw new Error(`${name}: expected rejection`);
}

async function runHeightCorrectionReaderTests(): Promise<void> {
  let mode: 'get-ok' | 'get-422' | 'post-422' | 'post-202' = 'get-ok';
  let postBodies = 0;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url !== '/api/worldlayout') {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'not found' }));
        return;
      }
      if (req.method === 'GET') {
        if (mode === 'get-422') {
          res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ ...problemResponse(), layout: { ...validLayout(), name: '__should_not_be_loaded__' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, layout: validLayout(), hash: 'h1', weltKennung: 'foreign' }));
        return;
      }
      if (req.method === 'POST') {
        postBodies++;
        await body(req);
        if (mode === 'post-202') {
          res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ ...problemResponse(), ok: true, message: 'File saved', angewendet: false, grund: 'verworfen' }));
          return;
        }
        res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify(problemResponse()));
        return;
      }
      res.writeHead(405, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'method' }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ message: (err as Error).message }));
    }
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address();
    assert('server address', typeof addr === 'object' && addr !== null);
    process.env.WOV_ADMIN_URL = `http://127.0.0.1:${(addr as { port: number }).port}`;
    process.env.WOV_ADMIN_TOKEN = 'test-token';
    process.env.WOV_MCP_FREMDE_WELT = '1';

    const kern = await import(`./kern.js?height-reader-test=${Date.now()}`);
    mode = 'get-ok';
    const loaded = await kern.lade('de');
    assert('lade ok returns service layout', loaded.layout?.name === 'MCP height reader test' && loaded.hash === 'h1', JSON.stringify(loaded));

    mode = 'post-422';
    const postDe = await expectRejects('schreibe de has height and placement details', () => kern.schreibe(validLayout(), 'h1', 'de'), /0,0[\s\S]*haus-1|haus-1[\s\S]*0,0/);
    assert('schreibe de mentions invalid fields', /r\[0\]/.test(postDe) && /yaw/.test(postDe), postDe);
    const postEn = await expectRejects('schreibe en has height and placement details', () => kern.schreibe(validLayout(), 'h1', 'en'), /0,0[\s\S]*haus-1|haus-1[\s\S]*0,0/);
    assert('schreibe en not same german wrapper', !/^Nichts gespeichert:/.test(postEn) && /yaw/.test(postEn), postEn);

    mode = 'post-202';
    const ok202 = await kern.schreibe(validLayout(), 'h1', 'en');
    assert('schreibe 202 keeps success path and localizes height problem before generic hint', /0,0[\s\S]*haus-1|haus-1[\s\S]*0,0/.test(ok202) && /not applied|NICHT angewendet/i.test(ok202), ok202);
    assert('post was actually sent three times', postBodies === 3, String(postBodies));

    mode = 'get-422';
    const getDe = await expectRejects('lade de rejects GET 422 without using truncated layout', () => kern.lade('de'), /0,0[\s\S]*haus-1|haus-1[\s\S]*0,0/);
    assert('lade de contains height field and no truncated success', /r\[0\]/.test(getDe) && !/__should_not_be_loaded__/.test(getDe), getDe);
    const getEn = await expectRejects('lade en rejects GET 422 without using truncated layout', () => kern.lade('en'), /0,0[\s\S]*haus-1|haus-1[\s\S]*0,0/);
    assert('lade en contains placement field and no truncated success', /yaw/.test(getEn) && !/__should_not_be_loaded__/.test(getEn), getEn);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHeightCorrectionReaderTests()
    .then(() => console.log('all ok'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
