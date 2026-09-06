/**
 * The editor's client for `services/api` (ADR-0017).
 *
 * Every answer is validated with the same schemas the API validated it with
 * (`@wov/world-schema`, agent rule 10). The editor is a separate program that
 * may be older or newer than the service it talks to, so a version skew has to
 * become a listed problem rather than an undefined field somewhere in a panel.
 *
 * The transport is `fetch` — no client library. The four calls below are the
 * whole surface; a dependency for that would be a dependency for nothing.
 */
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import type { PrefabDefinition, WorldDefinition } from '@wov/world-schema';

/** One row of `GET /worlds`. */
export interface WorldSummary {
  readonly id: string;
  readonly name: string;
  readonly zones: number;
  readonly updatedAt: string;
}

/** A world file the API could read but not validate. */
export interface InvalidWorld {
  readonly id: string;
  readonly errors: readonly string[];
}

export interface WorldListing {
  readonly worlds: readonly WorldSummary[];
  readonly invalid: readonly InvalidWorld[];
}

/** A prefab plus the catalogue it came from, as `GET /prefabs` merges them. */
export type CatalogedPrefab = PrefabDefinition & { readonly catalog: string };

/** A catalogue entry that did not validate, named so it can be fixed. */
export interface InvalidPrefabs {
  readonly file: string;
  readonly errors: readonly string[];
}

export interface PrefabListing {
  readonly prefabs: readonly CatalogedPrefab[];
  readonly invalid: readonly InvalidPrefabs[];
}

/** What `PUT /worlds/:id` answers with. */
export interface SaveResult {
  readonly id: string;
  readonly name: string;
  readonly zones: number;
  readonly updatedAt: string;
  readonly created: boolean;
}

/** A request that did not succeed, with the API's own message where there is one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface EditorApi {
  listWorlds(): Promise<WorldListing>;
  loadWorld(id: string): Promise<WorldDefinition>;
  saveWorld(world: WorldDefinition): Promise<SaveResult>;
  listPrefabs(): Promise<PrefabListing>;
}

/** Reads the API's own `{ error, message }` body, falling back to the status. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      const message = record['message'] ?? record['error'];
      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // A non-JSON body is not a second failure; the status still describes it.
  }
  return `${String(response.status)} ${response.statusText}`;
}

function asRecord(value: unknown, url: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError(200, url, `the API answered with ${typeof value}, expected an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Creates a client for the API at `baseUrl` (no trailing slash).
 *
 * `doFetch` is injected so the request handling has one implementation rather
 * than a second, divergent copy in the tests.
 */
export function createEditorApi(baseUrl: string, doFetch: typeof fetch = fetch): EditorApi {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await doFetch(url, init);
    } catch {
      // A dead API is the most likely thing to be wrong on a fresh clone, so it
      // says which URL it tried rather than "failed to fetch".
      throw new ApiError(0, url, `cannot reach the API at ${url} — is \`pnpm dev\` running?`);
    }
    if (!response.ok) {
      throw new ApiError(response.status, url, await describeFailure(response));
    }
    return response.json();
  };

  return {
    async listWorlds() {
      const url = `${baseUrl}/worlds`;
      const body = asRecord(await call('/worlds'), url);
      return {
        worlds: Array.isArray(body['worlds']) ? (body['worlds'] as WorldSummary[]) : [],
        invalid: Array.isArray(body['invalid']) ? (body['invalid'] as InvalidWorld[]) : [],
      };
    },

    async loadWorld(id) {
      const path = `/worlds/${encodeURIComponent(id)}`;
      const parsed = parseWorldDefinition(await call(path));
      if (!parsed.ok) {
        throw new ApiError(
          200,
          `${baseUrl}${path}`,
          `the world "${id}" does not match the schema: ${parsed.errors.join('; ')}`,
        );
      }
      return parsed.world;
    },

    async saveWorld(world) {
      const path = `/worlds/${encodeURIComponent(world.id)}`;
      const body = asRecord(
        await call(path, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(world),
        }),
        `${baseUrl}${path}`,
      );
      return body as unknown as SaveResult;
    },

    async listPrefabs() {
      const url = `${baseUrl}/prefabs`;
      const body = asRecord(await call('/prefabs'), url);
      return splitPrefabs(
        Array.isArray(body['prefabs']) ? body['prefabs'] : [],
        Array.isArray(body['invalid']) ? (body['invalid'] as InvalidPrefabs[]) : [],
      );
    },
  };
}

/**
 * Validates the merged prefab rows, keeping the good ones and listing the rest.
 *
 * Each row is run through `parsePrefabCatalog` as a one-entry catalogue rather
 * than checked field by field here: it is the only prefab validator there is,
 * and a second copy of its rules is exactly what agent rule 11 forbids. The
 * `catalog` field the API adds is not part of the format, so it is lifted off
 * before validation and put back after.
 */
export function splitPrefabs(
  raw: readonly unknown[],
  invalid: readonly InvalidPrefabs[] = [],
): PrefabListing {
  const prefabs: CatalogedPrefab[] = [];
  const problems: InvalidPrefabs[] = [...invalid];

  for (const row of raw) {
    if (typeof row !== 'object' || row === null) {
      problems.push({ file: 'unknown', errors: [`expected a prefab object, got ${typeof row}`] });
      continue;
    }
    const { catalog: rawCatalog, ...definition } = row as Record<string, unknown>;
    const catalog = typeof rawCatalog === 'string' ? rawCatalog : 'unknown';
    const parsed = parsePrefabCatalog({ schemaVersion: 1, id: 'merged', prefabs: [definition] });
    const validated = parsed.ok ? parsed.catalog.prefabs[0] : undefined;
    if (validated === undefined) {
      problems.push({
        file: catalog,
        errors: parsed.ok ? ['the prefab did not survive validation'] : parsed.errors,
      });
      continue;
    }
    prefabs.push({ ...validated, catalog });
  }

  return { prefabs, invalid: problems };
}
