/**
 * Die Ausrüstungsslots — EINE Liste für Fenster, Gegenstände und Server.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum Slots und nicht „angezogen ja/nein"
 * ════════════════════════════════════════════════════════════════════
 * Ein Slot trägt höchstens einen Gegenstand, und jeder Gegenstand kennt
 * seinen Slot. Damit ergibt sich von selbst, was zusammen tragbar ist:
 * Hose und Hemd ja, zwei Hosen nein. Ohne Slots müsste jede Kombination
 * von Hand ausgeschlossen werden — und die Liste der Ausnahmen wüchse mit
 * jedem neuen Kleidungsstück.
 *
 * ════════════════════════════════════════════════════════════════════
 *  Warum hier auch das Aussehen der Fensteranordnung steht
 * ════════════════════════════════════════════════════════════════════
 * `seite` und die Reihenfolge gehören zur Bedeutung des Slots, nicht zur
 * Bildschirmgestaltung: Kopf gehört nach oben, Schuhe nach unten, weil
 * die Figur so gebaut ist. Stünde die Anordnung im Fenster, müsste man
 * sie beim nächsten Fenster erneut erfinden.
 */

/** Kennung eines Slots. Steht später im Spielstand — nicht ändern. */
export type AusruestungsSlot =
  | 'kopf'
  | 'halskette'
  | 'hemd'
  | 'hose'
  | 'schuhe'
  | 'armreif'
  | 'ring1'
  | 'ring2'
  | 'waffe';

export interface SlotDef {
  readonly id: AusruestungsSlot;
  readonly name: string;
  /** Spalte im Charakterfenster — die Figur steht dazwischen. */
  readonly seite: 'links' | 'rechts' | 'unten';
  /**
   * Verbindung zum sichtbaren Rüstungsteil (shared/aussehen.ts). Nur
   * Slots mit `teilSlot` verändern das Aussehen der Figur; ein Ring
   * bleibt vorerst reine Buchführung, weil es dafür kein Modell gibt.
   */
  readonly teilSlot?: 'oberkoerper' | 'beine';
}

/**
 * Reihenfolge = Reihenfolge im Fenster, von oben nach unten.
 *
 * Kopf, Halskette, Hemd links; Armreif und die beiden Ringe rechts —
 * die übliche Anordnung, bei der die getragene Kleidung links und der
 * Schmuck rechts steht. Die Waffe sitzt unter der Figur, weil sie als
 * einzige über die Hotbar gewechselt wird und damit einen anderen
 * Charakter hat als der Rest.
 *
 * ⚠ Für Kopf, Schuhe, Halskette, Armreif und die Ringe gibt es HEUTE
 * KEINE Gegenstände. Die Slots stehen trotzdem da: Ein Fenster, das erst
 * wächst, wenn Inhalte kommen, verschiebt bei jedem neuen Teil die
 * gesamte Anordnung — und man sähe nicht, was das Spiel vorsieht.
 */
export const AUSRUESTUNG_SLOTS: readonly SlotDef[] = [
  { id: 'kopf', name: 'Kopf', seite: 'links' },
  { id: 'halskette', name: 'Halskette', seite: 'links' },
  { id: 'hemd', name: 'Hemd', seite: 'links', teilSlot: 'oberkoerper' },
  { id: 'hose', name: 'Hose', seite: 'links', teilSlot: 'beine' },
  { id: 'schuhe', name: 'Schuhe', seite: 'links' },
  { id: 'armreif', name: 'Armreif', seite: 'rechts' },
  { id: 'ring1', name: 'Ring', seite: 'rechts' },
  { id: 'ring2', name: 'Ring', seite: 'rechts' },
  { id: 'waffe', name: 'Waffe', seite: 'unten' },
] as const;

const NACH_ID = new Map(AUSRUESTUNG_SLOTS.map((s) => [s.id, s]));

export function slotDef(id: string | null | undefined): SlotDef | null {
  return (id && NACH_ID.get(id as AusruestungsSlot)) || null;
}

export function istAusruestungsSlot(id: unknown): boolean {
  return typeof id === 'string' && NACH_ID.has(id as AusruestungsSlot);
}

/**
 * In welchen Slot gehört ein Gegenstand?
 *
 * Ohne Angabe in die HAND. Das ist kein Notbehelf, sondern die Regel für
 * alles, was bisher existiert: Hammer, Axt, Hacke, Spitzhacke und Keule
 * tragen kein `ausruestung`-Feld und sollen sich verhalten wie immer.
 * Eine Umstellung, bei der jeder vorhandene Gegenstand ein neues Feld
 * braucht, hätte genau eines gebracht: vergessene Einträge.
 */
export const SLOT_VORGABE: AusruestungsSlot = 'waffe';
