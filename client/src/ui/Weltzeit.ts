/**
 * Reine Umrechnung `timeOfDay` (0..1, Tagesbruchteil aus dem TimeSync) in
 * Uhrzeit + Sonnenstand-Symbol für die HUD-Anzeige (s. Minimap.ts).
 *
 * Kein DOM-/Babylon-Bezug — deshalb ein eigenes Modul statt einer Methode
 * auf Minimap: so lässt sich die Arithmetik ohne Browser testen (s.
 * test/weltzeit.ts), genau wie RefraktionsAuswahl.ts/WaterRefraction.ts
 * ihre reine Logik von der Engine-Anbindung trennen.
 */
import { FRACTION_SUNRISE, FRACTION_SUNSET } from '@wov/shared';

/** Symbol für die Weltzeit-Anzeige. */
export type Sonnenstand = 'sonne' | 'mond' | 'aufgang' | 'untergang';

export interface Weltzeit {
  /** 0..23 */
  stunde: number;
  /** 0..59 */
  minute: number;
  sonnenstand: Sonnenstand;
}

/**
 * Breite des Übergangsfensters um Sonnenaufgang/-untergang, in Stunden vor
 * UND nach der jeweiligen Schwelle. Redaktionelle Wahl, keine Messung: Ohne
 * Fenster kippt das Symbol exakt an der Schwelle hart von Mond auf Sonne,
 * was am Bildschirm wie ein Anzeigefehler wirkt statt wie ein Übergang.
 */
const UEBERGANG_H = 0.5;
const UEBERGANG_F = UEBERGANG_H / 24;

/**
 * @param timeOfDay Tagesbruchteil, wie `lighting.timeOfDay` ihn hält.
 *   Werte ausserhalb 0..1 (Überlauf, negative Eingaben) werden auf den
 *   Tageskreis zurückgefaltet.
 */
export function weltzeitAus(timeOfDay: number): Weltzeit {
  const f = ((timeOfDay % 1) + 1) % 1;
  // Auf die Minute runden statt zu kappen: FRACTION_SUNRISE/_SUNSET sind
  // Divisionsergebnisse (240/1800 usw.) und treffen 03:12/20:24 in
  // Fliesskomma nicht exakt — ein Floor hätte hier 03:11 geliefert.
  const gesamtMinuten = Math.round(f * 24 * 60) % 1440;
  const stunde = Math.floor(gesamtMinuten / 60);
  const minute = gesamtMinuten % 60;

  let sonnenstand: Sonnenstand;
  if (Math.abs(f - FRACTION_SUNRISE) <= UEBERGANG_F) sonnenstand = 'aufgang';
  else if (Math.abs(f - FRACTION_SUNSET) <= UEBERGANG_F) sonnenstand = 'untergang';
  else if (f > FRACTION_SUNRISE && f < FRACTION_SUNSET) sonnenstand = 'sonne';
  else sonnenstand = 'mond';

  return { stunde, minute, sonnenstand };
}
