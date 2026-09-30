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
    this.letzter = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  }

  /** Naechste, noch nie vergebene Nummer. */
  naechster(): number {
    return ++this.letzter;
  }

  /** Zuletzt vergebene Nummer (0 = noch keine). */
  aktuell(): number {
    return this.letzter;
  }

  /** Den Zaehler auf mindestens `wert` heben (nie senken). */
  hebeAuf(wert: number | undefined | null): void {
    if (typeof wert === 'number' && Number.isFinite(wert) && wert > this.letzter) this.letzter = Math.floor(wert);
  }
}
