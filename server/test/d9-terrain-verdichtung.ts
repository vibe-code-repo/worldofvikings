/**
 * D9 — Terraforming verdichten: Endzustand statt Operationsliste.
 *
 * Die Liste der Spieler-Grabungen wuchs unbegrenzt, ging komplett in jeden
 * Save und wurde jedem neu verbindenden Peer vollständig zugeschickt.
 * Verdichtet wird jetzt nicht die Liste, sondern ihr Ergebnis: der
 * TerrainComp je Zone.
 *
 * Terrain-Modifikationen sind Spielerarbeit — eine Verdichtung, die das
 * sichtbare Ergebnis verändert, ist Datenverlust. Deshalb wird hier NICHT
 * „sieht gleich aus" geprüft, sondern jeder der 65×65 Höhenwerte und jeder
 * Masken-Texel BITGENAU:
 *
 *  1. Kodieren → Dekodieren: der Comp ist Feld für Feld derselbe.
 *  2. Verdichtet == unverdichtet: Ein Provider, der nur die Comps
 *     eingesetzt bekommt, liefert exakt dieselben Höhen und Farben wie
 *     einer, der die komplette Operationsliste abspielt.
 *  3. Speichern → Laden → identischer Zustand (über den echten Server).
 *  4. Altstand (v2, Operationsliste) wird beim Laden übernommen und beim
 *     nächsten Save verdichtet weggeschrieben — ohne Unterschied im Boden.
 *  5. Größe: was die Verdichtung tatsächlich einspart.
 *
 * Lauf: npx tsx test/d9-terrain-verdichtung.ts   (aus server/)
 */

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import {
  createGeo,
  getStableHash,
  HeightmapProvider,
  TERRAIN_OP_DEFAULTS,
  PaintType,
  E_WIDTH,
  kodiereTerrainComp,
  dekodiereTerrainComp,
  terrainCompNachBase64,
  type TerrainOpSettings,
  type TerrainComp,
} from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import type { WorldSaveData } from '../src/world/WorldManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d9-worlds');
const SAVE_FILE = resolve(WORLDS_DIR, 'world.db.zst');
const SEED = 'KxSYuZquuw';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

