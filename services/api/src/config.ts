/**
 * Runtime configuration read from the environment.
 *
 * Local development must work without any secret (spec §7, §47), so every
 * value has a usable default.
 */
export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  /** Origins allowed to call the API from a browser (website, game, editor). */
  readonly corsOrigins: readonly string[];
  /** Pino log level. */
  readonly logLevel: string;
}

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5172',
  'http://localhost:5173',
  'http://localhost:5174',
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawPort = env['API_PORT'] ?? '3000';
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`API_PORT must be a valid port number, got "${rawPort}"`);
  }

  const rawOrigins = env['API_CORS_ORIGINS'];
  const corsOrigins =
    rawOrigins === undefined || rawOrigins.length === 0
      ? DEFAULT_CORS_ORIGINS
      : rawOrigins
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  return {
    host: env['API_HOST'] ?? '127.0.0.1',
    port,
    corsOrigins,
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}
