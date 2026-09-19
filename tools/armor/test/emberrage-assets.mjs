/** Real game-skeleton and skinning checks without registering or granting items. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { prepareLegacyFemaleBody, updateLegacyFemaleMask } from '../../../client/src/player/legacyFemaleMask.ts';

const [root, reference] = process.argv.slice(2);
const report = {};
for (const variant of ['Male', 'Female']) {
  const dir = join(root, variant);
  const equipment = JSON.parse(readFileSync(join(dir, 'equipment.json')));
  const fit = variant === 'Female' ? JSON.parse(readFileSync(join(dir, 'fit-validation.json'))) : null;
  const engine = new NullEngine(); const scene = new Scene(engine);
  const load = p => SceneLoader.ImportMeshAsync('', '', `data:base64,${readFileSync(p).toString('base64')}`, scene, undefined, '.glb');
  const body = await load(join(reference, variant === 'Male' ? 'WikingerKoerper.reference.glb' : 'WikingerinKoerper.reference.glb'));
  const skeleton = body.skeletons[0]; const armor = [];
  for (const clip of body.animationGroups) clip.stop();
  const base = body.meshes.find(m => m.getTotalVertices());
  const indices = Array.from(base.getIndices());
  if (fit) prepareLegacyFemaleBody([base], 'wikingerin');
  for (const part of equipment.parts) {
    const file = join(dir, 'game-ready', part.item + '.glb');
    const b = readFileSync(file); const gltf = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)));
    for (const node of gltf.nodes.filter(n => n.mesh !== undefined)) {
      assert.equal(node.extras.itemId, part.item);
      assert.equal(node.extras.bodyVariant, variant.toLowerCase());
      assert.equal(node.extras.bodyProfile, equipment.bodyProfile);
      assert(part.regions.includes(node.extras.replaces));
    }
    const lights = gltf.materials.filter(m => /^Emberrage_(glow|core|red|eyes)$/.test(m.name));
    assert(lights.length > 0, part.item + ': exported emissive geometry');
    for (const m of lights) assert(m.emissiveFactor[0] > 10 * Math.max(m.emissiveFactor[1], m.emissiveFactor[2]));
    assert.deepEqual(part.hideAppearance, part.regions[0] === 'Head' ? ['hair', 'beard', 'eyebrows'] : []);
    const result = await load(file);
    assert.deepEqual(result.skeletons[0].bones.map(b => b.name), skeleton.bones.map(b => b.name));
    for (let i = 0; i < skeleton.bones.length; i++) {
      const a = skeleton.bones[i].getAbsoluteInverseBindMatrix().asArray();
      const b = result.skeletons[0].bones[i].getAbsoluteInverseBindMatrix().asArray();
      assert(a.every((v,k) => Math.abs(v-b[k]) < 1e-6));
    }
    for (const mesh of result.meshes.filter(m => m.getTotalVertices())) { mesh.skeleton = skeleton; armor.push(mesh); }
    if (fit) {
      updateLegacyFemaleMask(base, new Set(part.regions));
      assert.equal(base.getIndices().length, indices.length - part.regions.reduce((n,r) => n + fit.parts[r].liningTriangles * 3, 0));
      updateLegacyFemaleMask(base, new Set());
      assert.deepEqual(Array.from(base.getIndices()), indices);
    }
  }
  const clips = [];
  for (const clip of body.animationGroups) {
    clip.start(true); clip.pause();
    for (const fraction of [0,.25,.5,.75,1]) {
      clip.goToFrame(clip.from + (clip.to-clip.from)*fraction);
      for (const node of body.transformNodes) node.computeWorldMatrix(true);
      skeleton.prepare(true);
      const lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
      for (const mesh of armor) {
        mesh.computeWorldMatrix(true); const positions = mesh.getPositionData(true,false);
        assert(positions?.every(Number.isFinite), clip.name);
        positions.forEach((v,i) => {lo[i%3]=Math.min(lo[i%3],v);hi[i%3]=Math.max(hi[i%3],v);});
      }
      assert(hi.every((v,i) => v-lo[i] < (fit ? 2.5 : 5)), clip.name + ': exploded armor');
    }
    clips.push(clip.name); clip.stop();
  }
  report[variant] = { status:'PASS', bones:skeleton.bones.length, items:equipment.parts.length,
    bodyProfile:equipment.bodyProfile, clips, samplesPerClip:5, redEmissiveMaterials:true,
    exactFemaleMasks:!!fit, collisionCertified:false };
  scene.dispose(); engine.dispose();
}
writeFileSync(join(root,'runtime-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);
