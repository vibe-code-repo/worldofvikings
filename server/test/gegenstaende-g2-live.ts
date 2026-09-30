/**
 * Items from data at run time, server side (card G2): harvest by the field `ernte`, crafting without a
 * station, the live watch with its receipt, the protection rules and the lock, over REAL WebSocket packets.
 * Gegenstandsdaten zur Laufzeit, Serverteil (Karte G2).
 *
 * The data item "Holzaxt" (damage 10, `ernte.baum` 1, recipe 8 Wood) exists only in this test's working copy.
 *
 *  [1] Start: the working copy is loaded (`ladeGegenstandsDatei`), the Holzaxt is known.
 *  [2] Crafting: Wood -8, Holzaxt +1, no workbench nearby; a code recipe still works.
 *  [3] Harvest: a 60 HP tree falls in 6 blows with the Holzaxt (damage 10), in 4 with the flint axe (15);
 *      fist and sword do not fell ("needs an axe"); the pickaxe field decides rocks.
 *  [4] Live: damage 10 -> 12 in the file: within 2 s the server measures 12, receipt `angewendet` with the new hash.
 *  [5] Broken file: the old state stays, receipt `abgelehnt`; a backup file `*.kaputt-*` is never read.
 *  [6] Discarded entries: nothing applied, receipt `verworfen` with reason codes.
 *  [7] Removing a held item: receipt `bestaetigung-noetig` with `gehalten`; a request for the wrong hash changes
 *      nothing; the right one applies and removes the copies for good (live inventory, relogin, saved player, chest).
 *  [8] Lock: under a held `<file>.lock` the watch neither reads nor applies (also not a half written file);
 *      after the release it applies.
 *  [9] `interneFehler`: stays 0 for hostile JSON; counts an exception of the watch itself.
 *
 * Run: npx tsx server/test/gegenstaende-g2-live.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEALTH_MEMBER, PacketType, getStableHash, maxLeben, TRUHE_INHALT_MEMBER, findItem, unpackContainer,
  type Vector3,
} from '@wov/shared';
import { VERWERF_GRUENDE, leseGegenstandsDatei, wendeGegenstandsDatenAn, type GegenstandsEintrag } from '@wov/shared/src/items/gegenstandsDaten.js';
import { gegenstandsBestaetigenDatei, gegenstandsQuittungsDatei } from '@wov/shared/src/items/gegenstandsArbeitskopie.js';
import { bestaetigenAnfrageSchreiben } from '@wov/shared/src/worldlayout/bestaetigenAnfrage.js';
import { layoutUnterSperre } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { GegenstandsWache, ladeGegenstandsDatei, type GegenstandsQuittung } from '../src/world/gegenstandsLive.js';
import { kannErnten } from '../src/spiel/Waffe.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lock holder: this file started again as a second process (`--halter <working copy> <stop file>`).
if (process.argv[2] === '--halter') {
  const [arbeitsDatei, stoppDatei] = [process.argv[3]!, process.argv[4]!];
  layoutUnterSperre(
    arbeitsDatei,
    () => {
      console.log('HALTER-BEREIT');
      while (!existsSync(stoppDatei)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    },
    { sperreWartenMs: 5000 }
  );
  process.exit(0);
}

const DIR = resolve(__dirname, 'tmp-gegenstaende-g2-live');
const WORLDS_DIR = resolve(DIR, 'welten');
const ARBEIT = resolve(DIR, 'arbeit', 'gegenstaende.json');
const QUITTUNG = gegenstandsQuittungsDatei(ARBEIT);
const BESTAETIGEN = gegenstandsBestaetigenDatei(ARBEIT);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(dirname(ARBEIT), { recursive: true });
let PORT = 0;

const P = { VersionCheck: 1, PasswordAuth: 2, PeerInfo: 3, PlayerInput: 40, InteractResult: 45, Attack: 46, AdminCommand: 53, Craft: 66, AuthChallenge: 68, ContainerAction: 69 };
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

// ── The data item ────────────────────────────────────────────────────
const axt = findItem('AxeFlint');
if (!axt?.holdPosition || !axt.holdRotation) throw new Error('AxeFlint has no grip');
function holzaxt(schaden: number): Record<string, unknown> {
  return {
    id: 'Holzaxt',
    nameSchluessel: 'inhalt.gegenstand.Holzaxt.name',
    typ: 'zweihaendigWaffe',
    slot: 'hand',
    modell: { upload: null, skala: 0.6, haltePosition: [...axt!.holdPosition!], halteRotation: [...axt!.holdRotation!], hiebVersatz: 0, animationsSatz: axt!.animationSet ?? 'sword' },
    stapel: 1,
    gewicht: 2,
    werte: { damage: schaden },
    ernte: { baum: 1 },
    haltbarkeit: { max: 150, verbrauch: 1, ausdauer: 8 },
    itemLevel: 1,
    rarity: 'common',
    rezept: { menge: 1, zutaten: [{ item: 'Wood', menge: 8 }] },
    texte: { 'inhalt.gegenstand.Holzaxt.name': { de: 'Holzaxt', en: 'Wooden axe' } },
  };
}
const dateiText = (roh: unknown[]): string => JSON.stringify({ version: 1, gegenstaende: roh });
/** Atomic write like the admin route (temp + rename): the new mtime/size/inode is seen by the watch. */
function schreibeArbeit(text: string): string {
  const temp = `${ARBEIT}.test.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, ARBEIT);
  return sha(text);
}
const eintraege = (schaden: number): GegenstandsEintrag[] => {
  const l = leseGegenstandsDatei(dateiText([holzaxt(schaden)]));
  if (l.dateiFehler || l.verworfen.length > 0) throw new Error('test entry is not valid');
  return l.eintraege;
};
const quittung = (): GegenstandsQuittung | null => {
  try {
    return JSON.parse(readFileSync(QUITTUNG, 'utf-8')) as GegenstandsQuittung;
  } catch {
    return null;
  }
};
/** Waits until the receipt says `status` for `hash`; returns the receipt and the elapsed ms (null after `maxMs`). */
async function wartePaketQuittung(status: string, hash: string, maxMs = 4000): Promise<{ q: GegenstandsQuittung; ms: number } | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const q = quittung();
    if (q && q.status === status && q.hash === hash) return { q, ms: Date.now() - t0 };
    await warte(50);
  }
  return null;
}

// ── Real WebSocket plumbing ──────────────────────────────────────────
interface Meldung { ok: boolean; message: string }
type MitLog = WebSocket & { _meldungen?: Meldung[]; _sync?: number };
function verbinde(name: string): Promise<MitLog> {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`) as MitLog;
    ws._meldungen = [];
    ws._sync = 0;
    ws.binaryType = 'nodebuffer';
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
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.InteractResult) {
        ws._meldungen!.push({ ok: r.readBool(), message: r.readString() });
      } else if (type === PacketType.InventorySync) {
        ws._sync!++;
      } else if (type === P.PeerInfo) {
        clearTimeout(timer);
        ok(ws);
      }
    });
    ws.on('error', fail);
  });
}
const sendAdmin = (ws: WebSocket, line: string): void => {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
};
let seq = 0;
const sendInput = (ws: WebSocket, yaw: number): void => {
  const w = new Writer();
  w.writeInt32(++seq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
};
async function blicke(ws: WebSocket, dauerMs = 400): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) { sendInput(ws, 0); await warte(50); }
}
const sendAttack = (ws: WebSocket, pos: Vector3, waffe = ''): void => {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(0);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
};
const sendEquip = (ws: WebSocket, item: string): void => {
  const w = new Writer();
  w.writeString('waffe');
  w.writeString(item);
  ws.send(Buffer.concat([Buffer.from([PacketType.Equip]), w.toBuffer()]));
};
const sendCraft = (ws: WebSocket, ergebnis: string): void => {
  const w = new Writer();
  w.writeString(ergebnis);
  ws.send(Buffer.concat([Buffer.from([P.Craft]), w.toBuffer()]));
};

