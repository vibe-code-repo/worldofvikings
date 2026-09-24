/** Exercise the real avatar and preview refresh paths without a player login or GPU. */
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { AvatarRig } from '../src/player/AvatarRig.js';
import { CharakterVorschau } from '../src/ui/CharakterVorschau.js';
import { Vorschau } from '../../tools/web/vorschau-web.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { hiddenAppearance, hiddenAppearanceForFiles, equipmentSetCatalog, findItem, Inventory,
  encodeArmor, frisurMitGesicht, AUGENBRAUEN, PLAINHIDE_FREE_REGIONS, legacyFemaleRegionForBone } from '@wov/shared';
import { armorFileForSkeleton, prepareLegacyFemaleBody, updateArmorVisibility } from '../src/player/armorVisibility.js';
import { bodyRegionOfMeshName, type BodyRegion } from '../src/player/bodyRegions.js';

const all = ['hair', 'beard', 'eyebrows'];
assert.deepEqual([...hiddenAppearance([{}])], []);
assert.deepEqual([...hiddenAppearance([{ hideAppearance: ['hair'] }, { hideAppearance: ['beard'] }])], ['hair', 'beard']);
assert.deepEqual([...hiddenAppearanceForFiles(['wildwarden/wildwarden_crown'])], []);
assert.deepEqual([...hiddenAppearanceForFiles(['ashenveil/ashenveil_hood'])], all);
assert.deepEqual([...hiddenAppearanceForFiles(['wildwarden/wildwarden_robe', 'ironward/IronwardHelmet'])], all);
assert.deepEqual([...hiddenAppearanceForFiles(['missing/helmet'])], []);
// Only the Gravethorn helm hides hair, beard and eyebrows; Plainhide keeps the player's own head and hands.
for (const sex of ['male', 'female']) {
  assert.deepEqual([...hiddenAppearanceForFiles([`gravethorn/gravethorn_${sex}_hood`])], all);
  assert.deepEqual([...hiddenAppearanceForFiles(['shoulders', 'vest', 'bracers', 'gloves', 'robe', 'boots'].map(key => `gravethorn/gravethorn_${sex}_${key}`))], []);
  assert.deepEqual([...hiddenAppearanceForFiles(['shoulders', 'vest', 'bracers', 'robe', 'boots'].map(key => `plainhide/plainhide_${sex}_${key}`))], []);
  assert.deepEqual([...hiddenAppearanceForFiles([`crowshade/crowshade_${sex}_hood`])], all);
  assert.deepEqual([...hiddenAppearanceForFiles(['shoulders', 'vest', 'bracers', 'gloves', 'robe', 'boots'].map(key => `crowshade/crowshade_${sex}_${key}`))], []);
}
for (const set of equipmentSetCatalog().sets) for (const part of set.parts) {
  assert.deepEqual(part.hideAppearance, findItem(part.itemId)?.hideAppearance);
}
const inventory = new Inventory();
inventory.addItem(findItem('ashenveil_hood')!, 1);
inventory.load(inventory.serialize());
assert.deepEqual(inventory.all[0].shared.hideAppearance, all, 'Restored inventory resolves current item policy');

