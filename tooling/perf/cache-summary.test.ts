import { describe, expect, it } from 'vitest';
import { formatPass, megabytes, summarizePass, type WireEntry } from './cache-summary.js';

function entry(overrides: Partial<WireEntry> & { url: string }): WireEntry {
  return { status: 200, bytes: 0, fromCache: false, ...overrides };
}

describe('summarizePass', () => {
  it('counts requests, bytes and status codes per origin', () => {
    const summary = summarizePass(
      'cold',
      [
        entry({ url: 'http://localhost:9391/store/a.glb', bytes: 1000 }),
        entry({ url: 'http://localhost:9391/store/b.png', bytes: 2000 }),
        entry({ url: 'http://localhost:3391/worlds/village1', bytes: 500 }),
      ],
      12.5,
    );

    expect(summary.requests).toBe(3);
    expect(summary.bytes).toBe(3500);
    expect(summary.status200).toBe(3);
    expect(summary.byOrigin['http://localhost:9391']).toEqual({
      requests: 2,
      bytes: 3000,
      status200: 2,
      status304: 0,
      fromCache: 0,
    });
    expect(summary.seconds).toBe(12.5);
  });

  it('keeps a 304 out of the 200 count and out of the byte total it never added to', () => {
    const summary = summarizePass(
      'warm',
      [
        entry({ url: 'http://localhost:9391/store/a.glb', status: 304, bytes: 220 }),
        entry({ url: 'http://localhost:9391/store/b.png', status: 304, bytes: 220 }),
      ],
      3,
    );

    expect(summary.status200).toBe(0);
    expect(summary.status304).toBe(2);
    // Header bytes are still bytes: a warm open is cheap, not free.
    expect(summary.bytes).toBe(440);
  });

  it('counts a response the browser answered itself as neither 200 nor 304', () => {
    // The whole reason this function is tested. Chromium reports a cache hit
    // with the status of the response it stored, so counting it as a 200 would
    // make a perfectly cached open look like a full download.
    const summary = summarizePass(
      'warm',
      [entry({ url: 'http://localhost:5392/assets/index.js', status: 200, fromCache: true })],
      1,
    );

    expect(summary.fromCache).toBe(1);
    expect(summary.status200).toBe(0);
    expect(summary.status304).toBe(0);
    expect(summary.byOrigin['http://localhost:5392']?.fromCache).toBe(1);
  });

  it('reports anything that was neither, by code', () => {
    const summary = summarizePass(
      'cold',
      [
        entry({ url: 'http://localhost:9391/store/missing.glb', status: 404 }),
        entry({ url: 'http://localhost:9391/store/gone.glb', status: 404 }),
        entry({ url: 'http://localhost:3391/worlds/x', status: 500 }),
      ],
      1,
    );

    expect(summary.otherStatus).toEqual({ '404': 2, '500': 1 });
  });

  it('groups a URL with no origin instead of throwing on it', () => {
    // Babylon builds blob: and data: URLs; `new URL(...).origin` is "null".
    const summary = summarizePass(
      'cold',
      [entry({ url: 'data:image/png;base64,AAAA', bytes: 4 }), entry({ url: 'not a url' })],
      1,
    );

    expect(summary.byOrigin['unknown']?.requests).toBe(2);
  });

  it('names the heaviest responses, largest first', () => {
    const summary = summarizePass(
      'cold',
      [
        entry({ url: 'http://a/small.glb', bytes: 10 }),
        entry({ url: 'http://a/huge.glb', bytes: 9000 }),
        entry({ url: 'http://a/medium.glb', bytes: 500 }),
      ],
      1,
    );

    expect(summary.heaviest.map((one) => one.url)).toEqual([
      'http://a/huge.glb',
      'http://a/medium.glb',
      'http://a/small.glb',
    ]);
  });
});

describe('megabytes', () => {
  it('reports megabytes to two decimals', () => {
    expect(megabytes(1024 * 1024)).toBe('1.00 MB');
    expect(megabytes(0)).toBe('0.00 MB');
  });
});

describe('formatPass', () => {
  it('puts the pass on one line and each origin under it', () => {
    const lines = formatPass(
      summarizePass(
        'warm',
        [
          entry({ url: 'http://localhost:9391/store/a.glb', status: 304, bytes: 200 }),
          entry({ url: 'http://localhost:3391/worlds/village1', status: 304, bytes: 300 }),
        ],
        4.25,
      ),
      { entityCount: 5273, loadedCount: 5273 },
    );

    expect(lines[0]).toContain('warm: 2 requests');
    expect(lines[0]).toContain('2×304');
    expect(lines[0]).toContain('5273/5273 entities');
    // Heaviest origin first, so the line that matters is the one you read.
    expect(lines[1]).toContain('http://localhost:3391');
    expect(lines).toHaveLength(3);
  });
});
