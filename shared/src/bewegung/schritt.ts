/**
 * EIN Simulationsschritt der Spielerbewegung — dieselbe Rechnung fuer
 * Client und Server, weil eine zweite Rechnung eine zweite Wahrheit ist.
 * ONE simulation step of player movement — the same maths for client and
 * server, because a second implementation is a second truth.
 *
 * Rein: kein Babylon, kein `node:`, keine Uhr, kein Zufall, kein
 * Modulzustand. Dieselben Argumente ergeben auf jeder Maschine dieselben
 * Zahlen. Erlaubt sind `+ - * /` und `Math.sqrt`; `Math.hypot`, `Math.pow`
 * und `Math.atan2` sind es NICHT — sie liefern in Node und im Browser
 * nicht garantiert dasselbe letzte Bit, und genau daran zerfaellt eine
 * Vorhersage, die auf beiden Seiten gleich ausgehen soll.
 *
 * WAS DER SCHRITT NICHT KANN, und das absichtlich:
 *  - SPRINGEN. Der Server fuehrt bis heute keinen Sprungzustand (das Feld
 *    `jumping` im Eingabepaket wird gelesen und verworfen). Ein springender
 *    Spieler kommt deshalb ueber Hindernisse, die dieser Schritt noch fuer
 *    im Weg haelt; die Abweichung ist kurz und bleibt unter dem weichen
 *    Abgleich. Wer das aendert, braucht zuerst den Zustand im Protokoll.
 *  - BESCHLEUNIGUNG. Der Bestand setzt das Tempo hart (kein Anlaufen,
 *    kein Ausrollen), und daran aendert dieser Umbau nichts: Er raeumt die
 *    Drift an Hindernissen auf, nicht das Fahrgefuehl.
 */
import type { Vek3 } from '../kollision/form.js';
import type { BodenAbfrage, HindernisAbfrage } from './abfragen.js';
import { gleitBewegung } from './gleiten.js';
import { BODEN_KLEBEN, FALL_TEMPO, GEH_TEMPO, KOERPER_RADIUS, LAUF_TEMPO } from './masse.js';

/** Wo die Figur steht — an den Fuessen. Where the body is, at its feet. */
export interface BewegungsZustand {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Die Absicht dieses Schritts. The intent of this step. */
export interface BewegungsEingabe {
  /** Waagerechte Absicht, je Achse auf −1..+1 geklemmt. */
  readonly x: number;
  readonly z: number;
  /** Lauftempo statt Gehtempo. */
  readonly rennt: boolean;
}

/**
 * Rechnet einen Schritt von `dt` Sekunden.
 *
 * Reihenfolge: erst waagerecht (mit Gleiten an dem, was im Weg steht),
 * dann senkrecht. Umgekehrt saehe die Bodenabfrage die alte Stelle, und
 * die Figur stuende beim Hinauflaufen einen Schritt lang in der Luft.
 *
 * Die waagerechte Absicht wird NICHT normiert: Der Bestand rechnet je
 * Achse `moveX * tempo * dt`, der Client schickt bereits geklemmte Werte,
 * und ein hier eingezogenes Normieren waere eine Tempoaenderung, die
 * niemand bestellt hat.
 */
export function bewegungsSchritt(
  zustand: BewegungsZustand,
  eingabe: BewegungsEingabe,
  dt: number,
  boden: BodenAbfrage,
  hindernis: HindernisAbfrage
): BewegungsZustand {
  const tempo = eingabe.rennt ? LAUF_TEMPO : GEH_TEMPO;
  const wunschX = zustand.x + eingabe.x * tempo * dt;
  const wunschZ = zustand.z + eingabe.z * tempo * dt;

  const ziel = gleitBewegung({
    von: zustand,
    nachX: wunschX,
    nachZ: wunschZ,
    radius: KOERPER_RADIUS,
    boden,
    hindernis,
  });

  // Senkrecht: Der Boden „klebt" bis `BODEN_KLEBEN` unter den Fuessen
  // (Original `m_StickToGroundDistance`) — wer eine Treppe hinunterlaeuft
  // oder ueber eine Gelaendekante rollt, wird aufgesetzt statt fallen
  // gelassen; erst darunter faellt die Figur mit fester Rate. `null`
  // heisst „hier ist kein Boden" und laesst die Hoehe stehen (in der
  // Oberwelt kommt das nicht vor, im Dungeon-Band waere es der Fall).
  const grund = boden.hoeheBei(ziel.x, ziel.z, zustand.y);
  let y = zustand.y;
  if (grund !== null) {
    if (y - grund <= BODEN_KLEBEN) {
      y = grund;
    } else {
      const gefallen = y - FALL_TEMPO * dt;
      y = gefallen > grund ? gefallen : grund;
    }
  }

  return { x: ziel.x, y, z: ziel.z };
}

/**
 * Nur die getroffenen Flaechen eines Schritts — fuer Diagnose und Test.
 *
 * Getrennt gehalten, weil `bewegungsSchritt` einen ZUSTAND liefern soll
 * und nichts sonst: Wer wissen will, WORAN die Figur haengt, fragt hier,
 * und der heisse Pfad traegt kein zusaetzliches Objekt je Schritt.
 */
export function flaechenDesSchritts(
  zustand: BewegungsZustand,
  eingabe: BewegungsEingabe,
  dt: number,
  boden: BodenAbfrage,
  hindernis: HindernisAbfrage
): { readonly normalen: readonly Vek3[]; readonly blockiert: boolean } {
  const tempo = eingabe.rennt ? LAUF_TEMPO : GEH_TEMPO;
  const ergebnis = gleitBewegung({
    von: zustand,
    nachX: zustand.x + eingabe.x * tempo * dt,
    nachZ: zustand.z + eingabe.z * tempo * dt,
    radius: KOERPER_RADIUS,
    boden,
    hindernis,
  });
  return { normalen: ergebnis.normalen, blockiert: ergebnis.blockiert };
}
