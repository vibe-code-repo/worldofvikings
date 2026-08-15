/**
 * D6 — Drahtformat des ZDO-Syncs: Kodierung → Dekodierung.
 *
 * Der Sync schickt seit D6 zwei Satzarten (VOLLSTAND und DELTA). Das ist die
 * Sorte Änderung, bei der ein Vorzeichenfehler im Flagbyte erst auffällt,
 * wenn im Spiel Bäume an falscher Stelle stehen — deshalb hier der direkte
 * Nachweis: Der Server schreibt mit `writeZDO`, der ECHTE Client-Parser
 * (client/src/net/ZDOSync) liest, und das Ergebnis wird gegen den
 * Ausgangszustand gehalten.
 *
 * Geprüft wird:
 *  1. Erstübertragung ist vollständig und kommt unverändert an.
 *  2. Reine Bewegung erzeugt ein Delta OHNE Member — und der Client behält
 *     trotzdem Skalierung, Animation, Leben und Layout-Herkunft.
 *  3. Ein geänderter Member kommt allein (nicht der ganze Satz) durch.
 *  4. Nach einer Member-Entfernung fällt der Satz auf Vollstand zurück und
 *     der entfernte Member ist beim Client wirklich weg.
 *  5. Ein Delta ohne vorherigen Vollstand wird verworfen statt halbgar
 *     angewandt — und der Paketrest bleibt lesbar.
 *  6. Der Besitzer (eigener Spieler) überlebt Vollstand wie Delta.
 *  7. Das Delta ist deutlich kleiner als der Vollstand (Zahlen im Log).
 *
 * Lauf: npx tsx test/d6-zdo-delta.ts   (aus server/)
 */

import { ANIM_MEMBER, HEALTH_MEMBER, LAYOUT_ID_MEMBER, getStableHash } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { ZDO } from '../src/zdo/ZDO.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import { Writer } from '../src/io/Writer.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';
import type { ZDOEntityUpdate } from '../../client/src/net/ZDOSync';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

// createWovServer ohne init(): Der Konstruktor verdrahtet nur Subsysteme,
// writeZDO hängt an keinem Weltzustand.
const server = createWovServer({ port: 2499, worldsDir: '/tmp/wov-d6-test-unused' });
const schreibe = (server as unknown as {
  writeZDO(w: Writer, zdo: ZDO, peerRev: number | undefined): void;
}).writeZDO.bind(server);

/**
 * Ein Sync-Paket bauen — exakt der Rahmen aus syncZDOs: tick, Satzanzahl,
 * Sätze, Zerstörungsanzahl, Zerstörungen.
 */
function paket(
  saetze: Array<{ zdo: ZDO; peerRev: number | undefined }>,
  zerstoert: ZDOID[] = []
): { puffer: Buffer; satzBytes: number } {
  const w = new Writer(1024);
  w.writeInt32(4711);
  w.writeInt32(saetze.length);
  const vorher = w.geschrieben;
  for (const s of saetze) schreibe(w, s.zdo, s.peerRev);
  const satzBytes = w.geschrieben - vorher;
  w.writeInt32(zerstoert.length);
  for (const id of zerstoert) {
    w.writeString(id.userId.toString());
    w.writeInt32(id.id);
  }
  return { puffer: w.toBuffer(), satzBytes };
}

function lies(puffer: Buffer, spiegel: ZDOSpiegel, ownUserId = '') {
  // Buffer → eigenständiger ArrayBuffer: Buffer sitzt im gemeinsamen Pool,
  // sein .buffer enthält fremde Bytes.
  const ab = puffer.buffer.slice(puffer.byteOffset, puffer.byteOffset + puffer.byteLength);
  return parseZDOSync(new BinaryReader(ab as ArrayBuffer), ownUserId, spiegel);
}

const nahe = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

console.log('=== D6 ZDO-Drahtformat: Round-Trip ===');

