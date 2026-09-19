/**
 * Schatten: Laub-Klone brauchen die Vorlage des Farbpasses (G20).
 *
 * Ein Vegetationsklon (`layerMask 0`) wird nie im Farbpass gezeichnet.
 * Babylons `ShadowDepthWrapper` baut den Tiefen-Shader aber aus dem Effekt,
 * den das Basismaterial im Farbpass fuer genau diesen Sub-Mesh anlegt. Ohne
 * den Aufruf `meldeKlonAnBasisEffekt` blieb `generator.isReady()` fuer jedes
 * Laub-Material dauerhaft `false` (gemessen 18.09.2026: 0 von 17 Klonen bereit,
 * Laubschatten 0,005 % gegen 10,68 % der Bildflaeche). Drei Zusicherungen:
 *
 *  1. Der Aufruf legt die Vorlage im Wrapper an, sonst nicht (NullEngine).
 *  2. Die Quelle wirft WEITER, bis der Klon bereit ist, und gibt erst dann
 *     ab. Sonst stuende das Laub in der Zwischenzeit ohne Werfer da.
 *  3. Ein wartender Klon ohne Instanzen wird nicht angemeldet (der
 *     Basis-Effekt entstuende ohne INSTANCES-Define).
 *
 * Lauf: npx tsx client/test/schatten-laub-klon.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShadowDepthWrapper } from '@babylonjs/core/Materials/shadowDepthWrapper';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { zellMeshAusPrototyp } from '../src/entities/EntityManager';
import { Shadows, meldeKlonAnBasisEffekt } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten G20: Laub-Klone');
const EINHEIT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Ein Prototyp mit UVs (Alphatest) und optionalem Tiefen-Wrapper. */
function prototyp(scene: Scene, name: string, mitWrapper: boolean): Mesh {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = [0, 0, 1, 0, 0, 1];
  vd.applyToMesh(m);
  const material = new PBRMaterial(`${name}_mat`, scene);
  if (mitWrapper) material.shadowDepthWrapper = new ShadowDepthWrapper(material, scene);
  m.material = material;
  return m;
}

/** Was der Wrapper ueber einen Sub-Mesh weiss (private Tabelle von Babylon). */
function wrapperKenntSubMesh(m: Mesh): boolean {
  const w = m.material?.shadowDepthWrapper as unknown as { _subMeshToEffect: Map<unknown, unknown> } | undefined;
  return !!w && w._subMeshToEffect.has(m.subMeshes[0]);
}


// ── G20.1 Der Aufruf legt die Vorlage im Wrapper an ──────────────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const laub = prototyp(scene, 'leaves', true);
  const klon = zellMeshAusPrototyp(laub, 'schattenVegetation_1_leaves', scene);
  klon.thinInstanceSetBuffer('matrix', EINHEIT, 16, false);
  pruefe(!wrapperKenntSubMesh(klon), 'der Wrapper kannte den Klon schon vor dem Aufruf — der Test misst nichts');
  pruefe(meldeKlonAnBasisEffekt(klon) === true, 'ein Klon mit Wrapper meldet „nichts zu tun"');
  pruefe(
    wrapperKenntSubMesh(klon),
    'nach meldeKlonAnBasisEffekt hat der Wrapper keine Vorlage fuer den Klon — Laub wirft dauerhaft nichts (G20)'
  );

  const fels = prototyp(scene, 'rock', false);
  const felsKlon = zellMeshAusPrototyp(fels, 'schattenVegetation_2_rock', scene);
  pruefe(meldeKlonAnBasisEffekt(felsKlon) === false, 'ein Klon OHNE Wrapper braucht keine Vorlage, meldet aber eine');
  scene.dispose();
  engine.dispose();
}

