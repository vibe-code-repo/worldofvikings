/**
 * Build pieces per tool — Unity `PieceTable` / `Piece`.
 *
 * C# reference: PieceTable.cs, Piece.cs, Player.SetPlaceMode.
 *
 * Simplified against the original: Valheim keeps a 15×6 grid with 8 categories
 * because the hammer has hundreds of build pieces. The hoe has four modes and
 * the cultivator three, so a flat list per tool is enough. `category` is kept
 * in the shape so adding the hammer later does not require a rewrite.
 *
 * Every ground piece carries the TerrainOp settings that get applied when it is
 * placed. In Valheim the piece prefab literally has both a `Piece` and a
 * `TerrainOp` component (verified on `raise`, `path` and `cultivate`); placing
 * it instantiates the prefab, whose TerrainOp deforms the terrain and then
 * destroys itself. We skip the prefab round-trip and apply the settings
 * directly — same result, no throwaway entity.
 */

import { PaintType, TERRAIN_OP_DEFAULTS, type TerrainOpSettings } from '../worldgen/TerrainComp.js';

export interface PieceDef {
  /** Prefab name in the original (`raise`, `path`, `cultivate`, …). */
  name: string;
  label: string;
  /** Sprite in assets/sprites/, without ".png". */
  icon: string;
  /** Reserved for the hammer's category tabs; all ground pieces are 0. */
  category: number;
  /**
   * C# Piece.m_groundPiece — the piece clips to the terrain and shows no
   * cursor marker of its own.
   */
  groundPiece: boolean;
  /**
   * C# Piece.m_allowAltGroundPlacement. When set, the target height is the
   * ground under the PLAYER's feet rather than the raycast hit; holding
   * AltPlace (shift) switches back to the hit point.
   *
   * Only `levelground` has this in the original, and it is exactly what makes
   * "level to the height I'm standing on" work.
   */
  allowAltGroundPlacement: boolean;
  terrainOp: TerrainOpSettings;

  // Cost levers — parsed from the original but not enforced yet.
  /** `raise` costs 4 stone (m_recover: 0, so it is not refunded). */
  resources?: ReadonlyArray<{ item: string; amount: number }>;
  /** `raise` additionally needs a workbench within 20 m. */
  craftingStation?: string;
  /**
   * Bau-Piece (Hammer): statt einer Terrain-Op wird dieses Prefab als
   * persistentes ZDO gesetzt (Ghost-Vorschau, Raster-Snap, PlacePiece-
   * Paket). terrainOp ist dann eine wirkungslose Attrappe.
   */
  bauPrefab?: string;
}

/** Attrappe für Bau-Pieces — ändert weder Höhe noch Bemalung. */
const KEINE_OP: TerrainOpSettings = { ...TERRAIN_OP_DEFAULTS };

/** Bau-Piece-Kurzform für die Hammer-Tabelle. */
function bau(
  name: string,
  label: string,
  icon: string,
  prefab: string,
  resources: ReadonlyArray<{ item: string; amount: number }>
): PieceDef {
  return {
    name,
    label,
    icon,
    category: 0,
    groundPiece: false,
    allowAltGroundPlacement: false,
    terrainOp: KEINE_OP,
    resources,
    bauPrefab: prefab,
  };
}

/** Verified from the `digg` prefab dump: level −0.5 m, radius 1.5, radial. */
const DIGG: TerrainOpSettings = {
  ...TERRAIN_OP_DEFAULTS,
  levelOffset: -0.5,
  level: true,
  levelRadius: 1.5,
  square: false,
  paintCleared: true,
  paintType: PaintType.Dirt,
  paintRadius: 2.5,
};

