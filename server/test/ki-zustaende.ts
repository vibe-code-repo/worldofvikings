/**
 * D4 — KI-Zustandsmaschine der Kreaturen.
 *
 * Reine Logik (`shared/src/kiZustand.ts`) und das SpawnSystem mit echten ZDOs,
 * ohne Netz und ohne Weltgenerierung (flaches Gelände als Stellvertreter,
 * wie `wolf-rudel-begrenzung.ts`). Jeder Fall nennt seine Zahlen.
 *
 *  [1]  Steckbriefe liegen in ihren Spannen; Tiere haben keine KI.
 *  [2]  Wanderradius: ein wandernder Wolf bleibt in min(Wanderradius, Leine).
 *  [3]  Sicht 230°: hinter der Kreatur bleibt unbemerkt, Hören nur über Lärm.
 *  [4]  Leine: die Verfolgung bricht ab, der Wolf kehrt heim.
 *  [5]  Verfolgung endet nach der Zeit (blockiert) und nach der Strecke.
 *  [6]  Verfall: nach 20 s ohne Reiz lässt die Kreatur los.
 *  [7]  Rückzug: Wahrscheinlichkeit über viele Würfe mit festem Seed.
 *  [8]  Aggro-Tabelle: mehrere Angreifer, der größte Schaden zählt.
 *  [9]  Drei Wölfe: Ein Wolf jenseits seiner Leine zieht die anderen nicht mit.
 *  [10] Fels: der Wolf bleibt davor stehen (Abstand ≥ Fels- plus Kreaturradius).
 *  [11] Umlaufen: bei Rückenansicht läuft der Wolf im Bogen zur Vorderseite.
 *  [12] NPC-Steckbrief deckt die Bänder von `aggroSchritt` (Editor-Vorschau).
 *
 * Run: npx tsx server/test/ki-zustaende.ts   (from the repo root or server/)
 */
