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
 * Nachbesserung (Angriff 27.09.2026, B4–B6, B5-Testluecke):
 *  [5] Die Spawn-Vorschau im Editor-Testflug (`edplace-*`/`edghost`) friert
 *      nie ein, egal wie weit oder ausserhalb des Sichtkegels.
 *  [6] Sichtprobe als Kugel um die Huellmitte statt als Punkt an der
 *      Fusssohle (B4): eine Figur, deren Fusssohle knapp ausserhalb des
 *      Sichtkegels liegt, deren Koerper aber hineinragt, friert NICHT ein.
 *  [P1]–[P4] Aus `Berichte/angriff-fps-animation-einfrieren/
 *      probe-lod-fortsetzen.ts` uebernommene Faelle (B1–B3): Kampfbeginn
 *      ausser Sicht (P1), Einmal-Clips `hit`/`die` ausser Sicht gestartet
 *      und ins Bild zurueckgekehrt (P2/P3), Zustandswechsel im selben Bild
 *      wie die Rueckkehr (P4). Auf 0484f3d alle vier rot.
 *  [7]+[8] Die Verdrahtung mit einer Kamera AUSSERHALB des Ursprungs
 *      (B5-Testluecke: mit Kamera im Ursprung ueberleben die Mutanten
 *      M7/M8/M11, weil "Distanz vom Ursprung" und "Distanz von der
 *      Kamera" sowie "echte Kameraposition" und "Ursprung" dort
 *      zusammenfallen): [7] nah, aber hinter der Kamera; [8] im
 *      Sichtkegel, aber jenseits von 60 m.
 *
 * Nachbesserung N2 (Nachangriff, Befund A3 — 6 ueberlebende Mutanten aus
 * `Berichte/angriff-fps-animation-einfrieren-n1/mutationen-n1.sh`):
 *  [9]  A2 an der Verdrahtung (probe-n1.ts N1/N2): ein Tod auf 70 m oder
 *       hinter der Kamera endet nach ca. 1 s, statt mitten im Clip stehen
 *       zu bleiben.
 *  [10] N-M1 (probe-n1b.ts G1): ein Modell OHNE "idle"-Clip (wie
 *       npc_1_walk.glb) — wechsleAnimation() stoppt die pausierte
 *       walk-Gruppe komplett, OHNE etwas zu starten; der isStarted-
 *       Waechter darf sie beim Rueckkehren nicht wieder anlaufen lassen.
 *  [11] N-M13 (probe-n1b.ts G2): idle pausiert, dann Server-Zustand
 *       `attack` — das Fortsetzen im attack-Zweig darf nicht fehlen, sonst
 *       bleibt die Figur bis zum ersten Schlag starr.
 *  [12] N-M6+N-M7: ein winziger Wuerfel knapp ausserhalb der reinen
 *       Sichtlinie — ohne Mindestradius (M6) oder mit ignoriertem Radius
 *       im Vergleich (M7) wuerde er faelschlich einfrieren.
 *  [13] N-M8+N-M9: ein kleiner Wuerfel, dessen Netz 3,2 m ueber der Wurzel
 *       SCHWEBT — die GEMESSENE Huellmitte liegt im Sichtkegel, waehrend
 *       die Wurzel selbst weit ausserhalb liegt — ohne Mittelhoehe (M8)
 *       oder ohne jemals gemessene Huelle (M9, Rueckfall 0,9 m) friert er
 *       ein.
 *
 * [9]–[13] nutzen `frustumAbstand`/`sucheYFuerAbstand` NUR zum Platzieren
 * der Proben (Babylon-Frustumebenen sind normiert, der Abstand ist echte
 * Meter) — nicht als Nachbau der geprueften Regel selbst.
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
import { Frustum } from '@babylonjs/core/Maths/math.frustum';

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
scene.useConstantAnimationDeltaTime = true; // 16 ms je render(), fuer die P1–P4-Faelle unten
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

/**
 * Menschengrosser Quader (0,5 × 1,8 × 0,5 m), Fuesse bei lokal y=0 — fuer
 * [6]/B4: eine echte Huelle, deren Mitte (`berechneLodHuelle`) spuerbar
 * ueber der Fusssohle liegt.
 */
