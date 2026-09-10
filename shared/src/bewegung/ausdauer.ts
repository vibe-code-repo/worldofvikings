/**
 * Die EINE Ausdauerregel — dieselbe Rechnung fuer Client und Server.
 * The ONE stamina rule — the same maths for client and server.
 *
 * Warum diese Datei entsteht: Bis hierher kannte NUR der Server Ausdauer
 * (`WovServer.handlePlayerInput`). Er koppelt das Rennen an sie und faellt
 * nach rund zehn Sekunden Sprint auf Gehtempo zurueck; der Client kannte
 * die Regel nicht und rannte weiter (`running` = Shift gedrueckt). Nach
 * zwanzig Sekunden Sprint stand der Client 190 m weit, der Server 122 m —
 * und der weiche Abgleich in `main.ts` zog die Figur die ganze Zeit
 * zurueck. Fuer Mike sah das aus wie Lag, war aber eine zweite Wahrheit:
 * zwei Seiten, die verschiedene Tempi rechnen.
 *
 * Rein: kein Babylon, kein `node:`, KEINE Uhr, kein Zufall, kein
 * Modulzustand. Die Zeit kommt als Argument herein (`jetzt`, ms), damit
 * ein Test sie stellen kann und beide Seiten mit derselben Rechnung auf
 * dieselben Zahlen kommen. Erlaubt sind `+ - * /` sowie `Math.min` und
 * `Math.max`; Wurzeln, `Math.pow` und Trigonometrie kommen hier nicht vor
 * (s. Kopf von `schritt.ts` zur Begruendung).
 * Pure module: no clock, no state — time is passed in.
 *
 * WAS DIE REGEL NICHT KANN, und das absichtlich:
 *  - Sie kennt kein FLIEGEN. Der Admin-Flug ist ein Serverzustand
 *    (`peer.flying`), und dort gilt gar keine Ausdauer — der Aufrufer
 *    entscheidet, ob er die Regel ueberhaupt rechnet.
 *  - Sie kennt keine EINZELKOSTEN (Schlag, Parade). Die stehen bei ihren
 *    Aufrufern und kommen als Parameter in `ausdauerAbzug` herein: Was
 *    ein Schlag kostet, ist eine Kampfzahl und keine Bewegungszahl.
 */

/**
 * Die Zahlen der Regel, an EINER Stelle.
 *
 * Die Werte sind die des Bestands aus `WovServer.handlePlayerInput` —
 * dieser Umbau raeumt die zweite Rechnung weg, nicht das Spielgefuehl.
 * Als Objekt und nicht als vier lose Konstanten, damit ein Test (und
 * spaeter vielleicht ein Ausruestungs-Bonus) eine abweichende Regel
 * durchreichen kann, ohne dass jemand die Zahlen ein zweites Mal
 * hinschreibt.
 */
export interface AusdauerRegel {
  /** Obergrenze und Startwert. Full bar. */
  readonly max: number;
  /** Verbrauch beim Rennen in Punkten je Sekunde. Drain per second. */
  readonly rennKostenProSek: number;
  /** Nachfuellen in Punkten je Sekunde. Regeneration per second. */
  readonly regenProSek: number;
  /** Ruhe vor dem Nachfuellen, in Millisekunden. Idle delay before regen. */
  readonly regenPauseMs: number;
}

/** Der Bestand: 100, −10/s beim Rennen, +14/s nach 1,5 s Pause. */
export const AUSDAUER_REGEL: AusdauerRegel = {
  max: 100,
  rennKostenProSek: 10,
  regenProSek: 14,
  regenPauseMs: 1500,
};

/**
 * Was eine Seite sich merken muss — mehr ist es nicht.
 *
 * `zuletztVerbraucht` ist eine Wanduhr-Marke in Millisekunden und wird
 * NICHT uebertragen: Client und Server setzen sie beide selbst, wenn sie
 * gerannt sind, und liegen damit hoechstens einen Takt auseinander.
 */
