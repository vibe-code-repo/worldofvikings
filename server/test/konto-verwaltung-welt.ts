/**
 * Konto-Verwaltung (W3) gegen einen ECHTEN Server: Was die Löschung und der
 * Passwortwechsel in der Welt und an den offenen Verbindungen tun.
 *
 * `konto-verwaltung.ts` prüft die HTTP-API mit Attrappen für Forum und Welt.
 * Diese Datei prüft die Naht dahinter, an echten WebSocket-Verbindungen
 * (Muster: adminbefehle-bann.ts, instanz-verwurf.ts) und an den echten
 * Weltobjekten:
 *
 *  A. Löschen in der Hauptwelt: die Verbindung wird getrennt, der Spielstand
 *     ist weg, eine NIE GEÖFFNETE Truhe (Prefab mit CONTAINER, kein Inhalt)
 *     verschwindet, ein Bau bleibt herrenlos, Truhe und Verbindung eines
 *     ZEUGEN bleiben unberührt, und das vor der Löschung abgeholte
 *     Spieler-Token kommt nicht mehr herein.
 *  B. Löschen, während der Recke in einer Dungeon-Instanz steht: keine Reste
 *     in `instance.players`, kein Absturz, keine ZDOs mit seinem Besitz in
 *     irgendeiner Welt, die leere Instanz wird verworfen.
 *  C. Passwortwechsel trennt Spiel UND Editor-Verbindung des Kontos (jede
 *     einzeln als Objekt), der Spielstand bleibt, das alte Spieler-Token wird
 *     abgewiesen, ein neues gilt. "Überall abmelden" trennt ebenso.
 *
 * Ablauf: npx tsx server/test/konto-verwaltung-welt.ts   (aus der Wurzel)
 */
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PacketType, PrefabFlag } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { antwortBerechnen, geheimnisErzeugen } from '../src/net/Identitaet.js';
import type { Kontendatenbank } from '../src/konto/Kontendatenbank.js';

let PORT = 0;
const P = PacketType;
const CHEST = 'environment-sm-prop-chest-01';
const BAU_HASH = 987654321; // unbekanntes Prefab: zaehlt als Bau, nicht als Truhe

let fehler = 0;
function check(was: string, bedingung: boolean, zusatz = ''): void {
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` (${zusatz})` : ''}`);
  if (!bedingung) fehler++;
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

let xff = 0;
async function http(
  pfad: string, leib?: unknown, kontoToken = '', methode = leib === undefined ? 'GET' : 'POST',
): Promise<{ code: number; daten: Record<string, unknown> }> {
  const antwort = await fetch(`http://127.0.0.1:${PORT}${pfad}`, {
    method: methode,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${(++xff % 250) + 1}`,
      ...(kontoToken ? { 'x-wov-account': kontoToken } : {}),
    },
    body: leib === undefined ? undefined : JSON.stringify(leib),
  });
  const text = await antwort.text();
  try { return { code: antwort.status, daten: JSON.parse(text) as Record<string, unknown> }; } catch { return { code: antwort.status, daten: {} }; }
}

interface Verbindung {
  ws: WebSocket;
  angemeldet: boolean;
  geschlossen: boolean;
  ablehnung: string;
  admin: string[];
  fertig: Promise<void>;
}
function verbinde(name: string, token: string, nurEditor = false): Verbindung {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';
  const v: Verbindung = { ws, angemeldet: false, geschlossen: false, ablehnung: '', admin: [], fertig: Promise.resolve() };
  let authGesendet = false;
  v.fertig = new Promise<void>((ok, scheitern) => {
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Anmeldung ueberfaellig`)), 15_000);
    const fertig = (): void => { clearTimeout(uhr); ok(); };
    ws.on('close', () => { v.geschlossen = true; fertig(); });
    ws.on('error', fertig);
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
        ws.send(Buffer.from([P.PasswordAuth, ...writeString(antwortBerechnen(nonce, '')),
          ...writeString(name), ...writeString(token), ...(nurEditor ? [1] : [])]));
      } else if (type === P.PeerInfo) {
        v.angemeldet = true;
        fertig();
      } else if (type === P.Disconnect) {
        [v.ablehnung] = readString(view, 0);
      } else if (type === P.AdminEvent) {
        let pos = 0;
        [, pos] = readString(view, pos);
        pos += 1;
        const [msg] = readString(view, pos);
        v.admin.push(msg);
      }
    });
  });
  return v;
}
let letzter = 0;
async function admin(v: Verbindung, zeile: string): Promise<void> {
  const frei = letzter + 1_100;
  if (Date.now() < frei) await warte(frei - Date.now());
  letzter = Date.now();
  v.ws.send(Buffer.from([P.AdminCommand, ...writeString(zeile)]));
}

