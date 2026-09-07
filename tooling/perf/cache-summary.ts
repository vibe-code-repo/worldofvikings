/**
 * What a cold and a warm editor open cost on the wire, as numbers.
 *
 * The half of `cache-profile.ts` that has no browser in it, for the same reason
 * `profile-summary.ts` exists: the rig starts four servers and a Chromium, so
 * nothing it computes can be checked without all of that — and the counting is
 * where this measurement can be quietly wrong. A response served out of the
 * browser's own cache and a response that was revalidated look almost alike in
 * a network log and mean completely different things (ADR-0052): the first
 * never left the machine, the second is the 304 this change is about.
 */

/** One response, as CDP reported it. */
export interface WireEntry {
  readonly url: string;
  readonly status: number;
  /** Bytes on the wire, headers included — CDP's `encodedDataLength`. */
  readonly bytes: number;
  /** True when Chromium answered from its own store without asking. */
  readonly fromCache: boolean;
}

/** How one origin's share of a pass adds up. */
export interface OriginTotals {
  readonly requests: number;
  readonly bytes: number;
  readonly status200: number;
  readonly status304: number;
  readonly fromCache: number;
}

/** One pass — cold or warm — summed up. */
export interface PassSummary {
  readonly pass: string;
  readonly seconds: number;
  readonly requests: number;
  readonly bytes: number;
  readonly status200: number;
  readonly status304: number;
  /** Everything that was neither, keyed by status code. */
  readonly otherStatus: Readonly<Record<string, number>>;
  /** Answered by the browser's own cache, so never asked for at all. */
  readonly fromCache: number;
  readonly byOrigin: Readonly<Record<string, OriginTotals>>;
  readonly heaviest: readonly WireEntry[];
}

/** How many entities the document held and how many showed their model. */
export interface EntityCounts {
  readonly entityCount: number;
  readonly loadedCount: number;
}

const HEAVIEST_SHOWN = 8;

/**
 * Sums one pass.
 *
 * A response Chromium answered from its own cache is counted as a request and
 * as its bytes (which are zero) but never as a 200, because it never was one:
 * counting it as a 200 would make a perfectly cached open look like a full
 * download, and counting it as a 304 would claim a revalidation that never
 * happened.
 */
export function summarizePass(
  pass: string,
  entries: readonly WireEntry[],
  seconds: number,
): PassSummary {
  const byOrigin: Record<string, OriginTotals> = {};
  const otherStatus: Record<string, number> = {};
  let bytes = 0;
  let status200 = 0;
  let status304 = 0;
  let fromCache = 0;

  for (const entry of entries) {
    bytes += entry.bytes;
    if (entry.fromCache) {
      fromCache += 1;
    } else if (entry.status === 200) {
      status200 += 1;
    } else if (entry.status === 304) {
      status304 += 1;
    } else {
      const key = String(entry.status);
      otherStatus[key] = (otherStatus[key] ?? 0) + 1;
    }

    const origin = originOf(entry.url);
    const before = byOrigin[origin] ?? {
      requests: 0,
      bytes: 0,
      status200: 0,
      status304: 0,
      fromCache: 0,
    };
    byOrigin[origin] = {
      requests: before.requests + 1,
      bytes: before.bytes + entry.bytes,
      status200: before.status200 + (!entry.fromCache && entry.status === 200 ? 1 : 0),
      status304: before.status304 + (!entry.fromCache && entry.status === 304 ? 1 : 0),
      fromCache: before.fromCache + (entry.fromCache ? 1 : 0),
    };
  }

  return {
    pass,
    seconds,
    requests: entries.length,
    bytes,
    status200,
    status304,
    otherStatus,
    fromCache,
    byOrigin,
    heaviest: [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, HEAVIEST_SHOWN),
  };
}

/** Megabytes, two decimals — the unit the sizes in this project are argued in. */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** One pass as the lines the rig prints, origin totals indented under it. */
export function formatPass(summary: PassSummary, counts: EntityCounts): string[] {
  const lines = [
    `${summary.pass}: ${String(summary.requests)} requests · ${megabytes(summary.bytes)} · ` +
      `${String(summary.status200)}×200 · ${String(summary.status304)}×304 · ` +
      `${String(summary.fromCache)} from cache · ${summary.seconds.toFixed(1)} s · ` +
      `${String(counts.loadedCount)}/${String(counts.entityCount)} entities`,
  ];
  for (const [origin, totals] of Object.entries(summary.byOrigin).sort(
    (left, right) => right[1].bytes - left[1].bytes,
  )) {
    lines.push(
      `    ${origin}: ${String(totals.requests)} req · ${megabytes(totals.bytes)} · ` +
        `${String(totals.status200)}×200 · ${String(totals.status304)}×304 · ` +
        `${String(totals.fromCache)} from cache`,
    );
  }
  if (Object.keys(summary.otherStatus).length > 0) {
    lines.push(`    other statuses: ${JSON.stringify(summary.otherStatus)}`);
  }
  return lines;
}

/**
 * A URL's origin, or `unknown` for one there is none of.
 *
 * `data:` and `blob:` URLs have origin `null`, and Babylon makes both; grouping
 * them under a word rather than letting `new URL` throw keeps a pass summable.
 */
function originOf(url: string): string {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? 'unknown' : origin;
  } catch {
    return 'unknown';
  }
}
