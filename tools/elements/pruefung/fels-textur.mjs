// Prüft: dass das Fels-Texturpaar kachelt, das Format der Bestandstexturen trägt und Relief statt Mauerwerk zeigt.
//
// ── Warum diese Sonde ────────────────────────────────────────────────
// „Sieht nach Fels aus" ist ein Urteil, das nur Mike fällen kann — aber
// die drei Arten, auf die eine Textur STILL kaputt ist, kann man zählen:
//
//   1. Sie kachelt nicht. Der Fehler zeigt sich erst an der Wand, als
//      Gitternetz aus Nähten, und nie in der Datei selbst.
//   2. Sie hat das falsche Format. Der Shader lädt sie trotzdem, und
//      erst das Texturbudget oder eine 2048er-Kante fällt später auf.
//   3. Sie ist Mauerwerk. Genau das soll der Fels ABLÖSEN — und
//      Ziegelverband hat eine Signatur, die man messen kann: waagerechte
//      Fugen färben den senkrechten Helligkeitsgradienten viel stärker
//      als den waagerechten.
//
// Die Sonde misst deshalb Nahtstetigkeit, Format und Anisotropie, dazu
// die Reliefstärke der Normal-Karte und die Grobstruktur des Albedos
// (Platten statt Schleifpapier). Sie urteilt nicht über Schönheit.
//
// Bewusst OHNE PIL/numpy und ohne Blender: ein 8-Bit-RGB-PNG ohne
// Interlace ist mit `node:zlib` in fünfzig Zeilen gelesen, und diese
// Sonde soll überall laufen, wo `assets/` liegt — nicht nur dort, wo
// eine Python-Umgebung steht.
//
// Aufruf: node tools/elements/pruefung/fels-textur.mjs [<albedo.png>]
// Ohne Argument: assets/models/stein_fels.png (+ _normal per Konvention).
//
// Checks the rock texture pair: tiling, format, and relief instead of brickwork.

