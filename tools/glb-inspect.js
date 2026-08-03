// Quick GLB inspector: dumps root node scales + material info for scale/material analysis.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const names = process.argv.slice(3);

for (const name of names) {
  const file = path.join(dir, name + '.glb');
  if (!fs.existsSync(file)) { console.log(`${name}: MISSING`); continue; }
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));

  const sceneNodes = json.scenes[json.scene ?? 0].nodes;
  const parentOf = new Set();
  (json.nodes || []).forEach(n => (n.children || []).forEach(c => parentOf.add(c)));
  const roots = json.nodes.map((n, i) => ({ ...n, i })).filter(n => !parentOf.has(n.i));

  console.log(`=== ${name} ===`);
  console.log(`  scene roots: [${sceneNodes}], root nodes: ${roots.map(r => `"${r.name}" scale=${JSON.stringify(r.scale ?? 1)}`).join('; ')}`);

  (json.materials || []).forEach(m => {
    const tex = m.pbrMetallicRoughness?.baseColorTexture !== undefined;
    console.log(`  mat "${m.name}" tex=${tex} alphaMode=${m.alphaMode ?? 'OPAQUE'} doubleSided=${!!m.doubleSided} cutoff=${m.alphaCutoff ?? '-'}`);
  });
}
