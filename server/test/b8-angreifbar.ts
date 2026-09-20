/**
 * B8 — die eigenen NPCs sind treffbar (ANGREIFBAR) und schlagen zurueck,
 * ueber den ECHTEN Paketweg.
 *
 * Ein echter WebSocket-Client, echter Handshake, Attack-/Parry-/Eingabe-
 * pakete durch NetManager.handlePacket bis WovServer.handleAttack bzw.
 * handleParry. Die NPCs werden OHNE Spawnsystem von der Probe selbst
 * gesetzt (`worldCreatures: false`, `server.spawns === null`); der
 * Zurueckschlag kommt aus dem AggroSystem im normalen Welt-Tick, nicht aus
 * einem Aufruf im Test. Gelesen wird nur der WIRKUNGSABDRUCK: Lebenspunkte
 * des Peers, Lebenspunkte und Anim-Member des NPC-ZDO, die Meldungen an den
 * Client. Der einzige Eingriff ist ein zaehlender Beobachter um
 * `aggro.onSchlag` (er ruft die echte Verdrahtung weiter auf) — er
 * unterscheidet „NPC hat zugeschlagen“ von „Schlag hat getroffen“.
 *
 * Abschnitte (Nummern wie in der Karte B8):
 *  [1] Tabellen: ANGREIFBAR sitzt genau an den NPC_KAMPF-Eintraegen; Zahlen.
 *  [2] Ohne Flag unverwundbar, mit Flag genau der Waffenschaden; Tod.
 *  [3] Zurueckschlagen: ein Furloc-Krieger verfolgt und trifft, Takt gemessen.
 *  [4] Parade: Treffer im Fenster kostet Ausdauer statt Leben.
 *  [5] Friedliche (Voelva, Dorfbewohner, Basis-Wikinger): kein Schaden,
 *      kein Schlag — auch nicht nach einem Angriff auf sie. [5b] Ein
 *      feindlicher NPC ohne Kampfwerte schlaegt nicht zu.
 *  [6] Reichweite: nur im Angriffsabstand; zwei Faelle plus die Grenze.
 *  [7] Kein Spawnsystem noetig.
 *  [8] Welt-Filter: ein Schlag und sein Treffer-Blitz gelten nur Spielern
 *      derselben Welt (Instanzen liegen am Ursprung).
 *  [9] Ein Schlag-Aufruf ohne (oder mit leerer) Welt wird gemeldet und
 *      verworfen, nicht geworfen; der Tick laeuft weiter.
 *
 * Run: npx tsx server/test/b8-angreifbar.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  ANIM_MEMBER,
  HEALTH_MEMBER,
  NPC_KAMPF,
  NPC_VORGABEN,
  PrefabFlag,
  getStableHash,
  maxLeben,
  npcKampf,
  type NpcDef,
  type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-b8-angreifbar');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2530;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerInput: 40,
  InteractResult: 45,
  Attack: 46,
  AdminCommand: 53,
  AdminEvent: 54,
  Parry: 58,
  HitEffect: 59,
  AuthChallenge: 68,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const jetzt = (): number => performance.now();

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
        const w = new Writer();
        w.writeString(antwortBerechnen(nonce, ''));
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

/** Ehrlich in eine Richtung drehen (20 Hz Eingabepakete), wie der Browser. */
async function blicke(ws: WebSocket, yaw: number, dauerMs = 400): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) {
    sendInput(ws, yaw);
    await warte(50);
  }
}

