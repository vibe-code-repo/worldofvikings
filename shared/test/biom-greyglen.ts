/**
 * New biome bit `Biome.Greyglen = 1 << 7` (authoring name `greyglen`): a copy of grassland
 * in every table, so the existing world stays bit-identical.
 * Neues Biom-Bit 128 `greyglen` als Kopie von Grasland; die bestehende Welt bleibt bitgleich.
 *
 *   npx tsx shared/test/biom-greyglen.ts   (from the repo root)
 */
import { createGeo } from '../src/worldgen/index.js';
import { getStableHash } from '../src/hash.js';
import { Biome } from '../src/types.js';
import { BIOME_TILE, TILE } from '../src/worldgen/bodenKacheln.js';
import { BIOME_BY_NAME, DEFAULT_BASE_LEVEL, sanitizeWorldLayout } from '../src/worldlayout/index.js';
import { STANDARD_WETTER_DEFINITIONEN, WetterWuerfel } from '../src/wetterDefinition.js';
import { environmentForBiome } from '../src/environment.js';
import { resolveBiomeBit } from '../src/weather.js';
import { ALLE_BIOME } from '../src/flora.js';
import { inhaltText } from '../src/texte.js';
import envData from '../src/envData.json' with { type: 'json' };

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── Bit and names ─────────────────────────────────────────────────────
check('Biome.Greyglen is 128', (Biome.Greyglen as number) === 128);
check('Name → bit: greyglen = 128', (BIOME_BY_NAME.get('greyglen') as number | undefined) === 128);
let hinUndZurueck = true;
for (const [name, bit] of BIOME_BY_NAME) {
  const zurueck = [...BIOME_BY_NAME].filter(([, b]) => b === bit).map(([n]) => n);
  if (zurueck.length !== 1 || zurueck[0] !== name) hinUndZurueck = false;
}
check('name ↔ bit is one-to-one for all biomes', hinUndZurueck);
check('bit → name: 128 gives greyglen', [...BIOME_BY_NAME].find(([, b]) => (b as number) === 128)?.[0] === 'greyglen');
check('unknown biome name is not mapped', !BIOME_BY_NAME.has('greyglenn' as never) && !BIOME_BY_NAME.has('Greyglen' as never));
const bits = [...BIOME_BY_NAME.values()].map((b) => b as number);
check('all authoring bits are distinct single bits', new Set(bits).size === bits.length && bits.every((b) => (b & (b - 1)) === 0));
check('existing bits unchanged', Biome.Meadows === 1 && Biome.Swamp === 2 && Biome.Mountain === 4 && Biome.BlackForest === 8
  && Biome.Plains === 16 && Biome.AshLands === 32 && Biome.DeepNorth === 64 && Biome.Ocean === 256 && Biome.Mistlands === 512);
check('base level table has greyglen = grassland', DEFAULT_BASE_LEVEL.get('greyglen') === DEFAULT_BASE_LEVEL.get('grassland'));
check('flora mask lets greyglen through', (ALLE_BIOME & Biome.Greyglen) !== 0);

// ── Region → getBiome ─────────────────────────────────────────────────
const layout = {
  version: 1,
  name: 'Greyglen test',
  detailSeed: 'wov-test',
  continents: [{ id: 'c', name: 'C' }],
  regions: [
    { id: 'west', continentId: 'c', biome: 'grassland', shape: { kind: 'circle', x: -4000, z: 0, radius: 1800 }, edgeFalloff: 300 },
    { id: 'ost', continentId: 'c', biome: 'greyglen', shape: { kind: 'circle', x: 4000, z: 0, radius: 1800 }, edgeFalloff: 300 },
  ],
};
const geo = createGeo({ mode: 'layout', worldSeed: getStableHash('wov-test'), layout });
check('region with greyglen → getBiome = 128', (geo.getBiome(4000, 0) as number) === 128, `= ${geo.getBiome(4000, 0)}`);
check('grassland region still → 1', (geo.getBiome(-4000, 0) as number) === 1);
let hoeheGleich = true;
let hoeheNichtLeer = false;
for (let i = 0; i < 20; i++) {
  const x = 3000 + i * 97, z = -400 + i * 41;
  const a = geo.getBiomeHeight(Biome.Greyglen, x, z).height;
  const b = geo.getBiomeHeight(Biome.Meadows, x, z).height;
  if (a !== b) hoeheGleich = false;
  if (a !== 0) hoeheNichtLeer = true;
}
check('getBiomeHeight(greyglen) = grassland formula', hoeheGleich && hoeheNichtLeer);

