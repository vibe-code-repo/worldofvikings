/**
 * Island pick and jump target of the offline flight (K2.0), without a window.
 *
 *   npx tsx test/inselwahl.ts        (from client/)
 *
 * Before: the flight always started at (0, 0) — open sea in the dev world —
 * and the editor gave no way to say where to arrive. Now the editor opens the
 * flight with `pos=x,z`, the target is checked (inside a region, above the
 * water line), the flight tells the player where it is, and Q leaves the last
 * position for the editor's map.
 *
 * The world is the real one: a COPY of `server/data/welten/dev.json` (read
 * only), built with the same `createWorld` the client uses. The numbers are
 * derived from it, not typed in, so the test keeps working when islands move.
 */
import { readFileSync } from 'node:fs';
import { WATER_LEVEL, sanitizeWorldLayout, signedDistance } from '@wov/shared';
import type { RegionDef, WorldLayout } from '@wov/shared';
import { createWorld } from '../src/world/World';
import {
  JUMP_CLEARANCE,
  MIN_ABOVE_WATER,
  checkJump,
  checkJumpFromDraft,
  compassName,
  flightUrl,
  headingOf,
  heightSourcesFor,
  islandCentre,
  islandList,
  islandRows,
  parseJumpParam,
  positionLines,
  regionAt,
  roundCoordinate,
} from '../src/editor/testflug/inselwahl';
import {
  RETURN_KEY,
  decodeReturn,
  encodeReturn,
  onReturn,
  sendReturn,
} from '../src/editor/testflug/ruecksprung';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};
const naheBei = (a: number, b: number, tol: number, text: string): void =>
  pruefe(Math.abs(a - b) <= tol, `${text} (${a} vs ${b}, tolerance ${tol})`);
const lies = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8');

console.log('Island pick and jump target');

const doc: unknown = JSON.parse(lies('../../server/data/welten/dev.json'));
const layout = sanitizeWorldLayout(doc) as WorldLayout;
pruefe(layout.regions.length >= 10, `dev world has regions (${layout.regions.length})`);
const world = createWorld(undefined, {}, doc);
const ground = (x: number, z: number): number => world.getGroundHeight(x, z);
const estimate = (x: number, z: number): number => world.geo.getHeight(x, z);
const src = heightSourcesFor(layout);

// The editor tree's own rule, copied here (editorMain.ts `inRegion` / `imPolygon`):
// the region drawn LAST that contains the point owns it.
const imPolygon = (pts: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean => {
  let innen = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]!;
    const [xj, zj] = pts[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) innen = !innen;
  }
  return innen;
};
const inRegion = (r: RegionDef, x: number, z: number): boolean =>
  r.shape.kind === 'circle'
    ? Math.hypot(x - r.shape.x, z - r.shape.z) <= r.shape.radius
    : imPolygon(r.shape.points, x, z);
