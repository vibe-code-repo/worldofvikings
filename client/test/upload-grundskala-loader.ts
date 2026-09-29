/**
 * Grundskala im Loader (Karte „Editor Upload-Größe", Auftrag Punkt 2).
 *
 * Geprüft am ECHTEN Ladeweg (`AssetManager.getMasters()`, derselbe Weg wie
 * `EntityManager.applyStatic()`/`prepareMasters()` für jede statische
 * Instanz im Spiel UND im Testflug-Bucket-Pfad) — nur der Netzwerkschritt
 * (`SceneLoader`/HTTP) ist durch einen synthetischen Container ersetzt,
 * genau wie in `client/test/kollisionsnetz.ts` (dortiger Kopfkommentar:
 * „Das GLB selbst kann hier nicht geladen werden, assets/ liegt ausserhalb
 * des Repos" — derselbe Grund gilt hier).
 *
 * Gemessen wird NICHT aus der Registry abgeschrieben: Die Zahlen unten
 * kommen aus `master.localMatrix.multiply(world)`, angewendet auf die
 * ROHEN Eckpunkte der synthetischen Geometrie — derselbe Rechenweg, den
 * `EntityManager.rebuildBucketInstances()`/`baueVollMaster()` für jede
 * Instanz im Spiel geht (`local.multiply(world)`, s. Kopfkommentar
 * `AssetManager.getMasters`).
 *
 * Rohgröße wie `U_Marktstand2` in der Diagnose vom 26.09.: 1,00 × 0,72 ×
 * 0,60 m. Mit Grundskala 4 verlangt der Auftrag 4,0 × 2,88 × 2,4 m bei
 * Platzierungs-`scale` 1 und 8,0 × 5,76 × 4,8 m bei `scale` 2 — GENAU
 * diese vier Zahlen werden hier nachgewiesen.
 *
 * Lauf:  npx tsx client/test/upload-grundskala-loader.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
// Seiteneffekt-Import wie im Client: ohne ihn fehlen die thinInstance*-
// Methoden am Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { uploadedModelRegistry } from '@wov/shared';
import { AssetManager, type PrefabMaster } from '../src/engine/AssetManager';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (bedingung) console.log(`  ok   ${was}`);
  else {
    console.log(`  FAIL ${was}`);
    fehler++;
  }
}
function nah(ist: number, soll: number, was: string, eps = 1e-4): void {
  pruefe(Math.abs(ist - soll) < eps, `${was}: ${ist.toFixed(4)} (erwartet ${soll})`);
}

const engine = new NullEngine();
const scene = new Scene(engine);

/** Rohgröße wie U_Marktstand2 (Diagnose 26.09.). */
const ROH = { breite: 1.0, hoehe: 0.72, tiefe: 0.6 };
/** Ecken der Rohgeometrie, von (0,0,0) bis (breite,hoehe,tiefe) — wie ein Tripo-Export ohne Knotenskala. */
const ROH_ECKEN: readonly Vector3[] = (() => {
  const raus: Vector3[] = [];
  for (const x of [0, ROH.breite]) for (const y of [0, ROH.hoehe]) for (const z of [0, ROH.tiefe]) raus.push(new Vector3(x, y, z));
  return raus;
})();

/** Ein Container wie ihn `loadContainer()` normalerweise per SceneLoader liefert — hier synthetisch. */
function baueContainer(name: string): AssetContainer {
  const wurzel = new TransformNode(`${name}_root`, scene);
  const mesh = new Mesh('Sicht', scene);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [0, ROH.breite]) for (const y of [0, ROH.hoehe]) for (const z of [0, ROH.tiefe]) p.push(x, y, z);
  d.positions = p;
  d.indices = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
    2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  d.applyToMesh(mesh);
  mesh.material = new PBRMaterial(`${name}_mat`, scene);
  mesh.parent = wurzel;
  const container = new AssetContainer(scene);
  container.meshes.push(mesh);
  container.transformNodes.push(wurzel);
  container.removeAllFromScene();
  return container;
}

