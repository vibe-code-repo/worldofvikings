/**
 * Ausdrückliche Bestätigung "trotzdem anwenden" für eine vom Massenlöschungs-
 * schutz zurückgehaltene Änderung (Editor E2, Karte Z3).
 *
 * Der Betriebsdienst prüft den Hash gegen die aktuelle Weltdatei (409 bei
 * einem veralteten Stand) und schreibt DANN diese kleine Datei neben der
 * Quittung. Die Layout-Wache des Spielservers sieht sie im selben
 * 1-Sekunden-Takt wie die Weltdatei selbst (auch ohne neuen Schreibvorgang
 * der Weltdatei) und verbraucht sie: gelöscht, gleich ob ihr Hash noch zum
 * aktuellen Stand passt oder nicht — eine Anfrage für einen inzwischen
 * überholten Stand soll nicht liegen bleiben und einen SPÄTEREN, andersartigen
 * Stand treffen.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BestaetigenAnfrage {
  /** Hash genau des Standes, dessen Massenlöschung zurückgehalten wurde (wie in der Quittung). */
  hash: string;
  zeit: string;
  /** Karte Z3 N1: eindeutige Kennung dieser Anfrage; die Quittung nennt sie, damit der Betriebsdienst SEINE Anfrage wiedererkennt. */
  id?: string;
}

export function bestaetigenAnfrageDatei(weltenOrdner: string, instanz: string): string {
  return resolve(weltenOrdner, `layout-bestaetigen.${instanz}.json`);
}

/** Atomar schreiben (Temp-Datei + rename), wie die Quittung. Liefert die Kennung der Anfrage. */
export function bestaetigenAnfrageSchreiben(pfad: string, hash: string): string {
  const temp = `${pfad}.${process.pid}.tmp`;
  const id = randomUUID();
  try {
    writeFileSync(temp, JSON.stringify({ hash, zeit: new Date().toISOString(), id }));
    renameSync(temp, pfad);
  } catch (fehler) {
    rmSync(temp, { force: true });
    throw fehler;
  }
  return id;
}

/** Fehlt die Datei oder ist sie kein gültiges Objekt mit Hash, kommt null. */
export function bestaetigenAnfrageLesen(pfad: string): BestaetigenAnfrage | null {
  try {
    const a = JSON.parse(readFileSync(pfad, 'utf-8')) as Partial<BestaetigenAnfrage> | null;
    if (!a || typeof a.hash !== 'string') return null;
    return a as BestaetigenAnfrage;
  } catch {
    return null;
  }
}

export function bestaetigenAnfrageLoeschen(pfad: string): void {
  rmSync(pfad, { force: true });
}

export type AnfrageNehmen =
  | { art: 'keine' }
  | { art: 'ungueltig'; grund: string }
  | { art: 'gueltig'; anfrage: BestaetigenAnfrage };

/**
 * Karte Z3 N1: die Anfrage ATOMAR übernehmen (umbenennen, dann lesen, dann löschen) statt lesen-dann-löschen:
 * Eine Anfrage, die der Betriebsdienst zwischen Lesen und Löschen atomar ersetzt, würde sonst mitgelöscht,
 * ohne je gelesen worden zu sein. Die Anfrage wird in JEDEM Fall verbraucht (auch wenn sie ungültig ist —
 * `ungueltig` trägt den Grund fürs Log).
 */
export function bestaetigenAnfrageNehmen(pfad: string): AnfrageNehmen {
  const eigene = `${pfad}.${process.pid}.nehmen`;
  try {
    renameSync(pfad, eigene);
  } catch (fehler) {
    if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return { art: 'keine' };
    return { art: 'ungueltig', grund: `nicht übernehmbar: ${(fehler as Error).message}` };
  }
  try {
    const a = JSON.parse(readFileSync(eigene, 'utf-8')) as Partial<BestaetigenAnfrage> | null;
    if (!a || typeof a !== 'object' || typeof a.hash !== 'string' || a.hash.length === 0) {
      return { art: 'ungueltig', grund: 'kein Objekt mit Hash (Text)' };
    }
    return { art: 'gueltig', anfrage: a as BestaetigenAnfrage };
  } catch (fehler) {
    return { art: 'ungueltig', grund: `nicht lesbar: ${(fehler as Error).message}` };
  } finally {
    try {
      rmSync(eigene, { recursive: true, force: true });
    } catch {
      /* bleibt liegen; der nächste Lauf überschreibt sie */
    }
  }
}
