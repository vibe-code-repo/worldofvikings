/**
 * Quittung des Spielservers für das Weltdokument (Editor E2, Karte K5.0).
 *
 * Der Betriebsdienst schreibt die Weltdatei; der laufende Spielserver sieht sie
 * im 1-Sekunden-Takt, wendet den Objektteil an und legt hier ab, was daraus
 * wurde. Der Betriebsdienst wartet nach dem Schreiben kurz auf eine Quittung mit
 * dem Hash SEINER Bytes und antwortet danach 200 (angewendet) oder 202
 * (geschrieben, nicht angewendet, mit Grund).
 *
 * Die Datei liegt neben den Spielständen (`<worlds>/layout-quittung.<instanz>.json`)
 * und wird atomar ersetzt (Temp-Datei + rename): Wer liest, sieht immer eine
 * ganze Quittung. Der Spielserver schreibt nur diese Datei, nie das Weltdokument.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Grund einer nicht angewendeten Änderung. `server-aus` kommt nie vom Server, sondern vom Betriebsdienst. */
export type QuittungsGrund = 'geo' | 'abgelehnt' | 'boot' | null;

export interface Quittung {
  /** SHA-256 über die BYTES der Weltdatei, wie `layoutHash`. */
  hash: string;
  ergebnis: 'angewendet' | 'nicht-angewendet';
  /** Bei `nicht-angewendet`: `geo` oder `abgelehnt`; `boot` heißt: beim Start geladen. */
  grund: QuittungsGrund;
  /** Ausführlicher Text zum Grund (welche Geo-Teile, welche Schutzrückgabe). */
  detail?: string;
  /** Zähler des Abgleichs (`gespawnt`, `aktualisiert`, `unveraendert`, `entfernt`, …), sonst null. */
  zaehler: Record<string, number> | null;
  /** ISO-Zeitstempel. */
  zeit: string;
}

export function quittungsDatei(weltenOrdner: string, instanz: string): string {
  return resolve(weltenOrdner, `layout-quittung.${instanz}.json`);
}

/** Atomar schreiben. */
export function quittungSchreiben(pfad: string, q: Quittung): void {
  const temp = `${pfad}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(q));
    renameSync(temp, pfad);
  } catch (fehler) {
    rmSync(temp, { force: true });
    throw fehler;
  }
}

/** Lesen; fehlt die Datei oder ist sie kein gültiges Objekt mit Hash, kommt null. */
export function quittungLesen(pfad: string): Quittung | null {
  try {
    const q = JSON.parse(readFileSync(pfad, 'utf-8')) as Partial<Quittung> | null;
    if (!q || typeof q.hash !== 'string') return null;
    if (q.ergebnis !== 'angewendet' && q.ergebnis !== 'nicht-angewendet') return null;
    return q as Quittung;
  } catch {
    return null;
  }
}
