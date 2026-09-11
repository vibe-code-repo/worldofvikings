/**
 * Der Antrieb des Bewegungsschritts auf der Serverseite.
 * The server-side driver of the movement step.
 *
 * Warum diese Datei ueberhaupt existiert, obwohl sie kurz ist: In
 * `WovServer.handlePlayerInput` bleibt so EIN Aufruf stehen statt eines
 * Blocks. Die Datei ist 1.900 Zeilen lang und wird von mehreren Leuten
 * gleichzeitig angefasst; jede Zeile Logik, die dort NICHT steht, ist
 * eine Zeile, die niemandem in die Quere kommt.
 *
 * Was hier passiert: Wanduhrzeit hinein, feste Schritte heraus. Die
 * Hindernisse werden EINMAL je Eingabepaket eingesammelt (`nahfeld`) und
 * dann von allen Schritten dieses Pakets benutzt — bei drei Schritten je
 * Paket spart das zwei Zonendurchlaeufe, und die Formen koennen sich
 * innerhalb von 50 ms ohnehin nicht bewegen.
 *
 * NICHT hier: Fliegen und das Dungeon-Band. Im Flug gibt es keine
 * Schwerkraft und keine Waende, in der Instanz simuliert der Client die
 * Raumkollision und meldet seine Hoehe — beide Zweige bleiben, wie sie
 * waren.
 */
import type { Vector3 } from '@wov/shared';
import {
  neuerAkkumulator,
  weiter,
  type Akkumulator,
} from '@wov/shared/src/bewegung/festerSchritt.js';
import { bewegungsSchritt, type BewegungsZustand } from '@wov/shared/src/bewegung/schritt.js';
import { neuerHangSpeicher } from '@wov/shared/src/bewegung/gelaendeHang.js';
import {
  GEH_TEMPO,
  LAUF_TEMPO,
  SCHRITT_LAENGE,
  SERVER_MAX_SCHRITTE,
} from '@wov/shared/src/bewegung/masse.js';
import type { Kollisionswelt } from './Kollisionswelt.js';

/** Der Teil eines Peers, den diese Klasse anfasst. */
export interface BewegtesWesen {
  position: Vector3;
}

export class Spielerbewegung {
  /**
   * Der getragene Rest je Spieler.
   *
   * Als WeakMap und nicht als Feld am Peer: Der Peer-Typ gehoert dem
   * Netzwerkteil, und ein Feld dort waere eine zweite Datei, die dieser
   * Umbau anfasst. Schwach, damit ein abgemeldeter Spieler nicht als
   * Rest einer Zahl im Speicher haengen bleibt.
   */
  private readonly akkus = new WeakMap<object, Akkumulator>();

  constructor(private readonly kollision: Kollisionswelt) {}

  /**
   * Rechnet ein Eingabepaket und liefert die neue Position.
   *
   * `moveX`/`moveZ` sind bereits auf −1..+1 geklemmt (der Aufrufer tut
   * das, bevor irgendetwas damit rechnet).
   */
  schritt(
    wesen: BewegtesWesen,
    moveX: number,
    moveZ: number,
    rennt: boolean,
    deltaSec: number
  ): Vector3 {
    const akku = this.akkus.get(wesen) ?? neuerAkkumulator(SCHRITT_LAENGE, SERVER_MAX_SCHRITTE);
    const ergebnis = weiter(akku, deltaSec);
    this.akkus.set(wesen, ergebnis.akku);
    if (ergebnis.schritte === 0) return wesen.position;

    const tempo = rennt ? LAUF_TEMPO : GEH_TEMPO;
    // Reichweite = was dieses Paket hoechstens zurueckliegt. Der Zuschlag
    // fuer die Ausdehnung der Koerper sitzt in `nahfeld` selbst.
    const weg = tempo * ergebnis.schritte * ergebnis.akku.schrittLaenge;
    const nah = this.kollision.nahfeld(wesen.position, weg);

    const eingabe = { x: moveX, z: moveZ, rennt };
    // EIN Hangspeicher je Eingabepaket, nicht je Schritt: Die vier
    // Gelaendeabfragen der Steigungsgrenze fallen damit einmal an statt
    // bis zu dreissigmal. Frisch je Paket und nicht am Spieler gehalten,
    // damit kein Zustand ueber Pakete hinweg altert — der Speicher prueft
    // seine Gueltigkeit ohnehin selbst (s. `HangSpeicher`), aber ein
    // Objekt, das nur so lange lebt wie der Aufruf, kann gar nicht erst
    // falsch werden.
    const hangSpeicher = neuerHangSpeicher();
    let zustand: BewegungsZustand = wesen.position;
    for (let i = 0; i < ergebnis.schritte; i += 1) {
      zustand = bewegungsSchritt(
        zustand,
        eingabe,
        ergebnis.akku.schrittLaenge,
        nah,
        nah,
        hangSpeicher
      );
    }
    return { x: zustand.x, y: zustand.y, z: zustand.z };
  }
}
