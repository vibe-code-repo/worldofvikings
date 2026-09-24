/**
 * G7 — Kampf, ueber den ECHTEN Paketpfad (handleAttack/handleHarvest).
 *
 * A2 (Security-Review) haelt bereits die reine Funktion gepruefteWaffe fest
 * (server/test/a2-waffe-inventar.ts). Dieser Test prueft denselben Effekt
 * EINGEBAUT: ein echter WebSocket-Client, ein echter Handshake, echte
 * Attack-Pakete durch NetManager.handlePacket (inkl. Drossel) hindurch bis
 * WovServer.handleAttack — keine der hier geprueften Regeln wird im Test
 * nachgebaut, nur ihr WIRKUNGSABDRUCK auf Peer/ZDO wird gelesen.
 *
 * Deckt vom Auftrag (Kampf):
 *  1. Schaden aus dem Inventar: Faust < Axt (besessen) UND eine im Paket
 *     genannte, aber NICHT besessene Waffe faellt exakt auf Faustschaden
 *     zurueck (A2 im Draht, nicht nur in der reinen Funktion).
 *  2. Ausdauerverbrauch: < 8 Punkte verweigert den Schlag komplett (kein
 *     Abzug, kein Treffer); genug Punkte kostet exakt 8.
 *  3. Plausibilitaet der Meldung: ein Angriff, dessen gemeldete Stelle
 *     weiter als SCHLAG_MELDUNG_TOLERANZ (4 m) von der SERVER-Position
 *     entfernt ist, bleibt wirkungslos — keine Ausdauer, kein Treffer.
 *  3b. Reichweite, Kegel und Anker (Paket 0.3): Ein Ziel im Ruecken wird
 *     NICHT getroffen, ein Ziel 4 m seitlich NICHT, ein Ziel 1,5 m vorn
 *     schon. Und: die Zielsuche haengt an der SERVER-Position, nicht an
 *     der gemeldeten — ein Paket, das eine Kreatur weitab nennt, aber
 *     plausibel nah gemeldet ist, trifft diese Kreatur nicht.
 *  3c. Der Server fuehrt die Blickrichtung SELBST (Befund 1 des
 *     Angreifer-Reviews, 13.09.): Ein Angriffspaket mit gelogenem Yaw
 *     trifft das Ziel im Ruecken nicht mehr, waehrend derselbe Schlag
 *     nach einer ehrlich gemeldeten Drehung sehr wohl trifft. Dazu der
 *     Rundumschlag im Kleinen: drei Ziele, gelogene Yaws, ein Treffer.
 *  4. Cooldown ueber die Drossel: zwei Attack-Pakete ohne Pause — nur EINS
 *     zaehlt (STANDARD_DROSSEL: Attack-Eimergroesse 1). Der naechste Schlag
 *     nach der Fuellzeit (350 ms) zaehlt wieder normal — legitimes,
 *     langsameres Spielen wird NICHT abgewuergt.
 *  5. Tod und Beute: eine Kreatur mit garantiertem Drop (Boar → RawMeat,
 *     Chance 1) stirbt nach genug Treffern, das Item landet im
 *     Server-Inventar, und die letzte InteractResult traegt die Beute.
 *
 * Run: npx tsx server/test/g7-kampf.ts   (from the repo root)
 */
import WebSocket from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rmSync } from 'fs';
import { getStableHash, findItem, HEALTH_MEMBER, type Vector3 } from '@wov/shared';
import { antwortBerechnen } from '../src/net/Identitaet.js';
import { createWovServer } from '../src/WovServer.js';
import { portVon } from '../../scripts/testport.mjs';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-g7-kampf');
rmSync(WORLDS_DIR, { recursive: true, force: true });
let PORT = 0; // the OS picks it; read back after start() (scripts/testport.mjs)

const P = {
  VersionCheck: 1,
  PasswordAuth: 2,
  PeerInfo: 3,
  PlayerInput: 40,
  InteractResult: 45,
  Attack: 46,
  AdminCommand: 53,
  AdminEvent: 54,
  AuthChallenge: 68,
};

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

function warte(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function verbinde(name: string): Promise<WebSocket> {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    ws.binaryType = 'nodebuffer';
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
        resolvePromise(ws);
      }
    });
    ws.on('error', reject);
  });
}

function sendAdmin(ws: WebSocket, line: string): void {
  const w = new Writer();
  w.writeString(line);
  ws.send(Buffer.concat([Buffer.from([P.AdminCommand]), w.toBuffer()]));
}