const engine = new NullEngine();
for (const kind of ['avatar', 'inventory-preview', 'web-preview']) {
  const scene = new Scene(engine);
  const head = CreateBox('Chr_Head_Male_00', {}, scene);
  const crown = CreateBox('WoV_Wildwarden_Crown', {}, scene);
  const hood = CreateBox('WoV_Ashenveil_Head', {}, scene);
  const cosmetics = ['hair', 'beard', 'eyebrows'].map(name => CreateBox(name, {}, scene));
  const prefix = kind === 'web-preview' ? 'armor/' : '';
  const crownFile = prefix + 'wildwarden/wildwarden_crown';
  const hoodFile = prefix + 'ashenveil/ashenveil_hood';
  const selected = new Map([['frisur', 'H_02'], ['bart', 'B_01'], ['augenbraue', 'A_01']]);
  const meshes = new Map([['H_02', [cosmetics[0]]], ['B_01', [cosmetics[1]]], ['A_01', [cosmetics[2]]], [crownFile, [crown]]]);
  const loaded = new Map([...meshes].map(([file, netze]) => [file, { netze }]));
  const proto = kind === 'avatar' ? AvatarRig.prototype : kind === 'web-preview' ? Vorschau.prototype : CharakterVorschau.prototype;
  const context = Object.assign(Object.create(proto), {
    scene, koerperNetze: [head], halter: { getChildMeshes: () => scene.meshes },
    getragen: selected, aktuell: selected, teile: meshes, geladen: loaded,
    teileErlaubt: true, neuerWikinger: true, bodyFile: 'wikinger/WikingerKoerper',
    teileEpoche: 0, teileLaeufe: new Map(), haarHex: '', zerstoert: false,
  });
  const refresh = () => (kind === 'avatar' ? context.refreshArmorVisibility() : context.refreshVisibility());
  selected.set('kopf', crownFile); refresh();
  assert(head.isEnabled(), kind + ': attachment crown preserves the textured head');
  assert(cosmetics.every(mesh => mesh.isEnabled()), kind + ': crown keeps all selected cosmetics');
  selected.set('kopf', hoodFile); refresh();
  assert(head.isEnabled() && cosmetics.every(mesh => mesh.isEnabled()), kind + ': unloaded/failed hood hides nothing');
  meshes.set(hoodFile, [hood]); loaded.set(hoodFile, { netze: [hood] }); refresh();
  assert(!head.isEnabled() && cosmetics.every(mesh => !mesh.isEnabled()), kind + ': loaded hood hides all');
  cosmetics[0].setEnabled(true); refresh();
  assert(!cosmetics[0].isEnabled(), kind + ': late hair load respects the hood');
  selected.set('kopf', crownFile); refresh();
  assert(head.isEnabled() && cosmetics.every(mesh => mesh.isEnabled()), kind + ': hood to crown restores head and cosmetics');
  selected.delete('kopf'); refresh();
  assert(head.isEnabled() && cosmetics.every(mesh => mesh.isEnabled()), kind + ': unequip restores everything');
  assert.equal(selected.get('frisur'), 'H_02', kind + ': selection is never erased by hiding');
  if (kind !== 'avatar') {
    selected.delete('frisur');
    await context.setze('frisur', 'H_02');
    assert.equal(selected.get('frisur'), 'H_02', kind + ': compatible male hair remains allowed');
    await context.setze('frisur', 'H_01');
    assert.equal(selected.get('frisur'), '', kind + ': incompatible old hair stays blocked');
  }
  scene.dispose();
}
// Remote players use the actual async entity loader, including hair tint and body masking.
{
  const scene = new Scene(engine);
  const root = new TransformNode('remote-player', scene);
  const skeleton = new Skeleton('body', 'body', scene);
  const head = CreateBox('Chr_Head_Male_00', {}, scene);
  head.parent = root; head.skeleton = skeleton;
  const dynamic = { root, aussehen: new Map() };
  const context = Object.assign(Object.create(EntityManager.prototype), {
    dynamics: new Map([['remote-test', dynamic]]),
    armorRequests: new WeakMap(),
    assets: { instantiate: async (file: string) => {
      const node = new TransformNode(file, scene);
      const mesh = CreateBox('attachment', {}, scene);
      mesh.parent = node; mesh.skeleton = skeleton;
      return node;
    } },
  });
  const eyebrow = AUGENBRAUEN.find(part => part.figur === 'wikinger')!;
  assert(eyebrow);
  const update = {
    key: 'remote-test', figur: 'wikinger', haarfarbe: 'mittelbraun',
    frisur: frisurMitGesicht('H_02', 'B_01', eyebrow.id), ruestung: '|',
  };
  const equip = async (id: string) => {
    update.ruestung = encodeArmor(id ? { kopf: id } : {});
    await context.setzeFremdesAussehen(update, 'wikinger/WikingerKoerper');
  };
  const attachmentsVisible = (visible: boolean) =>
    ['frisur', 'bart', 'augenbraue'].every(slot => dynamic.aussehen.get(slot)?.wurzel.isEnabled() === visible);
  await equip('wildwarden_crown');
  assert(head.isEnabled() && attachmentsVisible(true), 'Remote crown keeps the textured head and all cosmetics');
  await equip('ashenveil_hood');
  assert(!head.isEnabled() && attachmentsVisible(false), 'Remote hood hides all cosmetics');
  await equip('wildwarden_crown');
  assert(head.isEnabled() && attachmentsVisible(true), 'Remote crown restores the head and cosmetics');
  await equip('');
  assert(head.isEnabled() && attachmentsVisible(true), 'Remote removal restores body and cosmetics');
  scene.dispose();
}

