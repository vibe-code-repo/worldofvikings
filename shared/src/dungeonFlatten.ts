/**
 * Layout → konkrete Prefab-Instanzen (Phase G).
 *
 * WARUM GETRENNT VON dungeonGenerator.ts: `flattenLayout` ist die einzige
 * Stelle, die die Raum-EINRICHTUNG (netViews) braucht — und die liegt aus
 * Bundle-Gruenden in `roomPieces.ts` (~5 MB). `dungeonGenerator.ts` dagegen
 * liefert mit attachRoom/removeRoom/computeOpenConnections den Unterbau des
 * In-Game-Dungeon-Editors und wird deshalb vom CLIENT importiert. Blieben
 * beide im selben Modul, zoege der Editor die komplette Einrichtung aller
 * 289 Raeume ins Client-Bundle, obwohl er sie nie anfasst.
 *
 * Materialisiert wird ausschliesslich serverseitig (ZoneManager fuer Camps,
 * DungeonManager fuer Instanzen); dieses Modul steht deshalb nicht im
 * Barrel und wird ueber seinen expliziten Pfad importiert.
 */

import { DUNGEONS_BY_NAME } from './dungeons.js';
import type { DungeonLayout } from './dungeons.js';
import { getRoomPieces } from './roomPieces.js';
import type { Quaternion, Vector3 } from './types.js';
import { quatMul, quatMulVec3 } from './worldgen/Math3d.js';

export type FlattenedKind = 'room' | 'netView' | 'door';

/** One concrete prefab instance of a flattened layout (local dungeon space). */
export interface FlattenedPiece {
  kind: FlattenedKind;
  prefabName: string;
  prefabHash: number;
  pos: Vector3;
  rot: Quaternion;
  /** Index into layout.rooms for room/netView pieces (-1 for doors). */
  roomIndex: number;
}

function vAdd(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Resolve a layout into concrete prefab instances: one room shell per
 * placed room (geometry + colliders come from the room GLB), every net
 * view contained in the rooms (chests, spawners, torches — C++ PlaceRoom
 * furnishing), and the doors. All in local dungeon space.
 *
 * Rooms unknown to the base kit are skipped (sanitize prevents them on
 * the server path; the editor preview simply tolerates them).
 */
export function flattenLayout(layout: DungeonLayout, baseName: string): FlattenedPiece[] {
  const def = DUNGEONS_BY_NAME.get(baseName);
  const roomsByName = new Map(def?.rooms.map((r) => [r.name, r]) ?? []);
  const pieces: FlattenedPiece[] = [];

  layout.rooms.forEach((placed, roomIndex) => {
    const room = roomsByName.get(placed.room);
    if (!room) return;

    pieces.push({
      kind: 'room',
      prefabName: room.name,
      prefabHash: room.hash,
      pos: { ...placed.pos },
      rot: { ...placed.rot },
      roomIndex,
    });

    // C++ PlaceRoom: pos1 = pos + rot * view.pos, rot1 = rot * view.rot.
    for (const view of getRoomPieces(room.name).netViews) {
      pieces.push({
        kind: 'netView',
        prefabName: view.prefabName,
        prefabHash: view.prefabHash,
        pos: vAdd(placed.pos, quatMulVec3(placed.rot, view.pos)),
        rot: quatMul(placed.rot, view.rot),
        roomIndex,
      });
    }
  });

  for (const door of layout.doors) {
    pieces.push({
      kind: 'door',
      prefabName: door.prefabName,
      prefabHash: door.prefabHash,
      pos: { ...door.pos },
      rot: { ...door.rot },
      roomIndex: -1,
    });
  }

  return pieces;
}
