import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWovServer } from '../src/WovServer.js';

const root = mkdtempSync(join(tmpdir(), 'height-correction-boot-'));
const base = { version: 1, name: 'Height boot witness', detailSeed: 'height-boot', continents: [],
  regions: [{ id: 'land', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }], placements: [] };
const zones = Array.from({ length: 5000 }, (_, i) => ({ zx: i % 64, zz: Math.floor(i / 64), r: ['42|42|350'] }));
const fullRows = Array.from({ length: 64 }, (_, row) => `${row}|${Array.from({ length: 64 }, (_, i) => i).join(',')}|${Array(64).fill(350).join(',')}`);
const points = Array.from({ length: 25 }, (_, i) => ({ zx: i, zz: 0, r: fullRows }));
const cases: [string, unknown, boolean][] = [
  ['baseline', undefined, false],
  ['valid', [{ zx: 0, zz: 0, r: ['42|42|350'] }], false],
  ['mixed-invalid', [{ zx: 0, zz: 0, r: ['42|42|350', '41|1|bad'] }], true],
  ['not-array', 'kaputt', true],
  ['zones', zones, true],
  ['points', points, true],
];
let baseline = 0;
try {
  for (const [name, heightDeltas, rejected] of cases) {
    const dir = join(root, name); mkdirSync(dir);
    const path = join(dir, 'layout.json');
    const bytes = JSON.stringify({ ...base, ...(heightDeltas === undefined ? {} : { heightDeltas }) });
    writeFileSync(path, bytes);
    const errors: string[] = [];
    const previous = { log: console.log, warn: console.warn, error: console.error };
    const server = createWovServer({ port: 0, worldName: name, worldSeed: 'height-boot', worldFeatures: false, worldVegetation: false,
      worldsDir: join(dir, 'worlds'), kontenDir: join(dir, 'accounts'), worldMode: 'layout', worldLayoutPath: path,
      saveIntervalMs: 3600_000, worldBilinearHeight: true });
    try {
      console.log = () => undefined; console.warn = () => undefined;
      console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
      await server.start();
      const height = server.getGroundHeight(10, 10);
      if (name === 'baseline') baseline = height;
      const expected = name === 'valid' ? baseline + 3.5 : baseline;
      assert.ok(Math.abs(height - expected) < 1e-4, `${name}: measured=${height}, expected=${expected}`);
      assert.equal(readFileSync(path, 'utf8'), bytes, `${name}: boot must not rewrite disk`);
      if (rejected) {
        assert.ok(!(server.worldLayoutRaw as { heightDeltas?: unknown }).heightDeltas, `${name}: peer-visible effective layout excludes entire correction`);
        assert.ok(errors.some(line => line.startsWith('[Welt]') && /Git/.test(line) && /\d/.test(line)), `${name}: missing diagnostic: ${errors.join(';')}`);
      }
      previous.log(`PASS boot ${name}: height=${height.toFixed(5)} baseline=${baseline.toFixed(5)} delta=${(height-baseline).toFixed(5)} diagnostics=${errors.filter(line => line.startsWith('[Welt]')).length}`);
    } finally {
      server.stop();
      console.log = previous.log; console.warn = previous.warn; console.error = previous.error;
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('all ok: 6 boot cases');
