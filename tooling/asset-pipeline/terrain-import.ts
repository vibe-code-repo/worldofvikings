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
import { readGlb, worldBounds, writeGlb, type Bounds } from '@wov/content-build';
import {
  adaptiveMesh,
  buildHeightFieldGlb,
  buildTerrainGlb,
  gridSize,
  meshVsGrid,
  gridMesh,
  readHeightGrid,
  steepShare,
  thinGrid,
  transposeGrid,
  type GridAgreement,
} from './height-field.js';
import {
  MAX_TEXTURE_SIZE,
  decodePng,
  encodePng,
  fitWithin,
  isPng,
  readPngSize,
  mirrorVertically,
} from './png.js';
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

/**
 * Which way round a control map's axes are, relative to the ground it paints.
 *
 * The export's control maps do not share the height field's axis order, and the
 * mismatch is invisible in the file: both are square, both are 512², and a
 * wrongly turned map paints a perfectly plausible-looking landscape whose paths
 * simply do not follow the valleys.
 *
 * It is measured, not guessed. For each of the eight ways to turn or mirror a
 * square map, the terrain's own slope is averaged over the texels where the
 * rarest channel — 0.32 % coverage, the one that can only be a cliff face —
 * carries weight. Against the ground the store now ships, seven of the eight
 * give 0.62–1.84 and one gives **4.28**, against a tile whose own 95th
 * percentile is 2.38. That one is a vertical mirror.
 *
 * Three placements have now been shipped and the first two were wrong, which is
 * worth stating plainly because the failure has no symptom: a wrongly placed
 * map still paints a landscape. ADR-0020 named the mirror on the anti-diagonal
 * (0.64 here). ADR-0043 measured a quarter turn clockwise (1.84 here) and was
 * right about the ground *as it was then read* — and then ADR-0059 found that
 * ground itself was read on the wrong axes and turned it. A map is placed
 * relative to a height field, so turning the height field moves the answer, and
 * this constant has to be re-derived whenever {@link HEIGHT_FIELD_ORIENTATION}
 * changes. `pnpm validate:assets` re-measures it on the stored bytes against
 * the height field the import actually writes, so a placement cannot silently
 * go stale a third time (ADR-0043, ADR-0061).
 */
export const SPLAT_ORIENTATION = 'vertical mirror';

/**
 * Which way round a height field's axes are, relative to the world the props
 * stand in.
 *
 * The export's raster does not share the scene's axis order, exactly as its
 * control maps do not ({@link SPLAT_ORIENTATION}). The import already absorbs
 * half the difference — a placed model is mirrored in x on the way in — and
 * the ground used to be taken as it came, which left the two a quarter turn
 * apart. The village happens to sit near the line the two readings agree on,
 * so the mistake showed up as ground dressing a paving stone too deep rather
 * than as a landscape in the wrong place, and at the rim of the tile, where it
 * is worth tens of metres, nothing was standing to complain.
 *
 * Measured over 374 authored placements from 34 families of flat ground
 * dressing, scored by how tightly each family seats on each of the eight ways
 * to turn a square raster: seven give 0.28–0.76 m of spread, the swap gives
 * 0.068 m. The independent witness is the cliff ring of ADR-0037, which was
 * never scattered onto and therefore cannot have been fitted to the ground it
 * is measured against: 81 of 100 standing on the ground before, 100 of 100
 * after, worst gap 27.22 m before and −0.81 m after (ADR-0059).
 */
export const HEIGHT_FIELD_ORIENTATION = 'swap of the horizontal axes';

/** One texture taken out of the export under a chosen, stable name. */
export interface TerrainTexture {
  /** File name inside the export's texture folder. */
  readonly file: string;
  /** Store file name, without a folder — neutral and readable. */
  readonly name: string;
  /** What it is, in the words the manifest entry uses. */
  readonly note: string;
  readonly provenance: PackProvenance;
  /**
   * True for a control map: it is turned onto the ground's axes on import (see
   * {@link SPLAT_ORIENTATION}) and never resized.
   */
  readonly isSplatMap?: boolean;
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
    isSplatMap: true,
  },
  {
    file: 'SplatAlpha 1_6.png',
    name: 'village-splat-b.png',
    note: 'splat weights for terrain layers 5-6 (RG) of the village tile',
    provenance: TERRAIN_SET,
    isSplatMap: true,
  },
];