// ── [1] Erstübertragung: Vollstand ─────────────────────────────────
console.log('\n[1] Erstübertragung (Vollstand):');
const kreatur = new ZDO(
  new ZDOID(1n, 42),
  getStableHash('Boar'),
  { x: 100.5, y: 12.25, z: -300.75 },
  { x: 0, y: 0.7071068, z: 0, w: 0.7071068 }
);
kreatur.setFloat('scaleScalar', 1.5);
kreatur.setString(ANIM_MEMBER, 'idle');
kreatur.setInt(HEALTH_MEMBER, 40);
kreatur.setString(LAYOUT_ID_MEMBER, 'npc_dorf_3');

const spiegel = new ZDOSpiegel();
const p1 = paket([{ zdo: kreatur, peerRev: undefined }]);
const r1 = lies(p1.puffer, spiegel);
const u1 = r1.updates[0] as ZDOEntityUpdate | undefined;

check('ein Satz gelesen', r1.updates.length === 1);
check('Schlüssel', u1?.key === '1:42', u1?.key);
check('prefabHash', u1?.prefabHash === getStableHash('Boar'));
check(
  'Position',
  !!u1 && nahe(u1.position.x, 100.5) && nahe(u1.position.y, 12.25) && nahe(u1.position.z, -300.75)
);
check('Drehung', !!u1 && nahe(u1.rotation.w, 0.7071068));
check('scale', u1?.scale === 1.5, String(u1?.scale));
check('anim', u1?.anim === 'idle');
check('health', u1?.health === 40);
check('layoutId', u1?.layoutId === 'npc_dorf_3');
check('kein Fremdbesitz', u1?.isOwnPlayer === false);
const vollBytes = p1.satzBytes;

// ── [2] Reine Bewegung → Delta ohne Member ─────────────────────────
console.log('\n[2] Bewegung ohne Member-Änderung (Delta):');
const revNach1 = kreatur.revision.dataRevision;
kreatur.position = { x: 102, y: 12.5, z: -299 };
kreatur.revision.reviseData(); // wie SpawnSystem/RoutenLaeufer es tun

const p2 = paket([{ zdo: kreatur, peerRev: revNach1 }]);
const r2 = lies(p2.puffer, spiegel);
const u2 = r2.updates[0] as ZDOEntityUpdate | undefined;
const deltaBytes = p2.satzBytes;

check('Satz kam an', r2.updates.length === 1);
check('neue Position', !!u2 && nahe(u2.position.x, 102) && nahe(u2.position.z, -299));
check('scale erhalten', u2?.scale === 1.5, String(u2?.scale));
check('anim erhalten', u2?.anim === 'idle', u2?.anim);
check('health erhalten', u2?.health === 40, String(u2?.health));
check('layoutId erhalten', u2?.layoutId === 'npc_dorf_3', u2?.layoutId);
check(
  'Delta ist kleiner als der Vollstand',
  deltaBytes < vollBytes,
  `${deltaBytes} B statt ${vollBytes} B (−${(100 - (deltaBytes / vollBytes) * 100).toFixed(0)} %)`
);

// ── [3] EIN geänderter Member kommt allein ─────────────────────────
console.log('\n[3] Ein geänderter Member:');
const revNach2 = kreatur.revision.dataRevision;
kreatur.setString(ANIM_MEMBER, 'walk');
const p3 = paket([{ zdo: kreatur, peerRev: revNach2 }]);
const r3 = lies(p3.puffer, spiegel);
const u3 = r3.updates[0] as ZDOEntityUpdate | undefined;

check('anim aktualisiert', u3?.anim === 'walk', u3?.anim);
check('health unverändert', u3?.health === 40);
check('scale unverändert', u3?.scale === 1.5);
check(
  'nur ein Member auf dem Draht',
  p3.satzBytes < deltaBytes + 20,
  `${p3.satzBytes} B (Bewegung allein: ${deltaBytes} B)`
);

// ── [4] Member-Entfernung erzwingt Vollstand ───────────────────────
console.log('\n[4] Member entfernt → Vollstand:');
const revNach3 = kreatur.revision.dataRevision;
check('layoutId ist noch da', spiegel.hole('1:42')?.layoutId === 'npc_dorf_3');
kreatur.removeMember(getStableHash(LAYOUT_ID_MEMBER));
const p4 = paket([{ zdo: kreatur, peerRev: revNach3 }]);
const r4 = lies(p4.puffer, spiegel);
const u4 = r4.updates[0] as ZDOEntityUpdate | undefined;

