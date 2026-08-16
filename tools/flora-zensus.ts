/**
 * E9 — Vegetationsvielfalt: erst messen, dann ändern.
 *
 * Die Aufgabe stammt aus der Zeit vor Block A und nannte einen konkreten
 * Verdacht an der ALTEN Valheim-Tabelle (ein Farn mit `inForest: true` und
 * zugleich `maxAlt: 4.0`, der damit praktisch nie erscheint). Diese Tabelle
 * gibt es nicht mehr — `shared/src/flora.ts` ist seit Block A reine
 * Eigenflora. Die Frage dahinter gilt weiter, muss aber neu gestellt werden:
 *
 *   Kommt jede Art, die in einer Kuratierungsliste steht, in der Welt auch
 *   wirklich vor — und in welchem Verhältnis?
 *
 * Der Zensus streut die Zonen um den Nullpunkt einer Testinsel je Biom und
 * zählt die abgelegten ZDOs nach Prefabnamen. Aufbau und Radien sind aus
 * `server/test/h4-graslandflora.ts` übernommen, damit die Zahlen mit dem
 * vorhandenen Test vergleichbar bleiben.
 *
 * Lauf: npx tsx mess/flora-zensus.ts
 */
import {
  ASCHE_FLORA_NAMEN,
  GRASLAND_FLORA_NAMEN,
  HOCHNORD_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  SUMPF_FLORA_NAMEN,
  EIGENE_FLORA,
  HeightmapProvider,
  RegionGeo,
  findPrefabByHash,
  getStableHash,
  sanitizeWorldLayout,
  type WorldLayout,
} from '@wov/shared';
import { ZDOManager } from '../server/src/zdo/ZDOManager.js';
import { ZoneManager } from '../server/src/world/ZoneManager.js';

const SEED = getStableHash('GraslandProbe');

function insel(vegetation: readonly string[], biom: string): WorldLayout {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Zensus',
    detailSeed: 'gp',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: biom,
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [...vegetation],
      },
    ],
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  return layout;
}

function bewuchs(layout: WorldLayout): Map<string, number> {
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, {
    blendSmoothStep: true,
    bilinearSampling: false,
  });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  zm.update([{ x: 0, y: 40, z: 0 }], 60_000);
  const zaehler = new Map<string, number>();
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const name = findPrefabByHash(zdo.prefabHash)?.name ?? String(zdo.prefabHash);
        zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
      }
    }
  }
  return zaehler;
}

const buendel: Array<[string, string, readonly string[]]> = [
  ['Grasland', 'grassland', GRASLAND_FLORA_NAMEN],
  ['Nadelwald', 'blackforest', NADELWALD_FLORA_NAMEN],
  ['Sumpf', 'swamp', SUMPF_FLORA_NAMEN],
  ['Hochnord', 'deepnorth', HOCHNORD_FLORA_NAMEN],
  ['Asche', 'ashlands', ASCHE_FLORA_NAMEN],
];

/** Streueintrag je Name — für die Diagnose der Nullen. */
const eintrag = new Map(EIGENE_FLORA.map((f) => [f.prefabName, f]));

let nullen = 0;
for (const [titel, biom, namen] of buendel) {
  if (namen.length === 0) {
    console.log(`\n══ ${titel} (${biom}) — Bündel ist leer, nichts zu messen`);
    continue;
  }
  const zaehler = bewuchs(insel(namen, biom));
  const gesamt = [...namen].reduce((s, n) => s + (zaehler.get(n) ?? 0), 0);
  console.log(`\n══ ${titel} (${biom}) — ${namen.length} Arten, ${gesamt} Pflanzen auf 13×13 Zonen`);
  const zeilen = [...namen]
    .map((n) => ({ n, k: zaehler.get(n) ?? 0 }))
    .sort((a, b) => a.k - b.k);
  for (const { n, k } of zeilen) {
    const f = eintrag.get(n);
    const anteil = gesamt > 0 ? ((100 * k) / gesamt).toFixed(1) : '0.0';
    const regel = f
      ? `min/max ${f.min}/${f.max}  Höhe ${f.minAltitude}…${f.maxAltitude}` +
        (f.inForest ? `  Wald ${f.forestTresholdMin}…${f.forestTresholdMax}` : '  kein Waldfenster')
      : 'KEIN STREUEINTRAG';
    if (k === 0) nullen++;
    console.log(`  ${k === 0 ? '‼' : ' '} ${n.padEnd(18)} ${String(k).padStart(5)}  ${anteil.padStart(5)} %   ${regel}`);
  }
  // Fremdes darf nach dem Kuratierungstor nicht vorkommen — Gegenprobe.
  const fremd = [...zaehler.keys()].filter((n) => !namen.includes(n));
  if (fremd.length) console.log(`  ausserhalb der Liste: ${fremd.join(', ')}`);
}

console.log(`\nArten mit NULL Vorkommen: ${nullen}`);
