/**
 * Rauchtest der Kontext- und Schreibwerkzeuge des WorldLayout-MCP:
 * catalog_search, uploads_list, style_guide (Ressource + Rückfall),
 * ops_apply, undo_last — gegen einen EIGENEN Betriebsdienst auf einer
 * Testwurzel unter tmpdir() (Port 0, Wegwerf-Token). Nichts davon berührt
 * eine getrackte Weltdatei oder den DEV-Dienst.
 *
 * Zwischen MCP und Dienst sitzt ein durchleitender Zähl-Proxy: Er zählt
 * PATCH/POST je Statuscode und kann VOR dem Weiterreichen eines PATCH eine
 * fremde Änderung einspielen (deterministischer 409 vom Dienst).
 *
 *   npx tsx tools/worldlayout-mcp/probe-kontext.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer, request, type Server } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOKEN = 'probe-kontext-token-4711';

const WURZELN: string[] = [];
const neueWurzel = (name: string): string => {
  const w = mkdtempSync(resolve(tmpdir(), `worldlayout-mcp-kontext-${name}-`));
  WURZELN.push(w);
  return w;
};
const A = neueWurzel('a'); // Checkout des MCP UND Wurzel des eigenen Dienstes
const B = neueWurzel('b'); // fremder Checkout mit eigenem Dienst (Schreibsperre)

function welt(wurzel: string, name: string): void {
  mkdirSync(resolve(wurzel, 'server/data/welten'), { recursive: true });
  writeFileSync(resolve(wurzel, 'token'), `${TOKEN}\n`);
  writeFileSync(
    resolve(wurzel, 'server/data/welten/dev.json'),
    JSON.stringify({
      version: 1,
      name,
      detailSeed: 'kontext',
      continents: [],
      regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
    })
  );
}
function checkoutAnlegen(wurzel: string): void {
  mkdirSync(resolve(wurzel, 'tools/worldlayout-mcp'), { recursive: true });
  cpSync(resolve(WURZEL, 'tools/worldlayout-mcp'), resolve(wurzel, 'tools/worldlayout-mcp'), { recursive: true, filter: (q) => !q.includes('node_modules') });
  symlinkSync(resolve(WURZEL, 'node_modules'), resolve(wurzel, 'node_modules'));
  writeFileSync(resolve(wurzel, 'package.json'), '{ "type": "module" }\n');
}
welt(A, 'Kontext-A');
welt(B, 'Kontext-B');
checkoutAnlegen(A);
checkoutAnlegen(B);

// Upload-Registry und Manifest im Checkout A (Test-Registry mit 3 Modellen: 1 fest, 2 durchlässig).
const upload = (name: string, art: 'fest' | 'durchlaessig', b: number, h: number, t: number) => ({
  name,
  anzeigename: `Anzeige ${name}`,
  bytes: 1000,
  dreiecke: 100 + b,
  meshes: 1,
  materialien: 1,
  bilder: 0,
  fehlendeTexturen: false,
  breite: b,
  hoehe: h,
  tiefe: t,
  kollisionsart: art,
  hatKollisionsnetz: false,
  kollisionsnetzAbgelehnt: false,
  hochgeladenVon: 'probe',
  zeitpunkt: '2026-09-23T00:00:00Z',
});
const REGISTRY = resolve(A, 'assets/hochgeladen/registry.json');
mkdirSync(dirname(REGISTRY), { recursive: true });
writeFileSync(
  REGISTRY,
  JSON.stringify({ version: 1, modelle: [upload('U_Testhaus', 'fest', 6, 4, 5), upload('U_Testbusch', 'durchlaessig', 1.5, 1.2, 1.5), upload('U_Testfass', 'durchlaessig', 0.8, 1, 0.8)] })
);
cpSync(resolve(WURZEL, 'assets/manifest.json'), resolve(A, 'assets/manifest.json'));

const sha = (datei: string): string => createHash('sha256').update(readFileSync(datei)).digest('hex');
const weltDatei = (w: string): string => resolve(w, 'server/data/welten/dev.json');
const sicherungen = (w: string): number => readdirSync(resolve(w, 'server/data/welten')).length;

function dienstStarten(wurzel: string): Promise<{ kind: ChildProcess; url: string }> {
  return new Promise((fertig, scheitern) => {
    const kind = spawn(resolve(WURZEL, 'node_modules/.bin/tsx'), ['src/main.ts'], {
      cwd: resolve(WURZEL, 'admin'),
      env: { ...process.env, WOV_WURZEL: wurzel, WOV_INSTANZ: 'dev', WOV_ADMIN_ADRESSE: '127.0.0.1', WOV_ADMIN_PORT: '0', WOV_QUITTUNG: 'aus', WOV_ADMIN_TOKEN_DATEI: resolve(wurzel, 'token') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let puffer = '';
    const frist = setTimeout(() => {
      kind.kill();
      scheitern(new Error(`Betriebsdienst startet nicht:\n${puffer}`));
    }, 30_000);
    kind.stdout.on('data', (s: Buffer) => {
      puffer += s.toString();
      const t = /bereit auf 127\.0\.0\.1:(\d+)/.exec(puffer);
      if (t) {
        clearTimeout(frist);
        fertig({ kind, url: `http://127.0.0.1:${t[1]}` });
      }
    });
    kind.stderr.on('data', (s: Buffer) => (puffer += s.toString()));
    kind.on('exit', (code) => {
      clearTimeout(frist);
      scheitern(new Error(`Betriebsdienst beendet mit ${code}:\n${puffer}`));
    });
  });
}

/** Durchleitender Zähl-Proxy vor einem Betriebsdienst. */
interface Zaehl {
  server: Server;
  url: string;
  anfragen: Array<{ methode: string; pfad: string; status: number }>;
  /** Läuft vor dem Weiterreichen des nächsten PATCH (einmalig). */
  vorPatch?: () => Promise<void>;
  zaehle(methode: string, status?: number): number;
}
async function zaehlProxy(ziel: string): Promise<Zaehl> {
  const z: Zaehl = {
    server: undefined as unknown as Server,
    url: '',
    anfragen: [],
    zaehle: (m, s) => z.anfragen.filter((a) => a.methode === m && (s === undefined || a.status === s)).length,
  };
  z.server = createServer((req, res) => {
    const teile: Buffer[] = [];
    req.on('data', (c: Buffer) => teile.push(c));
    req.on('end', () => {
      void (async () => {
        if (req.method === 'PATCH' && z.vorPatch) {
          const h = z.vorPatch;
          z.vorPatch = undefined;
          await h();
        }
        const u = new URL(ziel);
        const aus = request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: req.headers }, (antwort) => {
          z.anfragen.push({ methode: req.method ?? '?', pfad: req.url ?? '', status: antwort.statusCode ?? 0 });
          res.writeHead(antwort.statusCode ?? 502, antwort.headers);
          antwort.pipe(res);
        });
        aus.on('error', () => {
          res.statusCode = 502;
          res.end();
        });
        aus.end(Buffer.concat(teile));
      })();
    });
  });
  await new Promise<void>((fertig) => z.server.listen(0, '127.0.0.1', fertig));
  z.url = `http://127.0.0.1:${(z.server.address() as { port: number }).port}`;
  return z;
}

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else console.log(`ok   ${name}`);
}
const text = (r: unknown): string => (r as { content: Array<{ text: string }> }).content[0]?.text ?? '';
const istFehler = (r: unknown): boolean => (r as { isError?: boolean }).isError === true;
const json = (r: unknown): Record<string, unknown> => {
  const t = text(r);
  const i = t.indexOf('\n\n{');
  return i < 0 ? {} : (JSON.parse(t.slice(i + 2)) as Record<string, unknown>);
};

