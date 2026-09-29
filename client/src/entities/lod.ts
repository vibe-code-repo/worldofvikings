/**
 * Bounding volumes of the entity layer: the hull of a dynamic instance for the
 * animation LOD, the sphere test against the view frustum and the widening of a
 * thin-instance master's bounding box by the wind reserve. The reused work
 * objects of these paths live here, each of them exactly once.
 * Moved verbatim out of EntityManager.ts.
 */

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import { SCHWUNG_RESERVE_M } from './konstanten';

/** Wiederverwendetes Nick-Quaternion des prozeduralen Gangs (kein Alloc pro Frame). */
const GANG_NICK_TMP = new Quaternion();

/**
 * Animations-LOD B4 (Nachbesserung): Mindestradius der Sichtkegel-Kugel,
 * auch wenn eine gemessene Huelle kleiner waere — sonst faellt ein
 * winziger Hitbox-Mittelpunkt genau auf eine Kegelkante und ein sichtbarer
 * Rand friert trotzdem ein.
 */
const ANIMATIONS_LOD_MIN_RADIUS_M = 1.5;

/** Wiederverwendete Huellmitte fuer den Animations-LOD-Sichtkegeltest (kein Alloc je Figur und Bild, B4). */
const LOD_MITTE_TMP = new Vector3();

/**
 * Huellmitte (Y-Versatz gegenueber `root.position`) und Huellradius einer
 * Instanz, EINMAL bei der Instanziierung aus ihren Meshes gemessen (wie
 * `merkeModellHoehe` bei den Clutter-Mastern oben) — NICHT jedes Bild neu,
 * das waere die Allokation je Figur und Bild, die B4 ausdruecklich
 * ausschliesst.
 *
 * Der Radius ist NICHT die halbe Diagonale der Huelle (Nachbesserung N2,
 * A4: das nimmt an, die Huelle sei symmetrisch um ihre EIGENE Mitte) —
 * er ist der groesste Abstand von der WURZEL-ACHSE (x/z von
 * `root.position`, Hoehe `root.position.y + mitteY`) zu einer der acht
 * Huellecken, mindestens `ANIMATIONS_LOD_MIN_RADIUS_M`. Das umschliesst die
 * Huelle wirklich exakt, AUCH bei einem seitlichen Versatz der Mitte (eine
 * Kuh mit vorgestrecktem Kopf: die Diagonale reichte nur bis 81 % der
 * tatsaechlich fernsten Ecke, `Berichte/angriff-fps-animation-einfrieren-n1/
 * probe-huelle-glb.ts`). Der Abstand von dieser Achse aendert sich zudem
 * NICHT bei einer spaeteren Drehung um die Hochachse (Gieren, der
 * haeufige Fall bei NPCs) — nur ihre Richtung tut es.
 *
 * Ohne Meshes (leerer Platzhalter waere ein Fehler in `makePlaceholder`,
 * kommt praktisch nicht vor) ODER ohne `getHierarchyBoundingVectors`
 * (Nachbesserung N2, A1: eine Test-Attrappe ohne echtes Mesh) ein sicherer
 * Rueckfallwert statt einer entarteten Huelle oder eines Absturzes.
 */
function berechneLodHuelle(root: TransformNode): { mitteY: number; radius: number } {
  if (typeof root.getHierarchyBoundingVectors !== 'function') {
    return { mitteY: 0.9, radius: ANIMATIONS_LOD_MIN_RADIUS_M };
  }
  const { min, max } = root.getHierarchyBoundingVectors(true);
  const spanne = max.subtract(min);
  if (!(spanne.x >= 0) || !(spanne.y >= 0) || !(spanne.z >= 0)) {
    return { mitteY: 0.9, radius: ANIMATIONS_LOD_MIN_RADIUS_M };
  }
  const mitteY = (min.y + max.y) / 2 - root.position.y;
  const achse = new Vector3(root.position.x, root.position.y + mitteY, root.position.z);
  let radius = ANIMATIONS_LOD_MIN_RADIUS_M;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        radius = Math.max(radius, Vector3.Distance(achse, new Vector3(x, y, z)));
      }
    }
  }
  return { mitteY, radius };
}

/** Ob eine Kugel (Huellmitte, Radius) den Sichtkegel schneidet — dieselbe Ebenen-Konvention wie `Frustum.IsPointInFrustum` (Abstand ≥ 0 = innerhalb), nur um den Radius nach aussen verschoben. */
function istKugelImSichtkegel(mitte: Vector3, radius: number, ebenen: readonly Plane[]): boolean {
  for (const e of ebenen) {
    if (e.dotCoordinate(mitte) < -radius) return false;
  }
  return true;
}

/**
 * Den Hüllkörper eines Thin-Instance-Masters um SCHWUNG_RESERVE_M
 * aufweiten — nach jedem Schreiben des Matrixpuffers aufzurufen.
 *
 * Exportiert, weil das die Zusicherung ist, an der die Sichtbarkeit hängt:
 * `client/test/master-huelle.ts` prüft ohne GPU nach, dass der Kasten jede
 * gesetzte Instanz vollständig enthält. Ein Hüllkörper, der eine Instanz
 * auslässt, lässt das Objekt im Spiel verschwinden — und zwar nur aus
 * bestimmten Blickwinkeln, also genau die Sorte Fehler, die man beim
 * Durchklicken nicht findet.
 *
 * Kein Alloc je Neuaufbau: `reConstruct` schreibt mit `copyFromFloats` in
 * die bestehenden Vektoren des Hüllkörpers, und die beiden Endpunkte
 * kommen aus wiederverwendeten Arbeitsvektoren.
 */
export function huellkoerperAufweiten(mesh: Mesh, reserve = SCHWUNG_RESERVE_M): void {
  const info = mesh.getBoundingInfo();
  const min = info.minimum;
  const max = info.maximum;
  info.reConstruct(
    RESERVE_MIN_TMP.copyFromFloats(min.x - reserve, min.y - reserve, min.z - reserve),
    RESERVE_MAX_TMP.copyFromFloats(max.x + reserve, max.y + reserve, max.z + reserve),
    mesh.getWorldMatrix()
  );
}

/** Arbeitsvektoren für huellkoerperAufweiten (kein Alloc je Neuaufbau). */
const RESERVE_MIN_TMP = new Vector3();
const RESERVE_MAX_TMP = new Vector3();

export {
  GANG_NICK_TMP,
  ANIMATIONS_LOD_MIN_RADIUS_M,
  LOD_MITTE_TMP,
  berechneLodHuelle,
  istKugelImSichtkegel,
};
