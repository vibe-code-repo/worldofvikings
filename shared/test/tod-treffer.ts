/**
 * Death and hit reaction: the pure rule (which clip for which side), the wire indices and the
 * one-shot member for a player figure.
 *
 * View yaw uses the server's convention (WovServer.fuehreBlickNach): the view points along
 * (-sin yaw, -cos yaw); at yaw 0 "front" is smaller z and "left" is larger x.
 *
 * Run: npx tsx shared/test/tod-treffer.ts
 */
import {
  richtungZuAngreifer, trefferClipFuer, todClipFuer, TOD_CLIPS, TREFFER_CLIPS, TOD_LIEGEZEIT_MS, TREFFER_MINDESTABSTAND_S,
  todClipIndex, todClipVonIndex, trefferClipIndex, trefferClipVonIndex, istTodOderTrefferClip,
  parseEinmal, naechstesEinmal, formatEinmal,
} from '../src/index.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

console.log('\n[1] Eight directions around a victim looking along -z (yaw 0), radius 3');
const opfer = { x: 10, z: 10 };
// [name, dx, dz, front, left]
const ACHT: Array<[string, number, number, boolean, boolean]> = [
  ['ahead', 0, -3, true, false],          // dead ahead: no side -> counts as right
  ['ahead-left', 3, -3, true, true],
  ['left', 3, 0, true, true],             // exactly abeam: in front (>= 0), left
  ['behind-left', 3, 3, false, true],
  ['behind', 0, 3, false, false],         // dead behind: no side -> counts as right
  ['behind-right', -3, 3, false, false],
  ['right', -3, 0, true, false],
  ['ahead-right', -3, -3, true, false],
];
for (const [name, dx, dz, vorn, links] of ACHT) {
  const r = richtungZuAngreifer(0, opfer, { x: opfer.x + dx, z: opfer.z + dz });
  check(`yaw 0, attacker ${name}: front=${vorn}, left=${links}`, r !== null && r.vorn === vorn && r.links === links, JSON.stringify(r));
}

console.log('\n[2] The same eight, victim turned (yaw 90 deg: the view points along -x)');
{
  // view (-1, 0): front = smaller x; left = (sin... ) the +z side is left? right = (-cos y, sin y) = (0, 1): right is +z.
  const y = Math.PI / 2;
  const t = (dx: number, dz: number) => richtungZuAngreifer(y, opfer, { x: opfer.x + dx, z: opfer.z + dz });
  check('attacker at smaller x is in front', t(-3, 0)!.vorn === true);
  check('attacker at larger x is behind', t(3, 0)!.vorn === false);
  check('front and at larger z: right (right hand = +z)', (() => { const r = t(-3, 3)!; return r.vorn && !r.links; })());
  check('front and at smaller z: left', (() => { const r = t(-3, -3)!; return r.vorn && r.links; })());
  check('behind and at smaller z: left', (() => { const r = t(3, -3)!; return !r.vorn && r.links; })());
}

console.log('\n[3] Clip choice');
check('front-left -> treffer_vorn_links', trefferClipFuer({ vorn: true, links: true }) === 'treffer_vorn_links');
check('front-right -> treffer_vorn_rechts', trefferClipFuer({ vorn: true, links: false }) === 'treffer_vorn_rechts');
check('behind-left -> treffer_hinten_links', trefferClipFuer({ vorn: false, links: true }) === 'treffer_hinten_links');
check('behind-right -> treffer_hinten_rechts', trefferClipFuer({ vorn: false, links: false }) === 'treffer_hinten_rechts');
check('unknown direction: front-left flinch (a defined default)', trefferClipFuer(null) === 'treffer_vorn_links');
check('deadly blow from the front -> tod_hinten (thrown backwards)', todClipFuer({ vorn: true, links: true }) === 'tod_hinten');
check('deadly blow from behind -> tod_vorn (falls forward)', todClipFuer({ vorn: false, links: false }) === 'tod_vorn');
check('deadly blow without direction -> tod_vorn (as the card says)', todClipFuer(null) === 'tod_vorn');
check('every one of the 8 directions maps to one of the four flinch clips, all four are used',
  new Set(ACHT.map(([, dx, dz]) => trefferClipFuer(richtungZuAngreifer(0, opfer, { x: opfer.x + dx, z: opfer.z + dz })))).size === 4);

console.log('\n[4] Degenerate input never guesses');
check('no view yet -> null', richtungZuAngreifer(null, opfer, { x: 11, z: 10 }) === null);
check('NaN view -> null', richtungZuAngreifer(Number.NaN, opfer, { x: 11, z: 10 }) === null);
check('attacker exactly on the victim -> null', richtungZuAngreifer(0, opfer, { ...opfer }) === null);
check('non-finite attacker position -> null', richtungZuAngreifer(0, opfer, { x: Number.POSITIVE_INFINITY, z: 0 }) === null);

console.log('\n[5] Wire indices');
check('death clips: index round trip, unknown index is null', TOD_CLIPS.every((c) => todClipVonIndex(todClipIndex(c)) === c) && todClipVonIndex(2) === null && todClipVonIndex(-1) === null && todClipVonIndex(0.5) === null && todClipVonIndex(Number.NaN) === null);
check('hit clips: index round trip, unknown index is null', TREFFER_CLIPS.every((c) => trefferClipVonIndex(trefferClipIndex(c)) === c) && trefferClipVonIndex(4) === null && trefferClipVonIndex(-1) === null);
check('istTodOderTrefferClip', istTodOderTrefferClip('tod_vorn') && istTodOderTrefferClip('treffer_hinten_links') && !istTodOderTrefferClip('idle') && !istTodOderTrefferClip('treffer_schwer'));

console.log('\n[6] The one-shot member carries the new clips, creatures keep theirs');
check('parseEinmal reads tod_hinten#3', JSON.stringify(parseEinmal('tod_hinten#3')) === JSON.stringify({ clip: 'tod_hinten', n: 3 }));
check('parseEinmal reads treffer_vorn_rechts#12', parseEinmal('treffer_vorn_rechts#12')?.n === 12);
check('the creature clips still parse', parseEinmal('attack#1')?.clip === 'attack' && parseEinmal('die#4')?.clip === 'die' && parseEinmal('hit#2')?.clip === 'hit');
check('an unknown clip name is still null (never a guess)', parseEinmal('treffer_schwer#1') === null && parseEinmal('tod_seitlich#1') === null && parseEinmal('tod_vorn') === null);
check('the counter goes up across clip kinds', naechstesEinmal(formatEinmal('treffer_vorn_links', 1), 'tod_vorn') === 'tod_vorn#2');

console.log('\n[7] The knobs');
check('lying time 5 s', TOD_LIEGEZEIT_MS === 5000);
check('minimum gap between two flinches is shorter than the clip (1.29 s) and longer than a quarter of it', TREFFER_MINDESTABSTAND_S > 0.32 && TREFFER_MINDESTABSTAND_S < 1.29, `${TREFFER_MINDESTABSTAND_S}`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
