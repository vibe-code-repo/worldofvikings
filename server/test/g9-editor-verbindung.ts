/**
 * E2E: Eine Editor-Verbindung bearbeitet, ohne die Welt zu betreten.
 *
 * Der Karteneditor speichert Dungeon-Dokumente über den Spielserver
 * (`DungeonEditSave`) — der Server hält `documents` und `instances` im
 * Arbeitsspeicher, eine an ihm vorbei geschriebene Datei würde er nicht
 * bemerken. Damit steht der Editor kurz als Peer in der Verbindungsliste,
 * und genau das hatte am 28.08.2026 zwei Nebenwirkungen, die beide
 * lautlos waren:
 *
 *  1. Der Server legte für jeden Speichervorgang einen CHARAKTER an —
 *     Charakter-ZDO, Startausrüstung, 12,3 KB Terraforming, ein
 *     15k-ZDO-Scan fürs Baubudget. Ein Phantom-Wikinger je Klick.
 *  2. Beim Trennen schrieb er `savedPlayers` unter der spielerId. Mit dem
 *     Sitzungstoken des Bearbeiters ist das DESSEN spielerId — jedes
 *     Speichern hätte seinen gemerkten Standort überschrieben.
 *
 * Beides ist unsichtbar: keine Meldung, kein Fehler, man stünde beim
 * nächsten Anmelden nur woanders. Deshalb steht es hier.
 *
 * Geprüft wird über die Leitung, was über die Leitung entschieden wird,
 * und am Serverobjekt, was nur dort sichtbar ist (Charakter-ZDOs).
 *
 * Ablauf: npx tsx server/test/g9-editor-verbindung.ts   (aus der Wurzel)
 */
import WebSocket from 'ws';
import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PacketType } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(HIER, '../../.tmp-g9');
const PORT = 27_314;

/**
 * Pakettypen IMPORTIERT statt abgeschrieben.
 *
 * Die erste Fassung trug eine eigene Tabelle, wie die aelteren E2E-Tests
 * es tun — und zwei Zahlen darin waren falsch (VersionCheck 0 statt 1,
 * DungeonEditData 63 statt 61). Der Test lief daraufhin 15 Sekunden in
 * einen Handshake-Timeout und meldete sechs Fehlschlaege, von denen
 * keiner etwas mit dem Pruefgegenstand zu tun hatte.
 *
 * Dieselbe Lehre, die im Kopf von g6-dungeon-e2e.ts fuer die
 * HMAC-Antwort steht: Was der Produktivcode definiert, wird benutzt und
 * nicht nachgebaut. Ein Nachbau ist nur so lange richtig, bis ihn jemand
 * anfasst — und er faellt dann als Fehler an einer ganz anderen Stelle
 * auf.
 */
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
  /** Wird erfüllt, sobald der Server die Anmeldung quittiert hat. */
  angemeldet: Promise<void>;
  /** Grund, falls der Server die Verbindung geschlossen hat. */
  geschlossen: string | null;
  /** Letzte DungeonEditData-Antwort. */
  quittung: { ok: boolean; meldung: string } | null;
}

/**
 * Einen Peer anmelden — mit demselben Namen und wahlweise als Editor.
 *
 * `nurEditor` wird als ANGEHÄNGTES Feld geschickt. Wer es weglässt, sieht
 * genau das, was ein älterer Client sähe; die anderen E2E-Tests tun das
 * und müssen weiter laufen.
 */
