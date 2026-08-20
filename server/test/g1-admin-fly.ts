/**
 * G1 smoke test — admin command registry + server-authoritative fly mode.
 *
 * The admin concept: clients send a command line via PacketType.AdminCommand,
 * the server AdminCommandRegistry dispatches it (permission gate:
 * canUseAdminCommands → peer.isAdmin, granted to everyone while the server
 * config runs players.everyone-admin: true). First command: "fly" — toggles
 * peer.flying, which switches handlePlayerInput from gravity physics to free
 * flight so zone generation / ZDO streaming follow the flying player.
 *
 * No network: drives the production paths directly (fake Peer object, input
 * buffers built with the real server Writer, handlePlayerInput via cast —
 * same pattern as f3-leveling).
 *
 * Run: npx tsx server/test/g1-admin-fly.ts   (from the repo root)
 */

import { createWovServer } from '../src/WovServer.js';
import { AdminCommandRegistry, canUseAdminCommands } from '../src/admin/AdminCommands.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import type { Peer } from '../src/net/Peer.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

console.log('=== G1 admin + fly smoke test ===');

// worldFeatures: false — G1 tests movement/admin logic, not worldgen
// (skips the ~75s worldwide feature placement, like d6)
const server = createWovServer({
  port: 2498,
  worldSeed: 'KxSYuZquuw',
  worldFeatures: false,
});
server.init();

// Minimal fake peer: only the fields the exercised paths touch.
// characterID = ZDOID.NONE → zdos.getZDO returns undefined (guarded).
// sendPacketWith: seit dem Ausdauer/Vitals-Sync (Nutzerbericht 2026-08-03,
// WovServer.ts sendPlayerState) ruft JEDER handlePlayerInput-Zweig alle
// 0,25s akkumulierter Zeit dieses Feld auf — ohne Stub wirft der echte
// Peer.sendPacketWith-Aufruf auf ein Objekt ohne Socket. No-op reicht, der
// Test prueft keine gesendeten Pakete.
function makePeer(isAdmin: boolean): Peer {
  return {
    name: 'TestViking',
    isAdmin,
    flying: false,
    position: { x: 0, y: 100, z: 0 },
    lastInputSeq: 0,
    lastInputTime: 0,
    characterID: ZDOID.NONE,
    stamina: 100,
    staminaZuletztVerbraucht: 0,
    staminaSyncAkku: 0,
    health: 100,
    foodBis: 0,
    foodBonus: 0,
    sendPacketWith: () => {},
    sendPacket: () => {},
  } as unknown as Peer;
}

/** Build a PlayerInput wire buffer with the new format (Writer ↔ Reader). */
function makeInput(opts: {
  seq?: number; moveX?: number; moveZ?: number;
  lookYaw?: number; lookPitch?: number; moveY?: number;
  running?: boolean; jumping?: boolean;
}): Reader {
  const w = new Writer();
  w.writeInt32(opts.seq ?? 1);
  w.writeFloat32(opts.moveX ?? 0);
  w.writeFloat32(opts.moveZ ?? 0);
  w.writeFloat32(opts.lookYaw ?? 0);
  w.writeFloat32(opts.lookPitch ?? 0);
  w.writeFloat32(opts.moveY ?? 0);
  w.writeBool(opts.running ?? false);
  w.writeBool(opts.jumping ?? false);
  return new Reader(w.toBuffer());
}

const handleInput = (peer: Peer, reader: Reader): void => {
  (
    server as unknown as { handlePlayerInput(p: Peer, r: Reader): void }
  ).handlePlayerInput(peer, reader);
};

// ── [1] AdminCommandRegistry ──────────────────────────────────────
console.log('\n[1] AdminCommandRegistry:');
const registry = new AdminCommandRegistry();

const adminPeer = makePeer(true);
check('admin peer passes the permission gate', canUseAdminCommands(adminPeer) === true);
const guestPeer = makePeer(false);
check('non-admin peer is rejected by the gate', canUseAdminCommands(guestPeer) === false);

const flyOn = registry.execute(adminPeer, 'fly');
check('"fly" toggles flying ON', flyOn.ok && flyOn.active === true && adminPeer.flying === true,
  flyOn.message);
