/**
 * Schatten: kleine Werfer faellt ab einer groessenabhaengigen Entfernung aus
 * der Werferliste (FPS-Welle, Karte 2/3, nach fps-analyse.md Rang 3).
 *
 * Jede Kaskade zeichnet die komplette Werferliste erneut; im Startdorf sind
 * 196 Aufrufe je Bild allein im Schattenpass gemessen, ein Grossteil davon
 * Bauwerksteile (`U_*_primitive`). Ihr Schatten ist ab einer gewissen
 * Entfernung im Bild nicht mehr auszumachen. `darfWerfen()` bekommt darum
 * eine zweite, groessenabhaengige Reichweite: Huellkugelradius < 1 m ab 30 m,
 * < 3 m ab 60 m (KLEINWERFER_… / MITTELWERFER_… in Shadows.ts).
 *
 * Vier Zusicherungen:
 *  1. `darfWerfen()` selbst: klein+fern faellt heraus, klein+nah bleibt drin,
 *     gross bleibt bis zur normalen Kaskadendistanz drin (isolierte Aufrufe,
 *     kein Generator noetig).
 *  2. Der volle Kreislauf ueber `tick()`/`setPlayerPosition()`: ein kleiner
 *     Werfer verlaesst beim Entfernen die renderList und kommt beim
 *     Naehern zurueck — ohne dass irgendwo eine Anlage je Bild noetig war
 *     (die Entscheidung faellt weiter nur im Werferlisten-Scan, s. tick()).
 *  3. Die G20-Klon-Huelle ist nach dem Packen immer groesser als
 *     MITTELWERFER_RADIUS_M — die neue Regel greift dort nie.
 *  4. B1-Regression (Nachangriff #105 N1): ein aufgegebener Klon bleibt nach
 *     einem Neubestimmen der Werferliste OHNE Neupacken (setDistantShadows)
 *     aus der renderList ausgeschlossen und kommt erst nach einer echten,
 *     erfolgreichen Uebergabe zurueck.
 *
 * Lauf: npx tsx client/test/schatten-werfer-groesse.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {
  Shadows,
  KLEINWERFER_RADIUS_M,
  KLEINWERFER_REICHWEITE_M,
  MITTELWERFER_RADIUS_M,
  MITTELWERFER_REICHWEITE_M,
  type ShadowLevel,
} from '../src/engine/Shadows';
import { SicherTiefenWrapper } from '../src/engine/ShadowDepthWrapperSicher';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten: kleine Werfer faellt ab Entfernung heraus');

/** Wie im ausgelieferten Look (Stufe 2): vier Kaskaden, 150 m Reichweite. */
const CFG: ShadowLevel = { kaskaden: 4, distanz: 150, aufloesung: 2048 };

/**
 * Mesh mit EXAKTEM Huellkugelradius, an gegebener x/z-Position.
 *
 * Eine echte Kugelgeometrie taugt hier nicht: Babylon berechnet die
 * Huellkugel aus der Bounding-Box (Radius = halbe Raumdiagonale), das gibt
 * bei einer UV-Kugel mit geometrischem Radius R den Wert R*sqrt(3), nicht R
 * (nachgemessen: R=2 ergab radiusWorld 3,46). Eine entartete, eindimensionale
 * Box (nur auf der x-Achse ausgedehnt) liefert stattdessen exakt R.
 */
function kugel(scene: Scene, name: string, radius: number, x: number, z: number): Mesh {
  const m = new Mesh(name, scene);
  m.setBoundingInfo(new BoundingInfo(new Vector3(-radius, 0, 0), new Vector3(radius, 0, 0)));
  m.position.set(x, 0, z);
  m.computeWorldMatrix(true);
  return m;
}

type Intern = {
  darfWerfen(mesh: Mesh, cfg: ShadowLevel): boolean;
  letzteX: number;
  letzteZ: number;
};

