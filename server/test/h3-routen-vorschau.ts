/**
 * Vorschau == Server: Beide laufen dieselbe Route mit derselben Mathematik.
 *
 * Der Editor-Testflug laesst Routen-NPCs schon vor dem Speichern laufen
 * (client/src/editor/RoutenVorschau.ts). Damit das ueberhaupt einen Sinn
 * hat, MUSS die Vorschau Schritt fuer Schritt dieselben Positionen
 * liefern wie der Server — sonst gestaltet man nach einem Bild, das die
 * fertige Welt nie zeigt.
 *
 * Geprueft wird genau das: Die Serverseite (RoutenLaeufer + ZDO) und die
 * nackte geteilte Mathematik (shared: RoutenLauf), wie sie der Client
 * benutzt, werden mit identischen Eingaben gefahren und Frame fuer Frame
 * verglichen — Position, Hoehe und Gangart.
 *
 * Run: npx tsx test/h3-routen-vorschau.ts   (aus server/)
 */
import {
  ANIM_MEMBER,
  VERFOLGUNG_ANTEIL,
  aggroSchritt,
  getStableHash,
  npcKampf,
  RoutenLauf,
  type RouteDef,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { RoutenLaeufer } from '../src/world/RoutenLaeufer.js';
import { AggroSystem } from '../src/world/AggroSystem.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const NPC = getStableHash('NPC_1');
/** Geneigtes Testgelaende wie in h2 — die Hoehe kommt aus dem Boden. */
const boden = (x: number, _z: number): number => 10 + x * 0.1;
const spieler = [{ x: 0, y: 0, z: 0 }];

/**
 * Die Vorschau in Reinform: eigene xz-Position, Hoehe aus dem Gelaende,
 * Gangart aus `bewegt` — exakt die Schleife aus RoutenVorschau.update(),
 * nur ohne Babylon-Szene.
 */
function vorschauLauf(
  route: RouteDef,
  start: { x: number; z: number },
  schritte: readonly number[]
): Array<{ x: number; y: number; z: number; anim: string }> {
  const lauf = new RoutenLauf(route, start.x, start.z);
  let x = start.x;
  let z = start.z;
  let anim = 'idle';
  const spur: Array<{ x: number; y: number; z: number; anim: string }> = [];
  for (const dt of schritte) {
    const s = lauf.schritt(x, z, dt);
    if (s.bewegt) {
      x = s.x;
      z = s.z;
    }
    anim = s.bewegt ? 'walk' : 'idle';
    spur.push({ x, y: boden(x, z), z, anim });
  }
  return spur;
}

/** Dieselbe Route auf dem Server, Tick fuer Tick. */
function serverLauf(
  route: RouteDef,
  start: { x: number; z: number },
  schritte: readonly number[]
): Array<{ x: number; y: number; z: number; anim: string }> {
  const zdos = new ZDOManager(1n);
  const zdo = zdos.createZDO(NPC, { x: start.x, y: boden(start.x, start.z), z: start.z });
  const laeufer = new RoutenLaeufer(zdos, boden);
  laeufer.registriere(zdo, route);
  const spur: Array<{ x: number; y: number; z: number; anim: string }> = [];
  for (const dt of schritte) {
    laeufer.update(dt, spieler);
    spur.push({
      x: zdo.position.x,
      y: zdo.position.y,
      z: zdo.position.z,
      anim: zdo.getString(ANIM_MEMBER) ?? 'idle',
    });
  }
  return spur;
}

/** Erster abweichender Frame, sonst −1. */
function ersteAbweichung(
  a: ReadonlyArray<{ x: number; y: number; z: number; anim: string }>,
  b: ReadonlyArray<{ x: number; y: number; z: number; anim: string }>
): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return i;
    if (Math.abs(p.x - q.x) > 1e-9) return i;
    if (Math.abs(p.y - q.y) > 1e-9) return i;
    if (Math.abs(p.z - q.z) > 1e-9) return i;
    if (p.anim !== q.anim) return i;
  }
  return -1;
}

