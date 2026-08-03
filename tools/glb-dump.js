// Deeper GLB dump: node tree names, mesh/skin/material summary, buffer sizes.
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
console.log(`file: ${file}  (${Math.round(buf.length / 1024)} KB, json ${jsonLen} B)`);
console.log(`nodes=${(j.nodes || []).length} meshes=${(j.meshes || []).length} skins=${(j.skins || []).length} mats=${(j.materials || []).length} images=${(j.images || []).length} anims=${(j.animations || []).length}`);
const meshNodes = (j.nodes || []).filter(n => n.mesh !== undefined);
console.log(`mesh-nodes (${meshNodes.length}): ${meshNodes.map(n => `"${n.name}"(mesh ${n.mesh}${n.skin !== undefined ? ', skin ' + n.skin : ''})`).join(' ')}`);
(j.meshes || []).forEach((m, i) => {
  const attrs = m.primitives.map(p => Object.keys(p.attributes).join('/')).join(' | ');
  console.log(`  mesh[${i}] prims=${m.primitives.length}: ${attrs}`);
});
if (j.skins) j.skins.forEach((s, i) => console.log(`  skin[${i}] joints=${s.joints.length}`));
