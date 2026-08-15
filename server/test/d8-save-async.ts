/**
 * D8 — asynchroner Weltsave: Round-Trip und Event-Loop.
 *
 * `JSON.stringify` über alle persistenten ZDOs plus `zstdCompressSync`
 * standen alle 30 Minuten am Stück im Weg. Der neue Weg schreibt schubweise
 * in einen zstd-Strom. Weil an dieser Datei die ganze Welt hängt und es
 * KEINE Sicherungskopien gibt, wird hier nicht „ungefähr gleich" geprüft,
 * sondern jedes ZDO Feld für Feld:
 *
 *  1. Speichern → Laden → identischer Zustand (ZDO-Schnappschüsse
 *     zeichengenau gleich, worldTime, Zonen, Spieler).
 *  2. Der asynchrone Save erzeugt denselben Inhalt wie der synchrone
 *     (Umschlag ohne den Zeitstempel verglichen).
 *  3. Atomizität: `.prev` wird rotiert, `.tmp` bleibt nicht liegen.
 *  4. Während des Saves eintreffende Änderungen korrumpieren ihn nicht —
 *     ein mittendrin zerstörtes ZDO wird NICHT geschrieben (es später doch
 *     zu schreiben hiesse, es beim Neustart wiederzubeleben).
 *  5. Der Event-Loop bleibt ansprechbar (die längste Pause eines 5-ms-
 *     Taktgebers, synchron gegen asynchron).
 *
 * Lauf: npx tsx test/d8-save-async.ts   (aus server/)
 */

import { existsSync, rmSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zstdDecompressSync } from 'node:zlib';
import { getStableHash } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import type { WorldSaveData } from '../src/world/WorldManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = resolve(__dirname, 'tmp-d8-worlds');
const SAVE_FILE = resolve(WORLDS_DIR, 'world.db.zst');
const SEED = 'KxSYuZquuw';
/** Genug, damit der Unterschied im Event-Loop überhaupt messbar wird. */
const ZDO_ANZAHL = 20_000;

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

function makeServer() {
  return createWovServer({
    port: 2497, // nie gebunden (nur init(), kein start())
    worldName: 'world',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldCreatures: false,
    dungeonsEnabled: false,
    worldsDir: WORLDS_DIR,
  });
}

/**
 * Längste Pause eines 5-ms-Taktgebers während `arbeit`. Das ist genau die
 * Größe, um die es bei D8 geht: Wie lange kommt kein ZDO-Sync und kein
 * Paket durch.
 */
async function laengstePause(arbeit: () => void | Promise<void>): Promise<number> {
  let letzter = Date.now();
  let max = 0;
  const takt = setInterval(() => {
    const jetzt = Date.now();
    max = Math.max(max, jetzt - letzter);
    letzter = jetzt;
  }, 5);
  try {
    await arbeit();
    // Dem Taktgeber Luft geben: Ein synchroner Block lässt ihn erst
    // danach feuern — ohne dieses Warten misst der synchrone Fall 0 ms,
    // weil `await` allein nur Microtasks abarbeitet und keine Timer.
    await new Promise<void>((r) => setTimeout(r, 30));
  } finally {
    clearInterval(takt);
  }
  return max;
}

function umschlag(): WorldSaveData {
  return JSON.parse(zstdDecompressSync(readFileSync(SAVE_FILE)).toString('utf-8')) as WorldSaveData;
}

console.log('=== D8 asynchroner Weltsave ===');
rmSync(WORLDS_DIR, { recursive: true, force: true });

// ── Server A aufbauen ──────────────────────────────────────────────
console.log(`\n[0] Server A mit ${ZDO_ANZAHL} persistenten ZDOs:`);
const serverA = makeServer();
serverA.init();
(serverA as unknown as { worldTime: number }).worldTime = 1234.5;

// piece_chest_wood: persistent, aber KEIN Vegetations-Prefab — sonst setzt
// loadWorld die y-Koordinate auf den aktuellen Boden nach, und der
// Vergleich würde eine Anpassung als Fehler melden.
const KISTE = getStableHash('piece_chest_wood');
for (let i = 0; i < ZDO_ANZAHL; i++) {
  const zdo = serverA.zdos.createZDO(
    KISTE,
    { x: (i % 300) * 3.5 - 500, y: 30 + (i % 17) * 0.25, z: Math.floor(i / 300) * 3.5 - 500 },
    { x: 0, y: 0, z: 0, w: 1 }
  );
  zdo.setInt('health', 100 - (i % 100));
  zdo.setString('besitzer', `spieler-${i % 7}`);
  zdo.setFloat('scaleScalar', 1 + (i % 5) * 0.1);
  if (i % 13 === 0) zdo.setLong('stand', BigInt(i) * 1_000_000_007n);
}
console.log(`  ${serverA.zdos.totalZDOCount} ZDOs angelegt`);

