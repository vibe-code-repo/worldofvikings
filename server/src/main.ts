/**
 * Server entry point.
 * 1:1 port of Main.cpp from Valhalla2.0 C++.
 *
 * C++ reference:
 *   int main(int argc, char** argv) {
 *     std::filesystem::current_path("./data/");
 *     Valhalla()->Start();
 *     return 0;
 *   }
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import { createValhallaServer, type ServerConfig } from './ValhallaServer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../data');

function loadServerConfig(): Partial<ServerConfig> {
  const configPath = resolve(DATA_DIR, 'server.yml');

  if (!existsSync(configPath)) {
    console.log('[Main] No server.yml found, using defaults');
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const yaml = parseYaml(raw) as Record<string, unknown>;

    const server = (yaml.server ?? {}) as Record<string, unknown>;
    const players = (yaml.players ?? {}) as Record<string, unknown>;
    const world = (yaml.world ?? {}) as Record<string, unknown>;
    const dungeons = (yaml.dungeons ?? {}) as Record<string, unknown>;

    return {
      name: (server.name as string) ?? 'Valheim Browser Server',
      password: (server.password as string) ?? '',
      port: (server.port as number) ?? 2456,
      maxPlayers: (players.max as number) ?? 10,
      everyoneAdmin: (players['everyone-admin'] as boolean) ?? false,
      worldName: (world.world as string) ?? 'world',
      // WORLD_SEED env var wins over server.yml — the easiest way to start
      // a fresh server with a custom seed (e.g. one picked on the client's
      // connect screen and pasted here); has no effect on an already
      //-running server / an existing save (see client/src/main.ts header).
      worldSeed: process.env.WORLD_SEED || (world.seed as string) || 'KxSYuZquuw',
      // worldgen flags (C++ ServerSettings defaults: smoothstep=true, bilinear=false,
      // ashlands-modern-noise=true)
      worldBlendSmoothStep: (world['experimental-biome-blend-smoothstep'] as boolean) ?? true,
      worldBilinearHeight: (world['experimental-bilinear-height-sampling'] as boolean) ?? false,
      worldRiverAffectsOcean: (world['experimental-river-affects-ocean'] as boolean) ?? false,
      worldAshlandsModernNoise: (world['experimental-ashlands-modern-noise'] as boolean) ?? true,
      worldDisableDistantRivers: (world['experimental-disable-distant-rivers'] as boolean) ?? false,
      // Phase E/F zone population flags (C++ defaults: all true / overrides false)
      worldFeatures: (world.features as boolean) ?? true,
      worldVegetation: (world.vegetation as boolean) ?? true,
      worldLocationOverrides: (world['experimental-location-overrides'] as boolean) ?? false,
      dungeonsEnabled: (dungeons.enabled as boolean) ?? true,
      // G2: creature spawning (C++ world.creatures default true)
      worldCreatures: (world.creatures as boolean) ?? true,
      // G1: world saves live next to server.yml (C++ ./worlds)
      worldsDir: resolve(DATA_DIR, 'worlds'),
    };
  } catch (err) {
    console.error(`[Main] Failed to parse server.yml: ${err}`);
    return {};
  }
}

// ── Main ─────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════╗');
console.log('║   Valheim Browser Server (Valhalla TS)   ║');
console.log('║   1:1 Port from Valhalla2.0 C++          ║');
console.log('╚══════════════════════════════════════════╝');
console.log();

const config = loadServerConfig();
const server = createValhallaServer(config);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Main] Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

// Start the server (C++ Valhalla()->Start())
server.start();