import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let fehler = 0;
/** Eine Prüfung mit ihrem gemessenen Wert — die Zahl steht immer dabei. */
function pruefe(name, bedingung, wert = '') {
  if (bedingung) console.log(`  ok   ${name}${wert ? `  [${wert}]` : ''}`);
  else {
    fehler++;
    console.error(`  ROT  ${name}${wert ? `  [${wert}]` : ''}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PNG lesen — nur der eine Fall, den die Steintexturen wirklich haben
// ─────────────────────────────────────────────────────────────────────

/**
 * Ein PNG (8 Bit, RGB oder RGBA, ohne Interlace) zu `{w, h, kanaele, daten}`.
 *
 * Absichtlich eng: Jeder zusätzlich unterstützte Fall wäre ungeprüfter
 * Code in einem Prüfer. Was nicht passt, wirft — und ein geworfener
 * Prüfer ist eine Aussage, kein stilles Bestehen.
 */
function pngLesen(pfad) {
  const roh = readFileSync(pfad);
  if (roh.readUInt32BE(0) !== 0x89504e47) throw new Error(`${pfad}: keine PNG-Signatur`);
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < roh.length) {
    const laenge = roh.readUInt32BE(pos);
    const art = roh.toString('ascii', pos + 4, pos + 8);
    const rumpf = roh.subarray(pos + 8, pos + 8 + laenge);
    if (art === 'IHDR') {
      ihdr = {
        w: rumpf.readUInt32BE(0),
        h: rumpf.readUInt32BE(4),
        tiefe: rumpf[8],
        farbtyp: rumpf[9],
        interlace: rumpf[12],
      };
    } else if (art === 'IDAT') idat.push(rumpf);
    else if (art === 'IEND') break;
    pos += 12 + laenge;
  }
  if (!ihdr) throw new Error(`${pfad}: kein IHDR`);
  if (ihdr.tiefe !== 8 || ihdr.interlace !== 0 || (ihdr.farbtyp !== 2 && ihdr.farbtyp !== 6)) {
    throw new Error(`${pfad}: nur 8-Bit-RGB(A) ohne Interlace, gefunden Tiefe=${ihdr.tiefe} Farbtyp=${ihdr.farbtyp} Interlace=${ihdr.interlace}`);
  }
  const kanaele = ihdr.farbtyp === 2 ? 3 : 4;
  const zeile = ihdr.w * kanaele;
  const roh2 = inflateSync(Buffer.concat(idat));
  const daten = Buffer.alloc(ihdr.h * zeile);
  // PNG-Filter rückgängig machen (Zeile für Zeile, wie in der Spezifikation).
  for (let y = 0; y < ihdr.h; y++) {
    const typ = roh2[y * (zeile + 1)];
    const ein = roh2.subarray(y * (zeile + 1) + 1, (y + 1) * (zeile + 1));
    const aus = daten.subarray(y * zeile, (y + 1) * zeile);
    const oben = y > 0 ? daten.subarray((y - 1) * zeile, y * zeile) : null;
    for (let i = 0; i < zeile; i++) {
      const a = i >= kanaele ? aus[i - kanaele] : 0;
      const b = oben ? oben[i] : 0;
      const c = oben && i >= kanaele ? oben[i - kanaele] : 0;
      let v = ein[i];
      if (typ === 1) v += a;
      else if (typ === 2) v += b;
      else if (typ === 3) v += (a + b) >> 1;
      else if (typ === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (typ !== 0) throw new Error(`${pfad}: unbekannter Filter ${typ} in Zeile ${y}`);
      aus[i] = v & 0xff;
    }
  }
  return { ...ihdr, kanaele, daten };
}

/** Helligkeit (0..1) je Bildpunkt — Rec. 601, wie sie auch `make-normal.py` nimmt. */
function helligkeit(bild) {
  const { w, h, kanaele, daten } = bild;
  const l = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * kanaele;
    l[i] = (0.299 * daten[p] + 0.587 * daten[p + 1] + 0.114 * daten[p + 2]) / 255;
  }
  return l;
}

const mittel = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// ─────────────────────────────────────────────────────────────────────
// Maasse
// ─────────────────────────────────────────────────────────────────────

/**
 * Nahtstetigkeit: die mittlere Sprunghöhe ÜBER die Kachelnaht, gemessen
 * an der mittleren Sprunghöhe im Bildinneren.
 *
 * Der Vergleich mit dem Inneren ist der Kern — eine absolute Schwelle
 * wäre bei einer feinkörnigen Textur zu streng und bei einer weichen zu
 * lasch. Kachelt das Bild, ist die Naht genau so unauffällig wie jede
 * andere Nachbarschaft, das Verhältnis also ~1.
 */
function nahtVerhaeltnis(l, w, h) {
  let nahtX = 0;
  let innenX = 0;
  for (let y = 0; y < h; y++) {
    nahtX += Math.abs(l[y * w + (w - 1)] - l[y * w]);
    for (let x = 1; x < w; x++) innenX += Math.abs(l[y * w + x] - l[y * w + x - 1]);
  }
  let nahtY = 0;
  let innenY = 0;
  for (let x = 0; x < w; x++) {
    nahtY += Math.abs(l[(h - 1) * w + x] - l[x]);
    for (let y = 1; y < h; y++) innenY += Math.abs(l[y * w + x] - l[(y - 1) * w + x]);
  }
  return {
    x: nahtX / h / (innenX / (h * (w - 1))),
    y: nahtY / w / (innenY / (w * (h - 1))),
    innenX: innenX / (h * (w - 1)),
    innenY: innenY / (w * (h - 1)),
  };
}

/**
 * Anisotropie: mittlerer senkrechter Gradient geteilt durch den
 * waagerechten. Ein Läuferverband legt seine Fugen waagerecht und
 * treibt diese Zahl nach oben; gebrochener Fels hat keine Vorzugsachse.
 */
function anisotropie(l, w, h) {
  const n = nahtVerhaeltnis(l, w, h);
  return n.innenY / n.innenX;
}

/** Standardabweichung — einmal fein, einmal über 16er-Blöcke gemittelt. */
function streuung(l) {
  const m = mittel(Array.from(l));
  let s = 0;
  for (const v of l) s += (v - m) * (v - m);
  return Math.sqrt(s / l.length);
}
function grobStreuung(l, w, h, block = 16) {
  const bw = Math.floor(w / block);
  const bh = Math.floor(h / block);
  const grob = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let s = 0;
      for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) s += l[(by * block + y) * w + bx * block + x];
      grob[by * bw + bx] = s / (block * block);
    }
  }
  return streuung(grob);
}

// ─────────────────────────────────────────────────────────────────────
// Lauf
// ─────────────────────────────────────────────────────────────────────

const albedoPfad = process.argv[2] ? resolve(process.argv[2]) : resolve(WURZEL, 'assets/models/stein_fels.png');
const normalPfad = albedoPfad.replace(/\.png$/, '_normal.png');

console.log(`Fels-Texturpaar\n  ${albedoPfad}\n  ${normalPfad}\n`);

// Die Sonde entscheidet NICHT selbst, ob sie übersprungen wird (die Weiche
// dafür steht in scripts/run-tests.mjs). Fehlt die Datei, ist sie rot —
// ein leerer Lauf darf nicht als Bestehen durchgehen.
const name = albedoPfad.split('/').pop().replace(/\.png$/, '');

console.log('Vorhandensein und Format:');
pruefe(`${name}.png liegt da`, existsSync(albedoPfad));
pruefe(`${name}_normal.png liegt daneben (Konvention aus F1)`, existsSync(normalPfad));
if (fehler > 0) {
  console.error(`\n${fehler} ROT`);
  process.exit(1);
}

const albedo = pngLesen(albedoPfad);
const normal = pngLesen(normalPfad);

for (const [wie, bild] of [
  [name, albedo],
  [`${name}_normal`, normal],
]) {
  pruefe(`${wie}: 1024x1024 wie die Bestandstexturen`, bild.w === 1024 && bild.h === 1024, `${bild.w}x${bild.h}`);
  pruefe(`${wie}: 8-Bit-RGB ohne Interlace`, bild.tiefe === 8 && bild.farbtyp === 2 && bild.interlace === 0, `Tiefe ${bild.tiefe}, Farbtyp ${bild.farbtyp}`);
}

const lA = helligkeit(albedo);
const lN = helligkeit(normal);

console.log('\nKachelt (Naht gegen Bildinneres, 1.0 = unauffaellig):');
for (const [wie, l, bild] of [
  [name, lA, albedo],
  [`${name}_normal`, lN, normal],
]) {
  const n = nahtVerhaeltnis(l, bild.w, bild.h);
  pruefe(`${wie}: senkrechte Naht`, n.x <= 1.5, n.x.toFixed(3));
  pruefe(`${wie}: waagerechte Naht`, n.y <= 1.5, n.y.toFixed(3));
}

console.log('\nFels statt Mauerwerk:');
const aniso = anisotropie(lA, albedo.w, albedo.h);
pruefe('Albedo hat keine Vorzugsachse (waagerechte Fugen faerben die senkrechte Ableitung)', aniso > 0.7 && aniso < 1.43, aniso.toFixed(3));
const fein = streuung(lA);
const grob = grobStreuung(lA, albedo.w, albedo.h);
pruefe('Albedo traegt Kontrast (nicht flach)', fein > 0.03, fein.toFixed(4));
pruefe('Albedo ist nicht ueberzeichnet', fein < 0.28, fein.toFixed(4));
pruefe('Albedo hat Grobstruktur — Platten, kein Schleifpapier', grob / fein > 0.25, `grob/fein ${(grob / fein).toFixed(3)}`);

console.log('\nNormal-Karte:');
// Tangent-Space: z zeigt aus der Flaeche heraus, also nie unter 0.5 kodiert.
let zMin = 255;
let neigungSumme = 0;
for (let i = 0; i < normal.w * normal.h; i++) {
  const p = i * normal.kanaele;
  if (normal.daten[p + 2] < zMin) zMin = normal.daten[p + 2];
  const nx = normal.daten[p] / 255 - 0.5;
  const ny = normal.daten[p + 1] / 255 - 0.5;
  neigungSumme += Math.hypot(nx, ny);
}
const neigung = neigungSumme / (normal.w * normal.h);
pruefe('z zeigt ueberall aus der Flaeche heraus (Tangent Space)', zMin >= 128, `min z = ${zMin}`);
pruefe('Relief ist da (mittlere Neigung ueber der Schwelle)', neigung > 0.02, neigung.toFixed(4));
pruefe('Relief ist nicht uebersteuert', neigung < 0.30, neigung.toFixed(4));

if (fehler > 0) {
  console.error(`\n${fehler} ROT`);
  process.exit(1);
}
console.log('\nalles gruen');
