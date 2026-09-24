/**
 * B9.4 — the client side of the animation path that needs no scene.
 *
 *  [1] The diagnostic hooks (dynMasse, dynSprung) leave the
 *      animation as they found it: ten calls, exactly one group playing.
 *      The old hooks started the measured clip and never stopped it.
 *  [2] The one-shot member format (`<clip>#<n>`): parse, count up, refuse junk.
 *  [3] The group search: exact before partial, two partial hits are ambiguous.
 *  [4] The real AssetManager reports an ambiguous state once and plays nothing.
 *
 * Run: npx tsx client/test/b9-4-animation-client.ts   (from the repo root)
 */
import * as Shared from '@wov/shared';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** A stand-in for Babylon's AnimationGroup: the same start/pause/play/stop semantics. */
class Gruppe {
  private gestartet = false;
  private pausiert = false;
  frame = 0;
  readonly from = 0;
  constructor(readonly name: string) {}
  get isPlaying(): boolean {
    return this.gestartet && !this.pausiert;
  }
  start(_loop?: boolean): void {
    this.gestartet = true;
    this.pausiert = false;
  }
  play(_loop?: boolean): void {
    this.gestartet = true;
    this.pausiert = false;
  }
  pause(): void {
    this.pausiert = true;
  }
  stop(): void {
    this.gestartet = false;
    this.pausiert = false;
  }
  goToFrame(f: number): void {
    this.frame = f;
  }
}

const S = Shared as unknown as Record<string, unknown>;

// ── [1] Diagnostic hooks clean up ────────────────────────────────
console.log('\n[1] Ten measurements in a row leave exactly one group playing');
{
  const mod = await import('../src/entities/gruppenSicherung.js').catch(() => null);
  check('gruppenSicherung exists', mod !== null);
  const alle = [new Gruppe('idle'), new Gruppe('run'), new Gruppe('walk')];
  alle[0]!.start(true); // the state clip that really plays
  const messe = (clip: string): void => {
    const g = alle.find((x) => x.name === clip);
    if (!mod) return;
    const zurueck = mod.pausiereFuerMessung(alle, g);
    zurueck();
  };
  const clips = ['run', 'walk', 'run', 'idle', 'walk', 'run', 'walk', 'idle', 'run', 'walk'];
  for (const c of clips) messe(c);
  const spielen = alle.filter((g) => g.isPlaying).map((g) => g.name);
  console.log(`      after ${clips.length} calls: playing = [${spielen.join(', ')}]`);
  check('ten calls later exactly one group plays (through the new module)', mod !== null && spielen.length === 1, spielen.join(','));
  check('and it is the one that played before (idle)', mod !== null && spielen[0] === 'idle');

  // Control: the OLD hooks, copied as they were, on the same stand-ins. This is
  // what the fix removes; it shows the stand-ins reproduce the leak.
  const alt = [new Gruppe('idle'), new Gruppe('run'), new Gruppe('walk')];
  alt[0]!.start(true);
  for (const c of clips) {
    const g = alt.find((x) => x.name === c);
    const spielt = alt.filter((x) => x.isPlaying);
    if (g) {
      for (const x of spielt) x.pause();
      g.start(true);
      g.pause();
      g.goToFrame(g.from);
    }
    if (g) {
      g.goToFrame(g.from);
      for (const x of [g, ...spielt]) x.play(true);
    }
  }
  const altSpielt = alt.filter((g) => g.isPlaying).length;
  console.log(`      the old hooks, same ten calls: ${altSpielt} groups playing`);
  check('control: the old hooks leave several groups playing (the leak the fix removes)', altSpielt > 1, `${altSpielt}`);

  // Measuring the clip that is already playing: it must keep playing.
  const g2 = [new Gruppe('idle'), new Gruppe('walk')];
  g2[1]!.start(true);
  const zurueck = mod?.pausiereFuerMessung(g2, g2[1]);
  const waehrend = g2.filter((g) => g.isPlaying).length;
  zurueck?.();
  check('during a measurement nothing plays (parked)', waehrend === 0, `${waehrend}`);
  check('measuring the playing clip: it plays again afterwards, nothing else does', g2[1]!.isPlaying && !g2[0]!.isPlaying);
}

// ── [2] One-shot member format ───────────────────────────────────
console.log('\n[2] animEinmal format');
{
  const parse = S.parseEinmal as ((w: string | undefined) => { clip: string; n: number } | null) | undefined;
  const nach = S.naechstesEinmal as ((a: string | undefined, c: string) => string) | undefined;
  check('parseEinmal exists', parse !== undefined && nach !== undefined);
  check("'attack#3' parses to attack / 3", JSON.stringify(parse?.('attack#3')) === '{"clip":"attack","n":3}');
  check('junk is null, never a guess', ['', undefined, 'attack', 'dance#1', 'hit#x', 'hit#-1', '#3', 'hit#1.5'].every((w) => parse?.(w) === null));
  check('naechstesEinmal counts up per event, also for the same clip', nach?.(undefined, 'hit') === 'hit#1' && nach?.('hit#1', 'hit') === 'hit#2' && nach?.('hit#2', 'die') === 'die#3');
}

