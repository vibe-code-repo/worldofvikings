/**
 * fps-analyse #9 — Animations-LOD, die VERDRAHTUNG im EntityManager.
 *
 * `client/test/animations-lod.ts` prueft die reine Regel
 * (animationsLod.ts) gegen erfundene Gruppen und eine echte
 * Babylon-AnimationGroup — aber nicht, ob `EntityManager.updateDynamics()`
 * sie ueberhaupt mit den richtigen Werten aufruft: echtes Kamera-Frustum,
 * echte Distanz, und die drei Ausnahmen aus der Karte ("Spieler, NPCs im
 * Kampf und die eigene Figur laufen immer"). Genau das prueft diese Datei,
 * an den echten Produktivklassen `EntityManager`/`AssetManager` (wie
 * client/test/kollisionsnetz.ts: nur der Ladeweg — SceneLoader/HTTP — ist
 * ersetzt, alles danach ist Produktivcode).
 *
 *  [1] Eine NICHT-Spieler-Figur weit hinter der Kamera (ausserhalb des
 *      Sichtkegels UND jenseits von 60 m) pausiert ihre Animationsgruppe.
 *  [2] Kehrt sie ins Bild zurueck, laeuft die GEMERKTE Gruppe an ihrem
 *      Bild weiter (kein Sprung auf 0).
 *  [3] Eine Figur mit Prefab `Player` (fremder Mitspieler) bleibt an
 *      DERSELBEN Stelle animiert — die Karte nimmt Spieler ausdruecklich
 *      von der Pause aus.
 *  [4] Eine NPC-Figur im Kampfzustand (`anim: 'attack'`) bleibt ebenfalls
 *      animiert, obwohl sie ausserhalb des Sichtkegels steht.
 *
 * Lauf: npx tsx client/test/animations-lod-wiring.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';

import type { ZDOEntityUpdate } from '../src/net/ZDOSync';
import { AssetManager } from '../src/engine/AssetManager';
import { EntityManager } from '../src/entities/EntityManager';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) {
    console.log(`  OK   ${was}`);
  } else {
    fehler++;
    console.error(`  ROT  ${was}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);
// Kamera bei (0,0,0), Blick auf +Z — der eine "nahe, im Bild"-Punkt liegt
// vor ihr, der "weit, hinter ihr"-Punkt liegt HINTER der Kamera und damit
// sicher ausserhalb jedes Sichtkegels, egal wie breit dessen Oeffnung ist.
const kamera = new FreeCamera('kamera', Vector3.Zero(), scene);
kamera.setTarget(new Vector3(0, 0, 1));
kamera.minZ = 0.1;
kamera.maxZ = 500;
scene.activeCamera = kamera;
// Wie im echten Bild: die Frustum-Ebenen haengen an view*proj, die Babylon
// erst bei einer dieser beiden Abfragen wirklich neu rechnet.
kamera.getViewMatrix(true);
kamera.getProjectionMatrix(true);

/** Wuerfel mit echter Geometrie — ohne sichtbares Mesh verwirft instantiate() die Instanz. */
function wuerfel(name: string): Mesh {
  const m = new Mesh(name, scene);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-0.2, 0.2]) for (const y of [-0.2, 0.2]) for (const z of [-0.2, 0.2]) p.push(x, y, z);
  d.positions = p;
  d.indices = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  d.applyToMesh(m);
  return m;
}

/**
 * Container mit einer Animationsgruppe "idle" vortaeuschen — der einzige
 * Ersatz ist der Ladeweg (SceneLoader/HTTP), alles danach (instantiate(),
 * starteAnfangsgruppe(), animGruppen-Zuordnung) ist Produktivcode.
 */
function stelleContainerBereit(assets: AssetManager, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const koerper = wuerfel(`${name}_koerper`);
  koerper.parent = wurzel;
  const anim = new Animation('idle-clip', 'position.y', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 100, value: 1 },
  ]);
  koerper.animations.push(anim);
  const gruppe = new AnimationGroup('idle', scene);
  gruppe.addTargetedAnimation(anim, koerper);
  const container = new AssetContainer(scene);
  container.meshes.push(koerper);
  container.transformNodes.push(wurzel);
  container.animationGroups.push(gruppe);
  container.removeAllFromScene();
  (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set(
    name,
    Promise.resolve(container)
  );
}

