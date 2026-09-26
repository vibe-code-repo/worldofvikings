/**
 * Schatten: der Tiefen-Wrapper baut nie aus einer Vorlage ohne `defines` (WebGPU-Stillstand).
 * Shadow depth wrapper never builds from a base effect that lost its `defines`.
 *
 * Unter WebGPU brach in etwa 10 % der Ladevorgaenge der Schattenpass ab
 * (`Can't find buffer "Material" in the draw context`, danach `createBindGroup`
 * in jedem Bild, onAfterRender feuerte nie wieder): Wird der Draw-Cache eines
 * Sub-Meshes zurueckgesetzt, nachdem der Farbpass seinen Effekt angelegt hat
 * (etwa weil ein Material-Plugin nachtraeglich angehaengt wird), kopiert
 * Babylons `ShadowDepthWrapper` `defines = null`; `bindForSubMesh` kehrt dann
 * ohne zu binden zurueck. Drei Zusicherungen:
 *
 *  1. Babylon-Zeuge: der unbewachte Wrapper legt in diesem Zustand einen Eintrag
 *     mit `defines == null` an (faellt der Test, hat Babylon das Verhalten
 *     geaendert und der Schutz gehoert neu bewertet).
 *  2. `SicherTiefenWrapper` meldet in diesem Zustand „nicht bereit" und legt
 *     keinen Eintrag an.
 *  3. Legt der Farbpass die Vorlage neu an, wird der Sub-Mesh wieder bereit.
 *
 * Lauf: npx tsx client/test/schatten-wrapper-sicher.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { SicherTiefenWrapper, erzeugeTiefenWrapper, vorlageHatDefines } from '../src/engine/ShadowDepthWrapperSicher';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten: Tiefen-Wrapper ohne veraltete Vorlage');

type Tabellen = {
  _subMeshToEffect: Map<unknown, [unknown, number]>;
  _subMeshToDepthWrapper: { mm: Map<unknown, Map<unknown, { mainDrawWrapper: { defines: unknown } }>> };
};

/** Mesh + Material, Farbpass-Vorlage angelegt, Draw-Cache danach zurueckgesetzt. */
function zustandNachReset(mitSicherung: boolean) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh('laub', scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = [0, 0, 1, 0, 0, 1];
  vd.applyToMesh(mesh);
  const material = new PBRMaterial('laub_mat', scene);
  // `doNotInjectCode`: kein #include im Fake-Quelltext, NullEngine kann keine Shader laden.
  const optionen = { doNotInjectCode: true };
  const wrapper = mitSicherung ? new SicherTiefenWrapper(material, scene, optionen) : new ShadowDepthWrapper(material, scene, optionen);
  material.shadowDepthWrapper = wrapper;
  mesh.material = material;
  const teil = mesh.subMeshes[0]!;
  const vorher = { vorlage: (wrapper as unknown as Tabellen)._subMeshToEffect.has(teil) };
  material.isReadyForSubMesh(mesh, teil, false);
  // NullEngine uebersetzt nichts: die Vorlage bekommt Quelltext und gilt als fertig, damit der
  // Wrapper bis `createEffect` kommt wie auf der GPU. / Fake source + ready so the wrapper gets as far as on a GPU.
  const vorlage = (wrapper as unknown as Tabellen)._subMeshToEffect.get(teil)?.[0] as
    | object
    | undefined;
  if (vorlage) {
    Object.defineProperty(vorlage, 'isReady', { value: () => true });
    Object.defineProperty(vorlage, 'vertexSourceCodeBeforeMigration', { value: 'void main(){}' });
    Object.defineProperty(vorlage, 'fragmentSourceCodeBeforeMigration', { value: 'void main(){}' });
  }
  return { engine, scene, mesh, material, wrapper, teil, vorher };
}
// Nur die Seiten des Generators, die der Wrapper anfasst, wenn er wirklich baut.
const generatorAttrappe = {} as unknown as ShadowGenerator;

