/**
 * Real server: a world with a greyglen region turns a client of the old handshake version away
 * ("bitte Seite neu laden"), a world without it keeps accepting it. Version 3 gets through in both.
 * Echter Server: Eine Welt mit greyglen-Region weist einen Client der alten Handshake-Version ab,
 * eine Welt ohne sie nimmt ihn weiter an. Version 3 kommt in beiden durch.
 *
 *   npx tsx server/test/protokoll-biom-version.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWovServer } from '../src/WovServer.js';
import { NetManager } from '../src/net/NetManager.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { PROTOCOL_VERSION, PacketType } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { schickeLayout } from '../src/net/layoutVerteilen.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(HIER, 'tmp-protokoll-biom-version');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

const P = { VersionCheck: 1, Disconnect: 4, AuthChallenge: 68 };

function layout(biome: string): string {
  return JSON.stringify({
    version: 1, name: 'Protokoll', detailSeed: 'wov-test', continents: [{ id: 'c', name: 'C' }],
    regions: [{ id: 'r', continentId: 'c', biome, shape: { kind: 'circle', x: 0, z: 0, radius: 800 }, edgeFalloff: 300 }],
  });
}

/** Sends `version` in the VersionCheck answer; the server either sends AuthChallenge (accepted) or Disconnect. */
function versuche(port: number, version: number): Promise<{ angenommen: boolean; grund: string | null }> {
  return new Promise((ok, schlecht) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    const frist = setTimeout(() => schlecht(new Error(`Timeout v${version}`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      if (type === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(version).toBuffer()]));
      else if (type === P.AuthChallenge) { clearTimeout(frist); ws.close(); ok({ angenommen: true, grund: null }); }
      else if (type === P.Disconnect) { clearTimeout(frist); ok({ angenommen: false, grund: new Reader(Buffer.from(data.subarray(1))).readString() }); }
    });
    ws.on('error', schlecht);
  });
}

async function mitWelt(name: string, biome: string): Promise<{ v2: Awaited<ReturnType<typeof versuche>>; v3: Awaited<ReturnType<typeof versuche>>; v1: Awaited<ReturnType<typeof versuche>>; v4: Awaited<ReturnType<typeof versuche>> }> {
  const dir = resolve(TMP, name);
  mkdirSync(dir, { recursive: true });
  const datei = resolve(dir, 'welt.json');
  writeFileSync(datei, layout(biome));
  const server = createWovServer({
    port: 0, worldName: `pbv-${name}`, worldSeed: 'wov-test', worldFeatures: false, worldVegetation: false,
    worldsDir: resolve(dir, 'saves'), kontenDir: resolve(dir, 'konten'), worldMode: 'layout', worldLayoutPath: datei, saveIntervalMs: 3600_000,
  });
  const log = console.log;
  console.log = () => undefined;
  try {
    server.start();
    await new Promise((r) => setTimeout(r, 300));
    const port = portVon(server);
    const v1 = await versuche(port, 1);
    const v2 = await versuche(port, 2);
    const v3 = await versuche(port, PROTOCOL_VERSION);
    const v4 = await versuche(port, PROTOCOL_VERSION + 1);
    return { v1, v2, v3, v4 };
  } finally {
    console.log = log;
    await server.stop();
  }
}

interface Teilnehmer {
  ws: WebSocket;
  layoutTexte: string[];
  grund: string | null;
  geschlossen: boolean;
}

/** A full login with the given handshake version; records every layout document and a disconnect reason. */
function melde(port: number, version: number, name: string): Promise<Teilnehmer> {
  return new Promise((ok, schlecht) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    const t: Teilnehmer = { ws, layoutTexte: [], grund: null, geschlossen: false };
    const frist = setTimeout(() => schlecht(new Error('Handshake-Timeout')), 8000);
    let auth = false;
    ws.on('close', () => { t.geschlossen = true; });
    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (typ === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(version).toBuffer()]));
      else if (typ === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([2]), w.toBuffer()]));
      } else if (typ === 3) { clearTimeout(frist); ok(t); }
      else if (typ === PacketType.LayoutAktualisiert || typ === PacketType.WorldLayoutData) t.layoutTexte.push(r.readString());
      else if (typ === P.Disconnect) t.grund = r.readString();
    });
    ws.on('error', schlecht);
  });
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The coupling: a greyglen region is written to the layout file of a RUNNING world while a version 2 client is
 * connected. Today the layout watch calls that a geometry change ("erst nach dem Neustart wirksam") and returns
 * before it hands anything to the clients. Whoever rebuilds it to take regions live must keep the version guard:
 * no client of version 2 may ever receive a document with greyglen, it is turned away with the reload message
 * instead. This test stays green for both, and turns red when the document reaches the old client unguarded
 * or when the watch no longer behaves as described here (then this comment says what to re-check).
 */
