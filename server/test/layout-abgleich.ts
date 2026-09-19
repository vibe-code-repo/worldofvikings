/**
 * Layout sync in place: a document edit (rotation, scale, small shift, raised
 * ground) must reach the ZDOs of a world that was SAVED and is booted again.
 *
 * Every check runs against a real server boot: boot 1 builds the world and
 * saves, the document changes, boot 2 loads that saved ZDO state and syncs it
 * against the new document. The world directory is a fresh temp directory,
 * never server/data/worlds.
 *
 * World 1 (five placements): (a) yaw, (b) scale, (c) small shift keeps the ZDO
 * id, (d) raised ground lifts layout objects but not player-built pieces,
 * (e) a route NPC keeps the position it had when it was saved. Boot 3 boots
 * the SAME document again and proves that nothing is rewritten (revisions
 * unchanged); boot 4 drops a scale and proves the member goes away.
 *
 * World 3 (wandering NPC, server-held object): the sync stamp. (i) an NPC that
 * wandered away while the document is unchanged stays where it is and keeps its
 * wander anchor, (j) an NPC whose placement the designer moved goes there
 * TOGETHER WITH its anchor, (k) an object the server holds 3 m above the ground
 * stays there (unchanged document; and even when the ground changes), (l) a state
 * without stamps (a save written before the stamp) does not teleport a wandering
 * creature and aligns a static object once.
 *
 * World 4: a player piece that still carries a layout id (state left by the
 * previous sync) loses it -- exactly ONE ZDO keeps the id; a new placement right
 * above a player piece warns; a document without placements removes every
 * orphaned layout ZDO. World 5: a placement pushed across the rounding edge of
 * the id (140.4 -> 140.5) keeps its ZDO. World 6: the real world document
 * (a copy of server/data/welten/dev.json) boots twice and moves no revision.
 *
 * World 7: `placements` of the wrong type (null, object, text, number) in the
 * raw document removes NOTHING and warns; only a missing field or an empty array
 * means "no placements" and clears the orphans. World 8: several ZDOs that
 * carry one id are cut down to ONE (the nearest, stamped one), and a placement
 * with an unknown prefab leaves its ZDO alone and warns. World 9: a player
 * piece is recognised whatever the member type of `spieler` is.
 *
 * World 10: a `placements` array whose entries the sanitizer ALL drops is not
 * "empty on purpose" either (nothing touched, warning). When only some are
 * dropped, or a placement names a prefab the registry does not know, this boot
 * deletes NOTHING (one rule for both) -- it still updates, stamps, spawns and
 * frees player pieces; the next clean document then clears as usual (worlds 10,
 * 11, and the dev.json copy in world 6). World 12: when no ZDO of an id fits the
 * prefab, the new one is spawned and the stale ones go in the SAME boot. World 13:
 * among duplicates at the same distance the ZDO with more state stays (a full chest
 * beats an empty one), in either save order, and every destroyed one is logged.
 * The early return for an unreadable `placements` still frees player pieces of a
 * stale id (world 7).
 *
 * World 2: (f) two placements with exactly the same prefab and position stay
 * ONE ZDO (pinned here, the decision belongs to a later card), (g) a player
 * piece of the same prefab next to a NEW placement is never adopted, (h) a
 * hand-placed piece of vegetation keeps the ground offset the load-time
 * re-seating uses (no flipping between ground and ground + offset). Only the
 * twelve environment-sm-env-* prefabs have an offset != 0; no vegetation
 * placement of dev.json is one of them, so (h) is a guard for the future.
 *
 * Round 4: an UNKNOWN prefab (typo in the free-text field of the editor) no longer
 * freezes the clean-up of the whole world: only ZDOs that could belong to it (same
 * id, or within 1 m of it) are spared, everything else is cleared as usual
 * (world 6b: dev.json copy with a typo + 10 deleted placements; world 14: typo +
 * a 0.6 m shift). Entries the sanitizer DROPS still switch deletion off for the
 * boot, and the warning counts the objects left standing. Placements with one id
 * that are more than 1 cm apart are different objects and keep one ZDO each (world
 * 15). "More state" uses the real state members (`truheInhalt`, `looted`, `health`,
 * door `state`); `scaleScalar` and `anim` do not count (world 13).
 *
 * Run: npx tsx test/layout-abgleich.ts   (from server/)
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOLIAGE, LAYOUT_ID_MEMBER, getStableHash, layoutKennung } from '@wov/shared';
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
const nahe = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const HIER = dirname(fileURLToPath(import.meta.url));
// Spelled out on purpose (not imported): the same file has to run against an older tree.
const LAYOUT_SOLL_MEMBER = 'layoutSoll';

const SEED = 'LayoutAbgleich1';
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-layout-abgleich-'));

type Platzierung = { prefab: string; x: number; z: number; yaw?: number; scale?: number; route?: string };

/** The test island. `baseLevel` is what the ground test turns. */
function dokument(baseLevel: number, placements: Platzierung[]): Record<string, unknown> {
  return {
    version: 1,
    name: 'Layout-Abgleich',
    detailSeed: SEED,
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel,
        vegetation: [],
      },
    ],
    routes: [{ id: 'runde', points: [[180, 100], [200, 100]], mode: 'pingpong', speed: 1 }],
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
  // The boot log lines of the sync (and its warnings) are part of the evidence.
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

const nachKennung = (server: Server, k: string): ZDO[] =>
  server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) === k);
const eines = (server: Server, p: { prefab: string; x: number; z: number }): ZDO | undefined =>
  nachKennung(server, layoutKennung(p))[0];
/** Rotation about the vertical axis in degrees. */
const yawGrad = (z: ZDO): number => (2 * Math.atan2(z.rotation.y, z.rotation.w) * 180) / Math.PI;
/** Wander anchor of a creature the SpawnSystem simulates (private state, read for the test). */
const heimat = (server: Server, id: string): { x: number; y: number; z: number } | undefined =>
  (server.spawns as unknown as { creatures: Map<string, { home: { x: number; y: number; z: number } }> }).creatures.get(id)?.home;
const layoutRevisionen = (server: Server): Map<string, number> =>
  new Map(server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER)).map((z) => [z.zdoid.toString(), z.revision.raw]));
const winkelDiff = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);

// ── World 1 ─────────────────────────────────────────────────────────
const P1 = { prefab: 'woodwall', x: 100, z: 100 };
const P2 = { prefab: 'piece_workbench', x: 120, z: 100 };
const P3 = { prefab: 'stone_wall_2x1', x: 140, z: 100 };
const P4 = { prefab: 'piece_chest_wood', x: 160, z: 100 };
const P5 = { prefab: 'NPC_1', x: 180, z: 100, route: 'runde' };
const BASIS_VORHER = 0.3;
const BASIS_NACHHER = 0.32;

console.log('\n[1] Boot 1: build the world, mutate, save');
const doc1 = dokument(BASIS_VORHER, [P1, P2, P3, P4, P5]);
const boot1 = starte('welt1', doc1);
const s1 = boot1.server;
const idP1 = eines(s1, P1)?.zdoid.toString();
const idP3 = eines(s1, P3)?.zdoid.toString();
const p4a = eines(s1, P4)!;
const npcA = eines(s1, P5)!;
check('boot 1: five layout ZDOs spawned', s1.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER)).length === 5);

const bodenP4Vorher = s1.getGroundHeight(P4.x, P4.z);
check('boot 1: P4 stands on the ground', nahe(p4a.position.y, bodenP4Vorher, 1e-6), `y=${p4a.position.y} ground=${bodenP4Vorher}`);
// A player-built piece at the same spot (different prefab) — must never move.
const spielerA = s1.zdos.createZDO(s1.prefabs.getByName('wood_wall_roof')!.hash, {
  x: P4.x,
  y: bodenP4Vorher,
  z: P4.z,
});
spielerA.setInt('spieler', 1);
const spielerId = spielerA.zdoid.toString();
const spielerYVorher = spielerA.position.y;
// A player-built piece that an older server adopted by proximity: it still
// carries the layout id of a placement the designer has since deleted.
const FOSSIL = { prefab: 'woodwall', x: 500, z: 100 };
const fossil = s1.zdos.createZDO(s1.prefabs.getByName(FOSSIL.prefab)!.hash, {
  x: FOSSIL.x,
  y: s1.getGroundHeight(FOSSIL.x, FOSSIL.z),
  z: FOSSIL.z,
});
fossil.setInt('spieler', 1);
fossil.setString(LAYOUT_ID_MEMBER, layoutKennung(FOSSIL));
const fossilId = fossil.zdoid.toString();
const fossilYVorher = fossil.position.y;
// The route NPC is somewhere in the middle of its round when the server stops.
const npcMitte = { x: 190, y: s1.getGroundHeight(190, 100), z: 100 };
s1.zdos.updateZDOZone(npcA, npcMitte);
const npcId = npcA.zdoid.toString();
s1.saveWorld();

