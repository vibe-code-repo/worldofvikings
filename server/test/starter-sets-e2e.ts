import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { CHARACTER_CLASSES, EQUIPMENT_SETS, PacketType, STARTER_SET_FOR_CLASSLESS } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const dir = mkdtempSync(join(tmpdir(), 'wov-starter-e2e-'));
// The port can be moved for a run on a task slot (247n); the runner keeps the default.
const port = Number(process.env.WOV_STARTER_E2E_PORT ?? 2586);
const config = { port, everyoneAdmin: false, worldsDir: dir, kontenDir: join(dir, 'konten'), worldName: 'starter-test', sessionSecret: randomBytes(32) };
let server = createWovServer(config);
const sockets = new Set<WebSocket>();
let accountToken = '';
async function post(path: string, body = {}, status = 200) {
  const response = await fetch(`http://127.0.0.1:${port}/accounts${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-wov-account': accountToken },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

function connect(name: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.add(ws);
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Inventory handshake timeout')); }, 10000);
    ws.on('error', error => { clearTimeout(timeout); reject(error); });
    ws.on('message', (data: Buffer) => {
      const reader = new Reader(data.subarray(1));
      if (data[0] === PacketType.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([PacketType.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (data[0] === PacketType.AuthChallenge) {
        const payload = new Writer().writeString(antwortBerechnen(reader.readString(), ''))
          .writeString(name).writeString(token).toBuffer();
        ws.send(Buffer.concat([Buffer.from([PacketType.PasswordAuth]), payload]));
      } else if (data[0] === PacketType.InventorySync) {
        assert(Array.isArray(JSON.parse(reader.readString())));
        clearTimeout(timeout);
        resolve(ws);
      }
    });
  });
}

async function disconnect(ws: WebSocket, name: string) {
  await new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.close(); });
  sockets.delete(ws);
  for (let i = 0; i < 100 && server.net.getPeers().some(peer => peer.name === name); i++) await delay(10);
  assert(!server.net.getPeers().some(peer => peer.name === name), 'Server processed disconnect and snapshot');
}

try {
  server.start();
  accountToken = (await post('/register', {
    username: 'StarterTest', email: 'starter@example.org', password: 'StarterTest12345',
  }, 201)).token;
  const appearance = { figure: 'wikinger', hairstyle: 'H_01', hairColor: 'mittelbraun', eyeColor: 'fjordblau', top: '', legs: '' };
  await post('/characters', { ...appearance, name: 'InvalidClass', classId: 'admin' }, 400);
  // Every class starts in Plainhide, in the variant of its figure; no class set is delivered.
  const classSetItems = EQUIPMENT_SETS.filter(set => !('starter' in set)).flatMap(set => set.parts.map(part => part.item));
  for (const [index, [classId, figure]] of CHARACTER_CLASSES.flatMap(id => [[id, 'wikinger'], [id, 'wikingerin']] as const).entries()) {
    const name = `Starter${String.fromCharCode(65 + index)}`;
    const { character } = await post('/characters', { ...appearance, name, classId, figure }, 201);
    assert.equal(character.classId, classId);
    const { sessionToken } = await post(`/characters/${character.id}/play`);
    let ws = await connect(name, sessionToken);
    let peer = server.net.getPeers().find(p => p.name === name)!;
    const setId = figure === 'wikinger' ? 'plainhide_male' : 'plainhide_female';
    const set = EQUIPMENT_SETS.find(entry => entry.id === setId)!;
    assert.equal(set.parts.length, 5);
    assert.equal(peer.klasse, classId);
    assert.equal(peer.starterSetGranted, setId);
    const playerId = peer.spielerId;
    for (const part of set.parts) assert.equal(peer.inventar.countOf(part.item), 1);
    for (const item of classSetItems) assert.equal(peer.inventar.countOf(item), 0, `${classId}: class set piece ${item} must not be granted`);
    assert.equal(peer.inventar.countOf('LederBH'), 0);
    assert.equal(peer.inventar.countOf('LederShorts'), 0);
    peer.inventar.removeItem(peer.inventar.all.find(item => item.shared.name === set.parts[0]!.item)!);
    const expected = peer.inventar.serialize();
    await disconnect(ws, name);
    // Also verify the real world-save/reload path, not just in-memory reconnects.
    if (figure === 'wikingerin') {
      server.stop();
      await delay(100);
      server = createWovServer(config);
      server.start();
    }
    ws = await connect(name, sessionToken);
    peer = server.net.getPeers().find(p => p.name === name)!;
    assert.equal(peer.spielerId, playerId, 'Authenticated identity survives restart');
    assert.equal(peer.klasse, classId);
    assert.equal(peer.starterSetGranted, setId);
    assert.deepEqual(peer.inventar.serialize(), expected, 'Reconnect/restart never grants a second set');
    await disconnect(ws, name);
  }
  // OPEN DECISION (Mike): a NEW character created without a classId (the API allows it). The expectation is this one line;
  // it must agree with the shared switch STARTER_SET_FOR_CLASSLESS. Login, save, restart and reconnect never change the outcome.
  const CLASSLESS_GETS_STARTER = false;
  assert.equal(STARTER_SET_FOR_CLASSLESS, CLASSLESS_GETS_STARTER, 'The shared switch and the test expectation must say the same');
  for (const [index, figure] of ['wikinger', 'wikingerin'].entries()) {
    const name = `Classless${String.fromCharCode(65 + index)}`;
    const { character } = await post('/characters', { ...appearance, name, figure }, 201);
    assert.equal(character.classId ?? '', '');
    const { sessionToken } = await post(`/characters/${character.id}/play`);
    let ws = await connect(name, sessionToken);
    let peer = server.net.getPeers().find(p => p.name === name)!;
    const setId = figure === 'wikinger' ? 'plainhide_male' : 'plainhide_female';
    const pieces = EQUIPMENT_SETS.find(entry => entry.id === setId)!.parts.map(part => part.item);
    assert.equal(peer.starterSetGranted, CLASSLESS_GETS_STARTER ? setId : '', `${name}: marker after the first login`);
    for (const item of pieces) assert.equal(peer.inventar.countOf(item), CLASSLESS_GETS_STARTER ? 1 : 0, `${name}: ${item}`);
    for (const item of classSetItems) assert.equal(peer.inventar.countOf(item), 0, `${name}: no class set piece`);
    const expected = peer.inventar.serialize();
    await disconnect(ws, name);
    server.stop(); await delay(100); server = createWovServer(config); server.start();
    ws = await connect(name, sessionToken);
    peer = server.net.getPeers().find(p => p.name === name)!;
    assert.equal(peer.starterSetGranted, CLASSLESS_GETS_STARTER ? setId : '', `${name}: marker after restart`);
    assert.deepEqual(peer.inventar.serialize(), expected, `${name}: restart changes nothing`);
    await disconnect(ws, name);
  }
  console.log('PASS starter sets E2E: HTTP creation, Plainhide for nine classes and both figures, inventory delivery, reconnect and server restart');
} finally {
  for (const ws of sockets) ws.terminate();
  server.stop();
  rmSync(dir, { recursive: true, force: true });
}