import {
  AGGRO_VERFALL_SEC,
  NPC_KAMPF,
  SPAWN_TABLE,
  VERFOLGUNG_ANTEIL,
  XorShiftRandom,
  aggroSchritt,
  getStableHash,
  HEALTH_MEMBER,
  kiLaerm,
  kiReiz,
  kiSchritt,
  neuerKiZustand,
  npcKampf,
  npcSteckbrief,
  sieht,
  yawQuaternion,
  type KiBefehl,
  type KiSteckbrief,
  type KiWelt,
  type KiZiel,
  type SpawnEntry,
  type Vector3,
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import type { ZDO } from '../src/zdo/ZDO.js';
import { PrefabManager } from '../src/prefab/PrefabManager.js';
import { SpawnSystem } from '../src/world/SpawnSystem.js';
import { Kollisionswelt } from '../src/world/Kollisionswelt.js';
import { KI_SPANNEN, alleSteckbriefe, steckbriefFuer } from '../src/spiel/KreaturenSteckbriefe.js';
import type { FormQuelle } from '@wov/shared/src/kollision/form.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const f = (n: number, k = 2): string => n.toFixed(k);

const WOLF = steckbriefFuer('Wolf')!;
const WOLF_KI = WOLF.ki!;
const WOLF_HASH = getStableHash('Wolf');
const BODEN_Y = 50;

function wolfEintrag(ueber: Partial<SpawnEntry> = {}): SpawnEntry {
  const basis = SPAWN_TABLE.find((e) => e.prefab === 'Wolf');
  if (!basis) throw new Error('Wolf not in SPAWN_TABLE');
  // spawnChance 0 / globalMax 0: only the wolves placed by hand exist.
  return { ...basis, spawnChance: 0, globalMax: 0, ...ueber };
}

/** Ein SpawnSystem über echten ZDOs; Gelände ist flach, Zonen gelten als erzeugt. */
function baue(table: readonly SpawnEntry[], seed = 1, opt: { kollision?: Kollisionswelt } = {}) {
  const zdos = new ZDOManager(1n);
  const hm = { getGroundHeight: (): number => BODEN_Y };
  const zones = { isZoneGenerated: (): boolean => true };
  const spawns = new SpawnSystem(zdos, {} as never, hm as never, zones as never, {
    rng: new XorShiftRandom(seed),
    table,
  });
  if (opt.kollision) spawns.kollision = opt.kollision;
  return { zdos, spawns };
}

function setzeWolf(zdos: ZDOManager, x: number, z: number, yaw: number): ZDO {
  const zdo = zdos.createZDO(WOLF_HASH, { x, y: BODEN_Y, z }, yawQuaternion(yaw));
  zdo.setInt(HEALTH_MEMBER, 30);
  return zdo;
}

const abstand = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

// ── Reine Logik: ein Schritt-Treiber ───────────────────────────────
interface Figur {
  x: number;
  z: number;
  yaw: number;
  gelaufen: number;
}
function welt(fig: Figur, ziele: readonly KiZiel[], home = { x: 0, z: 0 }, darf = true): KiWelt {
  return { x: fig.x, z: fig.z, yaw: fig.yaw, homeX: home.x, homeZ: home.z, ziele, zuletztGelaufen: fig.gelaufen, darfSchlagen: darf };
}
/** Bewegt die Figur wie der Server: laufen mit Tempo, gekappt auf maxWeg. */
function bewege(fig: Figur, b: KiBefehl, tempo: number, dt: number): void {
  fig.gelaufen = 0;
  if (b.bewegung !== 'laeuft') return;
  const weg = Math.min(tempo * dt, b.maxWeg);
  if (weg <= 0) return;
  fig.x += b.dirX * weg;
  fig.z += b.dirZ * weg;
  fig.gelaufen = weg;
}

// ── [1] Steckbriefe ────────────────────────────────────────────────
console.log('\n[1] Steckbriefe: Werte in den Spannen, Tiere ohne KI');
{
  const ki = WOLF_KI as unknown as Record<string, number>;
  const aus: string[] = [];
  for (const [feld, [lo, hi]] of Object.entries(KI_SPANNEN)) {
    const v = ki[feld];
    if (!(v >= lo && v <= hi)) aus.push(`${feld}=${v} ausserhalb ${lo}..${hi}`);
  }
  check('Wolf: jeder Wert liegt in seiner Spanne', aus.length === 0, aus.join('; ') || `${Object.keys(KI_SPANNEN).length} Werte`);
  check('Wolf: Verfolgungsstrecke 15 m, Haltesicht = Sicht', WOLF_KI.verfolgungM === 15 && WOLF_KI.haltSicht === WOLF_KI.sicht);
  check('Wolf: Verfall ist die Vorgabe 20 s', WOLF_KI.verfallSec === AGGRO_VERFALL_SEC);
  check('Kuh und Huhn: keine Zustandsmaschine (Tiere behalten ihr Verhalten)', steckbriefFuer('Kuh')!.ki === null && steckbriefFuer('Huhn')!.ki === null);
  check('alle Steckbriefe haben einen Körperradius > 0', [...alleSteckbriefe().values()].every((b) => b.koerperRadius > 0));
}

// ── [2] Wanderradius ───────────────────────────────────────────────
console.log('\n[2] Wanderradius: der Wolf bleibt in min(Wanderradius, Leine) um seinen Anker');
{
  const eintrag = wolfEintrag();
  const { zdos, spawns } = baue([eintrag], 11);
  const zdo = setzeWolf(zdos, 0, 0, 0);
  spawns.adoptPersisted();
  const peer: Vector3 = { x: 100, y: BODEN_Y, z: 0 }; // in der Simulation, weit ausser Sicht
  let maxAbstand = 0;
  let gelaufen = 0;
  let letzte = { ...zdo.position };
  for (let i = 0; i < 9000; i++) {
    spawns.update(0.1, [peer]);
    maxAbstand = Math.max(maxAbstand, abstand(zdo.position, { x: 0, z: 0 }));
    gelaufen += abstand(zdo.position, letzte);
    letzte = { ...zdo.position };
  }
  const grenze = Math.min(eintrag.wanderRadius, WOLF_KI.leine);
  check(`900 s Wandern: nie weiter als min(${eintrag.wanderRadius}, Leine ${WOLF_KI.leine}) = ${grenze} m (+ Ankunftstoleranz 0,4 m)`, maxAbstand <= grenze + 0.4 + 0.5, `max ${f(maxAbstand)} m`);
  check('… und er wandert tatsächlich (Zeuge gegen Stillstand)', maxAbstand > 3 && gelaufen > 100, `max ${f(maxAbstand)} m, Weg ${f(gelaufen, 0)} m`);
  check('der Eintrag selbst erlaubt mehr als die Leine (die Kappung wirkt)', eintrag.wanderRadius > WOLF_KI.leine, `${eintrag.wanderRadius} > ${WOLF_KI.leine}`);
}

// ── [3] Sicht 230° und Hören ───────────────────────────────────────
console.log('\n[3] Sichtwinkel 230°: hinter der Kreatur unbemerkt; Hören nur über Lärm');
{
  // Blick +z (yaw 0). Ziel bei Winkel a von der Blickrichtung.
  const bei = (gradVomBlick: number, d: number): boolean => {
    const a = (gradVomBlick * Math.PI) / 180;
    return sieht(WOLF_KI, 0, 0, 0, Math.sin(a) * d, Math.cos(a) * d);
  };
  check('0° (vorn) in 10 m: gesehen', bei(0, 10));
  check('114° (Kegelrand 115°) in 10 m: gesehen', bei(114, 10));
  check('116° in 10 m: nicht gesehen', !bei(116, 10));
  check('180° (direkt hinter der Kreatur) in 3 m: nicht gesehen', !bei(180, 3));
  check('0° in 18 m (Sicht 17 m): nicht gesehen', !bei(0, 18));

  // Im SpawnSystem: der Wolf steht (kein Wandern), der Spieler direkt hinter ihm.
  const stehend = wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 });
  const { zdos, spawns } = baue([stehend], 3);
  const zdo = setzeWolf(zdos, 0, 0, 0); // blickt +z
  spawns.adoptPersisted();
  const hinter: Vector3 = { x: 0, y: BODEN_Y, z: -6 };
  const info = [{ id: 'p0', blick: null }];
  for (let i = 0; i < 100; i++) spawns.update(0.1, [hinter], [hinter], info);
  check('Spieler 6 m direkt hinter dem Wolf, 10 s lang und still: nicht bemerkt', spawns.kiPhase(zdo) === 'wandern', `Phase ${spawns.kiPhase(zdo)}`);
  // Lärm ausserhalb des Hörradius (30 m): nichts.
  spawns.laerm('p0', { x: 0, y: BODEN_Y, z: -40 });
  spawns.update(0.1, [hinter], [hinter], info);
  check('Lärm 40 m entfernt (Hörradius 30 m): nicht gehört', spawns.kiPhase(zdo) === 'wandern', `Phase ${spawns.kiPhase(zdo)}`);
  // Lärm des Spielers im Hörradius: der Wolf bemerkt ihn trotz Rückenlage.
  spawns.laerm('p0', hinter);
  spawns.update(0.1, [hinter], [hinter], info);
  const nach = spawns.kiPhase(zdo);
  check('Lärm des Spielers 6 m hinter dem Wolf (im Hörradius): bemerkt', nach === 'bemerkt' || nach === 'anrennen', `Phase ${nach}`);
  for (let i = 0; i < 30; i++) spawns.update(0.1, [hinter], [hinter], info);
  const gedreht = 2 * Math.atan2(zdo.rotation.y, zdo.rotation.w);
  check('der Wolf hat sich dem Spieler zugedreht (Blick −z)', Math.abs(Math.cos(gedreht) + 1) < 0.2 || Math.abs(Math.abs(gedreht) - Math.PI) < 0.5, `yaw ${f(gedreht)}`);
}

