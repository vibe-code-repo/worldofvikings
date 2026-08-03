#!/usr/bin/env node
/**
 * Kleines Diagnose-Werkzeug: dekodiert ein PNG vollständig (inkl.
 * Rückrechnung der Zeilenfilter) und gibt pro Kanal Min/Max/Mittelwert
 * sowie das Histogramm-Profil aus.
 *
 * Grund: Statistiken über die ROHEN IDAT-Bytes sind wertlos, sobald ein
 * Bild andere Zeilenfilter als 0 (None) benutzt — genau das ist bei den
 * Unity-Exporten der Fall. Ohne Rückrechnung entscheidet man auf Basis
 * von Zufallszahlen, welchen Kanal ein Shader sampeln soll.
 *
 * Aufruf: node tools/png-stats.mjs <datei.png> [...]
 *         node tools/png-stats.mjs --slices 16 terrain_d_array.png
 *
 * `--slices N` zerlegt das Bild in N gleich hohe horizontale Streifen und
 * gibt die Statistik je Streifen aus. Gedacht für gestapelte Tile-Atlanten
 * (terrain_d_array.png = 16 Tiles à 256 px): so sieht man sofort, welcher
 * Tile-Index leer/schwarz ist — ein leerer Fels-Tile erklärt z. B. sofort
 * "das Terrain hat keine Textur".
 */
import { decode } from './lib/png.mjs';


const argv = process.argv.slice(2);
let slices = 1;
const si = argv.indexOf('--slices');
if (si >= 0) {
  slices = Number(argv[si + 1]);
  argv.splice(si, 2);
}

/** Statistik über einen Zeilenbereich [y0,y1). */
function report(label, data, w, ch, y0, y1) {
  const mn = new Array(ch).fill(255);
  const mx = new Array(ch).fill(0);
  const sum = new Array(ch).fill(0);
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      for (let c = 0; c < ch; c++) {
        const v = data[o + c];
        if (v < mn[c]) mn[c] = v;
        if (v > mx[c]) mx[c] = v;
        sum[c] += v;
      }
      n++;
    }
  }
  const names = ch === 4 ? ['R', 'G', 'B', 'A'] : ch === 3 ? ['R', 'G', 'B'] : ch === 2 ? ['G', 'A'] : ['G'];
  const parts = names.map((nm, c) => `${nm} ${String(mn[c]).padStart(3)}..${String(mx[c]).padStart(3)} ø${String(Math.round(sum[c] / n)).padStart(3)}`);
  // "leer" = überhaupt keine Variation in RGB ⇒ einfarbige Fläche
  const flat = mn[0] === mx[0] && mn[1] === mx[1] && mn[2] === mx[2];
  console.log(`${label}  ${parts.join('  ')}${flat ? '   ⚠ EINFARBIG' : ''}`);
}

for (const file of argv) {
  const { w, h, ch, ct, data } = decode(file);
  console.log(`\n${file.split('/').pop()}  ${w}x${h} ct${ct}`);
  if (slices <= 1) {
    report('  gesamt', data, w, ch, 0, h);
  } else {
    const sliceH = Math.floor(h / slices);
    for (let s = 0; s < slices; s++) {
      report(`  #${String(s).padStart(2)}`, data, w, ch, s * sliceH, (s + 1) * sliceH);
    }
  }
}
