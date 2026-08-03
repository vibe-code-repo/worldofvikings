/**
 * Geo-Factory — die eine Stelle, an der entschieden wird, WELCHE
 * Weltgenerierung eine Welt bekommt.
 *
 * `valheim` ist der bisherige 1:1-Port (radiales Seed-Weltbild);
 * `layout` wird die designer-definierte Regionen-Welt (RegionGeo, Phase 2
 * des Kartengenerierungs-Umbaus). Server, Client und Karten-Worker gehen
 * alle über diese Factory, damit der Modus an genau einem Ort wohnt.
 */

import { GeoManager, type GeoManagerSettings } from './GeoManager.js';
import { RegionGeo } from './RegionGeo.js';
import { sanitizeWorldLayout } from '../worldlayout/index.js';

/**
 * Konsumenten-Sicht auf die Weltgenerierung.
 *
 * Bewusst ein Typ-Alias statt eines strukturellen Interfaces: RegionGeo
 * erweitert GeoManager (erbt alle Biom-Höhenfunktionen unverändert), damit
 * bleiben sämtliche bestehenden Signaturen (`geo: GeoManager`) gültig und
 * es gibt keinen Drift zwischen Interface und Implementierung.
 */
export type IGeo = GeoManager;

export type WorldMode = 'valheim' | 'layout';

export interface GeoConfig {
  mode: WorldMode;
  /** get_stable_hash(seedName) — im Layout-Modus nur Quelle des Perlin-Details. */
  worldSeed: number;
  settings?: GeoManagerSettings;
  /**
   * WorldLayout-Dokument (nur Layout-Modus) — bewusst `unknown`: die
   * Validierung übernimmt sanitizeWorldLayout in Phase 1/2.
   */
  layout?: unknown;
}

export function createGeo(config: GeoConfig): IGeo {
  if (config.mode === 'layout') {
    const layout = sanitizeWorldLayout(config.layout);
    if (!layout) {
      throw new Error('world.mode "layout": kein gültiges WorldLayout-Dokument übergeben');
    }
    return new RegionGeo(config.worldSeed, config.settings, layout);
  }
  return new GeoManager(config.worldSeed, config.settings);
}