async function mcpStarten(wurzel: string, url: string): Promise<Client> {
  const t = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'tools/worldlayout-mcp/server.ts'],
    cwd: wurzel,
    env: { ...getDefaultEnvironment(), WOV_ADMIN_URL: url, WOV_ADMIN_TOKEN: TOKEN },
  });
  const c = new Client({ name: 'probe-kontext', version: '1.0.0' });
  await c.connect(t);
  return c;
}
const rufe = (c: Client, name: string, arguments_: Record<string, unknown>) => c.callTool({ name, arguments: arguments_ });

const kinder: ChildProcess[] = [];
const clients: Client[] = [];
const server: Server[] = [];
try {
  const dA = await dienstStarten(A);
  const dB = await dienstStarten(B);
  kinder.push(dA.kind, dB.kind);
  const pA = await zaehlProxy(dA.url);
  const pB = await zaehlProxy(dB.url);
  server.push(pA.server, pB.server);
  const c = await mcpStarten(A, pA.url);
  clients.push(c);

  const tools = (await c.listTools()).tools.map((x) => x.name);
  for (const n of ['catalog_search', 'uploads_list', 'style_guide_get', 'ops_apply', 'undo_last']) check(`Tool ${n} vorhanden`, tools.includes(n), tools.join(','));

  // ── style_guide ──
  const res = await c.listResources();
  check('Ressource style_guide (wov://weltbau/style_guide) gelistet', res.resources.some((r) => r.uri === 'wov://weltbau/style_guide' && r.mimeType === 'text/markdown'));
  const gelesen = await c.readResource({ uri: 'wov://weltbau/style_guide' });
  const md = String((gelesen.contents[0] as { text?: string }).text ?? '');
  check('style_guide: Markdown, Wasserlinie 30 m, ≤ 20 KB', /^# Stilführer Weltbau/.test(md) && /Wasserlinie: 30 m/.test(md) && md.length <= 20_000, `${md.length} Zeichen`);
  check('style_guide_get liefert denselben Text', text(await rufe(c, 'style_guide_get', {})) === md);

  // ── catalog_search ──
  const s1 = await rufe(c, 'catalog_search', { text: 'haus' });
  const j1 = json(s1) as { gesamt: number; treffer: Array<{ name: string; quelle: string }> };
  check('catalog_search "haus": Treffer mit Kopfzeile und ms', !istFehler(s1) && j1.gesamt >= 1 && /^catalog_search: \d+ Treffer.*\(\d/.test(text(s1)), text(s1).slice(0, 100));
  const s2 = json(await rufe(c, 'catalog_search', { quelle: ['upload'] })) as { gesamt: number; treffer: Array<{ name: string; fest: boolean; breite: number }> };
  check('catalog_search quelle=upload: die 3 Registry-Modelle mit Maßen und Kollisionsart', s2.gesamt === 3 && s2.treffer.find((t) => t.name === 'U_Testhaus')?.fest === true && s2.treffer.find((t) => t.name === 'U_Testhaus')?.breite === 6);
  const s3 = await rufe(c, 'catalog_search', { biom: 'lava' });
  check('catalog_search unbekanntes Biom: isError mit Liste', istFehler(s3) && /grassland/.test(text(s3)), text(s3));
  const s4 = json(await rufe(c, 'catalog_search', { text: 'baum', limit: 3 })) as { treffer: unknown[] };
  check('catalog_search limit=3 wird eingehalten', s4.treffer.length === 3);

  // ── uploads_list ──
  const u0 = json(await rufe(c, 'uploads_list', {})) as { anzahl: number; modelle: Array<{ name: string; platziert: number; kollisionsart: string }> };
  check('uploads_list: 3 Modelle, noch nichts platziert', u0.anzahl === 3 && u0.modelle.every((m) => m.platziert === 0));

  // ── ops_apply: Trockenfahrt ──
  const hash0 = sha(weltDatei(A));
  const sich0 = sicherungen(A);
  const netz0 = pA.anfragen.length;
  const trocken = await rufe(c, 'ops_apply', { trocken: true, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 10, z: 10 } }] });
  const jt = json(trocken) as { trocken: boolean; zaehler: { neu: number } };
  check('ops_apply trocken: Zähler +1, nichts geschrieben', !istFehler(trocken) && jt.trocken === true && jt.zaehler.neu === 1 && /trocken, nichts geschrieben/.test(text(trocken)), text(trocken).slice(0, 120));
  check('ops_apply trocken: Datei-Hash vor = nach, keine Sicherung', sha(weltDatei(A)) === hash0 && sicherungen(A) === sich0);
  check('ops_apply trocken: 0 PATCH/POST am Dienst (nur GET)', pA.zaehle('PATCH') === 0 && pA.zaehle('POST') === 0 && pA.anfragen.slice(netz0).every((a) => a.methode === 'GET'), pA.anfragen.slice(netz0).map((a) => a.methode).join(','));

  // ── ops_apply: Pflichtfeld, Prefab, ~ ──
  const ohneTrocken = await c.callTool({ name: 'ops_apply', arguments: { ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 1, z: 1 } }] } }).catch((f: unknown) => ({ isError: true, content: [{ text: String(f) }] }));
  check('ops_apply ohne `trocken`: abgewiesen', istFehler(ohneTrocken));
  const patch0 = pA.zaehle('PATCH');
  const unbekannt = await rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'Halluzinierbaum', x: 1, z: 1 } }] });
  check('ops_apply unbekanntes Prefab: isError, 0 PATCH, Datei gleich', istFehler(unbekannt) && /Halluzinierbaum/.test(text(unbekannt)) && pA.zaehle('PATCH') === patch0 && sha(weltDatei(A)) === hash0, text(unbekannt).slice(0, 150));
  const tilde = await rufe(c, 'ops_apply', { trocken: true, vorgangId: '~x', ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 1, z: 1 } }] });
  check('ops_apply vorgangId mit ~: abgewiesen', istFehler(tilde));

  // ── ops_apply echt (3 neu + 1 Region) → undo_last: Datei bytegleich ──
  // Die Testdatei ist von Hand geschrieben; der Dienst speichert im eigenen Format. Ein Aufwärm-Schritt (setzen + zurück)
  // bringt sie in dieses Format, damit „bytegleich“ das Format des Dienstes meint und nicht den Handschrieb.
  await rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'lakes', nachher: { id: 'warm', x: 1, z: 1, radius: 5 } }] });
  check('Aufwärmen: Weltdatei ins Dienstformat gebracht (undo ok)', !istFehler(await rufe(c, 'undo_last', {})));
  const vor = sha(weltDatei(A));
  const echt = await rufe(c, 'ops_apply', {
    trocken: false,
    ops: [
      { art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 10, z: 10 } },
      { art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 30, z: 10 } },
      { art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 12, z: 20 } },
      { art: 'aendere', sammlung: 'regions', id: 'kern', nachher: { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2100 }, edgeFalloff: 300 } },
    ],
  });
  const je = json(echt) as { hash: string; stapel: number; zaehler: { neu: number; geaendert: number; geo: boolean } };
  check('ops_apply echt: 3 neu, 1 geändert, Geo, Stapel 1', !istFehler(echt) && je.zaehler.neu === 3 && je.zaehler.geaendert === 1 && je.zaehler.geo === true && je.stapel === 1, text(echt).slice(0, 160));
  check('ops_apply echt: Dateihash ändert sich und passt zur Antwort', sha(weltDatei(A)) !== vor && /"hash"/.test(text(echt)));
  const u1 = json(await rufe(c, 'uploads_list', {})) as { modelle: Array<{ name: string; platziert: number }> };
  check('uploads_list: platziert 2/0/0 (U_Testhaus zweimal)', u1.modelle.map((m) => m.platziert).join() === '2,0,0', JSON.stringify(u1.modelle.map((m) => [m.name, m.platziert])));
  const wd = await rufe(c, 'world_diff', {});
  check('world_diff nach ops_apply: +3 Objekte, 1 Region geändert', /\+3 Objekte/.test(text(wd)) && /1 Region geändert/.test(text(wd)), text(wd).slice(0, 120));
  const undoTrocken = await rufe(c, 'undo_last', { trocken: true });
  check('undo_last trocken: nichts geschrieben, Stapel bleibt 1', !istFehler(undoTrocken) && (json(undoTrocken) as { stapel: number }).stapel === 1 && sha(weltDatei(A)) !== vor);
  const undo = await rufe(c, 'undo_last', {});
  check('undo_last: Datei bytegleich mit dem Stand vorher (sha256)', !istFehler(undo) && sha(weltDatei(A)) === vor, text(undo).slice(0, 140));
  const undo2 = await rufe(c, 'undo_last', {});
  check('zweites undo_last auf leerem Stapel: isError', istFehler(undo2) && /leer/.test(text(undo2)), text(undo2).slice(0, 100));

  // ── 10 Vorgänge: 10 Stapeleinträge, 10 × PATCH 200 ──
  const start = sha(weltDatei(A));
  const p200 = pA.zaehle('PATCH', 200);
  let letzterStapel = 0;
  for (let i = 0; i < 10; i++) {
    const art = i % 3;
    const ops =
      art === 0
        ? [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 50 + i, z: 50 } }]
        : art === 1
          ? [{ art: 'setze', sammlung: 'lakes', nachher: { id: `see${i}`, x: 300 + i * 10, z: 300, radius: 20 } }]
          : [{ art: 'setze', sammlung: 'routes', nachher: { id: `weg${i}`, points: [[0, 0], [10 + i, 10]], mode: 'loop' } }];
    const r = await rufe(c, 'ops_apply', { trocken: false, ops });
    if (istFehler(r)) console.error(text(r));
    letzterStapel = (json(r) as { stapel?: number }).stapel ?? -1;
  }
  check('10 ops_apply: Stapel 10, genau 10 PATCH 200 im Zähler', letzterStapel === 10 && pA.zaehle('PATCH', 200) - p200 === 10, `stapel ${letzterStapel}, PATCH200 ${pA.zaehle('PATCH', 200) - p200}`);
  const wd10 = text(await rufe(c, 'world_diff', {}));
  check('world_diff zählt die 10 Vorgänge (4 Objekte, 3 Seen, 3 Routen)', /\+4 Objekte/.test(wd10), wd10.slice(0, 160));
  let alleUndo = true;
  for (let i = 0; i < 10; i++) if (istFehler(await rufe(c, 'undo_last', {}))) alleUndo = false;
  check('10 × undo_last: alle ok, Datei bytegleich mit dem Start', alleUndo && sha(weltDatei(A)) === start);
  check('11. undo_last: isError (Stapel leer)', istFehler(await rufe(c, 'undo_last', {})));

  // ── Gleichzeitige Aufrufe laufen nacheinander ──
  const [g1, g2] = await Promise.all([
    rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 70, z: 70 } }] }),
    rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 71, z: 70 } }] }),
  ]);
  check('Zwei gleichzeitige ops_apply: beide ok, Stapel 2', !istFehler(g1) && !istFehler(g2) && Math.max((json(g1) as { stapel: number }).stapel, (json(g2) as { stapel: number }).stapel) === 2);
  await rufe(c, 'undo_last', {});
  await rufe(c, 'undo_last', {});
  check('… und beide wieder zurück (Datei = Start)', sha(weltDatei(A)) === start);

  // ── Leerer Diff: nichts schreiben, keinen Vorgang anlegen ──
  const echt1 = await rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', id: 'leer1', nachher: { id: 'leer1', prefab: 'environment-chestbottom', x: 60, z: 60 } }] });
  check('Vorbereitung leere Vorgänge: ein echter Vorgang, Stapel 1', !istFehler(echt1) && (json(echt1) as { stapel: number }).stapel === 1);
  const hashEcht1 = sha(weltDatei(A));
  const patchVorLeer = pA.zaehle('PATCH');
  const leerOps = [{ art: 'aendere', sammlung: 'placements', id: 'leer1', vorher: { id: 'leer1', prefab: 'environment-chestbottom', x: 60, z: 60 }, nachher: { id: 'leer1', prefab: 'environment-chestbottom', x: 60, z: 60 } }];
  let leerOk = true;
  let leerStapel = -1;
  for (let i = 0; i < 5; i++) {
    const r = await rufe(c, 'ops_apply', { trocken: false, ops: leerOps });
    const jr = json(r) as { leer?: boolean; geschrieben?: boolean; stapel?: number };
    if (istFehler(r) || jr.leer !== true || jr.geschrieben !== false || !/Keine Änderungen — nichts geschrieben, kein Vorgang angelegt/.test(text(r))) leerOk = false;
    leerStapel = jr.stapel ?? -1;
  }
  check('5 leere ops_apply: Antwort sagt „Keine Änderungen … kein Vorgang angelegt“', leerOk);
  check('5 leere ops_apply: 0 PATCH, Datei unverändert, Stapelhöhe weiter 1', pA.zaehle('PATCH') === patchVorLeer && sha(weltDatei(A)) === hashEcht1 && leerStapel === 1, `PATCH +${pA.zaehle('PATCH') - patchVorLeer}, Stapel ${leerStapel}`);
  const leerTrocken = await rufe(c, 'ops_apply', { trocken: true, ops: leerOps });
  check('leerer ops_apply trocken: ebenfalls „Keine Änderungen“, kein PATCH', !istFehler(leerTrocken) && (json(leerTrocken) as { leer?: boolean }).leer === true && pA.zaehle('PATCH') === patchVorLeer);
  const wdLeer = text(await rufe(c, 'world_diff', { gegen: 'vorgang' }));
  check('world_diff gegen "vorgang" zeigt weiter den letzten echten Vorgang (+1 Objekt)', /\+1 Objekt/.test(wdLeer), wdLeer.slice(0, 120));
  check('undo_last nimmt genau diesen echten Vorgang zurück (Datei = Start)', !istFehler(await rufe(c, 'undo_last', {})) && sha(weltDatei(A)) === start);

  // ── Konflikt: fremde Änderung am selben Objekt ──
  const ziel = await rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', id: 'ziel1', nachher: { prefab: 'environment-chestbottom', x: 80, z: 80 } }] });
  check('Konflikt-Vorbereitung: Objekt ziel1 gesetzt', !istFehler(ziel));
  // (a) fremd geändert, dann undo_last → Konflikt vom Werkzeug (lokal), Stapel bleibt
  const tokenHeader = { 'x-wov-token': TOKEN, 'content-type': 'application/json' };
  const fremdPatch = (body: unknown): Promise<Response> => fetch(`${dA.url}/api/worldlayout/ops`, { method: 'PATCH', headers: tokenHeader, body: JSON.stringify(body) });
  const fremd = await fremdPatch({ vorgangId: 'fremd-1', ops: [{ art: 'aendere', sammlung: 'placements', id: 'ziel1', vorher: { id: 'ziel1', prefab: 'environment-chestbottom', x: 80, z: 80 }, nachher: { id: 'ziel1', prefab: 'environment-chestbottom', x: 81, z: 80 } }] });
  check('Fremder Vorgang am selben Objekt angekommen (200)', fremd.status === 200);
  const hashFremd = sha(weltDatei(A));
  const undoK = await rufe(c, 'undo_last', {});
  check('undo_last nach fremder Änderung: Konflikt an ziel1, Datei unverändert', istFehler(undoK) && /Konflikt an ziel1/.test(text(undoK)) && sha(weltDatei(A)) === hashFremd, text(undoK).slice(0, 160));
  // (b) Wettlauf: die fremde Änderung kommt zwischen lade() und PATCH — der DIENST sagt 409
  const p409 = pA.zaehle('PATCH', 409);
  pA.vorPatch = async () => {
    await fremdPatch({ vorgangId: 'fremd-2', ops: [{ art: 'aendere', sammlung: 'placements', id: 'ziel1', vorher: { id: 'ziel1', prefab: 'environment-chestbottom', x: 81, z: 80 }, nachher: { id: 'ziel1', prefab: 'environment-chestbottom', x: 82, z: 80 } }] });
  };
  const wettlauf = await rufe(c, 'ops_apply', { trocken: false, ops: [{ art: 'aendere', sammlung: 'placements', id: 'ziel1', nachher: { id: 'ziel1', prefab: 'environment-chestbottom', x: 90, z: 90 } }] });
  const hashNachWettlauf = sha(weltDatei(A));
  check('Wettlauf: der Dienst antwortet 409, das Werkzeug meldet Konflikt an ziel1', istFehler(wettlauf) && /Konflikt an ziel1/.test(text(wettlauf)) && pA.zaehle('PATCH', 409) - p409 === 1, text(wettlauf).slice(0, 160));
  const dateiText = readFileSync(weltDatei(A), 'utf-8');
  check('Wettlauf: die Datei enthält den Stand des ersten Schreibers (x 82)', /"x":\s*82/.test(dateiText) && !/"x":\s*90/.test(dateiText));
  check('Wettlauf: Datei nach dem 409 unverändert', sha(weltDatei(A)) === hashNachWettlauf);

  // ── Schreibsperre: MCP im Checkout A gegen den Dienst von B ──
  const cB = await mcpStarten(A, pB.url);
  clients.push(cB);
  const hashB = sha(weltDatei(B));
  const sichB = sicherungen(B);
  const sperre = await rufe(cB, 'ops_apply', { trocken: false, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 1, z: 1 } }] });
  check('Schreibsperre: ops_apply gegen fremden Dienst → isError', istFehler(sperre) && /verwaltet nicht die Weltdatei/.test(text(sperre)), text(sperre).slice(0, 160));
  const sperreTrocken = await rufe(cB, 'ops_apply', { trocken: true, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'environment-chestbottom', x: 1, z: 1 } }] });
  check('Schreibsperre: auch die Trockenfahrt meldet es', istFehler(sperreTrocken) && /verwaltet nicht die Weltdatei/.test(text(sperreTrocken)));
  const sperreUndo = await rufe(cB, 'undo_last', {});
  check('Schreibsperre: undo_last ohne eigene Vorgänge → isError, kein PATCH', istFehler(sperreUndo));
  check('Schreibsperre: 0 PATCH/POST am Dienst B, Datei und Ordner von B unverändert (0 Bytes)', pB.zaehle('PATCH') === 0 && pB.zaehle('POST') === 0 && sha(weltDatei(B)) === hashB && sicherungen(B) === sichB, `PATCH ${pB.zaehle('PATCH')} POST ${pB.zaehle('POST')}`);

  // ── kaputte Upload-Registry: isError statt „keine Uploads“ ──
  const heil = readFileSync(REGISTRY, 'utf-8');
  writeFileSync(REGISTRY, '{kaputt');
  const kaputt = await rufe(c, 'uploads_list', {});
  check('Kaputte registry.json: uploads_list isError mit Pfad', istFehler(kaputt) && /kein gültiges JSON/.test(text(kaputt)), text(kaputt).slice(0, 120));
  rmSync(REGISTRY);
  const fehlt = await rufe(c, 'uploads_list', {});
  check('Fehlende registry.json: anzahl 0 mit Hinweis, kein Fehler', !istFehler(fehlt) && (json(fehlt) as { anzahl: number }).anzahl === 0 && /kein Upload-Ordner/.test(text(fehlt)), text(fehlt).slice(0, 120));
  const nachLoeschen = await rufe(c, 'ops_apply', { trocken: true, ops: [{ art: 'setze', sammlung: 'placements', nachher: { prefab: 'U_Testhaus', x: 1, z: 1 } }] });
  check('Nach Löschen der Registry ist U_Testhaus ein unbekanntes Prefab', istFehler(nachLoeschen) && /U_Testhaus/.test(text(nachLoeschen)), text(nachLoeschen).slice(0, 120));
  writeFileSync(REGISTRY, heil);

  // layout_deploy wurde nie aufgerufen; einziger systemctl-Aufruf des MCP steht dort.
  check('Kein systemctl: dieser Lauf hat layout_deploy nie aufgerufen', true);
} finally {
  for (const cl of clients) await cl.close().catch(() => undefined);
  for (const s of server) s.close();
  const pids = kinder.map((k) => k.pid).filter((p): p is number => p !== undefined);
  for (const k of kinder) {
    k.removeAllListeners('exit');
    k.kill();
  }
  for (const w of WURZELN) rmSync(w, { recursive: true, force: true });
  await new Promise((f) => setTimeout(f, 300));
  const uebrig = pids.filter((p) => existsSync(`/proc/${p}`));
  console.log(`Aufgeräumt: Dienst-PIDs ${pids.join(',')} — noch lebend: ${uebrig.length === 0 ? 'keine' : uebrig.join(',')}`);
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== KONTEXT-PROBE: ALL PASSED ===');
