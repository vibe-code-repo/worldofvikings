/**
 * D3-K4: the pure roll rule, the roll speed in the shared movement step and the jump bill.
 *
 *  [0] the numbers (path, time, speed, stamina, locks)
 *  [1] refusal order and each reason
 *  [2] invulnerable time: at the start, 1 ms before the end, at the end (exclusive), a clock that jumped back
 *  [3] slices of movement: the sum of all slices is the movement time whatever the packet rhythm
 *  [4] the path in the shared step: 4.853 +- 0.01 m over flat ground, the speed beats block and running
 *  [5] free room: the 80 % threshold, not a number nearer to the full path
 *  [6] direction: yaw and vector are inverse, the convention of the view
 *  [7] jump: billed 5, lock 0.8 s, not billed without stamina
 *
 * Run: npx tsx shared/test/d3-rolle.ts
 */
import {
  ROLLE_ABKLINGZEIT_MS,
  ROLLE_AUSDAUER,
  ROLLE_BEWEGUNG_MS,
  ROLLE_BEWEGUNG_S,
  ROLLE_DAUER_MS,
  ROLLE_MIN_ANTEIL,
  ROLLE_MIN_WEG_M,
  ROLLE_KURVE_ANTEIL,
  ROLLE_KURVE_SCHRITT_S,
  ROLLE_SPERRE_TOLERANZ_MS,
  ROLLE_TEMPO,
  ROLLE_WEG_M,
  SPRUNG_AUSDAUER,
  SPRUNG_SPERRE_MS,
  rolleAblehnung,
  rolleFreiraumOk,
  rolleLaeuft,
  rolleRichtung,
  rolleScheibe,
  rolleWegAnteil,
  rolleUnverwundbar,
  rolleYawVon,
  sprungAbrechnen,
  type RolleStand,
} from '../src/kampf/rolle.js';
import { bewegungsSchritt } from '../src/bewegung/schritt.js';
import { ebenerBoden, OHNE_HINDERNISSE } from '../src/bewegung/abfragen.js';
import { bewegungsTempo, LAUF_TEMPO } from '../src/bewegung/masse.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const nah = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

console.log('\n[0] The numbers');
check('path 4.853 m in 0.8333 s, clip 875 ms, stamina 10, lock 500 ms, 80 %', ROLLE_WEG_M === 4.853 && nah(ROLLE_BEWEGUNG_MS, 833.3333333, 1e-3) && ROLLE_DAUER_MS === 875 && ROLLE_AUSDAUER === 10 && ROLLE_ABKLINGZEIT_MS === 500 && ROLLE_MIN_ANTEIL === 0.8);
check('the speed is path / movement time (5.82 m/s)', nah(ROLLE_TEMPO, 4.853 / (20 / 24), 1e-9) && nah(ROLLE_TEMPO, 5.8236, 1e-3), `${ROLLE_TEMPO}`);
check('jump: 5 stamina, lock 800 ms', SPRUNG_AUSDAUER === 5 && SPRUNG_SPERRE_MS === 800);

