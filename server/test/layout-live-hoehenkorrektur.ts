/**
 * K5.0 / Karte T1: `heightDeltas` (Handkorrektur der Geländehöhe) ist eine
 * "geo"-Änderung wie Regionen/Wasser/Sockel — 202, kein Live-Übernehmen,
 * Neustart nötig. Reiner Test der Klassifizierung (`geoAenderung`), ohne
 * einen Spielserver zu starten: `server/src/WovServer.ts` bleibt unberührt.
 *
 *   npx tsx test/layout-live-hoehenkorrektur.ts   (aus server/)
 */
import { geoAenderung } from '../src/world/layoutLive.js';
import type { WorldLayout } from '@wov/shared/src/worldlayout/types.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}

function basis(extra: Record<string, unknown> = {}): WorldLayout {
  return {
    version: 1,
    name: 'x',
    detailSeed: 'geo-hoehenkorrektur-test',
    continents: [],
    regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 500 }, edgeFalloff: 100 }],
    ...extra,
  } as unknown as WorldLayout;
}

{
  const alt = basis();
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  check('heightDeltas dazu (vorher gar keins): als geo eingestuft (gelaende)', geoAenderung(alt, neu).includes('gelaende'), JSON.stringify(geoAenderung(alt, neu)));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  const neu = basis({ heightDeltas: [] });
  check('heightDeltas entfernt: als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 60]] }] });
  check('heightDeltas geändert (anderes Delta am selben Punkt): als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[11, 50]] }] });
  check('heightDeltas geändert (anderer Rasterpunkt): als geo eingestuft', geoAenderung(alt, neu).includes('gelaende'));
}
{
  const alt = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  const neu = basis({ heightDeltas: [{ zx: 0, zz: 0, points: [[10, 50]] }] });
  check('heightDeltas unverändert: NICHT als geo eingestuft', !geoAenderung(alt, neu).includes('gelaende'), JSON.stringify(geoAenderung(alt, neu)));
}
{
  const alt = basis();
  const neu = basis();
  check('kein heightDeltas auf beiden Seiten: keine geo-Änderung', geoAenderung(alt, neu).length === 0);
  const neuMitPlatzierung = basis({ placements: [{ id: 'p1', prefab: 'Kiste', x: 1, z: 1 }] });
  check('eine ANDERE Änderung bleibt unbeeinflusst (kein Platzierungs-Rauschen durch heightDeltas)', geoAenderung(alt, neuMitPlatzierung).length === 0);
}

console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
