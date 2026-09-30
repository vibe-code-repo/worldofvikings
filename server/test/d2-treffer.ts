/**
 * D2 — Trefferpruefung ueber den ECHTEN Paketpfad (WebSocket -> NetManager -> handleAttack).
 * Der Server entscheidet Treffer aus Geometrie und Zeit: Trefferkugel (0;1;1) r 0,8 m um die
 * Serverposition im Kegel ±60°, Toleranz fuer bewegte Ziele (Tempo x 0,14 s, hoechstens 1,5 m),
 * Fenster 0,2 s ab der Hiebspitze, Kombo 1-2-3 mit Quittung (`AttackAck`), Abklingzeit.
 *
 * Jeder Fall druckt: Treffer ja/nein, HP vorher/nachher und, wo es eine gibt, die Quittung.
 *
 *  [1] innerhalb der Kugel und im Fenster zaehlt, ausserhalb nicht (3,3 m geradeaus: im Kegel,
 *      aber weit ausserhalb der Kugel)
 *  [2] Ziel im Ruecken trifft nicht
 *  [3] bewegtes Ziel: dieselbe Stelle trifft mit Tempo, nicht ohne; die Toleranz ist gedeckelt
 *  [4] Kombo: der dritte Schlag zaehlt nur, wenn der zweite in das Kettenfenster fiel
 *  [5] zwei Attack-Pakete innerhalb von 50 ms zaehlen einmal
 *  [6] Zeitstempel aus der Zukunft (und ein abgelaufener) wird abgelehnt, ohne Ausdauerabzug
 *  [7] eine nicht getragene Waffe im Paket zaehlt nicht (Faustschaden)
 *  [8] alter Client (Paket ohne die D2-Felder): der Schlag zaehlt, es kommt KEINE Quittung
 *  [9] Latenz Schlag -> Treffer-Anzeige bei 40 ms kuenstlicher RTT (Zeuge: Zeitstempel)
 *  [10] die reinen Regeln (pruefeSchlag, trifftKugel) an den Grenzen
 *
 * Run: npx tsx server/test/d2-treffer.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { getStableHash, HEALTH_MEMBER, FAUST_SCHADEN, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import {
  KETTE_FENSTER_S,
  SCHLAG_FENSTER_S,
  SchlagErgebnis,
  abklingzeitMs,
  neuerSchlagZustand,
  pruefeSchlag,
  SPITZE_MAX_MS,
  trefferAbstand,
  trifftKugel,
  verbucheSchlag,
  zielToleranz,
} from '../src/spiel/Treffer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d2-treffer');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerInput: 40,
  Attack: 46,
  AdminCommand: 53,
  HitEffect: 59,
  Equip: 80,
  AttackAck: 88,
  AuthChallenge: 68,
};
const ERG = ['Treffer', 'Fehl', 'Kombo', 'Abklingzeit', 'Zeit', 'Ausdauer'];

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
        const w = new Writer();
        w.writeString(antwortBerechnen(reader.readString(), ''));
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

let eingabeSeq = 0;
function sendInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(++eingabeSeq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}
async function blicke(ws: WebSocket, yaw: number, dauerMs = 400): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) {
    sendInput(ws, yaw);
    await warte(50);
  }
}

function sendEquip(ws: WebSocket, slot: string, item: string): void {
  const w = new Writer();
  w.writeString(slot);
  w.writeString(item);
  ws.send(Buffer.concat([Buffer.from([P.Equip]), w.toBuffer()]));
}

interface Quittung {
  seq: number;
  schritt: number;
  ergebnis: number;
  t: number;
}

const YAW_MINUS_Z = 0;
const YAW_MINUS_X = Math.PI / 2;
const YAW_PLUS_Z = Math.PI;
const vorn = (von: Vector3, yaw: number, abstand: number): Vector3 => ({
  x: von.x - Math.sin(yaw) * abstand,
  y: von.y,
  z: von.z - Math.cos(yaw) * abstand,
});

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'd2-treffer',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
  });
  server.start();
  PORT = portVon(server);

  try {
    const ws = await verbinde('Schlaeger');
    const acks: Quittung[] = [];
    const trefferZeiten: number[] = [];
    // Kuenstliche Leitung: die Haelfte der RTT beim Empfangen (der Server-Weg steht in `verzoegereSendung`).
    let empfangsVerzug = 0;
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const nehme = (): void => {
        if (type === P.AttackAck) {
          const r = new Reader(Buffer.from(data.subarray(1)));
          acks.push({ seq: r.readInt32(), schritt: r.readInt32(), ergebnis: r.readInt32(), t: performance.now() });
        } else if (type === P.HitEffect) {
          trefferZeiten.push(performance.now());
        }
      };
      if (empfangsVerzug > 0) setTimeout(nehme, empfangsVerzug);
      else nehme();
    });

    const peer = server.net.getPeers().find((p) => p.name === 'Schlaeger');
    if (!peer) throw new Error('Peer nicht gefunden');
    const skeletonHash = getStableHash('Skeleton');
    const hp = (z: ZDO): number => z.getInt(HEALTH_MEMBER);
    const ziel = (pos: Vector3): ZDO => server.zdos.createZDO(skeletonHash, pos);

    async function neuerPlatz(x: number, z: number): Promise<Vector3> {
      sendAdmin(ws, `teleport ${x} ${z}`);
      await warte(300);
      const p = peer!.position;
      if (Math.hypot(p.x - x, p.z - z) > 1) throw new Error(`Teleport nach ${x},${z} hat nicht gewirkt`);
      return { ...p };
    }

    let seq = 0;
    let versendetT = 0;
    let verzoegereSendung = 0;
    interface SchlagOpt {
      yaw?: number;
      waffe?: string;
      schritt?: number;
      alterMs?: number;
      spitzeMs?: number;
      alt?: boolean;
    }
    /** Ein Attack-Paket wie der aktuelle Client (oder, mit `alt`, wie ein alter). Liefert die Quittung, falls eine kommt. */
    async function schlage(pos: Vector3, o: SchlagOpt = {}, wartMs = 400): Promise<Quittung | null> {
      const w = new Writer();
      w.writeVector3(pos);
      w.writeFloat32(o.yaw ?? YAW_MINUS_Z);
      w.writeString(o.waffe ?? '');
      const mein = ++seq;
      if (!o.alt) {
        w.writeInt32(mein);
        w.writeInt32(o.schritt ?? 1);
        w.writeFloat32(o.alterMs ?? 0);
        w.writeFloat32(o.spitzeMs ?? 400);
      }
      const paket = Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]);
      versendetT = performance.now();
      if (verzoegereSendung > 0) setTimeout(() => ws.send(paket), verzoegereSendung);
      else ws.send(paket);
      await warte(wartMs);
      return acks.find((a) => a.seq === mein) ?? null;
    }
    const zeige = (q: Quittung | null): string =>
      q ? `Quittung schritt=${q.schritt} ergebnis=${ERG[q.ergebnis] ?? q.ergebnis}` : 'keine Quittung';
    const frisch = (): void => {
      peer.stamina = 100;
      peer.schlag = neuerSchlagZustand();
    };
    // Vorbereiten: der Server kennt keinen Equip => alter Waffenname zaehlt; wir bleiben bei der Faust ('').
    await neuerPlatz(0, 0);

    // ── [1] Kugel und Fenster ─────────────────────────────────────
    console.log('\n[1] Innerhalb der Kugel zaehlt, ausserhalb nicht:');
    let mitte = await neuerPlatz(500, 500);
    await blicke(ws, YAW_MINUS_Z);
    frisch();
    const nah = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    let q = await schlage(mitte);
    check(`1,5 m geradeaus trifft`, hp(nah) === 20 - FAUST_SCHADEN && q?.ergebnis === SchlagErgebnis.Treffer, `hp 20 -> ${hp(nah)}; ${zeige(q)}`);
    server.zdos.destroyZDO(nah.zdoid);
    frisch();
    const fern = ziel(vorn(mitte, YAW_MINUS_Z, 3.3));
    q = await schlage(mitte);
    check(`3,3 m geradeaus (im Kegel, ausserhalb der Kugel) trifft NICHT`, hp(fern) === 0 && q?.ergebnis === SchlagErgebnis.Fehl, `hp 0 -> ${hp(fern)}; ${zeige(q)}`);
    server.zdos.destroyZDO(fern.zdoid);

    // ── [2] Ruecken ───────────────────────────────────────────────
    console.log('\n[2] Ziel im Ruecken:');
    frisch();
    const ruecken = ziel(vorn(mitte, YAW_PLUS_Z, 1.5));
    q = await schlage(mitte);
    check('Ziel 1,5 m im Ruecken trifft NICHT', hp(ruecken) === 0, `hp 0 -> ${hp(ruecken)}; ${zeige(q)}`);
    server.zdos.destroyZDO(ruecken.zdoid);
    frisch();
    const nacken = ziel(vorn(mitte, YAW_PLUS_Z, 0.5));
    q = await schlage(mitte);
    check('Ziel 0,5 m im Nacken (unter 0,8 m, die Blickrichtung zaehlt nicht) trifft', hp(nacken) === 20 - FAUST_SCHADEN, `hp 0 -> ${hp(nacken)}; ${zeige(q)}`);
    server.zdos.destroyZDO(nacken.zdoid);

    // ── [3] bewegtes Ziel ─────────────────────────────────────────
    console.log('\n[3] Bewegtes Ziel: Tempo x 0,14 s Toleranz, gedeckelt bei 1,5 m:');
    const spawns0 = (server as unknown as { spawns: object }).spawns;
    let tempo = 0;
    const bewegt = Object.create(spawns0 ?? {}) as { tempo: () => number };
    bewegt.tempo = () => tempo;
    Object.defineProperty(server, 'spawns', { get: () => bewegt, configurable: true });
    const rand = ziel(vorn(mitte, YAW_MINUS_Z, 2.95)); // 1,95 m von der Kugelmitte: Grenze ohne Toleranz 1,4 m
    frisch();
    tempo = 0;
    q = await schlage(mitte);
    check('stehendes Ziel am Rand (Abstand 1,95 m zur Kugelmitte): kein Treffer', hp(rand) === 0, `hp 0 -> ${hp(rand)}; ${zeige(q)}`);
    frisch();
    tempo = 5; // Toleranz 0,7 m
    q = await schlage(mitte);
    check('dieselbe Stelle, Ziel laeuft 5 m/s (Toleranz 0,70 m): Treffer', hp(rand) === 20 - FAUST_SCHADEN, `hp 0 -> ${hp(rand)}; ${zeige(q)}; Toleranz ${zielToleranz(5).toFixed(2)} m`);
    server.zdos.destroyZDO(rand.zdoid);
    frisch();
    tempo = 30; // Toleranz gedeckelt bei 1,5 m => Grenze 0,8 + 0,6 + 1,5 = 2,9 m
    const zuweit = ziel(vorn(mitte, YAW_MINUS_Z, 4.1)); // 3,1 m von der Kugelmitte: ueber 0,8 + 0,6 + 1,5 = 2,9
    q = await schlage(mitte);
    check('Toleranz ist gedeckelt: 30 m/s reichen nicht auf 3,1 m Abstand', hp(zuweit) === 0, `hp 0 -> ${hp(zuweit)}; Toleranz ${zielToleranz(30).toFixed(2)} m`);
    server.zdos.destroyZDO(zuweit.zdoid);
    Object.defineProperty(server, 'spawns', { get: () => spawns0, configurable: true });

    // ── [4] Kombo ─────────────────────────────────────────────────
    console.log('\n[4] Kombo 1-2-3: der dritte Schlag zaehlt nur nach dem zweiten im Kettenfenster:');
    mitte = await neuerPlatz(600, 600);
    await blicke(ws, YAW_MINUS_Z);
    frisch();
    const kette = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    const q1 = await schlage(mitte, { schritt: 1 }, 400);
    const q2 = await schlage(mitte, { schritt: 2 }, 400);
    const q3 = await schlage(mitte, { schritt: 3 }, 400);
    check('Schlag 1, 2, 3 im Fenster: alle drei zaehlen', hp(kette) === 20 - 3 * FAUST_SCHADEN && q3?.ergebnis === SchlagErgebnis.Treffer, `hp 20 -> ${hp(kette)}; ${zeige(q1)} | ${zeige(q2)} | ${zeige(q3)}`);
    check('die Quittung zaehlt 1, 2, 3', q1?.schritt === 1 && q2?.schritt === 2 && q3?.schritt === 3);
    server.zdos.destroyZDO(kette.zdoid);

    frisch();
    const ohne2 = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    const r1 = await schlage(mitte, { schritt: 1 }, 1300); // nach der Kette (0,35 s + 0,6 s) ist das Fenster zu
    const r3 = await schlage(mitte, { schritt: 3 }, 400);
    check(
      `Schlag 3 ohne Schlag 2 im Kettenfenster (${KETTE_FENSTER_S} s) zaehlt NICHT`,
      hp(ohne2) === 20 - FAUST_SCHADEN && r3?.ergebnis === SchlagErgebnis.Kombo && r3.schritt === 0,
      `hp 20 -> ${hp(ohne2)} (nur Schlag 1); ${zeige(r1)} | ${zeige(r3)}`
    );
    server.zdos.destroyZDO(ohne2.zdoid);

    // ── [5] zwei Pakete in 50 ms ──────────────────────────────────
    console.log('\n[5] Zwei Attack-Pakete innerhalb von 50 ms zaehlen einmal:');
    frisch();
    const doppel = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    const beide = Promise.all([schlage(mitte, {}, 450), warte(20).then(() => schlage(mitte, {}, 430))]);
    const [d1, d2] = await beide;
    check('zwei Pakete im Abstand von ~20 ms: ein Treffer', hp(doppel) === 20 - FAUST_SCHADEN, `hp 20 -> ${hp(doppel)}; ${zeige(d1)} | ${zeige(d2)}`);
    server.zdos.destroyZDO(doppel.zdoid);

    // ── [6] Zeitstempel ───────────────────────────────────────────
    console.log('\n[6] Zeitstempel aus der Zukunft und abgelaufene werden abgelehnt:');
    frisch();
    const zeit = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    q = await schlage(mitte, { alterMs: -100 });
    check('Zeitstempel aus der Zukunft (-100 ms): abgelehnt, kein Treffer, keine Ausdauer', hp(zeit) === 0 && q?.ergebnis === SchlagErgebnis.Zeit && peer.stamina === 100, `hp 0 -> ${hp(zeit)}; Ausdauer ${peer.stamina}; ${zeige(q)}`);
    q = await schlage(mitte, { alterMs: 5000 });
    check('Zeitstempel weit ausserhalb des Fensters (5000 ms alt): abgelehnt', hp(zeit) === 0 && q?.ergebnis === SchlagErgebnis.Zeit, `hp 0 -> ${hp(zeit)}; ${zeige(q)}`);
    q = await schlage(mitte, { alterMs: 100, spitzeMs: 400 });
    check('Zeitstempel im Fenster (100 ms bei Spitze 400 ms): zaehlt', hp(zeit) === 20 - FAUST_SCHADEN && q?.ergebnis === SchlagErgebnis.Treffer, `hp 0 -> ${hp(zeit)}; ${zeige(q)}`);
    server.zdos.destroyZDO(zeit.zdoid);

    // ── [7] nicht getragene Waffe ─────────────────────────────────
    console.log('\n[7] Eine nicht getragene Waffe im Paket zaehlt nicht:');
    sendEquip(ws, 'waffe', '');
    await warte(250);
    frisch();
    const waffeZiel = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    q = await schlage(mitte, { waffe: 'AxeFlint' });
    check(
      'Paket nennt AxeFlint (im Inventar, aber nicht getragen): Faustschaden',
      hp(waffeZiel) === 20 - FAUST_SCHADEN,
      `hp 20 -> ${hp(waffeZiel)} (Faust ${FAUST_SCHADEN}); ${zeige(q)}`
    );
    server.zdos.destroyZDO(waffeZiel.zdoid);

    // ── [8] alter Client ──────────────────────────────────────────
    console.log('\n[8] Alter Client (Paket ohne die D2-Felder):');
    frisch();
    const alt = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    const vorher = acks.length;
    q = await schlage(mitte, { alt: true });
    check('der Schlag zaehlt', hp(alt) === 20 - FAUST_SCHADEN, `hp 20 -> ${hp(alt)}`);
    check('es kommt KEINE Quittung (ein alter Client sieht das neue Paket nie)', q === null && acks.length === vorher, `Quittungen vorher ${vorher}, nachher ${acks.length}`);
    server.zdos.destroyZDO(alt.zdoid);

    // ── [9] Latenz ────────────────────────────────────────────────
    console.log('\n[9] Latenz Schlag -> Treffer-Anzeige bei 40 ms kuenstlicher RTT (20 ms je Richtung):');
    const dauern: number[] = [];
    verzoegereSendung = 20;
    empfangsVerzug = 20;
    for (let i = 0; i < 6; i++) {
      frisch();
      const z = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
      const n = trefferZeiten.length;
      await schlage(mitte, {}, 400);
      if (trefferZeiten.length > n) dauern.push(trefferZeiten[n]! - versendetT);
      server.zdos.destroyZDO(z.zdoid);
    }
    verzoegereSendung = 0;
    empfangsVerzug = 0;
    const max = Math.max(...dauern);
    const mittel = dauern.reduce((a, b) => a + b, 0) / dauern.length;
    check(
      'alle 6 Schlaege zeigen den Treffer, hoechstens 250 ms nach dem Klick',
      dauern.length === 6 && max <= 250,
      `Zeiten ms: ${dauern.map((d) => d.toFixed(0)).join(', ')}; Mittel ${mittel.toFixed(0)}, Max ${max.toFixed(0)}`
    );

    // ── [11] F3: ein luegender Client (Alter 0) gewinnt nichts ─────
    console.log('\n[11] F3: Alter 0 gemeldet, der Schlag aber verspaetet — es zaehlt der Zustand des Servers bei Ankunft:');
    mitte = await neuerPlatz(700, 700);
    await blicke(ws, YAW_MINUS_Z);
    frisch();
    const weg = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    server.zdos.destroyZDO(weg.zdoid); // das Ziel war beim Klick da, bei der Ankunft nicht mehr in Reichweite
    const wegNeu = ziel(vorn(mitte, YAW_MINUS_Z, 5));
    q = await schlage(mitte, { alterMs: 0, spitzeMs: 400 });
    check('verspaeteter Schlag, Alter 0: das inzwischen entfernte Ziel wird nicht getroffen', hp(wegNeu) === 0 && q?.ergebnis === SchlagErgebnis.Fehl, `hp 0 -> ${hp(wegNeu)}; ${zeige(q)}`);
    server.zdos.destroyZDO(wegNeu.zdoid);
    frisch();
    const k1 = await schlage(mitte, { schritt: 1, alterMs: 0 }, 1300);
    const k2 = await schlage(mitte, { schritt: 2, alterMs: 0 }, 400);
    check('zweiter Schlag 1,3 s spaeter mit Alter 0 und Schritt 2: der Server zaehlt Schritt 1 (Kette neu)', k1?.schritt === 1 && k2?.schritt === 1, `${zeige(k1)} | ${zeige(k2)}`);

    // ── [12] F6: Kurzpakete trennen den Peer nicht ─────────────────
    console.log('\n[12] F6: Attack-Pakete mit 0 bis 15 Byte werden still verworfen, der Peer bleibt verbunden:');
    mitte = await neuerPlatz(800, 800);
    await blicke(ws, YAW_MINUS_Z);
    frisch();
    for (let n = 0; n <= 15; n++) {
      ws.send(Buffer.concat([Buffer.from([P.Attack]), Buffer.alloc(n, 0x01)]));
      await warte(60);
    }
    await warte(300);
    check(
      'nach 16 Kurzpaketen (0..15 Byte): Verbindung offen, Peer noch beim Server',
      ws.readyState === WebSocket.OPEN && server.net.getPeers().some((p) => p.name === 'Schlaeger'),
      `readyState ${ws.readyState}, Peers ${server.net.getPeers().length}`
    );
    frisch();
    const nachKurz = ziel(vorn(mitte, YAW_MINUS_Z, 1.5));
    q = await schlage(mitte);
    check('der naechste gueltige Schlag trifft', hp(nachKurz) === 20 - FAUST_SCHADEN && q?.ergebnis === SchlagErgebnis.Treffer, `hp 20 -> ${hp(nachKurz)}; ${zeige(q)}`);
    server.zdos.destroyZDO(nachKurz.zdoid);

    // ── [10] reine Regeln an den Grenzen ──────────────────────────
    console.log('\n[10] Reine Regeln an den Grenzen:');
    const z0 = neuerSchlagZustand();
    const m = (schritt: number, alterMs = 0) => ({ seq: 1, schritt, alterMs, spitzeMs: 400 });
    check('erster Schlag: Schritt 1', JSON.stringify(pruefeSchlag(z0, m(1), 1000, '')) === '{"ok":true,"schritt":1}');
    verbucheSchlag(z0, 1000, 1, '');
    const kurz = pruefeSchlag(z0, m(2), 1000 + 49, '');
    check('49 ms nach dem vorigen Schlag: Abklingzeit', !kurz.ok && kurz.ergebnis === SchlagErgebnis.Abklingzeit);
    const knapp = pruefeSchlag(z0, m(2), 1000 + abklingzeitMs('') - 1, '');
    check(`${abklingzeitMs('') - 1} ms nach dem vorigen Schlag: noch Abklingzeit`, !knapp.ok && knapp.ergebnis === SchlagErgebnis.Abklingzeit);
    const zwei = pruefeSchlag(z0, m(2), 1000 + abklingzeitMs(''), '');
    check('nach der Abklingzeit im Kettenfenster: Schritt 2', zwei.ok && zwei.schritt === 2);
    const spaet = pruefeSchlag(z0, m(3), 1000 + abklingzeitMs('') + KETTE_FENSTER_S * 1000 + 1, '');
    check('1 ms nach dem Kettenfenster: Schritt 3 abgelehnt', !spaet.ok && spaet.ergebnis === SchlagErgebnis.Kombo);
    // F1: die Kante des Kettenfensters (Abklingzeit 350 ms + 0,6 s = 950 ms ab dem vorigen Schlag).
    const kante = 950; // literal, nicht aus den Konstanten: sonst wandert die Probe mit einer verstellten Konstante mit
    const innen = pruefeSchlag(z0, m(2), 1000 + kante - 10, '');
    check(`${kante - 10} ms nach dem vorigen Schlag (knapp innerhalb): Schritt 2`, innen.ok && innen.schritt === 2);
    const aufKante = pruefeSchlag(z0, m(2), 1000 + kante, '');
    check(`${kante} ms (Kante, noch innerhalb): Schritt 2`, aufKante.ok && aufKante.schritt === 2);
    const aussen = pruefeSchlag(z0, m(2), 1000 + kante + 1, '');
    check(`${kante + 1} ms (ausserhalb): die Kette beginnt neu, Schritt 1`, aussen.ok && aussen.schritt === 1);
    const weit = pruefeSchlag(z0, m(1), 1000 + kante + 500, '');
    check('weit nach dem Fenster: Schritt 1', weit.ok && weit.schritt === 1);
    // F3: das Alter ist das Wort des Clients; der Server prueft es an der eigenen Uhr. Ein Schlag kann nicht
    // begonnen haben, bevor der vorige (1000 ms, Abklingzeit 350 ms, Toleranz 50 ms) frei war.
    const ehrlich = pruefeSchlag(z0, m(2, 0), 1400, '');
    check('F3: Alter 0 bei 1400 ms (ehrlich oder gelogen): die Uhr des Servers entscheidet, Schritt 2', ehrlich.ok && ehrlich.schritt === 2);
    const rand3 = pruefeSchlag(z0, m(2, 100), 1400, '');
    check('F3: Alter 100 ms bei 1400 ms (Beginn 1300 = Ende der Abklingzeit minus Toleranz): gerade noch gueltig', rand3.ok);
    const rueck = pruefeSchlag(z0, m(2, 101), 1400, '');
    check('F3: Alter 101 ms bei 1400 ms (Beginn vor dem Ende des vorigen Schlags): abgelehnt, Zeit', !rueck.ok && rueck.ergebnis === SchlagErgebnis.Zeit);
    const ueberlappt = pruefeSchlag(z0, m(2, 380), 1400, '');
    check('F3: Alter 380 ms bei 1400 ms (Schlag haette den vorigen ueberlappt): abgelehnt, Zeit', !ueberlappt.ok && ueberlappt.ergebnis === SchlagErgebnis.Zeit);
    // F2: Spitzendeckel (600 ms) + Fenster 200 ms = 800 ms, auch wenn der Client eine riesige Spitze meldet.
    const riesig = { seq: 1, schritt: 1, spitzeMs: 6_000_000 };
    const riesigAlt = pruefeSchlag(neuerSchlagZustand(), { ...riesig, alterMs: 5000 }, 9000, '');
    check('Spitze 6 000 000 ms gemeldet, Alter 5000 ms: abgelehnt (Deckel)', !riesigAlt.ok && riesigAlt.ergebnis === SchlagErgebnis.Zeit);
    const deckelRand = pruefeSchlag(neuerSchlagZustand(), { ...riesig, alterMs: SPITZE_MAX_MS + SCHLAG_FENSTER_S * 1000 }, 9000, '');
    check(`Alter ${SPITZE_MAX_MS + SCHLAG_FENSTER_S * 1000} ms (Deckel + Fenster): gerade noch im Fenster`, deckelRand.ok);
    const deckelUeber = pruefeSchlag(neuerSchlagZustand(), { ...riesig, alterMs: SPITZE_MAX_MS + SCHLAG_FENSTER_S * 1000 + 1 }, 9000, '');
    check('1 ms darueber: abgelehnt', !deckelUeber.ok && deckelUeber.ergebnis === SchlagErgebnis.Zeit);
    const alter = pruefeSchlag(neuerSchlagZustand(), m(1, 601), 5000, '');
    check('Alter 601 ms bei Spitze 400 ms (Fenster 200 ms): abgelaufen', !alter.ok && alter.ergebnis === SchlagErgebnis.Zeit);
    const randOk = pruefeSchlag(neuerSchlagZustand(), m(1, 600), 5000, '');
    check('Alter 600 ms bei Spitze 400 ms: gerade noch im Fenster', randOk.ok);
    const nan = pruefeSchlag(neuerSchlagZustand(), { seq: 1, schritt: 1, alterMs: NaN, spitzeMs: 0 }, 5000, '');
    check('Alter NaN: abgelehnt', !nan.ok && nan.ergebnis === SchlagErgebnis.Zeit);
    const von = { x: 0, y: 0, z: 0 };
    check('Kugel: Ziel 2,3 m geradeaus trifft (0,8 + 0,6 Koerper), 2,5 m nicht', trifftKugel(von, 0, { x: 0, y: 0, z: -2.3 }) && !trifftKugel(von, 0, { x: 0, y: 0, z: -2.5 }));
    // F2: Hoehe. Ziel 1,5 m geradeaus (Kugelmitte 1 m vorn, 0,5 m waagerecht), aber hoeher/tiefer.
    const beiHoehe = (dy: number) => trifftKugel(von, 0, { x: 0, y: dy, z: -1.5 });
    check('Hoehe: dy 0 und 1,0 m treffen, dy 1,6 m und -1,6 m nicht (waagerecht in Reichweite)', beiHoehe(0) && beiHoehe(1) && !beiHoehe(1.6) && !beiHoehe(-1.6));
    const abst = trefferAbstand(von, 0, { x: 0, y: 1, z: -1.5 });
    check('Hoehe fliesst in den Abstand ein: dy 1 m bei 0,5 m waagerecht = 1,118 m', abst !== null && Math.abs(abst - Math.hypot(0.5, 1)) < 1e-9, `${abst}`);
    check('Kugel: kein Yaw (NaN) trifft nichts', !trifftKugel(von, NaN, { x: 0, y: 0, z: -1 }));
    check('Toleranz: 5 m/s = 0,70 m, 20 m/s = gedeckelt 1,50 m, negativ/NaN = 0', Math.abs(zielToleranz(5) - 0.7) < 1e-9 && zielToleranz(20) === 1.5 && zielToleranz(-3) === 0 && zielToleranz(NaN) === 0);
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\nD2 Trefferpruefung: alles gruen' : `\nD2 Trefferpruefung: ${failures} FEHLER`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
