/**
 * D3-K2: the eight clips for blocking and rolling on both body models, measured from the files.
 *
 * Run on the two REAL body models (assets/models/wikinger|wikingerin, 56 clips each):
 *  [1] Order: the 28 old clips, then the 20 core clips, then the 8 new ones, in this order.
 *  [2] Lengths as AvatarRig plays them ((to - from) / fps of the animation group, seconds): they are the
 *      constants the server and the client will use, e.g. the roll's invulnerability window is the length of `rolle`
 *      (0.875 s: the group starts at 0 and the first key sits at 1/24 s, so the motion proper lasts 0.833 s).
 *  [3] `block_halten` is a hold pose: first and last pose agree within 1 degree on every bone and the hips do
 *      not move. `block_start` ends in that pose, `block_ende` ends in it too.
 *  [4] Root travel per clip (forward = +z in the file). The roll covers 4.85 m on its own (the server must
 *      either follow that or play it in place), the four walk clips 1.8 to 1.9 m. The source of `block_links` /
 *      `block_rechts` travels along the forward axis, NOT sideways: this is pinned here as a fact of the files,
 *      so replacing those two clips by real side steps has to touch this test.
 *  [5] Both bodies carry identical animation data for the eight clips.
 *  [6] AvatarRig's exclusion list covers all of them (else the stance clips become idle variants and the
 *      walk and roll clips become candidates for the walk/run fallback).
 *
 * Needs the real body models. Run: npx tsx client/test/d3-clips.ts   (from the repo root or client/)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BLOCK_CLIPS, KERN_CLIPS, istKernClip } from '../src/player/kernClips.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(__dirname, '..', '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ALT = [
  'idle', 'gehen', 'rennen', 'springen', 'angriff', 'angriff2', 'angriff3', 'faust', 'faust2', 'faust3',
  'arm_schwert', 'hand_schwert', 'ausruesten', 'ablegen', 'parade_links', 'parade_rechts', 'parade_unten',
  'stab_angriff', 'stab_angriff2', 'stab_angriff3', 'arm_stab', 'stab_ausruesten', 'stab_ablegen',
  'stab_parade_links', 'stab_parade_rechts', 'stab_parade_unten', 'arm_speer', 'hand_speer',
];

/** Length in seconds and root travel (file units = metres) as measured in the files, 2026-10-02. */
const SOLL: Record<string, { laenge: number; vorwaerts: number }> = {
  block_start: { laenge: 0.458, vorwaerts: 0 },
  block_halten: { laenge: 0.167, vorwaerts: 0 },
  block_ende: { laenge: 0.458, vorwaerts: 0 },
  block_vor: { laenge: 1.375, vorwaerts: 1.926 },
  block_links: { laenge: 1.333, vorwaerts: -1.783 },
  block_rechts: { laenge: 1.333, vorwaerts: 1.784 },
  block_rueck: { laenge: 1.333, vorwaerts: -1.782 },
  rolle: { laenge: 0.875, vorwaerts: 4.853 },
};

const engine = new NullEngine();

async function lade(datei: string): Promise<AnimationGroup[]> {
  const scene = new Scene(engine);
  const url = 'data:model/gltf-binary;base64,' + readFileSync(datei).toString('base64');
  const container = await SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
  return container.animationGroups;
}

function winkel(a: Quaternion, b: Quaternion): number {
  const d = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

/** Largest rotation difference (degrees) between the pose at two key indices, over every bone. */
function posenAbstand(grp: AnimationGroup, i: number, j: number): { grad: number; knoten: string } {
  let grad = 0;
  let knoten = '';
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'rotationQuaternion') continue;
    const keys = ta.animation.getKeys();
    const a = keys[i < 0 ? keys.length + i : Math.min(i, keys.length - 1)]!.value as Quaternion;
    const b = keys[j < 0 ? keys.length + j : Math.min(j, keys.length - 1)]!.value as Quaternion;
    const w = winkel(a, b);
    if (w > grad) {
      grad = w;
      knoten = (ta.target as { name?: string })?.name ?? '';
    }
  }
  return { grad, knoten };
}

function hueftKeys(grp: AnimationGroup): Vector3[] {
  const ta = grp.targetedAnimations.find((t) => t.animation.targetProperty === 'position' && (t.target as { name?: string })?.name === 'Hips');
  if (!ta) throw new Error(`${grp.name}: no hips position channel`);
  return ta.animation.getKeys().map((k) => k.value as Vector3);
}

function laenge(grp: AnimationGroup): number {
  const fps = grp.targetedAnimations[0]!.animation.framePerSecond;
  return (grp.to - grp.from) / fps;
}

