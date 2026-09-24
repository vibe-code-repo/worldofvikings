/**
 * map_render (KI-Weltbau M1, „Sehen“): Kartenbild ohne GPU.
 *
 * Geprüft wird an einer kleinen künstlichen Welt (eine Graslandinsel, ein See,
 * ein Fluss, eine Route, drei Platzierungen), nicht an der DEV-Welt:
 *  - PNG gültig, Maße gleich der Anfrage (Signatur, IHDR, Größe der Bytes),
 *  - Wasseranteil des Bildes gegen eine unabhängige Zählung über ein feineres
 *    Raster der Geo-Abfrage (Abweichung ≤ 1,5 Prozentpunkte),
 *  - eine platzierte Probe an der erwarteten Bildkoordinate (±2 px), fester
 *    Körper dunkel, ein gedrehtes Rechteck an seinen vier Eckpunkten,
 *  - Befunde-Kreuz an der Sollstelle, Ebene wird über 512 m weggelassen,
 *  - Grenzen: riesige Pixelwünsche, zu große/kleine/ungültige Bereiche,
 *    unbekannte Ebenen; eine Linie von weit außerhalb bleibt schnell,
 *  - Farbkopplung: Farbe an einer Wasserstelle = `farbe()` des Editors.
 *
 * Aufruf: `npx tsx tools/test/weltbau-karte.ts`
 */
import { inflateSync } from 'node:zlib';
import { Biome, WATER_LEVEL, createGeo, getStableHash, sanitizeWorldLayout } from '@wov/shared';
import { farbe } from '@wov/client/src/ui/worldmap/kartenKacheln.js';
import { Leinwand, gedrehtesRechteck } from '@wov/shared/src/weltbau/zeichnen.js';
import { KARTEN_FARBEN } from '@wov/shared/src/weltbau/karte.js';
import { rendereKarte, weltBereich } from '../worldlayout-mcp/karten.js';
import { pngMasse } from '../worldlayout-mcp/png.js';

/** Rohdaten (mit Filterbyte je Zeile) aus dem IDAT eines PNG, das kodierePng schrieb. */
function entpacke(png: Buffer): Buffer {
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return inflateSync(Buffer.concat(idat));
}

let fehler = 0;
let pruefungen = 0;
const check = (ok: boolean, text: string): void => {
  pruefungen++;
  if (!ok) {
    fehler++;
    console.log(`  FEHLER: ${text}`);
  }
};
const wirft = (f: () => unknown, muster: RegExp, text: string): void => {
  try {
    f();
    check(false, `${text}: hat nicht geworfen`);
  } catch (e) {
    check(muster.test(e instanceof Error ? e.message : String(e)), `${text}: falsche Meldung ${String(e)}`);
  }
};

const layoutOderNull = sanitizeWorldLayout({
  version: 1,
  name: 'karte-test',
  detailSeed: 'karte-test',
  continents: [],
  regions: [
    { id: 'insel', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 300 }, edgeFalloff: 100 },
  ],
  lakes: [{ id: 'see', x: 60, z: 40, radius: 20 }],
  rivers: [{ id: 'bach', points: [[-100, -100], [-20, -40]], width: 6 }],
  routes: [{ id: 'weg', points: [[-150, 100], [150, 100]], mode: 'loop' }],
  placements: [
    { id: 'kiste', prefab: 'Kiste', x: 100, z: -50 },
    { id: 'haus', prefab: 'Haus', x: -60, z: -80, yaw: 0.6 },
    { id: 'baum', prefab: 'Baum', x: 20, z: 90 },
  ],
});
if (!layoutOderNull) throw new Error("Testwelt wurde vom Sanitizer abgelehnt");
const layout = layoutOderNull;
const flaeche = (p: string) =>
  p === 'Haus'
    ? ({ flaeche: { art: 'rechteck', halbX: 10, halbZ: 5 }, fest: true } as const)
    : p === 'Kiste'
      ? ({ flaeche: { art: 'rechteck', halbX: 1, halbZ: 1 }, fest: true } as const)
      : undefined;

const geo = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout });

// ── 1. Ausschnitt 700 m, 512 px: PNG, Maße, Wasseranteil ─────────────
const bereich = { minX: -350, minZ: -350, maxX: 350, maxZ: 350 };
const r = rendereKarte(layout, {
  bereich,
  pixel: 512,
  ebenen: ['gelaende', 'wasser', 'platzierungen', 'routen'],
  flaeche,
});
const m = pngMasse(r.png);
check(r.png[0] === 0x89 && r.png[1] === 0x50 && r.png[2] === 0x4e && r.png[3] === 0x47, 'PNG-Signatur');
check(m?.breite === 512 && m?.hoehe === 512, `IHDR 512×512, war ${JSON.stringify(m)}`);
check(r.ms < 5000, `512 px unter 5 s, war ${r.ms} ms`);

