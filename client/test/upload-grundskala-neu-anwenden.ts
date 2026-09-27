/**
 * H1 (Angriff „Editor Upload-Größe", PR #110): Eine geänderte Grundskala
 * eines SCHON registrierten Uploads muss ohne Neuladen der Seite wirken —
 * am selben Ladeweg wie das Spiel und der Testflug (`AssetManager.
 * getMasters()`), im selben Ablauf wie der Browser:
 *
 *   1. Einmal registrieren über `applyUploadedModelRegistry` (wie
 *      `ladeHochgeladeneRegistrierung` beim ersten Laden der Katalogseite).
 *   2. Ein ZWEITES Mal anwenden, mit geänderter `grundskala` im selben
 *      Eintrag (wie nach einem erfolgreichen PATCH + erneutem
 *      `ladeHochgeladeneRegistrierung`, `GegenstandsKatalog.
 *      grundskalaAendernAusfuehren`).
 *
 * Auf 2c0a7ed (vor dieser Nachbesserung) übersprang `applyUploadedModelRegistry`
 * jeden schon bekannten Namen (`if (UPLOADED_BY_NAME.has(m.name)) { geladen++;
 * continue; }`) — `grundskalaFuerModell` blieb bei 1, und der schon gebaute
 * Loader-Master (`AssetManager.masters`) blieb für immer bei der ALTEN,
 * unskalierten `localMatrix`. Der Editor-Status „Übernommen." nach dem PATCH
 * war falsch.
 *
 * Netzwerkschritt ersetzt wie in `client/test/upload-grundskala-loader.ts`
 * (dortiger Kopfkommentar): ein synthetischer Container statt SceneLoader.
 *
 * Lauf:  npx tsx client/test/upload-grundskala-neu-anwenden.ts
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

/** Rohgröße wie U_Marktstand2 (Diagnose 26.09., wie im bestehenden Loader-Test). */
const ROH = { breite: 1.0, hoehe: 0.72, tiefe: 0.6 };
const ROH_ECKEN: readonly Vector3[] = (() => {
  const raus: Vector3[] = [];
  for (const x of [0, ROH.breite]) for (const y of [0, ROH.hoehe]) for (const z of [0, ROH.tiefe]) raus.push(new Vector3(x, y, z));
  return raus;
})();

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

function basisEintrag(g: number | undefined): uploadedModelRegistry.UploadedModelEntry {
  return {
    name: 'U_Neuanwendentest',
    anzeigename: 'Neuanwendentest',
    bytes: 1000, dreiecke: 12, meshes: 1, materialien: 1, bilder: 0, fehlendeTexturen: false,
    breite: ROH.breite, hoehe: ROH.hoehe, tiefe: ROH.tiefe,
    kollisionsart: 'fest', hatKollisionsnetz: false, kollisionsnetzAbgelehnt: false,
    hochgeladenVon: 'test', zeitpunkt: new Date().toISOString(),
    ...(g !== undefined ? { grundskala: g } : {}),
  };
}

async function lauf(): Promise<void> {
  const assets = new AssetManager(scene);
  const modellName = `${uploadedModelRegistry.UPLOAD_MODEL_PREFIX}U_Neuanwendentest`;

  console.log('\n1. Erstes Registrieren mit Grundskala 1 (wie ladeHochgeladeneRegistrierung beim ersten Laden)\n');
  const erg1 = uploadedModelRegistry.applyUploadedModelRegistry({ version: 1, modelle: [basisEintrag(1)] });
  pruefe(erg1.geladen === 1, 'apply v1: 1 Eintrag geladen');
  pruefe(uploadedModelRegistry.grundskalaFuerModell(modellName) === 1, 'nach apply v1: grundskalaFuerModell === 1');

  try {
    (assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }).containers.set(
      modellName,
      Promise.resolve(baueContainer('U_Neuanwendentest'))
    );
    const masters1 = await assets.getMasters(modellName);
    pruefe(masters1.length > 0, 'getMasters() liefert mindestens einen Master (v1)');
    const masse1 = huelleUnter(masters1, Matrix.Scaling(1, 1, 1));
    nah(masse1.breite, ROH.breite, 'Loader-Maß nach v1 — Breite');
    nah(masse1.hoehe, ROH.hoehe, 'Loader-Maß nach v1 — Höhe');
    nah(masse1.tiefe, ROH.tiefe, 'Loader-Maß nach v1 — Tiefe');

    console.log('\n2. Zweites Anwenden MIT geänderter Grundskala 4 (wie PATCH + erneutes ladeHochgeladeneRegistrierung)\n');
    const erg2 = uploadedModelRegistry.applyUploadedModelRegistry({ version: 1, modelle: [basisEintrag(4)] });
    pruefe(erg2.geladen === 1, 'apply v2: weiterhin 1 Eintrag geladen (aktualisiert, nicht neu registriert)');
    pruefe(erg2.geaendert.includes('U_Neuanwendentest'), "apply v2 meldet 'U_Neuanwendentest' als geändert");
    pruefe(
      uploadedModelRegistry.grundskalaFuerModell(modellName) === 4,
      'nach apply v2: grundskalaFuerModell === 4 (H1 — auf 2c0a7ed blieb das bei 1)'
    );

    const masters2 = await assets.getMasters(modellName);
    pruefe(
      masters2 === masters1,
      'getMasters() liefert dasselbe Array-Objekt (in-place aktualisiert, keine neue GLB-Verarbeitung)'
    );
    const masse2 = huelleUnter(masters2, Matrix.Scaling(1, 1, 1));
    nah(masse2.breite, 4.0, 'Loader-Maß nach v2 (g=4) — Breite (H1 — auf 2c0a7ed blieb das bei 1,0)');
    nah(masse2.hoehe, 2.88, 'Loader-Maß nach v2 (g=4) — Höhe');
    nah(masse2.tiefe, 2.4, 'Loader-Maß nach v2 (g=4) — Tiefe');

    console.log('\n3. Drittes Anwenden zurück auf Grundskala 1 — auch die Rückrichtung wirkt\n');
    const erg3 = uploadedModelRegistry.applyUploadedModelRegistry({ version: 1, modelle: [basisEintrag(1)] });
    pruefe(erg3.geaendert.includes('U_Neuanwendentest'), "apply v3 (zurück auf 1) meldet 'U_Neuanwendentest' als geändert");
    const masters3 = await assets.getMasters(modellName);
    const masse3 = huelleUnter(masters3, Matrix.Scaling(1, 1, 1));
    nah(masse3.breite, ROH.breite, 'Loader-Maß nach v3 (zurück auf g=1) — Breite');
  } finally {
    uploadedModelRegistry.unregisterUploadedPrefab('U_Neuanwendentest');
  }

  console.log(fehler === 0 ? '\nOK — Grundskala-Änderung wirkt im Loader ohne Neuladen der Seite.\n' : `\n${fehler} FEHLER\n`);
  scene.dispose();
  engine.dispose();
  process.exit(fehler > 0 ? 1 : 0);
}

void lauf();
