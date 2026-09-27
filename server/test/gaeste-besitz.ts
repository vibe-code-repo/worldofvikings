/**
 * Gaeste-Besitz — ein Gast behaelt Besitz und Stand nur mit seinem Token,
 * und niemand uebernimmt einen fremden Stand ueber den Namen.
 *
 * Echte WebSocket-Clients gegen einen lokalen Testserver (127.0.0.1, Port 0,
 * eigene Testdaten). Die Proben beobachten am Server, was der Peer nach dem
 * Anmelden hat (Kennung, Inventar, Position, Truhen-Besitz).
 *
 *  [A] Gast „Ole“ ohne Token sammelt Holz, steht woanders, hat Truhe und
 *      Bettbesitz, trennt.
 *  [B] Ein voellig neuer Client ohne Token meldet sich als „Ole“: bekommt er
 *      Oles Inventar, Position oder Kennung? (Soll: nein.)
 *  [C] Ole mit Token, dreimal: gleiche Kennung, Inventar waechst weiter,
 *      Position, Truhe und Bett gehoeren ihm.
 *  [D] Konto „Anna“: Ein Gast (ohne Token / mit fremdem Gast-Token, auch in
 *      anderer Schreibweise) darf den Namen eines Kontos nicht tragen; Annas
 *      Stand bleibt bei ihr.
 *  [E] Namensgeschluesselter Altstand (Save aus der Zeit vor der spielerId)
 *      faellt nicht mehr an den, der den Namen tippt.
 *  [F] Das Editor-Bit (`nurEditor`) ist ein Client-Wert: Ein Gast damit und mit
 *      dem Namen eines Kontos traegt ihn nicht, chattet nicht darunter, sperrt
 *      die echte Person nicht aus, und `admin add` trifft nicht ihn. Ein echter
 *      Editor (auch mit Konto-Token) loest den Spielclient nicht ab.
 *  [F3] Ein Editor-Gast ohne Recht sendet TerrainOp/PlacePiece/Interact:
 *      nichts davon erreicht WovServer (C2).
 *  [F3b] Ein ADMIN-Editor sendet SetTimeOfDay/DungeonEditRequest: beide sind
 *      seit dieser Nachbesserung aus der Allowlist gestrichen (T1) und
 *      bewirken nichts, obwohl der Handler selbst isAdmin erfuellt saehe.
 *  [F4] Ein echter Admin-Editor speichert weiterhin — die Allowlist nimmt
 *      den erlaubten vier Pakettypen nichts.
 *  [H] Zwei gespeicherte Gaeste gleichen Namens: `admin add` meldet
 *      „nicht eindeutig“ und tut nichts. Eine andere Schreibung desselben
 *      Namens kommt online nicht mehr gleichzeitig herein (C3).
 *  [H2] Dieselben zwei Staende: `spieler entfernen Ole` meldet „nicht
 *      eindeutig“ und loescht nichts (C5).
 *  [H3] `spieler entfernen` mit einem Treffer in anderer Schreibung loescht
 *      ihn (C5b/C5c).
 *  [H4] `spieler entfernen` erkennt einen Online-Spieler auch in anderer
 *      Schreibung und loescht nichts (D2); die Eingabe ist bewusst GROSS
 *      geschrieben (ULF), damit ihr Schluessel vom Wortlaut abweicht (A11).
 *  [H5] `kick` erkennt eine andere Schreibung (C3).
 *  [H6] Ein Admin trifft sich per `kick` unter anderer Schreibung nicht
 *      mehr selbst (B1, Regression aus C3). Die gleiche Umstellung fuer
 *      `bann herkunft` steht — aus demselben Grund wie bei C3 oben — in
 *      server/test/adminbefehle-bann.ts, wo jede Verbindung ihre eigene
 *      Herkunft bekommt.
 *  [I] Namen mit Steuer-/Nullbreiten-Zeichen, weiteren unsichtbaren Default-
 *      Ignorable-Zeichen (B3) und andere Schreibweisen eines Kontonamens
 *      (NFD, Grossbuchstaben mit Umlaut) werden abgewiesen.
 *  [I2] Echte Namen mit Sonderzeichen (Koreanisch, Zoë in NFD, Braille
 *      ausser dem Blank-Zeichen) bleiben erlaubt (Gegenprobe zu B3).
 *  [J] Der Name "Editor" ist fuer Gaeste reserviert (auch waehrend ein
 *      Editor online ist, auch mit Leerzeichen: MR2); ein zweiter Editor
 *      bleibt moeglich; `admin add Editor` trifft keinen Editor-Peer; ein
 *      Konto mit anderem Namen bleibt unbeeinflusst.
 *  [J2] Ein Konto-Charakter „Editor“ kommt herein, obwohl Editor-Verbindungen
 *      online sind, und `admin add Editor`/`kick editor` treffen ihn, nie
 *      die Editor-Peers, in beiden Verbindungsreihenfolgen (C1a, B2). Ein
 *      `spieler entfernen editor` waehrend Editor-Peers online sind loescht
 *      trotzdem den (jetzt offline) Konto-Charakter (A10).
 *  [K] `admin add` mit einer NFD-geschriebenen Eingabe trifft einen
 *      NFC-benannten Peer.
 *
 * Run: npx tsx server/test/gaeste-besitz.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PacketType, findItem, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { Peer } from '../src/net/Peer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const P = PacketType;
let PORT = 0;
let fehler = 0;
function check(was: string, bedingung: boolean, zusatz = ''): void {
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` (${zusatz})` : ''}`);
  if (!bedingung) fehler++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const bis = async (bedingung: () => boolean, ms: number): Promise<boolean> => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return true;
    await warte(25);
  }
  return bedingung();
};

interface Klient {
  ws: WebSocket;
  angemeldet: boolean;
  /** Was der Server im PeerInfo als Kennung und Token schickte. */
  userId: string;
  token: string;
  geschlossen: boolean;
  /** Chat lines seen (`Name: text`) and AdminEvent replies, in order. */
  chats: string[];
  antworten: string[];
  /** C2: Zahl empfangener Pakete je Typ (PacketType), fuer Zeugen-Proben. */
  typen: Map<number, number>;
}