async function koppelung(): Promise<void> {
  const dir = resolve(TMP, 'live');
  mkdirSync(dir, { recursive: true });
  const datei = resolve(dir, 'welt.json');
  writeFileSync(datei, layout('grassland'));
  const server = createWovServer({
    port: 0, worldName: 'pbv-live', worldSeed: 'wov-test', worldFeatures: false, worldVegetation: false,
    worldsDir: resolve(dir, 'saves'), kontenDir: resolve(dir, 'konten'), worldMode: 'layout', worldLayoutPath: datei, saveIntervalMs: 3600_000,
  });
  const zeilen: string[] = [];
  const orig = { log: console.log, warn: console.warn };
  console.log = () => undefined;
  console.warn = (...a: unknown[]) => { zeilen.push(a.map(String).join(' ')); };
  try {
    server.start();
    await warte(300);
    const port = portVon(server);
    console.log = orig.log;
    const alt = await melde(port, 2, 'Alt');
    const neu = await melde(port, PROTOCOL_VERSION, 'Neu');
    check('both clients are in the greyglen-free world', !alt.geschlossen && !neu.geschlossen);
    const wache = (server as unknown as { layoutWache: { tick(): void } }).layoutWache;
    wache.tick(); // takes the boot state
    writeFileSync(datei + '.tmp', layout('greyglen'));
    renameSync(datei + '.tmp', datei);
    wache.tick();
    await warte(800);
    const mitGreyglen = (t: Teilnehmer): boolean => t.layoutTexte.some((x) => x.includes('greyglen'));
    check('the old client never receives a document with greyglen', !mitGreyglen(alt));
    check('the old client is either left alone or turned away with the reload message',
      !alt.geschlossen || (/veraltet/.test(alt.grund ?? '') && /neu laden/.test(alt.grund ?? '')), alt.grund ?? 'connected');
    const geoAbgelehnt = zeilen.some((z) => /Geo-Änderung/.test(z) && /nichts angewendet/.test(z));
    const alleKicks = alt.geschlossen && /veraltet/.test(alt.grund ?? '');
    check('watch behaviour as documented: geometry change not applied live, OR the old client was turned away', geoAbgelehnt || alleKicks,
      'the layout watch changed: re-check that no unguarded path hands a greyglen layout to a version 2 client');
    check('the current client stays connected either way', !neu.geschlossen);
    alt.ws.close();
    neu.ws.close();
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    await server.stop();
  }
}

/**
 * The login ends when the layout is refused. The version is checked in the handshake and again when the layout goes out;
 * the two differ only if the world document changes in between. Here it does: a version 2 client passes the handshake in a
 * greyglen-free world, then the document gets a greyglen region, then the client logs in. It must be turned away, and nothing
 * more may reach it afterwards (the Disconnect is the last packet, no zone data) and no character may be created for it.
 */
async function anmeldungEndet(): Promise<void> {
  const dir = resolve(TMP, 'login');
  mkdirSync(dir, { recursive: true });
  const datei = resolve(dir, 'welt.json');
  writeFileSync(datei, layout('grassland'));
  const server = createWovServer({
    port: 0, worldName: 'pbv-login', worldSeed: 'wov-test', worldFeatures: false, worldVegetation: false,
    worldsDir: resolve(dir, 'saves'), kontenDir: resolve(dir, 'konten'), worldMode: 'layout', worldLayoutPath: datei, saveIntervalMs: 3600_000,
  });
  const log = console.log;
  console.log = () => undefined;
  try {
    server.start();
    await warte(300);
    console.log = log;
    const port = portVon(server);
    const spieler = (): number => server.zdos.getAllZDOs().filter((z) => z.prefab !== 0 && server.prefabs.getByHash(z.prefab)?.name === 'Player').length;
    const vorher = spieler();
    const arten: number[] = [];
    let grund: string | null = null;
    let nachDisconnect = 0;
    await new Promise<void>((ok, schlecht) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.binaryType = 'nodebuffer';
      const frist = setTimeout(() => schlecht(new Error('Timeout')), 8000);
      let auth = false;
      ws.on('message', (data: Buffer) => {
        const typ = data.readUInt8(0);
        arten.push(typ);
        if (grund !== null) nachDisconnect++;
        const r = new Reader(Buffer.from(data.subarray(1)));
        if (typ === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
        else if (typ === P.AuthChallenge && !auth) {
          auth = true;
          // the document changes between handshake and login (public field, as the live update would set it)
          server.worldLayoutRaw = JSON.parse(layout('greyglen')) as unknown;
          const w = new Writer();
          w.writeString(antwortBerechnen(r.readString(), ''));
          w.writeString('Spaet');
          w.writeString('');
          ws.send(Buffer.concat([Buffer.from([2]), w.toBuffer()]));
        } else if (typ === P.Disconnect) grund = r.readString();
      });
      ws.on('close', () => { clearTimeout(frist); setTimeout(ok, 300); });
      ws.on('error', schlecht);
    });
    check('login: the client that no longer fits the document is turned away with the reload message', /veraltet/.test(grund ?? '') && /neu laden/.test(grund ?? ''), grund ?? 'none');
    check('login: nothing at all arrives after the Disconnect packet', nachDisconnect === 0, `${nachDisconnect} packets after`);
    check('login: the Disconnect is the last packet and no zone data was sent', arten[arten.length - 1] === P.Disconnect && !arten.includes(10), arten.join(','));
    check('login: no character was created for the refused client', spieler() === vorher, `${vorher} -> ${spieler()}`);
  } finally {
    console.log = log;
    await server.stop();
  }
}

