/**
 * Angriffs-Messzelle (read-only, keine Quelländerung) — misst die
 * Fehlerklasse, die `tools/messe-stonevault-logik.ts` per Konstruktion
 * NICHT sehen kann: Wandplatten (`StoneVaultWall`), die in einer BELEGTEN
 * Nachbarzelle stehen.
 *
 * Warum die andere Messzelle blind dafür ist: Sie sondiert nur Connectors
 * OHNE Partner. Eine offene Zellkante, die vor der eingebauten Seitenwand
 * eines Korridors steht, bekommt aber von `placeEndCaps` eine Platte —
 * damit hat sie einen Partner und fällt aus der Stichprobe. Der Fehler
 * bleibt: die Platte liegt im Streifen 0,7 … 1,0 der Nachbarzelle, also
 * exakt in deren eingebauter Wand (make-stonevault.py, `innenwand`).
 *
 * STAND 04.09.2026 (Meilenstein G1): Diese Messgrössen sind nach
 * `tools/messe-stonevault-logik.ts` (Teil 2) übernommen und dort um die
 * Kantentafel erweitert. Diese Datei bleibt als UNABHÄNGIGER Zeuge
 * stehen — sie rechnet dieselben Zahlen auf einem anderen Weg (Modultyp
 * statt Kantenzustand) und deckt damit auf, wenn sich die Erklärung im
 * grossen Skript von der Geometrie wegbewegt. Weichen beide Läufe
 * voneinander ab, ist eine der beiden falsch; wer sie ändert, prüft die
 * andere mit.
 *
 * Aufruf: npx tsx tools/angriff-stonevault.ts
 */
import { generateDungeonLayout } from '../shared/src/dungeonGenerator.js';
import { DUNGEONS_BY_NAME } from '../shared/src/dungeons.js';
import { quatMulVec3 } from '../shared/src/worldgen/Math3d.js';
import type { RoomDef } from '../shared/src/dungeons.js';
import type { Quaternion, Vector3 } from '../shared/src/types.js';

const def = DUNGEONS_BY_NAME.get('DG_StoneVault')!;
const byName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));
const ZELL = new Set([
  'StoneVaultEntry', 'StoneVaultCell', 'StoneVaultCorridor', 'StoneVaultCorner',
  'StoneVaultJunction', 'StoneVaultHall', 'StoneVaultHallLarge',
  'StoneVaultHallLong', 'StoneVaultHallGrand', 'StoneVaultHallVast',
  'StoneVaultStairs',
]);

/** Rasterschlüssel: Zellmitten liegen auf (2i, 3,5e, 2j−1) — Entry bei (0,0,−1). */
function schluessel(x: number, y: number, z: number): string {
  return `${Math.round(x / 2)}|${Math.round((z + 1) / 2)}|${Math.round(y / 3.5)}`;
}

function subCells(p: { room: string; pos: Vector3; rot: Quaternion }): Array<{ k: string; drift: number }> {
  const r = byName.get(p.room)!;
  const cx = Math.round(Math.max(r.size.x, 2) / 2);
  const cz = Math.round(Math.max(r.size.z, 2) / 2);
  const ebenen = Math.max(1, Math.round(r.size.y / 3.5)); // Treppe: 7 m = zwei Ebenen
  const out: Array<{ k: string; drift: number }> = [];
  for (let a = 0; a < cx; a++) for (let b = 0; b < cz; b++) {
    const lx = (a - (cx - 1) / 2) * 2, lz = (b - (cz - 1) / 2) * 2;
    const w = quatMulVec3(p.rot, { x: lx, y: 0, z: lz });
    const wx = p.pos.x + w.x, wz = p.pos.z + w.z;
    const i = Math.round(wx / 2), j = Math.round((wz + 1) / 2), e0 = Math.round(p.pos.y / 3.5);
    const drift = Math.max(Math.abs(wx - i * 2), Math.abs(wz - (j * 2 - 1)), Math.abs(p.pos.y - e0 * 3.5));
    for (let e = 0; e < ebenen; e++) out.push({ k: `${i}|${j}|${e0 + e}`, drift });
  }
  return out;
}

