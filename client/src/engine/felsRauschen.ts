/**
 * Die Rauschmaske auf dem Felsanteil des Bodens — Zahlen, GLSL und die
 * Gegenrechnung auf der CPU an EINER Stelle.
 *
 * ── Warum eine eigene Datei ──────────────────────────────────────────
 * Bis zum 11.09.2026 stand die Formel nur als GLSL-Zeichenkette in
 * `TerrainSplat.ts`, und jeder, der sie prüfen wollte, hat sie
 * abgeschrieben: einmal in `~/wov-lab-mess/original-lib.mjs` (die
 * Messmaske), einmal in jeder Diagnose daneben. Eine abgeschriebene
 * Formel ist so lange richtig, bis jemand an einer der beiden Zahlen
 * dreht — danach misst die Maske eine andere Schicht, als der
 * Bildschirm zeigt, und niemandem fällt es auf, weil beide Seiten
 * plausible Zahlen liefern.
 *
 * Hier steht sie einmal als Zahlen (`FELS_RAUSCHEN`), einmal als GLSL
 * (`felsRauschenGlsl`) und einmal als TypeScript (`felsMaskeBei`). Die
 * GLSL-Zeilen werden aus denselben Zahlen ERZEUGT, die die
 * TypeScript-Fassung benutzt; `tools/test/fels-rauschen.ts` rechnet die
 * Verteilung nach und wird rot, sobald eine Zahl die Zusagen unten
 * verletzt. Babylon wird hier bewusst nicht importiert, damit ein Test
 * die Datei ohne Engine laden kann.
 *
 * ── Was die Maske tut ────────────────────────────────────────────────
 * Sie multipliziert den Felsanteil (`RAMPEN.fels.anteil`, `rau.anteil`)
 * mit einem Faktor um 1 herum, der über die WELTkoordinate läuft — nicht
 * über die Kachel-UV: Sie soll eine Landschaft zeichnen und nicht mit
 * der Textur mitwandern. Ohne sie gewinnt auf jedem Hang dieselbe
 * Mischung, und der Fels ist nirgends die stärkste Schicht (gemessen:
 * NULL Bildpunkte mit wirksamer Schicht `rock-rough`, wo vorher 3682
 * Rasterzellen standen).
 *
 * ── Die Form: zwei Glättungen, ein Ausschlag, ein Ausgleich ──────────
 * Bis zum 11.09. war der Faktor `1 + 0,9 · (2n − 1)` mit `n` als
 * Wertrauschen. Das ist erwartungstreu (das Rauschen ist symmetrisch um
 * 0,5), erreicht aber nur `0,4 · 1,9 = 0,76` Fels im stärksten Fleck und
 * — das war der eigentliche Befund — NIRGENDS reines Moos: gemessen über
 * 4 Millionen Proben lagen 0,0 % der Fläche unter `kFels` 0,05. Der
 * ganze Hang war Mischung, nur in verschiedenen Stärken.
 *
 * Das Vorbild ist anders, und zwar gemessen (`design/original-boden.md`
 * §A, Tabelle „Wie hart sind die Übergänge?"):
 *
 *     Moss very Dark                 reine Texel (w > 0,95)  19,2 %
 *     Terrain_Meadow_Rock_Moss_01    reine Texel (w > 0,95)   0,0 %
 *
 * Also: fast ein Fünftel der Karte ist reines Moos, und der helle Fels
 * ist NIRGENDS rein — er kommt über 0,95 nie hinaus. Diese zwei Zahlen
 * geben beide Enden der Verteilung vor, und die drei Zahlen unten sind
 * genau darauf gerechnet (Nachweis: `tools/test/fels-rauschen.ts`,
 * 4·10⁶ Proben):
 *
 *     Mittelwert kFels          0,4000   (unverändert = RAMPEN.fels.anteil)
 *     kFels ≥ 0,95 („rein")     0,00 %   (Vorbild 0,0 %)
 *     kFels ≤ 0,05 („kein Fels") 18,4 %  (Vorbild 19,2 %)
 *     grösster kFels            0,941
 *     Mittel kFels, wo Fels die stärkste Schicht ist   0,715 (vorher 0,558)
 *
 * `kurve` ist die Zahl der Glättungen `n ↦ n²(3−2n)`. Sie ist
 * PUNKTSYMMETRISCH zu (0,5 | 0,5) — `g(1−n) = 1 − g(n)` —, verschiebt
 * den Mittelwert eines um 0,5 symmetrischen Rauschens also nicht und
 * zieht nur Masse zu den Enden. Zwei davon bringen die 18,4 % reines
 * Moos; ohne sie bräuchte es einen Ausschlag, der oben klemmt.
 *
 * `staerke` 1,45 ist der grösste Wert, bei dem der Fels die 0,95 des
 * Vorbilds NICHT erreicht: bei 1,50 stehen 0,31 % der Fläche darüber.
 *
 * `ausgleich` ist der Erwartungswert des geklemmten Faktors. Er MUSS
 * heraus gerechnet werden, und das ist keine Kosmetik: Der Ausschlag
 * 1,45 schickt den Faktor rechnerisch bis −0,45, und `max(0, …)`
 * schneidet diese Hälfte ab. Ein abgeschnittener Schwanz hebt den
 * Mittelwert — ohne den Ausgleich stünde der Boden bei 0,417 statt
 * 0,400 Fels, und der Deckel aus `RAMPEN` (der die 0,425 des Vorbilds
 * trägt) wäre still um 4 % verschoben.
 *
 * ── Die Wellenlänge ──────────────────────────────────────────────────
 * `skala` 24 m für die erste Oktave, die zweite bei 24/2,7 ≈ 9 m. Die
 * Kante eines Flecks ist rund ein Achtel seiner Wellenlänge und trifft
 * damit die gemessenen Kantenbreiten des Vorbilds (2,7 bis 4,3 m
 * Median, §A). Unverändert seit dem 10.09.
 *
 * Noise mask on the terrain's rock share: numbers, GLSL and the CPU
 * mirror in one place, tuned to the original's measured share of pure
 * moss (19.2 %) and pure rock (0.0 %) texels.
 */

