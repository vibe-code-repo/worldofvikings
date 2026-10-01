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

export interface VerlaufQuelle {
  rueckgaengig(): boolean;
  wiederholen(): boolean;
  readonly kannRueckgaengig: boolean;
  readonly kannWiederholen: boolean;
}

/** Tags kept; the oldest falls off (both histories keep 100 steps each). */
export const REIHENFOLGE_MAX = 200;

export class VerlaufReihenfolge {
  private readonly zurueck: Werkzeugart[] = [];
  private readonly vor: Werkzeugart[] = [];
  private quellen: Record<Werkzeugart, VerlaufQuelle> | null = null;
  private nichts: ((art: 'rueckgaengig' | 'wiederholen') => void) | null = null;

  /** `nichts` says "nothing to undo / redo" (HUD) when no history has a step left. */
  verbinde(quellen: Record<Werkzeugart, VerlaufQuelle>, nichts?: (art: 'rueckgaengig' | 'wiederholen') => void): void {
    this.quellen = quellen;
    this.nichts = nichts ?? null;
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
        const ok = art === 'rueckgaengig' ? q[w].rueckgaengig() : q[w].wiederholen();
        if (ok) {
          quelle.pop();
          gegen.push(w);
          return true;
        }
        // Refused (lock, conflict): the step stays and says why; nothing left in that history: the tag is stale.
        if (kann(w)) return false;
      }
      quelle.pop();
    }
    // Nothing left in the shared order. A history may still hold an old redo step of its own (a new stroke of the other
    // tool ended the line): it is NOT taken, only said.
    this.nichts?.(art);
    return false;
  }
}
