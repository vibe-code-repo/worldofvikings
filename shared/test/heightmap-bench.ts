/**
 * Heightmap-Messbank — isoliert `HeightmapProvider.getZone()` und
 * `getGroundHeight()` aus dem Bild heraus und misst sie ohne Renderer.
 *
 * Warum eigenstaendig und nicht im Spiel gemessen: Im Bild liegen Gitterbau,
 * Havok-Cooking und Wasserstreifen uebereinander; die Aufschluesselung dort
 * kostet Messtechnik und trifft trotzdem nur Summen. Hier laeuft genau eine
 * Sache, millionenfach, mit derselben Welt (server/data/worldlayout.json,
 * Layout-Modus — das ist die Welt, die der Server wirklich generiert).
 *
 * Aufruf (aus shared/):
 *   npx tsx test/heightmap-bench.ts            Messung
 *   npx tsx test/heightmap-bench.ts --zaehler  zusaetzlich Aufrufzaehler
 *
 * Der Zaehlerlauf braucht die Instrumentierung in Perlin.ts/compile.ts, die
 * nur zur Analyse eingeschaltet wird — ohne sie bleiben die Zaehler auf 0.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo } from '../src/worldgen/factory.js';
import { HeightmapProvider, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import { getStableHash } from '../src/hash.js';
import { sanitizeWorldLayout } from '../src/worldlayout/index.js';
import { Biome } from '../src/types.js';

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const layoutRoh = JSON.parse(
  readFileSync(resolve(WURZEL, 'server/data/worldlayout.json'), 'utf-8')
) as unknown;
const layout = sanitizeWorldLayout(layoutRoh)!;
const worldSeed = getStableHash(layout.detailSeed);

const GEO_EINSTELLUNGEN = {
  worldGenVersion: 2,
  disableDistantRivers: false,
  riverAffectsOcean: false,
  ashlandsModernNoise: true,
};

function neueGeo() {
  return createGeo({ mode: 'layout', worldSeed, layout: layoutRoh, settings: GEO_EINSTELLUNGEN });
}

const geo = neueGeo();
const bauZeit0 = performance.now();
console.log(
  `Welt "${layout.name}" — Seed ${worldSeed}, ${layout.regions.length} Regionen, ` +
    `Geo in ${(bauZeit0 - 0).toFixed(0)} ms bereit`
);

// ── Messzonen ────────────────────────────────────────────────────
//
// Nicht irgendwelche: gesucht wird je eine Zone mit einheitlichem Biom, eine
// mit Biomkante (dort laeuft der 4-fach-Blend) und eine im Gebirge (dort
// kommt baseHeightTilt mit vier zusaetzlichen Basishoehen dazu). Die drei
// Faelle unterscheiden sich um Groessenordnungen — ein einzelner Mittelwert
// wuerde das verdecken.

interface Messzone {
  art: string;
  zx: number;
  zy: number;
}

function eckbiome(zx: number, zy: number): [Biome, Biome, Biome, Biome] {
  const bx = zx * ZONE_UNITS - ZONE_UNITS / 2;
  const bz = zy * ZONE_UNITS - ZONE_UNITS / 2;
  return [
    geo.getBiome(bx, bz),
    geo.getBiome(bx + ZONE_UNITS, bz),
    geo.getBiome(bx, bz + ZONE_UNITS),
    geo.getBiome(bx + ZONE_UNITS, bz + ZONE_UNITS),
  ];
}

function sucheZonen(): Messzone[] {
  const treffer: Messzone[] = [];
  const gesucht = new Set(['einheitlich', 'kante', 'gebirge', 'ozean']);
  // Spiralsuche um den Schwerpunkt der Regionen — der Weltmittelpunkt ist
  // in dieser Welt offene See und traefe nur den billigsten Fall.
  let mx = 0;
  let mz = 0;
  for (const r of layout.regions) {
    const s = r.shape;
    if (s.kind === 'circle') {
      mx += s.x;
      mz += s.z;
    } else {
      mx += s.points.reduce((a, p) => a + p[0]!, 0) / s.points.length;
      mz += s.points.reduce((a, p) => a + p[1]!, 0) / s.points.length;
    }
  }
  const zx0 = Math.round(mx / layout.regions.length / ZONE_UNITS);
  const zy0 = Math.round(mz / layout.regions.length / ZONE_UNITS);
  for (let r = 0; r < 140 && gesucht.size > 0; r++) {
    for (let zy = zy0 - r; zy <= zy0 + r; zy++) {
      for (let zx = zx0 - r; zx <= zx0 + r; zx++) {
        if (Math.max(Math.abs(zx - zx0), Math.abs(zy - zy0)) !== r) continue;
        const b = eckbiome(zx, zy);
        const gleich = b[0] === b[1] && b[0] === b[2] && b[0] === b[3];
        const gebirge = b.some((x) => x === Biome.Mountain);
        const art = gebirge
          ? 'gebirge'
          : !gleich
            ? 'kante'
            : b[0] === Biome.Ocean
              ? 'ozean'
              : 'einheitlich';
        if (gesucht.has(art)) {
          gesucht.delete(art);
          treffer.push({ art, zx, zy });
        }
      }
    }
  }
  return treffer;
}

const zonen = sucheZonen();
console.log('\nMesszonen:');
for (const z of zonen) {
  console.log(`  ${z.art.padEnd(13)} Zone (${z.zx}, ${z.zy})  Ecken ${eckbiome(z.zx, z.zy).join('/')}`);
}

// ── getZone() ────────────────────────────────────────────────────
//
// Jede Messung braucht eine FRISCHE Zone (sonst misst man den Cache), aber
// dieselbe Geo (der Aufbau des Regionsfelds gehoert nicht in die Messung).
// Deshalb wird der Provider je Wiederholung neu gesetzt und die Zone um
// einen Zonenschritt versetzt — gleiches Gelaende, garantierter Cache-Miss.

function messeZone(z: Messzone, wiederholungen: number): { msJeZone: number; usJeVertex: number } {
  // Aufwaermen (JIT), Ergebnis verworfen
  for (let i = 0; i < 3; i++) new HeightmapProvider(geo).getZone(z.zx + 200 + i, z.zy);
  // Bestwert aus mehreren Serien, nicht Mittelwert: Auf einem Arbeitsrechner
  // streuen die Serien um 20 % nach OBEN (Sammler, Taktung, andere Prozesse),
  // aber nie nach unten. Das Minimum ist damit die stabilste Schaetzung fuer
  // "so schnell ist der Code" — und nur die soll der Vorher/Nachher-Vergleich
  // messen.
  let best = Infinity;
  for (let serie = 0; serie < 5; serie++) {
    const t0 = performance.now();
    for (let i = 0; i < wiederholungen; i++) {
      const p = new HeightmapProvider(geo);
      p.getZone(z.zx, z.zy);
    }
    const ms = (performance.now() - t0) / wiederholungen;
    if (ms < best) best = ms;
  }
  return { msJeZone: best, usJeVertex: (best * 1000) / 65 / 65 };
}

console.log('\n── getZone() (65x65 = 4225 Vertices) ──');
let summeMs = 0;
for (const z of zonen) {
  const m = messeZone(z, z.art === 'gebirge' ? 8 : 20);
  summeMs += m.msJeZone;
  console.log(
    `  ${z.art.padEnd(13)} ${m.msJeZone.toFixed(2).padStart(8)} ms/Zone   ` +
      `${m.usJeVertex.toFixed(3).padStart(7)} us/Vertex`
  );
}
console.log(`  ${'SUMME'.padEnd(13)} ${summeMs.toFixed(2).padStart(8)} ms`);

// ── getGroundHeight() ────────────────────────────────────────────
//
// Nachgestellt wird bakeShoreRows: ein zeilenweiser Scan ueber ein
// Wassergitter, 16.600 Punkte, Schrittweite wie dort. Der Zonencache ist
// vorher warm — gemessen wird der ABFRAGEPFAD, nicht der Zonenbau.

const PUNKTE_PRO_REIHE = 129;
const SCHRITT = 8; // m zwischen zwei Wasser-Vertices

function messeGrund(wiederholungen: number): { nsJeAufruf: number; aufrufe: number } {
  const p = new HeightmapProvider(geo);
  const ox = zonen[0]!.zx * ZONE_UNITS;
  const oz = zonen[0]!.zy * ZONE_UNITS;
  const halb = (PUNKTE_PRO_REIHE * SCHRITT) / 2;
  // Zonencache warmlaufen lassen (alle beruehrten Zonen einmal bauen)
  let senke = 0;
  for (let r = 0; r < PUNKTE_PRO_REIHE; r++) {
    for (let c = 0; c < PUNKTE_PRO_REIHE; c++) {
      senke += p.getGroundHeight(ox - halb + c * SCHRITT, oz - halb + r * SCHRITT);
    }
  }
  const aufrufe = wiederholungen * PUNKTE_PRO_REIHE * PUNKTE_PRO_REIHE;
  let best = Infinity;
  for (let serie = 0; serie < 5; serie++) {
    const t0 = performance.now();
    for (let w = 0; w < wiederholungen; w++) {
      for (let r = 0; r < PUNKTE_PRO_REIHE; r++) {
        for (let c = 0; c < PUNKTE_PRO_REIHE; c++) {
          senke += p.getGroundHeight(ox - halb + c * SCHRITT, oz - halb + r * SCHRITT);
        }
      }
    }
    const ns = ((performance.now() - t0) * 1e6) / aufrufe;
    if (ns < best) best = ns;
  }
  if (!Number.isFinite(senke)) throw new Error('unmoeglich — haelt den Optimierer fern');
  return { nsJeAufruf: best, aufrufe };
}

console.log('\n── getGroundHeight() (Zonencache warm, bakeShoreRows-Muster) ──');
messeGrund(2);
const g = messeGrund(40);
console.log(
  `  ${g.nsJeAufruf.toFixed(1)} ns/Aufruf  ` +
    `→ ${((g.nsJeAufruf * 16600) / 1e6).toFixed(2)} ms fuer 16.600 Aufrufe`
);

// ── Aufrufzaehler (nur mit Instrumentierung) ─────────────────────

if (process.argv.includes('--zaehler')) {
  const z = globalThis as unknown as Record<string, number | undefined>;
  const namen = [
    '__perlinAufrufe',
    '__detailAufrufe',
    '__feldSampleAufrufe',
    '__signedDistAufrufe',
    '__kantenSchritte',
    '__wasserProbeAufrufe',
    '__plateauProbeAufrufe',
    '__basisAufrufe',
    '__biomHoeheAufrufe',
  ];
  console.log('\n── Aufrufzaehler je EINER Zone ──');
  for (const mz of zonen) {
    for (const n of namen) z[n] = 0;
    new HeightmapProvider(geo).getZone(mz.zx, mz.zy);
    console.log(`  ${mz.art}:`);
    for (const n of namen) {
      const v = z[n] ?? 0;
      console.log(
        `      ${n.replace('__', '').padEnd(20)} ${String(v).padStart(10)}   ` +
          `${(v / 4225).toFixed(1).padStart(8)} je Vertex`
      );
    }
  }
}
