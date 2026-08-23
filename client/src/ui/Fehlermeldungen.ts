/**
 * F16 (Roadmap): Sammelstelle für Fehler, die dem Spieler etwas angehen.
 *
 * DOM-frei mit Absicht — Hud.ts rendert, diese Datei entscheidet nur WAS
 * und WIE LANGE. Der Anlass war ein konkreter, teurer Fall: In der Nacht
 * auf den 20.08.2026 lief eine Krypto-Berechnung im Anmelde-Handshake
 * (GameSocket.ts) in einem `void (async () => {…})()` ohne `catch` — jede
 * Anmeldung schlug fehl, der Browser zeigte NICHTS, der Server lief nach
 * zehn Sekunden in seinen Timeout. Die Suche kostete eine Stunde für einen
 * Fehler, der in der Konsole eine einzige Zeile gewesen wäre.
 *
 * Schweregrad ist bewusst grob (drei Stufen, nicht mehr): der Aufrufer
 * kennt den Kontext (fernes Objekt vs. abgerissene Verbindung), ein
 * automatischer Klassifizierer aus dem Fehlertext würde raten.
 */

/**
 * - `hinweis`: kein Spieleffekt oder rein informativ (z. B. Ersatz-
 *   darstellung aktiv, ein Detail fehlt, das Spiel läuft unverändert weiter).
 * - `warnung`: sichtbarer, aber lokal begrenzter Ausfall (Daten
 *   übersprungen, ein Feature bleibt aus) — der Spieler soll es wissen,
 *   muss aber nicht reagieren.
 * - `schwer`: das Spiel ist grundsätzlich beeinträchtigt (Verbindung,
 *   unerwarteter/unbehandelter Fehler) — genau der Fall, der ohne Meldung
 *   wie "kaputt" aussieht statt wie ein Fehler.
 */
export type Schweregrad = 'hinweis' | 'warnung' | 'schwer';

/** Wie lange ein Eintrag ohne erneutes Auftreten sichtbar bleibt. */
export const FEHLER_TTL_MS = 6000;

/** Deckel gegen Bildschirm-Zuspammen bei mehreren gleichzeitigen Ursachen. */
export const FEHLER_MAX_GLEICHZEITIG = 3;

/** Für die Anzeige bestimmte, DOM-freie Momentaufnahme eines Eintrags. */
export interface FehlerAnzeige {
  readonly text: string;
  readonly schweregrad: Schweregrad;
  /** Wie oft dieselbe Meldung seit ihrem letzten Verschwinden auflief. */
  readonly anzahl: number;
}

interface FehlerEintrag {
  text: string;
  schweregrad: Schweregrad;
  anzahl: number;
  /** Zeitpunkt (ms, Date.now()-Zeitbasis), ab dem der Eintrag verschwindet. */
  ablauf: number;
}

/**
 * Sammelt Fehlermeldungen für die Anzeige: gleiche Meldung (Text +
 * Schweregrad) zählt hoch statt sich zu stapeln ("3×"), die Zahl
 * gleichzeitig sichtbarer Meldungen ist gedeckelt, und jeder Eintrag
 * blendet nach `FEHLER_TTL_MS` ohne erneutes Auftreten von selbst aus.
 *
 * Kennt keine Uhr von sich aus — `melden`/`tick` nehmen `jetzt` als
 * Parameter entgegen (Default `Date.now()`), damit der Test ohne
 * `setTimeout`/Sleeps auskommt und der Aufrufer (Hud.update) die eigene
 * Frame-Zeit durchreichen kann.
 */
export class Fehlersammler {
  private eintraege: FehlerEintrag[] = [];

  /**
   * Meldet einen Fehler. Existiert bereits ein Eintrag mit demselben Text
   * UND Schweregrad, wird nur hochgezählt und die Ablaufzeit verlängert —
   * ein Fehler, der sich pro Bild wiederholt, erzeugt so genau EINE
   * wachsende Meldung statt einer Flut.
   */
  melden(text: string, schweregrad: Schweregrad, jetzt = Date.now()): void {
    const vorhanden = this.eintraege.find((e) => e.text === text && e.schweregrad === schweregrad);
    if (vorhanden) {
      vorhanden.anzahl++;
      vorhanden.ablauf = jetzt + FEHLER_TTL_MS;
      return;
    }
    if (this.eintraege.length >= FEHLER_MAX_GLEICHZEITIG) {
      // Deckel: die am kürzesten verbleibende Meldung räumt das Feld für
      // die neue — nicht die älteste nach Entstehungszeit, sondern die,
      // die ohnehin als nächstes verschwunden wäre.
      let indexKuerzeste = 0;
      for (let i = 1; i < this.eintraege.length; i++) {
        if (this.eintraege[i]!.ablauf < this.eintraege[indexKuerzeste]!.ablauf) indexKuerzeste = i;
      }
      this.eintraege.splice(indexKuerzeste, 1);
    }
    this.eintraege.push({ text, schweregrad, anzahl: 1, ablauf: jetzt + FEHLER_TTL_MS });
  }

  /** Entfernt abgelaufene Einträge. Vom Aufrufer periodisch zu rufen. */
  tick(jetzt = Date.now()): void {
    this.eintraege = this.eintraege.filter((e) => e.ablauf > jetzt);
  }

  /** Aktuell anzuzeigende Einträge, älteste zuerst. */
  aktive(): readonly FehlerAnzeige[] {
    return this.eintraege.map(({ text, schweregrad, anzahl }) => ({ text, schweregrad, anzahl }));
  }
}
