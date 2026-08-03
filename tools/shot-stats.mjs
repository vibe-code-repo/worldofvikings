#!/usr/bin/env node
/**
 * Misst die Bildstatistik eines Screenshots — das Werkzeug hinter allen
 * Zahlen in Docs/07-Grafik-Konzept.md.
 *
 * Aufruf: node tools/shot-stats.mjs <bild.png> [x0 y0 x1 y1] [...]
 *         node tools/shot-stats.mjs screenshots/heute.png 300 700 1600 950
 *
 * Warum diese fünf Kennzahlen und keine anderen:
 *
 *  - **RGB-Mittel** zeigt Kanal-Crushs. Ein Boden mit R71 G77 B12 hat kein
 *    Farbproblem im üblichen Sinn, sondern einen auf ein Sechstel
 *    zusammengedrückten Blaukanal — das ist der Fingerabdruck einer
 *    doppelten Gamma-Kodierung (Docs/07, Ursache A).
 *  - **Sättigung** steigt bei genau diesem Fehler, statt zu fallen: das
 *    Potenzieren mit 2.2 spreizt Kanalverhältnisse. 84 % gegen 31 % im
 *    Original war der erste harte Hinweis.
 *  - **Streuung (sd)** der Luminanz misst, wie viel Binnenstruktur eine
 *    Fläche hat. Halbierte Streuung heißt: gleichmäßig gefärbte Flächen
 *    ohne Schattierung — der eigentliche "Minecraft"-Eindruck.
 *  - **Entropie** misst den genutzten Tonwertumfang insgesamt. Unser Bild
 *    lag bei 6,41 bit gegen 7,32 bit im Original.
 *  - **Anteil > 128** deckt fehlende Lichtspitzen auf: 0,5 % bei uns gegen
 *    39 % im Original heißt, dass praktisch nur die untere Tonwerthälfte
 *    benutzt wird.
 *
 * Die Zahlen sind nur untereinander vergleichbar, wenn sie mit DIESEM
 * Werkzeug und auf derselben Bildregion erhoben werden — deshalb liegt es
 * im Repo statt als Wegwerf-Skript.
 */
import { decode } from './lib/png.mjs';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Aufruf: node tools/shot-stats.mjs <bild.png> [x0 y0 x1 y1] [...]');
  process.exit(1);
}

/** Zerlegt die Argumente in Gruppen aus Datei + optionaler Region. */
function* jobs(args) {
  for (let i = 0; i < args.length; ) {
    const file = args[i++];
    const zahlen = [];
    while (i < args.length && /^-?\d+$/.test(args[i])) zahlen.push(Number(args[i++]));
    yield { file, box: zahlen.length === 4 ? zahlen : null };
  }
}

function messen(file, box) {
  const { w, h, ch, data } = decode(file);
  const [x0, y0, x1, y1] = box
    ? [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(w, box[2]), Math.min(h, box[3])]
    : [0, 0, w, h];
  if (x1 <= x0 || y1 <= y0) throw new Error(`${file}: leere Region`);

  let sr = 0, sg = 0, sb = 0, sSat = 0, sL = 0, sL2 = 0, hell = 0, n = 0;
  const hist = new Uint32Array(256);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * w + x) * ch;
      const r = data[o], g = data[o + 1], b = ch >= 3 ? data[o + 2] : data[o];
      sr += r; sg += g; sb += b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 0) sSat += (mx - mn) / mx;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sL += l; sL2 += l * l;
      if (l > 128) hell++;
      hist[Math.min(255, Math.round(l))]++;
      n++;
    }
  }

  const mL = sL / n;
  const sd = Math.sqrt(Math.max(sL2 / n - mL * mL, 0));
  // Shannon-Entropie über das Luminanz-Histogramm, in bit (max 8)
  let ent = 0;
  for (const c of hist) if (c > 0) { const p = c / n; ent -= p * Math.log2(p); }

  return {
    w, h, n,
    r: sr / n, g: sg / n, b: sb / n,
    sat: (sSat / n) * 100,
    lum: mL, sd, ent,
    hell: (hell / n) * 100,
  };
}

const f2 = (v, k = 1) => v.toFixed(k).padStart(5);

for (const { file, box } of jobs(argv)) {
  let s;
  try {
    s = messen(file, box);
  } catch (e) {
    console.error(`${file}: ${e.message}`);
    continue;
  }
  const wo = box ? `[${box.join(' ')}]` : 'gesamt';
  console.log(`\n${file.split('/').pop()}  ${s.w}x${s.h}  ${wo}  (${s.n} px)`);
  console.log(`  RGB      ${f2(s.r)} ${f2(s.g)} ${f2(s.b)}`);
  console.log(`  Sättigung${f2(s.sat)} %`);
  console.log(`  Luminanz ${f2(s.lum)}   Streuung sd ${f2(s.sd)}`);
  console.log(`  Entropie ${f2(s.ent, 2)} bit   über 128: ${f2(s.hell)} %`);
}
