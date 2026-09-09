/**
 * Wächter für die Wasserfarben, die an die neuen Ankerfarben angebunden
 * sind (`WaterPlugin.ts`, Stufe 2 „Look").
 *
 * ── Warum dieser Test ────────────────────────────────────────────────
 * Die Palette ist keine Zahlenliste mehr, sondern eine RECHNUNG: Die
 * gemessenen Materialwerte des Vorbilds werden mit dem Farbton der
 * kalibrierten Nebel- und Horizontfarbe überlagert, ohne ihre Helligkeit
 * zu ändern. An dieser Rechnung kann dreierlei schiefgehen, und keines
 * davon bricht etwas — man sähe es nur an einem Bild, das niemand macht:
 *
 *  1. Jemand schreibt ein Hex aus dem neuen Projekt ROH hinein. Dann
 *     steht ein sRGB-Wert in einer linearen Kette: zu dunkel, zu satt.
 *     Das ist die Falle, die die Analyse „Look-Übertragung ins Labor" für
 *     `Lighting.ts` beschreibt (§4, „Gamma-Fallen des alten Clients").
 *  2. Jemand ersetzt `tonUeberlagern` durch eine gerade Mischung. Dann
 *     wandert die Helligkeit mit — das Flachwasser würde mehr als doppelt
 *     so hell, weil `#dfa974` fast dreimal so hell ist wie der
 *     Materialwert.
 *  3. Das Gewicht des FERNwassers rutscht. Es ist die Farbe, die am
 *     Horizont unmittelbar an den Nebel stösst; laufen die beiden
 *     auseinander, ist die Naht eine sichtbare Kante.
 *
 * Festgehalten wird deshalb:
 *  1. Die beiden Ankerfarben sind LINEAR, nicht sRGB.
 *  2. Jede Palettenfarbe behält die Helligkeit ihres gemessenen
 *     Ausgangswerts (± 1 %).
 *  3. Die Töne sind wirklich gewandert — und in die richtige Richtung:
 *     kühl (Blau ≥ Grün) in der Tiefe und in der Ferne, warm (Rot > Grün)
 *     am flachen Saum.
 *  4. Alle Werte bleiben im Bereich 0…1 — eine Farbe über 1 wäre in einer
 *     linearen Kette kein Fehler, sondern stiller Bloom.
 */
import {
  COLOR_LOD,
  HORIZONT_LINEAR,
  NEBEL_LINEAR,
  WASSER_PALETTE,
  WASSER_PALETTE_BASIS,
  wasserLuma,
} from '../src/engine/WaterPlugin.js';

let fehler = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  if (!bedingung) {
    fehler++;
    console.error(`  FEHLER: ${text}`);
  }
};

const rund = (c: readonly number[]): string => c.map((v) => v.toFixed(4)).join(' / ');

// ── 1. Die Ankerfarben stehen im linearen Raum ───────────────────────
//
// Gegenprobe mit der Umkehrung: `x^(1/2.2) * 255` muss wieder das Hex
// ergeben, aus dem der Wert stammt. Wer versehentlich den sRGB-Wert
// stehen liesse, fiele hier durch — dessen Rückrechnung ergäbe 219 statt
// 163.
{
  const nachSrgb = (v: number): number => Math.round(Math.pow(v, 1 / 2.2) * 255);
  const nebelHex = NEBEL_LINEAR.map(nachSrgb);
  const horizontHex = HORIZONT_LINEAR.map(nachSrgb);
  pruefe(
    nebelHex[0] === 0xa3 && nebelHex[1] === 0xaf && nebelHex[2] === 0xbd,
    `Nebelfarbe rechnet nicht auf #a3afbd zurück: ${nebelHex.join(',')}`
  );
  pruefe(
    horizontHex[0] === 0xdf && horizontHex[1] === 0xa9 && horizontHex[2] === 0x74,
    `Horizontfarbe rechnet nicht auf #dfa974 zurück: ${horizontHex.join(',')}`
  );
  // Und sie sind DUNKLER als ihr sRGB-Original — die Gammakurve senkt
  // jeden Wert unter 1. Ein Wert über 163/255 = 0,639 im Rotkanal wäre
  // der unverwandelte sRGB-Wert.
  pruefe(NEBEL_LINEAR[0] < 0.639, 'Nebelfarbe sieht nach sRGB aus, nicht nach linear');
  pruefe(HORIZONT_LINEAR[0] < 0.875, 'Horizontfarbe sieht nach sRGB aus, nicht nach linear');
}

