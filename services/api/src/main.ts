/**
 * API entry point (Phase 0).
 *
 * The API is not required for local rendering or editor work (spec §35); it
 * only exposes `/health` so that the development environment and CI can prove
 * the service starts.
 */
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const app = await buildServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
