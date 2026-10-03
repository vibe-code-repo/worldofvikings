/**
 * D3-K4: the roll in AvatarRig on the REAL body models (56 clips), NullEngine, fixed 16 ms frames.
 *
 *  [1] The clip `rolle` is known to the rig and plays only on demand (after loading only `idle` plays).
 *  [2] `setzeRolle(true)`: `rolle` plays ONCE from its first frame at the speed of the clip (speed ratio 1, whatever the
 *      figure's speed), reaches its last frame within the clip length, wins over a swing and a block, ends with
 *      `setzeRolle(false)` (idle again, or the walk cycle while walking).
 *  [3] The length of the clip is the length of the invulnerable time (875 ms).
 *  [4] Without the clip (a body with 48 clips): nothing breaks, the figure keeps its movement clip.
 *  [5] (N1, Z1) The curve of the roll (`ROLLE_KURVE_ANTEIL`, the movement of server and client) against the hips of the
 *      clip in the GLB: at every frame of 60 per second at most 5 cm apart; the span of the hips is 4.853 m.
 *  [6] (N1, T2) The clip runs IN PLACE in the rig: after `messeUndEntferneWurzelbewegung` the hips do not travel along
 *      the roll axis (at most 2 cm over all frames of the played clip), the travel belongs to the controller.
 *
 * Needs the real body models (56 clips). Run: npx tsx client/test/d3-rolle-avatar.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF/2.0';
import { AvatarRig } from '../src/player/AvatarRig.js';
import { ROLLE_DAUER_MS, ROLLE_TEMPO, ROLLE_WEG_M, rolleWegAnteil } from '@wov/shared/src/kampf/rolle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(__dirname, '..', '..');
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Zugriff {
  clipsBlock: { start: unknown; halten: unknown; vor: unknown; rueck: unknown; rolle: { grp: { name: string; loopAnimation: boolean; speedRatio: number; getCurrentFrame(): number; from: number; to: number; isPlaying: boolean } } | null };
  aktiv: { grp: { name: string } } | null;
  rolleAn: boolean;
  clipLaenge(c: unknown): number;
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

async function neuesRig(datei: string): Promise<{ rig: AvatarRig; scene: Scene; z: Zugriff; schritt: (n: number, speed?: number, rennt?: boolean) => void }> {
  const scene = new Scene(engine);
  scene.useConstantAnimationDeltaTime = true; // 16 ms per render, deterministic
  new FreeCamera('kamera', new Vector3(0, 1, -5), scene);
  const rig = new AvatarRig(scene, datei);
  await rig.geladen;
  const schritt = (n: number, speed = 0, rennt = false): void => {
    for (let i = 0; i < n; i++) {
      rig.update(0.016, speed, 4.5, rennt, false);
      scene.render();
    }
  };
  schritt(5);
  return { rig, scene, z: rig as unknown as Zugriff, schritt };
}

/** The hip keys of the clip `rolle` in a GLB: times (s) and the values of the axis z (model units = metres at scale 1). */
function glbHueftenZ(bytes: Buffer): { t: number[]; z: number[]; interpolation: string } {
  const jl = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jl).toString()) as {
    animations: Array<{ name: string; channels: Array<{ sampler: number; target: { node: number; path: string } }>; samplers: Array<{ input: number; output: number; interpolation?: string }> }>;
    nodes: Array<{ name: string }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number; type: string }>;
    bufferViews: Array<{ byteOffset?: number }>;
  };
  const bin = bytes.subarray(20 + jl + 8);
  const lies = (i: number): number[][] => {
    const a = json.accessors[i]!;
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]!;
    const off = (json.bufferViews[a.bufferView]!.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: n }, (_, c) => bin.readFloatLE(off + (k * n + c) * 4)));
  };
  const an = json.animations.find((x) => x.name === 'rolle')!;
  const ch = an.channels.find((c) => c.target.path === 'translation' && json.nodes[c.target.node]!.name === 'Hips')!;
  const s = an.samplers[ch.sampler]!;
  return { t: lies(s.input).map((x) => x[0]!), z: lies(s.output).map((x) => x[2]!), interpolation: s.interpolation ?? 'LINEAR' };
}

