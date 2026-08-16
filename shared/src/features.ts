/**
 * Feature (zone location) registry (Phase F) — C++ IZoneManager::Feature
 * entries parsed 1:1 from the server's features.pkg
 * (tools/prefab-parser/parse-features.ts), in pkg order (order matters:
 * m_features is iterated for placement).
 *
 * BUNDLE-SCHNITT: Hier steht nur noch der KOPF jedes Features — die 23 228
 * Pieces liegen getrennt in featurePiecesData.json hinter `featurePieces.ts`.
 * Grund: dieses Modul haengt ueber den Barrel an praktisch jedem Client-
 * Modul, und die Pieces waren allein 6 MB davon (im Produktionsbundle sogar
 * zweimal, weil der Karten-Worker ein eigener Rollup-Einstieg ist). Der
 * Client liest von einem Feature real nur `clearArea`, `exteriorRadius` und
 * den groessten horizontalen Piece-Abstand — der steht deshalb als
 * vorberechneter `pieceRadius` im Kopf. Wer die echten Pieces braucht (nur
 * der Server: Platzierung, Camp-Backfill, Dungeon-Erkennung), holt sie ueber
 * `getFeaturePieces(name)`.
 *
 * C++ reference: ZoneManager.cpp:48-157 (pkg read), ZoneManager.h:71-114.
 */

import featuresData from './featuresData.json';
import { getStableHash } from './hash.js';
import { istEigenesModell } from './prefabs.js';

/** C++ IZoneManager::Feature (ZoneManager.h:71-114). */
export interface Feature {
  readonly name: string;
  /** get_stable_hash(name) — C++ m_hash. */
  readonly hash: number;
  readonly biome: number;
  readonly biomeArea: number;
  readonly applyRandomDamage: boolean;
  readonly centerFirst: boolean;
  readonly clearArea: boolean;
  readonly exteriorRadius: number;
  readonly interiorRadius: number;
  readonly forestTresholdMin: number;
  readonly forestTresholdMax: number;
  readonly group: string;
  readonly iconAlways: boolean;
  readonly iconPlaced: boolean;
  readonly inForest: boolean;
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minTerrainDelta: number;
  readonly maxTerrainDelta: number;
  readonly minDistanceFromSimilar: number;
  readonly spawnAttempts: number;
  readonly quantity: number;
  readonly randomRotation: boolean;
  readonly slopeRotation: boolean;
  readonly snapToWater: boolean;
  readonly unique: boolean;
  /**
   * Groesster horizontaler Abstand eines Pieces vom Feature-Ursprung, beim
   * Parsen aus den Pieces vorberechnet. Ersetzt das fruehere Durchlaufen von
   * `pieces` in `getTerrainLeveling` — die einzige Stelle, an der der Client
   * die Pieces ueberhaupt anfasste.
   */
  readonly pieceRadius: number;
}

interface FeatureJson extends Omit<Feature, 'hash'> {}

/**
 * Die Features, die ausgeliefert werden — in pkg-Reihenfolge, gefiltert
 * gegen die Whitelist `EIGENE_MODELLE` (prefabs.ts).
 *
 * Seit Block A benutzt das Projekt ausschliesslich selbst gebaute Modelle.
 * Eine Location ist nichts als eine Anordnung von Prefabs aus dem
 * Valheim-Export; keiner der 146 Namen steht auf der Whitelist, die Liste
 * ist also leer. Das ist der beschlossene Zwischenzustand, kein Defekt —
 * bis eigene Bauwerke vorliegen, hat die Welt keine Locations.
 *
 * VERWORFEN: je Feature seine PIECES prüfen und nur die durchlassen, deren
 * Teile samt und sonders eigener Bau sind. Das wäre die genauere Regel,
 * zöge aber `featurePieces.ts` (23 228 Pieces, ~6 MB) in dieses Modul —
 * und damit über den Barrel zurück in jedes Client-Bundle, dessen
 * Abtrennung der Bundle-Schnitt oben gerade erst erkauft hat. Am Ergebnis
 * änderte es ohnehin nichts: Die Pieces sind durchweg Valheim-Geometrie.
 *
 * Der Rohbestand bleibt in `featuresData.json` liegen. Er ist die
 * Datengrundlage der Naht zu `featurePiecesData.json` (geprüft von
 * shared/test/weltdaten-schnitt.ts) und kommt zurück, sobald eigene
 * Bauwerke auf der Whitelist stehen.
 */
export const FEATURES: readonly Feature[] = bauFeatures();

function bauFeatures(): Feature[] {
  const roh = featuresData.features as FeatureJson[];
  const liste: Feature[] = [];
  for (const f of roh) {
    if (!istEigenesModell(f.name)) continue;
    liste.push({ ...f, hash: getStableHash(f.name) });
  }
  const uebersprungen = roh.length - liste.length;
  if (uebersprungen > 0) {
    console.warn(
      `[features] ${uebersprungen} von ${roh.length} Eintraegen ohne eigenes Modell uebersprungen`
    );
  }
  return liste;
}

export const FEATURES_BY_NAME: ReadonlyMap<string, Feature> = new Map(
  FEATURES.map((f) => [f.name, f])
);

export const FEATURES_BY_HASH: ReadonlyMap<number, Feature> = new Map(
  FEATURES.map((f) => [f.hash, f])
);

/** Lookup by get_stable_hash(name) — e.g. the 'location' member of a LocationProxy ZDO. */
export function getFeatureByHash(hash: number): Feature | undefined {
  return FEATURES_BY_HASH.get(hash);
}
