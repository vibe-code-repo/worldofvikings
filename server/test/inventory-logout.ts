/** Exercise the real disconnect handler and subsequent saved-state lookup. */
import assert from 'node:assert/strict';
import { WovServer } from '../src/WovServer.js';
import { Inventory, IRONWARD_PARTS, findItem } from '@wov/shared';

const server = Object.create(WovServer.prototype) as any;
server.savedPlayers = new Map();
const inventory = new Inventory();
inventory.addItem(findItem('Hammer')!, 1);
for (const part of IRONWARD_PARTS) inventory.addItem(findItem(part.item)!, 1);
inventory.all[1]!.equipped = true;
const before = inventory.serialize();
const peer = { name: 'LogoutTest', spielerId: 'logout-test', inventar: inventory,
  position: { x: 12, y: 4, z: -18 }, figur: 'wikinger', ruestung: '|',
  characterID: { isNone: () => true }, flying: false };
server.onPeerQuit(peer);
const saved = server.ermittleGespeichertenStand(peer);
assert.deepEqual(saved.inventar, before, 'Disconnect must preserve all items and equipped flags');
const loaded = new Inventory(); loaded.load(saved.inventar);
assert.deepEqual(loaded.serialize(), before, 'Relog must restore the exact inventory');
inventory.removeByName('IronwardHelmet', 1);
assert.deepEqual(saved.inventar, before, 'The saved snapshot must not alias the live inventory');
server.onPeerQuit({ ...peer, nurEditor: true, inventar: new Inventory() });
assert.deepEqual(server.ermittleGespeichertenStand(peer).inventar, before, 'Editor logout must not overwrite the character');
console.log('PASS inventory disconnect, relog, snapshot isolation and editor guard');
