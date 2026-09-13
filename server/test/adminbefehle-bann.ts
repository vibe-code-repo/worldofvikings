/**
 * Die Berechtigungskette, an EINEM durchgehenden Beispiel — und die
 * Bannbefehle, die daran haengen.
 *
 * Drei Pakete treffen sich hier, und jedes fuer sich war gruen:
 *   - `everyone-admin: false` (server.yml) — ab jetzt entscheidet allein
 *     die Adminliste, wer Adminbefehle nutzen darf.
 *   - das Adminkonto (`standard-konto:` mit `admin: true`) — der erste und
 *     anfangs einzige Eintrag dieser Liste.
 *   - die Bannliste (Kontendatenbank + NetManager.trenneGebannte).
 *
 * Was KEINER dieser drei Tests zeigen konnte, ist die Naht: ob die Kette
 * Konto → Charakter → spielerId → Adminliste → `peer.isAdmin` → Befehl
 * wirklich durchgeht, und ob `bannPruefen` am NetManager-Konstruktor
 * ueberhaupt haengt. Genau das faellt lautlos aus: ohne die eine Zeile in
 * WovServer.ts stehen Banns in der Datenbank, `bann liste` zaehlt sie auf,
 * und trotzdem kommt jeder herein.
 *
 * Deshalb laeuft dieser Test gegen einen ECHTEN `createWovServer` und
 * nicht gegen Attrappen:
 *   - Anmeldung ueber die echte Konto-HTTP-API (`/accounts/login`,
 *     `/accounts/characters/<id>/play`) — derselbe Weg wie im Browser, mit
 *     einem echten SessionToken statt einem selbst ausgestellten.
 *   - Handshake ueber eine echte WebSocket-Verbindung (Muster:
 *     server/test/bannliste.ts, das denselben Draht gegen einen nackten
 *     NetManager fuehrt).
 *   - `fly` als Probe-Adminbefehl, weil er nichts an der Welt aendert und
 *     seine Antwort (AdminEvent) den Wortlaut der Ablehnung mitbringt.
 *
 * Geprueft:
 *   1. Kette haelt: das Konto `admin` aus `standard-konto:` steht mit der
 *      spielerId seines Charakters auf der Adminliste, kommt herein und
 *      darf `fly`.
 *   2. Gegenprobe: `gast` — dasselbe Konto-Verfahren, kein `admin: true` —
 *      wird abgewiesen. Ohne diese Haelfte wuerde ein versehentlich
 *      wiederhergestelltes `everyone-admin: true` nicht auffallen.
 *   3. `bann`/`entbann`/`kick` sind registriert und tun, was sie sagen:
 *      der Gebannte fliegt sofort und kommt nicht wieder herein, nach
 *      `entbann` schon.
 *   4. Ein Bann gilt AUCH fuer einen Admin — strukturell, weil die
 *      Bannpruefung im Handshake vor der Admin-Entscheidung liegt. Der
 *      Befehl legt trotzdem eine Huerde davor (Ziel steht auf der
 *      Adminliste → Ablehnung mit Verweis auf `admin remove`), damit sich
 *      niemand den letzten Admin wegbannt. Beide Haelften stehen hier.
 *
 * Ablauf: npx tsx server/test/adminbefehle-bann.ts   (aus der Wurzel)
 */
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PacketType } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import type { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import type { AdminListe } from '../src/admin/AdminListe.js';

const PORT = 2574;
const P = PacketType;

let fehler = 0;
function check(was: string, bedingung: boolean, zusatz = ''): void {
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${was}${zusatz ? ` (${zusatz})` : ''}`);
  if (!bedingung) fehler++;
}
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Draht-Hilfen (identisch zu bannliste.ts; Pakettypen aus @wov/shared) ──

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

// ── Konto-HTTP-API: derselbe Weg wie im Browser ─────────────────────

async function json(
  pfad: string, leib?: unknown, kontoToken = '',
): Promise<{ code: number; daten: Record<string, unknown> }> {
  const antwort = await fetch(`http://127.0.0.1:${PORT}${pfad}`, {
    method: leib === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(kontoToken ? { authorization: `Bearer ${kontoToken}` } : {}),
    },
    body: leib === undefined ? undefined : JSON.stringify(leib),
  });
  const text = await antwort.text();
  try {
    return { code: antwort.status, daten: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { code: antwort.status, daten: { roh: text } };
  }
}

