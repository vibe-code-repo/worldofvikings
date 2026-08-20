/**
 * GPU-/DOM-freier Vertrag für die Weltzeit-Umrechnung (Minimap-Anzeige,
 * s. ui/Weltzeit.ts): Mitternacht, Mittag, Sonnenaufgang, Randwerte 0/1
 * und Überlauf.
 */
import { FRACTION_SUNRISE, FRACTION_SUNSET } from '@wov/shared';
import { weltzeitAus } from '../src/ui/Weltzeit';

function fordere(an: boolean, text: string): void {
  if (!an) throw new Error(text);
}

console.log('[1] Mitternacht');
{
  const w = weltzeitAus(0);
  fordere(w.stunde === 0 && w.minute === 0, `00:00 erwartet, erhalten ${w.stunde}:${w.minute}`);
  fordere(w.sonnenstand === 'mond', `Mond um Mitternacht erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[2] Mittag');
{
  const w = weltzeitAus(0.5);
  fordere(w.stunde === 12 && w.minute === 0, `12:00 erwartet, erhalten ${w.stunde}:${w.minute}`);
  fordere(w.sonnenstand === 'sonne', `Sonne am Mittag erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[3] Sonnenaufgang (FRACTION_SUNRISE, 3.2h = 03:12)');
{
  const w = weltzeitAus(FRACTION_SUNRISE);
  fordere(w.stunde === 3 && w.minute === 12, `03:12 erwartet, erhalten ${w.stunde}:${w.minute}`);
  fordere(w.sonnenstand === 'aufgang', `"aufgang" auf der Schwelle erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[4] Sonnenuntergang (FRACTION_SUNSET, 20.4h = 20:24)');
{
  const w = weltzeitAus(FRACTION_SUNSET);
  fordere(w.stunde === 20 && w.minute === 24, `20:24 erwartet, erhalten ${w.stunde}:${w.minute}`);
  fordere(w.sonnenstand === 'untergang', `"untergang" auf der Schwelle erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[5] Mitten am Tag, weit von beiden Schwellen entfernt');
{
  const w = weltzeitAus(0.3);
  fordere(w.sonnenstand === 'sonne', `Sonne bei 30 % Tagesbruchteil erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[6] Tiefe Nacht, weit von beiden Schwellen entfernt');
{
  const w = weltzeitAus(0.95);
  fordere(w.sonnenstand === 'mond', `Mond bei 95 % Tagesbruchteil erwartet, erhalten ${w.sonnenstand}`);
}

console.log('[7] Randwert 0 und 1 liefern dasselbe (voller Tageskreis)');
{
  const a = weltzeitAus(0);
  const b = weltzeitAus(1);
  fordere(a.stunde === b.stunde && a.minute === b.minute && a.sonnenstand === b.sonnenstand, '0 und 1 müssen identisch abgebildet werden');
}

console.log('[8] Überlauf (>1 und negativ) faltet auf den Tageskreis zurück');
{
  const w = weltzeitAus(1.3); // == 0.3
  fordere(w.stunde === 7 && w.minute === 12, `07:12 erwartet (1.3 == 0.3 Tagesbruchteil), erhalten ${w.stunde}:${w.minute}`);

  const n = weltzeitAus(-0.1); // == 0.9
  fordere(n.stunde === 21 && n.minute === 36, `21:36 erwartet (-0.1 == 0.9 Tagesbruchteil), erhalten ${n.stunde}:${n.minute}`);
  fordere(n.sonnenstand === 'mond', `Mond bei -0.1 erwartet, erhalten ${n.sonnenstand}`);
}

console.log('\nAlle Weltzeit-Tests grün.');
