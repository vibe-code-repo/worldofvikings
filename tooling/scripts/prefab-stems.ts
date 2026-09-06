/**
 * Reading `content/prefabs/` as "which store file is which prefab".
 *
 * A bundle node is called `SM_Env_StoneWall_01 (12)`; the prefab that means is
 * `environment-sm-env-stonewall-01`. The two meet at the **store file stem** —
 * the file name without folder or extension — because that is the only part of
 * the id a level designer ever typed. Both scene tools index the catalogues the
 * same way, so they can never disagree about what a name means.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePrefabCatalog } from '@wov/world-schema';
import { toKebab } from './scene-import.js';

export interface PrefabStems {
  /** Store file stem to prefab id. */
  readonly byStem: ReadonlyMap<string, string>;
  /**
   * Stems two catalogues both claim, left out of {@link byStem}.
   *
   * Dropped rather than resolved: picking one of two prefabs for an ambiguous
   * name would place a model that is possibly the wrong one and never say so.
   * Naming them in the report makes it a catalogue problem, which is what it is.
   */
  readonly ambiguous: readonly string[];
}

/** Reads every catalogue in a directory. Throws with the file name on bad data. */
export async function loadPrefabStems(directory: string): Promise<PrefabStems> {
  const byStem = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const fileName of (await readdir(directory)).sort()) {
    if (!fileName.endsWith('.json')) {
      continue;
    }
    const parsed = parsePrefabCatalog(
      JSON.parse(await readFile(join(directory, fileName), 'utf8')),
    );
    if (!parsed.ok) {
      throw new Error(`${fileName}: ${parsed.errors.join('; ')}`);
    }
    for (const prefab of parsed.catalog.prefabs) {
      const stem = toKebab(prefab.asset.split('/').at(-1) ?? prefab.asset);
      const claimed = byStem.get(stem);
      if (claimed !== undefined && claimed !== prefab.id) {
        ambiguous.add(stem);
        byStem.delete(stem);
        continue;
      }
      if (!ambiguous.has(stem)) {
        byStem.set(stem, prefab.id);
      }
    }
  }

  return { byStem, ambiguous: [...ambiguous].sort() };
}
