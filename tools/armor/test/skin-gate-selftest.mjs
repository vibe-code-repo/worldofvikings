/** The skin gate (tools/armor/test/skin-gate.mjs) must fail when a set does not match the item registry.
 * tsx tools/armor/test/skin-gate-selftest.mjs
 * No Blender, no assets: every registered family is written as tiny synthetic GLBs straight from the registry
 * (both bodies for the families that have a female set, and their web fit on the 63-bone web body) and run through
 * the gate. What a set must contain is derived from the registry: its items, its replaced regions, and the free regions
 * no item replaces (Plainhide keeps head and hands). The complete sets must pass; each deviation (GLB extras that
 * disagree with the registry, a part missing from the manifest or from disk, a wrong body, an unknown family, a body
 * mask that hides nothing or takes the free regions) must make it fail with its own message.
 * Since Nachbesserung 1 also: every free region is proven on its own (a body without the head or one hand fails, and so does
 * the stand-alone legacy check), a registered GLB without `itemId`, `bodyVariant` or `bodyProfile` fails unless its family is on
 * the gate's closed legacy list (`--list-legacy-sets`), and a manifest that lists an item id twice fails before loading.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// The web body is the 63-bone rig of the newer female; it has one mesh per region, like the male body.
const WEB_BONES = ['Root', 'Hips', 'UpperLeg_L', ...Array.from({ length: 60 }, (_, i) => `Web_${i}`)];

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
const maleBody = (...without) => file(MALE_BONES, REGIONS.filter(r => !without.includes(r)).map(r => ({ name: `WoV_BodyBase_Male_${r}`, triangleBones: [1] })), 3);
const femaleBodyWithClips = (clips, without) => file(FEMALE_BONES,
  [{ name: 'Chr_Wikingerin_Body', triangleBones: REGIONS.filter(r => !without.includes(r)).map(r => FEMALE_BONES.indexOf(REGION_BONE[r])) }], clips);
const femaleBody = (...without) => femaleBodyWithClips(3, without);
const webBody = (...without) => file(WEB_BONES, REGIONS.filter(r => !without.includes(r)).map(r => ({ name: `Chr_${r}_Female_00`, triangleBones: [1] })), 3);
// The gate's own closed list of families whose GLBs carry no identity extras. Pinned here, so it cannot grow unnoticed.
const LEGACY_FAMILIES = JSON.parse(execFileSync(tsx, [gate, '--list-legacy-sets'], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop());
assert.deepEqual(LEGACY_FAMILIES, ['ironward', 'wildwarden', 'ashenveil'], 'The legacy list is closed: a new entry needs a reviewed change of this test as well');

/** The registry's items for a family and variant, written the way the exporter writes them. */
function partsOf(family, variant) {
  return RUESTUNG.filter(p => p.datei.startsWith(`${family}/`) && (!variant || p.bodyVariant === variant));
}
function writeSet(dir, family, variant, tweak = {}) {
  mkdirSync(dir, { recursive: true });
  // A web fit is skinned to the web body and says so: the catalog's web profile, not the game profile.
  const web = tweak.web === true;
  const bones = web ? WEB_BONES : variant === 'female' ? FEMALE_BONES : MALE_BONES;
  // The older sets carry the region only; every later family's GLBs carry the body policy and the item id.
  const policy = !LEGACY_FAMILIES.includes(family);
  const items = [];
  for (const part of partsOf(family, variant)) {
    const item = part.datei.split('/')[1];
    const extras = extra => ({ ...extra, ...(policy ? { itemId: item, bodyVariant: part.bodyVariant, bodyProfile: web ? 'wov-female-v1' : part.bodyProfile } : {}) });
    let meshes = part.regions.length
      ? part.regions.map(region => ({ name: `WoV_${item}_${region}`, triangleBones: [1], extras: extras({ replaces: region }) }))
      : [{ name: `WoV_${item}_Attachment`, triangleBones: [1], extras: extras({ attachment: true }) }];
    meshes = tweak.meshes?.[item]?.(meshes) ?? meshes;
    if (tweak.omitFile !== item) writeFileSync(join(dir, `${item}.glb`), file(bones, meshes));
    if (tweak.omitManifest !== item) items.push({ item, file: `${item}.glb`, regions: part.regions });
  }
  // A duplicate manifest line: the same item id again, pointing at a file of its own (broken) or at the same file.
  if (tweak.duplicate) {
    if (tweak.duplicate.file === 'corrupt.glb') writeFileSync(join(dir, 'corrupt.glb'), 'not a GLB');
    items.push({ item: tweak.duplicate.item, file: tweak.duplicate.file, regions: [] });
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 1, items }));
  return dir;
}

