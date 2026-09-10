/**
 * Die Ausdauerregel: bitgleich zum Bestand, und auf beiden Seiten dieselbe.
 *
 * Vorgeschichte: Ausdauer kannte nur der Server. Er koppelt das Rennen an
 * `stamina > 0` und faellt nach rund zehn Sekunden Sprint auf Gehtempo;
 * der Client rannte weiter. Nach 20 s Sprint standen 190,5 m Clientweg
 * gegen 122,0 m Serverweg — ohne eine einzige Blockierung. Der weiche
 * Abgleich in `main.ts` zog die Figur die ganze Zeit zurueck, und fuer
 * Mike sah das aus wie Lag.
 *
 * Der Umbau schiebt die Regel nach `shared/src/bewegung/ausdauer.ts`,
 * damit der Client sie MITRECHNEN kann. Dieser Test haelt drei Dinge fest:
 *
 *  [A] Die REGEL rechnet Zeichen fuer Zeichen dasselbe wie der Bestand.
 *      Der Bestand steht dazu hier noch einmal als Zeilenkopie da (das
 *      Muster aus `kollision-schritt.ts` [B1]): So misst die Regression
 *      gegen das ECHTE alte Verhalten und nicht gegen eine hingeschriebene
 *      Erwartung. Verglichen wird mit `Object.is`, also auf das letzte
 *      Bit — „ungefaehr gleich" waere hier wertlos.
 *  [B] Der SERVERWEG: 100 Eingabepakete durch `handlePlayerInput` mit
 *      gestellter Uhr. Ausdauer UND Position muessen danach exakt dort
 *      stehen, wo der Bestand sie hingerechnet haette. Nur so ist der
 *      Umbau nachweislich ein Umbau und keine Aenderung.
 *  [C] Der GLEICHLAUF: Client (60 Hz) und Server (20 Hz) rechnen dieselbe
 *      Funktion mit verschiedenen Takten. Nach 12 s Sprint duerfen sie
 *      hoechstens 5 Punkte auseinanderliegen — dieselbe Schranke, die die
 *      Live-Messung im Browser prueft, hier ohne Browser und ohne GPU.
 *  [D] Die EINZELKOSTEN (Schlag, Parade) sind Parameter, keine Zahlen in
 *      der Regel.
 *
 * Ohne Netz: Fake-Peer, `handlePlayerInput` per Cast — dasselbe Muster wie
 * `kollision-schritt.ts` und `g1-admin-fly.ts`.
 *
 * Lauf: npx tsx server/test/ausdauer-abgleich.ts   (aus server/)
 */
import { createWovServer } from '../src/WovServer.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import type { Peer } from '../src/net/Peer.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';
import {
  ausdauerAbzug,
  ausdauerSchritt,
  AUSDAUER_REGEL,
} from '@wov/shared/src/bewegung/ausdauer.js';

let fehler = 0;
function pruefe(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); fehler++; }
}

console.log('=== Ausdauer: eine Regel fuer Client und Server ===');

/**
 * Der Bestand, wie er bis zum Umbau in `handlePlayerInput` stand.
 *
 * Zeile fuer Zeile abgeschrieben, absichtlich ohne Verschoenerung: Die
 * Klammer `Math.max(0, …)`, das `>` (nicht `>=`) bei der Ruhefrist und
 * die Reihenfolge der Zweige sind genau das, was hier bewiesen werden
 * soll. Wer diese Kopie „aufraeumt", nimmt dem Test seinen Zeugen.
 */
function bestand(
  zustand: { stamina: number; zuletzt: number },
  running: boolean,
  bewegt: boolean,
  deltaSec: number,
  now: number
): boolean {
  const rennt = running && bewegt && zustand.stamina > 0;
  if (rennt) {
    zustand.stamina = Math.max(0, zustand.stamina - 10 * deltaSec);
    zustand.zuletzt = now;
  } else if (now - zustand.zuletzt > 1500 && zustand.stamina < 100) {
    zustand.stamina = Math.min(100, zustand.stamina + 14 * deltaSec);
  }
  return rennt;
}