console.log('\n[1] Refusal: each reason, and the order');
const frei: RolleStand = { tot: false, flug: false, imWasser: false, rolleBis: 0, rolleSperreBis: 0, ausdauer: 100, yaw: 0 };
{
  const t = 100_000;
  check('free: allowed', rolleAblehnung(frei, t) === null);
  check('dead', rolleAblehnung({ ...frei, tot: true }, t) === 'tot');
  check('flight mode', rolleAblehnung({ ...frei, flug: true }, t) === 'flug');
  check('in the water', rolleAblehnung({ ...frei, imWasser: true }, t) === 'wasser');
  check('a roll is running (until rolleBis, exclusive)', rolleAblehnung({ ...frei, rolleBis: t + 1 }, t) === 'laeuft' && rolleAblehnung({ ...frei, rolleBis: t }, t) === null);
  check('lock with the jitter tolerance (100 ms): refused 101 ms before rolleSperreBis, allowed 100 ms before and at it',
    rolleAblehnung({ ...frei, rolleSperreBis: t + 101 }, t) === 'abklingzeit' && rolleAblehnung({ ...frei, rolleSperreBis: t + 100 }, t) === null && rolleAblehnung({ ...frei, rolleSperreBis: t }, t) === null);
  check('the tolerance is 100 ms, the client lock stays 500 ms', ROLLE_SPERRE_TOLERANZ_MS === 100 && ROLLE_ABKLINGZEIT_MS === 500);
  check('a roll that still runs is refused whatever the tolerance (laeuft before the lock)', rolleAblehnung({ ...frei, rolleBis: t + 1, rolleSperreBis: 0 }, t) === 'laeuft');
  check('stamina 9.99 refused, 10 allowed', rolleAblehnung({ ...frei, ausdauer: 9.99 }, t) === 'ausdauer' && rolleAblehnung({ ...frei, ausdauer: 10 }, t) === null);
  check('NaN stamina refused', rolleAblehnung({ ...frei, ausdauer: Number.NaN }, t) === 'ausdauer');
  check('NaN / infinite direction refused', rolleAblehnung({ ...frei, yaw: Number.NaN }, t) === 'richtung' && rolleAblehnung({ ...frei, yaw: Infinity }, t) === 'richtung');
  check('order: dead beats everything', rolleAblehnung({ ...frei, tot: true, flug: true, imWasser: true, rolleBis: t + 5, ausdauer: 0 }, t) === 'tot');
}

console.log('\n[2] Invulnerable for the whole clip');
{
  const s = 50_000;
  const bis = s + ROLLE_DAUER_MS;
  check('at the start (0 ms)', rolleUnverwundbar(s, bis, s));
  check('100 ms in', rolleUnverwundbar(s, bis, s + 100));
  check('clip length - 50 ms (825 ms)', rolleUnverwundbar(s, bis, s + 825));
  check('874 ms: still', rolleUnverwundbar(s, bis, s + 874));
  check('875 ms (the end, exclusive): vulnerable', !rolleUnverwundbar(s, bis, s + 875));
  check('clip length + 50 ms: vulnerable', !rolleUnverwundbar(s, bis, s + 925));
  check('1 ms before the start (clock jumped back): vulnerable', !rolleUnverwundbar(s, bis, s - 1));
  check('no roll (rolleBis 0): vulnerable', !rolleUnverwundbar(0, 0, 10));
  check('rolleLaeuft agrees with the invulnerable time', rolleLaeuft(bis, bis - 1) && !rolleLaeuft(bis, bis) && !rolleLaeuft(0, 5));
}

console.log('\n[3] Slices of movement: the path depends on the time, not on the number of packets');
{
  const s = 1000;
  const mitTakt = (schritt: number): number => {
    let zeit = s;
    let summe = 0;
    for (let t = s; t <= s + 2000; t += schritt) {
      const sc = rolleScheibe(s, zeit, t);
      zeit = sc.bis;
      summe += sc.dt;
    }
    return summe;
  };
  for (const takt of [1, 16, 50, 100, 400, 1000]) {
    check(`packets every ${takt} ms: the slices add up to the movement time (0.8333 s)`, nah(mitTakt(takt), ROLLE_BEWEGUNG_MS / 1000, 1e-9), `${mitTakt(takt)}`);
  }
  const letzte = rolleScheibe(s, s + 800, s + 5000);
  check('a late packet gets the remainder only (the part of the curve after 800 ms), the next one nothing', nah(letzte.dt, (1 - rolleWegAnteil(0.8)) * ROLLE_BEWEGUNG_S, 1e-12) && letzte.bis === s + ROLLE_DAUER_MS && rolleScheibe(s, letzte.bis, s + 6000).dt === 0, `${letzte.dt}`);
  check('the slices end with the clip (875 ms), not with the 833 ms of the constant speed', rolleScheibe(s, s + 834, s + 874).dt > 0 && rolleScheibe(s, s + 875, s + 900).dt === 0);
  check('the first 41.7 ms (the pose before the first key) move nothing, the slice 0 ... 125 ms moves the share of the curve', rolleScheibe(s, s, s + 41).dt === 0 && nah(rolleScheibe(s, s, s + 125).dt, rolleWegAnteil(0.125) * ROLLE_BEWEGUNG_S, 1e-12));
  check('a clock that jumped back adds nothing and moves the mark nowhere', rolleScheibe(s, s + 100, s + 50).dt === 0 && rolleScheibe(s, s + 100, s + 50).bis === s + 100);
}

