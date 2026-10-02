/**
 * The root-motion line in AssetManager.instantiate ("lying clips of OTHER players' bodies") on the REAL path
 * (Tod und Treffer N1, review finding B3): a real AssetManager instantiates the real body model (its container is
 * handed in where the HTTP loader would put it, everything after that is production code) and the lying clips of the
 * instance come out with the ground-plane travel nailed and every height key as authored.
 *
 *  [1] tod_hinten: the horizontal axis that carries the fall's travel is flat on the instance, not in the raw file.
 *  [2] The height keys of every lying/stooping clip are identical to the raw file (the rule never nails the height).
 *  [3] Control: a walking clip is left alone by this line (its travel stays; only the own figure removes it).
 *
 * Needs the real body model (assets/models/wikinger). Run: npx tsx client/test/tod-treffer-assetmanager.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { AssetManager } from '../src/engine/AssetManager';
import { LIEGE_CLIPS } from '../src/player/wurzelbewegung';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KOERPER = resolve(__dirname, '..', '..', 'assets/models/wikinger/WikingerKoerper.glb');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** Hip-bone position keys of a group as [x,y,z][] (the root-bone track with the most keys; `Root` itself only has 3). */
function wurzel(grp: AnimationGroup): number[][] {
  let beste: number[][] = [];
  for (const ta of grp.targetedAnimations) {
    const name = (ta.target as { name?: string })?.name ?? '';
    if (ta.animation.targetProperty !== 'position' || !/^(Root|Hip|Hips|Pelvis)$/.test(name)) continue;
    const keys = ta.animation.getKeys().map((k) => { const v = k.value as Vector3; return [v.x, v.y, v.z]; });
    if (keys.length > beste.length) beste = keys;
  }
  return beste;
}
const spanne = (keys: number[][], a: number): number => Math.max(...keys.map((k) => k[a]!)) - Math.min(...keys.map((k) => k[a]!));

async function main(): Promise<void> {
  if (!existsSync(KOERPER)) throw new Error('assets/models/wikinger/WikingerKoerper.glb fehlt — dieser Test braucht das echte Modell');
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const url = 'data:model/gltf-binary;base64,' + readFileSync(KOERPER).toString('base64');
  const roh = await SceneLoader.LoadAssetContainerAsync('', url, new Scene(engine), null, '.glb');
  const container: AssetContainer = await SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
  container.removeAllFromScene();

  const assets = new AssetManager(scene as never);
  (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set('KoerperProbe', Promise.resolve(container));
  const inst = await assets.instantiate('KoerperProbe');
  check('the real instantiate path returned the body', inst !== null);
  if (!inst) return;
  const gruppen = scene.animationGroups.filter((g) => !container.animationGroups.includes(g));
  const finde = (liste: readonly AnimationGroup[], n: string): AnimationGroup | undefined => liste.find((g) => g.name === n);
  check('the instance carries its own animation groups (56 clips)', gruppen.length === 56, `${gruppen.length}`);

  const rohTod = wurzel(finde(roh.animationGroups, 'tod_hinten')!);
  const instTod = wurzel(finde(gruppen, 'tod_hinten')!);
  const horizontal = spanne(rohTod, 0) >= spanne(rohTod, 2) ? 0 : 2;
  console.log('\n[1] tod_hinten: the fall\'s ground-plane travel is taken out');
  check('raw file: the horizontal axis carries real travel', spanne(rohTod, horizontal) > 0.05, `axis ${'xyz'[horizontal]}: ${spanne(rohTod, horizontal).toFixed(3)}`);
  check('instance: the same axis is flat', spanne(instTod, horizontal) < 1e-9, `${spanne(instTod, horizontal)}`);

  console.log('\n[2] Height keys of every lying/stooping clip stay as authored');
  const namen = roh.animationGroups.map((g) => g.name).filter((n) => LIEGE_CLIPS.test(n));
  let hoehenGleich = true;
  for (const n of namen) {
    const a = wurzel(finde(roh.animationGroups, n)!); const b = wurzel(finde(gruppen, n)!);
    if (a.length !== b.length || a.some((k, i) => k[1] !== b[i]![1])) { hoehenGleich = false; console.log(`      height differs: ${n}`); }
  }
  check(`${namen.length} lying clips: every height key equals the raw file`, namen.length >= 8 && hoehenGleich, namen.join(','));

  console.log('\n[3] Control: a walking clip is not touched by this line');
  const rohGehen = wurzel(finde(roh.animationGroups, 'gehen')!);
  const instGehen = wurzel(finde(gruppen, 'gehen')!);
  check('gehen keeps its travel (identical keys)', rohGehen.length === instGehen.length && rohGehen.every((k, i) => k.every((v, j) => v === instGehen[i]![j]!)));
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => { console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`); process.exit(failures === 0 ? 0 : 1); });