/** Hüllbox der Rohecken unter `local.multiply(world)` — derselbe Rechenweg wie im Spiel. */
function huelleUnter(masters: readonly PrefabMaster[], world: Matrix): { breite: number; hoehe: number; tiefe: number } {
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const master of masters) {
    const m = master.localMatrix.multiply(world);
    for (const ecke of ROH_ECKEN) {
      const t = Vector3.TransformCoordinates(ecke, m);
      min = Vector3.Minimize(min, t);
      max = Vector3.Maximize(max, t);
    }
  }
  return { breite: max.x - min.x, hoehe: max.y - min.y, tiefe: max.z - min.z };
}

async function lauf(): Promise<void> {
  const assets = new AssetManager(scene);

  console.log('\n1. Grundskala 4 wirkt MULTIPLIKATIV auf die Platzierungs-scale (nicht ersetzend)\n');
  {
    const eintrag: uploadedModelRegistry.UploadedModelEntry = {
      name: 'U_Testladergs4',
      anzeigename: 'Testlader (Grundskala 4)',
      bytes: 1000, dreiecke: 12, meshes: 1, materialien: 1, bilder: 0, fehlendeTexturen: false,
      breite: ROH.breite, hoehe: ROH.hoehe, tiefe: ROH.tiefe,
      kollisionsart: 'fest', hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false,
      hochgeladenVon: 'test', zeitpunkt: new Date().toISOString(),
      grundskala: 4,
    };
    uploadedModelRegistry.registerUploadedPrefab(eintrag);
    const modellName = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${eintrag.name}`;
    // Netzwerkschritt ersetzt — s. Kopfkommentar.
    (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set(
      modellName,
      Promise.resolve(baueContainer(eintrag.name))
    );
    try {
      const masters = await assets.getMasters(modellName);
      pruefe(masters.length > 0, 'getMasters() liefert mindestens einen Master');

      const scale1 = huelleUnter(masters, Matrix.Scaling(1, 1, 1));
      nah(scale1.breite, 4.0, 'scale 1 — Breite');
      nah(scale1.hoehe, 2.88, 'scale 1 — Höhe');
      nah(scale1.tiefe, 2.4, 'scale 1 — Tiefe');

      const scale2 = huelleUnter(masters, Matrix.Scaling(2, 2, 2));
      nah(scale2.breite, 8.0, 'scale 2 — Breite');
      nah(scale2.hoehe, 5.76, 'scale 2 — Höhe');
      nah(scale2.tiefe, 4.8, 'scale 2 — Tiefe');
    } finally {
      uploadedModelRegistry.unregisterUploadedPrefab(eintrag.name);
    }
  }

  console.log('\n2. Gegenprobe: ohne grundskala (Feld fehlt) bleibt die Rohgröße unverändert\n');
  {
    const eintrag: uploadedModelRegistry.UploadedModelEntry = {
      name: 'U_TestladerOhne',
      anzeigename: 'Testlader (ohne Grundskala)',
      bytes: 1000, dreiecke: 12, meshes: 1, materialien: 1, bilder: 0, fehlendeTexturen: false,
      breite: ROH.breite, hoehe: ROH.hoehe, tiefe: ROH.tiefe,
      kollisionsart: 'fest', hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false,
      hochgeladenVon: 'test', zeitpunkt: new Date().toISOString(),
    };
    uploadedModelRegistry.registerUploadedPrefab(eintrag);
    const modellName = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}${eintrag.name}`;
    (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set(
      modellName,
      Promise.resolve(baueContainer(eintrag.name))
    );
    try {
      const masters = await assets.getMasters(modellName);
      const scale1 = huelleUnter(masters, Matrix.Scaling(1, 1, 1));
      nah(scale1.breite, ROH.breite, 'ohne Grundskala, scale 1 — Breite bleibt roh');
      nah(scale1.hoehe, ROH.hoehe, 'ohne Grundskala, scale 1 — Höhe bleibt roh');
      nah(scale1.tiefe, ROH.tiefe, 'ohne Grundskala, scale 1 — Tiefe bleibt roh');
    } finally {
      uploadedModelRegistry.unregisterUploadedPrefab(eintrag.name);
    }
  }

  console.log(fehler === 0 ? '\nOK — Grundskala wirkt im Loader multiplikativ.\n' : `\n${fehler} FEHLER\n`);
  scene.dispose();
  engine.dispose();
  process.exit(fehler > 0 ? 1 : 0);
}

void lauf();
