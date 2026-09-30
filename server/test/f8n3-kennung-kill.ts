/**
 * F8 N3 — Weltkennung, monotoner Stempel, deterministische Kill-Proben.
 *
 * ECHTE Serverprozesse, echtes SIGKILL, echter WebSocket-Spieler. Die Kill-Punkte sind KEIN Zufall: Die Kindprozesse laufen mit
 * `NODE_ENV=test` und `WOV_KILL_PUNKT=<Punkt>`, und der Server beendet sich selbst genau dort (util/TestHaken.ts; ohne
 * NODE_ENV=test tut der Haken nichts). Das sind die Proben killtxn/killsave2/killsave3 des Angriffs, deterministisch.
 *
 *   [T1] Testwelt hin und zurueck: dev-Stand und Testwelt-Stand bleiben getrennt (eigene Weltdatei, eigene Kennung)
 *   [T2] dev-Welt hart beendet, dann frische Testwelt: die dev-Truhe erscheint dort nicht; zurueck: dev-Stand komplett
 *   [T3] alte Weltdatei ohne Kennung: uebernimmt `<seed>|<modus>`, die vorhandenen Zeilen gehoeren ihr weiter
 *   [U]  Uhrsprung rueckwaerts UND vorwaerts: Summe bleibt (der Schiedsrichter ist eine Folgenummer)
 *   [K1] Kill IN der Transaktion (Spieler geschrieben, ZDOs noch nicht): nichts oder alles
 *   [K2] Kill zwischen Weltspeichern und Datei (synchron): Zeilen muessen stehen bleiben
 *   [K3] dasselbe asynchron
 *   [K4] Ereignis WAEHREND des asynchronen Weltspeicherns (nach dem Serialisieren): die Zeile darf das Wegraeumen nicht treffen
 *   [M]  Migration der alten Tabelle in EINER Transaktion: Kill mitten drin, danach vollstaendig migriert, nichts verloren
 *
 * Lauf: npx tsx test/f8n3-kennung-kill.ts   (aus server/)   Ephemerer Port, ~4 min.  Nur Teile: F8N3_NUR=k1,k2
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import WebSocket from 'ws';
import { findItem, getStableHash, packContainer, unpackContainer } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { erstelleHerunterfahren } from '../src/herunterfahren.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { antwortBerechnen, spielerIdErzeugen, tokenAusstellen } from '../src/net/Identitaet.js';
import { hakenRegistrieren } from '../src/util/TestHaken.js';
import { portVon } from '../../scripts/testport.mjs';

const DATEI = fileURLToPath(import.meta.url);
const SEED = 'KxSYuZquuw';
const GEHEIMNIS_HEX = 'ab'.repeat(32);
const RIESIG = 3_600_000;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, ContainerAction: 69, AuthChallenge: 68 };
const TRUHE = getStableHash('HolzTruhe');
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function laeuft(abschnitt: string): boolean {
  const nur = process.env.F8N3_NUR ?? '';
  return nur === '' || nur.toLowerCase().split(',').includes(abschnitt.toLowerCase());
}

// ── Kindmodus ────────────────────────────────────────────────────────
if (process.argv[2] === 'kind') {
  const worldsDir = process.argv[3]!;
  // Uhr, die sich per Kommando verschieben laesst (VOR createWovServer). Der Server darf davon nichts abhaengig machen.
  const echteUhr = Date.now.bind(Date);
  let versatz = 0;
  Date.now = () => echteUhr() + versatz;
  const server = createWovServer({
    port: 0,
    worldName: 'world',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    everyoneAdmin: true,
    worldsDir,
    kontenDir: resolve(worldsDir, 'konten'),
    saveIntervalMs: RIESIG,
    spielerSicherungMs: RIESIG, // nur Ereignisse und Stopp: jede Zeile hat einen benennbaren Grund
    sessionSecret: Buffer.from(GEHEIMNIS_HEX, 'hex'),
  });
  await server.start(); // wie main.ts: start() ruft init() selbst auf
  const fahreHerunter = erstelleHerunterfahren(server, (code) => process.exit(code));
  process.on('SIGTERM', fahreHerunter);
  console.log(`BEREIT ${portVon(server)}`);
  const alle = (hash: number) => server.zdos.getAllZDOs().filter((z) => z.prefabHash === hash);
  const holz = (n: number) => { const inv = unpackContainer('[]'); inv.addItem(findItem('Wood')!, n); return packContainer(inv); };
  const intern = server as unknown as { zustandWeltId: string; sichereSpielerSofort(peer: unknown, grund: string, welt: unknown[] | null): void };
  createInterface({ input: process.stdin }).on('line', (zeile) => {
    const [cmd, a, b, c] = zeile.split(' ');
    if (cmd === 'kiste') {
      const z = server.zdos.createZDO(TRUHE, { x: Number(a), y: 10, z: Number(b) }, { x: 0, y: 0, z: 0, w: 1 });
      z.setString('truheInhalt', holz(Number(c)));
      console.log('OK');
    } else if (cmd === 'uhr') {
      versatz += Number(a);
      console.log('OK');
    } else if (cmd === 'speichere') {
      server.saveWorld(); // beim Kill-Punkt kommt nie ein OK
      console.log('OK');
    } else if (cmd === 'speichereasync') {
      void server.saveWorldAsync().then(() => console.log('OK'));
    } else if (cmd === 'ereignis-im-speichern') {
      // Punkt "speichern-mitte": alle ZDOs sind serialisiert, die Datei noch nicht geschrieben. Genau dort nimmt der Spieler 5 Holz aus der
      // Truhe (Ereignis-Sicherung schreibt Spieler + Truhe); der Weltspeicher hat die Truhe mit dem ALTEN Inhalt.
      hakenRegistrieren('speichern-mitte', () => {
        hakenRegistrieren('speichern-mitte', null);
        const peer = server.net.getPeers().find((p) => !p.nurEditor && p.authenticated)!;
        const kiste = alle(TRUHE)[0]!;
        const inv = unpackContainer(kiste.getString('truheInhalt'));
        const n = inv.countOf('Wood');
        inv.removeByName('Wood', n);
        kiste.setString('truheInhalt', packContainer(inv));
        kiste.revision.reviseData();
        peer.inventar.addItem(findItem('Wood')!, n);
        intern.sichereSpielerSofort(peer, 'truhe', [kiste]);
      });
      void server.saveWorldAsync().then(() => console.log('OK'));
    } else if (cmd === 'stand') {
      const peer = server.net.getPeers().find((p) => !p.nurEditor && p.authenticated);
      console.log('STAND ' + JSON.stringify({
        da: !!peer,
        x: peer?.position.x,
        z: peer?.position.z,
        holz: peer?.inventar.countOf('Wood') ?? 0,
        kisten: alle(TRUHE).map((k) => ({ userId: k.zdoid.userId.toString(), id: k.zdoid.id, holz: unpackContainer(k.getString('truheInhalt')).countOf('Wood') })),
        weltId: intern.zustandWeltId,
      }));
    }
  });
  setInterval(() => {}, 1000);
} else {
  await haupt();
}

// ── Elternseite ──────────────────────────────────────────────────────

interface Standmeldung {
  da: boolean; x: number; z: number; holz: number;
  kisten: { userId: string; id: number; holz: number }[];
  weltId: string;
}
interface Kind {
  proc: ChildProcess;
  port: number;
  stand(): Promise<Standmeldung>;
  befehl(zeile: string): Promise<void>;
  beende(signal: NodeJS.Signals): Promise<number | null>;
  /** Wartet, bis der Prozess von selbst endet (Kill-Punkt); liefert Signal oder Exit-Code. */
  gestorben(ms: number): Promise<string | null>;
}

