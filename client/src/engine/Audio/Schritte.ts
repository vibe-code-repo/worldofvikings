/**
 * Schritttakt und Untergrundwahl der Schrittgeräusche (Karte B4).
 *
 * Der Takt zählt zurückgelegte METER, nicht Zeit: Ein Schritt je 1,1 m beim
 * Gehen, je 1,5 m beim Rennen, dazwischen mindestens 0,18 s. Im Stand, in
 * der Luft und bei Sprüngen der Position (Teleport) kommt nichts. Das Modul
 * kennt weder Babylon noch Web-Audio: Eingabe ist die Position je Frame,
 * Ausgabe ist „jetzt ein Schritt mit dieser Klanggruppe“. Damit können
 * später fremde Spieler und Tiere denselben Takt benutzen.
 *
 * Step cadence in metres travelled (1.1 m walking, 1.5 m running, at least
 * 0.18 s apart), plus the choice of ground sound group.
 */
import { WATER_LEVEL } from '@wov/shared';
import { schrittGruppeBei, type BodenQuelle } from '@wov/shared/src/worldgen/bodenMischung.js';

export type Gangart = 'gehen' | 'rennen';

/** Meter je Schritt. */
export const SCHRITT_WEITE: Readonly<Record<Gangart, number>> = { gehen: 1.1, rennen: 1.5 };
/** Kürzester Abstand zweier Schritte in Sekunden. */
export const SCHRITT_MIN_ABSTAND_S = 0.18;
/**
 * Größte Strecke eines einzelnen Updates, die noch als Gehen zählt. Was
 * darüber liegt (Teleport, Einsprung, Respawn), setzt den Takt zurück,
 * statt einen Schritt zu ernten.
 */
export const SCHRITT_MAX_SPRUNG = 4;

export interface SchrittEingabe {
  x: number;
  y: number;
  z: number;
  /** Monotone Zeit in Sekunden. */
  zeit: number;
  /** `false` in der Luft (Sprung/Fall). */
  bodenkontakt: boolean;
  gangart: Gangart;
}

export interface SchrittEreignis {
  x: number;
  y: number;
  z: number;
}

export class SchrittTakt {
  private letzteX = NaN;
  private letzteZ = NaN;
  private strecke = 0;
  private letzterSchrittZeit = -Infinity;

  /** Liefert einen Schritt, wenn in diesem Update einer fällig ist, sonst null. */
  update(e: SchrittEingabe): SchrittEreignis | null {
    const hatVorher = Number.isFinite(this.letzteX);
    const dx = e.x - this.letzteX;
    const dz = e.z - this.letzteZ;
    const weg = hatVorher ? Math.hypot(dx, dz) : 0;
    this.letzteX = e.x;
    this.letzteZ = e.z;

    if (!e.bodenkontakt) return null; // Luftphase: nichts zählen, aber Position nachführen
    if (weg > SCHRITT_MAX_SPRUNG) {
      this.strecke = 0;
      return null;
    }
    this.strecke += weg;

    const weite = SCHRITT_WEITE[e.gangart];
    if (this.strecke < weite) return null;
    if (e.zeit - this.letzterSchrittZeit < SCHRITT_MIN_ABSTAND_S) {
      // Zu früh: die Strecke bleibt gutgeschrieben (aber nie mehr als ein
      // Schritt, damit danach kein Stau auf einmal losläuft).
      this.strecke = Math.min(this.strecke, weite);
      return null;
    }
    this.strecke = Math.min(this.strecke - weite, weite * 0.999);
    this.letzterSchrittZeit = e.zeit;
    return { x: e.x, y: e.y, z: e.z };
  }

  /** Takt zurücksetzen (Weltwechsel, Dungeon-Einstieg). */
  zuruecksetzen(): void {
    this.letzteX = NaN;
    this.letzteZ = NaN;
    this.strecke = 0;
  }
}

/** Knietiefe: tieferes Wasser gibt keine Schritte (der Client kennt kein Schwimmen, die Figur geht auf dem Grund). */
export const KNIETIEFE = 0.5;
/** Ab dieser Wassertiefe klingt es nach Wasser statt nach Boden. */
export const NASS_AB = 0.05;
/** So viel höher als das Gelände muss ein Kollisionskörper unter den Füßen liegen, um als Objekt zu zählen. */
export const OBJEKT_ABSTAND = 0.15;

export const GRUPPE_HOLZ = 'footsteps/wood';
export const GRUPPE_WASSER = 'footsteps/water';
export const GRUPPE_STEIN = 'footsteps/tile';

export interface BodenKontext {
  x: number;
  z: number;
  /** Im Dungeon gibt es kein Gelände: der Boden ist gebauter Stein. */
  dungeon: boolean;
  /** Höhe des ersten Kollisionskörpers unter den Füßen (Havok-Sonde), falls bekannt. */
  koerperHoehe: number | null;
  quelle: BodenQuelle;
}

/**
 * Klanggruppe unter den Füßen, oder null (nichts abspielen):
 *  - Dungeon → Stein (`footsteps/tile`)
 *  - Wasser tiefer als die Kniehöhe → null
 *  - Kollisionskörper mindestens `OBJEKT_ABSTAND` über dem Gelände → Holz
 *    (Bauteile und Stege; der Client führt kein Material je Bauteil)
 *  - Wasser bis Kniehöhe → Wasser
 *  - sonst die Bodenmischung des Geländes.
 */
export function schrittGruppe(k: BodenKontext): string | null {
  if (k.dungeon) return GRUPPE_STEIN;
  const gelaende = k.quelle.getGroundHeight(k.x, k.z);
  if (k.koerperHoehe !== null && k.koerperHoehe > gelaende + OBJEKT_ABSTAND) return GRUPPE_HOLZ;
  const tiefe = WATER_LEVEL - gelaende;
  if (tiefe > KNIETIEFE) return null;
  if (tiefe > NASS_AB) return GRUPPE_WASSER;
  return schrittGruppeBei(k.x, k.z, k.quelle);
}
