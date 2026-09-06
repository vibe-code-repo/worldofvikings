/**
 * Editing as data: every change to a world is an {@link EditorCommand} value,
 * applied by one pure function.
 *
 * Two consequences the editor depends on:
 *
 * - **Undo is not a special case.** {@link applyCommand} returns the inverse
 *   command next to the new document, so the history (see `history.ts`) only
 *   ever stores two values per step, never a copy of the world.
 * - **A command can fail.** Applying returns a result instead of throwing, so a
 *   keystroke that cannot be honoured — an id already taken, a zone that is
 *   gone — leaves the document untouched and gives the shell a message.
 *
 * The inverse depends on the state the command was applied to (removing an
 * entity has to remember which entity and at which index), which is why it is
 * computed here and not by a lone `invert(command)`.
 */
import {
  EntityDefinitionSchema,
  IdentifierSchema,
  TerrainDefinitionSchema,
  ZoneDefinitionSchema,
  type EntityDefinition,
  type TerrainDefinition,
  type TerrainLayer,
  type Vector3,
  type WorldDefinition,
  type ZoneDefinition,
} from '@wov/world-schema';
import { findZone, type EditorDocument } from './document.js';
import { nextEntityIds } from './ids.js';

/** An entity together with the position it takes in the zone's entity list. */
export interface EntityPlacement {
  readonly entity: EntityDefinition;
  /** Index in the zone; appended when absent. */
  readonly index?: number;
}

/**
 * What a transform change does to one field: a value sets it, `null` removes
 * it, an absent key leaves it alone.
 *
 * `rotation` and `scale` are optional in a world file, so "no rotation" and
 * "rotation zero" are different states, and undo has to be able to restore the
 * first one.
 */
export interface TransformPatch {
  readonly position?: Vector3;
  readonly rotation?: Vector3 | null;
  readonly scale?: Vector3 | null;
}

export interface TransformChange {
  readonly entityId: string;
  readonly patch: TransformPatch;
}

export interface AddEntitiesCommand {
  readonly kind: 'addEntities';
  readonly zoneId: string;
  readonly entries: readonly EntityPlacement[];
}

export interface RemoveEntitiesCommand {
  readonly kind: 'removeEntities';
  readonly zoneId: string;
  readonly entityIds: readonly string[];
}

export interface UpdateTransformCommand {
  readonly kind: 'updateTransform';
  readonly zoneId: string;
  readonly changes: readonly TransformChange[];
}

export interface DuplicateEntitiesCommand {
  readonly kind: 'duplicateEntities';
  readonly zoneId: string;
  readonly entityIds: readonly string[];
  /** Added to the copy's position, so a copy is not hidden inside its source. */
  readonly offset: Vector3;
}

export interface RenameEntityCommand {
  readonly kind: 'renameEntity';
  readonly zoneId: string;
  readonly entityId: string;
  readonly nextId: string;
}

export interface AddZoneCommand {
  readonly kind: 'addZone';
  readonly zone: ZoneDefinition;
  readonly index?: number;
}

export interface RemoveZoneCommand {
  readonly kind: 'removeZone';
  readonly zoneId: string;
}

/**
 * Changes a zone's display name.
 *
 * Its `id` is deliberately not renameable here: the id is what
 * {@link EditorDocument.activeZoneId} and a future cross-zone reference point
 * at, so changing it is a migration, not an edit. The name is a label, and
 * labelling a zone properly is something an author does constantly.
 */
export interface RenameZoneCommand {
  readonly kind: 'renameZone';
  readonly zoneId: string;
  readonly name: string;
}

/**
 * What one ground layer's surface is set to. Absent means "leave it alone".
 *
 * `null` is not the same as absent: it clears the field back out of the world
 * file, which is how a layer goes back to being plain diffuse without an author
 * having to know that 0 and "not stated" render the same.
 */
export interface TerrainSurfacePatch {
  readonly normalScale?: number | null;
  readonly metallic?: number | null;
  readonly smoothness?: number | null;
}

/** One layer's index in the zone's terrain, and what to change about it. */
export interface TerrainLayerChange {
  readonly index: number;
  readonly patch: TerrainSurfacePatch;
}

/**
 * Changes how a zone's ground *behaves* — never what it is made of.
 *
 * Deliberately narrow. Which textures a terrain blends, which splat maps weight
 * them and where the tile stands are import decisions with an asset behind each
 * one; how rough the rock is and how far its bumps push is a look, and a look
 * is something an author turns a dial for and watches change. So this command
 * carries the four numbers and the one switch, and nothing that would let the
 * editor invent a layer or point one at a file that is not in the store.
 *
 * It is also the editor half of a promise: the same function backs
 * `pnpm terrain-surface`, so a value written into a world file by a script and
 * a value typed into the panel travel the same path (ADR-0032).
 */
