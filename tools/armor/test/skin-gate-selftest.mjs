/** The skin gate (tools/armor/test/skin-gate.mjs) must fail when a set does not match the item registry.
 * tsx tools/armor/test/skin-gate-selftest.mjs
 * No Blender, no assets: every registered family is written as tiny synthetic GLBs straight from the registry
 * (both bodies for Seidraven and Emberrage) and run through the gate. The complete sets must pass; each
 * deviation (GLB extras that disagree with the registry, a part missing from the manifest or from disk, a wrong
 * body, an unknown family, a body mask that hides nothing) must make it fail with its own message.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUESTUNG } from '@wov/shared';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tsx = join(root, 'node_modules/.bin/tsx');
const gate = join(root, 'tools/armor/test/skin-gate.mjs');

function glb(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const out = Buffer.alloc(28 + jsonChunk.length + binChunk.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonChunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonChunk.copy(out, 20);
  const at = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, at); out.writeUInt32LE(0x004e4942, at + 4); binChunk.copy(out, at + 8);
  return out;
}
const floats = values => Buffer.from(new Float32Array(values).buffer);
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const REGIONS = ['Head', 'Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'HandLeft', 'HandRight', 'LegLeft', 'LegRight'];
// The legacy female body is one mesh; the client sorts its triangles into regions by the bone that moves them.
const REGION_BONE = { Head: 'Head', Torso: 'Spine01', Hips: 'Hips', ArmUpperLeft: 'L_Upperarm', ArmUpperRight: 'R_Upperarm',
  ArmLowerLeft: 'L_Forearm', ArmLowerRight: 'R_Forearm', HandLeft: 'L_Hand', HandRight: 'R_Hand', LegLeft: 'L_Calf', LegRight: 'R_Calf' };
const MALE_BONES = ['Root', 'Hips', 'UpperLeg_L'];
const FEMALE_BONES = ['Root', 'Hips', 'L_Thigh', ...new Set(Object.values(REGION_BONE).filter(b => b !== 'Hips'))];

/** One skinned GLB: a flat rig, meshes made of triangles that follow one bone each, optional clips on Hips. */
function file(bones, meshes, clips = 0) {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], accessors: [], bufferViews: [], buffers: [], meshes: [], animations: [] };
  const chunks = []; let offset = 0;
  const add = (bytes, accessor) => {
    const pad = (4 - offset % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    chunks.push(bytes); offset += bytes.length;
    json.accessors.push({ bufferView: json.bufferViews.length - 1, ...accessor });
    return json.accessors.length - 1;
  };
  json.nodes = bones.map((name, i) => ({ name, ...(i === 0 ? { children: bones.map((_, k) => k).slice(1) } : {}) }));
  json.skins = [{ joints: bones.map((_, i) => i), skeleton: 0,
    inverseBindMatrices: add(floats(bones.flatMap(() => identity)), { componentType: 5126, count: bones.length, type: 'MAT4' }) }];
  for (const mesh of meshes) {
    const n = mesh.triangleBones.length * 3;
    const positions = Array.from({ length: n }, (_, v) => [(v % 3) * .01, 1 + mesh.triangleBones[Math.floor(v / 3)] * .01, 0]).flat();
    const attributes = {
      POSITION: add(floats(positions), { componentType: 5126, count: n, type: 'VEC3', min: [0, 1, 0], max: [.02, 1 + bones.length * .01, 0] }),
      JOINTS_0: add(Buffer.from(Uint8Array.from({ length: n * 4 }, (_, k) => k % 4 === 0 ? mesh.triangleBones[Math.floor(k / 12)] : 0)),
        { componentType: 5121, count: n, type: 'VEC4' }),
      WEIGHTS_0: add(floats(Array.from({ length: n * 4 }, (_, k) => k % 4 === 0 ? 1 : 0)), { componentType: 5126, count: n, type: 'VEC4' }),
    };
    const indices = add(Buffer.from(Uint16Array.from({ length: n }, (_, k) => k).buffer), { componentType: 5123, count: n, type: 'SCALAR' });
    json.meshes.push({ primitives: [{ attributes, indices }] });
    json.scenes[0].nodes.push(json.nodes.length);
    json.nodes.push({ name: mesh.name, mesh: json.meshes.length - 1, skin: 0, ...(mesh.extras ? { extras: mesh.extras } : {}) });
  }
  for (let c = 0; c < clips; c++) {
    const input = add(floats([0, 1]), { componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] });
    const output = add(floats([0, 0, 0, 0, .02, 0]), { componentType: 5126, count: 2, type: 'VEC3' });
    json.animations.push({ name: `Clip${c}`, samplers: [{ input, output, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] });
  }
  if (!clips) delete json.animations;
  const bin = Buffer.concat(chunks); json.buffers.push({ byteLength: bin.length });
  return glb(json, bin);
}
const maleBody = () => file(MALE_BONES, REGIONS.map(r => ({ name: `WoV_BodyBase_Male_${r}`, triangleBones: [1] })), 3);
const femaleBody = (without) => file(FEMALE_BONES,
  [{ name: 'Chr_Wikingerin_Body', triangleBones: REGIONS.filter(r => r !== without).map(r => FEMALE_BONES.indexOf(REGION_BONE[r])) }], 3);

