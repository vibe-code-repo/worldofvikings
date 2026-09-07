/**
 * The checks that span two content files, which no single-file schema can make:
 * a prefab id must be unique across all catalogs, an entity may only reference
 * a prefab that exists (ADR-0016), a zone's terrain may only name assets the
 * manifest declares (ADR-0020), and a zone's sound may only name clips,
 * surfaces and emitter anchors that exist (ADR-0052).
 *
 * Pure functions so they are tested directly instead of through the script.
 */
import { terrainAssetPaths } from '@wov/world-schema';
import type {
  PrefabCatalog,
  SoundProfile,
  WorldDefinition,
  ZoneDefinition,
} from '@wov/world-schema';

/** One parsed catalog together with the file it came from, for the message. */
export interface LoadedCatalog {
  readonly file: string;
  readonly catalog: PrefabCatalog;
}

export interface PrefabIdIndex {
  /** Every prefab id known to the repository. */
  readonly ids: ReadonlySet<string>;
  /** One message per id claimed by more than one catalog. */
  readonly duplicates: readonly string[];
}

/**
 * Indexes all catalogs by prefab id.
 *
 * An entity references a prefab by its bare id, with no catalog name, so two
 * catalogs using the same id would make the reference ambiguous — which file
 * wins would depend on read order.
 */
export function collectPrefabIds(catalogs: readonly LoadedCatalog[]): PrefabIdIndex {
  const owners = new Map<string, string>();
  const ids = new Set<string>();
  const duplicates: string[] = [];

  for (const { file, catalog } of catalogs) {
    for (const prefab of catalog.prefabs) {
      const owner = owners.get(prefab.id);
      if (owner !== undefined) {
        duplicates.push(`prefab id "${prefab.id}" is defined in both ${owner} and ${file}`);
        continue;
      }
      owners.set(prefab.id, file);
      ids.add(prefab.id);
    }
  }

  return { ids, duplicates };
}

/** One message per entity whose `prefab` does not exist. */
export function findUnknownPrefabReferences(
  world: WorldDefinition,
  prefabIds: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];
  for (const zone of world.zones) {
    for (const entity of zone.entities) {
      if (!prefabIds.has(entity.prefab)) {
        messages.push(`${zone.id}/${entity.id} references unknown prefab "${entity.prefab}"`);
      }
    }
  }
  return messages;
}

/**
 * One message per terrain asset a world names that the manifest does not list.
 *
 * Terrain is the first world data that points straight at asset *paths* rather
 * than at a prefab id, so this is the check that keeps a world file from
 * referring to a height field or a splat map nobody has declared. The paths come
 * from `terrainAssetPaths`, which is the schema package's own answer to "what
 * does a terrain need", so a new field cannot be forgotten here.
 */
export function findMissingTerrainAssets(
  world: WorldDefinition,
  assetPaths: ReadonlySet<string>,
): string[] {
  const messages: string[] = [];
  for (const zone of world.zones) {
    if (zone.terrain === undefined) {
      continue;
    }
    for (const path of terrainAssetPaths(zone.terrain)) {
      if (!assetPaths.has(path)) {
        messages.push(`${zone.id}/terrain references unknown asset "${path}"`);
      }
    }
  }
  return messages;
}

/**
 * The checks a sound block needs and no schema can make (ADR-0052).
 *
 * Four things, all of which are silent failures at runtime and loud ones here:
 *
 * 1. **`layerSurfaces` must be as long as the terrain has layers.** It is an
 *    array parallel to `terrain.layers`, and the day a layer is inserted in the
 *    middle the two drift and every footstep on the tail of the tile is wrong.
 *    This is the check that pays for keeping the surface out of the layer
 *    itself, and ADR-0052 records moving it there once that block is free.
 * 2. **Every clip must be declared in the manifest**, exactly as a terrain's
 *    height field must be — the same rule, for the same reason.
 * 3. **Every surface named must have a bank**, or the footstep is silence with
 *    no error anywhere.
 * 4. **Every emitter must point at something that exists**: a prefab in the
 *    catalogue, or an entity in its own zone.
 */
export function findSoundProblems(
  world: WorldDefinition,
  known: { readonly assetPaths: ReadonlySet<string>; readonly prefabIds: ReadonlySet<string> },
): string[] {
  const messages: string[] = [];

  const check = (where: string, sound: SoundProfile | undefined, zone?: ZoneDefinition): void => {
    if (sound === undefined) {
      return;
    }
    for (const path of soundAssetPaths(sound)) {
      if (!known.assetPaths.has(path)) {
        messages.push(`${where}/sound references unknown asset "${path}"`);
      }
    }
    for (const emitter of sound.emitters ?? []) {
      if (emitter.prefab !== undefined && !known.prefabIds.has(emitter.prefab)) {
        messages.push(
          `${where}/sound emitter "${emitter.id}" references unknown prefab "${emitter.prefab}"`,
        );
      }
      if (
        emitter.entity !== undefined &&
        zone !== undefined &&
        !zone.entities.some((entity) => entity.id === emitter.entity)
      ) {
        messages.push(
          `${where}/sound emitter "${emitter.id}" references unknown entity "${emitter.entity}"`,
        );
      }
    }
  };

  check(world.id, world.sound);
  for (const zone of world.zones) {
    check(zone.id, zone.sound, zone);

    // The effective footsteps of this zone: its own block over the world's,
    // which is the same precedence the engine resolves with.
    const footsteps = { ...world.sound?.footsteps, ...zone.sound?.footsteps };
    const layerSurfaces = footsteps.layerSurfaces;
    const layers = zone.terrain?.layers?.length;
    if (layerSurfaces !== undefined && layers !== undefined && layerSurfaces.length !== layers) {
      messages.push(
        `${zone.id}/sound.footsteps.layerSurfaces has ${String(layerSurfaces.length)} entries ` +
          `but the terrain has ${String(layers)} layers`,
      );
    }

    const banks = new Set(
      (zone.sound?.footsteps?.banks ?? world.sound?.footsteps?.banks ?? []).map(
        (bank) => bank.surface,
      ),
    );
    if (banks.size === 0) {
      continue;
    }
    for (const surface of new Set([...(layerSurfaces ?? []), footsteps.defaultSurface])) {
      if (surface !== undefined && !banks.has(surface)) {
        messages.push(`${zone.id}/sound names surface "${surface}", which has no footstep bank`);
      }
    }
  }

  return messages;
}

/** Every asset path a sound profile names: the bed, the emitters, the banks. */
function soundAssetPaths(sound: SoundProfile): string[] {
  const paths: string[] = [];
  if (sound.ambience?.clip !== undefined) {
    paths.push(sound.ambience.clip);
  }
  for (const emitter of sound.emitters ?? []) {
    paths.push(emitter.clip, ...(emitter.variants ?? []));
  }
  for (const bank of sound.footsteps?.banks ?? []) {
    paths.push(...bank.clips);
  }
  return paths;
}