export interface UpdateTerrainSurfaceCommand {
  readonly kind: 'updateTerrainSurface';
  readonly zoneId: string;
  /** Per-layer changes; layers not named here keep what they have. */
  readonly layers?: readonly TerrainLayerChange[];
  /** Facetted ground on or off; absent leaves it as it is. */
  readonly flatNormals?: boolean;
}

export type EditorCommand =
  | AddEntitiesCommand
  | RemoveEntitiesCommand
  | UpdateTransformCommand
  | DuplicateEntitiesCommand
  | RenameEntityCommand
  | AddZoneCommand
  | RemoveZoneCommand
  | RenameZoneCommand
  | UpdateTerrainSurfaceCommand;

export type EditorCommandKind = EditorCommand['kind'];

/** Either a value, or a message a person can act on. */
export type CommandResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface AppliedCommand {
  readonly document: EditorDocument;
  /** The command that undoes this one, on the document it produced. */
  readonly inverse: EditorCommand;
  /** Ids the command brought into existence, for the shell to select. */
  readonly createdEntityIds: readonly string[];
}

// --- command constructors ---------------------------------------------------
// Commands are plain data; these exist so callers do not spell out `kind`.

export function addEntity(
  zoneId: string,
  entity: EntityDefinition,
  options: { readonly index?: number } = {},
): AddEntitiesCommand {
  return { kind: 'addEntities', zoneId, entries: [placement(entity, options.index)] };
}

export function addEntities(
  zoneId: string,
  entries: readonly EntityPlacement[],
): AddEntitiesCommand {
  return { kind: 'addEntities', zoneId, entries };
}

export function removeEntities(
  zoneId: string,
  entityIds: readonly string[],
): RemoveEntitiesCommand {
  return { kind: 'removeEntities', zoneId, entityIds };
}

export function updateTransform(
  zoneId: string,
  changes: readonly TransformChange[],
): UpdateTransformCommand {
  return { kind: 'updateTransform', zoneId, changes };
}

export function duplicateEntities(
  zoneId: string,
  entityIds: readonly string[],
  options: { readonly offset?: Vector3 } = {},
): DuplicateEntitiesCommand {
  return { kind: 'duplicateEntities', zoneId, entityIds, offset: options.offset ?? [0, 0, 0] };
}

export function renameEntity(
  zoneId: string,
  entityId: string,
  nextId: string,
): RenameEntityCommand {
  return { kind: 'renameEntity', zoneId, entityId, nextId };
}

export function addZone(
  zone: ZoneDefinition,
  options: { readonly index?: number } = {},
): AddZoneCommand {
  return options.index === undefined
    ? { kind: 'addZone', zone }
    : { kind: 'addZone', zone, index: options.index };
}

export function removeZone(zoneId: string): RemoveZoneCommand {
  return { kind: 'removeZone', zoneId };
}

export function renameZone(zoneId: string, name: string): RenameZoneCommand {
  return { kind: 'renameZone', zoneId, name };
}

export function updateTerrainSurface(
  zoneId: string,
  options: {
    readonly layers?: readonly TerrainLayerChange[];
    readonly flatNormals?: boolean;
  } = {},
): UpdateTerrainSurfaceCommand {
  return {
    kind: 'updateTerrainSurface',
    zoneId,
    ...(options.layers === undefined ? {} : { layers: options.layers }),
    ...(options.flatNormals === undefined ? {} : { flatNormals: options.flatNormals }),
  };
}

// --- applying ---------------------------------------------------------------

/**
 * Applies a command to a document.
 *
 * The document is never mutated: the result is a new document sharing every
 * untouched zone with the old one, which is what makes undo a matter of keeping
 * two commands instead of two worlds.
 */
export function applyCommand(
  document: EditorDocument,
  command: EditorCommand,
): CommandResult<AppliedCommand> {
  switch (command.kind) {
    case 'addEntities':
      return applyAddEntities(document, command);
    case 'removeEntities':
      return applyRemoveEntities(document, command);
    case 'updateTransform':
      return applyUpdateTransform(document, command);
    case 'duplicateEntities':
      return applyDuplicateEntities(document, command);
    case 'renameEntity':
      return applyRenameEntity(document, command);
    case 'addZone':
      return applyAddZone(document, command);
    case 'removeZone':
      return applyRemoveZone(document, command);
    case 'renameZone':
      return applyRenameZone(document, command);
    case 'updateTerrainSurface':
      return applyUpdateTerrainSurface(document, command);
  }
}