/** Die vier Zahlen der Maske. */
export const FELS_RAUSCHEN = {
  /** Wellenlänge der ersten Oktave in Metern. */
  skala: 24,
  /** Ausschlag um 1 herum, 0 = keine Maske. */
  staerke: 1.45,
  /** Zahl der punktsymmetrischen Glättungen auf dem Rauschwert. */
  kurve: 2,
  /**
   * Erwartungswert des geklemmten Faktors, durch den geteilt wird.
   *
   * Gemessen über 4·10⁶ Proben des EIGENEN Rauschens (nicht geschätzt);
   * `tools/test/fels-rauschen.ts` rechnet ihn nach und wird rot, sobald
   * der Mittelwert um mehr als 0,5 % danebenliegt.
   */
  ausgleich: 1.04132,
} as const;

/** Punktsymmetrische Glättung, `g(1−n) = 1 − g(n)`. */
function glatt(n: number): number {
  return n * n * (3 - 2 * n);
}

/**
 * Der Hash des Rauschens — Zeile für Zeile dieselbe Rechnung wie im
 * GLSL unten. `fract` heisst in GLSL `x − floor(x)` und liefert für
 * negative Zahlen einen POSITIVEN Rest; `%` in JavaScript tut das
 * nicht, deshalb die Nachbesserung.
 */
function hash21(x: number, y: number): number {
  let qx = (x * 123.34) % 1;
  let qy = (y * 456.21) % 1;
  if (qx < 0) qx += 1;
  if (qy < 0) qy += 1;
  const d = qx * qx + qy * qy + 45.32;
  qx += d;
  qy += d;
  const r = (qx * qy) % 1;
  return r < 0 ? r + 1 : r;
}

/** Wertrauschen mit glatter Interpolation (sonst Rautenmuster im Hang). */
function wertRauschen(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = glatt(x - ix);
  const fy = glatt(y - iy);
  const a = hash21(ix, iy);
  const b = hash21(ix + 1, iy);
  const c = hash21(ix, iy + 1);
  const d = hash21(ix + 1, iy + 1);
  const o1 = a + (b - a) * fx;
  const o2 = c + (d - c) * fx;
  return o1 + (o2 - o1) * fy;
}

/**
 * Der Maskenfaktor an einer Weltkoordinate — die CPU-Fassung dessen,
 * was `vbFelsRauschen` im Fragment rechnet.
 *
 * Für Messmasken und Tests. Sie ist NICHT der schnellste Weg, sondern
 * der, den man neben den Shader legen kann.
 */
export function felsMaskeBei(x: number, z: number): number {
  const s = 1 / FELS_RAUSCHEN.skala;
  let n = wertRauschen(x * s, z * s) * 0.65 + wertRauschen(x * s * 2.7, z * s * 2.7) * 0.35;
  for (let i = 0; i < FELS_RAUSCHEN.kurve; i++) n = glatt(n);
  return Math.max(0, 1 + FELS_RAUSCHEN.staerke * (n * 2 - 1)) / FELS_RAUSCHEN.ausgleich;
}

/**
 * Dieselbe Rechnung als GLSL — ERZEUGT aus denselben Zahlen, damit
 * Shader und CPU nicht auseinanderlaufen können.
 */
export function felsRauschenGlsl(): string[] {
  const { skala, staerke, kurve, ausgleich } = FELS_RAUSCHEN;
  return [
    'float vbFelsHash(vec2 p) {',
    '  vec2 q = fract(p * vec2(123.34, 456.21));',
    '  q += dot(q, q + 45.32);',
    '  return fract(q.x * q.y);',
    '}',
    'float vbFelsWert(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    // Glatte Interpolation: ohne sie sieht man das Gitter des Rauschens
    // als Rautenmuster im Hang.
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = vbFelsHash(i);',
    '  float b = vbFelsHash(i + vec2(1.0, 0.0));',
    '  float c = vbFelsHash(i + vec2(0.0, 1.0));',
    '  float d = vbFelsHash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'void vbFelsRauschen(vec3 wpos, out float result) {',
    `  float s = 1.0 / ${skala.toFixed(1)};`,
    '  float n = vbFelsWert(wpos.xz * s) * 0.65 + vbFelsWert(wpos.xz * s * 2.7) * 0.35;',
    // Die Glättungen ziehen Masse zu den Enden, ohne den Mittelwert zu
    // verschieben — siehe Kopfkommentar.
    ...Array.from({ length: kurve }, () => '  n = n * n * (3.0 - 2.0 * n);'),
    `  result = max(0.0, 1.0 + ${staerke.toFixed(3)} * (n * 2.0 - 1.0)) * ${(1 / ausgleich).toFixed(6)};`,
    '}',
  ];
}
