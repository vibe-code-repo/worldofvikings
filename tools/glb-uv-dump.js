// UV-Bereiche + Vertex-Geometrie der grasscross-GLBs auslesen
const fs = require('fs');

function readGlbJson(buf) {
  const jsonLen = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)), binOff: 20 + jsonLen + 8 };
}
function acc(g, buf, ai) {
  const a = g.json.accessors[ai];
  const bv = g.json.bufferViews[a.bufferView];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || nComp * 4;
  const base = g.binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const v = [];
    for (let c = 0; c < nComp; c++) v.push(buf.readFloatLE(base + i * stride + c * 4));
    out.push(v);
  }
  return out;
}

for (const f of process.argv.slice(2)) {
  const buf = fs.readFileSync(f);
  const g = readGlbJson(buf);
  console.log('===', f.split(/[\\/]/).pop());
  for (const mesh of g.json.meshes || []) {
    for (const prim of mesh.primitives) {
      const pos = acc(g, buf, prim.attributes.POSITION);
      const uv = prim.attributes.TEXCOORD_0 !== undefined ? acc(g, buf, prim.attributes.TEXCOORD_0) : null;
      const mm = (arr, k) => [Math.min(...arr.map((v) => v[k])), Math.max(...arr.map((v) => v[k]))].map((v) => +v.toFixed(3));
      console.log(`  verts=${pos.length}  x ${mm(pos, 0)}  y ${mm(pos, 1)}  z ${mm(pos, 2)}`);
      if (uv) console.log(`  uv u ${mm(uv, 0)}  v ${mm(uv, 1)}`);
      // Stiehlt das Quad die ganze Textur oder nur einen Streifen?
      if (uv) {
        const uniq = new Set(uv.map((v) => v.map((x) => x.toFixed(2)).join(',')));
        console.log('  uv-Ecken:', [...uniq].slice(0, 12).join(' | '));
      }
    }
  }
}