console.log('\n[2] Boot 2: document changed (yaw, scale, shift, raised ground)');
const doc2 = dokument(BASIS_NACHHER, [
  { ...P1, yaw: Math.PI / 2 },
  { ...P2, scale: 2 },
  { ...P3, x: 140.3 },
  P4,
  P5,
]);
const boot2 = starte('welt1', doc2);
const s2 = boot2.server;
console.log(`     log: ${boot2.zeilen.join(' | ')}`);

const z1 = eines(s2, P1)!;
check('(a) yaw 0 -> pi/2: rotation is 90 deg +-0.01', winkelDiff(yawGrad(z1), 90) <= 0.01, `yaw=${yawGrad(z1).toFixed(4)} deg`);
check('(a) same ZDO id', z1.zdoid.toString() === idP1);

const z2 = eines(s2, P2)!;
check('(b) scale 1 -> 2: scaleScalar = 2', nahe(z2.getFloat('scaleScalar', 0), 2, 1e-6), `scaleScalar=${z2.getFloat('scaleScalar', 0)}`);

const z3 = eines(s2, P3)!; // same rounded key: round(140.3) = 140
check('(c) shift +0.3 m: x within 1 mm', nahe(z3.position.x, 140.3, 1e-3), `x=${z3.position.x}`);
check('(c) shift: z untouched within 1 mm', nahe(z3.position.z, 100, 1e-3), `z=${z3.position.z}`);
check('(c) shift keeps the ZDO id', z3.zdoid.toString() === idP3, `${idP3} -> ${z3.zdoid.toString()}`);

const bodenP4Nachher = s2.getGroundHeight(P4.x, P4.z);
const aenderung = bodenP4Nachher - bodenP4Vorher;
check('(d) the ground really rose (>= 0.5 m, else the check proves nothing)', aenderung >= 0.5, `${bodenP4Vorher.toFixed(3)} -> ${bodenP4Nachher.toFixed(3)} = +${aenderung.toFixed(3)}`);
const z4 = eines(s2, P4)!;
check('(d) layout object follows the ground: dy = ground change +-0.05', nahe(z4.position.y - bodenP4Vorher, aenderung, 0.05), `dy=${(z4.position.y - bodenP4Vorher).toFixed(3)} ground change=${aenderung.toFixed(3)}`);
const spielerB = s2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === spielerId)!;
check('(d) player piece (spieler=1) keeps its y', spielerB !== undefined && nahe(spielerB.position.y, spielerYVorher, 1e-9), `y=${spielerB?.position.y} was ${spielerYVorher}`);

const fossilB = s2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === fossilId);
check('(d) player piece with a stale layout id is not removed', fossilB !== undefined);
check('(d) ... and the stale layout id is taken off it', fossilB !== undefined && fossilB.getString(LAYOUT_ID_MEMBER) === '', `layoutId='${fossilB?.getString(LAYOUT_ID_MEMBER)}'`);
check(
  '(d) ... and keeps its y although the ground under it rose',
  fossilB !== undefined && nahe(fossilB.position.y, fossilYVorher, 1e-9),
  `y=${fossilB?.position.y} was ${fossilYVorher}, ground now ${s2.getGroundHeight(FOSSIL.x, FOSSIL.z).toFixed(3)}`
);

const npcB = eines(s2, P5)!;
check('(e) route NPC: same ZDO, only one NPC', npcB.zdoid.toString() === npcId && s2.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) === layoutKennung(P5)).length === 1);
check(
  '(e) route NPC keeps its saved position',
  nahe(npcB.position.x, npcMitte.x, 1e-6) && nahe(npcB.position.y, npcMitte.y, 1e-6) && nahe(npcB.position.z, npcMitte.z, 1e-6),
  `(${npcB.position.x}, ${npcB.position.y}, ${npcB.position.z}) saved (${npcMitte.x}, ${npcMitte.y}, ${npcMitte.z})`
);
check('(e) route NPC is registered with the runner', (s2.routen?.npcCount ?? 0) === 1, `${s2.routen?.npcCount}`);
check('the boot logged the sync counts', boot2.zeilen.some((z) => /aktualisiert/.test(z)), boot2.zeilen.join(' | '));
s2.saveWorld();
const revNachBoot2 = new Map(s2.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER)).map((z) => [z.zdoid.toString(), z.revision.raw]));

console.log('\n[3] Boot 3: the SAME document again -> nothing is rewritten');
const boot3 = starte('welt1', doc2);
const s3 = boot3.server;
console.log(`     log: ${boot3.zeilen.join(' | ')}`);
const geaendert = s3.zdos
  .getAllZDOs()
  .filter((z) => z.getString(LAYOUT_ID_MEMBER))
  .filter((z) => revNachBoot2.get(z.zdoid.toString()) !== z.revision.raw);
check('unchanged document: no layout ZDO revision moved', geaendert.length === 0, `${geaendert.length} of ${revNachBoot2.size} moved`);
check('unchanged document: log says 0 aktualisiert', boot3.zeilen.some((z) => /\b0 aktualisiert/.test(z)), boot3.zeilen.join(' | '));
s3.saveWorld();

console.log('\n[4] Boot 4: scale back to 1 -> the scale member goes away');
const doc4 = dokument(BASIS_NACHHER, [{ ...P1, yaw: Math.PI / 2 }, { ...P2 }, { ...P3, x: 140.3 }, P4, P5]);
const s4 = starte('welt1', doc4).server;
const z2b = eines(s4, P2)!;
check('scale 2 -> 1: scaleScalar member removed', !z2b.hasMember(getStableHash('scaleScalar')), `scaleScalar=${z2b.getFloat('scaleScalar', 0)}`);

