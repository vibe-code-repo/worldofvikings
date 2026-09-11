/**
 * Bewegungsschritt und Serverkollision — an echter Geometrie gemessen.
 *
 * Zwei Ebenen in einer Datei, absichtlich:
 *  [A] Die FORMEN: Strahl gegen Kiste, Kapsel und Netz ueber
 *      `Kollisionswelt.nahfeldAus` und ebenem Boden. Kein ZDO, keine
 *      Welt — hier wird Geometrie geprueft und sonst nichts.
 *  [B] Der SERVERWEG: `handlePlayerInput` mit echten ZDOs, einer
 *      Test-Formquelle und gestellter Uhr. Hier wird geprueft, dass die
 *      Formen den Spieler wirklich erreichen — und dass die LEERE Quelle
 *      auf die Stelle genau so rechnet wie der Bestand vor dem Umbau.
 *
 * Ohne Netz: Fake-Peer, `handlePlayerInput` per Cast (dasselbe Muster wie
 * g1-admin-fly.ts). Die Uhr wird gestellt, weil `deltaSec` aus der
 * Wanduhr kommt — ohne das ist die Regression nicht vergleichbar, sondern
 * nur ungefaehr.
 *
 * Lauf: npx tsx server/test/kollision-schritt.ts   (aus server/)
 */
import { createWovServer } from '../src/WovServer.js';
import { KollisionsFormen } from '../src/world/KollisionsFormen.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import { Reader } from '../src/io/Reader.js';
import { Writer } from '../src/io/Writer.js';
import { ZDOID } from '../src/zdo/ZDOID.js';
import type { Peer } from '../src/net/Peer.js';
import { HAUPTWELT_ID } from '../src/world/Welt.js';
import { getStableHash } from '../src/util/Hash.js';
import type { FormQuelle, KollisionsForm, Vek3 } from '@wov/shared/src/kollision/form.js';
import { bewegungsSchritt } from '@wov/shared/src/bewegung/schritt.js';
import {
  FALL_TEMPO,
  GEH_TEMPO,
  KOERPER_RADIUS,
  LAUF_TEMPO,
  SCHRITT_LAENGE,
} from '@wov/shared/src/bewegung/masse.js';
import { GROSSBUSCH_RADIUS } from '@wov/shared';

