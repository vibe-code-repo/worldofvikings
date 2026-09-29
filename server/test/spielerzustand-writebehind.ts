/**
 * F8 — Spielerzustand write-behind in die Konten-SQLite.
 *
 * Geprüft wird mit ECHTEN Serverprozessen und echtem SIGKILL (ein Test im
 * selben Prozess kann "überlebt einen harten Abbruch" nicht beweisen), mit
 * einem echten WebSocket-Spieler, der sich per Sitzungstoken anmeldet (damit
 * er nach dem Neustart dieselbe spielerId hat). Der Takt wird per
 * Konfiguration (`spielerSicherungMs`) verkürzt, nicht per Monkeypatch.
 *
 *   [A] Takt: Position und Inventar ändern sich, ein Takt vergeht, SIGKILL,
 *       Neustart -> der Zustand ist da, höchstens ein Takt alt. Der
 *       Weltspeicher existiert dabei NICHT (Beleg: es kommt aus der SQLite).
 *   [B] Ereignis: bei riesigem Takt (1 h) wird ein Ausrüstungswechsel
 *       (echtes SetAussehen-Paket) sofort gesichert; SIGKILL 300 ms später.
 *       Was NACH dem Ereignis geschah, fehlt (Beleg: es ist ereignis-, nicht
 *       zufallsgetrieben).
 *   [C] Kontrolle (der alte Zustand): riesiger Takt, kein Ereignis, SIGKILL
 *       -> es gibt keine Zeile, der Neustart beginnt frisch.
 *   [D] Neuester gewinnt: SQLite neuer als Weltspeicher -> SQLite; SQLite
 *       künstlich älter als Weltspeicher -> Weltspeicher (kein Rückschritt).
 *   [H] Waffe (K2a): getragene Waffe steckt in der Zeile und kommt nach SIGKILL
 *       + Neustart zurück (peer.waffe).
 *   [E] Stopp (SIGTERM): eine letzte Sicherung, Exit 0, Zeile stimmt.
 *   [F] Fremde Welt: eine Zeile mit anderer welt_id wird nicht übernommen
 *       und weggeräumt (Welt zurückgesetzt, Konten behalten).
 *   [G] Fehlerweg (Einheit): scheitert das Schreiben, ist es laut, der
 *       Eintrag bleibt schmutzig und der nächste Lauf schreibt ihn.
 *   [H] Zahlen: Verlustfenster und Zeit je Schreibvorgang.
 *
 * Lauf: npx tsx test/spielerzustand-writebehind.ts   (aus server/)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { equipmentSetCatalog } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { erstelleHerunterfahren } from '../src/herunterfahren.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { antwortBerechnen, spielerIdErzeugen, tokenAusstellen } from '../src/net/Identitaet.js';
import { SPIELER_SICHERUNG_INTERVALL_MS, SpielerSicherung, neuerAls } from '../src/spiel/SpielerSicherung.js';
import type { SavedPlayer } from '../src/world/WorldManager.js';
import { portVon } from '../../scripts/testport.mjs';

const DATEI = fileURLToPath(import.meta.url);
const SEED = 'KxSYuZquuw';
const GEHEIMNIS_HEX = 'ab'.repeat(32);
const RIESIG = 3_600_000;
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, AdminCommand: 53, SetAussehen: 73, Equip: 80, AuthChallenge: 68 };
const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Kindmodus: ein Weltserver, der Befehle über stdin annimmt ─────────
if (process.argv[2] === 'kind') {
  const worldsDir = process.argv[3]!;
  const intervall = Number(process.argv[4]);
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
    saveIntervalMs: RIESIG, // der Weltspeicher tickt im Test nie: alles Gesicherte kommt aus der SQLite
    spielerSicherungMs: intervall,
    sessionSecret: Buffer.from(GEHEIMNIS_HEX, 'hex'),
  });
  server.init();
  server.start();
  const fahreHerunter = erstelleHerunterfahren(server, (code) => process.exit(code));
  process.on('SIGTERM', fahreHerunter);
  console.log(`BEREIT ${portVon(server)}`);
  createInterface({ input: process.stdin }).on('line', (zeile) => {
    if (zeile !== 'stand') return;
    const peer = server.net.getPeers().find((p) => !p.nurEditor && p.authenticated);
    const s = (server as unknown as { spielerSicherung: SpielerSicherung | null }).spielerSicherung;
    console.log(
      'STAND ' +
        JSON.stringify({
          da: !!peer,
          x: peer?.position.x,
          z: peer?.position.z,
          holz: peer?.inventar.countOf('Wood') ?? 0,
          ruestung: peer?.ruestung,
          waffe: peer?.waffe,
          figur: peer?.figur,
          stats: s?.stats(),
        }),
    );
  });
  setInterval(() => {}, 1000);
} else {
  await haupt();
}

// ── Elternseite ──────────────────────────────────────────────────────

interface Standmeldung {
  da: boolean;
  x: number;
  z: number;
  holz: number;
  ruestung?: string;
  waffe?: string;
  figur?: string;
  stats?: { laeufe: number; zeilen: number; fehler: number; summeMs: number; maxMs: number };
}

interface Kind {
  proc: ChildProcess;
  port: number;
  out: () => string;
  stand(): Promise<Standmeldung>;
  beende(signal: NodeJS.Signals): Promise<number | null>;
}

function starteKind(dir: string, intervallMs: number): Promise<Kind> {
  return new Promise((ok, fehl) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', DATEI, 'kind', dir, String(intervallMs)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const wartende: ((z: Standmeldung) => void)[] = [];
    const timer = setTimeout(() => { proc.kill('SIGKILL'); fehl(new Error('Kind nicht bereit:\n' + out)); }, 90_000);
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
          out: () => out,
          stand: () =>
            new Promise((r) => {
              wartende.push(r);
              proc.stdin!.write('stand\n');
            }),
          beende: (signal) =>
            new Promise((r) => {
              proc.once('exit', (c) => r(c));
              proc.kill(signal);
            }),
        });
      }
      for (const zeile of d.toString().split('\n')) {
        if (zeile.startsWith('STAND ')) wartende.shift()?.(JSON.parse(zeile.slice(6)));
      }
    };
    proc.stdout!.on('data', beiDaten);
    proc.stderr!.on('data', beiDaten);
  });
}

function verbinde(port: number, token: string): Promise<WebSocket> {
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
        w.writeString('Anna');
        w.writeString(token);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(t);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}

function admin(ws: WebSocket, zeile: string): void {
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), new Writer().writeString(zeile).toBuffer()]));
}

interface Zeile { spieler_id: string; welt_id: string; stand: number; daten: string }
function leseZeilen(dir: string): Zeile[] {
  const pfad = resolve(dir, 'konten/world.db');
  if (!existsSync(pfad)) return [];
  const db = new DatabaseSync(pfad, { readOnly: true });
  try {
    return db.prepare('SELECT spieler_id, welt_id, stand, daten FROM spielerzustand').all() as unknown as Zeile[];
  } catch {
    return []; // Tabelle fehlt (Stand vor F8)
  } finally {
    db.close();
  }
}

async function haupt(): Promise<void> {
  let failures = 0;
  const check = (name: string, cond: boolean, detail = ''): void => {
    if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
    else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); failures++; }
  };

  const WURZEL = resolve(tmpdir(), `f8-spielerzustand-${process.pid}`);
  rmSync(WURZEL, { recursive: true, force: true });
  const pids: number[] = [];
  const spielerId = spielerIdErzeugen();
  const token = tokenAusstellen(spielerId, 4711n, Buffer.from(GEHEIMNIS_HEX, 'hex'));
  const satz = equipmentSetCatalog().sets.find((s) => s.id === 'plainhide_male')!;
  const weste = satz.parts.find((p) => p.appearanceSlot === 'oberkoerper')!;
  const oberId = (satz.appearance as Record<string, string>).oberkoerper!;

  const neu = async (dir: string, intervall: number): Promise<Kind> => {
    const k = await starteKind(dir, intervall);
    pids.push(k.proc.pid!);
    return k;
  };

  try {
    console.log('=== F8 Spielerzustand write-behind ===');

    console.log('\n[A] Takt: Änderung -> ein Takt -> SIGKILL -> Neustart:');
    const dirA = resolve(WURZEL, 'a');
    mkdirSync(dirA, { recursive: true });
    const TAKT = 1500;
    let a = await neu(dirA, TAKT);
    let ws = await verbinde(a.port, token);
    const start = (await a.stand()).holz; // Startausrüstung zählt mit
    admin(ws, 'teleport 120 340');
    admin(ws, 'item give Wood 5');
    const tAenderung = Date.now();
    await warte(TAKT + 1500);
    const tKill = Date.now();
    const sicherungsStats = (await a.stand()).stats;
    await a.beende('SIGKILL');
    ws.terminate();
    let zeilen = leseZeilen(dirA);
    check('nach SIGKILL steht eine Zeile in der SQLite', zeilen.length === 1, `${zeilen.length} Zeile(n)`);
    check('es gibt KEINEN Weltspeicher (Zustand stammt nur aus der SQLite)', !existsSync(resolve(dirA, 'world.db.zst')));
    const alterMs = zeilen[0] ? tKill - zeilen[0].stand : Infinity;
    check('Zeile höchstens einen Takt (+ Reserve) alt', alterMs <= TAKT + 1500, `${alterMs} ms alt, Änderung vor ${tKill - tAenderung} ms`);
    let a2 = await neu(dirA, TAKT);
    ws = await verbinde(a2.port, token);
    let s = await a2.stand();
    check('Neustart: Position wiederhergestellt', Math.abs(s.x - 120) < 1 && Math.abs(s.z - 340) < 1, `x=${s.x} z=${s.z}`);
    check(`Neustart: Inventar wiederhergestellt (${start}+5 Holz)`, s.holz === start + 5, `holz=${s.holz}`);
    ws.terminate();
    await a2.beende('SIGKILL');

    console.log('\n[B] Ereignis: sofort gesichert, auch bei Takt = 1 h:');
    const dirB = resolve(WURZEL, 'b');
    mkdirSync(dirB, { recursive: true });
    const b = await neu(dirB, RIESIG);
    const wsB = await verbinde(b.port, token);
    admin(wsB, 'teleport 200 210');
    admin(wsB, `item give ${weste.itemId} 1`);
    admin(wsB, 'item give Wood 3');
    await warte(400);
    const vorEreignis = leseZeilen(dirB).length;
    wsB.send(Buffer.concat([Buffer.from([P.SetAussehen]), new Writer()
      .writeString('H_01').writeString(oberId).writeString('').writeString('mittelbraun')
      .writeString(JSON.stringify({ oberkoerper: oberId })).toBuffer()]));
    await warte(300);
    admin(wsB, 'item give Wood 2'); // NACH dem Ereignis: darf beim Kill fehlen
    await warte(150);
    await b.beende('SIGKILL');
    wsB.terminate();
    zeilen = leseZeilen(dirB);
    check('vor dem Ereignis: keine Zeile (Takt 1 h)', vorEreignis === 0, `${vorEreignis}`);
    check('nach dem Ereignis: Zeile da, 300 ms vor SIGKILL', zeilen.length === 1);
    const dB = zeilen[0] ? (JSON.parse(zeilen[0].daten) as SavedPlayer) : null;
    check('Zeile trägt die Rüstung (Ereignis: Ausrüstungswechsel)', !!dB && (dB.ruestung ?? '').includes(oberId), dB?.ruestung ?? '-');
    check('Zeile trägt die Position zum Ereigniszeitpunkt', !!dB && Math.abs(dB.position.x - 200) < 1, `x=${dB?.position.x}`);
    const holz = (dB?.inventar ?? []).filter((i) => JSON.stringify(i).includes('"Wood"')).length;
    const holzMenge = JSON.stringify(dB?.inventar ?? []);
    check('Zeile trägt das Inventar (Weste + Holz vorhanden)', holz > 0 && holzMenge.includes(weste.itemId), `Wood-Einträge ${holz}`);

    console.log('\n[C] Kontrolle: Takt 1 h, kein Ereignis, SIGKILL (= Verhalten vor F8):');
    const dirC = resolve(WURZEL, 'c');
    mkdirSync(dirC, { recursive: true });
    const c = await neu(dirC, RIESIG);
    const wsC = await verbinde(c.port, token);
    const startC = (await c.stand()).holz;
    admin(wsC, 'teleport 300 310');
    admin(wsC, 'item give Wood 7');
    await warte(1500);
    await c.beende('SIGKILL');
    wsC.terminate();
    check('keine Zeile, kein Weltspeicher: der Fortschritt ist weg', leseZeilen(dirC).length === 0 && !existsSync(resolve(dirC, 'world.db.zst')));
    const c2 = await neu(dirC, RIESIG);
    const wsC2 = await verbinde(c2.port, token);
    s = await c2.stand();
    check(`Neustart beginnt frisch (${startC} Holz wie vorher, nicht ${startC}+7)`, s.holz === startC && Math.abs(s.x - 300) > 1, `holz=${s.holz} x=${s.x}`);
    wsC2.terminate();
    await c2.beende('SIGKILL');

    console.log('\n[H] Waffe: Equip -> Takt -> SIGKILL -> Neustart, die Waffe ist wieder da:');
    const dirH = resolve(WURZEL, 'h');
    mkdirSync(dirH, { recursive: true });
    const h1 = await neu(dirH, TAKT);
    const wsH = await verbinde(h1.port, token);
    admin(wsH, 'item give AxeFlint 1');
    await warte(300);
    wsH.send(Buffer.concat([Buffer.from([P.Equip]), new Writer().writeString('waffe').writeString('AxeFlint').toBuffer()]));
    await warte(400);
    check('vor dem Kill: der Server trägt die Axt', (await h1.stand()).waffe === 'AxeFlint', String((await h1.stand()).waffe));
    await warte(TAKT + 1500);
    await h1.beende('SIGKILL');
    wsH.terminate();
    zeilen = leseZeilen(dirH);
    const dH = zeilen[0] ? (JSON.parse(zeilen[0].daten) as SavedPlayer) : null;
    check('Zeile trägt die Waffe (SavedPlayer.waffe)', dH?.waffe === 'AxeFlint', String(dH?.waffe));
    const h2 = await neu(dirH, TAKT);
    const wsH2 = await verbinde(h2.port, token);
    check('Neustart: getragene Waffe wiederhergestellt', (await h2.stand()).waffe === 'AxeFlint', String((await h2.stand()).waffe));
    wsH2.terminate();
    await h2.beende('SIGKILL');

    console.log('\n[D/E] Neuester gewinnt, Stopp sichert zuletzt:');
    const dirD = resolve(WURZEL, 'd');
    mkdirSync(dirD, { recursive: true });
    const d1 = await neu(dirD, TAKT);
    const wsD1 = await verbinde(d1.port, token);
    const startD = (await d1.stand()).holz;
    admin(wsD1, 'teleport 50 60');
    admin(wsD1, 'item give Wood 1');
    await warte(TAKT + 1000);
    const codeD1 = await d1.beende('SIGTERM'); // Weltspeicher + letzte Sicherung
    wsD1.terminate();
    check('[E] Stopp: Exit 0', codeD1 === 0, `Code ${codeD1}`);
    check('[E] Stopp: Weltspeicher UND Zeile da', existsSync(resolve(dirD, 'world.db.zst')) && leseZeilen(dirD).length === 1);
    const d2 = await neu(dirD, TAKT);
    const wsD2 = await verbinde(d2.port, token);
    s = await d2.stand();
    check('Stand aus dem Stopp geladen (50/60, +1 Holz)', Math.abs(s.x - 50) < 1 && s.holz === startD + 1, `x=${s.x} holz=${s.holz}`);
    admin(wsD2, 'teleport 200 210');
    admin(wsD2, 'item give Wood 4');
    await warte(TAKT + 1000);
    await d2.beende('SIGKILL'); // Weltspeicher bleibt alt (50/60), SQLite ist neuer
    wsD2.terminate();
    const d3 = await neu(dirD, TAKT);
    const wsD3 = await verbinde(d3.port, token);
    s = await d3.stand();
    check('SQLite neuer als Weltspeicher -> SQLite gewinnt (200/210, +5 Holz)', Math.abs(s.x - 200) < 1 && s.holz === startD + 5, `x=${s.x} holz=${s.holz}`);
    wsD3.terminate();
    await d3.beende('SIGTERM'); // Weltspeicher jetzt neu (200/210)
    // SQLite künstlich ÄLTER machen und mit einem Rückschritt-Inhalt füllen.
    {
      const db = new DatabaseSync(resolve(dirD, 'konten/world.db'));
      const z = db.prepare('SELECT daten FROM spielerzustand').get() as { daten: string };
      const alt = JSON.parse(z.daten);
      alt.position = { x: 999, y: 0, z: 999 };
      db.prepare('UPDATE spielerzustand SET stand = 1, daten = ?').run(JSON.stringify(alt));
      db.close();
    }
    const d4 = await neu(dirD, RIESIG);
    const wsD4 = await verbinde(d4.port, token);
    s = await d4.stand();
    check('Weltspeicher neuer als SQLite -> Weltspeicher gewinnt (kein Rückschritt)', Math.abs(s.x - 200) < 1, `x=${s.x}`);
    wsD4.terminate();
    await d4.beende('SIGKILL');
    check('neuerAls: strikt, fehlender Stempel = 0', neuerAls({ gespeichertAm: 2 } as SavedPlayer, { gespeichertAm: 1 } as SavedPlayer)
      && !neuerAls({ gespeichertAm: 1 } as SavedPlayer, { gespeichertAm: 1 } as SavedPlayer)
      && !neuerAls({ } as SavedPlayer, undefined) && neuerAls({ gespeichertAm: 1 } as SavedPlayer, {} as SavedPlayer));

    console.log('\n[F] Fremde Welt (Zurücksetzen ohne Konten):');
    {
      const db = new DatabaseSync(resolve(dirD, 'konten/world.db'));
      db.prepare("UPDATE spielerzustand SET welt_id = 'andere-welt', stand = ?").run(Date.now() + 60_000);
      db.close();
    }
    rmSync(resolve(dirD, 'world.db.zst'), { force: true });
    rmSync(resolve(dirD, 'world.db.zst.prev'), { force: true });
    const f = await neu(dirD, RIESIG);
    const wsF = await verbinde(f.port, token);
    s = await f.stand();
    check('Zeile einer anderen Welt wird nicht übernommen', s.holz === startD && Math.abs(s.x - 200) > 1, `holz=${s.holz} x=${s.x}`);
    wsF.terminate();
    await f.beende('SIGKILL');
    check('… und weggeräumt', leseZeilen(dirD).length === 0, `${leseZeilen(dirD).length}`);

    console.log('\n[G] Fehlerweg: laut, bleibt schmutzig, nächster Lauf schreibt:');
    {
      let scheitern = true;
      const geschrieben: string[] = [];
      const db = {
        spielerzustandSchreiben: (z: { spielerId: string }[]) => {
          if (scheitern) throw new Error('disk I/O error (Test)');
          for (const r of z) geschrieben.push(r.spielerId);
        },
        spielerzustandLesen: () => [],
        spielerzustandFremdeWeltenLoeschen: () => 0,
        spielerzustandLoeschen: () => {},
      };
      const laut: string[] = [];
      const sich = new SpielerSicherung(db as never, 'w', () => 1000, { warn: (t) => laut.push(t), error: (t) => laut.push(t) });
      const stand: SavedPlayer = { name: 'X', spielerId: 'id-x', position: { x: 1, y: 2, z: 3 }, flying: false };
      const r1 = sich.sichere([stand], 'test');
      check('Fehler: Rückgabe -1 und laute Meldung', r1 === -1 && laut.some((t) => t.includes('SPIELER_SICHERUNG_FEHLER')));
      scheitern = false;
      const r2 = sich.sichere([stand], 'test');
      check('nächster Lauf schreibt den schmutzig gebliebenen Stand', r2 === 1 && geschrieben.join() === 'id-x');
      const r3 = sich.sichere([stand], 'test');
      check('unveränderter Stand wird nicht erneut geschrieben', r3 === 0 && geschrieben.length === 1);
      const r4 = sich.sichere([{ ...stand, position: { x: 2, y: 2, z: 3 } }], 'test');
      check('geänderter Stand wird geschrieben', r4 === 1 && geschrieben.length === 2);
    }

    console.log('\n[H] Zahlen:');
    check(`Standardtakt ${SPIELER_SICHERUNG_INTERVALL_MS} ms ≤ 60000 ms`, SPIELER_SICHERUNG_INTERVALL_MS <= 60_000);
    check('Schreibvorgang gemessen (maxMs erfasst) und unter 250 ms', !!sicherungsStats && sicherungsStats.laeufe >= 1 && sicherungsStats.fehler === 0 && sicherungsStats.maxMs < 250,
      JSON.stringify(sicherungsStats));
    console.log(`  ZAHL Lauf A: Änderung ${tKill - tAenderung} ms vor SIGKILL, Zeile ${alterMs} ms alt (Takt ${TAKT} ms)`);
    console.log(`  ZAHL Verlustfenster vorher ${(30 * 60 * 1000) / 1000} s (SAVE_INTERVAL_MS), nachher ≤ ${SPIELER_SICHERUNG_INTERVALL_MS / 1000} s + Ereignisse sofort`);
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* schon weg */ } }
    await warte(300);
    rmSync(WURZEL, { recursive: true, force: true });
  }
  if (failures > 0) {
    console.error(`\n${failures} Prüfung(en) fehlgeschlagen`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden');
  process.exit(0);
}
