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
  /**
   * When true, every write answers 403 instead of touching a file (ADR-0017):
   * `PUT /worlds/:id`, `PUT /prefabs/:catalog` and the content actions.
   *
   * The environment variable is still `WORLDS_READ_ONLY` — it is what
   * deployments already set, and the flag never meant "worlds only", it meant
   * "this API serves content, it does not author it" (spec §49).
   */
  readonly contentReadOnly: boolean;
  /**
   * The one directory a scene bundle may be imported from, or `undefined`.
   *
   * A scene import reads a file path that reaches the service from a browser,
   * which is exactly the shape of a directory-traversal hole. The rule is an
   * allow-list rather than a filter: without `WOV_IMPORT_DIR` the action is
   * refused outright, and with it, the resolved path must still be inside the
   * directory (ADR-0033). No default — a service nobody configured for imports
   * must not be able to read the disk.
   */
  readonly importDir: string | undefined;
  /** Root of the private asset store, for regenerating the prefab catalogue. */
  readonly assetStoreDir: string | undefined;
  /** `assets/` of this checkout: the manifest and the public models. */
  readonly assetsDir: string;
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

/** `assets/` of the same checkout, reached the same way. */
const REPOSITORY_ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets');

/** An environment path, resolved, or `undefined` when it is not set. */
function readDirectory(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? '';
  return value === '' ? undefined : resolve(value);
}

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
    contentReadOnly: readFlag('WORLDS_READ_ONLY', env['WORLDS_READ_ONLY']),
    importDir: readDirectory(env['WOV_IMPORT_DIR']),
    assetStoreDir: readDirectory(env['WOV_ASSET_STORE']),
    assetsDir: readDirectory(env['ASSETS_DIR']) ?? REPOSITORY_ASSETS_DIR,
  };
}
