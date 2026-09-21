/**
 * Client-side world data — the SAME GeoManager/HeightmapProvider the server
 * runs (identical seed ⇒ identical world, see WovServer.ts:190).
 *
 * M0.1: online, the seed + worldgen flags come from the server's
 * ServerConfig handshake (PacketType 52, see main.ts) — never hardcoded,
 * so client and server can never render different worlds. Offline mode
 * (no server) still needs a local seed, chosen on the connect screen.
 */
import {
  sanitizeWorldLayout,
  createGeo,
  type IGeo,
  HeightmapProvider,
  RegionGeo,
  getStableHash,
} from '@wov/shared';

/**
 * Height-map zone cache of the client: 1024 zones (≈ 50 MB; the server keeps the
 * default of 512). A standing picture already needs 623–631 zones (9 × 9 near
 * window, far ring up to 10 zones, 5 × 5 vegetation preview), so 512 evicted what
 * was needed again a moment later: up to half of the zones built while flying were
 * rebuilds, and coming back to a place just left took 7.5 s to stand again. With
 * 1024: no rebuilds, height-map time −38 %, back at the place after 1.0 s. 2048
 * brings nothing more (measurement M2.0, Berichte/2026-09-20 Inselmodus M2.0
 * Messung, section 6). Only the client: the world the server builds is unchanged.
 */
export const CLIENT_ZONE_CACHE = 1024;

// Fallback for offline mode when no seed was entered on the connect screen.
export const DEFAULT_OFFLINE_SEED = 'KxSYuZquuw';

export interface ClientWorldSettings {
  worldGenVersion?: number;
  disableDistantRivers?: boolean;
  riverAffectsOcean?: boolean;
  ashlandsModernNoise?: boolean;
  blendSmoothStep?: boolean;
  bilinearSampling?: boolean;
}

export interface ClientWorld {
  geo: IGeo;
  heightmaps: HeightmapProvider;
  getGroundHeight(x: number, z: number): number;
  /**
   * Der gehashte Weltseed, mit dem `geo` gebaut wurde.
   *
   * Die Bewuchs-Vorschau im Testflug braucht ihn: Die Streuung wuerfelt je
   * Zone aus (seed + zoneX*4271 + zoneY*9187 + prefabHash), und nur mit
   * DEMSELBEN Seed wie der Server steht die Vorschau dort, wo spaeter auch
   * die Welt waechst.
   */
  seed: number;
  /** Im Layout-Modus derselbe Gegenstand wie `geo`, sonst null. */
  regionGeo: RegionGeo | null;
}

export function createWorld(
  seed: string = DEFAULT_OFFLINE_SEED,
  settings: ClientWorldSettings = {},
  layout?: unknown
): ClientWorld {
  // Layout-Modus: detailSeed des Dokuments schlägt den Handshake-Seed —
  // muss zur identischen Regel im Server (WovServer.init) passen.
  const layoutSeed = layout ? sanitizeWorldLayout(layout)?.detailSeed : undefined;
  const worldSeed = getStableHash(layoutSeed ?? seed);
  const geo = createGeo({
    mode: layout ? 'layout' : 'radial',
    worldSeed,
    layout,
    settings: {
      worldGenVersion: settings.worldGenVersion ?? 2,
      disableDistantRivers: settings.disableDistantRivers ?? false,
      riverAffectsOcean: settings.riverAffectsOcean ?? false,
      ashlandsModernNoise: settings.ashlandsModernNoise ?? true, // server.yml experimental-ashlands-modern-noise
    },
  });
  const heightmaps = new HeightmapProvider(
    geo,
    {
      blendSmoothStep: settings.blendSmoothStep ?? true, // server.yml experimental-biome-blend-smoothstep (default)
      bilinearSampling: settings.bilinearSampling ?? false, // server.yml experimental-bilinear-height-sampling (default)
    },
    CLIENT_ZONE_CACHE
  );
  return {
    geo,
    heightmaps,
    getGroundHeight: (x, z) => heightmaps.getGroundHeight(x, z),
    seed: worldSeed,
    regionGeo: geo instanceof RegionGeo ? geo : null,
  };
}