/** The registry's items for a family and variant, written the way the exporter writes them. */
function partsOf(family, variant) {
  return RUESTUNG.filter(p => p.datei.startsWith(`${family}/`) && (!variant || p.bodyVariant === variant));
}
function writeSet(dir, family, variant, tweak = {}) {
  mkdirSync(dir, { recursive: true });
  const bones = variant === 'female' ? FEMALE_BONES : MALE_BONES;
  // Seidraven and Emberrage GLBs carry the body policy and item id; the older sets carry the region only.
  const policy = ['seidraven', 'emberrage'].includes(family);
  const items = [];
  for (const part of partsOf(family, variant)) {
    const item = part.datei.split('/')[1];
    const extras = extra => ({ ...extra, ...(policy ? { itemId: item, bodyVariant: part.bodyVariant, bodyProfile: part.bodyProfile } : {}) });
    let meshes = part.regions.length
      ? part.regions.map(region => ({ name: `WoV_${item}_${region}`, triangleBones: [1], extras: extras({ replaces: region }) }))
      : [{ name: `WoV_${item}_Attachment`, triangleBones: [1], extras: extras({ attachment: true }) }];
    meshes = tweak.meshes?.[item]?.(meshes) ?? meshes;
    if (tweak.omitFile !== item) writeFileSync(join(dir, `${item}.glb`), file(bones, meshes));
    if (tweak.omitManifest !== item) items.push({ item, file: `${item}.glb`, regions: part.regions });
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, items }));
  return dir;
}

