const fs = require('fs');
const path = require('path');
function inspect(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546C67) { console.log(path.basename(file), 'not glb'); return; }
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const meshes = (json.meshes || []).length;
  const skins = (json.skins || []).length;
  const nodes = (json.nodes || []).length;
  const prims = (json.meshes||[]).reduce((a,m)=>a+(m.primitives?m.primitives.length:0),0);
  console.log(`${path.basename(file)}: meshes=${meshes} prims=${prims} skins=${skins} nodes=${nodes} size=${buf.length}`);
}
const dir = 'C:\\Users\\Administrator\\Modding\\valheim_browser_assets\\models\\';
const files = [
  'troll@Laying Sleeping.glb','troll@Mutant Jumping.glb','troll@Throw.glb','troll@Zombie Attack.glb','troll@Zombie Attack2.glb',
  'trollNewWalk.glb','TrollHide.glb','Troll_ragdoll.glb','Troll_Summoned.glb','TrollUndead_Gibs.glb',
  'neck@Attack1.glb','neck@Ninja Idle.glb','neck@Run.glb','Neck_Ragdoll.glb','NeckTail.glb',
  'Greyling_attack.glb','Greyling_ragdoll.glb'
];
for (const f of files) {
  try { inspect(dir+f); } catch(e) { console.log(f, 'ERROR', e.message); }
}
