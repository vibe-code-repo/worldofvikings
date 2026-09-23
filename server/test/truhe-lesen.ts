/**
 * Truhe lesen — der Inhalt einer fremden Truhe reist nicht im ZDOSync mit.
 *
 * Echte WebSocket-Clients (Handshake, Drossel). Der Test liest die
 * ZDOSync-Pakete SELBST auf dem Draht mit (nicht ueber den Client-Parser, der
 * unbekannte Member verwirft) und haelt je Client fest, welche Member zu
 * welchem ZDO angekommen sind. Truhen werden direkt am Server angelegt.
 * Der Testport ist ephemer (`port: 0`, gelesen mit `portVon`).
 *
 *  [R1-R3] Drei Runden: B steht 2 m neben A's Truhe (7 Holz). B bekommt das
 *          ZDO (Zeuge: Vollstand + Revision), aber ohne `truheInhalt`; nach
 *          einer Aenderung des Inhalts auch im Delta nicht. A bekommt beides.
 *  [O]     A hat die Truhe offen und nimmt Holz, waehrend B daneben steht:
 *          A sieht jede Aenderung sofort (ContainerSync + Delta), B nichts.
 *  [D]     Delta, in dem sich Inhalt UND ein zweites Member im selben Zug
 *          aendern: B bekommt genau das zweite Member, nie den Inhalt; A
 *          beides. Hier laeuft die Member-Schleife des Deltas (bei nur dem
 *          Inhalt kehrt writeZDO vorher zurueck, `neue === 0`).
 *  [G]     Gegenproben: eigene Truhe, Truhe ohne Besitzer, Grabtruhe — der
 *          Inhalt kommt an.
 *
 * Run: npx tsx server/test/truhe-lesen.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import {
  TRUHE_INHALT_MEMBER,
  TRUHE_LOOTED_MEMBER,
  findItem,
  getStableHash,
  packContainer,
  unpackContainer,
  type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-truhe-lesen');
const WORLDS_DIR = resolve(TMP, 'welten');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ZDOSync: 10,
  Interact: 44,
  InteractResult: 45,
  AdminCommand: 53,
  AuthChallenge: 68,
  ContainerAction: 69,
  ContainerSync: 70,
};

const INHALT_HASH = getStableHash(TRUHE_INHALT_MEMBER);
const MARKER_NAME = 'truheZweitesMember';
const MARKER_HASH = getStableHash(MARKER_NAME);

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Wartet auf einen ZEUGEN (`bedingung`), hoechstens `ms`. */
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};
/** Nachfrist, in der ein UNERWUENSCHTES Paket noch ankaeme (Absenz laesst sich nur so zeigen). */
const NACHFRIST_MS = 400;

/** Was ein Client zuletzt zu einem ZDO auf dem Draht gesehen hat. */
interface Satz {
  saetze: number; // wie oft das ZDO in einem Paket stand
  voll: boolean; // der erste Satz war ein Vollstand
  revision: number; // letzte Revision (raw)
  inhaltGesehen: boolean; // TRUHE_INHALT kam je an
  inhalt: string; // letzter angekommener Inhalt ('' = nie)
  members: number; // Member im letzten Satz
  marker: number | undefined; // letzter angekommener Wert des zweiten Members
}
interface Klient {
  ws: WebSocket;
  ergebnisse: Array<{ ok: boolean; message: string }>;
  syncs: string[]; // ContainerSync: Inhalt als String
  zdos: Map<string, Satz>;
  parseFehler: number;
  restFehler: number; // Pakete, in denen nach dem Lesen Bytes uebrig blieben
}

/** Ein ZDOSync-Paket lesen (Format: WovServer.writeZDO), Member je ZDO festhalten. */
function liesZDOSync(k: Klient, r: Reader): void {
  try {
    r.readInt32(); // tick
    const anzahl = r.readInt32();
    for (let i = 0; i < anzahl; i++) {
      const satzFlags = r.readUInt8();
      const voll = (satzFlags & 1) !== 0;
      const userId = r.readString();
      const id = r.readInt32();
      if (voll) r.readInt32(); // prefabHash
      r.readVector3();
      r.readQuaternion();
      const revision = r.readUInt32();
      if (voll) r.readUInt8(); // flags
      if ((satzFlags & 2) !== 0) {
        r.readString();
        r.readInt32();
      }
      const n = r.readInt32();
      const key = `${userId}:${id}`;
      const alt = k.zdos.get(key);
      const s: Satz = alt ?? { saetze: 0, voll, revision, inhaltGesehen: false, inhalt: '', members: 0, marker: undefined };
      s.saetze++;
      s.revision = revision;
      s.members = n;
      for (let m = 0; m < n; m++) {
        const hash = r.readInt32();
        const typ = r.readUInt8();
        const wert = r.readByTypeTag(typ);
        if (hash === INHALT_HASH) {
          s.inhaltGesehen = true;
          s.inhalt = String(wert);
        }
        if (hash === MARKER_HASH) s.marker = Number(wert);
      }
      k.zdos.set(key, s);
    }
    const zerstoert = r.readInt32();
    for (let i = 0; i < zerstoert; i++) {
      r.readString();
      r.readInt32();
    }
    if (r.remaining() !== 0) k.restFehler++;
  } catch {
    k.parseFehler++;
  }
}