/**
 * Ein Eingabepaket wie das des echten Clients: stehend (moveX/moveZ 0),
 * aber MIT Blickrichtung. Genau dieses Feld fuehrt seit dem 13.09. die
 * server-eigene Blickrichtung nach (WovServer.fuehreBlickNach).
 *
 * Wire-Format: seq, moveX, moveZ, lookYaw, lookPitch, moveY, running,
 * jumping (s. shared/src/protocol.ts, PlayerInputPacket).
 */
let eingabeSeq = 0;
function sendInput(ws: WebSocket, yaw: number): void {
  const w = new Writer();
  w.writeInt32(++eingabeSeq);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeFloat32(yaw);
  w.writeFloat32(0);
  w.writeFloat32(0);
  w.writeBool(false);
  w.writeBool(false);
  ws.send(Buffer.concat([Buffer.from([P.PlayerInput]), w.toBuffer()]));
}

/**
 * EHRLICH in eine Richtung drehen — so, wie es der Browser tut: 20 Hz
 * Eingabepakete, bis der Server die Richtung uebernommen hat.
 *
 * Warum das noetig ist: Der Server laesst seine gefuehrte Blickrichtung
 * nur mit begrenzter Drehrate wandern (BLICK_DREHRATE_MAX, 15 rad/s).
 * Eine halbe Drehung braucht darum rund 0,21 s Meldungen — im Spiel
 * genau die Zeit, die die Figur sichtbar zum Umdrehen braucht. Ein Test,
 * der die Richtung "einfach setzt", misst nicht den Spielfall.
 */
async function blicke(ws: WebSocket, yaw: number, dauerMs = 400): Promise<void> {
  for (let t = 0; t < dauerMs; t += 50) {
    sendInput(ws, yaw);
    await warte(50);
  }
}

/**
 * `yaw` ist die Blickrichtung wie der Client sie meldet:
 * forward = (−sin yaw, −cos yaw). Yaw 0 schaut also nach −Z. Seit dem
 * 13.09. ist der Wert nur noch eine MELDUNG: Der Server rechnet den
 * Kegel gegen seine eigene, nachgefuehrte Richtung (fuehreBlickNach) —
 * wer hier etwas anderes einsetzt als das, was `sendInput` vorher
 * gemeldet hat, luegt, und genau das prueft Abschnitt [3c].
 */
function sendAttack(ws: WebSocket, pos: Vector3, waffe: string, yaw = 0): void {
  const w = new Writer();
  w.writeVector3(pos);
  w.writeFloat32(yaw);
  w.writeString(waffe);
  ws.send(Buffer.concat([Buffer.from([P.Attack]), w.toBuffer()]));
}

interface InteractResultMsg {
  ok: boolean;
  message: string;
  itemName: string;
  amount: number;
}

