/**
 * GPU-freier Vertrag fuer die Grafikoption "Vegetationsgrenze".
 *
 * Geprueft werden der unveraenderte Standard (0 = unbegrenzt), die
 * Kreisgrenze inklusive Rand und die ausschliessliche Verwendung von X/Z:
 * Hoehenunterschiede duerfen einen Baum nicht aus dem Bild entfernen.
 */
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { vegetationsMatrizenImRadius } from '../src/entities/EntityManager';

function bei(x: number, y: number, z: number): Matrix {
  return Matrix.Translation(x, y, z);
}

function fordere(an: boolean, text: string): void {
  if (!an) throw new Error(text);
}

const alle = [
  bei(10, 500, 20),      // Mittelpunkt, beliebige Hoehe
  bei(13, -200, 24),     // Abstand 5, exakt auf dem Rand
  bei(13.01, 0, 24),     // knapp ausserhalb
  bei(-30, 7, 20),       // Abstand 40
];

const unbegrenzt = vegetationsMatrizenImRadius(alle, 10, 20, 0);
fordere(unbegrenzt === alle, '0 m muss den vorhandenen Vollbestand unveraendert liefern');

const nah = vegetationsMatrizenImRadius(alle, 10, 20, 5);
fordere(nah.length === 2, `5-m-Kreis: 2 Treffer erwartet, erhalten ${nah.length}`);
fordere(nah[0] === alle[0] && nah[1] === alle[1], 'Rand oder X/Z-Auswahl ist falsch');

const vierzig = vegetationsMatrizenImRadius(alle, 10, 20, 40);
fordere(vierzig.length === 4, `40-m-Kreis: 4 Treffer erwartet, erhalten ${vierzig.length}`);

console.log('Vegetationsgrenze: unbegrenzt, Kreisrand und Hoehenunabhaengigkeit OK');
