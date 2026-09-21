/**
 * Bannliste: gesperrte Zugaenge kommen nicht herein — und fliegen raus.
 *
 * Der Server ist seit dem 12.09. oeffentlich erreichbar und die
 * Registrierung steht offen. `NetManager.kick()` gab es, aber nichts, was
 * jemanden DAUERHAFT fernhaelt. Was hier nachgewiesen wird, ist genau der
 * Kreis, an dem eine Bannliste sonst scheitert:
 *
 *   1. Bann setzen  → der naechste Verbindungsversuch wird abgelehnt,
 *                     mit einer Meldung, die den Grund nennt.
 *   2. Bann aufheben → dieselbe Verbindung klappt wieder.
 *   3. Wer schon DRIN ist, fliegt beim Bann sofort. Eine Bannliste, die
 *      nur beim Anmelden greift, ist eine Bitte an den Gesperrten, doch
 *      bitte selbst zu gehen.
 *   4. Alle drei Bannarten wirken (Konto, Spieler-ID, Herkunft) — die
 *      Begruendung fuer drei Arten steht im Kopf von Kontendatenbank.ts.
 *   5. Befristete Banns laufen wirklich ab, und ein abgelaufener sperrt
 *      niemanden mehr aus.
 *
 * Warum ueber eine ECHTE WebSocket-Verbindung an einem echten NetManager
 * und nicht gegen die Datenbank allein: Die Frage, die dieses Paket
 * beantwortet, ist nicht „steht die Zeile in SQLite", sondern „kommt der
 * Gesperrte herein". Das entscheidet sich in handlePasswordAuth, hinter
 * Versionspruefung, Nonce und Tokenpruefung — und ein Attrappen-Peer haette
 * genau diesen Pfad nicht.
 *
 * Warum NetManager direkt statt createWovServer: Dieser Test prueft die
 * MECHANIK (Handshake, Bannarten, Fristen) und zieht die Verdrahtung
 * selbst, damit er ohne Welt und ohne Konto-API auskommt. Ob sie im
 * echten Server wirklich haengt, ist eine andere Frage — die beantwortet
 * server/test/adminbefehle-bann.ts an einem echten createWovServer.
 *
 * Echte SQLite in einem tmp-Ordner (Muster server/test/konto-lokal.ts):
 * ein Bann muss einen Neustart ueberleben, das kann eine Map nicht zeigen.
 *
 * Ablauf: npx tsx server/test/bannliste.ts   (aus der Wurzel)
 */
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PacketType } from '@wov/shared';
import { NetManager } from '../src/net/NetManager.js';
import { portVon } from '../../scripts/testport.mjs';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import {
  antwortBerechnen, geheimnisErzeugen, tokenAusstellen,
} from '../src/net/Identitaet.js';

let PORT = 0; // the OS picks it; read back after start() (scripts/testport.mjs)
const P = PacketType;

// ── Draht-Hilfen ────────────────────────────────────────────────────
// Abgeschaut aus g9-editor-verbindung.ts; die Pakettypen kommen wie dort
// aus @wov/shared und werden NICHT nachgebaut.

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

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Ausgang {
  ws: WebSocket;
  /** true, sobald PeerInfo kam — der Server hat die Anmeldung quittiert. */
  angemeldet: boolean;
  /** Text des Disconnect-Pakets, '' wenn keins kam. */
  ablehnung: string;
  /** Erfuellt, sobald feststeht, ob angemeldet oder abgewiesen. */
  fertig: Promise<void>;
}

/**
 * Handshake durchlaufen und den Ausgang zurueckgeben.
 *
 * Wichtig: Der Test wartet NICHT nur auf PeerInfo, sondern ebenso auf
 * Disconnect oder close — sonst waere „abgelehnt" von „haengt" nicht zu
 * unterscheiden und ein kaputter Bann liefe in einen Timeout statt in
 * einen Fehlschlag.
 */
