/**
 * A chest whose prefab has an empty name opens as an empty chest and does not throw (card "Folgen Tod und Beute", job 2).
 *
 * Real WebSocket player, real packet path (`Interact`). `handleTruheOeffnen` rolls `wuerfleTruhe(def?.name ?? '')`; the empty
 * name matched no chest pattern and the old code then read a row `undefined` (TypeError in the packet handler, no answer to
 * the player). The prefab is registered by the test: name '' with the CONTAINER flag (a prefab with a real name always
 * matches the catch-all pattern).
 *  [1] Opening the nameless chest: the player gets the answer `Truhe geöffnet` and a ContainerSync with an EMPTY content.
 *  [2] The server runs on: a normal chest (piece_chest_wood) opened afterwards is filled with one item and answered.
 *  [3] The nameless chest is marked looted (a second opening gives the same empty content, no dice).
 *
 * Run: npx tsx server/test/truhe-leerer-name.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { PacketType, PrefabFlag, TRUHE_LOOTED_MEMBER, unpackContainer } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Prefab } from '../src/prefab/Prefab.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Vector3 } from '@wov/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-truhe-leerer-name');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, Interact: 44, AuthChallenge: 68 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Socke extends WebSocket {
  antworten: Array<{ ok: boolean; text: string }>;
  behaelter: string[];
}

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.antworten = []; ws.behaelter = [];
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
      } else if (type === PacketType.InteractResult) {
        ws.antworten.push({ ok: r.readBool(), text: r.readString() });
      } else if (type === PacketType.ContainerSync) {
        r.readString(); r.readInt32();
        ws.behaelter.push(r.readString());
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}

const sendInteract = (ws: WebSocket, pos: Vector3, prefabHash: number): void => {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeInt32(prefabHash);
  ws.send(Buffer.concat([Buffer.from([P.Interact]), w.toBuffer()]));
};
/** Waits until `f` is true (max 3 s). */
async function bis(f: () => boolean): Promise<boolean> {
  const t0 = Date.now();
  while (!f() && Date.now() - t0 < 3000) await warte(25);
  return f();
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'truhe-leerer-name',
    saveIntervalMs: 3600_000, spielerSicherungMs: 3600_000, everyoneAdmin: true,
    worldCreatures: false, worldFeatures: false, worldVegetation: false,
  });
  server.start();
  PORT = portVon(server);
  const sockets: WebSocket[] = [];
  try {
    const namenlos = new Prefab('', { x: 1, y: 1, z: 1 }, PrefabFlag.CONTAINER | PrefabFlag.PERSISTENT);
    server.prefabs.register(namenlos);
    const echteTruhe = server.prefabs.getByName('piece_chest_wood')!;
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna = server.net.getPeers().find((x) => x.name === 'Anna')!;
    await warte(300);
    const pos = { ...anna.position };
    check('the test prefab has the empty name and is found by its hash', server.prefabs.getByHash(namenlos.hash)?.name === '', `hash ${namenlos.hash}`);
    const leer = server.zdos.createZDO(namenlos.hash, { ...pos });
    const voll = server.zdos.createZDO(echteTruhe.hash, { x: pos.x + 0.5, y: pos.y, z: pos.z });

    console.log('\n[1] Open the nameless chest');
    sendInteract(ws, pos, namenlos.hash);
    const angekommen = await bis(() => ws.antworten.length >= 1 && ws.behaelter.length >= 1);
    check('the player gets an answer and the chest content (no silence from a throwing handler)', angekommen, `${ws.antworten.length} answers, ${ws.behaelter.length} contents`);
    check('answer: ok, "Truhe geöffnet"', ws.antworten[0]?.ok === true && ws.antworten[0].text === 'Truhe geöffnet', JSON.stringify(ws.antworten[0]));
    check('the content is EMPTY', ws.behaelter[0] !== undefined && unpackContainer(ws.behaelter[0]).all.length === 0, ws.behaelter[0]);
    check('the chest is marked looted', leer.getInt(TRUHE_LOOTED_MEMBER) === 1);

    console.log('\n[2] The server runs on: a normal chest is opened and filled');
    sendInteract(ws, { x: pos.x + 0.5, y: pos.y, z: pos.z }, echteTruhe.hash);
    const zweite = await bis(() => ws.antworten.length >= 2 && ws.behaelter.length >= 2);
    check('the second answer and content came', zweite, `${ws.antworten.length} answers, ${ws.behaelter.length} contents`);
    check('the normal chest holds exactly one item', ws.behaelter[1] !== undefined && unpackContainer(ws.behaelter[1]).all.length === 1, ws.behaelter[1]);
    check('the peer is still connected and alive', server.net.getPeers().some((x) => x.name === 'Anna') && ws.readyState === WebSocket.OPEN);
    void voll;

    console.log('\n[3] A second opening of the nameless chest');
    sendInteract(ws, pos, namenlos.hash);
    const dritte = await bis(() => ws.antworten.length >= 3 && ws.behaelter.length >= 3);
    check('answered again, still empty', dritte && ws.antworten[2]?.ok === true && unpackContainer(ws.behaelter[2]!).all.length === 0, ws.behaelter[2]);
  } finally {
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.close();
    server.stop();
  }
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
