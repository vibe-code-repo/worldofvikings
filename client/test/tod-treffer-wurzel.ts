/**
 * A4 of the core animations: root motion of the lying and stooping clips never nails the HEIGHT.
 *
 * Run on the two REAL body models (56 clips each: 28 old ones + 20 core clips + 8 block/roll clips):
 *  [1] The 28 old clips come out exactly as with the old rule (a verbatim copy of the old
 *      AvatarRig.messeUndEntferneWurzelbewegung is the reference): every root-bone key, the returned
 *      speed, for both bodies. Nothing that walked, ran, jumped or swung changed.
 *  [2] The lying/stooping clips (tod_*, aufstehen_*, umgeworfen, aufrappeln, buecken_*, truhe_oeffnen)
 *      keep their height keys EXACTLY as authored; only a horizontal axis may be nailed.
 *  [3] tod_hinten ends with the hips at 0.12 (model units, the card's "0,12 m"), where the old rule froze it at 0.85
 *      — the dead figure hovered. The old reference is run beside it to show the difference is the rule and not the data.
 *  [4] The decision function alone: a synthetic clip whose largest span is the height.
 *
 * Needs the real body models (assets/models/wikinger|wikingerin, v1).
 * Run: npx tsx client/test/tod-treffer-wurzel.ts   (from the repo root or client/)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { LIEGE_CLIPS, messeUndEntferneWurzelbewegung, wurzelAchsen } from '../src/player/wurzelbewegung.js';
import { BLOCK_CLIPS, KERN_CLIPS } from '../src/player/kernClips.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(__dirname, '..', '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** The 28 clips of the body models before 2026-09-29 (DEV c424960), in file order. */
const ALT = [
  'idle', 'gehen', 'rennen', 'springen', 'angriff', 'angriff2', 'angriff3', 'faust', 'faust2', 'faust3',
  'arm_schwert', 'hand_schwert', 'ausruesten', 'ablegen', 'parade_links', 'parade_rechts', 'parade_unten',
  'stab_angriff', 'stab_angriff2', 'stab_angriff3', 'arm_stab', 'stab_ausruesten', 'stab_ablegen',
  'stab_parade_links', 'stab_parade_rechts', 'stab_parade_unten', 'arm_speer', 'hand_speer',
];

/** VERBATIM copy of the old rule (AvatarRig.messeUndEntferneWurzelbewegung on origin/main), the reference. */
function alteRegel(grp: AnimationGroup, modellSkalierung: number, istSprung = false): number {
  let weiteste = 0;
  for (const ta of grp.targetedAnimations) {
    if (ta.animation.targetProperty !== 'position') continue;
    const zielName = (ta.target as { name?: string })?.name ?? '';
    if (!/^(Root|Hip|Hips|Pelvis|mixamorig:Hips)$/.test(zielName)) continue;
    const keys = ta.animation.getKeys();
    if (keys.length < 2) continue;
    const min = (keys[0]!.value as Vector3).clone();
    const max = min.clone();
    for (const k of keys) {
      min.minimizeInPlace(k.value as Vector3);
      max.maximizeInPlace(k.value as Vector3);
    }
    const spann = max.subtract(min);
    const achse: 'x' | 'y' | 'z' = spann.x >= spann.y && spann.x >= spann.z ? 'x' : spann.y >= spann.z ? 'y' : 'z';
    const weite = spann[achse];
    const eltern = (ta.target as TransformNode).parent as TransformNode | null;
    eltern?.computeWorldMatrix(true);
    const massstab = eltern?.absoluteScaling?.x ?? modellSkalierung;
    const weiteMeter = weite * massstab;
    if (weiteMeter < 0.2) continue;
    const achsen: Array<'x' | 'y' | 'z'> = istSprung ? ['x', 'y', 'z'] : [achse];
    for (const ax of achsen) {
      const ruhewert = (ta.target as TransformNode).position[ax];
      for (const k of keys) (k.value as Vector3)[ax] = ruhewert;
    }
    ta.animation.setKeys(keys);
    const fps = ta.animation.framePerSecond || 60;
    const dauer = (keys[keys.length - 1]!.frame - keys[0]!.frame) / fps;
    if (dauer > 0) weiteste = Math.max(weiteste, weiteMeter / dauer);
  }
  return weiteste;
}

const engine = new NullEngine();

