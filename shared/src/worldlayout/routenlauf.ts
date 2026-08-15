/**
 * RoutenLauf — die reine Wegmathematik einer NPC-Route.
 *
 * ── Warum das in shared/ liegt ────────────────────────────────────────
 * Gelaufen wird an zwei Stellen: auf dem SERVER (world/RoutenLaeufer.ts,
 * autoritativ für die echte Welt) und seit dem Editor-Testflug auch im
 * CLIENT (editor/RoutenVorschau.ts), damit man beim Zeichnen sofort
 * sieht, was die Route tut. Zweimal dieselbe Formel zu tippen wäre die
 * schlechteste aller Varianten: Eine Vorschau, die anders läuft als der
 * Server, ist schlimmer als gar keine — man gestaltet dann nach einem
 * Bild, das die fertige Welt nie zeigt. Also steht der Fortschritt
 * entlang der Punkte genau EINMAL hier, und beide Seiten halten nur noch
 * das Drumherum (ZDO-Drossel bzw. Szenen-Instanz).
 *
 * ── Was hier bewusst NICHT vorkommt ───────────────────────────────────
 * Keine ZDO, kein Babylon, keine Welt. Gerechnet wird ausschließlich in
 * der xz-Ebene; die Höhe ist nicht Teil einer Route (die Wegpunkte haben
 * keine, s. RouteDef) und kommt auf beiden Seiten aus `getGroundHeight`.
 * Auch die Frage „wird überhaupt simuliert" (Spielernähe, Griff des
 * Editors) bleibt draußen — das ist Politik der jeweiligen Seite, nicht
 * Geometrie.
 */

import type { Quaternion } from '../types.js';
import { ROUTE_DEFAULT_SPEED, wegpunktPause, type RouteDef, type Wegpunkt } from './types.js';

/** Rest-Toleranz eines Bewegungsschritts (m) — darunter gilt er als erledigt. */
export const ROUTEN_EPS = 1e-6;

/** Rest-Toleranz des Zeitbudgets (s) — darunter ist der Tick verbraucht. */
const ZEIT_EPS = 1e-9;

/** Ergebnis eines Zeitschritts. Die Höhe fehlt absichtlich (s. Kopf). */
export interface RoutenSchritt {
  x: number;
  z: number;
  /**
   * Zurückgelegter WEG in Metern (nicht Luftlinie). Kehrt der NPC
   * innerhalb eines Ticks um, steht er hinterher fast wieder am
   * Ausgangspunkt — als „steht" darf das nicht durchgehen.
   */
  gelaufen: number;
  /**
   * `gelaufen > ROUTEN_EPS` — zugleich die Antwort auf „läuft oder steht"
   * und damit auf `walk`/`idle`. Ein Tick, der nur gewartet hat, ist
   * `false`; ein Tick, in dem eine Pause ausläuft UND danach gelaufen
   * wird, ist `true`.
   */
  bewegt: boolean;
  /**
   * Verbleibende Wartezeit am erreichten Wegpunkt (s, 0 = wartet nicht).
   * Für Diagnose und Tests — die Animation hängt an `bewegt`.
   */
  wartet: number;
  /**
   * Blickrichtung in Radiant um die Hochachse, abgeleitet aus dem ZULETZT
   * gelaufenen Stück statt aus der Gesamtverschiebung: Nach einer Ecke
   * oder Umkehr zeigt der NPC damit dorthin, wo er als Nächstes hingeht.
   * Bei Stillstand bleibt der zuletzt gültige Wert stehen.
   */
  yaw: number;
}

