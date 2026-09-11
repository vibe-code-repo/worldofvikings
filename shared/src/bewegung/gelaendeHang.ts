/**
 * Die Steigungsgrenze am GELAENDE — dieselbe Zahl, die an Formen gilt.
 * The slope limit on the TERRAIN — the same number that applies to shapes.
 *
 * WARUM ES DIESE DATEI GIBT. `istWand()` in `masse.ts` entscheidet ueber
 * eine NORMALE, und eine Normale hat nur, was ein Strahl getroffen hat:
 * Felsnetze, Gebaeude, Dungeonwaende. Das Gelaende liefert keinen Treffer,
 * sondern eine HOEHENFUNKTION — der Server fragt `hoeheBei`, der Client
 * die Heightmap. Bis zum 11.09.2026 hatte die Grenze dort deshalb gar
 * keinen Angriffspunkt: Eine mit dem Planier-Werkzeug aufgeschuettete
 * 76-Grad-Wand (Mikes Wand bei −16736/−5218) lief man serverseitig
 * hinauf, als waere sie eine Rampe, weil die Bodenabfrage die Figur nach
 * jedem Schritt einfach auf die neue Hoehe hob.
 *
 * DIE REGEL, und sie ist die des Vorbilds (Opsive `SlopeLimit`, Vault:
 * „Original-Bewegung und Kollision — aus den Spieldaten"): Ist die
 * Bodenflaeche vor der Figur steiler als die Grenze, faellt der Anteil
 * der Bewegung weg, der IN sie hineinfuehrt. Quer dazu bleibt die Figur
 * frei — genau wie an einer Wand, und mit demselben Quelltext
 * (`gleiten.ts`). Bergab wird nie gebremst: Wer sich von der Flaeche
 * entfernt, laeuft nicht in sie hinein, und dieselbe Vorzeichenprobe
 * haelt an Waenden wie an Haengen. Es wird auch NICHT gerutscht — das
 * taete im Vorbild die eigene Slide-Faehigkeit, die bildratenabhaengig
 * ist und bewusst nicht uebernommen wurde (s. `STEIGUNGS_GRENZE_GRAD`).
 *
 * WORAN GEMESSEN WIRD: am reinen GELAENDE (`GelaendeAbfrage`), nicht an
 * `BodenAbfrage.hoeheBei`. Das ist keine Sparmassnahme, sondern die
 * richtige Frage — die Oberkante eines Felsens ist eine FORM und hat
 * ihre eigene Normale aus dem Strahlwurf, und der Client hat hier
 * ohnehin nur die Heightmap. Dass es nebenbei billig ist, entschied
 * trotzdem mit: Ueber `hoeheBei` gefuehrt (fuenf Bodenstrahlen je
 * Abfrage gegen jeden Koerper im Nahfeld) kostete ein Eingabepaket bei
 * 200 Formen 0,96–1,10 ms statt 0,40 ms.
 *
 * WIE DIE FLAECHE GEMESSEN WIRD: vier Hoehenabfragen als ZENTRALE
 * DIFFERENZ in den Weltachsen, um die Vorderkante der Kapsel herum. Die
 * Normale kommt damit aus dem Hoehenfeld selbst und haengt NICHT von der
 * Laufrichtung ab — so wie die Normale eines Strahlwurfs auch nicht davon
 * abhaengt, aus welcher Richtung man an die Wand laeuft.
 *
 * Ein frueherer Entwurf mass nur laengs des Weges (zwei Abfragen) und
 * dann laengs plus quer dazu (drei, einseitig). Beides ist gemessen
 * gescheitert, und beide Male an derselben Wand:
 *   — Nur laengs: Wer 65 Grad neben der Falllinie laeuft, sieht laengs
 *     seines Weges 59 Grad und steigt trotzdem acht Meter in der Sekunde.
 *     Zickzack den Fels hinauf.
 *   — Einseitig quer: Eine Wand, die NICHT in einer der beiden
 *     Abtastrichtungen liegt, ergibt einen Gefaellevektor, der laengs des
 *     WEGES zeigt statt senkrecht zur Wand. Dann faellt die ganze
 *     Bewegung weg statt nur ihres Anteils — die Figur klebt an der
 *     Kante, statt an ihr entlangzugehen (gemessen 11.09.2026:
 *     1,6 m in 4 s statt 17 m).
 *
 * Rein: kein Babylon, kein `node:`, keine Uhr, keine Trigonometrie.
 * Erlaubt sind `+ - * /` und `Math.sqrt` — dieselbe Hausordnung wie in
 * `schritt.ts`, aus demselben Grund (Node und Browser muessen Bit fuer Bit
 * dasselbe rechnen).
 */