export interface AusdauerStand {
  /** Aktueller Wert, 0..max. Current value. */
  readonly wert: number;
  /** Wanduhr-Marke des letzten Verbrauchs in ms. Last drain timestamp. */
  readonly zuletztVerbraucht: number;
}

/** Die Absicht dieses Takts. The intent of this tick. */
export interface AusdauerEingabe {
  /** Rennen gewuenscht (Shift bzw. das `running`-Bit im Eingabepaket). */
  readonly rennWunsch: boolean;
  /** Liegt ueberhaupt ein Bewegungswunsch an? Stehen kostet nichts. */
  readonly bewegt: boolean;
  /** Vergangene Zeit dieses Takts in Sekunden. */
  readonly dt: number;
  /** Wanduhr in Millisekunden — hereingereicht, nicht selbst geholt. */
  readonly jetzt: number;
}

/** Neuer Stand plus die Antwort, auf die es ankommt: rennt sie wirklich? */
export interface AusdauerErgebnis extends AusdauerStand {
  /**
   * Wird tatsaechlich gerannt — also Lauftempo statt Gehtempo?
   *
   * Das ist der Wert, an dem die beiden Seiten frueher auseinanderliefen:
   * Der Server hat ihn seit jeher gerechnet, der Client gar nicht.
   */
  readonly rennt: boolean;
}

/**
 * Ein Takt der Regel. One tick of the rule.
 *
 * Reihenfolge und Rundung sind absichtlich Zeichen fuer Zeichen die des
 * Bestands (`Math.max(0, …)`, `Math.min(max, …)`, `>` statt `>=` bei der
 * Pause): Der Server soll nach dem Umbau BITGLEICH dieselben Zahlen
 * liefern wie vorher — sonst ist nicht mehr zu unterscheiden, ob eine
 * spaetere Abweichung vom Umbau kommt oder von der Sache.
 *
 * Gerannt wird nur mit Bewegungswunsch UND Restausdauer. Genau daraus
 * entsteht das Saegezahnmuster, das ein langer Sprint zeigt: leer laufen,
 * 1,5 s Gehen, ein Haeppchen Ausdauer, wieder los. Das ist Bestand und
 * keine Erfindung dieser Datei.
 */
export function ausdauerSchritt(
  stand: AusdauerStand,
  eingabe: AusdauerEingabe,
  regel: AusdauerRegel = AUSDAUER_REGEL
): AusdauerErgebnis {
  const rennt = eingabe.rennWunsch && eingabe.bewegt && stand.wert > 0;
  if (rennt) {
    return {
      wert: Math.max(0, stand.wert - regel.rennKostenProSek * eingabe.dt),
      zuletztVerbraucht: eingabe.jetzt,
      rennt: true,
    };
  }
  if (eingabe.jetzt - stand.zuletztVerbraucht > regel.regenPauseMs && stand.wert < regel.max) {
    return {
      wert: Math.min(regel.max, stand.wert + regel.regenProSek * eingabe.dt),
      zuletztVerbraucht: stand.zuletztVerbraucht,
      rennt: false,
    };
  }
  return { wert: stand.wert, zuletztVerbraucht: stand.zuletztVerbraucht, rennt: false };
}

/**
 * Einmaliger Abzug — Schlag, Parade, was auch immer noch kommt.
 *
 * `kosten` ist ein PARAMETER und keine Zahl in dieser Datei: Was ein
 * Schlag kostet, gehoert zum Kampf und nicht zur Bewegung. Reicht die
 * Ausdauer nicht, kommt `null` zurueck — der Aufrufer bricht dann ab, so
 * wie er es vorher mit seinem eigenen `if` getan hat.
 *
 * Die Uhr-Marke wird mitgesetzt: Nach einem Schlag laeuft dieselbe
 * Ruhefrist wie nach dem Rennen, sonst fuellt sich der Balken waehrend
 * einer Schlagfolge nach.
 */
export function ausdauerAbzug(
  stand: AusdauerStand,
  kosten: number,
  jetzt: number
): AusdauerStand | null {
  if (stand.wert < kosten) return null;
  return { wert: stand.wert - kosten, zuletztVerbraucht: jetzt };
}
