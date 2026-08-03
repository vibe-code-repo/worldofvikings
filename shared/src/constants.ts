/**
 * Shared constants ported from Valhalla2.0 C++ server.
 * Source: WovServer.h, ZoneManager.h, Prefab.h, Types.h
 */

// === World Time (WovServer.h) ===
export const WORLD_TIME_LENGTH = 1800; // seconds per full day cycle
export const TIME_MORNING = 240;
export const TIME_DAY = 270;
export const TIME_AFTERNOON = 900;
export const TIME_NIGHT = 1530;

// === Zone System (ZoneManager.h) ===
export const ZONE_SIZE = 64; // meters per zone/sector
export const WORLD_INNER_ZDIAMETER = 200; // inner world diameter in zones
export const WORLD_OUTER_ZDIAMETER = 256; // outer world diameter in zones

// === Heightmap (Heightmap.h) ===
export const HEIGHTMAP_WIDTH = 64; // vertices per heightmap edge
export const HEIGHTMAP_LEVEL_MAX_DELTA = 8;
export const HEIGHTMAP_SMOOTH_MAX_DELTA = 1;

// === ZDO Sync (server.yml) ===
export const ZDO_SEND_INTERVAL_MS = 50;
export const ZDO_MAX_SEND_THRESHOLD = 10240;
export const ZDO_MIN_SEND_THRESHOLD = 2048;
export const ZDO_ASSIGN_INTERVAL_MS = 2000;

// === Network ===
export const DEFAULT_SERVER_PORT = 2456;
export const MAX_PLAYERS = 10;
export const PLAYER_LIST_SEND_INTERVAL_MS = 2000;

// === World Save ===
export const SAVE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// === Random Events (server.yml) ===
export const EVENT_CHANCE = 0.2;
export const EVENT_INTERVAL_MS = 46 * 60 * 1000; // 46 minutes
export const EVENT_ACTIVATION_RADIUS = 96;

// === Dungeon (server.yml) ===
export const DUNGEON_ZONE_SIZE = 64;
export const DUNGEON_REGEN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
export const DUNGEON_REGEN_STEPS = 3;

// === Dungeon instances (Phase G) ===
// Dungeon instances live in the SAME world coordinate system, but far
// outside the playable world (outer edge: WORLD_OUTER_ZDIAMETER/2 zones =
// ±8192 m). Every instance gets its own slot along +z; the spacing is far
// larger than the ZDO interest radius (4 zones = 256 m) plus the maximum
// dungeon extent, so instances can never see each other or the overworld.
// x > DUNGEON_INSTANCE_BAND_MIN ⇔ "inside a dungeon instance".
export const DUNGEON_INSTANCE_X_BASE = 100_000;
export const DUNGEON_INSTANCE_BAND_MIN = 50_000;
export const DUNGEON_INSTANCE_SPACING = 640; // 10 zones between instance origins
export const DUNGEON_INSTANCE_Y_BASE = 100; // instance origin height

/** Whether a world position lies inside the dungeon instance band. */
export function isInDungeonBand(x: number): boolean {
  return x > DUNGEON_INSTANCE_BAND_MIN;
}