/**
 * Anmelden wie der Browser und ein Spieltoken fuer den ersten Charakter
 * holen. Bewusst NICHT `tokenAusstellen` aus Identitaet.ts: dieser Test
 * fragt, ob die Kette VOM KONTO AUS haelt, und ein selbst ausgestelltes
 * Token uebersprænge genau ihren Anfang.
 *
 * Die spielerId kommt NICHT von hier — `nachAussen()` in KontoApi.ts
 * laesst sie mit Absicht nie den Server verlassen. Der Test holt sie aus
 * der Kontendatenbank, so wie es der Adminbefehl auch tut.
 */
async function spieltoken(benutzer: string, passwort: string): Promise<{
  token: string; charakterName: string;
}> {
  const anmeldung = await json('/accounts/login', { username: benutzer, password: passwort });
  if (anmeldung.code !== 200) {
    throw new Error(`Anmeldung ${benutzer} fehlgeschlagen: ${anmeldung.code} ${JSON.stringify(anmeldung.daten)}`);
  }
  const kontoToken = String(anmeldung.daten.token ?? '');
  const charaktere = (anmeldung.daten.characters ?? []) as { id: number; name: string }[];
  if (charaktere.length === 0) throw new Error(`${benutzer} hat keinen Charakter`);
  const erster = charaktere[0]!;
  const spiel = await json(`/accounts/characters/${erster.id}/play`, {}, kontoToken);
  const token = String(spiel.daten.sessionToken ?? '');
  if (!token) throw new Error(`kein Spieltoken fuer ${benutzer}: ${JSON.stringify(spiel.daten)}`);
  return { token, charakterName: erster.name };
}

// ── WebSocket-Sitzung mit Adminbefehl ───────────────────────────────

interface Sitzung {
  ws: WebSocket;
  angemeldet: boolean;
  ablehnung: string;
  geschlossen: boolean;
  fertig: Promise<void>;
  /** Antwort auf den zuletzt geschickten Adminbefehl (AdminEvent). */
  befehl(zeile: string): Promise<string>;
}

function verbinde(name: string, token: string): Sitzung {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.binaryType = 'nodebuffer';
  let authGesendet = false;
  let aufAdminEvent: ((text: string) => void) | null = null;

  const s: Sitzung = {
    ws, angemeldet: false, ablehnung: '', geschlossen: false,
    fertig: Promise.resolve(),
    // Vor jedem Befehl eine kurze Pause: AdminCommand ist gedrosselt
    // (server/src/net/Drossel.ts — Eimer 3, Nachfuellrate 1/s), und ein
    // verworfenes Paket saehe hier aus wie ein fehlender Befehl. Der Test
    // soll die Berechtigungskette pruefen, nicht die Drossel.
    befehl: async (zeile) => {
      await warte(1100);
      return new Promise<string>((fertig, scheitern) => {
        const uhr = setTimeout(() => scheitern(new Error(`${name}: keine Antwort auf "${zeile}"`)), 10_000);
        aufAdminEvent = (text) => { clearTimeout(uhr); fertig(text); };
        ws.send(Buffer.from([P.AdminCommand, ...writeString(zeile)]));
      });
    },
  };

  s.fertig = new Promise<void>((fertig, scheitern) => {
    const uhr = setTimeout(() => scheitern(new Error(`${name}: Handshake ueberfaellig`)), 15_000);
    const schluss = (): void => { clearTimeout(uhr); fertig(); };
    ws.on('close', () => { s.geschlossen = true; schluss(); });
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
        // Serverpasswort ist leer -> die Antwort auf die Nonce ist der
        // HMAC ueber ein leeres Passwort, berechnet mit dem ECHTEN Code
        // (antwortBerechnen), damit ein Formatwechsel diesen Test mitnimmt
        // statt still an ihm vorbeizugehen.
        const [nonce] = readString(view, 0);
        ws.send(Buffer.from([P.PasswordAuth, ...[
          ...writeString(antwortBerechnen(nonce, '')),
          ...writeString(name),
          ...writeString(token),
        ]]));
      } else if (type === P.PeerInfo) {
        s.angemeldet = true;
        schluss();
      } else if (type === P.Disconnect) {
        [s.ablehnung] = readString(view, 0);
      } else if (type === P.AdminEvent) {
        // command, active, message — nur die Meldung interessiert hier.
        const [, p1] = readString(view, 0);
        const p2 = p1 + 1; // bool
        const [meldung] = readString(view, p2);
        aufAdminEvent?.(meldung);
        aufAdminEvent = null;
      }
    });
  });
  return s;
}

