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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { BEUTE_PREFAB, BEUTE_RUECKFALL_MODELL, BEUTE_RUECKFALL_SKALA, getStableHash } from '@wov/shared';
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
pruefe(nah(10, 13) === null, 'exactly 3 m is out (strict, like the static search)');
pruefe(nah(10, 12.99) !== null, 'just inside 3 m (2.99) is in');

setze('1:2', BEUTE_PREFAB, 11, 2, 10);
const b = nah(11.2, 10);
pruefe(b?.prefab === BEUTE_PREFAB && b.prefabHash === getStableHash(BEUTE_PREFAB), 'the neutral loot prefab is a target, too', JSON.stringify(b));
pruefe(nah(10.1, 10)?.prefab === 'RawMeat', 'the nearer of two pieces wins');

setze('1:3', 'Pickable_Flint', 10.2, 0, 10); // static, nearer than the loot
pruefe(nah(10.2, 10.1)?.prefab === 'Pickable_Flint', 'a nearer static pickable still wins over loot');
pruefe(nah(9.9, 10)?.prefab === 'RawMeat', 'a nearer loot piece wins over a static pickable');
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

// B2 (N1): the same key gets a prefab that is no loot (or none the client knows): the old piece of loot is forgotten.
setze('3:1', 'RawMeat', 200, 0, 200);
pruefe(nah(200, 200)?.prefab === 'RawMeat', 'B2 setup: a piece of loot at 200/200');
setze('3:1', 'Wolf', 200, 0, 200);
pruefe(nah(200, 200) === null, 'B2: the same key now a Wolf -> the old loot target is gone', JSON.stringify(nah(200, 200)));
setze('3:2', 'RawMeat', 210, 0, 200);
mgr.applyUpdate({ key: '3:2', prefabHash: 0x12345, position: { x: 210, y: 0, z: 200 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, isOwnPlayer: false });
pruefe(nah(210, 200) === null, 'B2: the same key now an unknown prefab -> the old loot target is gone');

// B1 (N1): a change of world drops the loot targets; a ZDO of the same key in the new world with another prefab is no target.
setze('4:1', 'RawMeat', 300, 0, 300);
mgr.teleportiert(false, '');
pruefe(nah(300, 300)?.prefab === 'RawMeat', 'B1: a teleport inside the overworld keeps the loot (the server does not send it again)');
mgr.teleportiert(true, 'grab1');
pruefe(nah(300, 300) === null, 'B1: overworld -> dungeon: the loot target of the old world is gone');
setze('4:1', 'Wolf', 300, 0, 300);
pruefe(nah(300, 300) === null, 'B1: the same key in the new world with another prefab is no target');
setze('4:2', 'Wood', 301, 0, 300);
mgr.teleportiert(true, 'grab1');
pruefe(nah(301, 300)?.prefab === 'Wood', 'B1: a teleport inside the same dungeon keeps the loot');
mgr.teleportiert(true, 'grab2');
pruefe(nah(301, 300) === null, 'B1: dungeon -> another dungeon: dropped');
setze('4:3', 'Wood', 302, 0, 300);
mgr.teleportiert(false, '');
pruefe(nah(302, 300) === null, 'B1: dungeon -> overworld: dropped');
mgr.teleportiert(true, '');
setze('4:4', 'Wood', 303, 0, 300);
mgr.teleportiert(false, '');
pruefe(nah(303, 300) === null, 'B1: a dungeon with an empty id is not the overworld');

// B3 (N1): the height. The server checks the horizontal distance only (WovServer.ts handleInteract: dx/dz against the
// player, dz/dx of getZDOsInRadius; no y anywhere), and so do all static targets of `naechstesInteragierbares`.
// Loot follows the same rule: 3 m above or below is as much a target as a static pickable at that height.
setze('5:1', 'RawMeat', 400, 3, 400);
setze('5:2', 'Pickable_Flint', 410, 3, 400);
pruefe(nah(400, 400)?.prefab === 'RawMeat' && nah(410, 400)?.prefab === 'Pickable_Flint', 'B3: loot and static pickable 3 m above the player are both targets (no height test, like the server)');
setze('5:3', 'RawMeat', 420, -3, 400);
pruefe(nah(420, 400)?.prefab === 'RawMeat', 'B3: loot 3 m below the player is a target, too');
// chest and loot together: the common rule is "the horizontal distance decides, a tie goes to the static one (strict <)".
setze('6:1', 'HolzTruhe', 500, 0, 500);
setze('6:2', 'RawMeat', 501.5, 0, 500);
pruefe(nah(500.5, 500)?.prefab === 'HolzTruhe', 'B3: chest nearer than loot -> chest');
pruefe(nah(501.2, 500)?.prefab === 'RawMeat', 'B3: loot nearer than chest -> loot');
pruefe(nah(500.75, 500)?.prefab === 'HolzTruhe', 'B3: an exact tie goes to the static target (the common strict < rule)');

// The wiring in main.ts on the syntax tree: `entities?.teleportiert(drin, dungeonId)` inside the Teleport handler.
{
  const quelle = readFileSync(resolve(import.meta.dirname, '../src/main.ts'), 'utf8');
  const baum = ts.createSourceFile('main.ts', quelle, ts.ScriptTarget.Latest, true);
  const treffer: ts.CallExpression[] = [];
  const geh = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'entities?.teleportiert') treffer.push(n);
    ts.forEachChild(n, geh);
  };
  geh(baum);
  pruefe(treffer.length === 1, 'main.ts calls entities.teleportiert exactly once', String(treffer.length));
  const t = treffer[0];
  pruefe(!!t && t.arguments.length === 2 && t.arguments[0]!.getText(baum) === 'drin' && t.arguments[1]!.getText(baum) === 'dungeonId', 'it hands over `drin` and `dungeonId` unchanged');
  let handler = false;
  for (let n: ts.Node | undefined = t; n; n = n.parent) {
    if (ts.isCallExpression(n) && n.expression.getText(baum) === 'socket.on' && n.arguments[0]?.getText(baum) === 'PacketType.Teleport') handler = true;
  }
  pruefe(handler, 'and the call sits inside the PacketType.Teleport handler');
}

