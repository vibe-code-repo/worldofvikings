/**
 * G7 — Craften und Essen, ueber den ECHTEN Paketpfad (handleCraft/
 * handleEat).
 *
 * Deckt vom Auftrag (Craften und Essen):
 *  1. Rezeptpruefung: ein bekanntes Rezept (Hammer: 3 Wood + 2 Stone)
 *     verbraucht die Zutaten und liefert das Ergebnis.
 *  2. Zutatenverbrauch bei fehlenden Zutaten: FEHLT auch nur EINE Zutat,
 *     wird GAR NICHTS abgezogen — auch nicht die Zutaten, die reichlich da
 *     waeren (Pruefung laeuft komplett VOR jedem Abzug).
 *  3. Unbekanntes Rezept wird abgelehnt, ohne das Inventar anzufassen.
 *  4. Essen: Buff (foodBonus/foodBis) und +10 HP (bis zur — durch den Buff
 *     bereits erhoehten — Obergrenze), Item verbraucht.
 *  5. Essen ohne das Item im Server-Inventar: VOLLSTAENDIG wirkungslos
 *     (kein Buff, keine HP, keine Antwort) — das Inventar lebt
 *     serverseitig (Review-Punkt 8), ein Client kann sich nichts erschummeln.
 *
 * Neulinge bekommen serverseitig Hammer/AxeFlint/Hoe/PickaxeAntler/
 * Cultivator + 12 Wood + 30 Stone (WovServer.ts, START) — der Test liest
 * deshalb IMMER die Bestandszahl per countOf() gegen den vorherigen Stand.
 *
 * Run: npx tsx server/test/g7-craft-essen.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { findItem } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-craft-essen');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2512;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  InteractResult: 45,
  Craft: 66,
  Eat: 57,
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

function sendCraft(ws: WebSocket, ergebnis: string): void {
  const w = new Writer();
  w.writeString(ergebnis);
  ws.send(Buffer.concat([Buffer.from([P.Craft]), w.toBuffer()]));
}

function sendEat(ws: WebSocket, item: string): void {
  const w = new Writer();
  w.writeString(item);
  ws.send(Buffer.concat([Buffer.from([P.Eat]), w.toBuffer()]));
}

interface InteractResultMsg {
  ok: boolean;
  message: string;
  itemName: string;
  amount: number;
  /** peer.health im Moment des Nachrichteneingangs (s. Kommentar am push()). */
  health: number;
}

