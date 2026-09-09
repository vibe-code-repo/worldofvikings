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

/**
 * Grösste Hülle (m), mit der ein Master noch in den Unterwasser-Pass darf.
 *
 * ── Warum es diese Schranke ZUSÄTZLICH gibt ──────────────────────────
 * {@link istGestreuteLandschaft} hängt an der Mesh-Identität und wird vom
 * EntityManager gesetzt, sobald ein Bucket in `FOLIAGE_HASHES` steht. Das
 * ist der richtige, feine Weg — aber er greift nur für das, was auch als
 * FOLIAGE geführt wird. Alles andere kommt über die Höhenprüfung herein,
 * und die fragt die Hülle: Ein Thin-Instance-Master spannt eine Hülle
 * über ALLE seine Vorkommen. Ein einziger Baum am Strand zieht damit den
 * ganzen Bestand in den zweiten Pass — auf der Referenzinsel waren das
 * 36,2 Mio. Laub-Dreiecke (Lehre E23).
 *
 * Diese Schranke ist der Riegel dahinter: Was hundert Meter überspannt,
 * ist kein Gegenstand mehr, sondern ein Bestand oder eine Kulisse. Beides
 * hat unter Wasser nichts zu suchen. Das GELÄNDE ist ausdrücklich
 * ausgenommen — es IST der Meeresgrund und wird vor dieser Prüfung
 * durchgelassen (siehe `gehoertHinein`).
 *
 * ── Warum 100 m ──────────────────────────────────────────────────────
 * Über den ganzen Speicher nachgezählt (`client/test/refraktion-huelle.ts`,
 * 548 streubare Modelle): Das grösste ist `sm-env-water-plane-01` mit
 * 50,0 m — eine Wasserfläche, kein Gegenstand —, die grösste Vegetation
 * misst 25 m (`tree-1a3`). Ein Master über 100 m kann deshalb nur ein
 * Instanzbestand oder eine Kulisse sein (`backdrop-mountains-*` misst
 * 594 m, die Himmelskuppel 132 m). Der Faktor 2 zwischen dem grössten
 * Einzelmodell und der Schranke ist gross genug, dass sie nichts
 * Einzelnes streift, und klein genug, dass sie jeden Bestand fasst.
 *
 * Gemessen am 09.09.2026 an der Küste von insel-18 (11036/−18723, Blick
 * übers Wasser): 29 Meshes und 237.568 Dreiecke im Pass, KEIN Master über
 * 100 m. Die Schranke greift dort also nicht — sie hält den Zustand fest,
 * den `istGestreuteLandschaft` heute schon herstellt.
 */
export const REFRAKTION_MAX_HUELLE = 100;

/**
 * Ist die Hülle zu gross für den Unterwasser-Pass?
 *
 * Nimmt die Kantenlänge in Metern statt eines Meshes: So ist die Regel
 * ohne Babylon prüfbar (client/test/refraktion-huelle.ts), und die
 * Aufrufstelle behält die eine Zeile, die die Hülle wirklich misst.
 */
export function huelleZuGross(kantenlaenge: number): boolean {
  return kantenlaenge > REFRAKTION_MAX_HUELLE;
}
