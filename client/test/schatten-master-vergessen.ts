/**
 * Wächter gegen Vegetations-Schattenleichen (Angreifer-Review 13.09.).
 *
 * ── Der Befund ───────────────────────────────────────────────────────
 * `Shadows` legt zu jedem Vegetationsmaster einen SCHATTENKLON mit
 * eigener GPU-Geometrie an und merkt sich beides in `vegetationsSchatten`
 * (s. setVegetationsInstanzen). Wird der Master entsorgt, räumte der
 * bisherige Rückkanal `entferneWerfer()` nur die Listen — der Eintrag
 * blieb stehen und wurde danach in jedem Bild mitgezählt und mitgepackt
 * (packeVegetationsMaster, die Radiusschleifen in setPlayerPosition,
 * vegetationsSchattenStats). Eine Leiche, die mit der Sitzungsdauer
 * wächst und in keinem Bild ein Symptom hat; kein Messlauf unter ein paar
 * Minuten sieht sie.
 *
 * ── Warum ein Test und kein Bild ─────────────────────────────────────
 * Ein Screenshot kann diesen Fehler prinzipiell nicht zeigen: Der Klon
 * ist abgeschaltet oder steht deckungsgleich auf demselben Fleck. Die
 * einzige belastbare Auskunft ist eine ZUSTANDSGRÖSSE —
 * `vegetationsSchattenStats().master`. Sie darf nach dem Entsorgen eines
 * Masters nicht stehenbleiben.
 *
 * ── Was hier NICHT behauptet wird ────────────────────────────────────
 * Dass der Fehler heute im Spiel auftritt. Er tut es nicht: Der
 * Rückkanal `onMasterEntsorgt` bekommt ausschliesslich ZELL-Master
 * (EntityManager.zellMeshFreigeben), und Zell-Master laufen nie durch
 * `meldeVegetationsSchatten()` — dort kommen nur die Vollmaster an.
 * Zusätzlich ist der Zellschnitt selbst geparkt (ZELL_SCHNITT_AB =
 * MAX_SAFE_INTEGER). Der Test hält die INVARIANTE fest, nicht ein
 * beobachtetes Symptom: Beide Bedingungen sind eine Zeile Code
 * voneinander entfernt, und wer sie ändert, hat keinen Grund, an diese
 * Buchführung zu denken.
 *
 * Ohne Generator gerechnet — CascadedShadowGenerator läuft nicht auf der
 * NullEngine, die Buchführung über die Vegetationsmaster schon.
 *
 * Lauf: npx tsx client/test/schatten-master-vergessen.ts
 */
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
// Seiteneffekt-Import wie im Client: ohne ihn fehlen die thinInstance*-
// Methoden am Mesh, obwohl die Typen sie kennen.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Shadows } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Vegetations-Schattenmaster: entsorgt heisst vergessen');

/** Ein Prototyp mit echter Geometrie — der Klon kopiert VertexData. */
function prototyp(scene: Scene, name: string): Mesh {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 2, 0];
  vd.indices = [0, 1, 2];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.applyToMesh(m);
  return m;
}

/** Einheitsmatrix je Instanz, spaltenweise wie Babylon. */
function matrizen(n: number): Float32Array {
  const f = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) {
    const o = i * 16;
    f[o] = 1; f[o + 5] = 1; f[o + 10] = 1; f[o + 15] = 1;
    f[o + 12] = i * 4;
  }
  return f;
}

{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const sonne = new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene);
  const shadows = new Shadows(scene, sonne);

  const a = prototyp(scene, 'leaves_a');
  const b = prototyp(scene, 'leaves_b');
  shadows.setVegetationsInstanzen(a, matrizen(3));
  shadows.setVegetationsInstanzen(b, matrizen(2));
  pruefe(shadows.vegetationsSchattenStats().master === 2, 'zwei Master wurden nicht aufgenommen');

  // ── 1. Poolen laesst den Klon stehen (das ist gewollt) ─────────────
  //
  // Ein gepoolter Master kommt mit DERSELBEN Geometrie zurueck; seinen
  // Klon jetzt wegzuwerfen hiesse, ihn gleich darauf neu hochzuladen.
  shadows.entferneWerfer(b);
  pruefe(
    shadows.vegetationsSchattenStats().master === 2,
    'entferneWerfer() hat einen gepoolten Master verworfen — beim Wiederbeleben faellt der Klon neu an'
  );

  // ── 2. Entsorgen raeumt Eintrag UND Klon ───────────────────────────
  const klonName = scene.meshes.find((m) => m.name.startsWith('schattenVegetation_') && m.name.endsWith('leaves_a'));
  pruefe(klonName !== undefined, 'kein Schattenklon zum Master angelegt');
  shadows.vergissMaster(a);
  a.dispose();
  pruefe(
    shadows.vegetationsSchattenStats().master === 1,
    'vegetationsSchattenStats().master blieb nach dem Entsorgen stehen — die Leiche waechst mit der Sitzung'
  );
  pruefe(klonName?.isDisposed() === true, 'der Schattenklon (eigene GPU-Geometrie) wurde nicht entsorgt');
  pruefe(
    !scene.meshes.some((m) => m.name.startsWith('schattenVegetation_') && m.name.endsWith('leaves_a')),
    'der Schattenklon steht weiter in der Szene'
  );

  // ── 3. Zweimal vergessen ist kein Fehler ───────────────────────────
  shadows.vergissMaster(a);
  pruefe(shadows.vegetationsSchattenStats().master === 1, 'der zweite Aufruf hat mitgezaehlt');

  // ── 4. Ein nie aufgenommenes Mesh darf nichts anrichten ────────────
  const fremd = new Mesh('terrain_0_0', scene);
  shadows.vergissMaster(fremd);
  pruefe(shadows.vegetationsSchattenStats().master === 1, 'ein fremdes Mesh hat die Buchfuehrung veraendert');

  shadows.dispose();
  scene.dispose();
  engine.dispose();
}

// ── 5. Die Verdrahtung ─────────────────────────────────────────────
//
// Punkt 2 prueft, dass Shadows richtig aufraeumt. Ob der EntityManager
// den Unterschied ueberhaupt MELDET, steht in einer anderen Datei, und
// `tsc` faengt davon nur das Fehlen des Parameters — nicht ein
// vertauschtes true/false. Deshalb hier als Textnachweis: billig, aber
// er wird rot, wenn jemand die beiden Faelle wieder zusammenlegt.
{
  const em = readFileSync(new URL('../src/entities/EntityManager.ts', import.meta.url), 'utf-8');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf-8');
  const entsorgt = em.match(/onMasterEntsorgt\?\.\(mesh, true\)/g)?.length ?? 0;
  const gepoolt = em.match(/onMasterEntsorgt\?\.\(mesh, false\)/g)?.length ?? 0;
  pruefe(entsorgt === 1, `genau EIN Entsorgungspfad erwartet, gefunden ${entsorgt}`);
  pruefe(gepoolt === 2, `zwei Poolpfade erwartet, gefunden ${gepoolt}`);
  pruefe(
    /endgueltig \? shadows\?\.vergissMaster\(m\)/.test(main),
    'main.ts leitet den Entsorgungsfall nicht auf Shadows.vergissMaster()'
  );
}

if (fehler > 0) {
  console.log(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nEntsorgte Vegetationsmaster hinterlassen keine Buchung und keinen Klon.');