/**
 * The command that undoes `command` on `document` — without applying it.
 *
 * Same computation as {@link applyCommand}, so the two can never disagree about
 * what an undo means.
 */
export function invertCommand(
  document: EditorDocument,
  command: EditorCommand,
): CommandResult<EditorCommand> {
  const applied = applyCommand(document, command);
  return applied.ok ? { ok: true, value: applied.value.inverse } : applied;
}

function applyAddEntities(
  document: EditorDocument,
  command: AddEntitiesCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  const taken = new Set(zone.entities.map((entity) => entity.id));
  for (const entry of command.entries) {
    const parsed = EntityDefinitionSchema.safeParse(entry.entity);
    if (!parsed.success) {
      return fail(`entity "${entry.entity.id}" is not valid: ${firstIssue(parsed.error.issues)}`);
    }
    if (taken.has(entry.entity.id)) {
      return fail(`entity id "${entry.entity.id}" already exists in zone "${command.zoneId}"`);
    }
    taken.add(entry.entity.id);
  }

  // Ascending, so each entry lands at the index it was recorded with even when
  // several are inserted at once — this is how an undone multi-delete comes
  // back in its original order.
  const ordered = [...command.entries].sort(
    (left, right) =>
      (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER),
  );
  const entities = [...zone.entities];
  for (const entry of ordered) {
    const at = entry.index === undefined ? entities.length : clamp(entry.index, entities.length);
    entities.splice(at, 0, entry.entity);
  }

  const created = command.entries.map((entry) => entry.entity.id);
  return ok({
    document: withZoneEntities(document, zone, entities),
    inverse: removeEntities(command.zoneId, created),
    createdEntityIds: created,
  });
}

function applyRemoveEntities(
  document: EditorDocument,
  command: RemoveEntitiesCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  const doomed = new Set(command.entityIds);
  const restore: EntityPlacement[] = [];
  for (const entityId of doomed) {
    const index = zone.entities.findIndex((entity) => entity.id === entityId);
    const entity = zone.entities[index];
    if (entity === undefined) {
      return fail(`unknown entity "${entityId}" in zone "${command.zoneId}"`);
    }
    restore.push({ entity, index });
  }
  restore.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

  const entities = zone.entities.filter((entity) => !doomed.has(entity.id));
  const next = withZoneEntities(document, zone, entities);
  return ok({
    document: { ...next, selection: next.selection.filter((id) => !doomed.has(id)) },
    inverse: addEntities(command.zoneId, restore),
    createdEntityIds: [],
  });
}

function applyUpdateTransform(
  document: EditorDocument,
  command: UpdateTransformCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  const patches = new Map<string, TransformPatch>();
  for (const change of command.changes) {
    patches.set(change.entityId, change.patch);
  }

  const inverseChanges: TransformChange[] = [];
  for (const change of command.changes) {
    const entity = zone.entities.find((candidate) => candidate.id === change.entityId);
    if (entity === undefined) {
      return fail(`unknown entity "${change.entityId}" in zone "${command.zoneId}"`);
    }
    inverseChanges.push({ entityId: entity.id, patch: inversePatch(entity, change.patch) });
  }

  const entities = zone.entities.map((entity) => {
    const patch = patches.get(entity.id);
    return patch === undefined ? entity : patchEntity(entity, patch);
  });

  return ok({
    document: withZoneEntities(document, zone, entities),
    inverse: updateTransform(command.zoneId, inverseChanges),
    createdEntityIds: [],
  });
}

function applyDuplicateEntities(
  document: EditorDocument,
  command: DuplicateEntitiesCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  const wanted = new Set(command.entityIds);
  for (const entityId of wanted) {
    if (!zone.entities.some((entity) => entity.id === entityId)) {
      return fail(`unknown entity "${entityId}" in zone "${command.zoneId}"`);
    }
  }

  // File order, not the order the ids arrive in: the same selection duplicated
  // twice must produce the same world, whatever order the shell collected it.
  const sources = zone.entities.filter((entity) => wanted.has(entity.id));
  const createdEntityIds = nextEntityIds(
    zone.entities.map((entity) => entity.id),
    sources.map((entity) => entity.prefab),
  );

  const copies = sources.map((entity, position) => ({
    ...entity,
    id: createdEntityIds[position] ?? entity.id,
    position: translate(entity.position, command.offset),
  }));

  return ok({
    document: withZoneEntities(document, zone, [...zone.entities, ...copies]),
    inverse: removeEntities(command.zoneId, createdEntityIds),
    createdEntityIds,
  });
}

