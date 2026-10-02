/**
 * What the E key does when nothing interactable is in reach (client side, pure).
 *
 * Until 02.10.2026 E sent `dungeon enter` from the overworld, always. For a player without admin rights the server
 * refused it ("Admin commands are not allowed for this player"), and the refusal showed up whenever the E key was
 * pressed with no target, for example after loot was not found. Now:
 *   - in a dungeon: near the entry point (within 6 m) `dungeon leave`, else the hint "back to the entrance";
 *   - in the overworld: `dungeon enter` ONLY with a known dungeon entrance within 16 m (the radius the server
 *     searches, `dungeon assign` text in WovServer.ts); otherwise NOTHING. No hint: E without a target is a
 *     common key press, a message on each one would be noise.
 * The client does not know whether the player is an admin (`ESitzung` learns it from the first refusal and sets
 * `adminVerweigert`: then no `dungeon enter` is sent any more). The entrances are the very list the server searches
 * (`DungeonManager.listEntrances`, sent whole by `sendDungeonEntrances`), with the same radius and the same `<=`
 * (`findEntranceNear(pos, 16)`, horizontal), so the client's idea of "near an entrance" is the server's.
 */

export type EOhneZielAktion = 'dungeon-leave' | 'hinweis-eingang' | 'dungeon-enter' | 'nichts';

export const DUNGEON_VERLASSEN_M = 6;
export const DUNGEON_BETRETEN_M = 16;

export interface EOhneZielLage {
  imDungeon: boolean;
  pos: { x: number; z: number };
  /** Where the player came in (valid in a dungeon). */
  dungeonSpawn: { x: number; z: number };
  /** The dungeon entrances the server sent (the map markers). */
  eingaenge: ReadonlyArray<{ x: number; z: number }>;
  /** The server already refused an admin command of this player in this connection (`ESitzung`). */
  adminVerweigert?: boolean;
}

export function eOhneZiel(l: EOhneZielLage): EOhneZielAktion {
  if (l.imDungeon) {
    const dx = l.pos.x - l.dungeonSpawn.x;
    const dz = l.pos.z - l.dungeonSpawn.z;
    return dx * dx + dz * dz <= DUNGEON_VERLASSEN_M * DUNGEON_VERLASSEN_M ? 'dungeon-leave' : 'hinweis-eingang';
  }
  if (l.adminVerweigert) return 'nichts';
  for (const e of l.eingaenge) {
    const dx = l.pos.x - e.x;
    const dz = l.pos.z - e.z;
    if (dx * dx + dz * dz <= DUNGEON_BETRETEN_M * DUNGEON_BETRETEN_M) return 'dungeon-enter';
  }
  return 'nichts';
}