// ── World 2 ─────────────────────────────────────────────────────────
console.log('\n[5] World 2: two identical placements; a player piece next to a new placement');
const D1 = { prefab: 'wood_wall_roof', x: 220, z: 100 };
const NEU = { prefab: 'woodwall', x: 300, z: 100 };
const BAUM = { prefab: 'environment-sm-env-rock-cliff-02-1', x: 260, z: 100 };
// A vegetation prefab that dev.json really uses (ground offset 0).
const TREE = { prefab: 'Eiche2', x: 280, z: 100 };
const w1 = starte('welt2', dokument(BASIS_VORHER, [D1, { ...D1 }, BAUM, TREE])).server;
const baumOffset = FOLIAGE.find((f) => f.prefabHash === w1.prefabs.getByName(BAUM.prefab)?.hash)?.groundOffset ?? 0;
const baum1 = eines(w1, BAUM)!;
const baumY1 = baum1.position.y;
const baumRev1 = baum1.revision.raw;
check('(h) vegetation prefab has a ground offset (else the check proves nothing)', baumOffset !== 0, `${baumOffset}`);
check('(h) spawned at ground + offset', nahe(baumY1, w1.getGroundHeight(BAUM.x, BAUM.z) + baumOffset, 1e-6), `y=${baumY1} ground=${w1.getGroundHeight(BAUM.x, BAUM.z)} offset=${baumOffset}`);
const treeA = eines(w1, TREE)!;
const treeY1 = treeA.position.y;
const treeRev1 = treeA.revision.raw;
check('(h2) dev.json vegetation prefab: spawned exactly on the ground (offset 0)', nahe(treeY1, w1.getGroundHeight(TREE.x, TREE.z), 1e-6), `y=${treeY1} ground=${w1.getGroundHeight(TREE.x, TREE.z)}`);
const anzahl1 = nachKennung(w1, layoutKennung(D1)).length;
const spielerNah = w1.zdos.createZDO(w1.prefabs.getByName(NEU.prefab)!.hash, { x: 300.1, y: w1.getGroundHeight(300.1, 100), z: 100 });
spielerNah.setInt('spieler', 1);
const spielerNahId = spielerNah.zdoid.toString();
const spielerNahPos = { ...spielerNah.position };
w1.saveWorld();
const boot2w = starte('welt2', dokument(BASIS_VORHER, [D1, { ...D1 }, BAUM, TREE, NEU]));
const w2 = boot2w.server;
const baum2 = eines(w2, BAUM)!;
check('(h) after a reboot: same y, same revision', nahe(baum2.position.y, baumY1, 1e-6) && baum2.revision.raw === baumRev1, `y=${baum2.position.y} was ${baumY1}, rev ${baum2.revision.raw} was ${baumRev1}`);
check('(g) a new placement right above a player piece logs a warning', boot2w.zeilen.some((z) => z.includes(layoutKennung(NEU)) && /Spielerbau/.test(z)), boot2w.zeilen.join(' | '));
const tree2 = eines(w2, TREE)!;
check('(h2) ... and after a reboot: same y, same revision', nahe(tree2.position.y, treeY1, 1e-6) && tree2.revision.raw === treeRev1, `y=${tree2.position.y} was ${treeY1}, rev ${tree2.revision.raw} was ${treeRev1}`);
const anzahl2 = nachKennung(w2, layoutKennung(D1)).length;
check('(f) two identical placements: ONE ZDO before and after (pinned)', anzahl1 === 1 && anzahl2 === 1, `${anzahl1} -> ${anzahl2}`);
const nah2 = w2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === spielerNahId)!;
check('(g) player piece next to a new placement is not adopted', nah2 !== undefined && nah2.getString(LAYOUT_ID_MEMBER) === '');
check('(g) player piece did not move', nah2 !== undefined && nahe(nah2.position.x, spielerNahPos.x, 1e-9) && nahe(nah2.position.y, spielerNahPos.y, 1e-9));
check('(g) the new placement got its own ZDO', nachKennung(w2, layoutKennung(NEU)).length === 1 && nachKennung(w2, layoutKennung(NEU))[0]!.zdoid.toString() !== spielerNahId);

// ── World 3: the sync stamp ─────────────────────────────────────────
console.log('\n[6] World 3, boot 1: a wandering NPC, an object the server holds 3 m up, a static one');
const W1 = { prefab: 'NPC_1', x: 180, z: 100 }; // no route: the SpawnSystem lets it wander
const H1 = { prefab: 'woodwall', x: 200, z: 100 };
const S1 = { prefab: 'piece_chest_wood', x: 220, z: 100 };
const boot3a = starte('welt3', dokument(BASIS_VORHER, [W1, H1, S1]));
const t1 = boot3a.server;
const wesenA = eines(t1, W1)!;
const heldA = eines(t1, H1)!;
const staticA = eines(t1, S1)!;
const wesenId = wesenA.zdoid.toString();
const heldId = heldA.zdoid.toString();
const staticId = staticA.zdoid.toString();
check('(stamp) every layout ZDO carries the sync stamp after the first boot', [wesenA, heldA, staticA].every((z) => z.getString(LAYOUT_SOLL_MEMBER) !== ''), wesenA.getString(LAYOUT_SOLL_MEMBER));
// The creature has wandered 7 m; the server holds the wall 3 m above the ground.
const wandert = { x: 186.5, y: t1.getGroundHeight(186.5, 103.5), z: 103.5 };
t1.zdos.updateZDOZone(wesenA, wandert);
const gehalten = { x: H1.x, y: heldA.position.y + 3, z: H1.z };
t1.zdos.updateZDOZone(heldA, gehalten);
t1.saveWorld();
const dok3 = dokument(BASIS_VORHER, [W1, H1, S1]);

console.log('\n[7] World 3, boot 2: document unchanged -> nothing of the server state is reset');
const boot3b = starte('welt3', dok3);
const t2 = boot3b.server;
console.log(`     log: ${boot3b.zeilen.join(' | ')}`);
const wesenB = t2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === wesenId)!;
const heimatB = heimat(t2, wesenId);
check(
  '(i) wandered NPC keeps its position (document unchanged)',
  nahe(wesenB.position.x, wandert.x, 1e-6) && nahe(wesenB.position.y, wandert.y, 1e-6) && nahe(wesenB.position.z, wandert.z, 1e-6),
  `(${wesenB.position.x}, ${wesenB.position.y}, ${wesenB.position.z}) wandered to (${wandert.x}, ${wandert.y}, ${wandert.z})`
);
check(
  '(i) ... and its wander anchor is where it was saved (no offset)',
  heimatB !== undefined && Math.hypot(heimatB.x - wesenB.position.x, heimatB.z - wesenB.position.z) <= 0.01,
  heimatB ? `anchor (${heimatB.x}, ${heimatB.z}) offset ${Math.hypot(heimatB.x - wesenB.position.x, heimatB.z - wesenB.position.z).toFixed(3)} m` : 'no anchor (NPC not simulated)'
);
const heldB = t2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === heldId)!;
check('(k) an object the server holds 3 m up stays there (document and ground unchanged)', nahe(heldB.position.y, gehalten.y, 1e-9), `y=${heldB.position.y} held at ${gehalten.y}`);
check('(k) the boot logged 0 aktualisiert', boot3b.zeilen.some((z) => /\b0 aktualisiert/.test(z)), boot3b.zeilen.join(' | '));
t2.saveWorld();

console.log('\n[8] World 3, boot 3: NPC placement moved 0.4 m and the ground rose');
const W1neu = { ...W1, x: 180.4 }; // same id key: round(180.4) = 180
const boot3c = starte('welt3', dokument(BASIS_NACHHER, [W1neu, H1, S1]));
const t3 = boot3c.server;
console.log(`     log: ${boot3c.zeilen.join(' | ')}`);
const wesenC = t3.zdos.getAllZDOs().find((z) => z.zdoid.toString() === wesenId)!;
const heimatC = heimat(t3, wesenId);
check(
  '(j) NPC moved to the new placement position, same ZDO',
  wesenC !== undefined && nahe(wesenC.position.x, 180.4, 1e-3) && nahe(wesenC.position.z, 100, 1e-3) && nahe(wesenC.position.y, t3.getGroundHeight(180.4, 100), 0.05),
  `(${wesenC?.position.x}, ${wesenC?.position.y}, ${wesenC?.position.z})`
);
check(
  '(j) ... and its wander anchor moved with it (offset 0 +-0.01 m)',
  heimatC !== undefined && wesenC !== undefined && Math.hypot(heimatC.x - wesenC.position.x, heimatC.z - wesenC.position.z) <= 0.01 && nahe(heimatC.y, wesenC.position.y, 0.01),
  heimatC && wesenC ? `anchor (${heimatC.x}, ${heimatC.y}, ${heimatC.z}) NPC (${wesenC.position.x}, ${wesenC.position.y}, ${wesenC.position.z})` : 'no anchor'
);
const bodenH = t3.getGroundHeight(H1.x, H1.z);
const heldC = t3.zdos.getAllZDOs().find((z) => z.zdoid.toString() === heldId)!;
check('(k) the ground under the held object rose (else the check proves nothing)', bodenH - gehalten.y + 3 >= 0.5, `ground now ${bodenH.toFixed(3)}, was ${(gehalten.y - 3).toFixed(3)}`);
check('(k) ... the held object still stays where the server put it (not on the stamped height)', nahe(heldC.position.y, gehalten.y, 1e-9), `y=${heldC.position.y} held at ${gehalten.y}`);
const staticC = t3.zdos.getAllZDOs().find((z) => z.zdoid.toString() === staticId)!;
check('the static object follows the ground', nahe(staticC.position.y, t3.getGroundHeight(S1.x, S1.z), 1e-6), `y=${staticC.position.y} ground=${t3.getGroundHeight(S1.x, S1.z)}`);
// Simulate a save written before the stamp existed: strip the stamps, let the NPC wander again.
const wandert2 = { x: 184, y: t3.getGroundHeight(184, 102), z: 102 };
t3.zdos.updateZDOZone(wesenC, wandert2);
const yawWesenVorher = yawGrad(wesenC);
for (const z of t3.zdos.getAllZDOs()) if (z.getString(LAYOUT_ID_MEMBER)) z.removeMember(getStableHash(LAYOUT_SOLL_MEMBER));
t3.saveWorld();

