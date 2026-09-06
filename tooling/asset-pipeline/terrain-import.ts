/**
 * The terrain half of the import: one thinned height field per tile, and the
 * ground textures a world file's `terrain.layers` and `terrain.splat` point at
 * (ADR-0020).
 *
 * It is a step of `import-world-assets.ts` rather than its own command, because
 * that script rewrites every private manifest entry it owns on each run — a
 * second script writing entries beside it would have them dropped the next time
 * the first one ran.
 *
 * Two things happen here that the general import cannot do:
 *
 * 1. **A height field is rebuilt, not repacked.** The export's 513² grid has no
 *    usable UVs and 524 288 triangles. `height-field.ts` reads it as a grid,
 *    keeps every second row and column and writes positions, normals, UVs and
 *    indices from scratch. The general path deliberately never touches vertex
 *    data (`glb.ts`), so this cannot live there.
 * 2. **A handful of textures get chosen, stable names.** Everywhere else a
 *    texture is named by the hash of its bytes, because it is discovered inside
 *    a model. These are named in a world file by hand, so their names have to
 *    be readable and stable across a re-import: `terrain-grass-a.png`, not
 *    `grass-ani-4f2c19ab.png`.
 */
import { readGlb, worldBounds, writeGlb, type Bounds } from './glb.js';
import { buildHeightFieldGlb, gridSize, readHeightGrid, thinGrid } from './height-field.js';
import { MAX_TEXTURE_SIZE, decodePng, encodePng, fitWithin, isPng, readPngSize } from './png.js';
import { TERRAIN_SET, type PackProvenance } from './selection.js';

/**
 * What is honestly known about the six ground textures.
 *
 * A separate set from the terrain height fields: those are the project's own
 * work, while the surface textures carry no marking of any kind and are
 * recorded as an unidentified third-party set rather than filed under a guess
 * — the same treatment the model sets get in `selection.ts`. Everything stays
 * `NOASSERTION` and not redistributable until a person checks.
 */
export const TERRAIN_SURFACE_SET: PackProvenance = {
  source: 'private asset collection — terrain surface textures',
  author: 'unconfirmed — third-party commercial pack, licence review open',
};

/** One texture taken out of the export under a chosen, stable name. */
export interface TerrainTexture {
  /** File name inside the export's texture folder. */
  readonly file: string;
  /** Store file name, without a folder — neutral and readable. */
  readonly name: string;
  /** What it is, in the words the manifest entry uses. */
  readonly note: string;
  readonly provenance: PackProvenance;
}

/** Where textures sit in the export. */
export const TEXTURE_FOLDER = 'Texture2D';
/** Where height fields sit in the export. */
export const HEIGHT_FIELD_FOLDER = 'TerrainData';

/**
 * The two weight maps of the village tile.
 *
 * A splat map is *paint*, not a picture: each channel is one layer's weight, so
 * it is copied at its authored 512² and never resized. Halving it would bleed
 * every path edge by a metre.
 */
export const VILLAGE_SPLAT_MAPS: readonly TerrainTexture[] = [
  {
    file: 'SplatAlpha 0_6.png',
    name: 'village-splat-a.png',
    note: 'splat weights for terrain layers 1-4 (RGBA) of the village tile',
    provenance: TERRAIN_SET,
  },
  {
    file: 'SplatAlpha 1_6.png',
    name: 'village-splat-b.png',
    note: 'splat weights for terrain layers 5-6 (RG) of the village tile',
    provenance: TERRAIN_SET,
  },
];

/**
 * The six ground textures the village tile blends.
 *
 * Ordered as the layer list in a world file is written, and named after what
 * they *are* rather than after where they came from. Which splat channel drives
 * which of them is a separate question, answered by looking at the rendered
 * tile — see ADR-0020 and `docs/world-format.md`.
 */
export const TERRAIN_SURFACE_TEXTURES: readonly TerrainTexture[] = [
  {
    file: 'Grass Ani.png',
    name: 'terrain-grass-a.png',
    note: 'ground layer texture: meadow grass',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Ani Grass 2.png',
    name: 'terrain-grass-b.png',
    note: 'ground layer texture: second, darker grass',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Ani Dark Rockwall.png',
    name: 'terrain-rock-a.png',
    note: 'ground layer texture: dark rock wall',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Rock_Rough_Texture_01.png',
    name: 'terrain-rock-rough.png',
    note: 'ground layer texture: rough rock',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Ani Dark Pebbles_Sand.png',
    name: 'terrain-gravel.png',
    note: 'ground layer texture: gravel and sand',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Moss-Dark-A.png',
    name: 'terrain-moss.png',
    note: 'ground layer texture: dark moss',
    provenance: TERRAIN_SURFACE_SET,
  },
];