/** The guard itself, with stand-in peers: it is the single path every layout takes to a peer. */
function waechter(): void {
  type Fake = { protokollVersion: number; disconnect(r?: string): void; grund: string | null; bekommen: number };
  const peer = (v: number): Fake => ({ protokollVersion: v, grund: null, bekommen: 0, disconnect(r = '') { this.grund = r; } });
  const mitGrau = { regions: [{ biome: 'greyglen' }] };
  const ohne = { regions: [{ biome: 'grassland' }] };
  const senden = (p: Fake): void => { p.bekommen++; };
  const a = peer(2), b = peer(3), c = peer(2), d = peer(0);
  check('guard: version 2 + greyglen → not sent, disconnected with the reload message',
    !schickeLayout(a, mitGrau, senden) && a.bekommen === 0 && /veraltet/.test(a.grund ?? '') && /neu laden/.test(a.grund ?? ''));
  check('guard: the message is bilingual and names the versions', /Client v2, Server v3/.test(a.grund ?? '') && /outdated \(client v2, server v3\)/.test(a.grund ?? '') && /please reload/.test(a.grund ?? ''), a.grund ?? '');
  check('guard: version 3 + greyglen → sent', schickeLayout(b, mitGrau, senden) && b.bekommen === 1 && b.grund === null);
  check('guard: version 2 without greyglen → sent', schickeLayout(c, ohne, senden) && c.bekommen === 1 && c.grund === null);
  check('guard: unknown version 0 is not trusted', !schickeLayout(d, ohne, senden) && d.bekommen === 0 && d.grund !== null);
}

async function main(): Promise<void> {
  waechter();
  await koppelung();
  await anmeldungEndet();
  const alt = await mitWelt('ohne', 'grassland');
  check('refusal text of a too old client: "Server v2" in a world without greyglen', /Client v1, Server v2/.test(alt.v1.grund ?? ''), alt.v1.grund ?? '');
  check('refusal text of a too new client names the current version', new RegExp(`Client v${PROTOCOL_VERSION + 1}, Server v${PROTOCOL_VERSION}\\)`).test(alt.v4.grund ?? ''), alt.v4.grund ?? '');
  check('refusal text is in German and English', /veraltet/.test(alt.v1.grund ?? '') && /outdated/.test(alt.v1.grund ?? ''));
  check('world without greyglen: version 2 is accepted', alt.v2.angenommen);
  check('world without greyglen: current version is accepted', alt.v3.angenommen);
  check('world without greyglen: version 1 and a future version are refused', !alt.v1.angenommen && !alt.v4.angenommen);

  const neu = await mitWelt('mit', 'greyglen');
  check('world with greyglen: version 2 is refused with the reload message', !neu.v2.angenommen && /veraltet/.test(neu.v2.grund ?? '') && /neu laden/.test(neu.v2.grund ?? ''), neu.v2.grund ?? '');
  check('the message names both versions', /Client v2/.test(neu.v2.grund ?? '') && new RegExp(`Server v${PROTOCOL_VERSION}`).test(neu.v2.grund ?? ''));
  check('world with greyglen: the current version is accepted', neu.v3.angenommen);
  check('world with greyglen: version 1 and a future version are refused', !neu.v1.angenommen && !neu.v4.angenommen);

  // A NetManager without the hook (as in other tests): the base version stays accepted.
  const bloss = new NetManager({ port: 0, password: '', serverName: 't', maxPlayers: 2, everyoneAdmin: false, sessionSecret: Buffer.alloc(32, 1), istAdminId: () => false });
  const blossPort = await bloss.start();
  const b2 = await versuche(blossPort, 2);
  const b3 = await versuche(blossPort, PROTOCOL_VERSION);
  const b1 = await versuche(blossPort, 1);
  check('NetManager without a minimum hook accepts the base version and the current one, refuses version 1', b2.angenommen && b3.angenommen && !b1.angenommen);
  bloss.stop();

  const client = readFileSync(resolve(HIER, '..', '..', 'client', 'src', 'net', 'GameSocket.ts'), 'utf8');
  check('the client sends the shared constant', client.includes('w.writeInt32(PROTOCOL_VERSION)'));

  rmSync(TMP, { recursive: true, force: true });
  if (fehler > 0) {
    console.error(`\n${fehler} FAIL`);
    process.exit(1);
  }
  console.log('\nprotokoll-biom-version: alle Pruefungen gruen');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
