/**
 * Gehört `PlayerState.seq` zu der Position, die im selben Paket steht?
 *
 * Diese Frage ist der ganze Unterschied zwischen einem Abgleich, der die
 * Figur zurückzieht, und einem, der es nicht tut. Der Client schlägt zu
 * jeder bestätigten Sequenznummer nach, wo er selbst stand, als er sie
 * abschickte (client/src/net/Positionsverlauf.ts), und rechnet die Drift
 * gegen genau diesen Punkt. Meldete der Server `seq` aus dem AKTUELLEN
 * Takt zusammen mit `position` aus dem VORIGEN — so stand es bis heute,
 * weil `sendPlayerState` VOR der Positionsberechnung lief —, dann misst
 * der Client verlässlich einen Bewegungsschritt Versatz, den es nicht
 * gibt, und zieht bei jedem Paket nach.
 *
 * Ein grüner Client-Test kann das nicht beweisen: Er sieht nur, was der
 * Client aus dem Paket macht, nicht, was der Server hineinschreibt.
 * Deshalb hier, am echten `handlePlayerInput`, mit einem Fake-Peer und
 * dem echten Writer/Reader-Paar (Muster aus g1-admin-fly.ts).
 *
 * Lauf: npx tsx server/test/abgleich-seq-position.ts   (aus dem Repo-Wurzel)
 */

import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import { PacketType } from '../../shared/src/types.js';
import type { Peer } from '../src/net/Peer.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

console.log('=== PlayerState: seq gehoert zur gemeldeten Position ===');

// worldFeatures: false wie in g1 — geprüft wird Bewegung/Protokoll, nicht
// die Weltgenerierung.
const server = createWovServer({ port: 2499, worldSeed: 'KxSYuZquuw', worldFeatures: false });
server.init();

/** Ein mitgeschriebenes PlayerState-Paket, schon aufgeschlüsselt. */
interface Gemeldet {
  health: number;
  stamina: number;
  x: number;
  y: number;
  z: number;
  seq: number;
}

const gesendet: Gemeldet[] = [];

function makePeer(): Peer {
  return {
    name: 'SeqViking',
    isAdmin: true,
    flying: false,
    worldId: HAUPTWELT_ID,
    position: { x: 0, y: 36.052001953125, z: 0 },
    lastInputSeq: 0,
    lastInputTime: 0,
    characterID: ZDOID.NONE,
    stamina: 100,
    staminaZuletztVerbraucht: 0,
    staminaSyncAkku: 0,
    health: 100,
    foodBis: 0,
    foodBonus: 0,
    // Der Mitschnitt: dasselbe Drahtformat, das der Client liest.
    sendPacketWith: (typ: PacketType, schreib: (w: Writer) => void) => {
      if (typ !== PacketType.PlayerState) return;
      const w = new Writer();
      schreib(w);
      const r = new Reader(w.toBuffer());
      const health = r.readFloat32();
      const stamina = r.readFloat32();
      const p = r.readVector3();
      gesendet.push({ health, stamina, x: p.x, y: p.y, z: p.z, seq: r.readInt32() });
    },
    sendPacket: () => {},
  } as unknown as Peer;
}

function eingabe(opts: { seq: number; moveX?: number; moveZ?: number; running?: boolean }): Reader {
  const w = new Writer();
  w.writeInt32(opts.seq);
  w.writeFloat32(opts.moveX ?? 0);
  w.writeFloat32(opts.moveZ ?? 0);
  w.writeFloat32(0); // lookYaw
  w.writeFloat32(0); // lookPitch
  w.writeFloat32(0); // moveY
  w.writeBool(opts.running ?? false);
  w.writeBool(false); // jumping
  return new Reader(w.toBuffer());
}

const handleInput = (peer: Peer, reader: Reader): void => {
  (server as unknown as { handlePlayerInput(p: Peer, r: Reader): void }).handlePlayerInput(
    peer,
    reader
  );
};