// ── [4] Leine ──────────────────────────────────────────────────────
console.log('\n[4] Leine: die Verfolgung bricht ab, der Wolf kehrt heim');
{
  const { zdos, spawns } = baue([wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 })], 5);
  const zdo = setzeWolf(zdos, 0, 0, Math.PI / 2); // blickt +x
  spawns.adoptPersisted();
  const spieler: Vector3 = { x: 14, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  const phasen: string[] = [];
  let maxHeim = 0;
  let heimPhaseBeiAbstand = -1;
  for (let i = 0; i < 200; i++) {
    spieler.x += 4.5 * 0.1; // der Spieler läuft mit Gehtempo davon
    spawns.update(0.1, [spieler], [spieler], info);
    const ph = spawns.kiPhase(zdo) ?? '?';
    if (phasen[phasen.length - 1] !== ph) {
      phasen.push(ph);
      if (ph === 'heimkehren') heimPhaseBeiAbstand = abstand(zdo.position, { x: 0, z: 0 });
    }
    maxHeim = Math.max(maxHeim, abstand(zdo.position, { x: 0, z: 0 }));
  }
  check('Phasenfolge: bemerkt → anrennen → heimkehren → wandern', phasen.join('>') === 'wandern>bemerkt>anrennen>heimkehren>wandern', phasen.join('>'));
  check(`der Wolf überschreitet die Leine ${WOLF_KI.leine} m nicht um mehr als einen Schritt`, maxHeim <= WOLF_KI.leine + 0.6, `max ${f(maxHeim)} m`);
  check('der Abbruch geschieht an der Leine, nicht früher', heimPhaseBeiAbstand > WOLF_KI.leine - 0.6, `bei ${f(heimPhaseBeiAbstand)} m`);
  check('nach 20 s steht der Wolf wieder am Anker (< 0,6 m)', abstand(zdo.position, { x: 0, z: 0 }) < 0.6, `${f(abstand(zdo.position, { x: 0, z: 0 }))} m`);
}

