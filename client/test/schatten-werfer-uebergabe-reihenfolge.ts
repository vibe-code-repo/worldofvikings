/**
 * Schatten: uebergebeAnKlon() gibt einen aufgegebenen Klon aus
 * vegetationsAufgegebeneKlone frei, BEVOR es ihn per nimmAuf() anmeldet
 * (Nachbesserung PR #119 N1, Befund B4/M9 aus dem Angriff auf die
 * gestrichene Groessenregel).
 *
 * Die falsche Reihenfolge (Freigabe NACH nimmAuf) liesse die Uebergabe sich
 * selbst blockieren: nimmAuf() prueft ueber darfWerfen(), ob der Klon
 * werfen darf, und darfWerfen() lehnt ihn ab, solange er in
 * vegetationsAufgegebeneKlone steht. addShadowCaster() liefe dann nicht,
 * und der Klon stuende erst nach dem naechsten Neupacken in der
 * renderList. Die Quelle wurde in derselben Uebergabe aber schon per
 * entferneWerfer(stand.quelle) entfernt — bis zum naechsten Neupacken
 * wirft dann WEDER Klon NOCH Quelle.
 *
 * Lauf: npx tsx client/test/schatten-werfer-uebergabe-reihenfolge.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Shadows, type ShadowLevel } from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten: Uebergabe-Reihenfolge Freigabe vor nimmAuf (M9)');

type Intern = {
  generator: unknown;
  stufe: number;
  nimmAuf(mesh: AbstractMesh): void;
  darfWerfen(mesh: AbstractMesh, cfg: ShadowLevel): boolean;
  konfiguration(): ShadowLevel | null;
  uebergebeAnKlon(stand: { quelle: Mesh; schatten: Mesh }): void;
  vegetationsAufgegebeneKlone: Set<AbstractMesh>;
};

{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const shadows = new Shadows(scene, new DirectionalLight('sonne', new Vector3(0.3, -1, 0.2), scene));
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
  const intern = shadows as unknown as Intern;
  intern.generator = fake;
  intern.stufe = 2;

  const quelle = new Mesh('m9_quelle', scene);
  const schatten = new Mesh('m9_klon', scene);

  // Vorbedingung: die Quelle wirft, wie vor jeder Uebergabe.
  intern.nimmAuf(quelle);
  pruefe(liste.includes(quelle), 'Vorbedingung: die Quelle wirft vor der Uebergabe nicht');

  // Der Klon ist aufgegeben (wie nach TIEFE_MAX_VERSUCHE in tiefeNachziehen).
  intern.vegetationsAufgegebeneKlone.add(schatten);
  pruefe(
    !intern.darfWerfen(schatten, intern.konfiguration()!),
    'Vorbedingung: der aufgegebene Klon darf schon vor der Uebergabe werfen — der Test misst nichts'
  );

  intern.uebergebeAnKlon({ quelle, schatten });

  pruefe(!liste.includes(quelle), 'nach der Uebergabe wirft die Quelle weiter');
  pruefe(
    liste.includes(schatten),
    'M9: der Klon wirft nach der Uebergabe nicht SOFORT — bei einer Freigabe nach nimmAuf() weder Klon noch Quelle bis zum naechsten Neupacken'
  );

  scene.dispose();
  engine.dispose();
}

if (fehler > 0) {
  console.error(`\n✗ ${fehler} Fehler`);
  process.exit(1);
}
console.log('\n✓ Schatten: Uebergabe-Reihenfolge (M9) gruen.');
