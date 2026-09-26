/**
 * E2E: a dropped dungeon instance never leaves a player in a dead world, and
 * the instance's player list is keyed per connection, not per name.
 * Eine verworfene Instanz laesst keinen Spieler in einer toten Welt zurueck,
 * und die Spielerliste der Instanz ist je Verbindung geschluesselt, nicht
 * nach Namen.
 *
 * B3/K1: after `dungeon reset` a player who was still inside kept the
 * instance's `worldId`; `welt()` fell back to the main world, and the
 * instance's character id addressed a FOREIGN ZDO there (destroyed and cloned
 * on `leave`). Now the players are moved out first.
 * B4: `instance.players` was keyed by name; a same-named editor leaving
 * removed the real player, the instance counted as empty and was dropped with
 * the player inside.
 *
 * Ablauf: npx tsx server/test/instanz-verwurf.ts   (aus der Wurzel)
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
const TMP = resolve(HIER, '../../.tmp-instanz-verwurf');
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

  const peerVon = (name: string, nurEditor: boolean) =>
    server.net.getPeers().find((p) => p.name === name && !!p.nurEditor === nurEditor);
  const dungeonAnlegen = async (v: Verbindung, seed: number): Promise<string> => {
    const vorher = v.admin.length;
    await admin(v, `dungeon create forestcrypt ${seed}`);
    await bis(() => v.admin.slice(vorher).some((m) => /Dungeon erzeugt: \S+/.test(m)));
    const id = v.admin.slice(vorher).map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x);
    if (!id) throw new Error(`Dungeon nicht erzeugt: ${v.admin.join(' | ')}`);
    return id;
  };
  const OPFER_HASH = 987654321;
  const OPFER_POS = { x: 10, y: 0, z: 10 };

  // ── A. B3/K1: reset with players inside, then a foreign ZDO with the number
  //       of the instance character, then leave ──
  const spieler = verbinde('Tester', false);
  await spieler.angemeldet;
  await warte(500);
  const sp = peerVon('Tester', false)!;
  check('A: Spieler angemeldet', !!sp);
  const spHash = server.hauptwelt.zdos.getZDO(sp.characterID)?.prefabHash ?? 0;
  const dungeonA = await dungeonAnlegen(spieler, 4242);

  const editor = verbinde('Ed1', true);
  await editor.angemeldet;
  await warte(500);
  const ed = peerVon('Ed1', true)!;

  await admin(spieler, `dungeon enter ${dungeonA}`);
  await admin(editor, `dungeon enter ${dungeonA}`);
  await bis(() => sp.worldId !== 'haupt' && ed.worldId !== 'haupt');
  const instWelt = sp.worldId;
  const idInInstanz = sp.characterID;
  check('A: Spieler und Editor stehen in der Instanz', sp.worldId !== 'haupt' && ed.worldId === instWelt, `worldId=${sp.worldId}`);
  check('A: Spieler hat sein Charakter-ZDO in der Instanz', !!server.welten.get(instWelt)?.zdos.getZDO(idInInstanz));

  await admin(spieler, `dungeon reset ${dungeonA}`);
  await bis(() => !server.dungeons.getInstance(dungeonA));
  check('A: Instanz verworfen', !server.dungeons.getInstance(dungeonA));
  const draussen = await bis(() => sp.worldId === 'haupt' && ed.worldId === 'haupt', 3_000);
  check('A: Spieler und Editor stehen nach dem Verwerfen wieder in der Hauptwelt', draussen, `spieler=${sp.worldId} editor=${ed.worldId}`);
  const eigenes = server.hauptwelt.zdos.getZDO(sp.characterID);
  check('A: Spieler hat ein Charakter-ZDO der Hauptwelt (gleicher Hash)', !!eigenes && eigenes.prefabHash === spHash,
    `hash ${eigenes?.prefabHash} / ${spHash}`);
  check('A: Editor bleibt ohne Charakter-ZDO', ed.characterID.isNone(), ed.characterID.toString());

  // Foreign ZDO of the main world with exactly the number the character had
  // in the dropped instance.
  let opfer = server.hauptwelt.zdos.getZDO(idInInstanz) ?? null;
  let opferSelbstErstellt = false;
  for (let i = 0; i < 5000 && !opfer; i++) {
    const z = server.hauptwelt.zdos.createZDO(OPFER_HASH, OPFER_POS);
    if (z.zdoid.equals(idInInstanz)) {
      opfer = z;
      opferSelbstErstellt = true;
    }
  }
  check('A: fremdes ZDO mit der Nummer der Instanzfigur liegt in der Hauptwelt',
    !!opfer && !opfer.zdoid.equals(sp.characterID), idInInstanz.toString());
  const opferHash = opfer?.prefabHash ?? 0;
  const opferId = opfer?.zdoid;

  await admin(spieler, 'dungeon leave');
  await warte(600);
  const noch = opferId ? server.hauptwelt.zdos.getZDO(opferId) : undefined;
  check('A: fremdes ZDO existiert nach leave noch (nicht zerstört und als Figur geklont), gleicher Hash', !!noch && noch.prefabHash === opferHash,
    `hash ${noch?.prefabHash} / ${opferHash}`);
  if (opferSelbstErstellt) {
    check('A: fremdes ZDO behält Position', !!noch && noch.position.x === OPFER_POS.x && noch.position.z === OPFER_POS.z);
  }
  check('A: Spieler steht in der Hauptwelt mit gültiger Figur', sp.worldId === 'haupt' && !!server.hauptwelt.zdos.getZDO(sp.characterID));

  // Belt and braces: an id of a vanished world is never resolved in another.
  ed.characterID = idInInstanz;
  ed.worldId = 'dungeon:gibt-es-nicht';
  (server as unknown as { zdosVon(p: unknown): unknown }).zdosVon(ed);
  check('A: unbekannte Welt: Kennung wird verworfen statt in der Hauptwelt aufgelöst', ed.characterID.isNone(), ed.characterID.toString());
  check('A: unbekannte Welt: Peer steht danach in der Hauptwelt', ed.worldId === 'haupt', ed.worldId);
  editor.ws.close();

  // ── B. B4: player list per connection ──
  const dungeonB = await dungeonAnlegen(spieler, 4243);
  const editorB = verbinde('Tester', true);
  await editorB.angemeldet;
  await warte(500);
  const edB = peerVon('Tester', true)!;
  await admin(spieler, `dungeon enter ${dungeonB}`);
  await admin(editorB, `dungeon enter ${dungeonB}`);
  await bis(() => sp.worldId !== 'haupt' && edB.worldId !== 'haupt');
  const instB = server.dungeons.getInstance(dungeonB);
  check('B: Spieler und gleichnamiger Editor stehen in der Instanz', !!instB && sp.worldId !== 'haupt' && edB.worldId !== 'haupt');
  check('B: beide Verbindungen sind eingetragen', instB?.players.size === 2, `size ${instB?.players.size}`);
  await admin(editorB, 'dungeon leave');
  await bis(() => edB.worldId === 'haupt');
  check('B: der Editor trägt sich aus, der Spieler bleibt eingetragen', instB?.players.size === 1, `size ${instB?.players.size}`);
  server.dungeons.tick(Date.now());
  server.dungeons.tick(Date.now() + 10 * 24 * 3600 * 1000);
  check('B: Instanz lebt weiter, der Spieler steht noch drin',
    server.dungeons.getInstance(dungeonB) === instB && sp.worldId === instB?.welt.id, `worldId=${sp.worldId}`);
  // An editor that just disconnects also leaves the list.
  const editorC = verbinde('Ed3', true);
  await editorC.angemeldet;
  await warte(500);
  const edC = peerVon('Ed3', true)!;
  await admin(editorC, `dungeon enter ${dungeonB}`);
  await bis(() => edC.worldId !== 'haupt');
  check('B: Editor mit anderem Namen trägt sich ein', instB?.players.size === 2, `size ${instB?.players.size}`);
  editorC.ws.close();
  await bis(() => instB?.players.size === 1, 3_000);
  check('B: getrennter Editor trägt sich aus', instB?.players.size === 1, `size ${instB?.players.size}`);

  // ── C. Gegenprobe: normal enter / leave ──
  const eigen0 = sp.characterID;
  await admin(spieler, 'dungeon leave');
  await bis(() => sp.worldId === 'haupt');
  check('C: leave: Spieler in der Hauptwelt mit Figur', sp.worldId === 'haupt' && !!server.hauptwelt.zdos.getZDO(sp.characterID));
  check('C: leave: Liste leer, Instanz besteht noch', instB?.players.size === 0 && server.dungeons.getInstance(dungeonB) === instB,
    `size ${instB?.players.size}`);
  check('C: leave: Spielerfigur der Instanz ist weg', !server.welten.get(instB!.welt.id)?.zdos.getZDO(eigen0));
  await admin(spieler, `dungeon enter ${dungeonB}`);
  await bis(() => sp.worldId !== 'haupt');
  check('C: enter: Spieler in der Instanz mit Figur, eingetragen',
    sp.worldId === instB?.welt.id && !!server.welten.get(sp.worldId)?.zdos.getZDO(sp.characterID) && instB.players.size === 1);

  spieler.ws.close();
  await warte(500);
  check('C: Trennen in der Instanz trägt aus', instB?.players.size === 0, `size ${instB?.players.size}`);
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
