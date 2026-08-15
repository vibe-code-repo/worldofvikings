/**
 * RoutenLaeufer: Fortschritt entlang einer Route, Rundlauf, Umkehr,
 * Gelaendehoehe, Blickrichtung und der Wechsel steht/laeuft.
 *
 * Run: npx tsx test/h2-routen.ts   (aus server/)
 */
import { ANIM_MEMBER, getStableHash, sanitizeWorldLayout, type RouteDef } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { RoutenLaeufer } from '../src/world/RoutenLaeufer.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}
const nahe = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

const NPC = getStableHash('NPC_1');
/** Geneigtes Testgelaende: Hoehe haengt von x ab, damit sichtbar wird,
 *  dass die Y-Koordinate aus dem Boden kommt und nicht mitgeschleppt wird. */
const boden = (x: number, _z: number): number => 10 + x * 0.1;
/** Der Spieler steht am Ursprung — ohne ihn simuliert nichts (simRadius). */
const spieler = [{ x: 0, y: 0, z: 0 }];

/** Frischer NPC auf einer Route; Startposition = erster Wegpunkt. */
function baue(route: RouteDef, start = { x: 0, y: 0, z: 0 }) {
  const zdos = new ZDOManager(1n);
  const zdo = zdos.createZDO(NPC, { ...start, y: boden(start.x, start.z) });
  const laeufer = new RoutenLaeufer(zdos, boden);
  laeufer.registriere(zdo, route);
  return { zdos, zdo, laeufer };
}

// ── Fortschritt entlang der Route ────────────────────────────────────
{
  const route: RouteDef = { id: 'gerade', points: [[0, 0], [20, 0]], mode: 'loop', speed: 2 };
  const { zdo, laeufer } = baue(route);
  laeufer.update(1, spieler);
  check('Fortschritt: 2 m/s × 1 s = 2 m', nahe(zdo.position.x, 2), `= ${zdo.position.x}`);
  check('Fortschritt: Hoehe aus dem Gelaende', nahe(zdo.position.y, boden(2, 0)), `= ${zdo.position.y}`);
  check('Fortschritt: Gangart walk', zdo.getString(ANIM_MEMBER) === 'walk');
  // Blickrichtung: yaw = atan2(dx, dz) = +90° um die Hochachse.
  check('Fortschritt: schaut nach +x', nahe(zdo.rotation.y, Math.sin(Math.PI / 4), 1e-6), `= ${zdo.rotation.y}`);
  // Zeitschritt-Unabhaengigkeit: 10 × 0,1 s bringen dieselbe Strecke.
  for (let i = 0; i < 10; i++) laeufer.update(0.1, spieler);
  check('Fortschritt: kleine Ticks summieren sich', nahe(zdo.position.x, 4, 1e-9), `= ${zdo.position.x}`);
}

// ── Registrierung mitten auf der Strecke ─────────────────────────────
{
  const route: RouteDef = { id: 'gerade', points: [[0, 0], [20, 0]], mode: 'loop', speed: 2 };
  // NPC steht (aus dem Save) bei x = 18, also am NAECHSTEN Wegpunkt (20/0):
  // er darf nicht zum Anfang zurueckmarschieren.
  const { zdo, laeufer } = baue(route, { x: 18, y: 0, z: 0 });
  laeufer.update(1, spieler);
  check('Wiederaufnahme: laeuft zum naechsten Wegpunkt', zdo.position.x > 18, `= ${zdo.position.x}`);
}

// ── Rundlauf (loop) ──────────────────────────────────────────────────
{
  const route: RouteDef = {
    id: 'quadrat',
    points: [[0, 0], [10, 0], [10, 10], [0, 10]],
    mode: 'loop',
    speed: 10,
  };
  const { zdo, laeufer } = baue(route);
  // 4 s = 40 m = genau einmal herum (4 × 10 m).
  for (let i = 0; i < 4; i++) laeufer.update(1, spieler);
  check(
    'loop: nach einer Runde wieder am Start',
    nahe(zdo.position.x, 0, 1e-6) && nahe(zdo.position.z, 0, 1e-6),
    `= (${zdo.position.x}, ${zdo.position.z})`
  );
  laeufer.update(0.5, spieler);
  check('loop: laeuft ohne Halt weiter', nahe(zdo.position.x, 5, 1e-6), `= ${zdo.position.x}`);
}

