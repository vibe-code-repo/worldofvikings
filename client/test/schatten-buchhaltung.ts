/**
 * Schatten: Buchhaltung der Vegetationsmaster (G16).
 *
 * Zwei Fehler derselben Familie — die Buchung im Schattensystem sagte etwas
 * anderes als der Master im Bild:
 *
 *  (a) Wechselt ein Vegetations-Bucket vom Voll- in den Zellbetrieb, schaltet
 *      `baueZellMaster()` die Prototypen ab, meldete das dem Schattensystem
 *      aber nicht: Der Vollmaster behielt Buchung, Klon und `bereit` und warf
 *      Schatten fuer einen Bestand, den er nicht mehr zeichnete.
 *  (b) `setVegetationsInstanzen(quelle, null)` legte auch fuer einen leeren
 *      Master einen Eintrag samt Klon (eigene GPU-Geometrie) an — die
 *      Dick-Variante im 100-FPS-Profil meldet bei jedem Neuaufbau `null`.
 *
 * Der Zellschnitt ist derzeit geparkt (`ZELL_SCHNITT_AB` = MAX_SAFE_INTEGER),
 * (a) tritt im Spiel also nicht auf; der Test haelt die Invariante fest, wie
 * `schatten-master-vergessen.ts` es fuer das Entsorgen tut.
 *
 * Ohne Generator und ohne Szene des Spiels gerechnet: `Shadows` mit einer
 * Attrappe des Generators (der echte laeuft nicht auf der NullEngine), der
 * EntityManager ueber den Rumpf von `baueZellMaster` mit einem Stellvertreter
 * als `this`.
 *
 * Lauf: npx tsx client/test/schatten-buchhaltung.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { FOLIAGE_HASHES } from '../../shared/src/vegetation.js';
import { EntityManager } from '../src/entities/EntityManager';
import { Shadows } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten G16: Buchhaltung der Vegetationsmaster');

function prototyp(scene: Scene, name: string): Mesh {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.applyToMesh(m);
  return m;
}

/** Einheitsmatrizen, spaltenweise wie Babylon, n Stueck im Abstand von 2 m. */
function matrizen(n: number): Float32Array {
  const f = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    f[o] = 1;
    f[o + 5] = 1;
    f[o + 10] = 1;
    f[o + 15] = 1;
    f[o + 12] = i * 2;
  }
  return f;
}

const klone = (scene: Scene): Mesh[] =>
  scene.meshes.filter((m) => m.name.startsWith('schattenVegetation_')) as Mesh[];

/** Ein Generator nur so weit, wie Shadows ihn anfasst — s. schatten-laub-klon.ts. */
function mitAttrappe(shadows: Shadows): Mesh[] {
  const liste: Mesh[] = [];
  const fake = {
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
    isReady: () => true,
    dispose: () => undefined,
  };
  const intern = shadows as unknown as { generator: unknown; stufe: number };
  intern.generator = fake;
  intern.stufe = 2;
  return liste;
}

// ── (b) Ein leerer Master bekommt weder Eintrag noch Klon ────────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  mitAttrappe(shadows);
  const leer = prototyp(scene, 'leaves_leer');
  const vorher = scene.meshes.length;

  shadows.setVegetationsInstanzen(leer, null);
  pruefe(shadows.vegetationsSchattenStats().master === 0, 'null fuer einen leeren Master legt einen Eintrag an (G16 b)');
  pruefe(klone(scene).length === 0, 'null fuer einen leeren Master legt einen Klon mit eigener GPU-Geometrie an (G16 b)');

  shadows.setVegetationsInstanzen(leer, new Float32Array(0));
  pruefe(shadows.vegetationsSchattenStats().master === 0, 'ein leerer Puffer legt einen Eintrag an (G16 b)');
  pruefe(scene.meshes.length === vorher, `die Szene ist gewachsen: ${vorher} -> ${scene.meshes.length} Meshes`);

  // Kommt der Master spaeter mit Instanzen, entsteht der Eintrag dann.
  shadows.setVegetationsInstanzen(leer, matrizen(3));
  pruefe(shadows.vegetationsSchattenStats().master === 1, 'ein Master mit Instanzen bekommt keinen Eintrag mehr (Rueckfall)');

  shadows.dispose();
  scene.dispose();
  engine.dispose();
}