// ── 1. darfWerfen(): klein+fern faellt heraus, klein+nah bleibt drin ────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  const intern = shadows as unknown as Intern;
  intern.letzteX = 0;
  intern.letzteZ = 0;

  // Klein (r < 1 m): faellt exakt an KLEINWERFER_REICHWEITE_M heraus.
  const kleinNah = kugel(scene, 'propFass', 0.5, KLEINWERFER_REICHWEITE_M - 5, 0);
  pruefe(intern.darfWerfen(kleinNah, CFG), `kleiner Werfer ${KLEINWERFER_REICHWEITE_M - 5} m entfernt (< ${KLEINWERFER_REICHWEITE_M} m) faellt faelschlich heraus`);
  const kleinFern = kugel(scene, 'propFass2', 0.5, KLEINWERFER_REICHWEITE_M + 5, 0);
  pruefe(!intern.darfWerfen(kleinFern, CFG), `kleiner Werfer ${KLEINWERFER_REICHWEITE_M + 5} m entfernt (> ${KLEINWERFER_REICHWEITE_M} m) bleibt faelschlich drin`);

  // Mittel (1 m <= r < 3 m): erst an MITTELWERFER_REICHWEITE_M heraus, nicht schon an KLEINWERFER_REICHWEITE_M.
  const mittelZwischen = kugel(scene, 'propKarren', 2, KLEINWERFER_REICHWEITE_M + 5, 0);
  pruefe(
    intern.darfWerfen(mittelZwischen, CFG),
    `Werfer mit r=2 m bei ${KLEINWERFER_REICHWEITE_M + 5} m faellt schon an der Kleinwerfer-Grenze heraus — die Groessenstufen sind vertauscht`
  );
  const mittelFern = kugel(scene, 'propKarren2', 2, MITTELWERFER_REICHWEITE_M + 5, 0);
  pruefe(!intern.darfWerfen(mittelFern, CFG), `Werfer mit r=2 m bei ${MITTELWERFER_REICHWEITE_M + 5} m (> ${MITTELWERFER_REICHWEITE_M} m) bleibt faelschlich drin`);

  // Gross (r >= 3 m): die neue Regel greift nie, nur die normale Kaskadendistanz.
  const grossFern = kugel(scene, 'propHaus', MITTELWERFER_RADIUS_M, MITTELWERFER_REICHWEITE_M + 20, 0);
  pruefe(
    intern.darfWerfen(grossFern, CFG),
    `Werfer mit r=${MITTELWERFER_RADIUS_M} m bei ${MITTELWERFER_REICHWEITE_M + 20} m faellt trotz Kaskadendistanz ${CFG.distanz} m heraus — die neue Regel wirkt auf grosse Werfer`
  );
  const grossAusserKaskade = kugel(scene, 'propHaus2', 10, CFG.distanz + 30, 0);
  pruefe(
    !intern.darfWerfen(grossAusserKaskade, CFG),
    'ein grosser Werfer ausserhalb der Kaskadendistanz bleibt drin — die alte Kaskadenregel ist kaputtgegangen'
  );

  // Randwert exakt an der Grenze: <= gilt als drin (wie bei der Kaskadendistanz oben).
  const kleinGenauGrenze = kugel(scene, 'propGrenze', 0.5, KLEINWERFER_REICHWEITE_M, 0);
  pruefe(intern.darfWerfen(kleinGenauGrenze, CFG), `kleiner Werfer genau bei ${KLEINWERFER_REICHWEITE_M} m faellt heraus — die Grenze soll noch drin sein (>, nicht >=)`);

  scene.dispose();
  engine.dispose();
}

// ── 2. Voller Kreislauf: renderList folgt der Spielerposition ───────────
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  const liste: Mesh[] = [];
  const fake = {
    freezeShadowCastersBoundingInfo: false,
    numCascades: CFG.kaskaden,
    shadowMaxZ: CFG.distanz,
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

  const propFass = kugel(scene, 'propFassKreislauf', 0.5, 0, 0);
  shadows.setPlayerPosition(0, 0);
  shadows.tick();
  pruefe(liste.includes(propFass), 'Vorbedingung: der kleine Werfer wirft neben dem Spieler noch nicht');

  // Weit genug weg fuer einen Rescan (> NACHFUEHR_ABSTAND) UND ueber die Kleinwerfer-Reichweite hinaus.
  shadows.setPlayerPosition(KLEINWERFER_REICHWEITE_M + 10, 0);
  shadows.tick();
  pruefe(!liste.includes(propFass), `kleiner Werfer faellt beim Entfernen (${KLEINWERFER_REICHWEITE_M + 10} m) nicht aus der renderList`);

  // Zurueck in Reichweite.
  shadows.setPlayerPosition(KLEINWERFER_REICHWEITE_M - 10, 0);
  shadows.tick();
  pruefe(liste.includes(propFass), 'kleiner Werfer kommt beim Naehern nicht in die renderList zurueck');

  scene.dispose();
  engine.dispose();
}

