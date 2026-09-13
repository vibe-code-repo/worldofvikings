/** Actual Babylon GLB loader + animation/skinning gate. No browser or GPU required.
 * tsx tools/test/ironward-skin.mjs body.glb exported-models-directory [--family=ashenveil] [--unregistered] [--write-report]
 * Unregistered sets check deformation only, not the game's item registry/masking.
 * --write-report stores animation-validation.json next to the models.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { verifyArmorSkin, updateArmorVisibility } from '../../client/src/player/armorVisibility.ts';
const [bodyPath, directory] = process.argv.slice(2);
const family = process.argv.find(a => a.startsWith('--family='))?.split('=')[1] ?? 'ironward';
assert(['ironward', 'wildwarden', 'ashenveil'].includes(family), 'Unknown armor family');
const unregistered = process.argv.includes('--unregistered');
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const engine = new NullEngine(); const scene = new Scene(engine);
const load = path => SceneLoader.ImportMeshAsync('', '', `data:base64,${readFileSync(path).toString('base64')}`, scene, undefined, '.glb');
const body = await load(bodyPath); const skeleton = body.skeletons[0];
for (const group of body.animationGroups) group.stop();
const armor = [];
for (const part of manifest.items) {
  const result = await load(join(directory, part.file));
  if (!unregistered) verifyArmorSkin(skeleton, result.skeletons[0], `${family}/${part.item}`);
  assert.deepEqual(result.skeletons[0].bones.map(b => b.name), skeleton.bones.map(b => b.name));
  for (let i = 0; i < skeleton.bones.length; i++) {
    const a = skeleton.bones[i].getAbsoluteInverseBindMatrix().asArray();
    const b = result.skeletons[0].bones[i].getAbsoluteInverseBindMatrix().asArray();
    assert(a.every((v, k) => Math.abs(v - b[k]) < 1e-6), `${part.item}: inverse bind matrix ${i}`);
  }
  for (const mesh of result.meshes.filter(m => m.getTotalVertices())) { mesh.skeleton = skeleton; armor.push(mesh); }
}
if (!unregistered) {
  updateArmorVisibility(scene.meshes, manifest.items.map(p => `${family}/${p.item}`));
  assert(body.meshes.filter(m => m.getTotalVertices()).every(m => !m.isEnabled()), 'Full armor must replace all eleven regions');
  assert(armor.every(m => m.isEnabled()), 'Armor must not mask itself');
}
const frames = [];
for (const clip of body.animationGroups) {
  clip.start(true); clip.pause();
  for (const t of [0, .25, .5, .75]) {
    clip.goToFrame(clip.from + (clip.to - clip.from) * t);
    for (const node of body.transformNodes) node.computeWorldMatrix(true);
    skeleton.prepare(true);
    for (const mesh of armor) {
      mesh.computeWorldMatrix(true);
      const positions = mesh.getPositionData(true, false);
      assert(positions && positions.every(v => Number.isFinite(v) && Math.abs(v) < 4), `${clip.name}: exploded ${mesh.name}`);
    }
  }
  frames.push(clip.name); clip.stop();
}
assert(frames.length >= 3, 'Expected real movement clips');
if (!unregistered) {
  updateArmorVisibility(scene.meshes, []);
  assert(body.meshes.filter(m => m.getTotalVertices()).every(m => m.isEnabled()));
}
const report = { status: 'PASS', bones: skeleton.bones.length, armorPrimitives: armor.length, clips: frames,
  samplesPerClip: 4, registryMaskingTested: !unregistered, collisionCertified: false };
if (process.argv.includes('--write-report')) writeFileSync(join(directory, 'animation-validation.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report, null, 2));
scene.dispose(); engine.dispose();
