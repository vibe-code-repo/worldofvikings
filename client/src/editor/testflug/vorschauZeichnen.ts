/**
 * The two places where the editor test flight hands a placement to the
 * entity layer — split out of Testflug.ts (which needs a scene and the DOM)
 * so that the hand-over of the blow event `animEinmal` is tested.
 */

import { getStableHash, type NpcDef, type NpcEinordnung } from '@wov/shared';

export interface ZeigePlatzierung {
  prefab: string;
  x: number;
  z: number;
  yaw?: number;
  scale?: number;
  anim?: string;
  /** Blow event of the route preview (the server's `animEinmal`, `attack#n`). */
  animEinmal?: string;
  npc?: NpcDef;
}

/** Placement scale limits, as the server clamps them (`sanitize.ts`: `klemm(scale, 0.2, 5, 1)`). */
export const SKALA_MIN = 0.2;
export const SKALA_MAX = 5;
/** Same threshold as the server's `sollSkala`: at or below it the prefab's own scale stays. */
const SKALA_TOLERANZ = 1e-3;

/**
 * The scale the server would put on the entity (`layoutAbgleich.sollSkala`
 * after `sanitize` clamped it): 0 = none, the prefab's `localScale` applies.
 */
export function anzeigeSkala(scale: unknown): number {
  if (scale === undefined) return 0;
  // Like the server's `klemm`: `Number(v)` (so "3" is 3, null and "" are 0), not finite = the default 1.
  const n = Number(scale);
  const s = Number.isFinite(n) ? Math.min(SKALA_MAX, Math.max(SKALA_MIN, n)) : 1;
  return Math.abs(s - 1) > SKALA_TOLERANZ ? s : 0;
}

/** The update the entity layer gets for placement `i` (i < 0: the ghost at the mouse). */
export function platzierungsUpdate(
  p: ZeigePlatzierung,
  i: number,
  hoehe: number,
  npc: NpcEinordnung | null | undefined
): Record<string, unknown> {
  const yaw = p.yaw ?? 0;
  return {
    key: i < 0 ? 'edghost' : `edplace-${i}`,
    prefabHash: getStableHash(p.prefab),
    position: { x: p.x, y: hoehe, z: p.z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
    // Static prefabs: replaces the prefab's `localScale` like `composeZdoWorld` does online.
    // Dynamic prefabs (animals, NPCs): `applyDynamic` multiplies it with `localScale`, online and here alike.
    ...(anzeigeSkala(p.scale) > 0 ? { scale: anzeigeSkala(p.scale) } : {}),
    ...(p.anim !== undefined ? { anim: p.anim } : {}),
    // The blow event of the preview (like the server's animEinmal).
    ...(p.animEinmal !== undefined ? { animEinmal: p.animEinmal } : {}),
    // Der Geist an der Maus (i < 0) bleibt bewusst ohne Schild — er
    // ist noch keine Figur, sondern eine Vorschau.
    ...(npc && i >= 0 ? { npc } : {}),
    isOwn: false,
  };
}

/** The `zeichne` callback of the route preview: forwards everything, the event and the scale too. */
export function vorschauZeichner(
  zeige: (p: ZeigePlatzierung, i: number) => void
): (
  i: number,
  p: { prefab: string; scale?: number },
  x: number,
  z: number,
  yaw: number,
  anim: 'idle' | 'walk' | 'attack',
  animEinmal?: string
) => void {
  return (i, p, x, z, yaw, anim, animEinmal) => zeige({ prefab: p.prefab, x, z, yaw, scale: p.scale, anim, animEinmal }, i);
}
