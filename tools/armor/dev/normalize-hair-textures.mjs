#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import sharp from 'sharp';

const HAIR_FILE = /^(?:H_|B_|AF_|AM_)\d+\.glb$/;
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const LUMA = [0.2126, 0.7152, 0.0722];
const MAX_PALETTE_LINEAR = Math.pow(0xde / 255, 2.2); // schneeweiss, the brightest shipped hair color

function align4(n) { return n + ((4 - (n % 4)) % 4); }
function srgbByteToLinear(v) { return Math.pow(v / 255, 2.2); }
function linearToSrgbByte(v) { return Math.round(Math.max(0, Math.min(1, v)) ** (1 / 2.2) * 255); }
function pixelLuma(raw, offset) { return LUMA[0] * srgbByteToLinear(raw[offset]) + LUMA[1] * srgbByteToLinear(raw[offset + 1]) + LUMA[2] * srgbByteToLinear(raw[offset + 2]); }

export function parseGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let json = null, bin = null;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    if (type === 0x004e4942) bin = data;
    offset += 8 + align4(length);
  }
  if (!json || !bin) throw new Error('GLB must contain JSON and BIN chunks');
  return { json, bin };
}

function readAccessor(glb, index) {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const components = NUM_COMPONENTS[accessor.type];
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  const stride = view.byteStride ?? components * componentSize;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const row = [];
    const base = start + i * stride;
    for (let c = 0; c < components; c++) {
      const offset = base + c * componentSize;
      let value;
      if (accessor.componentType === 5126) value = glb.bin.readFloatLE(offset);
      else if (accessor.componentType === 5123) value = glb.bin.readUInt16LE(offset);
      else if (accessor.componentType === 5125) value = glb.bin.readUInt32LE(offset);
      else if (accessor.componentType === 5121) value = glb.bin.readUInt8(offset);
      else if (accessor.componentType === 5122) value = glb.bin.readInt16LE(offset);
      else if (accessor.componentType === 5120) value = glb.bin.readInt8(offset);
      else throw new Error(`unsupported componentType ${accessor.componentType}`);
      row.push(value);
    }
    out.push(components === 1 ? row[0] : row);
  }
  return out;
}

function markPixel(mask, width, height, x, y, radius = 1) {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const px = Math.max(0, Math.min(width - 1, x + dx));
    const py = Math.max(0, Math.min(height - 1, y + dy));
    mask[py * width + px] = 1;
  }
}
function uvToPixel(uv, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.floor(uv[0] * width)));
  const y = Math.max(0, Math.min(height - 1, Math.floor((1 - uv[1]) * height)));
  return [x, y];
}
function edge(ax, ay, bx, by, px, py) { return (px - ax) * (by - ay) - (py - ay) * (bx - ax); }
function markTriangle(mask, width, height, a, b, c) {
  const pa = uvToPixel(a, width, height), pb = uvToPixel(b, width, height), pc = uvToPixel(c, width, height);
  const area = edge(pa[0], pa[1], pb[0], pb[1], pc[0], pc[1]);
  if (Math.abs(area) < 0.5) { markPixel(mask, width, height, pa[0], pa[1], 2); markPixel(mask, width, height, pb[0], pb[1], 2); markPixel(mask, width, height, pc[0], pc[1], 2); return; }
  const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]) - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0]) + 1));
  const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]) - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1]) + 1));
  const sign = area > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (sign * edge(pa[0], pa[1], pb[0], pb[1], px, py) >= -0.001 &&
        sign * edge(pb[0], pb[1], pc[0], pc[1], px, py) >= -0.001 &&
        sign * edge(pc[0], pc[1], pa[0], pa[1], px, py) >= -0.001) mask[y * width + x] = 1;
  }
}

function usedImageMasks(glb, width, height) {
  const masks = new Map();
  const materialsByImage = new Map();
  for (const mesh of glb.json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const material = glb.json.materials?.[primitive.material ?? 0];
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (textureIndex === undefined) continue;
    const imageIndex = glb.json.textures?.[textureIndex]?.source;
    if (imageIndex === undefined) continue;
    if (!materialsByImage.has(imageIndex)) materialsByImage.set(imageIndex, new Set());
    materialsByImage.get(imageIndex).add(primitive.material ?? 0);
    if (primitive.attributes?.TEXCOORD_0 === undefined) continue;
    const mask = masks.get(imageIndex) ?? new Uint8Array(width * height);
    masks.set(imageIndex, mask);
    const uvs = readAccessor(glb, primitive.attributes.TEXCOORD_0);
    const indices = primitive.indices !== undefined ? readAccessor(glb, primitive.indices) : Array.from({ length: uvs.length }, (_, i) => i);
    for (let i = 0; i < indices.length; i += 3) {
      const a = uvs[indices[i]], b = uvs[indices[i + 1]], c = uvs[indices[i + 2]];
      if (a && b && c) markTriangle(mask, width, height, a, b, c);
    }
  }
  return { masks, materialsByImage };
}

