/**
 * Besitz und Grenzen — fremde Betten/Truhen, Wiedereinstieg, Chat und Graben
 * ueber die Weltgrenze, ueber den ECHTEN Paketweg.
 *
 * Echte WebSocket-Clients (Handshake, Drossel, dann handleInteract /
 * handleContainerAction / handleChatMessage / handleTerrainOp). Am Server
 * vorbei greifen nur: ZDOs werden direkt angelegt (wie in b7-entsperren.ts),
 * der Tod kommt ueber `applyCreatureAttack`, und der Wiedereinstieg ins
 * Koordinatenband wird ueber `teleportPeer` an seinen Ort gestellt.
 * Der Testport ist ephemer: ein freier Port wird beim Start erfragt.
 *
 *  [A1] Fremdes Bett setzt keinen Wiedereinstieg; eigenes Bett und
 *       Weltbett (ohne Besitzer) schon; Bett in einer Instanz nicht.
 *  [A2] Fremde Truhe: weder oeffnen noch nehmen noch hineinlegen. Eigene
 *       Truhe und Truhen ohne Besitzer (Weltcontainer, Grabtruhe) offen.
 *  [B1] Wiedereinstiegspunkt im Koordinatenband → Weltspawn.
 *  [B2] Chat kreuzt die Weltgrenze nicht, in allen drei Reichweiten und
 *       in beide Richtungen; in derselben Welt kommt er weiter an.
 *  [B3] Graben in einer Instanz aendert die Hauptwelt nicht und wird ihr
 *       nicht gemeldet; Graben in der Hauptwelt geht wie vorher, erreicht
 *       aber keine Instanz — die holt sich den Stand bei der Rueckkehr.
 *  [C3] Der Zaehler `ohneWeltVerworfen` steht im Betriebs-Schnappschuss
 *       (metriken.json) und in der Tageslog-Zeile.
 *
 * Run: npx tsx server/test/besitz-grenzen.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { createServer } from 'net';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import {
  ChatMsgType,
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
  findItem,
  packContainer,
  unpackContainer,
  type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Zwei Ebenen tief: der Server legt Dungeon-Dokumente unter `<worldsDir>/../dungeons`
// ab — so landen sie in diesem Wegwerf-Ordner und nicht neben den Tests.
const TMP = resolve(__dirname, 'tmp-besitz-grenzen');
const WORLDS_DIR = resolve(TMP, 'welten');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });
const METRIKEN_DATEI = resolve(TMP, 'metriken', 'metriken.json');
mkdirSync(dirname(METRIKEN_DATEI), { recursive: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ChatMessage: 42,
  Teleport: 43,
  Interact: 44,
  InteractResult: 45,
  TerrainOp: 47,
  TerrainOpSync: 48,
  TerrainCompSync: 49,
  AdminCommand: 53,
  AdminEvent: 54,
  AuthChallenge: 68,
  ContainerAction: 69,
  ContainerSync: 70,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Wartet auf einen ZEUGEN (`bedingung`), hoechstens `ms`; nie auf eine feste Zeit allein. */
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};
/** Kurze Nachfrist, in der ein UNERWUENSCHTES Paket noch ankaeme (Absenz laesst sich nur so zeigen). */
const NACHFRIST_MS = 200;
const f = (n: number, k = 3): string => n.toFixed(k);

/** Ein freier Port: auf 0 binden, Nummer lesen, wieder freigeben. */
function freierPort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

interface Ergebnis {
  ok: boolean;
  message: string;
}
interface Klient {
  ws: WebSocket;
  ergebnisse: Ergebnis[];
  teleports: Vector3[];
  syncs: string[]; // ContainerSync: Inhalt als String
  chat: Array<{ name: string; typ: number; text: string }>;
  terrainOps: number;
  terrainComps: number[]; // je Paket: Zahl der Zonen
  admin: string[];
}

