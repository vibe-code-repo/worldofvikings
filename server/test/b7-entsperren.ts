/**
 * B7 — Findlinge, Betten und Truhen aus dem Speicher tun, was sie sollen.
 *
 * Läuft über den ECHTEN Paketpfad (WebSocket, Handshake, Drossel, dann
 * handleAttack/handleHarvest bzw. handleInteract) — keine der hier
 * geprüften Regeln wird nachgebaut. Nur zwei Dinge greifen am Server
 * vorbei: ZDOs werden direkt angelegt (wie in f1-truhe.ts und g7-kampf.ts),
 * und der Tod kommt über `applyCreatureAttack`, weil ein Test keine
 * Kreatur zum Spieler führen muss, um die Wiedereinstiegs-Regel zu sehen.
 *
 *  [1] Felsen: Spitzhacke auf je einen Store-Fels jeder Größenklasse gibt
 *      Stein (Menge 6–10 wie bei den Altfelsen), die Axt nicht; ein
 *      Bauwerksteil (`stone-throne`) und ein Pflasterstein bleiben stumm.
 *      Regression: `Rock_4` und ein Baum verhalten sich wie vorher.
 *  [2] Betten: ohne Bett stirbt man am Weltspawn; jedes der vier Store-Betten
 *      setzt `peer.spawnPoint`, der Tod bringt den Spieler DORTHIN (Teleport-
 *      Paket, nicht nur Serverfeld). Ein Tisch setzt nichts.
 *  [3] Truhen: die vier Store-Truhen und die GrabTruhe öffnen sich mit
 *      echtem Inhalt (ContainerSync); Deckel und Riegel nicht. Der Inhalt
 *      steht je Truhe im ZDO und übersteht Speichern und Neustart.
 *
 * Laufzeit: gut 15 s (ein gestarteter Server, ein init()-Neustart).
 *
 * Run: npx tsx server/test/b7-entsperren.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  HEALTH_MEMBER,
  TRUHE_INHALT_MEMBER,
  unpackContainer,
  type Vector3,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Eigenes Verzeichnis statt data/worlds — sonst landet bei jedem Lauf eine
// Welt neben Mikes echtem Spielstand (dieselbe Regel wie f1-truhe.ts).
const WORLDS_DIR = resolve(__dirname, 'tmp-b7-entsperren');
rmSync(WORLDS_DIR, { recursive: true, force: true });
const PORT = 2610;

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  Teleport: 43,
  Interact: 44,
  InteractResult: 45,
  Attack: 46,
  AuthChallenge: 68,
  ContainerSync: 70,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Ergebnis { ok: boolean; message: string; itemName: string; amount: number }
interface Sync { userId: string; id: number; json: string }

interface Klient {
  ws: WebSocket;
  ergebnisse: Ergebnis[];
  teleports: Vector3[];
  syncs: Sync[];
}

function verbinde(name: string): Promise<Klient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    let authSent = false;
    const k: Klient = { ws, ergebnisse: [], teleports: [], syncs: [] };
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
        k.ergebnisse.push({
          ok: r.readBool(),
          message: r.readString(),
          itemName: r.readString(),
          amount: r.readInt32(),
        });
      } else if (type === P.Teleport) {
        k.teleports.push(r.readVector3());
      } else if (type === P.ContainerSync) {
        k.syncs.push({ userId: r.readString(), id: r.readInt32(), json: r.readString() });
      }
    });
    ws.on('error', reject);
  });
}

function sendAttack(ws: WebSocket, pos: Vector3, waffe: string): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(0);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

function sendInteract(ws: WebSocket, pos: Vector3, prefabHash: number): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeInt32(prefabHash);
  ws.send(Buffer.concat([Buffer.from([P.Interact]), w.toBuffer()]));
}

/** Der Server-Teil, an den nur dieser Test von aussen greift (siehe Kopf). */
interface TodesZugriff {
  applyCreatureAttack(pos: Vector3, damage: number, radius: number): void;
}

