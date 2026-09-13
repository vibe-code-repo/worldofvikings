/** Real female GLB loading, body masking, independent characters and animation skinning. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { SEIDRAVEN_FEMALE_PARTS } from '../../shared/src/seidraven.ts';
import { prepareLegacyFemaleBody, updateArmorVisibility, verifyArmorSkin } from '../../client/src/player/armorVisibility.ts';

const [bodyPath,directory,fitPath]=process.argv.slice(2);
const fit=JSON.parse(readFileSync(fitPath));
const engine=new NullEngine();const scene=new Scene(engine);
const load=p=>SceneLoader.ImportMeshAsync('','',`data:base64,${readFileSync(p).toString('base64')}`,scene,undefined,'.glb');
const body=await load(bodyPath);const skeleton=body.skeletons[0];
for(const clip of body.animationGroups)clip.stop();
const meshes=body.meshes.filter(m=>m.getTotalVertices());
assert.equal(meshes.length,1,'Fixture must be the shipped monolithic female body');
const base=meshes[0];const original=Array.from(base.getIndices());
const other=base.clone('OtherCharacter',null);const cosmetic=base.clone('UnmarkedCosmetic',null);
prepareLegacyFemaleBody([base],'wikingerin');prepareLegacyFemaleBody([other],'wikingerin');
assert.notEqual(base.geometry,other.geometry);
const armor=[];
for(const part of SEIDRAVEN_FEMALE_PARTS){
 const result=await load(join(directory,part.item+'.glb'));
 verifyArmorSkin(skeleton,result.skeletons[0],`seidraven/${part.item}`);
 for(let i=0;i<skeleton.bones.length;i++){
  const a=skeleton.bones[i].getAbsoluteInverseBindMatrix().asArray();
  const b=result.skeletons[0].bones[i].getAbsoluteInverseBindMatrix().asArray();
  assert(a.every((v,k)=>Math.abs(v-b[k])<1e-6));
 }
 for(const m of result.meshes.filter(m=>m.getTotalVertices())){
  if (/Seidraven_(glow|core)/.test(m.material?.name??'')) {
   const joints=m.getVerticesData(VertexBuffer.MatricesIndicesKind);
   const weights=m.getVerticesData(VertexBuffer.MatricesWeightsKind);
   const names=new Map(result.skeletons[0].bones.map(b=>[b.getIndex(),b.name]));
   const expected=m.name.includes('ArmUpperLeft')?'L_Clavicle':'R_Clavicle';
   for(let i=0;i<weights.length;i+=4){
    assert(Math.abs(weights[i]-1)<1e-6 && weights.slice(i+1,i+4).every(w=>w===0));
    assert.equal(names.get(joints[i]),expected,'Light feathers must be rigidly shoulder-bound');
   }
  }
  m.skeleton=skeleton;armor.push(m);
 }
 updateArmorVisibility([base,cosmetic],['seidraven/'+part.item]);
 const hidden=part.regions.reduce((n,r)=>n+fit.parts[r].liningTriangles*3,0);
 assert.equal(base.getIndices().length,original.length-hidden,`${part.item}: exact fitted lining mask`);
 assert.deepEqual(Array.from(other.getIndices()),original,'Other characters must not change');
 assert.deepEqual(Array.from(cosmetic.getIndices()),original,'Unmarked attachments must not change');
 updateArmorVisibility([base],[]);assert.deepEqual(Array.from(base.getIndices()),original);
}
updateArmorVisibility([base,...armor],SEIDRAVEN_FEMALE_PARTS.map(p=>'seidraven/'+p.item));
assert(!base.isEnabled());assert(armor.every(m=>m.isEnabled()));
updateArmorVisibility([base],[]);assert(base.isEnabled());assert.deepEqual(Array.from(base.getIndices()),original);
const clips=[];
for(const clip of body.animationGroups){
 clip.start(true);clip.pause();
 for(const fraction of [0,.25,.5,.75,1]){
  clip.goToFrame(clip.from+(clip.to-clip.from)*fraction);
  for(const node of body.transformNodes)node.computeWorldMatrix(true);
  skeleton.prepare(true);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const mesh of armor){
   mesh.computeWorldMatrix(true);const p=mesh.getPositionData(true,false);
   assert(p&&p.every(Number.isFinite),`${clip.name}: invalid coordinates`);
   p.forEach((v,i)=>{const a=i%3;lo[a]=Math.min(lo[a],v);hi[a]=Math.max(hi[a],v);});
  }
  assert(hi.every((v,i)=>v-lo[i]<2.5),`${clip.name}: exploded armor (root translation allowed)`);
 }
 clips.push(clip.name);clip.stop();
}
assert.equal(clips.length,6);
const report={status:'PASS',bodyProfile:'legacy-female-v1',bones:skeleton.bones.length,
 clips,samplesPerClip:5,exactBodyRegionMask:true,restoreOriginalIndices:true,independentCharacters:true,
 bodyTriangles:original.length/3,rigidShoulderWings:true,collisionCertified:false};
writeFileSync(join(directory,'runtime-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);scene.dispose();engine.dispose();
