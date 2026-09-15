/** Real server handlers, without starting a world or network listener. */
import assert from 'node:assert/strict';
import { WovServer } from '../src/WovServer.js';
import { Inventory, WILDWARDEN_PARTS, findItem, decodeArmor } from '@wov/shared';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { AdminCommandRegistry } from '../src/admin/AdminCommands.js';

// Private handlers are intentionally exercised, not reimplemented in the test.
// The probe is deliberately partial: known members stay typed, the rest open.
type ServerProbe = WovServer & Record<string, unknown>;
const server = Object.create(WovServer.prototype) as ServerProbe;
const zdoValues = new Map<string, string>();
server.zdosVon = () => ({ getZDO: () => ({ setString: (k: string, v: string) => zdoValues.set(k, v) }) });
const peer = { name: 'Gast', figur: 'wikinger', frisur: 'H_01', haarfarbe: 'mittelbraun', ruestung: '|', inventar: new Inventory(), sendPacketWith: () => {} };
function appearance(parts: Record<string, string>, old = false) {
  const w = new Writer().writeString('H_01').writeString(parts.oberkoerper ?? '').writeString(parts.beine ?? '');
  if (!old) w.writeString('mittelbraun').writeString(JSON.stringify(parts));
  server.handleSetAussehen(peer, new Reader(w.toBuffer()));
}
appearance({ kopf: 'wildwarden_crown' }); assert.equal(peer.ruestung, '|', 'Cannot equip unowned armor');
for (const p of WILDWARDEN_PARTS) peer.inventar.addItem(findItem(p.item)!, 1);
const parts = Object.fromEntries(WILDWARDEN_PARTS.map(p => [p.slot, p.id]));
appearance(parts); assert.deepEqual(decodeArmor(peer.ruestung), parts);
assert(peer.inventar.all.every(i => i.equipped));
const accepted = peer.ruestung;
appearance({ kopf: 'wildwarden_vest' }); assert.equal(peer.ruestung, accepted, 'Reject wrong slot');
peer.inventar.removeByName('wildwarden_crown', 1); server.inventarSync(peer);
assert(!decodeArmor(peer.ruestung).kopf, 'Dropped armor must be removed');
appearance({}, true); assert.equal(peer.ruestung, '|', 'Three-string legacy client');
assert(peer.inventar.all.every(i => !i.equipped));

server.adminCommands = new AdminCommandRegistry();
server.net = { getPeers: () => [] };
const original = new Inventory(); original.addItem(findItem('Hammer')!, 1);
const saved = { name: 'Gast', figur: 'wikinger', inventar: original.serialize(), position: { x: 4, y: 5, z: 6 } };
server.savedPlayers = new Map([['test-player', saved]]);
let saves = 0; server.saveWorldAsync = async () => { saves++; };
server.registerSpawnCommand();
const admin = { isAdmin: true };
let result = server.adminCommands.execute(admin, 'item wildwarden Gast'); assert(result.ok, result.message);
assert.equal(saved.inventar.length, 8); assert.deepEqual(saved.position, { x: 4, y: 5, z: 6 });
result = server.adminCommands.execute(admin, 'item wildwarden Gast'); assert(result.ok);
assert.match(result.message, /0 neue/); assert.equal(saved.inventar.length, 8); assert.equal(saves, 2);
assert(!server.adminCommands.execute({ isAdmin: false }, 'item wildwarden Gast').ok);
assert(!server.adminCommands.execute(admin, 'item wildwarden Nobody').ok);
const full = new Inventory(); for (let i = 0; i < 32; i++) full.addItem(findItem('Hammer')!, 1);
saved.inventar = full.serialize(); const before = JSON.stringify(saved.inventar);
assert(!server.adminCommands.execute(admin, 'item wildwarden Gast').ok);
assert.equal(JSON.stringify(saved.inventar), before, 'Full inventory unchanged atomically');
server.prefabs = { getByName: () => undefined };
server.zdos = { getAllZDOs: () => [] };
Object.defineProperty(server, 'zones', { value: { getGeneratedZones: () => [] } });
Object.defineProperty(server, 'heightmaps', { value: { listTerrainComps: () => [] } });
server.weltMarken = { alsNamen: () => [] };
server.net = { getPeers: () => [{ nurEditor: true, spielerId: 'test-player', name: 'Gast', inventar: new Inventory() }] };
assert.deepEqual(server.momentaufnahme().kopf.players, [saved], 'Editor session cannot overwrite saved character');
console.log('PASS Wildwarden server: ownership, slots, equipped flags, legacy packets, atomic and idempotent delivery, admin gate');