/**
 * The ground textures the village tile blends, and the normal maps that go with
 * them.
 *
 * Named after what they *are* rather than after where they came from. Which
 * splat channel drives which of them is a separate question, answered by
 * measurement — see ADR-0032 and `docs/world-format.md`.
 *
 * There are two pebbles-and-sand images and they are two different layers: the
 * broad, low one that covers the shore, and the narrow one the village paths
 * are painted with. The channel that carries the second one holds 3.4 times as
 * much weight under the stone-and-brick path props as under the bushes, which
 * is what says it is a path and not a second meadow (ADR-0032).
 *
 * A normal map is a *direction*, not a picture, so it never gets a placeholder
 * of its own: a clone without the store draws the ground flat, which is what it
 * did before these existed.
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
  {
    file: 'Ani Pebbles_Sand.png',
    name: 'terrain-gravel-path.png',
    note: 'ground layer texture: pale gravel, the layer the village paths are painted with',
    provenance: TERRAIN_SURFACE_SET,
  },
];

/**
 * The five normal maps, one per surface texture that has one.
 *
 * Both grasses share a map in the export, so five maps cover seven textures.
 * Their strengths are not stored here — they are per layer in a world file
 * (`normalScale`), because the same map is right at 2 under grass and at 5
 * under rough rock, and that is an authoring decision, not a property of the
 * file.
 */
export const TERRAIN_NORMAL_MAPS: readonly TerrainTexture[] = [
  {
    file: 'Grass Ani N.png',
    name: 'terrain-grass-normal.png',
    note: 'ground layer normal map: grass, shared by both grass textures',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Ani Rockwall_Normal.png',
    name: 'terrain-rock-a-normal.png',
    note: 'ground layer normal map: dark rock wall',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Rock_Rough_Normals_01.png',
    name: 'terrain-rock-rough-normal.png',
    note: 'ground layer normal map: rough rock',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Ani Pebbles_Sand_normals.png',
    name: 'terrain-gravel-normal.png',
    note: 'ground layer normal map: gravel and sand, shared by both gravel textures',
    provenance: TERRAIN_SURFACE_SET,
  },
  {
    file: 'Moss_Normals_01.png',
    name: 'terrain-moss-normal.png',
    note: 'ground layer normal map: dark moss',
    provenance: TERRAIN_SURFACE_SET,
  },
];

/** Every terrain texture the import takes, splat maps first. */
export const TERRAIN_TEXTURES: readonly TerrainTexture[] = [
  ...VILLAGE_SPLAT_MAPS,
  ...TERRAIN_SURFACE_TEXTURES,
  ...TERRAIN_NORMAL_MAPS,
];

/** One height field the import thins into a second, cheaper tile. */
export interface HeightFieldImport {
  /** File name inside {@link HEIGHT_FIELD_FOLDER}. */
  readonly file: string;
  /** Store path of the thinned tile. */
  readonly path: string;
  /** Keep every `factor`-th row and column: 2 turns 513² into 257². */
  readonly factor: number;
  /**
   * Degrees past which a cell keeps the source resolution (ADR-0032).
   *
   * Absent means "thin the whole tile", which is what the plain 257² copy is.
   * Present means an adaptive tile: coarse where the ground is gentle, full
   * resolution where it stands up, one watertight mesh.
   */
  readonly steepSlope?: number;
}

/**
 * The tiles that get a thinned copy.
 *
 * Only the village tile for now, because it is the only one a world file
 * places. The full-resolution import keeps producing all twelve, so nothing is
 * lost — this adds a second, playable copy beside the source-fidelity one.
 */