async function main(): Promise<void> {
  // everyoneAdmin AUSDRUECKLICH: Seit Paket 0.1 ist die Vorgabe `false`
  // (s. DEFAULT_CONFIG in WovServer.ts). Ohne diese Zeile wies der Server
  // jedes `teleport` dieses Tests mit "Admin commands are not allowed"
  // ab — und weil der Test den Rueckgabewert nie las, blieb er gruen und
  // spielte alle Abschnitte still an derselben Stelle durch. Die Ziele
  // frueherer Abschnitte standen dann noch in Reichweite der spaeteren.
  const server = createWovServer({
    port: 0,
    worldsDir: WORLDS_DIR,
    kontenDir: resolve(WORLDS_DIR, 'konten'),
    worldName: 'g7-kampf',
    saveIntervalMs: 3600_000,
    everyoneAdmin: true,
  });
  server.start();
  PORT = portVon(server);

  try {
    const ws = await verbinde('Kaempfer');
    const interactLog: InteractResultMsg[] = [];
    ws.on('message', (data: Buffer) => {
      const type = data.readUInt8(0);
      if (type !== P.InteractResult) return;
      const reader = new Reader(Buffer.from(data.subarray(1)));
      interactLog.push({
        ok: reader.readBool(),
        message: reader.readString(),
        itemName: reader.readString(),
        amount: reader.readInt32(),
      });
    });

    const skeletonHash = getStableHash('Skeleton');
    const boarHash = getStableHash('Boar');
    const hp = (zdo: ZDO): number => zdo.getInt(HEALTH_MEMBER);

    /**
     * Seit Paket 0.3 sucht `handleAttack` um die SERVER-Position, nicht
     * mehr um die gemeldete. Zwei Folgen fuer diesen Test:
     *
     *  • Jedes Ziel muss NEBEN DEM SPIELER stehen, nicht irgendwo.
     *  • Mehrere Ziele in Reichweite konkurrieren — der Schlag nimmt das
     *    naechste im Kegel. Die Ziele stehen deshalb sternfoermig in vier
     *    Richtungen, 90° auseinander; der Kegel (±60°) laesst je Schlag
     *    genau eines zu.
     *
     * Blickbasis wie im Client: forward = (−sin yaw, −cos yaw).
     */
    const YAW_MINUS_Z = 0;
    const YAW_MINUS_X = Math.PI / 2;
    const YAW_PLUS_Z = Math.PI;
    const YAW_PLUS_X = (3 * Math.PI) / 2;

    /** Punkt in `abstand` m Richtung `yaw` von `von` aus. */
    const vorn = (von: Vector3, yaw: number, abstand: number): Vector3 => ({
      x: von.x - Math.sin(yaw) * abstand,
      y: von.y,
      z: von.z - Math.cos(yaw) * abstand,
    });

    /**
     * Frischer, leerer Platz — jeder Abschnitt bekommt seinen eigenen.
     *
     * Der Teleport wird NACHGEPRUEFT. Schlaegt er fehl (fehlende
     * Admin-Rechte), stehen alle Abschnitte uebereinander und die
     * Reichweiten-/Kegelpruefungen messen die Ziele des vorigen
     * Abschnitts mit — gruen, aber wertlos.
     */
    async function neuerPlatz(x: number, z: number): Promise<Vector3> {
      sendAdmin(ws, `teleport ${x} ${z}`);
      await warte(300);
      const p = peer!.position;
      if (Math.hypot(p.x - x, p.z - z) > 1) {
        throw new Error(`Teleport nach ${x},${z} hat nicht gewirkt (Spieler steht bei ${p.x},${p.z})`);
      }
      return { ...p };
    }

    const peer = server.net.getPeers().find((p) => p.name === 'Kaempfer');
    if (!peer) throw new Error('Peer nicht gefunden');
    await neuerPlatz(0, 0);
    // AxeFlint gehoert ohnehin zur Server-Startausruestung jedes Neulings
    // (WovServer.ts, START-Liste) — Club NICHT, das ist die Grundlage fuer
    // den Fallback-Nachweis in [1].

    // ── [1] Schaden aus dem Inventar ──────────────────────────────
    console.log('\n[1] Schaden nur fuer besessene Waffen (A2 im Draht):');
    let mitte = { ...peer.position };
    const skelA = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 2));
    const skelB = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_X, 2));
    const skelC = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_PLUS_Z, 2));

    // Vor jedem Schlag EHRLICH hindrehen. Ohne diese Zeilen schluege der
    // Test in eine Richtung, die er dem Server nie gemeldet hat — der
    // Kegel rechnet seit dem 13.09. gegen die GEFUEHRTE Blickrichtung.
    await blicke(ws, YAW_MINUS_Z);
    sendAttack(ws, mitte, '', YAW_MINUS_Z); // Faust
    await warte(400);
    await blicke(ws, YAW_MINUS_X);
    sendAttack(ws, mitte, 'AxeFlint', YAW_MINUS_X); // besessene Waffe
    await warte(400);
    await blicke(ws, YAW_PLUS_Z);
    sendAttack(ws, mitte, 'Club', YAW_PLUS_Z); // NICHT besessen → Faust
    await warte(400);

    const faustSchaden = 20 - hp(skelA);
    const axtSchaden = 20 - hp(skelB);
    const fallbackSchaden = 20 - hp(skelC);
    check('Faustschlag traf', faustSchaden > 0, `${faustSchaden}`);
    check('Axt macht mehr Schaden als Faust', axtSchaden > faustSchaden, `Axt=${axtSchaden} Faust=${faustSchaden}`);
    check(
      'nicht besessene Waffe im Paket faellt exakt auf Faustschaden zurueck',
      fallbackSchaden === faustSchaden,
      `Fallback=${fallbackSchaden} Faust=${faustSchaden}`
    );

    // ── [2] Ausdauerverbrauch ──────────────────────────────────────
    console.log('\n[2] Ausdauerverbrauch:');
    const skelStam = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_PLUS_X, 2));
    // Erst drehen, DANN die Ausdauer setzen: Waehrend der Eingabepakete
    // laeuft die Ausdauerregel mit, und ein vorher gesetzter Wert waere
    // hinterher ein anderer.
    await blicke(ws, YAW_PLUS_X);
    peer.stamina = 5;
    sendAttack(ws, mitte, '', YAW_PLUS_X);
    await warte(400);
    check('< 8 Ausdauer: kein Treffer', hp(skelStam) === 0, `hp=${hp(skelStam)}`);
    check('< 8 Ausdauer: kein Abzug', peer.stamina === 5, `stamina=${peer.stamina}`);

    peer.stamina = 100;
    sendAttack(ws, mitte, '', YAW_PLUS_X);
    await warte(400);
    check('genug Ausdauer: Treffer', hp(skelStam) === 20 - faustSchaden, `hp=${hp(skelStam)}`);
    check('genug Ausdauer: Abzug exakt 8', peer.stamina === 92, `stamina=${peer.stamina}`);

    // ── [3] Plausibilitaet der gemeldeten Stelle ──────────────────
    console.log('\n[3] Gemeldete Stelle muss zur Server-Position passen:');
    const skelFern = server.zdos.createZDO(skeletonHash, { x: 5000, y: 0, z: 5000 });
    await blicke(ws, YAW_MINUS_Z);
    peer.stamina = 92;
    sendAttack(ws, skelFern.position, '');
    await warte(400);
    check('unplausible Meldung: kein Treffer', hp(skelFern) === 0, `hp=${hp(skelFern)}`);
    check('unplausible Meldung: keine Ausdauer verbraucht', peer.stamina === 92, `stamina=${peer.stamina}`);

    // ── [3b] Reichweite, Kegel und Anker (Paket 0.3) ─────────────
    console.log('\n[3b] Reichweite, Trefferkegel und Anker der Zielsuche:');
    mitte = await neuerPlatz(400, 400);
    await blicke(ws, YAW_MINUS_Z);
    peer.stamina = 100;

    // Ruecken: 2 m HINTER dem Spieler, also gegen die Blickrichtung.
    const skelRuecken = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_PLUS_Z, 2));
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(400);
    check('Ziel im Ruecken trifft NICHT', hp(skelRuecken) === 0, `hp=${hp(skelRuecken)}`);
    server.zdos.destroyZDO(skelRuecken.zdoid);

    // 4 m seitlich: ausserhalb des Kegels UND ausserhalb der Reichweite.
    peer.stamina = 100;
    const skelSeite = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_X, 4));
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(400);
    check('Ziel 4 m seitlich trifft NICHT', hp(skelSeite) === 0, `hp=${hp(skelSeite)}`);
    server.zdos.destroyZDO(skelSeite.zdoid);

    // 4 m GERADEAUS: im Kegel, aber ausserhalb der Reichweite (3,5 m).
    // Trennt die beiden neuen Regeln voneinander — faellt nur der Kegel
    // weg, bleibt dieser Fall trotzdem rot.
    peer.stamina = 100;
    const skelWeitVorn = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 4));
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(400);
    check('Ziel 4 m GERADEAUS trifft NICHT (Reichweite 3,5 m)', hp(skelWeitVorn) === 0, `hp=${hp(skelWeitVorn)}`);
    server.zdos.destroyZDO(skelWeitVorn.zdoid);

    // 1,5 m vorn: der Normalfall, muss treffen.
    peer.stamina = 100;
    const skelVorn = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 1.5));
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(400);
    check('Ziel 1,5 m vorn TRIFFT', hp(skelVorn) === 20 - faustSchaden, `hp=${hp(skelVorn)}`);
    server.zdos.destroyZDO(skelVorn.zdoid);

    /*
      Anker: Die Suche haengt an der SERVER-Position, nicht an der
      gemeldeten. Die Kreatur steht 6 m vorn — ausser Reichweite. Gemeldet
      wird eine Stelle 3 m vorn: plausibel (< 4 m Toleranz) und zugleich
      nur 3 m von der Kreatur entfernt. Vor Paket 0.3 suchte der Server um
      genau diese gemeldete Stelle und haette getroffen.
    */
    peer.stamina = 100;
    const skelAnker = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 6));
    sendAttack(ws, vorn(mitte, YAW_MINUS_Z, 3), '', YAW_MINUS_Z);
    await warte(400);
    check(
      'gemeldete Stelle waehlt kein Ziel aus (Anker = Server-Position)',
      hp(skelAnker) === 0,
      `hp=${hp(skelAnker)}`
    );
    server.zdos.destroyZDO(skelAnker.zdoid);

    // ── [3c] Der Server fuehrt den Blick selbst (Befund 1) ────────
    /*
      Bis zum 13.09. rechnete der Kegel gegen den Gierwinkel, den das
      ANGRIFFSPAKET behauptete. `handlePlayerInput` las `lookYaw` zwar,
      legte ihn aber nie am Peer ab — der Server hatte also gar keine
      eigene Blickrichtung, gegen die er die Behauptung haette halten
      koennen. Ein Angreifer-Skript hat das live vorgefuehrt: ehrliche
      Position, Ziel im Ruecken, gelogener Yaw — Treffer; und ein
      Rundumschlag mit je neu gewaehltem Yaw traf vier von sechs
      sternfoermig verteilten Zielen, ohne dass die Figur sich je
      gedreht hat.

      Geprueft wird hier genau der Unterschied zwischen MELDEN und
      DREHEN. Alle drei Faelle stehen an derselben Stelle, mit
      derselben Kreatur im Ruecken:
        a) ehrlich hinschauen, ehrlich schlagen  → Treffer
        b) vorwaerts melden, rueckwaerts schlagen → KEIN Treffer
        c) sich wirklich umdrehen, dann schlagen  → wieder Treffer
      (c) ist die wichtigere Haelfte: Eine Sperre, die auch das ehrliche
      Umdrehen verschluckt, waere schlimmer als die Luecke.
    */
    mitte = await neuerPlatz(500, 500);
    const innen = peer as unknown as { blickYaw: number | null };

    // a) Ehrlich: hinschauen und schlagen.
    await blicke(ws, YAW_MINUS_Z);
    peer.stamina = 100;
    const skelEhrlich = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 2));
    sendAttack(ws, mitte, '', YAW_MINUS_Z);
    await warte(400);
    check('ehrlicher Schlag nach vorn TRIFFT', hp(skelEhrlich) === 20 - faustSchaden, `hp=${hp(skelEhrlich)}`);
    server.zdos.destroyZDO(skelEhrlich.zdoid);

    // b) DER BEFUND: Eingaben melden weiter nach vorn, das Angriffspaket
    //    behauptet die Gegenrichtung. Die Position bleibt ehrlich.
    await blicke(ws, YAW_MINUS_Z);
    peer.stamina = 100;
    const skelLuege = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_PLUS_Z, 2));
    sendAttack(ws, mitte, '', YAW_PLUS_Z);
    await warte(400);
    check('gelogener Yaw trifft NICHT ins Ruecken-Ziel', hp(skelLuege) === 0, `hp=${hp(skelLuege)}`);
    check(
      'die Luege hat den gefuehrten Blick nur um das Erlaubte bewegt (<= 0,75 rad)',
      innen.blickYaw !== null && Math.abs(innen.blickYaw) <= 0.76,
      `blickYaw=${innen.blickYaw?.toFixed(3)}`
    );

    // c) Gegenprobe: wirklich umdrehen (Eingabepakete melden die Drehung),
    //    dann derselbe Schlag auf dasselbe Ziel.
    await blicke(ws, YAW_PLUS_Z);
    peer.stamina = 100;
    sendAttack(ws, mitte, '', YAW_PLUS_Z);
    await warte(400);
    check(
      'nach ehrlichem Umdrehen trifft derselbe Schlag',
      hp(skelLuege) === 20 - faustSchaden,
      `hp=${hp(skelLuege)}`
    );
    server.zdos.destroyZDO(skelLuege.zdoid);

    /*
      Der Rundumschlag, klein nachgebaut: drei Ziele im Abstand von 120°,
      Eingaben durchgehend nach −Z, und je Ziel ein Angriffspaket mit
      passend gelogenem Yaw. Getroffen werden darf nur das vordere.

      120° ist mit Bedacht gewaehlt und nicht 90°: Ein einzelnes
      Angriffspaket darf den gefuehrten Blick um bis zu 0,75 rad (43°)
      mitnehmen — es ist die frischeste Blickmeldung zu diesem Schlag
      (s. BLICK_ALTERSDECKEL_S). Zusammen mit dem Kegel (±60°) reicht ein
      Schlag damit rund 103° zur Seite. Das ist die Zusage, die dieser
      Test festhaelt: kein Treffer nach hinten und keiner ueber die
      Schulter — nicht "auf ein Grad genau nach vorn".
    */
    mitte = await neuerPlatz(700, 700);
    const stern = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((yaw) => ({
      yaw,
      zdo: server.zdos.createZDO(skeletonHash, vorn(mitte, yaw, 2)),
    }));
    await blicke(ws, YAW_MINUS_Z);
    for (const ziel of stern) {
      peer.stamina = 100;
      sendAttack(ws, mitte, '', ziel.yaw); // gelogen, ausser beim ersten
      await warte(450); // Drossel: ein Schlag je 350 ms
      // Zwischen den Schlaegen weiter ehrlich nach vorn melden — genau
      // das tat das Angreifer-Skript auch, seine Figur stand still.
      sendInput(ws, YAW_MINUS_Z);
    }
    // Getroffen = das ZDO hat einen HEALTH-Eintrag bekommen. Ein nie
    // getroffenes ZDO hat gar keinen und liest sich als 0 — ein Vergleich
    // gegen den Startwert (20) haette hier ALLE als getroffen gezaehlt.
    const getroffen = stern.filter((z) => hp(z.zdo) > 0).map((z) => Math.round((z.yaw * 180) / Math.PI));
    check(
      'Rundumschlag mit gelogenem Yaw trifft nur das Ziel VORN',
      getroffen.length === 1 && getroffen[0] === 0,
      `getroffen bei ${getroffen.join('°, ')}°`
    );
    for (const ziel of stern) server.zdos.destroyZDO(ziel.zdo.zdoid);

    // ── [4] Cooldown ueber die Drossel ────────────────────────────
    console.log('\n[4] Cooldown ueber die Drossel (Attack-Eimergroesse 1):');
    mitte = await neuerPlatz(600, 600);
    peer.stamina = 100;
    const skelBurst = server.zdos.createZDO(skeletonHash, vorn(mitte, YAW_MINUS_Z, 2));
    sendAttack(ws, mitte, '', YAW_MINUS_Z); // sollte zaehlen
    sendAttack(ws, mitte, '', YAW_MINUS_Z); // sollte von der Drossel verworfen werden
    await warte(350);
    check(
      'Stossangriff: nur EIN Treffer zaehlt',
      hp(skelBurst) === 20 - faustSchaden,
      `hp=${hp(skelBurst)} (erwartet ${20 - faustSchaden})`
    );
    check('Stossangriff: nur EIN Ausdauerabzug', peer.stamina === 92, `stamina=${peer.stamina}`);

    await warte(400); // Fuellzeit abwarten — Eimer wieder voll
    sendAttack(ws, mitte, '', YAW_MINUS_Z); // legitimer Folgeschlag, langsamer getaktet
    await warte(300);
    check(
      'legitimer Folgeschlag NACH der Fuellzeit zaehlt normal',
      hp(skelBurst) === 20 - 2 * faustSchaden,
      `hp=${hp(skelBurst)} (erwartet ${20 - 2 * faustSchaden})`
    );

    // ── [5] Tod und Beute ────────────────────────────────────────
    console.log('\n[5] Tod und Beute (Boar → garantiert RawMeat):');
    mitte = await neuerPlatz(800, 800);
    const boar = server.zdos.createZDO(boarHash, vorn(mitte, YAW_MINUS_Z, 2));
    const boarZdoid = boar.zdoid;
    const rawMeatVorher = peer.inventar.countOf('RawMeat');
    let tot = false;
    for (let i = 0; i < 8 && !tot; i++) {
      await warte(400);
      peer.stamina = 100;
      sendAttack(ws, mitte, 'AxeFlint', YAW_MINUS_Z);
      await warte(250);
      tot = server.zdos.getZDO(boarZdoid) === undefined;
    }
    check('Boar stirbt nach genug Treffern', tot);
    const rawMeatNachher = peer.inventar.countOf('RawMeat');
    check(
      'RawMeat im Server-Inventar gelandet',
      rawMeatNachher > rawMeatVorher,
      `${rawMeatVorher} → ${rawMeatNachher}`
    );
    const beuteMsg = interactLog.at(-1);
    check(
      'letzte InteractResult meldet die Beute',
      !!beuteMsg && beuteMsg.ok && beuteMsg.itemName === 'RawMeat' && beuteMsg.amount > 0,
      JSON.stringify(beuteMsg)
    );

    console.log(
      failures === 0 ? '\n=== G7 Kampf: ALL PASSED ===' : `\n=== G7 Kampf: ${failures} FAILURES ===`
    );
  } catch (err) {
    // Without this the finally below exits 0 on an abort: nothing was checked, yet the run looked green.
    console.error('FAIL:', err);
    failures++;
  } finally {
    server.stop();
    rmSync(WORLDS_DIR, { recursive: true, force: true });
    process.exit(failures > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
