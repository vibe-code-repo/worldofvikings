/**
 * Rot-Test fuer P5 — Steinmaterial je PLATZIERTEM RAUM, ueber die Leitung.
 * Red test for P5 — per-PLACED-ROOM stone material, over the wire.
 *
 *   npx tsx server/test/p5-raum-steinkit.ts   (aus dem Repo-Wurzelverzeichnis)
 *
 * Ergaenzt `shared/test/dungeon-steinkit-dokument.ts` (Sanitizer) um den
 * TRANSPORT: Kartierung entschied sich fuer den Member-Weg — ein
 * String-Member `steinKit` am Raum-ZDO, gesetzt in
 * `DungeonManager.materialize()`, generisch ueber die Leitung getragen
 * (Server-seitig `writeZDO` serialisiert jeden Member unabhaengig vom
 * Namen), und client-seitig zu ergaenzen in `ZDOSync.parseZDOSync()`.
 * Dieser Test bleibt bewusst SERVERSEITIG (ZDO direkt aus der ZDOManager
 * der Instanz gelesen) — er beweist den Member, nicht den Client-Umbau.
 *
 * VOR DER UMSETZUNG ROT, weil:
 *   - `sanitizeDungeonDocument` liest `PlacedRoom.steinKit` noch nicht ein
 *     (s. `shared/test/dungeon-steinkit-dokument.ts`, Abschnitt 5-8) — das
 *     gespeicherte Dokument traegt den Override also gar nicht erst.
 *   - `DungeonManager.materialize()` setzt in `zdos.createZDO(...)` noch
 *     keinen `steinKit`-Member auf dem Raum-ZDO.
 *
 * NACH DER UMSETZUNG GRUEN, OHNE AENDERUNG an diesem Test.
 *
 * Geprueft wird:
 *  1. Dokument (`DG_StoneVault`, `createGenerated`) mit `steinKit` an Raum
 *     Index 3 (wand=stein_moos, moos=3) gespeichert.
 *  2. Nach `getOrCreateInstance` traegt GENAU das ZDO dieses Raums (per
 *     prefabHash + Position aus dem Layout gefunden, Toleranz 1e-3) den
 *     String-Member `steinKit` mit dem erwarteten, sanitisierten JSON.
 *  3. Alle anderen Raum-ZDOs — auch die mit DEMSELBEN prefabHash (der Kit
 *     hat mehrere Raeume desselben Typs) — tragen KEINEN `steinKit`-Member.
 */

import { rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  DUNGEONS_BY_NAME,
  HeightmapProvider,
  getStableHash,
  sanitizeSteinKit,
  type DungeonDocument,
} from '@wov/shared';
import { LeereGeo } from '@wov/shared/src/worldgen/LeereGeo.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { DungeonManager } from '../src/world/dungeon/DungeonManager.js';
import { Welt } from '../src/world/Welt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, 'tmp-p5-raum-steinkit');

let fehler = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    fehler++;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

rmSync(DIR, { recursive: true, force: true });

