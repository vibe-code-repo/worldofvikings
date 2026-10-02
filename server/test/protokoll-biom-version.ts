/**
 * Real server: a world with a greyglen region turns a client of the old handshake version away
 * ("bitte Seite neu laden"), a world without it keeps accepting it. Version 3 gets through in both.
 * Echter Server: Eine Welt mit greyglen-Region weist einen Client der alten Handshake-Version ab,
 * eine Welt ohne sie nimmt ihn weiter an. Version 3 kommt in beiden durch.
 *
 *   npx tsx server/test/protokoll-biom-version.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWovServer } from '../src/WovServer.js';
import { NetManager } from '../src/net/NetManager.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { PROTOCOL_VERSION } from '@wov/shared';

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

async function main(): Promise<void> {
  const alt = await mitWelt('ohne', 'grassland');
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
  check('NetManager without a minimum hook accepts the base version and the current one', b2.angenommen && b3.angenommen);
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
