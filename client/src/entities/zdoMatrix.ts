/**
 * World matrix of an instance, from its ZDO update and the scale of the prefab.
 * Moved verbatim out of EntityManager.ts.
 */

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ZDOEntityUpdate } from '../net/ZDOSync';
import type { Vector3Like } from './typen';

/**
 * Weltmatrix einer Instanz.
 *
 * Die Skalierung stammt aus dem ZDO — ABER nur, wenn das Prefab eine
 * abweichende mitschickt (SYNC_INITIAL_SCALE). Fehlt sie, gilt die
 * localScale des Prefabs, nicht 1: Rock_3 und Rock_4 stehen im pkg mit
 * localScale 2 und wurden dadurch in halber Größe gerendert — ein
 * Felsbrocken, der nur 34 cm aus dem Boden ragte und im Gras unsichtbar
 * blieb.
 */
function composeZdoWorld(u: ZDOEntityUpdate, prefabScale?: Vector3Like): Matrix {
  const s = u.scale;
  const scaling =
    typeof s === 'number'
      ? new Vector3(s, s, s)
      : s
        ? new Vector3(s.x, s.y, s.z)
        : prefabScale
          ? new Vector3(prefabScale.x, prefabScale.y, prefabScale.z)
          : Vector3.One();
  return Matrix.Compose(
    scaling,
    new Quaternion(u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w),
    new Vector3(u.position.x, u.position.y, u.position.z)
  );
}

export { composeZdoWorld };