const PASSWORT = 'altespasswort1';
async function konto(server: ReturnType<typeof createWovServer>, benutzer: string, charName: string) {
  const r = await http('/accounts/register', { username: benutzer, email: `${benutzer}@example.org`, password: PASSWORT });
  if (r.code !== 201) throw new Error(`Registrierung ${benutzer}: ${r.code}`);
  const token = String(r.daten.token);
  const c = await http('/accounts/characters', {
    name: charName, figure: 'wikingerin', hairstyle: 'H_01', hairColor: 'mittelbraun', eyeColor: 'fjordblau', top: '', legs: '',
  }, token);
  if (c.code !== 201) throw new Error(`Charakter ${charName}: ${c.code}`);
  const id = Number((c.daten.character as { id: number }).id);
  const db = (server as unknown as { kontenDb: Kontendatenbank }).kontenDb;
  const ch = db.charakterNachName(charName)!;
  const play = async (kt: string): Promise<string> =>
    String((await http(`/accounts/characters/${id}/play`, {}, kt)).daten.sessionToken);
  return { benutzer, token, id, play, spielerId: ch.spielerId, besitzer: ch.altlastUserId.toString(), charName };
}

async function main(): Promise<void> {
  const ordner = mkdtempSync(join(tmpdir(), 'wov-konto-welt-'));
  const server = createWovServer({
    port: 0,
    worldsDir: join(ordner, 'worlds'),
    kontenDir: join(ordner, 'konten'),
    worldName: 'probe',
    everyoneAdmin: true,
    sessionSecret: Buffer.from(geheimnisErzeugen(), 'hex'),
    saveIntervalMs: 3_600_000,
  });
  server.init();
  server.start();
  PORT = portVon(server);
  await warte(1500);
  const innen = server as unknown as { savedPlayers: Map<string, unknown> };
  const peerVon = (name: string, editor = false) =>
    server.net.getPeers().find((p) => p.name === name && !!p.nurEditor === editor);
  const chestDef = server.prefabs.getByName(CHEST);
  check('Truhen-Prefab hat das Flag CONTAINER', !!chestDef && (chestDef.flags & PrefabFlag.CONTAINER) !== 0n);
  const chestHash = chestDef!.hash;
  const besitzOf = (b: string) => (welt: string): number => {
    let n = 0;
    for (const z of server.welten.get(welt)!.zdos.getAllZDOs()) if (z.getString('besitzer') === b) n++;
    return n;
  };

  try {
    // ── A. Loeschen in der Hauptwelt ─────────────────────────────────
    const alrun = await konto(server, 'Alrun', 'Alrunr');
    const zeuge = await konto(server, 'Zeuge', 'Zeugr');
    const alrunToken = await alrun.play(alrun.token);
    const vA = verbinde(alrun.charName, alrunToken);
    const vZ = verbinde(zeuge.charName, await zeuge.play(zeuge.token));
    await vA.fertig; await vZ.fertig;
    check('A: beide Verbindungen stehen', vA.angemeldet && vZ.angemeldet);
    await warte(400);

    const haupt = server.hauptwelt.zdos;
    const truheA = haupt.createZDO(chestHash, { x: 5, y: 0, z: 5 });
    truheA.setInt('spieler', 1); truheA.setString('besitzer', alrun.besitzer);
    const bauA = haupt.createZDO(BAU_HASH, { x: 6, y: 0, z: 6 });
    bauA.setInt('spieler', 1); bauA.setString('besitzer', alrun.besitzer);
    const truheZ = haupt.createZDO(chestHash, { x: 8, y: 0, z: 8 });
    truheZ.setInt('spieler', 1); truheZ.setString('besitzer', zeuge.besitzer);
    check('A: Truhe von Alrun hat keinen Inhalt (nie geoeffnet)', !truheA.hasMember(-1) && truheA.getString('besitzer') === alrun.besitzer);

    const geloescht = await http('/accounts/delete', { password: PASSWORT, confirm: 'Alrun' }, alrun.token);
    check('A: Loeschung antwortet 200', geloescht.code === 200, JSON.stringify(geloescht.daten));
    await bis(() => vA.geschlossen, 3_000);
    check('A: Verbindung von Alrun getrennt', vA.geschlossen);
    check('A: Peer von Alrun ist aus der Spielerliste', !peerVon(alrun.charName));
    check('A: Spielstand entfernt', !innen.savedPlayers.has(alrun.spielerId));
    check('A: nie geoeffnete Truhe ist weg', !haupt.getZDO(truheA.zdoid));
    const bauNach = haupt.getZDO(bauA.zdoid);
    check('A: der Bau bleibt, herrenlos', !!bauNach && bauNach.getString('besitzer') === '');
    check('A: Truhe des Zeugen unberuehrt', !!haupt.getZDO(truheZ.zdoid) && truheZ.getString('besitzer') === zeuge.besitzer);
    check('A: Verbindung des Zeugen steht weiter', !vZ.geschlossen && !!peerVon(zeuge.charName));
    const zurueck = verbinde(alrun.charName, alrunToken);
    await zurueck.fertig;
    check('A: das vor der Loeschung abgeholte Spieler-Token kommt nicht mehr herein', !zurueck.angemeldet, zurueck.ablehnung);
    check('A: keine ZDO mit Alruns Besitz mehr, ausser dem herrenlosen Bau', besitzOf(alrun.besitzer)('haupt') === 0);

    // ── B. Loeschen, waehrend der Recke in einer Instanz steht ───────
    const cedric = await konto(server, 'Cedric', 'Cedricr');
    const vC = verbinde(cedric.charName, await cedric.play(cedric.token));
    await vC.fertig;
    await warte(400);
    const pC = peerVon(cedric.charName)!;
    const vorher = vC.admin.length;
    await admin(vC, 'dungeon create forestcrypt 4242');
    await bis(() => vC.admin.slice(vorher).some((m) => /Dungeon erzeugt: \S+/.test(m)));
    const dungeonId = vC.admin.slice(vorher).map((m) => m.match(/Dungeon erzeugt: (\S+)/)?.[1]).find((x) => x)!;
    await admin(vC, `dungeon enter ${dungeonId}`);
    await bis(() => pC.worldId !== 'haupt');
    const instanz = server.dungeons.getInstance(dungeonId)!;
    const instWelt = pC.worldId;
    check('B: Cedric steht in der Instanz und ist eingetragen', instWelt !== 'haupt' && instanz.players.has(pC.userId), `worldId=${instWelt}`);
    const truheI = server.welten.get(instWelt)!.zdos.createZDO(chestHash, { x: 3, y: 0, z: 3 });
    truheI.setInt('spieler', 1); truheI.setString('besitzer', cedric.besitzer);
    const bauI = server.welten.get(instWelt)!.zdos.createZDO(BAU_HASH, { x: 4, y: 0, z: 4 });
    bauI.setInt('spieler', 1); bauI.setString('besitzer', cedric.besitzer);

    const cLoesch = await http('/accounts/delete', { password: PASSWORT, confirm: 'Cedric' }, cedric.token);
    check('B: Loeschung antwortet 200', cLoesch.code === 200, JSON.stringify(cLoesch.daten));
    await bis(() => vC.geschlossen, 3_000);
    check('B: Verbindung getrennt, Peer weg', vC.geschlossen && !peerVon(cedric.charName));
    check('B: keine Reste in instance.players', !instanz.players.has(pC.userId) && instanz.players.size === 0, `size ${instanz.players.size}`);
    check('B: Truhe in der Instanz weg', !server.welten.get(instWelt)?.zdos.getZDO(truheI.zdoid));
    let ohneAbsturz = true;
    try {
      server.dungeons.tick(Date.now());
      server.dungeons.tick(Date.now() + 10 * 24 * 3600 * 1000);
    } catch { ohneAbsturz = false; }
    // Ob die Instanz danach verworfen wird, entscheidet der DungeonManager (eine
    // Instanz mit Spielerbauten bleibt); hier zaehlt: kein Absturz, keine Spieler.
    const rest = server.dungeons.getInstance(dungeonId);
    check('B: tick nach der Loeschung ohne Absturz, Instanz verworfen oder leer', ohneAbsturz && (!rest || rest.players.size === 0));
    check('B: der Bau in der Instanz bleibt herrenlos', (server.welten.get(instWelt)?.zdos.getZDO(bauI.zdoid)?.getString('besitzer') ?? '') === ''
      || !server.welten.get(instWelt));
    let uebrig = 0;
    for (const w of server.welten.values()) for (const z of w.zdos.getAllZDOs()) if (z.getString('besitzer') === cedric.besitzer) uebrig++;
    check('B: kein ZDO mit Cedrics Besitz in irgendeiner Welt', uebrig === 0, `${uebrig}`);
    check('B: Zeuge weiter verbunden', !vZ.geschlossen);

    // ── C. Passwortwechsel trennt Spiel und Editor ───────────────────
    const dagmar = await konto(server, 'Dagmar', 'Dagmarr');
    const t1 = await dagmar.play(dagmar.token);
    const vD = verbinde(dagmar.charName, t1);
    const vE = verbinde(dagmar.charName, t1, true);
    await vD.fertig; await vE.fertig;
    check('C: Spiel- und Editor-Verbindung stehen', vD.angemeldet && vE.angemeldet);
    await warte(400);
    const w = await http('/accounts/password', { currentPassword: PASSWORT, newPassword: 'neuespasswort2' }, dagmar.token);
    check('C: Passwortwechsel 200', w.code === 200, JSON.stringify(w.daten));
    await bis(() => vD.geschlossen && vE.geschlossen, 3_000);
    check('C: beide Verbindungen getrennt (Spiel und Editor)', vD.geschlossen && vE.geschlossen, `spiel=${vD.geschlossen} editor=${vE.geschlossen}`);
    check('C: keine Peers des Kontos mehr', !peerVon(dagmar.charName) && !peerVon(dagmar.charName, true));
    check('C: der Spielstand bleibt', innen.savedPlayers.has(dagmar.spielerId));
    const alt = verbinde(dagmar.charName, t1);
    await alt.fertig;
    check('C: das alte Spieler-Token wird abgewiesen', !alt.angemeldet, alt.ablehnung);
    const neu = await dagmar.play(String(w.daten.token));
    const vN = verbinde(dagmar.charName, neu);
    await vN.fertig;
    check('C: ein neues Spieler-Token gilt', vN.angemeldet, vN.ablehnung);

    // "Ueberall abmelden" trennt ebenso.
    await warte(300);
    const abm = await http('/accounts/login', { username: 'Dagmar', password: 'neuespasswort2', logoutOthers: true });
    check('C: "ueberall abmelden" antwortet 200', abm.code === 200);
    await bis(() => vN.geschlossen, 3_000);
    check('C: die laufende Verbindung ist getrennt', vN.geschlossen);
    vZ.ws.close();
  } finally {
    server.stop();
    rmSync(ordner, { recursive: true, force: true });
  }
  console.log(fehler === 0 ? '\nAlle Pruefungen gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(fehler > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
