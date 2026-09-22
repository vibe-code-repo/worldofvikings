/** Actual Babylon GLB loader + animation/skinning gate. No browser or GPU required.
 * tsx tools/armor/test/skin-gate.mjs body.glb exported-models-directory [--family=ashenveil] [--variant=male|female] [--web] [--unregistered] [--write-report]
 * --family is any family the item registry knows (the folder part of `datei` in RUESTUNG); default ironward.
 * --variant picks the body when a family has male and female items (Seidraven, Emberrage, Plainhide, Gravethorn); a family with a
 *   single variant needs none. The body GLB must match that variant's bodyProfile.
 * --web checks the web-body fit of a female set instead of the game fit: the body GLB is the 63-bone web body, and the GLBs
 *   must be skinned to it and carry the `previewBodyProfile` the catalog names for the set (wov-female-v1), not the registered
 *   game profile (legacy-female-v1). The items are the same registry items; only the body and its rig differ.
 * A registered run is driven by the registry: every item it lists for the family and variant must be in
 * manifest.json and exist as a GLB, and the `replaces` / `attachment` extras of each GLB must name exactly the
 * regions the registry lists, in both directions.
 * In a registered run every mesh node of a GLB must carry `itemId`, `bodyVariant` and `bodyProfile` and they must equal the
 * registry (the web profile with --web). The ONLY exception is the named list FAMILIES_WITHOUT_IDENTITY_EXTRAS below
 * (`--list-legacy-sets` prints it); every other family, including every future one, is required.
 * Every region the registry leaves free (Plainhide: head and hands) must exist after the full set is worn, each one on its
 * own, with WHOLE triangles (an index count that is a multiple of 3 and at least 3) in an indexed triangle list, and every
 * mesh of it must be enabled, `isVisible === true` and a finite `visibility > 0`. A segmented body mesh whose name names no
 * known region fails the gate; region names are read with the same parser the client uses (`bodyRegionOfMeshName`), so a
 * mesh is never counted for two regions. It does NOT prove material transparency (alphaMode BLEND, alpha 0),
 * foreign geometry that encloses a free region, the completeness of the original body geometry, or that correct identity
 * fields were not copied onto foreign geometry (see `notProven` in the report and the README). A manifest that lists an item id twice is refused before anything is loaded.
 * --unregistered checks deformation only, not the registry, the extras or the masking; use it for sets that
 * have no registry entry yet.
 * --write-report stores animation-validation.json next to the models.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { RUESTUNG, equipmentSetCatalog } from '@wov/shared';
import { verifyArmorSkin, updateArmorVisibility, prepareLegacyFemaleBody } from '../../../client/src/player/armorVisibility.ts';
import { updateLegacyFemaleMask } from '../../../client/src/player/legacyFemaleMask.ts';
import { bodyRegionOfMeshName, BODY_REGIONS } from '../../../client/src/player/bodyRegions.ts';

/**
 * The registered families whose shipped GLBs predate the identity extras: their mesh nodes carry `replaces` or `attachment`
 * and nothing else (measured on the real GLBs of every body fit: no `itemId`, no `bodyVariant`, no `bodyProfile`).
 * They are the only exception. The list is closed on purpose: a family that is not on it, and every future family, must carry
 * all three fields. It is not derived from a name pattern; adding a family here is a deliberate, reviewed edit.
 */
const FAMILIES_WITHOUT_IDENTITY_EXTRAS = ['ironward', 'wildwarden', 'ashenveil'];
const NOT_PROVEN = ['material transparency (alphaMode BLEND, alpha 0)', 'foreign geometry that spatially encloses a free region',
  'completeness of the original body geometry', 'that correct identity fields were not copied onto foreign geometry (a metadata contract, not provenance)'];
