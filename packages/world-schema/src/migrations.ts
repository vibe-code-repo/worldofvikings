/**
 * World file migrations: how a file written by an older build is brought up to
 * {@link CURRENT_WORLD_SCHEMA_VERSION} before it is validated.
 *
 * Agent rule 11 is "never silently change data formats", and this is what
 * keeps that promise rather than breaking it: a version bump is paired with a
 * step here, the step is a pure function over plain data, `parseWorldDefinition`
 * reports which version a file came from, and a version with no step is still
 * refused by name. Nothing is guessed and nothing is rewritten on disk — the
 * file on disk only changes when someone saves it (ADR-0017, ADR-0020).
 */

/** One version's worth of upgrade: `from` → `from + 1`. */
export interface WorldMigration {
  readonly from: number;
  /** Plain data in, plain data out. Never mutates its argument. */
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/**
 * v1 → v2: zones gained an optional `terrain` (ADR-0020).
 *
 * Purely additive, so the upgrade is the version number and nothing else. A
 * v1 world is a v2 world whose zones have no ground yet — which is exactly
 * what it was.
 */
const v1ToV2: WorldMigration = {
  from: 1,
  migrate: (data) => ({ ...data, schemaVersion: 2 }),
};

/** Every known step, in ascending order. */
export const WORLD_MIGRATIONS: readonly WorldMigration[] = [v1ToV2];

/** What {@link migrateWorldData} did. */
export type WorldMigrationResult =
  | { readonly ok: true; readonly data: unknown; readonly from: number; readonly to: number }
  | { readonly ok: false; readonly error: string };

/**
 * Upgrades a world document to `target`, one recorded step at a time.
 *
 * A file already at `target` is returned untouched with `from === to`. A version
 * that is newer than this build, or older with no step to reach the next one,
 * is an error naming the version — the contributor must see a version problem,
 * not a field problem caused by one.
 */
export function migrateWorldData(data: unknown, target: number): WorldMigrationResult {
  if (typeof data !== 'object' || data === null || !('schemaVersion' in data)) {
    // No version at all: hand it on unchanged so the schema reports the missing
    // field itself, in the same shape as every other field error.
    return { ok: true, data, from: target, to: target };
  }

  const raw = (data as { schemaVersion: unknown }).schemaVersion;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { ok: false, error: `unsupported schemaVersion ${String(raw)}, expected ${target}` };
  }
  if (raw === target) {
    return { ok: true, data, from: raw, to: raw };
  }
  if (raw > target) {
    return {
      ok: false,
      error:
        `world file is schemaVersion ${String(raw)}, but this build understands ` +
        `${String(target)} — update the project instead of downgrading the file`,
    };
  }

  let current = { ...(data as Record<string, unknown>) };
  let version = raw;
  while (version < target) {
    const step = WORLD_MIGRATIONS.find((migration) => migration.from === version);
    if (step === undefined) {
      return {
        ok: false,
        error: `unsupported schemaVersion ${String(raw)}, expected ${String(target)}`,
      };
    }
    current = step.migrate(current);
    version += 1;
  }
  return { ok: true, data: current, from: raw, to: version };
}