function starteKind(dir: string, killPunkt = ''): Promise<Kind> {
  return new Promise((ok, fehl) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', DATEI, 'kind', dir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', ...(killPunkt ? { WOV_KILL_PUNKT: killPunkt } : {}) },
    });
    let out = '';
    const stand: ((z: Standmeldung) => void)[] = [];
    const okWarte: (() => void)[] = [];
    let ende: string | null = null;
    const endeWarte: ((s: string) => void)[] = [];
    proc.once('exit', (code, signal) => {
      ende = signal ?? `exit ${code}`;
      for (const w of endeWarte) w(ende);
    });
    const kind: Kind = {
      proc, port: 0,
      stand: () => new Promise((r) => { stand.push(r); proc.stdin!.write('stand\n'); }),
      befehl: (zeile) => new Promise((r) => { okWarte.push(r); proc.stdin!.write(zeile + '\n'); }),
      beende: (signal) => new Promise((r) => { if (ende !== null) return r(null); proc.once('exit', (c) => r(c)); proc.kill(signal); }),
      gestorben: (ms) => new Promise((r) => {
        if (ende !== null) return r(ende);
        const t = setTimeout(() => r(null), ms);
        endeWarte.push((s) => { clearTimeout(t); r(s); });
      }),
    };
    const timer = setTimeout(() => { proc.kill('SIGKILL'); fehl(new Error('Kind nicht bereit:\n' + out)); }, 120_000);
    let bereit = false;
    const beiDaten = (d: Buffer) => {
      out += d.toString();
      const m = /BEREIT (\d+)/.exec(out);
      if (m && !bereit) { bereit = true; clearTimeout(timer); kind.port = Number(m[1]); ok(kind); }
      for (const zeile of d.toString().split('\n')) {
        if (zeile.startsWith('STAND ')) stand.shift()?.(JSON.parse(zeile.slice(6)));
        else if (zeile === 'OK') okWarte.shift()?.();
      }
    };
    proc.stdout!.on('data', beiDaten);
    proc.stderr!.on('data', beiDaten);
    // Ein Kind, das vor BEREIT stirbt (Kill-Punkt beim Start), ist ein gueltiges Ergebnis: gestorben() liefert das Signal.
    proc.once('exit', () => { if (!bereit) { clearTimeout(timer); ok(kind); } });
  });
}