function verbinde(port: number, name: string): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, ergebnisse: [], syncs: [], zdos: new Map(), parseFehler: 0, restFehler: 0 };
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
      } else if (type === P.ContainerSync) {
        r.readString();
        r.readInt32();
        k.syncs.push(r.readString());
      } else if (type === P.ZDOSync) {
        liesZDOSync(k, r);
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

const key = (z: ZDO): string => `${z.zdoid.userId}:${z.zdoid.id}`;
const holzIn = (json: string): number => unpackContainer(json).countOf('Wood');

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'truhe-lesen',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
    worldCreatures: false,
    worldFeatures: false,
    worldVegetation: false,
    metrikenDatei: resolve(TMP, 'metriken', 'metriken.json'),
  });
  server.start();
  const PORT = portVon(server);

  try {
    const kA = await verbinde(PORT, 'Anna');
    const kB = await verbinde(PORT, 'Bjoern');
    const peer = (name: string) => {
      const p = server.net.getPeers().find((x) => x.name === name);
      if (!p) throw new Error(`Peer ${name} nicht gefunden`);
      return p;
    };
    const pA = peer('Anna');
    const pB = peer('Bjoern');
    await warte(300);
    const hash = (name: string): number => {
      const def = server.prefabs.getByName(name);
      if (!def) throw new Error(`Prefab "${name}" fehlt in der Registry`);
      return def.hash;
    };
    async function stelle(k: Klient, p: { position: Vector3 }, x: number, z: number): Promise<void> {
      sendAdmin(k.ws, `teleport ${x} ${z}`);
      await bis(() => Math.hypot(p.position.x - x, p.position.z - z) <= 1, 5_000);
      await warte(NACHFRIST_MS);
      if (Math.hypot(p.position.x - x, p.position.z - z) > 1) {
        throw new Error(`Teleport nach ${x},${z} hat nicht gewirkt`);
      }
    }
    function truheMitHolz(name: string, pos: Vector3, besitzer: string, n: number): ZDO {
      const z = server.zdos.createZDO(hash(name), pos);
      if (besitzer) {
        z.setInt('spieler', 1);
        z.setString('besitzer', besitzer);
      }
      const inv = unpackContainer('');
      const def = findItem('Wood');
      if (def && n > 0) inv.addItem(def, n);
      z.setInt(TRUHE_LOOTED_MEMBER, 1);
      z.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
      return z;
    }
    /** Inhalt am Server aendern, wie handleContainerAction es tut. */
    function setzeHolz(z: ZDO, n: number): void {
      const inv = unpackContainer('');
      const def = findItem('Wood');
      if (def) inv.addItem(def, n);
      z.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
      z.revision.reviseData();
      z.dirty = true;
    }
    const idA = pA.userId.toString();
    const idB = pB.userId.toString();
    const CHEST = 'environment-sm-prop-chest-01';

    // ── [R1-R3] Fremder Spieler zwei Meter neben der Truhe ─────────
    for (let runde = 1; runde <= 3; runde++) {
      console.log(`\n[R${runde}] B steht 2 m neben A's Truhe (7 Holz):`);
      const x = 200 + 60 * runde;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const truhe = truheMitHolz(CHEST, { x: x + 1, y: pA.position.y, z: 200 }, idA, 7);
      const k = key(truhe);
      const zeugeB = await bis(() => kB.zdos.has(k) && kA.zdos.has(k), 8_000);
      await warte(NACHFRIST_MS);
      const a = kA.zdos.get(k);
      const b = kB.zdos.get(k);
      console.log(`      A: ${JSON.stringify(a)}`);
      console.log(`      B: ${JSON.stringify(b)}`);
      check(`R${runde}: B hat das ZDO der Truhe bekommen (Zeuge: Vollstand)`, zeugeB && !!b && b.voll);
      check(`R${runde}: B empfaengt den Inhalt NICHT`, !!b && !b.inhaltGesehen, JSON.stringify(b));
      check(`R${runde}: A (Besitzer) empfaengt den Inhalt: 7 Holz`, !!a && a.inhaltGesehen && holzIn(a.inhalt) === 7, JSON.stringify(a));

      // Delta: Inhalt aendert sich, beide Clients ziehen die Revision nach.
      const revA = a?.revision ?? 0;
      const revB = b?.revision ?? 0;
      setzeHolz(truhe, 5);
      const zeugen = await bis(
        () => (kA.zdos.get(k)?.revision ?? 0) !== revA && (kB.zdos.get(k)?.revision ?? 0) !== revB,
        8_000,
      );
      await warte(NACHFRIST_MS);
      const a2 = kA.zdos.get(k);
      const b2 = kB.zdos.get(k);
      console.log(`      nach Aenderung auf 5 Holz — A: ${JSON.stringify(a2)}`);
      console.log(`      nach Aenderung auf 5 Holz — B: ${JSON.stringify(b2)}`);
      check(`R${runde}: beide haben das Delta bekommen (Zeuge: neue Revision)`, zeugen);
      check(`R${runde}: B empfaengt auch im Delta keinen Inhalt`, !!b2 && !b2.inhaltGesehen, JSON.stringify(b2));
      check(`R${runde}: A empfaengt das Delta: 5 Holz`, !!a2 && holzIn(a2.inhalt) === 5, JSON.stringify(a2));
      server.zdos.destroyZDO(truhe.zdoid);
    }

    // ── [O] Der Besitzer hat die Truhe offen, ein Fremder steht daneben ──
    console.log('\n[O] A hat die Truhe offen und nimmt Holz, B steht daneben:');
    {
      const x = 600;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const truhe = truheMitHolz(CHEST, { x: x + 1, y: pA.position.y, z: 200 }, idA, 7);
      const k = key(truhe);
      await bis(() => kB.zdos.has(k) && kA.zdos.has(k), 8_000);
      await warte(350);
      const e0 = kA.ergebnisse.length;
      const s0 = kA.syncs.length;
      sendInteract(kA.ws, truhe.position, hash(CHEST));
      await bis(() => kA.ergebnisse.length > e0 && kA.syncs.length > s0, 3_000);
      check('O: A oeffnet die Truhe, Inhalt kommt per ContainerSync (7 Holz)',
        kA.ergebnisse[e0]?.ok === true && holzIn(kA.syncs[s0] ?? '') === 7, JSON.stringify(kA.ergebnisse[e0]));
      for (const soll of [6, 5, 3]) {
        const menge = holzIn(kA.syncs[kA.syncs.length - 1] ?? '') - soll;
        await warte(350);
        const s1 = kA.syncs.length;
        const revA = kA.zdos.get(k)?.revision ?? 0;
        const revB = kB.zdos.get(k)?.revision ?? 0;
        sendContainerAction(kA.ws, truhe, 0, 'Wood', menge);
        await bis(() => kA.syncs.length > s1 && (kA.zdos.get(k)?.revision ?? 0) !== revA && (kB.zdos.get(k)?.revision ?? 0) !== revB, 8_000);
        await warte(NACHFRIST_MS);
        const a = kA.zdos.get(k);
        const b = kB.zdos.get(k);
        console.log(`      A nimmt ${menge}: ContainerSync ${holzIn(kA.syncs[kA.syncs.length - 1] ?? '')} Holz, ZDO-Delta A: ${a ? holzIn(a.inhalt) : '?'}, B: inhaltGesehen=${b?.inhaltGesehen}`);
        check(`O: A sieht ${soll} Holz sofort (ContainerSync)`, kA.syncs.length === s1 + 1 && holzIn(kA.syncs[kA.syncs.length - 1] ?? '') === soll);
        check(`O: A's ZDO-Delta traegt ${soll} Holz`, !!a && holzIn(a.inhalt) === soll, JSON.stringify(a));
        check(`O: B bekommt das Delta (neue Revision), aber keinen Inhalt`, !!b && b.revision !== revB && !b.inhaltGesehen, JSON.stringify(b));
      }
      server.zdos.destroyZDO(truhe.zdoid);
    }

    // ── [D] Inhalt und ein zweites Member aendern sich im selben Zug ──
    console.log('\n[D] Delta mit Inhalt UND zweitem Member (B fremd neben A\'s Truhe):');
    {
      const x = 640;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const truhe = truheMitHolz(CHEST, { x: x + 1, y: pA.position.y, z: 200 }, idA, 7);
      truhe.setInt(MARKER_NAME, 7);
      const k = key(truhe);
      await bis(() => kB.zdos.has(k) && kA.zdos.has(k), 8_000);
      await warte(NACHFRIST_MS);
      const revA = kA.zdos.get(k)?.revision ?? 0;
      const revB = kB.zdos.get(k)?.revision ?? 0;
      const paketeB = kB.zdos.get(k)?.saetze ?? 0;
      setzeHolz(truhe, 3);
      truhe.setInt(MARKER_NAME, 11);
      truhe.dirty = true;
      const zeugen = await bis(
        () => (kA.zdos.get(k)?.revision ?? 0) !== revA && (kB.zdos.get(k)?.revision ?? 0) !== revB,
        8_000,
      );
      await warte(NACHFRIST_MS);
      const a = kA.zdos.get(k);
      const b = kB.zdos.get(k);
      console.log(`      A: ${JSON.stringify(a)}`);
      console.log(`      B: ${JSON.stringify(b)}`);
      check('D: beide haben das Delta bekommen (Zeuge: neue Revision)', zeugen && (b?.saetze ?? 0) > paketeB);
      check('D: B bekommt das zweite Member (11)', b?.marker === 11, JSON.stringify(b));
      check('D: B bekommt im Delta genau 1 Member (nur das zweite)', b?.members === 1, JSON.stringify(b));
      check('D: B empfaengt den Inhalt NICHT (auch nicht den alten)', !!b && !b.inhaltGesehen, JSON.stringify(b));
      check('D: A (Besitzer) bekommt Inhalt (3 Holz) und zweites Member (11)',
        !!a && a.inhaltGesehen && holzIn(a.inhalt) === 3 && a.marker === 11, JSON.stringify(a));
      server.zdos.destroyZDO(truhe.zdoid);
    }

    // ── [G] Gegenproben ─────────────────────────────────────────────
    console.log('\n[G] Gegenproben: eigene Truhe, ohne Besitzer, Grabtruhe:');
    {
      const x = 700;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const faelle: Array<{ name: string; besitzer: string; zdo?: ZDO; lesen: Klient; text: string }> = [
        { name: CHEST, besitzer: idB, lesen: kB, text: 'B\'s eigene Truhe: B liest' },
        { name: CHEST, besitzer: '', lesen: kB, text: 'Weltcontainer ohne Besitzer: B liest' },
        { name: 'GrabTruhe', besitzer: '', lesen: kB, text: 'Grabtruhe ohne Besitzer: B liest' },
        { name: CHEST, besitzer: idB, lesen: kA, text: 'B\'s Truhe: A (Fremder) liest NICHT' },
      ];
      let dz = 0;
      for (const f of faelle) {
        f.zdo = truheMitHolz(f.name, { x: x + 1, y: pA.position.y, z: 200 + ++dz }, f.besitzer, 7);
      }
      await bis(() => faelle.every((f) => f.lesen.zdos.has(key(f.zdo!))), 8_000);
      await warte(NACHFRIST_MS);
      for (const f of faelle) {
        const s = f.lesen.zdos.get(key(f.zdo!));
        console.log(`      ${f.text}: ${JSON.stringify(s)}`);
        if (f.text.includes('NICHT')) check(f.text, !!s && !s.inhaltGesehen, JSON.stringify(s));
        else check(f.text, !!s && s.inhaltGesehen && holzIn(s.inhalt) === 7, JSON.stringify(s));
      }
      for (const f of faelle) server.zdos.destroyZDO(f.zdo!.zdoid);
    }

    check('kein Paket war fehlerhaft (Zaehlung der Member stimmt im Draht)', kA.parseFehler === 0 && kB.parseFehler === 0, `A ${kA.parseFehler}, B ${kB.parseFehler}`);
    check('jedes Paket war genau aufgebraucht (remaining() === 0)', kA.restFehler === 0 && kB.restFehler === 0, `A ${kA.restFehler}, B ${kB.restFehler}`);
    kA.ws.close();
    kB.ws.close();
  } finally {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n=== Truhe lesen: ALLES BESTANDEN ===' : `\n=== Truhe lesen: ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