const geo = new LeereGeo();
const welten = new Map<string, Welt>();
const umgebung = { prefabName: () => undefined, kreaturTrifft: () => {} };
const weltAnlegen = (weltId: string): Welt => {
  const da = welten.get(weltId);
  if (da) return da;
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

const zdos = new ZDOManager(1n);
const mgr = new DungeonManager(zdos, DIR, weltAnlegen, weltEntfernen);
mgr.load();

const STEIN_KIT_HASH = getStableHash('steinKit');

// ── 1. Dokument mit Raum-Override anlegen ─────────────────────────────────

console.log('\nDokument mit Raum-Override:');
const ID = 'p5-raum-steinkit';
const doc = mgr.createGenerated('DG_StoneVault', 111, ID);
check('Dokument erzeugt', doc !== null, doc ? `${doc.layout.rooms.length} Räume` : '');
if (!doc) {
  console.log('p5-raum-steinkit: ABBRUCH — Dokument nicht anlegbar');
  process.exit(1);
}

const ROOM_INDEX = 3;
check(
  'genug Räume für Index 3',
  doc.layout.rooms.length > ROOM_INDEX,
  `${doc.layout.rooms.length} Räume`
);

const kit = DUNGEONS_BY_NAME.get('DG_StoneVault')!;
const zielRaum = doc.layout.rooms[ROOM_INDEX]!;
const zielRoomDef = kit.rooms.find((r) => r.name === zielRaum.room)!;
const ZIEL_PREFAB_HASH = zielRoomDef.hash;
const ZIEL_POS = { ...zielRaum.pos };

/** Das erwartete, gesäuberte `steinKit` — "wand=stein_moos moos=3". */
const ROH_STEINKIT = {
  wandTextur: 'stein_moos',
  verwitterung: { moos: 3, frost: 0, nass: 0 },
};
const ERWARTETES_STEINKIT = sanitizeSteinKit(ROH_STEINKIT)!;
check('erwartetes steinKit ist gültig (Testvoraussetzung)', ERWARTETES_STEINKIT !== undefined);

const mitRaumKit = JSON.parse(JSON.stringify(doc)) as DungeonDocument;
(mitRaumKit.layout.rooms[ROOM_INDEX] as unknown as Record<string, unknown>).steinKit =
  ROH_STEINKIT;
const gespeichert = mgr.upsertDocument(mitRaumKit);
check('Dokument mit Raum-Override gespeichert', gespeichert !== null);

const vonPlatte = mgr.getDocument(ID);
check(
  'gespeichertes Dokument trägt den Raum-Override',
  vonPlatte !== undefined &&
    (vonPlatte.layout.rooms[ROOM_INDEX] as unknown as { steinKit?: unknown }).steinKit !==
      undefined,
  JSON.stringify((vonPlatte?.layout.rooms[ROOM_INDEX] as unknown as { steinKit?: unknown })?.steinKit)
);

// ── 2. Instanz betreten — ZDO des Ziel-Raums prüfen ───────────────────────

console.log('\nInstanz — Ziel-Raum-ZDO trägt den steinKit-Member:');
const inst = mgr.getOrCreateInstance(ID);
check('Instanz materialisiert', inst !== null);
if (!inst) {
  console.log('p5-raum-steinkit: ABBRUCH — Instanz nicht anlegbar');
  process.exit(1);
}

const TOLERANZ = 1e-3;
const nah = (a: number, b: number): boolean => Math.abs(a - b) < TOLERANZ;

const kandidatenZielPrefab = inst.welt.zdos.getZDOByPrefab(ZIEL_PREFAB_HASH);
check(
  'mindestens ein ZDO mit dem Ziel-prefabHash existiert',
  kandidatenZielPrefab.length > 0,
  `${kandidatenZielPrefab.length} Kandidaten`
);

const zielZdo = kandidatenZielPrefab.find(
  (z) =>
    nah(z.position.x, ZIEL_POS.x) && nah(z.position.y, ZIEL_POS.y) && nah(z.position.z, ZIEL_POS.z)
);
check(
  'Ziel-Raum-ZDO über prefabHash + Position gefunden',
  zielZdo !== undefined,
  `Position gesucht: ${JSON.stringify(ZIEL_POS)}`
);

if (zielZdo) {
  check('Ziel-Raum-ZDO trägt einen steinKit-Member', zielZdo.hasMember(STEIN_KIT_HASH));
  const json = zielZdo.getString('steinKit', '__kein_member__');
  check('steinKit-Member ist kein Platzhalter', json !== '__kein_member__');
  let geparst: unknown = undefined;
  try {
    geparst = JSON.parse(json);
  } catch {
    // bleibt undefined — der folgende Check schlägt dann fehl
  }
  check(
    'steinKit-Member enthält das erwartete, sanitisierte JSON',
    JSON.stringify(geparst) === JSON.stringify(ERWARTETES_STEINKIT),
    `ist ${json}`
  );
}

// ── 3. Alle anderen Raum-ZDOs bleiben ohne den Member ─────────────────────

console.log('\nAndere Räume — kein steinKit-Member:');

// (a) Räume DESSELBEN prefabHash (der Kit hat mehrere Räume desselben Typs)
// an einer ANDEREN Position müssen frei bleiben — der Bucket/Member ist an
// die konkrete Platzierung gebunden, nicht an den Prefab.
const andereMitGleichemPrefab = kandidatenZielPrefab.filter((z) => z !== zielZdo);
check(
  'Testvoraussetzung: es gibt weitere ZDOs mit demselben prefabHash',
  andereMitGleichemPrefab.length > 0,
  `${andereMitGleichemPrefab.length}`
);
check(
  'kein anderes ZDO mit gleichem prefabHash trägt den steinKit-Member',
  andereMitGleichemPrefab.every((z) => !z.hasMember(STEIN_KIT_HASH)),
  `${andereMitGleichemPrefab.filter((z) => z.hasMember(STEIN_KIT_HASH)).length} betroffen`
);

// (b) Ein Raum an einem ANDEREN Index (anderer prefabHash) bleibt ebenfalls
// frei — stellvertretend Index 0 (Eingangsraum).
const ANDERER_INDEX = 0;
const andererRaum = doc.layout.rooms[ANDERER_INDEX]!;
const andererRoomDef = kit.rooms.find((r) => r.name === andererRaum.room)!;
const andereZdos = inst.welt.zdos
  .getZDOByPrefab(andererRoomDef.hash)
  .filter(
    (z) =>
      nah(z.position.x, andererRaum.pos.x) &&
      nah(z.position.y, andererRaum.pos.y) &&
      nah(z.position.z, andererRaum.pos.z)
  );
check('Vergleichs-Raum (Index 0) gefunden', andereZdos.length > 0, `${andereZdos.length}`);
check(
  'Vergleichs-Raum ohne Override trägt keinen steinKit-Member',
  andereZdos.every((z) => !z.hasMember(STEIN_KIT_HASH))
);

if (fehler > 0) {
  console.error(`\n${fehler} FAILURES`);
  process.exit(1);
}
console.log('\nAlle P5-Raum-steinKit-Prüfungen grün.');
