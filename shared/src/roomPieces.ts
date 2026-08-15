/**
 * Die Einrichtung der Dungeon-Raeume (Phase G) — netViews und randomSpawns
 * je Raum-Prefab, aus dungeons.pkg geparst
 * (tools/prefab-parser/parse-dungeons.ts).
 *
 * WARUM EIN EIGENES MODUL: Die netViews (Truhen, Spawner, Fackeln …) samt
 * ihrer Zufallsvarianten sind ~5,2 MB JSON und damit der Loewenanteil der
 * Dungeon-Daten. Gebraucht werden sie ausschliesslich beim MATERIALISIEREN
 * eines Layouts (`flattenLayout`), und das laeuft nur auf dem Server — der
 * Client bekommt die fertigen ZDOs. `dungeons.ts` dagegen haengt ueber
 * prefabs.ts am Barrel und landet damit in jedem Client-Bundle; die
 * Einrichtung waere dort blinder Ballast gewesen.
 *
 * SCHLUESSEL IST DER RAUMNAME: 103 der 392 Raum-Eintraege sind Mehrfach-
 * verwendungen desselben Prefabs in verschiedenen Dungeon-Kits (die Crypt-
 * Kits teilen sich Gaenge). Sie sind im pkg byte-gleich — der Parser prueft
 * das beim Schreiben —, deshalb reicht ein Namensschluessel und die Daten
 * liegen nur einmal auf der Platte.
 *
 * Dieses Modul wird bewusst NICHT aus `index.ts` re-exportiert, damit ein
 * versehentlicher Client-Import auffaellt.
 */

import roomPiecesData from './roomPiecesData.json';
import type { Quaternion, Vector3 } from './types.js';

/** An interactive prefab contained in a room (chest, spawner, torch, …). */
export interface RoomNetView {
  readonly prefabName: string;
  readonly prefabHash: number;
  readonly pos: Vector3;
  readonly rot: Quaternion;
}

/** Random decoration variant data attached to net views of a room. */
export interface RoomRandomSpawn {
  readonly chanceToSpawn: number;
  readonly dungeonRequireTheme: number;
  readonly requireBiome: number;
  readonly notInLava: boolean;
  readonly minElevation: number;
  readonly maxElevation: number;
  /** Indices into the room's netViews affected by this spawn group. */
  readonly childViews: readonly number[];
}

/** Einrichtung eines Raum-Prefabs. */
export interface RoomPieces {
  readonly netViews: readonly RoomNetView[];
  readonly randomSpawns: readonly RoomRandomSpawn[];
}

const RAEUME = roomPiecesData.rooms as unknown as Record<string, RoomPieces>;

const LEER: RoomPieces = { netViews: [], randomSpawns: [] };

/** Einrichtung eines Raums; unbekannte Namen liefern eine leere Einrichtung. */
export function getRoomPieces(roomName: string): RoomPieces {
  return RAEUME[roomName] ?? LEER;
}
