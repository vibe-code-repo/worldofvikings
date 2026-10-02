/**
 * Undo / redo of vegetation strokes in the test flight: ONE step per stroke. DOM-free.
 *
 * Rückgängig/Wiederholen der Bewuchs-Striche im Testflug, ein Schritt je Strich.
 *
 * An own stack like `GelaendeVerlauf` (Ctrl+Z/Y act on the terrain tab only, while it is open). A step is the list of
 * circles a stroke laid; undoing it takes exactly these circles out of the draft, redoing puts them back.
 */
import type { VegetationEntferntKreis } from '@wov/shared';

/** Steps kept; the oldest falls off. */
export const VEG_VERLAUF_MAX = 100;

export interface VegetationVorgang {
  readonly kreise: readonly VegetationEntferntKreis[];
}

export class VegetationVerlauf {
  private readonly zurueck: VegetationVorgang[] = [];
  private readonly vor: VegetationVorgang[] = [];

  get kannRueckgaengig(): boolean {
    return this.zurueck.length > 0;
  }
  get kannWiederholen(): boolean {
    return this.vor.length > 0;
  }
  get tiefe(): { rueckgaengig: number; wiederholen: number } {
    return { rueckgaengig: this.zurueck.length, wiederholen: this.vor.length };
  }

  /** A finished stroke that is now in the draft. A new stroke ends the redo line. */
  neu(v: VegetationVorgang): void {
    this.zurueck.push(v);
    if (this.zurueck.length > VEG_VERLAUF_MAX) this.zurueck.shift();
    this.vor.length = 0;
  }

  /** Takes back the last stroke: `anwenden` does it and says whether it worked (`false` = the step stays). */
  rueckgaengig(anwenden: (v: VegetationVorgang) => boolean): VegetationVorgang | null {
    const v = this.zurueck[this.zurueck.length - 1];
    if (!v || !anwenden(v)) return null;
    this.zurueck.pop();
    this.vor.push(v);
    return v;
  }

  /** Puts the last taken-back stroke in again. */
  wiederholen(anwenden: (v: VegetationVorgang) => boolean): VegetationVorgang | null {
    const v = this.vor[this.vor.length - 1];
    if (!v || !anwenden(v)) return null;
    this.vor.pop();
    this.zurueck.push(v);
    return v;
  }

  /** Drops the step that would be undone next (it cannot be undone: refused), so the next older one is next. */
  verwerfeRueckgaengig(): void {
    this.zurueck.pop();
  }

  /** The draft was changed from outside: what the steps refer to may be gone. */
  leeren(): void {
    this.zurueck.length = 0;
    this.vor.length = 0;
  }
}
