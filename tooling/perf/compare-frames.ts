/**
 * Compares two frames `frame-profile.ts` wrote (`pnpm perf:compare`).
 *
 * The half of a performance change nobody can argue with: two `.rgba` files
 * from the same view, before and after, and the mean absolute difference
 * between them. A change that claims to leave the picture alone has to survive
 * this, and one that does not has to say what it traded and why.
 *
 * ```bash
 * pnpm perf:compare test-results/perf/baseline.square.rgba \
 *                   test-results/perf/frozen.square.rgba
 * ```
 *
 * Exit code 1 when the mean difference is at or above `--threshold`
 * (2/255 by default), so this can stand in a script.
 */
import { readFile } from 'node:fs/promises';
import { compareFrames } from './pixels.js';

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  process.stderr.write('usage: perf:compare <before.rgba> <after.rgba> [--threshold <n>]\n');
  process.exit(2);
}

const thresholdIndex = rest.indexOf('--threshold');
const threshold =
  thresholdIndex === -1 ? 2 : Number.parseFloat(rest[thresholdIndex + 1] ?? '2') || 2;

const [before, after] = await Promise.all([readFile(beforePath), readFile(afterPath)]);
const difference = compareFrames(new Uint8Array(before), new Uint8Array(after));

process.stdout.write(
  `mean |Δ| ${difference.meanAbsolute.toFixed(4)}/255 · ` +
    `max |Δ| ${String(difference.maxAbsolute)}/255 · ` +
    `${(difference.changedShare * 100).toFixed(2)}% of ${String(difference.pixels)} pixels changed\n`,
);

if (difference.meanAbsolute >= threshold) {
  process.stderr.write(
    `the picture changed: mean |Δ| ${difference.meanAbsolute.toFixed(4)} >= ${String(threshold)}\n`,
  );
  process.exit(1);
}
