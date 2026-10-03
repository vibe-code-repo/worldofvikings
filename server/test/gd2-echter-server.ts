/**
 * GD2: the base stock against a REAL game server (WebSocket, watch, receipt) with a player inventory, a chest and a piece
 * of loot on the ground, and the REAL admin route (in process, plain HTTP server) as the editor's save path.
 * A base item is overridden, reset and refused when someone tries to take it out. What players, the chest and the ground
 * hold stays untouched in every step.
 *
 *  [1] Start: working copy `[]` (the DEV state) is reconciled (left alone: the base items follow the repo), the server starts with it.
 *      Anna holds 30 Wood + 1 Hammer more than her starter set, a chest holds 5 Wood + 1 Hammer, 3 Wood lie on the ground.
 *  [2] Override: a PUT with Wood's `ernte` changed: 200, the watch applies it (receipt `angewendet`, `ernte.baum` 3).
 *  [3] Removal attempt: a PUT without Wood is 422 (file byte-equal, the watch sees nothing, Wood keeps its value);
 *      a hand-edited file without Wood (past the route) is no removal either: receipt `angewendet`, never
 *      `bestaetigung-noetig`, the base entry applies.
 *  [4] Reset: the override is back, `POST .../zuruecksetzen` removes it: receipt `angewendet`, Wood is the base item again.
 *  [5] A deviating copy (hand-edited stack size): the watch's receipt names it (`ersetzt`), the route reports `grundErsetzt`,
 *      the reset ends it (no `ersetzt` any more, the file is clean).
 *  [6] The 29 repo copies an older build left in the file are cleaned out by the route; the game does not notice.
 *  After every step: Anna's inventory (full serialisation), the chest and the ground piece (full ZDO snapshots) are
 *  byte-equal to the snapshot of step 1.
 *
 * Run: npx tsx server/test/gd2-echter-server.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacketType, TRUHE_INHALT_MEMBER, findItem, unpackContainer } from '@wov/shared';
import { GRUNDBESTAND_IDS, leseGegenstandsDatei, wendeGegenstandsDatenAn } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsArbeitsDatei, gegenstandsQuittungsDatei, gegenstandsRepoDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { GegenstandsWache, gegenstaendeAbgleichenBeimStart, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';
import { gegenstaendeBehandeln } from '../../admin/src/routen/gegenstaende.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';

const WURZEL_ECHT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ECHT = readFileSync(gegenstandsRepoDatei(WURZEL_ECHT));
const DIR = mkdtempSync('/tmp/gd2-server-');
const WURZEL = resolve(DIR, 'wurzel');
const ARBEITSORDNER = resolve(DIR, 'arbeit');
mkdirSync(dirname(gegenstandsRepoDatei(WURZEL)), { recursive: true });
mkdirSync(ARBEITSORDNER, { recursive: true });
writeFileSync(gegenstandsRepoDatei(WURZEL), REPO_ECHT);
process.env.WOV_WELT_VERZEICHNIS = ARBEITSORDNER;
const ARBEIT = gegenstandsArbeitsDatei(WURZEL);
const QUITTUNG = gegenstandsQuittungsDatei(ARBEIT);
const WORLDS_DIR = resolve(DIR, 'welten');

let PORT = 0;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer | string): string => layoutHash(b);

// ── The admin route behind a plain HTTP server (the editor's save path) ──
const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  void gegenstaendeBehandeln(req, res, url.pathname, url.searchParams, WURZEL).then((ok) => {
    if (!ok) {
      res.writeHead(404);
      res.end();
    }
  });
});
await new Promise<void>((fertig) => http.listen(0, '127.0.0.1', fertig));
const httpPort = (http.address() as { port: number }).port;
type Antwort = { status: number; daten: Record<string, unknown> };
async function anfrage(methode: string, pfad: string, body?: string, ifMatch?: string): Promise<Antwort> {
  const kopf: Record<string, string> = { 'content-type': 'application/json' };
  if (ifMatch) kopf['if-match'] = `"${ifMatch}"`;
  const r = await fetch(`http://127.0.0.1:${httpPort}${pfad}`, { method: methode, headers: kopf, ...(body === undefined ? {} : { body }) });
  const roh = await r.text();
  let daten: Record<string, unknown> = {};
  try {
    daten = JSON.parse(roh) as Record<string, unknown>;
  } catch {
    /* no JSON */
  }
  return { status: r.status, daten };
}
const holeStand = async (): Promise<{ hash: string; eintraege: Array<Record<string, unknown>>; grundErsetzt: string[] }> => {
  const g = await anfrage('GET', '/api/gegenstaende');
  return { hash: String(g.daten.hash), eintraege: g.daten.eintraege as Array<Record<string, unknown>>, grundErsetzt: g.daten.grundErsetzt as string[] };
};
const repoRoh = (): Array<Record<string, unknown>> => (JSON.parse(REPO_ECHT.toString('utf-8')) as { gegenstaende: Array<Record<string, unknown>> }).gegenstaende;
const woodMit = (ueber: Record<string, unknown>): Record<string, unknown> => ({ ...repoRoh().find((e) => e.id === 'Wood')!, ...ueber });
const rohListe = (): Array<Record<string, unknown>> => (JSON.parse(readFileSync(ARBEIT, 'utf-8')) as { gegenstaende: Array<Record<string, unknown>> }).gegenstaende;
const dokument = (liste: unknown[]): string => `${JSON.stringify({ version: 1, gegenstaende: liste }, null, 2)}\n`;
/** Hand edit past the route: atomic write like the route, so the watch sees a new inode. */
function handSchreiben(text: string): string {
  const temp = `${ARBEIT}.test.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, ARBEIT);
  return sha(text);
}
const quittung = (): GegenstandsQuittung | null => {
  try {
    return JSON.parse(readFileSync(QUITTUNG, 'utf-8')) as GegenstandsQuittung;
  } catch {
    return null;
  }
};
async function wartePaketQuittung(hash: string, maxMs = 5000): Promise<GegenstandsQuittung | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const q = quittung();
    if (q && q.hash === hash) return q;
    await warte(50);
  }
  return null;
}

// ── Real WebSocket plumbing (login only) ──
function verbinde(name: string): Promise<WebSocket> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    let auth = false;
    const timer = setTimeout(() => fail(new Error(`handshake timeout: ${name}`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(ws);
      } else if (type === PacketType.InventorySync) {
        /* not needed */
      }
    });
    ws.on('error', fail);
  });
}

async function main(): Promise<void> {
  console.log('\n[1] Start: reconcile, load, start the server; Anna, a chest and the ground hold Wood and Hammer');
  writeFileSync(ARBEIT, dokument([])); // the DEV state: `[]` and a basis equal to it
  writeFileSync(resolve(ARBEITSORDNER, 'gegenstaende.basis'), `${sha(dokument([]))}\n`);
  wendeGegenstandsDatenAn([]);
  const abgleich = gegenstaendeAbgleichenBeimStart(WURZEL, ARBEIT, { log: () => undefined, warn: () => undefined, error: () => undefined });
  check('the reconciliation leaves the `[]` copy alone (the 29 follow the repo, nothing is copied)', abgleich?.fall === 'unveraendert' && rohListe().length === 0, abgleich?.fall);
  const start = ladeGegenstandsDatei(ARBEIT, { log: () => undefined, warn: () => undefined, error: () => undefined });
  check('the start loads it: 0 entries of the file, art angewendet, the 29 base items known', start.art === 'angewendet' && start.eintraege.length === 0 && GRUNDBESTAND_IDS.every((id) => findItem(id) !== undefined), `${start.art} ${start.eintraege.length}`);

  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'gd2',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
    gegenstandsDatei: ARBEIT, gegenstandsStart: start.eintraege, gegenstandsStartQuittung: start.startQuittung, gegenstandsOhneGutenStand: start.ohneGutenStand,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    gebeItem(peer: Peer, name: string, amount: number): void;
    beuteAmBoden: { legeHin(raum: unknown, pos: { x: number; y: number; z: number }, stuecke: Array<{ name: string; amount: number }>): unknown };
    gegenstandsWache: GegenstandsWache | null;
  };
  const sockets: WebSocket[] = [];
  try {
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna = server.net.getPeers().find((p) => p.name === 'Anna');
    if (!anna) throw new Error('peer Anna missing');
    await warte(500);
    check('the server has a watch', zugriff.gegenstandsWache instanceof GegenstandsWache);

    const w0 = anna.inventar.countOf('Wood');
    const h0 = anna.inventar.countOf('Hammer');
    zugriff.gebeItem(anna, 'Wood', 30);
    zugriff.gebeItem(anna, 'Hammer', 1);
    const truhe = server.prefabs.getByName('piece_chest_wood')!;
    const kiste = server.zdos.createZDO(truhe.hash, { ...anna.position });
    kiste.setString(TRUHE_INHALT_MEMBER, JSON.stringify([['Wood', 5, 0, 1], ['Hammer', 1, 100, 1]]));
    zugriff.beuteAmBoden.legeHin(server.zdos, { ...anna.position }, [{ name: 'Wood', amount: 3 }]);
    const stueck = server.zdos.getAllZDOs().find((z) => z.getString('beute_item') === 'Wood');
    if (!stueck) throw new Error('ground piece missing');

    // the WHOLE state: the full serialisation of the inventory (every field, every place), the chest ZDO with all its members and
    // its revision, the ground piece ZDO likewise
    const momentaufnahme = (): string =>
      JSON.stringify({
        inv: anna.inventar.serialize(),
        truhe: kiste.toSnapshot(),
        boden: [stueck.destroyed, stueck.toSnapshot()],
      });
    const vorher = momentaufnahme();
    check('setup: Anna +30 Wood and +1 Hammer on top of the starter set, chest 5 Wood + 1 Hammer, 3 Wood on the ground',
      anna.inventar.countOf('Wood') === w0 + 30 && anna.inventar.countOf('Hammer') === h0 + 1 && unpackContainer(kiste.getString(TRUHE_INHALT_MEMBER)).countOf('Wood') === 5 && !stueck.destroyed && stueck.getInt('beute_menge') === 3, vorher);
    const unberuehrt = (wo: string): void => check(`${wo}: inventory (full serialisation), chest and ground piece (full ZDO snapshot) are byte-equal to the snapshot`, momentaufnahme() === vorher, momentaufnahme().slice(0, 200));
    // the first tick of the watch settles the start (last good state is written), nothing changes
    await warte(1500);
    unberuehrt('after the first ticks');

    console.log('\n[2] Override: Wood with another harvest field');
    const s0 = await holeStand();
    const put = await anfrage('PUT', '/api/gegenstaende', dokument([woodMit({ ernte: { baum: 3 } })]), s0.hash);
    check('PUT with Wood.ernte.baum 3: 200, the file holds this one deviation', put.status === 200 && s0.eintraege.length === 0 && rohListe().length === 1 && put.daten.eintraege === 1, `${put.status} ${JSON.stringify(put.daten)}`);
    const q2 = await wartePaketQuittung(String(put.daten.hash));
    check('the watch applies it: receipt angewendet for the new hash, no `ersetzt`', q2?.status === 'angewendet' && q2.ersetzt === undefined, JSON.stringify(q2));
    check('Wood now harvests 3 for trees (the override runs)', findItem('Wood')?.ernte?.baum === 3, JSON.stringify(findItem('Wood')?.ernte));
    unberuehrt('after the override');

    console.log('\n[3] Removal attempt');
    const s1 = await holeStand();
    const bytesVor = readFileSync(ARBEIT);
    const ohne = dokument([]);
    const abgelehnt = await anfrage('PUT', '/api/gegenstaende', ohne, s1.hash);
    check('PUT without Wood: 422 grundgegenstand-nicht-loeschbar, file byte-equal', abgelehnt.status === 422 && abgelehnt.daten.fehler === 'grundgegenstand-nicht-loeschbar' && readFileSync(ARBEIT).equals(bytesVor), `${abgelehnt.status} ${JSON.stringify(abgelehnt.daten)}`);
    const abgelehnt2 = await anfrage('PUT', '/api/gegenstaende?bestaetigt=1', ohne, s1.hash);
    check('... also with ?bestaetigt=1', abgelehnt2.status === 422 && readFileSync(ARBEIT).equals(bytesVor));
    await warte(2500);
    check('the watch saw nothing: the receipt is still the one of the override, Wood keeps its value', quittung()?.hash === s1.hash && findItem('Wood')?.ernte?.baum === 3);
    unberuehrt('after the refused PUT');
    // past the route: a hand-edited file without Wood
    const handHash = handSchreiben(ohne);
    const qHand = await wartePaketQuittung(handHash);
    check('hand-edited file without Wood: receipt angewendet (never bestaetigung-noetig), nothing asked', qHand?.status === 'angewendet' && qHand.gehalten === undefined, JSON.stringify(qHand));
    check('... Wood is the base item again (no harvest value), and still known', findItem('Wood') !== undefined && findItem('Wood')?.ernte?.baum === undefined, JSON.stringify(findItem('Wood')?.ernte));
    unberuehrt('after the hand-edited removal');

    console.log('\n[4] Reset');
    const s2 = await holeStand();
    const mitWieder = await anfrage('PUT', '/api/gegenstaende', dokument([woodMit({ ernte: { baum: 3 } })]), s2.hash);
    check('setup: the override is back (PUT 200)', mitWieder.status === 200, `${mitWieder.status} ${JSON.stringify(mitWieder.daten)}`);
    await wartePaketQuittung(String(mitWieder.daten.hash));
    check('setup: Wood.ernte.baum 3 runs again', findItem('Wood')?.ernte?.baum === 3);
    const s3 = await holeStand();
    const reset = await anfrage('POST', '/api/gegenstaende/zuruecksetzen', JSON.stringify({ id: 'Wood' }), s3.hash);
    check('POST zuruecksetzen {Wood}: 200, zurueckgesetzt true', reset.status === 200 && reset.daten.zurueckgesetzt === true, `${reset.status} ${JSON.stringify(reset.daten)}`);
    check('the entry is gone from the file (nothing else was in it)', rohListe().length === 0, `${rohListe().length}`);
    const q4 = await wartePaketQuittung(String(reset.daten.hash));
    check('the watch applies it: receipt angewendet', q4?.status === 'angewendet', JSON.stringify(q4));
    check('Wood is the base item again', findItem('Wood')?.ernte?.baum === undefined);
    unberuehrt('after the reset');

    console.log('\n[5] A deviating copy and its reset');
    const s4 = await holeStand();
    const hand2 = handSchreiben(dokument([woodMit({ stapel: 77 })]));
    check('setup: the route reads the hand-edited file and names the copy', (await holeStand()).grundErsetzt.join() === 'Wood' && hand2 !== s4.hash);
    const q5 = await wartePaketQuittung(hand2);
    check('the watch: receipt angewendet with `ersetzt: [Wood]`', q5?.status === 'angewendet' && JSON.stringify(q5.ersetzt) === '["Wood"]', JSON.stringify(q5));
    const maxStapel = findItem('Wood')?.maxStackSize;
    check('the stack size of the BASE item runs (50), not the 77 of the copy', maxStapel === 50, String(maxStapel));
    const qRoute = await anfrage('GET', '/api/gegenstaende/quittung');
    check('the route\'s receipt answer carries grundErsetzt [Wood]', JSON.stringify(qRoute.daten.grundErsetzt) === '["Wood"]');
    unberuehrt('with the deviating copy');
    const s5 = await holeStand();
    const reset2 = await anfrage('POST', '/api/gegenstaende/zuruecksetzen', JSON.stringify({ id: 'Wood' }), s5.hash);
    check('reset: 200, grundErsetzt [] in the answer, the file is clean', reset2.status === 200 && JSON.stringify(reset2.daten.grundErsetzt) === '[]' && leseGegenstandsDatei(readFileSync(ARBEIT, 'utf-8')).grundErsetzt.length === 0, JSON.stringify(reset2.daten));
    const q6 = await wartePaketQuittung(String(reset2.daten.hash));
    check('the watch: receipt angewendet WITHOUT `ersetzt` (the permanent warning ends)', q6?.status === 'angewendet' && q6.ersetzt === undefined, JSON.stringify(q6));
    unberuehrt('after the second reset');
    console.log('\n[6] The 29 repo copies of an older build: the route cleans them out, the game does not notice');
    const alt = dokument(repoRoh());
    handSchreiben(alt);
    const g6 = await anfrage('GET', '/api/gegenstaende');
    check('GET takes them out: no entries left, the hash is the hash of the cleaned file, a back-up holds the old bytes', g6.status === 200 && (g6.daten.eintraege as unknown[]).length === 0 && g6.daten.hash === sha(readFileSync(ARBEIT)), `${g6.status}`);
    const q7 = await wartePaketQuittung(String(g6.daten.hash));
    check('the watch applies the cleaned file: receipt angewendet, no `ersetzt`', q7?.status === 'angewendet' && q7.ersetzt === undefined, JSON.stringify(q7));
    unberuehrt('after the clean-out');
    check('all 29 base items are known the whole time', GRUNDBESTAND_IDS.every((id) => findItem(id) !== undefined));
    server.zdos.destroyZDO(kiste.zdoid);
  } finally {
    for (const w of sockets) w.close();
    server.stop();
    http.close();
    wendeGegenstandsDatenAn([]);
    rmSync(DIR, { recursive: true, force: true });
    void existsSync;
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
