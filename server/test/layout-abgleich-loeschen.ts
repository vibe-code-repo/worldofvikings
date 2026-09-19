/**
 * Layout sync: an object the designer DELETED is gone, and one set again where it stood is a NEW object
 * (Editor E1, card K1.3, attack finding A-10).
 *
 * Before: a ZDO whose `layoutId` is an id that the document no longer has, standing within 0.5 m of a
 * placement of the same prefab, was "the same object with a changed id": it was kept and re-stamped onto
 * the new placement, state and all (a chest kept its contents, a tree its felling count). "Delete the chest
 * and set a chest where it stood" therefore did not delete anything.
 *
 * Now: such a ZDO (id-shaped, no `@`) is taken over only by a placement whose id the SANITIZER derived itself
 * (the entry had no id in the file: the rounding-edge case of `layout-abgleich.ts`, world 5, stays as it is;
 * the sanitizer reports these ids, `abgeleitet`). An entry whose id STANDS in the file has a name of its own --
 * however derived it looks (157 of 157 entries of the real world file carry an id in derived form) -- and
 * never takes over the ZDO of another name: the old one is orphaned and removed by the usual rules, the new one
 * is spawned empty. That holds for the editor's ids (derived + a random tail), for an id the MCP server or a
 * hand-written file gives in derived form or with a `-2`, and for any other. The old key (`Prefab@x,z`, saves
 * from before E1) and a ZDO without a `layoutId` are taken over as before.
 *
 * Every check is a real server boot on a temp world (boot 1 builds and saves, boot 2 loads that save and
 * syncs it against the changed document). Run: npx tsx test/layout-abgleich-loeschen.ts   (from server/)
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as gemeinsam from '@wov/shared';
import { LAYOUT_ID_MEMBER, TRUHE_INHALT_MEMBER, layoutKennung } from '@wov/shared';
import { createWovServer } from '../src/WovServer.js';
import type { ZDO } from '../src/zdo/ZDO.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const SEED = 'LayoutLoeschen1';
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-loeschen-'));
const TRUHE = 'piece_chest_wood';
const INHALT = '[["Holz",42,0,0]]';

type Platzierung = { id?: string; prefab: string; x: number; z: number };

function dokument(placements: Platzierung[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Loeschen',
    detailSeed: SEED,
    continents: [],
    regions: [
      { id: 'probe', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 1600 }, edgeFalloff: 200, baseLevel: 0.3, vegetation: [] },
    ],
    routes: [],
    placements,
  };
}

function starte(welt: string, doc: Record<string, unknown>) {
  const ordner = join(WURZEL, welt);
  mkdirSync(join(ordner, 'worlds'), { recursive: true });
  const layoutPfad = join(ordner, 'layout.json');
  writeFileSync(layoutPfad, JSON.stringify(doc));
  const server = createWovServer({
    port: 2471, // never bound (init() only, no start())
    worldName: 'world',
    worldSeed: SEED,
    worldFeatures: false,
    worldVegetation: false,
    worldsDir: join(ordner, 'worlds'),
    kontenDir: join(ordner, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: layoutPfad,
  });
  const zeilen: string[] = [];
  const orig = { log: console.log, warn: console.warn };
  const faenge =
    (weiter: (...a: unknown[]) => void) =>
    (...a: unknown[]): void => {
      const z = a.map(String).join(' ');
      if (z.includes('Layout-')) zeilen.push(z);
      weiter(...a);
    };
  console.log = faenge(orig.log);
  console.warn = faenge(orig.warn);
  try {
    server.init();
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
  }
  return { server, zeilen };
}
type Server = ReturnType<typeof starte>['server'];
const layoutZdos = (s: Server, id: string): ZDO[] => s.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) === id);
const alleLayoutZdos = (s: Server): ZDO[] => s.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER));
const inhalt = (z: ZDO): string => z.getString(TRUHE_INHALT_MEMBER);
const gleichListe = (name: string, ist: readonly string[] | undefined, soll: readonly string[]): void =>
  check(name, ist !== undefined && JSON.stringify([...ist].sort()) === JSON.stringify([...soll].sort()), `${JSON.stringify(ist)}`);
const abgleich = (zeilen: string[]): string => zeilen.find((z) => /Layout-Abgleich:/.test(z)) ?? '';
const zahl = (zeile: string, was: string): number => Number(new RegExp(`(\\d+) ${was}`).exec(zeile)?.[1] ?? NaN);
// Spelled out on purpose: the same file has to run against a tree from before the change and report every check.
const platzierungsIdBasis = gemeinsam.platzierungsIdBasis as (p: { prefab: string; x: number; z: number }) => string;

/** Boot 1: one chest with contents; returns the world so that boot 2 can load its save. */
function ersterBoot(welt: string, alt: Platzierung) {
  const b1 = starte(welt, dokument([alt]));
  const z1 = layoutZdos(b1.server, alt.id!)[0];
  check(`${welt}: boot 1 spawned the chest with its id`, z1 !== undefined && layoutZdos(b1.server, alt.id!).length === 1);
  z1?.setString(TRUHE_INHALT_MEMBER, INHALT);
  b1.server.saveWorld();
  return { uid: z1?.zdoid.toString(), boot: b1 };
}

