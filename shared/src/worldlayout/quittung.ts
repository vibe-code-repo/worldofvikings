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
export type QuittungsGrund = 'geo' | 'abgelehnt' | 'bestaetigung-noetig' | 'verworfen' | 'zu-viele-aenderungen' | 'boot' | null;

export interface Quittung {
  /** SHA-256 über die BYTES der Weltdatei, wie `layoutHash`. */
  hash: string;
  ergebnis: 'angewendet' | 'nicht-angewendet';
  /**
   * Bei `nicht-angewendet`: `geo`, `abgelehnt` oder `bestaetigung-noetig` (der Abgleich hätte viele Objekte oder
   * Objekte mit Zustand entfernt; `detail` nennt die ids), `verworfen` (der Sanitizer hat Einträge gestrichen, live
   * geschieht dann nichts; `detail` nennt sie) oder `zu-viele-aenderungen` (mehr als die Obergrenze an neuen,
   * geänderten oder entfernten Einträgen in einem Schreibvorgang; `detail` nennt die Zahl); `boot` heißt: beim Start geladen.
   */
  grund: QuittungsGrund;
  /** Ausführlicher Text zum Grund (welche Geo-Teile, welche Schutzrückgabe). */
  detail?: string;
  /**
   * Karte Z3 N1: gesetzt, wenn DIESER Schreibvorgang die dauerhafte Löschsperre erweitert hat (unabhängig
   * vom obigen `grund`, der `zu-viele-aenderungen` oder `geo` bleiben kann) — `anzahl` und `hash` der
   * gerade erweiterten Sperrdatei, für Editor und MCP.
   */
  loeschsperre?: { anzahl: number; hash: string };
  /**
   * Zähler des Abgleichs (`gespawnt`, `aktualisiert`, `unveraendert`, `entfernt`, …), sonst null. Live kommt
   * `zurueck` dazu: Einträge, die ein Grabstein verschluckt hat (gleiche id, gleicher Inhalt wie ein gelöschter,
   * gefällter Eintrag; nichts gespawnt). Bei `zurueck > 0` nennt `detail` die ids, auch bei `angewendet`.
   */
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

/** Entfernen (Start des Spielservers: eine Quittung des vorigen Laufs darf nie zu einem 200 führen). */
export function quittungLoeschen(pfad: string): void {
  rmSync(pfad, { force: true });
}

/**
 * Wie `quittungLoeschen`, aber ein Fehler (Ordner nicht beschreibbar, EACCES, EROFS, ein Ordner statt der Datei)
 * geht ins Log und stoppt den Aufrufer nicht. Liefert, ob die Datei weg ist.
 */
export function quittungLoeschenSicher(pfad: string, protokoll: (text: string) => void = console.error): boolean {
  try {
    quittungLoeschen(pfad);
    return true;
  } catch (fehler) {
    protokoll(`Quittung nicht gelöscht (${pfad}): ${(fehler as Error).message}`);
    return false;
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
