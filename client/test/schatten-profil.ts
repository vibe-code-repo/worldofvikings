/**
 * Schattenfassung des 100-FPS-Profils (E25).
 *
 * Das Profil darf ausschliesslich die niedrige Stufe ueberschreiben;
 * alle normalen Qualitaetsstufen muessen unveraendert bleiben. Die
 * Zuordnung ist bewusst als reine Funktion pruefbar, weil Babylons
 * CascadedShadowGenerator von der GPU-losen NullEngine nicht unterstuetzt
 * wird. Der Generator-Neuaufbau selbst wird im WebGL-Lauf geprueft.
 *
 * Lauf: npx tsx client/test/schatten-profil.ts
 */

import { SHADOW_LEVELS, schattenKonfiguration } from '../src/engine/Shadows';

let fehler = 0;
function pruefe(bedingung: boolean, was: string): void {
  if (!bedingung) {
    fehler++;
    console.log(`  FEHLGESCHLAGEN: ${was}`);
  }
}

const normal = schattenKonfiguration(1, false);
pruefe(normal === SHADOW_LEVELS[1], 'normale Stufe 1 wurde umgedeutet');
pruefe(normal?.aufloesung === 512, 'normale Stufe 1 ist nicht 512 px');
pruefe(normal?.kaskaden === 2, 'normale Stufe 1 hat nicht zwei Kaskaden');
pruefe(normal?.distanz === 80, 'normale Stufe 1 reicht nicht 80 m');

const profil = schattenKonfiguration(1, true);
pruefe(profil !== SHADOW_LEVELS[1], 'Profil verwendet versehentlich die normale Stufe');
pruefe(profil?.aufloesung === 1024, 'Profil verwendet nicht 1024 px');
pruefe(profil?.kaskaden === 2, 'Profil hat nicht zwei Kaskaden');
pruefe(profil?.distanz === 80, 'Profil reicht nicht 80 m');

for (const stufe of [0, 2, 3]) {
  pruefe(
    schattenKonfiguration(stufe, true) === SHADOW_LEVELS[stufe],
    `Profil greift ungewollt in Stufe ${stufe} ein`
  );
}
pruefe(schattenKonfiguration(-1, true) === null, 'ungueltige negative Stufe liefert Konfiguration');
pruefe(schattenKonfiguration(99, true) === null, 'ungueltige hohe Stufe liefert Konfiguration');

if (fehler > 0) {
  console.log(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nSchattenprofil: Profilwerte und alle Profilgrenzen gruen.');