// ── 0. The sanitizer says which ids it derived itself ──
console.log('\n[0] sanitizeWorldLayoutMitBericht: `abgeleitet` = the ids the sanitizer derived, not the ones that stood in the file');
{
  const bericht = (gemeinsam.sanitizeWorldLayoutMitBericht as (d: unknown) => { abgeleitet?: string[]; layout: { placements?: { id?: string }[] } } | null)(
    dokument([
      { prefab: TRUHE, x: 1, z: 1 }, // no id: derived
      { id: 'piece-chest-wood_5_5', prefab: TRUHE, x: 5, z: 5 }, // an id IN the file that looks derived: a name of its own
      { id: 'piece-chest-wood_7_7-2', prefab: TRUHE, x: 7, z: 7 }, // the `-N` form, also explicit
      { id: 'Ungültig Ü', prefab: TRUHE, x: 9, z: 9 }, // an invalid id is not kept: derived
      { id: 'doppelt', prefab: TRUHE, x: 20, z: 20 },
      { id: 'doppelt', prefab: TRUHE, x: 30, z: 30 }, // a duplicate id: the second loses it and gets a derived one
    ])
  );
  gleichListe('the ids derived by the sanitizer', bericht?.abgeleitet, ['piece-chest-wood_1_1', 'piece-chest-wood_30_30', 'piece-chest-wood_9_9']);
  check('explicit ids in derived form are NOT in the list, and are kept', !(bericht?.abgeleitet ?? []).some((i) => i === 'piece-chest-wood_5_5' || i === 'piece-chest-wood_7_7-2') && (bericht?.layout.placements ?? []).some((p) => p.id === 'piece-chest-wood_5_5'));
}

// ── 1. Delete the chest, set another one where it stood (editor id with a tail) ──
const ALT_ID = 'piece-chest-wood_100_100'; // derived form (`platzierungsIdBasis`), like every id the migration wrote into the world file
const ALT = { id: ALT_ID, prefab: TRUHE, x: 100, z: 100 };

for (const [name, abstand] of [
  ['exactly where it stood', 0],
  ['0.3 m beside it', 0.3],
  ['0.49 m beside it', 0.49],
] as const) {
  console.log(`\n[1] delete + set a chest ${name}, editor-style id (derived + letter tail)`);
  const welt = `loeschen-${abstand}`;
  const { uid } = ersterBoot(welt, ALT);
  const NEU = { id: `${ALT_ID}-k3x9`, prefab: TRUHE, x: 100 + abstand, z: 100 };
  const b2 = starte(welt, dokument([NEU]));
  const zeile = abgleich(b2.zeilen);
  console.log(`     log: ${zeile}`);
  const neu = layoutZdos(b2.server, NEU.id!);
  check(`the new chest has exactly one ZDO`, neu.length === 1, `${neu.length}`);
  check(`... a NEW one (uid ${neu[0]?.zdoid.toString()} != old ${uid})`, neu[0] !== undefined && neu[0].zdoid.toString() !== uid);
  check(`... WITHOUT the old contents`, neu[0] !== undefined && inhalt(neu[0]) === '', `"${neu[0] ? inhalt(neu[0]) : '-'}"`);
  check(`the deleted chest is gone (no ZDO with its id, its uid does not exist)`, layoutZdos(b2.server, ALT_ID).length === 0 && !b2.server.zdos.getAllZDOs().some((z) => z.zdoid.toString() === uid));
  check(`the log says 1 spawned, 1 removed`, zahl(zeile, 'gespawnt') === 1 && zahl(zeile, 'entfernt') === 1, zeile);
  check(`one layout ZDO in the world (no doubling)`, alleLayoutZdos(b2.server).length === 1, `${alleLayoutZdos(b2.server).length}`);
  // boot 3 on the same document: stable
  b2.server.saveWorld();
  const b3 = starte(welt, dokument([NEU]));
  check(`boot 3 (same document): 0 spawned, 0 removed, the new chest keeps its ZDO`, zahl(abgleich(b3.zeilen), 'gespawnt') === 0 && zahl(abgleich(b3.zeilen), 'entfernt') === 0 && layoutZdos(b3.server, NEU.id!)[0]?.zdoid.toString() === neu[0]?.zdoid.toString());
}

