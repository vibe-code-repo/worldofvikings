/**
 * TAA steht hinter allen anderen Paessen (G19, A3).
 *
 * Der Konstruktor von `PostProcessing` verlangt TAA HINTEN (E13). Nach dem
 * Einschalten stellt sich das von selbst ein und geht beim naechsten
 * Umschalten eines beliebigen anderen Effekts verloren (gemessen 18.09.2026,
 * 12 von 12 Umschaltungen). Die Kettenpruefung ist eine reine Funktion ueber
 * die Namen der Kamerakette (`camera._postProcesses`, freie Plaetze `null`).
 *
 * Lauf: npx tsx client/test/taa-reihenfolge.ts
 */
import { taaStehtHinten } from '../src/engine/PostProcessing';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

console.log('TAA-Reihenfolge (G19, A3)');

// ── G19 (A3) TAA steht hinter allen anderen Paessen ──────────────────
{
  const kette = (...namen: (string | null)[]) => namen.map((n) => (n === null ? null : { name: n }));
  pruefe(
    taaStehtHinten(kette('valheimDof', 'imageProcessing', 'fxaa', 'TAA', 'TAAPass')),
    'TAA am Ende wird als „nicht hinten" gemeldet'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'TAA', null, 'imageProcessing', 'TAAPass', null)) === false,
    'TAAPass nach einem Fremdpass bedeutet: TAA steht nicht mehr hinten'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'TAA', 'TAAPass', 'highlights', 'imageProcessing', 'fxaa')) === false,
    'nach dem Umschalten von Bloom steht TAA vorn — das war der gemessene Fehler'
  );
  pruefe(
    taaStehtHinten(kette('valheimDof', 'imageProcessing', 'fxaa', 'valheimMotionBlur', 'TAA', 'TAAPass', null, null)),
    'freie Plaetze am Kettenende (null) duerfen die Pruefung nicht stoeren'
  );
  pruefe(taaStehtHinten(kette('TAA', 'TAAPass', 'fxaa')) === false, 'TAA ganz vorn wurde als hinten gemeldet');
  pruefe(taaStehtHinten(kette('fxaa', 'TAAPass', 'TAA')) === false, 'vertauschte Reihenfolge TAAPass/TAA gilt nicht');
  pruefe(taaStehtHinten(kette()) === false && taaStehtHinten(kette('TAA')) === false, 'leere oder unvollstaendige Kette gilt nicht');
}


if (fehler > 0) {
  console.error(`\n${fehler} Fehler`);
  process.exit(1);
}
console.log('\nTAA-Reihenfolge: hinten erkannt, nach Umschalten vorn erkannt.');