async function main(): Promise<void> {
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g7-craft-essen', saveIntervalMs: 3600_000 });
  server.start();

  try {
    const ws = await verbinde('Handwerker');
    const peer = server.net.getPeers().find((p) => p.name === 'Handwerker');
    if (!peer) throw new Error('Peer nicht gefunden');
    const log: InteractResultMsg[] = [];
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      if (type !== P.InteractResult) return;
      const reader = new Reader(Buffer.from(data.subarray(1)));
      // health HIER erfassen, nicht erst beim spaeteren check() neu lesen:
      // WovServer.ts hat einen 1-Hz-Essens-Regenerationstick (+2 HP/s bei
      // aktivem Buff), der sonst zufaellig in das anschliessende warte(300)
      // -Fenster faellt und die exakte "+10 HP"-Pruefung in [4] flaky macht
      // (reproduziert: ~1 von 3 Laeufen, siehe Schlusskontrolle Paket 4).
      // Ein Snapshot direkt bei Nachrichteneingang zieht das Zeitfenster auf
      // Netzwerk-Millisekunden statt 300ms zusammen.
      log.push({
        ok: reader.readBool(),
        message: reader.readString(),
        itemName: reader.readString(),
        amount: reader.readInt32(),
        health: peer.health,
      });
    });

    // ── [1] Rezeptpruefung + Zutatenverbrauch ─────────────────────
    console.log('\n[1] Bekanntes Rezept (Hammer: 3 Wood + 2 Stone):');
    const woodVor1 = peer.inventar.countOf('Wood');
    const stoneVor1 = peer.inventar.countOf('Stone');
    const hammerVor1 = peer.inventar.countOf('Hammer');
    log.length = 0;
    sendCraft(ws, 'Hammer');
    await warte(300);
    const antwort1 = log.at(-1);
    check('Herstellung bestaetigt', !!antwort1?.ok && antwort1.message.includes('Hammer'), JSON.stringify(antwort1));
    check('3 Wood abgezogen', peer.inventar.countOf('Wood') === woodVor1 - 3, `${woodVor1} → ${peer.inventar.countOf('Wood')}`);
    check('2 Stone abgezogen', peer.inventar.countOf('Stone') === stoneVor1 - 2, `${stoneVor1} → ${peer.inventar.countOf('Stone')}`);
    check('1 Hammer zusaetzlich im Inventar', peer.inventar.countOf('Hammer') === hammerVor1 + 1, `${hammerVor1} → ${peer.inventar.countOf('Hammer')}`);

    // ── [2] Fehlende Zutat: GAR NICHTS wird abgezogen ─────────────
    console.log('\n[2] Fehlende Zutat (AxeFlint braucht Flint, keins vorhanden):');
    check('Testannahme: kein Flint im Inventar', peer.inventar.countOf('Flint') === 0);
    const woodVor2 = peer.inventar.countOf('Wood');
    const axeVor2 = peer.inventar.countOf('AxeFlint');
    log.length = 0;
    sendCraft(ws, 'AxeFlint');
    await warte(300);
    const antwort2 = log.at(-1);
    check('Ablehnung "Zutat fehlt"', !!antwort2 && !antwort2.ok && antwort2.message.includes('Zutat fehlt'), JSON.stringify(antwort2));
    check(
      'Wood NICHT angetastet, obwohl reichlich vorhanden',
      peer.inventar.countOf('Wood') === woodVor2,
      `${woodVor2} → ${peer.inventar.countOf('Wood')}`
    );
    check('kein AxeFlint zusaetzlich', peer.inventar.countOf('AxeFlint') === axeVor2);

    // ── [3] Unbekanntes Rezept ─────────────────────────────────────
    console.log('\n[3] Unbekanntes Rezept:');
    log.length = 0;
    sendCraft(ws, 'Excalibur');
    await warte(300);
    const antwort3 = log.at(-1);
    check('Ablehnung "Unbekanntes Rezept"', !!antwort3 && !antwort3.ok && antwort3.message.includes('Unbekanntes Rezept'), JSON.stringify(antwort3));

    // ── [4] Essen ────────────────────────────────────────────────
    console.log('\n[4] Essen (CookedMeat: +30 max HP, +10 HP sofort):');
    peer.inventar.addItem(findItem('CookedMeat')!, 1);
    peer.health = 50;
    const meatVor4 = peer.inventar.countOf('CookedMeat');
    log.length = 0;
    sendEat(ws, 'CookedMeat');
    await warte(300);
    const antwort4 = log.at(-1);
    check('Essen bestaetigt', !!antwort4?.ok && antwort4.message.includes('Gegessen'), JSON.stringify(antwort4));
    check('foodBonus gesetzt', peer.foodBonus === 30, `${peer.foodBonus}`);
    check('foodBis in der Zukunft', peer.foodBis > Date.now());
    check('HP um genau 10 gestiegen (unter der neuen Obergrenze)', antwort4?.health === 60, `${antwort4?.health}`);
    check('CookedMeat verbraucht', peer.inventar.countOf('CookedMeat') === meatVor4 - 1);

    // ── [5] Essen ohne das Item ─────────────────────────────────────
    // Hinweis: derselbe 1-Hz-Regenerationstick (s. Kommentar oben bei [4])
    // koennte theoretisch auch HIER innerhalb des warte(300) mitfeuern (Buff
    // aus [4] laeuft in [5] noch), da es aber kein Antwortpaket gibt, an dem
    // sich ein Snapshot festmachen liesse — bislang nicht reproduziert, nicht
    // behoben, absichtlich offen dokumentiert statt stillschweigend belassen.
    console.log('\n[5] Essen ohne das Item im Server-Inventar — wirkungslos:');
    check('Testannahme: kein CookedMeat mehr da', peer.inventar.countOf('CookedMeat') === 0);
    const healthVor5 = peer.health;
    const bonusVor5 = peer.foodBonus;
    log.length = 0;
    sendEat(ws, 'CookedMeat');
    await warte(300);
    check('keine Antwort (stiller No-Op)', log.length === 0, JSON.stringify(log));
    check('HP unveraendert', peer.health === healthVor5, `${peer.health}`);
    check('foodBonus unveraendert', peer.foodBonus === bonusVor5);

    console.log(
      failures === 0 ? '\n=== G7 Craft/Essen: ALL PASSED ===' : `\n=== G7 Craft/Essen: ${failures} FAILURES ===`
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