function wuerfelHoehe(name: string): Mesh {
  const m = new Mesh(name, scene);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-0.25, 0.25]) for (const y of [0, 1.8]) for (const z of [-0.25, 0.25]) p.push(x, y, z);
  d.positions = p;
  d.indices = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  d.applyToMesh(m);
  return m;
}

/** Wie `stelleContainerBereit`, aber mit der menschengrossen Huelle (B4/[6]). */
function stelleContainerBereitHoehe(assets: AssetManager, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const koerper = wuerfelHoehe(`${name}_koerper`);
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

/**
 * Container mit VIER Clips (idle/walk/hit/die) — wie ein Tier, das der
 * Server in Bewegung, im Kampf, getroffen oder sterbend zeigen kann (fuer
 * die aus `probe-lod-fortsetzen.ts` uebernommenen Faelle P1–P4 unten).
 * `hit`/`die` sind Einmal-Clips: 30 Bilder = 1 s bei 30 fps.
 */
function stelleTierBereit(assets: AssetManager, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const koerper = wuerfel(`${name}_koerper`);
  koerper.parent = wurzel;
  const container = new AssetContainer(scene);
  const eigenschaften = ['position.y', 'position.x', 'scaling.y', 'scaling.x'];
  ['idle', 'walk', 'hit', 'die'].forEach((clipName, i) => {
    const a = new Animation(`${clipName}-clip`, eigenschaften[i]!, 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
    a.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    const g = new AnimationGroup(clipName, scene);
    g.addTargetedAnimation(a, koerper);
    container.animationGroups.push(g);
  });
  container.meshes.push(koerper);
  container.transformNodes.push(wurzel);
  container.removeAllFromScene();
  (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set(
    name,
    Promise.resolve(container)
  );
}

/**
 * Wie `stelleTierBereit`, aber NUR mit einem "walk"-Clip (kein "idle") —
 * wie das echte `npc_1_walk.glb` fuer NPC_1/Player (A3/N-M1, probe-n1b.ts
 * G1): `wechsleAnimation()` findet auf einem Server-Zustandswechsel zu
 * 'idle' KEINE Zielgruppe und stoppt trotzdem ALLE Gruppen, auch die
 * gerade pausierte.
 */
function stelleNurWalkBereit(assets: AssetManager, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const koerper = wuerfel(`${name}_koerper`);
  koerper.parent = wurzel;
  const anim = new Animation('walk-clip', 'position.y', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: 1 },
  ]);
  const gruppe = new AnimationGroup('walk', scene);
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

/**
 * Kleiner (0,4 m) Wuerfel, dessen Geometrie lokal von y=3,0 bis y=3,4
 * SCHWEBT (die Wurzel selbst bleibt bei y=0) — A3/N-M8+N-M9: eine ECHTE
 * Huellmitte weit ueber der Wurzel (3,2 m), aber ein KLEINER Radius
 * (Mindestradius greift). Ein Tier-/NPC-Rig, dessen Wurzel am Boden sitzt
 * waehrend das Netz weiter oben haengt, waere strukturell aehnlich. Mit
 * einer schlanken SAEULE (Radius ≈ halbe Hoehe) liesse sich M8 nicht von
 * M9 trennen: der noetige Hoehenversatz waechst dort proportional zum
 * Radius selbst mit, ein hoeherer Turm macht die Kugel automatisch
 * gleich groesser mit.
 */
function stelleSchwebendBereit(assets: AssetManager, name: string): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  const m = new Mesh(`${name}_koerper`, scene);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-0.2, 0.2]) for (const y of [3.0, 3.4]) for (const z of [-0.2, 0.2]) p.push(x, y, z);
  d.positions = p;
  d.indices = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  d.applyToMesh(m);
  m.parent = wurzel;
  const anim = new Animation('idle-clip', 'position.y', 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: 0 },
    { frame: 100, value: 1 },
  ]);
  m.animations.push(anim);
  const gruppe = new AnimationGroup('idle', scene);
  gruppe.addTargetedAnimation(anim, m);
  const container = new AssetContainer(scene);
  container.meshes.push(m);
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
stelleContainerBereitHoehe(assets, 'menschModell');
stelleTierBereit(assets, 'tierModell');
stelleNurWalkBereit(assets, 'nurWalkModell');
stelleSchwebendBereit(assets, 'schwebendModell');

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