/** Verbinden wie der Browser: `token` leer = kein Token im localStorage. */
function verbinde(name: string, token: string, nurEditor = false): Promise<Klient> {
  return new Promise((fertig, scheitern) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    const k: Klient = { ws, angemeldet: false, userId: '', token: '', geschlossen: false, chats: [], antworten: [], typen: new Map() };
    let authGesendet = false;
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Handshake ueberfaellig`)), 15_000);
    const schluss = (): void => { clearTimeout(uhr); fertig(k); };
    ws.on('close', () => { k.geschlossen = true; schluss(); });
    ws.on('error', schluss);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      k.typen.set(type, (k.typen.get(type) ?? 0) + 1);
      const r = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authGesendet) return;
        authGesendet = true;
        const w = new Writer();
        w.writeString(antwortBerechnen(r.readString(), ''));
        w.writeString(name);
        w.writeString(token);
        w.writeBool(nurEditor);
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        r.readString(); // Name
        k.userId = r.readString();
        r.readString(); // Servername
        k.token = r.remaining() > 0 ? r.readString() : '';
        k.angemeldet = true;
        schluss();
      } else if (type === P.ChatMessage) {
        r.readString();
        const von = r.readString();
        r.readInt32();
        k.chats.push(`${von}: ${r.readString()}`);
      } else if (type === P.AdminEvent) {
        r.readString();
        r.readBool();
        k.antworten.push(r.readString());
      }
    });
  });
}

async function json(pfad: string, leib?: unknown, kontoToken = ''): Promise<Record<string, unknown>> {
  const antwort = await fetch(`http://127.0.0.1:${PORT}${pfad}`, {
    method: leib === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(kontoToken ? { authorization: `Bearer ${kontoToken}` } : {}),
    },
    body: leib === undefined ? undefined : JSON.stringify(leib),
  });
  return JSON.parse(await antwort.text()) as Record<string, unknown>;
}

function sendeChat(k: Klient, text: string): void {
  const w = new Writer();
  w.writeInt32(0);
  w.writeString(text);
  k.ws.send(Buffer.concat([Buffer.from([P.ChatMessage]), w.toBuffer()]));
}

/** C2: rohes Paket senden, ohne den Umweg ueber einen GameSocket-Client. */
function sendePaket(k: Klient, typ: number, w: Writer): void {
  k.ws.send(Buffer.concat([Buffer.from([typ]), w.toBuffer()]));
}

/** One admin command; the drossel refills 1/s, so wait first. Returns the reply text. */
async function admin(k: Klient, zeile: string): Promise<string> {
  await warte(1100);
  const n = k.antworten.length;
  const w = new Writer();
  w.writeString(zeile);
  k.ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
  await bis(() => k.antworten.length > n, 5_000);
  return k.antworten[n] ?? '';
}

async function spieltoken(benutzer: string): Promise<string> {
  const anmeldung = await json('/accounts/login', { username: benutzer, password: benutzer });
  const kontoToken = String(anmeldung.token ?? '');
  const charId = ((anmeldung.characters ?? []) as { id: number }[])[0]!.id;
  const spiel = await json(`/accounts/characters/${charId}/play`, {}, kontoToken);
  return String(spiel.sessionToken ?? '');
}