async function main(): Promise<void> {
  const ordner = mkdtempSync(join(tmpdir(), 'wov-adminbefehle-'));

  // Ein echter Server, aber ohne Weltmerkmale (spart ~75 s Worldgen, s.
  // g1-admin-fly.ts) und mit eigenem Daten- und Kontenordner, damit der
  // Lauf nichts anfasst, was Mike gehoert.
  const server = createWovServer({
    port: PORT,
    worldSeed: 'KxSYuZquuw',
    worldFeatures: false,
    worldsDir: join(ordner, 'worlds'),
    kontenDir: join(ordner, 'konten'),
    worldName: 'probe',
    // everyoneAdmin bleibt bei der Vorgabe FALSE — das ist der Zustand,
    // den dieser Test pruefen soll, und ihn hier zu setzen hiesse, die
    // Vorgabe aus dem Beweis zu nehmen.
    standardKonten: [
      { name: 'gast', passwort: 'gast', charakter: 'Gast' },
      { name: 'admin', passwort: 'admin', charakter: 'Admin', admin: true },
    ],
  });
  server.init();
  server.start();
  await warte(600);

  const innen = server as unknown as { kontenDb: Kontendatenbank; adminListe: AdminListe };

  try {
    // ── 1. Die Kette, Glied fuer Glied ───────────────────────────────
    const admin = await spieltoken('admin', 'admin');
    const gast = await spieltoken('gast', 'gast');
    check('Adminkonto hat einen Charakter', admin.charakterName === 'Admin', admin.charakterName);

    // Glied fuer Glied: Konto -> Charakter -> spielerId -> Adminliste.
    const adminCharakter = innen.kontenDb.charakterNachName('Admin');
    const gastCharakter = innen.kontenDb.charakterNachName('Gast');
    check('beide Charaktere stehen in der Kontendatenbank',
      adminCharakter !== null && gastCharakter !== null);
    check('Charakter des Adminkontos steht auf der Adminliste',
      innen.adminListe.enthaelt(adminCharakter!.spielerId),
      JSON.stringify(innen.adminListe.alle()));
    check('Gast steht NICHT auf der Adminliste',
      !innen.adminListe.enthaelt(gastCharakter!.spielerId));

    const adminSitzung = verbinde('Admin', admin.token);
    await adminSitzung.fertig;
    check('Adminkonto kommt herein', adminSitzung.angemeldet, adminSitzung.ablehnung);
    const flyAdmin = await adminSitzung.befehl('fly');
    check('Admin darf "fly"', flyAdmin.includes('Fly mode ON'), flyAdmin);

    // ── 2. Gegenprobe ────────────────────────────────────────────────
    const gastSitzung = verbinde('Gast', gast.token);
    await gastSitzung.fertig;
    check('Gast kommt herein (nur eben ohne Rechte)', gastSitzung.angemeldet, gastSitzung.ablehnung);
    const flyGast = await gastSitzung.befehl('fly');
    check('Gast darf NICHT "fly"', !flyGast.includes('Fly mode'), flyGast);
    const bannVersuch = await gastSitzung.befehl('bann Admin');
    check('Gast darf nicht bannen', !bannVersuch.toLowerCase().includes('gebannt'), bannVersuch);
    check('der Gast ist nach dem Fehlversuch immer noch verbunden', !gastSitzung.geschlossen);
    check('Admin ist nach dem Fehlversuch nicht gebannt',
      innen.kontenDb.bannListe().length === 0,
      JSON.stringify(innen.kontenDb.bannListe()));

    // ── 3. Die Huerde vor dem Selbstaussperren ───────────────────────
    const selbst = await adminSitzung.befehl('bann Admin');
    check('sich selbst kann der Admin nicht bannen', selbst.includes('Dich selbst'), selbst);

    // ── 4. bann/kick/entbann am lebenden Gast ────────────────────────
    check('der Gast zaehlt vor dem Bann als online', server.net.peerCount === 2,
      `peerCount=${server.net.peerCount}`);
    const gebannt = await adminSitzung.befehl('bann Gast 2h Probelauf');
    check('der Bannbefehl existiert und meldet Vollzug', gebannt.includes('gebannt'), gebannt);
    check('er nennt, wen es getroffen hat', gebannt.includes('Gast'), gebannt);
    await warte(400);
    check('die laufende Gast-Sitzung ist geschlossen', gastSitzung.geschlossen);
    check('der Gast ist aus der Spielerliste', server.net.peerCount === 1,
      `peerCount=${server.net.peerCount}`);
    check('der Bann steht in der Datenbank', innen.kontenDb.bannListe().length === 1,
      JSON.stringify(innen.kontenDb.bannListe()));
    check('er ist befristet, nicht dauerhaft', innen.kontenDb.bannListe()[0]?.bis !== null);
    check('er haengt am KONTO, nicht an der einen Figur',
      innen.kontenDb.bannListe()[0]?.art === 'konto', innen.kontenDb.bannListe()[0]?.art);

    // DIE Frage, die ohne die Zeile in WovServer.ts still falsch waere.
    const abgewiesen = verbinde('Gast', gast.token);
    await abgewiesen.fertig;
    check('der Gebannte kommt nicht wieder herein (bannPruefen ist verdrahtet)',
      !abgewiesen.angemeldet, abgewiesen.ablehnung);
    check('die Ablehnung nennt den Grund', abgewiesen.ablehnung.includes('Probelauf'),
      abgewiesen.ablehnung);

    const bannliste = await adminSitzung.befehl('bann liste');
    check('"bann liste" zeigt den Eintrag', bannliste.includes('konto'), bannliste);
    check('und nennt den Benutzernamen statt der Konto-Nummer',
      bannliste.includes('gast'), bannliste);

    const entbannt = await adminSitzung.befehl('entbann Gast');
    check('"entbann" hebt ihn auf', entbannt.includes('aufgehoben'), entbannt);
    const wieder = verbinde('Gast', gast.token);
    await wieder.fertig;
    check('danach kommt derselbe Zugang wieder herein', wieder.angemeldet, wieder.ablehnung);

    // kick: trennt, bannt aber nicht.
    const geworfen = await adminSitzung.befehl('kick Gast');
    check('"kick" existiert und trennt', geworfen.includes('getrennt'), geworfen);
    await warte(300);
    check('der Geworfene ist weg', wieder.geschlossen);
    check('geworfen ist nicht gebannt', innen.kontenDb.bannListe().length === 0);
    const zurueck = verbinde('Gast', gast.token);
    await zurueck.fertig;
    check('nach kick kann er sofort wiederkommen', zurueck.angemeldet, zurueck.ablehnung);
    zurueck.ws.close();
    await warte(200);

    // ── 5. Ein Bann gilt auch fuer einen Admin ───────────────────────
    //
    // Die Huerde sitzt im BEFEHL, nicht in der Berechtigung. Also erst
    // die Ablehnung des Befehls zeigen, dann denselben Bann an ihm vorbei
    // in die Datenbank setzen und pruefen, dass der Admin draussen
    // bleibt. Genau so wuerde ein Bann aus einem anderen Werkzeug wirken.
    const adminKonto = adminCharakter!;
    const gastSitzung2 = verbinde('Gast', gast.token);
    await gastSitzung2.fertig;
    // Der Gast darf nicht bannen, also macht es der Admin — an sich
    // selbst geht es nicht (s. o.), deshalb hier ueber die Datenbank.
    innen.kontenDb.bannSetzen('konto', String(adminKonto.kontoId), {
      grund: 'Konto uebernommen', gesetztVon: 'Test', bis: null,
    });
    const raus = server.net.trenneGebannte();
    check('auch der Admin fliegt, wenn er gebannt ist',
      raus.some((p) => p.name === 'Admin'), raus.map((p) => p.name).join(','));
    await warte(300);
    const adminAbgewiesen = verbinde('Admin', admin.token);
    await adminAbgewiesen.fertig;
    check('ein gebannter Admin kommt nicht herein', !adminAbgewiesen.angemeldet,
      adminAbgewiesen.ablehnung);
    innen.kontenDb.bannAufheben('konto', String(adminKonto.kontoId));

    // Und die Gegenrichtung: der Befehl schuetzt den Admin vor dem
    // versehentlichen Bann durch einen ZWEITEN Admin.
    innen.adminListe.hinzufuegen(gastCharakter!.spielerId, 'Gast');
    const adminSitzung2 = verbinde('Admin', admin.token);
    await adminSitzung2.fertig;
    check('Admin kommt nach dem Aufheben wieder herein', adminSitzung2.angemeldet,
      adminSitzung2.ablehnung);
    const geschuetzt = await adminSitzung2.befehl('bann Gast');
    check('ein Ziel auf der Adminliste wird vom Befehl abgelehnt',
      geschuetzt.includes('Admin-Liste'), geschuetzt);
    check('und der Verweis sagt, wie man es doch tut',
      geschuetzt.includes('admin remove'), geschuetzt);
    check('nichts wurde eingetragen', innen.kontenDb.bannListe().length === 0);

    gastSitzung2.ws.close();
    adminSitzung.ws.close();
    adminSitzung2.ws.close();
    await warte(200);
  } finally {
    server.stop();
    await warte(300);
    rmSync(ordner, { recursive: true, force: true });
  }

  console.log(fehler === 0 ? '\nAlles gruen.' : `\n${fehler} Pruefung(en) fehlgeschlagen.`);
  process.exit(fehler === 0 ? 0 : 1);
}

void main();