export const PIECES: Record<string, PieceDef> = {
  levelground: {
    name: 'levelground',
    label: 'Einebnen',
    icon: 'hoe',
    category: 0,
    groundPiece: true,
    // The one piece with this flag — target height comes from the player.
    allowAltGroundPlacement: true,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      level: true,
      levelRadius: 2,
      square: true,
      smooth: true,
      smoothRadius: 3,
      smoothPower: 3,
      paintCleared: true,
      paintType: PaintType.Dirt,
      paintRadius: 2.5,
    },
  },
  raise: {
    name: 'raise',
    label: 'Aufschütten',
    icon: 'stone',
    category: 0,
    groundPiece: true,
    allowAltGroundPlacement: false,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      raise: true,
      raiseRadius: 2,
      raiseDelta: 1,
      raisePower: 3,
      square: false,
      paintCleared: true,
      paintType: PaintType.Dirt,
      paintRadius: 2,
    },
    resources: [{ item: 'Stone', amount: 4 }],
    craftingStation: 'piece_workbench',
  },
  path: {
    // verified: smooth radius 3 with power 1 (not the usual 3), paint radius 3
    name: 'path',
    label: 'Pfad',
    icon: 'cultivate_ground',
    category: 0,
    groundPiece: true,
    allowAltGroundPlacement: false,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      smooth: true,
      smoothRadius: 3,
      smoothPower: 1,
      paintCleared: true,
      paintType: PaintType.Dirt,
      paintRadius: 3,
    },
  },
  paved_road: {
    name: 'paved_road',
    label: 'Gepflastert',
    icon: 'stone',
    category: 0,
    groundPiece: true,
    allowAltGroundPlacement: false,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      smooth: true,
      smoothRadius: 3,
      smoothPower: 1,
      paintCleared: true,
      paintType: PaintType.Paved,
      paintRadius: 3,
    },
  },
  cultivate: {
    // verified from cultivate_v2: level radius 1.5, smooth 3/3, paint 3
    name: 'cultivate',
    label: 'Kultivieren',
    icon: 'cultivate_ground',
    category: 0,
    groundPiece: true,
    allowAltGroundPlacement: false,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      levelRadius: 1.5,
      square: false,
      smooth: true,
      smoothRadius: 3,
      smoothPower: 3,
      paintCleared: true,
      paintType: PaintType.Cultivate,
      paintRadius: 3,
    },
  },
  reset: {
    // Not an original piece — the hoe has no "undo paint" mode. Added because
    // without it there is no way back to the biome look while painting is the
    // only visible effect of most modes.
    name: 'reset',
    label: 'Zurücksetzen',
    icon: 'hoe',
    category: 0,
    groundPiece: true,
    allowAltGroundPlacement: false,
    terrainOp: {
      ...TERRAIN_OP_DEFAULTS,
      paintCleared: true,
      paintType: PaintType.Reset,
      paintRadius: 2,
    },
  },
};

/** Which modes each tool offers — C# ItemData.SharedData.m_buildPieces. */
Object.assign(PIECES, {
  bau_boden: bau('bau_boden', 'Holzboden 2×2', 'wood_floor', 'wood_floor', [{ item: 'Wood', amount: 2 }]),
  bau_wand: bau('bau_wand', 'Holzwand', 'wood_floor', 'woodwall', [{ item: 'Wood', amount: 2 }]),
  bau_tuer: bau('bau_tuer', 'Holztür', 'wood_door', 'wood_door', [{ item: 'Wood', amount: 4 }]),
  bau_dach: bau('bau_dach', 'Dachschräge 45°', 'wood_floor', 'wood_roof_45', [{ item: 'Wood', amount: 2 }]),
  bau_werkbank: bau('bau_werkbank', 'Werkbank', 'hammer', 'piece_workbench', [{ item: 'Wood', amount: 10 }]),
  bau_bett: bau('bau_bett', 'Bett', 'bed', 'bed', [{ item: 'Wood', amount: 8 }]),
  bau_portal: bau('bau_portal', 'Portal', 'portal_wood', 'portal_wood', [
    { item: 'Wood', amount: 20 },
    { item: 'Flint', amount: 10 },
  ]),
  // Kein Original-Bauteil: eigenes Modell aus tools/tripo-generate.mjs.
  // Der Eintrag wirkt an zwei Stellen — der Hammer kann den Baum online
  // setzen, und BAU_PREFABS speist die Kategorie "Bauteile" des SpawnPanels
  // (Taste B im Editor-Testflug).
  bau_kipine: bau('bau_kipine', 'KI-Kiefer', 'sapling_pine', 'KiPine2', [{ item: 'Wood', amount: 1 }]),
  bau_steinkreis: bau('bau_steinkreis', 'Steinkreis', 'portal_stone', 'Steinkreis', [
    { item: 'Stone', amount: 20 },
  ]),
});

export const PIECE_TABLES: Record<string, readonly string[]> = {
  Hoe: ['levelground', 'raise', 'path', 'paved_road', 'reset'],
  Cultivator: ['cultivate', 'path'],
  Hammer: [
    'bau_boden', 'bau_wand', 'bau_tuer', 'bau_dach',
    'bau_werkbank', 'bau_bett', 'bau_portal', 'bau_kipine', 'bau_steinkreis',
  ],
};

/** Bau-Prefabs des Hammers — Server-Whitelist für PlacePiece. */
export const BAU_PREFABS: ReadonlySet<string> = new Set(
  PIECE_TABLES.Hammer.map((n) => PIECES[n]?.bauPrefab).filter((p): p is string => !!p)
);

export function piecesFor(table: string): PieceDef[] {
  return (PIECE_TABLES[table] ?? []).map((n) => PIECES[n]).filter(Boolean);
}

/** The pickaxe's terrain hit — C# m_spawnOnHitTerrain -> digg_v3. */
export const TERRAIN_HIT_OPS: Record<string, TerrainOpSettings> = {
  digg: DIGG,
};
