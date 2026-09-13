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
import { hiddenAppearance, hiddenAppearanceForFiles, equipmentSetCatalog, findItem, Inventory,
  encodeArmor, frisurMitGesicht, AUGENBRAUEN } from '@wov/shared';

const all = ['hair', 'beard', 'eyebrows'];
assert.deepEqual([...hiddenAppearance([{}])], []);
assert.deepEqual([...hiddenAppearance([{ hideAppearance: ['hair'] }, { hideAppearance: ['beard'] }])], ['hair', 'beard']);
assert.deepEqual([...hiddenAppearanceForFiles(['wildwarden/wildwarden_crown'])], []);
assert.deepEqual([...hiddenAppearanceForFiles(['ashenveil/ashenveil_hood'])], all);
assert.deepEqual([...hiddenAppearanceForFiles(['wildwarden/wildwarden_robe', 'ironward/IronwardHelmet'])], all);
assert.deepEqual([...hiddenAppearanceForFiles(['missing/helmet'])], []);
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
  const crown = CreateBox('WoV_Wildwarden_Head', {}, scene);
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
  assert(!head.isEnabled(), kind + ': crown still replaces the head');
  assert(cosmetics.every(mesh => mesh.isEnabled()), kind + ': crown keeps all selected cosmetics');
  selected.set('kopf', hoodFile); refresh();
  assert(head.isEnabled() && cosmetics.every(mesh => mesh.isEnabled()), kind + ': unloaded/failed hood hides nothing');
  meshes.set(hoodFile, [hood]); loaded.set(hoodFile, { netze: [hood] }); refresh();
  assert(!head.isEnabled() && cosmetics.every(mesh => !mesh.isEnabled()), kind + ': loaded hood hides all');
  cosmetics[0].setEnabled(true); refresh();
  assert(!cosmetics[0].isEnabled(), kind + ': late hair load respects the hood');
  selected.set('kopf', crownFile); refresh();
  assert(cosmetics.every(mesh => mesh.isEnabled()), kind + ': hood to crown restores cosmetics');
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
  assert(!head.isEnabled() && attachmentsVisible(true), 'Remote crown keeps all cosmetics');
  await equip('ashenveil_hood');
  assert(!head.isEnabled() && attachmentsVisible(false), 'Remote hood hides all cosmetics');
  await equip('wildwarden_crown');
  assert(attachmentsVisible(true), 'Remote crown restores cosmetics');
  await equip('');
  assert(head.isEnabled() && attachmentsVisible(true), 'Remote removal restores body and cosmetics');
  scene.dispose();
}
engine.dispose();
console.log('PASS item policies, saved inventory, mixed items, all 4 rendering paths, delayed/failed loads, restoration and hair compatibility');
