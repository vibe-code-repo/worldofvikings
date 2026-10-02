/**
 * D5 N3 — the admin flag: the client learns its rights from the server, and the server never takes the client's word for them.
 *
 * Real server (`everyone-admin` off, guests), real WebSocket clients, the real client class `ESitzung` fed with the real packets.
 *
 *  [1] Login: the `ServerConfig` flag byte carries bit 7 for an admin and not for a guest (a guest who is put on the admin list
 *      and logs in again with the session token gets the bit).
 *  [2] The server decides: a guest without rights sends `dungeon enter`, `teleport` and `fly`, also after sending the server a
 *      faked `ServerConfig` (flag set) and a faked `AdminEvent admin/active`: every command is refused with the server's text,
 *      the guest does not move, `peer.isAdmin` stays false. An admin gets past the gate (control: teleport moves him).
 *  [3] B2, live: rights granted in mid-session reach the client as `AdminEvent admin/true`, rights withdrawn as `admin/false`;
 *      `ESitzung` turns "nothing" into `dungeon-enter` at an entrance and back, and the server refuses the guest again.
 *
 * Run: npx tsx server/test/d5-beute-admin.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { FLAG_ADMIN } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ESitzung } from '../../client/src/player/eSitzung';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d5-beute-admin');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, ServerConfig: 52, AdminCommand: 53, AdminEvent: 54, AuthChallenge: 68 };
const VERWEIGERT = 'Admin commands are not allowed for this player';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};

interface AdminEreignis { command: string; active: boolean; text: string }
interface Klient {
  ws: WebSocket;
  token: string;
  flags: number | null;
  ereignisse: AdminEreignis[];
  /** The client class, fed exactly like main.ts does: PeerInfo -> neueVerbindung, ServerConfig -> serverConfig, AdminEvent -> adminEreignis. */
  sitzung: ESitzung;
}

