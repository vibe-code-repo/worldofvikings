/**
 * Spawn table (Phase G2) — AUTHORED, not ported.
 *
 * The C++ reference server (valheim.community) contains NO server-side
 * creature spawn system: in the original architecture the owning Unity
 * client runs the SpawnSystem (its rules live in ZoneSystem.m_spawnLists,
 * which neither repo has). The C++ server merely replicates the resulting
 * creature ZDOs. Our browser architecture has no privileged "owning"
 * client, so spawning is server-side here — and since no reference data
 * exists, this table is authored from scratch, tuned to the vanilla feel
 * (deer grazing in the Meadows, greydwarfs roaming the Black Forest).
 *
 * Everything is data-driven: SPAWN_TABLE entries are consumed by the
 * server's SpawnSystem; tests inject overrides via SpawnSystemOptions.
 */

import { Biome } from './types.js';

/** One creature kind's spawn + movement rules. */
export interface SpawnEntry {
  /** Prefab name (ZDO prefab hash = getStableHash(prefab)). */
  readonly prefab: string;
  /** Biome bitmask: spawn allowed where (geo.getBiome(x,z) & biomes) !== 0. */
  readonly biomes: Biome;
  /** Cap within countRadius of each player (per-player area cap). */
  readonly maxPerPlayer: number;
  /** Radius around a player for the per-player cap, meters. */
  readonly countRadius: number;
  /** Server-wide safety cap (multi-player overlap). */
  readonly globalMax: number;
  /** Seconds between spawn rolls (per entry, while ≥1 player online). */
  readonly spawnIntervalSec: number;
  /** Success chance 0..1 per roll per player. */
  readonly spawnChance: number;
  /** Group size bounds, inclusive (each member re-checked for ground). */
  readonly groupSizeMin: number;
  readonly groupSizeMax: number;
  /** Group members scatter within this radius of the anchor, meters. */
  readonly groupRadius: number;
  /** Spawn ring around the player, meters (pop-in distance). */
  readonly ringMin: number;
  readonly ringMax: number;
  /** Min ground height (WATER_LEVEL 30 + 0.5 — no shoreline paddling). */
  readonly minAltitude: number;
  /** Wander speed, m/s. */
  readonly walkSpeed: number;
  /** Flee speed, m/s. */
  readonly runSpeed: number;
  /** Wander targets stay within this radius of the home anchor, meters. */
  readonly wanderRadius: number;
  /** Idle pause bounds between walks, seconds. */
  readonly idleMinSec: number;
  readonly idleMaxSec: number;
  /** Flee from players (deer); passive creatures ignore them (v1: no combat). */
  readonly flees: boolean;
  /** Player closer than this triggers fleeing, meters. */
  readonly fleeDistance: number;
  /** Player farther than this calms a fleeing creature, meters. */
  readonly calmDistance: number;
  /** false = greift nie an (NPCs); fehlt = true (Monster). */
  readonly aggro?: boolean;
  /** false = despawnt nie (NPCs, Bosse behalten ihren Platz). */
  readonly despawns?: boolean;
}

/** No player within this radius → creature despawns (meters). */
export const SPAWN_DESPAWN_RADIUS = 130;
/** Creatures only simulate while a player is within this radius (meters). */
export const SPAWN_SIM_RADIUS = 160;
/** ZDO position resend throttle for moving creatures (seconds, = 4 Hz). */
export const SPAWN_SYNC_INTERVAL_SEC = 0.25;

/**
 * v1 table: creatures with WORKING GLB meshes only. Boar routes through the
 * 'Boar_0' model override and Greydwarf through 'greydwarf@Idle'
 * (HINT_DEFS in prefabs.ts) because the eponymous GLBs are mesh-less bone
 * rigs; Neck/Greyling/Troll/Skeleton stay unspawned until meshed variants
 * exist (known limitation #27).
 */
export const SPAWN_TABLE: readonly SpawnEntry[] = [
  {
    // Deer: the iconic skittish Meadows grazer — fast, nearly catchable
    // (player sprint is 7.5 m/s, deer run 6.0).
    prefab: 'Deer',
    biomes: Biome.Meadows,
    maxPerPlayer: 4,
    countRadius: 120,
    globalMax: 40,
    spawnIntervalSec: 5,
    spawnChance: 0.4,
    groupSizeMin: 1,
    groupSizeMax: 2,
    groupRadius: 6,
    ringMin: 35,
    ringMax: 80,
    minAltitude: 30.5,
    walkSpeed: 1.5,
    runSpeed: 6.0,
    wanderRadius: 20,
    idleMinSec: 2,
    idleMaxSec: 6,
    flees: true,
    fleeDistance: 10,
    calmDistance: 40,
  },
  {
    // Boar: sturdier, slower Meadows forager; passive in v1 (no combat
    // system yet — vanilla boars attack when provoked).
    prefab: 'Boar',
    biomes: Biome.Meadows,
    maxPerPlayer: 3,
    countRadius: 120,
    globalMax: 30,
    spawnIntervalSec: 6,
    spawnChance: 0.35,
    groupSizeMin: 1,
    groupSizeMax: 2,
    groupRadius: 5,
    ringMin: 35,
    ringMax: 80,
    minAltitude: 30.5,
    walkSpeed: 1.2,
    runSpeed: 5.0,
    wanderRadius: 15,
    idleMinSec: 3,
    idleMaxSec: 8,
    flees: false,
    fleeDistance: 0,
    calmDistance: 0,
  },
  {
    // Greydwarf: Black Forest dweller — the forest should feel inhabited;
    // slightly wider spawn ring so it appears at the tree line.
    prefab: 'Greydwarf',
    biomes: Biome.BlackForest,
    maxPerPlayer: 5,
    countRadius: 130,
    globalMax: 50,
    spawnIntervalSec: 5,
    spawnChance: 0.35,
    groupSizeMin: 1,
    groupSizeMax: 2,
    groupRadius: 8,
    ringMin: 40,
    ringMax: 85,
    minAltitude: 30.5,
    walkSpeed: 1.6,
    runSpeed: 5.5,
    wanderRadius: 25,
    idleMinSec: 2,
    idleMaxSec: 5,
    flees: false,
    fleeDistance: 0,
    calmDistance: 0,
  },
];
