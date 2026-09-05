/**
 * @wov/gameplay — gameplay state and systems.
 *
 * Hard rule (spec §25, agent rule 7): gameplay state never lives inside a
 * Babylon.js mesh, and this package never imports a renderer. Phase 0 only
 * fixes the entity identity type that later systems build on; no gameplay
 * systems are implemented yet.
 */

/** Opaque id of a runtime entity. Distinct from the authored world entity id. */
export type EntityId = string & { readonly __brand: 'EntityId' };

/** Creates an {@link EntityId} from a raw string. */
export function toEntityId(raw: string): EntityId {
  if (raw.length === 0) {
    throw new Error('toEntityId: id must not be empty');
  }
  return raw as EntityId;
}