// ── [5] Verfolgung: Zeit und Strecke ───────────────────────────────
console.log('\n[5] Verfolgung endet nach der gewählten Zeit und nach der Strecke');
{
  // Ohne Leine, um Zeit und Strecke einzeln zu sehen.
  const frei: KiSteckbrief = { ...WOLF_KI, leine: Infinity };
  const dt = 0.05;
  const rng = (): number => 0.5;
  const ziel: KiZiel = { key: 'p0', x: 0, z: 8 };

  // (a) Blockiert (kommt nicht voran): nur die Zeit begrenzt.
  {
    const z = neuerKiZustand();
    const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
    const s: KiSteckbrief = { ...frei, verfolgungM: Infinity };
    let t = 0;
    let anrennenAb = -1;
    let ende = -1;
    for (let i = 0; i < 600 && ende < 0; i++) {
      t += dt;
      const b = kiSchritt(z, s, welt(fig, [ziel]), dt, rng);
      fig.gelaufen = 0; // der Fels hält ihn fest
      if (b.phase === 'anrennen' && anrennenAb < 0) anrennenAb = t;
      if (b.phase === 'heimkehren') ende = t;
    }
    const dauer = ende - anrennenAb;
    check(`blockiert: die Verfolgung endet nach ${WOLF_KI.verfolgungSec} s`, dauer >= WOLF_KI.verfolgungSec - 1e-9 && dauer <= WOLF_KI.verfolgungSec + 2 * dt, `Anrennen ${f(anrennenAb)} s → Abbruch ${f(ende)} s = ${f(dauer)} s`);
  }
  // (b) Läuft: die Strecke begrenzt.
  {
    const z = neuerKiZustand();
    const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
    const s: KiSteckbrief = { ...frei, verfolgungSec: Infinity };
    let ende = false;
    let gelaufen = 0;
    for (let i = 0; i < 600 && !ende; i++) {
      // Das Ziel bleibt 14 m vor dem Wolf: ausser Reichweite, aber in Haltesicht.
      const weit: KiZiel = { key: 'p0', x: 0, z: fig.z + 14 };
      const b = kiSchritt(z, s, welt(fig, [weit]), dt, rng);
      if (b.phase === 'heimkehren') ende = true;
      else {
        const vorher = fig.z;
        bewege(fig, b, 4.9, dt);
        if (b.phase === 'anrennen') gelaufen += fig.z - vorher;
      }
    }
    check(`laufend: die Verfolgung endet nach ${WOLF_KI.verfolgungM} m Strecke`, ende && gelaufen > WOLF_KI.verfolgungM - 0.6 && gelaufen < WOLF_KI.verfolgungM + 0.6, `gelaufen ${f(gelaufen)} m`);
  }
}