function verbinde(name: string, sessionToken: string): Ausgang {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';
  const a: Ausgang = { ws, angemeldet: false, ablehnung: '', fertig: Promise.resolve() };
  let authGesendet = false;

  a.fertig = new Promise<void>((fertig, scheitern) => {
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Handshake ueberfaellig`)), 10_000);
    const schluss = (): void => { clearTimeout(uhr); fertig(); };
    ws.on('close', schluss);
    ws.on('error', schluss);
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
        ws.send(Buffer.from([P.PasswordAuth, ...[
          ...writeString(antwortBerechnen(nonce, '')),
          ...writeString(name),
          ...writeString(sessionToken),
        ]]));
      } else if (type === P.PeerInfo) {
        a.angemeldet = true;
        schluss();
      } else if (type === P.Disconnect) {
        [a.ablehnung] = readString(view, 0);
        // Kein schluss() hier: der Server schliesst den Socket direkt
        // danach, und das close-Ereignis loest ohnehin aus. So bleibt der
        // Text auch dann erhalten, wenn beides dicht aufeinander folgt.
      }
    });
  });
  return a;
}

/** Eine bestehende Sitzung offen halten und beobachten, ob sie fliegt. */
interface Sitzung extends Ausgang { geschlossen: boolean }

function verbindeUndBleibe(name: string, sessionToken: string): Sitzung {
  const a = verbinde(name, sessionToken) as Sitzung;
  a.geschlossen = false;
  a.ws.on('close', () => { a.geschlossen = true; });
  return a;
}

async function main(): Promise<void> {
  const ordner = mkdtempSync(join(tmpdir(), 'wov-bannliste-'));
  const db = new Kontendatenbank(join(ordner, 'konten.db'));
  const geheimnis = Buffer.from(geheimnisErzeugen(), 'hex');

  const konto = db.kontoAnlegen('Ragnar', 'ragnar@example.org', 'x');
  if (!konto.ok) throw new Error('Konto liess sich nicht anlegen');
  const angelegt = db.charakterAnlegen(konto.konto.id, 'Ragnar', {
    figur: 'wikinger', frisur: 'H_01', haarfarbe: 'mittelbraun', ober: '', beine: '',
  });
  if (!angelegt.ok) throw new Error('Charakter liess sich nicht anlegen');
  const charakter = angelegt.charakter;
  const token = tokenAusstellen(charakter.spielerId, charakter.altlastUserId, geheimnis);

  const net = new NetManager({
    port: 0,
    password: '',
    serverName: 'Bannprobe',
    maxPlayers: 10,
    everyoneAdmin: false,
    sessionSecret: geheimnis,
    istAdminId: () => false,
    charakterZuSpielerId: (id) => db.charakterZuSpielerId(id),
    // GENAU SO gehoert es in WovServer.ts neben charakterZuSpielerId:
    // NetManager stellt die Frage, die Kontendatenbank beantwortet sie.
    bannPruefen: (zugang) => db.bannFuerZugang(zugang),
  });
  net.start();
  PORT = portVon(net);
  await warte(300);

  try {
    // ── 1. Ohne Bann kommt der Charakter herein ──────────────────────
    const frei = verbinde('Ragnar', token);
    await frei.fertig;
    check('ohne Bann wird die Verbindung angenommen', frei.angemeldet, frei.ablehnung);
    frei.ws.close();
    await warte(200);

    // ── 2. Eine LAUFENDE Sitzung fliegt beim Bann ────────────────────
    //
    // Der Kern des Pakets. Der Bann wird gesetzt, waehrend der Spieler
    // online ist; erst trenneGebannte() macht ihn wirksam — genau der
    // Aufruf, den der Adminbefehl nach dem Eintrag tut.
    const sitzung = verbindeUndBleibe('Ragnar', token);
    await sitzung.fertig;
    check('Sitzung fuer den Rauswurf steht', sitzung.angemeldet, sitzung.ablehnung);
    check('sie zaehlt als online', net.peerCount === 1, `peerCount=${net.peerCount}`);

    db.bannSetzen('konto', String(konto.konto.id), {
      grund: 'Griefing', gesetztVon: 'Mike', bis: null,
    });
    const getroffen = net.trenneGebannte();
    check('trenneGebannte meldet genau eine getroffene Verbindung', getroffen.length === 1,
      `${getroffen.length}`);
    await warte(300);
    check('die laufende Sitzung ist geschlossen', sitzung.geschlossen);
    check('der Rauswurf nennt den Grund', sitzung.ablehnung.includes('Griefing'),
      sitzung.ablehnung);
    check('der Gebannte steht nicht mehr in der Spielerliste', net.peerCount === 0,
      `peerCount=${net.peerCount}`);

    // ── 3. Und er kommt nicht wieder herein ──────────────────────────
    const abgewiesen = verbinde('Ragnar', token);
    await abgewiesen.fertig;
    check('Kontobann: neuer Verbindungsversuch wird abgelehnt', !abgewiesen.angemeldet);
    check('die Ablehnung ist lesbar und dauerhaft',
      abgewiesen.ablehnung.includes('dauerhaft') && abgewiesen.ablehnung.includes('Griefing'),
      abgewiesen.ablehnung);

    // ── 4. Bann aufheben → es klappt wieder ──────────────────────────
    check('bannAufheben findet den Eintrag',
      db.bannAufheben('konto', String(konto.konto.id)));
    const wieder = verbinde('Ragnar', token);
    await wieder.fertig;
    check('nach dem Aufheben kommt derselbe Zugang wieder herein', wieder.angemeldet,
      wieder.ablehnung);
    wieder.ws.close();
    await warte(200);

    // ── 5. Bann auf die Spieler-ID ───────────────────────────────────
    //
    // Der Fall ohne Konto: der Zugang wird ueber die spielerId gesperrt,
    // ohne dass eine Kontozeile im Spiel ist.
    db.bannSetzen('spieler', charakter.spielerId, { grund: 'Probe Spieler-ID' });
    const perSpielerId = verbinde('Ragnar', token);
    await perSpielerId.fertig;
    check('Spielerbann: Verbindung wird abgelehnt', !perSpielerId.angemeldet,
      perSpielerId.ablehnung);
    db.bannAufheben('spieler', charakter.spielerId);

    // ── 6. Bann auf die Herkunft ─────────────────────────────────────
    //
    // Der Test spricht ueber Loopback, die ermittelte Herkunft ist also
    // 127.0.0.1. Trifft in echt Unbeteiligte hinter demselben Anschluss —
    // deshalb ist genau diese Art die, die befristet gehoert (Punkt 7).
    //
    // Zugleich der Nachweis, dass die Herkunft ueberhaupt bis zur
    // Bannpruefung durchgereicht wird: sie kommt aus herkunftErmitteln()
    // und wird in NetManager je Verbindung gemerkt.
    db.bannSetzen('herkunft', '127.0.0.1', { grund: 'Kontenflut' });
    const perHerkunft = verbinde('Ragnar', token);
    await perHerkunft.fertig;
    check('Herkunftsbann: Verbindung wird abgelehnt', !perHerkunft.angemeldet,
      perHerkunft.ablehnung);
    db.bannAufheben('herkunft', '127.0.0.1');

    // ── 7. Befristung ────────────────────────────────────────────────
    //
    // Zwei Zeitpunkte statt einer echten Wartezeit: ein Bann, dessen
    // Frist in der Vergangenheit liegt, und einer, dessen Frist in der
    // Zukunft liegt. Das prueft dieselbe Rechnung, die auch nach einer
    // Stunde greift, und der Test dauert keine Stunde.
    const abgelaufen = Date.now() - 60_000;
    db.bannSetzen('konto', String(konto.konto.id), { grund: 'Auszeit', bis: abgelaufen });
    check('ein abgelaufener Bann steht nicht mehr in der Liste',
      db.bannListe().length === 0, `${db.bannListe().length}`);
    const nachAblauf = verbinde('Ragnar', token);
    await nachAblauf.fertig;
    check('ein abgelaufener Bann sperrt niemanden mehr aus', nachAblauf.angemeldet,
      nachAblauf.ablehnung);
    nachAblauf.ws.close();
    await warte(200);

    db.bannSetzen('konto', String(konto.konto.id), {
      grund: 'Auszeit', bis: Date.now() + 3_600_000,
    });
    const nochBefristet = verbinde('Ragnar', token);
    await nochBefristet.fertig;
    check('ein laufender befristeter Bann sperrt aus', !nochBefristet.angemeldet);
    check('die Ablehnung nennt das Fristende',
      nochBefristet.ablehnung.startsWith('Zugang gesperrt bis '), nochBefristet.ablehnung);

    // Aufraeumen entfernt nur, was wirklich abgelaufen ist.
    db.bannSetzen('herkunft', '10.0.0.1', { grund: 'alt', bis: abgelaufen });
    const weg = db.abgelaufeneAufraeumen();
    check('abgelaufeneAufraeumen loescht genau den abgelaufenen Eintrag', weg === 1, `${weg}`);
    check('der laufende Bann bleibt stehen', db.bannListe().length === 1,
      `${db.bannListe().length}`);

    // ── 8. Der Bann ueberlebt einen Neustart ─────────────────────────
    //
    // Der Punkt, an dem eine Map-im-Speicher durchgefallen waere: die
    // Bannliste ist ein Versprechen ueber Serverneustarts hinweg.
    db.schliessen();
    const dbNeu = new Kontendatenbank(join(ordner, 'konten.db'));
    try {
      check('nach dem Neustart steht der Bann noch',
        dbNeu.bannFuerZugang({ spielerId: charakter.spielerId }) !== null);
      // Und die frisch geoeffnete Datenbank hat das Schema selbst
      // mitgebracht, ohne Handgriff (schemaAnlegen/spaltenNachziehen).
      check('charakterNachName findet den Charakter fuer den Adminbefehl',
        dbNeu.charakterNachName('ragnar')?.spielerId === charakter.spielerId);
    } finally {
      dbNeu.schliessen();
    }
  } finally {
    net.stop();
    rmSync(ordner, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nBannliste: alle Pruefungen bestanden' : `\n${fehler} Fehlschlag/-schlaege`);
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
