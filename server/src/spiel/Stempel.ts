/**
 * F8 N3 — gemeinsamer monotoner Stempel.
 *
 * Spielerzeilen, ZDO-Zeilen und die Spielerstaende im Weltspeicher tragen eine Folgenummer
 * statt der Wanduhr. "Neuer gewinnt" vergleicht nur diese Zahl. Eine Wanduhr, die springt
 * (NTP, wiederhergestellte VM), kann damit weder Verlust noch Verdopplung erzeugen (F8-N2-Angriff B2).
 *
 * Beim Start wird der Zaehler aus dem Hoechsten angehoben, was auf der Platte steht
 * (beide Tabellen, Kopf der Weltdatei, Spielerstaende darin). Alte Staende mit Millisekunden-
 * Stempeln (vor N3) liegen darunter oder darueber; der Zaehler laeuft ab dem Hoechsten weiter.
 */
export class Stempel {
  private letzter: number;

  constructor(start = 0) {
    this.letzter = 0;
    if (start !== 0) this.hebeAuf(start);
  }

  /** Naechste, noch nie vergebene Nummer. */
  naechster(): number {
    return ++this.letzter;
  }

  /** Zuletzt vergebene Nummer (0 = noch keine). */
  aktuell(): number {
    return this.letzter;
  }

  /**
   * Den Zaehler auf mindestens `wert` heben (nie senken). Nur sichere Ganzzahlen >= 0 zaehlen (`Number.isSafeInteger`):
   * ein beschaedigter oder von Hand gesetzter Wert wie 1e300 oder 2^53 wuerde `++` wirkungslos machen (dann trueg jede
   * Zeile denselben Stempel, "neuer gewinnt" waere Gleichstand). Ein solcher Wert wird laut gemeldet und ignoriert;
   * `undefined`/`null` (Feld fehlt, alter Stand) ist kein Fehler.
   */
  hebeAuf(wert: number | undefined | null): void {
    if (wert === undefined || wert === null) return;
    if (typeof wert !== 'number' || !Number.isSafeInteger(wert) || wert < 0) {
      console.error(`[Stempel] unbrauchbarer Startwert ignoriert (erwartet: sichere Ganzzahl >= 0): ${String(wert)}`);
      return;
    }
    if (wert > this.letzter) this.letzter = wert;
  }
}