/** Wie `anlegen`, aber mit `animEinmal` — fuer die Einmal-Clip-Faelle P2/P3. */
const anlegenMitEinmal = (
  key: string,
  prefabName: string,
  model: string,
  pos: Vector3,
  anim: string,
  animEinmal?: string
): Promise<void> =>
  (
    mgr as unknown as {
      applyDynamic: (u: ZDOEntityUpdate, p: string, m: string | null, a?: string, belebt?: boolean) => Promise<void>;
    }
  ).applyDynamic(
    { key, prefabHash: 0, position: pos, rotation: Quaternion.Identity(), isOwnPlayer: false, anim, animEinmal } as ZDOEntityUpdate,
    prefabName,
    model,
    anim
  );

/** Figur hart versetzen (ohne Gleiten) — Wurzel UND das gemerkte Ziel, sonst zieht updateDynamics() sie im naechsten Bild wieder zurueck. */
function hartVersetzen(key: string, p: Vector3): void {
  const d = (mgr as unknown as { dynamics: Map<string, { root: TransformNode; ziel?: { pos: Vector3 } }> }).dynamics.get(key)!;
  d.root.position.copyFrom(p);
  if (d.ziel) d.ziel.pos.copyFrom(p);
}

function bilder(n: number): void {
  for (let i = 0; i < n; i++) {
    mgr.updateDynamics(0.016);
    scene.render();
  }
}

/**
 * Testhilfe fuer [12]/[13] (NICHT Teil der geprueften Regel): kleinster
 * Ebenenabstand (`Plane.dotCoordinate`) eines Punkts zu den AKTUELLEN
 * Frustum-Ebenen der `kamera` — negativ heisst "ausserhalb", der Betrag
 * ist der Abstand in Metern (Babylons `Frustum.GetPlanes` liefert
 * normierte Ebenen).
 */
function frustumAbstand(p: Vector3): number {
  const ebenen = Frustum.GetPlanes(kamera.getTransformationMatrix());
  return Math.min(...ebenen.map((e) => e.dotCoordinate(p)));
}

/**
 * Testhilfe (NICHT Teil der geprueften Regel): sucht per Bisektion ein y,
 * sodass der Punkt (0, y, z) einen `frustumAbstand` nahe `ziel` hat —
 * fuer y=0 klar innerhalb (auf der Blickachse), fuer y=60 klar ausserhalb
 * (obere Sichtkegel-Ebene).
 */
function sucheYFuerAbstand(z: number, ziel: number): number {
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 60; i++) {
    const mitte = (lo + hi) / 2;
    if (frustumAbstand(new Vector3(0, mitte, z)) > ziel) lo = mitte;
    else hi = mitte;
  }
  return (lo + hi) / 2;
}

/** Wie `sucheYFuerAbstand`, aber fuer die UNTERE Sichtkegel-Ebene (y=0 innen, y=-60 aussen). */
function sucheYFuerAbstandUnten(z: number, ziel: number): number {
  let lo = -60;
  let hi = 0;
  for (let i = 0; i < 60; i++) {
    const mitte = (lo + hi) / 2;
    if (frustumAbstand(new Vector3(0, mitte, z)) > ziel) hi = mitte;
    else lo = mitte;
  }
  return (lo + hi) / 2;
}

/** Namen der gerade spielenden Gruppen dieser Instanz, mit Schleifenmodus — der Beleg fuer "hoechstens EINE Dauergruppe" (P1/P4). */
const laufendeNamen = (key: string): string[] =>
  assets
    .gruppenVon(wurzelVon(key))
    .filter((g) => g.isPlaying)
    .map((g) => `${g.name}${g.loopAnimation ? '(loop)' : '(einmal)'}`);

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

