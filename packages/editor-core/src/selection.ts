/**
 * Selection and the active zone — view state, not world data.
 *
 * Changing what is selected never makes a document dirty and never enters the
 * undo history: it is not an edit. Undo still *restores* a selection, because
 * the history remembers the view each command was made in (see `history.ts`).
 */
import { activeZone, type EditorDocument } from './document.js';

/**
 * Selects exactly these entities.
 *
 * Ids that are not in the active zone are dropped rather than remembered:
 * a selection that outlives its entity is how a panel ends up showing a ghost.
 */
export function setSelection(
  document: EditorDocument,
  entityIds: readonly string[],
): EditorDocument {
  const zone = activeZone(document);
  if (zone === undefined) {
    return document.selection.length === 0 ? document : { ...document, selection: [] };
  }

  const known = new Set(zone.entities.map((entity) => entity.id));
  const selection: string[] = [];
  for (const entityId of entityIds) {
    if (known.has(entityId) && !selection.includes(entityId)) {
      selection.push(entityId);
    }
  }
  return { ...document, selection };
}

/** Adds an entity to the selection, or removes it if it is already in it. */
export function toggleSelection(document: EditorDocument, entityId: string): EditorDocument {
  const next = document.selection.includes(entityId)
    ? document.selection.filter((id) => id !== entityId)
    : [...document.selection, entityId];
  return setSelection(document, next);
}

export function clearSelection(document: EditorDocument): EditorDocument {
  return document.selection.length === 0 ? document : { ...document, selection: [] };
}

/**
 * Switches the active zone and clears the selection, which belonged to the zone
 * being left. An unknown zone id changes nothing.
 */
export function setActiveZone(document: EditorDocument, zoneId: string | null): EditorDocument {
  if (zoneId !== null && !document.world.zones.some((zone) => zone.id === zoneId)) {
    return document;
  }
  if (document.activeZoneId === zoneId) {
    return document;
  }
  return { ...document, activeZoneId: zoneId, selection: [] };
}