// ── [A] Die reine Regel gegen den Bestand ──────────────────────────
console.log('\n[A] Regel gegen Bestand, Bit fuer Bit:');
{
  /*
    Ein Drehbuch, das ALLE Zweige beruehrt, und zwar in der Reihenfolge,
    in der ein Spieler sie ausloest: sprinten bis leer (Saegezahn ab
    Sekunde 10), stehen bleiben, nachfuellen bis voll, wieder los. Die
    Takte wechseln absichtlich zwischen 50 ms (Server, 20 Hz) und 16 ms
    (Client, 60 Hz) — die Regel darf am Takt nicht haengen.
  */
  const drehbuch: { sekunden: number; running: boolean; bewegt: boolean; takt: number }[] = [
    { sekunden: 14, running: true, bewegt: true, takt: 50 },   // Sprint bis in den Saegezahn
    { sekunden: 4, running: false, bewegt: false, takt: 50 },  // Stehen: Ruhefrist + Nachfuellen
    { sekunden: 3, running: true, bewegt: false, takt: 16 },   // Shift ohne Bewegung: kostet nichts
    { sekunden: 6, running: true, bewegt: true, takt: 16 },    // wieder los, feinerer Takt
    { sekunden: 12, running: false, bewegt: true, takt: 50 },  // Gehen: fuellt nach
  ];

  const a = { stamina: 100, zuletzt: 0 };
  let b = { wert: 100, zuletztVerbraucht: 0 };
  let uhr = 0;
  let takte = 0;
  let abweichung = 0;
  let renntUngleich = 0;
  let sahLeer = false;
  let sahVoll = false;

  for (const teil of drehbuch) {
    const dt = teil.takt / 1000;
    for (let t = 0; t < teil.sekunden * 1000; t += teil.takt) {
      uhr += teil.takt;
      const renntAlt = bestand(a, teil.running, teil.bewegt, dt, uhr);
      const neu = ausdauerSchritt(b, {
        rennWunsch: teil.running,
        bewegt: teil.bewegt,
        dt,
        jetzt: uhr,
      });
      b = { wert: neu.wert, zuletztVerbraucht: neu.zuletztVerbraucht };
      takte += 1;
      if (!Object.is(a.stamina, b.wert)) abweichung += 1;
      if (!Object.is(a.zuletzt, b.zuletztVerbraucht)) abweichung += 1;
      if (renntAlt !== neu.rennt) renntUngleich += 1;
      if (b.wert === 0) sahLeer = true;
      if (b.wert === AUSDAUER_REGEL.max && sahLeer) sahVoll = true;
    }
  }

  pruefe(`${takte} Takte: Ausdauer und Uhr-Marke bitgleich`, abweichung === 0,
    `${abweichung} Abweichungen`);
  pruefe('rennt/rennt-nicht in jedem Takt gleich', renntUngleich === 0,
    `${renntUngleich} Abweichungen`);
  // Ohne diese beiden Zeugen bewiese der Test nur, dass zweimal nichts
  // passiert ist: Ein Drehbuch, das die Grenzen nie erreicht, laeuft auch
  // dann gruen, wenn `Math.max`/`Math.min` fehlen.
  pruefe('Drehbuch erreicht die untere Grenze (0)', sahLeer);
  pruefe('Drehbuch erreicht die obere Grenze (100)', sahVoll);
}

// ── [B] Der Serverweg: 100 Pakete mit gestellter Uhr ───────────────
console.log('\n[B] handlePlayerInput, 100 Pakete:');

const server = createWovServer({ port: 2477, worldSeed: 'KxSYuZquuw', worldFeatures: false });
server.init();

function machPeer(): Peer {
  return {
    name: 'AusdauerViking', isAdmin: true, flying: false, worldId: HAUPTWELT_ID,
    position: { x: 0, y: 0, z: 0 },
    lastInputSeq: 0, lastInputTime: 0, characterID: ZDOID.NONE,
    stamina: 100, staminaZuletztVerbraucht: 0, staminaSyncAkku: 0,
    health: 100, foodBis: 0, foodBonus: 0,
    sendPacketWith: () => {}, sendPacket: () => {},
  } as unknown as Peer;
}

function eingabe(moveX: number, moveZ: number, running = false): Reader {
  const w = new Writer();
  w.writeInt32(1);
  w.writeFloat32(moveX); w.writeFloat32(moveZ);
  w.writeFloat32(0); w.writeFloat32(0); w.writeFloat32(0);
  w.writeBool(running); w.writeBool(false);
  return new Reader(w.toBuffer());
}