// ── [6] Verfall ────────────────────────────────────────────────────
console.log('\n[6] Verfall: nach 20 s ohne neuen Reiz lässt die Kreatur los');
{
  const z = neuerKiZustand();
  const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
  const ziel: KiZiel = { key: 'p0', x: 0, z: -25 }; // ausserhalb der Sicht, nur gehört
  kiLaerm(z, 'p0');
  const dt = 0.1;
  let t = 0;
  let phaseBei19_8 = '';
  let loslassen = -1;
  for (let i = 0; i < 400 && loslassen < 0; i++) {
    t += dt;
    const b = kiSchritt(z, WOLF_KI, welt(fig, [ziel]), dt, () => 0.5);
    if (Math.abs(t - 19.8) < dt / 2) phaseBei19_8 = b.phase;
    if (t > 1 && b.phase === 'wandern') loslassen = t;
  }
  check('Lärm aus 25 m (ausser Sicht): der Wolf bemerkt und wartet', phaseBei19_8 === 'bemerkt', `Phase bei 19,8 s: ${phaseBei19_8}`);
  check(`ohne neuen Reiz lässt er nach ${AGGRO_VERFALL_SEC} s los`, loslassen >= AGGRO_VERFALL_SEC - 1e-9 && loslassen <= AGGRO_VERFALL_SEC + 2 * dt, `los bei ${f(loslassen)} s`);
  check('die Tabelle ist danach leer', z.tabelle.size === 0);
  // Ein neuer Reiz kurz vor dem Ende setzt die Uhr zurück.
  const z2 = neuerKiZustand();
  kiLaerm(z2, 'p0');
  let t2 = 0;
  let zweiter = false;
  let los2 = -1;
  for (let i = 0; i < 600 && los2 < 0; i++) {
    t2 += dt;
    if (!zweiter && t2 >= 15) {
      kiLaerm(z2, 'p0');
      zweiter = true;
    }
    const b = kiSchritt(z2, WOLF_KI, welt(fig, [ziel]), dt, () => 0.5);
    if (t2 > 1 && b.phase === 'wandern') los2 = t2;
  }
  check('ein Reiz bei 15 s verschiebt das Loslassen auf 35 s', los2 >= 35 - 1e-9 && los2 <= 35 + 2 * dt, `los bei ${f(los2)} s`);
}

// ── [7] Rückzug ────────────────────────────────────────────────────
console.log('\n[7] Rückzug nach n Angriffen mit Wahrscheinlichkeit p (fester Seed)');
{
  const rng = new XorShiftRandom(20260930);
  const wuerfel = (): number => rng.nextFloat();
  const z = neuerKiZustand();
  const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
  const ziel: KiZiel = { key: 'p0', x: 0, z: 1.2 };
  kiReiz(z, 'p0', 8);
  const dt = 0.05;
  let wuerfe = 0;
  let rueckzuege = 0;
  let schlaegeSeitWurf = 0;
  const schlaegeVorWurf = new Set<number>();
  for (let i = 0; i < 2_000_000 && wuerfe < 4000; i++) {
    const b = kiSchritt(z, WOLF_KI, welt(fig, [ziel]), dt, wuerfel);
    if (b.schlag) schlaegeSeitWurf++;
    if (b.rueckzugWurf !== null) {
      wuerfe++;
      if (b.rueckzugWurf) rueckzuege++;
      schlaegeVorWurf.add(schlaegeSeitWurf);
      schlaegeSeitWurf = 0;
    }
    bewege(fig, b, 4.9, dt);
    kiReiz(z, 'p0', 0); // der Spieler bleibt im Spiel
  }
  const anteil = rueckzuege / wuerfe;
  check(`${wuerfe} Würfe (≥ 1000): Rückzugsanteil ${f(anteil * 100, 1)} % = ${WOLF_KI.rueckzugChance * 100} % ± 3`, wuerfe >= 1000 && Math.abs(anteil - WOLF_KI.rueckzugChance) <= 0.03, `${rueckzuege} von ${wuerfe}`);
  check(`gewürfelt wird jeweils nach genau ${WOLF_KI.rueckzugNach} Schlägen`, schlaegeVorWurf.size === 1 && schlaegeVorWurf.has(WOLF_KI.rueckzugNach), [...schlaegeVorWurf].join(','));
  // Ohne Rückzug (n = 0) gibt es nie einen Wurf.
  const z0 = neuerKiZustand();
  const fig0: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
  kiReiz(z0, 'p0', 8);
  let w0 = 0;
  let s0 = 0;
  for (let i = 0; i < 4000; i++) {
    const b = kiSchritt(z0, { ...WOLF_KI, rueckzugNach: 0 }, welt(fig0, [ziel]), dt, wuerfel);
    if (b.rueckzugWurf !== null) w0++;
    if (b.schlag) s0++;
    kiReiz(z0, 'p0', 0);
  }
  check('rueckzugNach 0: kein Wurf, der Wolf schlägt weiter', w0 === 0 && s0 > 100, `${w0} Würfe, ${s0} Schläge`);
}

