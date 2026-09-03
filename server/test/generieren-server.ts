/**
 * Rot-Test fuer Ziel B — `DungeonManager.createGenerated` mit
 * Generator-Einstellungen (maxRooms/zoneSize-Override aus dem Dokument).
 *
 * VOR DER UMSETZUNG ROT: `createGenerated` nimmt heute nur
 * `(baseName, seed, id?)` — ein vierter Parameter `einstellungen` existiert
 * nicht (Annahme dieses Tests, macht den Aufruf selbst schon zum roten
 * Befund unter `tsc`; `tsx` fuehrt ihn trotzdem aus und ignoriert das
 * ueberzaehlige Argument). Erwartet wird nach der Umsetzung:
 *   - `createGenerated(baseName, seed, id?, einstellungen?)` reicht
 *     `einstellungen.maxRooms` als Kit-Override (Kopie von `def`) und
 *     `einstellungen.zoneSize` als `settingsIn` an `generateDungeonLayout`
 *     durch.
 *   - Das gespeicherte Dokument traegt `generatorEinstellungen` und sein
 *     `zoneSize` ist der WIRKLICH benutzte Wert, nicht mehr hart 64.
 *   - Ein zweiter Manager auf demselben Verzeichnis liest das Dokument mit
 *     `generatorEinstellungen` unveraendert zurueck.
 *   - `createGenerated(doc.base, neuerSeed, doc.id)` OHNE eigenes
 *     `einstellungen`-Argument (wie `dungeon regen` es heute aufruft) MUSS
 *     die im Dokument gespeicherten Einstellungen weiterverwenden, nicht
 *     auf die Kit-Vorgabe zurueckfallen.
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Lauf: npx tsx server/test/generieren-server.ts   (aus dem Repo-Wurzelverzeichnis)
 */

import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { HeightmapProvider, getStableHash } from '@wov/shared';
import { LeereGeo } from '@wov/shared/src/worldgen/LeereGeo.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { DungeonManager } from '../src/world/dungeon/DungeonManager.js';
import { Welt } from '../src/world/Welt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DUNGEONS_DIR = resolve(__dirname, 'tmp-generieren-server');

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

rmSync(DUNGEONS_DIR, { recursive: true, force: true });

// Weltfabrik wie in g5-dungeons.ts — hier nur noetig, weil der
// `DungeonManager`-Konstruktor sie verlangt; materialisiert wird in
// diesem Test nichts.
const zdos = new ZDOManager(1n);
const geo = new LeereGeo();
const welten = new Map<string, Welt>();
const umgebung = { prefabName: () => undefined, kreaturTrifft: () => {} };
const weltAnlegen = (weltId: string): Welt => {
  const vorhanden = welten.get(weltId);
  if (vorhanden) return vorhanden;
  const welt = new Welt(
    {
      id: weltId,
      geo,
      heightmaps: new HeightmapProvider(geo),
      zonenSeed: getStableHash(weltId),
      zonenOptionen: { worldFeatures: false, worldVegetation: false },
      mitKreaturen: false,
      mitZonengenerierung: false,
      serverUserId: 1n,
    },
    umgebung
  );
  welten.set(weltId, welt);
  return welt;
};
const weltEntfernen = (weltId: string): void => {
  welten.delete(weltId);
};

const mgr = new DungeonManager(zdos, DUNGEONS_DIR, weltAnlegen, weltEntfernen);
mgr.load();

// ── 1. createGenerated mit Einstellungen ────────────────────────────
console.log('\ncreateGenerated mit Einstellungen:');

// Vergleichsbasis: dieselbe Basis/Seed OHNE Override.
const ohneOverride = (
  mgr as unknown as {
    createGenerated(base: string, seed: number, id?: string): { layout: { rooms: unknown[] } } | null;
  }
).createGenerated('DG_Steingrab', 4242, 'vergleich-ohne-override');
check('Vergleichsdokument ohne Override entsteht', ohneOverride !== null);

const mitOverride = (
  mgr as unknown as {
    createGenerated(
      base: string,
      seed: number,
      id?: string,
      einstellungen?: { maxRooms?: number; zoneSize?: number }
    ): {
      layout: { rooms: unknown[] };
      zoneSize: number;
      generatorEinstellungen?: { maxRooms?: number; zoneSize?: number };
    } | null;
  }
).createGenerated('DG_Steingrab', 4242, 'mit-override', { maxRooms: 6, zoneSize: 24 });
check('Dokument mit Override entsteht', mitOverride !== null);
check(
  'generatorEinstellungen steht im Dokument',
  mitOverride?.generatorEinstellungen?.maxRooms === 6 &&
    mitOverride?.generatorEinstellungen?.zoneSize === 24,
  JSON.stringify(mitOverride?.generatorEinstellungen)
);
check(
  'zoneSize im Dokument ist der WIRKLICH benutzte Wert (24), nicht hart 64',
  mitOverride?.zoneSize === 24,
  `ist ${mitOverride?.zoneSize}`
);
check(
  'maxRooms:6 ergibt spuerbar weniger Raeume als ohne Override',
  (mitOverride?.layout.rooms.length ?? Infinity) < (ohneOverride?.layout.rooms.length ?? 0),
  `${mitOverride?.layout.rooms.length} < ${ohneOverride?.layout.rooms.length}?`
);

// ── 2. Zweiter Manager liest zurueck ─────────────────────────────────
console.log('\nDisk-Rundreise:');
const mgr2 = new DungeonManager(zdos, DUNGEONS_DIR, weltAnlegen, weltEntfernen);
mgr2.load();
const zurueckgelesen = mgr2.getDocument('mit-override') as
  | { generatorEinstellungen?: { maxRooms?: number; zoneSize?: number }; zoneSize: number }
  | undefined
  | null;
check(
  'zweiter Manager sieht generatorEinstellungen unveraendert',
  zurueckgelesen?.generatorEinstellungen?.maxRooms === 6 &&
    zurueckgelesen?.generatorEinstellungen?.zoneSize === 24,
  JSON.stringify(zurueckgelesen?.generatorEinstellungen)
);
check('zweiter Manager sieht zoneSize 24', zurueckgelesen?.zoneSize === 24, `${zurueckgelesen?.zoneSize}`);

// ── 3. regen-Aequivalent: Einstellungen ueberleben ohne erneute Angabe ──
console.log('\nregen-Aequivalent (dungeon regen ruft ohne einstellungen auf):');
const regeneriert = (
  mgr as unknown as {
    createGenerated(
      base: string,
      seed: number,
      id?: string
    ): {
      layout: { rooms: unknown[] };
      zoneSize: number;
      generatorEinstellungen?: { maxRooms?: number; zoneSize?: number };
    } | null;
  }
).createGenerated('DG_Steingrab', 999, 'mit-override');
check(
  'regen ohne eigenes einstellungen-Argument behaelt die gespeicherten Einstellungen',
  regeneriert?.generatorEinstellungen?.maxRooms === 6 &&
    regeneriert?.generatorEinstellungen?.zoneSize === 24,
  JSON.stringify(regeneriert?.generatorEinstellungen)
);
check(
  'und das neue Layout ist mit zoneSize 24 gebaut, nicht mit der Kit-Vorgabe',
  regeneriert?.zoneSize === 24,
  `ist ${regeneriert?.zoneSize}`
);

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exit(1);
}
console.log('\nAlle Generator-Einstellungen-Server-Pruefungen gruen.');
