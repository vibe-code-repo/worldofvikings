/**
 * Items from data, start with a broken working copy (card G2, note of the orchestrator): the LAST GOOD STATE.
 * Gegenstandsdaten beim Start: kaputte Arbeitsdatei => letzter guter Stand.
 *
 * Without the data items `Inventory.load` and `unpackContainer` would drop their stacks silently at the next
 * save. So after every successful application the state goes to `gegenstaende.letzter-guter.json`, and the start
 * falls back to it when the working copy is broken, rejected or gone.
 *
 *  [1] Good file applied at start: the last good state is written.
 *  [2] Server 1: a player holds a Holzaxt, a chest holds one; stop (saves).
 *  [3] Restart with a BROKEN file: last good state loaded (art letzter-guter), receipt `abgelehnt` with the hash
 *      of the broken bytes; player and chest keep the Holzaxt; the player takes it out of the chest by packet;
 *      stop (saves again).
 *  [4] Second restart, working copy GONE: same again; the Holzaxt survived the save of [3].
 *  [5] Restart with discarded entries in the file: same.
 *  [5b] The good file again: the player still has the Holzaxt after three saves in a row.
 *  [6] Both missing: the empty state (only then), the known risk is visible in the numbers.
 *  [7] A missing file alone is the empty state, not an error; a good file replaces the last good state.
 *      A good EMPTY file is a removal too: not applied at start, the last good state stays.
 *  [8] N1/F1: a VALID file with an entry LESS at start does not bypass the confirmation: last good state loaded and
 *      kept, receipt `bestaetigung-noetig` with `gehalten` from the first tick of the watch; a restart between receipt
 *      and confirmation changes nothing; after the confirmation the item is gone (live inventory).
 *
 * Run: npx tsx server/test/gegenstaende-g2-start.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRUHE_INHALT_MEMBER, findItem, unpackContainer } from '@wov/shared';
import { leseGegenstandsDatei, wendeGegenstandsDatenAn } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsLetzterGuterDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-start');
const WORLDS_DIR = resolve(DIR, 'welten');
const ARBEIT = resolve(DIR, 'arbeit', 'gegenstaende.json');
const GUTER = gegenstandsLetzterGuterDatei(ARBEIT);
const QUITTUNG = gegenstandsQuittungsDatei(ARBEIT);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(dirname(ARBEIT), { recursive: true });

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, AuthChallenge: 68, ContainerAction: 69 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const still = { log: () => undefined, warn: () => undefined, error: () => undefined };

const holzaxt = {
  id: 'Holzaxt',
  nameSchluessel: 'inhalt.gegenstand.Holzaxt.name',
  typ: 'zweihaendigWaffe',
  slot: 'hand',
  modell: { upload: null, skala: 0.6 },
  stapel: 1,
  gewicht: 2,
  werte: { damage: 10 },
  ernte: { baum: 1 },
  rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 8 }] },
  texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' } },
};
const GUT = JSON.stringify({ version: 1, gegenstaende: [holzaxt] });
const KAPUTT = '{"version":1,"gegenstaende":[ {"id":';
const VERWORFEN = JSON.stringify({ version: 1, gegenstaende: [holzaxt, { ...holzaxt, id: 'Kaputt', nameSchluessel: 'inhalt.gegenstand.Kaputt.name', typ: 'gibtsnicht', texte: { 'inhalt.gegenstand.Kaputt.name': { de: 'k', en: 'k' } } }] });

/** A fresh process knows no data items. */
const frischerProzess = (): void => wendeGegenstandsDatenAn([]);

let PORT = 0;
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
      }
    });
    ws.on('error', fail);
  });
}
const sendAdmin = (ws: WebSocket, line: string): void => {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
};
const sendContainer = (ws: WebSocket, id: ZDO['zdoid'], richtung: 0 | 1, item: string, menge: number): void => {
  const w = new Writer();
  w.writeString(id.userId.toString());
  w.writeInt32(id.id);
  w.writeInt32(richtung);
  w.writeString(item);
  w.writeInt32(menge);
  ws.send(Buffer.concat([Buffer.from([P.ContainerAction]), w.toBuffer()]));
};
const quittung = (): GegenstandsQuittung | null => {
  try {
    return JSON.parse(readFileSync(QUITTUNG, 'utf-8')) as GegenstandsQuittung;
  } catch {
    return null;
  }
};

