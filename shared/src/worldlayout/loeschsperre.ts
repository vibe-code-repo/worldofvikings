/**
 * Dauerhafte Löschsperre (Editor E2, Karte Z3 N1): welche Layout-`id`s eine zurückgehaltene
 * Massenlöschung schützt. Anders als die Quittung (`quittung.ts`, ephemer — jeder Start verwirft sie)
 * lebt diese Datei unabhängig vom Prozess: Ein Absturz, ein SIGKILL im Boot-Fenster oder eine
 * harmlose Folgeänderung an ANDEREN Objekten dürfen sie nicht berühren. Entfernt (bzw. verkleinert)
 * wird sie ausschließlich durch:
 *  - eine ausdrückliche Bestätigung (`POST /api/welt/bestaetigen`, `layoutBootSchutz.ts`),
 *  - Rücknahme je `id` (die id steht wieder im Dokument — dann fällt GENAU sie aus der Sperre), oder
 *  - „Welt zurücksetzen" (K4.0), das ein komplett neues Dokument schreibt.
 * `main.ts` und der Konstruktor von `LayoutWache` lesen und löschen sie NIE — beide Boot- und
 * Live-Weg fragen sie bei jedem Abgleich frisch ab (`layoutBootSchutz.ts`, `sperreAbgleichen`).
 *
 * Ist die Datei da, aber nicht als gültiges Objekt lesbar (kaputtes JSON, falsche Form), gilt sie als
 * GESCHLOSSEN, nicht als „keine Sperre": Der Aufrufer bekommt `'kaputt'` zurück und muss dann JEDES
 * Löschen verweigern, bis die Datei von Hand geprüft ist — ein unlesbarer Schutz ist ein Schutz, kein
 * Freibrief.
 */
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Welche Regel die Sperre ausgelöst hat (wie in `layoutLiveAbgleich.ts`: „alle“, „mehr als X/Y %“ oder „Zustand“). */
export type LoeschsperreGrund = 'alle' | 'anteil' | 'zustand';

export interface Loeschsperre {
  /** Layout-`id`s, deren Löschung zurückgehalten wird. */
  ids: string[];
  /** Hash (wie `layoutHash`) des Stands, der die Sperre zuletzt erweitert hat. Nur zur Anzeige/Quittung. */
  hash: string;
  grund: LoeschsperreGrund;
  /** ISO-Zeitstempel des letzten Schreibens. */
  zeit: string;
}

export function loeschsperreDatei(weltenOrdner: string, instanz: string): string {
  return resolve(weltenOrdner, `layout-loeschsperre.${instanz}.json`);
}

/** Atomar schreiben (Temp-Datei + rename), wie die Quittung. */
export function loeschsperreSchreiben(pfad: string, sperre: Loeschsperre): void {
  const temp = `${pfad}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(sperre));
    renameSync(temp, pfad);
  } catch (fehler) {
    rmSync(temp, { force: true });
    throw fehler;
  }
}

export function loeschsperreEntfernen(pfad: string): void {
  rmSync(pfad, { force: true });
}

/**
 * Lesen. Drei Ausgänge: eine gültige Sperre; `'kaputt'` (die Datei ist da, aber nicht lesbar oder ihr Inhalt
 * ist kein gültiges Objekt der erwarteten Form — gilt als GESCHLOSSEN, s. Kopfkommentar); `null` (die Datei
 * fehlt, und NUR das: ENOENT — keine Sperre). Jeder andere Lesefehler (EACCES, EIO, EISDIR, …) schließt.
 */
export function loeschsperreLesen(pfad: string): Loeschsperre | 'kaputt' | null {
  let text: string;
  try {
    text = readFileSync(pfad, 'utf-8');
  } catch (fehler) {
    return (fehler as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'kaputt';
  }
  try {
    const s = JSON.parse(text) as Partial<Loeschsperre> | null;
    const gueltig =
      !!s &&
      Array.isArray(s.ids) &&
      s.ids.every((id) => typeof id === 'string') &&
      typeof s.hash === 'string' &&
      (s.grund === 'alle' || s.grund === 'anteil' || s.grund === 'zustand') &&
      typeof s.zeit === 'string';
    return gueltig ? (s as Loeschsperre) : 'kaputt';
  } catch {
    return 'kaputt';
  }
}
