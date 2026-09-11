/**
 * Die zwei Fragen, die der Bewegungsschritt an die Welt stellt — und sonst
 * keine: was UNTER der Figur liegt und was NEBEN ihr steht.
 * The only two questions the movement step asks the world: what is below the
 * body, and what is beside it.
 *
 * Warum als Schnittstelle und nicht als Aufruf am Server: Der Schritt soll
 * auf beiden Seiten dieselbe Zahl liefern. Der Client beantwortet die
 * Fragen mit Havok, der Server mit `Kollisionswelt`, ein Test mit einem
 * Rechteck auf dem Papier — und der Schritt selbst bleibt in allen drei
 * Faellen derselbe Quelltext. Er importiert deshalb weder Babylon noch
 * `node:` noch den ZDO-Speicher, sondern nur diese Datei.
 *
 * Beide Fragen sind ABFRAGEN, keine Loeser: Sie sagen, was da ist, nicht
 * was zu tun ist. Was man mit einer getroffenen Flaeche macht — anhalten,
 * daran entlanggleiten, aufgeben —, ist Spielregel und steht in
 * `gleiten.ts`; so bleibt sie ohne Physik-Unterbau pruefbar.
 */
import type { Vek3 } from '../kollision/form.js';

/** Was ein Strahl getroffen hat. What a ray met. */
export interface Treffer {
  /**
   * Einheitsnormale der Flaeche, aus ihr HERAUS zeigend — so, wie ein
   * Strahlwurf sie meldet. Eine Wand, in die jemand hineinlaeuft, hat
   * also eine Normale, die auf ihn zeigt.
   * Unit normal pointing OUT of the surface.
   */
  readonly normale: Vek3;
  /** Abstand vom Startpunkt der Bewegung zur Flaeche in m. Distance in m. */
  readonly abstand: number;
  /** Trefferpunkt in Weltkoordinaten. Hit point in world space. */
  readonly punkt: Vek3;
}

/**
 * Nur das GELAENDE — ohne Felsen, Bauwerke und Dungeonboeden.
 * The terrain alone, without rocks, buildings and dungeon floors.
 *
 * Getrennt von `BodenAbfrage`, und zwar aus zwei Gruenden, die beide
 * gemessen sind:
 *
 *  1) SIE IST EINE ANDERE FRAGE. Die Steigungsgrenze am Gelaende
 *     (`gelaendeHang.ts`) will wissen, wie das Hoehenfeld GENEIGT ist.
 *     Die Oberkante eines Felsens, auf dem die Figur gerade steht, ist
 *     dafuer kein Gelaende, sondern eine Form — und Formen haben ihre
 *     eigene Normale aus dem Strahlwurf. Der Client hat an dieser Stelle
 *     ohnehin nichts anderes als die Heightmap; damit rechnen beide
 *     Seiten dieselbe Flaeche.
 *
 *  2) SIE IST BILLIG. `Nahfeld.hoeheBei` wirft fuenf Bodenstrahlen gegen
 *     jeden Koerper im Nahfeld. Die Hangregel braucht vier Abfragen je
 *     Schritt; ueber `hoeheBei` gefuehrt kostete das Eingabepaket
 *     dadurch 0,96–1,10 ms statt 0,40 ms (200 Formen, gemessen am
 *     11.09.2026 in `server/test/kollision-schritt.ts` [B3]). Ueber
 *     diese Abfrage ist es ein Heightmap-Zugriff.
 */
export interface GelaendeAbfrage {
  /** Hoehe des Gelaendes an `(x, z)`, oder `null`, wo keines ist. */
  gelaendeHoehe(x: number, z: number): number | null;
}

/** Was unter der Figur liegt. What is below the body. */
export interface BodenAbfrage extends GelaendeAbfrage {
  /**
   * Hoehe des Bodens an `(x, z)`, oder `null`, wo keiner ist.
   *
   * `yFuss` ist die Hoehe, auf der die Figur GERADE steht. Sie wird
   * gebraucht, weil „der Boden" nicht nur das Gelaende ist: Steht die
   * Figur auf einem Felsen, ist die Felsoberkante der Boden, und welcher
   * Felsen gemeint ist, entscheidet sich an der Fusshoehe. Ohne diesen
   * Parameter faende ein Suchstrahl von oben das Dach einer Huette und
   * setzte den Spieler darauf.
   */
  hoeheBei(x: number, z: number, yFuss: number): number | null;
}

/** Was neben der Figur steht. What is beside the body. */
export interface HindernisAbfrage {
  /**
   * Die erste Flaeche, die ein Koerper vom Halbmesser `radius` auf dem
   * geraden Weg von `von` nach `nach` trifft — oder `null`, wenn der Weg
   * frei ist. Beide Punkte liegen an den FUESSEN, dort, wo auch die
   * Position sitzt.
   *
   * Eine Flaeche, auf die sich die Bewegung NICHT zubewegt, steht nicht
   * im Weg. Wer an einer Wand steht und von ihr weggeht, hat freie Bahn,
   * was immer ein Strahl zu melden hat, der in der Wand beginnt. Ohne
   * diese Regel kommt ein in eine Ecke geratener Koerper nicht einmal
   * rueckwaerts wieder heraus.
   */
  ersterTreffer(von: Vek3, nach: Vek3, radius: number): Treffer | null;
}

/** Nichts steht im Weg — das Verhalten vor den Kollisionsformen. */
export const OHNE_HINDERNISSE: HindernisAbfrage = Object.freeze({
  ersterTreffer: (): Treffer | null => null,
});

/** Ebener Boden auf fester Hoehe — der Stellvertreter fuer Tests. */
export function ebenerBoden(hoehe = 0): BodenAbfrage {
  return { hoeheBei: (): number => hoehe, gelaendeHoehe: (): number => hoehe };
}

/** Ein Gelaende aus einer Funktion — der Stellvertreter fuer Tests. */
export function gelaendeAus(f: (x: number, z: number) => number): GelaendeAbfrage {
  return { gelaendeHoehe: f };
}
