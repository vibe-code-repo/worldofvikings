import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJsonFile, writeJsonFileAtomically } from './content-files.js';

/** A world whose byte length moves with every rewrite, so a stamp from another version shows as a size mismatch. */
function worldOfLength(step: number): string {
  // Large enough that reading it takes more than one turn of the event loop,
  // which is the window a rename can land in.
  return JSON.stringify({ step, padding: 'x'.repeat(200_000 + (step % 7) * 1000) });
}

describe('readJsonFile', () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'wov-content-files-'));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('pairs the bytes it read with the stamp of the same version', async () => {
    const path = join(folder, 'world.json');
    await writeJsonFileAtomically(path, worldOfLength(0));

    // Read and rewrite at the same time, many times: the read must never hand
    // back one version's bytes under another version's size — that size is the
    // validator a client would then hold (ADR-0052).
    for (let step = 1; step <= 400; step += 1) {
      const [read] = await Promise.all([
        readJsonFile(path),
        writeJsonFileAtomically(path, worldOfLength(step)),
      ]);
      expect(read.status).toBe('ok');
      if (read.status === 'ok') {
        expect(read.size).toBe(Buffer.byteLength(JSON.stringify(read.data)));
      }
    }
  });

  it('reports a missing file as not found', async () => {
    expect(await readJsonFile(join(folder, 'missing.json'))).toEqual({ status: 'not-found' });
  });
});