// Unabhängige Zählung: 3× so feines Raster mit versetzter Phase.
{
  let nass = 0;
  let n = 0;
  const s = 700 / 1536;
  for (let j = 0; j < 1536; j++) {
    for (let i = 0; i < 1536; i++) {
      const x = -350 + (i + 0.31) * s;
      const z = -350 + (j + 0.67) * s;
      const b = geo.getBiome(x, z);
      if (b === Biome.Ocean || geo.getBiomeHeight(b, x, z).height < WATER_LEVEL) nass++;
      n++;
    }
  }
  const soll = nass / n;
  check(soll > 0.05 && soll < 0.95, `Testwelt hat Land und Wasser (Wasseranteil ${soll.toFixed(3)})`);
  check(Math.abs(soll - r.wasserAnteil) <= 0.015, `Wasseranteil Bild ${r.wasserAnteil.toFixed(4)} vs. Zählung ${soll.toFixed(4)}`);
}

// Farbkopplung: Wasserstelle weit draußen (Ozean) = farbe() des Editors.
const px = 512 / 700;
const pixelVon = (x: number, z: number): [number, number] => [Math.floor((x + 350) * px), Math.floor((z + 350) * px)];

// PNG entpacken (Filter 0 je Zeile, wie kodierePng schreibt): Zeilen à 1 + 3·Breite Bytes.
const rgb = entpacke(r.png);
const pix = (x: number, z: number): [number, number, number] => {
  const [ix, iy] = pixelVon(x, z);
  const o = iy * (1 + 512 * 3) + 1 + ix * 3;
  return [rgb[o], rgb[o + 1], rgb[o + 2]];
};
const nah = (a: readonly number[], b: readonly number[], tol: number): boolean => a.every((v, k) => Math.abs(v - b[k]) <= tol);

{
  const x = 345;
  const z = 345; // Ecke: Ozean
  const erwartet = new Uint8Array(4);
  const b = geo.getBiome(x, z);
  const h = geo.getBiomeHeight(b, x, z).height;
  farbe(b, h, 0, erwartet, 0);
  check(h < WATER_LEVEL, `Ecke ist Wasser (Höhe ${h.toFixed(1)})`);
  check(nah(pix(x, z), [erwartet[0], erwartet[1], erwartet[2]], 2), `Wasserfarbe ${pix(x, z)} vs. ${[...erwartet].slice(0, 3)}`);
}

// Platzierung „Kiste“ bei (100, −50): fester Körper, Mittelpunktfarbe dunkel/Rand gelb.
check(nah(pix(100, -50), KARTEN_FARBEN.fest, 2) || nah(pix(100, -50), KARTEN_FARBEN.festRand, 2), `Kiste an (100,-50): ${pix(100, -50)}`);
// Nachbarpixel ±2 px: mindestens einer trägt die Markenfarbe, aber ein Ort 8 px weiter nicht.
{
  const [ix, iy] = pixelVon(100, -50);
  const treffer = (dx: number, dy: number) => {
    const o = (iy + dy) * (1 + 512 * 3) + 1 + (ix + dx) * 3;
    const c: [number, number, number] = [rgb[o], rgb[o + 1], rgb[o + 2]];
    return nah(c, KARTEN_FARBEN.fest, 2) || nah(c, KARTEN_FARBEN.festRand, 2);
  };
  let inFenster = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (treffer(dx, dy)) inFenster = true;
  check(inFenster, 'Markenfarbe der Kiste innerhalb ±2 px der erwarteten Bildkoordinate');
  check(!treffer(9, 9), 'neun Pixel weiter keine Markenfarbe');
}

// Haus (gedreht, 20×10 m): vier Ecken leicht nach innen liegen in Farbe „fest“, Mitte auch.
{
  const ecken = gedrehtesRechteck(-60, -80, 10, 5, 0.6);
  const scale = (e: [number, number]) => [-60 + (e[0] + 60) * 0.7, -80 + (e[1] + 80) * 0.7] as const;
  let innen = 0;
  for (const e of ecken) {
    const p = scale(e);
    if (nah(pix(p[0], p[1]), KARTEN_FARBEN.fest, 2)) innen++;
  }
  check(innen === 4, `vier Hausecken (nach innen gerückt) sind fest gefärbt, waren ${innen}`);
  // Ein Punkt in Richtung der unveränderten (ungedrehten) Ecke außerhalb des gedrehten Hauses: nicht fest.
  const aussen = ecken[0];
  const ausserhalb = [aussen[0] + (aussen[0] + 60) * 0.5, aussen[1] + (aussen[1] + 80) * 0.5];
  check(!nah(pix(ausserhalb[0], ausserhalb[1]), KARTEN_FARBEN.fest, 2), 'Punkt außerhalb der gedrehten Ecke ist nicht fest');
}