if (process.argv.includes('--list-legacy-sets')) { console.log(JSON.stringify(FAMILIES_WITHOUT_IDENTITY_EXTRAS)); process.exit(0); }
if (process.argv.includes('--list-not-proven')) { console.log(JSON.stringify(NOT_PROVEN)); process.exit(0); }
const [bodyPath, directory] = process.argv.slice(2);
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const families = [...new Set(RUESTUNG.filter(p => p.datei.includes('/')).map(p => p.datei.split('/')[0]))];
const family = option('family') ?? 'ironward';
const unregistered = process.argv.includes('--unregistered');
const web = process.argv.includes('--web');
assert(unregistered || families.includes(family), `Unknown armor family "${family}"; the registry knows: ${families.join(', ')}`);
assert(!(web && unregistered), '--web needs the registry: the web body profile comes from the catalog, not from the command line');
const itemOf = part => part.datei.split('/')[1];
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
// One source for "which entry counts": the manifest may not list an item id twice, so the existence check and the loading
// below cannot look at different entries.
const listed = new Map(manifest.items.map(i => [i.item, i]));
const duplicated = [...new Set(manifest.items.map(i => i.item).filter((item, at, all) => all.indexOf(item) !== at))];
assert.deepEqual(duplicated, [], `manifest.json lists an item id more than once: ${duplicated.join(', ')}`);
const identityRequired = !unregistered && !FAMILIES_WITHOUT_IDENTITY_EXTRAS.includes(family);

// What the registry promises for this family and body. A registered run is checked against nothing else.
let expected = [], variant, profile;
if (!unregistered) {
  const familyParts = RUESTUNG.filter(p => p.datei.startsWith(`${family}/`));
  const variants = [...new Set(familyParts.map(p => p.bodyVariant).filter(Boolean))];
  variant = option('variant') ?? (variants.length === 1 ? variants[0] : undefined);
  assert(variant, `Family ${family} has ${variants.join(' and ')} items; choose the body with --variant=${variants.join('|')}`);
  assert(variants.includes(variant), `Family ${family} has no ${variant} items (registry: ${variants.join(', ')})`);
  expected = familyParts.filter(p => !p.bodyVariant || p.bodyVariant === variant);
  const profiles = [...new Set(expected.map(p => p.bodyProfile).filter(Boolean))];
  assert(profiles.length <= 1, `${family}/${variant}: more than one body profile in the registry: ${profiles.join(', ')}`);
  profile = profiles[0];
  if (web) {
    // The catalog says which body the web fit of this set was made for; the registry only knows the game figure.
    const set = equipmentSetCatalog().sets.find(s => s.familyId === family && s.bodyVariant === variant);
    const preview = [...new Set((set?.parts ?? []).map(p => p.previewBodyProfile))];
    assert(variant === 'female' && preview.length === 1 && preview[0] !== profile,
      `--web: ${family}/${variant} has no separate web fit (catalog previewBodyProfile: ${preview.join(', ') || 'none'})`);
    profile = preview[0];
  }
  // Every item the registry names must be in the manifest and exist as a GLB: a missing part is never a smaller target.
  const unknown = manifest.items.map(i => i.item).filter(item => !familyParts.some(p => itemOf(p) === item));
  assert.deepEqual(unknown, [], `manifest.json lists items the registry does not know for ${family}`);
  const missing = expected.map(itemOf).filter(item => !listed.has(item));
  assert.deepEqual(missing, [], `manifest.json lacks registered ${family}/${variant} items`);
  const absent = expected.map(itemOf).filter(item => !existsSync(join(directory, listed.get(item).file)));
  assert.deepEqual(absent, [], `GLB missing for registered ${family}/${variant} items`);
} else if (manifest.items.some(i => RUESTUNG.some(p => p.datei.endsWith(`/${i.item}`)))) {
  console.error('WARNING: --unregistered on items the registry knows; registry, extras and masking are NOT checked (use --family).');
}
const entries = unregistered
  ? manifest.items.map(i => ({ item: i.item, file: i.file }))
  : expected.map(part => ({ item: itemOf(part), file: listed.get(itemOf(part)).file, part }));

