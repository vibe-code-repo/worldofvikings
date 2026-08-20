/**
 * A2 (Security-Review): gepruefteWaffe darf den Waffennamen aus dem
 * Angriffs-/Ernte-Paket nur uebernehmen, wenn er tatsaechlich im
 * Server-Inventar liegt — sonst faellt der Schaden auf Faust zurueck.
 * Reine Funktion, kein Server/Socket noetig.
 *
 * Vorher liess sich per Paketfeld Axtschaden ohne Axt erzielen, und
 * handleHarvest uebernahm dieselbe (ungeprueften) Waffe fuer die
 * Werkzeugpflicht beim Ernten.
 *
 * Run: npx tsx server/test/a2-waffe-inventar.ts
 */

import { Inventory, findItem } from '@wov/shared';
import { gepruefteWaffe } from '../src/WovServer.js';

let failures = 0;
const check = (label: string, actual: string, expected: string): void => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: "${actual}" (expect "${expected}")`);
};

// Leeres Inventar: Faust bleibt Faust, keine Paketwaffe wird angenommen.
const leer = new Inventory();
check('leeres Inventar, Faust bleibt Faust', gepruefteWaffe(leer, ''), '');
check('leeres Inventar, Axt im Paket wird abgelehnt', gepruefteWaffe(leer, 'AxeFlint'), '');
check('leeres Inventar, unbekannter Name wird abgelehnt', gepruefteWaffe(leer, 'Excalibur'), '');

// Axt im Inventar: Paketfeld "AxeFlint" wird uebernommen.
const mitAxt = new Inventory();
const axtDef = findItem('AxeFlint');
if (!axtDef) throw new Error('itemDefs kennt AxeFlint nicht mehr — Testannahme veraltet');
mitAxt.addItem(axtDef, 1);
check('Axt im Inventar, Axt im Paket wird uebernommen', gepruefteWaffe(mitAxt, 'AxeFlint'), 'AxeFlint');
// Spitzhacke NICHT im Inventar — trotz Axt darin wird sie nicht akzeptiert.
check('Axt im Inventar, Spitzhacke im Paket wird abgelehnt', gepruefteWaffe(mitAxt, 'PickaxeAntler'), '');
// Besitz einer Waffe erzwingt sie nicht — Faust bleibt weiterhin waehlbar.
check('Axt im Inventar, Faust im Paket bleibt Faust', gepruefteWaffe(mitAxt, ''), '');

console.log(failures === 0 ? '\n=== A2 gepruefteWaffe: ALL PASSED ===' : `\n=== A2 gepruefteWaffe: ${failures} FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