const assets = new AssetManager(scene);
stelleContainerBereit(assets, 'npcModell');
stelleContainerBereit(assets, 'spielerModell');

const mgr = new EntityManager(scene, null as never, assets, null as never);
const anlegen = (
  key: string,
  prefabName: string,
  model: string,
  pos: Vector3,
  anim: string
): Promise<void> =>
  (
    mgr as unknown as {
      applyDynamic: (u: ZDOEntityUpdate, p: string, m: string | null, a?: string, belebt?: boolean) => Promise<void>;
    }
  ).applyDynamic(
    {
      key,
      prefabHash: 0,
      position: pos,
      rotation: Quaternion.Identity(),
      isOwnPlayer: false,
      anim,
    },
    prefabName,
    model,
    anim
  );

const wurzelVon = (key: string): TransformNode =>
  (mgr as unknown as { dynamics: Map<string, { root: TransformNode }> }).dynamics.get(key)!.root;

await anlegen('npc:nah', 'TestNpc', 'npcModell', new Vector3(0, 0, 5), 'idle');
await anlegen('npc:fern', 'TestNpc', 'npcModell', new Vector3(0, 0, -80), 'idle');
await anlegen('spieler:fern', 'Player', 'spielerModell', new Vector3(0, 0, -80), 'idle');
await anlegen('npc:kampf-fern', 'TestNpc', 'npcModell', new Vector3(0, 0, -80), 'attack');

const spieltNoch = (key: string): boolean => assets.gruppenVon(wurzelVon(key)).some((g) => g.isPlaying);

console.log('\n[0] Vorbereitung: alle vier Instanzen animieren beim Erscheinen');
pruefe(spieltNoch('npc:nah'), 'nahe NPC-Figur spielt von Anfang an');
pruefe(spieltNoch('npc:fern'), 'ferne NPC-Figur spielt von Anfang an');
pruefe(spieltNoch('spieler:fern'), 'ferne Spielerfigur spielt von Anfang an');
pruefe(spieltNoch('npc:kampf-fern'), 'ferne kaempfende NPC-Figur spielt von Anfang an');

mgr.updateDynamics(0.016);

console.log('\n[1] Ausserhalb von Sichtkegel und 60-m-Grenze pausiert eine NPC-Figur');
pruefe(spieltNoch('npc:nah'), 'nahe, sichtbare NPC-Figur laeuft unveraendert weiter');
pruefe(!spieltNoch('npc:fern'), 'ferne, unsichtbare NPC-Figur wurde pausiert');

console.log('\n[3] Ein fremder Spieler (Prefab "Player") laeuft immer, auch an derselben fernen Stelle');
pruefe(spieltNoch('spieler:fern'), 'ferne Spielerfigur wurde NICHT pausiert (Karte: "Spieler ... laufen immer")');

console.log('\n[4] Eine kaempfende NPC-Figur laeuft immer, auch ausserhalb des Sichtkegels');
pruefe(spieltNoch('npc:kampf-fern'), 'kaempfende ferne NPC-Figur wurde NICHT pausiert');

console.log('\n[2] Rueckkehr ins Bild: die pausierte NPC-Figur laeuft ohne Sprung weiter');
const fernerRoot = wurzelVon('npc:fern');
const gruppeVorher = assets.gruppenVon(fernerRoot)[0]!;
// Bild vor der Pause merken (goToFrame verschiebt sie nicht, sie steht seit
// dem Start bei Bild 0 — der eigentliche Beleg ist "kein Reset auf 0" nach
// einer Pause auf einem SPAETEREN Bild, deshalb hier erst hinspulen).
gruppeVorher.goToFrame(37);
pruefe(Math.abs(gruppeVorher.animatables[0]!.masterFrame - 37) < 1e-6, 'Vorbereitung: Figur steht auf Bild 37');
// Zurueck ins Bild versetzen und erneut aktualisieren.
fernerRoot.position.copyFromFloats(0, 0, 5);
mgr.updateDynamics(0.016);
pruefe(spieltNoch('npc:fern'), 'die zurueckgekehrte Figur animiert wieder');
pruefe(
  Math.abs(gruppeVorher.animatables[0]!.masterFrame - 37) < 1e-6,
  `kein Sprung auf Bild 0 — Bild ist ${gruppeVorher.animatables[0]?.masterFrame}`
);

scene.dispose();
engine.dispose();

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} FAILED`);
process.exit(fehler === 0 ? 0 : 1);