console.log('\n[3b] The curve of the clip (share of the path over the time)');
{
  check('21 keys, the first 0, the last 1, none outside 0 ... 1', ROLLE_KURVE_ANTEIL.length === 21 && ROLLE_KURVE_ANTEIL[0] === 0 && ROLLE_KURVE_ANTEIL[20] === 1 && ROLLE_KURVE_ANTEIL.every((a) => a >= 0 && a <= 1));
  check('the last key is the clip length: 21 / 24 s = 875 ms', nah(21 * ROLLE_KURVE_SCHRITT_S * 1000, ROLLE_DAUER_MS, 1e-9));
  check('monotone: no key lies below the one before', ROLLE_KURVE_ANTEIL.every((a, i) => i === 0 || a >= ROLLE_KURVE_ANTEIL[i - 1]!));
  let monoton = true;
  let letzteA = 0;
  let maxSprung = 0;
  for (let ms = -10; ms <= 1000; ms++) {
    const a = rolleWegAnteil(ms / 1000);
    if (a < letzteA) monoton = false;
    maxSprung = Math.max(maxSprung, a - letzteA);
    letzteA = a;
  }
  check('rolleWegAnteil is monotone on a 1 ms grid and has no jump above 0.02 per ms', monoton && maxSprung < 0.02, `${maxSprung.toFixed(4)}`);
  check('before the first key (and at it): 0; at the last key and after it: 1; a negative time: 0', rolleWegAnteil(-1) === 0 && rolleWegAnteil(0) === 0 && rolleWegAnteil(1 / 24) === 0 && rolleWegAnteil(0.875) === 1 && rolleWegAnteil(5) === 1);
  check('at the keys the table values: 2/24 s = 0.18446, 9/24 s = 0.847868', nah(rolleWegAnteil(2 / 24), 0.18446, 1e-9) && nah(rolleWegAnteil(9 / 24), 0.847868, 1e-9));
  check('linear between the keys: halfway between the first two is 0.09223', nah(rolleWegAnteil(1.5 / 24), 0.09223, 1e-9));
  check('85 % of the path lie in the first 0.375 s (the clip is front-loaded: the constant speed would be at 45 %)', nah(rolleWegAnteil(0.375), 0.847868, 1e-9) && rolleWegAnteil(0.375) > 0.84 && 0.375 / (ROLLE_BEWEGUNG_S + 1 / 24) < 0.5);
  check('the last 0.5 s carry only 0.45 m of the 4.853 m (the clip nearly stops)', nah((1 - rolleWegAnteil(0.375)) * ROLLE_WEG_M, 0.7, 0.05) && nah((1 - rolleWegAnteil(0.4167)) * ROLLE_WEG_M, 0.577, 0.01));
  // the path along the slices (metres at the speed of the roll) is the path of the curve whatever the rhythm
  for (const takt of [1, 7, 16, 33, 50, 100, 400]) {
    const s0 = 5000;
    let zeit = s0;
    let weg = 0;
    let bei375 = 0;
    for (let t = s0; t <= s0 + 1200; t += takt) {
      const sc = rolleScheibe(s0, zeit, t);
      zeit = sc.bis;
      weg += sc.dt * ROLLE_TEMPO;
      if (t <= s0 + 375) bei375 = weg;
    }
    check(`packets every ${takt} ms: the metres add up to 4.853 and the path at <= 375 ms is the curve (${(bei375).toFixed(2)} m)`, nah(weg, ROLLE_WEG_M, 1e-9) && Math.abs(bei375 - rolleWegAnteil(Math.floor(375 / takt) * takt / 1000) * ROLLE_WEG_M) < 1e-9);
  }
}

