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
import { readFileSync, readdirSync } from 'node:fs';
import * as ts from 'typescript';
import { WATER_LEVEL, sanitizeWorldLayout, signedDistance } from '@wov/shared';
import type { RegionDef, WorldLayout } from '@wov/shared';
import { createWorld } from '../src/world/World';
import {
  JUMP_CLEARANCE,
  MIN_ABOVE_WATER,
  TARGET_HEIGHT,
  checkJump,
  checkJumpFromDraft,
  compassName,
  flightUrl,
  headingOf,
  heightSourcesFor,
  islandCentre,
  islandList,
  islandSearch,
  islandSearchAsync,
  islandRows,
  parseJumpParam,
  positionLines,
  regionAt,
  roundCoordinate,
  searchMessage,
  SEARCH_BUDGET_MS,
} from '../src/editor/testflug/inselwahl';
import {
  LATE_MS,
  RETURN_CHANNEL,
  decodeReturn,
  encodeReturn,
  onReturn,
  planReturn,
  sendReturn,
} from '../src/editor/testflug/ruecksprung';
import type { ReturnChannel } from '../src/editor/testflug/ruecksprung';
import { clientBase, gameUrl, normaliseBase } from '../src/editor/spielAdresse';

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
  let mindesthoehe = Infinity;
  for (const e of liste) {
    const region = layout.regions.find((r) => r.id === e.id)!;
    pruefe(e.placements === (zaehlung.get(e.id) ?? 0), `${e.id}: placement count ${e.placements} = tree rule ${zaehlung.get(e.id) ?? 0}`);
    if (e.target) {
      const g = ground(e.target.x, e.target.z);
      pruefe(g >= WATER_LEVEL + MIN_ABOVE_WATER, `${e.id}: target ground ${g.toFixed(1)} m above water ${WATER_LEVEL}`);
      // No wet beach, no exception: real ground at least TARGET_HEIGHT above the water line (finding of attack 2: the
      // cheap estimate hid the real land of insel-3, which then got a target 3.17 m high).
      pruefe(g - WATER_LEVEL >= TARGET_HEIGHT, `${e.id}: target stands ${(g - WATER_LEVEL).toFixed(2)} m above the water line (asked: ${TARGET_HEIGHT} m)`);
      mindesthoehe = Math.min(mindesthoehe, g - WATER_LEVEL);
      pruefe(signedDistance(region.shape, e.target.x, e.target.z) >= 0, `${e.id}: target inside the region`);
      pruefe(regionAt(layout, e.target.x, e.target.z) === region, `${e.id}: the region is the topmost at its target`);
      pruefe(e.message === null, `${e.id}: no message with a target`);
      const j = checkJump(layout, ground, e.target.x, e.target.z);
      pruefe(j.ok && Math.abs(j.y - (j.ground + JUMP_CLEARANCE)) < 1e-9, `${e.id}: figure is put down ${JUMP_CLEARANCE} m above ground`);
    } else {
      pruefe(typeof e.message === 'string' && e.message.length > 0, `${e.id}: a region without land carries a message`);
    }
  }
  console.log(`  lowest target of ${mitZiel.length} regions: ${mindesthoehe.toFixed(2)} m above the water line`);
  const zeilen = islandRows(layout);
  pruefe(zeilen.every((r, i) => r.id === liste[i]!.id), 'rows and list agree');
  // Labels of the editor tree: region id and biome, the continent by name.
  pruefe(zeilen.every((r, i) => r.biome === layout.regions[i]!.biome), 'biome label = the editor tree');
}

