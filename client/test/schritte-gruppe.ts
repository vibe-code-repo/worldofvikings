/**
 * Untergrundwahl der Schritte (client/src/engine/Audio/Schritte.ts,
 * shared/src/worldgen/bodenMischung.ts): Punkt auf Fels-Hang -> Fels-Gruppe,
 * Wiese -> Gras, auf einem Holz-Bauteil -> Holz; jede verwendete Gruppe
 * existiert im `toene`-Abschnitt der ECHTEN assets/manifest.json und wird von
 * der Ton-Engine (readAudioManifest/groupByBus) unter Bus `world` gefunden.
 *
 * Lauf: npx tsx client/test/schritte-gruppe.ts   (aus dem Repo-Wurzel)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Biome, WATER_LEVEL } from '@wov/shared';
import {
  BODENARTEN,
  KLANGGRUPPE,
  bodenMischungBei,
  ueberwiegendeBodenart,
  type BodenQuelle,
  type BodenZone,
} from '@wov/shared/src/worldgen/bodenMischung.js';
import {
  schrittGruppe,
  GRUPPE_HOLZ,
  GRUPPE_STEIN,
  GRUPPE_WASSER,
  KNIETIEFE,
} from '../src/engine/Audio/Schritte';
import { readAudioManifest, groupByBus } from '../src/engine/Audio/AudioManifest';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

function quelleMit(biom: Biome, hoehe: (x: number, z: number) => number): BodenQuelle {
  const zone: BodenZone = {
    zoneX: 0,
    zoneY: 0,
    cornerBiomes: [biom, biom, biom, biom],
    getBiome: () => biom,
    getVegetationMask: () => 0,
  };
  return { getGroundHeight: hoehe, getZoneAt: () => zone };
}
const wiese = quelleMit(Biome.Meadows, () => 60);
const hang55 = quelleMit(Biome.Meadows, (x) => 60 + Math.tan((55 * Math.PI) / 180) * x);

// Der Punkt mit dem staerksten Felsanteil auf dem 55°-Hang (das Rauschen macht Flecken).
let felsPunkt: [number, number] = [0, 0];
{
  let best = -1;
  for (let x = -30; x <= 30; x += 0.5) {
    for (let z = -30; z <= 30; z += 0.5) {
      const f = bodenMischungBei(x, z, hang55).fels;
      if (f > best) {
        best = f;
        felsPunkt = [x, z];
      }
    }
  }
}

console.log('=== Untergrundwahl der Schritte ===');
console.log('\n[1] Gelaende:');
{
  const g = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: null, quelle: wiese });
  pruefe('Wiese -> Gras-Gruppe', g === 'footsteps/grass', String(g));
  const f = schrittGruppe({ x: felsPunkt[0], z: felsPunkt[1], dungeon: false, koerperHoehe: null, quelle: hang55 });
  const art = ueberwiegendeBodenart(bodenMischungBei(felsPunkt[0], felsPunkt[1], hang55));
  pruefe('Fels-Hang (55°, Felsfleck) -> Bodenart Fels', art === 'fels', art);
  pruefe('… und deren Klanggruppe', f === KLANGGRUPPE.fels, String(f));
  const schnee = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: null, quelle: quelleMit(Biome.Mountain, () => 130) });
  pruefe('Gebirge ueber der Schneelinie -> Schnee-Gruppe', schnee === 'footsteps/snow', String(schnee));
}

console.log('\n[2] Objekte, Dungeon, Wasser:');
{
  const holz = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: 61.2, quelle: wiese });
  pruefe('auf einem Holz-Bauteil (Koerper 1,2 m ueber dem Gelaende) -> Holz', holz === GRUPPE_HOLZ, String(holz));
  const nurGelaende = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: 60.05, quelle: wiese });
  pruefe('Koerper nur 5 cm ueber dem Gelaende (Terrain-Collider) -> weiter Boden', nurGelaende === 'footsteps/grass', String(nurGelaende));
  // Am 22°-Hang (Steigung 0,4) liegt der Gelaende-Collider bis 0,22 m neben der Heightmap (Messung im Browser): kein Holz.
  const hang = quelleMit(Biome.Meadows, (x) => 60 + 0.4 * x);
  const amHang = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: 62 + 0.22, quelle: hang });
  pruefe('Gelaende-Collider 0,22 m ueber der Heightmap am Hang (Steigung 0,4) -> kein Holz', amHang !== GRUPPE_HOLZ, String(amHang));
  const holzHang = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: 62 + 0.9, quelle: hang });
  pruefe('Bauteil 0,9 m ueber dem Gelaende am selben Hang -> Holz', holzHang === GRUPPE_HOLZ, String(holzHang));
  const flachHolz = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: 60.2, quelle: wiese });
  pruefe('flacher Boden: Bauteil 0,2 m ueber dem Gelaende -> Holz', flachHolz === GRUPPE_HOLZ, String(flachHolz));
  const dungeon = schrittGruppe({ x: 5, z: 5, dungeon: true, koerperHoehe: 3, quelle: wiese });
  pruefe('Dungeon -> Stein', dungeon === GRUPPE_STEIN, String(dungeon));
  const flach = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: null, quelle: quelleMit(Biome.Meadows, () => WATER_LEVEL - 0.3) });
  pruefe('Wasser 0,3 m tief (unter Knietiefe) -> Wasser-Gruppe', flach === GRUPPE_WASSER, String(flach));
  const tief = schrittGruppe({ x: 5, z: 5, dungeon: false, koerperHoehe: null, quelle: quelleMit(Biome.Meadows, () => WATER_LEVEL - KNIETIEFE - 0.2) });
  pruefe('Wasser ueber Knietiefe -> kein Schritt', tief === null, String(tief));
}

console.log('\n[3] Jede Gruppe existiert im echten Manifest:');
{
  const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const manifest = JSON.parse(readFileSync(resolve(wurzel, 'assets/manifest.json'), 'utf-8')) as { toene?: Record<string, unknown> };
  pruefe('assets/manifest.json hat einen toene-Abschnitt', typeof manifest.toene === 'object' && manifest.toene !== null);
  const gruppen = groupByBus(readAudioManifest(manifest)).world;
  const verwendet = new Set<string>([...BODENARTEN.map((b) => KLANGGRUPPE[b]), GRUPPE_HOLZ, GRUPPE_WASSER, GRUPPE_STEIN]);
  for (const g of verwendet) {
    const klips = gruppen.get(g) ?? [];
    pruefe(`Gruppe ${g} hat Klips unter Bus world`, klips.length > 0, `${klips.length} Klips`);
  }
  const alle = Object.keys(manifest.toene ?? {}).filter((k) => k.startsWith('footsteps/'));
  pruefe('46 Aufnahmen unter footsteps/ im Manifest', alle.length === 46, String(alle.length));
}

if (fehler > 0) {
  console.error(`\n${fehler} FEHLER`);
  process.exit(1);
}
console.log('\nALLE GRÜN');
