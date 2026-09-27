/**
 * Besitzer sichtbar — die Konto-Kennung (`userId`) des Erbauers reist nicht
 * mehr im ZDOSync an jeden Peer in Reichweite mit (Folgekarte aus dem
 * Angriff auf #67, Befund 2: `Berichte/2026-09-23 Truheninhalt lesen —
 * Angriff.md`).
 *
 * Echte WebSocket-Clients (Handshake, Drossel). Der Test liest die
 * ZDOSync-Pakete SELBST auf dem Draht mit (nicht ueber den Client-Parser, der
 * unbekannte Member verwirft), wie `truhe-lesen.ts` — und haelt zusaetzlich
 * fest, ob und mit welchem Wert der `besitzer`-Member und das ZDO-Owner-Feld
 * (Satzflag Bit1) je Client ankamen. Bauteile werden direkt am Server
 * angelegt (wie `handlePlacePiece` es taete). Der Testport ist ephemer
 * (`port: 0`, gelesen mit `portVon`).
 *
 *  [1] Wand, Bett, Truhe von A gebaut, B steht 2 m daneben: B bekommt das
 *      ZDO (Zeuge: Vollstand), aber ohne `besitzer`-Member. A sieht ihn mit
 *      dem richtigen Wert.
 *  [2] Delta, in dem der `besitzer`-Member selbst (gleicher Wert, neue
 *      Revision) UND ein zweites Member im selben Zug wechseln: B bekommt
 *      nur das zweite Member, nie `besitzer`; A beides.
 *  [3] ZDO-Owner-Feld (Satzkopf, heute nur der Spielercharakter): jeder
 *      sieht das Feld an seiner EIGENEN Figur, niemand an der des anderen.
 *  [G] Gegenprobe: eine besitzerlose (Welt-)Truhe traegt gar keinen
 *      `besitzer`-Member — fuer niemanden gibt es dort etwas zu verdecken.
 *
 * Run: npx tsx server/test/besitzer-sichtbar.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { getStableHash, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { ZDOID } from '../src/zdo/ZDOID.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(__dirname, 'tmp-besitzer-sichtbar');
const WORLDS_DIR = resolve(TMP, 'welten');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ZDOSync: 10,
  AdminCommand: 53,
  AuthChallenge: 68,
};

const BESITZER_HASH = getStableHash('besitzer');
const MARKER_NAME = 'wandZweitesMember';
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
  besitzerGesehen: boolean; // `besitzer`-Member kam je an
  besitzerWert: string; // letzter angekommener Wert ('' = nie)
  ownerGesehen: boolean; // Satzkopf-Owner-Feld (Bit1) kam je an
  ownerWert: string; // letzter angekommener ownerUserId ('' = nie)
  members: number; // Member im letzten Satz
  marker: number | undefined; // letzter angekommener Wert des zweiten Members
}
interface Klient {
  ws: WebSocket;
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
      const key = `${userId}:${id}`;
      const alt = k.zdos.get(key);
      const s: Satz = alt ?? {
        saetze: 0, voll, revision,
        besitzerGesehen: false, besitzerWert: '',
        ownerGesehen: false, ownerWert: '',
        members: 0, marker: undefined,
      };
      if ((satzFlags & 2) !== 0) {
        s.ownerGesehen = true;
        s.ownerWert = r.readString();
        r.readInt32(); // ownerId
      }
      s.saetze++;
      s.revision = revision;
      const n = r.readInt32();
      s.members = n;
      for (let m = 0; m < n; m++) {
        const hash = r.readInt32();
        const typ = r.readUInt8();
        const wert = r.readByTypeTag(typ);
        if (hash === BESITZER_HASH) {
          s.besitzerGesehen = true;
          s.besitzerWert = String(wert);
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
    const k: Klient = { ws, zdos: new Map(), parseFehler: 0, restFehler: 0 };
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

const key = (z: ZDO | ZDOID): string => {
  const zdoid = 'zdoid' in z ? z.zdoid : z;
  return `${zdoid.userId}:${zdoid.id}`;
};

async function main(): Promise<void> {
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'besitzer-sichtbar',
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
    /** Ein Spielerbau wie `handlePlacePiece` ihn anlegt. */
    function bauteil(prefabName: string, pos: Vector3, besitzer: string): ZDO {
      const z = server.zdos.createZDO(hash(prefabName), pos);
      z.setInt('spieler', 1);
      if (besitzer) z.setString('besitzer', besitzer);
      return z;
    }
    const idA = pA.userId.toString();
    const idB = pB.userId.toString();
    const WAND = 'woodwall';
    const BETT = 'environment-sm-prop-bed-04';
    const TRUHE = 'environment-sm-prop-chest-01';

    // ── [1] Wand, Bett, Truhe: B bekommt kein `besitzer` ────────────────
    console.log("\n[1] A baut Wand/Bett/Truhe, B steht 2 m daneben:");
    {
      const x = 200;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      let dz = 0;
      const teile = [WAND, BETT, TRUHE].map((prefab) =>
        bauteil(prefab, { x: x + 1, y: pA.position.y, z: 200 + ++dz }, idA)
      );
      await bis(() => teile.every((t) => kA.zdos.has(key(t)) && kB.zdos.has(key(t))), 8_000);
      await warte(NACHFRIST_MS);
      for (const [i, prefab] of [WAND, BETT, TRUHE].entries()) {
        const t = teile[i]!;
        const a = kA.zdos.get(key(t));
        const b = kB.zdos.get(key(t));
        console.log(`      ${prefab} — A: ${JSON.stringify(a)}`);
        console.log(`      ${prefab} — B: ${JSON.stringify(b)}`);
        check(`${prefab}: B hat das ZDO bekommen (Vollstand)`, !!b && b.voll);
        check(`${prefab}: B bekommt "besitzer" NICHT`, !!b && !b.besitzerGesehen, JSON.stringify(b));
        check(`${prefab}: A (Erbauer) bekommt "besitzer" = eigene userId`,
          !!a && a.besitzerGesehen && a.besitzerWert === idA, JSON.stringify(a));
      }
      for (const t of teile) server.zdos.destroyZDO(t.zdoid);
    }

    // ── [2] Delta: `besitzer` selbst UND ein zweites Member wechseln ───
    console.log('\n[2] Delta mit "besitzer" UND einem zweiten Member (B fremd neben A\'s Wand):');
    {
      const x = 260;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const wand = bauteil(WAND, { x: x + 1, y: pA.position.y, z: 200 }, idA);
      wand.setInt(MARKER_NAME, 7);
      const k = key(wand);
      await bis(() => kB.zdos.has(k) && kA.zdos.has(k), 8_000);
      await warte(NACHFRIST_MS);
      const revA = kA.zdos.get(k)?.revision ?? 0;
      const revB = kB.zdos.get(k)?.revision ?? 0;
      const paketeB = kB.zdos.get(k)?.saetze ?? 0;
      // Gleicher Wert, aber setMember() revidiert immer — genau der Fall, in
      // dem der Delta-Pfad ueber "besitzer" laufen muss, nicht nur der Vollstand.
      wand.setString('besitzer', idA);
      wand.setInt(MARKER_NAME, 11);
      wand.dirty = true;
      const zeugen = await bis(
        () => (kA.zdos.get(k)?.revision ?? 0) !== revA && (kB.zdos.get(k)?.revision ?? 0) !== revB,
        8_000,
      );
      await warte(NACHFRIST_MS);
      const a = kA.zdos.get(k);
      const b = kB.zdos.get(k);
      console.log(`      A: ${JSON.stringify(a)}`);
      console.log(`      B: ${JSON.stringify(b)}`);
      check('Delta: beide haben es bekommen (Zeuge: neue Revision)', zeugen && (b?.saetze ?? 0) > paketeB);
      check('Delta: B bekommt das zweite Member (11)', b?.marker === 11, JSON.stringify(b));
      check('Delta: B bekommt im Delta genau 1 Member (nur das zweite)', b?.members === 1, JSON.stringify(b));
      check('Delta: B empfaengt "besitzer" NICHT (auch nicht den alten Wert)', !!b && !b.besitzerGesehen, JSON.stringify(b));
      check('Delta: A (Erbauer) bekommt "besitzer" (idA) und das zweite Member (11)',
        !!a && a.besitzerGesehen && a.besitzerWert === idA && a.marker === 11, JSON.stringify(a));
      server.zdos.destroyZDO(wand.zdoid);
    }

    // ── [3] ZDO-Owner-Feld: nur die eigene Figur traegt es ──────────────
    console.log('\n[3] Owner-Feld (Satzkopf, Bit1) der Spielercharaktere:');
    {
      await stelle(kA, pA, 300, 300);
      await stelle(kB, pB, 302, 300);
      const kAv = key(pA.characterID);
      const kBv = key(pB.characterID);
      await bis(
        () => kA.zdos.has(kAv) && kA.zdos.has(kBv) && kB.zdos.has(kAv) && kB.zdos.has(kBv),
        8_000,
      );
      await warte(NACHFRIST_MS);
      const aUeberSichSelbst = kA.zdos.get(kAv);
      const aUeberB = kA.zdos.get(kBv);
      const bUeberSichSelbst = kB.zdos.get(kBv);
      const bUeberA = kB.zdos.get(kAv);
      console.log(`      A ueber sich selbst: ${JSON.stringify(aUeberSichSelbst)}`);
      console.log(`      A ueber B: ${JSON.stringify(aUeberB)}`);
      console.log(`      B ueber sich selbst: ${JSON.stringify(bUeberSichSelbst)}`);
      console.log(`      B ueber A: ${JSON.stringify(bUeberA)}`);
      check('A sieht das Owner-Feld an der eigenen Figur (Wert = eigene userId)',
        !!aUeberSichSelbst && aUeberSichSelbst.ownerGesehen && aUeberSichSelbst.ownerWert === idA,
        JSON.stringify(aUeberSichSelbst));
      check('B sieht das Owner-Feld an der eigenen Figur (Wert = eigene userId)',
        !!bUeberSichSelbst && bUeberSichSelbst.ownerGesehen && bUeberSichSelbst.ownerWert === idB,
        JSON.stringify(bUeberSichSelbst));
      check('A bekommt das Owner-Feld an B\'s Figur NICHT (Befund 2)',
        !!aUeberB && !aUeberB.ownerGesehen, JSON.stringify(aUeberB));
      check('B bekommt das Owner-Feld an A\'s Figur NICHT (Befund 2)',
        !!bUeberA && !bUeberA.ownerGesehen, JSON.stringify(bUeberA));
    }

    // ── [G] Gegenprobe: besitzerlose Truhe traegt gar keinen Member ────
    console.log('\n[G] Gegenprobe: besitzerlose (Welt-)Truhe:');
    {
      const x = 320;
      await stelle(kA, pA, x, 200);
      await stelle(kB, pB, x + 2, 200);
      const truhe = bauteil(TRUHE, { x: x + 1, y: pA.position.y, z: 200 }, '');
      const k = key(truhe);
      await bis(() => kA.zdos.has(k) && kB.zdos.has(k), 8_000);
      await warte(NACHFRIST_MS);
      const a = kA.zdos.get(k);
      const b = kB.zdos.get(k);
      check('G: weder A noch B bekommen einen "besitzer"-Member (es gibt keinen)',
        !!a && !a.besitzerGesehen && !!b && !b.besitzerGesehen, `A ${JSON.stringify(a)}, B ${JSON.stringify(b)}`);
      server.zdos.destroyZDO(truhe.zdoid);
    }

    check('kein Paket war fehlerhaft (Zaehlung der Member stimmt im Draht)', kA.parseFehler === 0 && kB.parseFehler === 0, `A ${kA.parseFehler}, B ${kB.parseFehler}`);
    check('jedes Paket war genau aufgebraucht (remaining() === 0)', kA.restFehler === 0 && kB.restFehler === 0, `A ${kA.restFehler}, B ${kB.restFehler}`);
    kA.ws.close();
    kB.ws.close();
  } finally {
    server.stop();
    rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n=== Besitzer sichtbar: ALLES BESTANDEN ===' : `\n=== Besitzer sichtbar: ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
