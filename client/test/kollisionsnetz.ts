/**
 * Die `_col`-Konvention: ein Mesh der GLB ist NUR Kollision, nie Bild.
 *
 * Warum es diese Konvention gibt (Herleitung im Kopf von
 * client/src/engine/AssetManager.ts): Die Spielerkapsel hat 0,4 m Radius,
 * und an einer 0,25-m-Setzstufe steht die Kontaktnormale bei
 * acos((0,4−0,25)/0,4) ≈ 68° — über der Steigungsgrenze, auch nach deren
 * Anhebung auf den Originalwert 60° am 11.09.2026. Die höchste Kante, die
 * eine 0,4-m-Kapsel so noch nimmt, ist r·(1−cos(Grenze)): bei 40° waren das
 * 9,4 cm, bei 60° sind es 20 cm — beides unter einer 25-cm-Stufe. Eine
 * Treppe, deren Kollision aus dem GERENDERTEN Mesh gebacken wird, ist damit
 * unbegehbar, egal wie flach ihre Rampe im Mittel ist. Ein `_col`-Mesh legt
 * stattdessen die glatte Rampe unter die Stufen.
 *
 * Der Fehlermodus ist unauffällig und teuer: Das Kollisionsnetz ist ein
 * plumper Quader. Rutscht es versehentlich in den Renderweg, steht es als
 * grauer Klotz in der Treppe (oder wirft, noch heimtückischer, nur seinen
 * Schatten — die Werferliste entscheidet allein über den NAMEN, s.
 * Shadows.NIE_WERFEN). Übernimmt es umgekehrt die Kollision NICHT, sieht
 * man gar nichts: Die Treppe sieht aus wie immer, die Figur bleibt an der
 * ersten Stufe stehen.
 *
 * Geprüft wird deshalb der ganze Weg, an echten Produktivklassen:
 * AssetManager.getMasters() → EntityManager.applyStatic()/flush() →
 * `colliderSpecs`. Das GLB selbst kann hier nicht geladen werden (assets/
 * liegt ausserhalb des Repos), der Prototyp ist deshalb synthetisch: ein
 * Container mit `Sichtbar` (Würfel, 12 Dreiecke) und `Treppe_col`
 * (Rampe, 2 Dreiecke), untergehängt an einen verschobenen Elternknoten —
 * damit auch das Wegbacken der Hierarchie in `localMatrix` mitgeprüft wird.
 *
 *   (a) Der `_col`-Master ist unsichtbar, nicht pickbar und KEIN
 *       Schattenwerfer (echte Shadows-Instanz, nicht der Regex).
 *   (b) Der Collider-Spec enthält NUR die `_col`-Dreiecke.
 *   (c) Ohne `_col`-Mesh bleibt alles wie zuvor: Spec aus dem Sichtbaren.
 *
 * Lauf:  npx tsx client/test/kollisionsnetz.ts
 */

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
// Seiteneffekt-Import wie im Client: ohne ihn fehlen die thinInstance*-
// Methoden am Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import type { KollisionsForm } from '@wov/shared';
import { AssetManager } from '../src/engine/AssetManager';
import { EntityManager } from '../src/entities/EntityManager';
import { Shadows, schattenKonfiguration } from '../src/engine/Shadows';
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

// ── Synthetischer Prototyp ───────────────────────────────────────────
// Der Elternknoten steht bewusst NICHT im Ursprung: `zuMaster()` bäckt
// seine Transformation in `localMatrix`, und `buildMeshCollider()` muss
// sie beim Zusammentragen der Dreiecke anwenden. Ohne diesen Versatz
// wäre ein vergessenes `local` im Test unsichtbar.
const ELTERN_Y = 4;
/** Höhenband der Rampe im Prototyp, VOR dem Elternversatz. */
const RAMPE_Y = [0, 1] as const;