// ── [1] Synchron vs. asynchron: gleicher Inhalt ────────────────────
console.log('\n[1] Gleicher Inhalt wie der synchrone Weg:');
const pauseSync = await laengstePause(() => serverA.saveWorld());
const synchron = umschlag();
rmSync(`${SAVE_FILE}.prev`, { force: true });
rmSync(SAVE_FILE, { force: true });

const pauseAsync = await laengstePause(() => serverA.saveWorldAsync());
const asynchron = umschlag();

check('Version gleich', synchron.version === asynchron.version);
check('worldTime gleich', synchron.worldTime === asynchron.worldTime, String(asynchron.worldTime));
check('Zonen gleich', JSON.stringify(synchron.zones) === JSON.stringify(asynchron.zones));
check('Spieler gleich', JSON.stringify(synchron.players) === JSON.stringify(asynchron.players));
check(
  'ZDO-Block zeichengenau gleich',
  JSON.stringify(synchron.zdos) === JSON.stringify(asynchron.zdos),
  `${asynchron.zdos.length} ZDOs`
);

// ── [2] Event-Loop ─────────────────────────────────────────────────
console.log('\n[2] Event-Loop während des Saves:');
console.log(`  längste Pause synchron: ${pauseSync} ms, asynchron: ${pauseAsync} ms`);
check(
  'asynchron blockiert kürzer als synchron',
  pauseAsync < pauseSync,
  `${pauseAsync} ms statt ${pauseSync} ms`
);
check('asynchron bleibt unter einem halben Server-Tick', pauseAsync < 34, `${pauseAsync} ms`);

// ── [3] Atomizität ─────────────────────────────────────────────────
console.log('\n[3] Atomizität:');
check('Save-Datei da', existsSync(SAVE_FILE));
check('keine .tmp übrig', !existsSync(`${SAVE_FILE}.tmp`));
await serverA.saveWorldAsync(); // zweiter Lauf → .prev muss rotieren
check('.prev nach dem zweiten Save da', existsSync(`${SAVE_FILE}.prev`));
check('.prev ist lesbar', (() => {
  try {
    JSON.parse(zstdDecompressSync(readFileSync(`${SAVE_FILE}.prev`)).toString('utf-8'));
    return true;
  } catch {
    return false;
  }
})());

// ── [4] Änderung während des Saves ─────────────────────────────────
console.log('\n[4] Zerstörung während des laufenden Saves:');
const opfer = serverA.zdos.getZDOByPrefab(KISTE)[0]!;
const opferKey = opfer.zdoid.toString();
const lauf = serverA.saveWorldAsync();
// Der Save gibt zwischen den Schüben den Loop frei — hier trifft die
// Änderung also mitten hinein, genau wie im Betrieb.
await new Promise<void>((r) => setImmediate(r));
serverA.zdos.destroyZDO(opfer.zdoid);
await lauf;
const nachher = umschlag();
check(
  'zerstörtes ZDO ist nicht im Save',
  !nachher.zdos.some(
    (z) => `${(z.id as { userId: string }).userId}:${(z.id as { id: number }).id}` === opferKey
  ),
  opferKey
);
check(
  'alle anderen sind noch da',
  nachher.zdos.length >= ZDO_ANZAHL - 1,
  `${nachher.zdos.length} von ${ZDO_ANZAHL}`
);

// ── [5] Speichern → Laden → identischer Zustand ────────────────────
console.log('\n[5] Round-Trip über einen frischen Server:');
const vorher = new Map<string, string>();
for (const z of serverA.zdos.getAllZDOs()) {
  if (z.prefabHash !== KISTE) continue;
  vorher.set(z.zdoid.toString(), JSON.stringify(z.toSnapshot()));
}

const serverB = makeServer();
serverB.init();

const nachB = new Map<string, string>();
for (const z of serverB.zdos.getAllZDOs()) {
  if (z.prefabHash !== KISTE) continue;
  nachB.set(z.zdoid.toString(), JSON.stringify(z.toSnapshot()));
}

let fehlend = 0;
let abweichend = 0;
for (const [key, snapshot] of vorher) {
  const b = nachB.get(key);
  if (b === undefined) {
    fehlend++;
    continue;
  }
  if (b !== snapshot) abweichend++;
}
check('kein ZDO verloren', fehlend === 0, `${fehlend} fehlend`);
check('kein ZDO verändert', abweichend === 0, `${abweichend} abweichend`);
check(
  'worldTime übernommen',
  Math.abs(serverB.getWorldTime() - serverA.getWorldTime()) < 1e-9,
  `${serverB.getWorldTime()}`
);

rmSync(WORLDS_DIR, { recursive: true, force: true });
console.log(failures === 0 ? '\nAlle D8-Prüfungen grün' : `\n${failures} D8-Prüfung(en) fehlgeschlagen`);
process.exit(failures > 0 ? 1 : 0);