function datenGleich(a: AnimationGroup, b: AnimationGroup): boolean {
  if (a.targetedAnimations.length !== b.targetedAnimations.length) return false;
  const nach = (g: AnimationGroup) =>
    new Map(g.targetedAnimations.map((t) => [`${(t.target as { name?: string })?.name}/${t.animation.targetProperty}`, t.animation.getKeys()]));
  const na = nach(a);
  const nb = nach(b);
  for (const [k, ka] of na) {
    const kb = nb.get(k);
    if (!kb || kb.length !== ka.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (ka[i]!.frame !== kb[i]!.frame) return false;
      const va = ka[i]!.value as { asArray?: () => number[] };
      const vb = kb[i]!.value as { asArray?: () => number[] };
      const xa = va.asArray ? va.asArray() : [va as unknown as number];
      const xb = vb.asArray ? vb.asArray() : [vb as unknown as number];
      if (xa.some((v, n) => Math.abs(v - xb[n]!) > 1e-9)) return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  const koerper = new Map<string, AnimationGroup[]>();
  for (const [name, datei] of [['wikinger', 'wikinger/WikingerKoerper.glb'], ['wikingerin', 'wikingerin/WikingerinKoerper.glb']] as const) {
    if (!existsSync(resolve(WURZEL, 'assets/models', datei))) throw new Error(`${datei} fehlt — dieser Test braucht die echten Koerper`);
    console.log(`\n════ ${name} ════`);
    const g = await lade(resolve(WURZEL, 'assets/models', datei));
    koerper.set(name, g);
    const nach = new Map(g.map((x) => [x.name, x]));

    console.log('\n[1] Order');
    const namen = g.map((x) => x.name);
    check('56 clips: 28 old, 20 core, 8 new, in this order',
      namen.length === 56 && namen.slice(0, 28).join() === ALT.join() && namen.slice(28, 48).join() === KERN_CLIPS.join() && namen.slice(48).join() === BLOCK_CLIPS.join(),
      `${namen.length}: ${namen.slice(48).join()}`);

    console.log('\n[2] Lengths');
    for (const [clip, soll] of Object.entries(SOLL)) {
      const grp = nach.get(clip);
      const l = grp ? laenge(grp) : NaN;
      check(`${clip}: ${soll.laenge} s`, Math.abs(l - soll.laenge) <= 0.002, `${l.toFixed(4)} s`);
    }

    console.log('\n[3] The hold pose and its joins');
    {
      const halten = nach.get('block_halten')!;
      const naht = posenAbstand(halten, 0, -1);
      check('block_halten: first and last pose agree within 1 degree on every bone', naht.grad <= 1, `${naht.grad.toFixed(3)} deg (${naht.knoten})`);
      const h = hueftKeys(halten);
      check('block_halten: the hips do not move (< 1 mm)', h.every((p) => p.subtract(h[0]!).length() < 0.001));
      let start = 0;
      let enden = 0;
      for (const ta of nach.get('block_start')!.targetedAnimations) {
        if (ta.animation.targetProperty !== 'rotationQuaternion') continue;
        const ref = halten.targetedAnimations.find((t) => t.animation.targetProperty === 'rotationQuaternion' && t.target === ta.target);
        if (!ref) continue;
        const a = ta.animation.getKeys();
        const r = ref.animation.getKeys()[0]!.value as Quaternion;
        start = Math.max(start, winkel(a[a.length - 1]!.value as Quaternion, r));
        const e = nach.get('block_ende')!.targetedAnimations.find((t) => t.animation.targetProperty === 'rotationQuaternion' && t.target === ta.target);
        if (e) {
          const ek = e.animation.getKeys();
          enden = Math.max(enden, winkel(ek[ek.length - 1]!.value as Quaternion, r));
        }
      }
      check('block_start ends in the hold pose (within 1 degree)', start <= 1, `${start.toFixed(3)} deg`);
      check('block_ende ends in the hold pose too (within 1 degree)', enden <= 1, `${enden.toFixed(3)} deg`);
      const startNaht = posenAbstand(nach.get('block_start')!, 0, -1);
      check('block_start is a transition, not a loop: its first and last pose differ by more than 10 degrees', startNaht.grad > 10, `${startNaht.grad.toFixed(1)} deg (${startNaht.knoten})`);
    }

    console.log('\n[4] Root travel (hips, forward = +z)');
    for (const [clip, soll] of Object.entries(SOLL)) {
      const h = hueftKeys(nach.get(clip)!);
      const d = h[h.length - 1]!.subtract(h[0]!);
      check(`${clip}: forward ${soll.vorwaerts} m, sideways 0 m (±0.03)`, Math.abs(d.z - soll.vorwaerts) <= 0.03 && Math.abs(d.x) <= 0.03, `forward ${d.z.toFixed(3)}, sideways ${d.x.toFixed(3)}`);
    }
    {
      const h = hueftKeys(nach.get('rolle')!);
      const tief = Math.min(...h.map((p) => p.y));
      check('rolle: the hips go down to the ground (below 0.2 m) and come back up above 0.7 m', tief < 0.2 && h[0]!.y > 0.7 && h[h.length - 1]!.y > 0.7, `lowest ${tief.toFixed(3)} m`);
    }
  }

  console.log('\n[5] Both bodies carry identical data for the new clips');
  const a = koerper.get('wikinger')!;
  const b = koerper.get('wikingerin')!;
  for (const clip of BLOCK_CLIPS) {
    check(`${clip}: identical keys on both bodies`, datenGleich(a.find((g) => g.name === clip)!, b.find((g) => g.name === clip)!));
  }

  console.log('\n[6] AvatarRig keeps every on-demand clip out of the movement classification');
  check('istKernClip is true for all 20 core clips and all 8 block/roll clips, false for each of the 28 old ones',
    [...KERN_CLIPS, ...BLOCK_CLIPS].every((n) => istKernClip(n)) && ALT.every((n) => !istKernClip(n)),
    [...KERN_CLIPS, ...BLOCK_CLIPS].filter((n) => !istKernClip(n)).concat(ALT.filter((n) => istKernClip(n))).join());

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

void main();
