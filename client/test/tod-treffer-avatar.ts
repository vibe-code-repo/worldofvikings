/**
 * The own figure plays death and hit reaction (AvatarRig on the REAL body models, NullEngine, fixed 16 ms frames).
 *
 *  [1] Loading the 48-clip body does not disturb the states: idle stays the idle, `gehen` the walk, `rennen`
 *      the run (the door clips travel 2.4 m and would otherwise be taken for the run cycle), only `idle` plays,
 *      the death clips wait for their call, the four hit clips are upper-body layers.
 *  [2] Death: `starteTod('tod_hinten')` — after 3.5 s the hips are at the lying height 0.12 (not 0.85), and
 *      neither walking input nor a hit reaction moves the figure while it lies; `endeTod()` gets it up.
 *  [3] Hit: the layer touches only the upper body, does not interrupt walking, is not restarted inside the
 *      minimum gap (0.65 s), and yields to a swing.
 *
 * Needs the real body models. Run: npx tsx client/test/tod-treffer-avatar.ts
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
import { KERN_CLIPS } from '../src/player/kernClips.js';
import { TREFFER_MINDESTABSTAND_S } from '@wov/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(__dirname, '..', '..');
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

interface Zugriff {
  clipRuhe: { grp: { name: string; isPlaying: boolean } } | null;
  clipGehen: { grp: { name: string } } | null;
  clipRennen: { grp: { name: string } } | null;
  clipSprung: { grp: { name: string } } | null;
  clipsRuhe: Array<{ grp: { name: string } }>;
  clipsAngriff: Array<{ grp: { name: string } }>;
  clipsTod: Map<string, unknown>;
  aktionen: Map<string, { kanaele: Array<{ knoten: { name: string } }> }>;
  aktion: unknown;
  aktiv: { grp: { name: string } } | null;
  angriffRest: number;
}

const engine = new NullEngine();
engine.getDeltaTime = () => 16; // the layers read the engine clock

// The rig loads '/assets/models/<file>' over HTTP in the browser; here the file comes from disk.
const echtLaden = SceneLoader.ImportMeshAsync.bind(SceneLoader);
(SceneLoader as unknown as { ImportMeshAsync: unknown }).ImportMeshAsync = (_n: string, _root: string, datei: string, scene: Scene) => {
  const bytes = readFileSync(resolve(WURZEL, 'assets/models', datei));
  return echtLaden('', '', 'data:model/gltf-binary;base64,' + bytes.toString('base64'), scene, null, '.glb');
};

async function neuesRig(datei: string): Promise<{ rig: AvatarRig; scene: Scene; z: Zugriff; schritt: (n: number, speed?: number) => void }> {
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
  return { rig, scene, z: rig as unknown as Zugriff, schritt };
}

const OBERKOERPER = new Set([
  'Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head', 'Clavicle_L', 'Shoulder_L', 'Elbow_L', 'Hand_L', 'Clavicle_R', 'Shoulder_R', 'Elbow_R', 'Hand_R',
]);

function winkel(a: Quaternion, b: Quaternion): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

async function main(): Promise<void> {
  for (const [name, datei] of [['wikinger', 'wikinger/WikingerKoerper.glb'], ['wikingerin', 'wikingerin/WikingerinKoerper.glb']] as const) {
    if (!existsSync(resolve(WURZEL, 'assets/models', datei))) throw new Error(`${datei} fehlt — dieser Test braucht die echten Koerper`);
    console.log(`\n════ ${name} ════`);

    // ── [1] classification ─────────────────────────────────────
    console.log('\n[1] The 20 core clips do not disturb the states');
    {
      const { scene, z } = await neuesRig(datei);
      check('idle is the idle, gehen the walk, rennen the run, springen the jump',
        z.clipRuhe?.grp.name === 'idle' && z.clipGehen?.grp.name === 'gehen' && z.clipRennen?.grp.name === 'rennen' && z.clipSprung?.grp.name === 'springen',
        `${z.clipRuhe?.grp.name}/${z.clipGehen?.grp.name}/${z.clipRennen?.grp.name}/${z.clipSprung?.grp.name}`);
      check('the standing poses are exactly [idle] (betaeubt, aufheben ... are no standing pose)', z.clipsRuhe.map((c) => c.grp.name).join() === 'idle', z.clipsRuhe.map((c) => c.grp.name).join());
      check('the swing chain is unchanged', z.clipsAngriff.map((c) => c.grp.name).join() === 'angriff,angriff2,angriff3');
      check('both death clips are known', [...z.clipsTod.keys()].sort().join() === 'tod_hinten,tod_vorn');
      const treffer = ['treffer_vorn_links', 'treffer_vorn_rechts', 'treffer_hinten_links', 'treffer_hinten_rechts'];
      check('the four hit clips are upper-body actions, and nothing else of the 20 is', treffer.every((t) => z.aktionen.has(t)) && !['treffer_schwer', 'rueckstoss', 'betaeubt', 'knopf', 'aufheben'].some((t) => z.aktionen.has(t)), [...z.aktionen.keys()].join(','));
      check('a hit layer writes only upper-body bones (and their fingers), and it does write the spine',
        treffer.every((t) => z.aktionen.get(t)!.kanaele.every((k) => OBERKOERPER.has(k.knoten.name) || /^(Thumb|Index|Middle|Ring|Pinky|Finger|Hand)/i.test(k.knoten.name) || /_(L|R)$/.test(k.knoten.name) && !/(Thigh|Calf|Foot|Toe|Ankle|Knee|Leg)/i.test(k.knoten.name)) && z.aktionen.get(t)!.kanaele.some((k) => k.knoten.name === 'Spine_02')),
        [...new Set(z.aktionen.get('treffer_vorn_links')!.kanaele.map((k) => k.knoten.name))].join(','));
      const laufend = scene.animationGroups.filter((g) => g.isPlaying).map((g) => g.name);
      check('only `idle` plays after loading (no core clip runs as a state)', laufend.join() === 'idle', laufend.join());
      check('all 20 core clips exist as groups', KERN_CLIPS.every((n) => scene.getAnimationGroupByName(n)));
    }

    // ── [2] death ──────────────────────────────────────────────
    console.log('\n[2] Death: falls, lies low, stays lying, gets up');
    {
      const { rig, scene, z, schritt } = await neuesRig(datei);
      const hueft = scene.getTransformNodeByName('Hips')!;
      const stehHoehe = hueft.position.y;
      check('standing hip height about 0.85 (model units)', stehHoehe > 0.8 && stehHoehe < 0.9, stehHoehe.toFixed(3));
      check('starteTod says yes', rig.starteTod('tod_hinten') === true && rig.liegt === true);
      schritt(220); // 3.5 s > the 2.83 s of the clip
      const hoehe = hueft.position.y;
      const weltHoehe = hueft.getAbsolutePosition().y - rig.root.getAbsolutePosition().y;
      console.log(`      hips: ${hoehe.toFixed(3)} in the file, ${weltHoehe.toFixed(3)} m above the figure's foot point in the scene`);
      check('after 3.5 s the hips lie at 0.12 m (0.10 - 0.14), not at 0.85', hoehe > 0.10 && hoehe < 0.14 && weltHoehe > 0.10 && weltHoehe < 0.14, `${hoehe.toFixed(3)} / ${weltHoehe.toFixed(3)} m`);
      check('the clip is the death clip and it stays', z.aktiv?.grp.name === 'tod_hinten');
      schritt(120, 4.5); // the input keeps asking to walk
      check('walking input while lying: still lying, same pose, still the death clip', Math.abs(hueft.position.y - hoehe) < 1e-6 && z.aktiv?.grp.name === 'tod_hinten', `${hueft.position.y.toFixed(4)}`);
      check('a hit reaction while lying is refused', rig.zeigeTreffer('treffer_vorn_links') === false);
      check('an unknown death clip name plays nothing', (rig.starteTod as (n: string) => boolean)('tod_seitlich') === false);
      rig.endeTod();
      check('endeTod: standing again, idle plays, the death clip does not', rig.liegt === false && z.aktiv?.grp.name === 'idle' && z.clipRuhe!.grp.isPlaying && !scene.getAnimationGroupByName('tod_hinten')!.isPlaying);
      schritt(10, 3);
      check('and walking works again', z.aktiv?.grp.name === 'gehen', z.aktiv?.grp.name);
      check('the hips are back up', hueft.position.y > 0.7, hueft.position.y.toFixed(3));
      // forward fall
      const r2 = await neuesRig(datei);
      r2.rig.starteTod('tod_vorn'); r2.schritt(260);
      const h2 = r2.scene.getTransformNodeByName('Hips')!.position.y;
      check('tod_vorn: hips at 0.10 after 4.2 s', h2 > 0.08 && h2 < 0.13, h2.toFixed(3));
    }

    // ── [3] hit reaction ───────────────────────────────────────
    console.log('\n[3] Hit reaction: upper body only, walking goes on, minimum gap, a swing wins');
    {
      // Two identical rigs walk side by side; only one is struck. Same clip, same frames: every difference is the flinch.
      const a = await neuesRig(datei); const ref = await neuesRig(datei);
      a.schritt(30, 3); ref.schritt(30, 3);
      const holeKnoten = (scene: Scene, namen: string[]) => namen.map((n) => scene.getTransformNodeByName(n)!);
      const OBEN = ['Spine_01', 'Spine_02', 'Spine_03', 'Neck', 'Head', 'Clavicle_L', 'Clavicle_R', 'Shoulder_L', 'Shoulder_R'];
      const BEIN = ['UpperLeg_L', 'UpperLeg_R', 'LowerLeg_L', 'LowerLeg_R', 'Ankle_L', 'Ankle_R'];
      const aOben = holeKnoten(a.scene, OBEN); const rOben = holeKnoten(ref.scene, OBEN);
      const aBein = holeKnoten(a.scene, BEIN); const rBein = holeKnoten(ref.scene, BEIN);
      check('both rigs have the bones', [...aOben, ...rOben, ...aBein, ...rBein].every((n) => !!n), `${aOben.length} upper, ${aBein.length} leg`);
      check('before the blow the two walking rigs agree (< 0.5 deg: two rigs start their clocks apart)',
        aOben.every((n, i) => winkel(n.rotationQuaternion!, rOben[i]!.rotationQuaternion!) < 0.5) && aBein.every((n, i) => winkel(n.rotationQuaternion!, rBein[i]!.rotationQuaternion!) < 0.5));
      check('treffer_vorn_links starts', a.rig.zeigeTreffer('treffer_vorn_links') === true && a.z.aktion !== null);
      let groesst = 0; let beinGroesst = 0;
      for (let i = 0; i < 45; i++) {
        a.schritt(1, 3); ref.schritt(1, 3);
        aOben.forEach((n, j) => { groesst = Math.max(groesst, winkel(n.rotationQuaternion!, rOben[j]!.rotationQuaternion!)); });
        aBein.forEach((n, j) => { beinGroesst = Math.max(beinGroesst, winkel(n.rotationQuaternion!, rBein[j]!.rotationQuaternion!)); });
      }
      console.log(`      struck rig vs. untouched rig: largest upper-body difference ${groesst.toFixed(1)} deg, largest leg difference ${beinGroesst.toFixed(4)} deg`);
      check('the upper body visibly flinches (> 3 deg)', groesst > 3, `${groesst.toFixed(1)} deg`);
      check('the legs stay the walking legs (< 0.5 deg difference, against a 30 deg flinch)', beinGroesst < 0.5, `${beinGroesst.toFixed(4)} deg`);
      check('the figure is still in the walking clip', a.z.aktiv?.grp.name === 'gehen');

      // minimum gap: a fresh rig, exact clock
      const b = await neuesRig(datei);
      check('a first reaction starts', b.rig.zeigeTreffer('treffer_hinten_rechts') === true);
      check('a second one at once is not started (minimum gap)', b.rig.zeigeTreffer('treffer_vorn_links') === false);
      b.schritt(Math.floor((TREFFER_MINDESTABSTAND_S - 0.05) / 0.016));
      check(`still refused at ${(TREFFER_MINDESTABSTAND_S - 0.05).toFixed(2)} s`, b.rig.zeigeTreffer('treffer_vorn_links') === false);
      b.schritt(6);
      check(`accepted after ${TREFFER_MINDESTABSTAND_S} s`, b.rig.zeigeTreffer('treffer_vorn_links') === true);
      check('an unknown or heavy clip name is refused (treffer_schwer belongs to another card)', b.rig.zeigeTreffer('treffer_schwer') === false && b.rig.zeigeTreffer('irgendwas') === false);

      // walking goes on
      const c = await neuesRig(datei);
      c.schritt(30, 3);
      const vorher = c.z.aktiv?.grp.name;
      c.rig.zeigeTreffer('treffer_vorn_rechts');
      c.schritt(20, 3);
      check('a walking figure keeps walking while it flinches', vorher === 'gehen' && c.z.aktiv?.grp.name === 'gehen' && c.z.aktion !== null, `${vorher} -> ${c.z.aktiv?.grp.name}`);

      // a swing wins
      const d = await neuesRig(datei);
      d.rig.schlage('faust');
      d.schritt(2);
      check('during a swing the flinch is refused (the attack clip owns the whole body)', d.rig.zeigeTreffer('treffer_vorn_links') === false);
      d.schritt(200);
      check('after the swing it works again', d.rig.schlaegt === false && d.rig.zeigeTreffer('treffer_vorn_links') === true);
      // death cancels a running flinch
      const e = await neuesRig(datei);
      e.rig.zeigeTreffer('treffer_vorn_links'); e.schritt(5);
      e.rig.starteTod('tod_vorn');
      check('dying ends a running flinch', e.z.aktion === null && e.rig.liegt);
    }
  }
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
