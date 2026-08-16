/**
 * Inhaltliche Layout-Prüfung (Review-Punkt 32): `sanitizeWorldLayout`
 * prüft nur die STRUKTUR — ob ein kuratierter Vegetations-, Location-
 * oder Spawn-Name überhaupt existiert, fiel bisher erst beim Server-Boot
 * auf und wurde dort nur gezählt.
 *
 * Diese Prüfung läuft gegen dieselben Tabellen wie der Server und liefert
 * einen Bericht, den Editor, MCP und Boot-Log anzeigen können.
 *
 * Seit Block A prüft sie zusätzlich gegen die Whitelist der selbst gebauten
 * Modelle (`istEigenesModell`): Ein Name kann bekannt UND trotzdem nicht
 * mehr erwünscht sein — das sind die aus Valheim extrahierten Prefabs, die
 * aus Welt und Spielinhalt verschwinden. Die Prüfung MELDET das nur; wer
 * die Welt ändert, ist der nächste Schritt und nicht sie.
 */

import { FOLIAGE } from '../vegetation.js';
import { FEATURES } from '../features.js';
import { SPAWN_TABLE } from '../spawnData.js';
import { PREFABS_BY_NAME, istEigenesModell } from '../prefabs.js';
import { istNpcPrefab } from '../npc.js';
import type { WorldLayout } from './types.js';

export interface LayoutBefund {
  /** Regions-ID bzw. 'placements' — wo der Fund liegt. */
  wo: string;
  art: 'vegetation' | 'location' | 'spawn' | 'placement' | 'route' | 'welt' | 'modell';
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
      } else if (!istEigenesModell(n)) {
        // `else`, nicht ein zweiter Befund: Ein Name, den es gar nicht gibt,
        // ist selbstverständlich auch kein eigenes Modell — zwei Zeilen über
        // dieselbe Zeile im Dokument sagen nichts Zweites.
        befunde.push({ wo: r.id, art: 'modell', text: `kein eigenes Modell: ${n}` });
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

  // Routen: Namensauflösung passiert erst beim Spawnen (der Server
  // ignoriert Unbekanntes still) — ein Tippfehler in der Route bliebe
  // sonst als reglos stehender NPC unerklärt.
  const routenIds = new Set((layout.routes ?? []).map((r) => r.id));
  // Fremdmodelle werden je NAME gezählt und erst nach der Schleife gemeldet,
  // nicht je Platzierung. Die vorhandenen Platzierungs-Befunde schreiben
  // bewusst die Koordinate mit, weil ein Tippfehler an genau einer Stelle
  // sitzt; hier ist es umgekehrt — der Befund gilt dem Prefab, und jede
  // Antwort darauf (Ersatzmodell bauen oder alle Vorkommen entfernen) trifft
  // ohnehin alle seine Platzierungen. In der Weltdatei dieses Projekts
  // stünden sonst 69 Zeilen im Boot-Log, davon 27 Mal dieselbe.
  const fremdeModelle = new Map<string, number>();
  for (const p of layout.placements ?? []) {
    if (!PREFABS_BY_NAME.has(p.prefab)) {
      befunde.push({
        wo: 'placements',
        art: 'placement',
        text: `unbekanntes Prefab: ${p.prefab} @(${p.x}, ${p.z})`,
      });
    } else if (!istEigenesModell(p.prefab)) {
      fremdeModelle.set(p.prefab, (fremdeModelle.get(p.prefab) ?? 0) + 1);
    }
    if (p.route !== undefined && !routenIds.has(p.route)) {
      befunde.push({
        wo: 'placements',
        art: 'route',
        text: `unbekannte Route: ${p.route} (${p.prefab} @(${p.x}, ${p.z}))`,
      });
    }
    // NPC-Angaben an einem Prefab ohne Vorgabe sind ERLAUBT (loeseNpcAuf
    // macht daraus einen zivilen Neutralen), aber fast immer ein Versehen
    // aus der Handarbeit im JSON: Der Editor bietet die Felder dort gar
    // nicht an. Hinweis statt Fehler — genau wie beim Ein-Punkt-Standposten.
    if (p.npc !== undefined && !istNpcPrefab(p.prefab)) {
      befunde.push({
        wo: 'placements',
        art: 'placement',
        text: `NPC-Angaben an einem Prefab ohne Vorgabe: ${p.prefab} @(${p.x}, ${p.z})`,
      });
    }
  }
  for (const [name, anzahl] of fremdeModelle) {
    befunde.push({
      wo: 'placements',
      art: 'modell',
      text: `kein eigenes Modell: ${name} (${anzahl} Platzierung${anzahl === 1 ? '' : 'en'})`,
    });
  }

  // Eine Route mit nur einem Wegpunkt ist zulässig (Standposten), aber
  // meistens ein halb fertiger Entwurf — deshalb ein Hinweis, kein Fehler.
  for (const r of layout.routes ?? []) {
    if (r.points.length < 2) {
      befunde.push({
        wo: r.id,
        art: 'route',
        text: 'Route hat nur einen Wegpunkt — der NPC bleibt dort stehen',
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
