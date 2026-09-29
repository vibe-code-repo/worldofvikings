/**
 * AudibleRadius (client/src/engine/Audio/AudibleRadius.ts): the 'world'
 * bus needs the analytic radius where a spatial sound's gain has fallen
 * to 2 %, inverted from Babylon AudioV2's 'inverse' distance-model
 * formula (not measured, not eyeballed). Pure, DOM-free.
 *
 * Lauf: npx tsx client/test/audio-audible-radius.ts   (aus dem Repo-Wurzel)
 */
import { audibleRadius, inverseDistanceGain } from '../src/engine/Audio/AudibleRadius';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}
const nahe = (a: number, b: number, eps: number): boolean => Math.abs(a - b) < eps;

console.log('=== AudibleRadius ===');

console.log('\n[1] Rückwärtsprobe: bei audibleRadius() ist der Gewinn genau die Schwelle');
{
  const faelle: Array<[number, number, number]> = [
    [2, 1, 0.02],
    [1, 5, 0.02],
    [3, 0.5, 0.05],
    [10, 2, 0.1],
  ];
  for (const [minDistance, rolloff, schwelle] of faelle) {
    const r = audibleRadius(minDistance, rolloff, schwelle);
    const gewinn = inverseDistanceGain(r, minDistance, rolloff);
    pruefe(
      `minDistance=${minDistance} rolloff=${rolloff} schwelle=${schwelle}`,
      nahe(gewinn, schwelle, 1e-9),
      `radius ${r.toFixed(3)} -> Gewinn ${gewinn.toFixed(6)}`,
    );
  }
}

console.log('\n[2] Bekannter Fall: minDistance=2, rolloff=1, Standardschwelle 2 % -> Radius 100');
{
  const r = audibleRadius(2, 1);
  pruefe('Radius ist 100', nahe(r, 100, 1e-9), `${r}`);
}

console.log('\n[3] Innerhalb minDistance bleibt der Gewinn bei 1 (geklemmt):');
{
  const g = inverseDistanceGain(0.5, 2, 1);
  pruefe('Gewinn genau 1 unterhalb minDistance', g === 1, `${g}`);
}

console.log('\n[4] Größerer rolloffFactor zieht den Radius näher heran:');
{
  const r1 = audibleRadius(5, 1);
  const r2 = audibleRadius(5, 4);
  pruefe('höherer rolloff -> kleinerer Radius', r2 < r1, `r1=${r1.toFixed(2)} r2=${r2.toFixed(2)}`);
}

console.log('\n[5] Ungültige Eingaben werfen statt NaN/Infinity zu liefern:');
{
  const faelle: Array<[() => unknown, string]> = [
    [() => audibleRadius(0, 1), 'minDistance = 0'],
    [() => audibleRadius(-1, 1), 'minDistance < 0'],
    [() => audibleRadius(1, 0), 'rolloff = 0'],
    [() => audibleRadius(1, 1, 0), 'schwelle = 0'],
    [() => audibleRadius(1, 1, 1), 'schwelle = 1'],
  ];
  for (const [fn, label] of faelle) {
    let geworfen = false;
    try {
      fn();
    } catch {
      geworfen = true;
    }
    pruefe(label, geworfen);
  }
}

if (fehler > 0) {
  console.error(`\n=== AudibleRadius: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== AudibleRadius: ALLE GRÜN ===');