console.log('\n[9] World 3, boot 4: a state WITHOUT stamps (save from before the stamp), yaw changed');
const boot3d = starte('welt3', dokument(BASIS_NACHHER, [{ ...W1neu, yaw: 1 }, H1, { ...S1, yaw: 1 }]));
const t4 = boot3d.server;
console.log(`     log: ${boot3d.zeilen.join(' | ')}`);
const wesenD = t4.zdos.getAllZDOs().find((z) => z.zdoid.toString() === wesenId)!;
check('(l) legacy wandering NPC is not teleported', nahe(wesenD.position.x, wandert2.x, 1e-6) && nahe(wesenD.position.z, wandert2.z, 1e-6), `(${wesenD.position.x}, ${wesenD.position.z}) wandered to (${wandert2.x}, ${wandert2.z})`);
check('(l) ... and its yaw is not rewritten', winkelDiff(yawGrad(wesenD), yawWesenVorher) <= 0.01, `yaw=${yawGrad(wesenD).toFixed(3)} was ${yawWesenVorher.toFixed(3)}`);
check('(l) ... but it is stamped now', wesenD.getString(LAYOUT_SOLL_MEMBER) !== '', wesenD.getString(LAYOUT_SOLL_MEMBER));
const staticD = t4.zdos.getAllZDOs().find((z) => z.zdoid.toString() === staticId)!;
check('(l) legacy static object: aligned once (yaw 1 rad) and stamped', winkelDiff(yawGrad(staticD), (1 * 180) / Math.PI) <= 0.01 && staticD.getString(LAYOUT_SOLL_MEMBER) !== '', `yaw=${yawGrad(staticD).toFixed(3)} deg, stamp='${staticD.getString(LAYOUT_SOLL_MEMBER)}'`);
const heldD = t4.zdos.getAllZDOs().find((z) => z.zdoid.toString() === heldId)!;
check('(l) legacy static object held 3 m up: aligned once to the ground (as before the stamp)', nahe(heldD.position.y, t4.getGroundHeight(H1.x, H1.z), 1e-6), `y=${heldD.position.y} ground=${t4.getGroundHeight(H1.x, H1.z)}`);

// ── World 4: player pieces and empty documents ──────────────────────
console.log('\n[10] World 4: a player piece that still carries a layout id; a document without placements');
const PA = { prefab: 'woodwall', x: 300, z: 100 };
const PB = { prefab: 'woodwall', x: 320, z: 100 };
const boot4a = starte('welt4', dokument(BASIS_VORHER, []));
const u1 = boot4a.server;
const woodwall = u1.prefabs.getByName('woodwall')!.hash;
// The state an older server left behind: it adopted the player's wall by proximity and wrote the id on it.
const baut1 = u1.zdos.createZDO(woodwall, { x: 300.05, y: u1.getGroundHeight(300.05, 100.05), z: 100.05 });
baut1.setInt('spieler', 1);
baut1.setString(LAYOUT_ID_MEMBER, layoutKennung(PA));
const baut1Id = baut1.zdoid.toString();
const baut1Pos = { ...baut1.position };
const baut2 = u1.zdos.createZDO(woodwall, { x: 320.1, y: u1.getGroundHeight(320.1, 100), z: 100 });
baut2.setInt('spieler', 1);
const baut2Id = baut2.zdoid.toString();
u1.saveWorld();
const boot4b = starte('welt4', dokument(BASIS_VORHER, [PA, PB]));
const u2 = boot4b.server;
console.log(`     log: ${boot4b.zeilen.join(' | ')}`);
const mitId = nachKennung(u2, layoutKennung(PA));
check('(A2) exactly ONE ZDO carries the id of the placement', mitId.length === 1 && mitId[0]!.zdoid.toString() !== baut1Id, `${mitId.length} ZDO(s): ${mitId.map((z) => z.zdoid.toString()).join(', ')}`);
const baut1B = u2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === baut1Id)!;
check(
  '(A2) the player piece stays where it was, without a layout id',
  baut1B !== undefined && baut1B.getString(LAYOUT_ID_MEMBER) === '' && nahe(baut1B.position.x, baut1Pos.x, 1e-9) && nahe(baut1B.position.y, baut1Pos.y, 1e-9) && nahe(baut1B.position.z, baut1Pos.z, 1e-9),
  `layoutId='${baut1B?.getString(LAYOUT_ID_MEMBER)}'`
);
check('(A2) the log counts the freed player piece', boot4b.zeilen.some((z) => /1 Spielerbau\(ten\)/.test(z)), boot4b.zeilen.join(' | '));
const naheB = u2.zdos.getZDOsInRadius({ x: PB.x, y: 0, z: PB.z }, 1).filter((z) => z.prefabHash === woodwall);
check('(A2) a placement right above a player piece: both objects stay', naheB.length === 2, `${naheB.length}`);
check('(A2) ... with a warning line', boot4b.zeilen.some((z) => z.includes(layoutKennung(PB)) && /Spielerbau/.test(z) && !/befreit/.test(z)), boot4b.zeilen.join(' | '));
check('(A2) the player piece under the new placement has no layout id', (u2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === baut2Id)?.getString(LAYOUT_ID_MEMBER) ?? 'x') === '');
u2.saveWorld();

const boot4c = starte('welt4', dokument(BASIS_VORHER, []));
const u3 = boot4c.server;
console.log(`     log: ${boot4c.zeilen.join(' | ')}`);
const uebrig = u3.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '' && z.getInt('spieler') !== 1);
check('(A4) a document without placements removes the orphaned layout ZDOs', uebrig.length === 0, `${uebrig.length} left`);
check('(A4) ... and logs how many', boot4c.zeilen.some((z) => /2 entfernt/.test(z)) && boot4c.zeilen.some((z) => /ohne Platzierungen — 2/.test(z)), boot4c.zeilen.join(' | '));
check('(A4) ... but player pieces stay', [baut1Id, baut2Id].every((id) => u3.zdos.getAllZDOs().some((z) => z.zdoid.toString() === id)));

// ── World 5: the rounding edge of the id ────────────────────────────
console.log('\n[11] World 5: a placement pushed across the rounding edge of its id');
const K1 = { prefab: 'piece_chest_wood', x: 140.4, z: 100 }; // id "@140"
const K2 = { ...K1, x: 140.5 }; // id "@141"
const boot5a = starte('welt5', dokument(BASIS_VORHER, [K1]));
const kz1 = eines(boot5a.server, K1)!;
const kzId = kz1.zdoid.toString();
boot5a.server.saveWorld();
const boot5b = starte('welt5', dokument(BASIS_VORHER, [K2]));
console.log(`     log: ${boot5b.zeilen.join(' | ')}`);
const kz2 = eines(boot5b.server, K2);
check('(A3) 140.4 -> 140.5 changes the id key but keeps the ZDO id', kz2 !== undefined && kz2.zdoid.toString() === kzId, `${kzId} -> ${kz2?.zdoid.toString()}`);
check('(A3) ... 0 spawned, 0 removed', boot5b.zeilen.some((z) => /\b0 gespawnt/.test(z) && /\b0 entfernt/.test(z)), boot5b.zeilen.join(' | '));
check('(A3) ... at the new position, one layout ZDO in the world', kz2 !== undefined && nahe(kz2.position.x, 140.5, 1e-3) && boot5b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER)).length === 1, `x=${kz2?.position.x}`);

