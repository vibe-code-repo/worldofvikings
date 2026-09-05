/** Opaque id of a runtime entity. Distinct from the authored world entity id. */
export type EntityId = string & { readonly __brand: 'EntityId' };

/** Creates an {@link EntityId} from a raw string. */
export function toEntityId(raw: string): EntityId {
  if (raw.length === 0) {
    throw new Error('toEntityId: id must not be empty');
  }
  return raw as EntityId;
}
