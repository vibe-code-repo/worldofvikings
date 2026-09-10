/**
 * Feste Simulationsschritte auf einer schwankenden Taktrate.
 * Fixed simulation steps on top of a variable tick rate.
 *
 * Der Server rechnete die Spielerbewegung bisher gegen die WANDUHR: Die
 * Spanne zwischen zwei Eingabepaketen ging als `deltaSec` direkt in die
 * Strecke. Solange nur eine Gerade integriert wird, faellt das nicht auf;
 * sobald eine Hinderniskante im Spiel ist, sehr wohl — bei 0,4 s Spanne
 * springt die Figur 3 m weit, und ob dazwischen ein Felsen stand, kann
 * kein Strahl mehr beantworten (er trifft ihn ja, aber die Bewegung ist
 * schon vorbei). Mit festen Schritten ist die groesste Strecke, die ein
 * einzelner Schritt zuruecklegt, 7,5 / 60 = 12,5 cm.
 *
 * Der Akkumulator sammelt echte Zeit und gibt GANZE Schritte heraus; der
 * Rest wird getragen. Er ist unveraenderlich: `weiter()` gibt einen neuen
 * Akkumulator zurueck, statt den alten zu beschreiben — ein Aufrufer kann
 * damit nichts halb aktualisieren.
 */
import { MAX_SCHRITTE, SCHRITT_LAENGE } from './masse.js';

/** Der getragene Rest. The carried remainder. */
export interface Akkumulator {
  /** Laenge eines Schritts in Sekunden. */
  readonly schrittLaenge: number;
  /** Gesammelte, noch nicht simulierte Zeit in Sekunden. */
  readonly rest: number;
  /** Obergrenze der Schritte je Aufruf. */
  readonly maxSchritte: number;
}

/** Was ein Aufruf aus einer Zeitspanne gemacht hat. */
export interface SchrittErgebnis {
  /** Der Akkumulator fuer den naechsten Aufruf. */
  readonly akku: Akkumulator;
  /** Wie oft der Bewegungsschritt mit `akku.schrittLaenge` laufen muss. */
  readonly schritte: number;
  /** Sekunden, die der Deckel weggeworfen hat. Seconds dropped by the cap. */
  readonly verworfen: number;
}

/** Legt einen leeren Akkumulator an. Creates an empty accumulator. */
export function neuerAkkumulator(
  schrittLaenge = SCHRITT_LAENGE,
  maxSchritte = MAX_SCHRITTE
): Akkumulator {
  if (!Number.isFinite(schrittLaenge) || schrittLaenge <= 0) {
    throw new RangeError(`neuerAkkumulator: schrittLaenge muss > 0 sein, war ${schrittLaenge}`);
  }
  if (!Number.isInteger(maxSchritte) || maxSchritte < 1) {
    throw new RangeError(`neuerAkkumulator: maxSchritte muss >= 1 sein, war ${maxSchritte}`);
  }
  return { schrittLaenge, rest: 0, maxSchritte };
}

/**
 * Nimmt eine Zeitspanne auf und sagt, wie viele feste Schritte sie kauft.
 *
 * Die Schrittzahl ist eine DIVISION, keine Abzugsschleife. Der
 * Unterschied ist nicht die Geschwindigkeit, sondern die Rundung: Wer in
 * einer Schleife 60-mal 1/60 abzieht, sammelt 60 Rundungsfehler im Rest;
 * wer einmal teilt, keinen. 30 Aufrufe mit 1/30 s ergeben so exakt
 * dieselben 60 Schritte wie 60 Aufrufe mit 1/60 s.
 *
 * Ueber dem Deckel wird der Ueberschuss ABSICHTLICH verworfen: Ihn zu
 * tragen machte den naechsten Aufruf noch teurer — das ist die Spirale,
 * gegen die der Deckel steht.
 */
export function weiter(akku: Akkumulator, spanne: number): SchrittErgebnis {
  if (!Number.isFinite(spanne) || spanne < 0) {
    throw new RangeError(`weiter: spanne muss endlich und >= 0 sein, war ${spanne}`);
  }

  const { schrittLaenge, maxSchritte } = akku;
  const offen = akku.rest + spanne;
  const gewuenscht = Math.floor(offen / schrittLaenge);
  const schritte = gewuenscht < maxSchritte ? gewuenscht : maxSchritte;
  const verbraucht = schritte * schrittLaenge;
  const ueber = gewuenscht > maxSchritte;

  return {
    akku: { schrittLaenge, rest: ueber ? 0 : offen - verbraucht, maxSchritte },
    schritte,
    verworfen: ueber ? offen - verbraucht : 0,
  };
}