function verbinde(port: number, name: string): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, ergebnisse: [], teleports: [], syncs: [], chat: [], terrainOps: 0, terrainComps: [], admin: [] };
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
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
        resolvePromise(k);
      } else if (type === P.InteractResult) {
        const ok = r.readBool();
        k.ergebnisse.push({ ok, message: r.readString() });
      } else if (type === P.Teleport) {
        k.teleports.push(r.readVector3());
      } else if (type === P.ContainerSync) {
        r.readString();
        r.readInt32();
        k.syncs.push(r.readString());
      } else if (type === P.ChatMessage) {
        r.readString();
        const nm = r.readString();
        const typ = r.readInt32();
        k.chat.push({ name: nm, typ, text: r.readString() });
      } else if (type === P.TerrainOpSync) {
        k.terrainOps += r.readInt32();
      } else if (type === P.TerrainCompSync) {
        k.terrainComps.push(r.readInt32());
      } else if (type === P.AdminEvent) {
        r.readString();
        r.readBool();
        k.admin.push(r.readString());
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
function sendInteract(ws: WebSocket, pos: Vector3, prefabHash: number): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeInt32(prefabHash);
  ws.send(Buffer.concat([Buffer.from([P.Interact]), w.toBuffer()]));
}
function sendContainerAction(ws: WebSocket, zdo: ZDO, richtung: 0 | 1, item: string, menge: number): void {
  const w = new Writer();
  w.writeString(zdo.zdoid.userId.toString());
  w.writeInt32(zdo.zdoid.id);
  w.writeInt32(richtung);
  w.writeString(item);
  w.writeInt32(menge);
  ws.send(Buffer.concat([Buffer.from([P.ContainerAction]), w.toBuffer()]));
}
function sendChat(ws: WebSocket, typ: number, text: string): void {
  const w = new Writer();
  w.writeInt32(typ);
  w.writeString(text);
  ws.send(Buffer.concat([Buffer.from([P.ChatMessage]), w.toBuffer()]));
}
function sendTerrainOp(ws: WebSocket, pos: Vector3, settings: object): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeString(JSON.stringify(settings));
  ws.send(Buffer.concat([Buffer.from([P.TerrainOp]), w.toBuffer()]));
}

interface Zugriff {
  applyCreatureAttack(pos: Vector3, damage: number, radius: number, weltId?: unknown): void;
  teleportPeer(peer: unknown, pos: Vector3, dungeonId: string | null): void;
}

