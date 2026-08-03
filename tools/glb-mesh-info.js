// Inspect mesh names, primitive attributes, and material refs in creature GLBs.
const fs = require('fs');
const dir = process.argv[2];
for (const n of process.argv.slice(3)) {
  const buf = fs.readFileSync(`${dir}/${n}.glb`);
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  console.log(`=== ${n} ===`);
  (j.meshes || []).forEach((m, i) => {
    const prims = m.primitives.map(p => `${Object.keys(p.attributes).join('/')}${p.material !== undefined ? ' -> mat[' + p.material + ']="' + (j.materials[p.material].name || '?') + '"' : ' -> NO MATERIAL'}`);
    console.log(`  mesh[${i}] "${m.name}"`);
    prims.forEach(p => console.log(`    ${p}`));
  });
}
