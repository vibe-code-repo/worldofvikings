/**
 * Turning the emitters a world file states into the places a sound is actually
 * made — the arithmetic, with no Babylon.js in it.
 *
 * An emitter is one of three things (see `SoundEmitterSchema`): a rule over a
 * prefab, one named entity, or a bare point. Only the third already knows where
 * it is. The first two have to be looked up against the zone's entities, and
 * that lookup is a decision worth watching in a test: a rule that matches
 * nothing, a rule that matches four hundred things, an entity id that was
 * renamed — each of them is a world-file mistake that must be *reported*, never
 * silently dropped and never silently multiplied into four hundred panners.
 */
import type { SoundEmitterOptions } from './sound-profile.js';

/** One entity of a zone, as far as an emitter is concerned. */
export interface PlacedEntity {
  readonly id: string;
  readonly prefab: string;
  readonly position: readonly [number, number, number];
}

/** One sound, at one place. */
export interface EmitterPlacement {
  readonly emitter: SoundEmitterOptions;
  /** The entity this sound hangs on, or `null` for a bare point. */
  readonly entity: string | null;
  /** Where it stands, from the entity or from the emitter itself. */
  readonly position: readonly [number, number, number];
}

/** What {@link planEmitters} found, including what it could not find. */
export interface EmitterPlan {
  readonly placements: readonly EmitterPlacement[];
  /** Emitters whose prefab or entity is not in this zone, by id. */
  readonly unmatched: readonly string[];
  /** Emitters whose prefab rule matched more than `maxCount`, by id. */
  readonly capped: readonly string[];
}

/**
 * Expands every emitter of a profile against a zone's entities.
 *
 * Prefab rules keep the zone's own entity order, so a village that grows a
 * twelfth brazier gets it at the end rather than in place of one that was
 * already sounding — which matters the moment `maxCount` bites, because it
 * decides *which* eleven are heard.
 */
export function planEmitters(
  emitters: readonly SoundEmitterOptions[],
  entities: readonly PlacedEntity[],
): EmitterPlan {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const placements: EmitterPlacement[] = [];
  const unmatched: string[] = [];
  const capped: string[] = [];

  for (const emitter of emitters) {
    if (emitter.position !== undefined) {
      placements.push({ emitter, entity: null, position: emitter.position });
      continue;
    }
    if (emitter.entity !== undefined) {
      const found = byId.get(emitter.entity);
      if (found === undefined) {
        unmatched.push(emitter.id);
        continue;
      }
      placements.push({ emitter, entity: found.id, position: found.position });
      continue;
    }
    if (emitter.prefab === undefined) {
      // The schema refuses this, so reaching it means an unvalidated profile
      // came in through the engine's own API. Reported, not thrown: one broken
      // emitter must not cost a zone its other sixteen.
      unmatched.push(emitter.id);
      continue;
    }
    const matches = entities.filter((entity) => entity.prefab === emitter.prefab);
    if (matches.length === 0) {
      unmatched.push(emitter.id);
      continue;
    }
    if (matches.length > emitter.maxCount) {
      capped.push(emitter.id);
    }
    for (const entity of matches.slice(0, emitter.maxCount)) {
      placements.push({ emitter, entity: entity.id, position: entity.position });
    }
  }

  return { placements, unmatched, capped };
}

/** The straight-line distance between two points, in metres. */
export function distanceBetween(
  a: readonly [number, number, number],
  b: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z);
}