console.log('\n[5] Editor-Vorschau (edplace-*/edghost) friert nie ein (B6)');
await anlegen('edplace-0', 'TestNpc', 'npcModell', new Vector3(0, 0, -80), 'idle');
await anlegen('edghost', 'TestNpc', 'npcModell', new Vector3(0, 0, -80), 'idle');
mgr.updateDynamics(0.016);
pruefe(spieltNoch('edplace-0'), '`edplace-0` (Testflug-Platzierung) laeuft weiter, obwohl weit hinter der Kamera');
pruefe(spieltNoch('edghost'), '`edghost` (Testflug-Geist) laeuft weiter, obwohl weit hinter der Kamera');

console.log('\n[6] Sichtprobe als Kugel um die Huellmitte statt als Punkt an der Fusssohle (B4)');
{
  // Kamera auf Augenhoehe (1,65 m), Blick LEVEL nach +Z, FOV 1,05 (wie
  // PlayerController) — eine 1,8 m grosse Figur direkt 1 m vor der Kamera:
  // die FUSSSOHLE (Wurzel) liegt ausserhalb des Sichtkegels (die untere
  // Ebene schneidet bei diesem Abstand ueber Bodenhoehe), der Koerper
  // ragt aber sichtbar hinein. Rechnerisch vorab geprueft
  // (.tmp-n1-experiment/experiment-b4.ts, nicht Teil dieses Commits):
  // Punkttest an der Sohle false, Kugeltest true.
  kamera.position.set(0, 1.65, 0);
  kamera.fov = 1.05;
  kamera.setTarget(new Vector3(0, 0, 5));
  kamera.getViewMatrix(true);
  kamera.getProjectionMatrix(true);
  await anlegen('mensch:nah-tief', 'TestMensch', 'menschModell', new Vector3(0, 0, 1), 'idle');
  pruefe(spieltNoch('mensch:nah-tief'), 'Vorbereitung: Figur animiert beim Erscheinen');
  mgr.updateDynamics(0.016);
  pruefe(
    spieltNoch('mensch:nah-tief'),
    'Figur direkt vor der Kamera friert NICHT ein — die Kugel um die Huellmitte reicht in den Sichtkegel, ' +
      'auch wenn die Fusssohle knapp ausserhalb liegt'
  );
  // Kamera fuer die folgenden Abschnitte zuruecksetzen.
  kamera.position.set(0, 0, 0);
  kamera.fov = 0.8;
  kamera.setTarget(new Vector3(0, 0, 1));
  kamera.getViewMatrix(true);
  kamera.getProjectionMatrix(true);
}

console.log('\n[P1] Kampfbeginn ausser Sicht (probe-lod-fortsetzen.ts P1): nie mehr als eine Dauergruppe (B2)');
{
  const HINTEN = new Vector3(0, 0, -20);
  const VORN = new Vector3(0, 0, 5);
  await anlegenMitEinmal('p1', 'Tier', 'tierModell', HINTEN, 'walk');
  bilder(3);
  pruefe(!spieltNoch('p1') || laufendeNamen('p1').join() === 'walk(loop)', 'nach 3 Bildern hinter der Kamera: walk pausiert oder unveraendert');
  await anlegenMitEinmal('p1', 'Tier', 'tierModell', HINTEN, 'attack');
  pruefe(laufendeNamen('p1').length === 1, `direkt nach Server-Zustand attack (vor der naechsten LOD-Aktualisierung): genau eine Gruppe, nicht ${JSON.stringify(laufendeNamen('p1'))}`);
  bilder(1);
  pruefe(laufendeNamen('p1').length === 1, `1 Bild spaeter: genau eine Gruppe (walk NICHT daneben wieder angelaufen), nicht ${JSON.stringify(laufendeNamen('p1'))}`);
  hartVersetzen('p1', VORN);
  bilder(30);
  pruefe(laufendeNamen('p1').length === 1, `30 Bilder spaeter, jetzt im Bild (5 m): weiterhin genau eine Gruppe, nicht ${JSON.stringify(laufendeNamen('p1'))}`);
}

