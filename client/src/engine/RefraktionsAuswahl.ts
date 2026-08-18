import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

/**
 * Gestreute Landschaftsobjekte, die nicht in den Unterwasser-Pass gehören.
 *
 * Die Menge hängt an der Mesh-Identität statt an Namen oder Bounding-Boxen:
 * Namen beschreiben GLB-Submeshes (`leaves_merged`, `busch_merged`) und
 * ändern sich mit der Asset-Pipeline. Die Hülle eines Thin-Instance-Masters
 * umfasst dagegen alle Vorkommen in der Welt und kann die Wasserlinie
 * schneiden, obwohl jede einzelne Instanz trocken steht.
 *
 * Bewusster Preis: Eine absichtlich unter Wasser gesetzte Instanz desselben
 * FOLIAGE-Prefabs bleibt ebenfalls draussen. Der Pass kann nur den ganzen
 * Master einreichen, nicht einzelne Thin Instances. Die Streuregel setzt
 * diese Prefabs regulär oberhalb der Wasserlinie; der Sonderfall ist daher
 * billiger als ein zweiter Durchlauf über den kompletten Landschaftsbestand.
 */
const GESTREUTE_LANDSCHAFT = new WeakSet<AbstractMesh>();

export function markiereAlsGestreuteLandschaft(mesh: AbstractMesh): void {
  GESTREUTE_LANDSCHAFT.add(mesh);
}

export function istGestreuteLandschaft(mesh: AbstractMesh): boolean {
  return GESTREUTE_LANDSCHAFT.has(mesh);
}