function wuerfel(name: string, sz: Scene): Mesh {
  const m = new Mesh(name, sz);
  const d = new VertexData();
  const p: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push(x, y + 3, z);
  d.positions = p;
  // 6 Seiten à 2 Dreiecke — die Wicklung ist für die Kollision egal.
  d.indices = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
    2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  d.applyToMesh(m);
  return m;
}

/** Rampe: zwei Dreiecke, die von y=0 auf y=1 steigen. */
function rampe(name: string, sz: Scene): Mesh {
  const m = new Mesh(name, sz);
  const d = new VertexData();
  d.positions = [
    -1, RAMPE_Y[0], -1,
    1, RAMPE_Y[0], -1,
    -1, RAMPE_Y[1], 1,
    1, RAMPE_Y[1], 1,
  ];
  d.indices = [0, 1, 2, 1, 3, 2];
  d.applyToMesh(m);
  return m;
}

/**
 * Einen geladenen Container vortäuschen. Der Ladeweg (SceneLoader, HTTP)
 * ist das EINZIGE, was hier ersetzt wird — alles danach ist Produktivcode.
 */
function stelleContainerBereit(assets: AssetManager, name: string, mitCol: boolean): void {
  const wurzel = new TransformNode(`${name}_wurzel`, scene);
  wurzel.position.set(0, ELTERN_Y, 0);
  const sichtbar = wuerfel('Sichtbar', scene);
  sichtbar.material = new PBRMaterial(`${name}_stein`, scene);
  sichtbar.parent = wurzel;
  const meshes: Mesh[] = [sichtbar];
  if (mitCol) {
    const col = rampe('Treppe_col', scene);
    col.material = new PBRMaterial('Kollision', scene);
    col.parent = wurzel;
    meshes.push(col);
  }
  const container = new AssetContainer(scene);
  container.meshes.push(...meshes);
  container.transformNodes.push(wurzel);
  container.removeAllFromScene();
  (
    assets as unknown as { containers: Map<string, Promise<AssetContainer | null>> }
  ).containers.set(name, Promise.resolve(container));
}