// The drawing: which model the client asks for and at what scale (a real scene on the NullEngine, the model "loads" at once).
const engine = new NullEngine();
const scene = new Scene(engine);
const geladen: string[] = [];
const assets2 = {
  instantiate: (modell: string) => { geladen.push(modell); return Promise.resolve(new TransformNode(`m_${modell}`, scene)); },
  entsorgeAnimationen: () => {},
  getMasters: nie, getKollisionsMasters: nie,
};
const mgr2 = new EntityManager(scene, null as never, assets2 as never, null as never);
const upd = (key: string, prefab: string, scale?: number): void =>
  mgr2.applyUpdate({ key, prefabHash: getStableHash(prefab), position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale, isOwnPlayer: false });
upd('2:1', 'RawMeat');
upd('2:2', BEUTE_PREFAB);
upd('2:3', 'Wolf');
await new Promise((r) => setTimeout(r, 20));
pruefe(geladen.includes(BEUTE_RUECKFALL_MODELL) && !geladen.includes('RawMeat') && !geladen.includes(BEUTE_PREFAB), 'loot asks for the fallback chest, not for its own (missing) model', geladen.join(','));
pruefe(geladen.filter((m) => m === BEUTE_RUECKFALL_MODELL).length === 2 && geladen.includes('Wolf'), 'both loot pieces use the chest, the wolf its own model', geladen.join(','));
const wurzeln = scene.transformNodes.filter((n) => n.name === 'RawMeat' || n.name === BEUTE_PREFAB || n.name === 'Wolf');
/** The scale of the entity named `n` if it is the same on all three axes, else NaN. */
const sk = (n: string): number => {
  const v = wurzeln.find((w) => w.name === n)?.scaling;
  return v && v.x === v.y && v.y === v.z ? v.x : NaN;
};
pruefe(wurzeln.length === 3, 'three entities in the scene (named after their prefab)', wurzeln.map((w) => w.name).join(','));
pruefe(Math.abs(sk('RawMeat') - BEUTE_RUECKFALL_SKALA) < 1e-6 && Math.abs(sk(BEUTE_PREFAB) - BEUTE_RUECKFALL_SKALA) < 1e-6, 'the chest is drawn small', `${sk('RawMeat')} / ${sk(BEUTE_PREFAB)}`);
pruefe(sk('Wolf') === 1, 'a creature is not scaled by the loot rule', String(sk('Wolf')));
upd('2:1', 'RawMeat', 2);
pruefe(Math.abs(sk('RawMeat') - 2 * BEUTE_RUECKFALL_SKALA) < 1e-6, 'a ZDO scale multiplies with the chest scale', String(sk('RawMeat')));

console.log(fehler === 0 ? '\nd5-beute-ziel: OK' : `\nd5-beute-ziel: ${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
