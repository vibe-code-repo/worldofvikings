/**
 * @wov/editor-core — editor-only logic: the document, the commands that change
 * it, undo/redo, selection and snapping.
 *
 * Hard rule (spec §10): nothing in `apps/game` may import this package. The
 * boundary is enforced by `pnpm lint:boundaries`, not only by convention.
 *
 * Nothing here knows about Babylon.js or React. `apps/editor` owns the canvas
 * and the panels; this package owns what an edit *is*, so every rule about
 * world data can be tested without a browser.
 */
export {
  activeZone,
  createDocument,
  createEmptyWorld,
  findEntity,
  findZone,
  markSaved,
  selectedEntities,
  serializeDocument,
} from './document.js';
export type { EditorDocument, SerializeResult } from './document.js';

export {
  addEntities,
  addEntity,
  addZone,
  applyCommand,
  duplicateEntities,
  invertCommand,
  removeEntities,
  removeZone,
  renameEntity,
  updateTransform,
} from './commands.js';
export type {
  AddEntitiesCommand,
  AddZoneCommand,
  AppliedCommand,
  CommandResult,
  DuplicateEntitiesCommand,
  EditorCommand,
  EditorCommandKind,
  EntityPlacement,
  RemoveEntitiesCommand,
  RemoveZoneCommand,
  RenameEntityCommand,
  TransformChange,
  TransformPatch,
  UpdateTransformCommand,
} from './commands.js';

export {
  DEFAULT_HISTORY_LIMIT,
  canRedo,
  canUndo,
  createEditorState,
  createHistory,
  execute,
  redo,
  undo,
} from './history.js';
export type {
  DocumentView,
  EditorHistory,
  EditorState,
  ExecuteResult,
  HistoryEntry,
} from './history.js';

export { clearSelection, setActiveZone, setSelection, toggleSelection } from './selection.js';

export { entityIdBase, nextEntityId, nextEntityIds } from './ids.js';

export {
  DEFAULT_GRID_STEP,
  DEFAULT_ROTATION_STEP_DEGREES,
  gridSnap,
  snapPosition,
  snapRotation,
  snapRotationAngle,
} from './snapping.js';