// ── Umkehr (pingpong) ────────────────────────────────────────────────
{
  const route: RouteDef = { id: 'pendel', points: [[0, 0], [10, 0]], mode: 'pingpong', speed: 4 };
  const { zdo, laeufer } = baue(route);
  laeufer.update(2, spieler); // x = 8
  check('pingpong: hin', nahe(zdo.position.x, 8), `= ${zdo.position.x}`);
  laeufer.update(1, spieler); // 2 m bis zum Ende, 2 m zurueck ⇒ x = 8
  check('pingpong: kehrt am Ende um', nahe(zdo.position.x, 8), `= ${zdo.position.x}`);
  check('pingpong: schaut jetzt nach −x', zdo.rotation.y < 0, `= ${zdo.rotation.y}`);
  laeufer.update(2, spieler); // 8 m zurueck ⇒ x = 0
  check('pingpong: wieder am Anfang', nahe(zdo.position.x, 0, 1e-6), `= ${zdo.position.x}`);
  laeufer.update(0.5, spieler); // dort erneut umkehren ⇒ x = 2
  check('pingpong: kehrt am Anfang um', nahe(zdo.position.x, 2, 1e-6), `= ${zdo.position.x}`);
}

// ── Ein Tick ueber mehrere Wegpunkte hinweg ──────────────────────────
{
  const route: RouteDef = {
    id: 'eng',
    points: [[0, 0], [1, 0], [2, 0], [2, 1]],
    mode: 'loop',
    speed: 3,
  };
  const { zdo, laeufer } = baue(route);
  laeufer.update(1, spieler); // 3 m: zwei Wegpunkte ueberspringen, dann abbiegen
  check(
    'Hakelei: ein Tick laeuft ueber mehrere Wegpunkte',
    nahe(zdo.position.x, 2) && nahe(zdo.position.z, 1),
    `= (${zdo.position.x}, ${zdo.position.z})`
  );
}

// ── Standposten: steht → idle ────────────────────────────────────────
{
  const route: RouteDef = { id: 'posten', points: [[6, 0]], mode: 'loop', speed: 2 };
  const { zdo, laeufer } = baue(route);
  laeufer.update(1, spieler);
  check('Standposten: laeuft erst hin (walk)', zdo.getString(ANIM_MEMBER) === 'walk');
  for (let i = 0; i < 5; i++) laeufer.update(1, spieler);
  check('Standposten: bleibt auf dem Punkt', nahe(zdo.position.x, 6, 1e-6), `= ${zdo.position.x}`);
  check('Standposten: Gangart idle', zdo.getString(ANIM_MEMBER) === 'idle');
}

// ── Niemand in der Naehe: keine Simulation ───────────────────────────
{
  const route: RouteDef = { id: 'gerade', points: [[0, 0], [500, 0]], mode: 'loop', speed: 2 };
  const { zdo, laeufer } = baue(route);
  laeufer.update(1, [{ x: 5000, y: 0, z: 0 }]);
  check('Fern: NPC bleibt unberuehrt', nahe(zdo.position.x, 0), `= ${zdo.position.x}`);
  laeufer.update(1, []);
  check('Fern: ohne Spieler passiert nichts', nahe(zdo.position.x, 0));
}

// ── Zerstoerte ZDO faellt aus der Verwaltung ─────────────────────────
{
  const route: RouteDef = { id: 'gerade', points: [[0, 0], [20, 0]], mode: 'loop', speed: 2 };
  const { zdos, zdo, laeufer } = baue(route);
  zdos.destroyZDO(zdo.zdoid);
  laeufer.update(1, spieler);
  check('Aufraeumen: zerstoerter NPC wird vergessen', laeufer.npcCount === 0, `= ${laeufer.npcCount}`);
}

// ── Route aus einem echten Layout-Dokument ───────────────────────────
{
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Routenwelt',
    detailSeed: 'h2',
    continents: [],
    regions: [],
    routes: [{ id: 'wache', points: [[0, 0], [12, 0]], mode: 'pingpong', speed: 1 }],
    placements: [{ prefab: 'NPC_1', x: 0, z: 0, route: 'wache' }],
  })!;
  const route = layout.routes![0]!;
  const { zdo, laeufer } = baue(route);
  laeufer.update(3, spieler);
  check('Dokument: Route aus dem Layout laeuft', nahe(zdo.position.x, 3), `= ${zdo.position.x}`);
  check('Dokument: Platzierung referenziert die Route', layout.placements![0]!.route === 'wache');
}

if (fehler > 0) {
  console.error(`\n${fehler} Pruefung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== H2-ROUTEN: ALL PASSED ===');