const schickeEingabe = (p: Peer, r: Reader): void => {
  (server as unknown as { handlePlayerInput(p: Peer, r: Reader): void }).handlePlayerInput(p, r);
};

/*
  Die Uhr stellen — `deltaSec` UND die Ruhefrist kommen aus Date.now().
  Ohne gestellte Uhr misst die Regression den Zufall der Maschine.
*/
const echteUhr = Date.now;
let uhr = echteUhr();
const TAKT = 50; // ms — 20 Hz, der Eingabetakt des Clients
Date.now = (): number => uhr;

/** Ebenes Umfeld, damit die Probe nicht an einem Hang haengt. */
function flachePlatz(): { x: number; y: number; z: number } {
  for (let i = 0; i < 400; i += 1) {
    const x = 200 + i * 13, z = -300 - i * 7;
    const h = server.getGroundHeight(x, z);
    if (h < 5) continue;
    let flach = true;
    for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]] as const) {
      if (Math.abs(server.getGroundHeight(x + dx, z + dz) - h) > 0.8) flach = false;
    }
    if (flach) return { x, y: h, z };
  }
  return { x: 0, y: server.getGroundHeight(0, 0), z: 0 };
}
const platz = flachePlatz();
console.log(`  (Probeplatz ${platz.x}/${platz.z}, Hoehe ${platz.y.toFixed(2)} m)`);

{
  const peer = machPeer();
  peer.position = { ...platz };
  uhr = echteUhr();
  peer.lastInputTime = uhr;

  /*
    `Math.fround`, weil die Absicht als float32 ueber die Leitung geht.
    Ohne das vergliche man mit Zahlen, die der Server nie bekommen hat.
  */
  const MX = Math.fround(0.6), MZ = Math.fround(0.8);
  const a = { stamina: 100, zuletzt: peer.staminaZuletztVerbraucht };
  // Der Weg mit dem TEMPO, das der Bestand aus seiner Ausdauer ableitet —
  // die Ausdauer entscheidet ueber 7,5 gegen 4,5 m/s, sie ist also nicht
  // nur eine Anzeige, sondern eine Wegstrecke.
  let ax = platz.x, az = platz.z;

  const PAKETE = 100; // 5 s bei 20 Hz — der Sprint faengt hier noch nicht an zu saegen
  for (let i = 0; i < PAKETE; i += 1) {
    uhr += TAKT;
    schickeEingabe(peer, eingabe(MX, MZ, true));
    const renntAlt = bestand(a, true, true, TAKT / 1000, uhr);
    const tempo = renntAlt ? 7.5 : 4.5;
    ax += MX * tempo * (TAKT / 1000);
    az += MZ * tempo * (TAKT / 1000);
  }

  pruefe('Ausdauer nach 100 Paketen bitgleich zum Bestand',
    Object.is(peer.stamina, a.stamina),
    `Server ${peer.stamina.toFixed(6)} / Bestand ${a.stamina.toFixed(6)}`);
  pruefe('Uhr-Marke bitgleich', Object.is(peer.staminaZuletztVerbraucht, a.zuletzt));
  const dWaage = Math.sqrt((peer.position.x - ax) ** 2 + (peer.position.z - az) ** 2);
  pruefe('Weg nach 100 Paketen wie beim Bestand', dWaage < 1e-5,
    `${dWaage.toExponential(2)} m auf ${(7.5 * 5).toFixed(1)} m Weg`);
}

