import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** A JSON file that could be read and parsed, or the reason it could not. */
export type JsonFileResult =
  | {
      readonly status: 'ok';
      readonly data: unknown;
      readonly updatedAt: string;
      /** Bytes on disk. Half of the response's cache validator (ADR-0052). */
      readonly size: number;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'unreadable'; readonly errors: readonly string[] };

/**
 * The `.json` files of one content folder, sorted by name. A missing folder is
 * an empty folder: a clean clone has `content/prefabs/` empty, and the editor
 * must still start.
 */
export async function listJsonFiles(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function readJsonFile(path: string): Promise<JsonFileResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return { status: 'not-found' };
    }
    throw error;
  }

  const stamp = await fileStamp(path);
  try {
    return { status: 'ok', data: JSON.parse(text), ...stamp };
  } catch (error) {
    return { status: 'unreadable', errors: [`<root>: ${describe(error)}`] };
  }
}

/**
 * Writes a file atomically: a temporary file next to the target, then a
 * rename. A crash or a second writer therefore leaves either the old file or
 * the new one, never half of a world.
 */
export async function writeJsonFileAtomically(
  path: string,
  text: string,
): Promise<{ created: boolean; updatedAt: string }> {
  const folder = dirname(path);
  await mkdir(folder, { recursive: true });

  const created = !(await exists(path));
  // Hidden and suffixed, so a crashed write is never mistaken for content:
  // `pnpm validate:content` only reads `*.json`.
  const temporary = join(folder, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  return { created, updatedAt: await modifiedAt(path) };
}

export async function modifiedAt(path: string): Promise<string> {
  return (await stat(path)).mtime.toISOString();
}

/**
 * Modification time and size in one `stat`.
 *
 * The pair is what a cache validator is built from (ADR-0052), and reading it
 * twice would be two chances for the file to change between them.
 */
export async function fileStamp(path: string): Promise<{ updatedAt: string; size: number }> {
  const stats = await stat(path);
  return { updatedAt: stats.mtime.toISOString(), size: stats.size };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
