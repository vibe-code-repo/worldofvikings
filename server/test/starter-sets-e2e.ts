import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { PacketType, starterSetForClass } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const dir = mkdtempSync(join(tmpdir(), 'wov-starter-e2e-'));
const port = 2586;
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
  for (const [index, [classId, figure]] of [
    ['krieger', 'wikinger'], ['hexer', 'wikinger'], ['druide', 'wikinger'],
    ['seherin', 'wikinger'], ['seherin', 'wikingerin'],
    ['runenmagier', 'wikinger'], ['runenmagier', 'wikingerin'],
  ].entries()) {
    const name = `Starter${String.fromCharCode(65 + index)}`;
    const { character } = await post('/characters', { ...appearance, name, classId, figure }, 201);
    assert.equal(character.classId, classId);
    const { sessionToken } = await post(`/characters/${character.id}/play`);
    let ws = await connect(name, sessionToken);
    let peer = server.net.getPeers().find(p => p.name === name)!;
    const set = starterSetForClass(classId!, figure!)!;
    assert.equal(peer.klasse, classId);
    assert.equal(peer.starterSetGranted, set.id);
    const playerId = peer.spielerId;
    for (const part of set.parts) assert.equal(peer.inventar.countOf(part.item), 1);
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
    assert.equal(peer.starterSetGranted, set.id);
    assert.deepEqual(peer.inventar.serialize(), expected, 'Reconnect/restart never grants a second set');
    await disconnect(ws, name);
  }
  console.log('PASS starter sets E2E: HTTP creation, all seven set variants, inventory delivery, reconnect and server restart');
} finally {
  for (const ws of sockets) ws.terminate();
  server.stop();
  rmSync(dir, { recursive: true, force: true });
}
