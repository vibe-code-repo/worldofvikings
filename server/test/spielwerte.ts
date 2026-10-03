/**
 * Spielwerte: Tode und Spielzeit im Spielerzustand, Abbildung in der Ruestkammer.
 *
 *  [1] Spielwerte (Uhr injiziert): Spielzeit summiert ueber Sichern und Abmelden, zaehlt nichts doppelt, springt bei
 *      rueckwaerts laufender Uhr nicht, laeuft nach dem Abmelden nicht weiter; Altstand ohne Felder bleibt "nicht
 *      erfasst" bis zum ersten Sichern; kaputte Werte werden bereinigt.
 *  [2] Ruestkammer (`baueProfil`): Felder vorhanden/fehlend (fehlend = weggelassen, nie 0), Spielzeit auf volle Stunden
 *      in Minuten abgerundet, `stufe`/`fertigkeiten` aus erfundenen Daten, XP nie ausgegeben, kaputte Werte.
 *  [3] Echter Server (ein WebSocket-Spieler): der Todeszaehler steht in DERSELBEN Sicherung `tod` wie die
 *      Wiederbelebung, zaehlt je Tod genau einmal, ueberlebt Abmelden/Wiederanmelden und einen Neustart; ein Altstand ohne
 *      Felder laedt fehlerfrei und bekommt die Felder beim ersten Sichern.
 *
 * Run: npx tsx server/test/spielwerte.ts
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { PacketType, TOD_CLIPS, type Vector3 } from '@wov/shared';
import { antwortBerechnen, spielerIdErzeugen, tokenAusstellen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import { Spielwerte, SPIELZEIT_MAX_SEK, TODE_MAX } from '../src/spiel/Spielwerte.js';
import { baueProfil } from '../src/konto/Armory.js';
import type { ArmoryZeile } from '../src/konto/Kontendatenbank.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-spielwerte');
rmSync(WORLDS_DIR, { recursive: true, force: true });

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── [1] Spielwerte ───────────────────────────────────────────────
function teil1(): void {
  console.log('\n[1] Spielwerte (Uhr injiziert)');
  let t = 1000;
  const sw = new Spielwerte(() => t);
  sw.laden(undefined);
  check('Altstand ohne Felder laedt fehlerfrei und liefert 0/0 erst im Sicherungsstand', JSON.stringify(sw.stand(true)) === '{"tode":0,"spielzeitSek":0}');
  t += 90_500; // 90,5 s
  check('90,5 s -> 90 s (abgerundet, Rest bleibt erhalten)', sw.stand(true).spielzeitSek === 90, JSON.stringify(sw.stand(true)));
  check('zweites Sichern ohne Zeitablauf zaehlt nichts doppelt', sw.stand(true).spielzeitSek === 90);
  t += 600; // Rest 0,5 + 0,6 = 1,1 s
  check('der Rest unter einer Sekunde geht nicht verloren (90,5 + 0,6 -> 91 s)', sw.stand(true).spielzeitSek === 91, String(sw.stand(true).spielzeitSek));
  t -= 3_600_000; // Uhr springt eine Stunde zurueck
  const nachSprung = sw.stand(true).spielzeitSek;
  check('Uhrsprung rueckwaerts: keine negative Spanne, nichts geht verloren', nachSprung === 91, String(nachSprung));
  t += 10_000;
  check('danach laeuft es ab dem neuen Messpunkt weiter (+10 s)', sw.stand(true).spielzeitSek === 101, String(sw.stand(true).spielzeitSek));
  t += 5_000;
  const ende = sw.beende();
  check('Abmelden bucht den Rest (+5 s)', ende.spielzeitSek === 106, JSON.stringify(ende));
  t += 999_000;
  check('nach dem Abmelden laeuft nichts weiter', sw.stand(true).spielzeitSek === 106 && sw.beende().spielzeitSek === 106);

  // Zwei Sitzungen nacheinander: die zweite beginnt beim gespeicherten Stand.
  const zweite = new Spielwerte(() => t);
  zweite.laden({ tode: 3, spielzeitSek: ende.spielzeitSek });
  t += 4_000;
  check('zweite Sitzung: gespeicherter Stand + eigene Spanne, nicht doppelt', zweite.stand(true).spielzeitSek === 110 && zweite.stand(true).tode === 3);

  // Tode
  const z = new Spielwerte(() => t);
  z.laden({ tode: 2 });
  z.zaehleTod();
  check('ein Tod -> +1', z.stand(true).tode === 3);
  check('Sichern zaehlt den Tod nicht noch einmal', z.stand(true).tode === 3 && z.stand(true).tode === 3);

  // Kaputte Werte
  const k = new Spielwerte(() => t);
  k.laden({ tode: -4, spielzeitSek: Number.NaN });
  check('negativ/NaN -> wie nicht erfasst (0 im ersten Stand)', JSON.stringify(k.stand(true)) === '{"tode":0,"spielzeitSek":0}');
  const r = new Spielwerte(() => t);
  r.laden({ tode: 1e300, spielzeitSek: Infinity });
  check('riesig -> gekappt, Unendlich -> verworfen', r.stand(true).tode === TODE_MAX && r.stand(true).spielzeitSek === 0);
  const r2 = new Spielwerte(() => t);
  r2.laden({ tode: '7', spielzeitSek: 1e30 });
  check('Text -> verworfen; riesige Sekunden -> gekappt', r2.stand(true).tode === 0 && r2.stand(true).spielzeitSek === SPIELZEIT_MAX_SEK);
  const f = new Spielwerte(() => t);
  f.laden({ tode: 2.9, spielzeitSek: 10.9 });
  check('Kommazahlen werden abgerundet', f.stand(true).tode === 2 && f.stand(true).spielzeitSek === 10);
  // Normaler Takt: nur 5-Minuten-Stufen, Abmelden/Tod/Stopp exakt, die Meldung sinkt nie.
  t = 0;
  const st = new Spielwerte(() => t);
  st.laden(undefined);
  const gemeldet: number[] = [];
  for (let i = 0; i < 10; i++) { t += 30_000; gemeldet.push(st.stand().spielzeitSek); } // 10 Takte = 300 s
  check('10 Takte zu 30 s im normalen Takt: erst die 5-Minuten-Stufe aendert den Wert', JSON.stringify(gemeldet) === '[0,0,0,0,0,0,0,0,0,300]', JSON.stringify(gemeldet));
  check('hoechstens eine Aenderung je 5 Minuten (untaetiger Spieler schreibt kaum)', new Set(gemeldet).size <= 2);
  t += 70_000;
  check('exakt (Abmelden/Tod/Stopp): sekundengenau (370 s)', st.stand(true).spielzeitSek === 370);
  check('danach sinkt die Meldung im normalen Takt nicht (370, nicht 300)', st.stand().spielzeitSek === 370);
  t += 240_000; // 610 s genau -> Stufe 600
  check('spaeter wieder in Stufen (610 s -> 600)', st.stand().spielzeitSek === 600, String(st.stand().spielzeitSek));
  const ge = new Spielwerte(() => t);
  ge.laden({ spielzeitSek: 1000 });
  check('geladener Stand 1000 s wird im normalen Takt nicht unterschritten (nicht 900)', ge.stand().spielzeitSek === 1000, String(ge.stand().spielzeitSek));
}

// ── [2] Ruestkammer ──────────────────────────────────────────────
function zeile(): ArmoryZeile {
  return { id: 1, kontoId: 1, spielerId: 'x', kontoName: 'k', name: 'Ragnar', klasse: 'krieger', figur: 'male', frisur: 'short', haarfarbe: 'brown', augenfarbe: 'blue', erstellt: 1_700_000_000_000, zuletztGespielt: 1_700_000_000_000 };
}
const profil = (daten: unknown) => baueProfil(zeile(), daten === null ? null : JSON.stringify(daten));
function teil2(): void {
  console.log('\n[2] Ruestkammer');
  const leer = profil({ name: 'Ragnar' }) as unknown as Record<string, unknown>;
  check('Altstand: tode/spielzeitMinuten/stufe/fertigkeiten fehlen (nicht 0, nicht null)',
    !('tode' in leer) && !('spielzeitMinuten' in leer) && !('stufe' in leer) && !('fertigkeiten' in leer) && !('erfahrung' in leer), Object.keys(leer).join(','));
  check('kein Spielstand (null) wirft nicht und laesst die Felder weg', !('tode' in (profil(null) as object)));
  const p = profil({ tode: 3, spielzeitSek: 3 * 3600 + 3599 }) as unknown as Record<string, unknown>;
  check('tode 3, Spielzeit 3 h 59 min 59 s -> 180 Minuten (volle Stunden)', p.tode === 3 && p.spielzeitMinuten === 180, JSON.stringify([p.tode, p.spielzeitMinuten]));
  check('Spielzeit ist immer ein Vielfaches von 60', [0, 59, 3599, 3600, 7261, 99999].every((s) => (profil({ spielzeitSek: s }).spielzeitMinuten as number) % 60 === 0));
  check('unter einer Stunde -> 0 Minuten (erfasst, aber 0 h)', profil({ spielzeitSek: 3599 }).spielzeitMinuten === 0);
  check('tode 0 bleibt 0 (erfasst)', profil({ tode: 0 }).tode === 0);
  const g = profil({
    stufe: 7, xp: 120, xpGesamt: 9999, erfahrung: 5,
    fertigkeiten: { schmieden: { rang: 4, xp: 50 }, kochen: { rang: 2, xp: 7 }, '': { rang: 1 }, 'a b': { rang: 1 }, kaputt: 5, negativ: { rang: -1 }, ohne: {}, rangnull: { rang: 0 }, rangkomma: { rang: 0.5 } },
  });
  check('stufe 7', g.stufe === 7);
  check('fertigkeiten: name = Schluessel fertigkeit.<id>, stufe = rang, sortiert, Ungueltiges weg',
    JSON.stringify(g.fertigkeiten) === JSON.stringify([{ name: 'fertigkeit.kochen', stufe: 2 }, { name: 'fertigkeit.schmieden', stufe: 4 }]), JSON.stringify(g.fertigkeiten));
  const text = JSON.stringify(g);
  check('XP wird nicht ausgegeben (weder xp, xpGesamt noch erfahrung noch deren Werte)', !/"(xp|xpGesamt|erfahrung)"/i.test(text) && !/[:,[](9999|120)[,}\]]/.test(text), text.slice(0, 200));
  check('Fertigkeit mit rang < 1 (0, 0,5, negativ) wird nicht ausgegeben', JSON.stringify((profil({ fertigkeiten: { a: { rang: 0 }, b: { rang: 0.5 }, c: { rang: -1 } } }) as { fertigkeiten?: unknown }).fertigkeiten) === undefined);
  check('stufe 0 / negativ / Text entfaellt', profil({ stufe: 0 }).stufe === undefined && profil({ stufe: -1 }).stufe === undefined && profil({ stufe: 'x' }).stufe === undefined);
  const kaputt = profil({ tode: -1, spielzeitSek: 'viel', fertigkeiten: [1, 2], stufe: Number.NaN });
  check('kaputte Werte entfallen', kaputt.tode === undefined && kaputt.spielzeitMinuten === undefined && kaputt.fertigkeiten === undefined && kaputt.stufe === undefined);
  const riesig = profil({ tode: 1e30, spielzeitSek: 1e30 });
  check('riesige Werte werden gekappt', riesig.tode === TODE_MAX && riesig.spielzeitMinuten === Math.floor(SPIELZEIT_MAX_SEK / 3600) * 60);
  const viele: Record<string, unknown> = {};
  for (let i = 0; i < 500; i++) viele[`f${i}`] = { rang: 1 };
  check('Fertigkeitenzahl begrenzt', (profil({ fertigkeiten: viele }).fertigkeiten?.length ?? 0) <= 64);
}

// ── [3] Server ───────────────────────────────────────────────────
const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, AuthChallenge: 68 };
let PORT = 0;
interface Socke extends WebSocket { tod: number; }
const GEHEIMNIS = Buffer.from('cd'.repeat(32), 'hex');
const SPIELER_ID = spielerIdErzeugen();
const TOKEN = tokenAusstellen(SPIELER_ID, 4712n, GEHEIMNIS);

function verbinde(name: string): Promise<Socke> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as Socke;
    ws.binaryType = 'nodebuffer';
    ws.tod = 0;
    let auth = false;
    const timer = setTimeout(() => fail(new Error(`handshake timeout: ${name}`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (auth) return;
        auth = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString(TOKEN);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === PacketType.PlayerTod) {
        ws.tod++;
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}

type Zeilen = Array<{ name: string; tode?: number; spielzeitSek?: number }>;
function baue() {
  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'spielwerte',
    saveIntervalMs: 3600_000, spielerSicherungMs: 3600_000, everyoneAdmin: true,
    worldCreatures: false, worldFeatures: false, worldVegetation: false, sessionSecret: GEHEIMNIS,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId: string, target?: Vector3): void;
    spielerSicherung: { sichere(...args: unknown[]): number; laden(): Zeilen };
  };
  return { server, zugriff };
}
const peerVon = (server: ReturnType<typeof baue>['server'], name: string): Peer | undefined => server.net.getPeers().find((x) => x.name === name) as Peer | undefined;

async function toete(server: ReturnType<typeof baue>['server'], zugriff: ReturnType<typeof baue>['zugriff'], anna: Peer): Promise<void> {
  anna.health = 5; anna.blockSeit = 0;
  zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
  void server;
  await warte(300);
}

let spielzeitVorher = -1;

async function teil3(): Promise<void> {
  console.log('\n[3] Echter Server');
  const a = baue();
  const sockets: WebSocket[] = [];
  const beiTod: Array<{ tode?: number; spielzeitSek?: number }> = [];
  const echt = a.zugriff.spielerSicherung.sichere.bind(a.zugriff.spielerSicherung);
  a.zugriff.spielerSicherung.sichere = (...args: unknown[]): number => {
    if (args[1] === 'tod') beiTod.push({ ...(args[0] as Zeilen)[0] });
    return echt(...args);
  };
  const zeileAnna = (z: typeof a.zugriff) => z.spielerSicherung.laden().find((s) => s.name === 'Anna');
  try {
    const ws = await verbinde('Anna');
    sockets.push(ws);
    const anna = peerVon(a.server, 'Anna')!;
    check('neuer Charakter: noch nichts gesichert', zeileAnna(a.zugriff) === undefined);
    const verbundenSeit = Date.now();
    // Untaetiger Spieler, 10 Takte (je 250 ms): auf main schreibt der erste Takt eine Zeile, die anderen nichts (Zahlen unten im Bericht).
    const sichereTakt = (_p: readonly Peer[], g: string): void => (a.server as unknown as { sichereSpielerSofort(p: Peer, g: string): void }).sichereSpielerSofort(anna, g);
    const z0 = a.zugriff.spielerSicherung.stats().zeilen;
    const je: number[] = [];
    for (let i = 0; i < 10; i++) {
      const vor = a.zugriff.spielerSicherung.stats().zeilen;
      sichereTakt(a.server.net.getPeers(), 'takt');
      je.push(a.zugriff.spielerSicherung.stats().zeilen - vor);
      await warte(250);
    }
    check('untaetiger Spieler, 10 Takte: hoechstens eine Zeile (die erste), danach keine (wie auf main)', a.zugriff.spielerSicherung.stats().zeilen - z0 <= 1 && je.slice(1).every((n) => n === 0), JSON.stringify(je));
    check('die erste Zeile traegt beide Felder (Altstand bekommt sie beim ersten Sichern): tode 0, spielzeitSek 0 (noch unter der ersten Stufe)',
      zeileAnna(a.zugriff)?.tode === 0 && zeileAnna(a.zugriff)?.spielzeitSek === 0, JSON.stringify(zeileAnna(a.zugriff)).slice(0, 120));
    // Weltspeichern ist exakt (nicht in 5-Minuten-Stufen): nach ~2,5 s Spielzeit steht sie sekundengenau im Weltstand.
    const weltmanager = (a.server as unknown as { worldManager: { save(d: { players: Array<{ name: string; spielzeitSek?: number }> }): void } }).worldManager;
    const echtSpeichern = weltmanager.save.bind(weltmanager);
    let weltSpieler: Array<{ name: string; spielzeitSek?: number }> = [];
    weltmanager.save = (d): void => { weltSpieler = d.players; echtSpeichern(d as never); };
    a.server.saveWorld();
    const imWelt = weltSpieler.find((x) => x.name === 'Anna')?.spielzeitSek;
    const seitAnmeldung = Math.ceil((Date.now() - verbundenSeit) / 1000);
    check('Weltspeichern: Spielzeit sekundengenau im Weltstand (>= 2 s, nicht die Stufe 0)', imWelt !== undefined && imWelt >= 2 && imWelt <= seitAnmeldung, `${imWelt} s bei ${seitAnmeldung} s`);
    weltmanager.save = echtSpeichern;
    a.server.liegezeitMs = 400;
    await toete(a.server, a.zugriff, anna);
    check('Anna liegt tot (ein PlayerTod)', ws.tod === 1 && anna.totBis > 0);
    // Zweiter Treffer auf eine Tote: nimmt nichts, zaehlt nichts.
    a.zugriff.applyCreatureAttack({ x: anna.position.x + 1, y: anna.position.y, z: anna.position.z - 2 }, 8, 2.4, anna.worldId, anna.position);
    await warte(100);
    check('der Zaehler steht vor der Wiederbelebung auf 1 (nicht doppelt durch Mehrfachtreffer)', anna.spielwerte.stand().tode === 1, String(anna.spielwerte.stand().tode));
    const t0 = Date.now();
    while (anna.totBis > 0 && Date.now() - t0 < 6000) await warte(25);
    check('Wiederbelebung: genau eine Sicherung "tod", sie traegt tode 1 und die exakte Spielzeit (>= 2 s)', beiTod.length === 1 && beiTod[0]!.tode === 1 && (beiTod[0]!.spielzeitSek ?? 0) >= 2, JSON.stringify(beiTod));
    check('die Zeile in der Kontendatenbank traegt tode 1', zeileAnna(a.zugriff)?.tode === 1, JSON.stringify(zeileAnna(a.zugriff)));
    a.server.liegezeitMs = 0;
    await toete(a.server, a.zugriff, anna);
    check('Sofort-Wiederbelebung (Liegezeit 0): zweiter Tod -> 2, in der "tod"-Sicherung', beiTod.length === 2 && beiTod[1]!.tode === 2, JSON.stringify(beiTod));

    await warte(1300); // mindestens eine Sekunde Spielzeit NACH der letzten Tod-Sicherung
    const nachTod = beiTod[beiTod.length - 1]!.spielzeitSek ?? 0;
    ws.close();
    const t1 = Date.now();
    while (peerVon(a.server, 'Anna') && Date.now() - t1 < 4000) await warte(25);
    check('Anna ist abgemeldet', peerVon(a.server, 'Anna') === undefined);
    const stand = zeileAnna(a.zugriff);
    const wandSek = Math.ceil((Date.now() - verbundenSeit) / 1000);
    check('Abmelden sichert tode 2 und die EXAKTE Spielzeit (>= 2 s gespielt, hoechstens die Wandzeit)', stand?.tode === 2 && stand.spielzeitSek! >= nachTod + 1 && stand.spielzeitSek! <= wandSek, `${stand?.spielzeitSek} s bei ${wandSek} s Wandzeit`);
    spielzeitVorher = stand?.spielzeitSek ?? -1;
    const frozen = anna.spielwerte.stand(true).spielzeitSek;
    await warte(1300);
    check('nach dem Abmelden zaehlt die Spielzeit des alten Peers nicht weiter', anna.spielwerte.stand(true).spielzeitSek === frozen, `${frozen} -> ${anna.spielwerte.stand(true).spielzeitSek}`);

    const ws2 = await verbinde('Anna');
    sockets.push(ws2);
    const anna2 = peerVon(a.server, 'Anna')!;
    check('Wiederanmelden: tode 2 geladen (kein Zuruecksetzen, kein Doppelzaehlen)', anna2.spielwerte.stand().tode === 2, String(anna2.spielwerte.stand().tode));

    // Z2: jeder Tod kommt an `stirb` bzw. `belebeNeu(.., true)` vorbei, nicht nur der Schadensblock.
    const innen = a.server as unknown as { stirb(p: Peer, clip: (typeof TOD_CLIPS)[number]): void; belebeNeu(p: Peer, sofort: boolean): void };
    const nTod = beiTod.length;
    innen.stirb(anna2, TOD_CLIPS[0]!);
    check('stirb direkt aufgerufen: tode +1 (2 -> 3)', anna2.spielwerte.stand().tode === 3, String(anna2.spielwerte.stand().tode));
    innen.belebeNeu(anna2, false);
    check('Wiederbelebung nach dem Liegen zaehlt nichts dazu, und die "tod"-Sicherung traegt 3', anna2.spielwerte.stand().tode === 3 && beiTod.length === nTod + 1 && beiTod[nTod]!.tode === 3, JSON.stringify(beiTod.slice(nTod).map((x) => x.tode)));
    innen.belebeNeu(anna2, true);
    check('belebeNeu(sofort) direkt aufgerufen (Tod ohne Liegezeit): tode +1 (3 -> 4), in der "tod"-Sicherung', anna2.spielwerte.stand().tode === 4 && beiTod[beiTod.length - 1]!.tode === 4, String(anna2.spielwerte.stand().tode));
  } finally {
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.close();
    a.server.stop();
  }

  console.log('\n[3b] Neustart');
  const b = baue();
  const sockets2: WebSocket[] = [];
  try {
    const ws = await verbinde('Anna');
    sockets2.push(ws);
    const anna = peerVon(b.server, 'Anna')!;
    check('nach dem Neustart: tode 4 aus dem Spielerzustand', anna.spielwerte.stand().tode === 4, String(anna.spielwerte.stand().tode));
    check('Spielzeit bleibt erhalten (>= exakter Stand vor dem Neustart, und der war >= 2)', spielzeitVorher >= 2 && anna.spielwerte.stand(true).spielzeitSek >= spielzeitVorher, `${spielzeitVorher} -> ${anna.spielwerte.stand(true).spielzeitSek}`);
  } finally {
    for (const s of sockets2) if (s.readyState === WebSocket.OPEN) s.close();
    b.server.stop();
  }
}

teil1();
teil2();
teil3()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
