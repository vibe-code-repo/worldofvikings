/**
 * How the OTHER players' figures show death and hit (EntityManager.applyDynamic with a fake asset layer).
 *
 * The server writes the event on the victim's character ZDO: `animEinmal` = `<clip>#<n>` (treffer_* / tod_*) and, while the
 * body lies, `anim` = the death clip. What the browser run showed (mike-pc, real GPU): after the flinch clip of a
 * bystander's view the figure stopped with NO group playing — a player's prefab default state is `Walking`, which names no
 * group of the body models, so "fall back to the state" switched everything off.
 *
 *  [1] A flinch plays once; its fall-back is `idle` (not the prefab state `Walking`) — red before the fix.
 *  [2] A creature keeps its old fall-back (its own state).
 *  [3] Death: the fall plays once, the figure stays down (no flinch, no state moves it), one play, never a loop.
 *  [4] A late joiner meets a dead player: he starts standing, then lies (once), the old fall is history.
 *  [5] Revival: the state goes back to `idle`, the figure stands up and reacts again.
 *
 * Run: npx tsx client/test/tod-treffer-fremd.ts
 */
export {}; // a module: top-level await
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const { EntityManager } = await import('../src/entities/EntityManager.js');
const { Vector3 } = await import('@babylonjs/core/Maths/math.vector.js');
type Update = Record<string, unknown>;
type Em = {
  dynamics: Map<string, { einmalN?: number; stirbt?: boolean; anim?: string }>;
  dynamicCount: number;
  assets: unknown;
  applyDynamic(u: Update, prefab: string, model: string | null, anim?: string, belebt?: boolean): Promise<void>;
};
const aufrufe: string[] = [];
let callbacks: Array<() => void> = [];
const fakeAssets = {
  async instantiate(_m: string, anim?: string) {
    aufrufe.push(`instantiate(${anim})`);
    return { name: '', position: new Vector3(), rotationQuaternion: null, scaling: new Vector3(1, 1, 1), getChildMeshes: () => [] };
  },
  wechsleAnimation(_r: unknown, z: string) { aufrufe.push(`wechsle(${z})`); },
  spieleEinmalKreatur(_r: unknown, clip: string, danach: (() => void) | null) {
    aufrufe.push(`einmal(${clip}${danach ? '' : ',bleibt'})`);
    if (danach) callbacks.push(danach);
    return true;
  },
  setzeAnimationsTempo() {},
  entsorgeAnimationen() {},
};
const neu = () => {
  const em = Object.create(EntityManager.prototype) as unknown as Em;
  em.dynamics = new Map();
  em.dynamicCount = 0;
  em.assets = fakeAssets;
  return em;
};
const upd = (extra: Update = {}): Update => ({
  key: '1:1', prefabHash: 12345, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, ...extra,
});
/** A player figure as the client sees it: prefab `Player`, default state `Walking`. */
const spieler = async (em: Em, u: Update) => em.applyDynamic(u, 'Player', 'wikinger/WikingerKoerper.glb', 'Walking', false);
const wolf = async (em: Em, u: Update) => em.applyDynamic(u, 'Wolf', 'Wolf', 'idle', false);
const sieh = (): string => aufrufe.join(' ');
const leere = (): void => { aufrufe.length = 0; callbacks = []; };

console.log('\n[1] A flinch of another player: plays once, falls back to idle');
{
  const em = neu();
  await spieler(em, upd());
  leere();
  await spieler(em, upd({ animEinmal: 'treffer_vorn_links#1' }));
  check('treffer_vorn_links#1 plays the clip once, with a fall-back', sieh() === 'einmal(treffer_vorn_links)' && callbacks.length === 1, sieh());
  leere();
  await spieler(em, upd({ animEinmal: 'treffer_vorn_links#1' }));
  check('the same counter again (every ZDO update carries it) plays nothing', aufrufe.length === 0, sieh());
  await spieler(em, upd({ animEinmal: 'treffer_hinten_rechts#2' }));
  check('the next blow (#2, another side) plays again', sieh() === 'einmal(treffer_hinten_rechts)', sieh());
  const danach = callbacks[callbacks.length - 1]!;
  leere();
  danach();
  check('after the clip the figure goes to `idle` — NOT to the prefab state `Walking` (no group of that name: it would stop)', sieh() === 'wechsle(idle)', sieh());
}

console.log('\n[2] A creature keeps its own fall-back');
{
  const em = neu();
  await wolf(em, upd({ anim: 'walk' }));
  leere();
  await wolf(em, upd({ anim: 'walk', animEinmal: 'hit#1' }));
  callbacks[0]!();
  check('a wolf that was walking returns to `walk` after its hit', sieh() === 'einmal(hit) wechsle(walk)', sieh());
}

console.log('\n[3] Death of another player');
{
  const em = neu();
  await spieler(em, upd());
  leere();
  await spieler(em, upd({ anim: 'tod_hinten', animEinmal: 'tod_hinten#3' }));
  check('the fall plays ONCE and stays (no fall-back), and nothing loops', sieh() === 'einmal(tod_hinten,bleibt)', sieh());
  check('the figure is marked as lying', em.dynamics.get('1:1')?.stirbt === true);
  leere();
  await spieler(em, upd({ anim: 'tod_hinten', animEinmal: 'treffer_vorn_links#4' }));
  check('a blow event while he lies plays nothing', aufrufe.length === 0, sieh());
  await spieler(em, upd({ anim: 'tod_hinten', animEinmal: 'tod_hinten#3' }));
  check('further ZDO updates change nothing', aufrufe.length === 0, sieh());
}

console.log('\n[4] A late joiner meets a dead player');
{
  const em = neu();
  leere();
  await spieler(em, upd({ anim: 'tod_vorn', animEinmal: 'tod_vorn#9' }));
  check('starts standing (never a looping death), then lies once; the old event #9 is history', sieh() === 'instantiate(idle) einmal(tod_vorn,bleibt)', sieh());
  check('marked as lying', em.dynamics.get('1:1')?.stirbt === true && em.dynamics.get('1:1')?.einmalN === 9);
}

console.log('\n[5] Revival');
{
  const em = neu();
  await spieler(em, upd());
  await spieler(em, upd({ anim: 'tod_hinten', animEinmal: 'tod_hinten#1' }));
  leere();
  await spieler(em, upd({ anim: 'idle', animEinmal: 'tod_hinten#1' }));
  check('anim goes back to `idle`: he stands up (idle plays), no longer lying', sieh() === 'wechsle(idle)' && em.dynamics.get('1:1')?.stirbt === false, sieh());
  leere();
  await spieler(em, upd({ anim: 'idle', animEinmal: 'treffer_hinten_links#2' }));
  check('and reacts to a blow again', sieh() === 'einmal(treffer_hinten_links)', sieh());
  leere();
  await spieler(em, upd({ anim: 'tod_vorn', animEinmal: 'tod_vorn#3' }));
  check('a second death lies down again', sieh() === 'einmal(tod_vorn,bleibt)', sieh());
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
