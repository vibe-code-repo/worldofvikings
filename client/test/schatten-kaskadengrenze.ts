/**
 * Schatten: Wo die scharfe Nahkaskade endet (G18).
 *
 * Aus dem Look-Profil gerechnet, nicht am Generator gelesen (der laeuft nicht
 * auf der NullEngine): Die Grenze muss so weit reichen, dass man sich im
 * Nahbereich bewegen kann, ohne dass die Schattenkante von scharf auf weich
 * springt. Die Rechnung ist an der Messung geeicht (9,05 m bei lambda 0,8,
 * minZ 0,5, 50 m, zwei Kaskaden); vorher endete die Nahkaskade bei 9 m und
 * die zweite Karte trug 5,4-fach groebere Texel.
 *
 * Lauf: npx tsx client/test/schatten-kaskadengrenze.ts
 */
import { LOOK_VORGABE } from '../../shared/src/lookProfil.js';
import {
  MIN_KASKADEN,
  SHADOW_LEVELS,
  kaskadenGrenzen,
  schattenLambda,
  schattenMitLook,
  schattenUeberblendung,
} from '../src/engine/Shadows';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('Schatten G18: Kaskadengrenze');

// ── G18 Wo endet die scharfe Nahkaskade? ─────────────────────────────
{
  // Eichung: die am Generator gelesenen Sichttiefen (18.09.2026, minZ 0,5).
  const ist = kaskadenGrenzen(0.5, 50, 2, 0.8);
  pruefe(Math.abs(ist[0]! - 9.05) < 0.01 && ist[1] === 50, `Eichung: lambda 0,8 gab ${ist.map((v) => v.toFixed(2)).join(' / ')}, gemessen 9,05 / 50`);
  const drei = kaskadenGrenzen(0.5, 50, 3, 0.35);
  pruefe(
    Math.abs(drei[0]! - 11.86) < 0.02 && Math.abs(drei[1]! - 25.55) < 0.02,
    `Eichung: 3 Kaskaden, lambda 0,35: ${drei.map((v) => v.toFixed(2)).join(' / ')}, gemessen 11,86 / 25,55 / 50`
  );

  // Die ausgelieferte Vorgabe: Nahkaskade bis mindestens ~18 m.
  const s = LOOK_VORGABE.schatten;
  const kaskaden = Math.max(MIN_KASKADEN, s.kaskaden);
  const grenzen = kaskadenGrenzen(0.5, s.reichweite, kaskaden, s.lambda);
  pruefe(
    grenzen[0]! >= 18,
    `Nahkaskade endet bei ${grenzen[0]!.toFixed(1)} m — unter 18 m springt die Schattenkante im Bewegungsbereich von scharf auf weich`
  );
  pruefe(s.ueberblendung >= 0.15, `Ueberblendung ${s.ueberblendung} zu schmal, der Wechsel bleibt sichtbar`);
  // Der Sprung an der Grenze: Die Texelbreite folgt der Reichweite der Kaskade
  // (gemessen 2,26 → 12,22 cm = 5,4-fach bei 9,05 → 50 m = 5,5-fach). Ein
  // 2048er Look braucht ausserdem eine Stufe, die ihn nicht auf 1024 kappt.
  const stufe = SHADOW_LEVELS[2]!;
  const wirksam = schattenMitLook(stufe, s);
  pruefe(
    wirksam !== null && wirksam.aufloesung === s.aufloesung,
    `Stufe 2 deckelt den Look auf ${wirksam?.aufloesung} px, der Look will ${s.aufloesung}`
  );
  const sprung = grenzen[1]! / grenzen[0]!;
  pruefe(sprung <= 3, `Texelsprung an der Grenze ${sprung.toFixed(1)}-fach — vorher 5,4-fach, Ziel unter 3`);

  // Durchreichen: der Look bestimmt, nur das 100-FPS-Profil behaelt seinen Preis.
  pruefe(schattenLambda(2, false, 0.05) === 0.05, 'schattenLambda gibt den Profilwert nicht weiter');
  pruefe(schattenLambda(1, true, 0.05) === 0.2, 'das 100-FPS-Profil hat seinen Lambda-Wert verloren');
  pruefe(schattenLambda(2, false) === 0.8, 'schattenLambda: Vorgabe ohne Profilwert hat sich veraendert');
  pruefe(schattenUeberblendung(2, false, 0.25) === 0.25, 'schattenUeberblendung gibt den Profilwert nicht weiter');
  pruefe(schattenUeberblendung(1, true, 0.25) === 0.2, 'das 100-FPS-Profil hat seine Ueberblendung verloren');

  // Die Stufe bleibt ein Hardwarepreis: Die Look-Aufloesung wirkt nur bis
  // zu ihrem Deckel, Kaskadenzahl und Reichweite kommen aus dem Look.
  const deckel = schattenMitLook(SHADOW_LEVELS[2]!, { ...s, aufloesung: 8192 });
  pruefe(
    deckel !== null && deckel.aufloesung === SHADOW_LEVELS[2]!.aufloesung,
    'Look-Aufloesung wird nicht am Deckel der Stufe gekappt'
  );
}


if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchatten G18: Eichung, Vorgabe und Durchreichen des Look-Profils gruen.');
