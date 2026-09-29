/**
 * F8 N2 — Truhen, Bauten und Inventar im selben Schreibvorgang; welt_id; Takt-Klemme; Offline-Stempel; Stopp.
 *
 * ECHTE Serverprozesse mit echtem SIGKILL und ein echter WebSocket-Spieler (Sitzungstoken, damit er nach dem Neustart dieselbe
 * spielerId hat). Die Truhe entsteht im Kindprozess (Kommando `kiste`) und kommt per sauberem Stopp in den Weltspeicher; danach
 * beginnt der eigentliche Lauf. Was der F8-Angriff (B1) gezeigt hat: Inventar steht alle <= 30 s in der SQLite, Truheninhalt nur im
 * Weltspeicher (30 min) — nach einem Kill sind beide von verschiedenen Zeitpunkten. Jede Summe hier ist "Inventar + Truhe".
 *
 *   [P1] aus der Truhe nehmen, Takt, Kill: Summe gleich, Truhe leer, Inventar +5
 *   [P2] in die Truhe legen, Takt, Kill: nichts weg
 *   [B1] Bauen (KI-Kiefer) und Abreissen (Teil aus dem Weltspeicher): Material und Bauteil zusammen
 *   [T]  Kill zwischen zwei Takten: nichts wurde geschrieben, beide Seiten stehen auf dem alten Stand (Summe gleich);
 *        nach einem Takt stehen beide Seiten auf dem neuen (Summe gleich)
 *   [E]  Ereignis: Takt 1 h, Truhe nehmen, Kill 300 ms spaeter: Fortschritt beider Seiten ist da
 *   [E2] dasselbe fuer Bauen und Abreissen
 *   [B2] welt_id: Layout im Editor geaendert (Datei), Kill, Neustart: Spielerstand da; Zeilen einer anderen Welt werden ignoriert, nicht geloescht
 *   [B3] world.player-save-interval: 0s, -5s, 600h, 30, abc, 10s, fehlend
 *   [B4] Admin-Eingriff an einem abwesenden Spieler ueberstimmt eine Zeile mit juengerem Stempel
 *   [B5] Stopp schreibt eine letzte Zeile (Takt 1 h, kein Ereignis, SIGTERM)
 *
 * Lauf: npx tsx test/f8n2-truhen-takt.ts   (aus server/)   Ephemerer Port, ~2-3 min.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { findItem, getStableHash, packContainer, unpackContainer } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { ZDO } from '../src/zdo/ZDO.js';
import { ueberlagern } from '../src/spiel/WeltZdoSicherung.js';
import { erstelleHerunterfahren } from '../src/herunterfahren.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { antwortBerechnen, spielerIdErzeugen, tokenAusstellen } from '../src/net/Identitaet.js';
import { portVon } from '../../scripts/testport.mjs';

const DATEI = fileURLToPath(import.meta.url);
const SEED = 'KxSYuZquuw';
const GEHEIMNIS_HEX = 'ab'.repeat(32);
const RIESIG = 3_600_000;
const TAKT = 1500;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, PlacePiece: 55, RemovePiece: 56, ContainerAction: 69, AuthChallenge: 68 };
const TRUHE = getStableHash('HolzTruhe');
// KiPine2: baubar (BAU_PREFABS, ohne Assets), persistent, kostet 1 Holz und gibt beim Abreissen nichts zurueck (halbe Kosten abgerundet).
const WAND = getStableHash('KiPine2');
/** F8N2_NUR=e2,b4: nur diese Abschnitte fahren (Fehlersuche); ohne Angabe laufen alle. */
function laeuft(abschnitt: string): boolean {
  const nur = process.env.F8N2_NUR ?? '';
  return nur === '' || nur.toLowerCase().split(',').includes(abschnitt.toLowerCase());
}
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Kindmodus ────────────────────────────────────────────────────────
if (process.argv[2] === 'kind') {
  const worldsDir = process.argv[3]!;
  const intervall = Number(process.argv[4]);
  const modus = process.argv[5] === 'layout' ? 'layout' : 'radial';
  const layoutPfad = process.argv[6] ?? '';
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
    saveIntervalMs: RIESIG, // der Weltspeicher tickt im Test nie
    spielerSicherungMs: intervall,
    sessionSecret: Buffer.from(GEHEIMNIS_HEX, 'hex'),
    ...(modus === 'layout' ? { worldMode: 'layout' as const, worldLayoutPath: layoutPfad } : {}),
  });
  server.init();
  server.start();
  const fahreHerunter = erstelleHerunterfahren(server, (code) => process.exit(code));
  process.on('SIGTERM', fahreHerunter);
  console.log(`BEREIT ${portVon(server)}`);
  // getZDOByPrefab liefert nach start() verwaiste Doppelgaenger (auch auf main): ueber die ID-Tabelle zaehlen.
  const alle = (hash: number) => server.zdos.getAllZDOs().filter((z) => z.prefabHash === hash);
  const holz = (n: number) => { const inv = unpackContainer('[]'); inv.addItem(findItem('Wood')!, n); return packContainer(inv); };
  createInterface({ input: process.stdin }).on('line', (zeile) => {
    const [cmd, a, b, c] = zeile.split(' ');
    if (cmd === 'kiste') {
      const z = server.zdos.createZDO(TRUHE, { x: Number(a), y: 10, z: Number(b) }, { x: 0, y: 0, z: 0, w: 1 });
      z.setString('truheInhalt', holz(Number(c)));
      console.log('OK');
    } else if (cmd === 'bau') {
      const z = server.zdos.createZDO(WAND, { x: Number(a), y: 10, z: Number(b) }, { x: 0, y: 0, z: 0, w: 1 });
      z.setInt('spieler', 1);
      console.log('OK');
    } else if (cmd === 'tausche') {
      // Truhe -> Inventar in EINEM synchronen Schritt, ohne Ereignis-Sicherung (nur der Takt sieht es).
      const peer = server.net.getPeers().find((p) => !p.nurEditor && p.authenticated)!;
      const kiste = alle(TRUHE)[0]!;
      const inv = unpackContainer(kiste.getString('truheInhalt'));
      const n = inv.countOf('Wood');
      inv.removeByName('Wood', n);
      kiste.setString('truheInhalt', packContainer(inv));
      kiste.revision.reviseData();
      peer.inventar.addItem(findItem('Wood')!, n);
      console.log('OK');
    } else if (cmd === 'stand') {
      const peer = server.net.getPeers().find((p) => !p.nurEditor && p.authenticated);
      const kisten = alle(TRUHE).map((k) => ({
        userId: k.zdoid.userId.toString(),
        id: k.zdoid.id,
        holz: unpackContainer(k.getString('truheInhalt')).countOf('Wood'),
      }));
      console.log('STAND ' + JSON.stringify({
        da: !!peer,
        x: peer?.position.x,
        z: peer?.position.z,
        holz: peer?.inventar.countOf('Wood') ?? 0,
        eisenteile: peer?.inventar.countOf('IronwardHelmet') ?? 0,
        kisten,
        waende: alle(WAND).length, waendeX: alle(WAND).map((z) => Math.round(z.position.x)),
      }));
    }
  });
  setInterval(() => {}, 1000);
} else {
  await haupt();
}

