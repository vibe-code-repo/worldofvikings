/**
 * Messender Nachweis fuer die ganzzahligen Hashes des Dungeon-Generators 2.0
 * (AP2, `hashing.ts`).
 * Measuring proof for dungeon generator 2.0's integer hashes (AP2,
 * `hashing.ts`).
 *
 *   npx tsx test/dungeon2-hashing.ts
 *
 * Geprueft wird, was ohne Browser-Gegenprobe schon feststeht: `mische` und
 * `hashPos` sind rein ganzzahlig, deterministisch, und trennen Straeme
 * sauber (kein Aspekt verschiebt einen anderen, ARCHITECTURE W7). Der volle
 * Node<->Browser-Abgleich mit 1000 eingefrorenen Werten ist AP5
 * (`dungeon2-determinismus.ts`) — hier wird bereits eine kleine, eingefrorene
 * Wertetabelle mitgefuehrt, damit AP5 eine Baseline hat, die nicht aus dem
 * Nichts kommt.
 * Checked here is what stands without a browser cross-check already:
 * `mische` and `hashPos` are purely integer, deterministic, and cleanly
 * separate streams (no aspect shifts another, ARCHITECTURE W7). The full
 * Node<->browser comparison with 1000 frozen values is AP5
 * (`dungeon2-determinismus.ts`) — a small frozen value table is carried along
 * here already, so AP5 has a baseline that does not come from nowhere.
 */

import { hashPos, mische } from '../src/dungeon2/hashing.js';

let gutZahl = 0;
const fehlerListe: string[] = [];

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) {
    gutZahl++;
    return;
  }
  fehlerListe.push(`${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

function pruefeGleich(name: string, ist: unknown, soll: unknown): void {
  pruefe(name, Object.is(ist, soll), `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

// ── Ganzzahligkeit und Wertebereich / integer-ness and range ────────────────
for (const [seed, salt] of [
  [0, 0],
  [1, 2],
  [-1, -1],
  [2 ** 31 - 1, 2 ** 31 - 1],
  [-(2 ** 31), 12345],
]) {
  const m = mische(seed, salt);
  pruefe(`mische(${seed},${salt}) ist eine uint32-Ganzzahl`, Number.isInteger(m) && m >= 0 && m < 2 ** 32);
}
for (const [x, z, ebene, seed] of [
  [0, 0, 0, 0],
  [-5, 5, -1, 42],
  [1000, -1000, 3, 7],
]) {
  const h = hashPos(x, z, ebene, seed);
  pruefe(`hashPos(${x},${z},${ebene},${seed}) ist eine uint32-Ganzzahl`, Number.isInteger(h) && h >= 0 && h < 2 ** 32);
}

// ── Determinismus: derselbe Aufruf, dasselbe Ergebnis ───────────────────────
pruefeGleich('mische ist deterministisch', mische(99, 7), mische(99, 7));
pruefeGleich('hashPos ist deterministisch', hashPos(3, -4, 1, 9), hashPos(3, -4, 1, 9));

// ── Eingefrorene Wertetabelle (Baseline fuer AP5) ───────────────────────────
// Frozen value table (baseline for AP5).
const MISCHE_TABELLE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0x00000000],
  [1, 1, 0x3d8ed02f],
  [1, 2, 0x2e7dcc10],
  [123456789, 987654321, 0x3d7f14af],
  [-1, -1, 0xce2d4699],
];
for (const [seed, salt, erwartet] of MISCHE_TABELLE) {
  pruefeGleich(`mische(${seed},${salt}) eingefroren`, mische(seed, salt), erwartet);
}

const HASHPOS_TABELLE: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 0, 0, 0, 0x00000000],
  [1, 0, 0, 0, 0x5716f995],
  [0, 1, 0, 0, 0x2fef5c8f],
  [0, 0, 1, 0, 0x514e28b7],
  [12, -7, 3, 424242, 0x1fdc35d2],
];
for (const [x, z, ebene, seed, erwartet] of HASHPOS_TABELLE) {
  pruefeGleich(`hashPos(${x},${z},${ebene},${seed}) eingefroren`, hashPos(x, z, ebene, seed), erwartet);
}

// ── Strom-Trennung (W7): verschiedene Salze streuen unterschiedlich ────────
// Stream separation (W7): different salts scatter differently.
{
  const basis = mische(555, 0);
  let mindestensEineAbweichung = false;
  for (let salt = 1; salt < 16; salt++) {
    if (mische(555, salt) !== basis) mindestensEineAbweichung = true;
  }
  pruefe('mische reagiert auf das Salz (kein konstanter Ausgang)', mindestensEineAbweichung);
}
{
  // hashPos: Aendern EINER Koordinate darf nicht denselben Hash lassen wie
  // vorher — sonst waeren zwei verschiedene Zellen nicht unterscheidbar.
  // hashPos: changing ONE coordinate must not leave the same hash as before —
  // otherwise two different cells would be indistinguishable.
  const basis = hashPos(10, 10, 0, 1);
  pruefe('hashPos unterscheidet x', hashPos(11, 10, 0, 1) !== basis);
  pruefe('hashPos unterscheidet z', hashPos(10, 11, 0, 1) !== basis);
  pruefe('hashPos unterscheidet ebene', hashPos(10, 10, 1, 1) !== basis);
  pruefe('hashPos unterscheidet seed', hashPos(10, 10, 0, 2) !== basis);
}

console.log(`dungeon2-hashing: ${gutZahl} Pruefungen gruen, ${fehlerListe.length} rot`);
for (const f of fehlerListe) console.log(`  ROT  ${f}`);
process.exit(fehlerListe.length === 0 ? 0 : 1);