/** The mesh nodes of a GLB with their extras, read from the file itself, not from the loader. */
function meshNodes(path) {
  const bytes = readFileSync(path);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.filter(n => n.mesh !== undefined).map(n => ({ name: n.name, extras: n.extras ?? {} }));
}
// glTF primitive.mode 4 is TRIANGLES; it is the default when the field is absent. Only an indexed triangle list is a
// supported body mesh: the Babylon loader accepts other topologies (a triangle strip) without converting them, so an
// index count alone cannot tell a strip from a malformed list.
const TRIANGLES_MODE = 4;
/** Per mesh node name: whether every one of its primitives is an indexed triangle list, read from the GLB itself. */
function meshPrimitiveModes(path) {
  const bytes = readFileSync(path);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const byName = new Map();
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const primitives = json.meshes[node.mesh].primitives;
    byName.set(node.name, primitives.every(p => p.indices !== undefined && (p.mode ?? TRIANGLES_MODE) === TRIANGLES_MODE));
  }
  return byName;
}
/** The GLB must say what the registry says: which regions it replaces, or that it is an attachment. */
function checkExtras(part, nodes) {
  const label = `${family}/${itemOf(part)}`, regions = part.regions ?? [];
  assert(nodes.length > 0, `${label}: the GLB has no mesh node`);
  const replaced = [];
  for (const { name, extras } of nodes) {
    const replaces = extras.replaces, attachment = extras.attachment === true;
    assert(attachment !== (replaces !== undefined),
      `${label}: node ${name} must carry exactly one of extras.replaces and extras.attachment, has ${JSON.stringify(extras)}`);
    if (replaces !== undefined) replaced.push(replaces);
    for (const key of ['itemId', 'bodyVariant', 'bodyProfile']) {
      // A missing field is an error for every family that is not on the legacy list, not a way past the comparison.
      if (extras[key] === undefined) {
        assert(!identityRequired, `${label}: node ${name} lacks extras.${key}, which a registered ${family} GLB must carry`);
        continue;
      }
      // A web fit is skinned to the web body: it carries the catalog's preview profile instead of the game profile.
      const want = key === 'itemId' ? itemOf(part) : key === 'bodyProfile' && web ? profile : part[key];
      assert.equal(extras[key], want, `${label}: node ${name} extras.${key} differs from the registry`);
    }
  }
  assert.deepEqual([...replaced].sort(), [...regions].sort(),
    `${label}: the GLB replaces [${replaced.sort()}] but the registry lists [${[...regions].sort()}]`);
}