// ── World 6: the real world document ────────────────────────────────
console.log('\n[12] World 6: a copy of server/data/welten/dev.json boots twice and moves nothing');
const devDoc = JSON.parse(readFileSync(resolve(HIER, '../data/welten/dev.json'), 'utf8')) as Record<string, unknown>;
const boot6a = starte('welt6', devDoc);
const dev1 = layoutRevisionen(boot6a.server);
boot6a.server.saveWorld();
const boot6b = starte('welt6', devDoc);
console.log(`     log: ${boot6b.zeilen.join(' | ')}`);
const dev2 = layoutRevisionen(boot6b.server);
const bewegt = [...dev2].filter(([id, rev]) => dev1.get(id) !== rev).length;
check('(dev) the document places many objects (sanity)', dev1.size >= 100, `${dev1.size} layout ZDOs`);
check('(dev) a reboot with the unchanged document moves 0 revisions', bewegt === 0 && dev2.size === dev1.size, `${bewegt} of ${dev2.size} moved, ${dev1.size} before`);
check('(dev) ... and logs 0 gespawnt, 0 aktualisiert', boot6b.zeilen.some((z) => /\b0 gespawnt, 0 aktualisiert/.test(z)), boot6b.zeilen.join(' | '));

// 158 of 159 entries written with a German decimal comma ("100,00"): the sanitizer drops them all but the first.
const devPlacements = devDoc.placements as { x: number; z: number; prefab: string }[];
const kaputt = devPlacements.map((p, i) => (i === 0 ? p : { ...p, x: p.x.toFixed(2).replace('.', ','), z: p.z.toFixed(2).replace('.', ',') }));
const boot6c = starte('welt6', { ...devDoc, placements: kaputt });
console.log(`     log: ${boot6c.zeilen.join(' | ')}`);
const dev3 = layoutRevisionen(boot6c.server);
check('(R3-1) dev.json copy with 158 of 159 broken entries: 0 entfernt, all 157 ZDOs stay', dev3.size === dev1.size && boot6c.zeilen.some((z) => /\b0 entfernt/.test(z)), `${dev3.size} of ${dev1.size} ZDOs alive`);
check('(R3-1) ... with the loud line naming 158 dropped entries and the 156 objects left standing', boot6c.zeilen.some((z) => /Layout-Abgleich ohne Löschen: 158 Einträge verworfen – 156 verwaiste Layout-Objekte bleiben bis zum nächsten sauberen Dokument stehen/.test(z)), boot6c.zeilen.join(' | '));
// The next clean document (the first 150 entries) clears the rest as usual.
const dev150 = devPlacements.slice(0, 150);
const kennungen150 = new Set(dev150.map((p) => layoutKennung(p)));
const boot6d = starte('welt6', { ...devDoc, placements: dev150 });
const dev4 = layoutRevisionen(boot6d.server);
check('(R3-1) the next clean document clears as usual (only the ZDOs of the 150 kept ids remain)', dev4.size === kennungen150.size && boot6d.zeilen.some((z) => new RegExp(`\\b${dev1.size - kennungen150.size} entfernt`).test(z)) && !boot6d.zeilen.some((z) => /ohne Löschen/.test(z)), `${dev4.size} left, expected ${kennungen150.size}; ${boot6d.zeilen.filter((z) => /entfernt/.test(z)).join(' | ')}`);

// ── World 7: a `placements` field of the wrong type ─────────────────
console.log('\n[13] World 7: placements null / object / text / number remove nothing; missing and [] clear');
const Q1 = { prefab: 'woodwall', x: 100, z: 100 };
const Q2 = { prefab: 'piece_chest_wood', x: 120, z: 100 };
const boot7a = starte('welt7', dokument(BASIS_VORHER, [Q1, Q2]));
const v1 = boot7a.server;
const q1 = eines(v1, Q1)!;
const q2 = eines(v1, Q2)!;
// A player piece a previous server adopted by proximity: it still carries a layout id.
const SPB = { prefab: 'woodwall', x: 300, z: 100 };
const spb = v1.zdos.createZDO(v1.prefabs.getByName('woodwall')!.hash, { x: 300.05, y: v1.getGroundHeight(300.05, 100.05), z: 100.05 });
spb.setInt('spieler', 1);
spb.setString(LAYOUT_ID_MEMBER, layoutKennung(SPB));
const spbId = spb.zdoid.toString();
const spbPos = { ...spb.position };
q1.setInt('zzZustand', 7); // state that lives on the instance and cannot come back from the document
q2.setInt('zzZustand', 7);
const q1Id = q1.zdoid.toString();
const q2Id = q2.zdoid.toString();
v1.saveWorld();
for (const [bad, typ] of [[null, 'null'], [{}, 'object'], ['nope', 'string'], [42, 'number']] as const) {
  const b = starte('welt7', { ...dokument(BASIS_VORHER, [Q1, Q2]), placements: bad });
  const dabei = b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
  const zustand = dabei.filter((z) => z.getInt('zzZustand') === 7).length;
  check(
    `(B1) placements = ${JSON.stringify(bad)}: nothing removed, both ZDOs and their state are there`,
    dabei.length === 2 && zustand === 2 && dabei.some((z) => z.zdoid.toString() === q1Id) && dabei.some((z) => z.zdoid.toString() === q2Id),
    `${dabei.length} layout ZDOs, ${zustand} with state`
  );
  const spbNach = b.server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === spbId);
  check(
    `(B8) placements = ${JSON.stringify(bad)}: the player piece is still freed of its stale id (no deletion) and stays put`,
    spbNach !== undefined && spbNach.getString(LAYOUT_ID_MEMBER) === '' && nahe(spbNach.position.x, spbPos.x, 1e-9) && nahe(spbNach.position.y, spbPos.y, 1e-9) && b.zeilen.some((z) => /1 Spielerbau\(ten\)/.test(z)),
    `layoutId='${spbNach?.getString(LAYOUT_ID_MEMBER)}'; ${b.zeilen.join(' | ')}`
  );
  check(
    `(B8) ... and the warning names the side effect (route NPCs are not registered in this boot)`,
    b.zeilen.some((z) => z.includes(`placements unlesbar (${typ})`) && z.includes('Routen-NPCs nicht beim Läufer angemeldet')),
    b.zeilen.join(' | ')
  );
  check(
    `(B1) ... and it warns: placements unlesbar (${typ})`,
    b.zeilen.some((z) => z.includes(`placements unlesbar (${typ})`) && z.includes('unangetastet')) && !b.zeilen.some((z) => /\d+ entfernt/.test(z)),
    b.zeilen.join(' | ')
  );
}
const alleWeg = starte('welt7', { ...dokument(BASIS_VORHER, [Q1, Q2]), placements: ['x'] });
const spbAlle = alleWeg.server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === spbId);
check(
  '(B8) placements = ["x"] (all dropped): player piece freed as well, warning names the route side effect',
  spbAlle !== undefined && spbAlle.getString(LAYOUT_ID_MEMBER) === '' && alleWeg.zeilen.some((z) => z.includes('alle 1 Einträge verworfen') && z.includes('Routen-NPCs nicht beim Läufer angemeldet')),
  alleWeg.zeilen.join(' | ')
);
const ohneFeld = dokument(BASIS_VORHER, []);
delete ohneFeld.placements;
for (const [doc, name] of [[ohneFeld, 'missing'], [dokument(BASIS_VORHER, []), '[]']] as const) {
  const b = starte('welt7', doc);
  const uebrig7 = b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
  check(`(B1) placements ${name}: means "none", the orphans are cleared`, uebrig7.length === 0 && b.zeilen.some((z) => /2 entfernt/.test(z)), `${uebrig7.length} left; ${b.zeilen.join(' | ')}`);
}

