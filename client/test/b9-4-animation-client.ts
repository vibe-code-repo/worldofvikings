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
  // (c2) after die no later event plays (the body stays as it lies)
  {
    const em = neu();
    await gib(em, upd({ anim: 'run' }));
    await gib(em, upd({ anim: 'run', animEinmal: 'die#1' }));
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'run', animEinmal: 'attack#2' }));
    await gib(em, upd({ anim: 'run', animEinmal: 'hit#3' }));
    check('events after die play nothing', aufrufe.length === 0, aufrufe.join(' '));
  }
  // (c3) first sight while the state is 'attack': the creature starts standing
  {
    const em = neu();
    aufrufe.length = 0;
    await gib(em, upd({ anim: 'attack' }));
    check("first sight in state 'attack' instantiates with idle, not with a looping swing", aufrufe[0] === 'instantiate(idle)', aufrufe.join(' '));
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

// ── [7] The group a fresh instance starts with ────────────────────────
console.log('\n[7] AssetManager.starteAnfangsgruppe (first sight, instantiate)');
{
  const { AssetManager } = await import('../src/engine/AssetManager.js');
  const am = Object.create(AssetManager.prototype) as unknown as {
    mehrdeutigGemeldet: Set<string>;
    starteAnfangsgruppe(g: unknown[], anim: string, modell: string): void;
  };
  am.mehrdeutigGemeldet = new Set();
  const aufrufe: string[] = [];
  const gruppen = ['Run_02', 'Running', 'Walking'].map((name) => ({
    name,
    stop() { aufrufe.push(`stop(${name})`); },
    start() { aufrufe.push(`start(${name})`); },
  }));
  const gestartet = (anim: string, modell = 'npc_1_walk'): { start: string[]; meldungen: string[] } => {
    aufrufe.length = 0;
    const meldungen: string[] = [];
    const alt = console.error;
    console.error = (...a: unknown[]) => void meldungen.push(a.join(' '));
    am.starteAnfangsgruppe(gruppen, anim, modell);
    console.error = alt;
    return { start: aufrufe.filter((x) => x.startsWith('start(')), meldungen };
  };
  check("'walk' finds Walking on first sight (the old case-sensitive search fell back to Run_02)", gestartet('walk').start.join() === 'start(Walking)', gestartet('walk').start.join());
  check("'Walking' (the prefab's own name) still finds Walking", gestartet('Walking').start.join() === 'start(Walking)');
  const r = gestartet('run');
  check("'run' is ambiguous: nothing starts and it is reported with the MODEL name", r.start.length === 0 && r.meldungen.length === 1 && /'npc_1_walk'/.test(r.meldungen[0] ?? '') && !/__root__/.test(r.meldungen[0] ?? ''), `${r.start.length} started, ${r.meldungen[0] ?? 'no message'}`);
  const r2 = gestartet('run', 'anderes_modell');
  check('the same wish on a second model is reported too (debounce per model)', r2.meldungen.length === 1 && /'anderes_modell'/.test(r2.meldungen[0] ?? ''), `${r2.meldungen.length}`);
  check("no hit ('idle') keeps the old fallback: the first group starts", gestartet('idle').start.join() === 'start(Run_02)', gestartet('idle').start.join());
}

// ── [8] Route preview: the blow event of the editor test flight ───────
console.log('\n[8] SchlagTakt and RoutenVorschau (editor test flight has no server)');
{
  const { SchlagTakt } = await import('../src/editor/schlagTakt.js');
  const t = new SchlagTakt();
  const werte: (string | undefined)[] = [];
  for (let i = 0; i < 100; i++) werte.push(t.schritt(0, true, 0.1, 2)); // 10 s in the attack band
  const wechsel = werte.filter((v, i) => v !== undefined && v !== werte[i - 1]);
  check('10 s in the attack band with a beat of 2 s: 5 events, counting up', wechsel.join(' ') === 'attack#1 attack#2 attack#3 attack#4 attack#5', wechsel.join(' '));
  t.schritt(0, false, 0.1, 2);
  const nach = t.schritt(0, true, 0.1, 2);
  check('leaving and re-entering the band: the counter goes on (no repeat of attack#5) and the clock restarts', nach === 'attack#5', String(nach));
  check('another placement counts on its own', new SchlagTakt().schritt(1, true, 0.1, 2) === undefined);

  // The real RoutenVorschau with a stub for the draft in localStorage.
  const { RoutenVorschau } = await import('../src/editor/RoutenVorschau.js');
  const { ENTWURF_KEY } = await import('../src/editor/weltdokument.js');
  const g = globalThis as unknown as { localStorage?: { getItem(k: string): string | null } };
  const altLS = g.localStorage;
  const entwurf = { placements: [{ prefab: 'FurlocKrieger', x: 0, y: 0, z: 0 }, { prefab: 'FurlocKrieger', x: 500, y: 0, z: 500 }, { prefab: 'NPC_1', x: 900, y: 0, z: 900, route: 'r' }],
    // (a preview without any walker draws nothing: standing NPCs are only
    // stepped while at least one route walker exists — so one walker far away)
    routes: [{ id: 'r', points: [[900, 900], [910, 900]], mode: 'loop', speed: 1 }] };
  g.localStorage = { getItem: (k: string) => (k === ENTWURF_KEY ? JSON.stringify(entwurf) : null) };
  const gezeichnet: { i: number; anim: string; einmal?: string }[] = [];
  const vor = new RoutenVorschau({
    zeichne: (i, _p, _x, _z, _yaw, anim, einmal) => void gezeichnet.push({ i, anim, einmal }),
    gegriffen: () => -1,
    spieler: () => ({ x: 0, z: 1.2 }), // next to the first warrior, far from the second
  });
  vor.setzeAn(true);
  for (let i = 0; i < 100; i++) vor.update(0.1);
  g.localStorage = altLS;
  const erste = gezeichnet.filter((x) => x.i === 0);
  const ereignisse = [...new Set(erste.map((x) => x.einmal).filter((x) => x !== undefined))];
  console.log(`      10 s next to a FurlocKrieger: ${erste.filter((x) => x.anim === 'attack').length} frames of attack, events ${ereignisse.join(' ')}`);
  check('the preview stands in state attack next to the player', erste.some((x) => x.anim === 'attack'));
  check('...and writes one blow event per beat (attack#1 .. attack#4 or #5 in 10 s)', ereignisse.length >= 4 && ereignisse.every((v, k) => v === `attack#${k + 1}`), ereignisse.join(' '));
  check('the far warrior never strikes and gets no event', !gezeichnet.some((x) => x.i === 1 && x.einmal !== undefined));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
