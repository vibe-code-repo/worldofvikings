import type { Movement, Transform } from './components.js';
import { toEntityId, type EntityId } from './entity.js';
import type { InputState } from './input.js';

/**
 * The whole gameplay state, as data.
 *
 * Components live in maps beside the entity list, not as fields on an entity
 * object: adding a component later (stats, inventory, AI) adds a map and
 * touches nothing that exists (spec §25, agent rule 6). A state value is
 * treated as immutable — systems return a new one.
 */
export interface WorldState {
  readonly entities: readonly EntityId[];
  readonly transforms: ReadonlyMap<EntityId, Transform>;
  readonly movements: ReadonlyMap<EntityId, Movement>;
  /** The Input component: the intent an entity is currently acting on. */
  readonly inputs: ReadonlyMap<EntityId, InputState>;
}

/** What an entity is made of when it enters the world. */
export interface EntitySpec {
  readonly id: string;
  readonly transform?: Transform;
  readonly movement?: Movement;
  readonly input?: InputState;
}

const EMPTY_STATE: WorldState = Object.freeze({
  entities: Object.freeze([]) as readonly EntityId[],
  transforms: new Map<EntityId, Transform>(),
  movements: new Map<EntityId, Movement>(),
  inputs: new Map<EntityId, InputState>(),
});

/** Builds a world state from a list of entity specifications. */
export function createWorldState(specs: readonly EntitySpec[] = []): WorldState {
  let state = EMPTY_STATE;
  for (const spec of specs) {
    state = addEntity(state, spec);
  }
  return state;
}

/** Returns a new state with one more entity. Throws on a duplicate id. */
export function addEntity(state: WorldState, spec: EntitySpec): WorldState {
  const id = toEntityId(spec.id);
  if (state.entities.includes(id)) {
    throw new Error(`addEntity: entity "${id}" already exists`);
  }

  const transforms = new Map(state.transforms);
  const movements = new Map(state.movements);
  const inputs = new Map(state.inputs);
  if (spec.transform !== undefined) {
    transforms.set(id, spec.transform);
  }
  if (spec.movement !== undefined) {
    movements.set(id, spec.movement);
  }
  if (spec.input !== undefined) {
    inputs.set(id, spec.input);
  }

  return { entities: [...state.entities, id], transforms, movements, inputs };
}

/** Transform component of `id`, or `undefined`. */
export function getTransform(state: WorldState, id: EntityId): Transform | undefined {
  return state.transforms.get(id);
}

/** Movement component of `id`, or `undefined`. */
export function getMovement(state: WorldState, id: EntityId): Movement | undefined {
  return state.movements.get(id);
}

/** Input component of `id`, or `undefined` for entities nothing steers. */
export function getInput(state: WorldState, id: EntityId): InputState | undefined {
  return state.inputs.get(id);
}