async function main(): Promise<void> {
  const PORT = await freierPort();
  const server = createWovServer({
    port: PORT,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'besitz-grenzen',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
    metrikenDatei: METRIKEN_DATEI,
  });
  server.start();
  const zugriff = server as unknown as Zugriff;

  try {
    const kA = await verbinde(PORT, 'Anna');
    const kB = await verbinde(PORT, 'Bjoern');
    const kC = await verbinde(PORT, 'Christa');
    const peer = (name: string) => {
      const p = server.net.getPeers().find((x) => x.name === name);
      if (!p) throw new Error(`Peer ${name} nicht gefunden`);
      return p;
    };
    const pA = peer('Anna');
    const pB = peer('Bjoern');
    const pC = peer('Christa');
    await warte(300);
    const hash = (name: string): number => {
      const def = server.prefabs.getByName(name);
      if (!def) throw new Error(`Prefab "${name}" fehlt in der Registry`);
      return def.hash;
    };

    /** Spieler per Admin-Teleport an (x, z); die Ankunft wird nachgeprueft. */
    async function stelle(k: Klient, p: { position: Vector3 }, x: number, z: number): Promise<void> {
      sendAdmin(k.ws, `teleport ${x} ${z}`);
      await bis(() => Math.hypot(p.position.x - x, p.position.z - z) <= 1, 5_000);
      await warte(NACHFRIST_MS);
      if (Math.hypot(p.position.x - x, p.position.z - z) > 1) {
        throw new Error(`Teleport nach ${x},${z} hat nicht gewirkt (Spieler bei ${p.position.x},${p.position.z})`);
      }
    }
    /** E-Druck auf ein Objekt; wartet die Drossel, gibt die neuen Meldungen. */
    async function benutze(k: Klient, name: string, ziel: Vector3): Promise<Ergebnis[]> {
      await warte(350);
      const vorher = k.ergebnisse.length;
      sendInteract(k.ws, ziel, hash(name));
      await bis(() => k.ergebnisse.length > vorher, 3_000);
      await warte(NACHFRIST_MS);
      return k.ergebnisse.slice(vorher);
    }
    /** ContainerAction; die Antwort ist ein ContainerSync (geglueckt) oder ein InteractResult (abgelehnt). */
    async function aktion(k: Klient, z: ZDO, richtung: 0 | 1, item: string, menge: number): Promise<void> {
      await warte(350);
      const e0 = k.ergebnisse.length;
      const s0 = k.syncs.length;
      sendContainerAction(k.ws, z, richtung, item, menge);
      await bis(() => k.ergebnisse.length > e0 || k.syncs.length > s0, 3_000);
      await warte(NACHFRIST_MS);
    }
    const nahe = (a: Vector3, b: Vector3): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.01;
    /** Tod durch einen Schlag; Rueckgabe: Ziel des Teleport-Pakets (oder undefined). */
    async function tot(k: Klient, p: { position: Vector3; worldId: string }): Promise<Vector3 | undefined> {
      const vorher = k.teleports.length;
      zugriff.applyCreatureAttack({ ...p.position }, 999, 5, p.worldId);
      await bis(() => k.teleports.length > vorher, 3_000);
      await warte(NACHFRIST_MS);
      return k.teleports.length === vorher + 1 ? k.teleports[k.teleports.length - 1] : undefined;
    }
    const holz = (p: typeof pA): number => p.inventar.countOf('Wood');
    function gibHolz(p: typeof pA, n: number): void {
      const def = findItem('Wood');
      if (!def) throw new Error('Item Wood fehlt');
      const rest = p.inventar.addItem(def, n);
      if (rest > 0) throw new Error(`Inventar voll (${rest} Holz uebrig)`);
    }
    /** Ein Spielerbau wie handlePlacePiece ihn anlegt; `besitzer` leer = Weltobjekt. */
    function baue(name: string, pos: Vector3, besitzer: string): ZDO {
      const z = server.zdos.createZDO(hash(name), pos);
      if (besitzer) {
        z.setInt('spieler', 1);
        z.setString('besitzer', besitzer);
      }
      return z;
    }
    /** Truhe mit `n` Holz; das Bit „Erstbefuellung schon gewuerfelt“ ist gesetzt. */
    function truheMitHolz(name: string, pos: Vector3, besitzer: string, n: number): ZDO {
      const z = baue(name, pos, besitzer);
      const inv = unpackContainer('');
      const def = findItem('Wood');
      if (def && n > 0) inv.addItem(def, n);
      z.setInt(TRUHE_LOOTED_MEMBER, 1);
      z.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
      return z;
    }
    const inhaltHolz = (z: ZDO): number => unpackContainer(z.getString(TRUHE_INHALT_MEMBER)).countOf('Wood');

    const idA = pA.userId.toString();
    const FREMD = /gehört einem anderen Spieler/;

    // ── [A1] Betten ────────────────────────────────────────────────
    console.log('\n[A1] Fremdes Bett setzt den Wiedereinstieg nicht:');
    // Der Tod trifft alle im Umkreis von 5 m: A und B stehen 6 m auseinander, das
    // Bett liegt 3 m von beiden (Reichweite 6 m).
    await stelle(kA, pA, 100, 100);
    await stelle(kB, pB, 106, 100);
    const weltSpawn: Vector3 = await (async () => {
      // Referenz: wo landet ein Spieler ohne Bett? (Weltspawn des Servers)
      const ziel = await tot(kB, pB);
      if (!ziel) throw new Error('Kein Teleport nach dem Tod ohne Bett');
      return ziel;
    })();
    console.log(`      Weltspawn (Tod ohne Bett): (${f(weltSpawn.x)}; ${f(weltSpawn.y)}; ${f(weltSpawn.z)})`);
    await stelle(kB, pB, 106, 100);
    const bettA = baue('environment-sm-prop-bed-04', { x: 103, y: pA.position.y, z: 100 }, idA);
    const bettSoll = { x: bettA.position.x, y: bettA.position.y + 0.6, z: bettA.position.z };
    {
      const teil = await benutze(kB, 'environment-sm-prop-bed-04', bettA.position);
      console.log(`      B drueckt E an A's Bett: ${JSON.stringify(teil[0])}, B.spawnPoint = ${JSON.stringify(pB.spawnPoint)}`);
      check('B an A\'s Bett: abgelehnt, mit verstaendlicher Meldung', teil.length === 1 && !teil[0]!.ok && FREMD.test(teil[0]!.message), JSON.stringify(teil[0]));
      check('B an A\'s Bett: spawnPoint bleibt leer', pB.spawnPoint === null, JSON.stringify(pB.spawnPoint));
      const dort = await tot(kB, pB);
      console.log(`      B stirbt: Teleport nach ${dort ? `(${f(dort.x)}; ${f(dort.y)}; ${f(dort.z)})` : 'keiner'} (A's Bett: (${f(bettSoll.x)}; ${f(bettSoll.y)}; ${f(bettSoll.z)}))`);
      check('B stirbt: erwacht am Weltspawn, nicht in A\'s Basis', !!dort && nahe(dort, weltSpawn) && !nahe(dort, bettSoll), JSON.stringify(dort));
    }
    await stelle(kB, pB, 106, 100);
    {
      const teil = await benutze(kA, 'environment-sm-prop-bed-04', bettA.position);
      check('A an eigenem Bett: Schlafplatz gesetzt', teil.length === 1 && teil[0]!.ok && /Schlafplatz/.test(teil[0]!.message), JSON.stringify(teil[0]));
      check('A: spawnPoint liegt am eigenen Bett', !!pA.spawnPoint && nahe(pA.spawnPoint, bettSoll), JSON.stringify(pA.spawnPoint));
      const dort = await tot(kA, pA);
      check('A stirbt: erwacht am eigenen Bett', !!dort && nahe(dort, bettSoll), JSON.stringify(dort));
    }
    server.zdos.destroyZDO(bettA.zdoid);
    pA.spawnPoint = null;
    await stelle(kA, pA, 100, 100);
    await stelle(kB, pB, 106, 100);
    {
      const weltbett = baue('environment-sm-prop-bed-03', { x: 103, y: pA.position.y, z: 100 }, '');
      const teil = await benutze(kB, 'environment-sm-prop-bed-03', weltbett.position);
      check('Weltbett (ohne Besitzer): fuer B nutzbar', teil.length === 1 && teil[0]!.ok && /Schlafplatz/.test(teil[0]!.message) && !!pB.spawnPoint, JSON.stringify(teil[0]));
      server.zdos.destroyZDO(weltbett.zdoid);
      pB.spawnPoint = null;
    }

    // ── [A2] Truhen ────────────────────────────────────────────────
    console.log('\n[A2] Fremde Truhe bleibt zu:');
    await stelle(kA, pA, 200, 200);
    await stelle(kB, pB, 202, 200);
    gibHolz(pB, 12);
    const holzB0 = holz(pB);
    const holzA0 = holz(pA);
    const truheA = truheMitHolz('environment-sm-prop-chest-01', { x: 201, y: pA.position.y, z: 200 }, idA, 4);
    {
      const syncs0 = kB.syncs.length;
      const teil = await benutze(kB, 'environment-sm-prop-chest-01', truheA.position);
      check('B oeffnet A\'s Truhe: abgelehnt, mit Meldung, kein Inhalt', teil.length === 1 && !teil[0]!.ok && FREMD.test(teil[0]!.message) && kB.syncs.length === syncs0, JSON.stringify(teil[0]));
      // Ohne Oeffnen: ContainerAction mit der ZDOID (Kennung ist im Paket, kein Umweg noetig).
      const erg0 = kB.ergebnisse.length;
      await aktion(kB, truheA, 0, 'Wood', 4);
      console.log(`      B nimmt 4 Holz aus A's Truhe: B ${holzB0} -> ${holz(pB)}, Truhe ${inhaltHolz(truheA)}`);
      check('B nimmt aus A\'s Truhe: Holz von B unveraendert', holz(pB) === holzB0, `${holzB0} -> ${holz(pB)}`);
      check('B nimmt aus A\'s Truhe: A\'s Truhe behaelt ihre 4 Holz', inhaltHolz(truheA) === 4, `${inhaltHolz(truheA)}`);
      const erg = kB.ergebnisse.slice(erg0);
      check('B nimmt: Meldung statt stillem Nichts', erg.length === 1 && !erg[0]!.ok && FREMD.test(erg[0]!.message), JSON.stringify(erg[0]));
      check('B nimmt: kein ContainerSync', kB.syncs.length === syncs0, `${kB.syncs.length - syncs0}`);
      await aktion(kB, truheA, 1, 'Wood', 5);
      check('B legt in A\'s Truhe: Truhe und B unveraendert', inhaltHolz(truheA) === 4 && holz(pB) === holzB0, `Truhe ${inhaltHolz(truheA)}, B ${holz(pB)}`);
    }
    {
      // Gegenprobe: A an der eigenen Truhe.
      const syncs0 = kA.syncs.length;
      const teil = await benutze(kA, 'environment-sm-prop-chest-01', truheA.position);
      check('A oeffnet eigene Truhe: Inhalt kommt an', teil.length === 1 && teil[0]!.ok && kA.syncs.length === syncs0 + 1, JSON.stringify(teil[0]));
      await aktion(kA, truheA, 0, 'Wood', 4);
      check('A nimmt aus eigener Truhe: Holz +4, Truhe leer', holz(pA) === holzA0 + 4 && inhaltHolz(truheA) === 0, `A ${holzA0} -> ${holz(pA)}, Truhe ${inhaltHolz(truheA)}`);
    }
    for (const name of ['environment-sm-prop-chest-01', 'GrabTruhe']) {
      // Truhe ohne Besitzer: fuer alle offen.
      const offen = truheMitHolz(name, { x: 201, y: pA.position.y, z: 201 }, '', 4);
      const b0 = holz(pB);
      const syncs0 = kB.syncs.length;
      const teil = await benutze(kB, name, offen.position);
      await aktion(kB, offen, 0, 'Wood', 4);
      check(`${name} ohne Besitzer: B oeffnet und nimmt (Holz ${b0} -> ${holz(pB)})`, teil.length === 1 && teil[0]!.ok && kB.syncs.length >= syncs0 + 1 && holz(pB) === b0 + 4 && inhaltHolz(offen) === 0, JSON.stringify(teil[0]));
      server.zdos.destroyZDO(offen.zdoid);
    }
    server.zdos.destroyZDO(truheA.zdoid);

    // ── [B1] Wiedereinstieg im Koordinatenband ─────────────────────
    console.log('\n[B1] Wiedereinstiegspunkt im Instanz-Band:');
    {
      const BAND: Vector3 = { x: 100100, y: 40, z: 100100 };
      zugriff.teleportPeer(pA, BAND, null);
      await bis(() => pA.position.x > 50_000, 3_000);
      const bett = baue('environment-sm-prop-bed-04', { x: BAND.x + 1, y: BAND.y, z: BAND.z }, idA);
      const teil = await benutze(kA, 'environment-sm-prop-bed-04', bett.position);
      console.log(`      Bett bei (${BAND.x}; ${BAND.y}; ${BAND.z}): ${JSON.stringify(teil[0])}, spawnPoint ${JSON.stringify(pA.spawnPoint)}`);
      const dort = await tot(kA, pA);
      console.log(`      Tod: Teleport nach ${dort ? `(${f(dort.x)}; ${f(dort.y)}; ${f(dort.z)})` : 'keiner'}`);
      check('Tod mit Bett im Band: der Weltspawn gilt, nicht das Band', !!dort && nahe(dort, weltSpawn) && dort.x < 50_000, JSON.stringify(dort));
      server.zdos.destroyZDO(bett.zdoid);
      pA.spawnPoint = null;
    }

    // ── Instanz fuer B2/B3 ─────────────────────────────────────────
    sendAdmin(kC.ws, 'dungeon create forestcrypt 4242');
    await bis(() => kC.admin.some((m) => /Dungeon erzeugt: \S+/.test(m)), 8_000);
    const dungeonId = kC.admin.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
    if (!dungeonId) throw new Error(`Dungeon nicht erzeugt: ${kC.admin.join(' | ')}`);
    sendAdmin(kC.ws, `dungeon enter ${dungeonId}`);
    const drin = await bis(() => pC.worldId !== 'haupt', 8_000);
    if (!drin) throw new Error('C steht nicht in der Instanz');
    const instanz = server.welten.get(pC.worldId)!;
    await warte(300);

    console.log('\n[A1b] Bett in einer Instanz:');
    {
      const bett = instanz.zdos.createZDO(hash('environment-sm-prop-bed-04'), { x: pC.position.x + 1, y: pC.position.y, z: pC.position.z });
      bett.setInt('spieler', 1);
      bett.setString('besitzer', pC.userId.toString());
      const teil = await benutze(kC, 'environment-sm-prop-bed-04', bett.position);
      console.log(`      C (Instanz) an eigenem Bett: ${JSON.stringify(teil[0])}, spawnPoint ${JSON.stringify(pC.spawnPoint)}`);
      check('Bett in der Instanz: kein Schlafplatz (Instanzkoordinaten waeren in der Oberwelt sinnlos)', teil.length === 1 && !teil[0]!.ok && pC.spawnPoint === null, JSON.stringify(teil[0]));
      instanz.zdos.destroyZDO(bett.zdoid);
    }

    // ── [B2] Chat ──────────────────────────────────────────────────
    console.log('\n[B2] Chat ueber die Weltgrenze:');
    // A in der Hauptwelt und C in der Instanz auf denselben XZ.
    const cx = Math.round(pC.position.x * 100) / 100;
    const cz = Math.round(pC.position.z * 100) / 100;
    await stelle(kA, pA, cx, cz);
    await stelle(kB, pB, cx + 4, cz);
    const TYPEN: Array<[string, number]> = [
      ['Normal', ChatMsgType.Normal],
      ['Fluestern', ChatMsgType.Whisper],
      ['Rufen', ChatMsgType.Shout],
    ];
    console.log(`      A (Hauptwelt) (${f(pA.position.x, 2)}; ${f(pA.position.z, 2)}), B (Hauptwelt) 4 m daneben, C (Instanz) (${f(pC.position.x, 2)}; ${f(pC.position.z, 2)})`);
    const zaehle = (k: Klient, text: string): number => k.chat.filter((c) => c.text === text).length;
    async function sprich(von: Klient, typ: number, text: string): Promise<void> {
      await warte(350); // Drossel: ein Chatpaket je 0,3 s
      sendChat(von.ws, typ, text);
      // Zeuge: der Absender hoert sich selbst immer; danach die Nachfrist, in der ein
      // Paket ueber die Grenze noch ankaeme.
      await bis(() => zaehle(von, text) >= 1, 3_000);
      await warte(NACHFRIST_MS);
    }
    let ueberGrenze = 0;
    for (const [name, typ] of TYPEN) {
      const text = `a-${name}`;
      await sprich(kA, typ, text);
      ueberGrenze += zaehle(kC, text);
      check(`A (Hauptwelt) ${name}: B (gleiche Welt, 4 m) hoert es genau einmal, A sich selbst, C nicht`, zaehle(kB, text) === 1 && zaehle(kA, text) === 1 && zaehle(kC, text) === 0, `B ${zaehle(kB, text)}, A ${zaehle(kA, text)}, C ${zaehle(kC, text)}`);
    }
    for (const [name, typ] of TYPEN) {
      const text = `c-${name}`;
      await sprich(kC, typ, text);
      ueberGrenze += zaehle(kA, text) + zaehle(kB, text);
      check(`C (Instanz) ${name}: C hoert sich selbst, A und B (Hauptwelt) nicht`, zaehle(kC, text) === 1 && zaehle(kA, text) === 0 && zaehle(kB, text) === 0, `C ${zaehle(kC, text)}, A ${zaehle(kA, text)}, B ${zaehle(kB, text)}`);
    }
    console.log(`      Nachrichten ueber die Weltgrenze: ${ueberGrenze} von 9 moeglichen (A→C, C→A, C→B je 3; Soll 0)`);
    check('ueber die Weltgrenze gelangen 0 von 9 Nachrichten', ueberGrenze === 0, `${ueberGrenze}`);

    // ── [B3] Graben ────────────────────────────────────────────────
    console.log('\n[B3] Graben in der Instanz:');
    const GRABEN = { level: true, square: true, levelRadius: 4, levelOffset: -3 };
    const bodenHaupt = (x: number, z: number): number => server.heightmaps.getGroundHeight(x, z);
    const stelle3 = { x: cx, z: cz };
    const h0 = bodenHaupt(stelle3.x, stelle3.z);
    const comps0 = [...server.heightmaps.listTerrainComps()].length;
    kA.terrainOps = 0;
    kB.terrainOps = 0;
    kC.terrainOps = 0;
    const erg0 = kC.ergebnisse.length;
    await warte(350);
    // Die Hoehe schickt der Client mit; ein Client in der Instanz nennt hier die
    // Hoehe der Oberwelt an dieser Stelle und will dort 3 m tiefer.
    sendTerrainOp(kC.ws, { x: pC.position.x, y: h0, z: pC.position.z }, GRABEN);
    await bis(() => kC.ergebnisse.length > erg0, 3_000); // Zeuge: die Ablehnung
    await warte(NACHFRIST_MS);
    const h1 = bodenHaupt(stelle3.x, stelle3.z);
    const comps1 = [...server.heightmaps.listTerrainComps()].length;
    console.log(`      Hauptwelt-Boden an der Stelle: ${f(h0)} -> ${f(h1)} (Aenderung ${f(h1 - h0)} m); Hauptwelt-Zonen mit Eingriff ${comps0} -> ${comps1}`);
    console.log(`      TerrainOpSync: A ${kA.terrainOps}, B ${kB.terrainOps}, C ${kC.terrainOps}`);
    check('C gräbt in der Instanz: der Boden der Hauptwelt bleibt', Math.abs(h1 - h0) < 1e-9, `${f(h0)} -> ${f(h1)}`);
    check('C gräbt in der Instanz: keine neue Zone mit Eingriff in der Hauptwelt', comps1 === comps0, `${comps0} -> ${comps1}`);
    check('C gräbt in der Instanz: die Hauptwelt-Spieler A und B bekommen kein TerrainOpSync', kA.terrainOps === 0 && kB.terrainOps === 0, `A ${kA.terrainOps}, B ${kB.terrainOps}`);
    const ergC = kC.ergebnisse.slice(erg0);
    check('C gräbt in der Instanz: Meldung statt stillem Nichts', ergC.length === 1 && !ergC[0]!.ok && /nicht graben/.test(ergC[0]!.message), JSON.stringify(ergC[0]));
    check('C gräbt in der Instanz: C selbst bekommt auch kein TerrainOpSync', kC.terrainOps === 0, `${kC.terrainOps}`);

    // Gegenprobe: in der eigenen Welt (Hauptwelt) wirkt die Grabung wie vorher.
    await warte(350);
    sendTerrainOp(kA.ws, { x: pA.position.x, y: h1, z: pA.position.z }, GRABEN);
    await bis(() => kA.terrainOps >= 1 && kB.terrainOps >= 1, 3_000); // Zeugen: das Echo bei A und B
    await warte(NACHFRIST_MS);
    const h2 = bodenHaupt(stelle3.x, stelle3.z);
    console.log(`      A gräbt in der Hauptwelt: ${f(h1)} -> ${f(h2)} (Aenderung ${f(h2 - h1)} m); TerrainOpSync A ${kA.terrainOps}, B ${kB.terrainOps}, C ${kC.terrainOps}`);
    check('A gräbt in der Hauptwelt: der Boden sinkt um 3,000 m', Math.abs(h2 - (h1 - 3)) < 0.01, `${f(h1)} -> ${f(h2)}`);
    check('A gräbt in der Hauptwelt: A und B (gleiche Welt) bekommen je ein TerrainOpSync', kA.terrainOps === 1 && kB.terrainOps === 1, `A ${kA.terrainOps}, B ${kB.terrainOps}`);
    check('A gräbt in der Hauptwelt: C in der Instanz bekommt keins', kC.terrainOps === 0, `${kC.terrainOps}`);

    // Rueckkehr: C bekommt den Stand der Oberwelt nach.
    const compsC0 = kC.terrainComps.length;
    sendAdmin(kC.ws, 'dungeon leave');
    await bis(() => pC.worldId === 'haupt', 8_000);
    await bis(() => kC.terrainComps.length > compsC0, 3_000); // Zeuge: der Nachschub
    await warte(NACHFRIST_MS);
    const nachC = kC.terrainComps.slice(compsC0);
    console.log(`      C kehrt zurueck: TerrainCompSync-Pakete ${nachC.length}, Zonen je Paket ${nachC.join(',')}`);
    check('C kehrt in die Hauptwelt zurueck: der Endzustand des Geländes kommt nach', pC.worldId === 'haupt' && nachC.length === 1 && nachC[0]! >= 1, `${nachC.join(',')}`);

    // ── [C3] Zaehler im Betriebs-Schnappschuss ─────────────────────
    console.log('\n[C3] ohneWeltVerworfen im Schnappschuss:');
    const lies = (): Record<string, unknown> | null => {
      try {
        return existsSync(METRIKEN_DATEI) ? (JSON.parse(readFileSync(METRIKEN_DATEI, 'utf-8')) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const echtesError = console.error;
    console.error = (): void => undefined; // die gedrosselte Meldung gehoert nicht ins Testprotokoll
    try {
      await bis(() => lies() !== null, 5_000);
      const vorher = lies();
      check('der Schnappschuss traegt das Feld, 0 im Normalbetrieb', vorher !== null && vorher.ohneWeltVerworfen === 0, `${JSON.stringify(vorher?.ohneWeltVerworfen)}`);
      zugriff.applyCreatureAttack({ ...pA.position }, 8, 5);
      zugriff.applyCreatureAttack({ ...pA.position }, 8, 5, '');
      const gesehen = await bis(() => lies()?.ohneWeltVerworfen === 2, 5_000);
      const nachher = lies();
      console.log(`      nach zwei verworfenen Schlaegen: ohneWeltVerworfen = ${JSON.stringify(nachher?.ohneWeltVerworfen)}`);
      check('zwei verworfene Schlaege: der Schnappschuss zeigt 2', gesehen, `${JSON.stringify(nachher?.ohneWeltVerworfen)}`);
      const heute = new Date().toISOString().slice(0, 10);
      const logDatei = resolve(dirname(METRIKEN_DATEI), `metriken-${heute}.jsonl`);
      const zeilen = existsSync(logDatei) ? readFileSync(logDatei, 'utf-8').split('\n').filter((z) => z.length > 0) : [];
      const letzte = zeilen.length > 0 ? (JSON.parse(zeilen[zeilen.length - 1]!) as Record<string, unknown>) : null;
      check('die Tageslog-Zeile traegt es ebenfalls', letzte !== null && letzte.ohneWeltVerworfen === 2, `${JSON.stringify(letzte?.ohneWeltVerworfen)}`);
    } finally {
      console.error = echtesError;
    }

    kA.ws.close();
    kB.ws.close();
    kC.ws.close();
  } finally {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n=== Besitz und Grenzen: ALLES BESTANDEN ===' : `\n=== Besitz und Grenzen: ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