/** Index des Wegpunkts mit dem kleinsten Abstand zu (x, z); 0 ohne Punkte. */
export function naechsterWegpunkt(
  x: number,
  z: number,
  punkte: ReadonlyArray<Wegpunkt>
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i]!;
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Drehung um die Hochachse (y-up, rechtshändig) — wie im SpawnSystem. */
export function yawQuaternion(yaw: number): Quaternion {
  const half = yaw / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/**
 * Ein NPC auf seiner Route: hält NUR den Laufzustand (welcher Wegpunkt ist
 * das Ziel, in welche Richtung wird die Liste gelesen) und rechnet daraus
 * den nächsten Zeitschritt.
 *
 * Die Position wird bewusst NICHT gespeichert, sondern je Schritt
 * hereingereicht: Auf dem Server ist die ZDO die Wahrheit über sie, im
 * Editor der Entwurf — beide würden eine Kopie hier drin früher oder
 * später überholen (Teleport, Ziehen mit der Maus).
 */
export class RoutenLauf {
  private _route: RouteDef;
  /** Index des Wegpunkts, auf den gerade zugelaufen wird. */
  private _ziel: number;
  /** Laufrichtung in der Punktliste (+1/−1) — nur bei 'pingpong' je −1. */
  private _richtung: 1 | -1 = 1;
  private _yaw = 0;
  /**
   * Restliche Wartezeit (s) am Wegpunkt `_ziel`. Größer 0 heißt: Der NPC
   * steht AUF diesem Punkt und ist noch nicht weitergeschaltet — genau
   * diese Kopplung sorgt dafür, dass jede Pause einmal abläuft.
   */
  private _wartet = 0;

  /**
   * Der Einstiegspunkt ist der NÄCHSTGELEGENE Wegpunkt statt immer der
   * erste: Ein NPC aus dem Save (oder ein eben verschobener im Editor)
   * steht irgendwo mitten auf seiner Runde und liefe sonst quer durch die
   * Landschaft zum Anfang zurück.
   */
  constructor(route: RouteDef, startX: number, startZ: number) {
    this._route = route;
    this._ziel = naechsterWegpunkt(startX, startZ, route.points);
  }

  get route(): RouteDef {
    return this._route;
  }

  get ziel(): number {
    return this._ziel;
  }

  get richtung(): 1 | -1 {
    return this._richtung;
  }

  get yaw(): number {
    return this._yaw;
  }

  /** Restliche Wartezeit am aktuellen Wegpunkt (s). */
  get wartet(): number {
    return this._wartet;
  }

  /**
   * Route austauschen, ohne den Lauf abzureißen — der Editor ändert sie
   * live (Wegpunkt gezogen, Tempo/Modus verstellt).
   *
   * Bleibt die ANZAHL der Punkte gleich, bleibt auch das Ziel stehen: Wer
   * einen Wegpunkt verschiebt, will den NPC dorthin ziehen sehen, nicht
   * bei jeder Mausbewegung ein neues Ziel bekommen. Ändert sich die
   * Anzahl (Punkt angehängt/zurückgenommen), zeigt der alte Index unter
   * Umständen auf etwas ganz anderes — dann ist der nächstgelegene Punkt
   * die einzig sinnvolle Antwort.
   */
  setzeRoute(route: RouteDef, x: number, z: number): void {
    const gleicheLaenge = route.points.length === this._route.points.length;
    this._route = route;
    if (!gleicheLaenge) {
      this._ziel = naechsterWegpunkt(x, z, route.points);
      this._richtung = 1;
      this._wartet = 0;
      return;
    }
    // Läuft gerade eine Pause und der Nutzer verkürzt sie (oder streicht
    // sie ganz), soll das SOFORT wirken — sonst stünde der NPC noch die
    // alte Zeit lang da und der Regler schiene wirkungslos.
    if (this._wartet > 0) {
      const punkt = route.points[this._ziel];
      this._wartet = Math.min(this._wartet, punkt ? wegpunktPause(punkt) : 0);
    }
  }

  /** Neu einsteigen (nächstgelegener Wegpunkt) — nach einem Sprung/Zug. */
  einstieg(x: number, z: number): void {
    this._ziel = naechsterWegpunkt(x, z, this._route.points);
    // Ein Neueinstieg ist ein frischer Anfang: eine halb abgelaufene Pause
    // gehörte zu einer Stelle, an der der NPC nicht mehr steht.
    this._wartet = 0;
  }

  /**
   * Ein Tick entlang der Route.
   *
   * Gerechnet wird mit einem ZEIT-Budget (nicht mit einer Schrittweite):
   * Laufen und Warten verbrauchen dieselbe Ressource, und nur so kann ein
   * einzelner Tick eine kurze Pause vollständig abarbeiten und danach
   * noch ein Stück weitergehen. Ein Frame-Hänger (oder ein Server, der
   * aufholt) darf keine Pause verschlucken und keine verdoppeln.
   *
   * Die Zeit wird über MEHRERE Wegpunkte verteilt (Schleife statt eines
   * einzelnen Segments): Bei eng gesetzten Punkten überspringt ein Tick
   * sonst Wegpunkte oder der NPC klebt an ihnen fest.
   */
  schritt(startX: number, startZ: number, deltaSec: number): RoutenSchritt {
    const punkte = this._route.points;
    const n = punkte.length;
    if (n === 0) return this.stillstand(startX, startZ);
    // Nach einem Route-Tausch kann der Index über die neue Liste hinausragen.
    if (this._ziel >= n) this._ziel = n - 1;

    let x = startX;
    let z = startZ;
    const tempo = this._route.speed ?? ROUTE_DEFAULT_SPEED;
    let zeit = deltaSec;
    /** Zurückgelegter WEG (nicht Luftlinie) und Richtung des letzten Stücks. */
    let gelaufen = 0;
    let blickX = 0;
    let blickZ = 0;

    // Obergrenze: je Wegpunkt höchstens zwei Durchläufe (ankommen und die
    // Pause beenden), plus Reserve. Ohne sie drehte sich die Schleife bei
    // doppelten Wegpunkten ohne Pause endlos.
    const maxRunden = 2 * n + 2;
    for (let runde = 0; runde < maxRunden && zeit > ZEIT_EPS; runde++) {
      // ── Warten ──────────────────────────────────────────────────────
      if (this._wartet > 0) {
        const w = Math.min(this._wartet, zeit);
        this._wartet -= w;
        zeit -= w;
        if (this._wartet > 0) break; // Pause reicht über den Tick hinaus
        // Pause abgelaufen: JETZT erst den nächsten Wegpunkt wählen. Weil
        // das Weiterschalten an das ENDE der Pause gebunden ist und nicht
        // an die Ankunft, kann derselbe Punkt nicht zweimal warten —
        // insbesondere nicht der Umkehrpunkt bei 'pingpong'.
        this.weiterschalten(n);
        continue;
      }
      if (tempo <= 0) break; // stehendes Tempo — keine Bewegung, kein Hänger

      // ── Laufen ──────────────────────────────────────────────────────
      const ziel = punkte[this._ziel]!;
      const dx = ziel[0] - x;
      const dz = ziel[1] - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= ROUTEN_EPS) {
        // Schon auf dem Punkt (doppelter Wegpunkt, Wiedereinstieg genau
        // darauf). Bei einer Ein-Punkt-Route ist das der Endzustand: Der
        // NPC steht auf seinem Posten (Gangart 'idle').
        if (n < 2) break;
        if (this.ankunft(punkte)) continue;
        this.weiterschalten(n);
        continue;
      }
      const schritt = Math.min(dist, tempo * zeit);
      x += (dx / dist) * schritt;
      z += (dz / dist) * schritt;
      zeit -= schritt / tempo;
      gelaufen += schritt;
      blickX = dx / dist;
      blickZ = dz / dist;
      if (schritt >= dist - ROUTEN_EPS) {
        // Ein-Punkt-Route: angekommen und fertig, hier wird nicht gewartet
        // (es gibt kein Weiter — der Posten IST der Endzustand).
        if (n < 2) break;
        if (!this.ankunft(punkte)) this.weiterschalten(n);
      }
    }

    // Gemessen wird der WEG, nicht die Luftlinie: Kehrt der NPC innerhalb
    // eines Ticks um, steht er hinterher fast wieder dort, wo er losging —
    // als „steht" darf das nicht durchgehen.
    if (gelaufen <= ROUTEN_EPS) return this.stillstand(startX, startZ);
    // Blickrichtung aus dem ZULETZT gelaufenen Stück. Während einer Pause
    // bleibt sie stehen (stillstand() reicht den alten Wert durch) — ein
    // NPC, der sich beim Warten schon zum nächsten Punkt dreht, wirkt
    // nervös.
    this._yaw = Math.atan2(blickX, blickZ);
    return { x, z, gelaufen, bewegt: true, wartet: this._wartet, yaw: this._yaw };
  }

  /**
   * Wegpunkt erreicht: Pause übernehmen. Gibt zurück, ob gewartet wird —
   * dann bleibt `_ziel` auf dem erreichten Punkt stehen, bis die Zeit um
   * ist (s. Warten-Zweig).
   */
  private ankunft(punkte: ReadonlyArray<Wegpunkt>): boolean {
    const pause = wegpunktPause(punkte[this._ziel]!);
    if (!(pause > 0)) return false;
    this._wartet = pause;
    return true;
  }

  private stillstand(x: number, z: number): RoutenSchritt {
    return { x, z, gelaufen: 0, bewegt: false, wartet: this._wartet, yaw: this._yaw };
  }

  /** Nächsten Wegpunkt wählen — Runde bzw. Umkehr am Ende. */
  private weiterschalten(n: number): void {
    if (this._route.mode === 'pingpong') {
      const naechster = this._ziel + this._richtung;
      if (naechster >= n) {
        // Umkehr: Ziel ist der VORLETZTE Punkt (n−2), nicht der letzte —
        // auf dem steht der NPC ja gerade.
        this._ziel = n - 2;
        this._richtung = -1;
      } else if (naechster < 0) {
        this._ziel = 1;
        this._richtung = 1;
      } else {
        this._ziel = naechster;
      }
      return;
    }
    this._ziel = (this._ziel + 1) % n;
  }
}
