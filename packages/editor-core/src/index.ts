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
  renameZone,
  setLighting,
  setLightingField,
  setTerrain,
  setTerrainField,
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
  RenameZoneCommand,
  SetLightingCommand,
  SetTerrainCommand,
  TransformChange,
  TransformPatch,
  UpdateTransformCommand,
} from './commands.js';

export {
  lightingAt,
  parseLightingBlock,
  parseTerrainBlock,
  withLighting,
  withTerrain,
  worldLighting,
  zoneLighting,
} from './blocks.js';
export type { BlockResult, LightingScope } from './blocks.js';

export { applyFieldPatch, applyFieldPatches, restorePatch, valueAtPath } from './patch.js';
export type { FieldPatch } from './patch.js';

export { describeFields, fieldPaths, humanizeKey } from './schema-form.js';
export type {
  FormBoolean,
  FormChoice,
  FormColor,
  FormField,
  FormGroup,
  FormList,
  FormNumber,
  FormText,
  FormUnknown,
  FormVector,
} from './schema-form.js';

export { LIGHTING_FIELDS, PREFAB_COLLISION_FIELDS, TERRAIN_FIELDS } from './world-forms.js';

export { LIGHTING_PRESETS, lightingPreset } from './lighting-presets.js';
export type { LightingPreset } from './lighting-presets.js';

export {
  IMPORTED_CATALOG_ID,
  OVERRIDE_CATALOG_ID,
  catalogForEdit,
  editedPrefab,
  emptyOverrideCatalog,
  withPrefab,
} from './prefab-overrides.js';
export type { PrefabEdit } from './prefab-overrides.js';

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

export { footprintOf, footprintsOf } from './footprint.js';
export type { FootprintOptions } from './footprint.js';

export { createRandom } from './random.js';
export type { Random } from './random.js';

export {
  AREA_PROBES,
  SCATTER_ATTEMPTS,
  SCATTER_DENSITY_AREA,
  SCATTER_MAXIMUM,
  insideRegion,
  planScatter,
  scatterCommand,
  scatterId,
  usableArea,
} from './scatter.js';
export type {
  Point2,
  Rect,
  ScatterOptions,
  ScatterPlan,
  ScatterRegion,
  WeightedPrefab,
} from './scatter.js';

export {
  DEFAULT_GRID_STEP,
  DEFAULT_ROTATION_STEP_DEGREES,
  gridSnap,
  snapPosition,
  snapRotation,
  snapRotationAngle,
} from './snapping.js';