// ── [3] Group search ─────────────────────────────────────────────
console.log('\n[3] Group search');
{
  const w = S.waehleGruppe as ((n: readonly string[], w: string) => { art: string; index?: number; treffer?: string[] }) | undefined;
  check('run on [Run_02, Running, Walking] is ambiguous (two hits), not the first', w?.(['Run_02', 'Running', 'Walking'], 'run').art === 'mehrdeutig');
  check('exact name wins', w?.(['walk2', 'walk'], 'walk').index === 1);
  check('case-insensitive partial hit', w?.(['Walking'], 'walk').art === 'teil');
  check('no hit is "fehlt"', w?.(['idle'], 'run').art === 'fehlt');
}

// ── [4] The real AssetManager: an ambiguous state is reported, not guessed ─
console.log('\n[4] AssetManager.wechsleAnimation with the groups of npc_1_walk.glb');
{
  const { AssetManager } = await import('../src/engine/AssetManager.js');
  // The class is used without a scene: only the maps the method reads are set.
  const am = Object.create(AssetManager.prototype) as unknown as {
    animGruppen: WeakMap<object, unknown[]>;
    mehrdeutigGemeldet: Set<string>;
    einmalMarke: WeakMap<object, number>;
    wechsleAnimation(root: object, wunsch: string): void;
  };
  am.animGruppen = new WeakMap();
  am.mehrdeutigGemeldet = new Set();
  am.einmalMarke = new WeakMap();
  const aufrufe: string[] = [];
  const gruppe = (name: string) => ({
    name,
    isPlaying: false,
    speedRatio: 1,
    from: 0,
    to: 1,
    stop() {
      aufrufe.push(`stop(${name})`);
      this.isPlaying = false;
    },
    start() {
      aufrufe.push(`start(${name})`);
      this.isPlaying = true;
    },
  });
  const root = { name: 'NPC_1' };
  am.animGruppen.set(root, [gruppe('Run_02'), gruppe('Running'), gruppe('Walking')]);
  const meldungen: string[] = [];
  const alt = console.error;
  console.error = (...a: unknown[]) => void meldungen.push(a.join(' '));
  am.wechsleAnimation(root, 'run');
  am.wechsleAnimation(root, 'run');
  console.error = alt;
  console.log(`      calls: ${aufrufe.join(' ')}; reported ${meldungen.length}x`);
  check("'run' on npc_1_walk plays NO group (the old code started Run_02, the first hit)", !aufrufe.some((x) => x.startsWith('start(')), aufrufe.join(' '));
  check('B4: the ambiguity is reported, once, naming both groups', meldungen.length === 1 && /Run_02/.test(meldungen[0] ?? '') && /Running/.test(meldungen[0] ?? ''), `${meldungen.length}x: ${meldungen[0] ?? ''}`);
  aufrufe.length = 0;
  am.wechsleAnimation(root, 'walk');
  check("'walk' (one hit) still plays Walking", aufrufe.includes('start(Walking)'), aufrufe.join(' '));
}

