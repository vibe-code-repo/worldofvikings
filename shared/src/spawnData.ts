/**
 * Spawn table (Phase G2) — AUTHORED, not ported.
 *
 * The reference server contains NO server-side
 * creature spawn system: in the original architecture the owning Unity
 * client runs the spawn system (its rules live in the zone spawn lists,
 * which neither repo has). The reference server merely replicates the resulting
 * creature ZDOs. Our browser architecture has no privileged "owning"
 * client, so spawning is server-side here — and since no reference data
 * exists, this table is authored from scratch, tuned to the vanilla feel
 * (deer grazing in the Meadows, greydwarfs roaming the Black Forest).
 *
 * Everything is data-driven: SPAWN_TABLE entries are consumed by the
 * server's SpawnSystem; tests inject overrides via SpawnSystemOptions.
 */

import { Biome } from './types.js';
import { pruefeClips, type KreaturClip } from './kreaturAnim.js';
import { istEigenesModell } from './prefabs.js';

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
  /**
   * Animation states the model ships as clips (group names in the GLB). Only
   * an entry that lists them gets the ZDO member `anim` written by the spawn
   * system; without the field nothing is written and the client keeps the
   * prefab's fixed animation (NPC_1 plays `Walking`, and a written `idle`
   * would find no group there and freeze it).
   *
   * A state the model lacks falls back: `attack` -> `run` -> `walk` -> `idle`.
   *
   * The list is checked where the table is built (`pruefeClips`): it must not
   * be empty, must contain `idle` and may only name known clips. `hit` and
   * `die` are one-shots the server triggers (`SpawnSystem.treffer/sterbe`),
   * not states. Listing a clip the model does not have is caught by the test
   * against the manifest; the client reports what it cannot find.
   */
  readonly clips?: readonly KreaturClip[];
  /**
   * Seconds the server keeps a slain creature so the `die` clip can play
   * (the clip's length). Required when `clips` lists `die`; without `die` the
   * creature disappears at once.
   */
  readonly dieSec?: number;
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
 *
 * Was davon wirklich spawnt, entscheidet `bauSpawnTabelle()` am Dateiende
 * gegen die Whitelist. Der Rohbestand bleibt vollständig stehen: Seine
 * Zahlen (Ringe, Kappen, Flucht- und Wanderwerte) sind die eigentliche
 * Arbeit an dieser Datei und sollen beim Wiederauftauchen eines Wesens
 * nicht neu erfunden werden.
 */
const SPAWN_TABLE_ROH: readonly SpawnEntry[] = [
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
  {
    // Cow (B9): the meadow's big grazer. Same role and numbers as the boar
    // (cap 3 within 120 m, groups of 1-2, ring 35-80 m, one roll per 6 s), but
    // `aggro: false`: a cow never attacks and never flees, it just stands and
    // wanders. The cap is also a cost cap: each cow is one skinned mesh
    // (1414 triangles) that cannot be instanced.
    //
    // Walk 1.0 m/s sits next to the walk clip's 0.94 m/s (prefabs.ts); `runSpeed`
    // is never used (no flee, no chase) and stays at the boar's 5.0.
    prefab: 'Kuh',
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
    walkSpeed: 1.0,
    runSpeed: 5.0,
    wanderRadius: 15,
    idleMinSec: 3,
    idleMaxSec: 8,
    flees: false,
    fleeDistance: 0,
    calmDistance: 0,
    aggro: false,
    clips: ['idle', 'walk', 'run'],
  },
  {
    // Wolf (B9): plays the greydwarf's part (the roadmap says so) in the same
    // biome, the Black Forest, and takes its combat numbers: 30 HP (leben.ts),
    // chase 5.5 m/s (player walks 4.5, runs 7.5), 8 damage every 2 s within
    // 2.4 m (SpawnSystem). Fewer than the greydwarf (3 instead of 5 within
    // 130 m, 30 instead of 50 server-wide, one roll per 6 s at 30 %): it is
    // the same damage from a faster body, and every wolf is a skinned mesh of
    // 1000 triangles that costs a draw call plus a shadow pass.
    //
    // Walk 1.0 m/s (clip: 0.62), chase 5.5 m/s (clip: 1.42): the client
    // couples the clip's playback rate to the real ground speed.
    prefab: 'Wolf',
    biomes: Biome.BlackForest,
    maxPerPlayer: 3,
    countRadius: 130,
    globalMax: 30,
    spawnIntervalSec: 6,
    spawnChance: 0.3,
    groupSizeMin: 1,
    groupSizeMax: 2,
    groupRadius: 6,
    ringMin: 40,
    ringMax: 85,
    minAltitude: 30.5,
    walkSpeed: 1.0,
    runSpeed: 5.5,
    wanderRadius: 25,
    idleMinSec: 2,
    idleMaxSec: 5,
    flees: false,
    fleeDistance: 0,
    calmDistance: 0,
    clips: ['idle', 'walk', 'run', 'attack'],
  },
];

/**
 * Spawn-Tabelle gegen die Whitelist `EIGENE_MODELLE` (prefabs.ts).
 *
 * Seit Block A steht ausschliesslich eigener Bau in der Welt. Deer, Boar
 * und Greydwarf sind Fremdmodelle — sie fallen alle drei weg, und damit
 * spawnt zunächst gar kein Wesen mehr. Das ist der beschlossene
 * Zwischenzustand: ohne eigene Kreaturmodelle wird nicht gekämpft.
 *
 * Gefiltert wird HIER, an der Entstehung der Tabelle, und nicht erst im
 * SpawnSystem: Sonst sähen Editor, Client und Server verschiedene
 * Tabellen, je nachdem, wer gerade fragt. Das SpawnSystem prüft trotzdem
 * ein zweites Mal — es nimmt auch injizierte Tabellen entgegen (Tests,
 * synthetische Einträge für Bosse und NPCs).
 */
function bauSpawnTabelle(): SpawnEntry[] {
  // Every raw entry, also the dormant ones: a wrong `clips` must not wait
  // for the creature to come back to be noticed.
  for (const e of SPAWN_TABLE_ROH) pruefeClips(e.prefab, e.clips, e.dieSec);
  const liste = SPAWN_TABLE_ROH.filter((e) => istEigenesModell(e.prefab));
  const uebersprungen = SPAWN_TABLE_ROH.length - liste.length;
  if (uebersprungen > 0) {
    console.warn(
      `[spawns] ${uebersprungen} von ${SPAWN_TABLE_ROH.length} Eintraegen ohne eigenes Modell uebersprungen`
    );
  }
  return liste;
}

/** Die ausgelieferte Tabelle — der Rohbestand oben, gegen die Whitelist. */
export const SPAWN_TABLE: readonly SpawnEntry[] = bauSpawnTabelle();
