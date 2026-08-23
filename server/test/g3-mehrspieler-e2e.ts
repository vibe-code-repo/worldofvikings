/**
 * G3 — Mehrspieler-E2E: die bislang fehlende Testluecke "kein einziger
 * Test mit zwei gleichzeitigen Clients". Faehrt echte WebSocket-
 * Verbindungen (Muster server/test/f3-einbau.ts, g6-dungeon-e2e.ts,
 * f1-truhe.ts, g7-zdo-interessen.ts) gegen einen ECHTEN WovServer:
 * echter Handshake ueber `antwortBerechnen`, echte Writer/Reader aus
 * server/src/io/, und fuer ZDO-Sichtbarkeit der echte Client-Parser
 * `parseZDOSync`/`ZDOSpiegel` aus client/src/net/ZDOSync.ts — kein
 * einziges der geprueften Verhalten wird hier nachgebaut.
 *
 * Deckt die geforderte Liste:
 *  1. Gegenseitige Sichtbarkeit: zwei Peers in Reichweite (256 m,
 *     WovServer.SICHT_RADIUS_ZONEN) sehen einander, ein weit entfernter
 *     Peer sieht sie nicht und wird nicht gesehen.
 *  2. Chat mit Reichweite (F14): Whisper 12 m, Normal 64 m, Rufen 256 m
 *     — ueber ECHTE ChatMessage-Pakete an mehrere echte Peers in
 *     kontrollierten Abstaenden (f14-chat-reichweite.ts haelt nur die
 *     REINE Auswahlfunktion fest, nicht den verdrahteten Zustand).
 *  3. Gleichzeitiges Bauen am selben Ort: Ist-Zustand festgehalten, auch
 *     wenn er unschoen ist (s. Kommentar bei testGleichzeitigesBauen).
 *  4. Truhe zu zweit (F1): gleichzeitig denselben Stapel nehmen — in
 *     Summe entsteht NICHTS (handleContainerAction laeuft synchron zu
 *     Ende, kein `await` zwischen Lesen und Schreiben, s. Kopfkommentar
 *     dort).
 *  5. Ein Peer geht: der andere merkt es (ZDO-Zerstoerung), Drossel- und
 *     Peer-Zustand werden aufgeraeumt.
 *
 * ── Unerwarteter Befund (Punkt 1, kein Bestandteil der Pruefliste) ───
 * Beim Schreiben dieses Tests fiel auf: Verlaesst ein ZDO das Sicht-
 * fenster eines Peers, OHNE zerstoert zu werden (ein Spieler LAEUFT weg,
 * bleibt aber verbunden), bekommt der Peer NIE eine Abmeldung. Details
 * und Fundstellen bei testSichtbarkeit() unten — dort auch als
 * (bewusst so benannte) BEFUND-Pruefung festgehalten, die den IST-
 * Zustand zusichert, nicht den WUENSCHENSWERTEN.
 *
 * ── Ports ──────────────────────────────────────────────────────────
 * 2496-2502, 2510-2514, 2517, 2551-2553 sind laut Kopfkommentaren der
 * bestehenden Tests belegt. Dieser Test benutzt 2560-2564 (eigener
 * Serverstart je Unterfall, s. Begruendung bei f1-truhe.ts: eigene
 * WORLDS_DIR pro Lauf statt eines gemeinsamen Servers haelt die fuenf
 * Szenarien unabhaengig voneinander).
 *
 * ── Warum dieser Test KEINE festen Wartezeiten mehr hat (23.08.2026) ──
 * Der Test war im Sammellauf (`npm test`, mehrere Server auf eigenen
 * Ports, 2 vCPUs) sporadisch rot und einzeln immer gruen. Ursache war
 * NICHT "zu kurz gewartet", sondern eine Wettlaufsituation gegen den
 * 50-ms-ZDO-Takt des Servers (ZDO_SEND_INTERVAL_MS):
 *
 *  (a) `verbinde()` haengte die Mitschnitte erst AN, nachdem der
 *      Handshake schon durch war. Faellt ein Takt in diese Luecke,
 *      verpasst der Test den VOLLSTAND eines ZDO. Alles Weitere kommt
 *      danach nur noch als Delta, und der echte Client-Parser verwirft
 *      Deltas ohne Vollstand zu Recht ("[ZDOSync] Delta ohne Vollstand
 *      … verworfen", client/src/net/ZDOSync.ts) — der Peer taucht dann
 *      NIE im Spiegel auf, auch nach beliebig langem Warten nicht.
 *      Gegenmittel: die Mitschnitte haengen jetzt am Socket, BEVOR der
 *      Handshake beginnt (s. verbinde() unten). Genau das tut der echte
 *      Client auch — die Invariante des Parsers ist damit eingehalten
 *      statt zufaellig getroffen.
 *
 *  (b) Alle Peers spawnen am selben Weltspawn. Faellt ein Takt zwischen
 *      Anmeldung und Verarbeitung des `teleport`-Befehls, sehen sich
 *      Peers, die der Test danach als "weit auseinander" prueft — und
 *      weil ein Sichtfenster-AUSTRITT keine Abmeldung schickt (der
 *      BEFUND unten!), bleibt diese Sichtung fuer immer stehen. Eine
 *      laengere Wartezeit haette daran nichts geaendert, sie macht das
 *      Fenster nur groesser. Gegenmittel: der weit entfernte Peer wird
 *      verbunden und weggeschickt, BEVOR die nahen Peers ueberhaupt
 *      eine Verbindung haben (s. testSichtbarkeit) — dann gibt es die
 *      Ueberlappung gar nicht erst, unabhaengig von jedem Takt.
 *
 * Daraus die Regel fuer diese Datei: NIE auf eine Zeitspanne warten,
 * immer auf einen ZEUGEN (`verlangeAuf`). Fuer Abwesenheitspruefungen
 * ("X darf NICHT ankommen") reicht das allein nicht — dort steht
 * jeweils ein spaeterer, garantiert ankommender Zeuge ueber demselben
 * Socket bzw. demselben Sync-Takt, hinter dem eine frueher gesendete
 * Nachricht zwingend schon sichtbar waere. Begruendung an der jeweiligen
 * Stelle.
 *
 * Run: npx tsx server/test/g3-mehrspieler-e2e.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import {
  ChatMsgType,
  getStableHash,
  findItem,
  neueTruheInventory,
  packContainer,
  unpackContainer,
  TRUHE_INHALT_MEMBER,
  type Vector3,
  type Quaternion,
} from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { BinaryReader } from '../../client/src/net/GameSocket';
import { parseZDOSync, ZDOSpiegel } from '../../client/src/net/ZDOSync';
import type { Drossel } from '../src/net/Drossel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g3-mehrspieler-e2e');
rmSync(WORLDS_DIR, { recursive: true, force: true });

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  ZDOSync: 10,
  PlayerState: 41,
  ChatMessage: 42,
  InteractResult: 45,
  PlacePiece: 55,
  AdminCommand: 53,
  ContainerAction: 69,
  AuthChallenge: 68,
};

const IDENTITAET: Quaternion = { x: 0, y: 0, z: 0, w: 1 };

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Auf eine Bedingung POLLEN statt eine feste Wartezeit zu verstreichen zu
 * lassen. Kehrt zurueck, sobald `bedingung()` wahr wird, spaetestens nach
 * `timeoutMs` — dann bleibt das Ergebnis false.
 *
 * Fuer alles, was der Test danach prueft, gilt `verlangeAuf` (darunter):
 * Ein abgelaufener Zeuge ist ein Fehler, kein "vielleicht war es zu
 * knapp". Ein stiller Timeout wuerde die eigentliche Pruefung darunter
 * zu einer Aussage ueber die Maschinenlast machen statt ueber den Server.
 */
