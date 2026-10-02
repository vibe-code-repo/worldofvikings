/**
 * D3-K3: the block in AvatarRig on the REAL body models (56 clips), NullEngine, fixed 16 ms frames.
 *
 *  [1] Clip choice while blocking: standing = `block_start` then `block_halten`; forwards `block_vor`; backwards
 *      `block_rueck`; sideways the normal walk cycle (`gehen`) with the torso of the hold pose as a layer. Over every
 *      direction and speed the two wrong clips `block_links` / `block_rechts` (they walk backwards / forwards, K2) are
 *      never chosen. Releasing returns to idle / walking; a swing wins.
 *  [2] The pose on the figure: the arms lie in the guard (the held `parade_unten`) while blocking, nothing is left of it
 *      0.3 s after the release; sideways the spine is the one of `block_halten`, otherwise (walking) it is not.
 *      A hit flinch lies over the block pose and gives it back.
 *  [3] Without the new clips (a body with the 48 old clips): nothing breaks; the held `parade_unten` is the pose
 *      (arms and spine), the legs are idle / the walk cycle. Without `parade_unten` too: nothing breaks.
 *
 * Needs the real body models (56 clips). Run: npx tsx client/test/d3-block-avatar.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';
import { AvatarRig } from '../src/player/AvatarRig.js';
import { BLOCK_CLIPS } from '../src/player/kernClips.js';
import type { BlockRichtung } from '../src/player/BlockSteuerung.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(__dirname, '..', '..');
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Zugriff {
  clipRuhe: { grp: { name: string } } | null;
  clipGehen: { grp: { name: string } } | null;
  clipsBlock: { start: { grp: { name: string } } | null; halten: { grp: { name: string } } | null; vor: unknown; rueck: unknown };
  aktiv: { grp: { name: string } } | null;
  aktionen: Map<string, { von: number; bis: number; kanaele: Array<{ knoten: { name: string }; anim: { evaluate(f: number): Quaternion } }> }>;
  blockGewicht: number;
  blockRumpfGewicht: number;
  waffensatz: string;
}

const engine = new NullEngine();
engine.getDeltaTime = () => 16; // the layers read the engine clock

/** Which clips the loader hands to the rig: all of them, or without the block clips (a body with 48 clips), or also without the parade. */
let weglassen: RegExp | null = null;
const echtLaden = SceneLoader.ImportMeshAsync.bind(SceneLoader);
(SceneLoader as unknown as { ImportMeshAsync: unknown }).ImportMeshAsync = async (_n: string, _root: string, datei: string, scene: Scene) => {
  const bytes = readFileSync(resolve(WURZEL, 'assets/models', datei));
  const res = await echtLaden('', '', 'data:model/gltf-binary;base64,' + bytes.toString('base64'), scene, null, '.glb');
  if (weglassen) {
    const raus = res.animationGroups.filter((g) => weglassen!.test(g.name));
    for (const g of raus) { g.dispose(); res.animationGroups.splice(res.animationGroups.indexOf(g), 1); }
  }
  return res;
};

async function neuesRig(datei: string): Promise<{ rig: AvatarRig; scene: Scene; z: Zugriff; schritt: (n: number, speed?: number) => void; knoten: (n: string) => Quaternion }> {
  const scene = new Scene(engine);
  scene.useConstantAnimationDeltaTime = true; // 16 ms per render, deterministic
  new FreeCamera('kamera', new Vector3(0, 1, -5), scene);
  const rig = new AvatarRig(scene, datei);
  await rig.geladen;
  const schritt = (n: number, speed = 0): void => {
    for (let i = 0; i < n; i++) {
      rig.update(0.016, speed, 4.5, false, false);
      scene.render();
    }
  };
  schritt(5);
  const knoten = (n: string): Quaternion => scene.getTransformNodeByName(n)!.rotationQuaternion!.clone();
  return { rig, scene, z: rig as unknown as Zugriff, schritt, knoten };
}

function winkel(a: Quaternion, b: Quaternion): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

/** Pose of the parade layer at the fraction the block holds, per bone name. */
function paradePose(z: Zugriff, anteil: number, name = 'parade_unten'): Map<string, Quaternion> {
  const s = z.aktionen.get(name)!;
  const m = new Map<string, Quaternion>();
  for (const k of s.kanaele) m.set(k.knoten.name, k.anim.evaluate(s.von + (s.bis - s.von) * anteil));
  return m;
}