const baumZaehlung = (l: WorldLayout): Map<string, number> => {
  const m = new Map<string, number>();
  const obenZuerst = [...l.regions].reverse();
  for (const p of l.placements ?? []) {
    const id = obenZuerst.find((r) => inRegion(r, p.x, p.z))?.id;
    if (id) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
};

// ── 1. Every region of the dev world: a target on land inside it, or a message ──
{
  const t0 = performance.now();
  const liste = islandList(layout, ground, estimate);
  const dauer = performance.now() - t0;
  console.log(`  ${liste.length} regions listed in ${dauer.toFixed(0)} ms`);
  pruefe(liste.length === layout.regions.length, 'one row per region');
  const mitZiel = liste.filter((e) => e.target !== null);
  pruefe(mitZiel.length >= 10, `most regions have a target (${mitZiel.length}/${liste.length})`);
  const zaehlung = baumZaehlung(layout);
  for (const e of liste) {
    const region = layout.regions.find((r) => r.id === e.id)!;
    pruefe(e.placements === (zaehlung.get(e.id) ?? 0), `${e.id}: placement count ${e.placements} = tree rule ${zaehlung.get(e.id) ?? 0}`);
    if (e.target) {
      const g = ground(e.target.x, e.target.z);
      pruefe(g >= WATER_LEVEL + MIN_ABOVE_WATER, `${e.id}: target ground ${g.toFixed(1)} m above water ${WATER_LEVEL}`);
      pruefe(signedDistance(region.shape, e.target.x, e.target.z) >= 0, `${e.id}: target inside the region`);
      pruefe(regionAt(layout, e.target.x, e.target.z) === region, `${e.id}: the region is the topmost at its target`);
      pruefe(e.message === null, `${e.id}: no message with a target`);
      const j = checkJump(layout, ground, e.target.x, e.target.z);
      pruefe(j.ok && Math.abs(j.y - (j.ground + JUMP_CLEARANCE)) < 1e-9, `${e.id}: figure is put down ${JUMP_CLEARANCE} m above ground`);
    } else {
      pruefe(typeof e.message === 'string' && e.message.length > 0, `${e.id}: a region without land carries a message`);
    }
  }
  const zeilen = islandRows(layout);
  pruefe(zeilen.every((r, i) => r.id === liste[i]!.id), 'rows and list agree');
  // Labels of the editor tree: region id and biome, the continent by name.
  pruefe(zeilen.every((r, i) => r.biome === layout.regions[i]!.biome), 'biome label = the editor tree');
}

// ── 2. The real sources give the same target as the cheap search alone ──────
{
  const a = layout.regions.find((r) => r.shape.kind === 'polygon')!;
  const t1 = islandCentre(layout, a, src.ground, src.estimate);
  const t2 = islandCentre(layout, a, ground, estimate);
  pruefe((t1 === null) === (t2 === null), 'heightSourcesFor agrees with createWorld');
  if (t1 && t2) pruefe(t1.x === t2.x && t1.z === t2.z, 'same target from both sources');
}

// ── 3. Special cases: outside every region, in the water, invalid ───────────
{
  const draussen = checkJump(layout, ground, 0, 0);
  pruefe(!draussen.ok && draussen.reason === 'outside', '(0, 0) is open sea: refused as "outside"');
  pruefe(!draussen.ok && /außerhalb jeder Region/.test(draussen.message), 'the message says so');

  const ungueltig = checkJump(layout, ground, Number.NaN, 5);
  pruefe(!ungueltig.ok && ungueltig.reason === 'invalid', 'NaN is refused');
  pruefe(!checkJump(layout, ground, Infinity, 0).ok, 'Infinity is refused');

  // A region that is all water: low base level and no relief (the highest point stays under the line).
  const flach: RegionDef = {
    id: 'flachsee',
    biome: 'grassland',
    shape: { kind: 'circle', x: 0, z: 0, radius: 900 },
    edgeFalloff: 300,
    baseLevel: 0.05,
    heightScale: 0,
  };
  const seeLayout = sanitizeWorldLayout({ ...(doc as object), regions: [flach], placements: [], rivers: [], lakes: [], routes: [] }) as WorldLayout;
  const seeWelt = createWorld(undefined, {}, seeLayout);
  const seeGround = (x: number, z: number): number => seeWelt.getGroundHeight(x, z);
  pruefe(seeGround(0, 0) < WATER_LEVEL, `test world: the shallow region is under water (${seeGround(0, 0).toFixed(1)} m)`);
  let hoechster = -Infinity;
  for (let x = -900; x <= 900; x += 60) for (let z = -900; z <= 900; z += 60) hoechster = Math.max(hoechster, seeWelt.geo.getHeight(x, z));
  pruefe(hoechster < WATER_LEVEL, `test world: nothing in it reaches the water line (highest ${hoechster.toFixed(1)} m)`);
  const imWasser = checkJump(seeLayout, seeGround, 0, 0);
  pruefe(!imWasser.ok && imWasser.reason === 'water', 'inside a region but under water: refused as "water"');
  pruefe(!imWasser.ok && /liegt im Wasser/.test(imWasser.message) && /flachsee/.test(imWasser.message), 'message names the region and the water');
  const keinLand = islandList(seeLayout, seeGround, (x, z) => seeWelt.geo.getHeight(x, z));
  pruefe(keinLand.length === 1 && keinLand[0]!.target === null, 'a region without land has no jump target');
  pruefe(/kein Land/.test(keinLand[0]!.message ?? ''), 'and says why');
}

// ── 4. Z-order: the region drawn last owns the point ───────────────────────
{
  const unten: RegionDef = { id: 'unten', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1000 }, edgeFalloff: 300 };
  const oben: RegionDef = { id: 'oben', biome: 'mountain', shape: { kind: 'circle', x: 0, z: 0, radius: 300 }, edgeFalloff: 300 };
  const l = sanitizeWorldLayout({ ...(doc as object), regions: [unten, oben], placements: [] }) as WorldLayout;
  pruefe(regionAt(l, 0, 0)?.id === 'oben', 'inside both: the later region');
  pruefe(regionAt(l, 700, 0)?.id === 'unten', 'inside the lower one only: the lower region');
  pruefe(regionAt(l, 2000, 0) === null, 'outside both: null');
}

