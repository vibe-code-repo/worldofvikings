/**
 * The editor's document: the world being edited, plus the view state that goes
 * with it (what is selected, which zone is active, whether it needs saving).
 *
 * Plain data and pure functions — no Babylon.js, no React. The viewport renders
 * a document, the panels read one, and every change goes through a command
 * (see `commands.ts`), so the same edit is testable without a browser.
 */
import {
  CURRENT_WORLD_SCHEMA_VERSION,
  parseWorldDefinition,
  type EntityDefinition,
  type WorldDefinition,
  type ZoneDefinition,
} from '@wov/world-schema';

export interface EditorDocument {
  /** The world exactly as it would be written to `content/worlds/`. */
  readonly world: WorldDefinition;
  /** Entity ids selected in the active zone, in the order they were picked. */
  readonly selection: readonly string[];
  /** The zone the viewport edits; `null` only while the world has no zone. */
  readonly activeZoneId: string | null;
  /** Whether the world differs from the last saved file. */
  readonly dirty: boolean;
}

/** Creates an empty, valid world document for a fresh editor session. */
export function createEmptyWorld(id: string, name: string): WorldDefinition {
  return {
    schemaVersion: CURRENT_WORLD_SCHEMA_VERSION,
    id,
    name,
    zones: [],
  };
}

/** Opens a world for editing: nothing selected, first zone active, not dirty. */
export function createDocument(world: WorldDefinition): EditorDocument {
  return {
    world,
    selection: [],
    activeZoneId: world.zones[0]?.id ?? null,
    dirty: false,
  };
}

export function findZone(document: EditorDocument, zoneId: string): ZoneDefinition | undefined {
  return document.world.zones.find((zone) => zone.id === zoneId);
}

export function activeZone(document: EditorDocument): ZoneDefinition | undefined {
  return document.activeZoneId === null ? undefined : findZone(document, document.activeZoneId);
}

export function findEntity(
  document: EditorDocument,
  zoneId: string,
  entityId: string,
): EntityDefinition | undefined {
  return findZone(document, zoneId)?.entities.find((entity) => entity.id === entityId);
}

/**
 * The selected entities in **file order**, not selection order — the hierarchy
 * and the inspector show a world, not a click history.
 */
export function selectedEntities(document: EditorDocument): readonly EntityDefinition[] {
  const selected = new Set(document.selection);
  return activeZone(document)?.entities.filter((entity) => selected.has(entity.id)) ?? [];
}

/** After a successful save: same world, no longer dirty. */
export function markSaved(document: EditorDocument): EditorDocument {
  return document.dirty ? { ...document, dirty: false } : document;
}

/** Result of {@link serializeDocument}. */
export type SerializeResult =
  | { readonly ok: true; readonly world: WorldDefinition }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * The world to write to disk, validated first.
 *
 * The commands keep the document valid, so this normally succeeds — it is here
 * because "normally" is not "always": a caller may build a document by hand,
 * and the editor must never write a file the game would reject at load time
 * (agent rule 10).
 */
export function serializeDocument(document: EditorDocument): SerializeResult {
  const result = parseWorldDefinition(document.world);
  return result.ok ? { ok: true, world: result.world } : { ok: false, errors: result.errors };
}