// ── G20.2 Die Quelle wirft weiter, bis der Klon bereit ist ───────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sonne = new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene);
  const shadows = new Shadows(scene, sonne);

  // Ein Generator nur so weit, wie Shadows ihn anfasst — der echte laeuft
  // nicht ohne GPU. `bereit` steuert, was `isReady` meldet.
  const liste: Mesh[] = [];
  const fake = {
    bereit: false,
    freezeShadowCastersBoundingInfo: false,
    numCascades: 2,
    shadowMaxZ: 50,
    addShadowCaster: (m: Mesh) => {
      if (!liste.includes(m)) liste.push(m);
    },
    getShadowMap: () => ({
      get renderList() {
        return liste;
      },
      set renderList(neu: Mesh[]) {
        liste.length = 0;
        liste.push(...neu);
      },
    }),
    isReady: () => fake.bereit,
    dispose: () => undefined,
  };
  const intern = shadows as unknown as { generator: unknown; stufe: number };
  intern.generator = fake;
  intern.stufe = 2;

  const laub = prototyp(scene, 'leaves_a', true);
  const matrizen = new Float32Array(16 * 3);
  for (let i = 0; i < 3; i++) {
    matrizen.set(EINHEIT, i * 16);
    matrizen[i * 16 + 12] = i * 2;
  }
  shadows.setVegetationsInstanzen(laub, matrizen);
  shadows.setPlayerPosition(0, 0);
  const klon = scene.meshes.find((m) => m.name.startsWith('schattenVegetation_')) as Mesh | undefined;
  pruefe(klon !== undefined, 'kein Schattenklon angelegt');

  shadows.tick();
  pruefe(shadows.vegetationsSchattenStats().aktiv === 3, `Klon nicht gepackt: aktiv ${shadows.vegetationsSchattenStats().aktiv}`);
  pruefe(
    liste.includes(laub),
    'die Quelle wurde abgemeldet, obwohl der Klon noch nicht werfen kann — das Laub steht ohne Schatten da (G20)'
  );
  pruefe(wrapperKenntSubMesh(klon!), 'beim Packen wurde die Vorlage nicht angemeldet');

  fake.bereit = true;
  shadows.tick();
  pruefe(!liste.includes(laub), 'die Quelle wirft weiter, obwohl der Klon bereit ist — Doppelwurf');
  pruefe(liste.includes(klon!), 'der bereite Klon ist nicht in der Werferliste');

  // Zweiter Durchlauf: ein bereits bereiter Klon wird beim Neupacken ohne
  // Umweg uebernommen (kein erneutes Warten, keine Luecke).
  shadows.setVegetationsInstanzen(laub, matrizen);
  shadows.tick();
  shadows.tick();
  pruefe(!liste.includes(laub) && liste.includes(klon!), 'nach dem Neupacken wirft nicht allein der Klon');

  // Ein wartender Klon ohne Instanzen (Spieler weit weg) wird NICHT angemeldet:
  // Der Basis-Effekt entstuende ohne INSTANCES-Define.
  {
    fake.bereit = false;
    const laubB = prototyp(scene, 'leaves_b', true);
    shadows.setVegetationsInstanzen(laubB, matrizen);
    shadows.tick();
    pruefe(shadows.vegetationsSchattenStats().tiefeWartend === 1, 'ein neuer Klon wartet nicht auf seinen Shader');
    shadows.setPlayerPosition(9000, 9000); // alle Instanzen fallen aus dem Ring
    shadows.tick();
    // Schon nach EINEM Tick: Der Klon verlaesst die Warteliste beim Packen,
    // nicht erst im naechsten Durchlauf (dort wuerde er noch einmal angemeldet).
    pruefe(
      shadows.vegetationsSchattenStats().tiefeWartend === 0,
      'ein Klon, dessen Instanzen ausfallen, bleibt bis zum naechsten Tick in der Warteliste'
    );
    shadows.tick();
    const st = shadows.vegetationsSchattenStats();
    pruefe(st.aktiv === 0, `Klone halten Instanzen ausserhalb des Rings: aktiv ${st.aktiv}`);
    pruefe(st.tiefeWartend === 0, 'ein Klon ohne Instanzen wartet weiter auf seinen Shader');
    const vor = st.tiefeAnmeldungen;
    shadows.tick();
    shadows.tick();
    pruefe(
      shadows.vegetationsSchattenStats().tiefeAnmeldungen === vor,
      'ein Klon ohne Instanzen wird bei jedem Bild angemeldet'
    );
    fake.bereit = true;
  }

  intern.generator = null;
  shadows.dispose();
  scene.dispose();
  engine.dispose();
}


if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchatten G20: Vorlage angemeldet, Uebergabe erst bei Bereitschaft, keine Anmeldung ohne Instanzen gruen.');