check('layoutId beim Client weg', u4?.layoutId === undefined, String(u4?.layoutId));
check('anim trotzdem da (Vollstand)', u4?.anim === 'walk', u4?.anim);
check('health trotzdem da (Vollstand)', u4?.health === 40);
check(
  'Satz ist wieder ein Vollstand',
  p4.satzBytes > deltaBytes,
  `${p4.satzBytes} B statt ${deltaBytes} B`
);

// ── [5] Delta ohne Vollstand wird verworfen ────────────────────────
console.log('\n[5] Delta ohne Vollstand (Schutz gegen Inkonsistenz):');
const waise = new ZDO(new ZDOID(1n, 99), getStableHash('Beech1'), { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
waise.setFloat('scaleScalar', 2);
const gesund = new ZDO(new ZDOID(1n, 100), getStableHash('Beech1'), { x: 7, y: 8, z: 9 }, { x: 0, y: 0, z: 0, w: 1 });

const leererSpiegel = new ZDOSpiegel();
const p5 = paket([
  { zdo: waise, peerRev: waise.revision.dataRevision }, // Delta ins Leere
  { zdo: gesund, peerRev: undefined }, // Vollstand dahinter
]);
const r5 = lies(p5.puffer, leererSpiegel);
check('Waisen-Delta verworfen', r5.updates.length === 1, `${r5.updates.length} Sätze`);
check('nachfolgender Satz intakt', r5.updates[0]?.key === '1:100', r5.updates[0]?.key);
check(
  'Position des Folgesatzes intakt',
  !!r5.updates[0] && nahe(r5.updates[0].position.x, 7) && nahe(r5.updates[0].position.z, 9)
);

// ── [6] Besitzer über Vollstand und Delta ──────────────────────────
console.log('\n[6] Besitzer (eigener Spieler):');
const held = new ZDO(new ZDOID(1n, 7), getStableHash('Player'), { x: 0, y: 30, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
held.setOwner(new ZDOID(555n, 0));
const spiegel6 = new ZDOSpiegel();
const r6a = lies(paket([{ zdo: held, peerRev: undefined }]).puffer, spiegel6, '555');
check('Vollstand: eigener Spieler erkannt', r6a.updates[0]?.isOwnPlayer === true);
const rev6 = held.revision.dataRevision;
held.position = { x: 1, y: 30, z: 1 };
held.revision.reviseData();
const r6b = lies(paket([{ zdo: held, peerRev: rev6 }]).puffer, spiegel6, '555');
check('Delta: eigener Spieler weiterhin erkannt', r6b.updates[0]?.isOwnPlayer === true);
const r6c = lies(paket([{ zdo: held, peerRev: undefined }]).puffer, new ZDOSpiegel(), '999');
check('fremder Spieler ist nicht der eigene', r6c.updates[0]?.isOwnPlayer === false);

// ── [7] Zerstörung räumt den Spiegel ───────────────────────────────
console.log('\n[7] Zerstörung räumt den Spiegel:');
const vorDemLoeschen = spiegel.anzahl;
const r7 = lies(paket([], [kreatur.zdoid]).puffer, spiegel);
check('Zerstörung gemeldet', r7.destroyed[0] === '1:42', r7.destroyed[0]);
check('Spiegel geleert', spiegel.anzahl === vorDemLoeschen - 1, `${spiegel.anzahl} Einträge`);

console.log(
  `\nBytes je Satz: Vollstand ${vollBytes}, Delta (nur Bewegung) ${deltaBytes}, ` +
    `Delta mit einem Member ${p3.satzBytes}`
);
console.log(failures === 0 ? '\nAlle D6-Prüfungen grün' : `\n${failures} D6-Prüfung(en) fehlgeschlagen`);
process.exit(failures > 0 ? 1 : 0);