async function main(): Promise<void> {
  for (const [name, datei] of [['wikinger', 'wikinger/WikingerKoerper.glb'], ['wikingerin', 'wikingerin/WikingerinKoerper.glb']] as const) {
    if (!existsSync(resolve(WURZEL, 'assets/models', datei))) throw new Error(`${datei} fehlt — dieser Test braucht die echten Koerper`);
    console.log(`\n════ ${name} ════`);
    weglassen = null;

    console.log('\n[1] The clip is known and plays on demand only');
    {
      const { scene, z } = await neuesRig(datei);
      check('the rig knows the clip `rolle`', z.clipsBlock.rolle?.grp.name === 'rolle');
      const laufend = scene.animationGroups.filter((g) => g.isPlaying).map((g) => g.name);
      check('after loading only `idle` plays', laufend.join() === 'idle', laufend.join());
    }

    console.log('\n[2] The roll plays once at the speed of the clip');
    {
      const { rig, z, schritt } = await neuesRig(datei);
      rig.setzeRolle(true);
      schritt(4, ROLLE_TEMPO, true);
      const c = z.clipsBlock.rolle!.grp;
      check('rolling: `rolle` plays', z.aktiv?.grp.name === 'rolle', z.aktiv?.grp.name);
      check('... once (no loop), from its first frames', c.loopAnimation === false && c.getCurrentFrame() - c.from < 8, `loop ${c.loopAnimation}, ${(c.getCurrentFrame() - c.from).toFixed(1)} frames in`);
      check('... at the speed of the clip (ratio 1), although the figure moves at 5.8 m/s', c.speedRatio === 1, `${c.speedRatio}`);
      schritt(46, ROLLE_TEMPO, true); // 50 frames in all = 0.8 s
      const gespielt = (c.getCurrentFrame() - c.from) / (c.to - c.from);
      check('after 0.8 s the clip is at 85-97 % of its length (not stretched, not slowed: 0.8 s of 0.875 s)', gespielt >= 0.85 && gespielt <= 0.97, `${(gespielt * 100).toFixed(1)} %`);
      schritt(8, ROLLE_TEMPO, true); // 58 frames = 0.93 s: the clip (0.875 s) is over
      check('after 0.93 s the clip has ended (stopped), the rig still reports the roll', !c.isPlaying && z.rolleAn === true);
      rig.setzeRolle(false);
      schritt(40);
      check('setzeRolle(false): idle again (standing)', z.aktiv?.grp.name === 'idle' && z.rolleAn === false, z.aktiv?.grp.name);
      // The same roll again starts from the beginning.
      rig.setzeRolle(true);
      schritt(4, ROLLE_TEMPO, true);
      check('a second roll starts from the first frame again', z.aktiv?.grp.name === 'rolle' && c.getCurrentFrame() - c.from < 8, `${(c.getCurrentFrame() - c.from).toFixed(1)}`);
      rig.setzeRolle(false);
      schritt(10, 2.25);
      schritt(40, 2.25);
      check('released while walking: the walk cycle', z.aktiv?.grp.name === 'gehen', z.aktiv?.grp.name);
    }
    {
      // The roll wins over a swing and over a block.
      const { rig, z, schritt } = await neuesRig(datei);
      rig.setzeBlock(true, 'steht');
      schritt(30);
      rig.setzeRolle(true);
      rig.setzeBlock(false, 'steht');
      schritt(4, ROLLE_TEMPO, true);
      check('a roll out of a block: `rolle` plays', z.aktiv?.grp.name === 'rolle', z.aktiv?.grp.name);
      rig.schlage('schwert');
      schritt(15, ROLLE_TEMPO, true);
      check('a swing during the roll (the client locks it, but the rig must not show it): still `rolle`', z.aktiv?.grp.name === 'rolle', z.aktiv?.grp.name);
    }

    console.log('\n[3] The clip is as long as the invulnerable time');
    {
      const { z } = await neuesRig(datei);
      const laenge = z.clipLaenge(z.clipsBlock.rolle) * 1000;
      check(`clip length ${laenge.toFixed(1)} ms = ROLLE_DAUER_MS ${ROLLE_DAUER_MS} (+- 1 ms)`, Math.abs(laenge - ROLLE_DAUER_MS) <= 1);
    }

    console.log('\n[4] Without the clip (48-clip body)');
    {
      weglassen = /^(block_|rolle$)/;
      const { rig, z, schritt } = await neuesRig(datei);
      check('(set-up) the rig has no `rolle`', z.clipsBlock.rolle === null);
      rig.setzeRolle(true);
      schritt(10, ROLLE_TEMPO, true);
      check('rolling without the clip: nothing breaks, the movement clip plays (run cycle)', !!z.aktiv && z.aktiv.grp.name !== 'rolle', z.aktiv?.grp.name);
      rig.setzeRolle(false);
      schritt(40);
      check('and ends with idle', z.aktiv?.grp.name === 'idle', z.aktiv?.grp.name);
      weglassen = null;
    }

    console.log('\n[5] The curve of the roll against the hips of the clip');
    {
      const k = glbHueftenZ(readFileSync(resolve(WURZEL, 'assets/models', datei)));
      const z0 = k.z[0]!;
      const spann = k.z[k.z.length - 1]! - z0;
      check(`${k.t.length} hip keys, linear, from ${k.t[0]!.toFixed(4)} to ${k.t[k.t.length - 1]!.toFixed(4)} s`, k.t.length === 21 && k.interpolation === 'LINEAR' && Math.abs(k.t[k.t.length - 1]! - ROLLE_DAUER_MS / 1000) < 1e-6);
      check(`the span of the hips along z is ROLLE_WEG_M (4.853 m, +- 2 mm)`, Math.abs(spann - ROLLE_WEG_M) < 0.002, `${spann.toFixed(4)} m`);
      const dehnung = (t: number): number => {
        if (t <= k.t[0]!) return 0;
        if (t >= k.t[k.t.length - 1]!) return k.z[k.z.length - 1]! - z0;
        let i = 0;
        while (k.t[i + 1]! < t) i++;
        const f = (t - k.t[i]!) / (k.t[i + 1]! - k.t[i]!);
        return k.z[i]! + (k.z[i + 1]! - k.z[i]!) * f - z0;
      };
      let maxAbw = 0;
      let bei = 0;
      for (let i = 0; i <= 53; i++) { // 0 ... 0.883 s at 60 frames per second
        const t = i / 60;
        const abw = Math.abs(dehnung(t) - rolleWegAnteil(t) * ROLLE_WEG_M);
        if (abw > maxAbw) { maxAbw = abw; bei = t; }
      }
      check(`the curve and the hips of the GLB are at most 5 cm apart at every frame (max ${(maxAbw * 100).toFixed(2)} cm at ${bei.toFixed(3)} s)`, maxAbw <= 0.05);
      check('the constant speed would have been up to 1.9 m off (the finding): at 0.375 s the hips are 4.1 m ahead, the constant speed is at 2.2 m', Math.abs(dehnung(0.375) - 4.115) < 0.05 && Math.abs(0.375 * ROLLE_TEMPO - 2.18) < 0.02);
    }

    console.log('\n[6] The clip runs in place in the rig');
    {
      const { rig, scene, z, schritt } = await neuesRig(datei);
      void z;
      const hueften = scene.getTransformNodeByName('Hips');
      check('(set-up) the rig has the node Hips', !!hueften);
      if (hueften) {
        const massstab = (hueften.parent as { absoluteScaling?: { x: number } } | null)?.absoluteScaling?.x ?? 1;
        rig.setzeRolle(true);
        const werte: number[] = [];
        const hoehen: number[] = [];
        for (let i = 0; i < 56; i++) {
          rig.update(0.016, ROLLE_TEMPO, 4.5, true, false);
          scene.render();
          werte.push(hueften.position.z * massstab);
          hoehen.push(hueften.position.y * massstab);
        }
        const spannInPlace = Math.max(...werte) - Math.min(...werte);
        check(`the hips do not travel along the roll axis in the played clip (${werte.length} frames, span ${(spannInPlace * 100).toFixed(2)} cm, at most 2 cm)`, spannInPlace <= 0.02);
        const spannHoehe = Math.max(...hoehen) - Math.min(...hoehen);
        check(`(control) the clip plays: the hips do move in height (the roll is not frozen), span ${(spannHoehe * 100).toFixed(1)} cm`, spannHoehe > 0.1);
        rig.setzeRolle(false);
        schritt(5);
      }
    }
  }
  console.log(failures === 0 ? '\nOK' : `\n${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
