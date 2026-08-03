/**
 * E2E test: SetTimeOfDay packet.
 * Starts the server on a test port, performs the handshake with a fake
 * client, requests night time (1530s) and verifies the TimeSync broadcast.
 */
import WebSocket from 'ws';
import { createWovServer } from '../src/WovServer.js';

const PORT = 2499;
const P = { VersionCheck: 1, PeerInfo: 3, TimeSync: 30, PasswordAuth: 2, SetTimeOfDay: 33 };

function writeString(v: string): number[] {
  const enc = new TextEncoder().encode(v);
  let zigzag = ((enc.length << 1) ^ (enc.length >> 31)) >>> 0;
  const out: number[] = [];
  do {
    const b = zigzag & 0x7f;
    zigzag >>>= 7;
    out.push(zigzag ? b | 0x80 : b);
  } while (zigzag);
  return [...out, ...enc];
}

function readVarInt(view: DataView, pos: number): [number, number] {
  let result = 0, shift = 0, byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [((result >>> 1) ^ -(result & 1)), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT });
  server.start();

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';

  let initialTimeOfDay: number | null = null;
  let authSent = false; // server sends PeerInfo twice — auth only once

  const done = new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for TimeSync broadcast')), 8000);

    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const view = new DataView(data.buffer, data.byteOffset + 1, data.length - 1);

      if (type === P.VersionCheck) {
        const pkt = Buffer.alloc(5);
        pkt.writeUInt8(P.VersionCheck, 0);
        pkt.writeInt32LE(1, 1);
        ws.send(pkt);
      } else if (type === P.PeerInfo) {
        if (!authSent) {
          authSent = true;
          const payload = [...writeString(''), ...writeString('Tester'), ...writeString('sess1')];
          ws.send(Buffer.from([P.PasswordAuth, ...payload]));
        }
      } else if (type === P.TimeSync) {
        const timeOfDay = view.getFloat64(8, true);
        const day = view.getInt32(16, true);
        if (initialTimeOfDay === null) {
          initialTimeOfDay = timeOfDay;
          console.log(`initial  TimeSync: timeOfDay=${timeOfDay.toFixed(0)} day=${day}`);
          // request night (1530s within the day cycle)
          const pkt = Buffer.alloc(9);
          pkt.writeUInt8(P.SetTimeOfDay, 0);
          pkt.writeDoubleLE(1530, 1);
          ws.send(pkt);
        } else {
          console.log(`after set TimeSync: timeOfDay=${timeOfDay.toFixed(0)} day=${day}`);
          clearTimeout(timeout);
          if (Math.abs(timeOfDay - 1530) < 2) resolvePromise();
          else reject(new Error(`expected timeOfDay≈1530, got ${timeOfDay}`));
        }
      }
    });
    ws.on('error', reject);
  });

  try {
    await done;
    console.log('PASS: SetTimeOfDay broadcast received with requested time');
  } catch (err) {
    console.error('FAIL:', err);
    process.exitCode = 1;
  } finally {
    ws.close();
    server.stop();
    process.exit(process.exitCode ?? 0);
  }
}

main();