// ── [8] Aggro-Tabelle ──────────────────────────────────────────────
console.log('\n[8] Aggro-Tabelle je Angreifer: der größte Schaden zählt');
{
  const z = neuerKiZustand();
  const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 };
  const nah: KiZiel = { key: 'nah', x: 0, z: 5 };
  const fern: KiZiel = { key: 'fern', x: 0, z: 12 };
  kiReiz(z, 'nah', 3);
  kiReiz(z, 'fern', 20);
  kiReiz(z, 'nah', 3);
  const b = kiSchritt(z, WOLF_KI, welt(fig, [nah, fern]), 0.1, () => 0.5);
  check('zwei Angreifer: der mit 20 Schaden (fern) schlägt den mit 6 (nah)', b.ziel === 'fern', `Ziel ${b.ziel}`);
  check('jeder Schaden zieht Aggro: der Wert summiert (3 + 3)', z.tabelle.get('nah')!.wert === 6);
  const b2 = kiSchritt(z, WOLF_KI, welt(fig, [nah]), 0.1, () => 0.5);
  check('der Angreifer ist weg (tot/abgemeldet): der andere ist das Ziel', b2.ziel === 'nah', `Ziel ${b2.ziel}`);
}

// ── [9] Drei Wölfe: Kettenaggro über die Leine ─────────────────────
console.log('\n[9] Drei Wölfe: jenseits der Leine zieht ein Wolf die anderen nicht mit');
{
  const stehend = wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 });
  const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  const weg = Math.PI / 2; // blickt +x, vom Spieler weg: ohne Reiz unbemerkt

  function szenario(aJenseitsLeine: boolean) {
    const { zdos, spawns } = baue([stehend], 9);
    // A: Anker je nach Fall; dann an den Ort gesetzt, an dem er getroffen wird.
    const a = setzeWolf(zdos, 8, aJenseitsLeine ? 20 : 6, weg);
    const b = setzeWolf(zdos, 8, 0, weg);
    const c = setzeWolf(zdos, 8, -3, weg);
    spawns.adoptPersisted();
    if (aJenseitsLeine) zdos.updateZDOZone(a, { x: 8, y: BODEN_Y, z: 6 });
    const abstandAHeim = aJenseitsLeine ? abstand({ x: 8, z: 6 }, { x: 8, z: 20 }) : 0;
    for (let i = 0; i < 20; i++) spawns.update(0.1, [spieler], [spieler], info);
    const vorher = [a, b, c].map((w) => spawns.kiPhase(w));
    spawns.treffer(a, { id: 'p0', schaden: 8 });
    for (let i = 0; i < 20; i++) spawns.update(0.1, [spieler], [spieler], info);
    return {
      vorher,
      a: spawns.kiPhase(a),
      b: spawns.kiPhase(b),
      c: spawns.kiPhase(c),
      abstandAHeim,
    };
  }

  const innen = szenario(false);
  check('Ausgangslage: alle drei unbemerkt (Spieler hinter ihnen)', innen.vorher.every((p) => p === 'wandern'), innen.vorher.join(','));
  check('Wolf A innerhalb seiner Leine getroffen: B und C werden mitgezogen', innen.b !== 'wandern' && innen.c !== 'wandern', `A ${innen.a}, B ${innen.b}, C ${innen.c}`);

  const aussen = szenario(true);
  check(`Wolf A ${f(aussen.abstandAHeim, 0)} m von seinem Anker (Leine ${WOLF_KI.leine} m): er kehrt heim`, aussen.a === 'heimkehren', `A ${aussen.a}`);
  check('Wolf A jenseits der Leine getroffen: B und C bleiben unbemerkt', aussen.b === 'wandern' && aussen.c === 'wandern', `B ${aussen.b}, C ${aussen.c}`);
}