async function main(): Promise<void> {
  const server = createWovServer({
    port: PORT,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'b7-entsperren',
    saveIntervalMs: 3600_000,
  });
  server.start();
  let laeuft = true;

  try {
    const k = await verbinde('Entsperrer');
    const peer = server.net.getPeers().find((p) => p.name === 'Entsperrer');
    if (!peer) throw new Error('Peer nicht gefunden');
    await warte(300);
    const spawn0: Vector3 = { ...peer.position };
    const hash = (name: string): number => {
      const def = server.prefabs.getByName(name);
      if (!def) throw new Error(`Prefab "${name}" fehlt in der Registry`);
      return def.hash;
    };
    const naechst = (dx: number, dz = 0): Vector3 => ({ x: spawn0.x + dx, y: spawn0.y, z: spawn0.z + dz });

    /** Ein Schlag mit `waffe`; wartet die Drossel (350 ms) und gibt die neuen Meldungen zurück. */
    async function schlage(waffe: string): Promise<Ergebnis[]> {
      await warte(400);
      peer!.stamina = 100;
      const vorher = k.ergebnisse.length;
      sendAttack(k.ws, peer!.position, waffe);
      await warte(250);
      return k.ergebnisse.slice(vorher);
    }

    /** Ein E-Druck auf `ziel`; wartet die Drossel und gibt die neuen Meldungen zurück. */
    async function benutze(name: string, ziel: Vector3): Promise<Ergebnis[]> {
      await warte(350);
      const vorher = k.ergebnisse.length;
      sendInteract(k.ws, ziel, hash(name));
      await warte(250);
      return k.ergebnisse.slice(vorher);
    }

    if (peer.inventar.countOf('PickaxeAntler') < 1 || peer.inventar.countOf('AxeFlint') < 1) {
      throw new Error('Startausruestung ohne Spitzhacke/Axt — Test hat keine Grundlage');
    }

    // ── [1] Felsen ────────────────────────────────────────────────
    console.log('\n[1] Felsen: Spitzhacke gibt Stein');
    const FELSEN: Array<[string, string]> = [
      ['environment-sm-env-rock-01', 'klein (0,3 m)'],
      ['environment-sm-env-rock-chunk-01', 'mittel (1,7 m)'],
      ['environment-sm-env-rock-cliff-01', 'Klippe (18 m)'],
      ['environment-sm-env-stone-02', 'Platte'],
    ];
    for (const [name, klasse] of FELSEN) {
      const fels = server.zdos.createZDO(hash(name), naechst(2));
      // Volle Lebenspunkte: ein Schlag der Spitzhacke (8) zieht ab, bricht ihn aber nicht.
      const teil = await schlage('PickaxeAntler');
      check(`${klasse}: erster Schlag lässt ihn stehen (keine Meldung)`, teil.length === 0 && server.zdos.getZDO(fels.zdoid) !== undefined);
      check(`${klasse}: Lebenspunkte sinken um den Spitzhackenschaden`, fels.getInt(HEALTH_MEMBER) === 90 - 8, `${fels.getInt(HEALTH_MEMBER)}`);
      // Axt: Werkzeugpflicht.
      const axt = await schlage('AxeFlint');
      check(`${klasse}: Axt wird abgewiesen`, axt.length === 1 && /Spitzhacke/.test(axt[0]!.message), axt[0]?.message);
      // Letzter Schlag.
      fels.setInt(HEALTH_MEMBER, 8);
      const steinVorher = peer.inventar.countOf('Stone');
      const ende = await schlage('PickaxeAntler');
      const menge = ende[0]?.amount ?? -1;
      check(
        `${klasse}: Spitzhacke bricht ihn und gibt Stein`,
        ende.length === 1 && ende[0]!.ok && ende[0]!.itemName === 'Stone' && menge >= 6 && menge <= 10 && /Fels zerbrochen/.test(ende[0]!.message),
        JSON.stringify(ende[0])
      );
      check(`${klasse}: Fels ist aus der Welt`, server.zdos.getZDO(fels.zdoid) === undefined);
      check(`${klasse}: Stein im Server-Inventar um ${menge} gewachsen`, peer.inventar.countOf('Stone') === steinVorher + menge, `${steinVorher} → ${peer.inventar.countOf('Stone')}`);
    }

    console.log('\n[1b] Was kein Fels ist, bleibt stumm');
    for (const name of ['environment-sm-env-stone-throne-01', 'environment-sm-prop-path-rock-01']) {
      const z = server.zdos.createZDO(hash(name), naechst(2));
      z.setInt(HEALTH_MEMBER, 8);
      const steinVorher = peer.inventar.countOf('Stone');
      const teil = await schlage('PickaxeAntler');
      check(`${name}: Spitzhacke bewirkt nichts`, teil.length === 0 && server.zdos.getZDO(z.zdoid) !== undefined && peer.inventar.countOf('Stone') === steinVorher);
      server.zdos.destroyZDO(z.zdoid);
    }

    console.log('\n[1c] Keine Regression: Altfels und Baum');
    {
      const alt = server.zdos.createZDO(hash('Rock_4'), naechst(2));
      alt.setInt(HEALTH_MEMBER, 8);
      const teil = await schlage('PickaxeAntler');
      check('Rock_4: Spitzhacke gibt Stein wie vorher', teil.length === 1 && teil[0]!.itemName === 'Stone' && teil[0]!.amount >= 6 && teil[0]!.amount <= 10, JSON.stringify(teil[0]));
      const baum = server.zdos.createZDO(hash('Beech_small1'), naechst(2));
      baum.setInt(HEALTH_MEMBER, 15);
      const t2 = await schlage('AxeFlint');
      check('Beech_small1: Axt gibt Holz wie vorher', t2.length === 1 && t2[0]!.itemName === 'Wood' && /Baum gefällt/.test(t2[0]!.message), JSON.stringify(t2[0]));
      const baum2 = server.zdos.createZDO(hash('Beech_small1'), naechst(2));
      const t3 = await schlage('PickaxeAntler');
      check('Beech_small1: Spitzhacke wird abgewiesen wie vorher', t3.length === 1 && /Axt/.test(t3[0]!.message), t3[0]?.message);
      server.zdos.destroyZDO(baum2.zdoid);
    }

    // ── [2] Betten ────────────────────────────────────────────────
    console.log('\n[2] Betten setzen den Wiedereinstieg');
    const tot = async (): Promise<Vector3 | undefined> => {
      const vorher = k.teleports.length;
      (server as unknown as TodesZugriff).applyCreatureAttack({ ...peer.position }, 999, 5);
      await warte(250);
      return k.teleports.length === vorher + 1 ? k.teleports[k.teleports.length - 1] : undefined;
    };
    const nahe = (a: Vector3, b: Vector3): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.01;

    check('vorher: kein Wiedereinstiegspunkt', peer.spawnPoint === null);
    const ohneBett = await tot();
    check('ohne Bett: Tod bringt den Spieler an den Weltspawn', !!ohneBett && nahe(ohneBett, spawn0), JSON.stringify(ohneBett));

    const BETTEN = ['03', '04', '05', '06'].map((n) => `environment-sm-prop-bed-${n}`);
    let versatz = 4;
    for (const name of BETTEN) {
      const ziel = naechst(versatz);
      versatz += 0.5;
      const bett = server.zdos.createZDO(hash(name), ziel);
      const teil = await benutze(name, ziel);
      const erwartet = { x: bett.position.x, y: bett.position.y + 0.6, z: bett.position.z };
      check(`${name}: Benutzen meldet den Schlafplatz`, teil.length === 1 && teil[0]!.ok && /Schlafplatz/.test(teil[0]!.message), JSON.stringify(teil[0]));
      check(`${name}: peer.spawnPoint liegt am Bett`, !!peer.spawnPoint && nahe(peer.spawnPoint, erwartet), JSON.stringify(peer.spawnPoint));
      const dort = await tot();
      check(`${name}: nach dem Tod erscheint der Spieler am Bett`, !!dort && nahe(dort, erwartet) && !nahe(dort, spawn0), JSON.stringify(dort));
      server.zdos.destroyZDO(bett.zdoid);
    }
    {
      const vorher = peer.spawnPoint ? { ...peer.spawnPoint } : null;
      const tisch = server.zdos.createZDO(hash('environment-sm-prop-table-stone-03'), naechst(1));
      const teil = await benutze('environment-sm-prop-table-stone-03', naechst(1));
      check('Tisch: setzt keinen Wiedereinstieg', teil.length === 1 && !teil[0]!.ok && !!vorher && !!peer.spawnPoint && nahe(peer.spawnPoint, vorher), JSON.stringify(teil[0]));
      server.zdos.destroyZDO(tisch.zdoid);
    }

    // ── [3] Truhen ────────────────────────────────────────────────
    console.log('\n[3] Truhen öffnen sich');
    const TRUHEN = [
      'environment-chestbottom',
      'environment-sm-prop-chest-01',
      'environment-sm-prop-chest-01-0',
      'environment-sm-prop-chest-04',
      'GrabTruhe',
    ];
    const inhalte = new Map<string, { id: number; userId: string; json: string }>();
    // Um die Stelle, an der der Spieler NACH den Todesproben steht (Reichweite 6 m).
    const p0: Vector3 = { ...peer.position };
    let ort = -3;
    for (const name of TRUHEN) {
      const ziel = { x: p0.x + ort, y: p0.y, z: p0.z + 2 };
      ort += 1.5;
      const truhe = server.zdos.createZDO(hash(name), ziel);
      const syncVorher = k.syncs.length;
      const teil = await benutze(name, ziel);
      const sync = k.syncs[k.syncs.length - 1];
      check(`${name}: Öffnen antwortet "Truhe geöffnet"`, teil.length === 1 && teil[0]!.ok && /Truhe geöffnet/.test(teil[0]!.message), JSON.stringify(teil[0]));
      check(`${name}: Inhalt kommt an (ContainerSync, dieselbe ZDOID)`, k.syncs.length === syncVorher + 1 && sync!.id === truhe.zdoid.id, JSON.stringify(sync));
      const posten = sync ? unpackContainer(sync.json).all.length : -1;
      check(`${name}: die Erstbefüllung hat genau einen Posten`, posten === 1, `${posten}`);
      await benutze(name, ziel);
      const zweit = k.syncs[k.syncs.length - 1];
      check(`${name}: zweites Öffnen liest denselben Inhalt`, !!sync && zweit?.json === sync.json);
      check(`${name}: der Inhalt steht in der Truhe selbst (ZDO-Member)`, truhe.getString(TRUHE_INHALT_MEMBER) === sync?.json);
      if (sync) inhalte.set(name, { id: truhe.zdoid.id, userId: truhe.zdoid.userId.toString(), json: sync.json });
    }
    for (const name of ['environment-sm-prop-chest-01-lid', 'environment-sm-prop-chest-01-latch']) {
      const ziel = { x: p0.x, y: p0.y, z: p0.z - 2 };
      const teil0 = server.zdos.createZDO(hash(name), ziel);
      const syncVorher = k.syncs.length;
      const teil = await benutze(name, ziel);
      check(`${name}: Truhenteil öffnet nichts`, teil.length === 1 && !teil[0]!.ok && k.syncs.length === syncVorher, JSON.stringify(teil[0]));
      server.zdos.destroyZDO(teil0.zdoid);
    }

    // Persistenz: speichern, Server anhalten, frisch laden (init()-only wie f1-truhe.ts).
    server.saveWorld();
    k.ws.close();
    server.stop();
    laeuft = false;
    const server2 = createWovServer({
      port: PORT,
      worldsDir: WORLDS_DIR,
      kontenDir: resolve(WORLDS_DIR, 'konten'),
      worldName: 'b7-entsperren',
    });
    server2.init();
    for (const [name, alt] of inhalte) {
      const neu = server2.zdos.getZDO(ZDOID.fromTuple(alt.userId, alt.id));
      check(`${name}: nach dem Neustart noch da`, neu !== undefined);
      check(`${name}: Inhalt übersteht Speichern und Laden`, neu?.getString(TRUHE_INHALT_MEMBER) === alt.json, `${neu?.getString(TRUHE_INHALT_MEMBER)} gegen ${alt.json}`);
    }
  } finally {
    if (laeuft) server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(failures > 0 ? `\n=== B7: ${failures} CHECK(S) FAILED ===` : '\n=== B7: ALLES BESTANDEN ===');
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('FAIL:', err);
    process.exit(1);
  });