import type { Vek3 } from '../kollision/form.js';
import type { GelaendeAbfrage } from './abfragen.js';
import { entlangFlaeche, waagerechteFlaeche } from './gleiten.js';
import { istWand, KOERPER_RADIUS } from './masse.js';

/**
 * Wie weit vor der Mitte die Flaeche gemessen wird, in m.
 *
 * Der Koerperradius: genau dort steht die Vorderseite der Kapsel.
 * Gemessen wird also das Stueck Boden, das die Figur als naechstes
 * BERUEHRT — nicht ein Fernziel, das sie nie erreicht.
 */
export const HANG_VORSCHAU = KOERPER_RADIUS;

/**
 * Halbe Breite der zentralen Differenz, in m.
 *
 * Zusammen mit `HANG_VORSCHAU` heisst das: Die weiteste Abfrage liegt
 * 0,8 m vor der Mitte, die Kapsel steht also noch rund 0,4 m VOR der
 * Wand, wenn die Regel greift. Dieser Abstand ist kein Luxus, sondern der
 * Kern der Sache: Beruehrt die Kapsel die fast senkrechte Flaeche erst,
 * verkeilt sie Havoks Character-Controller dort, und dann kommt die Figur
 * auch quer nicht mehr weg (gemessen 11.09.2026 an einer 80-Grad-Kante,
 * mit und ohne diese Regel gleichermassen). Wer 0,4 m davor stehen
 * bleibt, gleitet weiter mit vollem Tempo.
 *
 * Kuerzer als der Stuetzabstand des Hoehenfeldes (1 m je Vertex) zu
 * messen hat keinen Sinn — innerhalb eines Dreiecks ist die Neigung
 * konstant. Eine zentrale Differenz ueber 2·0,4 = 0,8 m liegt knapp
 * darunter und mittelt hoechstens zwei benachbarte Dreiecke.
 *
 * ACHTUNG bei `experimental-bilinear-height-sampling: false`: Dann liefert
 * `getGroundHeight` den NAECHSTEN Stuetzpunkt statt zu interpolieren, das
 * Gelaende ist eine Treppe aus 1-m-Stufen, und die Differenz springt.
 * Die Grenze wirkt dann grober, aber in dieselbe Richtung. Das Labor
 * laeuft mit `true` (server/data/server.yml), und dort ist die
 * Hoehenfunktion stueckweise linear — genau die Voraussetzung, unter der
 * diese Messweite stimmt.
 */
export const HANG_MESSWEITE = KOERPER_RADIUS;

/**
 * Die Normale der Bodenflaeche vor `(x, z)` in Laufrichtung `(ex, ez)`,
 * oder `null`, wenn eine der Abfragen keinen Boden meldet.
 *
 * `(ex, ez)` muss ein waagerechter EINHEITSVEKTOR sein; er legt NUR fest,
 * WO gemessen wird, nicht wie. Die gelieferte Normale ist eine
 * Einheitsnormale wie die eines Strahlwurfs — aus der Flaeche heraus, also
 * mit y > 0. Damit laesst sie sich ohne Sonderfall an `istWand()` und an
 * `gleiten.ts` weiterreichen.
 *
 * KOSTEN: vier Gelaendeabfragen. Billiger geht es nicht ehrlich — drei
 * Abfragen ergeben nur einen einseitigen Gefaellevektor, und der zeigt an
 * einer schraeg liegenden Wand in die falsche Richtung (s. Kopf dieser
 * Datei). Wie OFT sie anfallen, entscheidet der Aufrufer: `hangBremse`
 * steigt bei Stillstand vorher aus, und mit einem `HangSpeicher` faellt
 * die Messung einmal je Eingabepaket an statt einmal je 1/60-Schritt.
 */