// ── [5] EntityManager: events, late joiners, stale callbacks ────────────
console.log('\n[5] EntityManager.applyDynamic with a fake asset layer');
{
  const { EntityManager } = await import('../src/entities/EntityManager.js');
  const { Vector3 } = await import('@babylonjs/core/Maths/math.vector.js');
  const { Quaternion } = await import('@babylonjs/core/Maths/math.vector.js');
  type Update = Record<string, unknown>;
  type Em = {
    dynamics: Map<string, { einmalN?: number }>;
    dynamicCount: number;
    assets: unknown;
    applyDynamic(u: Update, prefab: string, model: string | null, anim?: string, belebt?: boolean): Promise<void>;
  };
  const aufrufe: string[] = [];
  const callbacks: (() => void)[] = [];
  const fakeAssets = {
    async instantiate(_m: string, anim?: string) {
      aufrufe.push(`instantiate(${anim})`);
      return { name: '', position: new Vector3(), rotationQuaternion: null, scaling: new Vector3(1, 1, 1), getChildMeshes: () => [] };
    },
    wechsleAnimation(_r: unknown, z: string) { aufrufe.push(`wechsle(${z})`); },
    spieleEinmalKreatur(_r: unknown, clip: string, danach: (() => void) | null) {
      aufrufe.push(`einmal(${clip})`);
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
  const gib = async (em: Em, u: Update) => em.applyDynamic(u, 'Wolf', 'Wolf', 'idle', false);
  const seit = (n: number) => aufrufe.slice(n);

  // (a) an event arrives after we saw the creature: played once
  {
    const em = neu();
    await gib(em, upd({ anim: 'idle' }));
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#1' }));
    check('a new event (attack#1) plays the attack clip once', aufrufe.join(' ') === 'einmal(attack)', aufrufe.join(' '));
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#1' }));
    check('the same counter again (every ZDO update carries it) plays nothing', aufrufe.length === 0, aufrufe.join(' '));
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#2' }));
    check('the next counter (attack#2) plays again, although the clip name did not change', aufrufe.join(' ') === 'einmal(attack)', aufrufe.join(' '));
  }
  // (b) late joiner: the event already in the member is history
  {
    const em = neu();
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#7' }));
    check('a client that meets the creature with attack#7 in the member plays no swing', !aufrufe.some((x) => x.startsWith('einmal')), aufrufe.join(' '));
    check("...and remembers the counter: the same value later is still history", em.dynamics.get('1:1')?.einmalN === 7);
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#7' }));
    check('attack#7 again: nothing', aufrufe.length === 0, aufrufe.join(' '));
    await gib(em, upd({ anim: 'idle', animEinmal: 'attack#8' }));
    check('attack#8 plays', aufrufe.join(' ') === 'einmal(attack)', aufrufe.join(' '));
  }
  // (c) die: plays once, the state may not move the body afterwards
  {
    const em = neu();
    await gib(em, upd({ anim: 'run' }));
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'run', animEinmal: 'die#1' }));
    await gib(em, upd({ anim: 'idle', animEinmal: 'die#1' }));
    check('die plays the die clip and a later state change does not stand the body up', aufrufe.join(' ') === 'einmal(die)', aufrufe.join(' '));
  }
  // (d) stale end callback
  {
    const em = neu();
    await gib(em, upd({ anim: 'walk' }));
    aufrufe.length = 0; callbacks.length = 0;
    await gib(em, upd({ anim: 'walk', animEinmal: 'hit#1' }));
    check('hit plays once and registers its fall-back', aufrufe.join(' ') === 'einmal(hit)' && callbacks.length === 1);
    callbacks.length = 0;
  }
  // (e) the state 'attack' is no swing (no phantom blow), it stands
  {
    const em = neu();
    await gib(em, upd({ anim: 'run' }));
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'attack' }));
    check("state 'attack' plays idle, not a swing (the blow comes as an event)", aufrufe.join(' ') === 'wechsle(idle)', aufrufe.join(' '));
  }
}

// ── [6] The real AssetManager: a stale end callback is ignored ─────────
console.log('\n[6] AssetManager.spieleEinmalKreatur: stale end callback');
{
  const { AssetManager } = await import('../src/engine/AssetManager.js');
  const am = Object.create(AssetManager.prototype) as unknown as {
    animGruppen: WeakMap<object, unknown[]>;
    mehrdeutigGemeldet: Set<string>;
    einmalMarke: WeakMap<object, number>;
    wechsleAnimation(root: object, wunsch: string): void;
    spieleEinmalKreatur(root: object, clip: string, danach: (() => void) | null): boolean;
  };
  am.animGruppen = new WeakMap();
  am.mehrdeutigGemeldet = new Set();
  am.einmalMarke = new WeakMap();
  const aufrufe: string[] = [];
  const endeCallbacks: Record<string, (() => void)[]> = {};
  const gruppe = (name: string) => ({
    name, isPlaying: false, speedRatio: 1, from: 0, to: 1,
    onAnimationGroupEndObservable: { addOnce(f: () => void) { (endeCallbacks[name] ??= []).push(f); } },
    stop() { aufrufe.push(`stop(${name})`); this.isPlaying = false; },
    start() { aufrufe.push(`start(${name})`); this.isPlaying = true; },
  });
  const root = { name: 'Wolf' };
  am.animGruppen.set(root, [gruppe('attack'), gruppe('idle'), gruppe('walk')]);
  let danach = 0;
  am.spieleEinmalKreatur(root, 'attack', () => { danach++; });
  am.wechsleAnimation(root, 'walk'); // a state change ends the one-shot
  for (const f of endeCallbacks.attack ?? []) f(); // the old clip's end fires late
  check('after a state change the old one-shot end does NOT switch the group again', danach === 0, `${danach} call(s)`);
  am.spieleEinmalKreatur(root, 'attack', () => { danach++; });
  am.spieleEinmalKreatur(root, 'attack', () => { danach += 10; }); // restart: the newest blow wins
  for (const f of endeCallbacks.attack ?? []) f();
  check('two blows: only the newest one falls back (1 call of the second, none of the first)', danach === 10, `${danach}`);
  const p = [gruppe('attack')];
  void p;
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
