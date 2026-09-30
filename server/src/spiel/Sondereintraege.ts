/**
 * Special spawn entries: the boss and the passive NPC, which never stand in the
 * spawn table, and the prefab hash of the boss.
 *
 * Moved here unchanged from `../WovServer.ts` (refactoring I1, step 0b).
 */

import { getStableHash } from '@wov/shared';
import type { Biome } from '@wov/shared';

const EIKTHYR_HASH = getStableHash('Eikthyr');

/** Synthetischer SpawnEntry für Eikthyr (adoptSingle — nie in der Tabelle). */
const BOSS_ENTRY = {
  prefab: 'Eikthyr',
  biomes: 0xffff as Biome,
  maxPerPlayer: 1,
  countRadius: 64,
  globalMax: 1,
  spawnIntervalSec: 999999,
  spawnChance: 0,
  groupSizeMin: 1,
  groupSizeMax: 1,
  groupRadius: 0,
  ringMin: 0,
  ringMax: 0,
  minAltitude: 25,
  walkSpeed: 2,
  runSpeed: 5,
  wanderRadius: 20,
  idleMinSec: 1,
  idleMaxSec: 3,
  flees: false,
  fleeDistance: 0,
  calmDistance: 0,
  despawns: false,
} as const satisfies import('@wov/shared').SpawnEntry;

/** Passiver Entry für eigene NPCs: wandert, kämpft nie, despawnt nie. */
const NPC_ENTRY = {
  ...BOSS_ENTRY,
  prefab: 'NPC_1',
  walkSpeed: 1.2,
  runSpeed: 1.2,
  wanderRadius: 8,
  idleMinSec: 3,
  idleMaxSec: 9,
  aggro: false,
} as const;

export { BOSS_ENTRY, EIKTHYR_HASH, NPC_ENTRY };
