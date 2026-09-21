import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { createEmberrageGlow, syncEmberrageGlow } from '../../web/emberrage-glow.js';
import { armorFileForSkeleton } from '../../../client/src/player/armorVisibility.js';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';

const engine = new NullEngine();
const scene = new Scene(engine);
const mesh = new Mesh('Equipped_Emberrage', scene);
const other = new Mesh('Other_avatar', scene);
const flame = new PBRMaterial('Emberrage_glow', scene);
flame.emissiveColor = new Color3(1, .001, .001);
const steel = new PBRMaterial('Emberrage_plate', scene);
const effect = createEmberrageGlow(scene, [mesh]);
assert(effect.layer.isEnabled);
assert(effect.layer.hasMesh(mesh));
assert(!effect.layer.hasMesh(other));
const color = new Color4();
effect.layer.customEmissiveColorSelector!(mesh, null!, flame, color);
assert(color.r === 1 && color.g < .01);
effect.layer.customEmissiveColorSelector!(mesh, null!, steel, color);
assert.equal(color.a, 0);
effect.setMeshes([]);
assert(!effect.layer.isEnabled, 'No equipped item must disable the whole layer');
effect.setMeshes([mesh]);
scene.onBeforeRenderObservable.notifyObservers(scene);
assert(effect.layer.intensity >= .375 && effect.layer.intensity <= .525);
effect.dispose();
assert(!scene.effectLayers.includes(effect.layer));
mesh.material = flame;
syncEmberrageGlow(scene);
assert(scene.effectLayers.some(l=>l.name==='Emberrage_equipment_glow' && l.isEnabled));
mesh.setEnabled(false);syncEmberrageGlow(scene);
assert(!scene.effectLayers.find(l=>l.name==='Emberrage_equipment_glow')?.isEnabled);
const webBody={bones:Array.from({length:63},(_,i)=>({name:i?'Unused_'+i:'UpperLeg_L'}))} as unknown as Skeleton;
assert.equal(armorFileForSkeleton('emberrage/emberrage_female_hood',webBody),'armor/emberrage/emberrage_female_hood');
assert.equal(armorFileForSkeleton('emberrage/emberrage_female_hood',null),'emberrage/emberrage_female_hood');
assert.equal(armorFileForSkeleton('emberrage/emberrage_male_hood',webBody),'emberrage/emberrage_male_hood');
// Gravethorn shares the adapter: its own emissive materials glow, its plate does not, and the two families do not mix names.
{
  const gravethorn = new Mesh('Equipped_Gravethorn', scene);
  const embers = new PBRMaterial('Gravethorn_red', scene);
  embers.emissiveColor = new Color3(1, .0067, .0111);
  const both = createEmberrageGlow(scene, [gravethorn]);
  for (const name of ['red', 'glow', 'core', 'eyes']) {
    const light = new PBRMaterial(`Gravethorn_${name}`, scene);
    light.emissiveColor = new Color3(1, .01, .01);
    both.layer.customEmissiveColorSelector!(gravethorn, null!, light, color);
    assert(color.a === 1 && color.r === 1, `Gravethorn_${name} must glow`);
  }
  for (const name of ['Gravethorn_plate', 'Gravethorn_edge', 'Gravethorn_metal', 'Gravethorn_black', 'Gravethorn_cloth', 'Gravethorn_leather',
    'Gravethorn_feather', 'Gravethorn_red_extra', 'Plainhide_leather', 'red']) {
    const dull = new PBRMaterial(name, scene);
    dull.emissiveColor = new Color3(1, 0, 0);
    both.layer.customEmissiveColorSelector!(gravethorn, null!, dull, color);
    assert.equal(color.a, 0, `${dull.name} must not glow`);
  }
  // Emberrage keeps its own names only: a look-alike from the other family is not an Emberrage light.
  const foreign = new PBRMaterial('Emberrage_plate', scene);
  foreign.emissiveColor = new Color3(1, 0, 0);
  both.layer.customEmissiveColorSelector!(gravethorn, null!, foreign, color);
  assert.equal(color.a, 0);
  both.dispose();
  // The scene-wide layer picks up Gravethorn meshes, Emberrage meshes and nothing else.
  const plainhide = new Mesh('Equipped_Plainhide', scene); plainhide.material = new PBRMaterial('Plainhide_leather', scene);
  const plate = new Mesh('Equipped_GravethornPlate', scene); plate.material = new PBRMaterial('Gravethorn_plate', scene);
  const embersMesh = new Mesh('Equipped_GravethornGlow', scene); embersMesh.material = embers;
  const emberrage = new Mesh('Equipped_EmberrageAgain', scene); emberrage.material = new PBRMaterial('Emberrage_plate', scene);
  mesh.material = null; mesh.setEnabled(true);
  syncEmberrageGlow(scene);
  const layer = scene.effectLayers.find(l => l.name === 'Emberrage_equipment_glow')!;
  assert(layer.isEnabled);
  assert(layer.hasMesh(plate) && layer.hasMesh(embersMesh) && layer.hasMesh(emberrage), 'Gravethorn and Emberrage meshes are covered');
  assert(!layer.hasMesh(plainhide) && !layer.hasMesh(other) && !layer.hasMesh(mesh), 'Plainhide and unrelated meshes are not');
  embersMesh.dispose(); plate.dispose(); emberrage.dispose(); syncEmberrageGlow(scene);
  assert(!layer.isEnabled, 'No glowing set left: the layer switches off');
}
scene.dispose(); engine.dispose();
console.log('PASS per-item glow, red-only emission, both profiles (Emberrage, Gravethorn), empty equipment, pulse bounds and disposal');
