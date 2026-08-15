/**
 * Gleichwertigkeit des Umkreis-Index (D3) gegen die frühere lineare Suche.
 *
 * `EntityManager.nearbyInstances()` lief bis Punkt D3 linear über jeden
 * Bucket und jede Instanz darin. Ersetzt ist das durch ein 32-m-Zellengitter
 * — und ein räumlicher Index, der Instanzen übersieht, ist kein Fix, sondern
 * ein Bug, der sich im Spiel nur als „das Fadenkreuz erkennt den Baum nicht
 * mehr" bemerkbar macht und dort kaum reproduzierbar ist.
 *
 * Deshalb wird hier die REFERENZ mitgeführt: dieselbe lineare Schleife über
 * `bucket.matrices`, die vorher im EntityManager stand, ausgeführt auf
 * demselben Objekt und gegen dasselbe Ergebnis verglichen. Verglichen wird
 * als MENGE — der Index liefert zellweise, die lineare Suche bucketweise,
 * die Reihenfolge darf also abweichen; kein Aufrufer verlässt sich darauf
 * (ObjectLabels sortiert selbst, Anvisiert nimmt das Minimum, Minimap und
 * die Gras-Aussparungen sind reihenfolgeunabhängig).
 *
 * Geprüft wird über einen Ablauf, der die drei Wege durch den Index nimmt:
 * Anlegen, Verschieben (auch über Zellgrenzen) und Entfernen.
 *
 * Lauf:  npx tsx client/test/entity-index.ts
 */

import { EntityManager } from '../src/entities/EntityManager';
import type { ZDOEntityUpdate } from '../src/net/ZDOSync';

// ── Referenz: die lineare Suche, wie sie vor D3 im EntityManager stand ──

interface Bucket {
  prefabName: string;
  matrices: number[];
}

function linear(
  mgr: EntityManager,
  x: number,
  z: number,
  radius: number
): Array<{ prefab: string; x: number; y: number; z: number }> {
  const out: Array<{ prefab: string; x: number; y: number; z: number }> = [];
  const r2 = radius * radius;
  const buckets = (mgr as unknown as { buckets: Map<number, Bucket> }).buckets;
  for (const bucket of buckets.values()) {
    const n = bucket.matrices.length / 16;
    for (let i = 0; i < n; i++) {
      // Translation der row-major-Matrix: Elemente 12/13/14.
      const px = bucket.matrices[i * 16 + 12]!;
      const py = bucket.matrices[i * 16 + 13]!;
      const pz = bucket.matrices[i * 16 + 14]!;
      const dx = px - x;
      const dz = pz - z;
      if (dx * dx + dz * dz > r2) continue;
      out.push({ prefab: bucket.prefabName, x: px, y: py, z: pz });
    }
  }
  return out;
}

// ── Deterministischer Zufall (mulberry32) ────────────────────────────
// Ein fester Startwert, damit ein Fehlschlag reproduzierbar ist statt
// „lief gestern noch".
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zufall = rng(20260815);

/** EntityManager ohne Szene: Der statische Pfad fasst nichts davon an. */
function neuerManager(): EntityManager {
  return new EntityManager(
    null as never,
    null as never,
    null as never,
    null as never
  );
}

/** Eine statische Instanz setzen (applyStatic ist privat — bewusst). */
function setze(
  mgr: EntityManager,
  key: string,
  prefab: string,
  hash: number,
  x: number,
  y: number,
  z: number
): void {
  const u: ZDOEntityUpdate = {
    key,
    prefabHash: hash,
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    // Statische Instanzen sind nie die eigene Spielfigur — die sortiert
    // applyStatic() ohnehin vorher aus (EntityManager.ts:536).
    isOwnPlayer: false,
  };
  (
    mgr as unknown as {
      applyStatic: (u: ZDOEntityUpdate, p: string, m: string | null) => void;
    }
  ).applyStatic(u, prefab, null);
}

function schluessel(i: { prefab: string; x: number; y: number; z: number }): string {
  return `${i.prefab}@${i.x},${i.y},${i.z}`;
}

let fehler = 0;

