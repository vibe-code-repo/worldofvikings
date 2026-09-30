/**
 * Quittung.ts (D2) — the client's side of the server's hit check: the fields appended to `Attack`
 * and the reading of `AttackAck` (one per swing). Pure, no Babylon, no socket.
 *
 * Der Client zeigt Schlag, Ton und Geste sofort (Vorhersage) und korrigiert nach der Quittung: Der Server
 * zaehlt die Kette selbst; verweigert er einen Schlag der Kette oder beginnt sie neu, faengt auch die Figur
 * wieder bei Hieb 1 an. Der Treffer selbst (Blut, Funken, Ton) kommt weiter mit `HitEffect`.
 */

/** Fields an up-to-date client appends to `Attack` (see PacketType.AttackAck). */
export interface SchlagFelder {
  seq: number;
  /** Combo step the figure plays (1..3); 0 = unknown, the server counts alone. */
  schritt: number;
  /** Age of the swing in ms (0: sent in the frame of the click). */
  alterMs: number;
  /** Time from swing start to the weapon tip in ms. */
  spitzeMs: number;
}

/** `AttackAck.ergebnis`, as the server sends it (server/src/spiel/Treffer.ts, SchlagErgebnis). */
export const ERGEBNIS_TREFFER = 0;
export const ERGEBNIS_KOMBO = 2;

export interface Quittung {
  seq: number;
  /** Combo step the server counted, 0 = refused. */
  schritt: number;
  ergebnis: number;
}

export function liesQuittung(r: { readInt32(): number }): Quittung {
  return { seq: r.readInt32(), schritt: r.readInt32(), ergebnis: r.readInt32() };
}

/** Keeps the swings that wait for their acknowledgement and the measured round trips. */
export class SchlagBuch {
  private naechste = 0;
  private readonly offen = new Map<number, { t: number; schritt: number }>();
  /** Round trips (ms) of the last acknowledged swings, newest last. */
  readonly latenzen: number[] = [];
  /** Sequence number of the newest swing sent. */
  letzteSeq = 0;

  /** A swing leaves now: its sequence number. Old entries (an ack that never came) are dropped. */
  neu(jetzt: number, schritt: number): number {
    const seq = ++this.naechste;
    this.letzteSeq = seq;
    this.offen.set(seq, { t: jetzt, schritt });
    for (const alt of this.offen.keys()) {
      if (alt >= seq - 16) break;
      this.offen.delete(alt);
    }
    return seq;
  }

  /**
   * The server answered. Returns the round trip in ms and whether the figure's chain must start
   * again (the server refused the finisher, or counted a lower step than the figure played), only
   * when this is the newest swing: an older answer must not reset a chain that has moved on.
   */
  quittiere(q: Quittung, jetzt: number): { latenzMs: number; kettenNeu: boolean } | null {
    const e = this.offen.get(q.seq);
    if (!e) return null;
    this.offen.delete(q.seq);
    const latenzMs = jetzt - e.t;
    this.latenzen.push(latenzMs);
    if (this.latenzen.length > 32) this.latenzen.shift();
    const abweichend = q.ergebnis === ERGEBNIS_KOMBO || (q.schritt > 0 && e.schritt > q.schritt);
    return { latenzMs, kettenNeu: abweichend && q.seq === this.letzteSeq };
  }
}