const flyOff = registry.execute(adminPeer, 'fly');
check('"fly" again toggles flying OFF', flyOff.ok && flyOff.active === false && adminPeer.flying === false,
  flyOff.message);

const unknown = registry.execute(adminPeer, 'nuclear-launch');
check('unknown command rejected', !unknown.ok, unknown.message);
const denied = registry.execute(guestPeer, 'fly');
check('non-admin "fly" denied and flying stays off',
  !denied.ok && guestPeer.flying === false, denied.message);

// ── [2] Gravity physics (flying = false) ──────────────────────────
console.log('\n[2] Walking physics (gravity):');
const walker = makePeer(true);
walker.position = { x: 0, y: 100, z: 0 };
handleInput(walker, makeInput({}));
check('airborne walker falls (first delta 1/30 s)',
  Math.abs(walker.position.y - (100 - 15 / 30)) < 1e-9,
  `y ${walker.position.y} (expect 99.5)`);
// lastInputTime = 0 before each call → deterministic 1/30 s delta
// (two back-to-back calls would otherwise see ~0 ms wall-clock delta)
for (let i = 0; i < 2000 && walker.position.y > 36.052001953125; i++) {
  walker.lastInputTime = 0;
  handleInput(walker, makeInput({}));
}
check('walker lands on the ground (D1 golden height)',
  walker.position.y === 36.052001953125, `y ${walker.position.y}`);

// ── [3] Fly physics (flying = true) ───────────────────────────────
console.log('\n[3] Fly physics (no gravity):');
const flyer = makePeer(true);
registry.execute(flyer, 'fly'); // flying = true

flyer.position = { x: 0, y: 100, z: 0 };
handleInput(flyer, makeInput({ moveY: 0 }));
check('hover: y unchanged with moveY=0 (no gravity)', flyer.position.y === 100,
  `y ${flyer.position.y}`);

flyer.lastInputTime = 0; // deterministic 1/30 s delta
handleInput(flyer, makeInput({ moveY: 1, running: true, seq: 2 }));
check('fly up fast: +30 m/s · delta', Math.abs(flyer.position.y - 101) < 1e-9,
  `y ${flyer.position.y} (expect 101)`);

const beforeDown = flyer.position.y;
flyer.lastInputTime = 0;
handleInput(flyer, makeInput({ moveY: -1, seq: 3 }));
check('fly down: −12 m/s · delta', Math.abs(flyer.position.y - (beforeDown - 0.4)) < 1e-9,
  `y ${flyer.position.y} (was ${beforeDown})`);

// Descend past the terrain: fly mode must NOT clamp to the ground
flyer.lastInputTime = 0; // deterministic 1/30 delta
flyer.position.y = 38; // ~2 m above ground(0,0) = 36.052
for (let i = 0; i < 10; i++) {
  flyer.lastInputTime = 0;
  handleInput(flyer, makeInput({ moveY: -1, seq: 10 + i }));
}
check('flyer can descend below terrain height (no ground clamp)',
  flyer.position.y < 36.052001953125, `y ${flyer.position.y}`);

// Horizontal flight speed (running): 30 m/s instead of 7.5 m/s walk/run
flyer.lastInputTime = 0;
flyer.position = { x: 0, y: 100, z: 0 };
handleInput(flyer, makeInput({ moveX: 0, moveZ: 1, running: true, seq: 99 }));
check('fly horizontal at 30 m/s (delta 1/30)',
  Math.abs(flyer.position.z - 1) < 1e-9, `z ${flyer.position.z} (expect 1)`);

// Safety clamp: endless ascent stops at y = 2000
flyer.position.y = 1999;
flyer.lastInputTime = 0;
handleInput(flyer, makeInput({ moveY: 1, running: true, seq: 100 }));
check('ascent safety clamp at 2000', flyer.position.y <= 2000, `y ${flyer.position.y}`);

// Fly OFF → gravity applies again
registry.execute(flyer, 'fly');
flyer.position.y = 100;
flyer.lastInputTime = 0;
handleInput(flyer, makeInput({ seq: 101 }));
check('fly OFF → gravity resumes', Math.abs(flyer.position.y - 99.5) < 1e-9,
  `y ${flyer.position.y}`);

if (failures > 0) {
  console.error(`\n=== G1: ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== G1: ALL PASSED ===');
process.exit(0);