// ── [10] Fels ──────────────────────────────────────────────────────
console.log('\n[10] Der Wolf läuft gegen einen Fels und bleibt davor stehen');
{
  const FELS_PREFAB = 'D4_TestFels';
  const FELS_R = 1.5;
  const felsHash = getStableHash(FELS_PREFAB);
  const prefabs = new PrefabManager();
  prefabs.register({ hash: felsHash, name: FELS_PREFAB, localScale: { x: 1, y: 1, z: 1 } } as never);
  const quelle: FormQuelle = {
    formFuer: (n) => (n === FELS_PREFAB ? { art: 'kapsel', x: 0, z: 0, radius: FELS_R, yMin: -1, yMax: 3 } : null),
  };

  function lauf(mitKollision: boolean): { minAbstand: number; hinten: boolean; ankunft: boolean } {
    const zdos0 = new ZDOManager(1n);
    const kollision = new Kollisionswelt(zdos0, prefabs, () => BODEN_Y, quelle);
    const hm = { getGroundHeight: (): number => BODEN_Y };
    const spawns = new SpawnSystem(zdos0, {} as never, hm as never, { isZoneGenerated: () => true } as never, {
      rng: new XorShiftRandom(2),
      table: [wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 })],
    });
    if (mitKollision) spawns.kollision = kollision;
    zdos0.createZDO(felsHash, { x: 0, y: BODEN_Y, z: 0 });
    const wolf = zdos0.createZDO(WOLF_HASH, { x: 0, y: BODEN_Y, z: -7 }, yawQuaternion(0)); // blickt +z, dem Fels zu
    wolf.setInt(HEALTH_MEMBER, 30);
    spawns.adoptPersisted();
    const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 4.5 }; // hinter dem Fels, 11,5 m vom Wolf
    let min = Infinity;
    let hinten = false;
    let ankunft = false;
    for (let i = 0; i < 400; i++) {
      spawns.update(0.05, [spieler], [spieler], [{ id: 'p0', blick: null }]);
      min = Math.min(min, abstand(wolf.position, { x: 0, z: 0 }));
      if (wolf.position.z > FELS_R) hinten = true;
      if (abstand(wolf.position, spieler) <= 1.75) ankunft = true;
    }
    return { minAbstand: min, hinten, ankunft };
  }

  const r = WOLF.koerperRadius;
  const mit = lauf(true);
  check(`mit Kollision: Abstand zum Felsmittelpunkt ≥ Fels ${FELS_R} + Wolf ${r} = ${f(FELS_R + r)} m über den ganzen Lauf`, mit.minAbstand >= FELS_R + r - 0.02, `kleinster Abstand ${f(mit.minAbstand, 3)} m`);
  check('… er steht davor (kleinster Abstand höchstens 0,3 m über dem Mindestabstand) und kommt nicht dahinter', mit.minAbstand <= FELS_R + r + 0.3 && !mit.hinten, `kleinster Abstand ${f(mit.minAbstand, 3)} m, hinter dem Fels: ${mit.hinten}`);
  const ohne = lauf(false);
  check('Gegenprobe ohne angeschlossene Kollision: er läuft durch den Fels', ohne.minAbstand < FELS_R, `kleinster Abstand ${f(ohne.minAbstand, 3)} m`);
}

