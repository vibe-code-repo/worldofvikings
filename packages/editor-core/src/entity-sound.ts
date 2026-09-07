/**
 * Which emitter sounds a given entity, and how to give one to an entity that
 * has none (ADR-0052, ADR-0033).
 *
 * The world format keeps emitters as a list on the zone's `sound` block, not as
 * a field on the entity — 5273 entities of which seventeen make a noise would
 * be 5273 places to look, and an emitter has fields (an interval, a radius, a
 * bus) that have nothing to do with a transform. But an *author* meets them the
 * other way round: they select a brazier and want to know what it sounds like.
 * This module is the join between those two views, and it lives here rather
 * than in a panel so that every rule about it can be tested without a browser.
 *
 * **Two ways an entity can sound, and they are not the same edit.** An emitter
 * with `entity: "village-e0421"` is about that one placement. An emitter with
 * `prefab: "camp-brazier-01"` is a rule over every placement of that prefab —
 * eleven braziers on one line, and a twelfth dropped in the editor audible with
 * nobody editing the sound block. Editing a rule from one of the braziers it
 * matches changes all eleven, so the panel has to be able to say which of the
 * two it is looking at. Hence {@link EntityEmitter.via}, and hence the search
 * order: a named placement wins over a rule, because that is the more specific
 * statement and the one an author wrote *about this entity*.
 */
import type { SoundEmitter, SoundProfile } from '@wov/world-schema';
import { soundAt, type SoundScope } from './blocks.js';
import { activeZone, type EditorDocument } from './document.js';
import type { FieldPatch } from './patch.js';

/** An emitter found for an entity, and where in the zone's list it sits. */
export interface EntityEmitter {
  /** Index in `sound.emitters`, which is the path a field patch addresses. */
  readonly index: number;
  readonly emitter: SoundEmitter;
  /**
   * Whether this entity is named by the emitter or merely matched by it.
   *
   * `prefab` means editing it changes every placement of that prefab. The panel
   * says so out loud; an author who changes the volume of "the forge" and
   * quietens eleven braziers has been lied to by their own editor.
   */
  readonly via: 'entity' | 'prefab';
  /** How many entities of the active zone this emitter sounds. */
  readonly matches: number;
}

/** Which scope an entity's emitter lives in: always its own zone. */
export function zoneScopeOf(document: EditorDocument): SoundScope | null {
  const zoneId = document.activeZoneId;
  return zoneId === null ? null : { kind: 'zone', zoneId };
}

/**
 * The emitter that sounds `entityId` in the active zone, or `null`.
 *
 * Only the *zone's* profile is searched, never the world's. A world-level
 * emitter list would be a rule over zones that do not share entity ids, and the
 * one thing worse than not finding an emitter is editing one that belongs to a
 * different zone (`resolveSoundProfile` replaces the list rather than merging
 * it, so the zone's list is the one in force wherever a zone has one at all).
 */
export function emitterForEntity(document: EditorDocument, entityId: string): EntityEmitter | null {
  const zone = activeZone(document);
  if (zone === undefined) {
    return null;
  }
  const entity = zone.entities.find((each) => each.id === entityId);
  if (entity === undefined) {
    return null;
  }
  const emitters = zone.sound?.emitters ?? [];

  const named = emitters.findIndex((emitter) => emitter.entity === entityId);
  const byPrefab = emitters.findIndex((emitter) => emitter.prefab === entity.prefab);
  const index = named >= 0 ? named : byPrefab;
  const found = emitters[index];
  if (found === undefined) {
    return null;
  }
  const via = named >= 0 ? 'entity' : 'prefab';
  const matches =
    via === 'entity' ? 1 : zone.entities.filter((each) => each.prefab === found.prefab).length;
  return { index, emitter: found, via, matches };
}

/**
 * An emitter id that is free in this zone, derived from the entity's own id.
 *
 * Derived rather than counted, so that the same entity always produces the same
 * emitter id and a second "add emitter here" on a brazier that already has one
 * cannot silently make a duplicate the schema then refuses. The suffix only
 * appears when the derived id is genuinely taken.
 */
export function emitterIdFor(entityId: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${entityId}-sound`;
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${String(index)}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** What {@link addEntityEmitter} needs to write a valid emitter. */
export interface AddEntityEmitterOptions {
  /** The zone's profile as it stands, so the new list is the old one plus one. */
  readonly profile: SoundProfile | undefined;
  readonly entityId: string;
  /**
   * The clip it starts on.
   *
   * Required, and required for a reason: `clip` is the one field of an emitter
   * the schema will not accept blank, and an "add" that produces a value its
   * own schema refuses turns a button into a validation error. The panel offers
   * the store's audio rows and disables the button when the store has none.
   */
  readonly clip: string;
}

/**
 * The one patch that adds an emitter for an entity: the whole `emitters` list.
 *
 * The whole list rather than an append at an index, because that is what makes
 * undo honest — `restorePatch` puts back the block that was there, including
 * the case where there was no `emitters` key at all.
 */
export function addEntityEmitter(options: AddEntityEmitterOptions): FieldPatch {
  const existing = options.profile?.emitters ?? [];
  const emitter: SoundEmitter = {
    id: emitterIdFor(
      options.entityId,
      existing.map((each) => each.id),
    ),
    entity: options.entityId,
    clip: options.clip,
    // A loop, because the overwhelming majority of a placed sound is a loop —
    // a fire, a forge, a well — and a one-shot needs an interval to go with it
    // that no default can guess.
    loop: true,
  };
  return { path: ['emitters'], value: [...existing, emitter] };
}

/** The patch that takes emitter `index` back out of the list. */
export function removeEmitterAt(profile: SoundProfile | undefined, index: number): FieldPatch {
  const existing = profile?.emitters ?? [];
  return { path: ['emitters'], value: existing.filter((_ignored, at) => at !== index) };
}

/** The zone's profile, for a panel that wants to hand it straight back in. */
export function zoneSoundProfile(document: EditorDocument): SoundProfile | undefined {
  const scope = zoneScopeOf(document);
  return scope === null ? undefined : soundAt(document.world, scope);
}