// Ein zweiter Lauf ueber die Leerstelle hinaus: Hier entsteht der
// Saegezahn (leer -> 1,5 s gehen -> Haeppchen -> wieder rennen), und genau
// dort waren Client und Server frueher am weitesten auseinander.
{
  const peer = machPeer();
  peer.position = { ...platz };
  uhr = echteUhr();
  peer.lastInputTime = uhr;
  const MX = Math.fround(1), MZ = Math.fround(0);
  const a = { stamina: 100, zuletzt: peer.staminaZuletztVerbraucht };
  let ax = platz.x;
  let wechsel = 0;
  let vorher = true;
  for (let i = 0; i < 400; i += 1) { // 20 s
    uhr += TAKT;
    schickeEingabe(peer, eingabe(MX, MZ, true));
    const renntAlt = bestand(a, true, true, TAKT / 1000, uhr);
    if (renntAlt !== vorher) { wechsel += 1; vorher = renntAlt; }
    ax += MX * (renntAlt ? 7.5 : 4.5) * (TAKT / 1000);
  }
  pruefe('20-s-Sprint: Ausdauer bitgleich zum Bestand',
    Object.is(peer.stamina, a.stamina),
    `Server ${peer.stamina.toFixed(6)} / Bestand ${a.stamina.toFixed(6)}`);
  pruefe('20-s-Sprint: Weg bitgleich zum Bestand',
    Math.abs(peer.position.x - ax) < 1e-5,
    `${Math.abs(peer.position.x - ax).toExponential(2)} m auf ${(ax - platz.x).toFixed(1)} m`);
  pruefe('Saegezahn tritt wirklich auf', wechsel >= 2, `${wechsel} Wechsel Rennen/Gehen`);
  console.log(`  MESSWERT: Serverweg ueber 20 s = ${(ax - platz.x).toFixed(1)} m ` +
    `(dauerhaft rennen waere ${(7.5 * 20).toFixed(1)} m)`);
}

Date.now = echteUhr;

// ── [C] Gleichlauf Client (60 Hz) gegen Server (20 Hz) ─────────────
console.log('\n[C] Gleichlauf zweier Takte:');
{
  /*
    Der Client rechnet je BILD, der Server je PAKET. Dieselbe Regel, zwei
    Takte — die beiden duerfen sich davon nicht trennen, sonst waere die
    Vorhersage im Client wertlos und der Abgleich zoege wieder. Ohne die
    Korrektur aus dem PlayerState-Paket, absichtlich: Was hier
    uebrigbleibt, ist der reine Taktfehler.
  */
  let client = { wert: 100, zuletztVerbraucht: 0 };
  let serverStand = { wert: 100, zuletztVerbraucht: 0 };
  const dauerMs = 12_000;
  let maxAbstand = 0;
  for (let t = 0; t < dauerMs; t += 1) {
    // 1-ms-Uhr, damit beide Takte auf derselben Zeitachse liegen.
    if (t % 16 === 0) {
      client = ausdauerSchritt(client, { rennWunsch: true, bewegt: true, dt: 0.016, jetzt: t });
    }
    if (t % 50 === 0) {
      serverStand = ausdauerSchritt(serverStand, { rennWunsch: true, bewegt: true, dt: 0.05, jetzt: t });
    }
    const d = Math.abs(client.wert - serverStand.wert);
    if (d > maxAbstand) maxAbstand = d;
  }
  console.log(`  MESSWERT: groesster Abstand ueber 12 s = ${maxAbstand.toFixed(2)} Punkte`);
  pruefe('nach 12 s Sprint weniger als 5 Punkte Abstand', maxAbstand < 5,
    `${maxAbstand.toFixed(2)} Punkte`);
}

// ── [D] Einzelkosten sind Parameter ────────────────────────────────
console.log('\n[D] Einzelabzug (Schlag, Parade):');
{
  const voll = { wert: 100, zuletztVerbraucht: 0 };
  const nachSchlag = ausdauerAbzug(voll, 8, 5000);
  pruefe('Schlag zieht die uebergebenen Kosten ab',
    nachSchlag !== null && Object.is(nachSchlag.wert, 92),
    `${nachSchlag?.wert}`);
  pruefe('Schlag setzt die Ruhefrist neu',
    nachSchlag !== null && nachSchlag.zuletztVerbraucht === 5000);
  const nachParade = ausdauerAbzug({ wert: 5, zuletztVerbraucht: 0 }, 4, 1);
  pruefe('Parade mit anderen Kosten', nachParade !== null && Object.is(nachParade.wert, 1));
  pruefe('zu wenig Ausdauer -> null', ausdauerAbzug({ wert: 7.9, zuletztVerbraucht: 0 }, 8, 1) === null);
  pruefe('genau die Kosten reichen', ausdauerAbzug({ wert: 8, zuletztVerbraucht: 0 }, 8, 1) !== null);
  // Die Kosten stehen NICHT in der Regel — sonst waere der obige Test nur
  // eine Wiederholung derselben Zahl.
  pruefe('die Regel selbst kennt keine Schlagkosten',
    !Object.values(AUSDAUER_REGEL).includes(8));
}

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