function verbinde(name: string, nurEditor: boolean): Verbindung {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';
  const v: Verbindung = { ws, angemeldet: Promise.resolve(), geschlossen: null, quittung: null };
  let authGesendet = false;

  v.angemeldet = new Promise<void>((fertig, scheitern) => {
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Anmeldung überfällig`)), 15_000);
    ws.on('close', () => {
      // Ein Schluss VOR der Quittung ist eine Ablehnung. Sie wird nicht
      // geworfen: Genau diesen Ausgang will der Test unten unterscheiden.
      v.geschlossen ??= 'vom Server geschlossen';
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
        const nutzlast = [
          ...writeString(antwortBerechnen(nonce, '')),
          ...writeString(name),
          ...writeString(''),
          ...(nurEditor ? [1] : []),
        ];
        ws.send(Buffer.from([P.PasswordAuth, ...nutzlast]));
      } else if (type === P.PeerInfo) {
        clearTimeout(uhr);
        fertig();
      } else if (type === P.DungeonEditData) {
        let pos = 0;
        const ok = view.getUint8(pos) !== 0;
        pos += 1;
        const [meldung] = readString(view, pos);
        v.quittung = { ok, meldung };
      }
    });
  });
  return v;
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  rmSync(TMP, { recursive: true, force: true });
  const server = createWovServer({
    port: PORT,
    worldsDir: resolve(TMP, 'worlds'),
    saveIntervalMs: 3_600_000,
  });
  server.start();
  await warte(1500);

  // ── 1. Ein normaler Spieler ist online ──
  const spieler = verbinde('Tester', false);
  await spieler.angemeldet;
  await warte(500);
  check('normaler Spieler angemeldet', spieler.geschlossen === null, spieler.geschlossen ?? '');

  const zdosVorher = server.hauptwelt.zdos.getAllZDOs().length;

  // ── 2. Eine Editor-Verbindung MIT DEMSELBEN NAMEN ──
  //
  // Ohne die Ausnahme im Duplikatszweig endet das hier: Ein zweiter
  // Anmelder mit belegtem Namen und anderer Kennung wird abgewiesen
  // ("Name already in use"). Genau das ist der Fall, den der Editor auf
  // dem Live-Server träfe — dort steht der Name im Konto, und beide
  // Verbindungen tragen ihn.
  const editor = verbinde('Tester', true);
  await editor.angemeldet;
  await warte(500);
  check('Editor-Verbindung wird trotz belegtem Namen angenommen', editor.geschlossen === null, editor.geschlossen ?? '');
  check('der normale Spieler bleibt verbunden', spieler.geschlossen === null, spieler.geschlossen ?? '');

  // ── 3. Sie legt keinen Charakter in der Welt an ──
  const zdosNachher = server.hauptwelt.zdos.getAllZDOs().length;
  check(
    'Editor-Verbindung erzeugt keine ZDOs in der Welt',
    zdosNachher === zdosVorher,
    `${zdosVorher} → ${zdosNachher}`
  );

  // ── 4. Speichern geht trotzdem ──
  //
  // Der Riegel vor dem Paket ist `isAdmin` und wurde NICHT angefasst.
  // Ohne diese Prüfung könnte die Ausnahme oben still die Rechte mit
  // weggenommen haben, und der Editor wäre eine Verbindung, die alles
  // darf ausser dem, wofür es sie gibt.
  const doc = {
    version: 2,
    id: 'g9-probe',
    name: 'G9',
    base: 'DG_Steingrab',
    mode: 'custom',
    seed: 1,
    zoneSize: 64,
    layout: {
      rooms: [
        {
          room: 'SteingrabGang',
          pos: { x: 0, y: 0, z: 0 },
          rot: { x: 0, y: 0, z: 0, w: 1 },
          seed: 1,
        },
      ],
      doors: [],
      props: [],
    },
  };
  editor.ws.send(Buffer.from([P.DungeonEditSave, ...writeString(JSON.stringify(doc))]));
  await warte(1500);
  check('Speichern quittiert', editor.quittung?.ok === true, editor.quittung?.meldung ?? 'keine Antwort');
  check('Dokument liegt beim Server', server.dungeons.getDocument('g9-probe') !== undefined);

  // ── 5. Das Trennen fasst den gemerkten Spielerzustand nicht an ──
  //
  // Der teuerste der beiden Fehler: `savedPlayers` ist über die spielerId
  // geschlüsselt, und mit einem echten Sitzungstoken trüge die
  // Editor-Verbindung die des Bearbeiters. Ein Eintrag mehr nach dem
  // Trennen hiesse: Sie hat einen Spielerzustand geschrieben.
  //
  // `savedPlayers` ist privat und bekommt dafür KEINE öffentliche Tür:
  // Der Zustand gehört dem Server, und ein Zugang für einen Test wäre
  // einer für alle. Der Griff steht deshalb hier, eingezäunt und
  // benannt — und nicht als Bequemlichkeit in der Produktivklasse.
  const gemerkte = (): number =>
    (server as unknown as { savedPlayers: Map<string, unknown> }).savedPlayers.size;
  const gemerkteVorher = gemerkte();
  editor.ws.close();
  await warte(800);
  check(
    'Trennen schreibt keinen Spielerzustand',
    gemerkte() === gemerkteVorher,
    `${gemerkteVorher} → ${gemerkte()}`
  );
  check('der normale Spieler ist immer noch da', spieler.geschlossen === null, spieler.geschlossen ?? '');

  spieler.ws.close();
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
