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
 * mehr erwünscht sein — das sind die extrahierten Fremdprefabs, die
 * aus Welt und Spielinhalt verschwinden. Die Prüfung MELDET das nur; wer
 * die Welt ändert, ist der nächste Schritt und nicht sie.
 */

import { FOLIAGE } from '../vegetation.js';
import { FEATURES } from '../features.js';
import { SPAWN_TABLE } from '../spawnData.js';
import { PREFABS_BY_NAME, istEigenesModell } from '../prefabs.js';
import { istNpcPrefab } from '../npc.js';
import type { PlacementDef, WorldLayout } from './types.js';
import { gleicherInhalt, zusammengefassteDuplikate } from './platzierungsId.js';
import { MAX_KANDIDATEN } from './compile.js';
import { ueberlappungsGruppen, type UeberlappungsGruppe } from './kartenAuswertung.js';

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
  befunde.push(...platzierungsBefunde(layout));
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
  befunde.push(...ueberlappungsBefunde(layout));
  return befunde;
}

/**
 * Zuletzt gerechnete Überlappungsgruppen samt dem Schlüssel der Geometrie, aus
 * der sie stammen. Die Rechnung läuft über das Zellraster jeder Region und
 * kostet in der Dev-Welt (19 Regionen, 40 km) rund 180 ms, die übrige Prüfung
 * zusammen etwa 1 ms — und der Editor ruft `pruefeLayout` bei jedem Neuaufbau
 * mehrfach. Ein Schlüssel aus dem INHALT statt einer Objekt-Identität, weil
 * das Layout im Editor an Ort und Stelle verändert wird: Eine Identität bliebe
 * dabei gleich, während sich die Form ändert.
 */
let ueberlappungsCache: { schluessel: string; gruppen: UeberlappungsGruppe[] } | undefined;

/**
 * Zellüberlappungen (Block 0.11): Rasterzellen, in denen mehr Regionen als
 * MAX_KANDIDATEN konkurrieren. Das Kompilat (compile.ts, `fuelleChunk`) verwirft
 * dort ohne Meldung die Region mit dem niedrigsten Index; die Karte kann an
 * der Stelle dann eine andere Region zeigen, als eingegeben wurde. Wie bei den
 * Platzierungs-Befunden nur ein HINWEIS (`art: 'welt'`).
 *
 * Eine Zeile je Regionen-Kombination, nicht je Zelle: In der Dev-Welt sind es
 * 893 Zellen in vier Kombinationen, s. `ueberlappungsGruppen`. `wo` ist
 * 'welt', keine Regions-ID, weil der Befund mehreren Regionen gilt.
 */
function ueberlappungsBefunde(layout: WorldLayout): LayoutBefund[] {
  // Mit höchstens MAX_KANDIDATEN Regionen kann keine Zelle überlaufen.
  if (layout.regions.length <= MAX_KANDIDATEN) return [];
  // Gelesen wird nur, was `zellUeberlappungen` liest: Reihenfolge, ID, Form
  // und Randabfall der Regionen.
  const schluessel = JSON.stringify(layout.regions.map((r) => [r.id, r.edgeFalloff, r.shape]));
  if (ueberlappungsCache?.schluessel !== schluessel) {
    ueberlappungsCache = { schluessel, gruppen: ueberlappungsGruppen(layout) };
  }
  return ueberlappungsCache.gruppen.map((g) => ({
    wo: 'welt',
    art: 'welt',
    text:
      `Zellüberlappung: ${g.regionen.length} Regionen (${g.regionen.join(', ')}) konkurrieren in ` +
      `${g.zellenAnzahl} Zelle${g.zellenAnzahl === 1 ? '' : 'n'} um (${Math.round(g.mitteX)}, ${Math.round(g.mitteZ)}), ` +
      `x ${g.minX}…${g.maxX}, z ${g.minZ}…${g.maxZ} — das Kompilat merkt sich nur ${MAX_KANDIDATEN} je Zelle`,
  }));
}

/**
 * Befunde zu den Platzierungs-IDs. Alles nur HINWEISE (`art: 'welt'` stuft der
 * Editor als Hinweis ein): Der Sanitizer hat die Lage schon bereinigt, hier
 * steht, was er dabei getan hat oder nicht tun durfte.
 */
function platzierungsBefunde(layout: WorldLayout): LayoutBefund[] {
  const befunde: LayoutBefund[] = [];
  // Was der Sanitizer beim Erzeugen DIESES Layouts zusammengefasst hat.
  for (const zeile of zusammengefassteDuplikate(layout)) {
    befunde.push({ wo: 'placements', art: 'welt', text: `exaktes Duplikat zu einem Eintrag zusammengefasst: ${zeile}` });
  }
  const ids = new Set<string>();
  const doppelt = new Set<string>();
  const nachPrefab = new Map<string, PlacementDef[]>();
  const beschreibung = (p: PlacementDef): string => p.id ?? `${p.prefab} @(${p.x}, ${p.z})`;
  for (const p of layout.placements ?? []) {
    if (p.id !== undefined) {
      if (ids.has(p.id) && !doppelt.has(p.id)) {
        doppelt.add(p.id);
        befunde.push({ wo: 'placements', art: 'welt', text: `Platzierungs-ID mehrfach vergeben: ${p.id}` });
      }
      ids.add(p.id);
    }
    // Zwei Einträge mit gleichem Inhalt, die der Sanitizer NICHT zusammenlegt
    // (verschiedene ausdrückliche IDs) oder die noch nicht sanitisiert sind.
    const gleiche = nachPrefab.get(p.prefab);
    const zwilling = gleiche?.find((q) => gleicherInhalt(q, p));
    if (zwilling) {
      befunde.push({
        wo: 'placements',
        art: 'welt',
        text: `Platzierungen mit identischem Inhalt: ${beschreibung(zwilling)} und ${beschreibung(p)}`,
      });
    }
    if (gleiche) gleiche.push(p);
    else nachPrefab.set(p.prefab, [p]);
  }
  return befunde;
}
