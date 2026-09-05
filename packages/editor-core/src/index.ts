/**
 * @wov/editor-core — editor-only logic (selection, commands, undo/redo).
 *
 * Hard rule (spec §10): nothing in `apps/game` may import this package. The
 * boundary is enforced by `pnpm lint:boundaries`, not only by convention.
 *
 * Phase 0 only contains the empty-document factory so that the editor shell has
 * something real to render against.
 */
import { CURRENT_WORLD_SCHEMA_VERSION, type WorldDefinition } from '@wov/world-schema';

/** Creates an empty, valid world document for a fresh editor session. */
export function createEmptyWorld(id: string, name: string): WorldDefinition {
  return {
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id,
    name,
    zones: [],
  };
}
