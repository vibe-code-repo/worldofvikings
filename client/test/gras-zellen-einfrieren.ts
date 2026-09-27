/**
 * fps-analyse #8 — Clutter-Zell-Master (Gras/Bewuchs) frieren ein.
 *
 * `GrassClutter.buildCell()` baute je Zelle und Eintrag einen Mesh-Master
 * mit Thin-Instance-Puffern (Matrix, optional Faerbung), stehend im
 * Ursprung — genau das Muster, fuer das `AssetManager.zuMaster()` und
 * `EntityManager.zellMeshHolen()` schon `freezeWorldMatrix()` rufen. Der
 * Clutter-Master tat das NICHT: 116 dieser Master (47.426 Thin-Instanzen)
 * waren am Startdorf ungetestet unter den 320 von 788 nicht eingefrorenen
 * Meshes aus der fps-Analyse (Berichte/fps-analyse.md, Punkt 8).
 *
 * Die Baulogik ist jetzt in der eigenen, exportierten Funktion
 * `baueClutterZellMesh()` (client/src/engine/GrassClutter.ts) — testbar
 * ohne Weltdaten oder GLB-Laden, `buildCell()` liefert nur noch die schon
 * aufbereiteten Matrizen/Farben an.
 *
 * Geprüft wird über die ECHTE Funktion und eine ECHTE Babylon-Geometrie
 * auf der NullEngine — keine GPU, kein `assets/`.
 *
 *   npx tsx client/test/gras-zellen-einfrieren.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math';
import { baueClutterZellMesh } from '../src/engine/GrassClutter';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

// Geometrie eines echten Meshs ziehen (wie zellMeshAusPrototyp es tut),
// statt Rohdaten von Hand zu erfinden.
const quelle = MeshBuilder.CreateBox('quelle', { size: 0.3 }, scene);
const vd = VertexData.ExtractFromMesh(quelle, true, true);
quelle.dispose();
const geometry = {
  positions: Float32Array.from(vd.positions ?? []),
  normals: Float32Array.from(vd.normals ?? []),
  uvs: Float32Array.from(vd.uvs ?? []),
  indices: Uint32Array.from(vd.indices ?? []),
};
const material = new StandardMaterial('halm', scene);

/** N Instanz-Weltmatrizen entlang der X-Achse, {@link start}..{@link start}+N-1 Meter. */
function matrizen(start: number, n: number): Float32Array {
  const data = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) Matrix.Translation(start + i, 0, 0).toArray(data, i * 16);
  return data;
}

console.log('\n[1] Zell-Master friert seine eigene Weltmatrix ein');
const mesh = baueClutterZellMesh(scene, 'clutter_0,0_testhalm', geometry, material, matrizen(0, 5), null);
check('Master ist eingefroren (fps-analyse #8: bisher NICHT der Fall)', mesh.isWorldMatrixFrozen);
check('Master selbst steht im Ursprung', mesh.position.equals(Vector3.Zero()));

console.log('\n[2] Die Huelle umschliesst trotz eingefrorener Matrix alle Instanzen');
mesh.computeWorldMatrix(true);
let info = mesh.getBoundingInfo();
check(
  'min/max in Weltkoordinaten deckt Instanz 0 (x=0) und Instanz 4 (x=4) ab',
  info.boundingBox.minimumWorld.x <= 0.01 && info.boundingBox.maximumWorld.x >= 3.99,
  `min=${info.boundingBox.minimumWorld.x.toFixed(2)} max=${info.boundingBox.maximumWorld.x.toFixed(2)}`
);

console.log('\n[3] clearArea() schreibt den Instanzpuffer neu (weniger Instanzen) — Master bleibt eingefroren und richtig platziert');
// Dieselbe Operation wie GrassClutter.clearArea(): direkt `thinInstanceSetBuffer`
// auf den bestehenden (eingefrorenen) Master, ohne ihn aufzutauen.
const weniger = matrizen(10, 2); // nur noch Instanzen bei x=10 und x=11
mesh.thinInstanceSetBuffer('matrix', weniger, 16, false);
check('Master bleibt eingefroren (freeze nicht durch den Puffer-Wechsel geloest)', mesh.isWorldMatrixFrozen);
mesh.computeWorldMatrix(true);
info = mesh.getBoundingInfo();
check(
  'Huelle folgt den VERBLEIBENDEN Instanzen (x=10..11), nicht den alten (x=0..4)',
  info.boundingBox.minimumWorld.x >= 9.5 && info.boundingBox.maximumWorld.x <= 11.5,
  `min=${info.boundingBox.minimumWorld.x.toFixed(2)} max=${info.boundingBox.maximumWorld.x.toFixed(2)}`
);

console.log('\n[4] Faerbungspuffer optional — kein Aufruf ohne Farbdaten');
const ohneFarbe = baueClutterZellMesh(scene, 'clutter_0,0_ohnefarbe', geometry, material, matrizen(0, 1), null);
check('friert trotzdem ein', ohneFarbe.isWorldMatrixFrozen);

console.log(fehler === 0 ? '\nALL PASSED' : `\n${fehler} FAILED`);
process.exit(fehler === 0 ? 0 : 1);