async function warteAuf(bedingung: () => boolean, timeoutMs = 10_000, intervallMs = 10): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (bedingung()) return true;
    if (Date.now() - start >= timeoutMs) return bedingung();
    await warte(intervallMs);
  }
}

/**
 * Wie `warteAuf`, meldet einen abgelaufenen Zeugen aber selbst als
 * Fehlschlag — mit Namen. Damit steht im Protokoll, WELCHER Zeuge
 * ausgeblieben ist, statt dass eine unschuldige Pruefung weiter unten
 * dafuer den Kopf hinhaelt.
 */
async function verlangeAuf(was: string, bedingung: () => boolean, timeoutMs = 10_000): Promise<void> {
  if (!(await warteAuf(bedingung, timeoutMs))) {
    check(`Zeuge ausgeblieben: ${was}`, false, `nach ${timeoutMs} ms`);
  }
}

/** Positionsvergleich mit Toleranz — Bodenhoehe/Rundung sind hier egal. */
function nahe(ist: number, soll: number, toleranz = 1): boolean {
  return Math.abs(ist - soll) < toleranz;
}

// ── Draht-Hilfsfunktionen (Muster server/test/g7-bauen.ts / g7-zdo-interessen.ts) ──

/**
 * Ein verbundener Testclient mit BEREITS LAUFENDEN Mitschnitten.
 *
 * Entscheidend ist der Zeitpunkt, zu dem die Mitschnitte am Socket
 * haengen: vor dem ersten empfangenen Byte, nicht erst nach dem
 * Handshake (s. Kopfkommentar (a) — das war die Ursache der
 * Sammellauf-Flakes). Der echte Client verdrahtet seinen ZDOSync-Pfad
 * ebenfalls beim Aufbau des Sockets; ein Test, der spaeter einhaengt,
 * prueft eine Lage, die es im Betrieb gar nicht gibt.
 */
interface Testclient {
  name: string;
  ws: WebSocket;
  /** ZDO-Sichtbarkeit ueber den ECHTEN Client-Parser (Muster g7-zdo-interessen.ts). */
  sichtbar: Set<string>;
  spiegel: ZDOSpiegel;
  jemalsZerstoert: Set<string>;
  chats: ChatMsg[];
  interact: InteractResultMsg[];
}