const BLOCK_ZEIT = 0.016;
const GEHTEMPO = 2.25; // blocking speed (the controller passes this)

async function main(): Promise<void> {
  for (const [name, datei] of [['wikinger', 'wikinger/WikingerKoerper.glb'], ['wikingerin', 'wikingerin/WikingerinKoerper.glb']] as const) {
    if (!existsSync(resolve(WURZEL, 'assets/models', datei))) throw new Error(`${datei} fehlt — dieser Test braucht die echten Koerper`);
    console.log(`\n════ ${name} ════`);
    weglassen = null;

    // ── [1] clip choice ────────────────────────────────────────
    console.log('\n[1] Which clip carries the legs');
    {
      const { rig, z, schritt } = await neuesRig(datei);
      check('the four block clips are known (start, halten, vor, rueck)', !!z.clipsBlock.start && !!z.clipsBlock.halten && !!z.clipsBlock.vor && !!z.clipsBlock.rueck);
      check('before blocking: idle', z.aktiv?.grp.name === 'idle');
      rig.setzeBlock(true, 'steht');
      schritt(5);
      check('blocking, standing: `block_start` (the way into the guard)', z.aktiv?.grp.name === 'block_start', z.aktiv?.grp.name);
      schritt(40); // 0.64 s > 0.458 s
      check('0.64 s later: `block_halten` (the held pose)', z.aktiv?.grp.name === 'block_halten', z.aktiv?.grp.name);
      check('the rig reports the block', rig.blockt === true);
      const gesehen = new Set<string>();
      const probe = (richtung: BlockRichtung, tempo: number, frames = 40): string => {
        rig.setzeBlock(true, richtung);
        for (let i = 0; i < frames; i++) { schritt(1, tempo); gesehen.add(z.aktiv?.grp.name ?? ''); }
        return z.aktiv?.grp.name ?? '';
      };
      check('forwards: `block_vor`', probe('vor', GEHTEMPO) === 'block_vor');
      check('backwards: `block_rueck`', probe('rueck', GEHTEMPO) === 'block_rueck');
      check('sideways: the normal walk cycle `gehen` (no side-step clip exists)', probe('seit', GEHTEMPO) === 'gehen');
      check('forwards again: `block_vor`', probe('vor', GEHTEMPO) === 'block_vor');
      check('stopping while blocking: `block_halten`, not the idle legs', probe('steht', 0, 60) === 'block_halten');
      check('over all directions and speeds the wrong clips `block_links` / `block_rechts` were never chosen', !gesehen.has('block_links') && !gesehen.has('block_rechts') && !gesehen.has('block_ende'), [...gesehen].join());
      for (const richtung of ['vor', 'rueck', 'seit', 'steht'] as const) for (const tempo of [0, 1, 2.25, 4.5, 7.5]) probe(richtung, tempo, 20);
      check('… also not over every direction x speed (0, 1, 2.25, 4.5, 7.5 m/s)', !gesehen.has('block_links') && !gesehen.has('block_rechts') && !gesehen.has('block_ende'), [...gesehen].join());
      rig.setzeBlock(false, 'steht');
      schritt(60);
      check('released, standing: idle again', z.aktiv?.grp.name === 'idle' && !rig.blockt, z.aktiv?.grp.name);
      rig.setzeBlock(true, 'steht');
      schritt(60);
      rig.setzeBlock(false, 'steht');
      schritt(5, GEHTEMPO);
      schritt(40, GEHTEMPO);
      check('released while walking: the walk cycle again', z.aktiv?.grp.name === 'gehen', z.aktiv?.grp.name);
    }
    {
      // `block_start` plays once and stays short; a second block starts it again.
      const { rig, z, schritt } = await neuesRig(datei);
      rig.setzeBlock(true, 'steht');
      schritt(10);
      rig.setzeBlock(false, 'steht');
      schritt(60);
      rig.setzeBlock(true, 'steht');
      schritt(3);
      check('a second block starts with `block_start` again', z.aktiv?.grp.name === 'block_start', z.aktiv?.grp.name);
      // Walking at once: no entry clip, straight to the walk.
      const { rig: r2, z: z2, schritt: s2 } = await neuesRig(datei);
      r2.setzeBlock(true, 'vor');
      s2(40, GEHTEMPO);
      check('blocking while already walking forwards: `block_vor` (the entry clip is not played over the walk)', z2.aktiv?.grp.name === 'block_vor', z2.aktiv?.grp.name);
      // A swing wins: the guard layer fades and the attack plays.
      const { rig: r3, z: z3, schritt: s3 } = await neuesRig(datei);
      r3.setzeBlock(true, 'steht');
      s3(60);
      check('(set-up) blocking, the guard layer is at 1', z3.blockGewicht === 1, `${z3.blockGewicht}`);
      r3.schlage('schwert');
      s3(15);
      check('a swing while the block flag is still on: the attack clip plays', z3.aktiv?.grp.name.startsWith('angriff') === true, z3.aktiv?.grp.name);
      check('… and the guard layer is gone (0), the server ends the block with the swing', z3.blockGewicht === 0, `${z3.blockGewicht}`);
    }

    // ── [2] the pose ───────────────────────────────────────────
    console.log('\n[2] The pose on the figure');
    {
      const { rig, z, schritt, knoten } = await neuesRig(datei);
      const arme = ['Shoulder_R', 'Elbow_R', 'Hand_R', 'Shoulder_L', 'Elbow_L', 'Hand_L'];
      const ruheArme = arme.map((n) => knoten(n));
      const pose = paradePose(z, 0.5);
      rig.setzeBlock(true, 'steht');
      schritt(60);
      check('(set-up) the guard layer is at full weight', z.blockGewicht === 1);
      const imBlock = arme.map((n) => knoten(n));
      const dp = arme.map((n, i) => winkel(imBlock[i]!, pose.get(n)!));
      check('blocking: the arms lie in the held parade pose (every arm bone within 1 deg)', dp.every((w) => w < 1), dp.map((w) => w.toFixed(2)).join(' '));
      const dr = arme.map((n, i) => winkel(imBlock[i]!, ruheArme[i]!));
      check('blocking: the arms are far from the idle arms (some bone over 20 deg)', Math.max(...dr) > 20, `max ${Math.max(...dr).toFixed(1)} deg`);
      check('standing in the block the spine is the one of `block_halten` (the full-body clip carries it): rumpf layer off', z.blockRumpfGewicht === 0);
      rig.setzeBlock(false, 'steht');
      schritt(20); // 0.32 s > the 0.1 s fade
      check('0.3 s after the release the guard layer is gone', z.blockGewicht === 0, `${z.blockGewicht}`);
      const danach = arme.map((n, i) => winkel(knoten(n), ruheArme[i]!));
      // The idle clip itself breathes (a few degrees, and its phase differs from the snapshot), so the bound is 12 deg
      // against the 79 deg of the guard.
      check('… and the arms are back at the idle pose (within 12 deg; the guard was up to 79 deg away)', Math.max(...danach) < 12, `max ${Math.max(...danach).toFixed(2)} deg`);
    }
    {
      // Sideways: the walk cycle has an upright torso, the hold pose turns it: the torso layer carries it.
      const { rig, z, schritt, knoten } = await neuesRig(datei);
      const halten = new Map<string, Quaternion>();
      const g = (await Promise.resolve(z)).clipsBlock.halten as unknown as { grp: { targetedAnimations: Array<{ target: { name: string }; animation: { targetProperty: string; evaluate(f: number): Quaternion } }>; from: number } };
      for (const ta of g.grp.targetedAnimations) if (ta.animation.targetProperty === 'rotationQuaternion') halten.set(ta.target.name, ta.animation.evaluate(g.grp.from));
      const rumpf = ['Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head'];
      rig.setzeBlock(false, 'steht');
      schritt(60, GEHTEMPO);
      const gehend = rumpf.map((n) => winkel(knoten(n), halten.get(n)!));
      rig.setzeBlock(true, 'seit');
      schritt(60, GEHTEMPO);
      const seit = rumpf.map((n) => winkel(knoten(n), halten.get(n)!));
      check('sideways in the block: the torso layer is at full weight', z.blockRumpfGewicht === 1, `${z.blockRumpfGewicht}`);
      check('sideways in the block: spine, neck and head are the hold pose (within 1 deg)', seit.every((w) => w < 1), seit.map((w) => w.toFixed(2)).join(' '));
      check('(control) walking without the block the torso is NOT the hold pose (some bone over 5 deg)', Math.max(...gehend) > 5, gehend.map((w) => w.toFixed(1)).join(' '));
      rig.setzeBlock(true, 'vor');
      schritt(30, GEHTEMPO);
      check('forwards in the block the torso layer is off again (block_vor carries its own torso)', z.blockRumpfGewicht === 0, `${z.blockRumpfGewicht}`);
    }
    {
      // A hit flinch over the block pose: visible, and the pose comes back.
      const { rig, z, schritt, knoten } = await neuesRig(datei);
      rig.setzeBlock(true, 'steht');
      schritt(60);
      const arme = ['Shoulder_R', 'Elbow_R', 'Hand_R', 'Shoulder_L', 'Elbow_L', 'Hand_L', 'Spine_03'];
      const vorher = arme.map((n) => knoten(n));
      check('a hit flinch while blocking starts', rig.zeigeTreffer('treffer_vorn_links') === true);
      schritt(8);
      const mitte = arme.map((n, i) => winkel(knoten(n), vorher[i]!));
      check('… it is visible over the block pose (some bone over 3 deg away)', Math.max(...mitte) > 3, `max ${Math.max(...mitte).toFixed(1)} deg`);
      schritt(80);
      const nach = arme.map((n, i) => winkel(knoten(n), vorher[i]!));
      check('… and the block pose is back after it (within 1 deg), the block still on', Math.max(...nach) < 1 && rig.blockt, `max ${Math.max(...nach).toFixed(2)} deg`);
      check('(the layer was never dropped)', z.blockGewicht === 1);
    }

    // ── [3] fallback ───────────────────────────────────────────
    console.log('\n[3] A body without the new clips (the 48 old clips)');
    {
      weglassen = new RegExp(`^(${BLOCK_CLIPS.join('|')})$`);
      const { rig, scene, z, schritt, knoten } = await neuesRig(datei);
      check('the block clips are really gone from this body', BLOCK_CLIPS.every((n) => !scene.getAnimationGroupByName(n)) && !z.clipsBlock.start && !z.clipsBlock.halten);
      check('idle is still the idle, gehen the walk', z.clipRuhe?.grp.name === 'idle' && z.clipGehen?.grp.name === 'gehen');
      const gesehen = new Set<string>();
      let fehler = '';
      try {
        rig.setzeBlock(true, 'steht');
        schritt(40);
        gesehen.add(z.aktiv?.grp.name ?? '');
        const steht = z.aktiv?.grp.name;
        check('standing in the block: the legs stay idle', steht === 'idle', steht);
        for (const r of ['vor', 'rueck', 'seit'] as const) {
          rig.setzeBlock(true, r);
          schritt(40, GEHTEMPO);
          gesehen.add(z.aktiv?.grp.name ?? '');
          check(`${r}: the walk cycle carries the legs`, z.aktiv?.grp.name === 'gehen', z.aktiv?.grp.name);
        }
        rig.setzeBlock(true, 'steht');
        schritt(60);
        const pose = paradePose(z, 0.5);
        const ganz = ['Spine_02', 'Spine_03', 'Shoulder_R', 'Hand_R', 'Elbow_L'];
        const w = ganz.map((n) => winkel(knoten(n), pose.get(n)!));
        check('the held `parade_unten` is the pose, arms AND spine (every bone within 1 deg)', w.every((x) => x < 1), w.map((x) => x.toFixed(2)).join(' '));
        check('the guard layer is at 1 and the torso layer does not exist', z.blockGewicht === 1 && z.blockRumpfGewicht === 0);
        rig.setzeBlock(false, 'steht');
        schritt(30);
        check('released: idle again, layer gone', z.aktiv?.grp.name === 'idle' && z.blockGewicht === 0);
      } catch (e) {
        fehler = String(e);
      }
      check('no exception in any of it', fehler === '', fehler);
    }
    {
      weglassen = new RegExp(`^(${BLOCK_CLIPS.join('|')}|parade_.*|stab_parade_.*)$`);
      const { rig, z, schritt } = await neuesRig(datei);
      let fehler = '';
      try {
        rig.setzeBlock(true, 'seit');
        schritt(60, GEHTEMPO);
        rig.setzeBlock(false, 'steht');
        schritt(30);
      } catch (e) {
        fehler = String(e);
      }
      check('without the block clips AND without `parade_unten`: no exception, no pose, the figure just walks', fehler === '' && z.blockGewicht === 0 && z.aktiv?.grp.name === 'idle', `${fehler} gewicht ${z.blockGewicht} aktiv ${z.aktiv?.grp.name}`);
    }
    weglassen = null;
  }
  void BLOCK_ZEIT;
}

main()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} FAIL`);
      process.exit(1);
    }
    console.log('\nAlle Pruefungen bestanden.');
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
