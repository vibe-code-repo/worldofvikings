/**
 * Messskript (read-only) — misst Verbindungslogik-Fehler in generierten
 * DG_StoneVault-Layouts: offene Kanten ins Leere, Blindtüren gegen
 * eingebaute Wände, stumme Zellnachbarschaften, Erreichbarkeit vom
 * Eingang, und Treppen mit unversorgtem Anschluss.
 *
 * Aufruf: npx tsx tools/messe-stonevault-logik.ts
 */
import { generateDungeonLayout, computeOpenConnections } from '../shared/src/dungeonGenerator.js';
import { DUNGEONS_BY_NAME } from '../shared/src/dungeons.js';
import { quatMul, quatMulVec3 } from '../shared/src/worldgen/Math3d.js';
import type { DungeonLayout, RoomDef, PlacedRoom } from '../shared/src/dungeons.js';
import type { Quaternion, Vector3 } from '../shared/src/types.js';

const def = DUNGEONS_BY_NAME.get('DG_StoneVault');
if (!def) throw new Error('DG_StoneVault nicht gefunden');
const roomsByName = new Map<string, RoomDef>(def.rooms.map((r) => [r.name, r]));

function quatInverse(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}
function vAdd(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function localToGlobal(localPos: Vector3, localRot: Quaternion, parentPos: Vector3, parentRot: Quaternion) {
  return { pos: vAdd(parentPos, quatMulVec3(parentRot, localPos)), rot: quatMul(localRot, parentRot) };
}
function sqDist(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

interface ConnInst {
  roomIndex: number;
  connIndex: number;
  pos: Vector3;
  rot: Quaternion;
  outward: Vector3; // Weltrichtung, in die der Connector zeigt (lokal +Z)
  entrance: boolean;
}

function allConnections(layout: DungeonLayout): ConnInst[] {
  const out: ConnInst[] = [];
  layout.rooms.forEach((placed, roomIndex) => {
    const room = roomsByName.get(placed.room);
    if (!room) return;
    room.connections.forEach((c, connIndex) => {
      const g = localToGlobal(c.localPos, c.localRot, placed.pos, placed.rot);
      const outward = quatMulVec3(g.rot, { x: 0, y: 0, z: 1 });
      out.push({ roomIndex, connIndex, pos: g.pos, rot: g.rot, outward, entrance: c.entrance });
    });
  });
  return out;
}

/** Punkt liegt im tatsächlichen (nicht genudgten) Rumpf eines platzierten Raums? */
function pointInRoomHull(p: Vector3, placed: PlacedRoom, room: RoomDef): boolean {
  // lokaler Punkt = invRot * (p - pos); roomBodyFromFloor: Ursprung ist der Boden.
  const inv = quatInverse(placed.rot);
  const rel = { x: p.x - placed.pos.x, y: p.y - placed.pos.y, z: p.z - placed.pos.z };
  const lp = quatMulVec3(inv, rel);
  const halfX = room.size.x / 2;
  const halfZ = room.size.z / 2;
  const eps = 0.02;
  return (
    lp.x >= -halfX - eps && lp.x <= halfX + eps &&
    lp.z >= -halfZ - eps && lp.z <= halfZ + eps &&
    lp.y >= -eps && lp.y <= room.size.y + eps
  );
}

const ZELLARTIG = new Set(['StoneVaultEntry', 'StoneVaultCell', 'StoneVaultCorridor', 'StoneVaultCorner', 'StoneVaultJunction', 'StoneVaultHall', 'StoneVaultStairs']);

interface Befund {
  seed: number;
  offenInsLeere: number;
  blindtueren: number;
  stummeNachbarn: number;
  unerreichbar: number;
  treppenProblem: number;
  raeume: number;
  beispiele: string[];
}

function messeLayout(layout: DungeonLayout, seed: number): Befund {
  const conns = allConnections(layout);
  const open = computeOpenConnections(layout, 'DG_StoneVault');
  // Menge der "offenen" Positionen (roomIndex+connIndex) für schnellen Lookup.
  const openKey = new Set(open.map((o) => `${o.roomIndex}:${o.connIndex}`));

  let offenInsLeere = 0;
  let blindtueren = 0;
  const beispiele: string[] = [];

  for (const c of conns) {
    if (c.entrance) continue; // Eingang des GESAMTEN Dungeons — bleibt absichtlich offen (Anschluss nach draussen)
    if (!openKey.has(`${c.roomIndex}:${c.connIndex}`)) continue; // hat einen Partner (Raum oder Wand) — kein Fehler
    // "Offen": kein Connector-Partner. Prüfen, ob physisch trotzdem ein Raum im Weg steht (Blindtür)
    // oder wirklich Leere dahinter ist.
    const probe = vAdd(c.pos, { x: c.outward.x * 0.4, y: c.outward.y * 0.4, z: c.outward.z * 0.4 });
    let blocked: { idx: number; name: string } | null = null;
    layout.rooms.forEach((placed, idx) => {
      if (idx === c.roomIndex) return;
      const room = roomsByName.get(placed.room);
      if (!room) return;
      if (pointInRoomHull(probe, placed, room)) blocked = { idx, name: placed.room };
    });
    if (blocked) {
      blindtueren++;
      const b = blocked as { idx: number; name: string };
      if (beispiele.length < 6) {
        beispiele.push(
          `Blindtür: Raum #${c.roomIndex} (${layout.rooms[c.roomIndex]!.room}) Connector ${c.connIndex} bei ` +
            `(${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)}) stößt auf eingebaute Wand von ` +
            `Raum #${b.idx} (${b.name})`
        );
      }
    } else {
      offenInsLeere++;
      if (beispiele.length < 6) {
        beispiele.push(
          `Offen ins Leere: Raum #${c.roomIndex} (${layout.rooms[c.roomIndex]!.room}) Connector ${c.connIndex} bei ` +
            `(${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)})`
        );
      }
    }
  }

  // (c) Stumme Nachbarschaft: zellartige Räume, deren nominale (auf 2 m
  // hochgerundete) Grundfläche aneinanderstößt, ohne dass irgendein Connector
  // beider Räume dort zusammentrifft (auch nicht über eine Wand).
  const cellRooms = layout.rooms
    .map((p, i) => ({ p, i, room: roomsByName.get(p.room) }))
    .filter((x) => x.room && ZELLARTIG.has(x.p.room));

  function nominalHalf(room: RoomDef, rot: Quaternion): { hx: number; hy: number; hz: number } {
    const nx = Math.max(room.size.x, 2);
    const nz = Math.max(room.size.z, 2);
    const s = quatMulVec3(rot, { x: nx, y: room.size.y, z: nz });
    return { hx: Math.abs(s.x) / 2, hy: Math.abs(s.y) / 2, hz: Math.abs(s.z) / 2 };
  }

  let stummeNachbarn = 0;
  for (let a = 0; a < cellRooms.length; a++) {
    for (let b = a + 1; b < cellRooms.length; b++) {
      const A = cellRooms[a]!, B = cellRooms[b]!;
      const ha = nominalHalf(A.room!, A.p.rot);
      const hb = nominalHalf(B.room!, B.p.rot);
      const ymidA = A.p.pos.y + A.room!.size.y / 2;
      const ymidB = B.p.pos.y + B.room!.size.y / 2;
      const dx = Math.abs(A.p.pos.x - B.p.pos.x);
      const dz = Math.abs(A.p.pos.z - B.p.pos.z);
      const dy = Math.abs(ymidA - ymidB);
      const touchEps = 0.1;
      const overlapY = dy < ha.hy + hb.hy - touchEps;
      const touchX = Math.abs(dx - (ha.hx + hb.hx)) < touchEps && dz < ha.hz + hb.hz - touchEps;
      const touchZ = Math.abs(dz - (ha.hz + hb.hz)) < touchEps && dx < ha.hx + hb.hx - touchEps;
      if (!overlapY || (!touchX && !touchZ)) continue;
      // beruehren sich -> gibt es EINEN Connector von A und EINEN von B, die
      // (egal ob direkt gepaart oder ueber eine Wand) an dieser Grenze liegen?
      // Boundary je Achse EXAKT (Mittelpunkt der beiden Zentren); je Raum wird
      // auf der SENKRECHTEN Achse dessen EIGENES Zentrum verwendet, nicht das
      // des Partners — sonst verschiebt sich der Suchpunkt bei mehrzelligen
      // Räumen (Treppe, Halle) und ihre eigenen Connectors werden verfehlt.
      const boundaryX = (A.p.pos.x + B.p.pos.x) / 2;
      const boundaryZ = (A.p.pos.z + B.p.pos.z) / 2;
      const nearBoundary = (c: ConnInst, ownPos: Vector3) => {
        const px = touchX ? boundaryX : ownPos.x;
        const pz = touchX ? ownPos.z : boundaryZ;
        return Math.hypot(c.pos.x - px, c.pos.z - pz) < 1.2 && Math.abs(c.pos.y - ownPos.y) < 2;
      };
      const aHas = conns.some((c) => c.roomIndex === A.i && nearBoundary(c, A.p.pos));
      const bHas = conns.some((c) => c.roomIndex === B.i && nearBoundary(c, B.p.pos));
      if (!aHas && !bHas) {
        stummeNachbarn++;
        const pairKey = [A.p.room, B.p.room].sort().join('+');
        pairTypeTally.set(pairKey, (pairTypeTally.get(pairKey) ?? 0) + 1);
        if (beispiele.length < 6) {
          beispiele.push(
            `Stumme Nachbarschaft: #${A.i} (${A.p.room}) @(${A.p.pos.x},${A.p.pos.z}) <-> ` +
              `#${B.i} (${B.p.room}) @(${B.p.pos.x},${B.p.pos.z}) — kein Connector auf beiden Seiten`
          );
        }
      }
    }
  }

  // (d) Erreichbarkeit: Graph aus gepaarten Connectors (nur zwischen
  // zellartigen Räumen — Wände sind Sackgassen).
  const cellIdx = new Set(cellRooms.map((x) => x.i));
  const adj = new Map<number, Set<number>>();
  for (const i of cellIdx) adj.set(i, new Set());
  const cellConns = conns.filter((c) => cellIdx.has(c.roomIndex));
  for (let a = 0; a < cellConns.length; a++) {
    for (let b = a + 1; b < cellConns.length; b++) {
      const ca = cellConns[a]!, cb = cellConns[b]!;
      if (ca.roomIndex === cb.roomIndex) continue;
      if (sqDist(ca.pos, cb.pos) < 0.01) {
        adj.get(ca.roomIndex)!.add(cb.roomIndex);
        adj.get(cb.roomIndex)!.add(ca.roomIndex);
      }
    }
  }
  const startIdx = 0; // Eingangsraum
  const seen = new Set<number>([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  const unerreichbar = cellRooms.filter((x) => !seen.has(x.i)).length;
  if (unerreichbar > 0) {
    const beispielRaum = cellRooms.find((x) => !seen.has(x.i))!;
    beispiele.push(`Unerreichbar: #${beispielRaum.i} (${beispielRaum.p.room}) @(${beispielRaum.p.pos.x},${beispielRaum.p.pos.z},${beispielRaum.p.pos.y})`);
  }

  // (e) Treppen mit unversorgtem Anschluss (offen ODER Blindtür).
  let treppenProblem = 0;
  for (const c of conns) {
    if (layout.rooms[c.roomIndex]!.room !== 'StoneVaultStairs') continue;
    if (openKey.has(`${c.roomIndex}:${c.connIndex}`)) {
      treppenProblem++;
      beispiele.push(
        `Treppenanschluss unversorgt: #${c.roomIndex} Connector ${c.connIndex} bei (${c.pos.x.toFixed(1)},${c.pos.y.toFixed(1)},${c.pos.z.toFixed(1)})`
      );
    }
  }

  return {
    seed,
    offenInsLeere,
    blindtueren,
    stummeNachbarn,
    unerreichbar,
    treppenProblem,
    raeume: layout.rooms.length,
    beispiele,
  };
}

function stats(vals: number[]) {
  const sorted = [...vals].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mid = sorted.length / 2;
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[Math.floor(mid)]!;
  const betroffen = vals.filter((v) => v > 0).length;
  return { min, median, max, betroffenAnteil: `${betroffen}/${vals.length}` };
}

const pairTypeTally = new Map<string, number>();
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const befunde: Befund[] = [];
for (const seed of SEEDS) {
  const layout = generateDungeonLayout(def, seed);
  befunde.push(messeLayout(layout, seed));
}

// Mikes gen-probe-Fall: Seed 2123721695, maxRooms 12, zoneSize 32.
const probeDef = { ...def, maxRooms: 12 };
const probeLayout = generateDungeonLayout(probeDef, 2123721695, { zoneSize: 32 });
const probeBefund = messeLayout(probeLayout, 2123721695);

console.log('=== DG_StoneVault — 40 Seeds (1..40), Standardeinstellungen (maxRooms 60, zoneSize 48) ===\n');
console.log('Metrik                  min  median  max  betroffene Seeds');
for (const [label, key] of [
  ['offene Kanten ins Leere', 'offenInsLeere'],
  ['Blindtüren (Wand davor)', 'blindtueren'],
  ['stumme Nachbarschaften ', 'stummeNachbarn'],
  ['unerreichbare Räume    ', 'unerreichbar'],
  ['Treppen-Anschlussfehler', 'treppenProblem'],
] as const) {
  const vals = befunde.map((b) => b[key as keyof Befund] as number);
  const s = stats(vals);
  console.log(`${label}  ${String(s.min).padStart(3)}  ${String(s.median).padStart(6)}  ${String(s.max).padStart(3)}  ${s.betroffenAnteil}`);
}

console.log('\nRäume je Layout: min', Math.min(...befunde.map((b) => b.raeume)), 'median', stats(befunde.map((b) => b.raeume)).median, 'max', Math.max(...befunde.map((b) => b.raeume)));

console.log('\n--- Beispiele (2-3 Seeds mit auffälligen Werten) ---');
const auffaellig = [...befunde].sort((a, b) => (b.blindtueren + b.stummeNachbarn + b.unerreichbar) - (a.blindtueren + a.stummeNachbarn + a.unerreichbar)).slice(0, 3);
for (const b of auffaellig) {
  console.log(`\nSeed ${b.seed} (${b.raeume} Räume): offen=${b.offenInsLeere} blind=${b.blindtueren} stumm=${b.stummeNachbarn} unerreichbar=${b.unerreichbar} treppe=${b.treppenProblem}`);
  for (const e of b.beispiele) console.log('  ' + e);
}

console.log('\n=== Mikes gen-probe: Seed 2123721695, maxRooms 12, zoneSize 32 ===');
console.log(`Räume=${probeBefund.raeume} offen=${probeBefund.offenInsLeere} blind=${probeBefund.blindtueren} stumm=${probeBefund.stummeNachbarn} unerreichbar=${probeBefund.unerreichbar} treppe=${probeBefund.treppenProblem}`);
for (const e of probeBefund.beispiele) console.log('  ' + e);

console.log('\n--- Stumme Nachbarschaften nach Raumtyp-Paar (uber alle 40 Seeds) ---');
for (const [k, v] of [...pairTypeTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${k}: ${v}`);
}

// Zusaetzliche Rohdaten fuer die Auswertung.
console.log('\n--- Alle Seeds (roh) ---');
for (const b of befunde) {
  console.log(`seed=${b.seed} raeume=${b.raeume} offen=${b.offenInsLeere} blind=${b.blindtueren} stumm=${b.stummeNachbarn} unerreichbar=${b.unerreichbar} treppe=${b.treppenProblem}`);
}
