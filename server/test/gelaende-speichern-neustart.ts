/**
 * Terrain T4b: end-to-end witness of the chain save -> restart -> ground height,
 * with the real building blocks and no stand-ins on the world path.
 *
 *   draft with heightDeltas -> layoutSchreibenAsync (the call behind POST /api/worldlayout,
 *   with a base hash) into an OWN temp work copy -> createWovServer boots from exactly that
 *   file (own world path, port 0) -> getGroundHeight / worldLayoutRaw.
 *
 * Height unit: a grid point of zone (zx, zz), row ry, column rx lies at world
 * x = zx*64 - 32 + rx, z = zz*64 - 32 + ry; the delta is stored in centimetres.
 * The 422 mapping of the route itself (heightErrorAnswer) is covered by admin/test/weltops-hoehenkorrektur.ts;
 * here only the server side: a damaged heightDeltas is refused and never reaches the work copy.
 *
 *   npx tsx test/gelaende-speichern-neustart.ts   (from server/)
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutDateiHash, layoutSchreibenAsync, LayoutUngueltig } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { createWovServer } from '../src/WovServer.js';

const TOLERANZ = 1e-4; // metres; the boot witness measures +3.5 m within the same bound
const root = mkdtempSync(join(tmpdir(), 'gelaende-speichern-neustart-'));
const base = { version: 1, name: 'Terrain save witness', detailSeed: 'gelaende-t4b', continents: [],
  regions: [{ id: 'land', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] }], placements: [] };

// Draft: raise, lower, a zone-edge pair (shared border of zones 0,0 and 1,1) and a zone near the region edge.
const entwurf = [
  { zx: 0, zz: 0, r: ['20|20|-200', '42|42|350', '63|63|150'] },
  { zx: 1, zz: 1, r: ['0|0|100'] },
  { zx: 24, zz: 0, r: ['10|10|120'] },
];
const punkte: { name: string; x: number; z: number; delta: number }[] = [
  { name: 'raise', x: 10, z: 10, delta: 3.5 },
  { name: 'lower', x: -12, z: -12, delta: -2.0 },
  { name: 'zone-edge-a', x: 31, z: 31, delta: 1.5 },
  { name: 'zone-edge-b', x: 32, z: 32, delta: 1.0 },
  { name: 'region-edge', x: 24 * 64 - 32 + 10, z: -32 + 10, delta: 1.2 },
  { name: 'untouched-far', x: 50, z: 50, delta: 0 },
  { name: 'untouched-next', x: 11, z: 10, delta: 0 },
];

async function boote(pfad: string, name: string) {
  const dir = join(root, `boot-${name}`); mkdirSync(dir);
  const previous = { log: console.log, warn: console.warn, error: console.error };
  const server = createWovServer({ port: 0, worldName: name, worldSeed: 'gelaende-t4b', worldFeatures: false, worldVegetation: false,
    worldsDir: join(dir, 'worlds'), kontenDir: join(dir, 'accounts'), worldMode: 'layout', worldLayoutPath: pfad,
    saveIntervalMs: 3600_000, worldBilinearHeight: true });
  console.log = () => undefined; console.warn = () => undefined; console.error = () => undefined;
  try { await server.start(); } finally { console.log = previous.log; console.warn = previous.warn; console.error = previous.error; }
  return server;
}

try {
  // Work copy: its own temp file, never the DEV one.
  const arbeit = join(root, 'welten-arbeit', 'test.json');
  mkdirSync(join(root, 'welten-arbeit'));
  writeFileSync(arbeit, JSON.stringify(base, null, 2));

  // 0) Baseline boot of the unchanged work copy.
  const basis: Record<string, number> = {};
  const s0 = await boote(arbeit, 'basis');
  try { for (const p of punkte) basis[p.name] = s0.getGroundHeight(p.x, p.z); } finally { s0.stop(); }

  // 1+2) Save the draft the way POST /api/worldlayout does, with the base hash.
  const hash0 = layoutDateiHash(arbeit);
  assert.ok(hash0, 'work copy has a hash');
  const ergebnis = await layoutSchreibenAsync(arbeit, { ...base, heightDeltas: entwurf }, undefined, { basis: hash0! });
  const gespeichert = JSON.parse(readFileSync(arbeit, 'utf8')) as { heightDeltas?: { zx: number; zz: number; r: string[] }[] };
  assert.deepEqual(gespeichert.heightDeltas, entwurf, 'work copy carries the draft heightDeltas unchanged');
  assert.notEqual(ergebnis.hash, hash0, 'hash moved');
  const bytesNachSpeichern = readFileSync(arbeit, 'utf8');

  // 3) Restart: boot from exactly this work copy; twice, to show the chain is repeatable.
  for (const lauf of ['neustart-1', 'neustart-2']) {
    const s = await boote(arbeit, lauf);
    try {
      for (const p of punkte) {
        const h = s.getGroundHeight(p.x, p.z);
        assert.ok(Math.abs(h - (basis[p.name]! + p.delta)) < TOLERANZ,
          `${lauf} ${p.name}: measured=${h}, expected=${basis[p.name]! + p.delta}`);
        console.log(`PASS ${lauf} ${p.name}: base=${basis[p.name]!.toFixed(5)} height=${h.toFixed(5)} delta=${(h - basis[p.name]!).toFixed(5)} (want ${p.delta})`);
      }
      // What a client peer receives: the effective layout keeps the saved correction.
      assert.deepEqual((s.worldLayoutRaw as { heightDeltas?: unknown }).heightDeltas, entwurf, `${lauf}: peer layout carries the correction`);
      assert.equal(readFileSync(arbeit, 'utf8'), bytesNachSpeichern, `${lauf}: boot must not rewrite the work copy`);
    } finally { s.stop(); }
  }

  // 5) Edge cases: damaged heightDeltas is refused at save, the work copy stays byte-identical.
  const zonenZuViele = Array.from({ length: 4097 }, (_, i) => ({ zx: i % 64, zz: Math.floor(i / 64), r: ['1|1|100'] }));
  const kaputt: [string, unknown, string][] = [
    ['value-out-of-bounds', [{ zx: 0, zz: 0, r: ['42|42|99999'] }], 'LayoutHoehenkorrekturUngueltig'],
    ['mixed-invalid-row', [{ zx: 0, zz: 0, r: ['42|42|350', '41|1|bad'] }], 'LayoutHoehenkorrekturUngueltig'],
    ['not-an-array', 'kaputt', 'LayoutHoehenkorrekturUngueltig'],
    ['too-many-zones', zonenZuViele, 'LayoutHoehenkorrekturZuVieleZonen'],
  ];
  for (const [name, heightDeltas, klasse] of kaputt) {
    const hash = layoutDateiHash(arbeit)!;
    await assert.rejects(layoutSchreibenAsync(arbeit, { ...base, heightDeltas }, undefined, { basis: hash }), (e: unknown) => {
      assert.ok(e instanceof LayoutUngueltig, `${name}: is a LayoutUngueltig`);
      assert.equal((e as Error).name, klasse, `${name}: error class`);
      return true;
    }, `${name}: must be refused`);
    assert.equal(readFileSync(arbeit, 'utf8'), bytesNachSpeichern, `${name}: work copy unchanged after refusal`);
    console.log(`PASS refused ${name} (${klasse}), work copy untouched`);
  }
  // The earlier correction still survives a restart after all the refusals.
  const s3 = await boote(arbeit, 'nach-ablehnung');
  try { assert.ok(Math.abs(s3.getGroundHeight(10, 10) - (basis['raise']! + 3.5)) < TOLERANZ, 'correction survives refusals'); } finally { s3.stop(); }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('all ok: save -> restart -> height, 7 points x 2 boots, 4 refusals');