export const HEIGHT_FIELDS: readonly HeightFieldImport[] = [
  // The raster a renderer-less tool reads (`heightSamples`). Rebuilt rather
  // than repacked for one reason: the general import centres a terrain tile on
  // its own hull, so the export's own copy of this ground spans −150…150 while
  // every tile rebuilt here spans 0…300. Two rasters of one tile in two frames
  // is the shape of a silent error — every answer is a real height from a real
  // part of the tile, just the wrong part — and only `heightAtOnTile`'s
  // fractional mapping has been hiding it. Full resolution, so the tools read
  // the authored samples and not an interpolation of them.
  { file: 'Terrain_Village1.glb', path: 'terrain/terrain-village1-samples.glb', factor: 1 },
  { file: 'Terrain_Village1.glb', path: 'terrain/terrain-village1-257.glb', factor: 2 },
  {
    file: 'Terrain_Village1.glb',
    path: 'terrain/terrain-village1-adaptive.glb',
    factor: 2,
    // 35°, because that is where the source's own paint changes: the rock
    // channel of the village splat map takes over at about 35° and the rough
    // rock channel at about 65° (ADR-0032). Below it the ground is meadow and
    // a 1.17 m grid is more than it needs.
    steepSlope: 35,
  },
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
  /** The angle past which cells kept the source resolution, or `undefined`. */
  readonly steepSlope?: number;
  /** Coarse cells kept at the source resolution. */
  readonly steepCells?: number;
  readonly coarseCells?: number;
  /** Share of cells past 60° in the source grid, and in what was written. */
  readonly sourceSteepShare: number;
  readonly resultSteepShare: number;
  /**
   * How far the written tile stands from the authored raster at the nodes it
   * shares with it — the number behind "the two grounds agree" (ADR-0059).
   */
  readonly agreement: GridAgreement;
}

/** The angle the import reports the loss at — cliff faces, not slopes. */
export const CLIFF_DEGREES = 60;

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
  steepSlope?: number,
): DecimatedHeightField {
  // The one place the export's axis order is corrected, so every tile built
  // here — coarse, adaptive or full resolution — comes out on the world's axes
  // and the tools and the renderer cannot end up on two different grounds
  // ({@link HEIGHT_FIELD_ORIENTATION}).
  const source = transposeGrid(readHeightGrid(readGlb(bytes), label));
  const thinned = thinGrid(source, factor);
  const name = label.replace(/\.glb$/i, '');
  const sourceSteepShare = steepShare(source, CLIFF_DEGREES);

  if (steepSlope === undefined) {
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
      sourceSteepShare,
      resultSteepShare: steepShare(thinned, CLIFF_DEGREES),
      agreement: meshVsGrid(gridMesh(thinned), source),
    };
  }

  const mesh = adaptiveMesh(source, factor, steepSlope);
  const glb = buildTerrainGlb(name, mesh);
  const bounds = worldBounds(glb.json, label);
  if (bounds === undefined) {
    throw new Error(`${label}: the adaptive tile has no geometry`);
  }
  return {
    bytes: writeGlb(glb),
    bounds,
    size: gridSize(thinned),
    columns: thinned.columns,
    rows: thinned.rows,
    sourceColumns: source.columns,
    sourceRows: source.rows,
    triangles: mesh.triangles,
    steepSlope,
    steepCells: mesh.steepCells,
    coarseCells: mesh.coarseCells,
    sourceSteepShare,
    // Measured on the mesh that was written, not on the grid it came from: the
    // point of the adaptive tile is that this number stays near the source's.
    resultSteepShare: meshSteepShare(mesh.positions, mesh.indices, CLIFF_DEGREES),
    agreement: meshVsGrid(mesh, source),
  };
}

