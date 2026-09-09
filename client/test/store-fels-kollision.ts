/**
 * Der Speicher-Fels ist ein HINDERNIS — und der Speicher-Baum nicht.
 *
 * ── Der Fehler, gegen den dieser Test steht ──────────────────────────
 * `tools/store-prefabs.mjs` gibt JEDEM Speicher-Prefab genau ein Flag:
 * `PERSISTENT`. Die Begründung dort ist richtig — alle anderen Flags
 * beschreiben Verhalten, und ein Fremdmodell hat keins. Die Folge war
 * es nicht: `COLLIDING_FLAGS` im `EntityManager` liest genau diese
 * Flags, findet keins, und legt das Prefab in `colliderless`. Man läuft
 * durch einen 20-m-Felsen hindurch.
 *
 * Das ist ein Fehler ohne Symptom im Testlauf: Kein Fehler, keine
 * Warnung, die Klippe steht da und sieht richtig aus. Sichtbar wird er
 * erst, wenn jemand dagegen läuft.
 *
 * ── Was hier gemessen wird ───────────────────────────────────────────
 * Der ganze Weg an echten Produktivklassen (AssetManager.getMasters →
 * EntityManager.applyStatic/flush → `colliderSpecs`), an ECHTEN
 * Prefabnamen und -hashes aus der Registrierung. Der Ladeweg (HTTP,
 * SceneLoader) ist das Einzige, was ersetzt wird — die GLBs liegen
 * ausserhalb des Repos.
 *
 *   (a) FELS → exakte Oberfläche (`kind: 'mesh'`), nicht Hüllquader.
 *       Ein Findling ist unregelmässig; sein Quader steht als
 *       unsichtbare Wand weit davor (Herleitung bei `FELS_KOLLISION`
 *       im EntityManager). Der Speicher-Fels fällt durch dessen
 *       Namensmuster (`^rock…` gegen `environment-sm-env-rock-…`) und
 *       wird über `STORE_FELSEN_NAMEN` erkannt — genau das wird geprüft.
 *
 *   (b) FESTE DEKO → Körper, aber Hüllquader. Ein Fass ist kastenförmig,
 *       da ist der Quader richtig und billiger.
 *
 *   (c) VEGETATION → KEIN Körper. Die bewusste Grenze: Die Kollision der
 *       Bäume ist eine eigene Entscheidung mit eigener Messung und
 *       gehört nicht in einen Fels-Auftrag. Ohne diesen Fall wäre die
 *       Grenze eine Behauptung im Kommentar.
 *
 *   (d) KULISSE (`kollision: none`, steht in `STORE_NICHT_STREUEN`) →
 *       KEIN Körper. Durch eine 594 m breite Bergkulisse muss man
 *       hindurchlaufen können.
 *
 * Lauf:  npx tsx client/test/store-fels-kollision.ts
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
// Seiteneffekt-Import wie im Client: ohne ihn fehlen die thinInstance*-
// Methoden am Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { findPrefabByName, getStableHash, STORE_FELSEN_NAMEN } from '@wov/shared';
import { AssetManager } from '../src/engine/AssetManager';
import { EntityManager } from '../src/entities/EntityManager';
import type { ZDOEntityUpdate } from '../src/net/ZDOSync';

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

/** Ein Würfel als Ersatzgeometrie — 12 Dreiecke, unsymmetrisch gestellt. */
function wuerfel(name: string, sz: Scene): Mesh {
  const m = new Mesh(name, sz);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push(x, y, z);
  d.positions = p;
  d.indices = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
    2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  d.applyToMesh(m);
  return m;
}

/**
 * Einen geladenen Container vortäuschen — unter dem MODELLPFAD des
 * echten Prefabs, damit `prepareMasters()` ihn findet.
 */