function vergleiche(name: string, route: RouteDef, start: { x: number; z: number }): void {
  // Ungleichmaessige Zeitschritte: Ein Browser-Frame ist nie 16,7 ms lang,
  // und genau an den Wegpunkt-Uebergaengen faellt Ungleichheit auf.
  const schritte: number[] = [];
  for (let i = 0; i < 400; i++) schritte.push(0.01 + (i % 7) * 0.013);
  const v = vorschauLauf(route, start, schritte);
  const s = serverLauf(route, start, schritte);
  const i = ersteAbweichung(v, s);
  check(
    `${name}: Vorschau und Server laufen identisch (${schritte.length} Frames)`,
    i < 0,
    i < 0 ? '' : `erste Abweichung bei Frame ${i}: ${JSON.stringify(v[i])} vs ${JSON.stringify(s[i])}`
  );
}

// ── Dieselbe Positionsfolge bei gleichen Eingaben ────────────────────
vergleiche('loop', { id: 'a', points: [[0, 0], [10, 0], [10, 10], [0, 10]], mode: 'loop', speed: 3 }, { x: 0, z: 0 });
vergleiche('pingpong', { id: 'b', points: [[0, 0], [12, 0]], mode: 'pingpong', speed: 4 }, { x: 0, z: 0 });
vergleiche('enge Punkte', { id: 'c', points: [[0, 0], [1, 0], [2, 0], [2, 1]], mode: 'loop', speed: 9 }, { x: 0, z: 0 });
vergleiche('Standposten', { id: 'd', points: [[6, 0]], mode: 'loop', speed: 2 }, { x: 0, z: 0 });
// Einstieg mitten auf der Strecke: beide muessen denselben Wegpunkt waehlen.
vergleiche('Wiedereinstieg', { id: 'e', points: [[0, 0], [20, 0], [20, 20]], mode: 'loop', speed: 2 }, { x: 18, z: 1 });

// ── Pausen: gleiche Positions- UND Animationsfolge ───────────────────
vergleiche(
  'Pause (loop)',
  { id: 'p1', points: [[0, 0], [10, 0, 2], [10, 10], [0, 10, 0.3]], mode: 'loop', speed: 3 },
  { x: 0, z: 0 }
);
vergleiche(
  'Pause (pingpong, an beiden Enden)',
  { id: 'p2', points: [[0, 0, 1.5], [8, 0, 2.5]], mode: 'pingpong', speed: 2 },
  { x: 0, z: 0 }
);
vergleiche(
  'Pause am Rundschluss (loop, letzter Punkt)',
  { id: 'p3', points: [[0, 0], [6, 0], [6, 6, 4]], mode: 'loop', speed: 3 },
  { x: 0, z: 0 }
);
// Nur Pausen, kein Weg: alle Wegpunkte auf derselben Stelle. Darf weder
// haengen noch als Bewegung durchgehen.
vergleiche(
  'Route aus lauter Pausen',
  { id: 'p4', points: [[0, 0, 1], [0, 0, 1], [0, 0, 1]], mode: 'loop', speed: 2 },
  { x: 0, z: 0 }
);
// Sehr grosse Zeitschritte: Ein einziger Tick verschluckt mehrere Pausen
// UND Wegstrecken — Server und Vorschau muessen trotzdem gleich landen.
{
  const route: RouteDef = {
    id: 'p5',
    points: [[0, 0, 0.4], [5, 0, 0.4], [5, 5, 0.4], [0, 5, 0.4]],
    mode: 'loop',
    speed: 6,
  };
  const schritte = [3, 0.5, 7, 0.2, 11, 1];
  const v = vorschauLauf(route, { x: 0, z: 0 }, schritte);
  const s = serverLauf(route, { x: 0, z: 0 }, schritte);
  check(
    'Grosse Zeitschritte: Vorschau und Server bleiben gleich',
    ersteAbweichung(v, s) < 0,
    JSON.stringify({ v, s })
  );
}