/** Share of a mesh's triangle **area** standing steeper than `degrees`. */
export function meshSteepShare(
  positions: Float32Array,
  indices: Uint32Array,
  degrees: number,
): number {
  let steep = 0;
  let total = 0;
  const limit = Math.cos((degrees * Math.PI) / 180);
  for (let index = 0; index < indices.length; index += 3) {
    const a = (indices[index] ?? 0) * 3;
    const b = (indices[index + 1] ?? 0) * 3;
    const c = (indices[index + 2] ?? 0) * 3;
    const abx = (positions[b] ?? 0) - (positions[a] ?? 0);
    const aby = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const abz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const acx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const acy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const acz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const area = Math.hypot(nx, ny, nz);
    if (area === 0) {
      continue;
    }
    total += area;
    if (Math.abs(ny) / area < limit) {
      steep += area;
    }
  }
  return total === 0 ? 0 : steep / total;
}

/**
 * Prepares one terrain texture for the store.
 *
 * A layer texture over the size budget is halved until it fits; one inside it is
 * passed through byte for byte, which keeps the import deterministic.
 *
 * A **control map is never resized** — each of its texels is a weight, and
 * halving one bleeds every path edge by a metre — but it *is* turned onto the
 * ground's axes ({@link SPLAT_ORIENTATION}), because that is a property of the
 * export and fixing it here means a world file needs no axis field and every
 * renderer can sample it the obvious way.
 */
export function fitTerrainTexture(bytes: Buffer, label: string, isSplatMap = false): Buffer {
  if (!isPng(bytes)) {
    throw new Error(`${label}: terrain textures must be PNG`);
  }
  const size = readPngSize(bytes);
  if (size === undefined) {
    throw new Error(`${label}: PNG has no readable header`);
  }
  if (isSplatMap) {
    if (size.width > MAX_TEXTURE_SIZE || size.height > MAX_TEXTURE_SIZE) {
      throw new Error(
        `${label}: a splat map must not be resized, and this one is ` +
          `${String(size.width)}x${String(size.height)}`,
      );
    }
    return encodePng(mirrorVertically(decodePng(bytes)));
  }
  if (size.width <= MAX_TEXTURE_SIZE && size.height <= MAX_TEXTURE_SIZE) {
    return bytes;
  }
  return encodePng(fitWithin(decodePng(bytes), MAX_TEXTURE_SIZE));
}

/** The manifest `origin` line for a rebuilt tile, with what was measured. */
export function heightFieldOrigin(decimated: DecimatedHeightField): string {
  const from = `${String(decimated.sourceColumns)}x${String(decimated.sourceRows)}`;
  const to = `${String(decimated.columns)}x${String(decimated.rows)}`;
  const turned = `turned onto the world's axes by a ${HEIGHT_FIELD_ORIENTATION}`;
  const tail =
    `normals and UVs rebuilt, ${turned}, origin kept at the tile corner, ` +
    `${String(decimated.triangles)} triangles.`;
  if (decimated.columns === decimated.sourceColumns && decimated.rows === decimated.sourceRows) {
    return `Height field rebuilt at its full ${from} vertices, ${tail}`;
  }
  if (decimated.steepSlope === undefined) {
    return `Height field thinned from ${from} to ${to} vertices, ${tail}`;
  }
  return (
    `Height field thinned from ${from} to ${to} vertices except past ` +
    `${String(decimated.steepSlope)} degrees, where the source resolution is kept ` +
    `(${String(decimated.steepCells ?? 0)} of ${String(decimated.coarseCells ?? 0)} cells); ` +
    tail
  );
}

/** The manifest `origin` line for a terrain texture. */
export function terrainTextureOrigin(texture: TerrainTexture): string {
  const note = `${texture.note.charAt(0).toUpperCase()}${texture.note.slice(1)}`;
  const turned =
    texture.isSplatMap === true ? ` Turned onto the ground's axes by a ${SPLAT_ORIENTATION}.` : '';
  return `${note}, taken from the modelling export under a chosen name.${turned}`;
}

/** Store path of a terrain texture. */
export function terrainTexturePath(texture: TerrainTexture): string {
  return `textures/${texture.name}`;
}