// ── World 8: one id, several ZDOs ───────────────────────────────────
console.log('\n[14] World 8: three ZDOs with one id are cut down to one');
const DUP = { prefab: 'woodwall', x: 600, z: 100 };
const boot8a = starte('welt8', dokument(BASIS_VORHER, [DUP]));
const x1 = boot8a.server;
const woodwall8 = x1.prefabs.getByName('woodwall')!.hash;
const dupOriginal = eines(x1, DUP)!;
// The state a server that adopted by proximity leaves behind: further ZDOs with the same id, no stamp.
const dupB = x1.zdos.createZDO(woodwall8, { x: 600, y: x1.getGroundHeight(600, 100) - 0.5, z: 100 });
dupB.setString(LAYOUT_ID_MEMBER, layoutKennung(DUP));
const dupC = x1.zdos.createZDO(woodwall8, { x: 600.2, y: x1.getGroundHeight(600.2, 100) - 0.5, z: 100 });
dupC.setString(LAYOUT_ID_MEMBER, layoutKennung(DUP));
const dupOriginalId = dupOriginal.zdoid.toString();
check('(B2) the state has three ZDOs with one id', nachKennung(x1, layoutKennung(DUP)).length === 3, `${nachKennung(x1, layoutKennung(DUP)).length}`);
x1.saveWorld();
const boot8b = starte('welt8', dokument(BASIS_NACHHER, [DUP]));
const x2 = boot8b.server;
console.log(`     log: ${boot8b.zeilen.join(' | ')}`);
const dupNach = nachKennung(x2, layoutKennung(DUP));
check('(B2) after the boot exactly ONE ZDO carries the id (the nearest, stamped one)', dupNach.length === 1 && dupNach[0]!.zdoid.toString() === dupOriginalId, `${dupNach.length}: ${dupNach.map((z) => z.zdoid.toString()).join(', ')}`);
check(
  '(B2) ... standing on the ground, stamped',
  dupNach.length === 1 && nahe(dupNach[0]!.position.y, x2.getGroundHeight(600, 100), 1e-6) && dupNach[0]!.getString(LAYOUT_SOLL_MEMBER) !== '',
  dupNach[0] ? `y=${dupNach[0].position.y} ground=${x2.getGroundHeight(600, 100)} stamp='${dupNach[0].getString(LAYOUT_SOLL_MEMBER)}'` : 'none'
);
check('(B2) ... and the log counts them', boot8b.zeilen.some((z) => /2 überzählige Layout-ZDOs mit gleicher Kennung entfernt/.test(z)), boot8b.zeilen.join(' | '));
check('(R3-2) ... and the count line says 2 entfernt (davon 2 überzählig), not 0', boot8b.zeilen.some((z) => /\b2 entfernt \(davon 2 überzählig\)/.test(z)), boot8b.zeilen.join(' | '));

// ── World 9: `spieler` of any member type ───────────────────────────
console.log('\n[15] World 9: a player piece is a player piece whatever the type of `spieler` is');
const SP4 = [
  { prefab: 'woodwall', x: 700, z: 100, typ: 'int' },
  { prefab: 'woodwall', x: 720, z: 100, typ: 'float' },
  { prefab: 'woodwall', x: 740, z: 100, typ: 'long' },
  { prefab: 'woodwall', x: 760, z: 100, typ: 'string' },
] as const;
const boot9a = starte('welt9', dokument(BASIS_VORHER, []));
const y1 = boot9a.server;
const gebaut = SP4.map((e) => {
  const z = y1.zdos.createZDO(y1.prefabs.getByName(e.prefab)!.hash, { x: e.x + 0.05, y: y1.getGroundHeight(e.x + 0.05, e.z + 0.05), z: e.z + 0.05 });
  if (e.typ === 'int') z.setInt('spieler', 1);
  else if (e.typ === 'float') z.setFloat('spieler', 1);
  else if (e.typ === 'long') z.setLong('spieler', 1n);
  else z.setString('spieler', '1');
  z.setString(LAYOUT_ID_MEMBER, layoutKennung(e));
  return { id: z.zdoid.toString(), pos: { ...z.position } };
});
y1.saveWorld();
const boot9b = starte('welt9', dokument(BASIS_VORHER, SP4.map((e) => ({ prefab: e.prefab, x: e.x, z: e.z }))));
console.log(`     log: ${boot9b.zeilen.join(' | ')}`);
SP4.forEach((e, i) => {
  const z = boot9b.server.zdos.getAllZDOs().find((q) => q.zdoid.toString() === gebaut[i]!.id);
  const eigenes = nachKennung(boot9b.server, layoutKennung(e));
  check(
    `(B4) spieler as ${e.typ}: the piece is freed, not moved, not adopted`,
    z !== undefined && z.getString(LAYOUT_ID_MEMBER) === '' && nahe(z.position.x, gebaut[i]!.pos.x, 1e-9) && nahe(z.position.y, gebaut[i]!.pos.y, 1e-9) && eigenes.length === 1 && eigenes[0]!.zdoid.toString() !== gebaut[i]!.id,
    z ? `layoutId='${z.getString(LAYOUT_ID_MEMBER)}' x=${z.position.x}, ${eigenes.length} own ZDO(s)` : 'destroyed'
  );
});
check('(B4) the log counts 4 freed player pieces', boot9b.zeilen.some((z) => /4 Spielerbau\(ten\)/.test(z)), boot9b.zeilen.join(' | '));

// ── World 10: entries the sanitizer drops ───────────────────────────
console.log('\n[16] World 10: a placements array the sanitizer empties completely vs. partly');
const R1 = { prefab: 'woodwall', x: 100, z: 100 };
const R2 = { prefab: 'piece_chest_wood', x: 120, z: 100 };
const R3 = { prefab: 'woodwall', x: 140, z: 100 };
const boot10a = starte('welt10', dokument(BASIS_VORHER, [R1, R2, R3]));
const r1s = boot10a.server;
const r1Ids = [R1, R2, R3].map((p) => eines(r1s, p)!.zdoid.toString());
for (const p of [R1, R2, R3]) eines(r1s, p)!.setInt('zzZustand', 7);
r1s.saveWorld();
for (const [roh, n] of [[['x', 'y'], 2], [[{}], 1], [[[]], 1], [[{ prefab: 'woodwall', x: 99999999, z: 100 }, { prefab: 'woodwall', x: 'abc', z: 1 }, 5], 3]] as const) {
  const b = starte('welt10', { ...dokument(BASIS_VORHER, [R1, R2, R3]), placements: roh });
  const dabei = b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
  check(
    `(B1b) placements ${JSON.stringify(roh)}: all ${n} entries dropped -> nothing removed, state kept`,
    dabei.length === 3 && dabei.every((z) => z.getInt('zzZustand') === 7) && r1Ids.every((id) => dabei.some((z) => z.zdoid.toString() === id)),
    `${dabei.length} layout ZDOs`
  );
  check(
    `(B1b) ... and it warns: alle ${n} Einträge verworfen`,
    b.zeilen.some((z) => z.includes(`placements: alle ${n} Einträge verworfen`) && z.includes('unangetastet')) && !b.zeilen.some((z) => /\d+ entfernt/.test(z)),
    b.zeilen.join(' | ')
  );
}
const teil = starte('welt10', { ...dokument(BASIS_VORHER, [R1, R2]), placements: [R1, R2, { prefab: 'woodwall', x: 99999999, z: 100 }] });
const teilDabei = teil.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
check(
  '(R3-1) 2 valid + 1 dropped entry: this boot deletes NOTHING (all three ZDOs stay)',
  teilDabei.length === 3 && r1Ids.every((id) => teilDabei.some((z) => z.zdoid.toString() === id)) && teilDabei.every((z) => z.getInt('zzZustand') === 7),
  `${teilDabei.length} left`
);
check(
  '(R3-1) ... with the loud line "ohne Löschen: 1 Einträge verworfen – 1 verwaiste Layout-Objekte bleiben …"',
  teil.zeilen.some((z) => /Layout-Abgleich ohne Löschen: 1 Einträge verworfen – 1 verwaiste Layout-Objekte bleiben bis zum nächsten sauberen Dokument stehen/.test(z)) && teil.zeilen.some((z) => /\b0 entfernt/.test(z)),
  teil.zeilen.join(' | ')
);
const sauber = starte('welt10', dokument(BASIS_VORHER, [R1, R2]));
const sauberDabei = sauber.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
check(
  '(R3-1) the next CLEAN document clears as usual: exactly the ZDO of the removed placement goes',
  sauberDabei.length === 2 && !sauberDabei.some((z) => z.zdoid.toString() === r1Ids[2]) && sauber.zeilen.some((z) => /\b1 entfernt/.test(z)) && !sauber.zeilen.some((z) => /ohne Löschen/.test(z)),
  `${sauberDabei.length} left; ${sauber.zeilen.join(' | ')}`
);

