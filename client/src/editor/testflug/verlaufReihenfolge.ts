/**
 * One order over the two undo stacks of the terrain tab (ground strokes and vegetation strokes). DOM-free.
 *
 * Eine gemeinsame Reihenfolge über die beiden Verläufe des Gelände-Reiters.
 *
 * Ctrl+Z takes back the stroke that was made LAST, whichever tool made it and whichever tool is chosen now; Ctrl+Y
 * follows the same order. The two histories stay separate (each owns what it undoes); this class only remembers which
 * of them made the n-th stroke. A tag whose history has nothing left (a foreign change emptied it) is skipped.
 */
export type Werkzeugart = 'gelaende' | 'vegetation';

/**
 * Result of an undo step: 'ok'; 'gesperrt' = refused on purpose (a plinth or building lies on the stroke); 'nicht-moeglich'
 * = not possible right now (an open stroke, nothing to undo, a conflict, no draft). Only 'gesperrt' drops a step.
 */
export type SchrittErgebnis = 'ok' | 'gesperrt' | 'nicht-moeglich';

export interface VerlaufQuelle {
  rueckgaengig(): boolean;
  rueckgaengigMitGrund(): SchrittErgebnis;
  wiederholen(): boolean;
  readonly kannRueckgaengig: boolean;
  readonly kannWiederholen: boolean;
  /** Drops the step that would be undone next from the history (it was refused and would block the older ones). */
  verwirfRueckgaengig(): void;
}

/** Tags kept; the oldest falls off (both histories keep 100 steps each). */
export const REIHENFOLGE_MAX = 200;

export class VerlaufReihenfolge {
  private readonly zurueck: Werkzeugart[] = [];
  private readonly vor: Werkzeugart[] = [];
  private quellen: Record<Werkzeugart, VerlaufQuelle> | null = null;
  private nichts: ((art: 'rueckgaengig' | 'wiederholen') => void) | null = null;
  private verworfen: ((art: Werkzeugart) => void) | null = null;

  /**
   * `nichts` says "nothing to undo / redo" (HUD) when no history has a step left; `verworfen` says that a refused
   * undo step was taken out of the order and its history (the refusal itself was already said by the history).
   */
  verbinde(
    quellen: Record<Werkzeugart, VerlaufQuelle>,
    nichts?: (art: 'rueckgaengig' | 'wiederholen') => void,
    verworfen?: (art: Werkzeugart) => void
  ): void {
    this.quellen = quellen;
    this.nichts = nichts ?? null;
    this.verworfen = verworfen ?? null;
  }

  /** A stroke of this tool is now in its history and in the draft. A new stroke ends the redo line. */
  neu(art: Werkzeugart): void {
    this.zurueck.push(art);
    if (this.zurueck.length > REIHENFOLGE_MAX) this.zurueck.shift();
    this.vor.length = 0;
  }

  get tiefe(): { rueckgaengig: number; wiederholen: number } {
    return { rueckgaengig: this.zurueck.length, wiederholen: this.vor.length };
  }

  rueckgaengig(): boolean {
    return this.schritt('rueckgaengig');
  }

  wiederholen(): boolean {
    return this.schritt('wiederholen');
  }

  private schritt(art: 'rueckgaengig' | 'wiederholen'): boolean {
    const q = this.quellen;
    if (!q) return false;
    const quelle = art === 'rueckgaengig' ? this.zurueck : this.vor;
    const gegen = art === 'rueckgaengig' ? this.vor : this.zurueck;
    const kann = (w: Werkzeugart): boolean => (art === 'rueckgaengig' ? q[w].kannRueckgaengig : q[w].kannWiederholen);
    while (quelle.length > 0) {
      const w = quelle[quelle.length - 1]!;
      if (kann(w)) {
        const ergebnis: SchrittErgebnis = art === 'rueckgaengig' ? q[w].rueckgaengigMitGrund() : q[w].wiederholen() ? 'ok' : 'nicht-moeglich';
        if (ergebnis === 'ok') {
          quelle.pop();
          gegen.push(w);
          return true;
        }
        // The attempt failed (lock, conflict) and said why. This key press ends here: it is NOT passed on to an older
        // stroke of the other tool. A history that emptied itself on the way leaves a stale tag, which goes.
        quelle.pop();
        if (ergebnis === 'gesperrt' && kann(w) && art === 'rueckgaengig') {
          // A refused undo step would block every older step of BOTH tools for good: it leaves the order and its
          // history, the next Ctrl+Z takes the next older stroke. A refused redo blocks no undo and stays.
          q[w].verwirfRueckgaengig();
          this.verworfen?.(w);
        } else if (kann(w)) quelle.push(w);
        return false;
      }
      quelle.pop();
    }
    // Nothing left in the shared order. A history may still hold an old redo step of its own (a new stroke of the other
    // tool ended the line): it is NOT taken, only said.
    this.nichts?.(art);
    return false;
  }
}