// ── (a) Shadows: null leert die Buchung eines bekannten Masters ───────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  const liste = mitAttrappe(shadows);
  const voll = prototyp(scene, 'leaves_voll');
  shadows.setVegetationsInstanzen(voll, matrizen(4));
  shadows.setPlayerPosition(0, 0);
  shadows.tick();
  const klon = klone(scene)[0]!;
  pruefe(shadows.vegetationsSchattenStats().aktiv === 4 && klon.isEnabled(), 'Vorbedingung: der Klon traegt 4 Instanzen');

  shadows.setVegetationsInstanzen(voll, null);
  shadows.tick();
  const st = shadows.vegetationsSchattenStats();
  pruefe(st.gesamt === 0 && st.aktiv === 0, `die Buchung ist nicht leer: gesamt ${st.gesamt}, aktiv ${st.aktiv}`);
  pruefe(!klon.isEnabled() && klon.thinInstanceCount === 0, 'der Klon wirft weiter, obwohl der Master nichts mehr traegt');
  pruefe(!liste.some((m) => m.isEnabled() && m.thinInstanceCount > 0), 'ein Werfer mit Instanzen steht in der Liste');

  shadows.dispose();
  scene.dispose();
  engine.dispose();
}

// ── (a) EntityManager: der Wechsel in den Zellbetrieb meldet null ─────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const proto = [prototyp(scene, 'leaves_a'), prototyp(scene, 'leaves_b')];
  for (const p of proto) {
    p.thinInstanceSetBuffer('matrix', matrizen(3), 16, false);
    p.setEnabled(true);
  }
  const hash = [...FOLIAGE_HASHES][0]!;
  const gemeldet: Array<[Mesh, Float32Array | null]> = [];
  // Nur, was der Rumpf von baueZellMaster bei einem Bucket ohne sichtbare
  // Instanzen anfasst.
  const em = {
    vegetationsSchattenEmpfaenger: (mesh: Mesh, m: Float32Array | null) => gemeldet.push([mesh, m]),
    meldeVegetationsSchatten: (EntityManager.prototype as unknown as Record<string, unknown>).meldeVegetationsSchatten,
    zellMaster: new Map(),
    zellPool: new Map(),
    impostoren: null,
    spielerBekannt: false,
    impostorGrenze: 100,
    toenungAn: false,
  };
  const bucket = { prefabHash: hash, prefabName: 'Beech1' };
  const baueZellMaster = (EntityManager.prototype as unknown as Record<string, unknown>).baueZellMaster as (
    b: unknown,
    masters: Mesh[],
    locals: Matrix[],
    zdoMats: Matrix[]
  ) => void;
  baueZellMaster.call(em, bucket, proto, [], []);

  pruefe(
    proto.every((p) => !p.isEnabled() && p.thinInstanceCount === 0),
    'die Prototypen wurden im Zellbetrieb nicht abgeschaltet — Vorbedingung des Tests'
  );
  pruefe(
    proto.every((p) => gemeldet.some(([m, daten]) => m === p && daten === null)),
    `der Wechsel in den Zellbetrieb meldet dem Schattensystem kein null fuer den Vollmaster (gemeldet: ${gemeldet.length}) — die Buchung samt Klon bleibt stehen (G16 a)`
  );

  // Ein Bucket, der kein Laub ist, bleibt ausserhalb der Meldung.
  gemeldet.length = 0;
  baueZellMaster.call(em, { prefabHash: -1, prefabName: 'Stein' }, proto, [], []);
  pruefe(gemeldet.length === 0, 'ein Bucket ohne Laubhash wurde dem Schattensystem gemeldet');

  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchatten G16: leerer Master ohne Eintrag, Zellbetrieb leert die Buchung.');
