/**
 * Wiedereinstieg nach einem Neustart mit Layout-Abgleich: der volle Weg mit
 * echten Clients (Bett setzen, Server stoppen, Dokument aendern, Server neu
 * starten, sterben).
 *
 * Der Layout-Abgleich setzt ein Layout-Bett beim Start auf die neue Gelaende-
 * hoehe (`layoutAbgleich.ts`, Boden-Zweig). Der gespeicherte Punkt (Bett + 0,6)
 * passte danach nicht mehr, und der Spieler erwachte still am Weltspawn.
 *
 *  [1] Bett 1 (100,100): der Boden steigt, das Bett wandert nur in der Hoehe →
 *      der Punkt zieht mit, der Tod fuehrt an die neue Bettposition, ohne
 *      Verlustmeldung.
 *  [2] Bett 2 (200,100): der Designer versetzt es seitlich → kein Bett mehr an
 *      der Stelle: Weltspawn UND die Meldung, einmal; der Punkt ist verworfen.
 *  [3] Bett 3 (300,100): der Designer loescht es → dasselbe wie [2].
 *
 * Alle drei Betten sind Weltbetten (ohne Besitzer). Der Testport ist ephemer.
 *
 * Run: npx tsx server/test/wiedereinstieg-bett-wandert.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import type { Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-wiedereinstieg-bett-wandert');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(resolve(TMP, 'welten'), { recursive: true });
const LAYOUT = resolve(TMP, 'layout.json');

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, Teleport: 43, Interact: 44, InteractResult: 45, AdminCommand: 53, AuthChallenge: 68 };
const BETT = 'environment-sm-prop-bed-04';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};
const NACHFRIST_MS = 250;
const f = (n: number): string => n.toFixed(3);
const pos = (v: Vector3 | null | undefined): string => (v ? `(${f(v.x)}; ${f(v.y)}; ${f(v.z)})` : 'keiner');
const gleich = (a: Vector3, b: Vector3): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.01;

interface Klient {
  ws: WebSocket;
  ergebnisse: Array<{ ok: boolean; message: string }>;
  teleports: Vector3[];
}
function verbinde(port: number, name: string): Promise<Klient> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, ergebnisse: [], teleports: [] };
    const timeout = setTimeout(() => rej(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        res(k);
      } else if (type === P.InteractResult) {
        const ok = r.readBool();
        k.ergebnisse.push({ ok, message: r.readString() });
      } else if (type === P.Teleport) {
        k.teleports.push(r.readVector3());
      }
    });
    ws.on('error', rej);
  });
}
function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}
function sendInteract(ws: WebSocket, ziel: Vector3, prefabHash: number): void {
  const w = new Writer();
  w.writeVector3(ziel);
  w.writeInt32(prefabHash);
  ws.send(Buffer.concat([Buffer.from([P.Interact]), w.toBuffer()]));
}

interface Zugriff {
  applyCreatureAttack(pos: Vector3, damage: number, radius: number, weltId?: unknown): void;
  weltSpawn(): Vector3;
}

/** Ein Dokument mit Betten an den angegebenen Stellen; `baseLevel` ist das, was der Boden-Test dreht. */
function schreibeDokument(baseLevel: number, betten: Array<{ x: number; z: number }>): void {
  writeFileSync(
    LAYOUT,
    JSON.stringify({
      version: 1,
      name: 'Wiedereinstieg',
      detailSeed: 'WiedereinstiegBett1',
      continents: [],
      regions: [
        { id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel, vegetation: [] },
      ],
      routes: [],
      placements: betten.map((b) => ({ prefab: BETT, x: b.x, z: b.z })),
    })
  );
}

function starteServer() {
  const server = createWovServer({
    port: 0,
    worldsDir: resolve(TMP, 'welten'),
    kontenDir: resolve(TMP, 'konten'),
    worldName: 'wiedereinstieg',
    worldSeed: 'WiedereinstiegBett1',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
  });
  server.start();
  return server;
}
type Server = ReturnType<typeof starteServer>;

const bettBei = (server: Server, x: number, z: number) =>
  server.zdos
    .getAllZDOs()
    .find((z2) => z2.prefabHash === server.prefabs.getByName(BETT)!.hash && Math.abs(z2.position.x - x) < 1 && Math.abs(z2.position.z - z) < 1);