async function lade(datei: string): Promise<AnimationGroup[]> {
  const scene = new Scene(engine);
  const url = 'data:model/gltf-binary;base64,' + readFileSync(datei).toString('base64');
  const container = await SceneLoader.LoadAssetContainerAsync('', url, scene, null, '.glb');
  return container.animationGroups;
}

/** All root-bone position keys of a group as plain numbers: name -> [frame,x,y,z][]. */
function wurzelKeys(grp: AnimationGroup): Record<string, number[][]> {
  const aus: Record<string, number[][]> = {};
  for (const ta of grp.targetedAnimations) {
    const name = (ta.target as { name?: string })?.name ?? '';
    if (ta.animation.targetProperty !== 'position' || !/^(Root|Hip|Hips|Pelvis)$/.test(name)) continue;
    aus[name] = ta.animation.getKeys().map((k) => [k.frame, (k.value as Vector3).x, (k.value as Vector3).y, (k.value as Vector3).z]);
  }
  return aus;
}
const gleich = (a: number[][], b: number[][]): boolean =>
  a.length === b.length && a.every((k, i) => k.every((v, j) => Object.is(v, b[i]![j]!) || Math.abs(v - b[i]![j]!) === 0));

async function main(): Promise<void> {
  const KOERPER: Array<[string, string]> = [
    ['wikinger', 'assets/models/wikinger/WikingerKoerper.glb'],
    ['wikingerin', 'assets/models/wikingerin/WikingerinKoerper.glb'],
  ];
  for (const [name, rel] of KOERPER) {
    const pfad = resolve(WURZEL, rel);
    if (!existsSync(pfad)) throw new Error(`${rel} fehlt — dieser Test braucht die echten Koerper`);
    console.log(`\n════ ${name} ════`);
    const neu = await lade(pfad);
    const alt = await lade(pfad);
    const roh = await lade(pfad);
    check('56 clips: the 28 old ones first, then the 20 core clips, then the 8 block/roll clips', neu.length === 56 && neu.slice(0, 28).every((g, i) => g.name === ALT[i]) && KERN_CLIPS.every((n, i) => neu[28 + i]!.name === n) && BLOCK_CLIPS.every((n, i) => neu[48 + i]!.name === n), `${neu.length}`);
    const sprung = neu.find((g) => g.name === 'springen');
    const rate = new Map<string, { neu: number; alt: number }>();
    for (let i = 0; i < neu.length; i++) {
      const istSprung = neu[i]!.name === sprung?.name;
      rate.set(neu[i]!.name, { neu: messeUndEntferneWurzelbewegung(neu[i]!, 1, istSprung), alt: alteRegel(alt[i]!, 1, istSprung) });
    }

    console.log('\n[1] The 28 old clips are untouched by the new rule');
    let alleGleich = true; let tempoGleich = true; let mitBewegung = 0;
    for (let i = 0; i < 28; i++) {
      const a = wurzelKeys(neu[i]!); const b = wurzelKeys(alt[i]!);
      const keyGleich = Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => gleich(a[k]!, b[k]!));
      if (!keyGleich) { alleGleich = false; console.log(`      keys differ: ${neu[i]!.name}`); }
      const r = rate.get(neu[i]!.name)!;
      if (r.neu !== r.alt) { tempoGleich = false; console.log(`      speed differs: ${neu[i]!.name} ${r.neu} vs ${r.alt}`); }
      if (r.alt > 0) mitBewegung++;
    }
    check('every root-bone key of the 28 old clips equals the old rule\'s result', alleGleich);
    check('the returned speed (m/s) of the 28 old clips is identical', tempoGleich);
    check('the comparison is not empty: several old clips do carry travel (gait, jump, thrusts)', mitBewegung >= 5, `${mitBewegung} clips`);

    console.log('\n[2] Lying and stooping clips keep every height key');
    const liegen = neu.filter((g) => LIEGE_CLIPS.test(g.name)).map((g) => g.name);
    check('the rule names exactly the 9 clips of the card: tod x2, aufstehen x2, umgeworfen, aufrappeln, buecken x2, truhe_oeffnen',
      [...liegen].sort().join() === ['aufrappeln', 'aufstehen_hinten', 'aufstehen_vorn', 'buecken_hoch', 'buecken_runter', 'tod_hinten', 'tod_vorn', 'truhe_oeffnen', 'umgeworfen'].join(), liegen.join(','));
    for (const n of liegen) {
      const g = neu.find((x) => x.name === n)!; const r0 = roh.find((x) => x.name === n)!;
      const a = wurzelKeys(g); const b = wurzelKeys(r0);
      const hoeheGleich = Object.keys(b).every((k) => a[k] && a[k]!.every((kk, i) => kk[2] === b[k]![i]![2]));
      check(`${n}: height keys identical to the authored clip`, hoeheGleich);
      const genagelt = Object.keys(b).flatMap((k) => (['x', 'z'] as const).filter((ax, j) => {
        const idx = j === 0 ? 1 : 3;
        return new Set(a[k]!.map((kk) => kk[idx])).size === 1 && new Set(b[k]!.map((kk) => kk[idx])).size > 1;
      }));
      check(`${n}: at most one ground axis nailed (${genagelt.join('') || 'none'})`, genagelt.length <= 1);
    }

    console.log('\n[3] tod_hinten: the hips end low (0.12) — the old rule froze the height');
    const endeY = (g: AnimationGroup): number => {
      const k = wurzelKeys(g)['Hips'] ?? wurzelKeys(g)['Hip']!;
      return k[k.length - 1]![2]!;
    };
    const hinten = neu.find((g) => g.name === 'tod_hinten')!; const hintenAlt = alt.find((g) => g.name === 'tod_hinten')!;
    const hintenRoh = roh.find((g) => g.name === 'tod_hinten')!;
    console.log(`      hips height at the last key: new ${endeY(hinten).toFixed(3)}, old rule ${endeY(hintenAlt).toFixed(3)}, authored ${endeY(hintenRoh).toFixed(3)}`);
    check('new: 0.12 (0.10 - 0.14) = the authored lying height', endeY(hinten) > 0.10 && endeY(hinten) < 0.14 && Math.abs(endeY(hinten) - endeY(hintenRoh)) < 1e-9);
    check('old rule (reference): frozen at the standing height 0.85 — the bug this card removes', endeY(hintenAlt) > 0.8);
    const vorn = neu.find((g) => g.name === 'tod_vorn')!;
    check('tod_vorn ends at 0.10 (0.08 - 0.13)', endeY(vorn) > 0.08 && endeY(vorn) < 0.13, endeY(vorn).toFixed(3));
    const umg = neu.find((g) => g.name === 'umgeworfen')!;
    const uk = wurzelKeys(umg)['Hips']!; const yMin = Math.min(...uk.map((k) => k[2]!)); const yMax = Math.max(...uk.map((k) => k[2]!));
    check('umgeworfen keeps its full height swing (span > 1.9)', yMax - yMin > 1.9, `${(yMax - yMin).toFixed(3)}`);
    const bueck = neu.find((g) => g.name === 'buecken_runter')!; const bk = wurzelKeys(bueck)['Hips']!;
    check('buecken_runter keeps its 0.41 dip', Math.max(...bk.map((k) => k[2]!)) - Math.min(...bk.map((k) => k[2]!)) > 0.4);
  }

  console.log('\n[4] The decision itself');
  // A clip whose largest span is the height (like tod_hinten: y 0.76 against z 0.62).
  const bilanz = wurzelAchsen('tod_hinten', { x: 0.09, y: 0.76, z: 0.62 }, 1);
  check('lying clip: only the ground axis z is nailed, never y', bilanz.achsen.join() === 'z', bilanz.achsen.join());
  check('the same spans under a walking clip name: the old rule takes y', wurzelAchsen('gehen', { x: 0.09, y: 0.76, z: 0.62 }, 1).achsen.join() === 'y');
  check('lying clip with only small ground travel: nothing nailed, height untouched', wurzelAchsen('umgeworfen', { x: 0.002, y: 1.975, z: 0.033 }, 1).achsen.length === 0);
  check('a jump keeps its all-three-axes rule', wurzelAchsen('springen', { x: 0.1, y: 0.5, z: 0.3 }, 1, true).achsen.join() === 'x,y,z');
  check('a lying clip is never treated as a jump (height stays)', !wurzelAchsen('tod_vorn', { x: 0.1, y: 0.5, z: 0.3 }, 1, true).achsen.includes('y'));
  check('scale: 0.15 model units at scale 2 is 0.3 m of travel', wurzelAchsen('tod_vorn', { x: 0.15, y: 0, z: 0 }, 2).achsen.join() === 'x');

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
