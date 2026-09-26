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
    ...(p.anim !== undefined ? { anim: p.anim } : {}),
    // The blow event of the preview (like the server's animEinmal).
    ...(p.animEinmal !== undefined ? { animEinmal: p.animEinmal } : {}),
    // Der Geist an der Maus (i < 0) bleibt bewusst ohne Schild — er
    // ist noch keine Figur, sondern eine Vorschau.
    ...(npc && i >= 0 ? { npc } : {}),
    isOwn: false,
  };
}

/** The `zeichne` callback of the route preview: forwards everything, the event too. */
export function vorschauZeichner(
  zeige: (p: ZeigePlatzierung, i: number) => void
): (
  i: number,
  p: { prefab: string },
  x: number,
  z: number,
  yaw: number,
  anim: 'idle' | 'walk' | 'attack',
  animEinmal?: string
) => void {
  return (i, p, x, z, yaw, anim, animEinmal) => zeige({ prefab: p.prefab, x, z, yaw, anim, animEinmal }, i);
}