async function main(): Promise<void> {
  const BASIS_VORHER = 0.3;
  const BASIS_NACHHER = 0.32; // hebt den Boden um mehr als 0,5 m (siehe layout-abgleich.ts, (d))
  schreibeDokument(BASIS_VORHER, [{ x: 100, z: 100 }, { x: 200, z: 100 }, { x: 300, z: 100 }]);

  let server: Server = starteServer();
  const kn: Record<string, Klient> = {};
  const namen = ['Anna', 'Bjoern', 'Christa'];
  const setzen: Record<string, Vector3> = {};
  const bettVorher: Record<string, Vector3> = {};
  try {
    let port = portVon(server);
    for (const n of namen) kn[n] = await verbinde(port, n);
    await warte(300);
    const peer = (name: string) => server.net.getPeers().find((x) => x.name === name)!;

    console.log('\n[Boot 1] Betten setzen, sterben:');
    const stelle = async (n: string, x: number, z: number): Promise<void> => {
      sendAdmin(kn[n]!.ws, `teleport ${x} ${z}`);
      await bis(() => Math.hypot(peer(n).position.x - x, peer(n).position.z - z) <= 1, 5000);
      await warte(NACHFRIST_MS);
    };
    const bettX: Record<string, number> = { Anna: 100, Bjoern: 200, Christa: 300 };
    const weltSpawn = (server as unknown as Zugriff).weltSpawn();
    for (const n of namen) {
      await stelle(n, bettX[n]! + 2, 100);
      const bett = bettBei(server, bettX[n]!, 100)!;
      bettVorher[n] = { ...bett.position };
      await warte(350);
      sendInteract(kn[n]!.ws, bett.position, server.prefabs.getByName(BETT)!.hash);
      await bis(() => kn[n]!.ergebnisse.length > 0, 3000);
      await warte(NACHFRIST_MS);
      setzen[n] = { ...peer(n).spawnPoint! };
      check(`${n}: Schlafplatz gesetzt`, kn[n]!.ergebnisse[0]?.ok === true && !!peer(n).spawnPoint, `Bett ${pos(bett.position)}, Punkt ${pos(peer(n).spawnPoint)}`);
      const v = kn[n]!.teleports.length;
      (server as unknown as Zugriff).applyCreatureAttack({ ...peer(n).position }, 999, 3, peer(n).worldId);
      await bis(() => kn[n]!.teleports.length > v, 3000);
      await warte(NACHFRIST_MS);
      const dort = kn[n]!.teleports[kn[n]!.teleports.length - 1];
      check(`${n}: Tod vor dem Neustart fuehrt ans Bett`, !!dort && gleich(dort, setzen[n]!), pos(dort));
    }
    check('Bett und Weltspawn sind verschiedene Orte (sonst beweist nichts etwas)', namen.every((n) => !gleich(setzen[n]!, weltSpawn)), pos(weltSpawn));

    for (const n of namen) kn[n]!.ws.close();
    await warte(400);
    server.stop();
    await warte(500);

    console.log('\n[Boot 2] Boden steigt; Bett 2 seitlich versetzt; Bett 3 geloescht:');
    schreibeDokument(BASIS_NACHHER, [{ x: 100, z: 100 }, { x: 200.3, z: 100 }]);
    server = starteServer();
    port = portVon(server);
    for (const n of namen) kn[n] = await verbinde(port, n);
    await warte(600);
    const bett1 = bettBei(server, 100, 100)!;
    console.log(`      Bett 1: ${pos(bettVorher.Anna)} -> ${pos(bett1.position)} (dy = ${f(bett1.position.y - bettVorher.Anna!.y)} m)`);
    check('Bett 1 ist wirklich gewandert (>= 0,5 m, sonst beweist nichts etwas)', bett1.position.y - bettVorher.Anna!.y >= 0.5);
    check('Anna hat den Punkt aus dem Spielstand', !!peer('Anna').spawnPoint && gleich(peer('Anna').spawnPoint!, setzen.Anna!), pos(peer('Anna').spawnPoint));

    const tot = async (n: string): Promise<{ ziel: Vector3 | undefined; meldung: string }> => {
      const k = kn[n]!;
      const v = k.teleports.length;
      const e = k.ergebnisse.length;
      (server as unknown as Zugriff).applyCreatureAttack({ ...peer(n).position }, 999, 3, peer(n).worldId);
      await bis(() => k.teleports.length > v && k.ergebnisse.length > e, 3000);
      await warte(NACHFRIST_MS);
      return { ziel: k.teleports.length === v + 1 ? k.teleports[k.teleports.length - 1] : undefined, meldung: k.ergebnisse[k.ergebnisse.length - 1]?.message ?? '' };
    };
    const weltSpawn2 = (server as unknown as Zugriff).weltSpawn();

    const a = await tot('Anna');
    const sollA = { x: bett1.position.x, y: bett1.position.y + 0.6, z: bett1.position.z };
    console.log(`      [1] Anna stirbt: ${pos(a.ziel)}, Soll (neues Bett + 0,6) ${pos(sollA)}, Meldung "${a.meldung}"`);
    check('[1] Anna erwacht am NEUEN Bett, nicht am Weltspawn', !!a.ziel && gleich(a.ziel, sollA) && !gleich(a.ziel, weltSpawn2), pos(a.ziel));
    check('[1] keine Verlustmeldung', a.meldung === 'Du bist gestorben', a.meldung);
    check('[1] der Punkt ist mitgezogen', !!peer('Anna').spawnPoint && gleich(peer('Anna').spawnPoint!, sollA), pos(peer('Anna').spawnPoint));

    for (const n of ['Bjoern', 'Christa']) {
      const b = await tot(n);
      console.log(`      [${n === 'Bjoern' ? 2 : 3}] ${n} stirbt: ${pos(b.ziel)}, Meldung "${b.meldung}"`);
      check(`[${n === 'Bjoern' ? 2 : 3}] ${n} erwacht am Weltspawn`, !!b.ziel && gleich(b.ziel, weltSpawn2), pos(b.ziel));
      check(`[${n === 'Bjoern' ? 2 : 3}] ${n} erfaehrt, dass der Schlafplatz weg ist`, /Schlafplatz/.test(b.meldung), b.meldung);
      check(`[${n === 'Bjoern' ? 2 : 3}] der Punkt ist verworfen`, peer(n).spawnPoint === null, pos(peer(n).spawnPoint));
      const b2 = await tot(n);
      check(`[${n === 'Bjoern' ? 2 : 3}] beim naechsten Tod keine Wiederholung der Meldung`, b2.meldung === 'Du bist gestorben', b2.meldung);
    }
    for (const n of namen) kn[n]!.ws.close();
    await warte(300);
  } finally {
    try {
      server.stop();
    } catch {
      /* schon gestoppt */
    }
    await warte(300);
  }
  rmSync(TMP, { recursive: true, force: true });
  console.log(failures === 0 ? '\n=== ALL PASSED ===' : `\n=== ${failures} FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
