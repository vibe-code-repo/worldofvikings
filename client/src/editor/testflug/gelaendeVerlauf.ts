/**
 * Undo / redo of terrain strokes in the test flight: ONE step per stroke.
 * DOM-free; `GelaendeSteuerung` owns one and feeds it.
 *
 * Rückgängig/Wiederholen der Gelände-Striche im Testflug, ein Schritt je Strich.
 *
 * ── Why an own stack (and not a shared one with the objects) ────────
 * The flight has no user-facing undo for objects: `TestflugPersistenz.vorgang` inverts a Vorgang only to
 * take back a REFUSED write (`zurueckgenommen`), nothing binds it to a key, and terrain strokes are not
 * ops at all (`heightDeltas` is no collection of `ops.ts`, card T2). A shared stack would have to
 * invent object undo for the flight; it would also make Ctrl+Z take back a placement when the
 * user looks at the terrain tab. So Ctrl+Z/Y act on terrain strokes only, while the terrain tab is open.
 * What an object does on the ground moves with the stroke anyway: loose objects are put on the new
 * ground after every step (`GelaendeSteuerung`, `gelaendeLose.ts`), so one step takes back both.
 */
import { invertiere, type GelaendeVorgang } from './gelaendePinsel';

/** Steps kept; the oldest falls off. */
export const VERLAUF_MAX = 100;

export class GelaendeVerlauf {
  private readonly zurueck: GelaendeVorgang[] = [];
  private readonly vor: GelaendeVorgang[] = [];

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
  neu(v: GelaendeVorgang): void {
    this.zurueck.push(v);
    if (this.zurueck.length > VERLAUF_MAX) this.zurueck.shift();
    this.vor.length = 0;
  }

  /**
   * Takes back the last stroke: `anwenden` gets the INVERSE and says whether it was applied; only then
   * the step moves to the redo line. Exactly one stroke per call.
   */
  rueckgaengig(anwenden: (v: GelaendeVorgang) => boolean): GelaendeVorgang | null {
    const v = this.zurueck[this.zurueck.length - 1];
    if (!v || !anwenden(invertiere(v))) return null;
    this.zurueck.pop();
    this.vor.push(v);
    return v;
  }

  /** Puts the last taken-back stroke in again (the ORIGINAL Vorgang, so the layer is bit-equal to before the undo). */
  wiederholen(anwenden: (v: GelaendeVorgang) => boolean): GelaendeVorgang | null {
    const v = this.vor[this.vor.length - 1];
    if (!v || !anwenden(v)) return null;
    this.vor.pop();
    this.zurueck.push(v);
    return v;
  }

  /** The draft was changed from outside: what the steps refer to is gone. */
  leeren(): void {
    this.zurueck.length = 0;
    this.vor.length = 0;
  }
}