function sendAttack(ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

function sendParry(ws: WebSocket): void {
  ws.send(Buffer.from([P.Parry]));
}

/** Waffenschaden laut WovServer.WAFFEN_SCHADEN — hier bewusst als Literal, damit ein Drehen daran auffaellt. */
const SCHADEN_FAUST = 4;
const SCHADEN_AXT = 15;

const flagAn = (def: { flags: bigint } | undefined): boolean =>
  typeof PrefabFlag.ANGREIFBAR === 'bigint' && ((def?.flags ?? 0n) & PrefabFlag.ANGREIFBAR) !== 0n;

interface Abtastung {
  t: number;
  health: number;
  stamina: number;
}
interface Treffer {
  t: number;
  schaden: number;
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: PORT,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'b8-angreifbar',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    // Keine Kreaturen und kein Gelaende-Aufwand: Der Test soll allein den
    // NPC vor sich haben, und ein Wildschwein aus dem Spawnsystem wuerde
    // die Lebenspunktereihen verfaelschen.
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
  });
  server.start();

  try {
    const ws = await verbinde('Kaempfer');
    const meldungen: string[] = [];
    ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) !== P.InteractResult) return;
      const reader = new Reader(Buffer.from(data.subarray(1)));
      reader.readBool();
      meldungen.push(reader.readString());
    });
    const peer = server.net.getPeers().find((p) => p.name === 'Kaempfer');
    if (!peer) throw new Error('Peer nicht gefunden');

    // Beobachter um die echte Verdrahtung: zaehlt jeden Schlag eines NPC,
    // ob er trifft oder pariert wird, und reicht ihn unveraendert weiter.
    const schlaege: { t: number; schaden: number; radius: number }[] = [];
    const echt = server.aggro.onSchlag;
    server.aggro.onSchlag = (pos, schaden, radius) => {
      schlaege.push({ t: jetzt(), schaden, radius });
      echt?.(pos, schaden, radius);
    };

    const YAW_MINUS_Z = 0;
    const hashVon = (name: string): number => getStableHash(name);
    const hp = (zdo: ZDO): number => zdo.getInt(HEALTH_MEMBER);

    /** Punkt in `abstand` m Richtung -Z (Blickrichtung Yaw 0) vom Spieler. */
    const vorn = (von: Vector3, abstand: number): Vector3 => ({ x: von.x, y: von.y, z: von.z - abstand });

    /** Ein NPC wie das Layout ihn setzt: Prefab, Position, volle Lebenspunkte. */
    function setzeNpc(name: string, pos: Vector3): ZDO {
      const zdo = server.zdos.createZDO(hashVon(name), pos);
      zdo.setInt(HEALTH_MEMBER, maxLeben(name));
      return zdo;
    }
    const entferne = (zdo: ZDO): void => {
      if (!zdo.destroyed) server.zdos.destroyZDO(zdo.zdoid);
    };

    /** Frischer Platz, frische Werte. Der Teleport wird nachgeprueft. */
    async function neuerPlatz(x: number, z: number): Promise<Vector3> {
      sendAdmin(ws, `teleport ${x} ${z}`);
      await warte(300);
      const p = peer!.position;
      if (Math.hypot(p.x - x, p.z - z) > 1) {
        throw new Error(`Teleport nach ${x},${z} hat nicht gewirkt (Spieler steht bei ${p.x},${p.z})`);
      }
      peer!.health = 100;
      peer!.stamina = 100;
      peer!.paradeBis = 0;
      meldungen.length = 0;
      schlaege.length = 0;
      return { ...p };
    }

    /** Alle 10 ms Lebenspunkte und Ausdauer des Spielers lesen. */
    async function beobachte(dauerMs: number, bis?: (a: Abtastung[]) => boolean): Promise<Abtastung[]> {
      const reihe: Abtastung[] = [];
      const ende = jetzt() + dauerMs;
      while (jetzt() < ende) {
        reihe.push({ t: jetzt(), health: peer!.health, stamina: peer!.stamina });
        if (bis?.(reihe)) break;
        await warte(10);
      }
      return reihe;
    }
    /** Jeder Abfall der Lebenspunkte als Treffer mit Zeit und Betrag. */
    function treffer(reihe: readonly Abtastung[]): Treffer[] {
      const aus: Treffer[] = [];
      for (let i = 1; i < reihe.length; i++) {
        const d = reihe[i - 1].health - reihe[i].health;
        if (d > 0) aus.push({ t: reihe[i].t, schaden: d });
      }
      return aus;
    }
    const abstandZu = (zdo: ZDO, p: Vector3): number => Math.hypot(zdo.position.x - p.x, zdo.position.z - p.z);
    const f = (n: number, k = 2): string => n.toFixed(k);

    // ── [1] Tabellen ───────────────────────────────────────────────
    console.log('\n[1] ANGREIFBAR sitzt genau an den Figuren mit Kampfwerten:');
    const npcNamen = [...NPC_VORGABEN.keys()];
    const mitFlag = npcNamen.filter((n) => flagAn(server.prefabs.getByHash(hashVon(n))));
    const ohneFlag = npcNamen.filter((n) => !mitFlag.includes(n));
    console.log(`      NPC-Prefabs ${npcNamen.length}; mit Flag ${mitFlag.length}: ${mitFlag.join(', ')}`);
    console.log(`      ohne Flag ${ohneFlag.length}: ${ohneFlag.join(', ')}`);
    const kampfNamen = [...NPC_KAMPF.keys()];
    check(
      'die Prefabs mit Flag sind genau die NPC_KAMPF-Eintraege',
      mitFlag.length === kampfNamen.length && kampfNamen.every((n) => mitFlag.includes(n)),
      `Flag=${mitFlag.length} NPC_KAMPF=${kampfNamen.length}`
    );
    check('Surtr und die sechs Furlocs tragen das Flag', mitFlag.length === 7 && mitFlag.includes('Surtr'));
    check(
      'Voelva, Dorfbewohner (NPC_1) und Basis-Wikinger tragen es nicht',
      ['Voelva', 'NPC_1', 'WikingerBasis'].every((n) => ohneFlag.includes(n)) && ohneFlag.length === 3
    );
    const ki = PrefabFlag.ANIMAL_AI | PrefabFlag.MONSTER_AI;
    check(
      'kein NPC traegt ein *_AI-Flag (das Spawnsystem verwaltet keinen)',
      npcNamen.every((n) => ((server.prefabs.getByHash(hashVon(n))?.flags ?? 0n) & ki) === 0n)
    );
    // Die Zahlen stammen aus den Kreaturen des Spawnsystems (8 Punkte, 2 s),
    // nicht aus einer neuen Abstufung.
    const soll = npcKampf('FurlocKrieger');
    check(
      'Kampfwerte des Furloc-Kriegers: Schaden 8, Takt 2 s, Angriff 4 m',
      soll.schaden === 8 && soll.takt === 2 && soll.angriff === 4,
      `${soll.schaden} / ${soll.takt} s / ${soll.angriff} m`
    );

    // ── [2] Ohne Flag unverwundbar, mit Flag verwundbar ───────────
    console.log('\n[2] Trefferweg: Voelva (kein Flag) vs. Furloc-Krieger (Flag):');
    let mitte = await neuerPlatz(300, 300);
    const voelva = setzeNpc('Voelva', vorn(mitte, 2));
    await blicke(ws, YAW_MINUS_Z);
    peer.stamina = 100;
    sendAttack(ws, mitte, 'AxeFlint', YAW_MINUS_Z);
    await warte(400);
    check(
      'Voelva: kein Schaden — Lebenspunkte unberuehrt',
      hp(voelva) === maxLeben('Voelva') && !voelva.destroyed,
      `hp=${hp(voelva)}/${maxLeben('Voelva')}`
    );
    entferne(voelva);

    mitte = await neuerPlatz(340, 340);
    const krieger = setzeNpc('FurlocKrieger', vorn(mitte, 2));
    const start = maxLeben('FurlocKrieger');
    await blicke(ws, YAW_MINUS_Z);
    sendAttack(ws, mitte, 'AxeFlint', YAW_MINUS_Z);
    await warte(450);
    const nachAxt = hp(krieger);
    check(
      `Krieger: die Axt nimmt genau ${SCHADEN_AXT}`,
      start - nachAxt === SCHADEN_AXT,
      `${start} -> ${nachAxt} (Schaden ${start - nachAxt})`
    );
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(450);
    check(
      `Krieger: die Faust nimmt genau ${SCHADEN_FAUST}`,
      nachAxt - hp(krieger) === SCHADEN_FAUST,
      `${nachAxt} -> ${hp(krieger)} (Schaden ${nachAxt - hp(krieger)})`
    );
    // Tod: auf 10 setzen, ein Axtschlag beendet ihn.
    krieger.setInt(HEALTH_MEMBER, 10);
    sendAttack(ws, mitte, 'AxeFlint', YAW_MINUS_Z);
    await warte(450);
    check('Krieger stirbt am Axtschlag (ZDO zerstoert)', krieger.destroyed);
    check('Sieg-Meldung an den Spieler', meldungen.some((m) => m.includes('FurlocKrieger besiegt')), meldungen.slice(-2).join(' | '));
    await warte(400);
    // `zustand` ist privat; gelesen wird nur seine Groesse.
    const zustaende = (server.aggro as unknown as { zustand: Map<string, unknown> }).zustand.size;
    check(
      'AggroSystem laesst den Erschlagenen los (keine Sperre, kein Zustand)',
      server.aggro.aggroCount === 0 && zustaende === 0,
      `aggroCount=${server.aggro.aggroCount}, Zustaende=${zustaende}`
    );
    entferne(krieger);

    // ── [3] Zurueckschlagen ────────────────────────────────────────
    console.log('\n[3] Zurueckschlagen: der Krieger verfolgt und trifft im Takt:');
    mitte = await neuerPlatz(500, 500);
    const verfolger = setzeNpc('FurlocKrieger', vorn(mitte, 8));
    const w3 = npcKampf('FurlocKrieger');
    const reihe3 = await beobachte(25_000, (r) => treffer(r).length >= 5);
    const t3 = treffer(reihe3);
    const abstandEnde = abstandZu(verfolger, mitte);
    check('er hat verfolgt: von 8 m auf den Angriffsabstand', Math.abs(abstandEnde - w3.angriff) < 0.05, `Abstand am Ende ${f(abstandEnde)} m (Soll ${w3.angriff})`);
    check('mindestens fuenf Schlaege', t3.length >= 5, `${t3.length}`);
    check(
      `jeder Schlag nimmt genau ${w3.schaden} Lebenspunkte`,
      t3.length > 0 && t3.every((x) => x.schaden === w3.schaden),
      t3.map((x) => x.schaden).join(',')
    );
    const abstaende = t3.slice(1).map((x, i) => (x.t - t3[i].t) / 1000);
    console.log(`      Abstaende zwischen den Schlaegen (s): ${abstaende.map((a) => f(a)).join(', ')}`);
    const mittel = abstaende.reduce((s, a) => s + a, 0) / Math.max(1, abstaende.length);
    check(
      `jeder Abstand liegt beim Takt ${w3.takt} s (Prueftakt ~0,27 s)`,
      abstaende.length >= 4 && abstaende.every((a) => a >= w3.takt - 0.3 && a <= w3.takt + 0.3),
      `min ${f(Math.min(...abstaende))} max ${f(Math.max(...abstaende))}`
    );
    check(
      `Mittel ueber ${abstaende.length} Abstaende ist der Takt ${w3.takt} s +-0,1`,
      abstaende.length >= 4 && Math.abs(mittel - w3.takt) <= 0.1,
      `Mittel ${f(mittel, 3)} s`
    );
    check(
      'Lebenspunkte des Spielers: 100 - Schlaege x Schaden',
      peer.health === 100 - t3.length * w3.schaden,
      `${peer.health} (Soll ${100 - t3.length * w3.schaden})`
    );
    check('der Beobachter sah genauso viele Schlaege wie die Lebenspunkte fielen', schlaege.length === t3.length, `${schlaege.length} vs ${t3.length}`);
    check('der Schlag traegt den Angriffsabstand als Radius', schlaege.every((s) => s.radius === w3.angriff), `${schlaege[0]?.radius}`);
    entferne(verfolger);

    // ── [4] Parade ─────────────────────────────────────────────────
    console.log('\n[4] Parade: Treffer im Fenster kostet Ausdauer statt Leben:');
    mitte = await neuerPlatz(700, 700);
    const parierer = setzeNpc('FurlocKrieger', vorn(mitte, 3));
    // Einmal ohne Umschweife: was kostet eine Parade?
    peer.stamina = 100;
    sendParry(ws);
    await warte(120);
    check('eine Parade kostet genau 4 Ausdauer', peer.stamina === 96, `stamina=${peer.stamina}`);
    peer.paradeBis = 0;
    // Dann dauernd im Fenster stehen (600 ms Fenster, Parade alle 450 ms) und
    // bei JEDER Parade den Abzug messen.
    let paraden = 0;
    const abzuege: number[] = [];
    const ende4 = jetzt() + 7_000;
    let minHealth = 100;
    while (jetzt() < ende4) {
      if (peer.stamina < 8) peer.stamina = 100;
      const vor = peer.stamina;
      sendParry(ws);
      paraden++;
      await warte(60);
      abzuege.push(vor - peer.stamina);
      const r = await beobachte(390);
      for (const a of r) minHealth = Math.min(minHealth, a.health);
    }
    const abgewehrt = meldungen.filter((m) => m === 'Pariert').length;
    console.log(`      ${schlaege.length} Schlaege des NPC, ${abgewehrt} abgewehrt, ${paraden} Paraden, tiefster Lebenswert ${minHealth}`);
    check('der NPC hat zugeschlagen (mindestens drei Schlaege)', schlaege.length >= 3, `${schlaege.length}`);
    check('kein Lebenspunkt verloren', minHealth === 100 && peer.health === 100, `tiefster Wert ${minHealth}`);
    check('jeder Schlag wurde als „Pariert“ gemeldet', abgewehrt === schlaege.length, `${abgewehrt} von ${schlaege.length}`);
    check(
      'jede der Paraden kostete genau 4 Ausdauer',
      abzuege.length === paraden && abzuege.every((d) => d === 4),
      `${paraden} Paraden, Abzuege ${[...new Set(abzuege)].join('/')}`
    );
    // Gegenprobe: ohne Parade geht derselbe Schlag durch.
    meldungen.length = 0;
    schlaege.length = 0;
    peer.paradeBis = 0;
    const gegen = await beobachte(6_000, (r) => treffer(r).length >= 1);
    const g = treffer(gegen);
    check('Gegenprobe ohne Parade: derselbe Schlag nimmt 8 Lebenspunkte', g.length >= 1 && g[0].schaden === w3.schaden && peer.health === 100 - w3.schaden, `Lebenspunkte ${peer.health}`);
    entferne(parierer);

    // ── [5] Friedliche ─────────────────────────────────────────────
    console.log('\n[5] Friedliche: Voelva, Dorfbewohner, Basis-Wikinger:');
    mitte = await neuerPlatz(900, 900);
    const friedliche = ['Voelva', 'NPC_1', 'WikingerBasis'].map((n, i) => {
      const yaw = (i * 2 * Math.PI) / 3;
      const pos = { x: mitte.x - Math.sin(yaw) * 2, y: mitte.y, z: mitte.z - Math.cos(yaw) * 2 };
      return { name: n, yaw, zdo: setzeNpc(n, pos), pos0: { ...pos } };
    });
    let angriffe = 0;
    for (const fr of friedliche) {
      await blicke(ws, fr.yaw);
      peer.stamina = 100;
      sendAttack(ws, mitte, 'AxeFlint', fr.yaw);
      angriffe++;
      await warte(450);
    }
    // Nach den Angriffen noch sieben Sekunden zusehen (drei Takte).
    const reihe5 = await beobachte(7_000);
    for (const fr of friedliche) {
      check(
        `${fr.name}: kein Schaden, lebt`,
        hp(fr.zdo) === maxLeben(fr.name) && !fr.zdo.destroyed,
        `hp=${hp(fr.zdo)}/${maxLeben(fr.name)}`
      );
      check(
        `${fr.name}: rueckt nicht vor, schlaegt nicht (Anim-Member ist nicht „attack“)`,
        Math.hypot(fr.zdo.position.x - fr.pos0.x, fr.zdo.position.z - fr.pos0.z) === 0 && fr.zdo.getString(ANIM_MEMBER) !== 'attack',
        `anim=${JSON.stringify(fr.zdo.getString(ANIM_MEMBER))}`
      );
    }
    check(
      `nach ${angriffe} Angriffen auf sie und 7 s Wartezeit: kein Schlag, Spieler unverletzt`,
      schlaege.length === 0 && reihe5.every((a) => a.health === 100) && server.aggro.aggroCount === 0,
      `${schlaege.length} Schlaege, tiefster Wert ${Math.min(...reihe5.map((a) => a.health))}`
    );
    for (const fr of friedliche) entferne(fr.zdo);

    // [5b] Ein feindlicher NPC OHNE eigene Kampfwerte dreht sich hoechstens,
    // schlaegt nie zu. Heute gibt es keinen — also wird fuer die Dauer der
    // Probe einer eingetragen: ein Skelett (Muspel-Volk, feindlich zu
    // Wikingern) ohne NPC_KAMPF-Eintrag. Dieselbe Tabelle nutzt der Server,
    // beide Seiten laufen im selben Prozess.
    mitte = await neuerPlatz(1000, 1000);
    (NPC_VORGABEN as Map<string, NpcDef>).set('Skeleton', { name: 'Skelett', rolle: 'monster', fraktion: 'muspel' });
    const ohneWerte = setzeNpc('Skeleton', vorn(mitte, 2));
    const reihe5b = await beobachte(5_000);
    (NPC_VORGABEN as Map<string, NpcDef>).delete('Skeleton');
    check(
      'feindlicher NPC ohne Kampfwerte: er wendet sich zu (Anim „attack“) ...',
      ohneWerte.getString(ANIM_MEMBER) === 'attack',
      `anim=${JSON.stringify(ohneWerte.getString(ANIM_MEMBER))}`
    );
    check(
      '... schlaegt aber in 5 s nie zu: kein Schlag, kein Lebenspunkt verloren',
      schlaege.length === 0 && reihe5b.every((a) => a.health === 100),
      `${schlaege.length} Schlaege, Spieler ${peer.health}`
    );
    entferne(ohneWerte);

    // ── [6] Reichweite ─────────────────────────────────────────────
    console.log('\n[6] Reichweite: nur im Angriffsabstand (Krieger: aggro 18, Verfolgung 9, Angriff 4):');
    mitte = await neuerPlatz(1100, 1100);
    const fern = setzeNpc('FurlocKrieger', vorn(mitte, 14));
    const fernStart = { ...fern.position };
    const reihe6a = await beobachte(6_500);
    check(
      'draussen (14 m): 6,5 s lang kein Schlag, kein Lebenspunkt verloren',
      schlaege.length === 0 && reihe6a.every((a) => a.health === 100),
      `${schlaege.length} Schlaege, Spieler ${peer.health}`
    );
    check(
      'draussen (14 m): er bemerkt, setzt aber nicht nach — Abstand unveraendert',
      Math.hypot(fern.position.x - fernStart.x, fern.position.z - fernStart.z) === 0 && fern.getString(ANIM_MEMBER) !== 'attack',
      `Abstand ${f(abstandZu(fern, mitte))} m, anim=${JSON.stringify(fern.getString(ANIM_MEMBER))}`
    );
    entferne(fern);

    mitte = await neuerPlatz(1200, 1200);
    const nah = setzeNpc('FurlocKrieger', vorn(mitte, 3.5));
    const reihe6b = await beobachte(6_000, (r) => treffer(r).length >= 1);
    const t6b = treffer(reihe6b);
    check(
      'innen (3,5 m): er schlaegt zu — 8 Lebenspunkte, nach etwa einer Taktlaenge',
      t6b.length === 1 && t6b[0].schaden === w3.schaden && (t6b[0].t - reihe6b[0].t) / 1000 > 1.5 && (t6b[0].t - reihe6b[0].t) / 1000 < 3.0,
      `nach ${f((t6b[0]?.t ?? 0) / 1000 - reihe6b[0].t / 1000)} s, Schaden ${t6b[0]?.schaden}`
    );
    check('innen (3,5 m): er steht dabei — Abstand unveraendert 3,5 m', Math.abs(abstandZu(nah, mitte) - 3.5) < 0.01, `${f(abstandZu(nah, mitte))} m`);
    entferne(nah);

    mitte = await neuerPlatz(1300, 1300);
    const grenze = setzeNpc('FurlocKrieger', vorn(mitte, 4.6));
    const reihe6c = await beobachte(8_000, (r) => treffer(r).length >= 1);
    const t6c = treffer(reihe6c);
    check(
      'knapp ausserhalb (4,6 m): er rueckt bis auf 4,0 m heran und schlaegt erst dort zu',
      t6c.length === 1 && Math.abs(abstandZu(grenze, mitte) - w3.angriff) < 0.05,
      `Abstand beim Schlag ${f(abstandZu(grenze, mitte))} m`
    );
    entferne(grenze);

    // ── [7] Kein Spawnsystem ───────────────────────────────────────
    console.log('\n[7] Ohne Spawnsystem:');
    check('es gibt kein Spawnsystem (worldCreatures aus)', server.spawns === null);

    // ── [8] Welt-Filter ────────────────────────────────────────────
    // Alle Instanzen liegen am Ursprung, die Koordinaten zweier Welten sind
    // nicht vergleichbar. Ein Schlag (und sein Treffer-Blitz) gilt nur den
    // Spielern der Welt des Schlaegers. Zwei echte Clients: A in der
    // Hauptwelt, C im Dungeon, beide auf denselben XZ.
    console.log('\n[8] Ein Schlag trifft nur Spieler derselben Welt:');
    const wsC = await verbinde('Instanzspieler');
    const peerC = server.net.getPeers().find((p) => p.name === 'Instanzspieler');
    if (!peerC) throw new Error('Peer C nicht gefunden');
    const adminC: string[] = [];
    let blitzeA = 0;
    let blitzeC = 0;
    wsC.on('message', (data: Buffer) => {
      const t = data.readUInt8(0);
      if (t === P.HitEffect) blitzeC++;
      else if (t === P.AdminEvent) {
        const r = new Reader(Buffer.from(data.subarray(1)));
        r.readString();
        r.readBool();
        adminC.push(r.readString());
      }
    });
    ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) === P.HitEffect) blitzeA++;
    });
    const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
      const ende = jetzt() + ms;
      while (jetzt() < ende) {
        if (bedingung()) return true;
        await warte(50);
      }
      return bedingung();
    };
    sendAdmin(wsC, 'dungeon create forestcrypt 4242');
    await bis(() => adminC.some((m) => /Dungeon erzeugt: \S+/.test(m)), 8_000);
    const dungeonId = adminC.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
    if (!dungeonId) throw new Error(`Dungeon nicht erzeugt: ${adminC.join(' | ')}`);
    sendAdmin(wsC, `dungeon enter ${dungeonId}`);
    const drin = await bis(() => peerC.worldId !== 'haupt', 8_000);
    check('Spieler C steht in der Instanz (eigene Welt)', drin, `worldId=${peerC.worldId}`);
    const instanz = server.welten.get(peerC.worldId);
    if (!instanz) throw new Error('Welt der Instanz nicht gefunden');
    await warte(300);
    const stelle = { ...peerC.position };
    // A auf dieselben XZ in der Hauptwelt.
    const posA = await neuerPlatz(Math.round(stelle.x * 100) / 100, Math.round(stelle.z * 100) / 100);
    check(
      'A (Hauptwelt) und C (Instanz) stehen auf denselben XZ',
      Math.hypot(posA.x - peerC.position.x, posA.z - peerC.position.z) < 0.5 && peer.worldId === 'haupt',
      `A (${f(posA.x)}; ${f(posA.z)}) C (${f(peerC.position.x)}; ${f(peerC.position.z)}), Welten ${peer.worldId} / ${peerC.worldId}`
    );

    // Richtung 1: ein Furloc-Krieger der HAUPTWELT.
    peerC.health = 100;
    blitzeA = 0;
    blitzeC = 0;
    const ausHaupt = setzeNpc('FurlocKrieger', { x: posA.x, y: posA.y, z: posA.z });
    await beobachte(5_500);
    const n1 = schlaege.length;
    console.log(`      Oberwelt-NPC: ${n1} Schlaege; A ${peer.health}, C ${peerC.health}; Blitze A ${blitzeA}, C ${blitzeC}`);
    check('der Oberwelt-NPC hat zugeschlagen (mindestens zwei Schlaege)', n1 >= 2, `${n1}`);
    check('A (gleiche Welt) verliert 8 je Schlag', peer.health === 100 - n1 * w3.schaden, `${peer.health} (Soll ${100 - n1 * w3.schaden})`);
    check('C (andere Welt, gleiche XZ) verliert nichts', peerC.health === 100, `${peerC.health}`);
    check('A sieht jeden Treffer-Blitz', blitzeA === n1, `${blitzeA} von ${n1}`);
    check('C sieht keinen Treffer-Blitz', blitzeC === 0, `${blitzeC}`);
    entferne(ausHaupt);

    // Richtung 2: ein Furloc-Krieger der INSTANZ.
    peer.health = 100;
    peerC.health = 100;
    schlaege.length = 0;
    blitzeA = 0;
    blitzeC = 0;
    const echt2 = instanz.aggro.onSchlag;
    let n2 = 0;
    instanz.aggro.onSchlag = (pos, schaden, radius) => {
      n2++;
      echt2?.(pos, schaden, radius);
    };
    const ausInstanz = instanz.zdos.createZDO(hashVon('FurlocKrieger'), { ...peerC.position });
    ausInstanz.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
    await warte(5_500);
    console.log(`      Instanz-NPC: ${n2} Schlaege; A ${peer.health}, C ${peerC.health}; Blitze A ${blitzeA}, C ${blitzeC}`);
    check('der Instanz-NPC hat zugeschlagen (mindestens zwei Schlaege)', n2 >= 2, `${n2}`);
    check('C (gleiche Welt) verliert 8 je Schlag', peerC.health === 100 - n2 * w3.schaden, `${peerC.health} (Soll ${100 - n2 * w3.schaden})`);
    check('A (andere Welt, gleiche XZ) verliert nichts', peer.health === 100, `${peer.health}`);
    check('C sieht jeden Treffer-Blitz, A keinen', blitzeC === n2 && blitzeA === 0, `C ${blitzeC} von ${n2}, A ${blitzeA}`);
    if (!ausInstanz.destroyed) instanz.zdos.destroyZDO(ausInstanz.zdoid);
    wsC.close();

    // ── [9] Ein Aufruf ohne Welt wird gemeldet und verworfen ───────
    // b7-entsperren ruft applyCreatureAttack ueber `as unknown as`; dort sieht
    // tsc einen fehlenden Parameter nicht. Ein stilles Uebergehen aller Peers
    // hat dort den Todesweg unbemerkt tot gelegt. Geworfen wird nicht: das
    // steht im Server-Tick und kostet dort jeder Welt einen Frame. Die Zusage
    // ist: kein Schaden, kein Blitz, EIN Zaehlerstich je Aufruf, EINE
    // Meldung im Log (gedrosselt) — und der Tick laeuft weiter.
    console.log('\n[9] applyCreatureAttack/sendeTrefferEffekt ohne Welt: melden statt werfen:');
    type Schlagzugriff = {
      applyCreatureAttack(pos: Vector3, dmg: number, r: number, weltId?: unknown): void;
      sendeTrefferEffekt(pos: Vector3, art: number, weltId?: unknown): void;
      update(): void;
      ohneWeltVerworfen: number;
    };
    const zugriff = server as unknown as Schlagzugriff;
    await neuerPlatz(1500, 1500);
    const gemeldet: string[] = [];
    const echtesError = console.error;
    console.error = (...a: unknown[]): void => {
      gemeldet.push(a.map(String).join(' '));
    };
    let geworfen = '';
    try {
      // Kontrolle: mit Welt trifft der Schlag, der Zaehler bleibt stehen.
      const z0 = zugriff.ohneWeltVerworfen;
      zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, peer.worldId);
      await warte(200); // der Blitz des Kontrollschlags kommt noch an
      check('mit Welt: der Schlag trifft (100 -> 92)', peer.health === 92, `${peer.health}`);
      check('mit Welt: Zaehler unveraendert, keine Meldung', zugriff.ohneWeltVerworfen === z0 && gemeldet.length === 0, `Zaehler ${zugriff.ohneWeltVerworfen - z0}, Meldungen ${gemeldet.length}`);

      // Ohne Welt (der Fall b7-entsperren): kein Wurf, kein Schaden, kein Blitz.
      blitzeA = 0;
      const vorher = zugriff.ohneWeltVerworfen;
      try {
        zugriff.applyCreatureAttack({ ...peer.position }, 8, 5);
      } catch (e) {
        geworfen = e instanceof Error ? e.message : String(e);
      }
      await warte(150);
      check('ohne Welt: kein Wurf', geworfen === '', geworfen || '(kein Fehler)');
      check('ohne Welt: kein Schaden (92 bleibt 92), kein Blitz', peer.health === 92 && blitzeA === 0, `${peer.health} LP, ${blitzeA} Blitze`);
      check('ohne Welt: Zaehler +1', zugriff.ohneWeltVerworfen === vorher + 1, `${zugriff.ohneWeltVerworfen - vorher}`);
      check(
        'ohne Welt: EINE Meldung im Log, benennt die Stelle und weltId',
        gemeldet.length === 1 && /applyCreatureAttack/.test(gemeldet[0]) && /weltId/.test(gemeldet[0]),
        gemeldet[0] ?? '(keine Meldung)'
      );

      // Leerer String, falscher Typ: dieselbe Behandlung. Die Meldung ist
      // gedrosselt (eine je Minute), der Zaehler zaehlt jeden Aufruf.
      const v2 = zugriff.ohneWeltVerworfen;
      zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, '');
      zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, 42);
      zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, null);
      await warte(150);
      check('leerer String, Zahl, null: alle verworfen, Zaehler +3, kein Schaden', zugriff.ohneWeltVerworfen === v2 + 3 && peer.health === 92, `Zaehler +${zugriff.ohneWeltVerworfen - v2}, ${peer.health} LP`);
      check('Meldung gedrosselt: weiter nur eine', gemeldet.length === 1, `${gemeldet.length}`);

      // Auch der Treffer-Blitz allein.
      const v3 = zugriff.ohneWeltVerworfen;
      blitzeA = 0;
      zugriff.sendeTrefferEffekt({ ...peer.position }, 1);
      zugriff.sendeTrefferEffekt({ ...peer.position }, 1, '');
      await warte(200);
      check('sendeTrefferEffekt ohne/leere Welt: nichts gesendet, Zaehler +2', blitzeA === 0 && zugriff.ohneWeltVerworfen === v3 + 2, `${blitzeA} Blitze, Zaehler +${zugriff.ohneWeltVerworfen - v3}`);
      zugriff.sendeTrefferEffekt({ ...peer.position }, 1, peer.worldId);
      await warte(200);
      check('sendeTrefferEffekt mit Welt: der Blitz kommt an', blitzeA === 1, `${blitzeA}`);

      // Zeuge fuer das VERWERFEN selbst. Ohne ihn haelt der alte Weltfilter
      // dahinter jeden Fehlaufruf ab und die Wache bliebe unbewiesen: Ein
      // Peer, dessen worldId zufaellig gleich dem ungueltigen Wert ist ('' oder
      // undefined), passiert den Filter — nur die Wache haelt den Schlag dann
      // noch auf. `return true` in weltIdGueltig macht diese Proben rot.
      const peerWelt = peer as unknown as { worldId: unknown };
      const echteWelt = peer.worldId;
      try {
        for (const [name, wert] of [['leere worldId', ''], ['fehlende worldId', undefined]] as const) {
          peer.health = 100;
          blitzeA = 0;
          const vw = zugriff.ohneWeltVerworfen;
          peerWelt.worldId = wert;
          zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, wert);
          zugriff.sendeTrefferEffekt({ ...peer.position }, 1, wert);
          await warte(200);
          peerWelt.worldId = echteWelt;
          check(
            `Peer mit ${name} + Aufruf mit demselben Wert: Wache haelt Schlag und Blitz auf`,
            peer.health === 100 && blitzeA === 0 && zugriff.ohneWeltVerworfen === vw + 2,
            `${peer.health} LP, ${blitzeA} Blitze, Zaehler +${zugriff.ohneWeltVerworfen - vw}`
          );
        }
      } finally {
        peerWelt.worldId = echteWelt;
      }

      // Die Meldung selbst darf nie werfen: Welt-Objekt statt id (der Fehler
      // eines Aufrufers, der `.id` vergisst), BigInt, zyklisches Objekt,
      // werfender Getter und toJSON, Proxy mit werfenden Fallen. JSON.stringify
      // wirft bei allen. Die Drossel wird je Wert zurueckgesetzt, damit JEDER
      // bis zur Meldung kommt.
      const zyklus: Record<string, unknown> = {};
      zyklus.selbst = zyklus;
      const werfer = new Proxy(
        {},
        {
          get: () => {
            throw new Error('Getter');
          },
          ownKeys: () => {
            throw new Error('ownKeys');
          },
          getPrototypeOf: () => {
            throw new Error('Prototyp');
          },
        }
      );
      const bosartig: [string, unknown][] = [
        ['Welt-Objekt', server.hauptwelt],
        ['BigInt', 10n],
        ['zyklisches Objekt', zyklus],
        ['werfender toJSON', { toJSON: () => { throw new Error('toJSON'); } }],
        ['werfender Getter', Object.defineProperty({}, 'id', { get: () => { throw new Error('Getter'); }, enumerable: true })],
        ['Proxy', werfer],
        ['Symbol', Symbol('welt')],
      ];
      const meldung = zugriff as unknown as { ohneWeltLetzteMeldung: number };
      for (const [name, wert] of bosartig) {
        meldung.ohneWeltLetzteMeldung = 0;
        const vor = zugriff.ohneWeltVerworfen;
        const zeilen = gemeldet.length;
        let fehler = '';
        try {
          zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, wert);
        } catch (e) {
          fehler = e instanceof Error ? e.message : String(e);
        }
        check(
          `weltId = ${name}: kein Wurf, Zaehler +1, eine Logzeile`,
          fehler === '' && zugriff.ohneWeltVerworfen === vor + 1 && gemeldet.length === zeilen + 1,
          fehler ? `WURF: ${fehler}` : `Zaehler +${zugriff.ohneWeltVerworfen - vor}, ${gemeldet.length - zeilen} Zeile(n)`
        );
      }
      meldung.ohneWeltLetzteMeldung = Date.now(); // Drossel wieder scharf

      // Die Zusage, die zaehlt: der Tick laeuft weiter. Ein NPC schlaegt
      // ueber die ECHTE Aggro-Verdrahtung, aber mit einem Aufrufer, der die
      // Welt vergisst (fehlend) oder statt der id das Welt-Objekt gibt.
      // update() wird umwickelt und gezaehlt (Abbruch = Wurf im Tick).
      const tickProbe = async (was: string, weltArg: () => unknown): Promise<void> => {
        peer.health = 100;
        meldung.ohneWeltLetzteMeldung = 0;
        const echterSchlag = server.aggro.onSchlag;
        server.aggro.onSchlag = (pos, schaden, radius) => {
          zugriff.applyCreatureAttack(pos, schaden, radius, weltArg());
        };
        const echtesUpdate = zugriff.update.bind(server);
        let gestartet = 0;
        let abgebrochen = 0;
        zugriff.update = (): void => {
          gestartet++;
          // Drossel je Frame zuruecksetzen: JEDER Schlagframe erreicht die
          // Meldung (sonst formatierte nur der erste je Minute).
          meldung.ohneWeltLetzteMeldung = 0;
          try {
            echtesUpdate();
          } catch {
            abgebrochen++;
          }
        };
        const v4 = zugriff.ohneWeltVerworfen;
        const vergessen = setzeNpc('FurlocKrieger', { x: peer.position.x, y: peer.position.y, z: peer.position.z });
        await warte(4_500);
        const zaehlerNeu = zugriff.ohneWeltVerworfen - v4;
        delete (zugriff as { update?: unknown }).update;
        server.aggro.onSchlag = echterSchlag;
        entferne(vergessen);
        check(`Tick (${was}): kein einziger update()-Aufruf abgebrochen`, gestartet > 100 && abgebrochen === 0, `${gestartet} Aufrufe, ${abgebrochen} abgebrochen`);
        check(`Tick (${was}): Schlaege verworfen und gezaehlt, Spieler unverletzt`, zaehlerNeu >= 2 && peer.health === 100, `Zaehler +${zaehlerNeu}, ${peer.health} LP`);
      };
      await tickProbe('Welt vergessen', () => undefined);
      await tickProbe('Welt-Objekt statt id', () => server.hauptwelt);
      meldung.ohneWeltLetzteMeldung = Date.now();
      // ... und danach kommt ein ganz normaler Schlag mit Welt an.
      peer.health = 100;
      zugriff.applyCreatureAttack({ ...peer.position }, 8, 5, peer.worldId);
      check('danach: ein normaler Schlag mit Welt trifft (100 -> 92)', peer.health === 92, `${peer.health}`);
    } finally {
      console.error = echtesError;
    }

    console.log(failures === 0 ? '\n=== B8 Angreifbar: ALL PASSED ===' : `\n=== B8 Angreifbar: ${failures} FAILURES ===`);
    ws.close();
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