async function main(): Promise<void> {
  // ── [1] Start ─────────────────────────────────────────────────────
  console.log('\n[1] Start: the working copy is loaded');
  wendeGegenstandsDatenAn([]);
  check('before the start the Holzaxt is unknown', findItem('Holzaxt') === undefined);
  schreibeArbeit(dateiText([holzaxt(10)]));
  const start = ladeGegenstandsDatei(ARBEIT);
  check('start loads it (art angewendet, 1 entry)', start.art === 'angewendet' && start.eintraege.length === 1, start.art);
  check('the Holzaxt is known with damage 10 and ernte.baum 1', findItem('Holzaxt')?.stats?.damage === 10 && findItem('Holzaxt')?.ernte?.baum === 1);

  const server = createWovServer({
    port: 0, worldsDir: WORLDS_DIR, kontenDir: resolve(WORLDS_DIR, 'konten'), worldName: 'g2-live',
    saveIntervalMs: 3600_000, everyoneAdmin: true, worldCreatures: false, worldFeatures: false, worldVegetation: false,
    gegenstandsDatei: ARBEIT, gegenstandsStart: start.eintraege, gegenstandsStartQuittung: start.startQuittung, gegenstandsOhneGutenStand: start.ohneGutenStand,
  });
  server.start();
  PORT = portVon(server);
  const zugriff = server as unknown as {
    gebeItem(peer: Peer, name: string, amount: number): void;
    gegenstandsWache: GegenstandsWache | null;
    savedPlayers: Map<string, { inventar?: Array<{ name: string; stack: number }>; waffe?: string; spielerId?: string }>;
    ermittleGespeichertenStand: () => unknown;
  };
  const sockets: WebSocket[] = [];
  const halterPids: number[] = [];
  try {
    const wsA = await verbinde('Anna');
    sockets.push(wsA);
    const hole = (n: string): Peer => {
      const p = server.net.getPeers().find((x) => x.name === n);
      if (!p) throw new Error(`peer ${n} missing`);
      return p;
    };
    const anna = hole('Anna');
    await warte(400);
    sendAdmin(wsA, 'teleport 200 200');
    await warte(350);
    check('the server has a watch', zugriff.gegenstandsWache instanceof GegenstandsWache);

    // ── [2] Crafting ────────────────────────────────────────────────
    console.log('\n[2] Crafting: 8 Wood -> Holzaxt, no workbench');
    const holz0 = anna.inventar.countOf('Wood');
    const axt0 = anna.inventar.countOf('Holzaxt');
    sendCraft(wsA, 'Holzaxt');
    await warte(400);
    const holz1 = anna.inventar.countOf('Wood');
    check(`Wood ${holz0} -> ${holz1} (-8)`, holz0 - holz1 === 8);
    check(`Holzaxt ${axt0} -> ${anna.inventar.countOf('Holzaxt')} (+1)`, anna.inventar.countOf('Holzaxt') === axt0 + 1);
    check('the answer says "Hergestellt: Holzaxt"', wsA._meldungen!.some((m) => m.ok && m.message === 'Hergestellt: Holzaxt'), JSON.stringify(wsA._meldungen));
    const hammer0 = anna.inventar.countOf('Hammer');
    sendCraft(wsA, 'Hammer'); // code recipe: 3 Wood + 2 Stone, unchanged
    await warte(400);
    check('a code recipe still works (Hammer +1, Wood -3)', anna.inventar.countOf('Hammer') === hammer0 + 1 && anna.inventar.countOf('Wood') === holz1 - 3);
    const vorNichts = anna.inventar.countOf('Wood');
    sendCraft(wsA, 'Holzaxt');
    await warte(400);
    check('with too little Wood nothing is taken and nothing is made', anna.inventar.countOf('Wood') === vorNichts && anna.inventar.countOf('Holzaxt') === axt0 + 1);
    zugriff.gebeItem(anna, 'Wood', 20);

    // ── [3] Harvest ─────────────────────────────────────────────────
    console.log('\n[3] Harvest by the field `ernte`');
    check('kannErnten: Holzaxt and AxeFlint fell trees, not rocks; PickaxeAntler breaks rocks, not trees',
      kannErnten('Holzaxt', 'baum') && kannErnten('AxeFlint', 'baum') && !kannErnten('Holzaxt', 'fels') && !kannErnten('AxeFlint', 'fels')
      && kannErnten('PickaxeAntler', 'fels') && !kannErnten('PickaxeAntler', 'baum'));
    check('kannErnten: fist, sword and an unknown name fell nothing', !kannErnten('', 'baum') && !kannErnten('SwordNorth', 'baum') && !kannErnten('Unbekannt', 'baum'));
    const BAUM = getStableHash('Beech_small1');
    /** Blows until the tree is gone (max 12); returns the HP after each blow. */
    async function faelle(waffe: string): Promise<{ schlaege: number; hp: number[]; gefaellt: boolean }> {
      const mitte = anna.position;
      const baum: ZDO = server.zdos.createZDO(BAUM, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      baum.setInt(HEALTH_MEMBER, 60);
      await blicke(wsA);
      const hp: number[] = [];
      let n = 0;
      while (n < 12 && !baum.destroyed) {
        anna.stamina = 100;
        sendAttack(wsA, mitte, waffe);
        n++;
        await warte(420);
        hp.push(baum.destroyed ? 0 : baum.getInt(HEALTH_MEMBER));
      }
      const gefaellt = baum.destroyed;
      if (!gefaellt) server.zdos.destroyZDO(baum.zdoid);
      return { schlaege: n, hp, gefaellt };
    }
    sendEquip(wsA, 'Holzaxt');
    await warte(300);
    check('the Holzaxt is carried', anna.waffe === 'Holzaxt', anna.waffe);
    const holzVor = anna.inventar.countOf('Wood');
    const hAxt = await faelle('');
    check(`Holzaxt (damage 10): the 60 HP tree falls in ${hAxt.schlaege} blows, HP ${hAxt.hp.join(',')}`, hAxt.gefaellt && hAxt.schlaege === 6 && hAxt.hp.join() === '50,40,30,20,10,0');
    check('the felled tree gives 6-10 Wood', (() => { const d = anna.inventar.countOf('Wood') - holzVor; return d >= 6 && d <= 10; })(), `${anna.inventar.countOf('Wood') - holzVor}`);
    sendEquip(wsA, 'AxeFlint');
    await warte(300);
    const hFeuer = await faelle('');
    check(`flint axe (damage 15): ${hFeuer.schlaege} blows, HP ${hFeuer.hp.join(',')} (as today)`, hFeuer.gefaellt && hFeuer.schlaege === 4 && hFeuer.hp.join() === '45,30,15,0');
    for (const [name, label] of [['', 'fist'], ['SwordNorth', 'sword']] as const) {
      sendEquip(wsA, name);
      await warte(300);
      anna.stamina = 100;
      const vorher = wsA._meldungen!.length;
      const r = await faelle('');
      check(`${label}: does not fell (0 damage, the tree stands after ${r.schlaege} blows)`, !r.gefaellt && r.hp.every((h) => h === 60), r.hp.join(','));
      check(`${label}: "Zu hart — dafür braucht es eine Axt"`, wsA._meldungen!.slice(vorher).some((m) => m.message === 'Zu hart — dafür braucht es eine Axt'));
    }
    sendEquip(wsA, 'Holzaxt');
    await warte(300);

    // ── [4] Live: 10 -> 12 ──────────────────────────────────────────
    console.log('\n[4] Live: damage 10 -> 12 in the file');
    const FURLOC = getStableHash('FurlocKrieger');
    async function schlageWesen(): Promise<number> {
      const mitte = anna.position;
      const ziel: ZDO = server.zdos.createZDO(FURLOC, { x: mitte.x, y: mitte.y, z: mitte.z - 2 });
      ziel.setInt(HEALTH_MEMBER, maxLeben('FurlocKrieger'));
      await blicke(wsA);
      anna.stamina = 100;
      sendAttack(wsA, mitte, '');
      await warte(450);
      const hp = ziel.destroyed ? -1 : ziel.getInt(HEALTH_MEMBER);
      if (!ziel.destroyed) server.zdos.destroyZDO(ziel.zdoid);
      return maxLeben('FurlocKrieger') - hp;
    }
    const vorher = await schlageWesen();
    check(`damage measured on a creature before: ${vorher}`, vorher === 10);
    const syncVor = wsA._sync!;
    const hash12 = schreibeArbeit(dateiText([holzaxt(12)]));
    const q12 = await wartePaketQuittung('angewendet', hash12);
    check(`receipt "angewendet" with the new hash after ${q12?.ms} ms (limit 2000)`, q12 !== null && q12.ms <= 2000);
    check('the receipt has the agreed form (status, hash, zeit ISO)', q12 !== null && typeof q12.q.zeit === 'string' && !Number.isNaN(Date.parse(q12.q.zeit)) && Object.keys(q12.q).sort().join() === 'hash,status,zeit', JSON.stringify(q12?.q));
    const nachher = await schlageWesen();
    check(`the server now measures ${nachher} instead of ${vorher}`, nachher === 12);
    check('the stack in the inventory points to the new definition (rebind)', anna.inventar.all.find((i) => i.shared.name === 'Holzaxt')?.shared === findItem('Holzaxt') && findItem('Holzaxt')?.stats?.damage === 12);
    check('the inventories were sent to the peer again (InventorySync)', wsA._sync! > syncVor, `${syncVor} -> ${wsA._sync}`);
    check('the last good state was written and holds damage 12', (() => {
      try {
        return leseGegenstandsDatei(readFileSync(resolve(dirname(ARBEIT), 'gegenstaende.letzter-guter.json'), 'utf-8')).eintraege[0]?.werte.damage === 12;
      } catch {
        return false;
      }
    })());

    // ── [5] Broken file ─────────────────────────────────────────────
    console.log('\n[5] Broken file: the old state stays');
    writeFileSync(`${ARBEIT}.kaputt-2026-09-30T10-00-00`, dateiText([holzaxt(99)])); // a backup is not a working copy
    const hashKaputt = schreibeArbeit('{"version":1,"gegenstaende":[ {');
    const qK = await wartePaketQuittung('abgelehnt', hashKaputt);
    check(`receipt "abgelehnt" with the hash of the broken bytes after ${qK?.ms} ms`, qK !== null && qK.ms <= 2000);
    check('the old state stays: damage 12', (await schlageWesen()) === 12 && findItem('Holzaxt')?.stats?.damage === 12);
    const hashWieder = schreibeArbeit(dateiText([holzaxt(12)]));
    check('the same state again: receipt "angewendet"', (await wartePaketQuittung('angewendet', hashWieder)) !== null);
    check('the backup file with damage 99 was never applied', findItem('Holzaxt')?.stats?.damage === 12);

    // ── [6] Discarded entries ───────────────────────────────────────
    console.log('\n[6] Discarded entries: nothing applied');
    const schlecht = { ...holzaxt(30), id: 'Schlecht', nameSchluessel: 'inhalt.gegenstand.Schlecht.name', texte: { 'inhalt.gegenstand.Schlecht.name': { de: 'x', en: 'x' } }, typ: 'gibtsnicht' };
    const hashV = schreibeArbeit(dateiText([holzaxt(30), schlecht]));
    const qV = await wartePaketQuittung('verworfen', hashV);
    check('receipt "verworfen" with index, id and a reason code from VERWERF_GRUENDE',
      qV !== null && qV.q.verworfen?.length === 1 && qV.q.verworfen[0]!.index === 1 && qV.q.verworfen[0]!.id === 'Schlecht'
      && (VERWERF_GRUENDE as readonly string[]).includes(qV.q.verworfen[0]!.grund), JSON.stringify(qV?.q.verworfen));
    check('the valid entry next to it was NOT applied either: damage stays 12', (await schlageWesen()) === 12);
    check('the unknown-type entry does not exist', findItem('Schlecht') === undefined);

    // ── [7] Removing a held item ────────────────────────────────────
    console.log('\n[7] Removing a held item needs a confirmation');
    schreibeArbeit(dateiText([holzaxt(12)]));
    await warte(1500);
    const wsB = await verbinde('Bernd');
    sockets.push(wsB);
    const bernd = hole('Bernd');
    await warte(400);
    zugriff.gebeItem(bernd, 'Holzaxt', 1);
    await warte(300);
    const berndId = bernd.spielerId;
    wsB.close();
    await warte(700);
    const berndGespeichert = zugriff.savedPlayers.get(berndId);
    check('Bernd (offline) holds a Holzaxt in his saved state', berndGespeichert?.inventar?.some((s) => s.name === 'Holzaxt' && s.stack === 1) === true);
    const truhe = server.prefabs.getByName('piece_chest_wood')!;
    const kiste = server.zdos.createZDO(truhe.hash, { ...anna.position });
    kiste.setString(TRUHE_INHALT_MEMBER, JSON.stringify([['Holzaxt', 1, 100, 1], ['Wood', 5, 0, 1], ['Holzaxt', 1, 100, 1]]));
    const annaHat = anna.inventar.countOf('Holzaxt');
    check('Anna holds 1 Holzaxt, the chest 2', annaHat === 1 && unpackContainer(kiste.getString(TRUHE_INHALT_MEMBER)).countOf('Holzaxt') === 2);

    const hashOhne = schreibeArbeit(dateiText([]));
    const qB = await wartePaketQuittung('bestaetigung-noetig', hashOhne);
    check(`receipt "bestaetigung-noetig" after ${qB?.ms} ms, gehalten = ${JSON.stringify(qB?.q.gehalten)}`, qB !== null && qB.q.gehalten?.Holzaxt === 4);
    check('nothing applied: the Holzaxt is still there with damage 12, still in the inventory', findItem('Holzaxt')?.stats?.damage === 12 && anna.inventar.countOf('Holzaxt') === 1);

    bestaetigenAnfrageSchreiben(BESTAETIGEN, sha('ein ganz anderer Stand'));
    await warte(2300);
    check('a request for the WRONG hash is consumed and changes nothing', !existsSync(BESTAETIGEN) && quittung()?.status === 'bestaetigung-noetig' && findItem('Holzaxt') !== undefined && anna.inventar.countOf('Holzaxt') === 1);

    bestaetigenAnfrageSchreiben(BESTAETIGEN, hashOhne);
    const qA = await wartePaketQuittung('angewendet', hashOhne);
    check(`the right request: receipt "angewendet" after ${qA?.ms} ms, request file consumed`, qA !== null && qA.ms <= 2000 && !existsSync(BESTAETIGEN));
    check('the Holzaxt is gone from the item table', findItem('Holzaxt') === undefined);
    check('live inventory of Anna: 0 Holzaxt (was 1)', anna.inventar.countOf('Holzaxt') === 0 && !anna.inventar.all.some((i) => i.shared.name === 'Holzaxt'));
    check('the chest: 0 Holzaxt, the Wood is still there (text was 2 Holzaxt + 5 Wood)',
      !kiste.getString(TRUHE_INHALT_MEMBER).includes('Holzaxt') && unpackContainer(kiste.getString(TRUHE_INHALT_MEMBER)).countOf('Wood') === 5, kiste.getString(TRUHE_INHALT_MEMBER));
    check('Bernd\'s saved state: no Holzaxt', zugriff.savedPlayers.get(berndId)?.inventar?.some((s) => s.name === 'Holzaxt') === false);
    const lookup = zugriff as { ermittleGespeichertenStand: () => unknown };
    async function loginMit(name: string, eintrag: unknown): Promise<Peer> {
      lookup.ermittleGespeichertenStand = () => eintrag;
      const ws = await verbinde(name);
      sockets.push(ws);
      await warte(400);
      return hole(name);
    }
    const berndNeu = await loginMit('Bernd2', zugriff.savedPlayers.get(berndId));
    check('relogin of Bernd: no Holzaxt', berndNeu.inventar.countOf('Holzaxt') === 0);
    const annaId = anna.spielerId;
    wsA.close();
    await warte(700);
    const annaNeu = await loginMit('Anna2', zugriff.savedPlayers.get(annaId));
    check('relogin of Anna: no Holzaxt, other items intact (Hammer)', annaNeu.inventar.countOf('Holzaxt') === 0 && annaNeu.inventar.countOf('Hammer') >= 1);
    check('the removed weapon is not carried any more', annaNeu.waffe !== 'Holzaxt' && zugriff.savedPlayers.get(annaId)?.waffe !== 'Holzaxt');
    server.zdos.destroyZDO(kiste.zdoid);

    // ── [8] Lock ────────────────────────────────────────────────────
    console.log('\n[8] Lock: never a half state');
    const hash10 = schreibeArbeit(dateiText([holzaxt(10)]));
    check('re-adding the Holzaxt: receipt "angewendet"', (await wartePaketQuittung('angewendet', hash10)) !== null && findItem('Holzaxt')?.stats?.damage === 10);
    const stopp = resolve(DIR, 'stopp-halter');
    const kind = spawn(resolve(__dirname, '../../node_modules/.bin/tsx'), [fileURLToPath(import.meta.url), '--halter', ARBEIT, stopp], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    halterPids.push(kind.pid!);
    const beendet = new Promise<void>((fertig) => kind.once('exit', () => fertig()));
    await new Promise<void>((fertig, scheitern) => {
      const zeit = setTimeout(() => scheitern(new Error('lock holder does not start')), 30_000);
      let s = '';
      kind.stdout!.on('data', (d: Buffer) => {
        s += d.toString();
        if (s.includes('HALTER-BEREIT')) { clearTimeout(zeit); fertig(); }
      });
    });
    const qVor = quittung();
    // 1) a half written state (cut off in the middle) while the lock is held
    writeFileSync(ARBEIT, dateiText([holzaxt(20)]).slice(0, 60));
    await warte(2600);
    check('half written file under the lock: no new receipt (the watch did not read it)', JSON.stringify(quittung()) === JSON.stringify(qVor), JSON.stringify(quittung()));
    // 2) the complete new state, lock still held
    const hash20 = schreibeArbeit(dateiText([holzaxt(20)]));
    await warte(2600);
    check('complete new state under the lock: still not applied (damage 10, receipt unchanged)', findItem('Holzaxt')?.stats?.damage === 10 && JSON.stringify(quittung()) === JSON.stringify(qVor));
    // 3) release
    writeFileSync(stopp, '');
    await Promise.race([beendet, warte(10_000)]);
    const qFrei = await wartePaketQuittung('angewendet', hash20);
    check(`after the release: applied within ${qFrei?.ms} ms, damage 20`, qFrei !== null && qFrei.ms <= 2500 && findItem('Holzaxt')?.stats?.damage === 20);

    // ── [9] Internal errors ─────────────────────────────────────────
    console.log('\n[9] interneFehler');
    const feindlich = [
      dateiText([{ ...holzaxt(5), ['__proto__']: { polluted: 1 }, constructor: { prototype: { polluted: 1 } } }]),
      '{"version":1,"gegenstaende":[{"__proto__":{"x":1},"id":"Zz"}]}',
      dateiText([null, 5, 'x', [], holzaxt(NaN as unknown as number)]),
      '\u0000\u0000binary',
      dateiText([holzaxt(20)]),
    ];
    for (const t of feindlich) { schreibeArbeit(t); await warte(1200); }
    check('hostile JSON never produces "eintrag-ungueltig" or another internal error: interneFehler = 0', zugriff.gegenstandsWache?.interneFehler === 0, String(zugriff.gegenstandsWache?.interneFehler));
    check('({}).polluted stays undefined', (({}) as Record<string, unknown>).polluted === undefined);
    // The counter itself: an exception inside the watch (here `entfernen` throws) is counted and loud, the tick does not throw.
    const dir9 = resolve(DIR, 'wache9');
    mkdirSync(dir9, { recursive: true });
    const pfad9 = resolve(dir9, 'gegenstaende.json');
    writeFileSync(pfad9, dateiText([]));
    const meldungen: string[] = [];
    const wache = new GegenstandsWache({
      pfad: pfad9, quittungsPfad: gegenstandsQuittungsDatei(pfad9), bestaetigenPfad: gegenstandsBestaetigenDatei(pfad9),
      angewendet: eintraege(20), gehalten: () => ({}), entfernen: () => { throw new Error('boom'); }, neuBinden: () => undefined,
      log: { log: () => undefined, warn: () => undefined, error: (t) => meldungen.push(t) },
    });
    wache.tick();
    check('a throwing part of the watch: interneFehler = 1, one error line, tick did not throw', wache.interneFehler === 1 && meldungen.some((m) => m.includes('boom')), `${wache.interneFehler}`);
  } finally {
    for (const ws of sockets) ws.close();
    server.stop();
    for (const pid of halterPids) {
      for (const z of [-pid, pid]) {
        try { process.kill(z, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    wendeGegenstandsDatenAn([]);
    rmSync(DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
