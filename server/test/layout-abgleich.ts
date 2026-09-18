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
 * World 2: (f) two placements with exactly the same prefab and position stay
 * ONE ZDO (pinned here, the decision belongs to a later card), (g) a player
 * piece of the same prefab next to a NEW placement is never adopted.
 *
 * Run: npx tsx test/layout-abgleich.ts   (from server/)
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAYOUT_ID_MEMBER, getStableHash, layoutKennung } from '@wov/shared';
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
  // The boot log line of the sync is part of the evidence.
  const zeilen: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]): void => {
    const z = a.map(String).join(' ');
    if (z.includes('Layout-')) zeilen.push(z);
    orig(...a);
  };
  try {
    server.init();
  } finally {
    console.log = orig;
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
const w1 = starte('welt2', dokument(BASIS_VORHER, [D1, { ...D1 }])).server;
const anzahl1 = nachKennung(w1, layoutKennung(D1)).length;
const spielerNah = w1.zdos.createZDO(w1.prefabs.getByName(NEU.prefab)!.hash, { x: 300.1, y: w1.getGroundHeight(300.1, 100), z: 100 });
spielerNah.setInt('spieler', 1);
const spielerNahId = spielerNah.zdoid.toString();
const spielerNahPos = { ...spielerNah.position };
w1.saveWorld();
const w2 = starte('welt2', dokument(BASIS_VORHER, [D1, { ...D1 }, NEU])).server;
const anzahl2 = nachKennung(w2, layoutKennung(D1)).length;
check('(f) two identical placements: ONE ZDO before and after (pinned)', anzahl1 === 1 && anzahl2 === 1, `${anzahl1} -> ${anzahl2}`);
const nah2 = w2.zdos.getAllZDOs().find((z) => z.zdoid.toString() === spielerNahId)!;
check('(g) player piece next to a new placement is not adopted', nah2 !== undefined && nah2.getString(LAYOUT_ID_MEMBER) === '');
check('(g) player piece did not move', nah2 !== undefined && nahe(nah2.position.x, spielerNahPos.x, 1e-9) && nahe(nah2.position.y, spielerNahPos.y, 1e-9));
check('(g) the new placement got its own ZDO', nachKennung(w2, layoutKennung(NEU)).length === 1 && nachKennung(w2, layoutKennung(NEU))[0]!.zdoid.toString() !== spielerNahId);

rmSync(WURZEL, { recursive: true, force: true });
if (fehler > 0) {
  console.error(`\n${fehler} check(s) failed`);
  process.exit(1);
}
console.log('\n=== LAYOUT-ABGLEICH: ALL PASSED ===');