// ── 5. Jump address ─────────────────────────────────────────────────────────
{
  pruefe(flightUrl() === '/?offline=1&layout=editor', 'plain flight address unchanged');
  pruefe(flightUrl({ x: -17620, z: -5700 }) === '/?offline=1&layout=editor&pos=-17620,-5700', 'jump address');
  pruefe(flightUrl({ x: 1.23456, z: -0.04 }) === '/?offline=1&layout=editor&pos=1.2,0', 'coordinates rounded to 0.1 m without float noise (and no "-0")');
  pruefe(roundCoordinate(-17620.1) === -17620.1, 'no float noise: -17620.1');
  const p = parseJumpParam('-12.5,340');
  pruefe(p !== null && p.x === -12.5 && p.z === 340, 'pos parsed');
  for (const schlecht of [null, '', ',', '1', '1,2,3', 'a,b', '1,', ',2', 'NaN,1', 'Infinity,0']) {
    pruefe(parseJumpParam(schlecht) === null, `bad pos ${JSON.stringify(schlecht)} refused`);
  }
  const ok = checkJumpFromDraft(doc, ground, '-17620,-5700');
  pruefe(ok.ok && ok.region.id === 'insel-1', 'client side: the draft and pos give the arrival');
  pruefe(!checkJumpFromDraft(null, ground, '1,2').ok, 'client side: no draft, no jump');
  pruefe(!checkJumpFromDraft(doc, ground, 'x').ok, 'client side: bad pos, no jump');
  pruefe(!checkJumpFromDraft(doc, ground, '0,0').ok, 'client side: sea, no jump');
}

// ── 6. Orientation display ──────────────────────────────────────────────────
{
  // The camera looks along (-sin yaw, -cos yaw); north is +z (minimap, world map).
  naheBei(headingOf(0), 180, 1e-9, 'yaw 0 looks south (-z)');
  naheBei(headingOf(Math.PI), 0, 1e-9, 'yaw pi looks north (+z)');
  naheBei(headingOf(Math.PI / 2), 270, 1e-9, 'yaw pi/2 looks west (-x)');
  naheBei(headingOf(-Math.PI / 2), 90, 1e-9, 'yaw -pi/2 looks east (+x)');
  pruefe(compassName(0) === 'N' && compassName(45) === 'NO' && compassName(90) === 'O' && compassName(180) === 'S' && compassName(270) === 'W' && compassName(359) === 'N', 'compass names');
  // Three places on three islands: the displayed height over ground matches the height field (±0.5 m).
  const orte = islandList(layout, ground, estimate).filter((e) => e.target).slice(0, 3);
  pruefe(orte.length === 3, 'three islands with a target');
  for (const e of orte) {
    const { x, z } = e.target!;
    const g = ground(x, z);
    const zeilen = positionLines(layout, ground, { x, z, y: g + 7.3, yaw: Math.PI });
    pruefe(zeilen.length === 4, `${e.id}: four lines`);
    pruefe(zeilen[0]!.startsWith(`${e.id} · ${e.biome}`), `${e.id}: first line names region and biome (${zeilen[0]})`);
    pruefe(zeilen[1] === `x ${Math.round(x)}  z ${Math.round(z)}`, `${e.id}: coordinate line (${zeilen[1]})`);
    const m = /^(-?\d+,\d) m über Grund \(Gelände (-?\d+,\d) m\)$/.exec(zeilen[2]!);
    pruefe(m !== null, `${e.id}: height line shape (${zeilen[2]})`);
    if (m) {
      naheBei(Number(m[1]!.replace(',', '.')), 7.3, 0.5, `${e.id}: height over ground`);
      naheBei(Number(m[2]!.replace(',', '.')), g, 0.5, `${e.id}: ground height`);
    }
    pruefe(zeilen[3] === 'Blick N 0°', `${e.id}: direction line (${zeilen[3]})`);
  }
  pruefe(positionLines(layout, ground, { x: 0, z: 0, y: 0, yaw: 0 })[0] === 'offene See', 'open sea named as such');
  pruefe(positionLines(null, ground, { x: 0, z: 0, y: 0, yaw: 0 })[0] === 'offene See', 'no layout: open sea, no crash');
}