// ── 2. The same with another prefab at that place (unchanged behaviour) ──
console.log('\n[2] a chest deleted, another prefab set where it stood');
{
  const { uid } = ersterBoot('anderes-prefab', ALT);
  const b2 = starte('anderes-prefab', dokument([{ id: 'wand-neu-a1b2', prefab: 'woodwall', x: 100, z: 100 }]));
  check('the chest is removed, the wall is a new ZDO', !b2.server.zdos.getAllZDOs().some((z) => z.zdoid.toString() === uid) && layoutZdos(b2.server, 'wand-neu-a1b2').length === 1, abgleich(b2.zeilen));
}

// ── 2b. An id the MCP server or a hand-written file gives, in derived form: still a NEW object ──
for (const [name, altId, neuId] of [
  ['the plain derived form after a delete (MCP placement_set with an explicit id)', `${ALT_ID}-k3x9`, ALT_ID],
  ['the counter form `-2`', ALT_ID, `${ALT_ID}-2`],
  ['the counter form `-7`', `${ALT_ID}-k3x9`, `${ALT_ID}-7`],
] as const) {
  console.log(`\n[2b] delete + set a chest with an EXPLICIT id in derived form: ${name}`);
  const welt = `explizit-${neuId}`;
  const { uid } = ersterBoot(welt, { id: altId, prefab: TRUHE, x: 100, z: 100 });
  const b2 = starte(welt, dokument([{ id: neuId, prefab: TRUHE, x: 100.3, z: 100 }]));
  const zeile = abgleich(b2.zeilen);
  const neu = layoutZdos(b2.server, neuId);
  check('a NEW ZDO, WITHOUT the old contents, the old one is gone', neu.length === 1 && neu[0]!.zdoid.toString() !== uid && inhalt(neu[0]!) === '' && !b2.server.zdos.getAllZDOs().some((z) => z.zdoid.toString() === uid), `${uid} -> ${neu[0]?.zdoid.toString()}, "${neu[0] ? inhalt(neu[0]) : '-'}"`);
  check('the log says 1 spawned, 1 removed, 0 re-stamped', zahl(zeile, 'gespawnt') === 1 && zahl(zeile, 'entfernt') === 1 && !/umgestempelt/.test(zeile), zeile);
}

console.log('\n[2c] two chests in one metre, one of them deleted, an editor chest set where it stood: the other keeps its ZDO and contents');
{
  const welt = 'zwei-truhen';
  const X = { id: ALT_ID, prefab: TRUHE, x: 100.4, z: 100 };
  const Y = { id: `${ALT_ID}-2`, prefab: TRUHE, x: 100.1, z: 100 };
  const b1 = starte(welt, dokument([X, Y]));
  const zx = layoutZdos(b1.server, X.id)[0]!;
  const zy = layoutZdos(b1.server, Y.id)[0]!;
  zx.setString(TRUHE_INHALT_MEMBER, '[["Holz",1,0,0]]');
  zy.setString(TRUHE_INHALT_MEMBER, '[["Stein",2,0,0]]');
  const uidX = zx.zdoid.toString();
  const uidY = zy.zdoid.toString();
  b1.server.saveWorld();
  const Z = { id: `${ALT_ID}-n000`, prefab: TRUHE, x: 100.4, z: 100 };
  const b2 = starte(welt, dokument([Y, Z]));
  const y2 = layoutZdos(b2.server, Y.id)[0];
  const z2 = layoutZdos(b2.server, Z.id)[0];
  check('Y (kept): same ZDO, own contents', y2?.zdoid.toString() === uidY && y2 !== undefined && inhalt(y2) === '[["Stein",2,0,0]]');
  check('X (deleted) is gone; Z is a NEW empty ZDO (not X and not Y)', z2 !== undefined && ![uidX, uidY].includes(z2.zdoid.toString()) && inhalt(z2) === '' && !b2.server.zdos.getAllZDOs().some((z) => z.zdoid.toString() === uidX), abgleich(b2.zeilen));
  check('two layout ZDOs, log 1 spawned, 1 removed', alleLayoutZdos(b2.server).length === 2 && zahl(abgleich(b2.zeilen), 'gespawnt') === 1 && zahl(abgleich(b2.zeilen), 'entfernt') === 1, abgleich(b2.zeilen));
}

