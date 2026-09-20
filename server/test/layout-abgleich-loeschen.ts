/**
 * Layout sync: an object the designer DELETED is gone, and one set again where it stood is a NEW object
 * (Editor E1, card K1.3, attack finding A-10).
 *
 * Before: a ZDO whose `layoutId` is an id that the document no longer has, standing within 0.5 m of a
 * placement of the same prefab, was "the same object with a changed id": it was kept and re-stamped onto
 * the new placement, state and all (a chest kept its contents, a tree its felling count). "Delete the chest
 * and set a chest where it stood" therefore did not delete anything.
 *
 * Now: THE ID IN THE FILE IS THE ADDRESS OF AN OBJECT; a document without ids has no stable object identity.
 * A placement takes over an existing ZDO only if that ZDO carries the OLD key (its own prefab, `@`, whole numbers:
 * `Prefab@x,z`, saves from before E1) or no `layoutId` at all -- the migration path. A ZDO with an id-shaped `layoutId` that the document no
 * longer has is ORPHANED: it is removed by the usual rules (the E0 protections stay), whatever the new placement's
 * id looks like and however near it stands. That holds for the editor's ids (derived + a random tail), for an
 * id the MCP server or a hand-written file gives in derived form or with a `-2`, and for an entry WITHOUT an id
 * (the sanitizer derives one: pushed across the rounding edge of a metre it is a new id, section 3).
 *
 * (The first version of this rule told "a name of its own" by the SHAPE of the id -- 157 of 157 entries of the
 * real world file are in derived form, so it could not; the second by a report of the sanitizer, but every write
 * path materialises the derived ids, so the report was a property of one reading, not of the document. Neither
 * is left: there is one gate, `darfUebernehmen` in `layoutAbgleich.ts`, and this file pins it alone -- sections
 * 1, 2b, 2c, 3b, 3c and 6 go red when it lets an id-shaped orphan through, 4 and 5 when it refuses what it must take.)
 *
 * LIMITS of the rule (known, not built; both follow from "the id is the address"): in a document WITHOUT ids a NEW entry in the
 * same metre that sorts before the old one takes the old derived id together with its ZDO and state (the old entry becomes
 * `-2` and spawns empty); and an entry that loses its id to a duplicate gets a derived id and hits the ZDO of that id, if there
 * is one. Write the ids into the file to avoid both (every write path of the editor and of the MCP server does). The hits
 * through the id itself do not go through the gate either (`darfUebernehmen` is the nearness search only). And when a
 * placement inherits a ZDO by nearness while an older ZDO of ANOTHER prefab still carries the same id (the `stale` branch), that
 * one stays for one boot (two ZDOs with one `layoutId`; the next boot removes it as surplus) -- not new, identical to before.
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
let gut = 0;
// The number of checks this file runs. A crash in the middle (an exception, a section that never ran) prints a plain error
// and no FAIL line -- counted as "0 FAIL" it would pass; so the end (and the exit hook) compares ok + FAIL with this number.
const SOLL = 74;
let fertig = false;
process.on('exit', () => {
  if (!fertig) console.error(`FAIL abgebrochen: nur ${gut + fehler} von ${SOLL} Prüfungen liefen`);
});
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    gut++;
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

// ── 3. A document WITHOUT ids: the derived id is the address, and it changes across the rounding edge ──
console.log('\n[3] an entry WITHOUT an id in the file, pushed across the rounding edge of a metre: a NEW id -- the old ZDO goes, a new one spawns');
{
  const alt = { id: 'piece-chest-wood_140_100', prefab: TRUHE, x: 140.4, z: 100 };
  const { uid } = ersterBoot('abgeleitet', alt);
  const b2 = starte('abgeleitet', dokument([{ prefab: TRUHE, x: 140.5, z: 100 }])); // no id: the sanitizer derives ..._141_100
  const z = alleLayoutZdos(b2.server)[0];
  const zeile = abgleich(b2.zeilen);
  check('a NEW ZDO carries the new derived id, WITHOUT the old contents', alleLayoutZdos(b2.server).length === 1 && z?.zdoid.toString() !== uid && z?.getString(LAYOUT_ID_MEMBER) === platzierungsIdBasis({ prefab: TRUHE, x: 140.5, z: 100 }) && inhalt(z!) === '', `${uid} -> ${z?.zdoid.toString()}`);
  check('... the log says 1 spawned, 1 removed (the documented consequence of a file without ids)', zahl(zeile, 'gespawnt') === 1 && zahl(zeile, 'entfernt') === 1, zeile);
}

console.log('\n[3b] the chain of attack 3 (save from before E1, file without ids, the entry pushed across the edge, a write path in between)');
{
  // A save from before E1 is migrated by the first boot: the ZDO now carries the id derived from the file; the file stays without ids.
  const alt = { prefab: TRUHE, x: 140.4, z: 100 };
  const w = 'kette';
  const { uid: uid0 } = (() => {
    const b1 = starte(w, dokument([alt]));
    const z1 = alleLayoutZdos(b1.server)[0]!;
    z1.setString(TRUHE_INHALT_MEMBER, INHALT);
    b1.server.saveWorld();
    return { uid: z1.zdoid.toString() };
  })();
  const geschrieben = (doc: Record<string, unknown>): Record<string, unknown> => gemeinsam.sanitizeWorldLayout(doc) as unknown as Record<string, unknown>; // what every write path saves: the derived ids stand in the file
  // (i) the id stands in the file BEFORE the entry is moved (a write path ran first): the move keeps the address
  const mitId = geschrieben(dokument([alt])) as { placements: Platzierung[] };
  check('(i) fixture: the write path put the derived id into the file', mitId.placements[0]?.id === 'piece-chest-wood_140_100', `${mitId.placements[0]?.id}`);
  const bi = starte(w, dokument([{ ...mitId.placements[0]!, x: 140.5 }]));
  const zi = alleLayoutZdos(bi.server)[0];
  check('(i) the id in the file, entry moved across the edge: the SAME ZDO, contents kept, 0 spawned, 0 removed', alleLayoutZdos(bi.server).length === 1 && zi?.zdoid.toString() === uid0 && inhalt(zi!) === INHALT && zahl(abgleich(bi.zeilen), 'gespawnt') === 0 && zahl(abgleich(bi.zeilen), 'entfernt') === 0, abgleich(bi.zeilen));
  // (ii) the entry is moved in the file WITHOUT an id (the id is not in the file), with and without a write path in between: the same result
  for (const [name, mitSchreibweg] of [['without a write path', false], ['with a write path in between', true]] as const) {
    const bewegt = dokument([{ ...alt, x: 140.5 }]);
    const bb = starte(w, mitSchreibweg ? geschrieben(bewegt) : bewegt);
    const zz = alleLayoutZdos(bb.server)[0];
    const zeile = abgleich(bb.zeilen);
    check(`(ii) no id in the file when it moves, ${name}: a NEW ZDO without the contents (1 spawned, 1 removed -- the documented consequence)`, alleLayoutZdos(bb.server).length === 1 && zz?.zdoid.toString() !== uid0 && inhalt(zz!) === '' && zahl(zeile, 'gespawnt') === 1 && zahl(zeile, 'entfernt') === 1, zeile);
  }
}

console.log('\n[3c] two entries near a deleted chest: an editor id and an entry without an id -- NEITHER inherits (the id order, not the document order, decides who would grab it under a leak)');
{
  const w = 'zwei-neue';
  const { uid } = ersterBoot(w, { id: ALT_ID, prefab: TRUHE, x: 100.2, z: 100 });
  // `piece-chest-wood_100_100-k3x9` sorts BEFORE the derived `piece-chest-wood_101_100` of the entry without an id
  const A = { id: `${ALT_ID}-k3x9`, prefab: TRUHE, x: 100.1, z: 100 };
  const B = { prefab: TRUHE, x: 100.5, z: 100 };
  for (const [name, reihenfolge] of [['document order A, B', [A, B]], ['document order B, A', [B, A]]] as const) {
    const b2 = starte(w, dokument([...reihenfolge]));
    const zeile = abgleich(b2.zeilen);
    const alle = alleLayoutZdos(b2.server);
    check(`${name}: two NEW empty ZDOs, the old one is gone`, alle.length === 2 && alle.every((z) => z.zdoid.toString() !== uid && inhalt(z) === ''), `${alle.map((z) => `${z.zdoid}:"${inhalt(z)}"`).join(' ')}`);
    check(`${name}: the log says 2 spawned, 1 removed`, zahl(zeile, 'gespawnt') === 2 && zahl(zeile, 'entfernt') === 1, zeile);
  }
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

console.log('\n[6] the E0 protection keeps an orphan alive (an entry the sanitizer dropped): a NEW placement beside it still does not take it over');
{
  const w = 'geschont';
  const { uid } = ersterBoot(w, ALT);
  const NEU = { id: `${ALT_ID}-k3x9`, prefab: TRUHE, x: 100.2, z: 100 };
  // the second entry is not a placement at all: the sanitizer drops it, so this boot deletes NOTHING (verworfen > 0)
  const b2 = starte(w, dokument([NEU, { unsinn: true } as unknown as Platzierung]));
  const zeile = abgleich(b2.zeilen);
  const alt = b2.server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === uid);
  const neu = layoutZdos(b2.server, NEU.id!)[0];
  check('the orphan is still alive with its id and contents (nothing is deleted in this boot)', alt !== undefined && !alt.destroyed && alt.getString(LAYOUT_ID_MEMBER) === ALT_ID && inhalt(alt) === INHALT, zeile);
  check('the new placement got its OWN empty ZDO -- it did not take the protected orphan over', neu !== undefined && neu.zdoid.toString() !== uid && inhalt(neu) === '', `${neu?.zdoid} "${neu ? inhalt(neu) : '-'}"`);
  check('the log says 1 spawned, 0 removed, and that 1 orphan stays standing', zahl(zeile, 'gespawnt') === 1 && zahl(zeile, 'entfernt') === 0 && b2.zeilen.some((z) => /ohne Löschen: 1 Einträge verworfen – 1 verwaiste Layout-Objekte bleiben/.test(z)), b2.zeilen.join(' | '));
}

console.log('\n[7] the old key is recognised by its FULL form (`prefab@x,z`); a member that is not a text counts as a name, not as "none"');
{
  const NEU = { id: 'truhe-neu-a1b2', prefab: TRUHE, x: 100.2, z: 100 };
  // (a) a forged key: it contains an `@`, but no server ever wrote `irgendwas@7,7`
  const wa = 'kennung-gefaelscht';
  const { uid: uidA } = ersterBoot(wa, ALT);
  const ba = starte(wa, dokument([ALT]));
  layoutZdos(ba.server, ALT_ID)[0]!.setString(LAYOUT_ID_MEMBER, 'irgendwas@7,7');
  ba.server.saveWorld();
  const ba2 = starte(wa, dokument([NEU]));
  const za = layoutZdos(ba2.server, NEU.id)[0];
  check('(a) `irgendwas@7,7` beside a new placement: NOT taken over -- a NEW empty ZDO, the old one gone', za !== undefined && za.zdoid.toString() !== uidA && inhalt(za) === '' && !ba2.server.zdos.getAllZDOs().some((z) => z.zdoid.toString() === uidA), abgleich(ba2.zeilen));
  check('(a) ... the log says 1 spawned, 1 removed, nothing re-stamped', zahl(abgleich(ba2.zeilen), 'gespawnt') === 1 && zahl(abgleich(ba2.zeilen), 'entfernt') === 1 && !/umgestempelt/.test(abgleich(ba2.zeilen)), abgleich(ba2.zeilen));
  // (a2) the full form, but the prefab part is another prefab than the ZDO's own: no key this server wrote for this object
  const wa2 = 'kennung-fremdes-prefab';
  const { uid: uidA2 } = ersterBoot(wa2, ALT);
  const ba3 = starte(wa2, dokument([ALT]));
  layoutZdos(ba3.server, ALT_ID)[0]!.setString(LAYOUT_ID_MEMBER, 'woodwall@100,100');
  ba3.server.saveWorld();
  const ba4 = starte(wa2, dokument([NEU]));
  const za2 = layoutZdos(ba4.server, NEU.id)[0];
  check('(a2) `woodwall@100,100` on a chest ZDO (the prefab part is not the ZDO\'s prefab): NOT taken over, a NEW empty ZDO', za2 !== undefined && za2.zdoid.toString() !== uidA2 && inhalt(za2) === '', abgleich(ba4.zeilen));
  // (a3) the own prefab, but no whole numbers after the `@`
  const wa3 = 'kennung-zahlen';
  const { uid: uidA3 } = ersterBoot(wa3, ALT);
  const ba5 = starte(wa3, dokument([ALT]));
  layoutZdos(ba5.server, ALT_ID)[0]!.setString(LAYOUT_ID_MEMBER, 'piece_chest_wood@abc,def');
  ba5.server.saveWorld();
  const ba6 = starte(wa3, dokument([NEU]));
  const za3 = layoutZdos(ba6.server, NEU.id)[0];
  check('(a3) `piece_chest_wood@abc,def` (the own prefab, but no numbers): NOT taken over, a NEW empty ZDO', za3 !== undefined && za3.zdoid.toString() !== uidA3 && inhalt(za3) === '', abgleich(ba6.zeilen));
  // (b) a `layoutId` member of the wrong type (an Int): unreadable as a text, but there -- so a name, not "no key": left alone, never inherited
  const wb = 'kennung-int';
  const { uid: uidB } = ersterBoot(wb, ALT);
  const bb = starte(wb, dokument([ALT]));
  layoutZdos(bb.server, ALT_ID)[0]!.setInt(LAYOUT_ID_MEMBER, 7);
  bb.server.saveWorld();
  const bb2 = starte(wb, dokument([NEU]));
  const zb = layoutZdos(bb2.server, NEU.id)[0];
  const alt = bb2.server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === uidB);
  check('(b) an Int `layoutId` 0.2 m beside a new placement: the new placement gets its OWN empty ZDO', zb !== undefined && zb.zdoid.toString() !== uidB && inhalt(zb) === '', `${uidB} -> ${zb?.zdoid.toString()}`);
  check('(b) ... the unreadable one is left alone, with its contents (1 spawned, 0 removed)', alt !== undefined && !alt.destroyed && inhalt(alt) === INHALT && zahl(abgleich(bb2.zeilen), 'gespawnt') === 1 && zahl(abgleich(bb2.zeilen), 'entfernt') === 0, abgleich(bb2.zeilen));
  // (c) the genuine full form of another prefab's old key is still taken over by nearness, as before
  const wc = 'kennung-echt';
  const { uid: uidC } = ersterBoot(wc, ALT);
  const bc = starte(wc, dokument([ALT]));
  layoutZdos(bc.server, ALT_ID)[0]!.setString(LAYOUT_ID_MEMBER, 'piece_chest_wood@-3,250');
  bc.server.saveWorld();
  const bc2 = starte(wc, dokument([NEU]));
  const zc = layoutZdos(bc2.server, NEU.id)[0];
  check('(c) a genuine old key (`piece_chest_wood@-3,250`: the ZDO\'s own prefab, whole numbers, negative and far from the placement): taken over by nearness, contents kept', zc !== undefined && zc.zdoid.toString() === uidC && inhalt(zc) === INHALT, `${uidC} -> ${zc?.zdoid.toString()}`);
}

rmSync(WURZEL, { recursive: true, force: true });
fertig = true;
if (gut + fehler !== SOLL) {
  console.error(`FAIL Sollzahl: ${gut + fehler} Prüfungen statt ${SOLL}`);
  fehler++;
}
console.log(fehler === 0 ? '\nall ok' : `\n${fehler} FAIL`);
process.exit(fehler === 0 ? 0 : 1);
