/**
 * The game's read-only client for `services/api` (ADR-0017, ADR-0022).
 *
 * Two calls, both `GET`: the world it is about to walk around in, and the
 * prefab catalogue that says which file each entity's `prefab` is. The client
 * never writes — authoring is the editor's job — and it never reads
 * `assets/manifest.json`: the manifest is a build-time document about what
 * `assets/` should contain, and the game learns where bytes live from the
 * catalogue instead (ADR-0015, checked by `pnpm lint:boundaries`).
 *
 * Both answers are validated with the same schemas the API validated them
 * with (agent rule 10). The client is a separate program from the service and
 * may be older or newer than it, so a version skew has to become a stated
 * problem rather than an undefined field halfway through building a scene.
 */
import { parsePrefabCatalog, parseWorldDefinition } from '@wov/world-schema';
import type { PrefabDefinition, WorldDefinition } from '@wov/world-schema';

/** A request that did not succeed, with the API's own message where there is one. */
export class WorldApiError extends Error {
  override readonly name = 'WorldApiError';

  constructor(
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

export interface WorldApi {
  /** `GET /worlds/:id`, validated. */
  loadWorld(id: string): Promise<WorldDefinition>;
  /** `GET /prefabs`, validated; rows that do not validate are left out. */
  loadPrefabs(): Promise<readonly PrefabDefinition[]>;
}

/** Reads the API's own `{ error, message }` body, falling back to the status. */
async function describeFailure(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const message = (body as Record<string, unknown>)['message'];
      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // A non-JSON body is not a second failure; the status still describes it.
  }
  return `${String(response.status)} ${response.statusText}`;
}

/**
 * Picks the prefab rows out of a `GET /prefabs` body.
 *
 * The API merges the catalogues and adds a `catalog` field per row, which is
 * not part of the prefab format — it is lifted off before validation, because
 * the only prefab validator there is is the schema, and a second copy of its
 * rules here is what agent rule 11 forbids.
 *
 * A row that does not validate is dropped and named. Refusing the whole
 * catalogue over one bad entry would take a working world off the screen for a
 * prefab nothing in it references.
 */
export function readPrefabs(body: unknown): {
  readonly prefabs: readonly PrefabDefinition[];
  readonly invalid: readonly string[];
} {
  const rows = (body as Record<string, unknown> | null)?.['prefabs'];
  if (!Array.isArray(rows)) {
    return { prefabs: [], invalid: ['the API answered without a "prefabs" list'] };
  }

  const definitions: unknown[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      invalid.push(`expected a prefab object, got ${typeof row}`);
      continue;
    }
    const { catalog: _catalog, ...definition } = row as Record<string, unknown>;
    definitions.push(definition);
  }

  const parsed = parsePrefabCatalog({ schemaVersion: 1, id: 'merged', prefabs: definitions });
  if (parsed.ok) {
    return { prefabs: parsed.catalog.prefabs, invalid };
  }
  // One bad row fails the whole catalogue, so the rows are validated again one
  // at a time to find out which. That second pass only runs when something is
  // already wrong, so the common case stays one validation of one document.
  const prefabs: PrefabDefinition[] = [];
  for (const definition of definitions) {
    const one = parsePrefabCatalog({ schemaVersion: 1, id: 'merged', prefabs: [definition] });
    const validated = one.ok ? one.catalog.prefabs[0] : undefined;
    if (validated === undefined) {
      invalid.push(one.ok ? 'a prefab did not survive validation' : one.errors.join('; '));
      continue;
    }
    prefabs.push(validated);
  }
  return { prefabs, invalid };
}

/**
 * Creates a client for the API at `baseUrl` (no trailing slash).
 *
 * `doFetch` is injected so the request handling has one implementation rather
 * than a second, divergent copy in the tests.
 */
export function createWorldApi(baseUrl: string, doFetch: typeof fetch = fetch): WorldApi {
  const call = async (path: string): Promise<unknown> => {
    const url = `${baseUrl}${path}`;
    let response: Response;
    try {
      response = await doFetch(url);
    } catch {
      // A dead API is the most likely thing to be wrong on a fresh clone, so it
      // says which URL it tried rather than "failed to fetch".
      throw new WorldApiError(url, `cannot reach the API at ${url} — is \`pnpm dev\` running?`);
    }
    if (!response.ok) {
      throw new WorldApiError(url, await describeFailure(response));
    }
    return response.json();
  };

  return {
    async loadWorld(id) {
      const path = `/worlds/${encodeURIComponent(id)}`;
      const parsed = parseWorldDefinition(await call(path));
      if (!parsed.ok) {
        throw new WorldApiError(
          `${baseUrl}${path}`,
          `the world "${id}" does not match the schema: ${parsed.errors.join('; ')}`,
        );
      }
      return parsed.world;
    },

    async loadPrefabs() {
      const { prefabs, invalid } = readPrefabs(await call('/prefabs'));
      for (const problem of invalid) {
        console.warn(`[game] a prefab from the API was left out: ${problem}`);
      }
      return prefabs;
    },
  };
}