// The body regions of the game's figures; the ones no registered item replaces stay visible (Plainhide: head and hands).
const freeRegions = unregistered ? [] : BODY_REGIONS.filter(region => !expected.some(p => p.regions?.includes(region)));
const engine = new NullEngine(); const scene = new Scene(engine);
const load = path => SceneLoader.ImportMeshAsync('', '', `data:base64,${readFileSync(path).toString('base64')}`, scene, undefined, '.glb');
const body = await load(bodyPath); const skeleton = body.skeletons[0];
for (const group of body.animationGroups) group.stop();
if (profile) {
  // The two shipped bodies have different rigs; the registry names which one the items were fitted to.
  const bones = new Set(skeleton.bones.map(b => b.name));
  const fits = profile === 'legacy-female-v1' ? bones.has('L_Thigh') && !bones.has('UpperLeg_L')
    : profile === 'wov-male-v1' ? bones.has('UpperLeg_L') && !bones.has('L_Thigh') && skeleton.bones.length !== 63
    : profile === 'wov-female-v1' ? bones.has('UpperLeg_L') && !bones.has('L_Thigh') && skeleton.bones.length === 63 : undefined;
  assert(fits !== undefined, `No body check for bodyProfile ${profile}`);
  assert(fits, `${family}/${variant}: the body GLB is not a ${profile} body (${skeleton.bones.length} bones)`);
}
// The legacy female body is one mesh whose triangles are hidden per region instead of whole meshes.
const legacyFemale = profile === 'legacy-female-v1';
if (legacyFemale) {
  // Whole triangles first: the production mask code reads the index list three at a time and would fail with an unrelated message.
  for (const m of body.meshes.filter(m => m.getTotalVertices())) {
    assert(m.getTotalIndices() % 3 === 0, `${family}/${variant}: the body mesh has ${m.getTotalIndices()} indices: it needs whole triangles`);
  }
  prepareLegacyFemaleBody(body.meshes, expected[0].figure);
}
const armor = []; let meshNodeCount = 0;
for (const { item, file, part } of entries) {
  const path = join(directory, file);
  if (part) { const nodes = meshNodes(path); checkExtras(part, nodes); meshNodeCount += nodes.length; }
  const result = await load(path);
  if (part) verifyArmorSkin(skeleton, result.skeletons[0], `${family}/${item}`);
  assert.deepEqual(result.skeletons[0].bones.map(b => b.name), skeleton.bones.map(b => b.name));
  for (let i = 0; i < skeleton.bones.length; i++) {
    const a = skeleton.bones[i].getAbsoluteInverseBindMatrix().asArray();
    const b = result.skeletons[0].bones[i].getAbsoluteInverseBindMatrix().asArray();
    assert(a.every((v, k) => Math.abs(v - b[k]) < 1e-6), `${item}: inverse bind matrix ${i}`);
  }
  for (const mesh of result.meshes.filter(m => m.getTotalVertices())) { mesh.skeleton = skeleton; armor.push(mesh); }
}
const bodyMeshes = body.meshes.filter(m => m.getTotalVertices());
const original = legacyFemale ? Array.from(bodyMeshes[0].getIndices()) : [], maskTriangles = {}, freeRegionTriangles = {};
if (!unregistered) {
  // The registry decides which regions a set hides: an attachment such as the Wildwarden crown hides none.
  const files = expected.map(p => `${family}/${itemOf(p)}`);
  const replaced = new Set(expected.flatMap(p => p.regions ?? []));
  assert(replaced.size > 0, 'The registry knows no replaced region for these items; wrong --family?');
  if (legacyFemale) {
    assert.equal(bodyMeshes.length, 1, 'The legacy female body is a single mesh');
    const trianglesLeft = active => { updateArmorVisibility(scene.meshes, active); return bodyMeshes[0].getIndices().length; };
    // Each item takes away exactly the triangles of its own regions: an item with regions hides some, an attachment none,
    // and the items together hide the sum of their parts (regions never overlap).
    let taken = 0;
    for (const [i, part] of expected.entries()) {
      const drop = original.length - trianglesLeft([files[i]]);
      assert(drop % 3 === 0 && (drop > 0) === !!part.regions?.length, `${files[i]}: hides ${drop / 3} body triangles for regions [${part.regions ?? []}]`);
      maskTriangles[itemOf(part)] = drop / 3; taken += drop;
    }
    assert.equal(original.length - trianglesLeft(files), taken, 'Full armor must hide exactly the sum of its items\' triangles');
    // Regions no item replaces (Plainhide: head and hands) stay on the body; a set that covers every region leaves nothing.
    const left = bodyMeshes[0].getIndices().length / 3;
    assert.equal(left > 0, freeRegions.length > 0,
      `${family}/${variant}: the full set leaves ${left} body triangles for the free regions [${freeRegions}]`);
    // Each free region on its own: hide everything but that region and count what is left of it. "Something is left" is not
    // enough; a missing head or hand must turn the gate red and name the region.
    for (const region of freeRegions) {
      updateLegacyFemaleMask(bodyMeshes[0], new Set(BODY_REGIONS.filter(r => r !== region)));
      freeRegionTriangles[region] = bodyMeshes[0].getIndices().length / 3;
      assert(freeRegionTriangles[region] > 0 && Number.isInteger(freeRegionTriangles[region]),
        `${family}/${variant}: the free region ${region} has no body triangles: it is missing from the body`);
    }
    // And nothing but the free regions stays when the set is worn: the parts add up to what is left.
    const sum = Object.values(freeRegionTriangles).reduce((a, b) => a + b, 0);
    assert.equal(sum, left, `${family}/${variant}: the full set leaves ${left} body triangles but the free regions [${freeRegions}] hold ${sum}`);
    trianglesLeft(files);
    // The free regions live inside the one body mesh: with the full set worn that mesh must be on, visible and not faded out.
    if (freeRegions.length) {
      const m = bodyMeshes[0];
      assert(m.isEnabled() && m.isVisible === true && Number.isFinite(m.visibility) && m.visibility > 0,
        `${family}/${variant}: the free regions [${freeRegions}] are not visible after the full set (body mesh ${m.name}: isEnabled=${m.isEnabled()}, isVisible=${m.isVisible}, visibility=${m.visibility})`);
    }
  } else {
    // One region per body mesh, read the same way the client reads it: a mesh whose name names none is an error, not
    // silently ignored geometry, and a mesh named for one region (a free hand called "... Head") can never also stand
    // in for another (the free Head itself).
    const primitiveModes = meshPrimitiveModes(bodyPath);
    const meshRegion = new Map(bodyMeshes.map(m => [m, bodyRegionOfMeshName(m.name)]));
    for (const m of bodyMeshes) {
      assert(meshRegion.get(m) !== undefined, `${family}/${variant}: body mesh ${m.name} does not name a known body region`);
    }
    const hiddenBody = () => bodyMeshes.filter(m => !m.isEnabled());
    for (const [i, part] of expected.entries()) {
      updateArmorVisibility(scene.meshes, [files[i]]);
      const alone = hiddenBody();
      assert.equal(alone.length, (part.regions ?? []).length, `${files[i]} must hide exactly its ${(part.regions ?? []).length} registered regions`);
      assert(alone.every(m => part.regions.includes(meshRegion.get(m))), `${files[i]}: only its registered regions may be hidden`);
    }
    updateArmorVisibility(scene.meshes, files);
    const hidden = hiddenBody();
    assert.equal(hidden.length, replaced.size, `Full armor must hide exactly its ${replaced.size} registered regions`);
    assert(hidden.every(m => replaced.has(meshRegion.get(m))), 'Only registered regions may be hidden');
    // Each free region must exist as a body mesh and be visible: "the registered ones are hidden" says nothing about them.
    for (const region of freeRegions) {
      const meshes = bodyMeshes.filter(m => meshRegion.get(m) === region);
      assert(meshes.length > 0, `${family}/${variant}: the free region ${region} has no body mesh: it is missing from the body`);
      for (const m of meshes) {
        assert(primitiveModes.get(m.name), `${family}/${variant}: the free region ${region} has a mesh (${m.name}) that is not an indexed triangle list: only indexed triangle lists are supported`);
        // Whole triangles: a head with one or two indices is no head. Every mesh of the region counts, not only the first.
        const indices = m.getTotalIndices();
        assert(indices >= 3 && indices % 3 === 0,
          `${family}/${variant}: the free region ${region} has ${indices} indices in mesh ${m.name}: it needs whole triangles (a multiple of 3, at least 3)`);
      }
      // The states the mask code and the loader leave behind, after the full set is worn; each mesh of the region, not one of them.
      const unseen = meshes.find(m => !(m.isEnabled() && m.isVisible === true && Number.isFinite(m.visibility) && m.visibility > 0));
      assert(!unseen, `${family}/${variant}: the free region ${region} is not visible although no item replaces it (mesh ${unseen?.name}: isEnabled=${unseen?.isEnabled()}, isVisible=${unseen?.isVisible}, visibility=${unseen?.visibility})`);
      freeRegionTriangles[region] = meshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0);
    }
  }
  assert(armor.every(m => m.isEnabled()), 'Armor must not mask itself');
}
const frames = [];
for (const clip of body.animationGroups) {
  clip.start(true); clip.pause();
  for (const t of [0, .25, .5, .75]) {
    clip.goToFrame(clip.from + (clip.to - clip.from) * t);
    for (const node of body.transformNodes) node.computeWorldMatrix(true);
    skeleton.prepare(true);
    for (const mesh of armor) {
      mesh.computeWorldMatrix(true);
      const positions = mesh.getPositionData(true, false);
      assert(positions && positions.every(v => Number.isFinite(v) && Math.abs(v) < 4), `${clip.name}: exploded ${mesh.name}`);
    }
  }
  frames.push(clip.name); clip.stop();
}
assert(frames.length >= 3, 'Expected real movement clips');
if (!unregistered) {
  updateArmorVisibility(scene.meshes, []);
  assert(bodyMeshes.every(m => m.isEnabled()));
  if (legacyFemale) assert.deepEqual(Array.from(bodyMeshes[0].getIndices()), original, 'Unequipping must restore every body triangle');
}
const report = { status: 'PASS', bones: skeleton.bones.length, armorPrimitives: armor.length, clips: frames,
  samplesPerClip: 4, registryMaskingTested: !unregistered, collisionCertified: false,
  // What a green gate does not say. Keep in step with the README section "What the gate does not prove".
  notProven: NOT_PROVEN };
if (!unregistered) Object.assign(report, { family, bodyVariant: variant, bodyProfile: profile, registryItems: expected.length, glbMeshNodesChecked: meshNodeCount,
  freeRegions, freeRegionTriangles, identityExtras: identityRequired ? 'required' : 'legacy-exempt', ...(web ? { webBody: true } : {}),
  ...(legacyFemale ? { bodyTriangles: original.length / 3, hiddenBodyTrianglesPerItem: maskTriangles } : {}) });
if (process.argv.includes('--write-report')) writeFileSync(join(directory, 'animation-validation.json'), JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify(report, null, 2));
scene.dispose(); engine.dispose();