// ── World 11: unknown prefabs spare only what belongs to them ────────
console.log('\n[17] World 11: an unknown prefab spares its own ZDOs (same id / within 1 m); everything else clears as usual');
const boot11a = starte('welt11', dokument(BASIS_VORHER, []));
const aa = boot11a.server;
const woodwall11 = aa.prefabs.getByName('woodwall')!.hash;
const U1 = { prefab: 'gibtsnicht', x: 100, z: 100 }; // (B3) the prefab has vanished from the registry, its ZDO keeps the id
const U2 = { prefab: 'gibtsnicht', x: 200, z: 100 }; // moved >= 0.5 m by the designer
const U3 = { prefab: 'gibtsnicht', x: 300, z: 100 }; // two ZDOs with this id
const mach = (p: { prefab: string; x: number; z: number }, dx = 0): ZDO => {
  const z = aa.zdos.createZDO(woodwall11, { x: p.x + dx, y: aa.getGroundHeight(p.x + dx, p.z), z: p.z });
  z.setString(LAYOUT_ID_MEMBER, layoutKennung(p));
  z.setInt('zzZustand', 7);
  return z;
};
const v1z = mach(U1);
const v2z = mach(U2);
const v3a = mach(U3);
const v3b = mach(U3, 0.2);
const v11Ids = [v1z, v2z, v3a, v3b].map((z) => z.zdoid.toString());
const v1Y = v1z.position.y;
aa.saveWorld();
const lebt11 = (server: Server): string[] => server.zdos.getAllZDOs().map((z) => z.zdoid.toString()).filter((id) => v11Ids.includes(id));
const nur11 = (server: Server, erwartet: number[]): boolean => {
  const lebende = lebt11(server).sort();
  const soll = erwartet.map((i) => v11Ids[i]!).sort();
  return lebende.length === soll.length && lebende.every((id, i) => id === soll[i]);
};

const boot11b = starte('welt11', dokument(BASIS_NACHHER, [U1]));
console.log(`     log: ${boot11b.zeilen.join(' | ')}`);
const v1B = boot11b.server.zdos.getAllZDOs().find((z) => z.zdoid.toString() === v11Ids[0]);
check('(B3) unknown prefab: the ZDO with that id is not removed and not touched', v1B !== undefined && v1B.getString(LAYOUT_ID_MEMBER) === layoutKennung(U1) && nahe(v1B.position.y, v1Y, 1e-9), v1B ? `y=${v1B.position.y} was ${v1Y}, ground now ${boot11b.server.getGroundHeight(100, 100).toFixed(3)}` : 'removed');
check('(B3) ... and a warning names the id, the prefab and the number of spared ZDOs', boot11b.zeilen.some((z) => z.includes(layoutKennung(U1)) && z.includes("'gibtsnicht'") && /1 ZDO\(s\) mit dieser Kennung oder im Umkreis von 1 m bleiben unangetastet/.test(z)), boot11b.zeilen.join(' | '));
check('(A1) ... NO global lock: the three ZDOs that do not belong to it are cleared as usual', nur11(boot11b.server, [0]) && boot11b.zeilen.some((z) => /\b3 entfernt/.test(z)) && !boot11b.zeilen.some((z) => /ohne Löschen/.test(z)), `alive: ${lebt11(boot11b.server).join(',')}; ${boot11b.zeilen.join(' | ')}`);

const boot11c = starte('welt11', dokument(BASIS_NACHHER, [{ ...U2, x: 200.6 }]));
check('(A1) unknown prefab + placement moved by 0.6 m (the id key changes): its ZDO stays, no second object appears, the rest clears', nur11(boot11c.server, [1]) && boot11c.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '').length === 1, `alive: ${lebt11(boot11c.server).join(',')}`);

const boot11d = starte('welt11', dokument(BASIS_NACHHER, [U3]));
console.log(`     log: ${boot11d.zeilen.join(' | ')}`);
check('(A1) unknown prefab + duplicate: both ZDOs stay, nothing is cut down', nur11(boot11d.server, [2, 3]) && !boot11d.zeilen.some((z) => /überzählig/.test(z)), `alive: ${lebt11(boot11d.server).join(',')}; ${boot11d.zeilen.join(' | ')}`);

const boot11e = starte('welt11', dokument(BASIS_NACHHER, []));
check('(A1) a document without placements clears them all as usual', lebt11(boot11e.server).length === 0 && boot11e.zeilen.some((z) => /\b4 entfernt/.test(z)) && !boot11e.zeilen.some((z) => /ohne Löschen/.test(z)), `${lebt11(boot11e.server).length} alive; ${boot11e.zeilen.join(' | ')}`);

// ── World 12: no ZDO of the id fits the prefab ──────────────────────
console.log('\n[18] World 12: no ZDO of an id fits the prefab -> the new one is spawned and the stale ones go in the same boot');
const boot12a = starte('welt12', dokument(BASIS_VORHER, []));
const bb = boot12a.server;
const CHEST = { prefab: 'piece_chest_wood', x: 600, z: 100 };
for (const dx of [0, 0.2]) {
  const z = bb.zdos.createZDO(bb.prefabs.getByName('woodwall')!.hash, { x: 600 + dx, y: bb.getGroundHeight(600 + dx, 100), z: 100 });
  z.setString(LAYOUT_ID_MEMBER, layoutKennung(CHEST));
  z.setInt('zzZustand', 7);
}
bb.saveWorld();
const boot12b = starte('welt12', dokument(BASIS_VORHER, [CHEST]));
console.log(`     log: ${boot12b.zeilen.join(' | ')}`);
const mit12 = nachKennung(boot12b.server, layoutKennung(CHEST));
check(
  '(R3-3) after the boot exactly ONE ZDO carries the id, and it is the new chest',
  mit12.length === 1 && mit12[0]!.prefabHash === boot12b.server.prefabs.getByName('piece_chest_wood')!.hash && mit12[0]!.getInt('zzZustand') === 0,
  `${mit12.length} ZDO(s): ${mit12.map((z) => z.zdoid.toString()).join(', ')}`
);
check('(R3-3) ... spawned 1, removed the 2 stale ones in the same boot (counted)', boot12b.zeilen.some((z) => /\b1 gespawnt, .* 2 entfernt \(davon 2 überzählig\)/.test(z)), boot12b.zeilen.join(' | '));
const boot12c = starte('welt12', dokument(BASIS_VORHER, [CHEST]));
check('(R3-3) ... and a second boot of the same save has nothing left to clean', nachKennung(boot12c.server, layoutKennung(CHEST)).length === 1, `${nachKennung(boot12c.server, layoutKennung(CHEST)).length}`);

// ── World 13: a full chest beats an empty one at the same distance ───
console.log('\n[19] World 13: duplicates at the same distance -- the one with more STATE (real members) stays, in both save orders');
for (const [welt, volleZuerst] of [['welt13a', false], ['welt13b', true]] as const) {
  const bootA = starte(welt, dokument(BASIS_VORHER, []));
  const sA = bootA.server;
  const chest = sA.prefabs.getByName('piece_chest_wood')!.hash;
  const TRUHE = { prefab: 'piece_chest_wood', x: 600, z: 100 };
  const baue = (dx: number, voll: boolean): string => {
    const z = sA.zdos.createZDO(chest, { x: 600 + dx, y: sA.getGroundHeight(600 + dx, 100), z: 100 });
    z.setString(LAYOUT_ID_MEMBER, layoutKennung(TRUHE));
    // The real member of the server (TRUHE_INHALT_MEMBER). The empty one only carries what does not count as state.
    if (voll) z.setString('truheInhalt', '[[Wood,3]]');
    else {
      z.setFloat('scaleScalar', 1.5);
      z.setString('anim', 'idle');
    }
    return z.zdoid.toString();
  };
  // Both 0.2 m from the placement (600,100), one to each side; only the order in the save differs.
  const ids = volleZuerst ? [baue(0.2, true), baue(-0.2, false)] : [baue(-0.2, false), baue(0.2, true)];
  const volleId = volleZuerst ? ids[0]! : ids[1]!;
  const leereId = volleZuerst ? ids[1]! : ids[0]!;
  sA.saveWorld();
  const bootB = starte(welt, dokument(BASIS_VORHER, [TRUHE]));
  const uebrig13 = nachKennung(bootB.server, layoutKennung(TRUHE));
  check(
    `(A3) ${volleZuerst ? 'full chest (truheInhalt) saved first' : 'empty chest (scaleScalar + anim) saved first'}: the full chest stays with its content, the empty one goes`,
    uebrig13.length === 1 && uebrig13[0]!.zdoid.toString() === volleId && uebrig13[0]!.getString('truheInhalt') === '[[Wood,3]]',
    `${uebrig13.length} left: ${uebrig13.map((z) => `${z.zdoid.toString()}='${z.getString('truheInhalt')}'`).join(', ')}`
  );
  check(
    '(A3) ... and the destroyed ZDO is logged with id, id key and state member count (scaleScalar and anim do not count)',
    bootB.zeilen.some((z) => z.includes(`überzähliges ZDO ${leereId} (${layoutKennung(TRUHE)}) mit 0 Zustands-Member(n) entfernt`)),
    bootB.zeilen.join(' | ')
  );
}