// Route: Mittelpunkt der Strecke (0, 100) ist Routenfarbe (2 px breit, ±1).
check(
  [-1, 0, 1].some((d) => nah(pix(0, 100 + d * (1 / px)), KARTEN_FARBEN.route, 2)),
  `Route bei (0,100): ${pix(0, 100)}`
);

// ── 2. Befunde ───────────────────────────────────────────────────────
{
  const rb = rendereKarte(layout, {
    bereich: { x: 0, z: 0, radius: 200 },
    pixel: 256,
    ebenen: ['gelaende', 'befunde'],
    befunde: [{ schwere: 'rot', x: 0, z: 0 }],
  });
  check(rb.ebenen.includes('befunde') && rb.hinweise.length === 0, 'Befunde bei 400 m gezeichnet');
  const rgb2 = entpacke(rb.png);
  const o = 128 * (1 + 256 * 3) + 1 + 128 * 3; // Bildmitte, auf der Diagonale des Kreuzes
  check(nah([rgb2[o], rgb2[o + 1], rgb2[o + 2]], KARTEN_FARBEN.rot, 2), `rotes Kreuz in der Mitte: ${[rgb2[o], rgb2[o + 1], rgb2[o + 2]]}`);
  const grob = rendereKarte(layout, { bereich, pixel: 256, ebenen: ['gelaende', 'befunde'], befunde: [] });
  check(!grob.ebenen.includes('befunde') && /befunde weggelassen/.test(grob.text), 'Befunde bei 700 m weggelassen, Hinweis im Text');
}

// ── 3. Grenzen und Fehler ────────────────────────────────────────────
wirft(() => rendereKarte(layout, { bereich, pixel: 2048 }), /pixel muss/, 'pixel 2048');
wirft(() => rendereKarte(layout, { bereich, pixel: 100000 }), /pixel muss/, 'pixel 100000');
wirft(() => rendereKarte(layout, { bereich: { minX: 0, minZ: 0, maxX: 1e9, maxZ: 10 }, pixel: 256 }), /zu groß/, 'Bereich 1e9 m');
wirft(() => rendereKarte(layout, { bereich: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, pixel: 256 }), /zu klein/, 'Bereich 1 m');
wirft(() => rendereKarte(layout, { bereich: { minX: 5, minZ: 0, maxX: 5, maxZ: 10 }, pixel: 256 }), /keine Fläche/, 'Breite 0');
wirft(() => rendereKarte(layout, { bereich: { minX: NaN, minZ: 0, maxX: 5, maxZ: 10 }, pixel: 256 }), /ungültig/, 'NaN');
wirft(() => rendereKarte(layout, { bereich, pixel: 256, ebenen: ['gelaende', 'hologramm'] }), /unbekannte Ebene/, 'Ebene hologramm');

{
  const t = performance.now();
  const l = new Leinwand(64, 64);
  l.linie(-1e9, -1e9, 1e9, 1e9, [1, 2, 3], 3);
  l.linie(-1e9, 30, 1e9, 30, [1, 2, 3]);
  check(performance.now() - t < 50, `Linie von weit außerhalb schnell (${(performance.now() - t).toFixed(1)} ms)`);
  check(l.lies(30, 30)[0] === 1, 'beschnittene Diagonale trifft das Bild');
}

// ── 4. Ganze Welt: Bereich aus dem Layout ────────────────────────────
{
  const w = weltBereich(layout);
  const rw = rendereKarte(layout, { bereich: w, pixel: 256 });
  check(pngMasse(rw.png)?.breite === 256, 'Weltübersicht 256 px');
  check(rw.wasserAnteil > 0.3 && rw.wasserAnteil < 1, `Weltübersicht hat Wasser und Land (${rw.wasserAnteil.toFixed(2)})`);
}

// ── 5. 1024 px: Laufzeit als Zahl ────────────────────────────────────
{
  const r1 = rendereKarte(layout, { bereich, pixel: 1024, flaeche });
  check(pngMasse(r1.png)?.breite === 1024 && pngMasse(r1.png)?.hoehe === 1024, '1024×1024');
  console.log(`  1024 px: ${r1.ms} ms, ${r1.png.length} Bytes`);
  check(r1.ms <= 5000, `1024 px höchstens 5 s, war ${r1.ms} ms`);
}

console.log(fehler === 0 ? `weltbau-karte: ${pruefungen} Prüfungen, alle grün` : `weltbau-karte: ${fehler} von ${pruefungen} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