export function gelaendeHang(
  gelaende: GelaendeAbfrage,
  x: number,
  z: number,
  ex: number,
  ez: number
): Vek3 | null {
  const bx = x + ex * HANG_VORSCHAU;
  const bz = z + ez * HANG_VORSCHAU;
  const d = HANG_MESSWEITE;

  const xPlus = gelaende.gelaendeHoehe(bx + d, bz);
  const xMinus = gelaende.gelaendeHoehe(bx - d, bz);
  const zPlus = gelaende.gelaendeHoehe(bx, bz + d);
  const zMinus = gelaende.gelaendeHoehe(bx, bz - d);
  if (xPlus === null || xMinus === null || zPlus === null || zMinus === null) return null;

  const gx = (xPlus - xMinus) / (2 * d);
  const gz = (zPlus - zMinus) / (2 * d);
  // Die Normale einer Flaeche mit dem Gefaelle (gx, gz) ist (−gx, 1, −gz),
  // normiert mit sqrt(1 + gx² + gz²). Ihr y ist cos(Neigung) — genau die
  // Groesse, die `istWand` gegen `STEIGUNGS_GRENZE_COS` haelt.
  const laenge = Math.sqrt(1 + gx * gx + gz * gz);
  return { x: -gx / laenge, y: 1 / laenge, z: -gz / laenge };
}

/** Was aus einem Bewegungswunsch wurde, nachdem der Hang ihn gesehen hat. */
export interface HangErgebnis {
  /** Der erlaubte Weg in x/z — unveraendert, wenn nichts zu bremsen war. */
  readonly x: number;
  readonly z: number;
  /** Die Hangflaeche, an der gebremst wurde, oder `null`. */
  readonly flaeche: Vek3 | null;
}

/**
 * Gemerkte Hangflaeche — damit die Messung einmal je EINGABEPAKET
 * anfaellt und nicht einmal je 1/60-Schritt.
 *
 * WARUM DER SPEICHER BEIM AUFRUFER LIEGT und nicht in diesem Modul: Der
 * Bewegungsschritt muss rein bleiben (kein Modulzustand, gleiche
 * Argumente ergeben gleiche Zahlen — s. Kopf von `schritt.ts`). Ein
 * `let` hier drin waere geteilter Zustand zwischen allen Spielern des
 * Servers, und der erste, der ihn bemerkt, waere ein Spieler, der an
 * einer Wand haengt, weil ein anderer gerade an einer stand.
 *
 * WAS ER DARF. Ein Eingabepaket deckt bis zu 30 Schritte ab; die Figur
 * legt dabei hoechstens einen halben Meter zurueck, und die Flaeche
 * darunter aendert sich auf dieser Strecke nicht sprunghaft — ausser an
 * genau der Kante, um die es geht. Deshalb wird der gemerkte Wert nur
 * benutzt, solange die Figur sich WENIGER ALS `HANG_SPEICHER_WEITE`
 * von der Messstelle entfernt hat und in dieselbe Richtung laeuft;
 * darueber wird neu gemessen. An einer Wand heisst das: hoechstens 0,2 m
 * weiter, als ohne Speicher — und die Kapsel steht dann immer noch
 * 0,2 m vor der Flaeche.
 */
export interface HangSpeicher {
  /** Falsch, solange nichts gemessen wurde. */
  gueltig: boolean;
  /** Wo gemessen wurde. */
  x: number;
  z: number;
  /** In welche Richtung gemessen wurde (Einheitsvektor). */
  ex: number;
  ez: number;
  /** Die Flaeche, oder `null` fuer „dort ist keine Wand". */
  flaeche: Vek3 | null;
}

/** Ein leerer Speicher. Einer je Spieler und Eingabepaket genuegt. */
export function neuerHangSpeicher(): HangSpeicher {
  return { gueltig: false, x: 0, z: 0, ex: 0, ez: 0, flaeche: null };
}

