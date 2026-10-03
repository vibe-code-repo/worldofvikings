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
import { neuerHangSpeicher, type HangSpeicher } from '@wov/shared/src/bewegung/gelaendeHang.js';
import {
  ROLLE_BEWEGUNG_S,
  ROLLE_TEMPO,
  SCHRITT_LAENGE,
  SERVER_MAX_SCHRITTE,
  bewegungsTempo,
} from '@wov/shared/src/bewegung/masse.js';
import type { Kollisionswelt } from './Kollisionswelt.js';

/** Teilschritte der ganzen Rolle (Vorschau und gefahrener Weg teilen dasselbe Raster). */
export const ROLLE_SCHRITTE = Math.max(1, Math.ceil(ROLLE_BEWEGUNG_S / SCHRITT_LAENGE - 1e-9));

/** Der Weg EINER Rolle: ein Hangspeicher, die schon gefahrenen Teilschritte und die noch nicht verbrauchte Zeit (s). */
export interface RolleWeg {
  readonly hang: HangSpeicher;
  getan: number;
  rest: number;
}

export function neuerRolleWeg(): RolleWeg {
  return { hang: neuerHangSpeicher(), getan: 0, rest: 0 };
}

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
    deltaSec: number,
    blockt = false
  ): Vector3 {
    const akku = this.akkus.get(wesen) ?? neuerAkkumulator(SCHRITT_LAENGE, SERVER_MAX_SCHRITTE);
    const ergebnis = weiter(akku, deltaSec);
    this.akkus.set(wesen, ergebnis.akku);
    if (ergebnis.schritte === 0) return wesen.position;

    const tempo = bewegungsTempo(rennt, blockt);
    // Reichweite = was dieses Paket hoechstens zurueckliegt. Der Zuschlag
    // fuer die Ausdehnung der Koerper sitzt in `nahfeld` selbst.
    const weg = tempo * ergebnis.schritte * ergebnis.akku.schrittLaenge;
    const nah = this.kollision.nahfeld(wesen.position, weg);

    const eingabe = { x: moveX, z: moveZ, rennt, blockt };
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

  /**
   * Die Rolle (D3-K4): `dt` Sekunden Rollweg in Richtung (x, z), ein Einheitsvektor. Eigener Weg neben `schritt`:
   * die Zeit wird in gleich lange Teilschritte unter 1/60 s geteilt statt in feste Schritte mit getragenem
   * Rest, damit die Strecke genau `ROLLE_TEMPO * dt` ist (der Rest eines festen Schritts waere bis zu 10 cm).
   * Dieselbe Kollision und dasselbe Gelaende wie jeder Schritt: kein Durchrollen durch Felsen.
   */
  rollSchritt(wesen: BewegtesWesen, x: number, z: number, dt: number, lauf?: RolleWeg): Vector3 {
    if (!(dt > 0)) return wesen.position;
    if (lauf) return this.rolleAufRaster(wesen.position, x, z, dt, lauf);
    const weg = ROLLE_TEMPO * dt;
    return this.rolleSimulieren(wesen.position, x, z, dt, this.kollision.nahfeld(wesen.position, weg));
  }

  /**
   * Wie weit die volle Rolle von `von` aus in Richtung (x, z) kaeme (m, waagerecht), ohne etwas zu veraendern.
   * Der Freiraum-Test des Servers: Felsen, Waende und zu steile Haenge verkuerzen den Weg.
   */
  rolleVorschau(von: Vector3, x: number, z: number): number {
    const ende = this.rolleSimulieren(von, x, z, ROLLE_BEWEGUNG_S, this.kollision.nahfeld(von, ROLLE_TEMPO * ROLLE_BEWEGUNG_S));
    return Math.sqrt((ende.x - von.x) ** 2 + (ende.z - von.z) ** 2);
  }

  /**
   * Die Rolle auf dem Raster der Vorschau: Die Teilschritte sind dieselben wie in `rolleVorschau` (`ROLLE_BEWEGUNG_S`
   * geteilt in `ROLLE_SCHRITTE` gleiche Schritte, ein Hangspeicher fuer die ganze Rolle). Ein Paket fuehrt die
   * Schritte aus, die seine Zeit faellig macht, und traegt den Rest in `lauf.rest` zum naechsten. So haengt der
   * gefahrene Weg nicht davon ab, wie die Pakete fallen, und stimmt mit der Vorschau ueberein, auch an der
   * Steigungsgrenze, wo schon ein anderer Messpunkt die Entscheidung kippt. Die Figur liegt dabei hoechstens einen
   * Teilschritt (~8 cm) hinter der Zeit; nach dem letzten Paket der Bewegung ist der Weg voll.
   */
  private rolleAufRaster(von: Vector3, x: number, z: number, dt: number, lauf: RolleWeg): Vector3 {
    lauf.rest += dt;
    const teil = ROLLE_BEWEGUNG_S / ROLLE_SCHRITTE;
    const faellig = Math.min(ROLLE_SCHRITTE - lauf.getan, Math.floor(lauf.rest / teil + 1e-9));
    if (faellig <= 0) return von;
    lauf.rest -= faellig * teil;
    lauf.getan += faellig;
    const nah = this.kollision.nahfeld(von, ROLLE_TEMPO * teil * faellig);
    const eingabe = { x, z, rennt: false, blockt: false, rollt: true };
    let zustand: BewegungsZustand = von;
    for (let i = 0; i < faellig; i += 1) zustand = bewegungsSchritt(zustand, eingabe, teil, nah, nah, lauf.hang);
    return { x: zustand.x, y: zustand.y, z: zustand.z };
  }

  private rolleSimulieren(von: Vector3, x: number, z: number, dt: number, nah: ReturnType<Kollisionswelt['nahfeld']>): Vector3 {
    const n = Math.max(1, Math.ceil(dt / SCHRITT_LAENGE - 1e-9));
    const teil = dt / n;
    const eingabe = { x, z, rennt: false, blockt: false, rollt: true };
    const hangSpeicher = neuerHangSpeicher();
    let zustand: BewegungsZustand = von;
    for (let i = 0; i < n; i += 1) zustand = bewegungsSchritt(zustand, eingabe, teil, nah, nah, hangSpeicher);
    return { x: zustand.x, y: zustand.y, z: zustand.z };
  }
}