console.log('\n[4] The path in the shared step (flat ground)');
{
  const boden = ebenerBoden(0);
  const geh = (rennt: boolean, blockt: boolean, rollt: boolean, sek: number): number => {
    let z = { x: 0, y: 0, z: 0 };
    const n = Math.round(sek * 60);
    for (let i = 0; i < n; i++) z = bewegungsSchritt(z, { x: 0, z: -1, rennt, blockt, rollt }, 1 / 60, boden, OHNE_HINDERNISSE);
    return Math.hypot(z.x, z.z);
  };
  const weg = geh(false, false, true, ROLLE_BEWEGUNG_MS / 1000);
  check('the roll covers 4.853 m in its movement time (+- 0.01 m)', nah(weg, ROLLE_WEG_M, 0.01), `${weg.toFixed(4)} m`);
  check('bewegungsTempo: the roll wins over running and blocking', bewegungsTempo(true, true, true) === ROLLE_TEMPO && bewegungsTempo(true, false, true) === ROLLE_TEMPO && bewegungsTempo(false, true) !== ROLLE_TEMPO && bewegungsTempo(true, false) === LAUF_TEMPO);
  check('and in the step: with the block flag the roll still goes the full path', nah(geh(false, true, true, ROLLE_BEWEGUNG_MS / 1000), ROLLE_WEG_M, 0.01));
  check('control: without the roll flag the same second goes the walking path (4.5 m)', nah(geh(false, false, false, 1), 4.5, 0.01));
}

console.log('\n[5] Free room: 80 % of the path');
{
  check('threshold = 80 % of 4.853 m', nah(ROLLE_MIN_WEG_M, 3.8824, 1e-9));
  check('the full path is free', rolleFreiraumOk(ROLLE_WEG_M));
  check('3.89 m (just above) is free, 3.88 m (just below) is not', rolleFreiraumOk(3.89) && !rolleFreiraumOk(3.88));
  check('1 m (a wall in 1 m) is not free', !rolleFreiraumOk(1));
  check('0, NaN, negative: not free', !rolleFreiraumOk(0) && !rolleFreiraumOk(Number.NaN) && !rolleFreiraumOk(-1));
}

console.log('\n[6] Direction');
{
  for (const yaw of [0, 1, -1, 2.5, -3]) {
    const r = rolleRichtung(yaw);
    check(`yaw ${yaw}: the vector is a unit vector and the yaw comes back`, nah(Math.hypot(r.x, r.z), 1, 1e-12) && nah(Math.atan2(Math.sin(rolleYawVon(r.x, r.z) - yaw), Math.cos(rolleYawVon(r.x, r.z) - yaw)), 0, 1e-9));
  }
  const vorn = rolleRichtung(0);
  check('yaw 0 looks along -z (the view convention)', nah(vorn.x, 0) && nah(vorn.z, -1));
  const links = rolleRichtung(Math.PI / 2);
  check('yaw +90 deg looks along -x', nah(links.x, -1, 1e-12) && nah(links.z, 0, 1e-12));
}

console.log('\n[7] The jump bill');
{
  const a = sprungAbrechnen(100, 0, 1000);
  check('billed: stamina 95, lock until +800 ms', a.bezahlt && a.ausdauer === 95 && a.sperreBis === 1800);
  const b = sprungAbrechnen(a.ausdauer, a.sperreBis, 1799);
  check('799 ms later: not billed, nothing changes', !b.bezahlt && b.ausdauer === 95 && b.sperreBis === 1800);
  const c = sprungAbrechnen(a.ausdauer, a.sperreBis, 1800);
  check('800 ms later: billed again', c.bezahlt && c.ausdauer === 90 && c.sperreBis === 2600);
  const d = sprungAbrechnen(4.99, 0, 1000);
  check('stamina 4.99: not billed, no lock either', !d.bezahlt && d.ausdauer === 4.99 && d.sperreBis === 0);
  check('stamina 5: billed to 0', sprungAbrechnen(5, 0, 1000).ausdauer === 0);
  check('stamina NaN: not billed', !sprungAbrechnen(Number.NaN, 0, 1000).bezahlt);
}

console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