// The 63-bone web body needs the web fit of EVERY female set, and only of those: the file list comes from the registry.
{
  const bodyOf = (count: number, first: string) => ({ bones: Array.from({ length: count }, (_, i) => ({ name: i === 0 ? first : `bone${i}` })) }) as unknown as Skeleton;
  const web = bodyOf(63, 'UpperLeg_L'), legacy = bodyOf(51, 'L_Thigh'), male = bodyOf(71, 'UpperLeg_L');
  for (const set of equipmentSetCatalog().sets) for (const part of set.parts) {
    const file = part.model.replace(/\.glb$/, ''), preview = part.previewModel.replace(/\.glb$/, '');
    assert.equal(armorFileForSkeleton(file, web), preview, `${part.itemId}: web body`);
    assert.equal(armorFileForSkeleton(file, legacy), file, `${part.itemId}: 51-bone body keeps the game file`);
    assert.equal(armorFileForSkeleton(file, male), file, `${part.itemId}: male body keeps the game file`);
    assert.equal(armorFileForSkeleton(file, null), file, `${part.itemId}: no body yet`);
  }
  for (const family of ['plainhide', 'gravethorn', 'crowshade', 'seidraven', 'emberrage']) {
    assert.equal(armorFileForSkeleton(`${family}/${family}_female_vest`, web), `armor/${family}/${family}_female_vest`, family);
    assert.equal(armorFileForSkeleton(`${family}/${family}_male_vest`, web), `${family}/${family}_male_vest`, `${family}: male files never move`);
  }
  assert.equal(armorFileForSkeleton('armor/plainhide/plainhide_female_vest', web), 'armor/plainhide/plainhide_female_vest', 'already a web file');
  assert.equal(armorFileForSkeleton('R_LederBH', web), 'R_LederBH', 'the old leather pieces have no web fit');
}

// The 51-bone game figure is one mesh; Plainhide (eight regions) must leave head and hands visible and unmasked.
{
  const scene = new Scene(engine);
  const REGIONS = ['Head', 'Torso', 'Hips', 'ArmUpperLeft', 'ArmUpperRight', 'ArmLowerLeft', 'ArmLowerRight', 'HandLeft', 'HandRight', 'LegLeft', 'LegRight'];
  const BONE_OF: Record<string, string> = { Head: 'Head', Torso: 'Spine01', Hips: 'Hips', ArmUpperLeft: 'L_Upperarm', ArmUpperRight: 'R_Upperarm',
    ArmLowerLeft: 'L_Forearm', ArmLowerRight: 'R_Forearm', HandLeft: 'L_Hand', HandRight: 'R_Hand', LegLeft: 'L_Calf', LegRight: 'R_Calf' };
  const skeleton = new Skeleton('legacy', 'legacy', scene);
  const bones = ['Root', 'L_Thigh', ...REGIONS.map(region => BONE_OF[region]!)].map(name => new Bone(name, skeleton));
  const body = new Mesh('Chr_Wikingerin_Body', scene);
  // One triangle per region, weighted fully to that region's bone: the mask sorts triangles by bone.
  const data = new VertexData();
  data.positions = REGIONS.flatMap((_, r) => [0, r, 0, 1, r, 0, 0, r, 1]);
  data.indices = REGIONS.flatMap((_, r) => [3 * r, 3 * r + 1, 3 * r + 2]);
  data.matricesIndices = REGIONS.flatMap(region => Array(3).fill([bones.findIndex(b => b.name === BONE_OF[region]), 0, 0, 0]).flat());
  data.matricesWeights = REGIONS.flatMap(() => Array(3).fill([1, 0, 0, 0]).flat());
  data.applyToMesh(body); body.skeleton = skeleton;
  for (const region of REGIONS) assert.equal(legacyFemaleRegionForBone(BONE_OF[region]!), region, `test body: ${region} bone`);
  prepareLegacyFemaleBody([body], 'wikingerin');
  const visible = () => {
    const indices = body.getIndices()!;
    return REGIONS.filter((_, r) => Array.from(indices).some(i => Math.floor(i / 3) === r));
  };
  const plainhide = ['shoulders', 'vest', 'bracers', 'robe', 'boots'].map(key => `plainhide/plainhide_female_${key}`);
  updateArmorVisibility([body], plainhide);
  assert.deepEqual(visible().sort(), [...PLAINHIDE_FREE_REGIONS].sort(), 'Plainhide masks eight regions and leaves head and hands');
  assert(body.isEnabled(), 'the body mesh stays on for the free regions');
  const each: Record<string, string[]> = { shoulders: ['ArmUpperLeft', 'ArmUpperRight'], vest: ['Torso'], bracers: ['ArmLowerLeft', 'ArmLowerRight'], robe: ['Hips'], boots: ['LegLeft', 'LegRight'] };
  for (const [key, regions] of Object.entries(each)) {
    updateArmorVisibility([body], [`plainhide/plainhide_female_${key}`]);
    assert.deepEqual(REGIONS.filter(region => !visible().includes(region)).sort(), [...regions].sort(), `plainhide ${key} hides only its regions`);
  }
  // A full Gravethorn set covers the whole figure, so the mesh is switched off; unequipping restores every triangle.
  updateArmorVisibility([body], ['hood', 'vest', 'robe', 'shoulders', 'bracers', 'gloves', 'boots'].map(key => `gravethorn/gravethorn_female_${key}`));
  assert.equal(visible().length, 0); assert(!body.isEnabled());
  updateArmorVisibility([body], []);
  assert.equal(visible().length, REGIONS.length); assert(body.isEnabled());
  // Crowshade (seven pieces, all eleven regions) is masked on the 51-bone figure like Gravethorn; without the mask the head stays.
  const crowshade = ['hood', 'vest', 'robe', 'shoulders', 'bracers', 'gloves', 'boots'].map(key => `crowshade/crowshade_female_${key}`);
  updateArmorVisibility([body], crowshade);
  assert.equal(visible().length, 0, 'Crowshade masks every region of the 51-bone figure'); assert(!body.isEnabled());
  updateArmorVisibility([body], crowshade.filter(file => !file.endsWith('_hood')));
  assert.deepEqual(visible(), ['Head'], 'without the mask only the head stays visible');
  updateArmorVisibility([body], []);
  assert.equal(visible().length, REGIONS.length);
  scene.dispose();
}
engine.dispose();

