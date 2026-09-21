/** Real female GLB loading, body masking, independent characters and animation skinning.
 * tsx tools/armor/test/legacy-female-armor.mjs body.glb exported-models-directory fit-validation.json [--family=seidraven]
 * The body is the shipped monolithic 51-bone female GLB. --family is any family with a female set in the registry;
 * its items, their regions and the regions no item replaces (the free regions: Plainhide keeps head and hands) come from the
 * registry, the exact lining triangle counts from the fit report. Writes runtime-validation.json next to the models.
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { RUESTUNG } from '@wov/shared';
import { prepareLegacyFemaleBody, updateArmorVisibility, verifyArmorSkin } from '../../../client/src/player/armorVisibility.ts';
import { updateLegacyFemaleMask } from '../../../client/src/player/legacyFemaleMask.ts';

const [bodyPath,directory,fitPath]=process.argv.slice(2);
const family=process.argv.find(a=>a.startsWith('--family='))?.slice(9)??'seidraven';
const BODY_REGIONS=['Head','Torso','Hips','ArmUpperLeft','ArmUpperRight','ArmLowerLeft','ArmLowerRight','HandLeft','HandRight','LegLeft','LegRight'];
// The registered female items of the family, and what they leave alone.
const parts=RUESTUNG.filter(p=>p.datei.startsWith(`${family}/`)&&p.bodyProfile==='legacy-female-v1').map(p=>({item:p.datei.split('/')[1],file:p.datei,regions:p.regions??[]}));
assert(parts.length,`The registry has no female ${family} items`);
const replaced=[...new Set(parts.flatMap(p=>p.regions))],freeRegions=BODY_REGIONS.filter(r=>!replaced.includes(r));
// A failed run must not leave an old runtime-validation.json behind that still claims an exact mask.
rmSync(join(directory,'runtime-validation.json'),{force:true});
const fit=JSON.parse(readFileSync(fitPath));
assert.deepEqual(Object.keys(fit.parts).sort(),[...replaced].sort(),'The fit report must cover exactly the regions the registry replaces');
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
for(const part of parts){
 const result=await load(join(directory,part.item+'.glb'));
 verifyArmorSkin(skeleton,result.skeletons[0],part.file);
 for(let i=0;i<skeleton.bones.length;i++){
  const a=skeleton.bones[i].getAbsoluteInverseBindMatrix().asArray();
  const b=result.skeletons[0].bones[i].getAbsoluteInverseBindMatrix().asArray();
  assert(a.every((v,k)=>Math.abs(v-b[k])<1e-6));
 }
 for(const m of result.meshes.filter(m=>m.getTotalVertices())){
  // Only Seidraven has wings: its light feathers hang rigidly on the collarbones.
  if (family==='seidraven' && /Seidraven_(glow|core)/.test(m.material?.name??'')) {
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
 updateArmorVisibility([base,cosmetic],[part.file]);
 const hidden=part.regions.reduce((n,r)=>n+fit.parts[r].liningTriangles*3,0);
 assert.equal(base.getIndices().length,original.length-hidden,`${part.item}: exact fitted lining mask`);
 assert.deepEqual(Array.from(other.getIndices()),original,'Other characters must not change');
 assert.deepEqual(Array.from(cosmetic.getIndices()),original,'Unmarked attachments must not change');
 updateArmorVisibility([base],[]);assert.deepEqual(Array.from(base.getIndices()),original);
}
// The whole set: exactly the lining of its regions goes; what stays is the free regions and nothing else.
const files=parts.map(p=>p.file);
updateArmorVisibility([base,...armor],files);
const linings=replaced.reduce((n,r)=>n+fit.parts[r].liningTriangles,0);
const remaining=base.getIndices().length/3;
assert.equal(remaining,original.length/3-linings,'Full set: the body keeps every triangle the fit did not replace');
assert.equal(base.isEnabled(),freeRegions.length>0,'The body mesh stays on exactly when free regions are left');
assert.equal(remaining>0,freeRegions.length>0);
assert(armor.every(m=>m.isEnabled()));
// The triangles that stay (free regions) and the triangles of the replaced regions must partition the body: nothing of a replaced
// region survives, nothing of a free region is taken.
const key=(a,i)=>`${a[i]},${a[i+1]},${a[i+2]}`;
const triangles=indices=>{const out=new Set();for(let i=0;i<indices.length;i+=3)out.add(key(indices,i));return out;};
const stays=triangles(Array.from(base.getIndices()));
updateLegacyFemaleMask(base,new Set(freeRegions));
const replacedTriangles=triangles(Array.from(base.getIndices()));
for(const t of stays)assert(!replacedTriangles.has(t)||!freeRegions.length,'A free-region triangle belongs to a replaced region');
assert.equal(replacedTriangles.size,original.length/3-(freeRegions.length?remaining:0),'The replaced regions hold every triangle the free regions do not');
assert.equal(stays.size,remaining);
// Each free region on its own: hide everything but that region and count what is left of it. A missing head or a single
// missing hand must fail here and name the region; "some triangles stay" is not enough.
const freeRegionTriangles={};
for(const region of freeRegions){
 updateLegacyFemaleMask(base,new Set(BODY_REGIONS.filter(r=>r!==region)));
 freeRegionTriangles[region]=base.getIndices().length/3;
 assert(freeRegionTriangles[region]>0,`${family}: the free region ${region} has no body triangles: it is missing from the body`);
}
assert.equal(Object.values(freeRegionTriangles).reduce((a,b)=>a+b,0),remaining,`${family}: the full set leaves ${remaining} body triangles but the free regions [${freeRegions}] hold ${Object.values(freeRegionTriangles).reduce((a,b)=>a+b,0)}`);
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
const report={status:'PASS',family,bodyProfile:'legacy-female-v1',bones:skeleton.bones.length,items:parts.length,replacedRegions:replaced,freeRegions,
 clips,samplesPerClip:5,exactBodyRegionMask:true,restoreOriginalIndices:true,independentCharacters:true,
 bodyTriangles:original.length/3,replacedBodyTriangles:linings,freeBodyTriangles:remaining,freeRegionTriangles,
 ...(family==='seidraven'?{rigidShoulderWings:true}:{}),collisionCertified:false};
writeFileSync(join(directory,'runtime-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);scene.dispose();engine.dispose();