function verbinde(port: number, token: string, name = 'Anna'): Promise<WebSocket> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let auth = false;
    const t = setTimeout(() => fail(new Error('Handshake')), 15_000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString(token);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) { clearTimeout(t); ok(ws); }
    });
    ws.on('error', fail);
  });
}

function admin(ws: WebSocket, zeile: string): void {
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), new Writer().writeString(zeile).toBuffer()]));
}
function truhe(ws: WebSocket, k: { userId: string; id: number }, richtung: 0 | 1, item: string, menge: number): void {
  ws.send(Buffer.concat([Buffer.from([P.ContainerAction]), new Writer().writeString(k.userId).writeInt32(k.id).writeInt32(richtung).writeString(item).writeInt32(menge).toBuffer()]));
}

function sql<T>(dir: string, text: string): T[] {
  const pfad = resolve(dir, 'konten/world.db');
  if (!existsSync(pfad)) return [];
  const db = new DatabaseSync(pfad, { readOnly: true });
  try { return db.prepare(text).all() as unknown as T[]; } catch { return []; } finally { db.close(); }
}
function weltdatei(dir: string, name = 'world.db.zst'): { meta: { weltId?: string; stempel?: number }; players: { gespeichertAm?: number }[]; zdos: unknown[] } {
  return JSON.parse(zstdDecompressSync(readFileSync(resolve(dir, name))).toString('utf-8'));
}