/** Deterministische Pseudo-Zufallsfolge — der Test muss reproduzierbar sein. */
function wuerfel(saat: number): () => number {
  let s = saat >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Eine Folge von Werkzeugschlägen, wie sie beim Bauen entsteht: planieren,
 * ausheben, glätten, Weg pflastern — mehrfach über dieselben Stellen, damit
 * die Operationen einander wirklich überschreiben.
 */
function opFolge(anzahl: number, spanne = 150): Array<{ x: number; y: number; z: number; s: TerrainOpSettings }> {
  const r = wuerfel(20260815);
  const ops: Array<{ x: number; y: number; z: number; s: TerrainOpSettings }> = [];
  for (let i = 0; i < anzahl; i++) {
    // Bewusst eng um den Ursprung: Ohne Überlappung wäre die Verdichtung
    // trivial und der Test würde nichts beweisen. Die Vorgabe von 150 m
    // trifft gleichzeitig mehrere Zonen samt ihrer geteilten Randvertices
    // — genau dort reisst Terrain auf, wenn eine Zone vergessen wird.
    const x = (r() - 0.5) * spanne;
    const z = (r() - 0.5) * spanne;
    const y = 28 + (r() - 0.5) * 4;
    const art = i % 4;
    if (art === 0) {
      ops.push({ x, y, z, s: { ...TERRAIN_OP_DEFAULTS, level: true, levelRadius: 2, square: true } });
    } else if (art === 1) {
      ops.push({
        x, y, z,
        s: { ...TERRAIN_OP_DEFAULTS, raise: true, raiseRadius: 2.5, raiseDelta: r() > 0.5 ? 1 : -1, raisePower: 3, square: false, paintCleared: false },
      });
    } else if (art === 2) {
      ops.push({
        x, y, z,
        s: { ...TERRAIN_OP_DEFAULTS, smooth: true, smoothRadius: 3, smoothPower: 3, paintCleared: false },
      });
    } else {
      ops.push({
        x, y, z,
        s: { ...TERRAIN_OP_DEFAULTS, paintCleared: true, paintRadius: 2, paintType: r() > 0.5 ? PaintType.Cultivate : PaintType.Paved },
      });
    }
  }
  return ops;
}

function neuerProvider(): HeightmapProvider {
  return new HeightmapProvider(
    createGeo({ mode: 'valheim', worldSeed: getStableHash(SEED) }),
    { blendSmoothStep: true, bilinearSampling: false }
  );
}

/** Alle Höhen der berührten Zonen, zum bitgenauen Vergleich. */
function hoehenAbdruck(p: HeightmapProvider, zonen: Array<[number, number]>): Float32Array {
  const out = new Float32Array(zonen.length * E_WIDTH * E_WIDTH);
  zonen.forEach(([zx, zy], n) => {
    out.set(p.getZone(zx, zy).heights, n * E_WIDTH * E_WIDTH);
  });
  return out;
}

function gleich(a: Float32Array | Uint8Array, b: Float32Array | Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Object.is: NaN === NaN muss hier "gleich" heissen, sonst meldet ein
    // legitimer Randwert einen Fehler.
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

console.log('=== D9 Terraforming verdichten ===');

// ── [1] Operationsfolge abspielen ──────────────────────────────────
console.log('\n[1] Operationsfolge auf einem frischen Provider:');
const OPS = 600;
const ops = opFolge(OPS);
const original = neuerProvider();
const beruehrt = new Set<string>();
for (const op of ops) {
  const wirkung = original.applyTerrainOp(op.x, op.y, op.z, op.s);
  for (const [zx, zy] of wirkung.heights) beruehrt.add(`${zx},${zy}`);
  for (const [zx, zy] of wirkung.paint) beruehrt.add(`${zx},${zy}`);
}
const zonen = [...beruehrt].map((k) => k.split(',').map(Number) as [number, number]);
const compsOriginal = [...original.listTerrainComps()].filter((c) => !c.isEmpty);
check('Operationen haben gewirkt', zonen.length > 0, `${zonen.length} Zone(n), ${OPS} Ops`);
check('Comps vorhanden', compsOriginal.length > 0, `${compsOriginal.length} Comp(s)`);

const abdruckOriginal = hoehenAbdruck(original, zonen);

// ── [2] Kodieren → Dekodieren ──────────────────────────────────────
console.log('\n[2] Kodieren → Dekodieren (Feld für Feld):');
let compFehler = 0;
let bytesGesamt = 0;
for (const comp of compsOriginal) {
  const roh = kodiereTerrainComp(comp);
  bytesGesamt += roh.length;
  const zurueck = dekodiereTerrainComp(roh);
  const felder: Array<[string, keyof TerrainComp]> = [
    ['levelDelta', 'levelDelta'],
    ['smoothDelta', 'smoothDelta'],
    ['modifiedHeight', 'modifiedHeight'],
    ['paintMask', 'paintMask'],
    ['modifiedPaint', 'modifiedPaint'],
  ];
  if (zurueck.zoneX !== comp.zoneX || zurueck.zoneY !== comp.zoneY) compFehler++;
  for (const [, feld] of felder) {
    const a = comp[feld] as Float32Array | Uint8Array | null;
    const b = zurueck[feld] as Float32Array | Uint8Array | null;
    if (a === null && b === null) continue;
    if (a === null || b === null || !gleich(a, b)) compFehler++;
  }
}
check('alle Comps überstehen den Round-Trip', compFehler === 0, `${compFehler} Abweichung(en)`);
console.log(`  ${compsOriginal.length} Comp(s), ${(bytesGesamt / 1024).toFixed(1)} KB kodiert`);

// ── [3] Verdichtet == unverdichtet ─────────────────────────────────
console.log('\n[3] Verdichtet gegen unverdichtet:');
const ausComps = neuerProvider();
for (const comp of compsOriginal) {
  ausComps.restoreTerrainComp(dekodiereTerrainComp(kodiereTerrainComp(comp)));
}
check(
  'Höhen bitgenau gleich',
  gleich(abdruckOriginal, hoehenAbdruck(ausComps, zonen)),
  `${zonen.length} Zone(n) × ${E_WIDTH}×${E_WIDTH} Vertices`
);

let maskenFehler = 0;
for (const [zx, zy] of zonen) {
  const a = original.getTerrainComp(zx, zy)?.paintMask ?? null;
  const b = ausComps.getTerrainComp(zx, zy)?.paintMask ?? null;
  if (a === null && b === null) continue;
  if (a === null || b === null || !gleich(a, b)) maskenFehler++;
}
check('Farbmasken bitgenau gleich', maskenFehler === 0, `${maskenFehler} Zone(n) abweichend`);

// Und der Gegentest: ein Provider, der die ROHE Liste abspielt, kommt auf
// dasselbe Ergebnis — sonst wäre der Vergleich oben zirkulär.
const ausOps = neuerProvider();
for (const op of ops) ausOps.applyTerrainOp(op.x, op.y, op.z, op.s);
check(
  'Wiederholtes Abspielen der Liste ergibt denselben Boden',
  gleich(abdruckOriginal, hoehenAbdruck(ausOps, zonen))
);

// ── [4] Größe ──────────────────────────────────────────────────────
console.log('\n[4] Größe:');
const opsBytes = Buffer.byteLength(
  JSON.stringify(ops.map((o) => ({ pos: { x: o.x, y: o.y, z: o.z }, settingsJson: JSON.stringify(o.s) })))
);
const compBase64 = compsOriginal.map((c) => terrainCompNachBase64(c));
const compBytes = Buffer.byteLength(JSON.stringify(compBase64));
console.log(
  `  ${OPS} Operationen: ${(opsBytes / 1024).toFixed(1)} KB — ` +
    `Endzustand: ${(compBytes / 1024).toFixed(1)} KB`
);
console.log(
  `  zstd: ${zstdCompressSync(Buffer.from(JSON.stringify(ops))).length} B gegen ` +
    `${zstdCompressSync(Buffer.from(JSON.stringify(compBase64))).length} B`
);
// Die Aussage ist NICHT "immer kleiner" — bei wenigen Hackenschlägen ist
// die Liste kürzer, und für 600 Operationen komprimiert sie sogar besser.
// Die Aussage ist "GEDECKELT": Der Endzustand kann 65×65 Vertices je Zone
// nicht überschreiten, die Liste wächst weiter, solange gespielt wird.
// Gesättigtes Gebiet als Ausgangspunkt (40 m, 1000 Schläge): Erst wenn
// das Raster voll ist, zeigt sich, ob weiteres Graben noch etwas kostet.
const FAKTOR = 10;
const opsSatt = opFolge(1000, 40);
const pSatt = neuerProvider();
for (const op of opsSatt) pSatt.applyTerrainOp(op.x, op.y, op.z, op.s);
const compsSatt = [...pSatt.listTerrainComps()].filter((c) => !c.isEmpty);
const compSattBytes = Buffer.byteLength(JSON.stringify(compsSatt.map((c) => terrainCompNachBase64(c))));
const opsSattBytes = Buffer.byteLength(
  JSON.stringify(opsSatt.map((o) => ({ pos: { x: o.x, y: o.y, z: o.z }, settingsJson: JSON.stringify(o.s) })))
);
const ops2 = opFolge(1000 * FAKTOR, 40);
const p2 = neuerProvider();
for (const op of ops2) p2.applyTerrainOp(op.x, op.y, op.z, op.s);
const comps2 = [...p2.listTerrainComps()].filter((c) => !c.isEmpty);
const comp2Bytes = Buffer.byteLength(JSON.stringify(comps2.map((c) => terrainCompNachBase64(c))));
const ops2Bytes = Buffer.byteLength(
  JSON.stringify(ops2.map((o) => ({ pos: { x: o.x, y: o.y, z: o.z }, settingsJson: JSON.stringify(o.s) })))
);
// Je ZONE vergleichen: Mehr Operationen streifen auch mehr Randzonen, und
// deren Kosten sind kein Wachstum durch Spielzeit, sondern durch Fläche.
// Die Frage von D9 ist, ob eine EINMAL bearbeitete Zone weiter wächst.
const jeZone1 = compSattBytes / compsSatt.length;
const jeZone2 = comp2Bytes / comps2.length;
console.log(
  `  ${FAKTOR}× so viele Operationen: Liste ${(ops2Bytes / 1024).toFixed(1)} KB ` +
    `(${(ops2Bytes / opsSattBytes).toFixed(1)}×) — Endzustand ${(comp2Bytes / 1024).toFixed(1)} KB ` +
    `auf ${comps2.length} Zonen, ${(jeZone2 / 1024).toFixed(1)} KB/Zone gegen ` +
    `${(jeZone1 / 1024).toFixed(1)} KB/Zone`
);
check(
  'Liste wächst proportional zur Operationszahl',
  ops2Bytes > opsSattBytes * (FAKTOR - 0.5),
  `${(ops2Bytes / opsSattBytes).toFixed(1)}×`
);
check(
  'Endzustand je Zone wächst NICHT proportional',
  jeZone2 < jeZone1 * 1.3,
  `${(jeZone2 / jeZone1).toFixed(2)}× statt ${FAKTOR}×`
);
check(
  'Endzustand je Zone bleibt unter der Rasterobergrenze',
  jeZone2 < 64 * 1024,
  `${(jeZone2 / 1024).toFixed(1)} KB/Zone`
);

// ── [5] Server-Round-Trip: speichern → laden ───────────────────────
console.log('\n[5] Server: speichern → laden → identischer Boden:');
rmSync(WORLDS_DIR, { recursive: true, force: true });

function makeServer() {
  return createWovServer({
    port: 2496,
    worldName: 'world',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    worldsDir: WORLDS_DIR,
  });
}

const serverA = makeServer();
serverA.init();
for (const op of ops) serverA.heightmaps.applyTerrainOp(op.x, op.y, op.z, op.s);
const probeStellen: Array<[number, number]> = [];
{
  const r = wuerfel(4711);
  for (let i = 0; i < 4000; i++) probeStellen.push([(r() - 0.5) * 170, (r() - 0.5) * 170]);
}
const bodenA = probeStellen.map(([x, z]) => serverA.heightmaps.getGroundHeight(x, z));
serverA.saveWorld();

const umschlag = JSON.parse(
  zstdDecompressSync(readFileSync(SAVE_FILE)).toString('utf-8')
) as WorldSaveData;
check('Save schreibt terrainComps', (umschlag.terrainComps?.length ?? 0) > 0, `${umschlag.terrainComps?.length} Zone(n)`);
check('Save schreibt KEINE Op-Liste mehr', umschlag.terrainOps === undefined);
check('Save-Version v3', umschlag.version === 3, String(umschlag.version));

const serverB = makeServer();
serverB.init();
const bodenB = probeStellen.map(([x, z]) => serverB.heightmaps.getGroundHeight(x, z));
check(
  'Boden nach dem Laden bitgenau gleich',
  bodenA.every((h, i) => Object.is(h, bodenB[i])),
  `${probeStellen.length} Messpunkte`
);
check(
  'Wege/Beete überstehen den Neustart',
  probeStellen.every(
    ([x, z]) => serverA.heightmaps.isCleared(x, z) === serverB.heightmaps.isCleared(x, z)
  )
);

// ── [6] Altstand v2 (Operationsliste) wird übernommen ──────────────
console.log('\n[6] Migration eines v2-Saves:');
rmSync(WORLDS_DIR, { recursive: true, force: true });
mkdirSync(WORLDS_DIR, { recursive: true });
const altUmschlag = {
  version: 2,
  meta: {
    worldName: 'world',
    worldSeed: SEED,
    worldGenVersion: 2,
    savedAt: new Date().toISOString(),
  },
  worldTime: 270,
  zones: [],
  players: [],
  zdos: [],
  terrainOps: ops.map((o) => ({ pos: { x: o.x, y: o.y, z: o.z }, settingsJson: JSON.stringify(o.s) })),
};
writeFileSync(SAVE_FILE, zstdCompressSync(Buffer.from(JSON.stringify(altUmschlag), 'utf-8')));

const serverC = makeServer();
serverC.init();
const bodenC = probeStellen.map(([x, z]) => serverC.heightmaps.getGroundHeight(x, z));
check(
  'v2-Boden bitgenau wie v3',
  bodenA.every((h, i) => Object.is(h, bodenC[i])),
  `${probeStellen.length} Messpunkte`
);
serverC.saveWorld();
const neuUmschlag = JSON.parse(
  zstdDecompressSync(readFileSync(SAVE_FILE)).toString('utf-8')
) as WorldSaveData;
check('v2 wird als v3 weggeschrieben', neuUmschlag.version === 3);
check('verdichtet', (neuUmschlag.terrainComps?.length ?? 0) > 0 && neuUmschlag.terrainOps === undefined);

rmSync(WORLDS_DIR, { recursive: true, force: true });
console.log(failures === 0 ? '\nAlle D9-Prüfungen grün' : `\n${failures} D9-Prüfung(en) fehlgeschlagen`);
process.exit(failures > 0 ? 1 : 0);
