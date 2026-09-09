/**
 * Die Instanz-Tönung der Store-Vegetation (Stufe 2, Bauer „Leistung").
 *
 * Ein Store-Wald sieht gestempelt aus, weil sich alle Bäume einer Art ein
 * Material und damit einen Farbfaktor teilen. Der Ersatz für das
 * Weltraum-Rauschen des Vorbilds ist eine Farbe je Thin-Instance
 * (`EntityManager.instanzToenung`).
 *
 * Diese Sonde prüft, was ohne sie LAUTLOS schiefginge:
 *
 *  1. DETERMINISMUS. Dieselbe Weltposition ergibt immer dieselbe Farbe —
 *     auch nach einem Neuaufbau des Buckets, in dem die Instanz einen
 *     anderen Index bekommt. Wäre die Farbe an den Index gebunden,
 *     wechselte ein Baum beim Vorbeilaufen die Farbe, und das sähe aus
 *     wie ein Flackern des Lichts.
 *  2. STREUUNG. Die Farben streuen wirklich. Ein Schalter, der nichts
 *     tut, sieht aus wie „die Amplitude ist zu klein" — die Varianz
 *     entscheidet das, nicht das Auge.
 *  3. AMPLITUDE. Die Streuung bleibt in dem Fenster, das die
 *     Look-Analyse nennt (5–8 % Luma). Zu viel liest sich als kranker
 *     Wald.
 *  4. KEIN GRAUSCHLEIER. Der Mittelwert bleibt bei 1,0 — die Tönung
 *     verschiebt die Gesamthelligkeit des Waldes nicht, sie streut nur
 *     um ihn herum. Sonst wäre jede Look-Messung danach um einen
 *     unbekannten Betrag verschoben.
 *  5. GERASTERT. Zwei Positionen, die sich um weniger als das Raster
 *     unterscheiden, ergeben dieselbe Farbe. Der Server schickt f32, der
 *     Client rechnet über eine Matrix zurück; ohne Rasterung entschiede
 *     das letzte Bit.
 *
 *   npx tsx client/test/instanz-toenung.ts
 */
import {
  instanzToenung,
  toenungsRauschen,
  TOENUNG_LUMA,
  TOENUNG_TON,
  INSTANZ_TOENUNG_AN,
} from '../src/entities/EntityManager';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const farbe = (x: number, z: number): [number, number, number, number] => {
  const a = new Float32Array(4);
  instanzToenung(x, z, a, 0);
  return [a[0]!, a[1]!, a[2]!, a[3]!];
};
const luma = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

check('Der Schalter steht an', INSTANZ_TOENUNG_AN);

// ── 1. Determinismus ─────────────────────────────────────────────────
const a1 = farbe(10077.3, -18723.7);
const a2 = farbe(10077.3, -18723.7);
check('dieselbe Position ergibt dieselbe Farbe', a1.every((v, i) => v === a2[i]));

// Und über die ganze Fläche, nicht nur an einem Punkt: 2000 Positionen,
// zweimal in UMGEKEHRTER Reihenfolge gerechnet. Ein Zustand zwischen den
// Aufrufen (ein Zähler, ein Math.random) fiele hier auf und sonst nirgends.
const orte: Array<[number, number]> = [];
for (let i = 0; i < 2000; i++) orte.push([10000 + i * 0.37, -18700 - i * 0.91]);
const vorwaerts = orte.map(([x, z]) => farbe(x, z));
const rueckwaerts = [...orte].reverse().map(([x, z]) => farbe(x, z)).reverse();
check(
  'Reihenfolge ändert nichts (2000 Positionen)',
  vorwaerts.every((c, i) => c.every((v, k) => v === rueckwaerts[i]![k]))
);

// ── 5. Rasterung ─────────────────────────────────────────────────────
check(
  'Positionen unter 1 mm Abstand ergeben dieselbe Farbe',
  farbe(10077.30001, -18723.7).every((v, i) => v === a1[i])
);
check(
  'Positionen ein halbes Raster auseinander ergeben verschiedene Farben',
  JSON.stringify(farbe(10077.3, -18723.7)) !== JSON.stringify(farbe(10077.9, -18723.7))
);

// ── 2.-4. Streuung, Amplitude, Mittelwert ────────────────────────────
const lumen = vorwaerts.map(luma);
const mittel = lumen.reduce((s, v) => s + v, 0) / lumen.length;
const varianz = lumen.reduce((s, v) => s + (v - mittel) ** 2, 0) / lumen.length;
const min = Math.min(...lumen);
const max = Math.max(...lumen);