/** Eine statische Instanz setzen (applyStatic ist privat — bewusst). */
function setze(mgr: EntityManager, prefab: string, modell: string, hash: number): void {
  const u: ZDOEntityUpdate = {
    key: `${prefab}-1`,
    prefabHash: hash,
    // Weit weg vom Kollisionsfenster: Der SPEC wird trotzdem gebaut (das
    // ist der Prüfgegenstand), nur legt StaticColliderSet.sync() keine
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
 * Die einzige Kollisionsform des Managers, samt Höhen und Dreiecken.
 *
 * Seit dem 10.09.2026 ist das eine {@link KollisionsForm} aus `shared`
 * und kein Babylon-`Mesh` mehr: Der Server braucht dieselbe Form und
 * kennt Babylon nicht. Die Frage bleibt dieselbe — welche Dreiecke sind
 * drin, und auf welcher Höhe liegen sie.
 */
function specGeometrie(mgr: EntityManager): { tris: number; ys: number[] } | null {
  const formen = [...mgr.colliderSpecs.values()] as KollisionsForm[];
  if (formen.length !== 1) return null;
  const form = formen[0]!;
  if (form.art !== 'netz') return null;
  const ys: number[] = [];
  for (let i = 1; i < form.positionen.length; i += 3) ys.push(form.positionen[i]!);
  return { tris: form.indizes.length / 3, ys };
}

async function main(): Promise<void> {
  // ── (a)+(b) Prototyp MIT Kollisionsnetz ────────────────────────────
  console.log('Prototyp MIT `_col`-Mesh:');
  const assets = new AssetManager(scene);
  stelleContainerBereit(assets, 'MitCol', true);
  const masters = await assets.getMasters('MitCol');
  const koll = masters.filter((m) => m.nurKollision);
  const sichtbar = masters.filter((m) => !m.nurKollision);
  pruefe(koll.length === 1 && sichtbar.length === 1, 'ein Kollisions- und ein Render-Master');
  const colMesh = koll[0]?.mesh;
  pruefe(colMesh?.isVisible === false, '`_col`-Master ist unsichtbar');
  pruefe(colMesh?.isPickable === false, '`_col`-Master ist nicht pickbar');
  pruefe(sichtbar[0]?.mesh.isVisible !== false, 'der sichtbare Master bleibt sichtbar');

  // Kein Schattenwerfer — an der echten Shadows-Instanz gemessen, nicht an
  // einer im Test nachgebauten Regel.
  //
  // Gefragt wird `darfWerfen()` direkt statt über `meldeWerfer()`: Der
  // öffentliche Weg braucht einen CascadedShadowGenerator, und den lehnt
  // die NullEngine ab ("CascadedShadowMap is not supported by the current
  // engine"). `darfWerfen()` IST die Entscheidung — beide Anmeldewege
  // (nimmAuf und werferNeuBestimmen) fragen nichts anderes.
  const sonne = new DirectionalLight('sonne', new Vector3(-1, -2, -1), scene);
  const schatten = new Shadows(scene, sonne);
  const cfg = schattenKonfiguration(2, false)!;
  const darfWerfen = (m: Mesh): boolean =>
    (
      schatten as unknown as { darfWerfen: (m: Mesh, c: typeof cfg) => boolean }
    ).darfWerfen(m, cfg);
  pruefe(!!colMesh && !darfWerfen(colMesh), 'Shadows nimmt den `_col`-Master NICHT als Werfer');
  pruefe(
    !!sichtbar[0] && darfWerfen(sichtbar[0].mesh),
    'Shadows nimmt den sichtbaren Master sehr wohl als Werfer'
  );

  const mgr = new EntityManager(scene, null as never, assets, null as never);
  mgr.enablePhysics();
  setze(mgr, 'Grabhuegel_Kollisionstest', 'MitCol', 990001);
  await warte();
  mgr.flush();
  const mit = specGeometrie(mgr);
  pruefe(mit !== null, 'ein Mesh-Collider-Spec ist entstanden');
  pruefe(mit?.tris === 2, `Spec enthält NUR die 2 Rampendreiecke (ist: ${mit?.tris})`);
  const soll = [RAMPE_Y[0] + ELTERN_Y, RAMPE_Y[1] + ELTERN_Y];
  pruefe(
    !!mit && mit.ys.every((y) => y >= soll[0]! - 1e-4 && y <= soll[1]! + 1e-4),
    `alle Spec-Höhen liegen im Rampenband ${soll[0]}..${soll[1]} ` +
      `(ist: ${mit ? [...new Set(mit.ys)].sort().join(', ') : '—'}) — ` +
      `der Elternversatz ist mitgebacken`
  );

  // ── (c) Prototyp OHNE Kollisionsnetz: unverändertes Verhalten ──────
  console.log('Prototyp OHNE `_col`-Mesh (Regressionswache):');
  const assets2 = new AssetManager(scene);
  stelleContainerBereit(assets2, 'OhneCol', false);
  const masters2 = await assets2.getMasters('OhneCol');
  pruefe(
    masters2.length === 1 && !masters2[0]!.nurKollision,
    'genau ein Master, und der ist kein Kollisionsnetz'
  );
  const mgr2 = new EntityManager(scene, null as never, assets2, null as never);
  mgr2.enablePhysics();
  setze(mgr2, 'Grabhuegel_Kollisionstest2', 'OhneCol', 990002);
  await warte();
  mgr2.flush();
  const ohne = specGeometrie(mgr2);
  pruefe(ohne?.tris === 12, `Spec kommt aus dem sichtbaren Würfel, 12 Dreiecke (ist: ${ohne?.tris})`);

  console.log(
    fehler === 0
      ? '\nOK — `_col` ersetzt die Kollision, bleibt aus Bild und Schattenkarte'
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
