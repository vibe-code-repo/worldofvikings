/**
 * Phase-3-Test des Kartengenerierungs-Umbaus: Layout-Modus im ZoneManager —
 * Zonenfenster aus der Layout-Bbox, Vegetations-Kuratierung je Region.
 *
 * Run: npx tsx test/h1-layout.ts   (aus server/)
 */
import { createGeo, HeightmapProvider, findPrefabByHash, getStableHash } from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

const layout = {
  version: 1,
  name: 'Kuratierte Insel',
  detailSeed: 'h1',
  continents: [],
  regions: [
    {
      id: 'insel',
      biome: 'meadows',
      shape: { kind: 'circle', x: 0, z: 0, radius: 2000 },
      edgeFalloff: 300,
      // Kuratiert: NUR Buchen — alles andere (Birken, Felsen, Büsche …)
      // darf nicht erscheinen.
      vegetation: ['Beech1'],
    },
  ],
};

const seed = getStableHash('h1-test');
const geo = createGeo({ mode: 'layout', worldSeed: seed, layout });
const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true });
const zdos = new ZDOManager(1n);
// Features aus: Der globale Location-Placement-Lauf gehört nicht in diesen
// Test (eigene Abnahme in Phase 4/E2E); hier geht es um Zonen + Vegetation.
const zm = new ZoneManager(geo, heightmaps, zdos, seed, { worldFeatures: false });

// ── Zonen um einen Spieler mitten auf der Insel generieren ───────────
for (let i = 0; i < 50; i++) zm.update([{ x: 0, y: 30, z: 0 }], 1000);
const zonenInsel = zm.generatedZoneCount;
check('Zonen auf der Insel generiert', zonenInsel > 0, `= ${zonenInsel}`);

// Vegetation einsammeln und gegen die Kuratierung prüfen.
const namen = new Map<string, number>();
for (let zy = -4; zy <= 4; zy++) {
  for (let zx = -4; zx <= 4; zx++) {
    for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
      const name = findPrefabByHash(zdo.prefabHash)?.name ?? `#${zdo.prefabHash}`;
      namen.set(name, (namen.get(name) ?? 0) + 1);
    }
  }
}
const arten = [...namen.keys()];
check('Vegetation vorhanden', namen.size > 0, JSON.stringify(arten.slice(0, 6)));
check(
  'Kuratierung exklusiv (nur Beech1)',
  arten.every((n) => n === 'Beech1'),
  `gefunden: ${arten.join(', ')}`
);

// ── Offene See außerhalb der Layout-Bbox bleibt ungeneriert ──────────
const vorher = zm.generatedZoneCount;
for (let i = 0; i < 10; i++) zm.update([{ x: 30000, y: 30, z: 0 }], 1000);
check(
  'Zonen außerhalb der Bbox werden nicht generiert',
  zm.generatedZoneCount === vorher,
  `${vorher} → ${zm.generatedZoneCount}`
);

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== H1-LAYOUT: ALL PASSED ===');
