import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  /** Absolute path of the authored game data the content routes read and write. */
  readonly contentDir: string;
  /** When true, `PUT /worlds/:id` answers 403 instead of writing (ADR-0017). */
  readonly worldsReadOnly: boolean;
}

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5172',
  'http://localhost:5173',
  'http://localhost:5174',
];

/**
 * `content/` of this checkout. Reached from `src/` while developing and from
 * `dist/` after a build — both sit three levels below the repository root.
 */
const REPOSITORY_CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../content');

const TRUE_FLAGS = new Set(['1', 'true', 'yes', 'on']);
const FALSE_FLAGS = new Set(['', '0', 'false', 'no', 'off']);

/** Reads a boolean environment flag, refusing values it cannot interpret. */
function readFlag(name: string, raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  const value = raw.trim().toLowerCase();
  if (TRUE_FLAGS.has(value)) {
    return true;
  }
  if (FALSE_FLAGS.has(value)) {
    return false;
  }
  throw new Error(`${name} must be one of 1/0, true/false, yes/no, on/off, got "${raw}"`);
}

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

  const rawContentDir = env['CONTENT_DIR'];

  return {
    host: env['API_HOST'] ?? '127.0.0.1',
    port,
    corsOrigins,
    logLevel: env['LOG_LEVEL'] ?? 'info',
    contentDir:
      rawContentDir === undefined || rawContentDir.length === 0
        ? REPOSITORY_CONTENT_DIR
        : resolve(rawContentDir),
    worldsReadOnly: readFlag('WORLDS_READ_ONLY', env['WORLDS_READ_ONLY']),
  };
}