console.log('\n[P2]+[P3] Einmal-Clip (hit/die) ausser Sicht gestartet, dann ins Bild (probe-lod-fortsetzen.ts P2/P3, B1; Pausier-Verhalten A2)');
{
  const HINTEN = new Vector3(0, 0, -20);
  const VORN = new Vector3(0, 0, 5);
  let marke = 0;
  async function einmalProbe(key: string, clip: string): Promise<{ schleifen: number; enden: number }> {
    await anlegenMitEinmal(key, 'Tier', 'tierModell', HINTEN, 'idle');
    bilder(2);
    await anlegenMitEinmal(key, 'Tier', 'tierModell', HINTEN, 'idle', `${clip}#${++marke}`);
    const gruppe = assets.gruppenVon(wurzelVon(key)).find((g) => g.name === clip)!;
    let schleifen = 0;
    let enden = 0;
    gruppe.onAnimationGroupLoopObservable.add(() => schleifen++);
    gruppe.onAnimationGroupEndObservable.add(() => enden++);
    bilder(10); // 0,16 s ausser Sicht -> A2: laeuft trotzdem unveraendert weiter (kein Pausieren mehr)
    pruefe(spieltNoch(key), `${key}: nach 10 Bildern ausser Sicht LAEUFT weiter (A2: Einmal-Clip pausiert nie)`);
    hartVersetzen(key, VORN);
    bilder(250); // 4 s im Bild — der 1-s-Clip ist laengst durchgelaufen
    return { schleifen, enden };
  }
  const hit = await einmalProbe('p2-hit', 'hit');
  pruefe(hit.schleifen === 0, `p2-hit: kein Schleifendurchlauf (loopAnimation blieb false) — ${hit.schleifen}`);
  pruefe(hit.enden === 1, `p2-hit: das Ende-Ereignis feuert genau einmal — ${hit.enden}`);
  pruefe(laufendeNamen('p2-hit').join() === 'idle(loop)', `p2-hit: faellt nach dem Ende auf idle zurueck — ${JSON.stringify(laufendeNamen('p2-hit'))}`);

  const die = await einmalProbe('p3-die', 'die');
  pruefe(die.schleifen === 0, `p3-die: kein Schleifendurchlauf — ${die.schleifen}`);
  pruefe(die.enden === 1, `p3-die: das Ende-Ereignis feuert genau einmal (stirbt einmal, nicht endlos) — ${die.enden}`);
  pruefe(laufendeNamen('p3-die').length === 0, `p3-die: bleibt auf dem letzten Bild stehen, keine Gruppe laeuft mehr danach — ${JSON.stringify(laufendeNamen('p3-die'))}`);
}

console.log('\n[P4] Zustandswechsel und Rueckkehr im selben Bild (probe-lod-fortsetzen.ts P4, B3)');
{
  const HINTEN = new Vector3(0, 0, -20);
  const VORN = new Vector3(0, 0, 5);
  await anlegenMitEinmal('p4', 'Tier', 'tierModell', HINTEN, 'walk');
  bilder(3);
  await anlegenMitEinmal('p4', 'Tier', 'tierModell', HINTEN, 'idle');
  hartVersetzen('p4', VORN);
  bilder(1);
  pruefe(laufendeNamen('p4').length === 1, `Server idle + im selben Bild ins Bild versetzt: genau eine Gruppe, nicht ${JSON.stringify(laufendeNamen('p4'))}`);
  bilder(60);
  pruefe(laufendeNamen('p4').length === 1, `60 Bilder spaeter: weiterhin genau eine Gruppe, nicht ${JSON.stringify(laufendeNamen('p4'))}`);
}

