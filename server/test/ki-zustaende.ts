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
 *  [13] Heimkehr hängt nicht fest: Wand, Anker im Fels, Feldprobe (N1 B1).
 *  [14] Leinen-Kiting: Heimkehrer sind unverwundbar und voll bei Leben (N1 B5).
 *  [15] Schlagplätze zählen je tatsächlichem Ziel (N1 B6).
 *  [16] Schaukeln an der Leine endet; Rückzug im Serverpfad (N1 B2, B7).
 *  [17] Kettenaggro ist nicht transitiv (N1 B3).
 *  [18] Im Fels: herausgeschoben, nicht hindurch; kein Spawn im Fels (N1 B4).
 *  [19] Schrittdeckel der Simulation; nichts Totes exportiert (N1 B9, B8).
 *  [20] Lange Ticks werden in Teilschritten nachgeholt (N2 N1-7).
 *  [21] Der Anker wandert nicht aus der Leine des Ursprungs (N2 N1-4).
 *  [22] Herausschieben: kein Wasser, kein Ausweg ⇒ abgeräumt, Felshaufen (N2 N1-5).
 *  [23] Heimkehr-Fortschrittsschwelle; [24] Grenze Leine + Sicht bei `aufgegeben` (N2 N1-8).
 *
 * Run: npx tsx server/test/ki-zustaende.ts   (from the repo root or server/)
 */
