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
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BestaetigenAnfrage {
  /** Hash genau des Standes, dessen Massenlöschung zurückgehalten wurde (wie in der Quittung). */
  hash: string;
  zeit: string;
}

export function bestaetigenAnfrageDatei(weltenOrdner: string, instanz: string): string {
  return resolve(weltenOrdner, `layout-bestaetigen.${instanz}.json`);
}

/** Atomar schreiben (Temp-Datei + rename), wie die Quittung. */
export function bestaetigenAnfrageSchreiben(pfad: string, hash: string): void {
  const temp = `${pfad}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify({ hash, zeit: new Date().toISOString() }));
    renameSync(temp, pfad);
  } catch (fehler) {
    rmSync(temp, { force: true });
    throw fehler;
  }
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