function vergleiche(mgr: EntityManager, x: number, z: number, r: number, wo: string): void {
  const a = linear(mgr, x, z, r).map(schluessel).sort();
  const b = mgr.nearbyInstances(x, z, r).map(schluessel).sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    fehler++;
    console.log(
      `  ABWEICHUNG ${wo}  bei (${x.toFixed(1)}, ${z.toFixed(1)}) r=${r}: ` +
        `linear ${a.length}, index ${b.length}`
    );
    const nurLinear = a.filter((v) => !b.includes(v)).slice(0, 5);
    const nurIndex = b.filter((v) => !a.includes(v)).slice(0, 5);
    if (nurLinear.length) console.log(`    nur linear: ${nurLinear.join('  ')}`);
    if (nurIndex.length) console.log(`    nur index:  ${nurIndex.join('  ')}`);
  }
}

// ── Aufbau: eine Welt in der Grössenordnung der DEV-Welt ─────────────

const PREFABS = ['Beech1', 'FirTree', 'Rock_4', 'Birch2', 'Pickable_Flint', 'wood_wall'];
const ANZAHL = 9900;
const WELT = 600; // ±600 m — dicht genug, dass jede Zelle mehrfach belegt ist

const mgr = neuerManager();
const gesetzt: Array<{ key: string; prefab: string; hash: number }> = [];

for (let i = 0; i < ANZAHL; i++) {
  const p = PREFABS[i % PREFABS.length]!;
  const hash = 1000 + (i % PREFABS.length);
  const key = `w:${i}`;
  setze(
    mgr,
    key,
    p,
    hash,
    (zufall() * 2 - 1) * WELT,
    zufall() * 30,
    (zufall() * 2 - 1) * WELT
  );
  gesetzt.push({ key, prefab: p, hash });
}
console.log(`aufgebaut: ${ANZAHL} Instanzen, Index ${JSON.stringify(mgr.indexStats)}`);

// ── 1) Abfragen quer über alle vorkommenden Radien ───────────────────
// 5 = Fadenkreuz, 40 = Namensschilder, 70 = Minimap/Gras, 3 = E-Taste.
const RADIEN = [0, 1, 3, 5, 12, 40, 70, 200];
let abfragen = 0;
for (const r of RADIEN) {
  for (let k = 0; k < 300; k++) {
    const x = (zufall() * 2 - 1) * (WELT + 40);
    const z = (zufall() * 2 - 1) * (WELT + 40);
    vergleiche(mgr, x, z, r, 'nach Aufbau');
    abfragen++;
  }
}
// Genau auf einer Zellgrenze und im Ursprung — die klassischen Off-by-one.
for (const c of [-64, -32, 0, 32, 64]) {
  for (const r of [5, 32, 40]) {
    vergleiche(mgr, c, c, r, 'Zellgrenze');
    vergleiche(mgr, c + 0.0001, c - 0.0001, r, 'Zellgrenze');
    abfragen += 2;
  }
}
console.log(`Abfragen nach Aufbau: ${abfragen}`);

// ── 2) Verschieben, auch über Zellgrenzen hinweg ─────────────────────
for (let i = 0; i < 2000; i++) {
  const e = gesetzt[Math.floor(zufall() * gesetzt.length)]!;
  setze(
    mgr,
    e.key,
    e.prefab,
    e.hash,
    (zufall() * 2 - 1) * WELT,
    zufall() * 30,
    (zufall() * 2 - 1) * WELT
  );
}
// Und einmal auf der Stelle bleiben (Server schickt dasselbe ZDO erneut) —
// der Zweig, der die Zellenliste NICHT anfasst.
for (let i = 0; i < 200; i++) {
  const e = gesetzt[i]!;
  setze(mgr, e.key, e.prefab, e.hash, 10 + i * 0.01, 5, -10 - i * 0.01);
  setze(mgr, e.key, e.prefab, e.hash, 10 + i * 0.01, 5, -10 - i * 0.01);
}
for (const r of RADIEN) {
  for (let k = 0; k < 200; k++) {
    vergleiche(
      mgr,
      (zufall() * 2 - 1) * (WELT + 40),
      (zufall() * 2 - 1) * (WELT + 40),
      r,
      'nach Verschieben'
    );
  }
}
console.log(`nach Verschieben: Index ${JSON.stringify(mgr.indexStats)}`);

// ── 3) Entfernen (auch doppelt und unbekannt) ────────────────────────
const entfernt = new Set<string>();
for (let i = 0; i < 3000; i++) {
  const e = gesetzt[Math.floor(zufall() * gesetzt.length)]!;
  mgr.removeZDO(e.key);
  entfernt.add(e.key);
}
mgr.removeZDO('gibt-es-nicht');
for (const k of [...entfernt].slice(0, 50)) mgr.removeZDO(k);