// ── Sanitizer ─────────────────────────────────────────────────────────
const s = sanitizeWorldLayout({
  ...layout,
  regions: [...layout.regions, { id: 'komisch', continentId: 'c', biome: 'greyglenn', shape: { kind: 'circle', x: 0, z: 9000, radius: 500 } }],
});
check('sanitizer keeps greyglen', s?.regions.find((r) => r.id === 'ost')?.biome === 'greyglen');
check('sanitizer still rejects an unknown biome name', s !== null && !s.regions.some((r) => r.id === 'komisch') && s.regions.length === 2);

// ── Ground tile ───────────────────────────────────────────────────────
check('BIOME_TILE has its own row for 128', Object.hasOwn(BIOME_TILE, 128));
check('BIOME_TILE[128] = grassland tile', BIOME_TILE[128] === BIOME_TILE[1] && BIOME_TILE[128] === TILE.Grass);
check('BIOME_TILE rows of the old biomes unchanged', BIOME_TILE[1] === TILE.Grass && BIOME_TILE[2] === TILE.SwampMud
  && BIOME_TILE[4] === TILE.Rock && BIOME_TILE[8] === TILE.Forest && BIOME_TILE[16] === TILE.Heath
  && BIOME_TILE[32] === TILE.Ash && BIOME_TILE[64] === TILE.Rock && BIOME_TILE[256] === TILE.Sand && BIOME_TILE[512] === TILE.Moss);

// ── Weather ───────────────────────────────────────────────────────────
const defs = STANDARD_WETTER_DEFINITIONEN;
const wiese = defs.biome.find((b) => b.biom === 'Meadows');
const grau = defs.biome.find((b) => b.biom === 'Greyglen');
check('weather table has a Greyglen row', grau !== undefined);
check('Greyglen weather = copy of Meadows (own array)', JSON.stringify(grau?.zustaende) === JSON.stringify(wiese?.zustaende) && grau?.zustaende !== wiese?.zustaende);
const wuerfel = new WetterWuerfel();
let wetterGleich = true;
for (let t = 0; t < 40; t++) {
  const sec = t * 1800;
  const a = wuerfel.wetterFuer(Biome.Greyglen, sec);
  const b = wuerfel.wetterFuer(Biome.Meadows, sec);
  if (a.zustand !== b.zustand || a.umgebung !== b.umgebung) wetterGleich = false;
}
check('drawn weather in greyglen = grassland over 40 windows', wetterGleich);
check('resolveBiomeBit(128) = 128', (resolveBiomeBit(Biome.Greyglen) as number | null) === 128);
check('default environment of greyglen = grassland', environmentForBiome(Biome.Greyglen).name === environmentForBiome(Biome.Meadows).name);
const env = (envData as { biomes: { biome: number; name: string; environments: unknown[] }[] }).biomes;
check('envData has a biome 128 entry', env.some((b) => b.biome === 128 && b.name === 'Greyglen'));
check('envData 128 = copy of biome 1', JSON.stringify(env.find((b) => b.biome === 128)?.environments) === JSON.stringify(env.find((b) => b.biome === 1)?.environments));

// ── Display names only through keys ──────────────────────────────────
check('display name de/en via key', inhaltText('inhalt.biom.greyglen', 'de') === 'Grauklamm' && inhaltText('inhalt.biom.greyglen', 'en') === 'Greyglen');

if (fehler > 0) {
  console.error(`\n${fehler} FAIL`);
  process.exit(1);
}
console.log('\nbiom-greyglen: alle Pruefungen gruen');