type Zugriff = {
  gebeItem(peer: Peer, name: string, amount: number): void;
  savedPlayers: Map<string, { inventar?: Array<{ name: string; stack: number }>; waffe?: string }>;
  ermittleGespeichertenStand: () => unknown;
};

/** One server start exactly like main.ts: load the file, then create the server with the result. */
function starte(name: string) {
  const geladen = ladeGegenstandsDatei(ARBEIT, still);
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'g2-start',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
    gegenstandsDatei: ARBEIT, gegenstandsStart: geladen.eintraege, gegenstandsStartQuittung: geladen.startQuittung,
  });
  server.start();
  PORT = portVon(server);
  const hole = (n: string): Peer => {
    const p = server.net.getPeers().find((x) => x.name === n);
    if (!p) throw new Error(`peer ${n} missing (${name})`);
    return p;
  };
  return { server, geladen, hole, zugriff: server as unknown as Zugriff };
}
const findeTruhe = (server: ReturnType<typeof starte>['server']): ZDO => {
  const h = server.prefabs.getByName('piece_chest_wood')!.hash;
  const z = server.zdos.getAllZDOs().find((x) => x.prefabHash === h);
  if (!z) throw new Error('chest not found');
  return z;
};

async function main(): Promise<void> {
  const sockets: WebSocket[] = [];
  let stand: ReturnType<typeof starte> | null = null;
  try {
    // ── [1] + [2] good start, player and chest ──────────────────────
    console.log('\n[1] Good file at start: the last good state is written');
    frischerProzess();
    writeFileSync(ARBEIT, GUT);
    stand = starte('server 1');
    check('art angewendet, the Holzaxt is known', stand.geladen.art === 'angewendet' && findItem('Holzaxt') !== undefined);
    check('gegenstaende.letzter-guter.json exists and holds the entry', existsSync(GUTER) && leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege.map((e) => e.id).join() === 'Holzaxt');

    console.log('\n[2] Server 1: a player and a chest hold a Holzaxt; stop (saves)');
    const wsA = await verbinde('Anna'); sockets.push(wsA);
    const anna = stand.hole('Anna');
    await warte(400);
    sendAdmin(wsA, 'teleport 200 200'); await warte(350);
    stand.zugriff.gebeItem(anna, 'Holzaxt', 1);
    await warte(300);
    const kiste = stand.server.zdos.createZDO(stand.server.prefabs.getByName('piece_chest_wood')!.hash, { ...anna.position });
    kiste.setString(TRUHE_INHALT_MEMBER, JSON.stringify([['Holzaxt', 1, 100, 1]]));
    check('Anna holds 1 Holzaxt, the chest 1', anna.inventar.countOf('Holzaxt') === 1 && unpackContainer(kiste.getString(TRUHE_INHALT_MEMBER)).countOf('Holzaxt') === 1);
    let annaId = anna.spielerId;
    stand.server.stop();
    for (const ws of sockets.splice(0)) ws.close();
    await warte(300);

    /** Restart, log Anna in with her saved state, check player and chest, take the axe out of the chest by packet, stop. */
    async function neustart(titel: string, erwartetArt: string, erwartetHash: string | null): Promise<void> {
      frischerProzess();
      check(`${titel}: a fresh process does not know the Holzaxt`, findItem('Holzaxt') === undefined);
      stand = starte(titel);
      check(`${titel}: start result "${stand.geladen.art}" (expected ${erwartetArt}), the Holzaxt is known again`, stand.geladen.art === erwartetArt && findItem('Holzaxt') !== undefined);
      if (erwartetHash !== null) {
        const q = quittung();
        check(`${titel}: receipt "abgelehnt" with the hash of the working copy`, q?.status === 'abgelehnt' && q.hash === erwartetHash, JSON.stringify(q));
      }
      const gespeichert = stand.zugriff.savedPlayers.get(annaId);
      stand.zugriff.ermittleGespeichertenStand = () => gespeichert;
      const ws = await verbinde('AnnaNeu'); sockets.push(ws);
      await warte(400);
      const p = stand.hole('AnnaNeu');
      check(`${titel}: the player still holds the Holzaxt`, p.inventar.countOf('Holzaxt') === 1, String(p.inventar.countOf('Holzaxt')));
      const truhe = findeTruhe(stand.server);
      check(`${titel}: the chest still holds the Holzaxt`, unpackContainer(truhe.getString(TRUHE_INHALT_MEMBER)).countOf('Holzaxt') === 1, truhe.getString(TRUHE_INHALT_MEMBER));
      sendAdmin(ws, 'teleport 200 200'); await warte(350);
      sendContainer(ws, truhe.zdoid, 0, 'Holzaxt', 1);
      await warte(400);
      check(`${titel}: taking it out of the chest by packet works (2 in the inventory)`, p.inventar.countOf('Holzaxt') === 2, String(p.inventar.countOf('Holzaxt')));
      sendContainer(ws, truhe.zdoid, 1, 'Holzaxt', 1);
      await warte(400);
      check(`${titel}: ... and putting one back (chest 1 again)`, unpackContainer(truhe.getString(TRUHE_INHALT_MEMBER)).countOf('Holzaxt') === 1 && p.inventar.countOf('Holzaxt') === 1);
      annaId = p.spielerId;
      stand.server.stop();
      for (const w of sockets.splice(0)) w.close();
      await warte(300);
    }

    console.log('\n[3] Restart with a BROKEN working copy');
    writeFileSync(ARBEIT, KAPUTT);
    await neustart('broken file', 'letzter-guter', sha(KAPUTT));
    check('the working copy itself was not touched', readFileSync(ARBEIT, 'utf-8') === KAPUTT);

    console.log('\n[4] Second restart, working copy GONE (after the save of [3])');
    rmSync(ARBEIT);
    await neustart('missing file', 'letzter-guter', null);

    console.log('\n[5] Restart with discarded entries in the file');
    writeFileSync(ARBEIT, VERWORFEN);
    await neustart('discarded entries', 'letzter-guter', sha(VERWORFEN));

    console.log('\n[5b] The Holzaxt survived the save of every restart above: a last restart with the good file');
    writeFileSync(ARBEIT, GUT);
    await neustart('good file again', 'angewendet', null);

    // ── [6] both missing ────────────────────────────────────────────
    console.log('\n[6] Working copy AND last good state missing: only then the empty state');
    rmSync(ARBEIT, { force: true });
    rmSync(GUTER, { force: true });
    frischerProzess();
    const leer = ladeGegenstandsDatei(ARBEIT, still);
    check('art "fehlt", empty state, the Holzaxt stays unknown (this is what the last good state protects against)', leer.art === 'fehlt' && leer.eintraege.length === 0 && findItem('Holzaxt') === undefined);
    writeFileSync(ARBEIT, KAPUTT);
    const leer2 = ladeGegenstandsDatei(ARBEIT, still);
    check('broken file and no last good state: nothing applied (art abgelehnt), the code items run on', leer2.art === 'abgelehnt' && leer2.eintraege.length === 0 && findItem('AxeFlint') !== undefined);

    // ── [7] missing file alone; good file replaces the last good state ─
    console.log('\n[7] Missing file without a last good state is no error; a good file replaces the last good state');
    rmSync(ARBEIT, { force: true });
    check('no file, no last good state: art "fehlt"', ladeGegenstandsDatei(ARBEIT, still).art === 'fehlt');
    writeFileSync(ARBEIT, JSON.stringify({ version: 1, gegenstaende: [{ ...holzaxt, werte: { damage: 12 } }] }));
    frischerProzess();
    const neu = ladeGegenstandsDatei(ARBEIT, still);
    check('a good file: art angewendet, damage 12, and the last good state now holds 12', neu.art === 'angewendet' && findItem('Holzaxt')?.stats?.damage === 12
      && leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege[0]?.werte.damage === 12);
    writeFileSync(ARBEIT, JSON.stringify({ version: 1, gegenstaende: [] }));
    frischerProzess();
    const leerGut = ladeGegenstandsDatei(ARBEIT, still);
    check('a good EMPTY file at start (removes everything): NOT applied, last good state loaded and kept (still damage 12)',
      leerGut.art === 'letzter-guter' && leerGut.eintraege.length === 1 && findItem('Holzaxt')?.stats?.damage === 12
      && leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege[0]?.werte.damage === 12);

    // ── [8] N1/F1: valid file with an entry less ────────────────────
    console.log('\n[8] A VALID file with one entry LESS at start: no bypass of the confirmation');
    const BESTAETIGEN = gegenstandsBestaetigenDatei(ARBEIT);
    const { rezept: _ohne, ...holzOhneRezept } = holzaxt;
    void _ohne;
    const steinaxt = { ...holzOhneRezept, id: 'Steinaxt', nameSchluessel: 'inhalt.gegenstand.Steinaxt.name', texte: { 'inhalt.gegenstand.Steinaxt.name': { de: 'Steinaxt', en: 'Stone axe' } } };
    const BEIDE = JSON.stringify({ version: 1, gegenstaende: [holzOhneRezept, steinaxt] });
    const NUR_HOLZ = JSON.stringify({ version: 1, gegenstaende: [holzOhneRezept] });
    rmSync(GUTER, { force: true });
    writeFileSync(ARBEIT, BEIDE);
    frischerProzess();
    stand = starte('server 8a');
    const wsB = await verbinde('Berta'); sockets.push(wsB);
    const berta = stand.hole('Berta');
    await warte(400);
    stand.zugriff.gebeItem(berta, 'Steinaxt', 1);
    stand.zugriff.gebeItem(berta, 'Holzaxt', 1);
    await warte(300);
    check('server 8a: Berta holds Steinaxt and Holzaxt, the last good state has both', berta.inventar.countOf('Steinaxt') === 1 && leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege.length === 2);
    annaId = berta.spielerId;
    stand.server.stop();
    for (const w of sockets.splice(0)) w.close();
    await warte(300);

    /** Restart with the file that lacks the Steinaxt, log Berta in, wait for the first ticks, read the receipt. */
    async function startMitWenigerEintraegen(titel: string): Promise<{ p: Peer; q: GegenstandsQuittung | null }> {
      frischerProzess();
      stand = starte(titel);
      check(`${titel}: art "letzter-guter", the Steinaxt is known again (file NOT applied)`, stand.geladen.art === 'letzter-guter' && findItem('Steinaxt') !== undefined, stand.geladen.art);
      check(`${titel}: the last good state is NOT overwritten (still 2 entries)`, leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege.length === 2);
      const gespeichert = stand.zugriff.savedPlayers.get(annaId);
      stand.zugriff.ermittleGespeichertenStand = () => gespeichert;
      const ws = await verbinde('Berta'); sockets.push(ws);
      await warte(2500);
      const p = stand.hole('Berta');
      const q = quittung();
      check(`${titel}: receipt bestaetigung-noetig with gehalten {Steinaxt: n >= 1} (the test's guest gets a new id at every login, so its saved twins add up)`, q?.status === 'bestaetigung-noetig' && (q.gehalten?.Steinaxt ?? 0) >= 1 && Object.keys(q.gehalten ?? {}).join() === 'Steinaxt', JSON.stringify(q));
      check(`${titel}: Berta still holds the Steinaxt, the definition is still known`, p.inventar.countOf('Steinaxt') === 1 && findItem('Steinaxt') !== undefined);
      return { p, q };
    }
    writeFileSync(ARBEIT, NUR_HOLZ);
    const r8b = await startMitWenigerEintraegen('server 8b');
    annaId = r8b.p.spielerId;
    stand!.server.stop();
    for (const w of sockets.splice(0)) w.close();
    await warte(300);
    console.log('   restart BETWEEN receipt and confirmation:');
    const r8c = await startMitWenigerEintraegen('server 8c');
    check('server 8c: the receipt hash is the hash of the file', r8c.q?.hash === sha(NUR_HOLZ));
    bestaetigenAnfrageSchreiben(BESTAETIGEN, sha(NUR_HOLZ));
    await warte(2500);
    const q8 = quittung();
    check('after the confirmation: receipt angewendet, Steinaxt unknown, Berta holds none, Holzaxt stays', q8?.status === 'angewendet' && findItem('Steinaxt') === undefined
      && r8c.p.inventar.countOf('Steinaxt') === 0 && r8c.p.inventar.countOf('Holzaxt') === 1, JSON.stringify(q8));
    check('the last good state now holds 1 entry', leseGegenstandsDatei(readFileSync(GUTER, 'utf-8')).eintraege.length === 1);
  } finally {
    for (const ws of sockets) ws.close();
    try { (stand as ReturnType<typeof starte> | null)?.server.stop(); } catch { /* already stopped */ }
    wendeGegenstandsDatenAn([]);
    rmSync(DIR, { recursive: true, force: true });
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