// ── 1. Babylon-Zeuge: der unbewachte Wrapper kopiert `defines == null` ──
{
  const z = zustandNachReset(false);
  const w = z.wrapper as unknown as Tabellen;
  pruefe(!z.vorher.vorlage, 'der Wrapper kannte den Sub-Mesh schon vor dem Farbpass — der Test misst nichts');
  pruefe(w._subMeshToEffect.has(z.teil), 'der Farbpass hat keine Vorlage im Wrapper angelegt — Babylon-Weg geaendert');
  pruefe(vorlageHatDefines(z.wrapper, z.teil), 'nach dem Farbpass fehlen die defines der Vorlage schon ohne Reset');
  z.teil.resetDrawCache();
  pruefe(!vorlageHatDefines(z.wrapper, z.teil), 'nach resetDrawCache hat die Vorlage noch defines — der Reset trifft die Vorlage nicht');
  z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  const eintrag = w._subMeshToDepthWrapper.mm.get(z.teil)?.values().next().value;
  pruefe(
    eintrag !== undefined && eintrag.mainDrawWrapper.defines == null,
    'Babylon kopiert nach dem Reset keine null-defines mehr — die Sicherung ist zu ueberpruefen'
  );
  z.scene.dispose();
  z.engine.dispose();
}

// ── 2. Der bewachte Wrapper meldet „nicht bereit" und legt nichts an ──
{
  const z = zustandNachReset(true);
  const w = z.wrapper as unknown as Tabellen;
  pruefe(z.wrapper instanceof SicherTiefenWrapper, 'der Test prueft nicht den bewachten Wrapper');
  pruefe(
    erzeugeTiefenWrapper(z.material, z.scene) instanceof SicherTiefenWrapper,
    'erzeugeTiefenWrapper (der Weg, den AssetManager nimmt) liefert nicht den bewachten Wrapper'
  );
  z.teil.resetDrawCache();
  pruefe(!vorlageHatDefines(z.wrapper, z.teil), 'Ausgangslage falsch: die Vorlage hat nach dem Reset noch defines');
  const bereit = z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  pruefe(bereit === false, 'ohne defines meldet der Wrapper „bereit" — der Schattenpass wuerde ohne Bindung zeichnen');
  pruefe(
    !w._subMeshToDepthWrapper.mm.has(z.teil),
    'der Wrapper hat trotz fehlender defines einen Tiefen-Eintrag angelegt (kopierte null)'
  );

  // ── 3. Der Farbpass legt die Vorlage neu an: bereit ──
  z.material.isReadyForSubMesh(z.mesh, z.teil, false);
  pruefe(vorlageHatDefines(z.wrapper, z.teil), 'nach neuem Farbpass fehlen die defines der Vorlage noch');
  z.wrapper.isReadyForSubMesh(z.teil, [], generatorAttrappe, false, 0);
  const eintrag = w._subMeshToDepthWrapper.mm.get(z.teil)?.values().next().value;
  pruefe(
    eintrag !== undefined && eintrag.mainDrawWrapper.defines != null,
    'nach neuem Farbpass baut der Wrapper weiter mit null-defines'
  );
  z.scene.dispose();
  z.engine.dispose();
}

// ── 4. Ohne Vorlage: nichts zu bewachen (Babylon meldet selbst „nicht bereit") ──
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mesh = new Mesh('leer', scene);
  new VertexData().applyToMesh(mesh);
  const material = new PBRMaterial('leer_mat', scene);
  const wrapper = erzeugeTiefenWrapper(material, scene);
  pruefe(vorlageHatDefines(wrapper, { } as never), 'ohne Vorlage meldet der Wachposten „fehlende defines"');
  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`✗ ${fehler} Fehler`);
  process.exit(1);
}
console.log('✓ Tiefen-Wrapper: kein Bau ohne defines');
