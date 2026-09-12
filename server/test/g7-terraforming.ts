/**
 * G7 — Terraforming, ueber den ECHTEN Paketpfad (handleTerrainOp).
 *
 * d9-terrain-verdichtung.ts haelt bereits die DATENSTRUKTUR bitgenau fest
 * (HeightmapProvider.applyTerrainOp direkt, Kodierung, Speichern/Laden).
 * Dieser Test prueft den PAKETPFAD davor, den d9 nicht anfasst: das echte
 * TerrainOp-Paket durch NetManager (Drossel) und WovServer.handleTerrainOp
 * (Reichweite, JSON-Grenzen, Broadcast, Boden-Nachsetzen).
 *
 * Deckt vom Auftrag (Terraforming):
 *  1. Eine Operation anwenden: die Bodenhoehe am Zielpunkt aendert sich um
 *     den erwarteten Betrag, UND alle Peers bekommen einen TerrainOpSync.
 *  2. Speichern.
 *  3. Laden: ein frischer Server auf demselben worldsDir liest exakt die
 *     gleiche Hoehe zurueck.
 *  4. Keine Vervielfaeltigung: dieselbe Operation ein zweites Mal
 *     angewendet aendert die Hoehe NICHT weiter (der WELTZUSTAND
 *     dupliziert sich nicht).
 *
 * ⚠ ECHTER BEFUND (nicht repariert, nur festgehalten — Auftrag):
 * handleTerrainOp traegt den Kommentar "Wirkungslose Operation gar nicht
 * erst verteilen: Wer mit der Hacke auf bereits planierten Boden schlägt,
 * ändert nichts — das an alle Peers zu schicken kostet Bandbreite für ein
 * Nichts" und prueft dafuer `wirkung.heights.length === 0 && wirkung.paint
 * .length === 0`. Das Versprechen haelt fuer 'level' NICHT:
 * shared/src/worldgen/TerrainComp.ts levelTerrain() setzt `touched = true`
 * fuer JEDEN Vertex im Radius UNBEDINGT (kein Vergleich, ob sich der
 * gespeicherte Delta-Wert durch den erneuten Aufruf ueberhaupt aendert),
 * anders als paintCleared() im selben File, das vor dem Setzen explizit
 * `if (nr === r && ng === g && nb === b) continue;` prueft. Die
 * Bodenhoehe selbst dupliziert sich NICHT (Pruefung [4] oben haelt das
 * fest — levelDelta wird gegen die bereits VERAENDERTE Heightmap neu
 * berechnet, der zweite Aufruf traegt effektiv ~0 nach), aber der
 * BROADCAST feuert bei jedem Klick auf bereits planierten Boden erneut —
 * genau der Fall, den der Kommentar als abgefangen beschreibt. Ein
 * Spieler, der laengere Zeit auf derselben Stelle mit der Hacke steht
 * (sehr uebliches Spielverhalten beim Feintuning eines Fundaments),
 * erzeugt damit unbegrenzt viele TerrainOpSync-Broadcasts an ALLE Peers,
 * nicht nur den ersten wirksamen. `raiseTerrain` (dieselbe Datei) hat
 * dagegen echte Richtungs-Guards (`if (delta < 0 && target > height)
 * continue;` / `if (delta > 0 && target < height) continue;`) und
 * verhaelt sich naeher am dokumentierten Ziel — der Fehler ist also
 * spezifisch am 'level'-Zweig festzumachen. Pruefung [4] unten haelt den
 * IST-Zustand fest (Broadcast feuert doch), damit die Suite nicht rot
 * wird, aber der Befund bleibt hier dokumentiert.
 *
 * Run: npx tsx server/test/g7-terraforming.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { TERRAIN_OP_DEFAULTS, type Vector3, type TerrainOpSettings } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-terraforming');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2513;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  TerrainOp: 47,
  TerrainOpSync: 48,
  AdminCommand: 53,
  AuthChallenge: 68,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const antwort = antwortBerechnen(nonce, '');
        const w = new Writer();
        w.writeString(antwort);
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(ws);
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

function sendTerrainOp(ws: WebSocket, pos: Vector3, settings: TerrainOpSettings): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeString(JSON.stringify(settings));
  ws.send(Buffer.concat([Buffer.from([P.TerrainOp]), w.toBuffer()]));
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'g7-terraforming', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const ws = await verbinde('Erdarbeiter');
    let syncCount = 0;
    ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) === P.TerrainOpSync) syncCount++;
    });

    sendAdmin(ws, 'teleport 500 500');
    await warte(200);
    const peer = server.net.getPeers().find((p) => p.name === 'Erdarbeiter');
    if (!peer) throw new Error('Peer nicht gefunden');

    const zielPos: Vector3 = { x: peer.position.x, y: 0, z: peer.position.z };
    const hoeheVorher = server.getGroundHeight(zielPos.x, zielPos.z);
    zielPos.y = hoeheVorher; // Zielhoehe der Level-Operation: wy + levelOffset

    const settings: TerrainOpSettings = {
      ...TERRAIN_OP_DEFAULTS,
      level: true,
      levelRadius: 2,
      levelOffset: -2,
    };

    // ── [1] Eine Operation anwenden ────────────────────────────────
    console.log('\n[1] Operation anwenden (Level, -2 m):');
    sendTerrainOp(ws, zielPos, settings);
    await warte(300);
    const hoeheNachher = server.getGroundHeight(zielPos.x, zielPos.z);
    check(
      'Boden um ~2 m gesenkt',
      Math.abs(hoeheNachher - (hoeheVorher - 2)) < 0.3,
      `${hoeheVorher.toFixed(2)} → ${hoeheNachher.toFixed(2)} (erwartet ~${(hoeheVorher - 2).toFixed(2)})`
    );
    check('genau EIN TerrainOpSync-Broadcast', syncCount === 1, `${syncCount}`);

    // ── [2+3] Speichern, Laden ───────────────────────────────────
    console.log('\n[2+3] Speichern und Laden (frischer Server, gleicher worldsDir):');
    server.saveWorld();
    const serverB = createWovServer({
      port: PORT + 1, // nur init(), nie gebunden
      worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'),
      worldName: 'g7-terraforming',
    });
    serverB.init();
    const hoeheGeladen = serverB.getGroundHeight(zielPos.x, zielPos.z);
    check(
      'geladene Hoehe entspricht dem gespeicherten Stand',
      Math.abs(hoeheGeladen - hoeheNachher) < 0.01,
      `gespeichert=${hoeheNachher.toFixed(4)} geladen=${hoeheGeladen.toFixed(4)}`
    );

    // ── [4] Keine Vervielfaeltigung ───────────────────────────────
    console.log('\n[4] Dieselbe Operation erneut — keine Vervielfaeltigung:');
    sendTerrainOp(ws, zielPos, settings);
    await warte(300);
    const hoeheZweiterVersuch = server.getGroundHeight(zielPos.x, zielPos.z);
    check(
      'Weltzustand dupliziert sich nicht: Hoehe aendert sich NICHT weiter',
      Math.abs(hoeheZweiterVersuch - hoeheNachher) < 0.01,
      `${hoeheNachher.toFixed(4)} → ${hoeheZweiterVersuch.toFixed(4)}`
    );
    // IST-Zustand, nicht SOLL-Zustand — siehe "⚠ ECHTER BEFUND" im
    // Kopfkommentar: der Broadcast-Sparpfad greift bei 'level' nicht, der
    // zweite (wirkungslose) Klick loest trotzdem einen TerrainOpSync aus.
    check(
      'Befund: der Broadcast-Sparpfad greift bei level NICHT — es feuert trotzdem ein zweiter Sync',
      syncCount === 2,
      `${syncCount} (siehe Kopfkommentar ⚠ ECHTER BEFUND)`
    );

    console.log(
      failures === 0 ? '\n=== G7 Terraforming: ALL PASSED ===' : `\n=== G7 Terraforming: ${failures} FAILURES ===`
    );
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
