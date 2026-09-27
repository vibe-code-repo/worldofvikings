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
 *  [H] Zwei gespeicherte Gaeste gleichen Namens: `admin add` meldet
 *      „nicht eindeutig“ und tut nichts.
 *  [H2] Dieselben zwei Staende: `spieler entfernen Ole` meldet „nicht
 *      eindeutig“ und loescht nichts (C5).
 *  [I] Namen mit Steuer-/Nullbreiten-Zeichen und andere Schreibweisen eines
 *      Kontonamens (NFD, Grossbuchstaben mit Umlaut) werden abgewiesen.
 *  [J] Der Name "Editor" ist fuer Gaeste reserviert (auch waehrend ein
 *      Editor online ist); ein zweiter Editor bleibt moeglich; `admin add
 *      Editor` trifft keinen Editor-Peer; ein Konto mit anderem Namen bleibt
 *      unbeeinflusst.
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
}

/** Verbinden wie der Browser: `token` leer = kein Token im localStorage. */
function verbinde(name: string, token: string, nurEditor = false): Promise<Klient> {
  return new Promise((fertig, scheitern) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
    const k: Klient = { ws, angemeldet: false, userId: '', token: '', geschlossen: false, chats: [], antworten: [] };
    let authGesendet = false;
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Handshake ueberfaellig`)), 15_000);
    const schluss = (): void => { clearTimeout(uhr); fertig(k); };
    ws.on('close', () => { k.geschlossen = true; schluss(); });
    ws.on('error', schluss);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
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
    await trenne(editor1);
    await trenne(editor2);

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
    const kai1 = await verbinde('Kai', '');
    const kai2 = await verbinde('kai', '');
    check('H: zwei online Gäste „Kai“/„kai“ (sonst beweist nichts etwas)', kai1.angemeldet && kai2.angemeldet);
    const kaiAntwort = await admin(boss, 'admin add KAI');
    check('H: admin add KAI (zwei online) meldet „nicht eindeutig“ und tut nichts',
      kaiAntwort.includes('nicht eindeutig') && !innen.adminListe.enthaelt(peerVon(kai1)!.spielerId) && !innen.adminListe.enthaelt(peerVon(kai2)!.spielerId), kaiAntwort);
    await trenne(kai1);
    await trenne(kai2);
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

    // ── [I] Namensformen ────────────────────────────────────────────
    console.log('\n[I] Namen mit Steuerzeichen und andere Schreibweisen eines Kontonamens:');
    for (const [was, name] of [
      ['Anna mit Nullbreite', 'Anna\u200b'],
      ['Ole mit Nullbreite', 'Ol\u200be'],
      ['Björn zerlegt (NFD)', 'Bjo\u0308rn'],
      ['BJÖRN groß', 'BJÖRN'],
      ['bjÖrn gemischt', 'bjÖrn'],
    ] as const) {
      const g = await verbinde(name, '');
      check(`I: ${was} wird abgewiesen`, !g.angemeldet);
      if (g.angemeldet) await trenne(g);
    }
    const bjoern = await verbinde('Bjoern', '');
    check('I: Kontrolle: „Bjoern“ (anderer Name) geht', bjoern.angemeldet);
    await trenne(bjoern);
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
