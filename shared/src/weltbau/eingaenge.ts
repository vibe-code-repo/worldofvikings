/**
 * eingaenge.ts — wo die Tür eines Hausmodells liegt.
 *
 * Im Repo gibt es dazu KEINE Daten (Katalog und Prefab-Definitionen kennen
 * weder Türen noch Eingänge); die Tabelle ist deshalb leer und wird gefüllt,
 * sobald es ganze Hausmodelle gibt. Ohne Eintrag nimmt die Prüfung „Haus ohne
 * erreichbaren Eingang“ die vier Seitenmitten, je 1 m vor der Grundfläche,
 * und meldet höchstens gelb („Eingang geschätzt“).
 *
 * Where a house model's door is. Empty until whole house models exist; the
 * check then falls back to the four side midpoints.
 */

/** Ein Eingangspunkt: Punkt VOR der Tür, lokal im (bereits gespiegelten) Weltraum des Prefabs, unskaliert. */
export interface Eingang {
  x: number;
  z: number;
}

export type EingangsTabelle = ReadonlyMap<string, readonly Eingang[]>;

export const EINGAENGE: EingangsTabelle = new Map<string, readonly Eingang[]>();