console.log('\n[7]+[8] Verdrahtung mit einer Kamera AUSSERHALB des Ursprungs (B5-Testluecke: toetet M7/M8/M11)');
{
  // Kamera NICHT im Ursprung: (0, 0, -5), Blick auf +Z. Mit Kamera im
  // Ursprung fallen "Distanz vom Ursprung" (M7) und "Kameraposition =
  // Ursprung" (M11) mit dem echten Wert zusammen — genau das hat die
  // Mutanten ueberleben lassen (Angriff, Befund B5).
  kamera.position.set(0, 0, -5);
  kamera.setTarget(new Vector3(0, 0, -4));
  kamera.getViewMatrix(true);
  kamera.getProjectionMatrix(true);

  await anlegen('npc:nah-hinter-kamera', 'TestNpc', 'npcModell', new Vector3(0, 0, -10), 'idle');
  pruefe(spieltNoch('npc:nah-hinter-kamera'), 'Vorbereitung: animiert beim Erscheinen');
  mgr.updateDynamics(0.016);
  pruefe(
    !spieltNoch('npc:nah-hinter-kamera'),
    '[7] nah (5 m), aber HINTER der echten Kamera -> pausiert (toetet M8: Sichtkegel immer wahr wuerde hier faelschlich animieren)'
  );

  // 62 m vor der Kamera (0,0,-5), also (0,0,57): im Sichtkegel (auf der
  // Blickachse), aber jenseits der 60-m-Grenze. Vom URSPRUNG aus gemessen
  // sind es nur 57 m (<= 60) — mit "Distanz vom Ursprung" (M7) oder
  // "Kamera = Ursprung" (M11) wuerde das faelschlich animieren.
  await anlegen('npc:im-kegel-fern', 'TestNpc', 'npcModell', new Vector3(0, 0, 57), 'idle');
  pruefe(spieltNoch('npc:im-kegel-fern'), 'Vorbereitung: animiert beim Erscheinen');
  mgr.updateDynamics(0.016);
  pruefe(
    !spieltNoch('npc:im-kegel-fern'),
    '[8] im Sichtkegel, aber 62 m von der echten Kamera entfernt -> pausiert (toetet M7 und M11: beide rechnen ' +
      'mit 57 m ab dem Ursprung und blieben faelschlich animiert)'
  );
}

// Kamera fuer [9]–[13] auf die Grundeinstellung zuruecksetzen.
kamera.position.set(0, 0, 0);
kamera.fov = 0.8;
kamera.setTarget(new Vector3(0, 0, 1));
kamera.getViewMatrix(true);
kamera.getProjectionMatrix(true);

console.log('\n[9] A2: ein Tod auf 70 m oder hinter der Kamera endet nach ca. 1 s (probe-n1.ts N1/N2)');
{
  const FERN_SICHTBAR = new Vector3(0, 0, 70); // im Sichtkegel, aber jenseits der 60-m-Grenze
  const HINTEN = new Vector3(0, 0, -20); // hinter der Kamera, ausserhalb jedes Sichtkegels
  for (const [key, pos, was] of [
    ['n2-tot-70m', FERN_SICHTBAR, '70 m entfernt (im Bild, aber jenseits 60 m)'],
    ['n2-tot-hinten', HINTEN, 'hinter der Kamera'],
  ] as const) {
    await anlegenMitEinmal(key, 'Tier', 'tierModell', pos, 'idle');
    bilder(2);
    await anlegenMitEinmal(key, 'Tier', 'tierModell', pos, 'idle', `die#${key}`);
    bilder(180); // 2,88 s — der 1-s-Clip (30 Bilder) muss laengst durchgelaufen sein
    pruefe(
      laufendeNamen(key).length === 0,
      `${key}: der Tod (${was}) ist nach 3 s zuende, nichts spielt mehr, nicht ${JSON.stringify(laufendeNamen(key))}`
    );
  }
}

console.log('\n[10] A3/N-M1: Modell ohne idle-Clip — wechsleAnimation() stoppt walk ganz, Rueckkehr startet NICHTS (probe-n1b.ts G1)');
{
  const HINTEN = new Vector3(0, 0, -20);
  const VORN = new Vector3(0, 0, 5);
  await anlegenMitEinmal('g1', 'TestNpc', 'nurWalkModell', HINTEN, 'walk');
  bilder(3);
  pruefe(!spieltNoch('g1'), 'Vorbereitung: walk pausiert (ausser Sicht)');
  await anlegenMitEinmal('g1', 'TestNpc', 'nurWalkModell', HINTEN, 'idle');
  bilder(1);
  hartVersetzen('g1', VORN);
  bilder(30);
  pruefe(
    !spieltNoch('g1'),
    'zurueck im Bild: NICHTS spielt — die gestoppte walk-Gruppe darf nicht wieder anlaufen (isStarted-Waechter, A3/N-M1)'
  );
}