function stelleBereit(assets: AssetManager, modell: string): void {
  const wurzel = new TransformNode(`${modell}_wurzel`, scene);
  const sichtbar = wuerfel('Sichtbar', scene);
  sichtbar.material = new PBRMaterial(`${modell}_mat`, scene);
  sichtbar.parent = wurzel;
  const container = new AssetContainer(scene);
  container.meshes.push(sichtbar);
  container.transformNodes.push(wurzel);
  container.removeAllFromScene();
  (
    assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }
  ).containers.set(modell, Promise.resolve(container));
}

function setze(mgr: EntityManager, prefab: string, modell: string, hash: number): void {
  const u: ZDOEntityUpdate = {
    key: `${prefab}-1`,
    prefabHash: hash,
    // Weit weg vom Kollisionsfenster: Der SPEC entsteht trotzdem (das ist
    // der Prüfgegenstand), nur legt StaticColliderSet.sync() keine
    // Havok-Körper an — die gäbe es unter der NullEngine nicht.
    position: { x: 1000, y: 0, z: 1000 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    isOwnPlayer: false,
  };
  (
    mgr as unknown as {
      applyStatic: (u: ZDOEntityUpdate, p: string, m: string | null) => void;
    }
  ).applyStatic(u, prefab, modell);
}

const warte = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * Die Kollisionsform eines Prefabs — über den echten Weg gebaut.
 *
 * Jeder Fall bekommt eine EIGENE Szene aus AssetManager und
 * EntityManager. Ein gemeinsamer Manager teilte sich `colliderSpecs`,
 * und dann sagte „genau ein Spec" nichts mehr über den Fall aus, den man
 * gerade prüft.
 */
async function formVon(prefab: string): Promise<string | null> {
  const def = findPrefabByName(prefab);
  if (!def?.model) throw new Error(`${prefab} ist nicht registriert`);
  const assets = new AssetManager(scene);
  stelleBereit(assets, def.model);
  const mgr = new EntityManager(scene, null as never, assets, null as never);
  mgr.enablePhysics();
  setze(mgr, prefab, def.model, getStableHash(prefab));
  await warte();
  mgr.flush();
  const specs = [...mgr.colliderSpecs.values()] as { kind: string }[];
  return specs.length === 0 ? null : (specs[0]!.kind ?? '?');
}

/*
  Die Prüflinge stehen als NAMEN da, nicht als Nachbau. Wären sie
  ausgedacht, prüfte der Test seine eigene Erfindung: `formVon()` löst
  jeden über `findPrefabByName()` auf und wirft, wenn er fehlt — ein
  umbenanntes oder entferntes Modell wird damit rot statt still grün.
*/
const FELS = 'environment-sm-env-rock-cliff-01';
const DEKO = 'environment-barrel-destructible';
const BAUM = 'vegetation-tree-1c3';
const KULISSE = 'environment-backdrop-mountains-clear';

async function main(): Promise<void> {
  pruefe(
    STORE_FELSEN_NAMEN.has(FELS),
    `${FELS} steht in STORE_FELSEN_NAMEN (sonst prüft (a) den falschen Fall)`
  );

  const fels = await formVon(FELS);
  pruefe(fels === 'mesh', `(a) Fels bekommt die exakte Oberfläche (ist: ${fels ?? 'gar keine'})`);

  const deko = await formVon(DEKO);
  pruefe(deko === 'box', `(b) feste Deko bekommt einen Hüllquader (ist: ${deko ?? 'gar keine'})`);

  const baum = await formVon(BAUM);
  pruefe(baum === null, `(c) Vegetation bleibt durchlässig (ist: ${baum ?? 'keine Form'})`);

  const kulisse = await formVon(KULISSE);
  pruefe(kulisse === null, `(d) Kulisse bleibt durchlässig (ist: ${kulisse ?? 'keine Form'})`);

  console.log(
    fehler === 0
      ? '\nOK — Speicher-Fels ist fest, Speicher-Vegetation und Kulisse sind es nicht'
      : `\n${fehler} FEHLER`
  );
  scene.dispose();
  engine.dispose();
  process.exit(fehler > 0 ? 1 : 0);
}

void main().catch((f: unknown) => {
  console.error(f);
  process.exit(1);
});
