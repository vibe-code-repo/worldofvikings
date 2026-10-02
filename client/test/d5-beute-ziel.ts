/**
 * D5 — E must find loot on the ground, with or without its model.
 *
 * Fault (DEV 02.10.2026): `ITEM_DROP` prefabs are dynamic entities, their scene node exists only after the model has loaded,
 * and `naechstesInteragierbares` walked the static buckets only. A piece of loot was never a target of E.
 *
 * The EntityManager here has an asset manager whose `instantiate` NEVER answers: the model is "not loaded", the entity
 * never reaches `dynamics`. The loot must be aimable all the same.
 *
 * Run: npx tsx client/test/d5-beute-ziel.ts   (from the repo root)
 */
import { BEUTE_PREFAB, getStableHash } from '@wov/shared';
import { EntityManager } from '../src/entities/EntityManager';
import type { ZDOEntityUpdate } from '../src/net/ZDOSync';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string, detail = ''): void => {
  console.log(`  ${bedingung ? 'PASS' : 'FAIL'}  ${text}${detail ? ' — ' + detail : ''}`);
  if (!bedingung) fehler++;
};

let instanziiert = 0;
const nie = () => new Promise<never>(() => {});
const assets = { instantiate: () => { instanziiert++; return nie(); }, getMasters: nie, getKollisionsMasters: nie };
const mgr = new EntityManager(null as never, null as never, assets as never, null as never);

function setze(key: string, prefab: string, x: number, y: number, z: number): void {
  const u: ZDOEntityUpdate = { key, prefabHash: getStableHash(prefab), position: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 }, isOwnPlayer: false };
  mgr.applyUpdate(u);
}
const nah = (x: number, z: number, r = 3) => mgr.naechstesInteragierbares(x, z, r);

setze('1:1', 'RawMeat', 10, 2, 10);
pruefe(instanziiert === 1, 'the model was asked for and never answered (entity not in the scene)', String(instanziiert));
const a = nah(10.5, 10.5);
pruefe(a?.prefab === 'RawMeat' && a.prefabHash === getStableHash('RawMeat') && a.x === 10 && a.y === 2 && a.z === 10, 'RawMeat is the target of E without a loaded model', JSON.stringify(a));
pruefe(nah(10, 14) === null, 'out of reach (4 m, radius 3): no target');
pruefe(nah(10, 12.9) !== null && nah(10, 13.1) === null, 'the radius edge is 3 m');

setze('1:2', BEUTE_PREFAB, 11, 2, 10);
const b = nah(11.2, 10);
pruefe(b?.prefab === BEUTE_PREFAB && b.prefabHash === getStableHash(BEUTE_PREFAB), 'the neutral loot prefab is a target, too', JSON.stringify(b));
pruefe(nah(10.1, 10)?.prefab === 'RawMeat', 'the nearer of two pieces wins');

setze('1:3', 'Pickable_Flint', 10.2, 0, 10); // static, nearer than the loot
pruefe(nah(10.2, 10.1)?.prefab === 'Pickable_Flint', 'a nearer static pickable still wins over loot');
setze('1:4', 'Pickable_Flint', 20, 0, 20);
pruefe(nah(10.5, 10.5, 3)?.prefab !== undefined, 'static and loot share one search');

setze('1:5', 'Wolf', 30, 0, 30);
pruefe(nah(30, 30) === null, 'a living creature is not a target of E');

mgr.removeZDO('1:1');
pruefe(nah(10.01, 10)?.prefab !== 'RawMeat', 'a removed piece is forgotten (picked up / expired)');
mgr.removeZDO('1:2');
mgr.removeZDO('1:3');
pruefe(nah(10, 10) === null, 'nothing left: no target');

// a moved piece (physics) is aimed at its new place
setze('1:6', 'Wood', 50, 0, 50);
setze('1:6', 'Wood', 52, 0, 50);
pruefe(nah(50, 50, 1) === null && nah(52, 50, 1)?.prefab === 'Wood', 'an update moves the target');

console.log(fehler === 0 ? '\nd5-beute-ziel: OK' : `\nd5-beute-ziel: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
