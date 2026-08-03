/**
 * Prefab — object type definition.
 * 1:1 port of Prefab.h from Valhalla2.0 C++.
 *
 * C++ reference:
 *   class Prefab {
 *     string m_name;
 *     Vector3f m_localScale;
 *     Flag m_flags;  // uint64 bitfield
 *     Hash m_hash;
 *     ...
 *   };
 */

import type { Hash, Vector3, ObjectType } from '@wov/shared';
import { PrefabFlag } from '@wov/shared';
import { getStableHash } from '../util/Hash.js';

export interface RandomSpawnData {
  hasRandomSpawn: boolean;
  chanceToSpawn: number;
  notInLava: boolean;
  minElevation: number;
  maxElevation: number;
}

export class Prefab {
  readonly name: string;
  readonly hash: Hash;
  readonly localScale: Vector3;
  readonly flags: bigint;
  readonly randomSpawn: RandomSpawnData;

  constructor(
    name: string,
    localScale: Vector3 = { x: 1, y: 1, z: 1 },
    flags: bigint = PrefabFlag.NONE,
    randomSpawn?: Partial<RandomSpawnData>
  ) {
    this.name = name;
    this.hash = getStableHash(name);
    this.localScale = localScale;
    this.flags = flags;
    this.randomSpawn = {
      hasRandomSpawn: randomSpawn?.hasRandomSpawn ?? false,
      chanceToSpawn: randomSpawn?.chanceToSpawn ?? 100,
      notInLava: randomSpawn?.notInLava ?? false,
      minElevation: randomSpawn?.minElevation ?? -1000,
      maxElevation: randomSpawn?.maxElevation ?? 1000,
    };
  }

  // ── Flag checks (Prefab.h) ───────────────────────────────────────

  allFlagsPresent(required: bigint): boolean {
    return (this.flags & required) === required;
  }

  anyFlagsPresent(required: bigint): boolean {
    return (this.flags & required) !== 0n;
  }

  allFlagsAbsent(excluded: bigint): boolean {
    return (this.flags & excluded) === 0n;
  }

  anyFlagsAbsent(excluded: bigint): boolean {
    return (this.flags & excluded) !== excluded;
  }

  isDistant(): boolean {
    return (this.flags & PrefabFlag.DISTANT) !== 0n;
  }

  isPersistent(): boolean {
    return (this.flags & PrefabFlag.PERSISTENT) !== 0n;
  }

  isPiece(): boolean {
    return (this.flags & PrefabFlag.PIECE) !== 0n;
  }

  isCreature(): boolean {
    return (
      (this.flags & PrefabFlag.ANIMAL_AI) !== 0n ||
      (this.flags & PrefabFlag.MONSTER_AI) !== 0n
    );
  }

  isItemDrop(): boolean {
    return (this.flags & PrefabFlag.ITEM_DROP) !== 0n;
  }

  isPickable(): boolean {
    return (this.flags & PrefabFlag.PICKABLE) !== 0n;
  }

  isContainer(): boolean {
    return (this.flags & PrefabFlag.CONTAINER) !== 0n;
  }

  isCraftingStation(): boolean {
    return (this.flags & PrefabFlag.CRAFTING_STATION) !== 0n;
  }

  isSmelter(): boolean {
    return (this.flags & PrefabFlag.SMELTER) !== 0n;
  }

  isFireplace(): boolean {
    return (this.flags & PrefabFlag.FIREPLACE) !== 0n;
  }

  isShip(): boolean {
    return (this.flags & PrefabFlag.SHIP) !== 0n;
  }

  isMineRock(): boolean {
    return (this.flags & PrefabFlag.MINE_ROCK_5) !== 0n;
  }

  isTreeBase(): boolean {
    return (this.flags & PrefabFlag.TREE_BASE) !== 0n;
  }

  isTreeLog(): boolean {
    return (this.flags & PrefabFlag.TREE_LOG) !== 0n;
  }

  isDungeon(): boolean {
    return (this.flags & PrefabFlag.DUNGEON) !== 0n;
  }

  isTerrainModifier(): boolean {
    return (this.flags & PrefabFlag.TERRAIN_MODIFIER) !== 0n;
  }

  // ── Object Type derivation (Prefab.h GetObjectType) ──────────────

  getObjectType(): ObjectType {
    if (this.isPiece()) return 1; // Piece
    if (this.isItemDrop() || this.isPickable()) return 2; // Item
    if (this.isCreature()) return 3; // Creature
    if (this.isDungeon()) return 4; // Dungeon
    if (this.isTerrainModifier()) return 5; // Terrain
    return 0; // Default
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      hash: this.hash,
      localScale: this.localScale,
      flags: this.flags.toString(),
      randomSpawn: this.randomSpawn,
    };
  }

  static fromJSON(data: Record<string, unknown>): Prefab {
    return new Prefab(
      data.name as string,
      data.localScale as Vector3,
      BigInt(data.flags as string),
      data.randomSpawn as Partial<RandomSpawnData>
    );
  }
}
