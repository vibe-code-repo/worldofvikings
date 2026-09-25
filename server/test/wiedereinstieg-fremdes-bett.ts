/**
 * Wiedereinstieg an einem Bett, das nicht (mehr) gilt — der volle Weg mit
 * echten Clients (PlacePiece, Interact, RemovePiece, Tod, Neustart).
 *
 *  [F1] Anna baut ein eigenes Bett 3 m ueber Bjoerns Bett (x um 0,03 m versetzt),
 *       setzt dort ihren Schlafplatz, reisst es ab und stirbt: Weltspawn und
 *       Meldung, nie an Bjoerns Bett. [F2] dasselbe 30 m unter dem Boden.
 *  [F3] Nach dem Neustart bleibt Annas Punkt verworfen (kein Bett, keine Meldung).
 *  [F4] Greta und Hanna bauen ihr Bett 4 cm neben Bjoerns Bett, auf gleicher Hoehe, setzt dort,
 *       reisst es ab; nach dem Neustart stirbt sie: Weltspawn und Meldung, nicht
 *       an Bjoerns Bett (der Besitzer des Bettes zaehlt, gespeichert ueber den Neustart).
 *  [M]  Ein abgerissenes eigenes Bett wird nicht still gegen ein anderes Bett
 *       derselben x/z-Saeule getauscht (zwei Weltbetten ohne Kennung darueber
 *       und darunter): Weltspawn und Meldung.
 *  [G]  Ein Gast (jede Verbindung eine neue userId) behaelt sein eigenes
 *       Spielerbett ueber den Neustart: er erwacht dort.
 *  [L]  Ein Layout-Bett (Kennung) zieht in der Hoehe und um 1,9 m seitlich mit; gibt
 *       es die Kennung zweimal in der Saeule, gilt der Punkt nicht (verwerfen und
 *       melden). Ein Spielerbau mit derselben Kennung zaehlt nicht. Wer nach einem
 *       Layout-Bett sein eigenes Bett setzt, erwacht dort (keine alte Kennung).
 *  [B]  Ein Punkt im Koordinatenband wird verworfen UND gemeldet.
 *
 * Run: npx tsx server/test/wiedereinstieg-fremdes-bett.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { LAYOUT_ID_MEMBER, isInDungeonBand, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-wiedereinstieg-fremdes-bett');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(resolve(TMP, 'welten'), { recursive: true });

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, Teleport: 43, Interact: 44, InteractResult: 45, AdminCommand: 53, PlacePiece: 55, RemovePiece: 56, AuthChallenge: 68 };
const BETT = 'environment-sm-prop-bed-04';
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (b: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (b()) return true;
    await warte(25);
  }
  return b();
};
const f = (n: number): string => n.toFixed(3);
const pos = (v: Vector3 | null | undefined): string => (v ? `(${f(v.x)}; ${f(v.y)}; ${f(v.z)})` : 'keiner');
const gleich = (a: Vector3 | undefined | null, b: Vector3 | undefined | null): boolean => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.02;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Klient { ws: WebSocket; ergebnisse: Array<{ ok: boolean; message: string }>; teleports: Vector3[] }
function verbinde(port: number, name: string): Promise<Klient> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, ergebnisse: [], teleports: [] };
    const t = setTimeout(() => rej(new Error('Handshake ' + name)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(t);
        res(k);
      } else if (type === P.InteractResult) {
        const ok = r.readBool();
        k.ergebnisse.push({ ok, message: r.readString() });
      } else if (type === P.Teleport) k.teleports.push(r.readVector3());
    });
    ws.on('error', rej);
  });
}
const sende = (ws: WebSocket, typ: number, w: Writer): void => ws.send(Buffer.concat([Buffer.from([typ]), w.toBuffer()]));
const admin = (ws: WebSocket, line: string): void => sende(ws, P.AdminCommand, new Writer().writeString(line));
function interact(ws: WebSocket, ziel: Vector3, hash: number): void {
  const w = new Writer();
  w.writeVector3(ziel);
  w.writeInt32(hash);
  sende(ws, P.Interact, w);
}
function place(ws: WebSocket, hash: number, p: Vector3): void {
  const w = new Writer();
  w.writeInt32(hash);
  w.writeVector3(p);
  w.writeQuaternion({ x: 0, y: 0, z: 0, w: 1 });
  sende(ws, P.PlacePiece, w);
}
function remove(ws: WebSocket, p: Vector3): void {
  const w = new Writer();
  w.writeVector3(p);
  sende(ws, P.RemovePiece, w);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function starte(): Any {
  const s = createWovServer({
    port: 0,
    worldsDir: resolve(TMP, 'welten'),
    kontenDir: resolve(TMP, 'konten'),
    worldName: 'fremdes-bett',
    worldSeed: 'FremdesBett1',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
  });
  s.start();
  return s;
}
const VERLUST = /Schlafplatz/;

async function main(): Promise<void> {
  let server: Any = starte();
  const HASH = server.prefabs.getByName(BETT)!.hash as number;
  const namen = ['Anna', 'Bjoern', 'Christa', 'Dora', 'Emil', 'Fritz', 'Greta', 'Hanna'];
  const kn: Record<string, Klient> = {};
  let port = portVon(server);
  for (const n of namen) kn[n] = await verbinde(port, n);
  await warte(300);
  const peer = (n: string): Any => server.net.getPeers().find((x: Any) => x.name === n);
  const stelle = async (n: string, x: number, z: number): Promise<void> => {
    admin(kn[n]!.ws, `teleport ${x} ${z}`);
    await bis(() => Math.hypot(peer(n).position.x - x, peer(n).position.z - z) <= 1, 5000);
    await warte(300);
  };
  const letzte = (n: string): string => kn[n]!.ergebnisse[kn[n]!.ergebnisse.length - 1]?.message ?? '';
  const aktion = async (n: string, fn: () => void): Promise<string> => {
    const e = kn[n]!.ergebnisse.length;
    fn();
    await bis(() => kn[n]!.ergebnisse.length > e, 3000);
    await warte(250);
    return letzte(n);
  };
  const bettBei = (p: Vector3): Any =>
    server.zdos.getAllZDOs().find((z: Any) => z.prefabHash === HASH && Math.abs(z.position.x - p.x) < 0.01 && Math.abs(z.position.z - p.z) < 0.01 && Math.abs(z.position.y - p.y) < 0.01);
  const tot = async (n: string): Promise<{ ziel?: Vector3; meldung: string }> => {
    const k = kn[n]!;
    const v = k.teleports.length;
    const e = k.ergebnisse.length;
    server.applyCreatureAttack({ ...peer(n).position }, 999, 3, peer(n).worldId);
    await bis(() => k.teleports.length > v && k.ergebnisse.length > e, 3000);
    await warte(250);
    return { ziel: k.teleports.length > v ? k.teleports[k.teleports.length - 1] : undefined, meldung: letzte(n) };
  };
  const holz = (n: string): void => server.gebeItem(peer(n), 'Wood', 40);
  const weltSpawn = server.weltSpawn() as Vector3;
  const baueUndSetze = async (n: string, p: Vector3): Promise<Any> => {
    await stelle(n, p.x + 2, p.z);
    holz(n);
    await aktion(n, () => place(kn[n]!.ws, HASH, p));
    const z = bettBei(p);
    await aktion(n, () => interact(kn[n]!.ws, z.position, HASH));
    return z;
  };

  // ── F1 / F2 ──
  let sollF1: Vector3 | undefined;
  for (const [tag, bx, bz, dy] of [['F1', 60, 60, 3], ['F2', 120, 60, -30]] as const) {
    console.log(`\n[${tag}] Annas Bett ${dy} m neben Bjoerns Bett in der Hoehe`);
    const zB = await baueUndSetze('Bjoern', { x: bx, y: server.getGroundHeight(bx, bz) as number, z: bz });
    const soll = { x: zB.position.x, y: zB.position.y + 0.6, z: zB.position.z };
    if (tag === 'F1') sollF1 = soll;
    await stelle('Anna', bx + 2, bz + 1);
    holz('Anna');
    const bettA = { x: zB.position.x + 0.03, y: zB.position.y + dy, z: zB.position.z };
    await aktion('Anna', () => place(kn.Anna!.ws, HASH, bettA));
    const zA = server.zdos.getAllZDOs().find((z: Any) => z.prefabHash === HASH && z.zdoid !== zB.zdoid && Math.abs(z.position.x - bettA.x) < 0.01 && Math.abs(z.position.y - bettA.y) < 0.05);
    await aktion('Anna', () => interact(kn.Anna!.ws, zA.position, HASH));
    check(`${tag}: Annas Punkt liegt an ihrem Bett`, gleich(peer('Anna').spawnPoint, { ...zA.position, y: zA.position.y + 0.6 }), pos(peer('Anna').spawnPoint));
    await aktion('Anna', () => remove(kn.Anna!.ws, zA.position));
    const t = await tot('Anna');
    console.log(`      Anna stirbt: ${pos(t.ziel)}, Meldung "${t.meldung}", Bjoerns Bett ${pos(soll)}`);
    check(`${tag}: Anna erwacht NICHT an Bjoerns Bett`, !gleich(t.ziel, soll));
    check(`${tag}: Anna erwacht am Weltspawn`, gleich(t.ziel, weltSpawn), pos(t.ziel));
    check(`${tag}: die Meldung sagt, dass der Schlafplatz weg ist`, VERLUST.test(t.meldung), t.meldung);
  }

  // ── F4: fremdes Bett auf gleicher Hoehe, 4 cm daneben ──
  // Greta trennt sich vor dem Neustart (Speichern beim Trennen), Hanna bleibt verbunden
  // (Speichern beim Stopp): beide Wege muessen den Besitzer des Bettes tragen.
  const f4: Record<string, { soll: Vector3; besitzer: string | null }> = {};
  for (const [n, bx] of [['Greta', 150], ['Hanna', 200]] as const) {
    console.log(`\n[F4] ${n}s Bett 4 cm neben Bjoerns Bett, gleiche Hoehe (Tod nach dem Neustart)`);
    const zB4 = await baueUndSetze('Bjoern', { x: bx, y: server.getGroundHeight(bx, 60) as number, z: 60 });
    await stelle(n, bx + 2, 61);
    holz(n);
    const bettG = { x: zB4.position.x + 0.04, y: zB4.position.y, z: zB4.position.z };
    await aktion(n, () => place(kn[n]!.ws, HASH, bettG));
    const zG = server.zdos.getAllZDOs().find((z: Any) => z.prefabHash === HASH && z.zdoid !== zB4.zdoid && Math.abs(z.position.x - bettG.x) < 0.01 && Math.abs(z.position.y - bettG.y) < 0.01);
    await aktion(n, () => interact(kn[n]!.ws, zG.position, HASH));
    check(`F4: ${n}s Punkt liegt an ihrem Bett`, gleich(peer(n).spawnPoint, { ...zG.position, y: zG.position.y + 0.6 }), pos(peer(n).spawnPoint));
    const besitzer = peer(n).spawnBettBesitzer as string | null;
    check(`F4: der Besitzer ihres Bettes ist gemerkt (nicht der von Bjoern)`, !!besitzer && besitzer !== (zB4.getString('besitzer') as string), `${besitzer} / ${zB4.getString('besitzer')}`);
    await aktion(n, () => remove(kn[n]!.ws, zG.position));
    f4[n] = { soll: { x: zB4.position.x, y: zB4.position.y + 0.6, z: zB4.position.z }, besitzer };
  }

  // ── M: zwei fremde Weltbetten in der Saeule ──
  console.log('\n[M] abgerissenes eigenes Bett, darueber und darunter je ein Weltbett');
  {
    const zC = await baueUndSetze('Christa', { x: 180, y: server.getGroundHeight(180, 60) as number, z: 60 });
    const oben = server.zdos.createZDO(HASH, { x: zC.position.x + 0.02, y: zC.position.y + 2, z: zC.position.z }, { x: 0, y: 0, z: 0, w: 1 });
    const unten = server.zdos.createZDO(HASH, { x: zC.position.x - 0.02, y: zC.position.y - 2, z: zC.position.z }, { x: 0, y: 0, z: 0, w: 1 });
    for (const z of [oben, unten]) {
      z.revision.reviseData();
      z.dirty = true;
    }
    await aktion('Christa', () => remove(kn.Christa!.ws, zC.position));
    const t = await tot('Christa');
    console.log(`      Christa stirbt: ${pos(t.ziel)}, Meldung "${t.meldung}"`);
    check('M: Christa erwacht am Weltspawn, an keinem der beiden Weltbetten', gleich(t.ziel, weltSpawn), pos(t.ziel));
    check('M: die Meldung sagt, dass der Schlafplatz weg ist', VERLUST.test(t.meldung), t.meldung);
  }

  // ── G / D: Gast mit eigenem Bett, Dora reisst ab ──
  console.log('\n[G] Gast: eigenes Spielerbett ueber den Neustart');
  const bE = { x: 300, y: server.getGroundHeight(300, 60) as number, z: 60 };
  const zE = await baueUndSetze('Emil', bE);
  const sollE = { x: zE.position.x, y: zE.position.y + 0.6, z: zE.position.z };
  const zD = await baueUndSetze('Dora', { x: 240, y: server.getGroundHeight(240, 60) as number, z: 60 });
  await aktion('Dora', () => remove(kn.Dora!.ws, zD.position));

  // ── L: Layout-Bett (Kennung) ──
  console.log('\n[L] Layout-Bett: Hoehe wandert mit, doppelte Kennung gilt nicht');
  const bF = { x: 360, y: server.getGroundHeight(360, 60) as number, z: 60 };
  await stelle('Fritz', 362, 60);
  const zF = server.zdos.createZDO(HASH, bF, { x: 0, y: 0, z: 0, w: 1 });
  zF.setString(LAYOUT_ID_MEMBER, 'wiedereinstieg-test-bett');
  zF.revision.reviseData();
  zF.dirty = true;
  await aktion('Fritz', () => interact(kn.Fritz!.ws, zF.position, HASH));
  check('L: Fritz hat den Punkt und die Kennung des Layout-Betts', !!peer('Fritz').spawnPoint && peer('Fritz').spawnBettId === 'wiedereinstieg-test-bett', `${pos(peer('Fritz').spawnPoint)} id=${peer('Fritz').spawnBettId}`);
  check('Emil (Spielerbett): keine Kennung', peer('Emil').spawnBettId === '');
  // Der Abgleich hebt das Bett: nur die Hoehe aendert sich.
  server.zdos.updateZDOZone(zF, { x: bF.x, y: bF.y + 2.5, z: bF.z });
  const tF = await tot('Fritz');
  const sollF = { x: zF.position.x, y: zF.position.y + 0.6, z: zF.position.z };
  console.log(`      Fritz stirbt: ${pos(tF.ziel)}, Soll (Bett ${pos(zF.position)} + 0,6) ${pos(sollF)}, Meldung "${tF.meldung}"`);
  check('L: Fritz erwacht am angehobenen Layout-Bett', gleich(tF.ziel, sollF), pos(tF.ziel));
  check('L: ohne Verlustmeldung', !VERLUST.test(tF.meldung), tF.meldung);
  // Seitlich um 1,9 m (fast der ganze Suchradius): der Punkt zieht mit.
  server.zdos.updateZDOZone(zF, { x: zF.position.x + 1.9, y: zF.position.y, z: zF.position.z });
  const tF19 = await tot('Fritz');
  const sollF19 = { x: zF.position.x, y: zF.position.y + 0.6, z: zF.position.z };
  console.log(`      Fritz stirbt (1,9 m seitlich): ${pos(tF19.ziel)}, Soll ${pos(sollF19)}, Meldung "${tF19.meldung}"`);
  check('L: Fritz erwacht am um 1,9 m seitlich versetzten Layout-Bett', gleich(tF19.ziel, sollF19) && !VERLUST.test(tF19.meldung), pos(tF19.ziel));
  // Dieselbe Kennung ein zweites Mal in der Saeule: nicht raten.
  const zF2 = server.zdos.createZDO(HASH, { x: zF.position.x, y: zF.position.y + 4, z: zF.position.z }, { x: 0, y: 0, z: 0, w: 1 });
  zF2.setString(LAYOUT_ID_MEMBER, 'wiedereinstieg-test-bett');
  zF2.revision.reviseData();
  zF2.dirty = true;
  const tF2 = await tot('Fritz');
  console.log(`      Fritz stirbt (Kennung doppelt): ${pos(tF2.ziel)}, Meldung "${tF2.meldung}"`);
  check('L: Kennung doppelt → Weltspawn, nicht geraten', gleich(tF2.ziel, weltSpawn), pos(tF2.ziel));
  check('L: Kennung doppelt → gemeldet', VERLUST.test(tF2.meldung), tF2.meldung);

  // Ein Spielerbau, der die Kennung traegt (Zustand vor dem Aufraeumen beim Start), ist kein Layout-Bett.
  {
    const bG = { x: 420, y: server.getGroundHeight(420, 60) as number, z: 60 };
    await stelle('Fritz', 422, 60);
    const zL = server.zdos.createZDO(HASH, bG, { x: 0, y: 0, z: 0, w: 1 });
    zL.setString(LAYOUT_ID_MEMBER, 'wiedereinstieg-test-bett-g');
    zL.revision.reviseData();
    zL.dirty = true;
    await aktion('Fritz', () => interact(kn.Fritz!.ws, zL.position, HASH));
    check('L: Fritz hat die Kennung des zweiten Layout-Betts', peer('Fritz').spawnBettId === 'wiedereinstieg-test-bett-g', peer('Fritz').spawnBettId);
    zL.setInt('spieler', 1);
    zL.revision.reviseData();
    const tS = await tot('Fritz');
    console.log(`      Fritz stirbt (Bett ist jetzt ein Spielerbau mit Kennung): ${pos(tS.ziel)}, Meldung "${tS.meldung}"`);
    check('L: ein Spielerbau mit der Kennung gilt nicht (Weltspawn + Meldung)', gleich(tS.ziel, weltSpawn) && VERLUST.test(tS.meldung), `${pos(tS.ziel)} "${tS.meldung}"`);
  }
  // Erst ein Layout-Bett, dann das eigene Bett: die Kennung darf nicht stehen bleiben.
  {
    const bH = { x: 440, y: server.getGroundHeight(440, 60) as number, z: 60 };
    await stelle('Fritz', 442, 60);
    const zH = server.zdos.createZDO(HASH, bH, { x: 0, y: 0, z: 0, w: 1 });
    zH.setString(LAYOUT_ID_MEMBER, 'wiedereinstieg-test-bett-h');
    zH.revision.reviseData();
    zH.dirty = true;
    await aktion('Fritz', () => interact(kn.Fritz!.ws, zH.position, HASH));
    check('L: Fritz hat die Kennung des dritten Layout-Betts', peer('Fritz').spawnBettId === 'wiedereinstieg-test-bett-h', peer('Fritz').spawnBettId);
    const zEigen = await baueUndSetze('Fritz', { x: 470, y: server.getGroundHeight(470, 60) as number, z: 60 });
    check('L: nach dem eigenen Bett ist die Kennung weg', peer('Fritz').spawnBettId === '', `id='${peer('Fritz').spawnBettId}'`);
    const tE = await tot('Fritz');
    const sollEigen = { x: zEigen.position.x, y: zEigen.position.y + 0.6, z: zEigen.position.z };
    check('L: Fritz erwacht an seinem eigenen Bett, ohne Meldung', gleich(tE.ziel, sollEigen) && !VERLUST.test(tE.meldung), `${pos(tE.ziel)} "${tE.meldung}"`);
  }

  // ── B: Punkt im Koordinatenband ──
  console.log('\n[B] Punkt im Koordinatenband');
  {
    const BAND = { x: 10_000_000, y: 50, z: 100 };
    check('B: der Testpunkt liegt wirklich im Band', isInDungeonBand(BAND.x));
    peer('Anna').spawnPoint = { ...BAND };
    const t = await tot('Anna');
    console.log(`      Anna stirbt: ${pos(t.ziel)}, Meldung "${t.meldung}", Punkt jetzt ${pos(peer('Anna').spawnPoint)}`);
    check('B: Weltspawn', gleich(t.ziel, weltSpawn), pos(t.ziel));
    check('B: gemeldet', VERLUST.test(t.meldung), t.meldung);
    check('B: der Punkt ist verworfen', peer('Anna').spawnPoint === null);
  }

  const d1 = await tot('Dora');
  check('D: Dora (abgerissen) erfaehrt es', VERLUST.test(d1.meldung) && gleich(d1.ziel, weltSpawn), `${pos(d1.ziel)} "${d1.meldung}"`);

  // ── Neustart ──
  for (const n of namen) if (n !== 'Hanna') kn[n]!.ws.close();
  await warte(500);
  server.stop();
  await warte(600);
  server = starte();
  port = portVon(server);
  for (const n of namen) kn[n] = await verbinde(port, n);
  await warte(600);
  console.log('\n[nach Neustart]');
  check('F3: Annas verworfener Punkt kommt nicht aus dem Spielstand zurueck', peer('Anna').spawnPoint === null, pos(peer('Anna').spawnPoint));
  const a2 = await tot('Anna');
  check('F3: Anna stirbt erneut: Weltspawn, nicht an Bjoerns Bett, ohne Wiederholung der Meldung', gleich(a2.ziel, weltSpawn) && !gleich(a2.ziel, sollF1) && !VERLUST.test(a2.meldung), `${pos(a2.ziel)} "${a2.meldung}"`);
  for (const n of ['Greta', 'Hanna']) {
    check(`F4: ${n}s Punkt und Besitzer kommen aus dem Spielstand`, !!peer(n).spawnPoint && peer(n).spawnBettBesitzer === f4[n]!.besitzer, `${pos(peer(n).spawnPoint)} / ${peer(n).spawnBettBesitzer}`);
    const g2 = await tot(n);
    console.log(`      ${n} stirbt: ${pos(g2.ziel)}, Meldung "${g2.meldung}", Bjoerns Bett ${pos(f4[n]!.soll)}`);
    check(`F4: ${n} erwacht NICHT an Bjoerns Bett`, !gleich(g2.ziel, f4[n]!.soll), pos(g2.ziel));
    check(`F4: ${n} erwacht am Weltspawn, mit Meldung`, gleich(g2.ziel, weltSpawn) && VERLUST.test(g2.meldung), `${pos(g2.ziel)} "${g2.meldung}"`);
  }
  const d2 = await tot('Dora');
  check('D: Dora nach dem Neustart: keine Wiederholung der Meldung', !VERLUST.test(d2.meldung) && gleich(d2.ziel, weltSpawn), `${pos(d2.ziel)} "${d2.meldung}"`);
  check('G: Emils Punkt kommt aus dem Spielstand', gleich(peer('Emil').spawnPoint, sollE), pos(peer('Emil').spawnPoint));
  const e2 = await tot('Emil');
  check('G: Emil (Gast, neue userId) erwacht an seinem Bett', gleich(e2.ziel, sollE) && !VERLUST.test(e2.meldung), `${pos(e2.ziel)} "${e2.meldung}"`);

  for (const n of namen) kn[n]!.ws.close();
  await warte(300);
  server.stop();
  await warte(300);
  rmSync(TMP, { recursive: true, force: true });
  console.log(failures === 0 ? '\n=== ALL PASSED ===' : `\n=== ${failures} FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