function verbinde(name: string, port: number): Promise<Testclient> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.binaryType = 'nodebuffer';

    const klient: Testclient = {
      name,
      ws,
      sichtbar: new Set<string>(),
      spiegel: new ZDOSpiegel(),
      jemalsZerstoert: new Set<string>(),
      chats: [],
      interact: [],
    };

    // ── Mitschnitt ZUERST anhaengen ────────────────────────────────────
    // Vor `ws.on('error')` und vor jeder Handshake-Antwort: `new
    // WebSocket()` verbindet asynchron, es kann bis zum Ende dieses
    // Konstruktors kein Paket eintreffen — ab hier ist also LUECKENLOS
    // mitgeschnitten. Alles Weitere (Handshake) haengt darunter.
    ws.on('message', (data: Buffer) => {
      const typ = data.readUInt8(0);
      if (typ === P.ZDOSync) {
        const reader = new BinaryReader(data.buffer, data.byteOffset + 1);
        const { updates, destroyed } = parseZDOSync(reader, '', klient.spiegel);
        for (const u of updates) klient.sichtbar.add(u.key);
        for (const k of destroyed) {
          klient.sichtbar.delete(k);
          klient.jemalsZerstoert.add(k);
        }
      } else if (typ === P.ChatMessage) {
        const reader = new Reader(Buffer.from(data.subarray(1)));
        klient.chats.push({
          senderId: reader.readString(),
          senderName: reader.readString(),
          typ: reader.readInt32(),
          text: reader.readString(),
        });
      } else if (typ === P.InteractResult) {
        const reader = new Reader(Buffer.from(data.subarray(1)));
        klient.interact.push({
          ok: reader.readBool(),
          message: reader.readString(),
          itemName: reader.readString(),
          amount: reader.readInt32(),
        });
      }
    });

    let authSent = false;
    const timeout = setTimeout(() => reject(new Error(`Timeout beim Handshake fuer "${name}"`)), 8000);
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      const reader = new Reader(Buffer.from(data.subarray(1)));
      if (type === P.VersionCheck) {
        ws.send(Buffer.concat([Buffer.from([P.VersionCheck]), new Writer().writeInt32(2).toBuffer()]));
      } else if (type === P.AuthChallenge) {
        if (authSent) return;
        authSent = true;
        const nonce = reader.readString();
        const antwort = antwortBerechnen(nonce, '');
        const w = new Writer();
        w.writeString(antwort);
        w.writeString(name);
        w.writeString('');
        ws.send(Buffer.concat([Buffer.from([P.PasswordAuth]), w.toBuffer()]));
      } else if (type === P.PeerInfo) {
        clearTimeout(timeout);
        resolvePromise(klient);
      }
    });
    ws.on('error', reject);
  });
}

interface ChatMsg {
  senderId: string;
  senderName: string;
  typ: number;
  text: string;
}

interface InteractResultMsg {
  ok: boolean;
  message: string;
  itemName: string;
  amount: number;
}

