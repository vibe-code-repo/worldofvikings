import { join } from 'node:path';
import { parseWorldDefinition, type WorldDefinition } from '@wov/world-schema';
import { contentFilePath, isContentId } from './content-ids.js';
import { listJsonFiles, readJsonFile, writeJsonFileAtomically } from './content-files.js';
import { serializeWorld } from './world-file.js';

/** The folder inside `CONTENT_DIR` that holds world files. */
export const WORLDS_FOLDER = 'worlds';

/** One row of `GET /worlds` — enough for a world picker, without the entities. */
export interface WorldSummary {
  readonly id: string;
  readonly name: string;
  readonly zones: number;
  /** File modification time, ISO 8601. */
  readonly updatedAt: string;
}

/** A world file that exists but cannot be used, with the reasons. */
export interface InvalidWorldFile {
  readonly id: string;
  readonly errors: readonly string[];
}

export interface WorldListing {
  readonly worlds: readonly WorldSummary[];
  readonly invalid: readonly InvalidWorldFile[];
}

export type LoadedWorld =
  | { readonly status: 'ok'; readonly world: WorldDefinition; readonly updatedAt: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'invalid'; readonly errors: readonly string[] };

/**
 * Every world file, validated.
 *
 * Broken files are reported rather than skipped: a world that silently
 * disappears from the editor's list is the worst possible answer to a typo in
 * a file somebody is editing.
 */
export async function listWorlds(contentDir: string): Promise<WorldListing> {
  const folder = join(contentDir, WORLDS_FOLDER);
  const worlds: WorldSummary[] = [];
  const invalid: InvalidWorldFile[] = [];

  for (const file of await listJsonFiles(folder)) {
    const id = file.slice(0, -'.json'.length);
    if (!isContentId(id)) {
      invalid.push({ id, errors: [`file name "${file}" is not a valid world id`] });
      continue;
    }

    const loaded = await loadWorld(contentDir, id);
    if (loaded.status === 'ok') {
      worlds.push({
        id: loaded.world.id,
        name: loaded.world.name,
        zones: loaded.world.zones.length,
        updatedAt: loaded.updatedAt,
      });
    } else if (loaded.status === 'invalid') {
      invalid.push({ id, errors: loaded.errors });
    }
  }

  return { worlds, invalid };
}

export async function loadWorld(contentDir: string, id: string): Promise<LoadedWorld> {
  const file = await readJsonFile(contentFilePath(contentDir, WORLDS_FOLDER, id));
  if (file.status === 'not-found') {
    return { status: 'not-found' };
  }
  if (file.status === 'unreadable') {
    return { status: 'invalid', errors: file.errors };
  }

  const parsed = parseWorldDefinition(file.data);
  if (!parsed.ok) {
    return { status: 'invalid', errors: parsed.errors };
  }
  return { status: 'ok', world: parsed.world, updatedAt: file.updatedAt };
}

export async function saveWorld(
  contentDir: string,
  world: WorldDefinition,
): Promise<{ created: boolean; updatedAt: string }> {
  const path = contentFilePath(contentDir, WORLDS_FOLDER, world.id);
  return writeJsonFileAtomically(path, serializeWorld(world));
}
