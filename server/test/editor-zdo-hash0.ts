/**
 * E2E: An editor connection that enters and leaves a dungeon leaves no ZDO
 * behind in the main world.
 * Eine Editor-Verbindung, die per "dungeon enter/leave" ein- und austritt,
 * hinterlaesst kein ZDO (Hash 0) in der Hauptwelt.
 *
 * Cause: `charakterUmziehen` created a ZDO in the target world even without a
 * source character ZDO (prefab hash 0). `onPeerQuit` returns early for editor
 * connections, so nothing ever destroyed it. Now a peer without a character
 * ZDO gets none.
 * Gegenprobe: a normal player keeps a character ZDO through the same trip.
 *
 * Ablauf: npx tsx server/test/editor-zdo-hash0.ts   (aus der Wurzel)
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PacketType } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { antwortBerechnen } from '../src/net/Identitaet.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(HIER, '../../.tmp-editor-zdo-hash0');
let PORT = 0;
const P = PacketType;

function writeString(v: string): number[] {
  const enc = new TextEncoder().encode(v);
  let zigzag = ((enc.length << 1) ^ (enc.length >> 31)) >>> 0;
  const out: number[] = [];
  do {
    const b = zigzag & 0x7f;
    zigzag >>>= 7;
    out.push(zigzag ? b | 0x80 : b);
  } while (zigzag);
  return [...out, ...enc];
}

function readVarInt(view: DataView, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = view.getUint8(pos++);
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return [(result >>> 1) ^ -(result & 1), pos];
}

function readString(view: DataView, pos: number): [string, number] {
  const [len, p] = readVarInt(view, pos);
  const s = new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset + p, len));
  return [s, p + len];
}

let fehler = 0;
function check(was: string, bedingung: boolean, zusatz = ''): void {
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` (${zusatz})` : ''}`);
  if (!bedingung) fehler++;
}

interface Verbindung {
  ws: WebSocket;
  angemeldet: Promise<void>;
  admin: string[];
  teleports: number;
}

function verbinde(name: string, nurEditor: boolean): Verbindung {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';
  const v: Verbindung = { ws, angemeldet: Promise.resolve(), admin: [], teleports: 0 };
  let authGesendet = false;
  v.angemeldet = new Promise<void>((fertig, scheitern) => {
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Anmeldung überfällig`)), 15_000);
    ws.on('close', () => {
      clearTimeout(uhr);
      fertig();
    });
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const view = new DataView(data.buffer, data.byteOffset + 1, data.length - 1);
      if (type === P.VersionCheck) {
        const pkt = Buffer.alloc(5);
        pkt.writeUInt8(P.VersionCheck, 0);
        pkt.writeInt32LE(2, 1);
        ws.send(pkt);
      } else if (type === P.AuthChallenge) {
        if (authGesendet) return;
        authGesendet = true;
        const [nonce] = readString(view, 0);
        ws.send(
          Buffer.from([
            P.PasswordAuth,
            ...writeString(antwortBerechnen(nonce, '')),
            ...writeString(name),
            ...writeString(''),
            ...(nurEditor ? [1] : []),
          ])
        );
      } else if (type === P.PeerInfo) {
        clearTimeout(uhr);
        fertig();
      } else if (type === P.AdminEvent) {
        let pos = 0;
        [, pos] = readString(view, pos); // command
        pos += 1; // active
        const [msg] = readString(view, pos);
        v.admin.push(msg);
      } else if (type === P.Teleport) {
        v.teleports++;
      }
    });
  });
  return v;
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function bis(bedingung: () => boolean, ms = 8_000): Promise<boolean> {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(50);
  }
  return bedingung();
}
/**
 * Sends an admin command. The server throttles AdminCommand (bucket 3, 1/s,
 * server/src/net/Drossel.ts) and silently drops what exceeds it, so keep more
 * than a second between two commands of one connection.
 */