/** Every terrain texture the import takes, splat maps first. */
export const TERRAIN_TEXTURES: readonly TerrainTexture[] = [
  ...VILLAGE_SPLAT_MAPS,
  ...TERRAIN_SURFACE_TEXTURES,
];

/** One height field the import thins into a second, cheaper tile. */
export interface HeightFieldImport {
  /** File name inside {@link HEIGHT_FIELD_FOLDER}. */
  readonly file: string;
  /** Store path of the thinned tile. */
  readonly path: string;
  /** Keep every `factor`-th row and column: 2 turns 513² into 257². */
  readonly factor: number;
}

/**
 * The tiles that get a thinned copy.
 *
 * Only the village tile for now, because it is the only one a world file
 * places. The full-resolution import keeps producing all twelve, so nothing is
 * lost — this adds a second, playable copy beside the source-fidelity one.
 */
export const HEIGHT_FIELDS: readonly HeightFieldImport[] = [
  { file: 'Terrain_Village1.glb', path: 'terrain/terrain-village1-257.glb', factor: 2 },
];

/** What {@link decimateHeightField} produced, including the measurements. */
export interface DecimatedHeightField {
  readonly bytes: Buffer;
  readonly bounds: Bounds;
  /** `[width, depth]` of the tile in metres — the world file's `size`. */
  readonly size: [number, number];
  readonly columns: number;
  readonly rows: number;
  readonly sourceColumns: number;
  readonly sourceRows: number;
  readonly triangles: number;
}

/**
 * Reads a height field, keeps every `factor`-th vertex and writes a clean tile.
 *
 * The hull is measured off the result rather than carried over from the source,
 * so the number in the manifest describes the file that is actually there.
 */
export function decimateHeightField(
  bytes: Buffer,
  label: string,
  factor: number,
): DecimatedHeightField {
  const source = readHeightGrid(readGlb(bytes), label);
  const thinned = thinGrid(source, factor);
  const name = label.replace(/\.glb$/i, '');
  const glb = buildHeightFieldGlb(name, thinned);
  const bounds = worldBounds(glb.json, label);
  if (bounds === undefined) {
    throw new Error(`${label}: the thinned tile has no geometry`);
  }

  return {
    bytes: writeGlb(glb),
    bounds,
    size: gridSize(thinned),
    columns: thinned.columns,
    rows: thinned.rows,
    sourceColumns: source.columns,
    sourceRows: source.rows,
    triangles: (thinned.columns - 1) * (thinned.rows - 1) * 2,
  };
}

/**
 * Brings one texture down to the size budget if it is over it, and refuses
 * anything that is not a PNG.
 *
 * A file already inside the budget is passed through byte for byte — which is
 * what keeps a splat map's paint exact and the import deterministic.
 */
export function fitTerrainTexture(bytes: Buffer, label: string): Buffer {
  if (!isPng(bytes)) {
    throw new Error(`${label}: terrain textures must be PNG`);
  }
  const size = readPngSize(bytes);
  if (size === undefined) {
    throw new Error(`${label}: PNG has no readable header`);
  }
  if (size.width <= MAX_TEXTURE_SIZE && size.height <= MAX_TEXTURE_SIZE) {
    return bytes;
  }
  return encodePng(fitWithin(decodePng(bytes), MAX_TEXTURE_SIZE));
}

/** The manifest `origin` line for a thinned tile, with what was measured. */
export function heightFieldOrigin(decimated: DecimatedHeightField): string {
  return (
    'Height field thinned from ' +
    `${String(decimated.sourceColumns)}x${String(decimated.sourceRows)} to ` +
    `${String(decimated.columns)}x${String(decimated.rows)} vertices, normals and UVs rebuilt, ` +
    `origin kept at the tile corner, ${String(decimated.triangles)} triangles.`
  );
}

/** The manifest `origin` line for a terrain texture. */
export function terrainTextureOrigin(texture: TerrainTexture): string {
  const note = `${texture.note.charAt(0).toUpperCase()}${texture.note.slice(1)}`;
  return `${note}, taken from the modelling export under a chosen name.`;
}

/** Store path of a terrain texture. */
export function terrainTexturePath(texture: TerrainTexture): string {
  return `textures/${texture.name}`;
}