const nachbarTally = new Map<string, number>();
let waendeGesamt = 0, waendeInBelegt = 0, doppelbelegung = 0, gestapelt = 0, maxDrift = 0;
const jeSeed: Array<{ seed: number; raeume: number; waende: number; inBelegt: number; gestapelt: number }> = [];

for (let seed = 1; seed <= 40; seed++) {
  const l = generateDungeonLayout(def, seed);
  const belegt = new Map<string, string[]>();
  l.rooms.forEach((p) => {
    if (!ZELL.has(p.room)) return;
    for (const c of subCells(p)) {
      (belegt.get(c.k) ?? belegt.set(c.k, []).get(c.k)!).push(p.room);
      if (c.drift > maxDrift) maxDrift = c.drift;
    }
  });
  doppelbelegung += [...belegt.values()].filter((v) => v.length > 1).length;
  gestapelt += [...belegt.keys()].filter((k) => {
    const [i, j, e] = k.split('|').map(Number);
    return belegt.has(`${i}|${j}|${e! + 1}`);
  }).length;
  let w = 0, wb = 0;
  l.rooms.forEach((p) => {
    if (p.room !== 'StoneVaultWall') return;
    w++;
    const n = belegt.get(schluessel(p.pos.x, p.pos.y, p.pos.z));
    if (n) { wb++; nachbarTally.set(n[0]!, (nachbarTally.get(n[0]!) ?? 0) + 1); }
  });
  waendeGesamt += w; waendeInBelegt += wb;
  jeSeed.push({ seed, raeume: l.rooms.length, waende: w, inBelegt: wb, gestapelt: 0 });
}

console.log('=== DG_StoneVault, 40 Seeds (Kit-Vorgaben maxRooms 60, zoneSize 48) ===');
console.log(`Wandplatten gesamt: ${waendeGesamt} — davon in einer BELEGTEN Nachbarzelle: ${waendeInBelegt} (${(100 * waendeInBelegt / waendeGesamt).toFixed(1)} %)`);
console.log('Nachbarmodul der Platte:');
for (const [k, v] of [...nachbarTally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`Zellen mit zwei Räumen (echte Doppelbelegung): ${doppelbelegung}`);
console.log(`Senkrecht gestapelte Zellen (Ebene n / n+1): ${gestapelt}`);
console.log(`Grösste Abweichung einer Zellmitte vom Sollraster: ${maxDrift.toExponential(2)} m`);

const probe = generateDungeonLayout({ ...def, maxRooms: 12 }, 2123721695, { zoneSize: 32 });
const belegtP = new Map<string, string>();
probe.rooms.forEach((p) => { if (ZELL.has(p.room)) for (const c of subCells(p)) belegtP.set(c.k, p.room); });
const trefferP = probe.rooms.filter((p) => p.room === 'StoneVaultWall' && belegtP.has(schluessel(p.pos.x, p.pos.y, p.pos.z)));
console.log(`\n=== Mikes gen-probe (Seed 2123721695, maxRooms 12, zoneSize 32) ===`);
console.log(`${probe.rooms.length} Räume, ${trefferP.length} Wandplatten in belegten Nachbarzellen:`);
for (const p of trefferP) console.log(`  Wand @(${p.pos.x.toFixed(2)},${p.pos.y},${p.pos.z.toFixed(2)}) in Zelle ${schluessel(p.pos.x, p.pos.y, p.pos.z)} von ${belegtP.get(schluessel(p.pos.x, p.pos.y, p.pos.z))}`);

console.log('\n--- roh ---');
for (const s of jeSeed) console.log(`seed=${s.seed} raeume=${s.raeume} waende=${s.waende} inBelegterZelle=${s.inBelegt}`);