const letzterBefehl = new WeakMap<Verbindung, number>();
async function admin(v: Verbindung, zeile: string): Promise<void> {
  const frei = (letzterBefehl.get(v) ?? 0) + 1_100;
  if (Date.now() < frei) await warte(frei - Date.now());
  letzterBefehl.set(v, Date.now());
  v.ws.send(Buffer.from([P.AdminCommand, ...writeString(zeile)]));
}

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: 0,
    worldsDir: resolve(TMP, 'worlds'),
    kontenDir: resolve(TMP, 'konten'),
    everyoneAdmin: true,
    saveIntervalMs: 3_600_000,
  });
  server.start();
  PORT = portVon(server);
  await warte(1500);

  let instanzId = '';
  const zdos = () => server.hauptwelt.zdos.getAllZDOs();
  const hash0 = () => zdos().filter((z) => z.prefabHash === 0).length;
  // Total counts of the main world are NOT compared: with assets loaded the
  // world spawns creatures during the run. Compare what matters instead: no
  // ZDO that existed before is lost, and no hash-0 ZDO appears.
  const idsVon = (liste: { zdoid: { toString(): string } }[]): Set<string> => new Set(liste.map((z) => z.zdoid.toString()));
  const verloren = (vorher: Set<string>, liste: { zdoid: { toString(): string } }[]): number => {
    const jetzt = idsVon(liste);
    let n = 0;
    for (const id of vorher) if (!jetzt.has(id)) n++;
    return n;
  };
  const peerVon = (name: string, nurEditor: boolean) =>
    server.net.getPeers().find((p) => p.name === name && !!p.nurEditor === nurEditor);

  // ── 1. Spieler: Umzug in eine Instanz und zurück, Charakter-ZDO bleibt ──
  const spieler = verbinde('Tester', false);
  await spieler.angemeldet;
  await warte(500);
  const sp = peerVon('Tester', false);
  check('Spieler angemeldet', !!sp);
  const spHash = sp ? server.hauptwelt.zdos.getZDO(sp.characterID)?.prefabHash ?? 0 : 0;
  check('Spieler hat ein Charakter-ZDO (Hash != 0)', spHash !== 0, `hash ${spHash}`);

  await admin(spieler, 'dungeon create forestcrypt 4242');
  await bis(() => spieler.admin.some((m) => /Dungeon erzeugt: \S+/.test(m)));
  const dungeonId = spieler.admin.map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
  if (!dungeonId) throw new Error(`Dungeon nicht erzeugt: ${spieler.admin.join(' | ')}`);

  await admin(spieler, `dungeon enter ${dungeonId}`);
  await bis(() => sp!.worldId !== 'haupt');
  const inInstanz = sp!.worldId !== 'haupt';
  instanzId = sp!.worldId;
  const instanzZdo = server.welten.get(sp!.worldId)?.zdos.getZDO(sp!.characterID);
  check('Spieler in der Instanz mit Charakter-ZDO gleicher Art', inInstanz && instanzZdo?.prefabHash === spHash,
    `hash ${instanzZdo?.prefabHash}`);
  await admin(spieler, 'dungeon leave');
  await bis(() => sp!.worldId === 'haupt');
  const zurueck = server.hauptwelt.zdos.getZDO(sp!.characterID);
  check('Spieler zurück: Charakter-ZDO in der Hauptwelt, gleicher Hash', !!zurueck && zurueck.prefabHash === spHash,
    `hash ${zurueck?.prefabHash}`);
  check('Spielerumzug hinterlässt kein Hash-0-ZDO', hash0() === 0, `hash0=${hash0()}`);

  // ── 2. Editor-Verbindung: enter/leave, dann trennen ──
  const instZdos = () => server.welten.get(instanzId)?.zdos.getAllZDOs() ?? [];
  const inst0 = { gesamt: instZdos().length, hash0: instZdos().filter((z) => z.prefabHash === 0).length, ids: idsVon(instZdos()) };
  const vorher = { gesamt: zdos().length, hash0: hash0(), ids: idsVon(zdos()) };
  const editor = verbinde('Tester', true);
  await editor.angemeldet;
  await warte(500);
  const ed = peerVon('Tester', true);
  check('Editor-Verbindung angemeldet', !!ed);
  check('Editor legt beim Anmelden kein Hash-0-ZDO an und verliert keins', hash0() === vorher.hash0 && verloren(vorher.ids, zdos()) === 0, `hash0 ${hash0()}`);

  await admin(editor, `dungeon enter ${dungeonId}`);
  await bis(() => ed!.worldId !== 'haupt');
  check('Editor steht in der Instanz', ed!.worldId !== 'haupt', `worldId=${ed!.worldId}`);
  await admin(editor, 'dungeon leave');
  await bis(() => ed!.worldId === 'haupt');
  check('Editor wieder in der Hauptwelt', ed!.worldId === 'haupt');
  console.log(`  nach leave: hash0 ${hash0()} (vorher ${vorher.hash0})`);

  editor.ws.close();
  await warte(800);
  check('nach Trennen: kein ZDO mit Hash 0', hash0() === vorher.hash0, `hash0 ${vorher.hash0} → ${hash0()}`);
  check('nach Trennen: kein ZDO der Hauptwelt verloren', verloren(vorher.ids, zdos()) === 0, `verloren ${verloren(vorher.ids, zdos())}`);
  const inst1 = { gesamt: instZdos().length, hash0: instZdos().filter((z) => z.prefabHash === 0).length };
  check('Instanz: ZDO-Zahl, Hash-0-Zahl und Kennungen wie vorher', inst1.gesamt === inst0.gesamt && inst1.hash0 === inst0.hash0 && verloren(inst0.ids, instZdos()) === 0,
    `${inst0.gesamt}/${inst0.hash0} → ${inst1.gesamt}/${inst1.hash0}`);
  check('Spieler-Charakter-ZDO unberührt', !!server.hauptwelt.zdos.getZDO(sp!.characterID));

  spieler.ws.close();
  await warte(500);

  // ── 3. S1: Charakter-ZDO weg (`abbau Player`), dann enter/leave ──
  // A stale characterID must not address a foreign ZDO with the same number
  // in the next world (ids are numbered per world).
  const o1 = verbinde('Opfer1', false);
  await o1.angemeldet;
  await warte(500);
  const p1 = peerVon('Opfer1', false)!;
  await admin(o1, 'abbau Player 5');
  await bis(() => !server.hauptwelt.zdos.getZDO(p1.characterID));
  check('S1: Charakter-ZDO abgebaut', !server.hauptwelt.zdos.getZDO(p1.characterID));
  const s1Haupt = { hash0: hash0(), ids: idsVon(zdos()) };
  await admin(o1, `dungeon enter ${dungeonId}`);
  await bis(() => p1.worldId !== 'haupt');
  const s1Inst = () => server.welten.get(p1.worldId)?.zdos.getAllZDOs() ?? [];
  const s1Inst0 = s1Inst().length;
  check('S1: characterID nach enter gelöscht', p1.characterID.isNone(), p1.characterID.toString());
  await admin(o1, 'dungeon leave');
  await bis(() => p1.worldId === 'haupt');
  check('S1: characterID nach leave gelöscht', p1.characterID.isNone(), p1.characterID.toString());
  check('S1: Instanz ohne Verlust (kein fremdes ZDO zerstört)', server.welten.get(instanzId)?.zdos.getAllZDOs().length === s1Inst0,
    `${s1Inst0} → ${server.welten.get(instanzId)?.zdos.getAllZDOs().length}`);
  check('S1: Hauptwelt: nichts verloren, kein Hash 0', verloren(s1Haupt.ids, zdos()) === 0 && hash0() === s1Haupt.hash0,
    `verloren ${verloren(s1Haupt.ids, zdos())}, hash0 ${s1Haupt.hash0} → ${hash0()}`);
  o1.ws.close();
  await warte(500);

  // ── 4. S2: Instanz verworfen, während der Spieler drin ist ──
  // The full hijack path: the stale character id (the number the character
  // had in the dropped instance) later names a FOREIGN ZDO of the main world.
  const o2 = verbinde('Opfer2', false);
  await o2.angemeldet;
  await warte(500);
  const p2 = peerVon('Opfer2', false)!;
  const inHaupt = (): boolean => p2.worldId === 'haupt';
  await admin(o2, `dungeon enter ${dungeonId}`);
  check('S2: erstes enter fand statt', await bis(() => !inHaupt()), `worldId=${p2.worldId}`);
  const idInInstanz = p2.characterID;
  check('S2: Charakter-ZDO in der Instanz', !idInInstanz.isNone());
  await admin(o2, `dungeon reset ${dungeonId}`);
  await warte(500);
  await admin(o2, 'dungeon leave');
  check('S2: leave nach reset fand statt', await bis(inHaupt), `worldId=${p2.worldId}`);
  // Dropping the instance moves the player out first (character ZDO in the
  // main world), so `leave` has nothing left to do and no stale id remains.
  check('S2: nach reset steht der Spieler mit gültiger Figur in der Hauptwelt', !p2.characterID.isNone() && !!server.hauptwelt.zdos.getZDO(p2.characterID), p2.characterID.toString());

  // A foreign ZDO of the main world that carries exactly the number the
  // character had in the dropped instance (created via createZDO until its
  // id is reached, like a later spawn would).
  const OPFER_HASH = 987654321;
  const OPFER_POS = { x: 10, y: 0, z: 10 };
  let opfer = server.hauptwelt.zdos.getZDO(idInInstanz) ?? null;
  for (let i = 0; i < 5000 && !opfer; i++) {
    const z = server.hauptwelt.zdos.createZDO(OPFER_HASH, OPFER_POS);
    if (z.zdoid.equals(idInInstanz)) opfer = z;
  }
  check('S2: fremdes ZDO mit der Nummer der Instanzfigur liegt in der Hauptwelt', !!opfer && opfer.prefabHash === OPFER_HASH,
    `${idInInstanz.toString()}`);
  const s2Haupt = idsVon(zdos());
  s2Haupt.delete(p2.characterID.toString()); // the player's own figure moves with him

  await admin(o2, `dungeon enter ${dungeonId}`);
  check('S2: zweites enter fand statt', await bis(() => !inHaupt()), `worldId=${p2.worldId}`);
  const inst2 = server.welten.get(p2.worldId)?.zdos.getAllZDOs() ?? [];
  check('S2: fremdes ZDO reist nicht als Spielerfigur in die Instanz', !inst2.some((z) => z.prefabHash === OPFER_HASH));
  await admin(o2, 'dungeon leave');
  check('S2: zweites leave fand statt', await bis(inHaupt), `worldId=${p2.worldId}`);
  const noch = opfer ? server.hauptwelt.zdos.getZDO(opfer.zdoid) : undefined;
  check(
    'S2: fremdes ZDO bleibt unverändert (existiert, Hash, Position)',
    !!noch && noch.prefabHash === OPFER_HASH && noch.position.x === OPFER_POS.x && noch.position.z === OPFER_POS.z
  );
  check('S2: Hauptwelt über enter/leave: nichts verloren, kein Hash 0', verloren(s2Haupt, zdos()) === 0 && hash0() === 0,
    `verloren ${verloren(s2Haupt, zdos())}, hash0 ${hash0()}`);
  o2.ws.close();
  await warte(300);
  server.stop();
  rmSync(TMP, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log(fehler === 0 ? '\nAlle Prüfungen grün.' : `\n${fehler} Prüfung(en) fehlgeschlagen.`);
    process.exit(fehler > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
