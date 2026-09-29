/**
 * Walddichte (shared/src/worldgen/waldDichte.ts) gegen die TATSÄCHLICH
 * gestreuten Bäume der Weltdatei `server/data/welten/dev.json`.
 *
 * Die Dichtefunktion sagt „erwartete Bäume in der 40-m-Scheibe“ aus Streutabelle,
 * Waldfaktor und Kuratierungsliste. Die Gegenprobe läuft `streueZone` (dieselbe
 * Rechnung wie der Server) über alle Zonen um die Messpunkte und zählt die
 * Bäume (`istWaldbaum`) in der Scheibe. Geprüft wird:
 *  - Regeln: ohne Region/Kuratierungsliste 0, monoton im Waldfaktor-Fenster,
 *    Kurve `waldStufe` monoton, 0 unter `von`, 1 ab `voll`.
 *  - Messung: ≥ 100 Punkte (4 Inseln + Startinsel-Fläche), Pearson und Spearman
 *    zwischen Erwartung und Zählung, und: wo die Erwartung 0 ist, steht wirklich
 *    kein Baum.
 *  - Kosten je Aufruf.
 *
 * Lauf: npx tsx shared/test/wald-dichte.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegionGeo } from '../src/worldgen/RegionGeo.js';
import { HeightmapProvider, WATER_LEVEL, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import { streueZone } from '../src/worldgen/streuung.js';
import { sanitizeWorldLayout } from '../src/worldlayout/sanitize.js';
import {
  WALD_RADIUS,
  baeumeImUmkreis,
  baumErwartung,
  baumErwartungBei,
  istWaldbaum,
  waldStufe,
  type WaldGelaende,
  type WaldQuelle,
} from '../src/worldgen/waldDichte.js';
import { FOLIAGE } from '../src/vegetation.js';
import { getStableHash } from '../src/hash.js';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

// ── 1. Regeln ───────────────────────────────────────────────────────
console.log('Regeln');
pruefe('Baumnamen: Store-Bäume und ältere eigene',
  ['vegetation-tree-1c3', 'vegetation-pine-1b5', 'vegetation-massive-tree-1a2', 'vegetation-split-tree-1a1',
    'vegetation-small-thin-tree-1a3', 'vegetation-branched-tree-2a1', 'Fichte3', 'Tanne7', 'Birke2'].every(istWaldbaum));
pruefe('keine Bäume: Busch, Ast, Fels, Farn, Weide',
  ['vegetation-large-bush-1a5', 'vegetation-branch-1a7', 'environment-sm-env-rock-cliff-01', 'Farn2', 'Weide3', 'Hasel2'].every((n) => !istWaldbaum(n)));
const baumEintraege = FOLIAGE.filter((v) => istWaldbaum(v.prefabName));
pruefe('die Streutabelle enthält Bäume', baumEintraege.length >= 40, `${baumEintraege.length} Einträge`);

const frei: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => ({ vegetation: baumEintraege.map((v) => v.prefabName) }) };
const radial: WaldQuelle = { getForestFactor: () => 0.5 };
const ohneListe: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => ({}) };
const keineRegion: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => null };
pruefe('Radialwelt (ohne regionAt): 0 Bäume', baeumeImUmkreis(0, 0, radial) === 0);
pruefe('Region ohne Kuratierungsliste: 0 Bäume', baeumeImUmkreis(0, 0, ohneListe) === 0);
pruefe('außerhalb jeder Region: 0 Bäume', baeumeImUmkreis(0, 0, keineRegion) === 0);
pruefe('kuratierte Region im Wald: viele Bäume', baeumeImUmkreis(0, 0, frei) > 100, baeumeImUmkreis(0, 0, frei).toFixed(0));
const halb: WaldQuelle = { ...frei, regionAt: () => ({ vegetation: frei.regionAt!(0, 0)!.vegetation, bewuchsDichte: 0.5 }) };
pruefe('bewuchsDichte skaliert', Math.abs(baeumeImUmkreis(0, 0, halb) * 2 - baeumeImUmkreis(0, 0, frei)) < 1e-6);
const nurBusch: WaldQuelle = { getForestFactor: () => 0.5, regionAt: () => ({ vegetation: ['vegetation-large-bush-1a5'] }) };
pruefe('Liste ohne Baumart: 0 Bäume', baeumeImUmkreis(0, 0, nurBusch) === 0);
// Bäume ohne Waldbedingung (`inForest` false) wachsen überall; darüber hinaus gilt das Fenster.
const ueberall = baumEintraege
  .filter((v) => !v.inForest)
  .reduce((sum, v) => sum + (v.max < 1 ? v.max : (v.min + v.max) / 2) * ((v.groupSizeMin + v.groupSizeMax) / 2), 0);
pruefe('Waldfaktor weit über allen Fenstern: nur die Arten ohne Waldbedingung', Math.abs(baumErwartung(3, null) - ueberall) < 1e-9 && ueberall < baumErwartung(0.5, null) / 5, `${baumErwartung(3, null).toFixed(1)} von ${baumErwartung(0.5, null).toFixed(0)}`);
pruefe('im Wald (0,5) mehr Erwartung als am Rand (1,3)', baumErwartung(0.5, null) > baumErwartung(1.3, null), `${baumErwartung(0.5, null).toFixed(0)} > ${baumErwartung(1.3, null).toFixed(0)}`);
pruefe('Tabelle und Rechnung stimmen (Stufe 0,01)', Math.abs(baumErwartungBei(0, 0, frei) - baumErwartung(0.5, frei.regionAt!(0, 0)!.vegetation!)) < 1e-4);

// Gelände: dieselben Höhen- und Neigungsregeln wie die Streuung
const mitGelaende = (hoehe: number, normalY: number): WaldQuelle => ({
  ...frei,
  gelaende: (_x: number, _z: number, aus: WaldGelaende) => {
    aus.hoehe = hoehe;
    aus.normalY = normalY;
  },
});
pruefe('Wiese 5 m über dem Wasser, flach: Bäume', baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 5, 1)) > 100);
pruefe('offenes Meer (5 m unter dem Wasserspiegel): 0 Bäume', baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL - 5, 1)) === 0);
pruefe('Wasserlinie (0,2 m über dem Spiegel, unter minAltitude 0,5): 0 Bäume', baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 0.2, 1)) === 0);
pruefe('60°-Hang (normalY 0,5): 0 Bäume', baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 5, 0.5)) === 0);
pruefe('25°-Hang (normalY 0,906): weniger Bäume als flach, aber welche', baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 5, 0.906)) > 0 && baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 5, 0.906)) < baeumeImUmkreis(0, 0, mitGelaende(WATER_LEVEL + 5, 1)));
pruefe('ohne Gelände-Funktion gelten die Fenster nicht (Meer zählt)', baeumeImUmkreis(0, 0, frei) > 100);

let monoton = true;
let vorher = -1;
for (let b = 0; b <= 400; b += 0.5) {
  const s = waldStufe(b, 20, 150);
  if (s < vorher) monoton = false;
  vorher = s;
}
pruefe('waldStufe monoton', monoton);
pruefe('waldStufe: 0 unter von, 1 ab voll', waldStufe(0, 20, 150) === 0 && waldStufe(20, 20, 150) === 0 && waldStufe(150, 20, 150) === 1 && waldStufe(999, 20, 150) === 1);
pruefe('waldStufe weich: Mitte zwischen 0 und 1', waldStufe(85, 20, 150) > 0.4 && waldStufe(85, 20, 150) < 0.6);

// ── 2. Messung gegen die echte Streuung ─────────────────────────────
console.log('Messung gegen die Streuung (dev.json)');
const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const layout = sanitizeWorldLayout(JSON.parse(readFileSync(resolve(wurzel, 'server/data/welten/dev.json'), 'utf-8')));
if (!layout) throw new Error('dev.json wurde verworfen');
const seed = getStableHash(layout.detailSeed);
const geo = new RegionGeo(seed, { worldGenVersion: 2 }, layout);
const hm = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
const quelle: WaldQuelle = {
  getForestFactor: (x, z) => geo.getForestFactor(x, z),
  regionAt: (x, z) => geo.regionAt(x, z),
  gelaende: (x, z, aus) => {
    aus.hoehe = hm.getGroundHeight(x, z);
    aus.normalY = hm.getZoneAt(x, z).getWorldNormal(x, z)?.y ?? 1;
  },
};

let zufall = 12345;
const rnd = (): number => (zufall = (Math.imul(zufall, 1664525) + 1013904223) >>> 0) / 4294967296;
const punkte: { x: number; z: number; id: string }[] = [];
for (const id of ['insel-1', 'insel-2', 'insel-3', 'insel-16']) {
  const r = layout.regions.find((q) => q.id === id);
  if (!r || r.shape.kind !== 'circle') throw new Error(`Region ${id} fehlt oder ist kein Kreis`);
  for (let versuch = 0, n = 0; n < 20 && versuch < 5000; versuch++) {
    const w = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r.shape.radius * 0.7;
    const x = r.shape.x + Math.cos(w) * d;
    const z = r.shape.z + Math.sin(w) * d;
    if (geo.regionAt(x, z)?.id !== id || hm.getGroundHeight(x, z) < 31.5) continue;
    punkte.push({ x, z, id });
    n++;
  }
}
// Startinsel: Wald, Dorf und Küste in einem Rechteck (dort liegen auch Flächen ohne Bäume).
for (let versuch = 0, n = 0; n < 30 && versuch < 20000; versuch++) {
  const x = -23120 + rnd() * 875;
  const z = -6160 + rnd() * 510;
  const rg = geo.regionAt(x, z);
  if (!rg || hm.getGroundHeight(x, z) < 31.5) continue;
  punkte.push({ x, z, id: `start:${rg.id}` });
  n++;
}
// Meer und Strand rund um Insel 1 (dort reicht die Region über das Wasser)
const kategorie = new Map<number, string>();
for (const [kat, lo, hi] of [['ozean', -1e9, 29], ['strand', 29, 31.5]] as const) {
  for (let versuch = 0, n = 0; n < 25 && versuch < 200000; versuch++) {
    const x = -20000 + rnd() * 4000;
    const z = -8000 + rnd() * 4000;
    const h = hm.getGroundHeight(x, z);
    if (h < lo || h >= hi) continue;
    kategorie.set(punkte.length, kat);
    punkte.push({ x, z, id: kat });
    n++;
  }
}
pruefe('mindestens 50 Messpunkte', punkte.length >= 50, `${punkte.length}`);

const zonen = new Map<string, { zx: number; zy: number }>();
const rand = WALD_RADIUS + ZONE_UNITS / 2;
for (const p of punkte) {
  for (let dx = -rand; dx <= rand; dx += ZONE_UNITS / 2) {
    for (let dz = -rand; dz <= rand; dz += ZONE_UNITS / 2) {
      const zx = Math.floor((p.x + dx) / ZONE_UNITS + 0.5);
      const zy = Math.floor((p.z + dz) / ZONE_UNITS + 0.5);
      zonen.set(`${zx},${zy}`, { zx, zy });
    }
  }
}
const baeume: { x: number; z: number }[] = [];
for (const { zx, zy } of zonen.values()) {
  const h = hm.getZoneAt(zx * ZONE_UNITS, zy * ZONE_UNITS);
  streueZone({ seed, geo, heightmaps: hm, regionGeo: geo }, h, [], (fund) => {
    if (istWaldbaum(fund.prefabName)) baeume.push({ x: fund.position.x, z: fund.position.z });
  });
}
const P: number[] = [];
const N: number[] = [];
for (const p of punkte) {
  let n = 0;
  for (const b of baeume) if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 <= WALD_RADIUS * WALD_RADIUS) n++;
  N.push(n);
  P.push(baeumeImUmkreis(p.x, p.z, quelle));
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y) / n;
  const mb = b.reduce((x, y) => x + y) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
function raenge(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const r = new Array<number>(a.length);
  idx.forEach(([, i], k) => (r[i] = k));
  return r;
}
const rP = pearson(P, N);
const rS = pearson(raenge(P), raenge(N));
console.log(`  ${punkte.length} Punkte, ${zonen.size} Zonen, ${baeume.length} Bäume gestreut; Pearson ${rP.toFixed(3)}, Spearman ${rS.toFixed(3)}`);
pruefe('Pearson Erwartung gegen Zählung ≥ 0,5', rP >= 0.5, rP.toFixed(3));
pruefe('Spearman Erwartung gegen Zählung ≥ 0,55', rS >= 0.55, rS.toFixed(3));
const leer = P.map((e, i) => [e, N[i]] as const).filter(([e]) => e === 0);
pruefe('mindestens 5 Punkte ohne Erwartung (offene/unkuratierte Fläche)', leer.length >= 5, `${leer.length}`);
// Falsch-positiv: hörbare Stufe (≥ 0,3) bei weniger als 10 gezählten Bäumen (Vögel im baumarmen Sumpf, im Gebirge, über dem Meer)
const stufen = P.map((e) => waldStufe(e, 20, 150));
const falschPositiv = punkte.map((p, i) => ({ p, i })).filter(({ i }) => stufen[i] >= 0.3 && N[i] < 10);
pruefe('Falsch-positive (Stufe ≥ 0,3, < 10 Bäume) höchstens 5', falschPositiv.length <= 5, `${falschPositiv.length} von ${punkte.length}: ${falschPositiv.map(({ p }) => p.id).join(',')}`);
const meer = punkte.map((p, i) => ({ p, i })).filter(({ i }) => kategorie.get(i) === 'ozean');
pruefe('offenes Meer (25 Punkte, Höhe < Wasserspiegel): Stufe 0 und Erwartung unter der Schwelle (Küstenpunkte sehen Land in der Scheibe)', meer.length === 25 && meer.every(({ i }) => stufen[i] === 0 && P[i] < 20), `max Erwartung ${Math.max(...meer.map(({ i }) => P[i])).toFixed(1)}`);
const sumpf = punkte.map((p, i) => ({ p, i })).filter(({ p }) => p.id === 'insel-3');
pruefe('Sumpf (insel-3): höchstens 2 von 20 mit Stufe ≥ 0,3', sumpf.filter(({ i }) => stufen[i] >= 0.3).length <= 2, `${sumpf.filter(({ i }) => stufen[i] >= 0.3).length}`);
console.log(`  falsch-positiv ${falschPositiv.length}/${punkte.length}`);
pruefe('Erwartung 0 ⇒ wirklich kein Baum in der Scheibe', leer.every(([, n]) => n === 0), `max gezählt ${Math.max(0, ...leer.map(([, n]) => n))}`);
const dicht = P.map((e, i) => [e, N[i]] as const).filter(([e]) => e >= 150);
const mittelDicht = dicht.reduce((s, [, n]) => s + n, 0) / Math.max(1, dicht.length);
const mittelAlle = N.reduce((s, n) => s + n, 0) / N.length;
pruefe('dicht (Erwartung ≥ 150): im Mittel mehr gezählte Bäume als im Durchschnitt', mittelDicht > mittelAlle * 1.3, `${mittelDicht.toFixed(1)} gegen ${mittelAlle.toFixed(1)}`);

// Kosten mit warmem Gelände-Zwischenspeicher (im Spiel liegen die Zonen um die Figur ohnehin geladen)
const messPunkt = punkte[0];
for (let i = 0; i < 50; i++) baeumeImUmkreis(messPunkt.x + (i % 10), messPunkt.z + (i % 7), quelle);
const t0 = performance.now();
let acc = 0;
const AUFRUFE = 3000;
for (let i = 0; i < AUFRUFE; i++) acc += baeumeImUmkreis(messPunkt.x + (i % 10), messPunkt.z + (i % 7), quelle);
const us = ((performance.now() - t0) / AUFRUFE) * 1000;
console.log(`  Kosten: ${us.toFixed(1)} µs je Aufruf (25 Abtastpunkte)`);
pruefe('Aufruf unter 100 µs (Takt 0,5 s; Ziel 50 µs)', us < 100 && acc >= 0, `${us.toFixed(1)} µs`);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nOK');
