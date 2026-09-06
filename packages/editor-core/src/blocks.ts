/**
 * The two blocks of a world file that are not entities: how a world or zone is
 * lit (ADR-0024) and what the ground of a zone is (ADR-0020).
 *
 * Both were script-only until ADR-0033: a person edited the JSON, or ran a
 * terrain import, and the editor drew the result without being able to change
 * it. This module is what makes them ordinary edits — a patch, a command, an
 * undo step — so a slider in the lighting panel and a dragged gizmo go through
 * exactly the same machinery.
 *
 * The commands live in `commands.ts` with the rest; what is here is the part
 * that is about *these blocks*: where they sit in a world, and what a valid one
 * is. Keeping it separate is what stops `commands.ts` from growing a second
 * personality.
 */
import {
  LightingProfileSchema,
  TerrainDefinitionSchema,
  type LightingProfile,
  type TerrainDefinition,
  type WorldDefinition,
  type ZoneDefinition,
} from '@wov/world-schema';

/**
 * Whose light a lighting command changes.
 *
 * Two levels, because that is what the format has: a world profile, and a zone
 * profile that overrides it group by group (ADR-0024). An interior is a zone
 * with its own `fog`, not a second world.
 */
export type LightingScope =
  { readonly kind: 'world' } | { readonly kind: 'zone'; readonly zoneId: string };

export function worldLighting(): LightingScope {
  return { kind: 'world' };
}

export function zoneLighting(zoneId: string): LightingScope {
  return { kind: 'zone', zoneId };
}

/** The profile this scope currently holds, or `undefined` when it holds none. */
export function lightingAt(
  world: WorldDefinition,
  scope: LightingScope,
): LightingProfile | undefined {
  if (scope.kind === 'world') {
    return world.lighting;
  }
  return world.zones.find((zone) => zone.id === scope.zoneId)?.lighting;
}

/**
 * A world with `scope`'s profile replaced.
 *
 * `undefined` removes the block, which is not the same as an empty one: a zone
 * with no `lighting` is lit like its world, a zone with `{}` is too — but the
 * file says something different, and the editor must be able to produce both.
 *
 * The key order is spelled out rather than spread, because this world is
 * written to disk: `lighting` belongs in front of `zones`, or the block lands
 * behind a 39 000-line array where nobody will scroll to it (see
 * `WorldDefinitionSchema`).
 */
export function withLighting(
  world: WorldDefinition,
  scope: LightingScope,
  profile: LightingProfile | undefined,
): WorldDefinition {
  if (scope.kind === 'world') {
    const { lighting: _lighting, zones, ...head } = world;
    return { ...head, ...(profile === undefined ? {} : { lighting: profile }), zones };
  }
  return {
    ...world,
    zones: world.zones.map((zone) =>
      zone.id === scope.zoneId ? withZoneLighting(zone, profile) : zone,
    ),
  };
}

function withZoneLighting(
  zone: ZoneDefinition,
  profile: LightingProfile | undefined,
): ZoneDefinition {
  const { lighting: _lighting, ...rest } = zone;
  return profile === undefined ? rest : { ...rest, lighting: profile };
}

/** A zone with its ground replaced; `undefined` takes the ground away. */
export function withTerrain(
  zone: ZoneDefinition,
  terrain: TerrainDefinition | undefined,
): ZoneDefinition {
  const { terrain: _terrain, ...rest } = zone;
  return terrain === undefined ? rest : { ...rest, terrain };
}

/** Either a validated block, or the schema's own messages. */
export type BlockResult<T> =
  | { readonly ok: true; readonly value: T | undefined }
  | { readonly ok: false; readonly errors: readonly string[] };

function issues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

/**
 * Validates a candidate lighting profile.
 *
 * `undefined` is a valid answer and means "no block". Everything else has to
 * satisfy `LightingProfileSchema` before it can enter the document, for the
 * same reason the file is validated on load: the editor must never produce a
 * world the game refuses (agent rule 10).
 */
export function parseLightingBlock(value: unknown): BlockResult<LightingProfile> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const parsed = LightingProfileSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: issues(parsed.error) };
}

/** The same for a zone's ground. `undefined` means the zone has none. */
export function parseTerrainBlock(value: unknown): BlockResult<TerrainDefinition> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  const parsed = TerrainDefinitionSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, errors: issues(parsed.error) };
}