// ── [1] seq 7 bewegt um Δ — das Paket traegt seq 7 UND die neue Stelle ──
console.log('\n[1] Eingabe seq 7:');
{
  const peer = makePeer();
  // Erst auf den Boden fallen lassen, damit der Schritt danach waagerecht
  // ist und die Zahlen nicht von der Schwerkraft verwaschen werden.
  for (let i = 0; i < 200 && peer.position.y > 36.06; i += 1) {
    peer.lastInputTime = 0;
    handleInput(peer, eingabe({ seq: i + 1 }));
  }
  gesendet.length = 0;
  peer.staminaSyncAkku = 0;

  const vorher = { ...peer.position };
  // lastInputTime = 0 → deterministische 1/30 s, und 1/30 s < 0,1 s:
  // ein einzelner Schritt sendet noch NICHT.
  peer.lastInputTime = 0;
  handleInput(peer, eingabe({ seq: 7, moveZ: 1 }));
  pruefe('unter 0,1 s akkumulierter Zeit wird nicht gesendet', gesendet.length === 0,
    `${gesendet.length} Pakete`);
  const nachEinem = { ...peer.position };
  pruefe('die Eingabe hat wirklich bewegt', Math.abs(nachEinem.z - vorher.z) > 0.1,
    `z ${vorher.z} → ${nachEinem.z}`);

  // Weiter, bis der 0,1-s-Takt greift (1/30 s je Schritt → beim dritten).
  let letzteVor: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i < 10 && gesendet.length === 0; i += 1) {
    letzteVor = { ...peer.position };
    peer.lastInputTime = 0;
    handleInput(peer, eingabe({ seq: 7, moveZ: 1 }));
  }
  pruefe('nach 0,1 s akkumulierter Zeit wird gesendet', gesendet.length === 1,
    `${gesendet.length} Pakete`);

  const paket = gesendet[0]!;
  pruefe('das Paket traegt seq 7', paket.seq === 7, `seq ${paket.seq}`);
  // Math.fround: das Drahtformat ist float32, peer.position ist float64 —
  // ein nackter Gleichheitsvergleich scheiterte an der letzten Stelle von
  // y (36.052001953125 → 36.052001953125 ist bitgleich, x/y aus der
  // Gelaendeklemmung nicht zwingend).
  const gleich = (a: number, b: number): boolean => Math.fround(a) === Math.fround(b);
  pruefe('das Paket traegt die NEUE Position (die zu seq 7 gehoert)',
    gleich(paket.x, peer.position.x) && gleich(paket.y, peer.position.y) &&
      gleich(paket.z, peer.position.z),
    `Paket ${paket.x.toFixed(4)}/${paket.y.toFixed(4)}/${paket.z.toFixed(4)}, ` +
      `Peer ${peer.position.x.toFixed(4)}/${peer.position.y.toFixed(4)}/${peer.position.z.toFixed(4)}`);
  pruefe('und NICHT die Stelle des vorigen Takts (der alte Fehler)',
    letzteVor !== null && paket.z !== letzteVor.z,
    `voriger Takt z ${letzteVor?.z.toFixed(4)}`);
}

// ── [2] Der Takt: 10 Hz, nicht 4 Hz ───────────────────────────────
console.log('\n[2] Sendetakt:');
{
  const peer = makePeer();
  for (let i = 0; i < 200 && peer.position.y > 36.06; i += 1) {
    peer.lastInputTime = 0;
    handleInput(peer, eingabe({ seq: i + 1 }));
  }
  gesendet.length = 0;
  peer.staminaSyncAkku = 0;
  // 30 Eingaben à 1/30 s = 1,0 s Spielzeit.
  for (let i = 0; i < 30; i += 1) {
    peer.lastInputTime = 0;
    handleInput(peer, eingabe({ seq: 1000 + i, moveZ: 1 }));
  }
  pruefe('rund zehn Pakete je Sekunde', gesendet.length === 10, `${gesendet.length} in 1,0 s`);
  // Jedes Paket muss die seq der Eingabe tragen, die es ausgeloest hat.
  const seqs = gesendet.map((g) => g.seq);
  const luecken = seqs.filter((s, i) => s !== 1000 + (i + 1) * 3 - 1);
  pruefe('jedes Paket traegt die seq seines eigenen Takts', luecken.length === 0,
    `seqs ${seqs.join(', ')}`);
  // Und die Positionen müssen streng wachsen — kein Paket wiederholt die
  // Stelle des vorigen.
  let waechst = true;
  for (let i = 1; i < gesendet.length; i += 1) {
    if (!(gesendet[i]!.z > gesendet[i - 1]!.z)) waechst = false;
  }
  pruefe('die gemeldeten Stellen wachsen von Paket zu Paket', waechst);
}

// ── [3] Andere Aufrufer bleiben ausser der Reihe ──────────────────
console.log('\n[3] Aufrufer ausserhalb des Eingabepfads:');
{
  const peer = makePeer();
  gesendet.length = 0;
  // Ein Aufruf, wie ihn Schaden/Respawn machen: sofort, ohne Akku.
  (server as unknown as { sendPlayerState(p: Peer): void }).sendPlayerState(peer);
  pruefe('meldet sofort', gesendet.length === 1);
  pruefe('mit der aktuellen Stelle und der zuletzt verarbeiteten seq',
    gesendet[0]!.z === peer.position.z && gesendet[0]!.seq === peer.lastInputSeq,
    `seq ${gesendet[0]!.seq}`);
}

if (fehler > 0) {
  console.error(`\n=== Abgleich/seq: ${fehler} PRUEFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== Abgleich/seq: ALLE GRUEN ===');
process.exit(0);
