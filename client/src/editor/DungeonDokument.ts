/**
 * Dungeon-Dokumente für den Karteneditor laden.
 *
 * Getrennt von `weltdokument.ts`, und das ist kein Ordnungssinn: Das
 * Weltdokument hat einen Entwurf im localStorage, einen Abgleichdialog und
 * einen Speicherweg. Ein Dungeon-Dokument hat nichts davon — es wird hier
 * nur GELESEN.
 *
 * ── Warum nur lesen ──────────────────────────────────────────────────
 * Der Betriebsdienst (Port 2468) ist ein anderer Prozess als der
 * Spielserver. Schriebe er eine Dungeon-Datei, merkte der laufende
 * Spielserver nichts davon — er hält `documents` und `instances` im
 * Arbeitsspeicher, und die nächste Materialisierung käme aus seinem Stand,
 * nicht von der Platte. Geschrieben wird deshalb über den
 * Spielserver-Socket (`DungeonEditSave`), der sanitisiert, persistiert und
 * die Instanz gleich neu aufbaut.
 *
 * Das ist auch der Grund, warum der Karteneditor Dungeons zeigen kann,
 * ohne dass ein Spielserver läuft: Lesen braucht nur den Betriebsdienst.
 */
import type { DungeonDocument } from '@wov/shared';

/** Ein Eintrag der Übersicht — der KOPF eines Dokuments, ohne Layout. */
export interface DungeonKopf {
  id: string;
  name: string;
  base: string;
  mode: 'generated' | 'custom';
  seed: number;
  raeume: number;
  tueren: number;
  deko: number;
}

interface ListenAntwort {
  ok: boolean;
  message?: string;
  fehler?: string;
  instanz?: string;
  dungeons?: DungeonKopf[];
}

interface DokumentAntwort {
  ok: boolean;
  message?: string;
  fehler?: string;
  instanz?: string;
  dungeon?: DungeonDocument;
}

/**
 * Fehler mit der Meldung des Dienstes.
 *
 * Die Endpunkte antworten bei jedem Fehlschlag mit `{ ok, fehler, message }`
 * — dieselbe Form wie `/api/worldlayout`. Wer die Meldung wegwirft und
 * "Laden fehlgeschlagen" anzeigt, nimmt dem Benutzer genau die Auskunft,
 * die der Dienst schon formuliert hat (fehlende Instanz, unbrauchbares
 * Dokument, unbekannte ID).
 */
export class DungeonLadeFehler extends Error {}

async function hole<T extends { ok: boolean; fehler?: string; message?: string }>(
  pfad: string
): Promise<T> {
  let antwort: Response;
  try {
    antwort = await fetch(pfad);
  } catch (err) {
    throw new DungeonLadeFehler(`Betriebsdienst nicht erreichbar (${String(err)})`);
  }
  let daten: T;
  try {
    daten = (await antwort.json()) as T;
  } catch {
    throw new DungeonLadeFehler(`Antwort unlesbar (HTTP ${antwort.status})`);
  }
  if (!antwort.ok || !daten.ok) {
    throw new DungeonLadeFehler(daten.fehler ?? daten.message ?? `HTTP ${antwort.status}`);
  }
  return daten;
}

/** Alle Dungeons der Instanz — nur die Köpfe. */
export async function holeDungeonListe(): Promise<{ instanz: string; dungeons: DungeonKopf[] }> {
  const daten = await hole<ListenAntwort>('/api/dungeons');
  return { instanz: daten.instanz ?? '?', dungeons: daten.dungeons ?? [] };
}

/** Ein einzelnes Dokument, geprüft wie der Spielserver es prüft. */
export async function holeDungeon(id: string): Promise<DungeonDocument> {
  const daten = await hole<DokumentAntwort>(`/api/dungeons/${encodeURIComponent(id)}`);
  if (!daten.dungeon) throw new DungeonLadeFehler('Antwort ohne Dokument');
  return daten.dungeon;
}