async function haupt(): Promise<void> {
  let failures = 0;
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
    else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); failures++; }
  };

  const WURZEL = resolve(tmpdir(), `f8n3-${process.pid}`);
  rmSync(WURZEL, { recursive: true, force: true });
  const pids: number[] = [];
  const spielerId = spielerIdErzeugen();
  const token = tokenAusstellen(spielerId, 4711n, Buffer.from(GEHEIMNIS_HEX, 'hex'));
  const neu = async (dir: string, killPunkt = ''): Promise<Kind> => {
    const k = await starteKind(dir, killPunkt);
    pids.push(k.proc.pid!);
    return k;
  };
  /** Welt mit einer Truhe (5 Holz) im Weltspeicher (sauberer Stopp). */
  const vorbereite = async (name: string): Promise<string> => {
    const dir = resolve(WURZEL, name);
    mkdirSync(dir, { recursive: true });
    const k = await neu(dir);
    await k.befehl('kiste 120 340 5');
    const code = await k.beende('SIGTERM');
    if (code !== 0 || !existsSync(resolve(dir, 'world.db.zst'))) throw new Error(`Vorbereitung ${name}: Exit ${code}`);
    return dir;
  };
  /** Kind starten, Spieler verbinden, neben die Truhe stellen, +4 Holz (Startwert Holz `h0` wird vorher gemessen). */
  const spiel = async (dir: string, killPunkt = '') => {
    const k = await neu(dir, killPunkt);
    const ws = await verbinde(k.port, token);
    await warte(300);
    const h0 = (await k.stand()).holz;
    admin(ws, 'teleport 120 340');
    admin(ws, 'item give Wood 4');
    await warte(500);
    return { k, ws, h0, s0: await k.stand() };
  };
  const summe = (s: Standmeldung) => s.holz + s.kisten.reduce((a, k) => a + k.holz, 0);
  const neustart = async (dir: string) => {
    const k = await neu(dir);
    const ws = await verbinde(k.port, token);
    await warte(300);
    return { k, ws, s: await k.stand() };
  };

  try {
    console.log('=== F8 N3 Weltkennung, Stempel, Kill-Punkte ===');

    console.log('\n[T1] Testwelt hin und zurueck (Weltdatei wandert beiseite wie bei /api/testwelt, die Kontendatenbank bleibt):');
    if (laeuft('t1')) {
      const dir = resolve(WURZEL, 't1');
      mkdirSync(dir, { recursive: true });
      const k1 = await neu(dir);
      const ws1 = await verbinde(k1.port, token);
      admin(ws1, 'teleport 120 340'); admin(ws1, 'item give Wood 4');
      await warte(500);
      const dev0 = await k1.stand();
      ws1.terminate(); await warte(400);
      await k1.beende('SIGTERM');
      const kennungDev = weltdatei(dir).meta.weltId;
      renameSync(resolve(dir, 'world.db.zst'), resolve(dir, 'world.db.zst.beiseite'));
      const k2 = await neu(dir);
      const ws2 = await verbinde(k2.port, token);
      await warte(400);
      const t0 = await k2.stand();
      check('Testwelt: Spieler beginnt FRISCH (nicht mit dem dev-Stand)', !(Math.abs(t0.x - 120) < 1 && t0.holz === dev0.holz), `x=${t0.x} holz=${t0.holz} (dev: x=${dev0.x} holz=${dev0.holz})`);
      check('Testwelt hat eine EIGENE Kennung', !!t0.weltId && t0.weltId !== kennungDev, `${t0.weltId} gegen ${kennungDev}`);
      admin(ws2, 'teleport 500 500'); admin(ws2, 'item give Wood 100');
      await warte(500);
      ws2.terminate(); await warte(400);
      await k2.beende('SIGTERM');
      renameSync(resolve(dir, 'world.db.zst'), resolve(dir, 'testwelt.db.zst'));
      renameSync(resolve(dir, 'world.db.zst.beiseite'), resolve(dir, 'world.db.zst'));
      const d3 = await neustart(dir);
      check('dev-Welt zurueck: Spieler wie vor der Testwelt (Position + Inventar)', Math.abs(d3.s.x - 120) < 1 && d3.s.holz === dev0.holz, `x=${d3.s.x} holz=${d3.s.holz} (vorher x=${dev0.x} holz=${dev0.holz})`);
      check('dev-Kennung unveraendert', d3.s.weltId === kennungDev);
      const zeilen = sql<{ welt_id: string }>(dir, 'SELECT welt_id FROM spielerzustand');
      check('zwei Zeilen unter zwei Kennungen (dev + Testwelt)', new Set(zeilen.map((z) => z.welt_id)).size === 2, zeilen.map((z) => z.welt_id).join(' | '));
      d3.ws.terminate(); await d3.k.beende('SIGKILL');
    }

    console.log('\n[T2] dev hart beendet, frische Testwelt, dann zurueck:');
    if (laeuft('t2')) {
      const dir = await vorbereite('t2');
      const { k, ws, h0, s0 } = await spiel(dir);
      truhe(ws, s0.kisten[0]!, 0, 'Wood', 5);
      await warte(400);
      await k.beende('SIGKILL'); ws.terminate();
      check('Zeilen der dev-Welt stehen (Truhe + Spieler)', sql(dir, 'SELECT 1 FROM weltzdo').length >= 1 && sql(dir, 'SELECT 1 FROM spielerzustand').length === 1);
      renameSync(resolve(dir, 'world.db.zst'), resolve(dir, 'world.db.zst.beiseite'));
      const tw = await neu(dir);
      const wsT = await verbinde(tw.port, token);
      await warte(300);
      const t = await tw.stand();
      check('frische Testwelt enthaelt KEINE Truhe der dev-Welt', t.kisten.length === 0, `${t.kisten.length} Truhe(n)`);
      wsT.terminate(); await warte(300);
      await tw.beende('SIGTERM'); // Testwelt speichert und raeumt SEINE Zeilen weg
      renameSync(resolve(dir, 'world.db.zst'), resolve(dir, 'testwelt.db.zst'));
      renameSync(resolve(dir, 'world.db.zst.beiseite'), resolve(dir, 'world.db.zst'));
      const d = await neustart(dir);
      check('dev zurueck: Truhe leer UND Inventar +5 (Zeilen der dev-Welt ueberlebten die Testwelt)', d.s.kisten[0]?.holz === 0 && d.s.holz === s0.holz + 5, `truhe=${d.s.kisten[0]?.holz} inv=${d.s.holz} (Start ${h0}, vor Nehmen ${s0.holz})`);
      d.ws.terminate(); await d.k.beende('SIGKILL');
    }

    console.log('\n[T3] alte Weltdatei ohne Kennung uebernimmt <seed>|<modus>:');
    if (laeuft('t3')) {
      const dir = resolve(WURZEL, 't3');
      mkdirSync(dir, { recursive: true });
      const k = await neu(dir);
      const ws = await verbinde(k.port, token);
      admin(ws, 'teleport 250 260'); admin(ws, 'item give Wood 6');
      await warte(500);
      const s0 = await k.stand();
      ws.terminate(); await warte(400);
      await k.beende('SIGTERM');
      // Zustand vor N3 nachstellen: Datei ohne Kennung, Zeilen unter `<seed>|<modus>` (das war die welt_id von N2).
      const doc = weltdatei(dir);
      delete doc.meta.weltId;
      delete doc.meta.stempel;
      writeFileSync(resolve(dir, 'world.db.zst'), zstdCompressSync(Buffer.from(JSON.stringify(doc), 'utf-8')));
      const db = new DatabaseSync(resolve(dir, 'konten/world.db'));
      db.prepare('UPDATE spielerzustand SET welt_id = ?').run(`${SEED}|radial`);
      db.close();
      // Der Weltspeicher darf den Spieler NICHT mehr tragen, sonst zeigt der Test nicht, dass die Zeile gebraucht wird.
      const d2 = weltdatei(dir);
      d2.players = [];
      writeFileSync(resolve(dir, 'world.db.zst'), zstdCompressSync(Buffer.from(JSON.stringify(d2), 'utf-8')));
      const n = await neustart(dir);
      check('Spielerstand aus der alten Zeile da (Position + Inventar)', Math.abs(n.s.x - 250) < 1 && n.s.holz === s0.holz, `x=${n.s.x} holz=${n.s.holz} (vorher ${s0.holz})`);
      check('die Welt uebernahm die alte Kennung', n.s.weltId === `${SEED}|radial`, n.s.weltId);
      n.ws.terminate(); await n.k.beende('SIGKILL');
      check('die Weltdatei traegt jetzt die Kennung (beim Start geschrieben)', weltdatei(dir).meta.weltId === `${SEED}|radial`);
    }

    console.log('\n[U] Uhrsprung (Date.now im Kind verschoben): die Folgenummer entscheidet, nicht die Uhr:');
    if (laeuft('u')) {
      for (const [name, versatz] of [['rueckwaerts', -3_600_000], ['vorwaerts', 3_600_000]] as const) {
        const dir = await vorbereite(`u-${name}`);
        const { k, ws, s0 } = await spiel(dir);
        await k.befehl('speichere'); // Spielerstand im Weltspeicher (mit Stempel), Zeilen weggeraeumt
        await k.befehl(`uhr ${versatz}`);
        truhe(ws, s0.kisten[0]!, 0, 'Wood', 5);
        await warte(500);
        await k.beende('SIGKILL'); ws.terminate();
        const n = await neustart(dir);
        check(`Uhr ${name}: nach Kill Summe gleich`, summe(n.s) === summe(s0), `${summe(s0)} -> ${summe(n.s)} (truhe ${n.s.kisten[0]?.holz}, inv ${n.s.holz})`);
        n.ws.terminate(); await n.k.beende('SIGKILL');
      }
    }

    console.log('\n[K1] Kill IN der Transaktion (Spielerzeile geschrieben, ZDO-Zeilen noch nicht):');
    if (laeuft('k1')) {
      const dir = await vorbereite('k1');
      const { k, ws, h0, s0 } = await spiel(dir, 'txn-mitte');
      truhe(ws, s0.kisten[0]!, 0, 'Wood', 5);
      const ende = await k.gestorben(20_000);
      check('der Server starb am Kill-Punkt (SIGKILL)', ende === 'SIGKILL', String(ende));
      ws.terminate();
      const n = await neustart(dir);
      check('nichts oder alles: Truhe 5 UND Inventar ohne +5 (nichts wurde geschrieben)', n.s.kisten[0]?.holz === 5 && n.s.holz === h0, `truhe=${n.s.kisten[0]?.holz} inv=${n.s.holz} (Start ${h0})`);
      n.ws.terminate(); await n.k.beende('SIGKILL');
    }

    for (const [tag, cmd, beschr] of [['k2', 'speichere', 'synchron'], ['k3', 'speichereasync', 'asynchron']] as const) {
      console.log(`\n[${tag.toUpperCase()}] Kill zwischen Weltspeichern und Datei (${beschr}): die Zeilen muessen stehen bleiben:`);
      if (laeuft(tag)) {
        const dir = await vorbereite(tag);
        const { k, ws, s0 } = await spiel(dir, 'speichern-vor-datei');
        truhe(ws, s0.kisten[0]!, 0, 'Wood', 5);
        await warte(400);
        check('vor dem Speichern: Zeilen da (Spieler + Truhe)', sql(dir, 'SELECT 1 FROM spielerzustand').length === 1 && sql(dir, 'SELECT 1 FROM weltzdo').length >= 1);
        k.proc.stdin!.write(cmd + '\n');
        const ende = await k.gestorben(20_000);
        check('der Server starb vor dem Schreiben der Datei', ende === 'SIGKILL', String(ende));
        ws.terminate();
        const n = await neustart(dir);
        check('Summe gleich, Truhe leer UND Inventar +5 (keine Verdopplung)', summe(n.s) === summe(s0) && n.s.kisten[0]?.holz === 0 && n.s.holz === s0.holz + 5, `${summe(s0)} -> ${summe(n.s)} (truhe ${n.s.kisten[0]?.holz}, inv ${n.s.holz})`);
        n.ws.terminate(); await n.k.beende('SIGKILL');
      }
    }

    console.log('\n[K4] Ereignis WAEHREND des asynchronen Weltspeicherns, danach Kill:');
    if (laeuft('k4')) {
      const dir = await vorbereite('k4');
      const { k, ws, s0 } = await spiel(dir);
      await k.befehl('ereignis-im-speichern'); // OK kommt, wenn der Weltspeicher UND das Wegraeumen durch sind
      const zw = sql<{ daten: string | null }>(dir, 'SELECT daten FROM weltzdo');
      check('die waehrend des Speicherns geschriebene Truhen-Zeile steht noch (Wegraeumen traf sie nicht)', zw.length === 1, `${zw.length} Zeile(n)`);
      const datei = weltdatei(dir);
      check('die Datei traegt die Truhe mit dem alten Inhalt (Ereignis kam nach dem Serialisieren)', datei.zdos.length >= 1);
      await k.beende('SIGKILL'); ws.terminate();
      const n = await neustart(dir);
      check('nach dem Kill: Summe gleich, Truhe leer UND Inventar +5', summe(n.s) === summe(s0) && n.s.kisten[0]?.holz === 0 && n.s.holz === s0.holz + 5, `${summe(s0)} -> ${summe(n.s)} (truhe ${n.s.kisten[0]?.holz}, inv ${n.s.holz})`);
      n.ws.terminate(); await n.k.beende('SIGKILL');
    }

    console.log('\n[M] Migration der alten Tabelle in EINER Transaktion, Kill mitten drin:');
    if (laeuft('m')) {
      const dir = resolve(WURZEL, 'm');
      mkdirSync(dir, { recursive: true });
      const k0 = await neu(dir);
      await k0.beende('SIGTERM'); // Schema anlegen
      const db = new DatabaseSync(resolve(dir, 'konten/world.db'));
      db.exec('DROP TABLE spielerzustand');
      db.exec('CREATE TABLE spielerzustand (spieler_id TEXT PRIMARY KEY COLLATE NOCASE, welt_id TEXT NOT NULL, stand INTEGER NOT NULL, daten TEXT NOT NULL)');
      for (let i = 1; i <= 6; i++) db.prepare('INSERT INTO spielerzustand VALUES (?, ?, ?, ?)').run(`sp_${i}`, i === 6 ? 'x|1234' : `${SEED}|radial`, 100 + i, '{"name":"n"}');
      db.close();
      const kk = await neu(dir, 'migration-mitte');
      const ende = await kk.gestorben(20_000);
      check('der Server starb mitten in der Migration (SIGKILL)', ende === 'SIGKILL', String(ende));
      const tabellen = sql<{ name: string }>(dir, "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'spielerzustand%' ORDER BY name").map((t) => t.name);
      check('nach dem Kill steht die alte Tabelle unberuehrt da (kein Rest `spielerzustand_alt`, nichts halb umgebaut)', tabellen.join() === 'spielerzustand' && sql(dir, 'SELECT 1 FROM spielerzustand').length === 6, tabellen.join());
      const k2 = await neu(dir);
      await k2.beende('SIGTERM');
      const spalten = sql<{ name: string; pk: number }>(dir, 'PRAGMA table_info(spielerzustand)');
      check('danach vollstaendig migriert: 6 Zeilen, Schluessel (spieler_id, welt_id)', sql(dir, 'SELECT 1 FROM spielerzustand').length === 6 && spalten.filter((c) => c.pk > 0).length === 2, JSON.stringify(spalten.map((c) => c.name + c.pk)));
      check('keine Restdatei `spielerzustand_alt`', !sql<{ name: string }>(dir, "SELECT name FROM sqlite_master WHERE name = 'spielerzustand_alt'").length);
    }
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* schon weg */ } }
    await warte(300);
    rmSync(WURZEL, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.error(`\n${failures} Pruefung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Pruefungen bestanden');
  process.exit(0);
}
