/**
 * Warum das Baumenü nicht aufgeht — als Satz statt als Schweigen.
 *
 * ── Der Anlass ───────────────────────────────────────────────────────
 * Mike konnte am 21.08.2026 das Baumenü nicht öffnen. Zwei Dinge kamen
 * zusammen, und beide waren stumm:
 *
 *   1. Er drückte `B`. Im normalen Spiel ist die Taste überhaupt nicht
 *      belegt — der einzige `KeyB`-Handler im Client sitzt im
 *      Editor-Testflug (`?layout=editor`). Das Menü liegt auf `Tab`.
 *   2. Auch `Tab` hätte geschwiegen: `PlacementController.toggleMenu()`
 *      steigt sofort wieder aus, wenn das gehaltene Werkzeug keine
 *      Bauteile führt — `if (this.pieces.length === 0) return true;`.
 *      Das Menü hängt an `equipment.pieceTable`, also am Gegenstand in
 *      der HAND, nicht am Inventar. Der Hammer liegt im Startkit, aber
 *      greifen muss man ihn selbst.
 *
 * Formal ist das kein Fehler, deshalb greift auch der Fehlersammler aus
 * F16 hier nicht. Es ist trotzdem dieselbe Krankheit: Etwas passiert
 * nicht, und niemand sagt warum. Diese Datei macht daraus einen Hinweis.
 *
 * ── Warum eine eigene Datei für einen Satz ───────────────────────────
 * Weil die ENTSCHEIDUNG, welcher Satz richtig ist, vier Fälle hat und
 * damit prüfbar sein soll. Dieselbe Bauart wie `weltzeitAus()`,
 * `befundSchwere()` und der `Fehlersammler`: reine Logik ohne DOM, der
 * Aufrufer zeigt sie an. `main.ts` ist mit über 2.400 Zeilen ohnehin ein
 * Kandidat für G9 — dort noch eine Fallunterscheidung einzuweben wäre
 * der falsche Weg.
 */

/** Was der Spieler gerade zur Verfügung hat. */
export interface BaumenueLage {
  /** Zahl der Bauteile des gehaltenen Werkzeugs (`PlacementController.pieces`). */
  readonly bauteile: number;
  /** Name des Gegenstands in der rechten Hand, `null` wenn leer. */
  readonly gehalten: string | null;
  /** Liegt ein Bauwerkzeug im Inventar, auch wenn es nicht in der Hand ist? */
  readonly werkzeugImInventar: boolean;
  /** Anzeigename des Bauwerkzeugs — für den Satz, nicht für die Logik. */
  readonly werkzeugName?: string;
}

/**
 * Liefert den Hinweis, der dem Spieler weiterhilft — oder `null`, wenn
 * das Menü aufgehen kann und nichts zu sagen ist.
 *
 * Die Sätze nennen ausdrücklich die Ziffern 1–8: Das ist der Weg, ein
 * Werkzeug in die Hand zu nehmen (`equipment.useHotbar`), und wer das
 * Menü nicht aufbekommt, weiß ihn erfahrungsgemäß gerade nicht.
 */
export function baumenueHinweis(lage: BaumenueLage): string | null {
  if (lage.bauteile > 0) return null;

  const werkzeug = lage.werkzeugName ?? 'Hammer';

  if (!lage.werkzeugImInventar) {
    return lage.gehalten
      ? `Mit „${lage.gehalten}" lässt sich nicht bauen — und du hast keinen ${werkzeug} dabei.`
      : `Zum Bauen fehlt dir der ${werkzeug}.`;
  }

  return lage.gehalten
    ? `Mit „${lage.gehalten}" lässt sich nicht bauen — nimm den ${werkzeug} in die Hand (Ziffern 1–8).`
    : `Nimm den ${werkzeug} in die Hand (Ziffern 1–8), dann öffnet Tab das Baumenü.`;
}