// ── Elternseite ──────────────────────────────────────────────────────

interface Standmeldung {
  da: boolean; x: number; z: number; holz: number; eisenteile: number;
  kisten: { userId: string; id: number; holz: number }[];
  waende: number;
  waendeX: number[];
}
interface Kind {
  proc: ChildProcess;
  port: number;
  stand(): Promise<Standmeldung>;
  befehl(zeile: string): Promise<void>;
  beende(signal: NodeJS.Signals): Promise<number | null>;
}

function starteKind(dir: string, intervallMs: number, modus = 'radial', layoutPfad = ''): Promise<Kind> {
  return new Promise((ok, fehl) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', DATEI, 'kind', dir, String(intervallMs), modus, layoutPfad], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const stand: ((z: Standmeldung) => void)[] = [];
    const okWarte: (() => void)[] = [];
    const timer = setTimeout(() => { proc.kill('SIGKILL'); fehl(new Error('Kind nicht bereit:\n' + out)); }, 120_000);
    let bereit = false;
    const beiDaten = (d: Buffer) => {
      out += d.toString();
      const m = /BEREIT (\d+)/.exec(out);
      if (m && !bereit) {
        bereit = true;
        clearTimeout(timer);
        ok({
          proc,
          port: Number(m[1]),
          stand: () => new Promise((r) => { stand.push(r); proc.stdin!.write('stand\n'); }),
          befehl: (zeile) => new Promise((r) => { okWarte.push(r); proc.stdin!.write(zeile + '\n'); }),
          beende: (signal) => new Promise((r) => { proc.once('exit', (c) => r(c)); proc.kill(signal); }),
        });
      }
      for (const zeile of d.toString().split('\n')) {
        if (zeile.startsWith('STAND ')) stand.shift()?.(JSON.parse(zeile.slice(6)));
        else if (zeile === 'OK') okWarte.shift()?.();
      }
    };
    proc.stdout!.on('data', beiDaten);
    if (process.env.F8N2_KINDLOG) proc.stdout!.on('data', (d: Buffer) => process.stderr.write(d));
    proc.stderr!.on("data", beiDaten);
    if (process.env.F8N2_KINDLOG) proc.stderr!.on("data", (d: Buffer) => process.stderr.write(d));
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

async function haupt(): Promise<void> {
  let failures = 0;
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
    else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); failures++; }
  };

  const WURZEL = resolve(tmpdir(), `f8n2-truhen-${process.pid}`);
  rmSync(WURZEL, { recursive: true, force: true });
  const pids: number[] = [];
  const spielerId = spielerIdErzeugen();
  const token = tokenAusstellen(spielerId, 4711n, Buffer.from(GEHEIMNIS_HEX, 'hex'));
  const neu = async (dir: string, intervall: number, modus = 'radial', layout = ''): Promise<Kind> => {
    const k = await starteKind(dir, intervall, modus, layout);
    pids.push(k.proc.pid!);
    return k;
  };
  /** Welt mit einer Truhe (5 Holz) und einer Wand im Weltspeicher (sauberer Stopp) vorbereiten. */
  const vorbereite = async (name: string): Promise<string> => {
    const dir = resolve(WURZEL, name);
    mkdirSync(dir, { recursive: true });
    const k = await neu(dir, RIESIG);
    await k.befehl('kiste 120 340 5');
    await k.befehl('bau 124 340');
    const code = await k.beende('SIGTERM');
    if (code !== 0 || !existsSync(resolve(dir, 'world.db.zst'))) throw new Error(`Vorbereitung ${name}: Exit ${code}`);
    return dir;
  };
  /** Kind starten, Spieler verbinden und neben die Truhe stellen. */
  const spiel = async (dir: string, takt: number) => {
    const k = await neu(dir, takt);
    const ws = await verbinde(k.port, token);
    admin(ws, 'teleport 120 340');
    admin(ws, 'item give Wood 4');
    await warte(500);
    return { k, ws, s0: await k.stand() };
  };
  const summe = (s: Standmeldung) => s.holz + s.kisten.reduce((a, k) => a + k.holz, 0);

  try {
    console.log('=== F8 N2 Truhen und Bauten im selben Takt ===');

    console.log('\n[P1] Aus der Truhe nehmen, Takt, SIGKILL:');
    if (laeuft('P1')) {
      const dir = await vorbereite('p1');
      const { k, ws, s0 } = await spiel(dir, TAKT);
      const kiste = s0.kisten[0]!;
      check('Ausgangslage: Truhe traegt 5 Holz', kiste.holz === 5, `truhe=${kiste.holz} inventar=${s0.holz}`);
      truhe(ws, kiste, 0, 'Wood', 5);
      await warte(TAKT + 1500);
      const s1 = await k.stand();
      check('vor dem Kill: Truhe leer, Inventar +5', s1.kisten[0]!.holz === 0 && s1.holz === s0.holz + 5);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('nach Kill+Neustart: Summe gleich (keine Verdopplung)', summe(s2) === summe(s0), `vorher ${summe(s0)}, nachher ${summe(s2)} (inventar ${s2.holz}, truhe ${s2.kisten[0]?.holz})`);
      check('nach Kill+Neustart: Truhe leer UND Inventar +5', s2.kisten[0]?.holz === 0 && s2.holz === s0.holz + 5);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[P2] In die Truhe legen, Takt, SIGKILL:');
    if (laeuft('P2')) {
      const dir = await vorbereite('p2');
      const { k, ws, s0 } = await spiel(dir, TAKT);
      const kiste = s0.kisten[0]!;
      truhe(ws, kiste, 1, 'Wood', 4);
      await warte(TAKT + 1500);
      const s1 = await k.stand();
      check('vor dem Kill: Truhe 9, Inventar -4', s1.kisten[0]!.holz === 9 && s1.holz === s0.holz - 4, `truhe=${s1.kisten[0]!.holz} inv=${s1.holz}`);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('nach Kill+Neustart: Summe gleich (nichts weg)', summe(s2) === summe(s0), `vorher ${summe(s0)}, nachher ${summe(s2)} (inventar ${s2.holz}, truhe ${s2.kisten[0]?.holz})`);
      check('nach Kill+Neustart: Truhe 9 UND Inventar -4', s2.kisten[0]?.holz === 9 && s2.holz === s0.holz - 4);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[B1] Bauen und Abreissen, Takt, SIGKILL:');
    if (laeuft('B1')) {
      const dir = await vorbereite('bau');
      const { k, ws, s0 } = await spiel(dir, TAKT);
      check('Ausgangslage: ein Bauteil (x=124) im Weltspeicher', s0.waende === 1 && s0.waendeX[0] === 124, `${s0.waendeX}`);
      ws.send(Buffer.concat([Buffer.from([P.PlacePiece]), new Writer().writeInt32(WAND).writeVector3({ x: 118, y: 10, z: 340 }).writeQuaternion({ x: 0, y: 0, z: 0, w: 1 }).toBuffer()]));
      await warte(300);
      ws.send(Buffer.concat([Buffer.from([P.RemovePiece]), new Writer().writeVector3({ x: 124, y: 10, z: 340 }).toBuffer()]));
      await warte(TAKT + 1500);
      const s1 = await k.stand();
      check('vor dem Kill: neues Teil (x=118) da, altes (x=124) weg, Holz -1', s1.waendeX.join() === '118' && s1.holz === s0.holz - 1, `x=${s1.waendeX} holz=${s1.holz} (start ${s0.holz})`);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('nach Kill+Neustart: Material und Bauteile zusammen (nur x=118, Holz -1)', s2.waendeX.join() === '118' && s2.holz === s0.holz - 1, `x=${s2.waendeX} holz=${s2.holz}`);
      const wandZeilen = sql<{ daten: string | null }>(dir, 'SELECT daten FROM weltzdo');
      check('die Zeilen stehen in der Tabelle weltzdo (neues Teil + Grabstein des alten)', wandZeilen.length >= 2 && wandZeilen.some((z) => z.daten === null), `${wandZeilen.length} Zeile(n)`);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[T] Kill zwischen zwei Takten / nach einem Takt (Aenderung ohne Ereignis):');
    if (laeuft('T')) {
      const dir = await vorbereite('t1');
      const { k, ws, s0 } = await spiel(dir, RIESIG);
      await k.befehl('tausche');
      await warte(200);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('Kill VOR dem naechsten Takt: beide Seiten auf dem alten Stand (Truhe 5, Inventar ohne +5)', s2.kisten[0]?.holz === 5 && s2.holz <= s0.holz, `inventar=${s2.holz} (vor tausche ${s0.holz}) truhe=${s2.kisten[0]?.holz}`);
      ws2.terminate(); await k2.beende('SIGKILL');
    }
    if (laeuft('T')) {
      const dir = await vorbereite('t2');
      const { k, ws, s0 } = await spiel(dir, TAKT);
      await k.befehl('tausche');
      await warte(TAKT + 1500);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('Kill NACH einem Takt: Summe gleich', summe(s2) === summe(s0), `vorher ${summe(s0)}, nachher ${summe(s2)}`);
      check('… und beide Seiten stehen auf dem neuen Stand (Truhe 0, Inventar +5)', s2.kisten[0]?.holz === 0 && s2.holz === s0.holz + 5);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[E] Ereignis: Takt 1 h, Truhe nehmen, SIGKILL 300 ms danach:');
    if (laeuft('E')) {
      const dir = await vorbereite('e');
      const { k, ws, s0 } = await spiel(dir, RIESIG);
      truhe(ws, s0.kisten[0]!, 0, 'Wood', 5);
      await warte(300);
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('Fortschritt beider Seiten da (Truhe 0, Inventar +5)', s2.kisten[0]?.holz === 0 && s2.holz === s0.holz + 5, `truhe=${s2.kisten[0]?.holz} inv=${s2.holz} (start ${s0.holz})`);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[E2] Ereignis Bauen/Abreissen: Takt 1 h, SIGKILL 300 ms danach:');
    if (laeuft('E2')) {
      const dir = await vorbereite('e2');
      const { k, ws, s0 } = await spiel(dir, RIESIG);
      ws.send(Buffer.concat([Buffer.from([P.PlacePiece]), new Writer().writeInt32(WAND).writeVector3({ x: 118, y: 10, z: 340 }).writeQuaternion({ x: 0, y: 0, z: 0, w: 1 }).toBuffer()]));
      await warte(300);
      ws.send(Buffer.concat([Buffer.from([P.RemovePiece]), new Writer().writeVector3({ x: 124, y: 10, z: 340 }).toBuffer()]));
      await warte(300);
      const sVor = await k.stand();
      const zeilenVorKill = sql<{ zdo_id: string; daten: string | null }>(dir, 'SELECT zdo_id, daten FROM weltzdo').map((z) => `${z.zdo_id}:${z.daten === null ? 'weg' : 'da'}`).join(' ');
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('Bauen + Abreissen ohne Takt: neues Teil da, altes weg, Holz -1', s2.waendeX.join() === '118' && s2.holz === s0.holz - 1, `x=${s2.waendeX} holz=${s2.holz} (start ${s0.holz}), vor dem Kill x=${sVor.waendeX}, Zeilen vor dem Kill: ${zeilenVorKill}`);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[I] Index der Spielerbauten (F2) nach Laden und Ueberlagern = Vollscan:');
    if (laeuft('I')) {
      const dir = resolve(WURZEL, 'index');
      mkdirSync(dir, { recursive: true });
      const mk = () => createWovServer({ port: 0, worldName: 'world', worldSeed: SEED, worldFeatures: false, worldVegetation: false, worldCreatures: false, dungeonsEnabled: false, worldsDir: dir, kontenDir: resolve(dir, 'konten') });
      const a = mk(); a.init();
      const x = a.zdos.createZDO(WAND, { x: 5, y: 1, z: 5 }); x.setInt('spieler', 1);
      const x2 = a.zdos.createZDO(WAND, { x: 9, y: 1, z: 5 }); x2.setInt('spieler', 1);
      a.saveWorld();
      const b = mk(); b.init();
      b.zdos.spielerbauten(); // Index bauen, DANACH ueberlagern
      const echtes = b.zdos.getAllZDOs().find((z) => z.position.x === 5)!;
      const ersatz = ZDO.fromSnapshot(echtes.toSnapshot());
      ersatz.setInt('spieler', 1); ersatz.setInt('marke', 7); // hoehere Datenrevision
      const neuesTeil = a.zdos.createZDO(WAND, { x: 20, y: 1, z: 5 }); neuesTeil.setInt('spieler', 1);
      const zeilen = [
        { zdoId: echtes.zdoid.toString(), daten: JSON.stringify(ersatz.toSnapshot()) },
        { zdoId: neuesTeil.zdoid.toString(), daten: JSON.stringify(neuesTeil.toSnapshot()) },
        { zdoId: b.zdos.getAllZDOs().find((z) => z.position.x === 9)!.zdoid.toString(), daten: null },
      ];
      const e = ueberlagern(zeilen, b.zdos, ZDO);
      const index = [...b.zdos.spielerbauten()].map((z) => z.zdoid.toString()).sort().join();
      const scan = b.zdos.getAllZDOs().filter((z) => z.getInt('spieler') === 1).map((z) => z.zdoid.toString()).sort().join();
      check('Ueberlagerung: 1 ersetzt, 1 neu, 1 entfernt', e.ersetzt === 1 && e.neu === 1 && e.entfernt === 1, JSON.stringify(e));
      check('Index der Spielerbauten == Vollscan', index === scan && index.split(',').length === 2, `index ${index} | scan ${scan}`);
      check('ersetztes ZDO traegt den Zeilenstand', b.zdos.getAllZDOs().find((z) => z.position.x === 5)!.getInt('marke') === 7);
    }

    console.log('\n[B2] welt_id nur aus Seed und Modus:');
    if (laeuft('B2')) {
      const dir = resolve(WURZEL, 'b2');
      mkdirSync(dir, { recursive: true });
      const layoutA = resolve(dir, 'layout.json');
      copyFileSync(resolve(fileURLToPath(new URL('../data/welten/dev.json', import.meta.url))), layoutA);
      const k = await neu(dir, TAKT, 'layout', layoutA);
      const ws = await verbinde(k.port, token);
      admin(ws, 'teleport 250 260');
      admin(ws, 'item give Wood 6');
      await warte(TAKT + 1500);
      const s0 = await k.stand();
      // Der Editor speichert ein geaendertes Layout, waehrend der Server laeuft; dann Absturz.
      const doc = JSON.parse(readFileSync(layoutA, 'utf-8'));
      doc.name = 'World of Vikings (im Editor umbenannt)';
      doc.regions[0].shape.radius += 1;
      writeFileSync(layoutA, JSON.stringify(doc, null, 2));
      await k.beende('SIGKILL'); ws.terminate();
      const k2 = await neu(dir, RIESIG, 'layout', layoutA);
      const ws2 = await verbinde(k2.port, token);
      const s2 = await k2.stand();
      check('Layout geaendert + Kill + Neustart: Spielerstand da', Math.abs(s2.x - 250) < 1 && s2.holz === s0.holz, `x=${s2.x} holz=${s2.holz} (vorher ${s0.holz})`);
      check('Zeile steht noch in der Tabelle', sql(dir, 'SELECT 1 FROM spielerzustand').length === 1);
      ws2.terminate(); await k2.beende('SIGKILL');
      // Zeilen einer anderen Welt: ignoriert, nicht geloescht (auch nicht ueberschrieben).
      const db = new DatabaseSync(resolve(dir, 'konten/world.db'));
      db.prepare("UPDATE spielerzustand SET welt_id = 'andere-welt|layout'").run();
      db.close();
      const k3 = await neu(dir, RIESIG, 'layout', layoutA);
      const ws3 = await verbinde(k3.port, token);
      const s3 = await k3.stand();
      check('Zeile einer anderen Welt wird nicht uebernommen', Math.abs(s3.x - 250) > 1, `x=${s3.x}`);
      // Dieselbe Figur schreibt jetzt eine EIGENE Zeile (Abmelden); die fremde bleibt daneben stehen.
      ws3.terminate();
      await warte(800);
      await k3.beende('SIGKILL');
      const zeilen = sql<{ welt_id: string }>(dir, 'SELECT welt_id FROM spielerzustand ORDER BY welt_id');
      check('die fremde Zeile ist NICHT geloescht und nicht ueberschrieben', zeilen.some((z) => z.welt_id === 'andere-welt|layout'), zeilen.map((z) => z.welt_id).join(' | '));
      check('die eigene Welt schreibt daneben ihre eigene Zeile', zeilen.some((z) => z.welt_id === `${SEED}|layout`), zeilen.map((z) => z.welt_id).join(' | '));
    }

    console.log('\n[B3] world.player-save-interval klemmen:');
    if (laeuft('B3')) {
      const ns = (await import('../src/ServerKonfig.js')) as Record<string, unknown>;
      const f = ns.leseSpielerSicherungMs as ((w: unknown, warn: (t: string) => void) => number) | undefined;
      check('Funktion leseSpielerSicherungMs existiert', typeof f === 'function');
      if (f) {
        const probe = (wert: unknown): { ms: number; laut: number } => { let laut = 0; const ms = f(wert, () => { laut++; }); return { ms, laut }; };
        for (const [wert, soll, laut] of [['0s', 5000, 1], ['0ms', 5000, 1], ['-5s', 30000, 1], ['600h', 600000, 1], ['30', 30000, 1], ['abc', 30000, 1], ['4s', 5000, 1], ['11min', 600000, 1], ['10s', 10000, 0], ['2min', 120000, 0], [undefined, 30000, 0]] as const) {
          const r = probe(wert);
          check(`${JSON.stringify(wert)} -> ${soll} ms, ${laut ? 'laute Meldung' : 'still'}`, r.ms === soll && r.laut === laut, `${r.ms} ms, ${r.laut} Meldung(en)`);
        }
        check('Zahl statt Text (YAML 30) -> Vorgabe + Meldung', probe(30).ms === 30000 && probe(30).laut === 1);
      }
    }

    console.log('\n[B4] Admin-Eingriff an einem abwesenden Spieler:');
    if (laeuft('B4')) {
      const dir = resolve(WURZEL, 'b4');
      mkdirSync(dir, { recursive: true });
      const k = await neu(dir, RIESIG);
      const ws = await verbinde(k.port, token, 'Anna');
      await warte(400);
      ws.terminate(); // Abmelden: Weltspeicher-Eintrag + Zeile mit Stempel T
      await warte(800);
      // Der Fall, den der Angriff nur als Restrisiko fand: die Zeile traegt einen JUENGEREN Stempel als der Weltspeicher-Eintrag.
      const db = new DatabaseSync(resolve(dir, 'konten/world.db'));
      db.prepare('UPDATE spielerzustand SET stand = stand + 5').run();
      db.close();
      const tokenBert = tokenAusstellen(spielerIdErzeugen(), 99n, Buffer.from(GEHEIMNIS_HEX, 'hex'));
      const wsBert = await verbinde(k.port, tokenBert, 'Bert');
      admin(wsBert, 'item ironward Anna');
      await warte(600);
      wsBert.terminate();
      await warte(300);
      await k.beende('SIGTERM');
      const k2 = await neu(dir, RIESIG);
      const ws2 = await verbinde(k2.port, token, 'Anna');
      const s2 = await k2.stand();
      check('Eingriff ueberlebt Stopp + Neustart (Stempel wurde erhoeht)', s2.eisenteile >= 1, `IronwardHelmet=${s2.eisenteile}`);
      ws2.terminate(); await k2.beende('SIGKILL');
    }

    console.log('\n[B5] Stopp schreibt eine letzte Zeile (Takt 1 h, kein Ereignis):');
    if (laeuft('B5')) {
      const dir = resolve(WURZEL, 'b5');
      mkdirSync(dir, { recursive: true });
      const k = await neu(dir, RIESIG);
      const ws = await verbinde(k.port, token);
      admin(ws, 'teleport 333 444');
      await warte(500);
      check('vor dem Stopp: keine Zeile', sql(dir, 'SELECT 1 FROM spielerzustand').length === 0);
      const code = await k.beende('SIGTERM');
      ws.terminate();
      const zeilen = sql<{ daten: string }>(dir, 'SELECT daten FROM spielerzustand');
      const pos = zeilen[0] ? (JSON.parse(zeilen[0].daten) as { position: { x: number } }).position.x : NaN;
      check('Stopp: Exit 0 und genau eine Zeile mit dem Endstand (x=333)', code === 0 && zeilen.length === 1 && Math.abs(pos - 333) < 1, `Exit ${code}, ${zeilen.length} Zeile(n), x=${pos}`);
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