function applyRenameEntity(
  document: EditorDocument,
  command: RenameEntityCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }
  if (!zone.entities.some((entity) => entity.id === command.entityId)) {
    return fail(`unknown entity "${command.entityId}" in zone "${command.zoneId}"`);
  }

  const parsed = IdentifierSchema.safeParse(command.nextId);
  if (!parsed.success) {
    return fail(`"${command.nextId}" is not a valid id: ${firstIssue(parsed.error.issues)}`);
  }
  if (
    command.nextId !== command.entityId &&
    zone.entities.some((entity) => entity.id === command.nextId)
  ) {
    return fail(`entity id "${command.nextId}" already exists in zone "${command.zoneId}"`);
  }

  const entities = zone.entities.map((entity) =>
    entity.id === command.entityId ? { ...entity, id: command.nextId } : entity,
  );
  const next = withZoneEntities(document, zone, entities);

  return ok({
    document: {
      ...next,
      selection: next.selection.map((id) => (id === command.entityId ? command.nextId : id)),
    },
    inverse: renameEntity(command.zoneId, command.nextId, command.entityId),
    createdEntityIds: [],
  });
}

function applyAddZone(
  document: EditorDocument,
  command: AddZoneCommand,
): CommandResult<AppliedCommand> {
  const parsed = ZoneDefinitionSchema.safeParse(command.zone);
  if (!parsed.success) {
    return fail(`zone "${command.zone.id}" is not valid: ${firstIssue(parsed.error.issues)}`);
  }
  if (findZone(document, command.zone.id) !== undefined) {
    return fail(`zone id "${command.zone.id}" already exists`);
  }

  const zones = [...document.world.zones];
  zones.splice(
    command.index === undefined ? zones.length : clamp(command.index, zones.length),
    0,
    command.zone,
  );

  return ok({
    document: {
      ...document,
      world: { ...document.world, zones },
      // A world without an active zone has nothing to edit; the first zone
      // added becomes it.
      activeZoneId: document.activeZoneId ?? command.zone.id,
      dirty: true,
    },
    inverse: removeZone(command.zone.id),
    createdEntityIds: [],
  });
}

function applyRemoveZone(
  document: EditorDocument,
  command: RemoveZoneCommand,
): CommandResult<AppliedCommand> {
  const index = document.world.zones.findIndex((zone) => zone.id === command.zoneId);
  const zone = document.world.zones[index];
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  const zones = document.world.zones.filter((candidate) => candidate.id !== command.zoneId);
  const activeZoneId =
    document.activeZoneId === command.zoneId ? (zones[0]?.id ?? null) : document.activeZoneId;

  return ok({
    document: {
      ...document,
      world: { ...document.world, zones },
      activeZoneId,
      selection: activeZoneId === document.activeZoneId ? document.selection : [],
      dirty: true,
    },
    inverse: addZone(zone, { index }),
    createdEntityIds: [],
  });
}

function applyRenameZone(
  document: EditorDocument,
  command: RenameZoneCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }

  // The same rule the file format applies, read from the schema rather than
  // restated here (agent rule 11).
  const parsed = ZoneDefinitionSchema.shape.name.safeParse(command.name);
  if (!parsed.success) {
    return fail(`zone name is not valid: ${firstIssue(parsed.error.issues)}`);
  }

  const zones = document.world.zones.map((candidate) =>
    candidate.id === command.zoneId ? { ...candidate, name: command.name } : candidate,
  );

  return ok({
    document: { ...document, world: { ...document.world, zones }, dirty: true },
    inverse: renameZone(command.zoneId, zone.name),
    createdEntityIds: [],
  });
}

// --- helpers ----------------------------------------------------------------

function placement(entity: EntityDefinition, index: number | undefined): EntityPlacement {
  return index === undefined ? { entity } : { entity, index };
}

/** The three fields the surface patch may touch. */
const SURFACE_FIELDS = ['normalScale', 'metallic', 'smoothness'] as const;