function verbinde(name: string, token = '', nurEditor = false): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    const k: Klient = { ws, token: '', flags: null, ereignisse: [], sitzung: new ESitzung(() => undefined) };
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`handshake timeout for "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const w = new Writer();
        w.writeString(antwortBerechnen(nonce, ''));
        w.writeString(name);
        w.writeString(token);
        w.writeBool(nurEditor);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        reader.readString(); reader.readString(); reader.readString(); // name, userId, server name
        k.token = reader.readString();
        k.sitzung.neueVerbindung();
      } else if (type === P.ServerConfig) {
        reader.readString(); reader.readString(); reader.readInt32(); // world name, seed, generator version
        k.flags = reader.readUInt8();
        k.sitzung.serverConfig(k.flags);
        clearTimeout(timeout);
        resolvePromise(k);
      } else if (type === P.AdminEvent) {
        const command = reader.readString();
        const active = reader.readBool();
        const text = k.sitzung.adminEreignis(command, active, reader.readString());
        k.ereignisse.push({ command, active, text });
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({ port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'd5-beute-admin', saveIntervalMs: 3600_000, everyoneAdmin: false });
  server.start();
  PORT = portVon(server);
  const peerVon = (name: string) => server.net.getPeers().find((p) => p.name === name)!;
  // Standing exactly at a dungeon entrance as far as the client is concerned: the rule only looks at its own list.
  const lage = { imDungeon: false, pos: { x: 100, z: 120 }, dungeonSpawn: { x: 10, z: 20 }, eingaenge: [{ x: 105, z: 120 }] };
  try {
    console.log('[1] The flag at login');
    const carol = await verbinde('Carol');
    check('a guest without rights: bit 7 of the ServerConfig flag byte is NOT set', carol.flags !== null && (carol.flags & FLAG_ADMIN) === 0, String(carol.flags));
    check('... the server says the same (premise: not admin)', peerVon('Carol').isAdmin === false);
    check('... and the client class starts without rights: E at an entrance sends nothing', !carol.sitzung.istAdmin && carol.sitzung.aktion(lage) === 'nichts');
    const dave0 = await verbinde('Dave');
    const daveToken = dave0.token;
    server.adminListe.hinzufuegen(peerVon('Dave').spielerId, 'Dave');
    dave0.ws.close();
    await bis(() => !server.net.getPeers().some((p) => p.name === 'Dave'), 3000);
    const dave = await verbinde('Dave', daveToken);
    check('an admin (on the list, logs in again with the token): bit 7 IS set', dave.flags !== null && (dave.flags & FLAG_ADMIN) !== 0, String(dave.flags));
    check('... the server says the same (premise: admin)', peerVon('Dave').isAdmin === true);
    check('... and the client class knows it: E at an entrance sends `dungeon enter`', dave.sitzung.istAdmin && dave.sitzung.aktion(lage) === 'dungeon-enter');

    console.log('\n[2] The server decides, not the flag');
    // A client that lies: a ServerConfig packet with the admin bit and an AdminEvent that grants the rights, both sent TO the server.
    const fakeConfig = new Writer();
    fakeConfig.writeString('x'); fakeConfig.writeString('x'); fakeConfig.writeInt32(0); fakeConfig.writeUInt8(0xff);
    carol.ws.send(Buffer.concat([Buffer.from([P.ServerConfig]), fakeConfig.toBuffer()]));
    const fakeEvent = new Writer();
    fakeEvent.writeString('admin'); fakeEvent.writeBool(true); fakeEvent.writeString('Du hast jetzt Adminrechte.');
    carol.ws.send(Buffer.concat([Buffer.from([P.AdminEvent]), fakeEvent.toBuffer()]));
    await warte(200);
    const vorher = { ...peerVon('Carol').position };
    carol.ereignisse.length = 0;
    for (const zeile of ['dungeon enter', 'teleport 500 500', 'fly']) sendAdmin(carol.ws, zeile); // the bucket of AdminCommand holds 3 (`Drossel.ts`)
    await warte(1300);
    sendAdmin(carol.ws, 'admin add Carol'); // a guest must not make herself an admin
    const alle = await bis(() => carol.ereignisse.length >= 4, 3000);
    check('every command of the guest got an answer', alle, String(carol.ereignisse.length));
    check('... and every answer is the refusal of the server', carol.ereignisse.every((e) => e.text === VERWEIGERT && e.active === false), JSON.stringify(carol.ereignisse.map((e) => e.text)));
    const nachher = peerVon('Carol').position;
    check('the guest did not move (the teleport was not executed)', nachher.x === vorher.x && nachher.z === vorher.z, `${vorher.x},${vorher.z} -> ${nachher.x},${nachher.z}`);
    check('the server still has isAdmin = false for the guest, and the faked packets did not reach the client class either', peerVon('Carol').isAdmin === false && !carol.sitzung.istAdmin);
    check('the guest is not on the admin list', !server.adminListe.enthaelt(peerVon('Carol').spielerId));
    // control: an admin passes the same gate
    dave.ereignisse.length = 0;
    const daveVor = { ...peerVon('Dave').position };
    sendAdmin(dave.ws, 'teleport 321 123');
    await bis(() => dave.ereignisse.length >= 1, 3000);
    check('control: the admin\'s teleport is executed (so the refusal above is the rights, not a broken command)', Math.abs(peerVon('Dave').position.x - 321) < 1 && peerVon('Dave').position.x !== daveVor.x, `${peerVon('Dave').position.x}`);
    dave.ereignisse.length = 0;
    sendAdmin(dave.ws, 'dungeon enter');
    await bis(() => dave.ereignisse.length >= 1, 3000);
    check('control: the admin\'s `dungeon enter` is not refused for the rights (another answer, e.g. no entrance near)', dave.ereignisse[0] !== undefined && dave.ereignisse[0].text !== VERWEIGERT, dave.ereignisse[0]?.text ?? '');

    console.log('\n[3] B2: rights change live');
    carol.ereignisse.length = 0;
    server.adminListe.hinzufuegen(peerVon('Carol').spielerId, 'Carol');
    const erhalten = await bis(() => carol.ereignisse.some((e) => e.command === 'adminrechte'), 5000);
    check('the grant reaches the client as `AdminEvent adminrechte` with active = true', erhalten && carol.ereignisse.find((e) => e.command === 'adminrechte')?.active === true && carol.ereignisse.find((e) => e.command === 'adminrechte')?.text === 'Du hast jetzt Adminrechte.', JSON.stringify(carol.ereignisse));
    check('the server agrees (isAdmin = true now, same connection)', peerVon('Carol').isAdmin === true);
    check('E at the entrance now sends `dungeon enter`', carol.sitzung.istAdmin && carol.sitzung.aktion(lage) === 'dungeon-enter');
    await warte(1300); // the AdminCommand bucket refills one per second
    carol.ereignisse.length = 0;
    sendAdmin(carol.ws, 'teleport 500 500');
    await bis(() => carol.ereignisse.length >= 1, 3000);
    check('and the server now executes her command (teleport moved her)', Math.abs(peerVon('Carol').position.x - 500) < 1, `${peerVon('Carol').position.x}`);
    carol.ereignisse.length = 0;
    server.adminListe.entfernen(peerVon('Carol').spielerId);
    const entzogen = await bis(() => carol.ereignisse.some((e) => e.command === 'adminrechte'), 5000);
    check('the withdrawal reaches the client as `AdminEvent adminrechte` with active = false', entzogen && carol.ereignisse.find((e) => e.command === 'adminrechte')?.active === false && carol.ereignisse.find((e) => e.command === 'adminrechte')?.text === 'Deine Adminrechte wurden entzogen.', JSON.stringify(carol.ereignisse));
    check('E at the entrance sends nothing again', !carol.sitzung.istAdmin && carol.sitzung.aktion(lage) === 'nichts');
    check('the server agrees (isAdmin = false)', peerVon('Carol').isAdmin === false);
    await warte(1300);
    carol.ereignisse.length = 0;
    const vor2 = peerVon('Carol').position.x;
    sendAdmin(carol.ws, 'teleport 900 900');
    await bis(() => carol.ereignisse.length >= 1, 3000);
    check('and the server refuses her again', carol.ereignisse[0]?.text === VERWEIGERT && peerVon('Carol').position.x === vor2);

    console.log('\n[4] N4-B1: the answers to `admin list|add|remove` do not touch the flag');
    for (const zeile of ['admin list', 'admin add Carol', 'admin remove Carol']) {
      await warte(1300); // the AdminCommand bucket
      dave.ereignisse.length = 0;
      sendAdmin(dave.ws, zeile);
      const antwort = await bis(() => dave.ereignisse.some((e) => e.command === 'admin'), 3000);
      const e = dave.ereignisse.find((x) => x.command === 'admin');
      check(`"${zeile}": the answer arrives as \`admin\` with active = false (behaviour unchanged)`, antwort && e?.active === false && e.text.length > 0, JSON.stringify(dave.ereignisse));
      check(`... the server still has isAdmin = true, the client class keeps the flag, E at the entrance sends \`dungeon enter\``, peerVon('Dave').isAdmin === true && dave.sitzung.istAdmin && dave.sitzung.aktion(lage) === 'dungeon-enter');
    }
    // the same command from a guest does not make her an admin on the client either (Carol was added and removed again above)
    await warte(1300);
    carol.ereignisse.length = 0;
    sendAdmin(carol.ws, 'admin list');
    await bis(() => carol.ereignisse.some((e) => e.command === 'admin'), 3000);
    check('a guest\'s `admin list` is refused and gives her no flag', carol.ereignisse[0]?.text === VERWEIGERT && !carol.sitzung.istAdmin && carol.sitzung.aktion(lage) === 'nichts', JSON.stringify(carol.ereignisse));

    console.log('\n[4b] N5-B1b: a typed command named like the live packet never takes the flag');
    for (const zeile of ['adminrechte', 'AdminRechte ja', 'ADMINRECHTE', '  adminRechte  nein']) {
      await warte(1300); // the AdminCommand bucket
      dave.ereignisse.length = 0;
      sendAdmin(dave.ws, zeile);
      await bis(() => dave.ereignisse.length >= 1, 3000);
      const e = dave.ereignisse[0];
      check(`"${zeile}": the answer is named \`admin\` (never \`adminrechte\`) with active = false`, dave.ereignisse.length === 1 && e?.command === 'admin' && e.active === false && e.text === 'Reserved name, not a command: adminrechte', JSON.stringify(dave.ereignisse));
      check('... the server still has isAdmin = true, the client keeps the flag, E at the entrance sends `dungeon enter`', peerVon('Dave').isAdmin === true && dave.sitzung.istAdmin && dave.sitzung.aktion(lage) === 'dungeon-enter');
    }
    // a guest gets the usual refusal or the reserved-name one, never the flag, and never an event named `adminrechte`
    for (const zeile of ['adminrechte', 'AdminRechte ja', 'ADMINRECHTE']) {
      await warte(1300);
      carol.ereignisse.length = 0;
      sendAdmin(carol.ws, zeile);
      await bis(() => carol.ereignisse.length >= 1, 3000);
      check(`a guest's "${zeile}": refused, named \`admin\`, active = false, no flag`, carol.ereignisse.length === 1 && carol.ereignisse[0]?.command === 'admin' && carol.ereignisse[0].active === false && carol.ereignisse[0].text.length > 0 && !carol.sitzung.istAdmin && !peerVon('Carol').isAdmin && carol.sitzung.aktion(lage) === 'nichts', JSON.stringify(carol.ereignisse));
    }
    // the live channel still works after that: grant and withdrawal reach the client (Frieda is a fresh guest)
    {
      const frieda = await verbinde('Frieda');
      server.adminListe.hinzufuegen(peerVon('Frieda').spielerId, 'Frieda');
      const ja = await bis(() => frieda.ereignisse.some((e) => e.command === 'adminrechte' && e.active), 5000);
      check('live grant still arrives as `adminrechte` / true and the client takes it', ja && frieda.sitzung.istAdmin);
      server.adminListe.entfernen(peerVon('Frieda').spielerId);
      const nein = await bis(() => frieda.ereignisse.some((e) => e.command === 'adminrechte' && !e.active), 5000);
      check('live withdrawal still arrives as `adminrechte` / false and the client takes it', nein && !frieda.sitzung.istAdmin);
      frieda.ws.close();
    }

    console.log('\n[5] N4-B2: editor connections get the bit exactly like game connections: by the rights of the account, not by being an editor');
    // Editor sessions get their rights the same way (`NetManager.handlePasswordAuth`: everyoneAdmin or the admin list on the spielerId, whatever `nurEditor` says).
    const editorGast = await verbinde('Eddie', '', true);
    check('an editor connection of a guest: bit 7 is NOT set', editorGast.flags !== null && (editorGast.flags & FLAG_ADMIN) === 0, String(editorGast.flags));
    check('... the server agrees (premise: editor peer, not admin)', server.net.getPeers().some((p) => p.nurEditor && !p.isAdmin) && !editorGast.sitzung.istAdmin);
    dave.ws.close();
    await bis(() => !server.net.getPeers().some((p) => p.name === 'Dave'), 3000);
    const daveEditor = await verbinde('Dave', daveToken, true);
    check('an editor connection of an admin account (token of a listed admin): bit 7 IS set', daveEditor.flags !== null && (daveEditor.flags & FLAG_ADMIN) !== 0, String(daveEditor.flags));
    check('... the server agrees (premise: editor peer, admin)', server.net.getPeers().some((p) => p.nurEditor && p.isAdmin));
    editorGast.ws.close();
    daveEditor.ws.close();

    carol.ws.close();
    console.log(failures === 0 ? '\nd5-beute-admin: OK' : `\nd5-beute-admin: ${failures} FAIL`);
  } catch (err) {
    console.error('FAIL:', err);
    failures++;
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}
main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
