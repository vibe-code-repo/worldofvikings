/**
 * Regressionstest für E23: Gestreute Landschaft im Refraktionspass.
 *
 * Ein Thin-Instance-Master fasst Vorkommen über grosse Teile der Welt in
 * einer Hülle zusammen. Deren Unterkante kann unter WATER_LEVEL liegen,
 * obwohl jede Pflanze trocken steht. Genau so gelangten auf der Messinsel
 * 36,2 Mio. Laub-Dreiecke in den zweiten Szenenpass.
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { WATER_LEVEL } from '@wov/shared';
import { gehoertHinein } from '../src/engine/WaterRefraction';
import {
  istGestreuteLandschaft,
  markiereAlsGestreuteLandschaft,
} from '../src/engine/RefraktionsAuswahl';
import { zellMeshAusPrototyp } from '../src/entities/EntityManager';

let fehler = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (bedingung) {
    console.log(`  ✓ ${text}`);
  } else {
    fehler++;
    console.log(`  ✗ ${text}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

function box(name: string, y: number) {
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
  mesh.position.y = y;
  mesh.computeWorldMatrix(true);
  return mesh;
}

console.log('[1] Bestehende Auswahlregeln');
pruefe(gehoertHinein(box('terrain_0_0', WATER_LEVEL + 20)), 'Terrain bleibt immer enthalten');
pruefe(!gehoertHinein(box('terrain_far_0_0', WATER_LEVEL - 20)), 'Fernterrain bleibt ausgeschlossen');
pruefe(!gehoertHinein(box('waterRing', WATER_LEVEL - 1)), 'Wasser rendert sich nicht selbst');
pruefe(!gehoertHinein(box('clutter_halme', WATER_LEVEL - 1)), 'Clutter bleibt ausgeschlossen');
pruefe(!gehoertHinein(box('valheimSky', WATER_LEVEL - 100)), 'Himmel bleibt ausgeschlossen');

console.log('\n[2] Echte Höhenprüfung für nicht gestreute Objekte');
pruefe(gehoertHinein(box('halbVersunkenerStein', WATER_LEVEL - 0.4)), 'eingetauchtes Objekt bleibt sichtbar');
pruefe(!gehoertHinein(box('trockenerStein', WATER_LEVEL + 1)), 'trockenes Objekt bleibt draussen');

console.log('\n[3] Gestreute Landschaft schlägt die gemeinsame Hülle');
const laub = box('leaves_merged', WATER_LEVEL - 1);
markiereAlsGestreuteLandschaft(laub);
pruefe(istGestreuteLandschaft(laub), 'Master trägt die semantische Markierung');
pruefe(!gehoertHinein(laub), 'markierter Master bleibt trotz tiefer Hülle draussen');

const zelle = zellMeshAusPrototyp(laub, 'leaves_merged#1_2', scene);
pruefe(istGestreuteLandschaft(zelle), 'Zell-Master übernimmt die Markierung');
pruefe(!gehoertHinein(zelle), 'auch der Zell-Master bleibt draussen');

zelle.dispose();
scene.dispose();
engine.dispose();

if (fehler > 0) {
  console.error(`\n${fehler} FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log('\nAlle Refraktions-Auswahltests grün.');
