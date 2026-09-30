/**
 * F10 — Ansage vor dem Neustart und Wiederverbinden (echter Serverprozess, Roh-WebSocket-Clients).
 *
 *  A. SIGTERM an einen Server mit zwei Spielern: jeder bekommt VOR dem Trennen das Paket
 *     `ServerNeustart` (Zaehler = Zahl der Clients, auf main 0), der Disconnect-Grund ist
 *     `restart` (nicht mehr `Server shutting down`), die Ansage kommt hoechstens 1 s vor dem
 *     Trennen, der Prozess endet mit Exit-Code 0.
 *  B. Neustart mit gleichem Weltpfad und gleichem Geheimnis: Anna verbindet nach dem echten
 *     Backoff des Client-Moduls (Wiederverbinden.ts) neu, mit ihrem SessionToken, steht
 *     hoechstens 1 m neben ihrer gesicherten Position; Zeit SIGTERM -> Wiedereintritt gemessen.
 *  C. BEFUND Token: Startet der Server mit einem ANDEREN Geheimnis (ohne WOV_SESSION_SECRET_HEX
 *     wuerfelt jeder Start ein neues), ist das alte Token ungueltig und die Figur beginnt neu.
 *     Das ist der Ist-Zustand und wird hier festgehalten, nicht geloest.
 *
 * Lauf: npx tsx server/test/f10-neustart-ansage.ts   (aus der Repo-Wurzel)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createWovServer } from '../src/WovServer.js';
import { erstelleHerunterfahren } from '../src/herunterfahren.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { freierPort } from '../../scripts/testport.mjs';

const DATEI = fileURLToPath(import.meta.url);
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AdminCommand: 53, Disconnect: 4, AuthChallenge: 68, ServerNeustart: 86 };

// ── Kindmodus: ein Weltserver mit dem echten Signal-Handler ─────────
if (process.argv[2] === 'kind') {
  const [, , , worldsDir, port, secretHex] = process.argv as string[];
  const server = createWovServer({
    port: Number(port),
    worldName: 'world',
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    everyoneAdmin: true,
    saveIntervalMs: 3_600_000,
    worldsDir: worldsDir!,
    kontenDir: resolve(worldsDir!, 'konten'),
    sessionSecret: Buffer.from(secretHex!, 'hex'),
  });
  server.init();
  server.start();
  process.on('SIGTERM', erstelleHerunterfahren(server, (code) => process.exit(code)));
  // "pos <name>" -> Position des Peers (Zeuge fuer den Elternprozess)
  createInterface({ input: process.stdin }).on('line', (zeile) => {
    const [, name] = zeile.split(' ');
    const p = server.net.getPeers().find((q) => q.name === name);
    console.log(p ? `POS ${name} ${p.position.x.toFixed(2)} ${p.position.z.toFixed(2)}` : `POS ${name} -`);
  });
  console.log('BEREIT');
  setInterval(() => {}, 1000);
} else {
  await haupt();
}

interface Kind {
  proc: ChildProcess;
  out: () => string;
  frage: (name: string) => Promise<{ x: number; z: number } | null>;
  beende: () => Promise<{ code: number | null; ms: number }>;
  pid: number;
}

function starteKind(worldsDir: string, port: number, secretHex: string): Promise<Kind> {
  return new Promise((ok, fehl) => {
    const proc = spawn(process.execPath, ['--import', 'tsx', DATEI, 'kind', worldsDir, String(port), secretHex], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let bereit = false;
    const timer = setTimeout(() => { proc.kill('SIGKILL'); fehl(new Error('Kind nicht bereit:\n' + out)); }, 90_000);
    proc.stdout!.on('data', (d: Buffer) => {
      out += d.toString();
      if (!bereit && out.includes('BEREIT')) {
        bereit = true;
        clearTimeout(timer);
        ok({
          proc,
          pid: proc.pid!,
          out: () => out,
          frage: (name) => new Promise((res) => {
            const vor = out.length;
            const pruefe = setInterval(() => {
              const m = new RegExp(`POS ${name} (\\S+) ?(\\S*)`).exec(out.slice(vor));
              if (m) { clearInterval(pruefe); res(m[1] === '-' ? null : { x: Number(m[1]), z: Number(m[2]) }); }
            }, 20);
            proc.stdin!.write(`pos ${name}\n`);
          }),
          beende: async () => {
            const t0 = Date.now();
            const ende = new Promise<number | null>((r) => proc.once('exit', (c) => r(c)));
            proc.kill('SIGTERM');
            const code = await Promise.race([ende, new Promise<number | null>((r) => setTimeout(() => r(-999), 15_000))]);
            if (code === -999) proc.kill('SIGKILL');
            return { code, ms: Date.now() - t0 };
          },
        });
      }
    });
    proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
  });
}

interface Ereignis { art: 'ansage' | 'disconnect' | 'close'; ms: number; text?: string; sek?: number }
interface Client {
  ws: WebSocket;
  name: string;
  ereignisse: Ereignis[];
  token: string;
}

/** Verbindet, meldet sich mit `token` an (leer = neu) und liefert den Client nach PeerInfo. */
function verbinde(name: string, port: number, token: string): Promise<Client> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    const c: Client = { ws, name, ereignisse: [], token };
    let authGesendet = false;
    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (typ === P.ServerNeustart) {
        c.ereignisse.push({ art: 'ansage', ms: performance.now(), text: r.readString(), sek: r.readInt32() });
      } else if (typ === P.Disconnect) {
        c.ereignisse.push({ art: 'disconnect', ms: performance.now(), text: r.readString() });
      } else if (typ === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (typ === P.AuthChallenge && !authGesendet) {
        authGesendet = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString(c.token);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (typ === P.PeerInfo) {
        r.readString(); r.readString(); r.readString();
        c.token = r.readString() || c.token;
        res(c);
      }
    });
    ws.on('close', () => c.ereignisse.push({ art: 'close', ms: performance.now() }));
    ws.on('error', rej);
    setTimeout(() => rej(new Error(`Handshake-Timeout ${name}`)), 8_000);
  });
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function haupt(): Promise<void> {
  let fehler = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    if (!ok) fehler++;
  };
  const WURZEL = resolve(tmpdir(), `f10-neustart-${process.pid}`);
  rmSync(WURZEL, { recursive: true, force: true });
  mkdirSync(WURZEL, { recursive: true });
  const kinder: ChildProcess[] = [];
  const offene: Client[] = [];
  const GEHEIMNIS = 'ab'.repeat(32);
  try {
    const port = await freierPort();

    console.log('=== F10 Neustart-Ansage ===\n[A] SIGTERM mit zwei Spielern:');
    const a = await starteKind(WURZEL, port, GEHEIMNIS);
    kinder.push(a.proc);
    const anna = await verbinde('Anna', port, '');
    const bjorn = await verbinde('Bjorn', port, '');
    offene.push(anna, bjorn);
    const ZIEL = { x: 120, z: 80 };
    anna.ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), new Writer().writeString(`teleport ${ZIEL.x} ${ZIEL.z}`).toBuffer()]));
    let pos: { x: number; z: number } | null = null;
    for (let i = 0; i < 100; i++) {
      pos = await a.frage('Anna');
      if (pos && Math.abs(pos.x - ZIEL.x) < 1 && Math.abs(pos.z - ZIEL.z) < 1) break;
      await warte(50);
    }
    check('Anna steht serverseitig bei (120, 80)', !!pos && Math.abs(pos.x - ZIEL.x) < 1 && Math.abs(pos.z - ZIEL.z) < 1, JSON.stringify(pos));

    const tStopp = performance.now();
    const ende = await a.beende();
    // B laeuft GLEICHZEITIG mit der Wiederverbindung: Start des zweiten Prozesses ohne zu warten.
    const bStart = starteKind(WURZEL, port, GEHEIMNIS);
    bStart.catch(() => undefined);
    await warte(300);
    const ansagen = [anna, bjorn].map((c) => c.ereignisse.filter((e) => e.art === 'ansage'));
    const zaehlerAnsage = ansagen.filter((x) => x.length === 1).length;
    check(`Ansage kam bei ${zaehlerAnsage} von 2 Clients an`, zaehlerAnsage === 2);
    for (const c of [anna, bjorn]) {
      const ans = c.ereignisse.find((e) => e.art === 'ansage');
      const dis = c.ereignisse.find((e) => e.art === 'disconnect');
      check(`${c.name}: Ansage-Schluessel netz.neustart.ansage, retry 3 s`, ans?.text === 'netz.neustart.ansage' && ans.sek === 3, `${ans?.text} / ${ans?.sek}`);
      check(`${c.name}: Disconnect-Grund "restart"`, dis?.text === 'restart', `"${dis?.text}"`);
      const abstand = ans && dis ? dis.ms - ans.ms : NaN;
      check(`${c.name}: Ansage vor dem Trennen, Abstand <= 1000 ms`, !!ans && !!dis && abstand >= 0 && abstand <= 1000, `${abstand.toFixed(1)} ms`);
    }
    check('Exit-Code 0', ende.code === 0, `Code ${ende.code}, ${ende.ms} ms`);

    console.log('\n[B] Neustart, gleicher Weltpfad, gleiches Geheimnis — Anna verbindet mit Backoff neu:');
    const modul = await import('../../client/src/net/Wiederverbinden').catch((e: unknown) => {
      check('Client-Modul Wiederverbinden.ts vorhanden', false, String(e));
      return null;
    });
    if (modul) {
      const versuchsZeiten: number[] = [];
      let neu: Client | null = null;
      let versuche = 0;
      const ansageMs = (anna.ereignisse.find((e) => e.art === 'ansage')?.sek ?? 0) * 1000;
      const tGetrennt = performance.now();
      for (;;) {
        const e = modul.naechsterVersuch('restart', versuche, performance.now() - tGetrennt, versuche === 0 ? ansageMs : 0);
        if (e.aufgeben) break;
        await warte(e.warteMs);
        versuche++;
        versuchsZeiten.push(Math.round(performance.now() - tStopp));
        try { neu = await verbinde('Anna', port, anna.token); break; } catch { /* Server noch nicht oben */ }
      }
      const tEin = performance.now();
      check('Anna ist wieder verbunden', neu !== null, `${versuche} Versuch(e) bei ${versuchsZeiten.join(', ')} ms nach SIGTERM`);
      check('Versuchsabstaende gemaess Backoff (erster Versuch nicht vor der Ansagezeit 3 s)', versuche >= 1 && versuchsZeiten[0]! >= 3000 - 100, `erster bei ${versuchsZeiten[0]} ms`);
      const b = await bStart;
      kinder.push(b.proc);
      if (neu) offene.push(neu);
      console.log(`  ZAHL SIGTERM -> Wiedereintritt: ${((tEin - tStopp) / 1000).toFixed(2)} s`);
      const pB = await b.frage('Anna');
      const abstand = pB ? Math.hypot(pB.x - ZIEL.x, pB.z - ZIEL.z) : Infinity;
      check('Anna steht <= 1 m von der gesicherten Position', abstand <= 1, `Abstand ${abstand.toFixed(2)} m, Position ${JSON.stringify(pB)}`);
      check('Serverprotokoll: Figur "restored"', /Player "Anna" spawned at .*\(restored\)/.test(b.out()));

      console.log('\n[C] BEFUND Token: neuer Start mit ANDEREM Geheimnis (wie ohne WOV_SESSION_SECRET_HEX):');
      const endeB = await b.beende();
      check('Server B endet mit Exit-Code 0', endeB.code === 0, `Code ${endeB.code}`);
      const c = await starteKind(WURZEL, port, 'cd'.repeat(32));
      kinder.push(c.proc);
      const alt = await verbinde('Anna', port, anna.token);
      offene.push(alt);
      const pC = await c.frage('Anna');
      const abstandC = pC ? Math.hypot(pC.x - ZIEL.x, pC.z - ZIEL.z) : Infinity;
      check('BEFUND: altes Token wird abgelehnt, Figur beginnt neu (nicht restored)', !/Player "Anna" spawned at .*\(restored\)/.test(c.out()) && abstandC > 1, `Abstand ${abstandC.toFixed(1)} m, Token-Wechsel ${alt.token !== anna.token}`);
      const endeC = await c.beende();
      check('Server C endet mit Exit-Code 0', endeC.code === 0, `Code ${endeC.code}`);
    }
  } finally {
    for (const c of offene) try { c.ws.terminate(); } catch { /* */ }
    for (const k of kinder) {
      try { k.kill("SIGKILL"); } catch { /* schon weg */ }
    }
    rmSync(WURZEL, { recursive: true, force: true });
  }
  if (fehler) { console.error(`${fehler} Fehler`); process.exit(1); }
  console.log('\nF10-Neustart-Ansage: alles gruen');
  process.exit(0);
}
