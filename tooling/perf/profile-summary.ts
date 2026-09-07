/**
 * Turning a CDP CPU profile into the table a performance change is argued with.
 *
 * Kept apart from the script that drives the browser, and free of both DOM and
 * Playwright, for the usual reason: the arithmetic that decides "the shadow
 * pass got cheaper" is the part that can be wrong quietly, and it is the part a
 * unit test can hold still.
 *
 * Two numbers per function, because they answer different questions:
 *
 * - **self** is where the CPU actually was. It is what a micro-optimisation
 *   moves and what a flame graph's widest leaves show.
 * - **inclusive** is what a *phase* costs — `_evaluateActiveMeshes` has almost
 *   no self time and owns a quarter of the frame. Measured over *unique*
 *   functions per stack, so a recursive call does not count its own subtree
 *   twice.
 */

/** One frame of a CDP profile node, as `Profiler.stop` reports it. */
export interface ProfileCallFrame {
  readonly functionName?: string | undefined;
  readonly url?: string | undefined;
}

/** One node of a CDP profile tree. */
export interface ProfileNode {
  readonly id: number;
  readonly callFrame: ProfileCallFrame;
  readonly children?: readonly number[] | undefined;
}

/** What `Profiler.stop` hands back, reduced to the fields this reads. */
export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  /** Node id per sample. */
  readonly samples?: readonly number[] | undefined;
  /** Microseconds before each sample. */
  readonly timeDeltas?: readonly number[] | undefined;
}

/** One row of the summary table. */
export interface ProfileRow {
  readonly name: string;
  /** Milliseconds sampled *in* this function. */
  readonly selfMs: number;
  /** Milliseconds sampled in this function or anything it called. */
  readonly inclusiveMs: number;
  /** {@link selfMs} as a share of the profile, 0–1. */
  readonly selfShare: number;
  /** {@link inclusiveMs} as a share of the profile, 0–1. */
  readonly inclusiveShare: number;
}

/** What {@link summarizeProfile} makes of one profile. */
export interface ProfileSummary {
  /** Milliseconds the profile covers, samples added up. */
  readonly totalMs: number;
  /** Samples taken; a profile of a few hundred is not evidence. */
  readonly samples: number;
  /** Rows, heaviest inclusive time first. */
  readonly rows: readonly ProfileRow[];
}

/** The name a node is counted under; anonymous frames are not merged away. */
function nameOf(node: ProfileNode): string {
  const named = node.callFrame.functionName ?? '';
  return named.length > 0 ? named : '(anonymous)';
}

/**
 * Aggregates a CPU profile by function name.
 *
 * A sample's time is `timeDeltas[i]` — the microseconds *before* sample `i`,
 * which is the convention `Profiler.stop` uses and the reason a profile's first
 * delta is the gap since `Profiler.start` rather than a measurement of
 * anything. Samples with no matching delta are dropped rather than guessed at.
 */
export function summarizeProfile(profile: CpuProfile): ProfileSummary {
  const byId = new Map<number, ProfileNode>();
  for (const node of profile.nodes) {
    byId.set(node.id, node);
  }
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }

  const self = new Map<string, number>();
  const inclusive = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalUs = 0;
  let counted = 0;

  for (const [index, sampleId] of samples.entries()) {
    const delta = deltas[index];
    if (delta === undefined || delta < 0) {
      continue;
    }
    const node = byId.get(sampleId);
    if (node === undefined) {
      continue;
    }
    totalUs += delta;
    counted += 1;
    const leaf = nameOf(node);
    self.set(leaf, (self.get(leaf) ?? 0) + delta);

    // Unique names per stack: a function that calls itself owns its subtree
    // once, not once per level.
    const seen = new Set<string>();
    let cursor: number | undefined = sampleId;
    while (cursor !== undefined) {
      const current = byId.get(cursor);
      if (current === undefined) {
        break;
      }
      seen.add(nameOf(current));
      cursor = parents.get(cursor);
    }
    for (const name of seen) {
      inclusive.set(name, (inclusive.get(name) ?? 0) + delta);
    }
  }

  const totalMs = totalUs / 1000;
  const rows: ProfileRow[] = [];
  for (const [name, inclusiveUs] of inclusive) {
    const selfUs = self.get(name) ?? 0;
    rows.push({
      name,
      selfMs: selfUs / 1000,
      inclusiveMs: inclusiveUs / 1000,
      selfShare: totalUs === 0 ? 0 : selfUs / totalUs,
      inclusiveShare: totalUs === 0 ? 0 : inclusiveUs / totalUs,
    });
  }
  // Heaviest phase first, and by name where two are equal. The tie is not rare:
  // a caller that does nothing but call has exactly its callee's inclusive
  // time, and an order that depends on which one the profiler happened to
  // number first would make two runs of the same build disagree about a table
  // that is meant to be compared line by line.
  rows.sort(
    (left, right) => right.inclusiveMs - left.inclusiveMs || left.name.localeCompare(right.name),
  );
  return { totalMs, samples: counted, rows };
}

/** Renders the heaviest rows as a fixed-width table for a terminal or a log. */
export function formatProfileTable(summary: ProfileSummary, limit = 20): string {
  const header = 'incl%   self%   incl ms   self ms  function';
  const lines = summary.rows.slice(0, limit).map((row) => {
    const inclusiveShare = `${(row.inclusiveShare * 100).toFixed(1)}%`.padStart(5);
    const selfShare = `${(row.selfShare * 100).toFixed(1)}%`.padStart(6);
    const inclusiveMs = row.inclusiveMs.toFixed(1).padStart(9);
    const selfMs = row.selfMs.toFixed(1).padStart(9);
    return `${inclusiveShare}  ${selfShare}  ${inclusiveMs} ${selfMs}  ${row.name}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * A running average, read twice, turned into the average over the window
 * between the two readings.
 *
 * The debug bridge reports `frameTimeMs` as the mean over *every* frame since
 * the page opened (`apps/game/src/dev-debug.ts`), which for a client that spent
 * its first ten seconds loading a village is a number dominated by the loading.
 * Two readings and the frame counts behind them recover the mean of the frames
 * in between, which is the only one worth quoting.
 *
 * @returns `null` when no frame was drawn between the readings — there is no
 * window to average, and a zero here would read as a free frame.
 */
export function windowMean(
  before: { readonly frameTimeMs: number; readonly frames: number },
  after: { readonly frameTimeMs: number; readonly frames: number },
): number | null {
  const frames = after.frames - before.frames;
  if (frames <= 0) {
    return null;
  }
  const total = after.frameTimeMs * after.frames - before.frameTimeMs * before.frames;
  return total / frames;
}