const scratch = mkdtempSync(join(tmpdir(), 'wov-armor-skin-'));
try {
  writeFileSync(join(scratch, 'male.glb'), maleBody());
  writeFileSync(join(scratch, 'female.glb'), femaleBody());
  writeFileSync(join(scratch, 'female-no-head.glb'), femaleBody('Head'));
  const body = { male: join(scratch, 'male.glb'), female: join(scratch, 'female.glb'), noHead: join(scratch, 'female-no-head.glb') };
  const run = (name, bodyFile, ...args) => new Promise(resolve => {
    const child = spawn(tsx, [gate, bodyFile, join(scratch, name), ...args], { cwd: root });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', status => resolve({ status, out, err }));
  });

  // Complete sets: every registered family and body, generated from the registry itself.
  const families = [...new Set(RUESTUNG.filter(p => p.datei.includes('/')).map(p => p.datei.split('/')[0]))];
  const cases = [];
  for (const family of families) {
    for (const variant of [...new Set(partsOf(family).map(p => p.bodyVariant))]) {
      const name = `good-${family}-${variant}`;
      writeSet(join(scratch, name), family, variant);
      cases.push({ name, family, variant, args: [`--family=${family}`, `--variant=${variant}`], bodyFile: body[variant], good: true });
    }
  }
  assert(['seidraven', 'emberrage'].every(f => families.includes(f)), 'Seidraven and Emberrage are registered families');

  // Deviations. Each is one change to an otherwise complete set.
  const swap = (item, change) => ({ meshes: { [item]: meshes => meshes.map(m => ({ ...m, extras: change(m.extras) })) } });
  const bad = (name, family, variant, tweak, expect, { bodyFile = body[variant], args = [`--family=${family}`, `--variant=${variant}`] } = {}) => {
    writeSet(join(scratch, name), family, variant, tweak);
    cases.push({ name, args, bodyFile, expect });
  };
  bad('crown-replaces-head', 'wildwarden', 'male', swap('wildwarden_crown', () => ({ replaces: 'Head' })),
    /wildwarden_crown: the GLB replaces \[Head\] but the registry lists \[\]/);
  bad('crown-no-extras', 'wildwarden', 'male', swap('wildwarden_crown', () => ({})),
    /wildwarden_crown: node \S+ must carry exactly one of extras\.replaces and extras\.attachment/);
  bad('boots-replace-head', 'wildwarden', 'male', swap('wildwarden_boots', () => ({ replaces: 'Head' })),
    /wildwarden_boots: the GLB replaces \[Head,Head\] but the registry lists \[LegLeft,LegRight\]/);
  bad('vest-is-attachment', 'wildwarden', 'male', swap('wildwarden_vest', () => ({ attachment: true })),
    /wildwarden_vest: the GLB replaces \[\] but the registry lists \[Torso\]/);
  bad('helm-is-attachment', 'ironward', 'male', swap('IronwardHelmet', () => ({ attachment: true })),
    /IronwardHelmet: the GLB replaces \[\] but the registry lists \[Head\]/);
  bad('manifest-lacks-boots', 'wildwarden', 'male', { omitManifest: 'wildwarden_boots' }, /manifest\.json lacks registered wildwarden\/male items/);
  bad('boots-file-missing', 'wildwarden', 'male', { omitFile: 'wildwarden_boots' }, /GLB missing for registered wildwarden\/male items/);
  bad('female-vest-replaces-head', 'seidraven', 'female', swap('seidraven_female_vest', e => ({ ...e, replaces: 'Head' })),
    /seidraven_female_vest: the GLB replaces \[Head\] but the registry lists \[Torso\]/);
  bad('female-hood-wrong-profile', 'emberrage', 'female', swap('emberrage_female_hood', e => ({ ...e, bodyProfile: 'wov-male-v1' })),
    /extras\.bodyProfile differs from the registry/);
  bad('female-body-without-head', 'seidraven', 'female', {}, /seidraven_female_hood: hides 0 body triangles for regions \[Head\]/, { bodyFile: body.noHead });
  bad('female-set-on-male-body', 'seidraven', 'female', {}, /seidraven\/female: the body GLB is not a legacy-female-v1 body/, { bodyFile: body.male });
  bad('male-set-on-female-body', 'emberrage', 'male', {}, /emberrage\/male: the body GLB is not a wov-male-v1 body/, { bodyFile: body.female });
  bad('seidraven-needs-variant', 'seidraven', 'male', {}, /choose the body with --variant=male\|female/, { args: ['--family=seidraven'] });
  bad('unknown-family', 'wildwarden', 'male', {}, /Unknown armor family "nonsense"; the registry knows: .*seidraven.*emberrage/, { args: ['--family=nonsense'] });

  // Four at a time: each run starts a Babylon engine.
  const results = new Array(cases.length); let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < cases.length) { const i = next++; results[i] = await run(cases[i].name, cases[i].bodyFile ?? body.male, ...cases[i].args); }
  }));
  let good = 0, bad_ = 0;
  cases.forEach((c, i) => {
    const r = results[i];
    if (c.good) {
      assert.equal(r.status, 0, `${c.name}: the complete set must pass\n${r.err}`);
      const report = JSON.parse(r.out.slice(r.out.indexOf('{')));
      assert.equal(report.status, 'PASS'); assert.equal(report.registryMaskingTested, true, `${c.name}: registry checks must run`);
      assert.equal(report.family, c.family); assert.equal(report.bodyVariant, c.variant);
      assert.equal(report.registryItems, 7, `${c.name}: seven registered items`);
      assert.equal(report.glbMeshNodesChecked, 11, `${c.name}: eleven mesh nodes checked (crown attachment or ten replaced regions)`);
      if (c.variant === 'female') {
        const hidden = Object.values(report.hiddenBodyTrianglesPerItem);
        assert.equal(hidden.reduce((a, b) => a + b, 0), REGIONS.length, `${c.name}: the full set hides every body triangle`);
      }
      good++;
    } else {
      assert.notEqual(r.status, 0, `${c.name}: must fail but the gate said\n${r.out}`);
      assert.match(r.err, c.expect, `${c.name}: wrong failure\n${r.err}`);
      bad_++;
    }
  });
  console.log(`PASS skin gate: ${good} complete sets (${families.length} families, both bodies for Seidraven and Emberrage) pass, ${bad_} deviations rejected with their own message`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
