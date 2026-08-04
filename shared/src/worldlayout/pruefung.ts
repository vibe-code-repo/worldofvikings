/**
 * Inhaltliche Layout-Prüfung (Review-Punkt 32): `sanitizeWorldLayout`
 * prüft nur die STRUKTUR — ob ein kuratierter Vegetations-, Location-
 * oder Spawn-Name überhaupt existiert, fiel bisher erst beim Server-Boot
 * auf und wurde dort nur gezählt.
 *
 * Diese Prüfung läuft gegen dieselben Tabellen wie der Server und liefert
 * einen Bericht, den Editor, MCP und Boot-Log anzeigen können.
 */

import { FOLIAGE } from '../vegetation.js';
import { FEATURES } from '../features.js';
import { SPAWN_TABLE } from '../spawnData.js';
import { PREFABS_BY_NAME } from '../prefabs.js';
import type { WorldLayout } from './types.js';

export interface LayoutBefund {
  /** Regions-ID bzw. 'placements' — wo der Fund liegt. */
  wo: string;
  art: 'vegetation' | 'location' | 'spawn' | 'placement' | 'welt';
  text: string;
}

export function pruefeLayout(layout: WorldLayout): LayoutBefund[] {
  const befunde: LayoutBefund[] = [];
  const vegNamen = new Set(FOLIAGE.map((f) => f.prefabName));
  const locNamen = new Set(FEATURES.map((f) => f.name));
  const spawnNamen = new Set(SPAWN_TABLE.map((e) => e.prefab));

  for (const r of layout.regions) {
    for (const n of r.vegetation ?? []) {
      if (!vegNamen.has(n)) {
        befunde.push({ wo: r.id, art: 'vegetation', text: `unbekannte Vegetation: ${n}` });
      }
    }
    for (const n of r.locations ?? []) {
      if (!locNamen.has(n)) {
        befunde.push({ wo: r.id, art: 'location', text: `unbekannte Location: ${n}` });
      }
    }
    for (const n of r.spawns ?? []) {
      if (!spawnNamen.has(n)) {
        befunde.push({ wo: r.id, art: 'spawn', text: `unbekannter Spawn: ${n}` });
      }
    }
  }

  for (const p of layout.placements ?? []) {
    if (!PREFABS_BY_NAME.has(p.prefab)) {
      befunde.push({
        wo: 'placements',
        art: 'placement',
        text: `unbekanntes Prefab: ${p.prefab} @(${p.x}, ${p.z})`,
      });
    }
  }

  // Startpunkte: fehlen sie, spawnt der Server am Ursprung — der kann im
  // Layout-Modus offener Ozean sein.
  const hatSpawn = layout.defaultSpawn || layout.continents.some((k) => k.spawn);
  if (!hatSpawn) {
    befunde.push({
      wo: 'welt',
      art: 'welt',
      text: 'Kein Startpunkt gesetzt (defaultSpawn oder continent.spawn) — Spawn liegt am Ursprung',
    });
  }
  return befunde;
}
