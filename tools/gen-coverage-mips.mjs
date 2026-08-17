/**
 * Coverage-erhaltende Mipmaps für Alpha-Test-Texturen.
 *
 * ── Das Problem ──────────────────────────────────────────────────────
 * Eine Mipmap mittelt vier Texel zu einem. Bei einer Cutout-Textur mittelt
 * sie damit auch den ALPHA-Kanal — und der entscheidet über Sein oder
 * Nichtsein: Im Shader steht `if (alpha < cutoff) discard`.
 *
 * Ein Grashalm, der auf Stufe 0 ein Texel voll bedeckt, teilt sich auf
 * Stufe 1 eines mit drei leeren Nachbarn; sein Alpha fällt von 255 auf 64.
 * Bei `cutoff` 0.46 (≈ 117) fällt er damit heraus. Mit jeder Stufe
 * verschwindet mehr — **das Gras dünnt mit der Entfernung aus, obwohl
 * dort in Wahrheit MEHR Halme je Pixel stehen.** Genau das beschreibt das
 * Grafik-Konzept als „Schollen"-Effekt und nennt es die Voraussetzung
 * dafür, dass dünn gedeckte Masken überhaupt tragen.
 *
 * ── Die Lösung ───────────────────────────────────────────────────────
 * Je Stufe den Alphakanal so nachskalieren, dass der ANTEIL der Texel
 * über dem Schwellwert derselbe bleibt wie auf Stufe 0. Der Faktor wird
 * nicht gerechnet, sondern gesucht (Bisektion über 24 Schritte) — die
 * Verteilung ist beliebig, eine geschlossene Formel gibt es nicht.
 *
 * ── Der Fallstrick, der hier schon einmal Zeit gekostet hat ──────────
 * **Nicht über uint8 verkleinern.** Bei dünnen Halmen ist `rgb × alpha`
 * winzig; bei α = 0.02 landet ein Grün von 0.4 als ≈ 2 im Byte, und die
 * spätere Division durch dasselbe kleine Alpha multipliziert den
 * Quantisierungsfehler wieder hoch. Gemessen (Docs/07): halbtransparente
 * Ränder kamen als RGB(109,144,107) statt (74,105,73) heraus — ein
 * sichtbar ausgebleichter Teppich. Diese Datei rechnet die ganze
 * Mip-Kette in Float und quantisiert erst beim Schreiben.
 *
 * Aufruf: node tools/gen-coverage-mips.mjs <bild.png> [cutoff]
 * Schreibt <bild>.mip1.png … bis 4×4 und meldet die Deckung je Stufe.
 */
import sharp from 'sharp';

const datei = process.argv[2];
const cutoff = Number(process.argv[3] ?? 0.46);
if (!datei) {
  console.error('Aufruf: node tools/gen-coverage-mips.mjs <bild.png> [cutoff]');
  process.exit(1);
}

const roheingabe = await sharp(datei).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
/** Stufe 0 in Float, RGBA in 0..1 — ab hier wird nicht mehr quantisiert. */
let breite = roheingabe.info.width;
let hoehe = roheingabe.info.height;
let daten = new Float32Array(breite * hoehe * 4);
for (let i = 0; i < daten.length; i++) daten[i] = roheingabe.data[i] / 255;

const deckung = (a, n) => {
  let ueber = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] >= cutoff) ueber++;
  return ueber / n;
};
const ZIEL = deckung(daten, breite * hoehe);
console.log(`${datei}  ${breite}×${hoehe}  cutoff ${cutoff}`);
console.log(`  Stufe 0: Deckung ${ZIEL.toFixed(4)}  (Bezug)`);

let stufe = 0;
while (breite > 4 && hoehe > 4) {
  stufe++;
  const nb = breite >> 1;
  const nh = hoehe >> 1;
  const klein = new Float32Array(nb * nh * 4);
  // Boxfilter über 2×2 — und zwar PRÄMULTIPLIZIERT, damit transparente
  // Texel die Farbe nicht verwässern. Danach zurückdividiert.
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nb; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * breite + (x * 2 + dx)) * 4;
          const al = daten[i + 3];
          r += daten[i] * al;
          g += daten[i + 1] * al;
          b += daten[i + 2] * al;
          a += al;
        }
      }
      const j = (y * nb + x) * 4;
      klein[j + 3] = a / 4;
      if (a > 1e-6) {
        klein[j] = r / a;
        klein[j + 1] = g / a;
        klein[j + 2] = b / a;
      } else {
        // Vollständig transparent: die Farbe des ersten Quelltexels
        // übernehmen statt Weiss oder Schwarz. „Die Farbe ist dort
        // beliebig" gilt nur, solange niemand sie mittelt — genau das tut
        // die nächste Stufe.
        const i = (y * 2 * breite + x * 2) * 4;
        klein[j] = daten[i];
        klein[j + 1] = daten[i + 1];
        klein[j + 2] = daten[i + 2];
      }
    }
  }

  // Alpha so skalieren, dass die Deckung wieder ZIEL trifft. Bisektion,
  // weil die Verteilung beliebig ist.
  const roh = deckung(klein, nb * nh);
  // Invariante der Bisektion: `lo` verfehlt das Ziel nach UNTEN, `hi`
  // erreicht es. Genommen wird am Ende `hi` — nicht die Mitte.
  //
  // Das ist kein Feinschliff, sondern der Unterschied zwischen richtig und
  // leer: Bei einer binären Maske liegen die gemittelten Alphawerte exakt
  // auf 0,5, und ein Faktor knapp unter dem Grenzwert kippt sie ALLE
  // gleichzeitig unter die Schwelle. Der erste Lauf lieferte so eine Stufe
  // mit Deckung 0,0000 — eine Textur, die auf halber Entfernung
  // vollständig verschwindet.
  let lo = 0.05;
  let hi = 20;
  const deckungBei = (f) => {
    let ueber = 0;
    for (let i = 3; i < klein.length; i += 4) {
      if (Math.min(1, klein[i] * f) >= cutoff) ueber++;
    }
    return ueber / (nb * nh);
  };
  for (let s = 0; s < 32; s++) {
    const mitte = (lo + hi) / 2;
    if (deckungBei(mitte) < ZIEL) lo = mitte;
    else hi = mitte;
  }
  const faktor = hi;
  for (let i = 3; i < klein.length; i += 4) klein[i] = Math.min(1, klein[i] * faktor);

  const bytes = Buffer.alloc(klein.length);
  for (let i = 0; i < klein.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(klein[i] * 255)));
  }
  const ziel = datei.replace(/\.png$/, `.mip${stufe}.png`);
  await sharp(bytes, { raw: { width: nb, height: nh, channels: 4 } }).png().toFile(ziel);
  console.log(
    `  Stufe ${stufe}: ${String(nb).padStart(4)}×${String(nh).padEnd(4)} ` +
      `Deckung roh ${roh.toFixed(4)} → korrigiert ${deckung(klein, nb * nh).toFixed(4)}` +
      `  (Faktor ${faktor.toFixed(3)})`
  );
  daten = klein;
  breite = nb;
  hoehe = nh;
}