import { readFileSync } from 'node:fs';
import * as SHARED from '@wov/shared';
import {
  AGGRO_VERFALL_SEC,
  HEIMKEHR_FESTSITZEN_SEC,
  HEIM_ANKUNFT_M,
  maxLeben,
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
function baue(table: readonly SpawnEntry[], seed = 1, opt: { kollision?: Kollisionswelt; ki?: Partial<KiSteckbrief> } = {}) {
  const zdos = new ZDOManager(1n);
  const hm = { getGroundHeight: (): number => BODEN_Y };
  const zones = { isZoneGenerated: (): boolean => true };
  const spawns = new SpawnSystem(zdos, {} as never, hm as never, zones as never, {
    rng: new XorShiftRandom(seed),
    table,
    kiUeberschreibung: opt.ki,
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
  // AUSNAHME (Mike, 30.09.2026): Der Wolf behält den Takt von 2 s wie vor D4 —
  // bewusst ausserhalb der Roadmap-Spanne 0,5–1,5 s. Nur dieser Wert, nur 2 s.
  const AUSNAHME: Record<string, readonly [number, number]> = { taktSec: [2, 2] };
  for (const [feld, [lo, hi]] of Object.entries(KI_SPANNEN)) {
    const v = ki[feld];
    const [alo, ahi] = feld in AUSNAHME ? [Math.min(lo, AUSNAHME[feld][0]), Math.max(hi, AUSNAHME[feld][1])] : [lo, hi];
    if (!(v >= alo && v <= ahi)) aus.push(`${feld}=${v} ausserhalb ${alo}..${ahi}`);
  }
  check('Ausnahme Takt: die Roadmap-Spanne bleibt 0,5–1,5 s, der Wolf steht mit 2 s darüber', KI_SPANNEN.taktSec[0] === 0.5 && KI_SPANNEN.taktSec[1] === 1.5 && WOLF_KI.taktSec === 2, `Takt ${WOLF_KI.taktSec}`);
  // B7: die Werte des Wolfs wörtlich als Zahl (die Tests lesen sonst ihre Erwartung aus dem Steckbrief selbst).
  check(
    'Wolf wörtlich: Leine 12, Rückzug nach 3 mit 0,4, Takt 2, Verfall 20, Sicht 17 / 230°',
    WOLF_KI.leine === 12 && WOLF_KI.rueckzugNach === 3 && WOLF_KI.rueckzugChance === 0.4 && WOLF_KI.taktSec === 2 && WOLF_KI.verfallSec === 20 && WOLF_KI.sicht === 17 && WOLF_KI.sichtWinkelGrad === 230,
    `Leine ${WOLF_KI.leine}, Rückzug ${WOLF_KI.rueckzugNach}/${WOLF_KI.rueckzugChance}, Takt ${WOLF_KI.taktSec}, Verfall ${WOLF_KI.verfallSec}, Sicht ${WOLF_KI.sicht}/${WOLF_KI.sichtWinkelGrad}`
  );
  check(
    'Wolf wörtlich: Hören 30, Haltesicht 17, Strecke 15, Zeit 10, Reichweite 1,7, Reaktion 0,25, Körper 0,45, Block 0',
    WOLF_KI.hoeren === 30 && WOLF_KI.haltSicht === 17 && WOLF_KI.verfolgungM === 15 && WOLF_KI.verfolgungSec === 10 && WOLF_KI.angriffReichweite === 1.7 && WOLF_KI.bemerktSec === 0.25 && WOLF_KI.koerperRadius === 0.45 && WOLF_KI.blockChance === 0
  );
  check('der Körper des Wolfs liegt unter dem Ankunftsradius der Heimkehr (am Fels erreichbar)', WOLF_KI.koerperRadius < HEIM_ANKUNFT_M, `${WOLF_KI.koerperRadius} < ${HEIM_ANKUNFT_M}`);
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
  const modus = (): string => (spawns as unknown as { creatures: Map<string, { mode: string }> }).creatures.values().next().value!.mode;
  const modiImAnrennen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    spieler.x += 4.5 * 0.1; // der Spieler läuft mit Gehtempo davon
    spawns.update(0.1, [spieler], [spieler], info);
    const ph = spawns.kiPhase(zdo) ?? '?';
    if (ph === 'anrennen') modiImAnrennen.add(modus());
    if (phasen[phasen.length - 1] !== ph) {
      phasen.push(ph);
      if (ph === 'heimkehren') heimPhaseBeiAbstand = abstand(zdo.position, { x: 0, z: 0 });
    }
    maxHeim = Math.max(maxHeim, abstand(zdo.position, { x: 0, z: 0 }));
  }
  check('Phasenfolge: bemerkt → anrennen → heimkehren → wandern (das Bemerken geschieht im ersten Schritt)', phasen.join('>') === 'bemerkt>anrennen>heimkehren>wandern', phasen.join('>'));
  check("während des Anrennens steht der Modus des Wolfs auf 'chase' (D2 liest daraus das Tempo)", modiImAnrennen.size === 1 && modiImAnrennen.has('chase'), [...modiImAnrennen].join(','));
  check(`der Wolf überschreitet die Leine ${WOLF_KI.leine} m nicht um mehr als einen Schritt`, maxHeim <= WOLF_KI.leine + 0.6, `max ${f(maxHeim)} m`);
  check('der Abbruch geschieht an der Leine, nicht früher', heimPhaseBeiAbstand > WOLF_KI.leine - 0.6, `bei ${f(heimPhaseBeiAbstand)} m`);
  check('nach 20 s steht der Wolf wieder am Anker (< 0,6 m)', abstand(zdo.position, { x: 0, z: 0 }) < 0.6, `${f(abstand(zdo.position, { x: 0, z: 0 }))} m`);
}

// ── [5] Verfolgung: Zeit und Strecke ───────────────────────────────
console.log('\n[5] Verfolgung endet nach der gewählten Zeit und nach der Strecke');
{
  // Leine so weit, dass sie nicht greift: Zeit und Strecke einzeln sehen.
  const frei: KiSteckbrief = { ...WOLF_KI, leine: 1e9 };
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
      const b = kiSchritt(z, s, welt(fig, [ziel], { x: 0, z: -30 }), dt, rng); // Anker weit weg: kein Heimkehr-Sprung
      fig.gelaufen = 0; // der Fels hält ihn fest
      if (b.phase === 'anrennen' && anrennenAb < 0) anrennenAb = t;
      if (anrennenAb >= 0 && b.phase === 'heimkehren') ende = t;
    }
    const dauer = ende - anrennenAb;
    check(`blockiert: die Verfolgung endet nach ${WOLF_KI.verfolgungSec} s`, dauer >= WOLF_KI.verfolgungSec - 2 * dt && dauer <= WOLF_KI.verfolgungSec + 2 * dt, `Anrennen ${f(anrennenAb)} s → Abbruch ${f(ende)} s = ${f(dauer)} s`);
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
  check('rueckzugNach 0: kein Wurf, der Wolf schlägt weiter (200 s bei Takt 2 s: rund 100 Schläge)', w0 === 0 && s0 >= 95, `${w0} Würfe, ${s0} Schläge`);
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

  // Dasselbe ohne Treffer: Wolf A bemerkt den Spieler selbst (er blickt auf ihn).
  function szenarioSicht(aJenseitsLeine: boolean) {
    const { zdos, spawns } = baue([stehend], 9);
    const a = setzeWolf(zdos, 8, aJenseitsLeine ? 20 : 6, -Math.PI / 2); // blickt −x, auf den Spieler
    const b = setzeWolf(zdos, 8, 0, weg);
    const c = setzeWolf(zdos, 8, -3, weg);
    spawns.adoptPersisted();
    if (aJenseitsLeine) zdos.updateZDOZone(a, { x: 8, y: BODEN_Y, z: 6 });
    // A blickt −x, der Spieler liegt bei (0,0): A sieht ihn aus rund 10 m.
    for (let i = 0; i < 20; i++) spawns.update(0.1, [spieler], [spieler], info);
    return { a: spawns.kiPhase(a), b: spawns.kiPhase(b), c: spawns.kiPhase(c) };
  }
  const sichtInnen = szenarioSicht(false);
  check('Wolf A sieht den Spieler selbst (innerhalb der Leine): B und C werden mitgezogen', sichtInnen.a !== 'wandern' && sichtInnen.b !== 'wandern' && sichtInnen.c !== 'wandern', `A ${sichtInnen.a}, B ${sichtInnen.b}, C ${sichtInnen.c}`);
  const sichtAussen = szenarioSicht(true);
  check('Wolf A sieht den Spieler, steht aber jenseits der Leine: er kehrt heim, B und C bleiben unbemerkt', sichtAussen.a === 'heimkehren' && sichtAussen.b === 'wandern' && sichtAussen.c === 'wandern', `A ${sichtAussen.a}, B ${sichtAussen.b}, C ${sichtAussen.c}`);

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

// ── Aufbau mit Fels für [13]–[19] ──────────────────────────────────
const FELS_NAME = 'D4_Fels';
const KISTE_NAME = 'D4_Kiste';
const FELS_RADIUS = 1.5;
const KISTE_HALB = 10;
type StateMap = Map<string, { home: Vector3; steck: KiSteckbrief }>;
const creaturesVon = (spawns: SpawnSystem): StateMap => (spawns as unknown as { creatures: StateMap }).creatures;

function felsRahmen(table: readonly SpawnEntry[], seed = 1, ki?: Partial<KiSteckbrief>, mitKollision = true, hoehe: (x: number, z: number) => number = () => BODEN_Y) {
  const felsHash = getStableHash(FELS_NAME);
  const kisteHash = getStableHash(KISTE_NAME);
  const prefabs = new PrefabManager();
  prefabs.register({ hash: felsHash, name: FELS_NAME, localScale: { x: 1, y: 1, z: 1 } } as never);
  prefabs.register({ hash: kisteHash, name: KISTE_NAME, localScale: { x: 1, y: 1, z: 1 } } as never);
  const quelle: FormQuelle = {
    formFuer: (n) =>
      n === FELS_NAME
        ? { art: 'kapsel', x: 0, z: 0, radius: FELS_RADIUS, yMin: -1, yMax: 3 }
        : n === KISTE_NAME
          ? { art: 'kiste', min: { x: -KISTE_HALB, y: -1, z: -KISTE_HALB }, max: { x: KISTE_HALB, y: 20, z: KISTE_HALB } }
          : null,
  };
  const zdos = new ZDOManager(1n);
  const kollision = new Kollisionswelt(zdos, prefabs, hoehe, quelle);
  const hm = { getGroundHeight: hoehe };
  const geo = { getBiome: (): number => -1 };
  const spawns = new SpawnSystem(zdos, geo as never, hm as never, { isZoneGenerated: () => true } as never, {
    rng: new XorShiftRandom(seed),
    table,
    kiUeberschreibung: ki,
  });
  if (mitKollision) spawns.kollision = kollision;
  return {
    zdos,
    spawns,
    kollision,
    fels: (x: number, z: number): ZDO => zdos.createZDO(felsHash, { x, y: BODEN_Y, z }),
    kiste: (x: number, z: number): ZDO => zdos.createZDO(kisteHash, { x, y: BODEN_Y, z }),
  };
}

/** Wolf, der nach dem Anlegen nicht von selbst wandert (Wanderradius 0, endlose Pause). */
const ruhigerWolf = (): SpawnEntry => wolfEintrag({ wanderRadius: 0, idleMinSec: 9999, idleMaxSec: 9999 });
const FERN: Vector3 = { x: 100, y: BODEN_Y, z: -14 };

// ── [13] Heimkehr hängt nicht fest (B1) ────────────────────────────
console.log('\n[13] Heimkehr: Wand, Anker im Fels, Feldprobe — nichts bleibt dauerhaft in `heimkehren`');
{
  // (a) Wand aus Felsen zwischen Wolf (14 m vom Anker, jenseits der Leine) und Anker.
  const r = felsRahmen([wolfEintrag()], 21);
  for (let x = -30; x <= 30; x += 2) r.fels(x, -7);
  const wolf = setzeWolf(r.zdos, 0, 0, 0);
  r.spawns.adoptPersisted();
  r.zdos.updateZDOZone(wolf, { x: 0, y: BODEN_Y, z: -14 });
  const info = [{ id: 'p0', blick: null }];
  let schlaege = 0;
  r.spawns.onCreatureAttack = (): void => {
    schlaege++;
  };
  r.spawns.update(0.05, [FERN], [FERN], info);
  r.spawns.treffer(wolf, { id: 'p0', schaden: 8 });
  let t = 0;
  let tHeim = -1;
  let tEnde = -1;
  let zEndePos = { x: 0, z: 0 };
  for (let i = 0; i < 600; i++) {
    r.spawns.update(0.05, [FERN], [FERN], info);
    t += 0.05;
    const ph = r.spawns.kiPhase(wolf);
    if (ph === 'heimkehren' && tHeim < 0) tHeim = t;
    if (tHeim >= 0 && ph !== 'heimkehren' && tEnde < 0) {
      tEnde = t;
      zEndePos = { x: wolf.position.x, z: wolf.position.z };
    }
  }
  const heimDauer = tEnde - tHeim;
  check('Wand: der Wolf kehrt heim und bleibt an der Wand stehen', tHeim > 0 && zEndePos.z < -8 && zEndePos.z > -9.2, `Heimkehr ab ${f(tHeim)} s, steht bei z=${f(zEndePos.z, 2)}`);
  // Anlauf ~1 s, dann HEIMKEHR_FESTSITZEN_SEC ohne Fortschritt.
  check(`Wand: nach ${HEIMKEHR_FESTSITZEN_SEC} s ohne Fortschritt ist Schluss mit der Heimkehr`, tEnde > 0 && heimDauer >= HEIMKEHR_FESTSITZEN_SEC && heimDauer <= HEIMKEHR_FESTSITZEN_SEC + 2.5, `Heimkehr ${f(heimDauer)} s`);
  const c = creaturesVon(r.spawns).values().next().value!;
  const uSpur = (c as unknown as { ursprung: Vector3 }).ursprung;
  check('Wand: der Ursprung bleibt, wo die Kreatur aufgenommen wurde (nur der Anker zieht um)', Math.hypot(uSpur.x, uSpur.z) < 1e-9 && Math.hypot(c.home.x - uSpur.x, c.home.z - uSpur.z) > 5, `Ursprung (${f(uSpur.x)}; ${f(uSpur.z)}), Anker (${f(c.home.x)}; ${f(c.home.z)})`);
  check('Wand: der Anker liegt jetzt dort, wo er steht', Math.hypot(c.home.x - zEndePos.x, c.home.z - zEndePos.z) < 0.6, `Anker (${f(c.home.x)}; ${f(c.home.z)}) gegen Wolf (${f(zEndePos.x)}; ${f(zEndePos.z)})`);
  check('Wand: danach wandert er wieder (Phase wandern)', r.spawns.kiPhase(wolf) === 'wandern', `Phase ${r.spawns.kiPhase(wolf)}`);
  // Er nimmt wieder wahr: ein Spieler vor ihm (hinter der Wand) wird bemerkt.
  const vor: Vector3 = { x: 0, y: BODEN_Y, z: -5 };
  let bemerkt = false;
  for (let i = 0; i < 60 && !bemerkt; i++) {
    r.spawns.update(0.05, [vor], [vor], [{ id: 'p1', blick: null }]);
    bemerkt = r.spawns.kiPhase(wolf) !== 'wandern';
  }
  check('Wand: der Festsitzer nimmt wieder wahr (Spieler vor ihm wird bemerkt)', bemerkt, `Phase ${r.spawns.kiPhase(wolf)}`);
  // ... und wehrt sich: Treffer eines Spielers dicht hinter ihm.
  const hinter: Vector3 = { x: 0, y: BODEN_Y, z: zEndePos.z - 1.2 };
  r.spawns.treffer(wolf, { id: 'p2', schaden: 8 });
  schlaege = 0;
  for (let i = 0; i < 120; i++) r.spawns.update(0.05, [hinter], [hinter], [{ id: 'p2', blick: null }]);
  check('Wand: der Festsitzer wehrt sich (Schläge gegen den Spieler dicht hinter ihm)', schlaege >= 1, `${schlaege} Schläge in 6 s`);
}
{
  // (b) Anker im Fels: wird beim ersten Schritt herausgeschoben; die Heimkehr kommt an.
  const r = felsRahmen([ruhigerWolf()], 22);
  r.fels(0, 0);
  const wolf = setzeWolf(r.zdos, 0.3, 0, 0);
  r.spawns.adoptPersisted();
  r.zdos.updateZDOZone(wolf, { x: 14, y: BODEN_Y, z: 0 });
  const info = [{ id: 'p0', blick: null }];
  const fern: Vector3 = { x: 100, y: BODEN_Y, z: 0 };
  r.spawns.update(0.05, [fern], [fern], info);
  const c = creaturesVon(r.spawns).values().next().value!;
  const home0 = { ...c.home };
  const dHome = Math.hypot(home0.x, home0.z);
  check(`Anker im Fels (Abstand 0,3 m vom Felsmittelpunkt): geschoben auf ≥ Fels ${FELS_RADIUS} + Wolf ${WOLF.koerperRadius}`, dHome >= FELS_RADIUS + WOLF.koerperRadius - 1e-6 && dHome <= FELS_RADIUS + WOLF.koerperRadius + 0.3, `Anker ${f(dHome, 3)} m vom Felsmittelpunkt`);
  r.spawns.treffer(wolf, { id: 'p0', schaden: 8 });
  let ankunft = -1;
  let t = 0;
  let sahHeim = false;
  for (let i = 0; i < 300 && ankunft < 0; i++) {
    r.spawns.update(0.05, [fern], [fern], info);
    t += 0.05;
    const ph = r.spawns.kiPhase(wolf);
    if (ph === 'heimkehren') sahHeim = true;
    if (sahHeim && ph === 'wandern') ankunft = t;
  }
  check('Anker im Fels: die Heimkehr kommt an (unter der Frist), ohne den Anker neu zu setzen', ankunft > 0 && ankunft < HEIMKEHR_FESTSITZEN_SEC && Math.hypot(c.home.x - home0.x, c.home.z - home0.z) < 1e-9, `angekommen nach ${f(ankunft)} s, Wolf ${f(Math.hypot(wolf.position.x - home0.x, wolf.position.z - home0.z))} m vom Anker`);
}
{
  // (c) Feldprobe: 30 Wölfe, 150 Felsen, Spieler steht, 300 s.
  const r = felsRahmen([ruhigerWolf()], 23);
  const zufall = new XorShiftRandom(77);
  for (let i = 0; i < 150; i++) r.fels(zufall.rangeFloat(-35, 35), zufall.rangeFloat(-35, 35));
  const wolfe: ZDO[] = [];
  for (let i = 0; i < 30; i++) wolfe.push(setzeWolf(r.zdos, zufall.rangeFloat(-35, 35), zufall.rangeFloat(-35, 35), zufall.rangeFloat(0, Math.PI * 2)));
  r.spawns.adoptPersisted();
  const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  const heimSeit = new Map<ZDO, number>();
  let laengsteHeim = 0;
  let ticks = 0;
  const zeiten: number[] = [];
  let simT = 0;
  for (let i = 0; i < 6000; i++) {
    const t0 = performance.now();
    r.spawns.update(0.05, [spieler], [spieler], info);
    zeiten.push(performance.now() - t0);
    simT += 0.05;
    ticks++;
    for (const w of wolfe) {
      if (r.spawns.kiPhase(w) === 'heimkehren') {
        if (!heimSeit.has(w)) heimSeit.set(w, simT);
        laengsteHeim = Math.max(laengsteHeim, simT - heimSeit.get(w)!);
      } else heimSeit.delete(w);
    }
  }
  const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const erste = median(zeiten.slice(300, 1300));
  const letzte = median(zeiten.slice(-1000));
  const dauerhaft = [...heimSeit.keys()].length;
  check('Feldprobe 30 Wölfe / 150 Felsen / 300 s: kein Wolf steckt am Ende in `heimkehren`', dauerhaft === 0, `${dauerhaft} von 30; längste Heimkehr ${f(laengsteHeim, 1)} s (Fristen: Weg höchstens ~3 s + ${HEIMKEHR_FESTSITZEN_SEC} s)`);
  check('Feldprobe: keine Heimkehr länger als 20 s (Zeuge gegen schleichenden Festhänger)', laengsteHeim < 20, `längste ${f(laengsteHeim, 1)} s`);
  check('Feldprobe: Tickzeit stabil (Median der letzten 1000 Ticks höchstens dreimal der ersten plus 0,5 ms) und unter 3 ms', letzte <= erste * 3 + 0.5 && letzte < 3, `erste 1000 Ticks ${f(erste, 3)} ms, letzte 1000 ${f(letzte, 3)} ms`);
  void ticks;
}

// ── [14] Leinen-Kiting (B5) ────────────────────────────────────────
console.log('\n[14] Spieler bei 14 m vom Anker trifft aus 3,5 m: Heimkehrer sind unverwundbar und voll bei Leben');
{
  const { zdos, spawns } = baue([ruhigerWolf()], 31);
  const wolf = setzeWolf(zdos, 0, 0, Math.PI / 2); // blickt +x, dem Spieler zu
  spawns.adoptPersisted();
  const spieler: Vector3 = { x: 14, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  const voll = maxLeben('Wolf');
  let schlaege = 0;
  spawns.onCreatureAttack = (): void => {
    schlaege++;
  };
  let treffer = 0;
  let abgewehrt = 0;
  let gestorben = false;
  let vollBeiHeimstart = true;
  let letztePhase = '';
  let naechsterSchlag = 0;
  let t = 0;
  for (let i = 0; i < 4000 && !gestorben; i++) {
    spawns.update(0.05, [spieler], [spieler], info);
    t += 0.05;
    const ph = spawns.kiPhase(wolf) ?? '';
    if (ph === 'heimkehren' && letztePhase !== 'heimkehren' && wolf.getInt(HEALTH_MEMBER) !== voll) vollBeiHeimstart = false;
    letztePhase = ph;
    // Der Spieler schlägt alle 0,5 s, wenn der Wolf in 3,5 m Reichweite steht — wie handleAttack:
    // ein Heimkehrer ist kein Ziel (unverwundbar), sonst Schaden und Reiz.
    if (t >= naechsterSchlag && abstand(wolf.position, spieler) <= 3.5) {
      naechsterSchlag = t + 0.5;
      if (spawns.unverwundbar(wolf)) abgewehrt++;
      else {
        treffer++;
        const hp = wolf.getInt(HEALTH_MEMBER) - 8;
        if (hp <= 0) gestorben = true;
        else {
          wolf.setInt(HEALTH_MEMBER, hp);
          spawns.treffer(wolf, { id: 'p0', schaden: 8 });
        }
      }
    }
  }
  check('Leinen-Kiting 14 m / 200 s: der Wolf stirbt nicht', !gestorben, `Treffer ${treffer}, abgewehrt ${abgewehrt}, Leben ${wolf.getInt(HEALTH_MEMBER)}/${voll}`);
  check('… Heimkehrer waren unverwundbar (mindestens ein Schlag des Spielers wurde abgewehrt)', abgewehrt >= 1, `${abgewehrt} abgewehrt`);
  check('… beim Heimkehren sind die Lebenspunkte voll', vollBeiHeimstart);
  check('… und kein Schaden-ohne-Risiko: der Spieler trifft höchstens dreimal, bevor der Wolf heimkehrt (30 Leben, Schaden 8 ⇒ vier nötig)', treffer <= 3, `${treffer} Treffer`);
  void schlaege;
}

// ── [15] Schlagplätze je tatsächliches Ziel (B6) ───────────────────
console.log('\n[15] Zwei Spieler, sechs Wölfe mit Aggro nur auf B: höchstens zwei schlagen gleichzeitig auf B');
{
  const { zdos, spawns } = baue([ruhigerWolf()], 41, { ki: { rueckzugNach: 0 } });
  const A: Vector3 = { x: 0, y: BODEN_Y, z: 0 };
  const B: Vector3 = { x: 2, y: BODEN_Y, z: 0 };
  // Drei Wölfe näher an A, drei näher an B, alle in 1,7 m von B (Abstand zu B 0,8–1,2 m).
  const xs = [0.8, 0.85, 0.9, 1.1, 1.15, 1.2];
  const wolfe = xs.map((x, i) => setzeWolf(zdos, x, (i - 2.5) * 0.05, Math.PI / 2));
  spawns.adoptPersisted();
  const info = [{ id: 'A', blick: null }, { id: 'B', blick: null }];
  const jeTick: number[] = [];
  let imTick = 0;
  spawns.onCreatureAttack = (_p, _d, _r, ziel): void => {
    if (ziel.x === B.x) imTick++;
  };
  for (const w of wolfe) spawns.treffer(w, { id: 'B', schaden: 8 });
  for (let i = 0; i < 400; i++) {
    imTick = 0;
    spawns.update(0.05, [A, B], [A, B], info);
    jeTick.push(imTick);
  }
  const hoechst = Math.max(...jeTick);
  const gesamt = jeTick.reduce((x, y) => x + y, 0);
  check('höchstens 2 Wölfe schlagen im selben Tick auf B', hoechst <= 2, `höchstens ${hoechst} je Tick`);
  // Zwei Plätze, Takt 2 s, 20 s: rund 2 × 10 Schläge (±1 je Platz).
  check('… und insgesamt in 20 s nicht mehr als zwei Schlagplätze hergeben (≤ 2 × 10 + 2)', gesamt >= 10 && gesamt <= 22, `${gesamt} Schläge in 20 s`);
}

// ── [16] Schaukeln an der Leine (B2), Rückzug im Serverpfad (B7) ───
console.log('\n[16] Spieler still bei 14 m: höchstens eine Handvoll Zustandswechsel; Rückzug im echten SpawnSystem');
{
  const { zdos, spawns } = baue([ruhigerWolf()], 51);
  const wolf = setzeWolf(zdos, 0, 0, Math.PI / 2);
  spawns.adoptPersisted();
  const spieler: Vector3 = { x: 14, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  let wechsel = 0;
  let letzte = spawns.kiPhase(wolf);
  // Schlimmster Fall: Der Wolf schaut in Ruhe immer zum Spieler (kein Wegdrehen nach der Heimkehr).
  const zumSpieler = (): void => {
    if (spawns.kiPhase(wolf) === 'wandern') wolf.rotation = yawQuaternion(Math.PI / 2);
  };
  for (let i = 0; i < 4000; i++) {
    zumSpieler();
    spawns.update(0.05, [spieler], [spieler], info);
    const ph = spawns.kiPhase(wolf);
    if (ph !== letzte) {
      wechsel++;
      letzte = ph;
    }
  }
  check('Spieler still bei 14 m, 200 s: höchstens 6 Zustandswechsel (vorher 75)', wechsel <= 6, `${wechsel} Wechsel`);
  // Der Wolf bemerkt einen aufgegebenen Spieler nicht gleich wieder; betritt er das Revier, schon.
  const revier: Vector3 = { x: 9, y: BODEN_Y, z: 0 };
  let ging = false;
  for (let i = 0; i < 100 && !ging; i++) {
    zumSpieler();
    spawns.update(0.05, [revier], [revier], info);
    ging = spawns.kiPhase(wolf) !== 'wandern';
  }
  check('Betritt der Spieler das Revier (9 m vom Anker, Leine 12), greift der Wolf wieder an', ging, `Phase ${spawns.kiPhase(wolf)}`);
}
{
  // Rückzug mit den echten Werten im echten SpawnSystem: Spieler 1,2 m vor dem Wolf, Schläge zählen.
  const { zdos, spawns } = baue([ruhigerWolf()], 52);
  const wolf = setzeWolf(zdos, 0, 0, 0); // blickt +z, dem Spieler zu
  spawns.adoptPersisted();
  const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 1.2 };
  const info = [{ id: 'p0', blick: null }];
  let schlaege = 0;
  spawns.onCreatureAttack = (): void => {
    schlaege++;
  };
  let rueckzuege = 0;
  let letzte = '';
  let weitesterRueckzug = 0;
  for (let i = 0; i < 80000; i++) {
    spawns.update(0.05, [spieler], [spieler], info);
    const ph = spawns.kiPhase(wolf) ?? '';
    if (ph === 'zurueckziehen' && letzte !== 'zurueckziehen') rueckzuege++;
    if (ph === 'zurueckziehen') weitesterRueckzug = Math.max(weitesterRueckzug, abstand(wolf.position, spieler));
    letzte = ph;
  }
  const wuerfe = Math.floor(schlaege / 3); // wörtlich 3: nach jedem dritten Schlag wird gewürfelt
  const anteil = rueckzuege / wuerfe;
  check(`Serverpfad: Rückzugsanteil ${f(anteil * 100, 1)} % = 40 % ± 4 (alle 3 Schläge gewürfelt, ${wuerfe} Würfe)`, wuerfe >= 500 && Math.abs(anteil - 0.4) <= 0.04, `${rueckzuege} Rückzüge bei ${schlaege} Schlägen`);
  check('Serverpfad: Schläge je Takt 2 s — 4000 s ergeben rund 2000 Schläge abzüglich der Rückzugslücken (1300–2000)', schlaege >= 1300 && schlaege <= 2000, `${schlaege} Schläge`);
  check('Serverpfad: im Rückzug entfernt sich der Wolf aus der Schlagreichweite', weitesterRueckzug > 1.7 + 1, `größter Abstand im Rückzug ${f(weitesterRueckzug)} m`);
}

// ── [17] Kettenaggro nicht transitiv (B3) ──────────────────────────
console.log('\n[17] 12 Wölfe im Abstand von 10 m: nur die direkten Nachbarn des getroffenen Wolfs werden alarmiert');
{
  const { zdos, spawns } = baue([ruhigerWolf()], 61);
  const wolfe: ZDO[] = [];
  for (let i = 0; i < 12; i++) wolfe.push(setzeWolf(zdos, i * 10, 0, -Math.PI / 2)); // blicken −x, alle vom Spieler weg
  spawns.adoptPersisted();
  // Der Spieler steht weit hinter der Kette (Sicht 17 m, Kegel nach −x): niemand sieht ihn.
  const spieler: Vector3 = { x: 130, y: BODEN_Y, z: 0 };
  const info = [{ id: 'p0', blick: null }];
  for (let i = 0; i < 20; i++) spawns.update(0.1, [spieler], [spieler], info);
  const vorher = wolfe.map((w) => spawns.kiPhase(w));
  spawns.treffer(wolfe[5], { id: 'p0', schaden: 8 });
  for (let i = 0; i < 40; i++) spawns.update(0.1, [spieler], [spieler], info);
  const phasen = wolfe.map((w) => spawns.kiPhase(w));
  const alarmiert = phasen.map((ph, i) => (ph !== 'wandern' ? i : -1)).filter((i) => i >= 0);
  check('Ausgangslage: alle 12 unbemerkt', vorher.every((p) => p === 'wandern'), vorher.join(','));
  check('Treffer auf Wolf 5: Wolf 5 und seine direkten Nachbarn 4 und 6 (10 m, innerhalb der Leine 12 m) sind alarmiert', [4, 5, 6].every((i) => alarmiert.includes(i)), `alarmiert: ${alarmiert.join(',')}`);
  check('… aber keiner weiter weg: der Ruf läuft nicht von Nachbar zu Nachbar weiter', alarmiert.length === 3, `alarmiert: ${alarmiert.join(',')} (${alarmiert.length})`);
}

// ── [18] Im Fels (B4) ──────────────────────────────────────────────
console.log('\n[18] Steckt der Wolf im Fels, wird er auf dem kürzesten Weg herausgeschoben; kein Spawn im Fels');
{
  // Die Abfrage selbst, ohne ZDO-Spiel: Mittelpunkt im Fels, in der Berührung, frei; Kiste.
  const zdos = new ZDOManager(1n);
  const kw = new Kollisionswelt(zdos, new PrefabManager(), () => BODEN_Y);
  const kapsel = { art: 'kapsel' as const, x: 0, z: 0, radius: FELS_RADIUS, yMin: -1, yMax: 3 };
  const nah = kw.nahfeldAus([{ form: kapsel, position: { x: 0, y: BODEN_Y, z: 0 } }]);
  const r = WOLF.koerperRadius;
  const im = nah.ausDemFels({ x: 0.3, y: BODEN_Y, z: 0 }, r);
  check('ausDemFels: Mittelpunkt 0,3 m vom Felsmittelpunkt ⇒ geschoben auf Fels + Radius (+ 5 cm Luft), in die nächste der 8 Richtungen', !!im && Math.abs(Math.hypot(im.x, im.z) - (FELS_RADIUS + r + 0.05 - 0)) < 0.35 && Math.hypot(im.x, im.z) >= FELS_RADIUS + r, im ? `(${f(im.x, 3)}; ${f(im.z, 3)}) = ${f(Math.hypot(im.x, im.z), 3)} m` : 'null');
  check('ausDemFels: an der Fläche (Abstand 1,7 m < 1,95 m = Berührung, Mittelpunkt ausserhalb) ist kein Steckenbleiben', nah.ausDemFels({ x: 1.7, y: BODEN_Y, z: 0 }, r) === null && nah.ausDemFels({ x: 1.2, y: BODEN_Y, z: 1.2 }, r) === null);
  // Berührung in allen 16 Richtungen um den Fels, dicht an der Fläche (Mittelpunkt 1,55 m): nie „steckt".
  const beruehrt = Array.from({ length: 16 }, (_, i) => nah.ausDemFels({ x: 1.55 * Math.cos((i * Math.PI) / 8), y: BODEN_Y, z: 1.55 * Math.sin((i * Math.PI) / 8) }, r)).filter((x) => x !== null).length;
  check('ausDemFels: Mittelpunkt 1,55 m vom Felsmittelpunkt in 16 Richtungen (Berührung, 5 cm ausserhalb): nie als steckend gemeldet', beruehrt === 0, `${beruehrt} von 16`);
  check('ausDemFels: frei (5 m) ⇒ null', nah.ausDemFels({ x: 5, y: BODEN_Y, z: 0 }, r) === null);
  const kiste = kw.nahfeldAus([{ form: { art: 'kiste', min: { x: -4, y: -1, z: -4 }, max: { x: 4, y: 6, z: 4 } }, position: { x: 0, y: BODEN_Y, z: 0 } }]);
  const imK = kiste.ausDemFels({ x: 3, y: BODEN_Y, z: 0.5 }, r);
  check('ausDemFels: Kiste, 1 m vom Rand ⇒ hinaus über die nächste Seite (x ≥ 4 + Radius)', !!imK && imK.x >= 4 + r && imK.x <= 4 + r + 0.2, imK ? `(${f(imK.x, 3)}; ${f(imK.z, 3)})` : 'null');
}
{
  // Der Fels wird unter den laufenden Wolf geladen; der Spieler steht hinter dem Fels.
  const r = felsRahmen([ruhigerWolf()], 71);
  const wolf = setzeWolf(r.zdos, 0, -6, 0); // blickt +z
  r.spawns.adoptPersisted();
  const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 5 };
  const info = [{ id: 'p0', blick: null }];
  for (let i = 0; i < 10; i++) r.spawns.update(0.05, [spieler], [spieler], info);
  r.fels(wolf.position.x + 0.3, wolf.position.z); // nachgeladen: der Wolf steht mitten darin
  const mx = wolf.position.x;
  const mz = wolf.position.z;
  const minR = FELS_RADIUS + WOLF.koerperRadius;
  let minNachher = Infinity;
  let zuerst = -1;
  let t = 0;
  r.spawns.treffer(wolf, { id: 'p0', schaden: 8 });
  for (let i = 0; i < 200; i++) {
    r.spawns.update(0.05, [spieler], [spieler], info);
    t += 0.05;
    const d = Math.hypot(wolf.position.x - (mx + 0.3), wolf.position.z - mz);
    if (zuerst < 0 && d >= minR - 0.02) zuerst = t;
    if (zuerst >= 0) minNachher = Math.min(minNachher, d);
  }
  check('Fels auf den Wolf geladen: er wird zuerst herausgeschoben (spätestens im dritten Schritt)', zuerst > 0 && zuerst <= 0.16, `draußen ab ${f(zuerst, 2)} s`);
  check(`… und läuft danach nie durch den Fels (Abstand ≥ ${f(minR)} m − 2 cm bis zum Ende)`, minNachher >= minR - 0.02, `kleinster Abstand ${f(minNachher, 3)} m`);
}
{
  // Kein Spawn im Fels: eine Kiste deckt den Ring (5 m um den Spieler) ab.
  const eintrag = wolfEintrag({ spawnChance: 1, globalMax: 20, maxPerPlayer: 20, spawnIntervalSec: 1, ringMin: 5, ringMax: 5, groupSizeMin: 1, groupSizeMax: 1 });
  const peer: Vector3 = { x: 0, y: BODEN_Y, z: 0 };
  const mit = felsRahmen([eintrag], 81);
  mit.kiste(0, 0);
  const ohne = felsRahmen([eintrag], 81);
  for (let i = 0; i < 20; i++) {
    mit.spawns.update(0.5, [peer]);
    ohne.spawns.update(0.5, [peer]);
  }
  check('Spawn: im Fels (Kiste über dem Ring) entsteht kein Wolf', mit.spawns.creatureCount === 0, `${mit.spawns.creatureCount} Wölfe`);
  check('Gegenprobe ohne Kiste: es entstehen Wölfe (Zeuge, dass die Probe überhaupt spawnt)', ohne.spawns.creatureCount >= 5, `${ohne.spawns.creatureCount} Wölfe`);
}

// ── [19] Schrittdeckel (B9), nichts Totes (B8) ─────────────────────
console.log('\n[19] Ein Stau wird höchstens 2 s nachgeholt; `kiBlockt` (ohne Aufrufer) ist entfernt');
{
  const { zdos, spawns } = baue([ruhigerWolf()], 91);
  const wolf = setzeWolf(zdos, 0, 0, 0);
  spawns.adoptPersisted();
  const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 14 }; // in Sicht und in der Leine, 14 m vor dem Wolf
  spawns.update(0.05, [spieler], [spieler], [{ id: 'p0', blick: null }]); // bemerkt
  for (let i = 0; i < 6; i++) spawns.update(0.05, [spieler], [spieler], [{ id: 'p0', blick: null }]); // losgerannt
  const z0 = wolf.position.z;
  spawns.update(10, [spieler], [spieler], [{ id: 'p0', blick: null }]); // ein einziger Stau von 10 s
  const weg = wolf.position.z - z0;
  // Nachgeholt werden höchstens 2 s (in Teilschritten zu 0,25 s): 4,9 × 2 = 9,8 m; ungekappt wären es bis zum Spieler 14 m.
  check('ein Stau von 10 s holt höchstens 2 s nach: der Wolf läuft höchstens 4,9 × 2 m', weg > 4.9 && weg <= 4.9 * 2 + 1e-6, `Weg ${f(weg, 3)} m`);
  // Die Meldung auf einen Schlag gegen einen Heimkehrer ist ein Katalogschlüssel mit Text in beiden Sprachen.
  const katalog = (l: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../client/src/i18n/katalog/${l}.json`, import.meta.url), 'utf8'));
  const schluessel = SHARED.SERVER_MELDUNG_UNVERWUNDBAR.slice(SHARED.SERVER_MELDUNG_SCHLUESSEL_PRAEFIX.length);
  const de = katalog('de')[schluessel];
  const en = katalog('en')[schluessel];
  check('Schlag auf einen Heimkehrer: die Meldung ist der Schlüssel „@kampf.unverwundbar“ mit deutschem und englischem Text', SHARED.SERVER_MELDUNG_UNVERWUNDBAR === '@kampf.unverwundbar' && !!de && !!en && de !== en, `de „${de}“, en „${en}“`);
  check('`kiBlockt` hatte keinen Aufrufer und ist entfernt (kein totes Export)', !('kiBlockt' in SHARED));
}

// ── [20] Nachholen langer Ticks (N2 N1-7) ──────────────────────────
console.log('\n[20] Lange Ticks (0,5 s, 1 s) holen in Teilschritten nach: mindestens 95 % der Wanduhr; ein Hänger von 30 s nur 2 s');
{
  /** Wolf jagt einen Spieler 30 m vor sich (ohne Leine, ohne Strecken- und Zeitgrenze); Weg nach 2 s Wanduhr. */
  const wegNach = (dt: number, takte: number): number => {
    const { zdos, spawns } = baue([ruhigerWolf()], 95, { ki: { leine: Infinity, verfolgungM: Infinity, verfolgungSec: Infinity } });
    const wolf = setzeWolf(zdos, 0, 0, 0);
    spawns.adoptPersisted();
    const spieler: Vector3 = { x: 0, y: BODEN_Y, z: 30 };
    const info = [{ id: 'p0', blick: null }];
    spawns.treffer(wolf, { id: 'p0', schaden: 1 });
    for (let i = 0; i < takte; i++) spawns.update(dt, [spieler], [spieler], info);
    return wolf.position.z;
  };
  const ref = wegNach(0.05, 40);
  const halb = wegNach(0.5, 4);
  const ganz = wegNach(1, 2);
  check('Referenz: 2 s Wanduhr in Schritten zu 0,05 s (0,25 s Reaktionszeit, dann 4,9 m/s)', ref > 7 && ref < 9.5, `${f(ref, 2)} m`);
  check('Ticks zu 0,5 s erreichen mindestens 95 % der Wanduhr', halb >= ref * 0.95, `${f(halb, 2)} m = ${f((halb / ref) * 100, 1)} %`);
  check('Ticks zu 1 s erreichen mindestens 95 % der Wanduhr', ganz >= ref * 0.95, `${f(ganz, 2)} m = ${f((ganz / ref) * 100, 1)} %`);
  const haenger = wegNach(30, 1);
  check('Ein Hänger von 30 s holt höchstens 2 s nach (keine Lawine): höchstens 4,9 × 2 m', haenger <= 4.9 * 2 + 1e-6 && haenger > 7, `${f(haenger, 2)} m`);
}

// ── [21] Der Anker wandert nicht davon (N2 N1-4) ───────────────────
console.log('\n[21] Dichtes Feld, Spieler kreist 1800 s: der Anker bleibt in der Leine des Ursprungs');
{
  const r = felsRahmen([wolfEintrag()], 101);
  const zufall = new XorShiftRandom(31);
  for (let i = 0; i < 150; i++) r.fels(zufall.rangeFloat(-35, 35), zufall.rangeFloat(-35, 35));
  const wolfe: ZDO[] = [];
  const urspruenge: { x: number; z: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const x = zufall.rangeFloat(-35, 35);
    const z = zufall.rangeFloat(-35, 35);
    urspruenge.push({ x, z });
    wolfe.push(setzeWolf(r.zdos, x, z, zufall.rangeFloat(0, Math.PI * 2)));
  }
  r.spawns.adoptPersisted();
  const info = [{ id: 'p0', blick: null }];
  let t = 0;
  let ankerVersetzt = 0;
  for (let i = 0; i < 18000; i++) {
    t += 0.1;
    const a = (t * 4.5) / 25;
    const spieler: Vector3 = { x: Math.cos(a) * 25, y: BODEN_Y, z: Math.sin(a) * 25 };
    r.spawns.update(0.1, [spieler], [spieler], info);
  }
  let maxAnker = 0;
  let maxOrt = 0;
  let lebend = 0;
  const staten = creaturesVon(r.spawns) as unknown as Map<string, { zdo: ZDO; home: Vector3; ursprung: Vector3 }>;
  for (const c of staten.values()) {
    lebend++;
    maxAnker = Math.max(maxAnker, Math.hypot(c.home.x - c.ursprung.x, c.home.z - c.ursprung.z));
    maxOrt = Math.max(maxOrt, Math.hypot(c.zdo.position.x - c.ursprung.x, c.zdo.position.z - c.ursprung.z));
  }
  ankerVersetzt = 30 - lebend;
  check(`Kein Anker liegt weiter als die Leine (${WOLF_KI.leine} m) vom Ursprung (30 Wölfe, 150 Felsen, 1800 s)`, lebend > 0 && maxAnker <= WOLF_KI.leine + 1e-6, `größter Anker-Abstand ${f(maxAnker, 2)} m, ${lebend} von 30 am Leben`);
  check('… und kein Wolf steht weiter als Anker + Leine (2 × 12 m) vom Ursprung', maxOrt <= 2 * WOLF_KI.leine + 0.5, `größter Abstand zum Ursprung ${f(maxOrt, 2)} m`);
  console.log(`      (aus dem Spiel genommen, weil der neue Anker zu weit lag: ${ankerVersetzt})`);
}

// ── [22] Wasser und Felshaufen beim Herausschieben (N2 N1-5) ───────
console.log('\n[22] Herausschieben betritt kein Wasser; ohne gültigen Ausweg verschwindet der Wolf; Felshaufen werden verlassen');
{
  // Wasser nur im Osten: der kürzeste Weg (Osten) ist ungültig, der Wolf geht in eine andere Richtung.
  const r = felsRahmen([ruhigerWolf()], 111, undefined, true, (x) => (x > 1.0 ? -5 : BODEN_Y));
  r.fels(0, 0);
  const wolf = setzeWolf(r.zdos, 0.4, 0, 0);
  r.spawns.adoptPersisted();
  const spieler: Vector3 = { x: -8, y: BODEN_Y, z: 0 };
  r.spawns.treffer(wolf, { id: 'p0', schaden: 1 });
  for (let i = 0; i < 40; i++) r.spawns.update(0.05, [spieler], [spieler], [{ id: 'p0', blick: null }]);
  check('Wasser im Osten: der Wolf landet nicht im Wasser (Boden unter ihm ≥ Mindesthöhe 30,5), kein Fels unter ihm', !wolf.destroyed && wolf.position.y >= 30.5 && Math.hypot(wolf.position.x, wolf.position.z) >= FELS_RADIUS + WOLF.koerperRadius - 0.03, `Position (${f(wolf.position.x)}; ${f(wolf.position.z)}), y ${f(wolf.position.y, 1)}`);
}
{
  // Rundum Wasser (Land nur unter dem Fels): kein gültiger Ausweg, der Wolf wird aus dem Spiel genommen.
  const r = felsRahmen([ruhigerWolf()], 112, undefined, true, (x, z) => (Math.hypot(x, z) <= 1.6 ? BODEN_Y : -5));
  r.fels(0, 0);
  const wolf = setzeWolf(r.zdos, 0.4, 0, 0);
  r.spawns.adoptPersisted();
  const spieler: Vector3 = { x: -8, y: BODEN_Y, z: 0 };
  r.spawns.treffer(wolf, { id: 'p0', schaden: 1 });
  let weg = -1;
  for (let i = 0; i < 40 && weg < 0; i++) {
    r.spawns.update(0.05, [spieler], [spieler], [{ id: 'p0', blick: null }]);
    if (wolf.destroyed) weg = i;
  }
  check('Rundum Wasser: kein gültiger Ausweg ⇒ der Wolf wird abgeräumt (ZDO zerstört, nicht mehr in der Simulation)', weg >= 0 && weg <= 8 && r.spawns.creatureCount === 0, `abgeräumt im Schritt ${weg}, Kreaturen ${r.spawns.creatureCount}`);
}
{
  // Felshaufen: 40 Wölfe, je mitten in 3–10 überlappenden Felsen, je ein Spieler 8 m daneben; alle jagen.
  const r = felsRahmen([wolfEintrag()], 113);
  const zufall = new XorShiftRandom(9);
  const wolfe: ZDO[] = [];
  const felsen: { x: number; z: number }[] = [];
  const spieler: Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const cx = (i % 8) * 30;
    const cz = Math.floor(i / 8) * 30;
    const n = 3 + Math.floor(zufall.nextFloat() * 8);
    for (let k = 0; k < n; k++) {
      const x = cx + zufall.rangeFloat(-1.5, 1.5);
      const z = cz + zufall.rangeFloat(-1.5, 1.5);
      r.fels(x, z);
      felsen.push({ x, z });
    }
    wolfe.push(setzeWolf(r.zdos, cx, cz, 0));
    spieler.push({ x: cx + 8, y: BODEN_Y, z: cz });
  }
  r.spawns.adoptPersisted();
  const info = spieler.map((_, i) => ({ id: `P${i}`, blick: null }));
  wolfe.forEach((w, i) => r.spawns.treffer(w, { id: `P${i}`, schaden: 1 }));
  for (let i = 0; i < 200; i++) r.spawns.update(0.05, spieler, spieler, info);
  const drin = wolfe.filter((w) => !w.destroyed && felsen.some((k) => Math.hypot(k.x - w.position.x, k.z - w.position.z) < FELS_RADIUS - 0.1)).length;
  const weg = wolfe.filter((w) => w.destroyed).length;
  check('Felshaufen (40 Wölfe in 3–10 überlappenden Felsen, 10 s Jagd): keiner steckt noch im Fels, keiner musste gehen', drin === 0 && weg === 0, `${drin} im Fels, ${weg} abgeräumt`);
}

{
  // Ein einziger Aufruf führt aus einem Felshaufen ins Freie (kein Hin- und Herpendeln zwischen zwei Felsen).
  const kw = new Kollisionswelt(new ZDOManager(1n), new PrefabManager(), () => BODEN_Y);
  const kapsel = { art: 'kapsel' as const, x: 0, z: 0, radius: FELS_RADIUS, yMin: -1, yMax: 3 };
  const zufall = new XorShiftRandom(9);
  let geschoben = 0;
  let nichtFrei = 0;
  let keinAusweg = 0;
  for (let i = 0; i < 200; i++) {
    const n = 3 + Math.floor(zufall.nextFloat() * 8);
    const nf = kw.nahfeldAus(Array.from({ length: n }, () => ({ form: kapsel, position: { x: zufall.rangeFloat(-1.5, 1.5), y: BODEN_Y, z: zufall.rangeFloat(-1.5, 1.5) } })));
    const res = nf.ausDemFels({ x: 0, y: BODEN_Y, z: 0 }, WOLF.koerperRadius);
    if (res === 'keinAusweg') keinAusweg++;
    else if (res) {
      geschoben++;
      if (nf.ausDemFels({ x: res.x, y: BODEN_Y, z: res.z }, WOLF.koerperRadius) !== null) nichtFrei++;
    }
  }
  check('200 Felshaufen (3–10 überlappende Felsen um den Wolf): ein Aufruf führt ins Freie, nie „kein Ausweg“ auf freiem Land', geschoben >= 150 && nichtFrei === 0 && keinAusweg === 0, `${geschoben} geschoben, danach ${nichtFrei} noch im Fels, ${keinAusweg} ohne Ausweg`);
  // Ein dicker Block (7 × 7 Felsen im Abstand 1,5 m, rund 12 m breit): ein Schub reicht nicht, er geht in derselben Richtung weiter.
  const block = kw.nahfeldAus(Array.from({ length: 49 }, (_, k) => ({ form: kapsel, position: { x: ((k % 7) - 3) * 1.5, y: BODEN_Y, z: (Math.floor(k / 7) - 3) * 1.5 } })));
  const ausBlock = block.ausDemFels({ x: 0, y: BODEN_Y, z: 0 }, WOLF.koerperRadius);
  const weit = ausBlock && ausBlock !== 'keinAusweg' ? Math.hypot(ausBlock.x, ausBlock.z) : 0;
  check('Block aus 49 Felsen, Wolf in der Mitte: der Schub geht in einer Richtung bis ins Freie (mehr als 5 m) und ist dort frei', weit > 5 && block.ausDemFels({ x: (ausBlock as { x: number }).x, y: BODEN_Y, z: (ausBlock as { z: number }).z }, WOLF.koerperRadius) === null, `Weg ${f(weit, 2)} m`);
}

// ── [23] Heimkehr: Fortschrittsschwelle (N2 N1-8) ──────────────────
console.log('\n[23] Die Heimkehr zählt nur Fortschritt ab 0,25 m: ein Schleicher mit 0,04 m/s sitzt fest, einer mit 0,1 m/s nicht');
{
  const lauf = (tempo: number): { ankerNeu: number; angekommen: number } => {
    const z = neuerKiZustand();
    const fig: Figur = { x: 0, z: -12.5, yaw: 0, gelaufen: 0 };
    kiLaerm(z, 'p0');
    const ziel: KiZiel = { key: 'p0', x: 0, z: -30 }; // ausser Sicht, nur gehört
    const dt = 0.1;
    let ankerNeu = -1;
    let angekommen = -1;
    let t = 0;
    // Erst in die Heimkehr bringen (jenseits der Leine ⇒ heimkehren im ersten Schritt).
    kiSchritt(z, WOLF_KI, welt(fig, [ziel]), dt, () => 0.5);
    for (let i = 0; i < 400 && ankerNeu < 0 && angekommen < 0; i++) {
      t += dt;
      const b = kiSchritt(z, WOLF_KI, welt(fig, [ziel]), dt, () => 0.5);
      if (b.ankerNeu) ankerNeu = t;
      else if (b.phase === 'wandern') angekommen = t;
      else if (b.phase === 'heimkehren') fig.z += tempo * dt; // nach +z, dem Anker (0,0) zu
    }
    return { ankerNeu, angekommen };
  };
  const langsam = lauf(0.04);
  check(`Schleicher 0,04 m/s (0,25 m Fortschritt erst nach 6,25 s): nach ${HEIMKEHR_FESTSITZEN_SEC} s gilt er als festsitzend`, langsam.ankerNeu >= HEIMKEHR_FESTSITZEN_SEC - 0.2 && langsam.ankerNeu <= HEIMKEHR_FESTSITZEN_SEC + 0.3, `Anker neu bei ${f(langsam.ankerNeu, 1)} s`);
  const mittel = lauf(0.1);
  check('Wer mit 0,1 m/s vorankommt (0,25 m je 2,5 s), ist nicht festgesessen: Anker bleibt (er kommt an oder läuft noch)', mittel.ankerNeu < 0, `Anker neu bei ${f(mittel.ankerNeu, 1)} s`);
}

// ── [24] aufgegeben: Grenze Leine + Sicht (N2 N1-8) ────────────────
console.log('\n[24] Ein aufgegebenes Ziel wird vergessen, wenn es weiter als Leine + Sicht (29 m) vom Anker weg ist');
{
  const z = neuerKiZustand();
  z.aufgegeben.add('p0');
  const fig: Figur = { x: 0, z: 0, yaw: 0, gelaufen: 0 }; // Wolf zu Hause, blickt +z
  const dt = 0.1;
  const schritt = (zz: number): KiBefehl => kiSchritt(z, WOLF_KI, welt(fig, [{ key: 'p0', x: 0, z: zz }]), dt, () => 0.5);
  schritt(14); // 14 m: im Sicht-, aber ausser Reviers: bleibt ignoriert
  check('14 m vom Anker (ausserhalb der Leine, in Sicht): bleibt aufgegeben und unbemerkt', z.aufgegeben.has('p0') && z.phase === 'wandern');
  schritt(40); // weit weg (40 m > Leine + Sicht)
  check('40 m vom Anker (weiter als Leine + Sicht): wird vergessen', !z.aufgegeben.has('p0'));
  const b = schritt(14);
  check('kommt er danach wieder auf 14 m, ist er ein neuer Anlass: der Wolf bemerkt ihn', b.phase !== 'wandern', `Phase ${b.phase}`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