check(`Varianz der Luma > 0 (${varianz.toExponential(2)})`, varianz > 0);
/*
  Die untere Schranke ist gerechnet, nicht geraten: Bei
  Gleichverteilung über [1-A, 1+A] ist die Varianz A²/3. Mit A = 0,07
  sind das 1,63e-3. Verlangt wird die Hälfte davon — genug Luft für die
  endliche Stichprobe, aber weit über allem, was eine wirkungslose
  Tönung liefern könnte.
*/
check(
  `Varianz erreicht die Hälfte des Erwartungswerts (${varianz.toExponential(2)} >= ${((TOENUNG_LUMA ** 2 / 3) / 2).toExponential(2)})`,
  varianz >= TOENUNG_LUMA ** 2 / 3 / 2
);
/*
  Die Schranke ist AUSGERECHNET, nicht mit einem Sicherheitszuschlag
  geraten — und dabei ist aufgefallen, dass die Farbtondrift die Luma
  eben nicht ganz in Ruhe lässt:

    Luma(L(1+t), L, L(1-t)) = L · (0,2126(1+t) + 0,7152 + 0,0722(1-t))
                            = L · (1 + 0,1404 · t)

  Rot wiegt in der Luma dreimal so schwer wie Blau, also hebt ein warmer
  Ton mehr an, als ein kühler wegnimmt. Bei t = ±0,05 sind das ±0,70 %
  obendrauf; das Fenster ist damit ±7,70 % und nicht ±7,00 %. Kein
  Grund, die Amplitude zu ändern (die Look-Analyse nennt 5–8 %) — aber
  ein Grund, die Zahl hier richtig hinzuschreiben statt sie mit einem
  Faktor 1,05 zuzudecken.

  Und die beiden Achsen wirken MULTIPLIKATIV aufeinander (die Drift
  sitzt auf der schon gestreuten Luma), die Schranke ist also ein
  Produkt und keine Summe. Der Unterschied sind 0,05 Prozentpunkte —
  genau so viel, wie der zweite Anlauf dieses Tests danebenlag.
*/
const LUMA_OBEN = (1 + TOENUNG_LUMA) * (1 + (0.2126 - 0.0722) * TOENUNG_TON);
const LUMA_UNTEN = (1 - TOENUNG_LUMA) * (1 - (0.2126 - 0.0722) * TOENUNG_TON);
const LUMA_FENSTER = LUMA_OBEN - 1;
check(
  `Luma bleibt zwischen ${LUMA_UNTEN.toFixed(4)} und ${LUMA_OBEN.toFixed(4)} (${min.toFixed(4)} … ${max.toFixed(4)})`,
  min >= LUMA_UNTEN && max <= LUMA_OBEN
);
check(
  `das Fenster bleibt unter den 8 %, die die Look-Analyse nennt (${(LUMA_FENSTER * 100).toFixed(2)} %)`,
  LUMA_FENSTER <= 0.08
);
check(`Mittelwert bleibt bei 1,0 (${mittel.toFixed(4)})`, Math.abs(mittel - 1) < 0.01);

// Die Farbtondrift ist wirklich gegenläufig — sonst wäre sie eine zweite
// Helligkeit und keine Drift.
const drift = vorwaerts.map((c) => c[0]! / c[1]! - c[2]! / c[1]!);
const driftMax = Math.max(...drift.map(Math.abs));
check(
  `R und B driften gegenläufig, höchstens ±${(2 * TOENUNG_TON * 100).toFixed(0)} % (${driftMax.toFixed(3)})`,
  driftMax > 0 && driftMax <= 2 * TOENUNG_TON * 1.05
);

// Alpha muss 1 sein: Babylons `hasVertexAlpha`-Pfad würde die Bäume sonst
// in den Transparenzdurchgang ziehen — sortiert, ohne Tiefenschreiben,
// und damit sichtbar falsch geschichtet.
check(
  'Alpha ist überall genau 1',
  vorwaerts.every((c) => c[3] === 1)
);

// ── Gleichverteilung des Rauschens ───────────────────────────────────
// Ein Hash, der auf wenige Werte zusammenfällt, bestünde alle Prüfungen
// oben und liefe trotzdem auf drei Grüntöne hinaus.
const eimer = new Array(10).fill(0);
for (const [x, z] of orte) eimer[Math.min(9, Math.floor(toenungsRauschen(x, z).a * 10))]!++;
const erwartet = orte.length / 10;
check(
  `Rauschen füllt alle zehn Zehntel (${eimer.join('/')})`,
  eimer.every((n) => n > erwartet * 0.5 && n < erwartet * 1.5)
);
// Die zweite Zahl darf nicht die erste sein — sonst wären Helligkeit und
// Farbton dieselbe Achse und der Wald hätte nur eine Streuung.
const paare = orte.map(([x, z]) => toenungsRauschen(x, z));
const ma = paare.reduce((s, p) => s + p.a, 0) / paare.length;
const mb = paare.reduce((s, p) => s + p.b, 0) / paare.length;
const kov =
  paare.reduce((s, p) => s + (p.a - ma) * (p.b - mb), 0) / paare.length;
check(`die beiden Zufallszahlen sind unkorreliert (Kovarianz ${kov.toExponential(2)})`, Math.abs(kov) < 0.01);

console.log(fehler === 0 ? '\nalles grün' : `\n${fehler} Fehlschläge`);
process.exit(fehler === 0 ? 0 : 1);