const scratch = mkdtempSync(join(tmpdir(), 'wov-armor-skin-'));
try {
  writeFileSync(join(scratch, 'male.glb'), maleBody());
  writeFileSync(join(scratch, 'female.glb'), femaleBody());
  writeFileSync(join(scratch, 'female-no-head.glb'), femaleBody('Head'));
  writeFileSync(join(scratch, 'female-no-free.glb'), femaleBody('Head', 'HandLeft', 'HandRight'));
  writeFileSync(join(scratch, 'web.glb'), webBody());
  writeFileSync(join(scratch, 'female-no-left-hand.glb'), femaleBody('HandLeft'));
  writeFileSync(join(scratch, 'web-no-head.glb'), webBody('Head'));
  writeFileSync(join(scratch, 'web-no-right-hand.glb'), webBody('HandRight'));
  writeFileSync(join(scratch, 'male-no-head.glb'), maleBody('Head'));
  const body = { male: join(scratch, 'male.glb'), female: join(scratch, 'female.glb'), noHead: join(scratch, 'female-no-head.glb'),
    noFree: join(scratch, 'female-no-free.glb'), web: join(scratch, 'web.glb'), noLeftHand: join(scratch, 'female-no-left-hand.glb'),
    webNoHead: join(scratch, 'web-no-head.glb'), webNoRightHand: join(scratch, 'web-no-right-hand.glb'), maleNoHead: join(scratch, 'male-no-head.glb') };
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
      // Every female set also ships its web fit, which the gate must be able to check against the web body.
      if (variant === 'female') {
        writeSet(join(scratch, `${name}-web`), family, variant, { web: true });
        cases.push({ name: `${name}-web`, family, variant, web: true, args: [`--family=${family}`, `--variant=${variant}`, '--web'], bodyFile: body.web, good: true });
      }
    }
  }
  assert(['seidraven', 'emberrage', 'plainhide', 'gravethorn'].every(f => families.includes(f)), 'Seidraven, Emberrage, Plainhide and Gravethorn are registered families');

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
  bad('male-set-on-web-body', 'emberrage', 'male', {}, /emberrage\/male: the body GLB is not a wov-male-v1 body/, { bodyFile: body.web });
  bad('seidraven-needs-variant', 'seidraven', 'male', {}, /choose the body with --variant=male\|female/, { args: ['--family=seidraven'] });
  bad('unknown-family', 'wildwarden', 'male', {}, /Unknown armor family "nonsense"; the registry knows: .*seidraven.*emberrage.*plainhide.*gravethorn/, { args: ['--family=nonsense'] });
  // The five-piece Plainhide set: an item that reaches into head or hands is refused, and so is a body that leaves no head and hands to keep.
  bad('plainhide-vest-replaces-head', 'plainhide', 'female', swap('plainhide_female_vest', e => ({ ...e, replaces: 'Head' })),
    /plainhide_female_vest: the GLB replaces \[Head\] but the registry lists \[Torso\]/);
  bad('plainhide-boots-replace-hands', 'plainhide', 'male', swap('plainhide_male_boots', e => ({ ...e, replaces: 'HandLeft' })),
    /plainhide_male_boots: the GLB replaces \[HandLeft,HandLeft\] but the registry lists \[LegLeft,LegRight\]/);
  bad('plainhide-body-has-no-free-regions', 'plainhide', 'female', {}, /plainhide\/female: the full set leaves 0 body triangles for the free regions \[Head,HandLeft,HandRight\]/, { bodyFile: body.noFree });
  bad('gravethorn-hood-attachment', 'gravethorn', 'female', swap('gravethorn_female_hood', ({ replaces: _replaced, ...rest }) => ({ ...rest, attachment: true })),
    /gravethorn_female_hood: the GLB replaces \[\] but the registry lists \[Head\]/);
  // The web fit: right body and right profile, or refused.
  const webBad = (name, family, variant, tweak, expect, options) => bad(name, family, variant, { web: true, ...tweak }, expect,
    { args: [`--family=${family}`, `--variant=${variant}`, '--web'], ...options });
  webBad('web-fit-on-game-body', 'plainhide', 'female', {}, /plainhide\/female: the body GLB is not a wov-female-v1 body \(\d+ bones\)/, { bodyFile: body.female });
  webBad('web-fit-on-male-body', 'gravethorn', 'female', {}, /gravethorn\/female: the body GLB is not a wov-female-v1 body/, { bodyFile: body.male });
  webBad('web-hood-carries-game-profile', 'gravethorn', 'female', swap('gravethorn_female_hood', e => ({ ...e, bodyProfile: 'legacy-female-v1' })),
    /gravethorn_female_hood: node \S+ extras\.bodyProfile differs from the registry/, { bodyFile: body.web });
  webBad('web-vest-replaces-head', 'plainhide', 'female', swap('plainhide_female_vest', e => ({ ...e, replaces: 'Head' })),
    /plainhide_female_vest: the GLB replaces \[Head\] but the registry lists \[Torso\]/, { bodyFile: body.web });
  webBad('web-flag-on-male-set', 'plainhide', 'male', {}, /--web: plainhide\/male has no separate web fit/, { bodyFile: body.web });
  bad('web-fit-on-web-body-without-flag', 'plainhide', 'female', { web: true }, /plainhide\/female: the body GLB is not a legacy-female-v1 body/, { bodyFile: body.web });
  bad('web-and-unregistered', 'plainhide', 'female', { web: true }, /--web needs the registry/, { bodyFile: body.web, args: ['--web', '--unregistered'] });

  // M1: every free region on its own. A body that still has SOME free triangles or meshes is not enough.
  bad('plainhide-game-body-lacks-head', 'plainhide', 'female', {}, /plainhide\/female: the free region Head has no body triangles: it is missing from the body/, { bodyFile: body.noHead });
  bad('plainhide-game-body-lacks-left-hand', 'plainhide', 'female', {}, /plainhide\/female: the free region HandLeft has no body triangles/, { bodyFile: body.noLeftHand });
  webBad('plainhide-web-body-lacks-head', 'plainhide', 'female', {}, /plainhide\/female: the free region Head has no body mesh: it is missing from the body/, { bodyFile: body.webNoHead });
  webBad('plainhide-web-body-lacks-right-hand', 'plainhide', 'female', {}, /plainhide\/female: the free region HandRight has no body mesh/, { bodyFile: body.webNoRightHand });
  bad('plainhide-male-body-lacks-head', 'plainhide', 'male', {}, /plainhide\/male: the free region Head has no body mesh/, { bodyFile: body.maleNoHead });

  // M2: identity extras are required in a registered run, per field and all three, for a foreign item of the same regions.
  // The stripped boots are the real attack: another set's boots under this set's file name, with the identity fields removed.
  const without = (...fields) => extras => Object.fromEntries(Object.entries(extras).filter(([key]) => !fields.includes(key)));
  for (const [family, item] of [['plainhide', 'plainhide_female_boots'], ['gravethorn', 'gravethorn_female_boots'], ['seidraven', 'seidraven_female_boots']]) {
    for (const fields of [['itemId'], ['bodyVariant'], ['bodyProfile'], ['itemId', 'bodyVariant', 'bodyProfile']]) {
      bad(`${family}-boots-without-${fields.join('+')}`, family, 'female', swap(item, without(...fields)),
        new RegExp(`${item}: node \\S+ lacks extras\\.${fields[0]}, which a registered ${family} GLB must carry`));
    }
  }
  bad('plainhide-male-boots-without-all-identity', 'plainhide', 'male', swap('plainhide_male_boots', without('itemId', 'bodyVariant', 'bodyProfile')),
    /plainhide_male_boots: node \S+ lacks extras\.itemId/);
  webBad('plainhide-web-boots-without-bodyProfile', 'plainhide', 'female', swap('plainhide_female_boots', without('bodyProfile')),
    /plainhide_female_boots: node \S+ lacks extras\.bodyProfile/, { bodyFile: body.web });
  // Control: foreign boots that DO carry the fields are refused by the value, as before.
  bad('plainhide-boots-of-another-item', 'plainhide', 'female', swap('plainhide_female_boots', e => ({ ...e, itemId: 'gravethorn_female_boots' })),
    /plainhide_female_boots: node \S+ extras\.itemId differs from the registry/);

  // K1: a manifest that lists an item id twice is refused before any GLB is loaded, whatever the second line points at.
  bad('manifest-duplicate-broken-file', 'plainhide', 'female', { duplicate: { item: 'plainhide_female_vest', file: 'corrupt.glb' } },
    /manifest\.json lists an item id more than once: plainhide_female_vest/);
  bad('manifest-duplicate-same-file', 'plainhide', 'female', { duplicate: { item: 'plainhide_female_boots', file: 'plainhide_female_boots.glb' } },
    /manifest\.json lists an item id more than once: plainhide_female_boots/);
  bad('manifest-duplicate-unregistered', 'ironward', 'male', { duplicate: { item: 'IronwardHelmet', file: 'corrupt.glb' } },
    /manifest\.json lists an item id more than once: IronwardHelmet/, { args: ['--unregistered'] });

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
      // What the set must contain, from the registry: its items, one mesh node per replaced region (an attachment has one node),
      // and the free regions no item replaces.
      const parts = partsOf(c.family, c.variant);
      const replaced = new Set(parts.flatMap(p => p.regions));
      const free = REGIONS.filter(region => !replaced.has(region));
      assert.equal(report.registryItems, parts.length, `${c.name}: every registered item is checked`);
      assert.equal(report.glbMeshNodesChecked, parts.reduce((n, p) => n + Math.max(p.regions.length, 1), 0), `${c.name}: mesh nodes checked`);
      assert.deepEqual(report.freeRegions, free, `${c.name}: free regions`);
      assert.equal(!!report.webBody, !!c.web, `${c.name}: web body flag`);
      // Identity extras are required for every family except the closed legacy list.
      assert.equal(report.identityExtras, LEGACY_FAMILIES.includes(c.family) ? 'legacy-exempt' : 'required', `${c.name}: identity extras mode`);
      // Each free region is proven on its own: one synthetic triangle (or mesh) per region.
      assert.deepEqual(report.freeRegionTriangles, Object.fromEntries(free.map(region => [region, 1])), `${c.name}: per-region free triangles`);
      if (c.variant === 'female' && !c.web) {
        const hidden = Object.values(report.hiddenBodyTrianglesPerItem);
        assert.equal(hidden.reduce((a, b) => a + b, 0), replaced.size, `${c.name}: the full set hides exactly its replaced regions`);
        assert.equal(report.bodyTriangles - replaced.size, free.length, `${c.name}: the free regions stay on the body`);
      }
      // The two sizes of set: Plainhide has five pieces and keeps head and hands; every other family has seven and covers the body.
      if (c.family === 'plainhide') { assert.equal(parts.length, 5); assert.deepEqual(free, ['Head', 'HandLeft', 'HandRight']); }
      else if (c.family !== 'wildwarden') { assert.equal(parts.length, 7); assert.deepEqual(free, []); }
      good++;
    } else {
      assert.notEqual(r.status, 0, `${c.name}: must fail but the gate said\n${r.out}`);
      assert.match(r.err, c.expect, `${c.name}: wrong failure\n${r.err}`);
      bad_++;
    }
  });
  // The stand-alone legacy check (legacy-female-armor.mjs) on a synthetic 51-bone body with six clips: it must prove every free
  // region too, and a failed run must not leave a report that still claims an exact mask.
  const legacyTool = join(root, 'tools/armor/test/legacy-female-armor.mjs');
  const legacyDir = writeSet(join(scratch, 'legacy-plainhide'), 'plainhide', 'female');
  const replacedByPlainhide = [...new Set(partsOf('plainhide', 'female').flatMap(p => p.regions))];
  writeFileSync(join(scratch, 'legacy-fit.json'), JSON.stringify({ parts: Object.fromEntries(replacedByPlainhide.map(r => [r, { liningTriangles: 1 }])) }));
  const legacyRun = (bodyName, without) => new Promise(resolve => {
    writeFileSync(join(scratch, `${bodyName}.glb`), femaleBodyWithClips(6, without));
    writeFileSync(join(legacyDir, 'runtime-validation.json'), JSON.stringify({ status: 'PASS', exactBodyRegionMask: true, stale: true }));
    const child = spawn(tsx, [legacyTool, join(scratch, `${bodyName}.glb`), legacyDir, join(scratch, 'legacy-fit.json'), '--family=plainhide'], { cwd: root });
    let err = ''; child.stderr.on('data', d => { err += d; }); child.stdout.on('data', () => {});
    child.on('close', status => resolve({ status, err }));
  });
  const legacyGood = await legacyRun('legacy-complete', []);
  assert.equal(legacyGood.status, 0, `legacy-female-armor.mjs must pass on a complete body\n${legacyGood.err}`);
  const legacyReport = JSON.parse(readFileSync(join(legacyDir, 'runtime-validation.json'), 'utf8'));
  assert.equal(legacyReport.exactBodyRegionMask, true); assert.equal(legacyReport.stale, undefined, 'a fresh report replaces the old one');
  assert.deepEqual(legacyReport.freeRegionTriangles, { Head: 1, HandLeft: 1, HandRight: 1 });
  let legacyBad = 0;
  for (const [name, without, region] of [['legacy-no-head', ['Head'], 'Head'], ['legacy-no-left-hand', ['HandLeft'], 'HandLeft'], ['legacy-no-right-hand', ['HandRight'], 'HandRight']]) {
    const r = await legacyRun(name, without);
    assert.notEqual(r.status, 0, `${name}: legacy-female-armor.mjs must fail without ${region}`);
    assert.match(r.err, new RegExp(`plainhide: the free region ${region} has no body triangles: it is missing from the body`), `${name}: wrong failure\n${r.err}`);
    assert(!existsSync(join(legacyDir, 'runtime-validation.json')), `${name}: no report may claim an exact mask after a failed run`);
    legacyBad++;
  }
  console.log(`PASS legacy-female-armor.mjs: 1 complete body passes, ${legacyBad} bodies without a free region are rejected and leave no report`);
  console.log(`PASS skin gate: ${good} complete sets (${families.length} families; male, game female and web female fits) pass, ${bad_} deviations rejected with their own message`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
