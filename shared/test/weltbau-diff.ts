/**
 * world_diff: zwölf festgelegte Änderungspaare mit erwarteten Zählern
 * (neu / geändert / entfernt / verschoben, dazu das Geo-Kennzeichen).
 *
 * Lauf: npx tsx shared/test/weltbau-diff.ts   (aus shared/)
 */
import type { PlacementDef, WorldLayout } from '../src/worldlayout/types.js';
import { diffLayouts, type DiffZaehler } from '../src/weltbau/diff.js';

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (!bedingung) fehler++;
  console.log(`${bedingung ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const pl = (id: string, x: number, z: number, extra: Record<string, unknown> = {}): PlacementDef =>
  ({ id, prefab: 'Kiste', x, z, ...extra }) as PlacementDef;

function dok(p: PlacementDef[], extra: Record<string, unknown> = {}): WorldLayout {
  return {
    version: 1,
    name: 'd',
    detailSeed: 's',
    continents: [],
    regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 300 }],
    placements: p,
    routes: [{ id: 'r1', points: [[0, 0], [10, 0]], mode: 'loop' }],
    lakes: [{ id: 'see', x: 50, z: 50, radius: 10 }],
    ...extra,
  } as unknown as WorldLayout;
}

const Z = (neu: number, geaendert: number, entfernt: number, verschoben: number): DiffZaehler => ({ neu, geaendert, entfernt, verschoben });
const gleich = (a: DiffZaehler, b: DiffZaehler): boolean =>
  a.neu === b.neu && a.geaendert === b.geaendert && a.entfernt === b.entfernt && a.verschoben === b.verschoben;

const BASIS = dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3)]);

const faelle: Array<[string, WorldLayout, DiffZaehler, boolean]> = [
  ['1 identisch', dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 0, 0, 0), false],
  ['2 eine Platzierung neu', dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3), pl('d', 4, 4)]), Z(1, 0, 0, 0), false],
  ['3 eine entfernt', dok([pl('a', 1, 1), pl('b', 2, 2)]), Z(0, 0, 1, 0), false],
  ['4 nur x geändert = verschoben', dok([pl('a', 9, 1), pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 0, 0, 1), false],
  ['5 nur yaw geändert = verschoben', dok([pl('a', 1, 1, { yaw: 1 }), pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 0, 0, 1), false],
  ['6 Prefab geändert', dok([{ ...pl('a', 1, 1), prefab: 'Fass' } as PlacementDef, pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 1, 0, 0), false],
  ['7 Feldreihenfolge egal', dok([{ z: 1, x: 1, prefab: 'Kiste', id: 'a' } as PlacementDef, pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 0, 0, 0), false],
  ['8 einebnen neu gesetzt = geändert + Geo', dok([pl('a', 1, 1, { einebnen: 5 }), pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 1, 0, 0), true],
  ['9 einebnen und x zugleich = geändert (nicht verschoben) + Geo', dok([pl('a', 8, 1, { einebnen: 5 }), pl('b', 2, 2), pl('c', 3, 3)]), Z(0, 1, 0, 0), true],
  [
    '10 Region geändert = Geo',
    dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3)], {
      regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 200 }, edgeFalloff: 300 }],
    }),
    Z(0, 1, 0, 0),
    true,
  ],
  ['11 Route geändert, kein Geo', dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3)], { routes: [{ id: 'r1', points: [[0, 0], [20, 0]], mode: 'loop' }] }), Z(0, 1, 0, 0), false],
  ['12 See entfernt + Startpunkt gesetzt', dok([pl('a', 1, 1), pl('b', 2, 2), pl('c', 3, 3)], { lakes: [], defaultSpawn: [5, 5] }), Z(0, 1, 1, 0), true],
];
let bestanden = 0;
for (const [name, neu, soll, geo] of faelle) {
  const d = diffLayouts(BASIS, neu);
  const richtig = gleich(d.zaehler, soll) && d.geo === geo;
  if (richtig) bestanden++;
  pruefe(`Paar ${name}`, richtig, `${JSON.stringify(d.zaehler)} geo=${d.geo}`);
}
pruefe(`${faelle.length} von ${faelle.length} Paaren stimmen`, bestanden === faelle.length);

// Sammlung für Sammlung
const gemischt = dok(
  [pl('a', 5, 1), { ...pl('b', 2, 2), prefab: 'Fass' } as PlacementDef, pl('n1', 7, 7), pl('n2', 8, 8, { einebnen: 3 })],
  {
    regions: [
      { id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 100 }, edgeFalloff: 300 },
      { id: 'neu', biome: 'swamp', shape: { kind: 'circle', x: 500, z: 0, radius: 100 }, edgeFalloff: 300 },
    ],
  }
);
const d = diffLayouts(BASIS, gemischt);
pruefe('gemischt: Zähler gesamt 3 neu, 1 geändert, 1 entfernt, 1 verschoben',
  gleich(d.zaehler, Z(3, 1, 1, 1)), JSON.stringify(d.zaehler));
pruefe('gemischt: je Sammlung', gleich(d.je.placements, Z(2, 1, 1, 1)) && gleich(d.je.regions, Z(1, 0, 0, 0)) && gleich(d.je.lakes, Z(0, 0, 0, 0)), JSON.stringify(d.je));
pruefe('gemischt: Geo', d.geo === true);
pruefe('verschoben nennt von/nach', d.eintraege.some((e) => e.art === 'verschoben' && e.id === 'a' && e.von?.x === 1 && e.nach?.x === 5));
pruefe('geändert nennt das Feld', d.eintraege.some((e) => e.art === 'geaendert' && e.id === 'b' && e.felder?.join() === 'prefab'));
pruefe('Text zählt', d.text.includes('+2 Objekte') && d.text.includes('1 verschoben') && d.text.includes('(Geo, wirkt nach Neustart)'), d.text);
pruefe('diff(a, a) = 0/0/0/0 und „Keine Änderungen“', gleich(diffLayouts(BASIS, BASIS).zaehler, Z(0, 0, 0, 0)) && diffLayouts(BASIS, BASIS).text === 'Keine Änderungen.');
pruefe('Determinismus', JSON.stringify(diffLayouts(BASIS, gemischt)) === JSON.stringify(d));

// Ausgabegrenze: 600 neue Platzierungen, alle gezählt, 500 ausgegeben
const riesig = dok(Array.from({ length: 600 }, (_, i) => pl(`p${i}`, i, 0)));
const dr = diffLayouts(dok([]), riesig);
pruefe('600 neue: Zähler 600, Einträge 500, 100 ausgelassen', dr.zaehler.neu === 600 && dr.eintraege.length === 500 && dr.ausgelassen === 100);

// Laufzeit
const t0 = performance.now();
const gross = dok(Array.from({ length: 2000 }, (_, i) => pl(`p${i}`, i, 0)));
const gross2 = dok(Array.from({ length: 2000 }, (_, i) => pl(`p${i}`, i + (i % 7 === 0 ? 1 : 0), 0)));
const dg = diffLayouts(gross, gross2);
const ms = performance.now() - t0;
pruefe('2000 Platzierungen in unter 200 ms (Ziel 50 ms)', ms < 200 && dg.zaehler.verschoben === 286, `${Math.round(ms)} ms, ${dg.zaehler.verschoben} verschoben`);

console.log(`\n${fehler === 0 ? 'ALLE GRUEN' : `${fehler} FEHLGESCHLAGEN`}`);
process.exit(fehler > 0 ? 1 : 0);