// F1: bodyRegionOfMeshName (client/src/player/bodyRegions.ts) is the same regex updateArmorVisibility always used, only
// pulled out into a pure, exported function so the armor tools read a body mesh's region the same way. This is a parity
// witness for that extraction (same mesh names in, same region out), not a new behavior: OLD_PATTERN is the regex as it
// stood inline in armorVisibility.ts before this change.
const OLD_PATTERN = /(?:Chr_|WoV_BodyBase_(?:Male|Female)_)(Head|Torso|Hips|ArmUpperLeft|ArmUpperRight|ArmLowerLeft|ArmLowerRight|HandLeft|HandRight|LegLeft|LegRight)(?:_(?:Male|Female)_\d+)?(?:$|[. ])/;
// Every body mesh name of the three real bodies, read from the shipped GLBs on 22.09.2026. The 51-bone legacy body
// (assets/models/wikingerin/WikingerinKoerper.glb) is one monolithic mesh ("mesh_node") masked by bone weight, not by
// name, so it never names a region; the 71-bone male (assets/models/wikinger/WikingerKoerper.glb) and the 63-bone web
// female (wov-web/static/assets/models/wikingerin/WikingerinKoerper.glb) are both segmented, one mesh per region.
const REAL_BODY_MESH_REGION: Record<string, BodyRegion | undefined> = {
  Chr_ArmLowerLeft_Male_00: 'ArmLowerLeft', Chr_ArmLowerRight_Male_00: 'ArmLowerRight', Chr_ArmUpperLeft_Male_00: 'ArmUpperLeft',
  Chr_ArmUpperRight_Male_00: 'ArmUpperRight', Chr_HandLeft_Male_00: 'HandLeft', Chr_HandRight_Male_00: 'HandRight',
  Chr_Head_Male_00: 'Head', Chr_Hips_Male_00: 'Hips', Chr_LegLeft_Male_00: 'LegLeft', Chr_LegRight_Male_00: 'LegRight', Chr_Torso_Male_00: 'Torso',
  Chr_ArmLowerLeft_Female_00: 'ArmLowerLeft', Chr_ArmLowerRight_Female_00: 'ArmLowerRight', Chr_ArmUpperLeft_Female_00: 'ArmUpperLeft',
  Chr_ArmUpperRight_Female_00: 'ArmUpperRight', Chr_HandLeft_Female_00: 'HandLeft', Chr_HandRight_Female_00: 'HandRight',
  Chr_Head_Female_00: 'Head', Chr_Hips_Female_00: 'Hips', Chr_LegLeft_Female_00: 'LegLeft', Chr_LegRight_Female_00: 'LegRight', Chr_Torso_Female_00: 'Torso',
  mesh_node: undefined,
};
for (const [name, region] of Object.entries(REAL_BODY_MESH_REGION)) {
  assert.equal(bodyRegionOfMeshName(name), region, `real body mesh ${name}: expected region`);
  assert.equal(bodyRegionOfMeshName(name), OLD_PATTERN.exec(name)?.[1], `real body mesh ${name}: same result before and after the extraction`);
}
// Astra's two alias fixtures: a mesh named for one region and merely ending in another region's word (a free hand
// called "... Head", or the case Nachbesserung 2 already caught, a torso called "... Head") must resolve to the region
// it is actually named for, from the anchored prefix, never to the trailing word alone.
for (const [name, region] of [['Chr_Torso_Female_00 Head', 'Torso'], ['Chr_HandLeft_Female_00 Head', 'HandLeft']] as const) {
  assert.equal(bodyRegionOfMeshName(name), region, `alias fixture ${name}: expected region`);
  assert.equal(bodyRegionOfMeshName(name), OLD_PATTERN.exec(name)?.[1], `alias fixture ${name}: same result before and after the extraction`);
}
console.log('PASS item policies, saved inventory, mixed items, all 4 rendering paths, delayed/failed loads, restoration and hair compatibility, the web-body file of every female set, the eight-region Plainhide mask and the shared body-region parser on all three real bodies and both alias fixtures');