/**
 * Wie weit die Figur von der Messstelle weglaufen darf, bevor neu
 * gemessen wird, in m.
 *
 * 0,2 — die Haelfte der Vorschau. Damit liegt die Messstelle immer noch
 * im vorderen Halbraum der Kapsel, und die Regel greift hoechstens
 * 0,2 m spaeter als ohne Speicher.
 */
export const HANG_SPEICHER_WEITE = 0.2;

/**
 * Die Regel selbst: waagerechten Bewegungswunsch gegen den Gelaendehang.
 *
 * `wegX`/`wegZ` ist die VERSCHIEBUNG dieses Schritts (nicht die Richtung);
 * zurueck kommt die erlaubte Verschiebung. Wo nichts zu bremsen ist, kommt
 * der Wunsch BIT FUER BIT unveraendert zurueck — es wird nicht einmal
 * multipliziert —, damit flaches Gelaende die bestehende Bewegung nicht
 * um ein letztes Bit verschiebt.
 *
 * `speicher` ist freiwillig: Ohne ihn wird in jedem Aufruf gemessen (so
 * rechnet der Client, der die Regel ohnehin nur einmal je Bild ruft), mit
 * ihm einmal je Eingabepaket (so rechnet der Server, der je Paket bis zu
 * 30 Schritte faehrt).
 *
 * Nur EINE Umlenkung, keine Schleife wie in `gleitBewegung`: Was quer zum
 * Hang uebrig bleibt, laeuft auf der Hoehenlinie, und dort ist die
 * Steigung in Laufrichtung null. Ein zweiter Durchgang faende also nichts
 * — ausser an einer Kante, wo zwei steile Haenge aufeinandertreffen, und
 * dort ist Anhalten die ehrliche Antwort (dasselbe Argument wie bei der
 * Ecke in `gleiten.ts`).
 */
export function hangBremse(
  gelaende: GelaendeAbfrage,
  x: number,
  z: number,
  wegX: number,
  wegZ: number,
  speicher?: HangSpeicher
): HangErgebnis {
  const laenge = Math.sqrt(wegX * wegX + wegZ * wegZ);
  if (laenge === 0) return { x: wegX, z: wegZ, flaeche: null };
  const ex = wegX / laenge;
  const ez = wegZ / laenge;

  let flaeche: Vek3 | null;
  if (
    speicher !== undefined &&
    speicher.gueltig &&
    speicher.ex === ex &&
    speicher.ez === ez &&
    (x - speicher.x) * (x - speicher.x) + (z - speicher.z) * (z - speicher.z) <
      HANG_SPEICHER_WEITE * HANG_SPEICHER_WEITE
  ) {
    flaeche = speicher.flaeche;
  } else {
    flaeche = gelaendeHang(gelaende, x, z, ex, ez);
    if (speicher !== undefined) {
      speicher.gueltig = true;
      speicher.x = x;
      speicher.z = z;
      speicher.ex = ex;
      speicher.ez = ez;
      speicher.flaeche = flaeche;
    }
  }

  if (flaeche === null || !istWand(flaeche)) return { x: wegX, z: wegZ, flaeche: null };

  // Ab hier wie an einer Wand: den Anteil IN die Flaeche wegnehmen, den
  // Anteil ENTLANG behalten. Derselbe Quelltext, damit „gleiten" an einem
  // Hang und an einer Huettenwand nicht zwei verschiedene Dinge sind.
  const waagerecht = waagerechteFlaeche(flaeche);
  if (waagerecht === null) return { x: wegX, z: wegZ, flaeche: null };
  // Bergab, quer, oder von der Flaeche weg: nichts laeuft in sie hinein,
  // also gibt es nichts wegzunehmen. Das ist die „bergab bleibt frei"-
  // Haelfte der Regel, und es ist dieselbe Vorzeichenprobe, mit der
  // `HindernisAbfrage.ersterTreffer` eine Wand im Ruecken durchlaesst.
  if (wegX * waagerecht.x + wegZ * waagerecht.z >= 0) {
    return { x: wegX, z: wegZ, flaeche: null };
  }
  const entlang = entlangFlaeche(wegX, wegZ, waagerecht);
  if (entlang === null) return { x: 0, z: 0, flaeche };
  return { x: entlang.x, z: entlang.z, flaeche };
}
