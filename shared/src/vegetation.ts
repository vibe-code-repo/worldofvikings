/**
 * Vegetation registry (Phase E) — C++ IZoneManager::Foliage entries parsed
 * 1:1 from the server's vegetation.pkg (tools/prefab-parser/parse-vegetation.ts),
 * with the prefab resolved against the shared registry (entries with unknown
 * prefabs are skipped, exactly like C++ ZoneManager.cpp:219-223).
 *
 * ── Block A: die Originaleinträge sind heraus ────────────────────────
 * `vegetationData.json` bleibt unverändert im Quelltext — es ist die
 * geparste Vorlage und zugleich die Herkunftsangabe der Zahlen in
 * `flora.ts`. Was sich geändert hat, ist der Aufbau von FOLIAGE: Jeder
 * Eintrag läuft jetzt gegen `istEigenesModell()`, und da in
 * `vegetation.pkg` ausschliesslich Valheim-Prefabs stehen, fällt der
 * gesamte Block heraus. Übrig bleibt die eigene Flora.
 *
 * Die Folge ist gross genug, um sie hier hinzuschreiben: Es gibt keine
 * Biom-Standardtabelle mehr. Eine Region ohne Kuratierungsliste bleibt
 * kahl, und eine Welt ohne Layout (die radiale Welt aus `GeoManager`)
 * trägt überhaupt keinen Bewuchs — `server/test/e2-vegetation.ts` misst
 * genau das.
 */

import vegetationData from './vegetationData.json';
import { getStableHash } from './hash.js';
import { PREFABS_BY_NAME, istEigenesModell } from './prefabs.js';
import { EIGENE_FLORA } from './flora.js';

/** C++ IZoneManager::Foliage (ZoneManager.h:130-171). */
export interface Foliage {
  /** Prefab name from the pkg (C++ resolves via PrefabManager). */
  readonly prefabName: string;
  /** get_stable_hash(prefabName) — C++ m_prefab->m_hash. */
  readonly prefabHash: number;
  /** Biome bitmask this foliage may spawn in. */
  readonly biome: number;
  /** BiomeArea bitmask (Edge/Median). */
  readonly biomeArea: number;
  /** Min. free radius between two instances (0 = may overlap). */
  readonly radius: number;
  /** Per-zone quantity min/max; max<1 → spawn chance instead. */
  readonly min: number;
  readonly max: number;
  /** Ground normal.y must be within [cos(maxTilt°), cos(minTilt°)]. */
  readonly minTilt: number;
  readonly maxTilt: number;
  readonly groupRadius: number;
  readonly forcePlacement: boolean;
  readonly groupSizeMin: number;
  readonly groupSizeMax: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  /** Random X/Z tilt in degrees. */
  readonly randTilt: number;
  readonly blockCheck: boolean;
  /** Altitude relative to WATER_LEVEL (30). */
  readonly minAltitude: number;
  readonly maxAltitude: number;
  readonly minOceanDepth: number;
  readonly maxOceanDepth: number;
  readonly terrainDeltaRadius: number;
  readonly minTerrainDelta: number;
  readonly maxTerrainDelta: number;
  readonly inForest: boolean;
  readonly forestTresholdMin: number;
  readonly forestTresholdMax: number;
  readonly snapToWater: boolean;
  readonly snapToStaticSolid: boolean;
  readonly groundOffset: number;
  readonly chanceToUseGroundTilt: number;
  /** Mistlands vegetation mask range. */
  readonly minVegetation: number;
  readonly maxVegetation: number;
}

interface FoliageJson extends Omit<Foliage, 'prefabHash'> {}

/**
 * Die Streutabelle der Welt: die eigene Flora aus `flora.ts`.
 *
 * Reihenfolge ist bedeutungstragend — der Streudurchlauf prüft je
 * Eintrag gegen die schon belegten Flächen und arbeitet die Tabelle von
 * vorn nach hinten ab. Wer zuerst kommt, bekommt den Platz.
 *
 * ── Warum EIGENE_FLORA trotzdem hinten angehängt wird ────────────────
 * Die alte Begründung lautete: Die eigenen Einträge müssen hinter den
 * rund 120 Originalen stehen, weil sie sonst deren Plätze verschöben und
 * damit jede bestehende Welt umbauten. Diese Begründung TRÄGT NICHT
 * MEHR — es gibt keine Originale davor, hinter die man sie stellen
 * könnte, und „hinten" ist damit dasselbe wie „vorn".
 *
 * Der Aufbau bleibt trotzdem zweistufig, aber aus einem anderen Grund:
 * Die Schleife über `vegetationData.json` ist jetzt die Stelle, an der
 * ein zurückkehrender Fremdeintrag AUFFÄLLT (Protokollzeile), statt
 * stillschweigend mitzulaufen. Und sie hält die Herkunft der Zahlen
 * sichtbar, auf die sich `flora.ts` beruft.
 *
 * Was die Reihenfolge nach wie vor trägt, ist die Schichtung INNERHALB
 * der eigenen Flora: erst die grossen Bäume, dann Jungwuchs, zuletzt
 * Kraut (siehe NADELWALD_FLORA). Die steht in `flora.ts` und ist von
 * dieser Datei unberührt.
 */
export const FOLIAGE: readonly Foliage[] = buildFoliage();

function buildFoliage(): Foliage[] {
  const list: Foliage[] = [];
  let fremd = 0;
  const roh = vegetationData.foliage as FoliageJson[];
  for (const f of roh) {
    // Block A: Nur eigene Modelle kommen in die Welt. In vegetation.pkg
    // steht nichts davon — die Schleife läuft heute leer aus und ist der
    // Wächter dafür, dass das so bleibt.
    if (!istEigenesModell(f.prefabName)) {
      fremd++;
      continue;
    }
    if (!PREFABS_BY_NAME.has(f.prefabName)) {
      console.warn(`[vegetation] Skipping unknown prefab: '${f.prefabName}'`);
      continue;
    }
    list.push({ ...f, prefabHash: getStableHash(f.prefabName) });
  }
  if (fremd > 0) {
    console.warn(
      `[vegetation] ${fremd} von ${roh.length} Eintraegen ohne eigenes Modell uebersprungen`
    );
  }
  for (const f of EIGENE_FLORA) {
    if (!PREFABS_BY_NAME.has(f.prefabName)) {
      console.warn(`[flora] Eigener Eintrag ohne Prefab: '${f.prefabName}'`);
      continue;
    }
    list.push(f);
  }
  return list;
}

/** Fast membership test for the client's instancing decision (E4). */
export const FOLIAGE_HASHES: ReadonlySet<number> = new Set(FOLIAGE.map((f) => f.prefabHash));