/** Quelle + gepackter Klon (3 Instanzen), wie in schatten-wrapper-sicher.ts. */
function bauSchattenSzene() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
  const liste: Mesh[] = [];
  const fake = {
    bereit: true,
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
  const laub = new Mesh('laub_q', scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.uvs = [0, 0, 1, 0, 0, 1];
  vd.applyToMesh(laub);
  const material = new PBRMaterial('laub_q_mat', scene);
  material.shadowDepthWrapper = new SicherTiefenWrapper(material, scene, { doNotInjectCode: true });
  laub.material = material;
  const matrizen = new Float32Array(16 * 3);
  for (let i = 0; i < 3; i++) {
    matrizen.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
    matrizen[i * 16 + 12] = i * 2;
  }
  shadows.setVegetationsInstanzen(laub, matrizen);
  shadows.setPlayerPosition(0, 0);
  const klon = scene.meshes.find((m) => m.name.startsWith('schattenVegetation_')) as Mesh;
  shadows.tick();
  shadows.tick();
  return { engine, scene, shadows, fake, liste, laub, klon };
}

// ── 3. Die G20-Klon-Huelle bleibt ausserhalb der neuen Regel ────────────
{
  const { engine, scene, liste, laub, klon } = bauSchattenSzene();
  pruefe(klon !== undefined, 'Ausgangslage falsch: kein Klon gepackt');
  const r = klon.getBoundingInfo().boundingSphere.radiusWorld;
  pruefe(r >= MITTELWERFER_RADIUS_M, `Klon-Huelle nach dem Packen ist ${r.toFixed(2)} m — unter MITTELWERFER_RADIUS_M (${MITTELWERFER_RADIUS_M} m) wuerde die neue Regel Klone treffen`);
  pruefe(liste.includes(klon) && !liste.includes(laub), 'Klon wirft nach dem Packen nicht allein — Ausgangslage fuer die Huellenpruefung falsch');
  scene.dispose();
  engine.dispose();
}

// ── 4. B1-Regression: aufgegebener Klon bleibt nach Rescan ohne Neupacken draussen ──
{
  const { engine, scene, shadows, fake, liste, laub, klon } = bauSchattenSzene();
  const material = klon.material as PBRMaterial;
  material.resetDrawCache();
  fake.bereit = false;
  // Wie in schatten-wrapper-sicher.ts 7b: bis TIEFE_MAX_VERSUCHE (1200) aufgeben, 20 Bilder Luft.
  for (let i = 0; i < 1220; i++) shadows.tick();
  pruefe(!liste.includes(klon), 'Vorbedingung: der aufgegebene Klon steht noch in der renderList');
  pruefe(liste.includes(laub), 'Vorbedingung: die Quelle wirft nach dem Aufgeben nicht weiter');

  // Neubestimmen OHNE Neupacken: setDistantShadows durchsucht scene.meshes
  // erneut ueber darfWerfen(), ruehrt vegetationsPackPending aber nicht an.
  shadows.setDistantShadows(false);
  shadows.tick();
  shadows.tick();
  pruefe(
    !liste.includes(klon),
    'B1: ein aufgegebener Klon ist nach setDistantShadows (Rescan ohne Neupacken) wieder in der renderList — droht Doppelwurf mit der Quelle'
  );
  pruefe(liste.includes(laub), 'B1: die Quelle wirft nach dem Rescan nicht mehr, obwohl der Klon weiter aufgegeben ist');

  // Ein zweiter Rescan ohne Neupacken aendert daran nichts (keine einmalige Ausnahme).
  shadows.setDistantShadows(true);
  shadows.tick();
  shadows.tick();
  pruefe(!liste.includes(klon), 'B1: ein zweiter Rescan ohne Neupacken nimmt den aufgegebenen Klon doch noch auf');

  // Eine ECHTE Uebergabe (Neupacken, danach bereit) hebt die Sperre wieder auf.
  fake.bereit = true;
  shadows.setPlayerPosition(200, 0); // > NACHFUEHR_ABSTAND: packt alle Staende neu
  for (let i = 0; i < 5; i++) shadows.tick();
  pruefe(liste.includes(klon) && !liste.includes(laub), 'nach einer echten Uebergabe nach dem Neupacken bleibt der Klon gesperrt');

  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`\n✗ ${fehler} Fehler`);
  process.exit(1);
}
console.log('\n✓ Schatten: groessenabhaengige Werfer-Reichweite und B1-Regression gruen.');