// ── Die Falle: Umkehrpunkt bei pingpong pausiert nur EINMAL ──────────
// Hin und zurueck beruehren denselben Punkt. Wer die Pause an die
// Ankunft haengt und die Umkehr getrennt behandelt, wartet dort zweimal.
{
  const route: RouteDef = { id: 'kehre', points: [[0, 0], [10, 0, 4]], mode: 'pingpong', speed: 1 };
  const dt = 0.25;
  const spur = vorschauLauf(route, { x: 0, z: 0 }, new Array(80).fill(dt) as number[]);
  // 10 s Hinweg (Frames 0–39), dann 4 s Pause (Frames 40–55), dann zurueck.
  const idleFenster = spur.filter((p, i) => i >= 40 && i < 56 && p.anim === 'idle').length;
  check('pingpong: Pause am Umkehrpunkt dauert genau 4 s', idleFenster === 16, `= ${idleFenster}`);
  check('pingpong: waehrend der Pause steht er auf dem Punkt', Math.abs(spur[47]!.x - 10) < 1e-9, `= ${spur[47]!.x}`);
  check('pingpong: unmittelbar danach laeuft er (walk)', spur[56]!.anim === 'walk');
  // Bei doppelter Pause stuende er hier noch immer bei x = 10.
  check('pingpong: nach 16 s zurueck bei x = 8', Math.abs(spur[63]!.x - 8) < 1e-9, `= ${spur[63]!.x}`);
  // Und die Gegenseite (Punkt 0, ohne Pause) haelt gar nicht an.
  const spurLang = vorschauLauf(route, { x: 0, z: 0 }, new Array(120).fill(dt) as number[]);
  check(
    'pingpong: Punkt ohne Pause haelt nicht an',
    spurLang.slice(94, 100).every((p) => p.anim === 'walk'),
    JSON.stringify(spurLang.slice(94, 100))
  );
  // Server und Vorschau sind sich auch hier einig.
  vergleiche('Umkehrpunkt mit Pause', route, { x: 0, z: 0 });

  // Blickrichtung friert waehrend der Pause ein — ein NPC, der sich beim
  // Warten schon zum naechsten Punkt dreht, wirkt nervös.
  const lauf = new RoutenLauf(route, 0, 0);
  const hin = lauf.schritt(0, 0, 10); // genau am Umkehrpunkt angekommen
  const beimWarten = lauf.schritt(hin.x, hin.z, 2); // mitten in der Pause
  check('Pause: Blickrichtung bleibt stehen', beimWarten.yaw === hin.yaw, `${beimWarten.yaw} vs ${hin.yaw}`);
  check('Pause: Restzeit wird gemeldet', Math.abs(beimWarten.wartet - 2) < 1e-9, `= ${beimWarten.wartet}`);
  check('Pause: gilt als Stillstand (idle)', !beimWarten.bewegt);
}

// ── Blickrichtung: dieselbe Drehung wie auf dem Server ───────────────
{
  const route: RouteDef = { id: 'f', points: [[0, 0], [0, -10]], mode: 'loop', speed: 5 };
  const lauf = new RoutenLauf(route, 0, 0);
  const s = lauf.schritt(0, 0, 1);
  const zdos = new ZDOManager(1n);
  const zdo = zdos.createZDO(NPC, { x: 0, y: boden(0, 0), z: 0 });
  const laeufer = new RoutenLaeufer(zdos, boden);
  laeufer.registriere(zdo, route);
  laeufer.update(1, spieler);
  // Server: yawQuaternion(yaw) — dieselbe Quelle, hier nur nachgerechnet.
  check(
    'Blickrichtung: gleicher Gierwinkel',
    Math.abs(Math.sin(s.yaw / 2) - zdo.rotation.y) < 1e-9,
    `sin(yaw/2)=${Math.sin(s.yaw / 2)} vs zdo.y=${zdo.rotation.y}`
  );
}

// ── Live-Aenderungen der Vorschau (Server sieht nur fertige Layouts) ──
{
  // Wegpunkt VERSCHOBEN (Anzahl gleich): Der NPC behaelt sein Ziel und
  // zieht zur neuen Stelle — sonst suchte er sich bei jeder Mausbewegung
  // einen anderen Wegpunkt.
  const route: RouteDef = { id: 'g', points: [[0, 0], [20, 0]], mode: 'loop', speed: 2 };
  const lauf = new RoutenLauf(route, 0, 0);
  lauf.schritt(0, 0, 1);
  check('Live: Ziel ist der zweite Punkt', lauf.ziel === 1, `= ${lauf.ziel}`);
  lauf.setzeRoute({ ...route, points: [[0, 0], [20, 20]] }, 2, 0);
  check('Live: verschobener Wegpunkt behaelt das Ziel', lauf.ziel === 1, `= ${lauf.ziel}`);
  const s = lauf.schritt(2, 0, 1);
  check('Live: laeuft zur neuen Stelle', s.z > 0, `z = ${s.z}`);

  // Punkt ANGEHAENGT (Anzahl geaendert): Neueinstieg am naechstgelegenen
  // Punkt, weil der alte Index jetzt auf etwas anderes zeigen kann.
  const lauf2 = new RoutenLauf(route, 0, 0);
  lauf2.schritt(0, 0, 1);
  lauf2.setzeRoute({ ...route, points: [[0, 0], [20, 0], [20, 20]] }, 19, 0);
  check('Live: neuer Wegpunkt ⇒ Neueinstieg am naechsten', lauf2.ziel === 1, `= ${lauf2.ziel}`);

  // Tempo geaendert: sofort wirksam, ohne den Lauf abzureissen.
  const lauf3 = new RoutenLauf(route, 0, 0);
  const a = lauf3.schritt(0, 0, 1);
  lauf3.setzeRoute({ ...route, speed: 8 }, a.x, a.z);
  const b = lauf3.schritt(a.x, a.z, 1);
  check('Live: neues Tempo greift sofort', Math.abs(b.x - a.x - 8) < 1e-9, `Δx = ${b.x - a.x}`);
}

