/**
 * @wov/content-build — the content build steps, as functions instead of scripts.
 *
 * Importing a scene bundle into a world file and turning the asset manifest
 * into a prefab catalogue are the two jobs that used to exist only as
 * `tooling/scripts/*.ts`. That made them things the editor could not do, which
 * is the gap ADR-0033 closes: the core moved here, `tooling/` kept the command
 * line around it, and `services/api` can now run the very same function for the
 * editor's *World* menu.
 *
 * Node built-ins are allowed — this package reads and writes files, and both of
 * its callers are Node. Babylon.js and React are not: nothing here draws.
 */
export {
  IDENTITY,
  assertSupported,
  countMissingNormals,
  countTriangles,
  describeImage,
  ensureNormals,
  multiply,
  nodeMatrix,
  readGlb,
  repackBuffer,
  takeEmbeddedImages,
  walkNodes,
  worldBounds,
  worldPositions,
  wrapInRoot,
  writeGlb,
} from './glb.js';
export type {
  Bounds,
  ExtractedImage,
  Glb,
  Gltf,
  GltfAccessor,
  GltfBufferView,
  GltfImage,
  GltfMesh,
  GltfNode,
  GltfPrimitive,
  Matrix4,
} from './glb.js';

export { measureTrunkBox, roundBounds } from './collision.js';
export type { TrunkOptions } from './collision.js';

export {
  IMPORTED_CATALOG_ID,
  buildImportedCatalog,
  colliderPathFor,
  hasTrunk,
  isColliderAsset,
  isPlaceableAsset,
  prefabCategoryFromAssetPath,
  prefabCollisionFor,
  prefabFromAsset,
  prefabIdFromAssetPath,
  prefabNameFromAssetPath,
} from './prefab-catalog.js';
export type { CatalogInputs } from './prefab-catalog.js';

export { loadPrefabStems } from './prefab-stems.js';
export type { PrefabStems } from './prefab-stems.js';

export {
  DEFAULT_ZONES,
  MIRROR_X,
  POSITION_DIGITS,
  ROTATION_DIGITS,
  SCALE_DIGITS,
  carryOverAuthoredBlocks,
  compose,
  decompose,
  matchName,
  matchesRoot,
  mirrorX,
  nameCandidates,
  round,
  scanScene,
  toEntities,
  toKebab,
} from './scene-import.js';
export type {
  EntityRecord,
  SceneInstance,
  SceneMiss,
  SceneScan,
  SceneScanOptions,
  Transform,
  ZoneRule,
} from './scene-import.js';

export { importSceneBundle } from './import-scene.js';
export type {
  SceneImportOptions,
  SceneImportReport,
  SceneImportResult,
  SceneImportZoneReport,
  SceneMissGroup,
} from './import-scene.js';

export { generatePrefabCatalog } from './generate-prefabs.js';
export type {
  GeneratePrefabsOptions,
  GeneratePrefabsReport,
  GeneratePrefabsResult,
} from './generate-prefabs.js';