// ── 1b. The estimate only orders: a wrong one must not hide real land ─────────
{
  // In six regions the centre is already the target, so the search never ran there; it is switched off here.
  // Terrain the draft has edited makes the world generator's height (the cheap estimate) tens of metres wrong.
  // Three liars stand in for it: everything deep under water, 60 m too low, a constant above the water line.
  const luegner: Array<[string, (x: number, z: number) => number]> = [
    ['everything deep under water', () => WATER_LEVEL - 500],
    ['the generator height minus 60 m', (x, z) => estimate(x, z) - 60],
    ['a constant above the water line', () => WATER_LEVEL + 40],
  ];
  const t0 = performance.now();
  let langsam = { id: '', ms: 0, art: '' };
  for (const [name, schaetzung] of luegner) {
    const ohne: string[] = [];
    for (const region of layout.regions) {
      const t1 = performance.now();
      const ziel = islandCentre(layout, region, ground, schaetzung, { useCentre: false }); // no centre shortcut: the grid search runs in ALL regions
      const ms = performance.now() - t1;
      if (ms > langsam.ms) langsam = { id: region.id, ms, art: name };
      if (!ziel) {
        ohne.push(region.id);
        continue;
      }
      const h = ground(ziel.x, ziel.z) - WATER_LEVEL;
      pruefe(h >= TARGET_HEIGHT, `estimate = ${name}: ${region.id}: real ground ${h.toFixed(2)} m above the water line (asked: ${TARGET_HEIGHT} m)`);
      pruefe(signedDistance(region.shape, ziel.x, ziel.z) >= 0, `estimate = ${name}: ${region.id}: target inside the region`);
    }
    pruefe(ohne.length === 0, `estimate = ${name}: every region still has a target (missing: ${ohne.join(', ') || 'none'})`);
  }
  console.log(`  three wrong estimates x 19 regions: ${(performance.now() - t0).toFixed(0)} ms, slowest ${langsam.id} ${langsam.ms.toFixed(0)} ms (${langsam.art})`);
  pruefe(langsam.ms < 8000, `the search stays bounded (${langsam.ms.toFixed(0)} ms for ${langsam.id})`);
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
  // The display and the in-game minimap agree (finding 2 of the first attack claimed 180 degrees apart;
  // browser run: at yaw 0 the minimap arrow points down, away from its N, and the display says "S").
  // The minimap draws its arrow with `rotate(yaw + PI)` on a tip at (0, -11), canvas y down, N at the top
  // (Minimap.ts); the same arithmetic gives the arrow's screen direction, from which the compass heading follows.
  const minimap = lies('../src/ui/Minimap.ts');
  pruefe(/ctx\.rotate\(yaw \+ Math\.PI\)/.test(minimap) && /moveTo\(0, -11\)/.test(minimap), 'the minimap still draws its arrow as rotate(yaw + PI) with the tip at (0, -11)');
  pruefe(/Norden = \+z \(oben\)/.test(minimap), 'the minimap still says north = +z at the top');
  for (let k = 0; k < 16; k++) {
    const yaw = (k * Math.PI) / 8 + 0.03;
    const winkel = yaw + Math.PI;
    // canvas rotation of the tip (0, -1): (sin a, -cos a); screen right = +x (east), screen down = -z (south)
    const ost = Math.sin(winkel);
    const nord = Math.cos(winkel);
    const ausMinimap = ((Math.atan2(ost, nord) * 180) / Math.PI + 360) % 360;
    const diff = Math.abs(((headingOf(yaw) - ausMinimap + 540) % 360) - 180);
    pruefe(diff < 1e-6, `yaw ${yaw.toFixed(2)}: display heading ${headingOf(yaw).toFixed(1)} = the minimap arrow's ${ausMinimap.toFixed(1)}`);
  }
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
  for (const roh of [null, undefined, 5, {}, '', 'x', '[]', '{}', '{"x":1,"z":2,"yaw":0}', '{"x":"1","z":2,"yaw":0,"at":1}', '{"x":null,"z":2,"yaw":0,"at":1}', '{"x":1e999,"z":2,"yaw":0,"at":1}']) {
    pruefe(decodeReturn(roh) === null, `garbage refused: ${JSON.stringify(roh)}`);
  }

  // A fake in place of BroadcastChannel: a bus with the sender excluded, like the real one.
  type Hoerer = (e: { data: unknown }) => void;
  class Kanal implements ReturnChannel {
    static alle = new Set<Kanal>();
    hoerer = new Set<Hoerer>();
    geschlossen = false;
    gesendet: unknown[] = [];
    constructor() {
      Kanal.alle.add(this);
    }
    postMessage(m: unknown): void {
      this.gesendet.push(m);
      for (const k of Kanal.alle) if (k !== this && !k.geschlossen) for (const h of [...k.hoerer]) h({ data: m });
    }
    addEventListener(_t: 'message', h: Hoerer): void {
      this.hoerer.add(h);
    }
    removeEventListener(_t: 'message', h: Hoerer): void {
      this.hoerer.delete(h);
    }
    close(): void {
      this.geschlossen = true;
      Kanal.alle.delete(this);
    }
  }
  pruefe(RETURN_CHANNEL === 'wov-editor-testflug-rueckkehr', 'channel name');

  const editorKanal = new Kanal();
  const gehoert: number[] = [];
  const weg = onReturn(editorKanal, (p) => gehoert.push(p.at));
  const flug = new Kanal();
  pruefe(sendReturn(() => flug, punkt), 'send reports success');
  pruefe(flug.gesendet.length === 1 && flug.gesendet[0] === encodeReturn(punkt), 'send posts the encoded position, once');
  pruefe(flug.geschlossen, 'the flight closes its channel after posting');
  pruefe(gehoert.length === 1 && gehoert[0] === punkt.at, 'the editor hears it once');
  // No editor listening: a send leaves nothing anywhere (a channel keeps no message).
  weg();
  pruefe(editorKanal.geschlossen, 'removing the listener closes the editor channel');
  pruefe(sendReturn(() => new Kanal(), punkt) && gehoert.length === 1, 'without a listener nothing is heard and nothing is stored');
  pruefe(!sendReturn(() => null, punkt), 'no channel available: false');
  const kaputt = new Kanal();
  kaputt.postMessage = () => { throw new Error('closed'); };
  pruefe(!sendReturn(() => kaputt, punkt) && kaputt.geschlossen, 'a channel that throws gives false, is closed, no throw');
  pruefe(!sendReturn(() => { throw new Error('nope'); }, punkt), 'a failing open gives false');
  pruefe(typeof onReturn(null, () => undefined) === 'function', 'no channel: a no-op remover, no crash');

  // Garbage and foreign messages are not heard.
  const ed2 = new Kanal();
  const h2: number[] = [];
  const weg2 = onReturn(ed2, (p) => h2.push(p.at));
  const fremd = new Kanal();
  for (const m of ['kaputt', null, 5, {}, JSON.stringify({ x: 1 })]) fremd.postMessage(m);
  pruefe(h2.length === 0, 'garbage messages are not heard');
  // Two flights: the editor keeps the NEWEST, a late older one is dropped (finding 6).
  const flugA = new Kanal();
  const flugB = new Kanal();
  const p = (x: number, at: number) => encodeReturn({ x, z: 0, yaw: 0, at });
  flugB.postMessage(p(2, 2000)); // written later, arrives first
  flugA.postMessage(p(1, 1000)); // written earlier, arrives late
  pruefe(h2.length === 1 && h2[0] === 2000, 'the older return that arrives second is dropped');
  flugA.postMessage(p(3, 2000));
  pruefe(h2.length === 2, 'the same write time is not "older": heard');
  flugA.postMessage(p(4, 2000 + LATE_MS + 5));
  pruefe(h2.length === 3, 'a newer one is heard');
  flugB.postMessage(p(5, 2000)); // system clock went back by more than LATE_MS: a new flight, heard
  pruefe(h2.length === 4, `older by more than ${LATE_MS} ms counts as a new flight (clock went back), so the map never freezes`);
  // The limit itself: at most LATE_MS older than the newest handled is late (dropped), one more is a new flight.
  const ed3 = new Kanal();
  const h3: number[] = [];
  const weg3 = onReturn(ed3, (q) => h3.push(q.at));
  const flugC = new Kanal();
  flugC.postMessage(p(0, 100_000));
  flugC.postMessage(p(0, 100_000 - LATE_MS + 1));
  flugC.postMessage(p(0, 100_000 - LATE_MS));
  pruefe(h3.length === 1, `${LATE_MS - 1} ms and exactly ${LATE_MS} ms older than the newest: dropped as late`);
  flugC.postMessage(p(0, 100_000 - LATE_MS - 1));
  pruefe(h3.length === 2, `${LATE_MS + 1} ms older: a new flight, heard`);
  weg3();
  weg2();
  pruefe(ed2.geschlossen && Kanal.alle.has(flugA), 'the remover closes only its own channel');

  // What Q does: after a refused jump nothing is sent (the figure stands at the origin).
  pruefe(planReturn(false, true) === 'send' && planReturn(false, false) === 'send', 'a normal return is sent whether or not the tab can close');
  pruefe(planReturn(true, true) === 'close-only', 'refused jump, tab can close: close it, send nothing');
  pruefe(planReturn(true, false) === 'stay', 'refused jump, tab cannot close: stay, send nothing');
  pruefe(planReturn(true, true, true) === 'send' && planReturn(true, false, true) === 'send', 'refused jump, but the figure has since come into a region: the return is sent again');
  pruefe(planReturn(true, true, false) === 'close-only' && planReturn(true, false, false) === 'stay', 'refused jump and still outside every region: as before');
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
  pruefe(anzahl(/planReturn\(/g) === 1 && anzahl(/sendReturnFromBrowser\(/g) === 1, 'Q asks planReturn once and sends only through it');
  pruefe(!/localStorage/.test(lies('../src/editor/testflug/ruecksprung.ts').replace(/\/\*[\s\S]*?\*\//g, '')), 'the way back does not touch localStorage');
}

// ── 9. Overlapping regions: the target does not depend on the draw order ─────
{
  const mitRegionen = (regionen: RegionDef[]): WorldLayout =>
    sanitizeWorldLayout({ ...(doc as object), regions: regionen, placements: [], rivers: [], lakes: [], routes: [] }) as WorldLayout;
  const quellen = (l: WorldLayout) => {
    const w = createWorld(undefined, {}, l);
    return { g: (x: number, z: number): number => w.getGroundHeight(x, z), e: (x: number, z: number): number => w.geo.getHeight(x, z) };
  };
  const inside = (l: WorldLayout, r: RegionDef, x: number, z: number): boolean => signedDistance(r.shape, x, z) >= 0 && l.regions.includes(r);

  // A: a small region lies on the centre of a big one (the finding: "hat kein Land").
  const gross: RegionDef = { id: 'gross', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2500 }, edgeFalloff: 500 };
  const klein: RegionDef = { id: 'klein-oben', biome: 'mountain', shape: { kind: 'circle', x: 0, z: 0, radius: 400 }, edgeFalloff: 200 };
  const lA = mitRegionen([gross, klein]);
  const qA = quellen(lA);
  const grossR = lA.regions.find((r) => r.id === 'gross')!;
  const tA = islandCentre(lA, grossR, qA.g, qA.e);
  pruefe(regionAt(lA, 0, 0)?.id === 'klein-oben', 'A: the centre of the big region belongs to the small one on top');
  pruefe(tA !== null, 'A: the big region still has a target (its centre is covered by a later region)');
  if (tA) {
    pruefe(inside(lA, grossR, tA.x, tA.z), 'A: the target lies inside the big region');
    pruefe(regionAt(lA, tA.x, tA.z) === grossR, 'A: and it is ground the big region owns (not the covered patch)');
    pruefe(qA.g(tA.x, tA.z) >= WATER_LEVEL + TARGET_HEIGHT, `A: on high land (${(qA.g(tA.x, tA.z) - WATER_LEVEL).toFixed(1)} m above water)`);
  }
  pruefe(islandList(lA, qA.g, qA.e).every((e) => e.target !== null), 'A: no region of the list is reported without land');

  // B: a region completely under a later one has no ground of its own — it still gets a target inside it.
  const unten: RegionDef = { id: 'unten', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 700 }, edgeFalloff: 200 };
  const deckel: RegionDef = { id: 'deckel', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1500 }, edgeFalloff: 300 };
  const lB = mitRegionen([unten, deckel]);
  const qB = quellen(lB);
  const untenR = lB.regions.find((r) => r.id === 'unten')!;
  const tB = islandCentre(lB, untenR, qB.g, qB.e);
  pruefe(regionAt(lB, 0, 0)?.id === 'deckel', 'B: the lower region is covered everywhere');
  pruefe(tB !== null && inside(lB, untenR, tB.x, tB.z), 'B: a covered region gets a target inside itself');
  if (tB) pruefe(checkJump(lB, qB.g, tB.x, tB.z).ok, 'B: and the jump there is accepted');

  // C: the real dev world in every draw order that matters: reversed, rotated. Each region keeps a target inside itself.
  const ordnungen: Array<[string, RegionDef[]]> = [
    ['reversed', [...layout.regions].reverse()],
    ['rotated by 5', [...layout.regions.slice(5), ...layout.regions.slice(0, 5)]],
    ['rotated by 11', [...layout.regions.slice(11), ...layout.regions.slice(0, 11)]],
  ];
  for (const [name, regionen] of ordnungen) {
    const l = mitRegionen(regionen);
    const q = quellen(l);
    const liste = islandList(l, q.g, q.e);
    const ohne = liste.filter((e) => e.target === null).map((e) => e.id);
    pruefe(ohne.length === 0, `C (${name}): every region has a target (missing: ${ohne.join(', ') || 'none'})`);
    for (const e of liste) {
      if (!e.target) continue;
      const r = l.regions.find((k) => k.id === e.id)!;
      const h = q.g(e.target.x, e.target.z) - WATER_LEVEL;
      pruefe(signedDistance(r.shape, e.target.x, e.target.z) >= 0, `C (${name}): ${e.id}: target inside the region`);
      pruefe(checkJump(l, q.g, e.target.x, e.target.z).ok, `C (${name}): ${e.id}: the jump is accepted`);
      pruefe(h >= MIN_ABOVE_WATER, `C (${name}): ${e.id}: above water (${h.toFixed(2)} m)`);
    }
  }
}

// ── 10. The search is bounded, stepwise and honest about it ─────────────────
{
  // A region under water: nothing high anywhere, so the whole grid is read.
  const flach: RegionDef = { id: 'flachsee', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 700 }, edgeFalloff: 300, baseLevel: 0.05, heightScale: 0 };
  const seeLayout = sanitizeWorldLayout({ ...(doc as object), regions: [flach], placements: [], rivers: [], lakes: [], routes: [] }) as WorldLayout;
  const seeWelt = createWorld(undefined, {}, seeLayout);
  const seeGround = (x: number, z: number): number => seeWelt.getGroundHeight(x, z);
  const see = seeLayout.regions[0]!;

  // A clock that advances 5 ms per look: the budget ends the search after a countable number of reads.
  let uhr = 0;
  const tick = (): number => (uhr += 5);
  uhr = 0;
  const halb = await islandSearchAsync(seeLayout, see, seeGround, seeGround, 100, tick);
  pruefe(!halb.complete && halb.target === null, 'water region, 100 ms of a 5 ms clock: cut off, no land found so far');
  pruefe(halb.reads > 0 && halb.reads <= 25, `and only about 100 / 5 reads were made (${halb.reads})`);
  const t0 = performance.now();
  const ganz = islandSearch(seeLayout, see, seeGround);
  const ganzMs = performance.now() - t0;
  pruefe(ganz.complete && ganz.target === null && ganz.reads > 500, `without a limit the whole grid is read (${ganz.reads} reads, ${ganzMs.toFixed(0)} ms) and the answer is: no land`);
  console.log(`  water region r=700: unlimited ${ganzMs.toFixed(0)} ms / ${ganz.reads} reads; with the ${SEARCH_BUDGET_MS} ms limit at most that`);

  // The real clock: reads that take 2 ms each are cut off after the budget, not after the grid (about 1300 x 2 ms).
  const langsam = (x: number, z: number): number => {
    const t = performance.now();
    while (performance.now() - t < 2) {
      /* a slow machine */
    }
    return seeGround(x, z);
  };
  const t3 = performance.now();
  const begrenzt = await islandSearchAsync(seeLayout, see, langsam, seeGround, 150);
  const dauer = performance.now() - t3;
  pruefe(!begrenzt.complete && begrenzt.reads < 200, `real clock, 2 ms reads, 150 ms budget: cut off after ${begrenzt.reads} reads`);
  pruefe(dauer < 150 + 120, `and it took ${dauer.toFixed(0)} ms, not the ~2600 ms of the whole grid`);

  // The stepwise driver equals the one-go driver where nothing is cut off, and the page breathes meanwhile.
  const region3 = layout.regions.find((r) => r.id === 'insel-3')!;
  const eins = islandSearch(layout, region3, ground, estimate);
  let takte = 0;
  const wecker = setInterval(() => takte++, 1);
  const schritt = await islandSearchAsync(layout, region3, ground, estimate, 60_000);
  clearInterval(wecker);
  pruefe(schritt.complete && schritt.target !== null && eins.target !== null && schritt.target.x === eins.target.x && schritt.target.z === eins.target.z, 'insel-3: stepwise and one-go search find the same target');
  pruefe(takte > 0, `the event loop ran during the stepwise search (${takte} timer ticks; a search of ${schritt.reads} reads)`);
  pruefe((schritt.height ?? 0) >= TARGET_HEIGHT, 'insel-3: high land');

  // A limit that strikes after the target is found changes nothing; one that strikes before takes what there is.
  let n = 0;
  const nachDrei = islandSearch(layout, region3, ground, estimate, { stop: () => ++n > 3 });
  pruefe(!nachDrei.complete && nachDrei.reads <= 4, `stopped after three reads: cut off (${nachDrei.reads} reads)`);
  pruefe(nachDrei.target === null || nachDrei.height! < TARGET_HEIGHT, 'and no target on high land is claimed');

  // What the player is told.
  const hoch: import('../src/editor/testflug/inselwahl').IslandSearch = { target: { x: 1, z: 2 }, height: 20, complete: true, reads: 1 };
  pruefe(searchMessage('insel-x', hoch) === null, 'high land: nothing to say');
  const niedrig = searchMessage('insel-x', { target: { x: 1, z: 2 }, height: 1.2, complete: true, reads: 900 });
  pruefe(niedrig !== null && !niedrig.error && /niedrig/.test(niedrig.text) && /1,2 m über der Wasserlinie/.test(niedrig.text), `low land is said out loud: ${niedrig?.text}`);
  const niedrigAbgebrochen = searchMessage('insel-x', { target: { x: 1, z: 2 }, height: 3, complete: false, reads: 900 });
  pruefe(niedrigAbgebrochen !== null && /abgebrochen/.test(niedrigAbgebrochen.text) && new RegExp(`${(SEARCH_BUDGET_MS / 1000).toFixed(1).replace('.', ',')} s`).test(niedrigAbgebrochen.text), `low land and cut off: both are said (${niedrigAbgebrochen?.text})`);
  const keins = searchMessage('insel-x', { target: null, height: null, complete: true, reads: 1681 });
  pruefe(keins !== null && keins.error && /kein Land/.test(keins.text) && !/abgebrochen/.test(keins.text), 'no land after the whole grid: says so');
  const keinsAbgebrochen = searchMessage('insel-x', { target: null, height: null, complete: false, reads: 400 });
  pruefe(keinsAbgebrochen !== null && keinsAbgebrochen.error && /abgebrochen/.test(keinsAbgebrochen.text) && /vermutlich/.test(keinsAbgebrochen.text), 'no land found when cut off: says the search was cut off, not that there is none');

  // The panel and the editor use these (source check on code names only).
  const panel = lies('../src/editor/testflug/InselwahlPanel.ts');
  pruefe(/islandSearchAsync\(/.test(panel) && /searchMessage\(/.test(panel), 'the panel searches stepwise and reports through searchMessage');
  pruefe(/oeffneTab\(\)/.test(panel) && panel.indexOf('oeffneTab()') < panel.indexOf('islandSearchAsync('), 'the tab is opened before the search starts (inside the click)');
  const editor = lies('../src/editor/editorMain.ts');
  pruefe(/if \(!tab\)/.test(editor) && /Pop-ups/.test(editor), 'the editor reports a blocked pop-up');
  const roh = (editor.match(/window\.open\(url, /g) ?? []).length;
  pruefe(roh === 1, `the flight tabs are opened in one place (oeffneFlugTab): ${roh}`);
}

// ── 7. The address carries the base prefix of the client ────────────────────
// The flight lived at `/?offline=1&layout=editor` and opened the editor again:
// the client is served under `/play/`, and on the editor host nginx sends `/`
// to the editor. The address starts with the base prefix of the build.
{
  const ziel = { x: -17620, z: -5700 };
  pruefe(flightUrl(undefined, '/play/') === '/play/?offline=1&layout=editor', 'prefix /play/: plain flight address');
  pruefe(flightUrl(ziel, '/play/') === '/play/?offline=1&layout=editor&pos=-17620,-5700', 'prefix /play/: jump address');
  pruefe(flightUrl(undefined, '/') === '/?offline=1&layout=editor', 'prefix /: the old plain address');
  pruefe(flightUrl(ziel, '/') === '/?offline=1&layout=editor&pos=-17620,-5700', 'prefix /: the old jump address');
  for (const base of ['/play', 'play/', 'play', '//play//', '/play//', '/play/']) {
    pruefe(flightUrl(ziel, base) === '/play/?offline=1&layout=editor&pos=-17620,-5700', `prefix ${JSON.stringify(base)} is put together right`);
    pruefe(!flightUrl(undefined, base).includes('//'), `prefix ${JSON.stringify(base)}: no doubled slash`);
  }
  for (const leer of ['', '///', undefined, null]) {
    pruefe(flightUrl(ziel, leer as string | undefined) === '/?offline=1&layout=editor&pos=-17620,-5700', `empty prefix ${JSON.stringify(leer)} is the root`);
  }
  pruefe(normaliseBase('/a/b') === '/a/b/', 'a two-level prefix keeps both levels');
  pruefe(gameUrl('', '/play') === '/play/', 'no query: just the prefix (with its slash)');
  pruefe(gameUrl('dungeon=steingrab-2', '/play/') === '/play/?dungeon=steingrab-2', 'a query is appended after the prefix');
  // Without Vite (this test) there is no `import.meta.env`: the reader says `/`.
  pruefe(clientBase() === '/', `the reader without Vite gives the root (${clientBase()})`);
  // The default is the reader, not a hard-coded root.
  pruefe(flightUrl() === gameUrl('offline=1&layout=editor', clientBase()), 'the default prefix is the client base');

  // No opener of the editor points at the bare root. Read from the syntax
  // tree, so the check survives prettier (quote style, line breaks) and does
  // not trip over a word in a comment.
  const dateien = (dir: URL): URL[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? dateien(new URL(`${e.name}/`, dir)) : e.name.endsWith('.ts') ? [new URL(e.name, dir)] : []
    );
  const editorDir = new URL('../src/editor/', import.meta.url);
  const quellen = dateien(editorDir);
  pruefe(quellen.length > 30, `the editor sources are found (${quellen.length} files)`);

  /** String pieces of an expression: literals and the fixed parts of a template. */
  const stuecke = (n: ts.Node): string[] => {
    const aus: string[] = [];
    const geh = (k: ts.Node): void => {
      if (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) aus.push(k.text);
      else if (ts.isTemplateHead(k) || ts.isTemplateMiddle(k) || ts.isTemplateTail(k)) aus.push(k.text);
      ts.forEachChild(k, geh);
    };
    geh(n);
    return aus;
  };
  const ruft = (n: ts.Node, namen: string[]): boolean => {
    let ja = false;
    const geh = (k: ts.Node): void => {
      if (ts.isCallExpression(k) && ts.isIdentifier(k.expression) && namen.includes(k.expression.text)) ja = true;
      ts.forEachChild(k, geh);
    };
    geh(n);
    return ja;
  };
  const WURZEL = /^\/($|\?)/; // exactly the root, or the root with a query
  const befunde: string[] = [];
  let oeffner = 0;
  for (const datei of quellen) {
    const text = readFileSync(datei, 'utf-8');
    if (!/window\.open|oeffneFlugTab|location\.href/.test(text)) continue;
    const baum = ts.createSourceFile(datei.pathname, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const name = datei.pathname.split('/src/editor/')[1];
    /**
     * What a name stands for at `von`: walk outwards from there, and in the
     * first enclosing function or block that declares it, take the initialiser
     * (or say it is a parameter). A name declared elsewhere in the file does
     * not count.
     */
    const bedeutung = (id: string, von: ts.Node): ts.Expression | 'parameter' | null => {
      for (let scope: ts.Node | undefined = von.parent; scope; scope = scope.parent) {
        if (ts.isFunctionLike(scope) && scope.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === id)) return 'parameter';
        if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
          for (const st of scope.statements) {
            if (!ts.isVariableStatement(st)) continue;
            for (const d of st.declarationList.declarations) {
              if (ts.isIdentifier(d.name) && d.name.text === id && d.initializer) return d.initializer;
            }
          }
        }
      }
      return null;
    };
    /** One address that opens the game: look at what it is made of. */
    const pruefeAdresse = (arg: ts.Expression, wo: string): void => {
      oeffner++;
      let a: ts.Expression = arg;
      if (ts.isIdentifier(arg)) {
        const b = bedeutung(arg.text, arg);
        // A parameter (oeffneFlugTab's `url`): its callers are looked at instead.
        if (b === 'parameter') return;
        if (b === null) {
          befunde.push(`${name} ${wo}: ${arg.text} is neither a parameter nor a const in scope`);
          return;
        }
        a = b;
      }
      const roh = stuecke(a).filter((st) => WURZEL.test(st));
      if (roh.length > 0) befunde.push(`${name} ${wo}: bare root ${JSON.stringify(roh)}`);
      // Whatever is not a name must be built by the one helper.
      if (!ruft(a, ['gameUrl', 'flightUrl'])) befunde.push(`${name} ${wo}: not built by gameUrl/flightUrl (${a.getText(baum).slice(0, 60)})`);
    };
    const geh = (k: ts.Node): void => {
      if (ts.isCallExpression(k) && k.arguments.length > 0) {
        const f = k.expression;
        const istOpen = ts.isPropertyAccessExpression(f) && f.name.text === 'open' && ts.isIdentifier(f.expression) && f.expression.text === 'window';
        const istFlugTab = ts.isIdentifier(f) && f.text === 'oeffneFlugTab';
        if (istOpen || istFlugTab) pruefeAdresse(k.arguments[0], `line ${baum.getLineAndCharacterOfPosition(k.getStart(baum)).line + 1}`);
      }
      // `tab.location.href = url`: an assignment to the location of another tab.
      if (ts.isBinaryExpression(k) && k.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(k.left) && k.left.name.text === 'href' && ts.isPropertyAccessExpression(k.left.expression) && k.left.expression.name.text === 'location') {
        pruefeAdresse(k.right, `line ${baum.getLineAndCharacterOfPosition(k.getStart(baum)).line + 1}`);
      }
      ts.forEachChild(k, geh);
    };
    geh(baum);
  }
  pruefe(oeffner >= 8, `the openers are found in the syntax tree (${oeffner}; window.open x5, oeffneFlugTab x2, location.href x1, minus the parameter)`);
  pruefe(befunde.length === 0, `no opener points at the bare root: ${befunde.join(' | ') || 'none'} (${oeffner} openers read)`);

  // The probe itself bites: the old forms are found (guards against a probe that sees nothing).
  const altText = [
    "window.open('/', '_blank');",
    'window.open(`${location.protocol}//${host}/`, "_blank");',
    'const ziel = `${location.protocol}//${host}/?dungeon=${id}`; window.open(ziel, "_blank");',
  ];
  for (const alt of altText) {
    const b = ts.createSourceFile('alt.ts', alt, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    pruefe(stuecke(b).some((s) => WURZEL.test(s)) && !ruft(b, ['gameUrl', 'flightUrl']), `the probe sees the old form: ${alt.slice(0, 50)}`);
  }
}

console.log(`\n${geprueft - fehler}/${geprueft} checks passed`);
if (fehler > 0) {
  console.error(`${fehler} FAILED`);
  process.exit(1);
}
