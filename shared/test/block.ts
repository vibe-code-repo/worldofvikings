/**
 * D3-K1: the pure block rule and the shared block speed.
 *
 *  [1] parry window: 0, 199, 200 and 201 ms after the block began, and the lock (no window)
 *  [2] front cone: 69, 70, 71 and 180 degrees, unknown view, attacker on the victim
 *  [3] holding: 2 stamina per second over 5 s, the block ends at 0
 *  [4] a blow that meets the block: absorption 0.7, 4 stamina, break at 3.9 and not at 4.0, parry costs 4 as well
 *  [5] block speed in the shared movement step (half the walking speed, no running)
 *
 * View yaw uses the server convention: the view points along (-sin yaw, -cos yaw); yaw 0 looks to -z.
 *
 * Run: npx tsx shared/test/block.ts
 */
import {
  BLOCK_ABSORPTION,
  BLOCK_HALTEN_PRO_SEK,
  BLOCK_KEGEL_GRAD,
  BLOCK_SPERRE_MS,
  BLOCK_TREFFER_AUSDAUER,
  PARADE_FENSTER_MS,
  blockHalten,
  blockTreffer,
  imBlockKegel,
  paradeOffen,
} from '../src/kampf/block.js';
import { bewegungsSchritt } from '../src/bewegung/schritt.js';
import { ebenerBoden, OHNE_HINDERNISSE } from '../src/bewegung/abfragen.js';
import { BLOCK_TEMPO_FAKTOR, GEH_TEMPO, SCHRITT_LAENGE, bewegungsTempo } from '../src/bewegung/masse.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const nah = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

console.log('\n[0] The numbers');
check('absorption 0.7, hold 2/s, blow 4, window 200 ms, cone 70 degrees, lock 500 ms',
  BLOCK_ABSORPTION === 0.7 && BLOCK_HALTEN_PRO_SEK === 2 && BLOCK_TREFFER_AUSDAUER === 4 && PARADE_FENSTER_MS === 200 && BLOCK_KEGEL_GRAD === 70 && BLOCK_SPERRE_MS === 500);

console.log('\n[1] Parry window');
{
  const t0 = 10_000;
  check('0 ms after the start: open', paradeOffen(t0, false, t0 + 0));
  check('199 ms: open', paradeOffen(t0, false, t0 + 199));
  check('200 ms: open (the edge belongs to the window)', paradeOffen(t0, false, t0 + 200));
  check('201 ms: closed', !paradeOffen(t0, false, t0 + 201));
  check('H1: a clock that jumped backwards (jetzt < blockSeit): closed', !paradeOffen(t0, false, t0 - 1) && !paradeOffen(t0, false, t0 - 3_600_000));
  check('no block (blockSeit 0): closed', !paradeOffen(0, false, 100));
  check('a block that began inside the lock (ohneParade): closed even at 0 ms', !paradeOffen(t0, true, t0));
}

console.log('\n[2] Front cone (victim at the origin looking to -z; attacker 3 m away at an angle from the view)');
{
  const opfer = { x: 0, z: 0 };
  const bei = (grad: number, yaw = 0) => {
    // direction at `grad` degrees to the right of the view (view = (-sin yaw, -cos yaw))
    const w = (grad * Math.PI) / 180;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = fz;
    const rz = -fx;
    return { x: 3 * (Math.cos(w) * fx + Math.sin(w) * rx), z: 3 * (Math.cos(w) * fz + Math.sin(w) * rz) };
  };
  check('0 degrees (dead ahead): inside', imBlockKegel(0, opfer, bei(0)));
  check('69 degrees: inside', imBlockKegel(0, opfer, bei(69)));
  check('-69 degrees (other side): inside', imBlockKegel(0, opfer, bei(-69)));
  check('71 degrees: outside', !imBlockKegel(0, opfer, bei(71)));
  check('-71 degrees: outside', !imBlockKegel(0, opfer, bei(-71)));
  check('90 degrees (abeam): outside', !imBlockKegel(0, opfer, bei(90)));
  check('180 degrees (behind): outside', !imBlockKegel(0, opfer, bei(180)));
  check('the cone follows the view yaw (yaw 1.2 rad, 69 / 71 degrees)', imBlockKegel(1.2, opfer, bei(69, 1.2)) && !imBlockKegel(1.2, opfer, bei(71, 1.2)));
  check('the cone uses the view, not the position of the attacker alone (attacker ahead of yaw 0, view turned by 180 degrees: outside)', !imBlockKegel(Math.PI, opfer, bei(0, 0)));
  check('unknown view (null / undefined / NaN): outside', !imBlockKegel(null, opfer, bei(0)) && !imBlockKegel(undefined, opfer, bei(0)) && !imBlockKegel(NaN, opfer, bei(0)));
  check('attacker exactly on the victim: outside (no direction)', !imBlockKegel(0, opfer, { x: 0, z: 0 }));
}

console.log('\n[3] Holding');
{
  let wert = 100;
  for (let i = 0; i < 100; i++) wert = blockHalten(wert, 0.05).wert; // 5 s in 50 ms ticks
  check('5 s of holding cost 10 stamina (+-0.1)', Math.abs(100 - wert - 10) <= 0.1, `${wert}`);
  check('the block does not end while stamina is left', !blockHalten(1, 0.05).endet);
  check('the block ends at 0 and the stamina does not go below', blockHalten(0.05, 0.05).endet && blockHalten(0.05, 0.05).wert === 0, JSON.stringify(blockHalten(0.05, 0.05)));
  check('negative dt costs nothing', blockHalten(50, -1).wert === 50);
}