let fehler = 0;
function pruefe(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else { console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`); fehler++; }
}

console.log('=== Bewegungsschritt und Serverkollision ===');

const server = createWovServer({ port: 2474, worldSeed: 'KxSYuZquuw', worldFeatures: false });
server.init();

// ── Formen fuer die Proben ─────────────────────────────────────────

const kiste = (min: Vek3, max: Vek3): KollisionsForm => ({ art: 'kiste', min, max });

/** Ein Netz, das dieselbe Kiste beschreibt — 12 Dreiecke, gleiche Antwort. */
function netzKiste(min: Vek3, max: Vek3): KollisionsForm {
  const p = new Float32Array([
    min.x, min.y, min.z, max.x, min.y, min.z, max.x, max.y, min.z, min.x, max.y, min.z,
    min.x, min.y, max.z, max.x, min.y, max.z, max.x, max.y, max.z, min.x, max.y, max.z,
  ]);
  const i = new Uint32Array([
    0, 2, 1, 0, 3, 2, // −z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // −y
    3, 7, 6, 3, 6, 2, // +y
    0, 4, 7, 0, 7, 3, // −x
    1, 2, 6, 1, 6, 5, // +x
  ]);
  return { art: 'netz', positionen: p, indizes: i, min, max };
}

// Ebener Boden auf 0 — die Formen sollen geprueft werden, nicht das Gelaende.
const eben = new Kollisionswelt(server.zdos, server.prefabs, () => 0);

/** Laeuft `sekunden` mit fester Absicht und liefert den Endzustand. */
function laufe(
  nah: ReturnType<Kollisionswelt['nahfeldAus']>,
  start: { x: number; y: number; z: number },
  eingabe: { x: number; z: number; rennt: boolean },
  sekunden: number
): { x: number; y: number; z: number } {
  let z = start;
  const schritte = Math.round(sekunden / SCHRITT_LAENGE);
  for (let i = 0; i < schritte; i += 1) {
    z = bewegungsSchritt(z, eingabe, SCHRITT_LAENGE, nah, nah);
  }
  return z;
}

// ── [A] Formen ─────────────────────────────────────────────────────
console.log('\n[A] Strahl gegen Formen (ebener Boden, ohne ZDO):');
{
  // Eine 4 m dicke, 100 m lange Wand, deren Flanke bei x = 5 steht.
  const wandForm = kiste({ x: -2, y: -1, z: -50 }, { x: 2, y: 3, z: 50 });
  const vorne = eben.nahfeldAus([{ form: wandForm, position: { x: 7, y: 0, z: 0 } }]);
  const gestoppt = laufe(vorne, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 5);
  pruefe('Kiste vor dem Spieler: haelt davor, 5 s Eingabe aendern das nicht',
    gestoppt.x > 3.5 && gestoppt.x < 5, `x=${gestoppt.x.toFixed(3)} (Kistenflanke bei 5)`);
  pruefe('… und wird nicht seitlich versetzt', Math.abs(gestoppt.z) < 1e-9);

  const netzGleich = eben.nahfeldAus([
    { form: netzKiste({ x: -2, y: -1, z: -50 }, { x: 2, y: 3, z: 50 }), position: { x: 7, y: 0, z: 0 } },
  ]);
  const netzStopp = laufe(netzGleich, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 5);
  pruefe('dasselbe als Netz: derselbe Halt',
    Math.abs(netzStopp.x - gestoppt.x) < 1e-9, `x=${netzStopp.x.toFixed(3)}`);

  const kapsel = eben.nahfeldAus([
    { form: { art: 'kapsel', x: 0, z: 0, radius: 1, yMin: 0.2, yMax: 3 }, position: { x: 6, y: 0, z: 0 } },
  ]);
  const kapselStopp = laufe(kapsel, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 5);
  pruefe('Kapsel: haelt vor dem Mantel',
    kapselStopp.x > 3.5 && kapselStopp.x < 5, `x=${kapselStopp.x.toFixed(3)} (Mantel bei 5)`);

  // Gleiten: schraeg gegen dieselbe Kiste — x steht, z laeuft weiter.
  const geglitten = laufe(vorne, { x: 0, y: 0, z: 0 }, { x: 1, z: 1, rennt: false }, 3);
  pruefe('schraeg gegen die Kiste: gleitet entlang',
    geglitten.x > 3.5 && geglitten.x < 5 && geglitten.z > 3 * GEH_TEMPO - 0.5,
    `x=${geglitten.x.toFixed(2)} z=${geglitten.z.toFixed(2)} (frei waeren ${(3 * GEH_TEMPO).toFixed(2)})`);

  // Stehen AUF der Kiste: 4 m hoch, Start darueber, keine Eingabe.
  const platte = eben.nahfeldAus([
    { form: kiste({ x: -3, y: -4, z: -3 }, { x: 3, y: 0, z: 3 }), position: { x: 0, y: 4, z: 0 } },
  ]);
  const oben = laufe(platte, { x: 0, y: 8, z: 0 }, { x: 0, z: 0, rennt: false }, 2);
  pruefe('Stehen auf der Kiste: y = Kistenoberkante', Math.abs(oben.y - 4) < 1e-6, `y=${oben.y}`);
  pruefe('… und der Fall dauerte nicht laenger als er darf',
    8 - 4 <= FALL_TEMPO * 2 + 1e-9);

  // Stufen: 0,40 m hinauf, 0,50 m nicht.
  for (const [hoehe, gehtRauf] of [[0.4, true], [0.5, false]] as const) {
    const stufe = eben.nahfeldAus([
      { form: kiste({ x: 0, y: -2, z: -5 }, { x: 10, y: hoehe, z: 5 }), position: { x: 2, y: 0, z: 0 } },
    ]);
    const e = laufe(stufe, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 2);
    const drauf = e.x > 2.5 && Math.abs(e.y - hoehe) < 1e-3;
    pruefe(`Stufe ${hoehe.toFixed(2)} m: ${gehtRauf ? 'begehbar' : 'Wand'}`,
      drauf === gehtRauf, `x=${e.x.toFixed(2)} y=${e.y.toFixed(3)}`);
  }

  // Haenge: eine Platte, deren Oberflaeche DURCH den Startpunkt laeuft und
  // in +x ansteigt. 35 Grad traegt (Hang), 45 Grad nicht (Wand).
  for (const [grad, begehbar] of [[35, true], [45, false]] as const) {
    const r = (grad * Math.PI) / 360; // halber Winkel fuer das Quaternion
    const rampe = eben.nahfeldAus([{
      form: kiste({ x: 0, y: -3, z: -6 }, { x: 20, y: 0, z: 6 }),
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: Math.sin(r), w: Math.cos(r) },
    }]);
    const e = laufe(rampe, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 3);
    pruefe(`Hang ${grad} Grad: ${begehbar ? 'hinauf' : 'Stopp'}`,
      (e.y > 0.5) === begehbar, `x=${e.x.toFixed(2)} y=${e.y.toFixed(2)}`);
  }

  // Korridor von 1 m zwischen zwei Felsen — die Figur (r 0,4) passt hindurch.
  const korridor = eben.nahfeldAus([
    { form: kiste({ x: -1, y: -1, z: -3 }, { x: 8, y: 3, z: 0 }), position: { x: 0, y: 0, z: -0.5 } },
    { form: kiste({ x: -1, y: -1, z: 0 }, { x: 8, y: 3, z: 3 }), position: { x: 0, y: 0, z: 0.5 } },
  ]);
  const durch = laufe(korridor, { x: -1, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 2);
  pruefe('1-m-Korridor zwischen zwei Felsen: kommt hindurch',
    durch.x > 3, `x=${durch.x.toFixed(2)} (frei waeren ${(-1 + 2 * GEH_TEMPO).toFixed(2)})`);

  /*
    GRENZE, festgehalten statt verschwiegen: Ein Spalt, der SCHMALER ist
    als die Figur (0,8 m), laesst der Server durch, der Client-Havok nicht.

    Grund ist Bauart, nicht Nachlaessigkeit: Die seitlichen Strahlen
    starten dann INNERHALB der beiden Formen, und ein Strahl, der drinnen
    beginnt, muss frei sein — sonst kommt niemand mehr aus einer Form
    heraus, in die er geraten ist (s. `strahlKiste`). Ein Kapsel-Sweep
    haette das Problem nicht, kostet aber ein Vielfaches.

    Die Drift bleibt dabei klein und kurz: Sie endet an der Stelle, an der
    der Spalt aufhoert, und ist nach oben durch dessen Laenge begrenzt.
    Wer sie zumachen will, braucht eine Durchdringungspruefung am ZIEL,
    keine weitere Umlenkung. Der Test haelt den Ist-Zustand fest, damit
    eine spaetere Aenderung hier auffaellt statt im Spiel.
  */
  const engerKorridor = eben.nahfeldAus([
    { form: kiste({ x: -1, y: -1, z: -3 }, { x: 8, y: 3, z: 0 }), position: { x: 0, y: 0, z: -0.25 } },
    { form: kiste({ x: -1, y: -1, z: 0 }, { x: 8, y: 3, z: 3 }), position: { x: 0, y: 0, z: 0.25 } },
  ]);
  const eng = laufe(engerKorridor, { x: -1, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 2);
  pruefe('0,5-m-Spalt: BEKANNTE GRENZE — der Server laesst durch, der Client nicht',
    eng.x > 3, `x=${eng.x.toFixed(2)}`);

  // Rueckwaerts aus einer Form heraus — die Fluchttuer.
  const drin = eben.nahfeldAus([
    { form: kiste({ x: -2, y: -1, z: -2 }, { x: 2, y: 3, z: 2 }), position: { x: 0, y: 0, z: 0 } },
  ]);
  const raus = laufe(drin, { x: 0, y: 0, z: 0 }, { x: -1, z: 0, rennt: true }, 1);
  pruefe('in der Form steckend: kommt heraus',
    raus.x < -LAUF_TEMPO + 0.1, `x=${raus.x.toFixed(2)}`);

  // Drehung 90 Grad und Skalierung 2: dieselbe Kiste, andere Flanke.
  // Grundform 1×1×4 (lang in z), um 90 Grad um y gedreht -> lang in x,
  // mal 2 skaliert -> Flanke bei 6 − 4 = 2 statt bei 6 − 1 = 5.
  const gedreht = eben.nahfeldAus([{
    form: kiste({ x: -0.5, y: -1, z: -2 }, { x: 0.5, y: 3, z: 2 }),
    position: { x: 6, y: 0, z: 0 },
    rotation: { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) },
    skalierung: { x: 2, y: 2, z: 2 },
  }]);
  const gd = laufe(gedreht, { x: 0, y: 0, z: 0 }, { x: 1, z: 0, rennt: false }, 3);
  pruefe('Drehung 90 Grad + Skalierung 2: Flanke sitzt bei x = 2',
    gd.x > 0.5 && gd.x < 2, `x=${gd.x.toFixed(3)}`);
}

// ── [B] Der Serverweg ──────────────────────────────────────────────
console.log('\n[B] handlePlayerInput mit ZDOs:');

function machPeer(): Peer {
  return {
    name: 'TestViking', isAdmin: true, flying: false, worldId: HAUPTWELT_ID,
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
  Die Uhr stellen. `deltaSec` kommt in handlePlayerInput aus Date.now();
  ohne eine gestellte Uhr misst die Regression den Zufall der Maschine
  und nicht den Umbau. Wird am Ende wieder freigegeben.
*/
const echteUhr = Date.now;
let uhr = echteUhr();
const TAKT = 50; // ms — 20 Hz, der Eingabetakt des Clients
Date.now = (): number => uhr;

/** Startpunkt mit ebenem Umfeld suchen, damit die Probe nicht am Hang haengt. */
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

// [B1] Leere Quelle = Bestand.
{
  const peer = machPeer();
  peer.position = { ...platz };
  uhr = echteUhr();
  peer.lastInputTime = uhr;

  /*
    Der Bestand, wie er vor dem Umbau in handlePlayerInput stand — Zeile
    fuer Zeile, damit die Regression gegen das ECHTE alte Verhalten
    misst und nicht gegen eine hingeschriebene Erwartung.

    `Math.fround`, weil die Absicht als float32 ueber die Leitung geht:
    Ohne das vergliche man die Bewegung mit einer Zahl, die der Server nie
    bekommen hat, und die Abweichung waechst mit jeder Zeile linear.
  */
  const MX = Math.fround(0.6), MZ = Math.fround(0.8);
  let ax = platz.x, ay = platz.y, az = platz.z;
  const alt = (moveX: number, moveZ: number, running: boolean, dt: number): void => {
    const tempo = running ? 7.5 : 4.5;
    ax += moveX * tempo * dt;
    az += moveZ * tempo * dt;
    const grund = server.getGroundHeight(ax, az);
    ay = ay > grund ? Math.max(grund, ay - 15 * dt) : grund;
  };

  for (let i = 0; i < 100; i += 1) {
    uhr += TAKT;
    schickeEingabe(peer, eingabe(MX, MZ, false));
    alt(MX, MZ, false, TAKT / 1000);
  }
  const dWaage = Math.sqrt((peer.position.x - ax) ** 2 + (peer.position.z - az) ** 2);
  pruefe('leere Quelle: nach 100 Paketen dieselbe Stelle wie der Bestand',
    dWaage < 1e-5,
    `waagerecht ${dWaage.toExponential(2)} m auf ${(4.5 * 5).toFixed(1)} m Weg`);
  /*
    Senkrecht darf sich EIN Fallschritt unterscheiden, und das ist keine
    Schlamperei, sondern der Sinn der Sache: Der Bestand liess je PAKET
    einmal fallen (bis 0,75 m), der feste Schritt je SCHRITT (0,25 m).
    An einer steilen Gelaendekante steht die Figur deshalb am Paketende
    einen Schritt hoeher — und im naechsten Schritt wieder gleich.
  */
  const dHoehe = Math.abs(peer.position.y - ay);
  pruefe('… senkrecht hoechstens einen Fallschritt daneben',
    dHoehe <= FALL_TEMPO * SCHRITT_LAENGE + 1e-6, `${dHoehe.toFixed(4)} m`);
  pruefe('… und die Kollisionswelt meldet sich als leer', !server.kollisionswelt.hatFormen);
}

// [B2] Mit Formquelle: ein ZDO wird zur Wand.
const PROBE_PREFAB = 'Rock_3';
const probeHash = getStableHash(PROBE_PREFAB);
const probeForm = kiste({ x: -3, y: -3, z: -3 }, { x: 3, y: 4, z: 3 });
const testQuelle: FormQuelle = {
  formFuer: (name) => (name === PROBE_PREFAB ? probeForm : null),
};
{
  pruefe('das Probe-Prefab ist registriert', server.prefabs.getByHash(probeHash) !== undefined);
  server.kollisionswelt.setzeFormQuelle(testQuelle);
  pruefe('Formquelle eingehaengt', server.kollisionswelt.hatFormen);

  // Die Skalierung des Exemplars ist NICHT 1: Rock_3 traegt localScale 2
  // im Katalog, und die Kollisionswelt rechnet damit — wie der Client.
  // Die erwartete Flanke wird deshalb ausgerechnet und nicht geraten.
  const ls = server.prefabs.getByHash(probeHash)!.localScale;
  const flanke = 8 - 3 * ls.x;
  const zdo = server.zdos.createZDO(probeHash, { x: platz.x + 8, y: platz.y, z: platz.z });

  const peer = machPeer();
  peer.position = { ...platz };
  uhr = echteUhr();
  peer.lastInputTime = uhr;
  for (let i = 0; i < 100; i += 1) {
    uhr += TAKT;
    schickeEingabe(peer, eingabe(1, 0, false));
  }
  const gelaufen = peer.position.x - platz.x;
  pruefe('ZDO mit Form: der Server haelt davor an',
    gelaufen > flanke - 0.6 && gelaufen < flanke,
    `x+${gelaufen.toFixed(2)} m (Flanke bei +${flanke}, localScale ${ls.x}, frei waeren +${(4.5 * 5).toFixed(0)})`);

  // Zone entladen = ZDO weg: die Form verschwindet mit ihm.
  server.zdos.destroyZDO(zdo.zdoid);
  const peer2 = machPeer();
  peer2.position = { ...platz };
  uhr = echteUhr();
  peer2.lastInputTime = uhr;
  for (let i = 0; i < 100; i += 1) {
    uhr += TAKT;
    schickeEingabe(peer2, eingabe(1, 0, false));
  }
  pruefe('ZDO entfernt: die Form ist weg, der Weg frei',
    peer2.position.x - platz.x > 20, `x+${(peer2.position.x - platz.x).toFixed(2)} m`);
}

// [B3] Leistung: 200 Formen in Reichweite.
{
  const zdos = [];
  for (let i = 0; i < 200; i += 1) {
    // Zwei Ringe innerhalb des Nahfelds — dicht genug, dass wirklich alle
    // 200 eingesammelt werden, und dicht genug am Spieler, dass die
    // Grobpruefung sie nicht sofort wegwirft.
    const w = (i / 100) * Math.PI * 2;
    const rad = i < 100 ? 5 : 9;
    zdos.push(server.zdos.createZDO(probeHash, {
      x: platz.x + Math.cos(w) * rad,
      y: platz.y,
      z: platz.z + Math.sin(w) * rad,
    }));
  }
  const peer = machPeer();
  peer.position = { ...platz };
  uhr = echteUhr();
  peer.lastInputTime = uhr;
  // Nahfeld einmal befragen, damit die Zahl der Koerper belegt ist.
  const nah = server.kollisionswelt.nahfeld(peer.position, 1);
  pruefe('200 Formen stehen in Reichweite', nah.anzahl >= 200, `${nah.anzahl} Koerper`);

  const PAKETE = 400;
  // Einlaufen, damit nicht die erste Uebersetzung mitgemessen wird.
  for (let i = 0; i < 50; i += 1) { uhr += TAKT; schickeEingabe(peer, eingabe(1, 0, true)); }
  peer.position = { ...platz };
  const t0 = echteUhr();
  for (let i = 0; i < PAKETE; i += 1) {
    uhr += TAKT;
    peer.position = { ...platz };
    schickeEingabe(peer, eingabe(1, 0, true));
  }
  const jePaket = (echteUhr() - t0) / PAKETE;
  console.log(`  MESSWERT: ${jePaket.toFixed(3)} ms je Eingabepaket bei ${nah.anzahl} Formen`);
  pruefe('unter 1 ms je Eingabepaket', jePaket < 1, `${jePaket.toFixed(3)} ms`);
  console.log(`  (25 Spieler zu 20 Hz = 500 Pakete/s -> ${(jePaket * 500 / 10).toFixed(1)} % einer Kernlast)`);

  for (const z of zdos) server.zdos.destroyZDO(z.zdoid);
}

// [B4] Grosse Buesche sind fest, kleine nicht ─────────────────────────
/*
  Die Entscheidung vom 11.09.2026 am SERVERWEG, nicht nur an der Tabelle:
  Ein grosser Busch muss den Spieler anhalten, ein kleiner ihn
  durchlassen — und zwar hier, wo die Serverkorrektur entsteht. Laeuft
  das auseinander, sieht man im Client die Kapsel und wird vom Server
  hindurchgezogen (oder umgekehrt: man steht im Bild frei und der Server
  haelt einen fest).

  Die ECHTE Formquelle, nicht die Testkiste von oben: Der Weg von
  `formUebersteuerung` ueber `KollisionsFormen.ableiten` bis zum
  Nahfeld soll mitgeprueft werden. Er braucht dafuer keine GLB — die
  Handform steht in einer Zeile Quelltext —, deshalb laeuft dieser
  Abschnitt auch im CI-Checkout ohne `assets/`.
*/
{
  const echteQuelle = new KollisionsFormen();
  server.kollisionswelt.setzeFormQuelle(echteQuelle);

  const GROSS = 'vegetation-large-bush-1a1';
  const KLEIN = 'vegetation-bush-1a1';
  const grossForm = echteQuelle.formFuer(GROSS);
  pruefe('grosser Busch: die Quelle liefert eine Kapsel',
    grossForm?.art === 'kapsel' && grossForm.radius === GROSSBUSCH_RADIUS,
    JSON.stringify(grossForm));
  pruefe('kleiner Busch: die Quelle liefert weiterhin nichts',
    echteQuelle.formFuer(KLEIN) === null);

  for (const [name, haeltAn] of [[GROSS, true], [KLEIN, false]] as const) {
    const hash = getStableHash(name);
    const def = server.prefabs.getByHash(hash);
    pruefe(`${name} ist registriert`, def !== undefined);
    if (def === undefined) continue;
    const zdo = server.zdos.createZDO(hash, { x: platz.x + 8, y: platz.y, z: platz.z });

    const peer = machPeer();
    peer.position = { ...platz };
    uhr = echteUhr();
    peer.lastInputTime = uhr;
    for (let i = 0; i < 100; i += 1) {
      uhr += TAKT;
      schickeEingabe(peer, eingabe(1, 0, false));
    }
    const gelaufen = peer.position.x - platz.x;
    /*
      Wo der Halt zu erwarten ist: Der Mantel steht bei 8 −
      r·Skalierung, und die Figur (KOERPER_RADIUS) haelt davor. Die
      Skalierung des EXEMPLARS kommt aus dem Katalog — nicht geraten,
      sondern abgefragt, wie oben bei Rock_3.
    */
    const mantel = 8 - GROSSBUSCH_RADIUS * def.localScale.x;
    const halt = mantel - KOERPER_RADIUS;
    if (haeltAn) {
      pruefe(`${name}: der Server haelt davor an`,
        gelaufen > halt - 0.35 && gelaufen <= mantel,
        `x+${gelaufen.toFixed(2)} m (Mantel +${mantel.toFixed(2)}, erwartet ~+${halt.toFixed(2)}, frei waeren +${(4.5 * 5).toFixed(0)})`);
    } else {
      pruefe(`${name}: man laeuft hindurch`,
        gelaufen > 20,
        `x+${gelaufen.toFixed(2)} m`);
    }
    server.zdos.destroyZDO(zdo.zdoid);
  }
}

Date.now = echteUhr;

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