function applyUpdateTerrainSurface(
  document: EditorDocument,
  command: UpdateTerrainSurfaceCommand,
): CommandResult<AppliedCommand> {
  const zone = findZone(document, command.zoneId);
  if (zone === undefined) {
    return unknownZone(command.zoneId);
  }
  const terrain = zone.terrain;
  if (terrain === undefined) {
    return fail(`zone "${command.zoneId}" has no terrain to change`);
  }

  const layers = [...(terrain.layers ?? [])];
  const undo: TerrainLayerChange[] = [];
  for (const change of command.layers ?? []) {
    const layer = layers[change.index];
    if (layer === undefined) {
      return fail(
        `zone "${command.zoneId}" has no terrain layer ${String(change.index)}; ` +
          `it has ${String(layers.length)}`,
      );
    }
    layers[change.index] = patchLayer(layer, change.patch);
    undo.push({ index: change.index, patch: inverseSurfacePatch(layer, change.patch) });
  }

  const next: { -readonly [K in keyof TerrainDefinition]: TerrainDefinition[K] } = {
    ...terrain,
    ...(command.layers === undefined ? {} : { layers }),
  };
  if (command.flatNormals === true) {
    next.flatNormals = true;
  } else if (command.flatNormals === false) {
    // Off is the default, so it is written by *leaving the field out*: a world
    // file that says `"flatNormals": false` and one that says nothing draw the
    // same ground, and only one of them makes a reader wonder why it is there.
    delete next.flatNormals;
  }
  // Validated here rather than trusted: the numbers come from a text field in a
  // panel or from a command line, and a metallic of 1.4 must be refused where
  // it is typed, not where it is drawn.
  const parsed = TerrainDefinitionSchema.safeParse(next);
  if (!parsed.success) {
    return fail(
      `terrain of zone "${command.zoneId}" is not valid: ${firstIssue(parsed.error.issues)}`,
    );
  }

  return ok({
    document: withZoneTerrain(document, zone, parsed.data),
    inverse: updateTerrainSurface(command.zoneId, {
      ...(command.layers === undefined ? {} : { layers: undo }),
      ...(command.flatNormals === undefined ? {} : { flatNormals: terrain.flatNormals === true }),
    }),
    createdEntityIds: [],
  });
}

function patchLayer(layer: TerrainLayer, patch: TerrainSurfacePatch): TerrainLayer {
  const next: Record<string, unknown> = { ...layer };
  for (const field of SURFACE_FIELDS) {
    if (!(field in patch)) {
      continue;
    }
    const value = patch[field];
    if (value === null) {
      delete next[field];
    } else if (value !== undefined) {
      next[field] = value;
    }
  }
  return next as TerrainLayer;
}

/** The patch that puts one layer back the way it was, field for field. */
function inverseSurfacePatch(layer: TerrainLayer, patch: TerrainSurfacePatch): TerrainSurfacePatch {
  const back: Record<string, number | null> = {};
  for (const field of SURFACE_FIELDS) {
    if (field in patch) {
      back[field] = layer[field] ?? null;
    }
  }
  return back as TerrainSurfacePatch;
}

function withZoneTerrain(
  document: EditorDocument,
  zone: ZoneDefinition,
  terrain: TerrainDefinition,
): EditorDocument {
  const world: WorldDefinition = {
    ...document.world,
    zones: document.world.zones.map((candidate) =>
      candidate.id === zone.id ? { ...candidate, terrain } : candidate,
    ),
  };
  return { ...document, world, dirty: true };
}

function withZoneEntities(
  document: EditorDocument,
  zone: ZoneDefinition,
  entities: readonly EntityDefinition[],
): EditorDocument {
  const world: WorldDefinition = {
    ...document.world,
    zones: document.world.zones.map((candidate) =>
      candidate.id === zone.id ? { ...candidate, entities: [...entities] } : candidate,
    ),
  };
  return { ...document, world, dirty: true };
}

function patchEntity(entity: EntityDefinition, patch: TransformPatch): EntityDefinition {
  const next = { ...entity };
  if (patch.position !== undefined) {
    next.position = patch.position;
  }
  for (const field of ['rotation', 'scale'] as const) {
    if (!(field in patch)) {
      continue;
    }
    const value = patch[field];
    if (value === null) {
      delete next[field];
    } else if (value !== undefined) {
      next[field] = value;
    }
  }
  return next;
}

/** The patch that puts `entity` back the way it was, field for field. */
function inversePatch(entity: EntityDefinition, patch: TransformPatch): TransformPatch {
  return {
    ...(patch.position === undefined ? {} : { position: entity.position }),
    ...('rotation' in patch ? { rotation: entity.rotation ?? null } : {}),
    ...('scale' in patch ? { scale: entity.scale ?? null } : {}),
  };
}

function translate(position: Vector3, offset: Vector3): Vector3 {
  return [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]];
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(Math.trunc(index), length));
}

function ok(value: AppliedCommand): CommandResult<AppliedCommand> {
  return { ok: true, value };
}

function fail<T>(error: string): CommandResult<T> {
  return { ok: false, error };
}

function unknownZone<T>(zoneId: string): CommandResult<T> {
  return fail(`unknown zone "${zoneId}"`);
}

function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0];
  if (issue === undefined) {
    return 'unknown problem';
  }
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}
