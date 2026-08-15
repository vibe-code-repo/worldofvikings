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
    mode: layout ? 'layout' : 'valheim',
    worldSeed,
    layout,
    settings: {
      worldGenVersion: settings.worldGenVersion ?? 2,
      disableDistantRivers: settings.disableDistantRivers ?? false,
      riverAffectsOcean: settings.riverAffectsOcean ?? false,
      ashlandsModernNoise: settings.ashlandsModernNoise ?? true, // server.yml experimental-ashlands-modern-noise
    },
  });
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: settings.blendSmoothStep ?? true, // server.yml experimental-biome-blend-smoothstep (default)
    bilinearSampling: settings.bilinearSampling ?? false, // server.yml experimental-bilinear-height-sampling (default)
  });
  return {
    geo,
    heightmaps,
    getGroundHeight: (x, z) => heightmaps.getGroundHeight(x, z),
    seed: worldSeed,
    regionGeo: geo instanceof RegionGeo ? geo : null,
  };
}