console.log('\n[4] A blow meets the block');
{
  const opfer = { x: 0, z: 0 };
  const vorn = { x: 0, z: -2 };
  const hinten = { x: 0, z: 2 };
  const stand = (ausdauer: number, blockSeit = 1000, ohneParade = false) => ({ blockSeit, ohneParade, ausdauer, blickYaw: 0 });
  const spaet = 1000 + 500; // far outside the parry window

  const g = blockTreffer(stand(100), opfer, vorn, 30, spaet);
  check('from the front, late: art geblockt, 30 % of the damage, stamina -4, block goes on',
    g.art === 'geblockt' && nah(g.schaden, 9, 1e-9) && g.ausdauer === 96 && !g.endet, JSON.stringify(g));
  const r = blockTreffer(stand(100), opfer, hinten, 30, spaet);
  check('from behind: art keiner, the full damage, stamina untouched', r.art === 'keiner' && r.schaden === 30 && r.ausdauer === 100 && !r.endet, JSON.stringify(r));
  const kein = blockTreffer({ blockSeit: 0, ohneParade: false, ausdauer: 100, blickYaw: 0 }, opfer, vorn, 30, spaet);
  check('no block held: art keiner, full damage', kein.art === 'keiner' && kein.schaden === 30 && kein.ausdauer === 100);
  const p = blockTreffer(stand(100), opfer, vorn, 30, 1000 + 199);
  check('in the parry window (199 ms): art pariert, 0 damage, the 4 stamina are paid anyway', p.art === 'pariert' && p.schaden === 0 && p.ausdauer === 96 && !p.endet, JSON.stringify(p));
  const p200 = blockTreffer(stand(100), opfer, vorn, 30, 1000 + 200);
  check('at 200 ms still a parry', p200.art === 'pariert');
  const p201 = blockTreffer(stand(100), opfer, vorn, 30, 1000 + 201);
  check('at 201 ms an ordinary block: 30 % of the damage', p201.art === 'geblockt' && nah(p201.schaden, 9, 1e-9));
  const pOhne = blockTreffer(stand(100, 1000, true), opfer, vorn, 30, 1000 + 50);
  check('inside the lock (ohneParade) the same time is no parry', pOhne.art === 'geblockt');
  const pHinten = blockTreffer(stand(100), opfer, hinten, 30, 1000 + 50);
  check('a blow from behind in the window is no parry', pHinten.art === 'keiner' && pHinten.schaden === 30);

  const b39 = blockTreffer(stand(3.9), opfer, vorn, 30, spaet);
  check('stamina 3.9 (blow costs 4): the block breaks, full damage, stamina 0, the block ends', b39.art === 'bruch' && b39.schaden === 30 && b39.ausdauer === 0 && b39.endet, JSON.stringify(b39));
  const b40 = blockTreffer(stand(4), opfer, vorn, 30, spaet);
  check('stamina 4.0: no break, 30 % of the damage, stamina 0 and the block ends', b40.art === 'geblockt' && nah(b40.schaden, 9, 1e-9) && b40.ausdauer === 0 && b40.endet, JSON.stringify(b40));
  const pa3 = blockTreffer(stand(3), opfer, vorn, 30, 1000 + 10);
  check('a parry with 3 stamina left still holds (0 damage) and drains to 0', pa3.art === 'pariert' && pa3.schaden === 0 && pa3.ausdauer === 0 && pa3.endet, JSON.stringify(pa3));
  const arm = blockTreffer(stand(100), opfer, vorn, 8, spaet);
  check('8 damage: 2.4 after the block', nah(arm.schaden, 2.4, 1e-9), `${arm.schaden}`);
}

console.log('\n[5] Block speed in the shared step');
{
  const boden = ebenerBoden(0);
  const gehe = (eingabe: { x: number; z: number; rennt: boolean; blockt?: boolean }): number => {
    let z = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60; i += 1) z = bewegungsSchritt(z, eingabe, SCHRITT_LAENGE, boden, OHNE_HINDERNISSE);
    return z.z;
  };
  check('BLOCK_TEMPO_FAKTOR is 0.5', BLOCK_TEMPO_FAKTOR === 0.5);
  check('one second of walking while blocking = half the walking speed (2.25 m)', nah(gehe({ x: 0, z: 1, rennt: false, blockt: true }), GEH_TEMPO * 0.5, 1e-9), `${gehe({ x: 0, z: 1, rennt: false, blockt: true })}`);
  check('running is ignored while blocking (same 2.25 m)', nah(gehe({ x: 0, z: 1, rennt: true, blockt: true }), GEH_TEMPO * 0.5, 1e-9));
  check('without blockt the walk is unchanged (4.5 m)', nah(gehe({ x: 0, z: 1, rennt: false }), GEH_TEMPO, 1e-9) && nah(gehe({ x: 0, z: 1, rennt: false, blockt: false }), GEH_TEMPO, 1e-9));
  check('bewegungsTempo: walk, run, block, block+run', bewegungsTempo(false, false) === 4.5 && bewegungsTempo(true, false) === 7.5 && bewegungsTempo(false, true) === 2.25 && bewegungsTempo(true, true) === 2.25);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