// ── [11] Umlaufen bei Rückenansicht ────────────────────────────────
console.log('\n[11] Umlaufen: dem Spieler, der den Rücken zukehrt, läuft der Wolf nicht in den Rücken');
{
  // Spieler bei (0,0) blickt −z (Peer-Blick yaw 0: forward = (−sin, −cos) = (0, −1)).
  // Der Wolf steht 8 m hinter ihm (+z) und blickt auf ihn.
  function lauf(umlaufen: boolean): { winkel: number[]; kontaktVorn: boolean; kontakt: boolean; pfad: Vector3[] } {
    const { zdos, spawns } = baue([wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 })], 4);
    const wolf = setzeWolf(zdos, 0, 8, Math.PI); // blickt −z, auf den Spieler
    spawns.adoptPersisted();
    if (!umlaufen) {
      // Gegenprobe: dieselbe Kreatur ohne Umlaufen.
      const c = (spawns as unknown as { creatures: Map<string, { steck: KiSteckbrief }> }).creatures.values().next().value!;
      c.steck = { ...c.steck, umlaufen: false };
    }
    const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 0 };
    const info = [{ id: 'p0', blick: 0 }];
    const winkel: number[] = [];
    const pfad: Vector3[] = [];
    let kontakt = false;
    let kontaktVorn = false;
    for (let i = 0; i < 300 && !kontakt; i++) {
      spawns.update(0.05, [spieler], [spieler], info);
      const rx = wolf.position.x - spieler.x;
      const rz = wolf.position.z - spieler.z;
      const d = Math.hypot(rx, rz);
      // Winkel zwischen der Blickrichtung des Spielers (0,−1) und dem Wolf.
      winkel.push((Math.acos(Math.max(-1, Math.min(1, (-rz) / d))) * 180) / Math.PI);
      pfad.push({ ...wolf.position });
      if (d <= 1.75) {
        kontakt = true;
        kontaktVorn = -rz > 0; // in der vorderen Hälfte des Spielers
      }
    }
    return { winkel, kontaktVorn, kontakt, pfad };
  }

  const mit = lauf(true);
  const start = mit.winkel[0];
  const minWinkel = Math.min(...mit.winkel);
  check('mit Umlaufen: der Wolf erreicht den Spieler', mit.kontakt, `${mit.winkel.length} Schritte`);
  check('Positionsfolge: er startet hinter dem Spieler (> 150° von dessen Blick) und kommt in die vordere Hälfte', start > 150 && mit.kontaktVorn, `Start ${f(start, 0)}°, Kontakt vorn ${mit.kontaktVorn}, kleinster Winkel ${f(minWinkel, 0)}°`);
  const seitlich = mit.pfad.filter((p) => Math.abs(p.x) > 1.5).length;
  check('der Weg weicht seitlich aus (|x| > 1,5 m an mehreren Stellen)', seitlich >= 5, `${seitlich} Stellen, größte Seitenlage ${f(Math.max(...mit.pfad.map((p) => Math.abs(p.x))))} m`);
  const ohne = lauf(false);
  check('Gegenprobe ohne Umlaufen: er kommt geradewegs von hinten (Kontakt in der hinteren Hälfte, |x| < 0,5 m)', ohne.kontakt && !ohne.kontaktVorn && Math.max(...ohne.pfad.map((p) => Math.abs(p.x))) < 0.5, `Kontakt vorn ${ohne.kontaktVorn}`);
}

// ── [12] NPC-Steckbrief gegen die Bänder von aggroSchritt ──────────
console.log('\n[12] NPC-Steckbrief deckt die Bänder von aggroSchritt (Editor-Vorschau)');
{
  const namen = [...NPC_KAMPF.keys()].filter((n) => aggroSchritt(n, 0, 0, [{ x: 0, z: 0 }]) !== null);
  let verglichen = 0;
  const abweichungen: string[] = [];
  for (const name of namen) {
    const kampf = npcKampf(name);
    const s = npcSteckbrief(kampf, VERFOLGUNG_ANTEIL);
    for (let d = 0.1; d < kampf.aggro + 6; d += 0.15) {
      const alt = aggroSchritt(name, 0, d, [{ x: 0, z: 0 }], 0);
      const z = neuerKiZustand();
      const b = kiSchritt(z, s, { x: 0, z: d, yaw: 0, homeX: 0, homeZ: d, ziele: [{ key: 'p0', x: 0, z: 0 }] }, 0, () => 0.5);
      const neu = b.phase === 'wandern' ? null : b.phase === 'kaempfen' ? 'attack' : b.phase === 'anrennen' ? 'walk' : 'idle';
      verglichen++;
      if ((alt ? alt.anim : null) !== neu) abweichungen.push(`${name}@${f(d)}: ${alt?.anim ?? 'null'} ≠ ${neu ?? 'null'}`);
    }
  }
  check(`${namen.length} NPCs, ${verglichen} Abstände: dieselbe Staffel wie aggroSchritt`, abweichungen.length === 0 && verglichen > 500, abweichungen.slice(0, 3).join('; ') || `${verglichen} gleich`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