function sendAdmin(k: Testclient, line: string): void {
  const w = new Writer();
  w.writeString(line);
  k.ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

function sendChat(k: Testclient, chatType: number, text: string): void {
  const w = new Writer();
  w.writeInt32(chatType);
  w.writeString(text);
  k.ws.send(Buffer.concat([Buffer.from([P.ChatMessage]), w.toBuffer()]));
}

function sendPlacePiece(k: Testclient, prefabHash: number, pos: Vector3): void {
  const w = new Writer();
  w.writeInt32(prefabHash);
  w.writeVector3(pos);
  w.writeQuaternion(IDENTITAET);
  k.ws.send(Buffer.concat([Buffer.from([P.PlacePiece]), w.toBuffer()]));
}

function sendContainerAction(
  k: Testclient,
  zdoUserId: string,
  zdoId: number,
  richtung: 0 | 1,
  itemName: string,
  amount: number
): void {
  const w = new Writer();
  w.writeString(zdoUserId);
  w.writeInt32(zdoId);
  w.writeInt32(richtung);
  w.writeString(itemName);
  w.writeInt32(amount);
  k.ws.send(Buffer.concat([Buffer.from([P.ContainerAction]), w.toBuffer()]));
}

/**
 * Peer server-seitig nachschlagen. Bewusst bei JEDEM Aufruf neu suchen
 * statt die Referenz festzuhalten: Sonst pollt man auf einem Objekt, das
 * der Server nach einem Reconnect laengst ersetzt hat.
 */
function peerVon(server: ReturnType<typeof createWovServer>, name: string) {
  return server.net.getPeers().find((p) => p.name === name);
}

/**
 * Verbinden, wegteleportieren und ERST ZURUECKKEHREN, wenn der Server
 * die neue Position wirklich uebernommen hat. Der Zeuge ist der
 * In-Prozess-Zustand des Servers (kein Netz-Umweg) — er sagt genau das
 * aus, was die nachfolgenden Pruefungen voraussetzen, und ist damit
 * unabhaengig von Maschinenlast und Sync-Takt.
 */
async function verbindeUndStelle(
  server: ReturnType<typeof createWovServer>,
  name: string,
  port: number,
  x: number,
  z: number
): Promise<Testclient> {
  const k = await verbinde(name, port);
  sendAdmin(k, `teleport ${x} ${z}`);
  await verlangeAuf(`${name} steht server-seitig bei (${x}, ${z})`, () => {
    const p = peerVon(server, name);
    return !!p && nahe(p.position.x, x) && nahe(p.position.z, z);
  });
  return k;
}

// ── [1] Gegenseitige Sichtbarkeit ─────────────────────────────────────

async function testSichtbarkeit(): Promise<void> {
  console.log('\n[1] Gegenseitige Sichtbarkeit:');
  const PORT = 2560;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g3-sichtbarkeit', saveIntervalMs: 3600_000 });
  server.start();
  try {
    // ── Reihenfolge ist hier die eigentliche Zusicherung ──────────────
    // ALLE Peers spawnen am selben Weltspawn. Verbaende man Conna
    // gleichzeitig mit Anna und Bjorn, waeren die drei fuer die Dauer
    // eines Sync-Takts (50 ms) nachweislich in Sichtweite — und weil ein
    // Sichtfenster-AUSTRITT keine Abmeldung schickt (BEFUND weiter
    // unten), bliebe diese Sichtung fuer immer im Spiegel stehen. Die
    // "sieht NICHT"-Pruefungen waeren dann nicht schwer zu treffen,
    // sondern schlicht falsch — sie haengen davon ab, wohin der 50-ms-
    // Takt zufaellig faellt. Deshalb: Conna verbindet ZUERST und ist
    // nachweislich weg (Server-Position bestaetigt), BEVOR Anna und
    // Bjorn ueberhaupt eine Verbindung haben. Damit gibt es die
    // Ueberlappung gar nicht, statt dass auf ihr Ausbleiben gehofft wird.
    const conna = await verbindeUndStelle(server, 'Conna', PORT, 3000, 3000);
    const anna = await verbindeUndStelle(server, 'Anna', PORT, 0, 0);
    const bjorn = await verbindeUndStelle(server, 'Bjorn', PORT, 30, 30); // ~42 m von Anna

    const keyAnna = peerVon(server, 'Anna')!.characterID.toString();
    const keyBjorn = peerVon(server, 'Bjorn')!.characterID.toString();
    const keyConna = peerVon(server, 'Conna')!.characterID.toString();

    // Auf den TATSAECHLICH erwarteten Zustand warten — nicht bloss auf
    // "Schluessel ist irgendwann mal aufgetaucht". Der Unterschied ist
    // nicht kosmetisch: Ein Spiegelstand vom Spawn wuerde die blosse
    // Anwesenheitsbedingung sofort erfuellen und die Vorbedingung der
    // BEFUND-Pruefung unten (Bjorn bei 30/30) still unterlaufen.
    await verlangeAuf(
      'Annas Spiegel kennt Bjorn bei (30, 30)',
      () => {
        const b = anna.spiegel.hole(keyBjorn);
        return !!b && nahe(b.position.x, 30) && nahe(b.position.z, 30);
      }
    );
    await verlangeAuf(
      'Bjorns Spiegel kennt Anna bei (0, 0)',
      () => {
        const a = bjorn.spiegel.hole(keyAnna);
        return !!a && nahe(a.position.x, 0) && nahe(a.position.z, 0);
      }
    );

    check('Anna sieht Bjorn (in Reichweite)', anna.sichtbar.has(keyBjorn));
    check('Bjorn sieht Anna (in Reichweite)', bjorn.sichtbar.has(keyAnna));
    check('Anna sieht Conna NICHT (weit weg)', !anna.sichtbar.has(keyConna));
    check('Bjorn sieht Conna NICHT (weit weg)', !bjorn.sichtbar.has(keyConna));
    check(
      'Conna sieht weder Anna noch Bjorn (selbst weit weg)',
      !conna.sichtbar.has(keyAnna) && !conna.sichtbar.has(keyBjorn)
    );

    // ── BEFUND (kein Bestandteil der Pruefliste, beim Schreiben dieses
    // Tests entdeckt) ────────────────────────────────────────────────
    // server/src/WovServer.ts syncZDOs() speist die "zerstoerungen", die
    // an einen Peer gehen, AUSSCHLIESSLICH aus der globalen Zerstoerungs-
    // liste (this.zdos.consumeDestroyList() — echtes ZDO-Loeschen).
    // Verlaesst ein ZDO nur das SICHTFENSTER eines Peers (ZonenFenster.
    // hole() liefert es beim naechsten Aufbau schlicht nicht mehr mit),
    // geschieht NICHTS weiter: peer.removeKnownZDO() wird nur im
    // Zerstoerungszweig gerufen (server/src/WovServer.ts, Zeile ~975),
    // nirgends sonst. Der dafuer vorgesehene Mechanismus existiert zwar
    // im Peer (server/src/net/Peer.ts: invalidateSector()/
    // invalidSectors, 1:1-Port von C++ m_invalidSector), wird aber im
    // GANZEN Projekt nirgends aufgerufen — toter Code.
    //
    // Folge: Ein Spieler, der wegspaziert (statt die Verbindung zu
    // trennen — DAS ist Punkt 5 unten und funktioniert korrekt, weil
    // onPeerQuit das Charakter-ZDO wirklich zerstoert), bleibt bei jedem
    // Peer, der ihn zuletzt gesehen hat, als EINGEFRORENER GEIST an der
    // letzten bekannten Position stehen — beliebig lange, bis (falls
    // ueberhaupt) eine spaetere Annaeherung das ZDO wieder ins Fenster
    // bringt. Das betrifft nicht nur Spieler, sondern jedes ZDO, das
    // sich aus einem Sichtfenster herausbewegt (z. B. eine Kreatur).
    //
    // Die folgende Pruefung haelt GENAU das fest — den IST-, nicht den
    // Soll-Zustand (Auftrag: "Halte den Ist-Zustand fest, auch wenn er
    // unschoen ist").
    console.log('\n  BEFUND — Sichtfenster-Austritt ohne Abmeldung:');
    const bjornVorher = anna.spiegel.hole(keyBjorn);
    check(
      'Vorbedingung: Anna kennt Bjorns Position bei ca. (30, 30)',
      !!bjornVorher && nahe(bjornVorher.position.x, 30) && nahe(bjornVorher.position.z, 30),
      JSON.stringify(bjornVorher?.position)
    );

    sendAdmin(bjorn, 'teleport 3000 3000');
    await verlangeAuf('Bjorn steht server-seitig bei (3000, 3000)', () => {
      const p = peerVon(server, 'Bjorn');
      return !!p && nahe(p.position.x, 3000);
    });

    // ── Zeuge fuer eine ABWESENHEIT ───────────────────────────────────
    // Die Pruefung darunter behauptet, dass bei Anna NICHTS ankommt. Ein
    // fester Schlaf (frueher 500 ms) kann das nie belegen — er kann nur
    // zu kurz sein. Der Zeuge ist stattdessen Conna: Bjorn ist eben auf
    // Connas Position (3000, 3000) teleportiert und betritt damit deren
    // Sichtfenster. Sobald Connas Spiegel Bjorn dort kennt, hat
    // syncZDOs() nachweislich einen Takt MIT Bjorns neuer Revision zu
    // Ende gefahren — und in genau diesem synchronen Durchlauf wurde
    // auch Anna bedient (die Peer-Schleife in WovServer.syncZDOs laeuft
    // ohne `await`). Bleibt Annas Stand danach alt, ist das kein
    // "noch nicht angekommen", sondern die Aussage des Befunds.
    await verlangeAuf('Conna sieht Bjorn nach dessen Teleport in ihr Fenster', () => {
      const b = conna.spiegel.hole(keyBjorn);
      return !!b && nahe(b.position.x, 3000) && nahe(b.position.z, 3000);
    });

    const peerBjornNachher = peerVon(server, 'Bjorn')!;
    check(
      'Bjorns ECHTE Serverposition ist jetzt weit weg',
      nahe(peerBjornNachher.position.x, 3000),
      JSON.stringify(peerBjornNachher.position)
    );
    const bjornNachher = anna.spiegel.hole(keyBjorn);
    check(
      'BEFUND: Anna bekommt weder ein Update noch eine Abmeldung — ihr Stand bleibt bei (30, 30), ein eingefrorener Geist statt eines verschwundenen Spielers',
      !!bjornNachher && nahe(bjornNachher.position.x, 30) && nahe(bjornNachher.position.z, 30),
      `Annas Stand: ${JSON.stringify(bjornNachher?.position)}, echte Position: ${JSON.stringify(peerBjornNachher.position)}`
    );
    check('BEFUND: kein Zerstoerungspaket fuer Bjorn kam bei Anna an', !anna.jemalsZerstoert.has(keyBjorn));

    for (const k of [anna, bjorn, conna]) k.ws.close();
  } finally {
    server.stop();
  }
}

// ── [2] Chat mit Reichweite ────────────────────────────────────────────

async function testChatReichweite(): Promise<void> {
  console.log('\n[2] Chat mit Reichweite (F14) — ueber echte Pakete an fuenf echte Peers:');
  const PORT = 2561;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g3-chat', saveIntervalMs: 3600_000 });
  server.start();
  try {
    const sender = await verbindeUndStelle(server, 'Sender', PORT, 0, 0);
    const nah = await verbindeUndStelle(server, 'Nah', PORT, 10, 0);
    const mittel = await verbindeUndStelle(server, 'Mittel', PORT, 50, 0);
    const weit = await verbindeUndStelle(server, 'Weit', PORT, 200, 0);
    const sehrWeit = await verbindeUndStelle(server, 'SehrWeit', PORT, 300, 0);

    const hat = (k: Testclient, text: string) => k.chats.some((c) => c.text === text);

    // Abstand zwischen den ChatMessage-Paketen bewusst > 300 ms: Die
    // Drossel (A4, server/src/net/Drossel.ts) fuehrt ChatMessage mit
    // Eimergroesse 1 / Fuellrate 1 Token je 0,3 s. Das ist die EINZIGE
    // feste Wartezeit, die in dieser Datei bleiben darf, und sie ist
    // keine Zustellungswette: Der Eimer fuellt sich nach WANDUHR, nicht
    // nach CPU-Zeit. Unter Last dauert dieser Schlaf hoechstens laenger
    // — nie kuerzer — der Token ist also immer da. Die Drosselung selbst
    // prueft server/test/g7-drossel-einbau.ts; hier soll sie bloss nicht
    // querschiessen.
    const CHAT_TOKEN_MS = 500;

    // [a] Whisper (12 m): Sender (Absender sieht sich immer selbst) + Nah.
    sendChat(sender, ChatMsgType.Whisper, 'psst');
    await verlangeAuf('Whisper erreicht Sender und Nah', () => hat(sender, 'psst') && hat(nah, 'psst'));
    await warte(CHAT_TOKEN_MS);

    // [b] Normal (64 m): + Mittel.
    sendChat(sender, ChatMsgType.Normal, 'hallo');
    await verlangeAuf(
      'Normal erreicht Sender, Nah und Mittel',
      () => hat(sender, 'hallo') && hat(nah, 'hallo') && hat(mittel, 'hallo')
    );
    await warte(CHAT_TOKEN_MS);

    // [c] Shout (256 m): + Weit, aber nicht SehrWeit (300 m > 256 m).
    sendChat(sender, ChatMsgType.Shout, 'HOI');
    await verlangeAuf(
      'Shout erreicht Sender, Nah, Mittel und Weit',
      () => hat(sender, 'HOI') && hat(nah, 'HOI') && hat(mittel, 'HOI') && hat(weit, 'HOI')
    );
    await warte(CHAT_TOKEN_MS);

    // ── Zeuge fuer die ABWESENHEITEN ──────────────────────────────────
    // Alle Pruefungen unten mit "bekommt sie NICHT" behaupten, dass ein
    // Paket AUSBLEIBT. Ein Schlaf kann das nicht belegen (er kann nur zu
    // kurz sein) — ein spaeteres Paket ueber DENSELBEN Socket schon:
    // WebSocket-Nachrichten kommen je Verbindung in Sendereihenfolge an.
    // Ist die Marke da, waere jede frueher an denselben Peer gesendete
    // Nachricht zwingend schon davor im Protokoll.
    //
    // Nah, Mittel und Weit haben mit 'HOI' bereits so eine Marke.
    // SehrWeit hat noch gar nichts bekommen — deshalb wird SehrWeit
    // eigens in Reichweite geholt und bekommt eine letzte Marke.
    sendAdmin(sehrWeit, 'teleport 10 0');
    await verlangeAuf('SehrWeit steht server-seitig bei (10, 0)', () => {
      const p = peerVon(server, 'SehrWeit');
      return !!p && nahe(p.position.x, 10);
    });
    sendChat(sender, ChatMsgType.Shout, 'MARKE');
    await verlangeAuf('Marke erreicht SehrWeit', () => hat(sehrWeit, 'MARKE'));

    check('Whisper: Sender bekommt die eigene Nachricht', hat(sender, 'psst'));
    check('Whisper: Nah (10 m) bekommt sie', hat(nah, 'psst'));
    check('Whisper: Mittel (50 m) bekommt sie NICHT', !hat(mittel, 'psst'));
    check('Whisper: Weit (200 m) bekommt sie NICHT', !hat(weit, 'psst'));
    check('Whisper: SehrWeit (300 m) bekommt sie NICHT', !hat(sehrWeit, 'psst'));

    check(
      'Normal: Sender + Nah + Mittel bekommen sie',
      hat(sender, 'hallo') && hat(nah, 'hallo') && hat(mittel, 'hallo')
    );
    check('Normal: Weit (200 m) bekommt sie NICHT', !hat(weit, 'hallo'));
    check('Normal: SehrWeit (300 m) bekommt sie NICHT', !hat(sehrWeit, 'hallo'));

    check(
      'Shout: Sender + Nah + Mittel + Weit bekommen sie',
      hat(sender, 'HOI') && hat(nah, 'HOI') && hat(mittel, 'HOI') && hat(weit, 'HOI')
    );
    check('Shout: SehrWeit (300 m) bekommt sie NICHT (ausserhalb 256 m)', !hat(sehrWeit, 'HOI'));

    for (const k of [sender, nah, mittel, weit, sehrWeit]) k.ws.close();
  } finally {
    server.stop();
  }
}

// ── [3] Gleichzeitiges Bauen am selben Ort ────────────────────────────

async function testGleichzeitigesBauen(): Promise<void> {
  console.log('\n[3] Gleichzeitiges Bauen am selben Ort — Ist-Zustand:');
  const PORT = 2562;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g3-bauen', saveIntervalMs: 3600_000 });
  server.start();
  try {
    // GrabMenhir (bau_menhir): reine Materialkosten (12 Stone), kein
    // Terrain-Effekt — dieselbe Wahl wie server/test/g7-bauen.ts, dort
    // bereits gegen den EINZELNEN Bau-/Abriss-Pfad verifiziert. Neulinge
    // bekommen serverseitig 30 Stone Startausruestung, reicht fuer beide.
    const menhirHash = getStableHash('GrabMenhir');
    // Exakt dieselbe Stelle — beide in Reichweite desselben Zielfeldes.
    const a = await verbindeUndStelle(server, 'BauA', PORT, 800, 800);
    const b = await verbindeUndStelle(server, 'BauB', PORT, 800, 800);

    const peerA = peerVon(server, 'BauA')!;
    const peerB = peerVon(server, 'BauB')!;
    const zielPos: Vector3 = { x: peerA.position.x + 2, y: peerA.position.y, z: peerA.position.z };

    // GLEICHZEITIG (kein await dazwischen) dasselbe Zielfeld beanspruchen.
    sendPlacePiece(a, menhirHash, zielPos);
    sendPlacePiece(b, menhirHash, zielPos);
    // handlePlacePiece antwortet AUSNAHMSLOS mit einem InteractResult
    // (Erfolg wie Ablehnung, s. `antwort()` dort) — auf diese Antworten
    // warten statt auf eine Zeitspanne. Erst wenn beide da sind, ist auch
    // der Weltzustand darunter (ZDOs, Inventare) fertig geschrieben:
    // handlePlacePiece laeuft synchron bis zur Antwort durch.
    await verlangeAuf(
      'beide Bauanfragen sind beantwortet',
      () => a.interact.length >= 1 && b.interact.length >= 1
    );

    const antwortA = a.interact.at(-1);
    const antwortB = b.interact.at(-1);
    check('BauA: Platzierung bestaetigt', !!antwortA?.ok, JSON.stringify(antwortA));
    check('BauB: Platzierung bestaetigt', !!antwortB?.ok, JSON.stringify(antwortB));

    const zdosAmZiel = server.zdos.getZDOByPrefab(menhirHash);
    // IST-ZUSTAND, kein Soll: handlePlacePiece prueft ausschliesslich
    // Reichweite (8 m zur SERVER-Position), Piece-Budget und Material —
    // NIE, ob am Zielfeld bereits ein Piece steht (kein Belegungscheck,
    // s. server/src/WovServer.ts handlePlacePiece). Zwei Peers, die
    // "gleichzeitig" dasselbe Feld beanspruchen, bekommen deshalb BEIDE
    // ihr Piece — zwei ueberlappende ZDOs an derselben Stelle statt einer
    // Kollision oder einer Ablehnung.
    check(
      'IST-ZUSTAND: beide Platzierungen erzeugen je ein eigenes ZDO — keine Kollisionspruefung',
      zdosAmZiel.length === 2,
      `${zdosAmZiel.length} ZDO(s) am Zielfeld`
    );
    check(
      'beide ZDOs tragen unterschiedliche Besitzer (je der eigene Erbauer)',
      zdosAmZiel.length === 2 &&
        zdosAmZiel[0]!.getString('besitzer') !== zdosAmZiel[1]!.getString('besitzer') &&
        new Set(zdosAmZiel.map((z) => z.getString('besitzer'))).size === 2
    );
    check(
      'beide Bauherren wurden je einzeln belastet (12 Stone), keine Verdopplung/keine Ersparnis',
      peerA.inventar.countOf('Stone') === 30 - 12 && peerB.inventar.countOf('Stone') === 30 - 12,
      `A=${peerA.inventar.countOf('Stone')} B=${peerB.inventar.countOf('Stone')}`
    );

    a.ws.close();
    b.ws.close();
  } finally {
    server.stop();
  }
}

// ── [4] Truhe zu zweit ─────────────────────────────────────────────────

async function testTrucheZuZweit(): Promise<void> {
  console.log('\n[4] Truhe zu zweit — kein Verdoppeln:');
  const PORT = 2563;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g3-truhe', saveIntervalMs: 3600_000 });
  server.start();
  try {
    const chestDef = server.prefabs.getByName('piece_chest_wood')!;
    // Beide auf derselben Stelle, deutlich < 6 m Reichweite.
    const a = await verbindeUndStelle(server, 'TruheA', PORT, 900, 900);
    const b = await verbindeUndStelle(server, 'TruheB', PORT, 900, 900);

    const peerA = peerVon(server, 'TruheA')!;
    const peerB = peerVon(server, 'TruheB')!;

    // Truhe mit GENAU 10 Wood befuellen — bewusst OHNE den Umweg ueber
    // handleTruheOeffnen/wuerfleTruhe (Zufallsbeute), weil die Menge fuer
    // diese Pruefung exakt bekannt sein muss (Muster: packContainer/
    // unpackContainer sind dieselben Funktionen wie in
    // server/src/WovServer.ts und server/test/f1-truhe.ts — kein
    // Nachbau).
    const chest = server.zdos.createZDO(chestDef.hash, { ...peerA.position });
    const inv = neueTruheInventory();
    inv.addItem(findItem('Wood')!, 10);
    chest.setString(TRUHE_INHALT_MEMBER, packContainer(inv));
    chest.revision.reviseData();
    chest.dirty = true;

    const woodVorA = peerA.inventar.countOf('Wood');
    const woodVorB = peerB.inventar.countOf('Wood');
    const zdoUserId = chest.zdoid.userId.toString();
    const zdoId = chest.zdoid.id;

    // GLEICHZEITIG: beide fordern den KOMPLETTEN Stapel (10) an — kein
    // await dazwischen. Kernaussage aus dem Kopfkommentar von
    // handleContainerAction: die Methode laeuft synchron zu Ende, Node
    // bedient die zwei Pakete deshalb strikt NACHEINANDER, immer gegen
    // den zu diesem Zeitpunkt echten Inhalt.
    sendContainerAction(a, zdoUserId, zdoId, 0, 'Wood', 10);
    sendContainerAction(b, zdoUserId, zdoId, 0, 'Wood', 10);
    // Zeuge: die ABLEHNUNG des Verlierers.
    //
    // handleContainerAction beantwortet nur den MISSERFOLG mit einem
    // InteractResult ('Nicht genug in der Truhe'); der Erfolgsfall
    // schickt stattdessen inventarSync + sendeTruheInhalt (ContainerSync)
    // — auf "beide bekommen ein InteractResult" zu warten liefe deshalb
    // ins Leere. Genau eine Ablehnung muss es aber geben: Node arbeitet
    // die zwei Pakete streng nacheinander ab, der Zweite findet die
    // Truhe leer. Ist diese Ablehnung da, sind BEIDE Handler-Durchlaeufe
    // fertig — der Truheninhalt darunter ist endgueltig.
    await verlangeAuf(
      'der zweite Zugriff ist mit einer Ablehnung beantwortet',
      () => a.interact.length + b.interact.length >= 1
    );

    const ablehnungen = [...a.interact, ...b.interact];
    check(
      'der leer ausgegangene Zugriff wird abgelehnt statt still verworfen',
      ablehnungen.length === 1 && !ablehnungen[0]!.ok,
      JSON.stringify(ablehnungen)
    );

    const woodNachA = peerA.inventar.countOf('Wood') - woodVorA;
    const woodNachB = peerB.inventar.countOf('Wood') - woodVorB;
    const chestNachher = unpackContainer(chest.getString(TRUHE_INHALT_MEMBER));

    check('Truhe ist leer (die 10 Wood wurden entnommen)', chestNachher.all.length === 0, JSON.stringify(chestNachher.all));
    check(
      'in Summe wurden GENAU 10 Wood entnommen, nicht 20 — keine Verdopplung',
      woodNachA + woodNachB === 10,
      `A=+${woodNachA} B=+${woodNachB} Summe=${woodNachA + woodNachB}`
    );
    check(
      'genau EINER der beiden bekam den ganzen Stapel, der andere ging leer aus',
      (woodNachA === 10 && woodNachB === 0) || (woodNachA === 0 && woodNachB === 10),
      `A=+${woodNachA} B=+${woodNachB}`
    );

    a.ws.close();
    b.ws.close();
  } finally {
    server.stop();
  }
}

// ── [5] Ein Peer geht ──────────────────────────────────────────────────

async function testPeerGeht(): Promise<void> {
  console.log('\n[5] Ein Peer geht — der andere merkt es, Zustand wird aufgeraeumt:');
  const PORT = 2564;
  const server = createWovServer({ port: PORT, worldsDir: WORLDS_DIR, worldName: 'g3-peer-geht', saveIntervalMs: 3600_000 });
  server.start();
  try {
    const bleibt = await verbindeUndStelle(server, 'Bleibt', PORT, 0, 0);
    const geht = await verbindeUndStelle(server, 'Geht', PORT, 10, 0); // in Reichweite

    const peerGeht = peerVon(server, 'Geht')!;
    const keyGeht = peerGeht.characterID.toString();

    // Auf den ZUSTAND warten, nicht nur auf das Auftauchen des
    // Schluessels: Bleibt muss Geht an seiner Zielposition kennen, sonst
    // prueft die Zerstoerungspruefung unten auf einem Spawn-Stand.
    await verlangeAuf('Bleibts Spiegel kennt Geht bei (10, 0)', () => {
      const g = bleibt.spiegel.hole(keyGeht);
      return !!g && nahe(g.position.x, 10);
    });

    check('Bleibt sieht Geht, bevor er die Verbindung trennt', bleibt.sichtbar.has(keyGeht));

    // Drossel-Zustand vor dem Trennen: beide Peers haben mindestens ein
    // AdminCommand-Paket geschickt (der teleport-Befehl oben), die
    // Drossel kennt also beide (private Feld — Zugriff wie in anderen
    // Tests ueblich per Typ-Cast, s. Muster server/test/d6-smoke.ts).
    const drossel = (server.net as unknown as { drossel: Drossel }).drossel;
    const drosselVorher = drossel.bekanntePeers;
    check('Drossel kennt beide Peers vor dem Trennen', drosselVorher >= 2, `${drosselVorher}`);

    geht.ws.close();
    await verlangeAuf('Geht ist server-seitig abgemeldet', () =>
      server.net.getPeers().every((p) => p.name !== 'Geht')
    );

    check('Geht ist aus getPeers() verschwunden', server.net.getPeers().every((p) => p.name !== 'Geht'));
    check('Gehts Charakter-ZDO wurde server-seitig zerstoert', server.zdos.getZDO(peerGeht.characterID) === undefined);

    // Anders als beim Fenster-Austritt (BEFUND in Test 1) ist das hier
    // eine ECHTE Zerstoerung (onPeerQuit ruft zdos.destroyZDO auf) und
    // geht ueber die globale Zerstoerungsliste — Bleibt bekommt sie
    // garantiert zugestellt, unabhaengig vom Sichtfenster.
    await verlangeAuf('Bleibt bekommt Gehts Zerstoerungspaket', () => bleibt.jemalsZerstoert.has(keyGeht));
    check(
      'Bleibt bekommt die Abmeldung — Geht verschwindet aus dem ZDOSync (keine Leiche)',
      !bleibt.sichtbar.has(keyGeht) && bleibt.jemalsZerstoert.has(keyGeht)
    );

    const drosselNachher = drossel.bekanntePeers;
    check(
      'Drosselzustand fuer Geht ist aufgeraeumt (ein Peer weniger als vorher)',
      drosselNachher === drosselVorher - 1,
      `${drosselVorher} → ${drosselNachher}`
    );

    bleibt.ws.close();
  } finally {
    server.stop();
  }
}

// ── Lauf ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await testSichtbarkeit();
    await testChatReichweite();
    await testGleichzeitigesBauen();
    await testTrucheZuZweit();
    await testPeerGeht();
  } finally {
    rmSync(WORLDS_DIR, { recursive: true, force: true });
  }
  console.log(
    failures === 0 ? '\n=== G3 Mehrspieler-E2E: ALLE PRUEFUNGEN BESTANDEN ===' : `\n=== G3 Mehrspieler-E2E: ${failures} FEHLGESCHLAGEN ===`
  );
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
