/**
 * Die Pieces der Features (Phase F) — C++ Prefab::Instance je
 * IZoneManager::Feature, aus features.pkg geparst
 * (tools/prefab-parser/parse-features.ts).
 *
 * WARUM EIN EIGENES MODUL: 23 228 Pieces sind ~8,5 MB JSON und damit der
 * mit Abstand groesste Brocken der Weltdaten. Sie werden ausschliesslich
 * SERVERSEITIG gebraucht (ZoneManager platziert die Pieces einer Location,
 * WovServer sucht das DUNGEON-Piece, backfillCamps laeuft ueber sie). Der
 * Client kennt Locations nur als fertige ZDOs vom Server und braucht davon
 * nichts. Stuenden die Pieces weiter in `features.ts`, zoege der Barrel-
 * Export sie in jedes Client-Bundle — genau das war der Grund fuer den
 * 12-MB-Chunk im Produktionsbuild.
 *
 * Dieses Modul wird deshalb bewusst NICHT aus `index.ts` re-exportiert:
 * es soll nur ueber den expliziten Pfad erreichbar sein, damit ein
 * versehentlicher Client-Import auffaellt.
 */

import featurePiecesData from './featurePiecesData.json';

/** C++ Prefab::Instance::RandomSpawn (Prefab.h:12-18). */
export interface FeatureRandomSpawn {
  readonly chanceToSpawn: number;
  readonly notInLava: boolean;
  readonly minElevation: number;
  readonly maxElevation: number;
}

/** C++ Prefab::Instance (piece of a feature). */
export interface FeaturePiece {
  /** Name from the pkg (0.221.6 added names). */
  readonly pieceName: string;
  /** Stable prefab hash from the pkg (C++ m_prefabHash). */
  readonly prefabHash: number;
  /** Position relative to the feature origin. */
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  /** Rotation relative to the feature origin. */
  readonly rot: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  /** RandomSpawn data merged onto this piece (null = always spawns). */
  readonly randomSpawn: FeatureRandomSpawn | null;
}

const PIECES = featurePiecesData.pieces as Record<string, readonly FeaturePiece[]>;

const LEER: readonly FeaturePiece[] = [];

/**
 * Pieces eines Features in pkg-Reihenfolge (die Reihenfolge ist
 * platzierungsrelevant). Unbekannte Namen liefern eine leere Liste statt
 * undefined — jede Aufrufstelle iteriert ohnehin nur.
 */
export function getFeaturePieces(featureName: string): readonly FeaturePiece[] {
  return PIECES[featureName] ?? LEER;
}