// ── World 6b: dev.json copy with a typo prefab + 10 deleted placements ─
console.log('\n[20] World 6b: a typo prefab in dev.json plus 10 deleted placements -- the 10 go, the ZDO at the typo stays');
const boot6e = starte('welt6b', devDoc);
const devB1 = layoutRevisionen(boot6e.server);
boot6e.server.saveWorld();
const typoIndex = 0;
// The first 10 placements from index 50 on whose id no other placement shares (so exactly 10 ZDOs must go).
const kennungsZahl = new Map<string, number>();
for (const p of devPlacements) kennungsZahl.set(layoutKennung(p), (kennungsZahl.get(layoutKennung(p)) ?? 0) + 1);
const geloescht = devPlacements.map((_, i) => i).filter((i) => i >= 50 && kennungsZahl.get(layoutKennung(devPlacements[i]!)) === 1).slice(0, 10);
const rest = devPlacements.filter((_, i) => !geloescht.includes(i));
const mitTypo = rest.map((p) => (p === devPlacements[typoIndex] ? { ...p, prefab: `${p.prefab}x` } : p));
const bleibenKennungen = new Set(mitTypo.map((p) => layoutKennung(p)));
const erwartetWeg = new Set(geloescht.map((i) => layoutKennung(devPlacements[i]!)).filter((k) => !bleibenKennungen.has(k))).size;
const typoKennungAlt = layoutKennung(devPlacements[typoIndex]!);
const boot6f = starte('welt6b', { ...devDoc, placements: mitTypo });
console.log(`     log: ${boot6f.zeilen.filter((z) => /Abgleich|Hinweis: Platzierung/.test(z)).join(' | ')}`);
const devB2 = layoutRevisionen(boot6f.server);
const typoZdo = boot6f.server.zdos.getAllZDOs().find((z) => z.getString(LAYOUT_ID_MEMBER) === typoKennungAlt);
check(
  '(A1) dev.json copy, typo prefab + 10 deleted placements: the deleted ones are removed as usual',
  devB1.size - devB2.size === erwartetWeg && erwartetWeg === 10 && boot6f.zeilen.some((z) => new RegExp(`\\b${erwartetWeg} entfernt`).test(z)) && !boot6f.zeilen.some((z) => /ohne Löschen/.test(z)),
  `${devB1.size} -> ${devB2.size} ZDOs, expected ${erwartetWeg} removed`
);
check('(A1) ... and the ZDO at the typo stays (still carries its old id), and the typo creates no ZDO', typoZdo !== undefined && !boot6f.server.zdos.getAllZDOs().some((z) => z.getString(LAYOUT_ID_MEMBER).includes(`${devPlacements[typoIndex]!.prefab}x@`)), typoZdo ? 'stays' : 'gone');
check('(A1) ... with a warning naming the typo id, prefab and the number of spared ZDOs', boot6f.zeilen.some((z) => z.includes(`${devPlacements[typoIndex]!.prefab}x@`) && /ZDO\(s\) mit dieser Kennung oder im Umkreis von 1 m bleiben unangetastet/.test(z)), boot6f.zeilen.join(' | '));

// ── World 14: typo + a 0.6 m shift ──────────────────────────────────
console.log('\n[21] World 14: typo prefab plus a 0.6 m shift -- the ZDO stays, no second object; the fixed name finds it again');
const W14 = { prefab: 'woodwall', x: 200, z: 100 };
const boot14a = starte('welt14', dokument(BASIS_VORHER, [W14]));
const w14Id = eines(boot14a.server, W14)!.zdoid.toString();
boot14a.server.saveWorld();
const boot14b = starte('welt14', dokument(BASIS_VORHER, [{ prefab: 'woodwalll', x: 200.6, z: 100 }]));
const w14b = boot14b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '');
check('(A1) typo prefab + 0.6 m shift: the old ZDO stays and no second object appears', w14b.length === 1 && w14b[0]!.zdoid.toString() === w14Id, `${w14b.length} layout ZDOs: ${w14b.map((z) => z.zdoid.toString()).join(', ')}`);
const boot14c = starte('welt14', dokument(BASIS_VORHER, [W14]));
check('(A1) ... and with the name fixed the same ZDO is found again (0 spawned, 0 removed)', eines(boot14c.server, W14)?.zdoid.toString() === w14Id && boot14c.zeilen.some((z) => /\b0 gespawnt/.test(z) && /\b0 entfernt/.test(z)), boot14c.zeilen.join(' | '));

// ── World 15: same id, different objects ─────────────────────────────
console.log('\n[22] World 15: placements in the same metre that are more than 1 cm apart are different objects');
const PAAR = [
  { prefab: 'woodwall', x: 599.6, z: 100 }, // id @600,100, 0.7 m apart
  { prefab: 'woodwall', x: 600.3, z: 100 },
  { prefab: 'woodwall', x: 700.4, z: 100.4 }, // id @700,100, 1.13 m apart
  { prefab: 'woodwall', x: 699.6, z: 99.6 },
];
let letzterStand = '';
for (let boot = 1; boot <= 3; boot++) {
  const b = starte('welt15', dokument(BASIS_VORHER, PAAR));
  const gefunden = PAAR.map((p) => b.server.zdos.getAllZDOs().filter((z) => z.getString(LAYOUT_ID_MEMBER) !== '').find((z) => Math.hypot(z.position.x - p.x, z.position.z - p.z) < 1e-3));
  const proKennung = [layoutKennung(PAAR[0]!), layoutKennung(PAAR[2]!)].map((k) => nachKennung(b.server, k).length);
  check(
    `(A4) boot ${boot}: each of the 4 placements has its own ZDO (2 per id), 0 removed`,
    proKennung[0] === 2 && proKennung[1] === 2 && gefunden.every((z) => z !== undefined) && new Set(gefunden.map((z) => z?.zdoid.toString())).size === 4 && b.zeilen.some((z) => /\b0 entfernt/.test(z)) && !b.zeilen.some((z) => /überzählig/.test(z)),
    `${proKennung.join('+')} ZDOs; ${b.zeilen.filter((z) => /Abgleich:/.test(z)).join(' | ')}`
  );
  if (boot === 1) check('(A4) ... spawned 4 in boot 1', b.zeilen.some((z) => /\b4 gespawnt/.test(z)), b.zeilen.join(' | '));
  else check(`(A4) ... and boot ${boot} spawns nothing new`, b.zeilen.some((z) => /\b0 gespawnt/.test(z)), b.zeilen.join(' | '));
  letzterStand = gefunden.map((z) => z?.zdoid.toString()).join(',');
  b.server.saveWorld();
}
check('(A4) the four ZDOs are the same in the last boot as they were placed', letzterStand.split(',').length === 4);

rmSync(WURZEL, { recursive: true, force: true });
if (fehler > 0) {
  console.error(`\n${fehler} check(s) failed`);
  process.exit(1);
}
console.log('\n=== LAYOUT-ABGLEICH: ALL PASSED ===');