// ── 2. Die Helligkeit bleibt die gemessene ───────────────────────────
{
  const paare: ReadonlyArray<readonly [string, readonly number[], readonly number[]]> = [
    ['Schaum', WASSER_PALETTE.schaum, WASSER_PALETTE_BASIS.schaum],
    ['Flachwasser', WASSER_PALETTE.flach, WASSER_PALETTE_BASIS.flach],
    ['Tiefwasser', WASSER_PALETTE.tief, WASSER_PALETTE_BASIS.tief],
    ['Oberfläche', WASSER_PALETTE.oben, WASSER_PALETTE_BASIS.oben],
    ['Fernwasser', COLOR_LOD, WASSER_PALETTE_BASIS.fern],
  ];
  for (const [name, neu, basis] of paare) {
    const a = wasserLuma(neu as readonly [number, number, number]);
    const b = wasserLuma(basis as readonly [number, number, number]);
    pruefe(
      Math.abs(a - b) <= b * 0.01,
      `${name}: Helligkeit gewandert (${a.toFixed(4)} statt ${b.toFixed(4)}) — ` +
        'wurde tonUeberlagern durch eine gerade Mischung ersetzt?'
    );
    pruefe(
      neu.every((v) => v >= 0 && v <= 1),
      `${name}: Wert ausserhalb 0…1 — ${rund(neu)}`
    );
  }
}

// ── 3. Die Töne sind gewandert, und in die richtige Richtung ─────────
{
  // Kühle Ferne: Blau überwiegt Grün. Der Ausgangswert (0.098, 0.196,
  // 0.169) tut das NICHT — er ist türkisgrün. Genau das ist die Änderung.
  pruefe(
    WASSER_PALETTE_BASIS.tief[2] < WASSER_PALETTE_BASIS.tief[1],
    'Voraussetzung des Tests weg: der Ausgangswert war grün-dominant'
  );
  pruefe(
    COLOR_LOD[2] >= COLOR_LOD[1],
    `Fernwasser ist nicht kühler geworden: ${rund(COLOR_LOD)}`
  );
  pruefe(
    WASSER_PALETTE.tief[2] >= WASSER_PALETTE.tief[1],
    `Tiefwasser ist nicht kühler geworden: ${rund(WASSER_PALETTE.tief)}`
  );
  // Warmer Saum: Rot überwiegt Grün deutlicher als vorher.
  const vorher = WASSER_PALETTE_BASIS.flach[0] - WASSER_PALETTE_BASIS.flach[1];
  const nachher = WASSER_PALETTE.flach[0] - WASSER_PALETTE.flach[1];
  pruefe(
    nachher > vorher,
    `Flachwasser ist nicht wärmer geworden (R−G ${nachher.toFixed(4)} gegen ${vorher.toFixed(4)})`
  );
  // Das Fernwasser folgt dem Nebel STÄRKER als das Tiefwasser — sonst
  // wäre die Staffelung nach der Sichtbarkeit der Naht dahin.
  const abstand = (c: readonly number[], ziel: readonly number[]): number => {
    // Abstand im TON, also nach dem Herausrechnen der Helligkeit.
    const s = wasserLuma(c as readonly [number, number, number]) / wasserLuma(ziel as readonly [number, number, number]);
    return Math.hypot(c[0] - ziel[0] * s, c[1] - ziel[1] * s, c[2] - ziel[2] * s);
  };
  pruefe(
    abstand(COLOR_LOD, NEBEL_LINEAR) < abstand(WASSER_PALETTE.tief, NEBEL_LINEAR),
    'Fernwasser liegt nicht näher an der Nebelfarbe als das Tiefwasser'
  );
}

console.log(`  Nebel   linear ${rund(NEBEL_LINEAR)}`);
console.log(`  Horizont linear ${rund(HORIZONT_LINEAR)}`);
console.log(`  flach ${rund(WASSER_PALETTE.flach)} | tief ${rund(WASSER_PALETTE.tief)}`);
console.log(`  oben  ${rund(WASSER_PALETTE.oben)} | fern ${rund(COLOR_LOD)} | schaum ${rund(WASSER_PALETTE.schaum)}`);
console.log(
  fehler === 0
    ? '\nOK — Ankerfarben linear, Helligkeiten gehalten, Töne gewandert'
    : `\n${fehler} FEHLER`
);
process.exit(fehler > 0 ? 1 : 0);