console.log('\n[11] A3/N-M13: idle pausiert, dann Server-Zustand attack — Fortsetzen im attack-Zweig (probe-n1b.ts G2)');
{
  const HINTEN = new Vector3(0, 0, -20);
  await anlegenMitEinmal('g2', 'Tier', 'tierModell', HINTEN, 'idle');
  bilder(3);
  pruefe(!spieltNoch('g2'), 'Vorbereitung: idle pausiert (ausser Sicht)');
  await anlegenMitEinmal('g2', 'Tier', 'tierModell', HINTEN, 'attack');
  bilder(60);
  pruefe(
    laufendeNamen('g2').join() === 'idle(loop)',
    `attack-Zustand setzt die gemerkte idle-Gruppe fort statt sie starr zu lassen (A3/N-M13), nicht ${JSON.stringify(laufendeNamen('g2'))}`
  );
}

console.log('\n[12] A3/N-M6+N-M7: Mindestradius und Radius im Sichtkegeltest (winziger Wuerfel am Kegelrand)');
{
  const Z = 20;
  const yRand = sucheYFuerAbstand(Z, -0.8); // 0,8 m ausserhalb der reinen Sichtlinie
  // npcModell ist ein 0,4-m-Wuerfel (echter Huellradius ~0,35 m VOR dem
  // Mindestradius) — ohne Mindestradius (N-M6) oder mit im Vergleich
  // ignoriertem Radius (N-M7, `dotCoordinate < 0` statt `< -radius`)
  // wuerde die Kugel hier NICHT bis in den Sichtkegel reichen.
  await anlegen('npc:klein-randnah', 'TestNpc', 'npcModell', new Vector3(0, yRand, Z), 'idle');
  pruefe(spieltNoch('npc:klein-randnah'), 'Vorbereitung: animiert beim Erscheinen');
  mgr.updateDynamics(0.016);
  pruefe(
    spieltNoch('npc:klein-randnah'),
    'winziger Wuerfel 0,8 m ausserhalb der reinen Sichtlinie friert NICHT ein — der Mindestradius (1,5 m) traegt ' +
      'die Kugel in den Sichtkegel (toetet N-M6: kein Mindestradius, und N-M7: Radius im Vergleich ignoriert)'
  );
}

console.log('\n[13] A3/N-M8+N-M9: Huellmitte (Mittelhoehe) und dass die Huelle ueberhaupt gemessen wird');
{
  const Z = 20;
  const MITTE_Y_ECHT = 3.2; // stelleSchwebendBereit: Netz schwebt lokal y=3,0..3,4, Wurzel bei y=0
  // Untere Sichtkegel-Ebene (wie [6]/B4): die Wurzel liegt TIEFER als das
  // schwebende Netz, muss also unterhalb der Kugel getestet werden, sonst
  // waere die Wurzel (M8s "Mitte = Wurzel") automatisch IMMER weiter innen
  // als die echte Mitte, statt weiter aussen.
  const zielMitteY = sucheYFuerAbstandUnten(Z, 0.3); // knapp INNERHALB des Sichtkegels
  const wurzelY = zielMitteY - MITTE_Y_ECHT;
  await anlegen('schwebend:rand', 'TestNpc', 'schwebendModell', new Vector3(0, wurzelY, Z), 'idle');
  pruefe(spieltNoch('schwebend:rand'), 'Vorbereitung: animiert beim Erscheinen');
  mgr.updateDynamics(0.016);
  pruefe(
    spieltNoch('schwebend:rand'),
    'der schwebende Wuerfel friert NICHT ein — die Kugel um die GEMESSENE Huellmitte (3,2 m ueber der Wurzel) liegt ' +
      'im Sichtkegel, obwohl die Wurzel selbst 3,2 m tiefer liegt (toetet N-M8: Mittelhoehe ignoriert, und N-M9: ' +
      'Huelle nie gemessen, Rueckfall 0,9 m/1,5 m)'
  );
}

scene.dispose();
engine.dispose();

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} FAILED`);
process.exit(fehler === 0 ? 0 : 1);