// ── 7. The way back ─────────────────────────────────────────────────────────
{
  const punkt = { x: -17620.5, z: -5700.25, yaw: 1.5, at: 1_700_000_000_000 };
  const zurueck = decodeReturn(encodeReturn(punkt));
  pruefe(zurueck !== null && zurueck.x === punkt.x && zurueck.z === punkt.z && zurueck.yaw === punkt.yaw && zurueck.at === punkt.at, 'encode / decode round trip');
  for (const roh of [null, '', 'x', '[]', '{}', '{"x":1,"z":2,"yaw":0}', '{"x":"1","z":2,"yaw":0,"at":1}', '{"x":null,"z":2,"yaw":0,"at":1}', '{"x":1e999,"z":2,"yaw":0,"at":1}']) {
    pruefe(decodeReturn(roh) === null, `garbage refused: ${JSON.stringify(roh)}`);
  }
  const gespeichert = new Map<string, string>();
  pruefe(sendReturn({ setItem: (k, v) => void gespeichert.set(k, v) }, punkt), 'send reports success');
  pruefe(gespeichert.get(RETURN_KEY) === encodeReturn(punkt), 'send writes the value under the key');
  pruefe(!sendReturn({ setItem: () => { throw new Error('quota'); } }, punkt), 'a refusing storage gives false, no throw');

  type Hoerer = (e: StorageEvent) => void;
  const hoerer = new Set<Hoerer>();
  const ziel = {
    addEventListener: (_t: 'storage', h: Hoerer) => void hoerer.add(h),
    removeEventListener: (_t: 'storage', h: Hoerer) => void hoerer.delete(h),
  };
  const sende = (key: string | null, newValue: string | null): void => {
    for (const h of [...hoerer]) h({ key, newValue } as StorageEvent);
  };
  const gehoert: number[] = [];
  const weg = onReturn(ziel, (p) => gehoert.push(p.x));
  sende('wov-editor-layout', encodeReturn(punkt));
  sende(RETURN_KEY, 'kaputt');
  sende(RETURN_KEY, null);
  sende(null, null);
  pruefe(gehoert.length === 0, 'other keys, garbage and a removal are not heard');
  sende(RETURN_KEY, encodeReturn(punkt));
  pruefe(gehoert.length === 1 && gehoert[0] === punkt.x, 'a return is heard once');
  weg();
  sende(RETURN_KEY, encodeReturn(punkt));
  pruefe(gehoert.length === 1 && hoerer.size === 0, 'after removing the listener nothing is heard');
}

// ── 8. Key V: the build mode only ───────────────────────────────────────────
{
  // The flight had two handlers on V (build mode and vegetation rebuild). Quotes
  // differ between formatters, so count the code names only.
  const testflug = lies('../src/editor/testflug/Testflug.ts');
  const anzahl = (m: RegExp): number => (testflug.match(m) ?? []).length;
  pruefe(anzahl(/Key[V]/g) === 1, 'exactly one handler on V (the build mode)');
  pruefe(anzahl(/Key[G]\b/g) === 1, 'the vegetation rebuild has its own key (G)');
  pruefe(anzahl(/Key[Q]\b/g) === 1, 'the way back has its own key (Q)');
}

console.log(`\n${geprueft - fehler}/${geprueft} checks passed`);
if (fehler > 0) {
  console.error(`${fehler} FAILED`);
  process.exit(1);
}
