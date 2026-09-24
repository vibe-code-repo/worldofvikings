/**
 * Integration Sehen <-> Prüfen: map_render verarbeitet Befunde der Art
 * "frist"/"hinweis" und Befunde ohne Koordinate, ohne zu zeichnen und ohne
 * Absturz; echte Hüllen ergeben Grundflächen statt Punkte.
 *
 * Aufruf: `npx tsx tools/test/weltbau-integration.ts`
 */
import { sanitizeWorldLayout } from '@wov/shared';
import { huellenAufloeser } from '@wov/shared/src/weltbau/huelle.js';
import { rendereKarte, zeichenbareBefunde } from '../worldlayout-mcp/karten.js';

let fehler = 0;
const check = (ok: boolean, text: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  if (!ok) fehler++;
};

const layout = sanitizeWorldLayout({
  version: 1, name: 'i', detailSeed: 'i', continents: [],
  regions: [{ id: 'insel', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 300 }, edgeFalloff: 100 }],
  placements: [{ id: 'k1', prefab: 'Kiste', x: 10, z: 10 }, { id: 'h1', prefab: 'environment-roof-sm-bld-preset-shelter-02', x: -20, z: 15, yaw: 0.4 }],
});
if (!layout) throw new Error('Testwelt abgelehnt');

const gut = { schwere: 'rot', x: 30, z: -30, pruefung: 'ueberlappung', ids: [], text: 't' };
const frist = { schwere: 'gelb', x: 0, z: 0, pruefung: 'frist', ids: [], text: 'TEILBERICHT' }; // Bereichsmitte
const hinweis = { schwere: 'hinweis', x: 5, z: 5, pruefung: 'wasser', ids: [], text: 'h' };
const kaputt = [null, 7, 'x', { schwere: 'rot', x: Number.NaN, z: 1 }, { schwere: 'rot', x: Infinity, z: 1 }, {}];

const z = zeichenbareBefunde([gut, frist, hinweis, ...kaputt]);
check(z.befunde.length === 1 && z.befunde[0]!.x === 30, `nur der gültige Befund bleibt (war ${z.befunde.length})`);
check(z.uebersprungen === 8, `8 übersprungen (war ${z.uebersprungen})`);

const bereich = { minX: -60, minZ: -60, maxX: 60, maxZ: 60 };
const basis = { bereich, pixel: 256, ebenen: ['gelaende', 'platzierungen', 'befunde'] };
let a, b, c;
try {
  a = rendereKarte(layout, { ...basis, befunde: [gut] });
  b = rendereKarte(layout, { ...basis, befunde: [gut, frist, hinweis, ...kaputt] });
  c = rendereKarte(layout, { ...basis });
  check(true, 'kein Absturz mit frist/hinweis/koordinatenlosen Befunden');
} catch (e) {
  check(false, `Absturz: ${String(e)}`);
}
if (a && b && c) {
  check(a.png.equals(b.png), 'Bild mit Zusatzbefunden bitgleich zu Bild nur mit dem gültigen Befund');
  check(!a.png.equals(c.png), 'gültiger Befund verändert das Bild (wird gezeichnet)');
  check(b.hinweise.some((h) => h.includes('8 Befund')), `Hinweis zählt die 8 ungezeichneten (${b.hinweise.join(' | ')})`);
}

// echte Hüllen: Grundfläche statt Punkt
const huellen = huellenAufloeser();
const hk = huellen('environment-roof-sm-bld-preset-shelter-02');
check(hk !== null && hk.halbX > 0, `Hülle des Schutzdachs vorhanden (${hk ? hk.halbX.toFixed(2) + ' x ' + hk.halbZ.toFixed(2) : 'null'})`);
const pkt = rendereKarte(layout, { bereich, pixel: 256, ebenen: ['platzierungen'] });
const fl = rendereKarte(layout, {
  bereich, pixel: 256, ebenen: ['platzierungen'],
  flaeche: (p) => { const h = huellen(p); return h ? { flaeche: { art: 'rechteck', halbX: h.halbX, halbZ: h.halbZ }, fest: h.fest } : undefined; },
});
check(!pkt.png.equals(fl.png), 'Bild mit Hüllen unterscheidet sich vom Punktbild');

console.log(fehler === 0 ? '\nALLES OK' : `\n${fehler} FEHLER`);
process.exit(fehler === 0 ? 0 : 1);