// ── 3. What still takes over (pinned) ──
console.log('\n[3] an entry WITHOUT an id in the file (the sanitizer derives it) pushed across the rounding edge keeps the ZDO -- pinned, world 5 of layout-abgleich.ts');
{
  const alt = { id: 'piece-chest-wood_140_100', prefab: TRUHE, x: 140.4, z: 100 };
  const { uid } = ersterBoot('abgeleitet', alt);
  const b2 = starte('abgeleitet', dokument([{ prefab: TRUHE, x: 140.5, z: 100 }])); // no id: the sanitizer derives ..._141_100
  const z = alleLayoutZdos(b2.server)[0];
  check('same ZDO, contents kept (the entry has no name of its own)', alleLayoutZdos(b2.server).length === 1 && z?.zdoid.toString() === uid && inhalt(z!) === INHALT, `${uid} -> ${z?.zdoid.toString()}`);
  check('... and it carries the new derived id', z?.getString(LAYOUT_ID_MEMBER) === platzierungsIdBasis({ prefab: TRUHE, x: 140.5, z: 100 }));
}

console.log('\n[4] a save from before E1 (old key `Prefab@x,z`): taken over as before, also by a placement with an explicit id');
{
  const alt = { id: ALT_ID, prefab: TRUHE, x: 100, z: 100 };
  const { uid } = ersterBoot('alte-kennung', alt);
  // Turn the save into one from before E1: the ZDO carries the OLD key.
  const b1 = starte('alte-kennung', dokument([alt]));
  const z1 = layoutZdos(b1.server, ALT_ID)[0]!;
  z1.setString(LAYOUT_ID_MEMBER, layoutKennung(alt));
  b1.server.saveWorld();
  // (a) the placement stands where the old key says: taken over through the old key
  const NEU = { id: 'truhe-mit-eigenem-namen', prefab: TRUHE, x: 100, z: 100 };
  const b2 = starte('alte-kennung', dokument([NEU]));
  const z2 = layoutZdos(b2.server, NEU.id)[0];
  check('(a) the explicit-id placement at the old spot takes the ZDO, contents kept', z2 !== undefined && z2.zdoid.toString() === uid && inhalt(z2) === INHALT, `${uid} -> ${z2?.zdoid.toString()}`);
  check('(a) log: 1 re-stamped, 0 spawned, 0 removed', /1 auf die Platzierungs-id umgestempelt|umgestempelt/.test(abgleich(b2.zeilen)) && zahl(abgleich(b2.zeilen), 'gespawnt') === 0 && zahl(abgleich(b2.zeilen), 'entfernt') === 0, abgleich(b2.zeilen));
  // (b) the placement stands 0.15 m from the ZDO but rounds to ANOTHER old key (100.45 -> `@100,100`, 100.6 -> `@101,100`):
  //     no old key fits, the ZDO is found by nearness, as before
  const alt2 = { id: ALT_ID, prefab: TRUHE, x: 100.45, z: 100 };
  const w = 'alte-kennung-nah';
  const uidB = ersterBoot(w, alt2).uid;
  const bx = starte(w, dokument([alt2]));
  layoutZdos(bx.server, ALT_ID)[0]!.setString(LAYOUT_ID_MEMBER, layoutKennung(alt2));
  bx.server.saveWorld();
  check('(b) fixture: the old key and the new placement round to different keys', layoutKennung(alt2) !== layoutKennung({ ...NEU, x: 100.6 }), `${layoutKennung(alt2)} vs ${layoutKennung({ ...NEU, x: 100.6 })}`);
  const b3 = starte(w, dokument([{ ...NEU, x: 100.6 }]));
  const z3 = layoutZdos(b3.server, NEU.id)[0];
  check('(b) another old key, 0.15 m away: the ZDO with the old key is found by nearness, contents kept', z3 !== undefined && z3.zdoid.toString() === uidB && inhalt(z3) === INHALT, `${uidB} -> ${z3?.zdoid.toString()}`);
}

console.log('\n[5] a ZDO WITHOUT a layoutId (no origin) beside a new explicit-id placement: taken over as before');
{
  const w = 'ohne-kennung';
  const { uid } = ersterBoot(w, ALT);
  const b = starte(w, dokument([ALT]));
  const z = layoutZdos(b.server, ALT_ID)[0]!;
  z.removeMember(gemeinsam.getStableHash(LAYOUT_ID_MEMBER));
  b.server.saveWorld();
  const NEU = { id: `${ALT_ID}-k3x9`, prefab: TRUHE, x: 100.2, z: 100 };
  const b2 = starte(w, dokument([NEU]));
  const z2 = layoutZdos(b2.server, NEU.id!)[0];
  check('same ZDO, contents kept', z2 !== undefined && z2.zdoid.toString() === uid && inhalt(z2) === INHALT, `${uid} -> ${z2?.zdoid.toString()}`);
}

rmSync(WURZEL, { recursive: true, force: true });
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