function imageBytes(glb, imageIndex) {
  const image = glb.json.images?.[imageIndex];
  if (!image || image.bufferView === undefined) throw new Error(`image ${imageIndex} is not stored in a bufferView`);
  const view = glb.json.bufferViews[image.bufferView];
  return glb.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

function buildGlb(json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
  const paddedBin = Buffer.concat([bin, Buffer.alloc(align4(bin.length) - bin.length, 0)]);
  const out = Buffer.alloc(12 + 8 + paddedJson.length + 8 + paddedBin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  let o = 12;
  out.writeUInt32LE(paddedJson.length, o); out.writeUInt32LE(0x4e4f534a, o + 4); paddedJson.copy(out, o + 8); o += 8 + paddedJson.length;
  out.writeUInt32LE(paddedBin.length, o); out.writeUInt32LE(0x004e4942, o + 4); paddedBin.copy(out, o + 8);
  return out;
}

function rebuildBin(json, oldBin, replacements) {
  const newViews = json.bufferViews.map((view, index) => ({ ...view, _index: index }));
  const pieces = [];
  let offset = 0;
  for (const view of newViews) {
    const original = oldBin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const data = replacements.get(view._index) ?? original;
    offset = align4(offset);
    pieces.push({ offset, data });
    view.byteOffset = offset;
    view.byteLength = data.length;
    offset += data.length;
  }
  const bin = Buffer.alloc(align4(offset));
  for (const piece of pieces) piece.data.copy(bin, piece.offset);
  for (const view of newViews) delete view._index;
  json.bufferViews = newViews;
  json.buffers[0].byteLength = bin.length;
  return bin;
}

export async function normalizeHairGlb(inputPath, outputPath = inputPath) {
  const bytes = readFileSync(inputPath);
  const glb = parseGlb(bytes);
  const json = structuredClone(glb.json);
  const replacements = new Map();
  const reports = [];
  for (let imageIndex = 0; imageIndex < (glb.json.images?.length ?? 0); imageIndex++) {
    const img = imageBytes(glb, imageIndex);
    const meta = await sharp(img).metadata();
    const raw = await sharp(img).ensureAlpha().raw().toBuffer();
    const { masks, materialsByImage } = usedImageMasks(glb, meta.width, meta.height);
    const mask = masks.get(imageIndex);
    if (!mask) continue;
    const lumas = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) lumas.push(pixelLuma(raw, i * 4));
    if (!lumas.length) continue;
    const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
    const maxRatio = Math.max(...lumas.map(v => v / mean));
    const reference = Math.min(1, 1 / maxRatio);
    if (reference < MAX_PALETTE_LINEAR) throw new Error(`${inputPath}: neutral reference ${reference.toFixed(4)} is below the brightest palette channel ${MAX_PALETTE_LINEAR.toFixed(4)}; palette reproduction would need clipping`);
    const before = Buffer.from(raw);
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
      const off = i * 4;
      const ratio = pixelLuma(before, off) / mean;
      const value = linearToSrgbByte(reference * ratio);
      raw[off] = value; raw[off + 1] = value; raw[off + 2] = value;
    }
    const encoded = await sharp(raw, { raw: { width: meta.width, height: meta.height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
    replacements.set(glb.json.images[imageIndex].bufferView, encoded);
    for (const materialIndex of materialsByImage.get(imageIndex) ?? []) {
      const material = json.materials[materialIndex];
      material.extras = { ...(material.extras ?? {}), wovHairNeutralReference: reference };
      material.name = `${String(material.name ?? 'hair')}`.replace(/__wovHairNeutralReference_[0-9.]+$/, '') + `__wovHairNeutralReference_${reference.toFixed(6)}`;
    }
    reports.push({ image: glb.json.images[imageIndex].name ?? String(imageIndex), width: meta.width, height: meta.height, pixels: lumas.length, meanLuma: +mean.toFixed(6), maxRatio: +maxRatio.toFixed(6), reference: +reference.toFixed(6), textureShaChanged: !img.equals(encoded) });
  }
  if (replacements.size) {
    const bin = rebuildBin(json, glb.bin, replacements);
    writeFileSync(outputPath, buildGlb(json, bin));
  } else if (outputPath !== inputPath) writeFileSync(outputPath, bytes);
  return { file: inputPath, changed: replacements.size > 0, reports };
}

export function hairFiles(root) {
  const dir = join(root, 'assets/models/wikingerin');
  return readdirSync(dir).filter(name => HAIR_FILE.test(name)).sort().map(name => join(dir, name));
}

async function main() {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd();
  const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const write = args.includes('--write');
  const files = args.filter(a => a.endsWith('.glb'));
  const targets = files.length ? files : hairFiles(root);
  if (!write && !outDir) throw new Error('use --write or --out <dir>');
  if (outDir) mkdirSync(outDir, { recursive: true });
  const all = [];
  for (const input of targets) {
    const output = outDir ? join(outDir, relative(join(root, 'assets/models/wikingerin'), input)) : input;
    if (outDir) mkdirSync(dirname(output), { recursive: true });
    all.push(await normalizeHairGlb(input, output));
  }
  console.log(JSON.stringify({ root, files: all.length, changed: all.filter(r => r.changed).length, results: all }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error); process.exit(1); });
