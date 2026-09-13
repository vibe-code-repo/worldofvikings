/** DEV only. Uses the existing authenticated admin protocol, never edits a save.
 * tsx tools/grant-ironward-dev.mts Gast [--apply]
 * Without --apply: inspect online players only. Session is editor-only so it
 * neither moves the character nor disconnects their running game session.
 * Uses normal login for the configured test account. Credentials and tokens
 * stay in memory and are never printed or stored.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { GameSocket } from '../client/src/net/GameSocket.js';
import { PacketType, IRONWARD_PARTS } from '@wov/shared';
import { parse as parseYaml } from 'yaml';

const name = process.argv[2]; const apply = process.argv.includes('--apply');
assert(name && !/[\r\n]/.test(name), 'Expected character name');
const env = Object.fromEntries(readFileSync('/etc/wov.env', 'utf8').split('\n').flatMap(line => {
  const match = /^([A-Z_]+)=(.*)$/.exec(line.trim()); return match ? [[match[1], match[2]]] : [];
}));
assert.equal(env.WOV_INSTANZ, 'dev', 'Refusing anything except DEV');
const db = new DatabaseSync('/opt/worldofvikings/server/data/konten/dev.db', { readOnly: true });
const rows = db.prepare('select ch.name, ch.spieler_id, k.benutzername from charaktere ch join konten k on k.id = ch.konto_id where ch.name = ? collate nocase').all(name) as Array<{ name: string; spieler_id: string; benutzername: string }>;
db.close(); assert.equal(rows.length, 1, 'Character must be unambiguous'); const character = rows[0]!;
const config = parseYaml(readFileSync('/opt/worldofvikings/server/data/server.yml', 'utf8'));
const configured = config['standard-konto'];
const account = (Array.isArray(configured) ? configured : [configured]).find(a => a?.name?.toLowerCase() === character.benutzername.toLowerCase());
assert(account, 'This helper only supports an explicitly configured DEV test account');
const login = await fetch('http://127.0.0.1:2467/accounts/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: account.name, password: account.passwort }),
});
assert(login.ok, `Normal account login failed (${login.status})`);
const auth = await login.json() as any;
const entry = auth.characters.find((c: any) => c.name.toLowerCase() === character.name.toLowerCase());
assert(entry, 'Character is not owned by the test account');
const play = await fetch(`http://127.0.0.1:2467/accounts/characters/${entry.id}/play`, {
  method: 'POST', headers: { authorization: `Bearer ${auth.token}` },
});
assert(play.ok, `Character login failed (${play.status})`);
let ticket = ((await play.json()) as any).sessionToken;
Object.assign(globalThis, {
  WebSocket, window: { setInterval, clearInterval },
  localStorage: { getItem: () => ticket, setItem: (_: string, value: string) => { ticket = value; } },
});
const socket = new GameSocket('ws://127.0.0.1:2467', character.name, true);
const result = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => { socket.disconnect(); reject(new Error('Admin request timed out')); }, 15000);
  socket.on(PacketType.PeerInfo, () => socket.sendAdminCommand(apply ? `item ironward ${character.name}` : 'spieler online'));
  socket.on(PacketType.AdminEvent, reader => {
    reader.readString(); reader.readBool(); const message = reader.readString();
    clearTimeout(timeout); socket.disconnect(); resolve(message);
  });
  socket.connect();
});
console.log(result);
if (apply) {
  assert(result.includes('Ironward vollständig (7/7)'), 'Delivery rejected');
  let verified = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const save = JSON.parse(zstdDecompressSync(readFileSync('/opt/worldofvikings/server/data/worlds/dev.db.zst')).toString());
    const player = save.players.find((p: any) => p.spielerId === character.spieler_id);
    verified = IRONWARD_PARTS.every(part => player?.inventar?.some((i: any) => i.name === part.item && i.stack >= 1));
    if (verified) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(verified, 'Inventory delivered but disk save NOT confirmed; check save logs before retrying');
  console.log('PASS: All seven items confirmed in the persistent DEV save.');
}