async function main(): Promise<void> {
  const ordner = mkdtempSync(join(tmpdir(), 'wov-gaeste-besitz-'));
  const server = createWovServer({
    port: 0,
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldCreatures: false,
    worldVegetation: false,
    worldsDir: join(ordner, 'worlds'),
    kontenDir: join(ordner, 'konten'),
    worldName: 'gaeste-besitz',
    saveIntervalMs: 3600_000,
    metrikenDatei: join(ordner, 'metriken', 'metriken.json'),
    standardKonten: [
      { name: 'anna', passwort: 'anna', charakter: 'Anna' },
      { name: 'bjoern', passwort: 'bjoern', charakter: 'Björn' },
      { name: 'boss', passwort: 'boss', charakter: 'Boss', admin: true },
      // D3 (Pruefung 3): fuer [J] — ein KONTO-Charakter namens „Editor“,
      // um C1a zu toeten (P1 in gast-pruef3).
      { name: 'editorkonto', passwort: 'editorkonto', charakter: 'Editor' },
    ],
  });
  server.init();
  server.start();
  PORT = portVon(server);
  await warte(600);

  const innen = server as unknown as {
    savedPlayers: Map<string, Record<string, unknown>>;
    kontenDb: { charakterNachName(name: string): { spielerId: string } | null };
    adminListe: { enthaelt(id: string): boolean };
    darfBenutzen(zdo: ZDO, peer: Peer): boolean;
  };
  const peerVon = (k: Klient): Peer | undefined =>
    server.net.getPeers().find((p) => p.userId.toString() === k.userId);
  const trenne = async (k: Klient): Promise<void> => {
    k.ws.close();
    await bis(() => !peerVon(k), 5_000);
    await warte(150);
  };
  const holz = (k: Klient): number => peerVon(k)?.inventar.countOf('Wood') ?? -1;
  const abstand = (a: Vector3, b: Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);
  const OLE_POS: Vector3 = { x: 300, y: 50, z: 400 };
  const truhenHash = server.prefabs.getByName('environment-sm-prop-chest-01')!.hash;
  const truheFuer = (userId: string): ZDO => {
    const z = server.zdos.createZDO(truhenHash, { x: 305, y: 50, z: 400 });
    z.setInt('spieler', 1);
    z.setString('besitzer', userId);
    return z;
  };

  try {
    // ── [A] Ole sammelt, baut, trennt ───────────────────────────────
    console.log('\n[A] Gast Ole ohne Token:');
    const basis = await verbinde('Frischling', '');
    const frischHolz = holz(basis);
    const frischPos = { ...peerVon(basis)!.position };
    const frischSpielerId = peerVon(basis)!.spielerId;
    await trenne(basis);
    console.log(`    Startwerte eines neuen Gasts: Holz ${frischHolz}, Position ${JSON.stringify(frischPos)}`);

    const ole1 = await verbinde('Ole', '');
    check('A: Ole kommt herein und bekommt ein Token', ole1.angemeldet && ole1.token.length > 0);
    const oleId = ole1.userId;
    const oleSpielerId = peerVon(ole1)!.spielerId;
    const oleToken = ole1.token;
    const p1 = peerVon(ole1)!;
    p1.inventar.addItem(findItem('Wood')!, 100);
    p1.position = { ...OLE_POS };
    p1.spawnPoint = { x: 301, y: 50, z: 400 };
    p1.spawnBettBesitzer = oleId;
    const truhe = truheFuer(oleId);
    check('A: Ole hat Holz und steht woanders', holz(ole1) === frischHolz + 100);
    await trenne(ole1);
    const olesHolz = frischHolz + 100;

    // ── [B] Ein voellig neuer Client als „Ole“ ───────────────────────
    console.log('\n[B] Neuer Client ohne Token als „Ole“:');
    const dieb = await verbinde('Ole', '');
    const pd = peerVon(dieb);
    const diebSpielerId = pd!.spielerId;
    console.log(`    angemeldet=${dieb.angemeldet} Kennung=${dieb.userId} (Ole: ${oleId}) Holz=${holz(dieb)} ` +
      `Abstand zu Oles Platz=${pd ? abstand(pd.position, OLE_POS).toFixed(1) : '-'}`);
    check('B: der Fremde bekommt NICHT Oles Inventar', holz(dieb) !== olesHolz, `Holz ${holz(dieb)}`);
    check('B: der Fremde bekommt NICHT Oles Position',
      !pd || abstand(pd.position, OLE_POS) > 20, JSON.stringify(pd?.position));
    check('B: der Fremde bekommt eine andere Kennung', dieb.userId !== oleId);
    check('B: Oles Truhe ist fuer ihn fremd', !!pd && !innen.darfBenutzen(truhe, pd));
    check('B: Oles Bettbesitz wurde nicht uebernommen', !pd || pd.spawnBettBesitzer !== oleId);
    await trenne(dieb);

    // ── [C] Ole mit Token, dreimal ────────────────────────────────────
    for (let runde = 1; runde <= 3; runde++) {
      console.log(`\n[C${runde}] Ole mit Token (${runde}. Wiederverbindung):`);
      const ole = await verbinde('Ole', oleToken);
      const p = peerVon(ole)!;
      check(`C${runde}: gleiche Kennung`, ole.userId === oleId, `${ole.userId} vs ${oleId}`);
      check(`C${runde}: Inventar (Holz ${olesHolz + runde - 1})`, holz(ole) === olesHolz + runde - 1, `Holz ${holz(ole)}`);
      check(`C${runde}: Position`, !!p && abstand(p.position, OLE_POS) < 1, JSON.stringify(p?.position));
      check(`C${runde}: Truhe gehoert ihm`, !!p && innen.darfBenutzen(truhe, p));
      check(`C${runde}: Bett gehoert ihm`, !!p && p.spawnBettBesitzer === oleId, String(p?.spawnBettBesitzer));
      p.inventar.addItem(findItem('Wood')!, 1);
      await trenne(ole);
    }

    // ── [D] Konto „Anna“ ──────────────────────────────────────────────
    console.log('\n[D] Konto Anna und Gaeste mit ihrem Namen:');
    const anmeldung = await json('/accounts/login', { username: 'anna', password: 'anna' });
    const kontoToken = String(anmeldung.token ?? '');
    const charId = ((anmeldung.characters ?? []) as { id: number }[])[0]!.id;
    const spiel = await json(`/accounts/characters/${charId}/play`, {}, kontoToken);
    const annaToken = String(spiel.sessionToken ?? '');
    check('D: Anna hat ein Spieltoken', annaToken.length > 0);
    const anna1 = await verbinde('Anna', annaToken);
    check('D: Anna kommt herein', anna1.angemeldet);
    const annaId = anna1.userId;
    peerVon(anna1)!.inventar.addItem(findItem('Wood')!, 100);
    const annasHolz = holz(anna1);
    const annasTruhe = truheFuer(annaId);
    await trenne(anna1);

    for (const [was, name, token] of [
      ['ohne Token', 'Anna', ''],
      ['mit Oles Gast-Token', 'Anna', oleToken],
      ['andere Schreibweise', 'ANNA', ''],
    ] as const) {
      const gast = await verbinde(name, token);
      const pg = peerVon(gast);
      console.log(`    Gast „${name}“ ${was}: angemeldet=${gast.angemeldet} Holz=${pg ? holz(gast) : '-'}`);
      check(`D: Gast als „${name}“ ${was} bekommt Annas Stand nicht`, !pg || holz(gast) !== annasHolz);
      check(`D: Gast als „${name}“ ${was} darf den Kontonamen nicht tragen`, !gast.angemeldet);
      if (pg) await trenne(gast);
    }
    const anna2 = await verbinde('Anna', annaToken);
    const pa = peerVon(anna2);
    check('D: Anna kommt danach unverdraengt herein', anna2.angemeldet);
    check('D: Annas Kennung ist stabil', anna2.userId === annaId);
    check('D: Annas Inventar ist unveraendert', holz(anna2) === annasHolz, `Holz ${holz(anna2)}`);
    check('D: Annas Truhe gehoert ihr', !!pa && innen.darfBenutzen(annasTruhe, pa));
    await trenne(anna2);

    // ── [E] Namensgeschluesselter Altstand ─────────────────────────────
    console.log('\n[E] Altstand unter dem Namen (ohne spielerId):');
    const spender = await verbinde('Spender', '');
    peerVon(spender)!.inventar.addItem(findItem('Wood')!, 100);
    const spenderSpielerId = peerVon(spender)!.spielerId;
    await trenne(spender);
    const vorlage = innen.savedPlayers.get(spenderSpielerId)!;
    check('E: Vorlage-Stand liegt vor', !!vorlage);
    innen.savedPlayers.delete(spenderSpielerId);
    innen.savedPlayers.set('Legacy', { ...vorlage, name: 'Legacy', spielerId: undefined });
    const alt = await verbinde('Legacy', '');
    console.log(`    angemeldet=${alt.angemeldet} Holz=${holz(alt)}`);
    check('E: ein Altstand faellt nicht an den, der den Namen tippt', holz(alt) === frischHolz, `Holz ${holz(alt)}`);
    await trenne(alt);

    // ── [F] Das Editor-Bit ist ein Client-Wert und schaltet nichts frei ──
    console.log('\n[F] Gast mit gesetztem Editor-Bit und dem Namen eines Kontos:');
    const boss = await verbinde('Boss', await spieltoken('boss'));
    const zeuge = await verbinde('Zeuge', '');
    const annaSpielerId = innen.kontenDb.charakterNachName('Anna')!.spielerId;
    sendeChat(boss, 'Hallo');
    await bis(() => zeuge.chats.length > 0, 3_000);
    check('F: Zeuge sieht eine normale Chatzeile (Kontrolle des Zeugen)', zeuge.chats.includes('Boss: Hallo'), JSON.stringify(zeuge.chats));
    const editorGast = await verbinde('Anna', '', true);
    const pe = peerVon(editorGast);
    console.log(`    angemeldet=${editorGast.angemeldet} Name am Server=${pe?.name}`);
    check('F: der Editor-Gast trägt den Namen „Anna“ nicht', !pe || pe.name !== 'Anna', String(pe?.name));
    sendeChat(editorGast, 'Ich bin Anna, gebt mir eure Sachen');
    await warte(700);
    check('F: der Editor-Gast schreibt nicht in den Chat (nicht einmal an sich selbst)', !zeuge.chats.some((c) => c.includes('gebt mir eure Sachen')) && editorGast.chats.length === 0, JSON.stringify([zeuge.chats, editorGast.chats]));
    const annaEcht = await verbinde('Anna', annaToken);
    check('F: die echte Anna kommt herein, obwohl der Editor-Gast online ist', annaEcht.angemeldet && annaEcht.userId === annaId);
    await trenne(annaEcht);
    const antwort = await admin(boss, 'admin add Anna');
    console.log(`    admin add Anna → ${antwort}`);
    check('F: admin add Anna trifft das Konto', innen.adminListe.enthaelt(annaSpielerId));
    check('F: admin add Anna trifft den Editor-Gast nicht', !!pe && !innen.adminListe.enthaelt(pe.spielerId));
    await trenne(editorGast);

    console.log('\n[F2] Ein echter Editor (mit Konto-Token) löst den offenen Spielclient nicht ab:');
    const annaSpiel = await verbinde('Anna', annaToken);
    const annaEditor = await verbinde('Anna', annaToken, true);
    await warte(300);
    check('F2: der Editor kommt herein', annaEditor.angemeldet);
    const editorPeer = server.net.getPeers().find((p) => p.nurEditor && p.userId.toString() === annaEditor.userId);
    check('F2: der Editor heißt „Editor“, nicht „Anna“', editorPeer?.name === 'Editor', String(editorPeer?.name));
    check('F2: der Spielclient ist noch verbunden', !annaSpiel.geschlossen && server.net.getPeers().some((p) => !p.nurEditor && p.name === 'Anna'));
    await trenne(annaEditor);
    await trenne(annaSpiel);
    const editorOhne = await verbinde('Editor', '', true);
    check('F2: ein Editor ohne Konto (Name „Editor“) kommt herein', editorOhne.angemeldet);
    await trenne(editorOhne);

    // ── [F3] C2: eine Editor-Verbindung ohne Recht sendet keine Spielpakete ──
    // GameSocket schickt ueber eine nurEditor-Verbindung nur DungeonModulBau,
    // DungeonModulLoeschen und DungeonEditSave (client/src/editor/{DungeonNeuerSaal,
    // DungeonSpeichern,dungeon2/Dungeon2Speichern}.ts). Vorher liess NetManager
    // trotzdem jedes andere Paket durch — TerrainOp kam beim Zeugen als
    // TerrainOpSync an, unsichtbar fuer jeden Namensweg (Pruefung 2, C2).
    console.log('\n[F3] Editor-Gast ohne Recht: TerrainOp/PlacePiece/Interact wirken nicht (C2):');
    const betAmSchmied = await verbinde('Schmied', '', true);
    const pSchmied = peerVon(betAmSchmied)!;
    check('F3: Editor-Gast ist kein Admin', !pSchmied.isAdmin);
    // An der Zeugenposition graben (nicht irgendwo abseits): applyTerrainOp
    // meldet sonst "kein Effekt" unabhaengig vom C2-Riegel, und der Test
    // waere leer wahr. „KiPine2" (bau_kipine) ist zurzeit das einzige
    // buildbare Piece mit trivialen Kosten -- die anderen acht Hammer-Teile
    // sind Fremdprefabs und aus BAU_PREFABS gefiltert (PieceTable.ts
    // hammerTabelle()), ein Bett waere also selbst mit Admin-Recht nicht
    // baubar und der Test damit unabhaengig vom C2-Riegel immer gruen.
    pSchmied.position = { ...peerVon(zeuge)!.position };
    pSchmied.inventar.addItem(findItem('Wood')!, 1);
    const kiefernHash = server.prefabs.getByName('KiPine2')!.hash;
    const zdosVorC2 = server.hauptwelt.zdos.getAllZDOs().length;
    const terrainOpSyncVor = zeuge.typen.get(P.TerrainOpSync) ?? 0;

    // TerrainOp: dieselbe Grabung wie in der Pruefung (4 m Radius, −3 m).
    { const w = new Writer();
      w.writeFloat32(pSchmied.position.x); w.writeFloat32(pSchmied.position.y); w.writeFloat32(pSchmied.position.z);
      w.writeString(JSON.stringify({ level: true, square: true, levelRadius: 4, levelOffset: -3 }));
      sendePaket(betAmSchmied, P.TerrainOp, w); }
    // PlacePiece: eine KI-Kiefer, mit genug Holz im Inventar, um am Kostencheck vorbeizukommen.
    { const w = new Writer();
      w.writeInt32(kiefernHash);
      w.writeFloat32(pSchmied.position.x); w.writeFloat32(pSchmied.position.y); w.writeFloat32(pSchmied.position.z);
      w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(1);
      sendePaket(betAmSchmied, P.PlacePiece, w); }
    // Beide oben verarbeiten lassen, BEVOR die Position fuer Interact
    // umgesetzt wird: handleTerrainOp/handlePlacePiece lesen peer.position
    // (dieselbe Server-Instanz) erst beim Eintreffen des Pakets, nicht beim
    // Senden. Ohne dieses Warten stand pSchmied schon bei der Truhe, wenn
    // die beiden Pakete ankamen — die Entfernungspruefung in handleTerrainOp
    // (max. 10 m zu peer.position) schlug dann fehl, und beide Checks unten
    // waren leer wahr, auf beiden Staenden gleich, unabhaengig vom C2-Riegel.
    //
    // T4 (Testluecke Pruefung 4): eine feste Wartezeit kann unter Last
    // wieder zu kurz sein und den Test still leer-wahr machen, ohne dass
    // er rot wird. Ein Ping NACH beiden Paketen kommt garantiert erst
    // zurueck, wenn der Server sie verarbeitet hat — handlePacket ist je
    // Verbindung synchron und geordnet (Ping wird ganz oben in derselben
    // Methode geechot, s. NetManager.ts), unabhaengig von der Systemlast.
    const pingVorC2 = betAmSchmied.typen.get(P.Ping) ?? 0;
    sendePaket(betAmSchmied, P.Ping, new Writer());
    await bis(() => (betAmSchmied.typen.get(P.Ping) ?? 0) > pingVorC2, 5_000);
    // Interact: Oles Truhe steht bei (305,50,400); der Editor-Gast wird extra dorthin gestellt.
    pSchmied.position = { ...truhe.position };
    { const w = new Writer();
      w.writeFloat32(truhe.position.x); w.writeFloat32(truhe.position.y); w.writeFloat32(truhe.position.z);
      w.writeInt32(truhenHash);
      sendePaket(betAmSchmied, P.Interact, w); }
    await warte(1000);

    check('F3: Zeuge bekommt keine TerrainOpSync vom Editor-Gast',
      (zeuge.typen.get(P.TerrainOpSync) ?? 0) === terrainOpSyncVor,
      `${terrainOpSyncVor} → ${zeuge.typen.get(P.TerrainOpSync) ?? 0}`);
    check('F3: kein neues ZDO durch PlacePiece', server.hauptwelt.zdos.getAllZDOs().length === zdosVorC2,
      `${zdosVorC2} → ${server.hauptwelt.zdos.getAllZDOs().length}`);
    check('F3: Holz des Editor-Gasts unangetastet (PlacePiece nie ausgefuehrt)', pSchmied.inventar.countOf('Wood') === 1, String(pSchmied.inventar.countOf('Wood')));
    check('F3: der Editor-Gast bekommt keine Quittung (InteractResult/ContainerSync) — die Pakete erreichten WovServer nie',
      (betAmSchmied.typen.get(P.InteractResult) ?? 0) === 0 && (betAmSchmied.typen.get(P.ContainerSync) ?? 0) === 0,
      JSON.stringify([...betAmSchmied.typen]));
    await trenne(betAmSchmied);

    console.log('\n[F4] Ein echter Admin-Editor speichert weiterhin (C2 nimmt der Allowlist nichts):');
    const adminEditor = await verbinde('BossEditor', await spieltoken('boss'), true);
    check('F4: Admin-Editor kommt herein', adminEditor.angemeldet && peerVon(adminEditor)?.isAdmin === true);
    let speicherQuittung: { ok: boolean; message: string } | null = null;
    adminEditor.ws.on('message', (data: Buffer) => {
      if (data.readUInt8(0) === P.DungeonEditData && !speicherQuittung) {
        const r = new Reader(Buffer.from(data.subarray(1)));
        speicherQuittung = { ok: r.readBool(), message: r.readString() };
      }
    });
    const dungeonDoc = {
      version: 2, id: 'f4-probe', name: 'F4', base: 'DG_Steingrab', mode: 'custom', seed: 1, zoneSize: 64,
      layout: { rooms: [{ room: 'SteingrabGang', pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, seed: 1 }], doors: [], props: [] },
    };
    // Kein Pruefsummen-Feld: ein leeres waere KEIN „aelterer Client ohne das
    // Feld“ (dann wuerde der Server sie mit der echten vergleichen und ablehnen),
    // sondern schlicht weggelassen — wie in g9-editor-verbindung.ts.
    { const w = new Writer(); w.writeString(JSON.stringify(dungeonDoc));
      sendePaket(adminEditor, P.DungeonEditSave, w); }
    await bis(() => speicherQuittung !== null, 3000);
    check('F4: DungeonEditSave vom Admin-Editor wird weiterhin ausgefuehrt (C2 sperrt keinen erlaubten Pakettyp)',
      (speicherQuittung as { ok: boolean; message: string } | null)?.ok === true, JSON.stringify(speicherQuittung));

    // ── [F3b] T1/A2/A3: SetTimeOfDay/DungeonEditRequest bewusst NICHT
    //      mehr in der Editor-Allowlist ────────────────────────────────
    // Beide Handler pruefen selbst isAdmin, wie die vier verbliebenen
    // Typen auch — die Probe nimmt deshalb bewusst den ADMIN-Editor aus
    // [F4] (isAdmin ist erfuellt): haette die Allowlist die beiden Typen
    // noch drin, wirkten sie hier. Dass sie es nicht tun, zeigt, dass die
    // Allowlist selbst blockt, nicht (nur) der jeweilige Handler.
    console.log('\n[F3b] Admin-Editor: SetTimeOfDay/DungeonEditRequest bewirken nichts (Allowlist schlank, T1):');
    const zeitVorher = server.getTimeOfDay();
    const timeSyncVorher = zeuge.typen.get(P.TimeSync) ?? 0;
    const dungeonEditDataVorher = adminEditor.typen.get(P.DungeonEditData) ?? 0;
    { const w = new Writer(); w.writeFloat64(777);
      sendePaket(adminEditor, P.SetTimeOfDay, w); }
    { const w = new Writer(); w.writeString('');
      sendePaket(adminEditor, P.DungeonEditRequest, w); }
    await warte(500);
    check('F3b: SetTimeOfDay vom Admin-Editor aendert die Weltzeit nicht (A2)',
      Math.abs(server.getTimeOfDay() - zeitVorher) < 1, `${zeitVorher} → ${server.getTimeOfDay()}`);
    check('F3b: kein TimeSync-Broadcast durch das geblockte SetTimeOfDay',
      (zeuge.typen.get(P.TimeSync) ?? 0) === timeSyncVorher);
    check('F3b: DungeonEditRequest vom Admin-Editor bekommt keine (neue) Antwort (A3)',
      (adminEditor.typen.get(P.DungeonEditData) ?? 0) === dungeonEditDataVorher, JSON.stringify([...adminEditor.typen]));

    await trenne(adminEditor);

    // ── [J] Der Name „Editor“ ist reserviert (C1); admin add trifft keinen
    //      Editor-Peer (ME) ──────────────────────────────────────────────
    console.log('\n[J] Editor online, Gast „Editor“/„editor“, zweiter Editor, admin add Editor, Konto unbeeinflusst (C1, ME):');
    const editor1 = await verbinde('Editor', '', true);
    check('J: erster Editor kommt herein', editor1.angemeldet);
    const editor2 = await verbinde('Zweiter', '', true);
    check('J: zweiter Editor kommt gleichzeitig herein (weiterhin möglich)', editor2.angemeldet);
    const gastEditor = await verbinde('Editor', '');
    check('J: Gast „Editor“ wird abgewiesen, solange ein Editor online ist', !gastEditor.angemeldet);
    if (gastEditor.angemeldet) await trenne(gastEditor);
    const gastEditorKlein = await verbinde('editor', '');
    check('J: Gast „editor“ (Kleinschreibung) wird abgewiesen', !gastEditorKlein.angemeldet);
    if (gastEditorKlein.angemeldet) await trenne(gastEditorKlein);
    // MR2 (Pruefung 3): die Reservierung muss trimmen, nicht nur klein
    // schreiben — sonst kommt "Editor" mit Leerzeichen durch.
    const gastEditorLeer = await verbinde(' Editor', '');
    check('J: Gast „ Editor“ (mit Leerzeichen) wird ebenfalls abgewiesen (MR2)', !gastEditorLeer.angemeldet);
    if (gastEditorLeer.angemeldet) await trenne(gastEditorLeer);
    const editorAntwort = await admin(boss, 'admin add Editor');
    console.log(`    admin add Editor → ${editorAntwort}`);
    // Exakte Nachricht statt einer Verneinung: Mit zwei Editoren online liefert
    // der ME-Mutant (Filter `!p.nurEditor` entfernt) "nicht eindeutig" statt
    // "Unbekannter Spieler" -- eine bloße Verneinung von "ist jetzt"/"war schon
    // Admin" würde das nicht fangen.
    check('J: `admin add Editor` trifft keinen Editor-Peer (ME)',
      editorAntwort.includes('Unbekannter Spieler'), editorAntwort);
    check('J: kein Editor-Peer wurde Admin',
      server.net.getPeers().filter((p) => p.nurEditor).every((p) => !innen.adminListe.enthaelt(p.spielerId)));
    const annaUnbeeinflusst = await verbinde('Anna', annaToken);
    check('J: Konto-Charakter mit anderem Namen bleibt unbeeinflusst, während Editoren online sind',
      annaUnbeeinflusst.angemeldet && annaUnbeeinflusst.userId === annaId);
    await trenne(annaUnbeeinflusst);

    // ── [J2] Konto-Charakter „Editor“ kommt herein, obwohl Editoren online
    //      sind, und `admin add Editor` trifft ihn (C1a) ──────────────────
    console.log('\n[J2] Konto-Charakter „Editor“, während Editor-Verbindungen online sind (C1a):');
    const editorKontoToken = await spieltoken('editorkonto');
    const kontoEditor = await verbinde('irrelevant', editorKontoToken);
    check('J2: Konto-Charakter „Editor“ kommt herein, obwohl Editoren online sind (C1a)', kontoEditor.angemeldet);
    const kontoEditorPeer = peerVon(kontoEditor);
    check('J2: er ist ein Nicht-Editor mit dem Namen „Editor“',
      !!kontoEditorPeer && !kontoEditorPeer.nurEditor && kontoEditorPeer.name === 'Editor');
    const editorAntwort2 = await admin(boss, 'admin add Editor');
    console.log(`    admin add Editor (Konto „Editor“ online) → ${editorAntwort2}`);
    check('J2: `admin add Editor` trifft jetzt den Konto-Charakter (C1a)',
      !!kontoEditorPeer && innen.adminListe.enthaelt(kontoEditorPeer.spielerId), editorAntwort2);

    // B2 (Nachbesserung Pruefung 4): `kick` soll wie `spielerIdFuerName`
    // und `spieler entfernen` die Editor-Peers nicht ueber den Namen
    // treffen. Reihenfolge 1: editor1/editor2 (nurEditor) sind schon
    // laenger verbunden als der Konto-Charakter „Editor“.
    const kickEditorAntwort1 = await admin(boss, 'kick editor');
    await warte(300);
    check('J2 (B2, Reihenfolge 1: Editor-Peers zuerst): `kick editor` trennt den Konto-Charakter, nicht die Editor-Peers',
      kontoEditor.geschlossen && !editor1.geschlossen && !editor2.geschlossen, kickEditorAntwort1);

    // A10 (Testluecke Pruefung 4, T3): "spieler entfernen editor" darf
    // Editor-Peers (editor1/editor2, noch online) nicht als "verbunden"
    // zaehlen — der Konto-Charakter „Editor“ ist gerade per kick offline
    // gegangen, sein Datensatz liegt noch in savedPlayers.
    const vorSpielerEntfernenEditor = innen.savedPlayers.size;
    const entfernenEditorAntwort = await admin(boss, 'spieler entfernen editor');
    console.log(`    spieler entfernen editor (Editor-Peers online) → ${entfernenEditorAntwort}`);
    check('A10: `spieler entfernen editor` loescht den (jetzt offline) Konto-Charakter trotz Editor-Peers online (D2)',
      entfernenEditorAntwort.includes('Entfernt: editor') && innen.savedPlayers.size === vorSpielerEntfernenEditor - 1,
      entfernenEditorAntwort);

    await trenne(editor1);
    await trenne(editor2);

    // Reihenfolge 2 (B2): Konto-Charakter zuerst, dann ein Editor-Peer.
    const editorKontoToken2 = await spieltoken('editorkonto');
    const kontoEditor2 = await verbinde('irrelevant', editorKontoToken2);
    check('J2 (B2, Reihenfolge 2): Konto-Charakter „Editor“ kommt erneut herein', kontoEditor2.angemeldet);
    const editor3 = await verbinde('Dritter', '', true);
    check('J2 (B2, Reihenfolge 2): ein Editor-Peer kommt an, waehrend der Konto-Charakter „Editor“ online ist', editor3.angemeldet);
    const kickEditorAntwort2 = await admin(boss, 'kick editor');
    await warte(300);
    check('J2 (B2, Reihenfolge 2: Konto-Charakter zuerst): `kick editor` trennt den Konto-Charakter, nicht den Editor-Peer',
      kontoEditor2.geschlossen && !editor3.geschlossen, kickEditorAntwort2);
    await trenne(editor3);

    // ── [K] `admin add` mit einer NFD-Eingabe trifft die NFC-Kennung (MN) ──
    console.log('\n[K] Admin-Namensauflösung mit einer NFD-Eingabe (MN):');
    const nfcName = 'Öyvind';
    const nfdName = 'O\u0308yvind';
    const nfdGast = await verbinde(nfcName, '');
    check('K: Gast mit NFC-geschriebenem Namen kommt herein (Kontrolle)', nfdGast.angemeldet);
    const nfdSpielerId = peerVon(nfdGast)!.spielerId;
    const nfdAntwort = await admin(boss, `admin add ${nfdName}`);
    console.log(`    admin add ${nfdName} (NFD) → ${nfdAntwort}`);
    check('K: `admin add` mit NFD-Eingabe trifft den NFC-benannten Peer (MN)',
      innen.adminListe.enthaelt(nfdSpielerId), nfdAntwort);
    await trenne(nfdGast);

    // ── [H] Zwei Gäste gleichen Namens: der Adminbefehl wählt nicht still ──
    console.log('\n[H] Zwei gespeicherte Gäste „Ole“:');
    const zweiOle = [...innen.savedPlayers.values()].filter((e) => e.name === 'Ole').length;
    check('H: es gibt zwei gespeicherte Stände „Ole“ (sonst beweist nichts etwas)', zweiOle === 2, String(zweiOle));
    const mehrdeutig = await admin(boss, 'admin add Ole');
    console.log(`    admin add Ole → ${mehrdeutig}`);
    check('H: admin add Ole meldet „nicht eindeutig“', mehrdeutig.includes('nicht eindeutig'), mehrdeutig);
    check('H: und macht niemanden zum Admin', !innen.adminListe.enthaelt(oleSpielerId) && !innen.adminListe.enthaelt(diebSpielerId));
    // C3: die Doppelnamen-Prüfung beim Anmelden vergleicht jetzt über
    // namenSchluessel statt exakt — „Kai“ und „kai“/„KAI “ stehen deshalb
    // nicht mehr gleichzeitig online (vorher, Pruefung 2 §3). Das macht die
    // Online-Mehrdeutigkeit in spielerIdFuerName für Nicht-Editoren
    // unerreichbar; die Ambiguität bei `admin add`/`spieler entfernen`
    // bleibt über gespeicherte Stände erhalten (Ole, oben/unten).
    const kai1 = await verbinde('Kai', '');
    check('H: „Kai“ kommt herein (Kontrolle)', kai1.angemeldet);
    const kai2 = await verbinde('kai', '');
    check('H: „kai“ (andere Schreibung) wird abgewiesen, solange „Kai“ online ist (C3)', !kai2.angemeldet);
    if (kai2.angemeldet) await trenne(kai2);
    const kai3 = await verbinde('KAI ', '');
    check('H: „KAI “ (groß + Leerzeichen) wird ebenfalls abgewiesen (C3)', !kai3.angemeldet);
    if (kai3.angemeldet) await trenne(kai3);
    await trenne(kai1);
    const eindeutig = await admin(boss, 'admin add Frischling');
    check('H: Kontrolle: ein eindeutiger Name geht', innen.adminListe.enthaelt(frischSpielerId), eindeutig);

    // ── [H2] `spieler entfernen` bei zwei gespeicherten Treffern (C5) ──
    console.log('\n[H2] `spieler entfernen Ole` bei zwei gespeicherten Ständen:');
    const vorEntfernen = innen.savedPlayers.size;
    const entfernenAntwort = await admin(boss, 'spieler entfernen Ole');
    console.log(`    spieler entfernen Ole → ${entfernenAntwort}`);
    check('H2: `spieler entfernen Ole` meldet „nicht eindeutig“ statt zu löschen',
      entfernenAntwort.includes('nicht eindeutig'), entfernenAntwort);
    check('H2: nichts wurde gelöscht (Zahl der Datensätze unverändert)',
      innen.savedPlayers.size === vorEntfernen, `${innen.savedPlayers.size} vs ${vorEntfernen}`);
    check('H2: beide „Ole“-Stände bleiben erhalten',
      [...innen.savedPlayers.values()].filter((e) => e.name === 'Ole').length === 2);

    // ── [H3] `spieler entfernen` mit einem Treffer, andere Schreibung (C5b/C5c) ──
    console.log('\n[H3] `spieler entfernen SVEN` (andere Schreibung), ein Treffer:');
    const sven = await verbinde('Sven', '');
    const svenSpielerId = peerVon(sven)!.spielerId;
    await trenne(sven);
    const vorSven = innen.savedPlayers.size;
    const svenAntwort = await admin(boss, 'spieler entfernen SVEN');
    console.log(`    spieler entfernen SVEN → ${svenAntwort}`);
    check('H3: `spieler entfernen SVEN` (Großschreibung) löscht den einen Treffer (C5b/C5c)',
      svenAntwort.includes('Entfernt') && !innen.savedPlayers.has(svenSpielerId) && innen.savedPlayers.size === vorSven - 1,
      `${svenAntwort} (${vorSven} → ${innen.savedPlayers.size})`);

    // ── [H4] `spieler entfernen` erkennt einen Online-Spieler auch in
    //      anderer Schreibung (D2) ──────────────────────────────────────
    // A11 (Testluecke Pruefung 4, T3): die Eingabe ist bewusst GROSS
    // geschrieben ("ULF") statt komplett klein — mit "ulf" ist der
    // Schluessel zufaellig gleich der Eingabe, und ein Mutant, der
    // `verbunden.has(name)` statt `verbunden.has(namenSchluessel(name))`
    // schreibt, faellt nicht auf. Mit "ULF" unterscheiden sich Eingabe
    // und Schluessel ("ulf"), der Mutant wird sichtbar.
    console.log('\n[H4] `spieler entfernen ULF` bei online „Ulf“ (D2/A11):');
    const ulf = await verbinde('Ulf', '');
    check('H4: „Ulf“ online (Kontrolle)', ulf.angemeldet);
    const vorUlf = innen.savedPlayers.size;
    const ulfAntwort = await admin(boss, 'spieler entfernen ULF');
    console.log(`    spieler entfernen ULF → ${ulfAntwort}`);
    check('H4: `spieler entfernen ULF` erkennt den online „Ulf“ trotz anderer Schreibung (verbunden) (D2/A11)',
      ulfAntwort.includes('verbunden'), ulfAntwort);
    check('H4: kein Datensatz wurde gelöscht', innen.savedPlayers.size === vorUlf, `${vorUlf} → ${innen.savedPlayers.size}`);
    await trenne(ulf);

    // ── [H5] `kick` mit anderer Schreibung (C3) ──────────────────────────
    console.log('\n[H5] `kick` erkennt eine andere Schreibung (C3):');
    const wanda = await verbinde('Wanda', '');
    check('H5: „Wanda“ online (Kontrolle)', wanda.angemeldet);
    const kickAntwort = await admin(boss, 'kick WANDA');
    await bis(() => wanda.geschlossen, 3_000);
    check('H5: `kick WANDA` (andere Schreibung) trennt „Wanda“ (C3)', wanda.geschlossen, kickAntwort);

    // ── [H6] B1: ein Admin trifft sich per `kick` nicht selbst, auch nicht
    //      unter anderer Schreibung (Regression aus C3) ──────────────────
    console.log('\n[H6] `kick BOSS` (eigener Name, andere Schreibung) trifft den Admin selbst nicht (B1):');
    const kickSelbstAntwort = await admin(boss, 'kick BOSS');
    check('H6: `kick BOSS` wird abgelehnt (Selbstschutz, B1)',
      kickSelbstAntwort.includes('Dich selbst'), kickSelbstAntwort);
    check('H6: Boss bleibt verbunden', !boss.geschlossen);

    // C3 fuer `bann herkunft` (WovServer.ts ~5007, derselbe Umbau wie bei
    // `kick`) bekommt HIER bewusst KEINE eigene Live-Probe: Alle Testclients
    // in dieser Datei verbinden von 127.0.0.1, ein echter `bann herkunft`
    // wuerde also nicht nur das Ziel treffen, sondern JEDE offene Verbindung
    // (inklusive `boss`, ueber den `admin()` laeuft) -- genau die Falle, die
    // Pruefung 2 mit `bann herkunft Kai` in der eigenen Probe schon einmal
    // ausgeloest hat ("bannt 127.0.0.1"). Der Codepfad ist zeilengleich mit
    // `kick` (H5/H6 oben); B1 (Selbstschutz) und A8 (bann-herkunft-Suche
    // exakt statt normalisiert) werden deshalb live in
    // server/test/adminbefehle-bann.ts geprueft, wo jede Verbindung ihre
    // eigene, per X-Forwarded-For vorgetaeuschte Herkunft bekommt.

    // ── [I] Namensformen ────────────────────────────────────────────
    console.log('\n[I] Namen mit Steuerzeichen und andere Schreibweisen eines Kontonamens:');
    for (const [was, name] of [
      ['Anna mit Nullbreite', 'Anna\u200b'],
      ['Ole mit Nullbreite', 'Ol\u200be'],
      ['Björn zerlegt (NFD)', 'Bjo\u0308rn'],
      ['BJÖRN groß', 'BJÖRN'],
      ['bjÖrn gemischt', 'bjÖrn'],
      // B3 (Nachbesserung Pruefung 4, A9): \p{Default_Ignorable_Code_Point}
      // deckt mehr ab als die alte feste Sechserliste — diese vier kamen in
      // Pruefung 4 noch durch (§2.3) und liessen "Anna"/"Editor" mit einem
      // unsichtbaren Anhaengsel wie das Original bzw. den reservierten
      // Namen aussehen.
      ['Anna mit Variantenselektor (VS16, U+FE0F)', 'Anna\uFE0F'],
      ['Anna mit Variantenselektor (VS17+, U+E0100)', 'Anna\u{E0100}'],
      ['Anna mit Khmer-Unsichtbarem (U+17B4)', 'Anna\u17B4'],
      ['Editor mit Variantenselektor (VS16, U+FE0F)', 'Editor\uFE0F'],
    ] as const) {
      const g = await verbinde(name, '');
      check(`I: ${was} wird abgewiesen`, !g.angemeldet);
      if (g.angemeldet) await trenne(g);
    }
    const bjoern = await verbinde('Bjoern', '');
    check('I: Kontrolle: „Bjoern“ (anderer Name) geht', bjoern.angemeldet);
    await trenne(bjoern);

    // ── [I2] Echte Namen mit Sonderzeichen bleiben erlaubt (Gegenprobe zu
    //      B3/A9) ────────────────────────────────────────────────────────
    console.log('\n[I2] Echte Namen mit Sonderzeichen werden zugelassen:');
    for (const [was, name] of [
      ['Koreanisch (Hangul)', '민준'],
      ['Zoë in NFD (e + combining diaeresis)', 'Zoe\u0308'],
      ['Braille außer dem Blank-Zeichen (kein U+2800)', '\u2801\u2803\u2807'],
    ] as const) {
      const g = await verbinde(name, '');
      check(`I2: ${was} wird zugelassen`, g.angemeldet);
      if (g.angemeldet) await trenne(g);
    }
  } finally {
    server.stop();
    rmSync(ordner, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nalles ok' : `\n${fehler} FEHLER`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