// ── Aggro: bemerken — nachsetzen — zuschlagen ───────────────────────
// Die drei Baender aus shared/aggro.ts. Der NPC steht bei (0, d), der
// Spieler im Ursprung; d ist damit direkt der Abstand, und der Schritt
// geht nach -z.
{
  const NAME = 'FurlocKrieger';
  const k = npcKampf(NAME);
  const ziel = [{ x: 0, z: 0 }];
  const bei = (d: number, dt = 0) => aggroSchritt(NAME, 0, d, ziel, dt);
  const verfolgung = k.aggro * VERFOLGUNG_ANTEIL;

  check('Aggro: jenseits des Radius gar nichts', bei(k.aggro + 0.1) === null);
  const weit = bei(k.aggro - 0.1)!;
  check('Aggro: bemerkt, aber weit ⇒ nur hindrehen',
        weit.anim === 'idle' && !weit.bewegt, `= ${weit.anim}`);
  const nah = bei(verfolgung - 0.1, 1)!;
  check('Aggro: ab der Haelfte des Radius ⇒ nachsetzen',
        nah.anim === 'walk' && nah.bewegt, `= ${nah.anim}`);
  check('Aggro: Schritt = tempo × dt',
        Math.abs(verfolgung - 0.1 - nah.z - k.tempo) < 1e-9, `Δz = ${verfolgung - 0.1 - nah.z}`);
  const drin = bei(k.angriff - 0.1, 1)!;
  check('Aggro: in Reichweite ⇒ zuschlagen und STEHEN',
        drin.anim === 'attack' && !drin.bewegt, `= ${drin.anim}`);
  // Der Kappungsfall: Ein grosser Zeitschritt darf ihn nicht durch den
  // Spieler hindurchtragen — er haelt genau auf Angriffsreichweite.
  const kappung = bei(k.angriff + 0.4, 10)!;
  check('Aggro: Schritt wird an der Angriffsreichweite gekappt',
        Math.abs(kappung.z - k.angriff) < 1e-9, `z = ${kappung.z}`);

  // Und dasselbe durch den SERVER: Das AggroSystem muss die ZDO wirklich
  // bewegen, nicht nur den Member schreiben.
  const zdos = new ZDOManager(1n);
  const start = verfolgung - 1;
  const zdo = zdos.createZDO(getStableHash(NAME), { x: 0, y: boden(0, start), z: start });
  const aggro = new AggroSystem(zdos, () => NAME, boden, { pruefIntervallSec: 0.25 });
  aggro.update(0.25, [{ x: 0, y: 0, z: 0 }]);
  check('Aggro/Server: ZDO rueckt nach',
        zdo.position.z < start - 1e-9, `z ${start} -> ${zdo.position.z}`);
  check('Aggro/Server: Gangart walk im Member',
        zdo.getString(ANIM_MEMBER) === 'walk', `= ${zdo.getString(ANIM_MEMBER)}`);
  check('Aggro/Server: Hoehe kommt aus dem Gelaende',
        Math.abs(zdo.position.y - boden(zdo.position.x, zdo.position.z)) < 1e-9);
  check('Aggro/Server: gesperrt fuer den RoutenLaeufer', aggro.aggroCount === 1);
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== H3-ROUTEN-VORSCHAU: ALL PASSED ===');