const erwartet = ANZAHL - entfernt.size;
if (mgr.indexStats.instanzen !== erwartet) {
  fehler++;
  console.log(
    `  ABWEICHUNG Zählstand: Index hält ${mgr.indexStats.instanzen}, erwartet ${erwartet}`
  );
}
if (mgr.staticCount !== erwartet) {
  fehler++;
  console.log(`  ABWEICHUNG staticCount: ${mgr.staticCount}, erwartet ${erwartet}`);
}
for (const r of RADIEN) {
  for (let k = 0; k < 300; k++) {
    vergleiche(
      mgr,
      (zufall() * 2 - 1) * (WELT + 40),
      (zufall() * 2 - 1) * (WELT + 40),
      r,
      'nach Entfernen'
    );
  }
}

// ── 4) Alles entfernen — der Index muss restlos leer sein ────────────
for (const e of gesetzt) mgr.removeZDO(e.key);
const leer = mgr.indexStats;
if (leer.instanzen !== 0 || leer.zellen !== 0) {
  fehler++;
  console.log(`  ABWEICHUNG Leerlauf: ${JSON.stringify(leer)} statt {0, 0}`);
}
vergleiche(mgr, 0, 0, 70, 'leer');

// ── 5) Dungeon-Koordinaten (x ≈ 100000) ──────────────────────────────
// Dungeon-Instanzen liegen weit ausserhalb der Welt; der Zellenschlüssel
// muss auch dort noch eindeutig sein.
const dmgr = neuerManager();
for (let i = 0; i < 500; i++) {
  setze(dmgr, `d:${i}`, 'stone_floor', 2000, 100000 + zufall() * 60, zufall() * 5, zufall() * 60);
}
for (let k = 0; k < 200; k++) {
  vergleiche(dmgr, 100000 + zufall() * 60, zufall() * 60, 5, 'Dungeon');
  vergleiche(dmgr, 100000 + zufall() * 60, zufall() * 60, 40, 'Dungeon');
}
// Negative Koordinaten mit derselben Zellendifferenz dürfen nicht kollidieren.
const nmgr = neuerManager();
setze(nmgr, 'a', 'A', 1, -100, 0, -100);
setze(nmgr, 'b', 'B', 2, 100, 0, 100);
vergleiche(nmgr, -100, -100, 1, 'Vorzeichen');
vergleiche(nmgr, 100, 100, 1, 'Vorzeichen');

// ── 6) Grössenordnung: Index gegen lineare Suche ─────────────────────
// Kein Grenzwert, nur eine Zahl fürs Protokoll — die echte Messung läuft
// im Browser. Node und Browser sind unterschiedliche Maschinen, ein
// bestandener Schwellwert hier sagte nichts über den Client aus.
const bmgr = neuerManager();
for (let i = 0; i < ANZAHL; i++) {
  setze(
    bmgr,
    `b:${i}`,
    PREFABS[i % PREFABS.length]!,
    1000 + (i % PREFABS.length),
    (zufall() * 2 - 1) * WELT,
    zufall() * 30,
    (zufall() * 2 - 1) * WELT
  );
}
for (const r of [5, 40, 70]) {
  const RUNDEN = 2000;
  const t0 = performance.now();
  for (let k = 0; k < RUNDEN; k++) linear(bmgr, (k % 200) - 100, (k % 173) - 86, r);
  const t1 = performance.now();
  for (let k = 0; k < RUNDEN; k++) bmgr.nearbyInstances((k % 200) - 100, (k % 173) - 86, r);
  const t2 = performance.now();
  console.log(
    `r=${r}: linear ${((t1 - t0) / RUNDEN).toFixed(4)} ms/Abfrage, ` +
      `Index ${((t2 - t1) / RUNDEN).toFixed(4)} ms/Abfrage ` +
      `(Faktor ${((t1 - t0) / Math.max(t2 - t1, 1e-9)).toFixed(1)})`
  );
}

console.log(fehler === 0 ? '\nOK — Index und lineare Suche stimmen überein' : `\n${fehler} ABWEICHUNGEN`);
process.exit(fehler > 0 ? 1 : 0);
