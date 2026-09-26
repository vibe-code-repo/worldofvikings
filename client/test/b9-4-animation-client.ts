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
  /** The server rule (AggroSystem.zuschlagen), written out independently. */
  const serverSchlaege = (schritte: { schlaegt: boolean; dt: number }[], takt: number): number => {
    let akku = 0;
    let n = 0;
    for (const s of schritte) {
      if (!s.schlaegt) continue; // the clock stands still outside the strike band while the target is kept
      akku += s.dt;
      if (akku >= takt) {
        akku = Math.min(akku - takt, takt);
        n++;
      }
    }
    return n;
  };
  const zaehle = (schritte: { schlaegt: boolean; dt: number }[], takt: number): number => {
    const t = new SchlagTakt();
    let n = 0;
    let letzt: string | undefined;
    for (const s of schritte) {
      const v = t.schritt(0, s.schlaegt, s.dt, takt);
      if (v !== undefined && v !== letzt) n++;
      letzt = v;
    }
    return n;
  };
  const gleich = (n: number, dt: number, schlaegt = true) => Array.from({ length: n }, () => ({ schlaegt, dt }));

  check('10 s in the band, beat 2 s: exactly 5 events', zaehle(gleich(100, 0.1), 2) === 5, String(zaehle(gleich(100, 0.1), 2)));
  check('beat 0.5 s would be 20 events, not 5 (the beat is the number the NPC data gives)', zaehle(gleich(100, 0.1), 0.5) === 20);
  check('frames of 0.3 s (the rest of a beat is kept): 10 s = 5 events, as on the server', zaehle(gleich(34, 0.3), 2) === serverSchlaege(gleich(34, 0.3), 2) && zaehle(gleich(34, 0.3), 2) === 5, `${zaehle(gleich(34, 0.3), 2)} / ${serverSchlaege(gleich(34, 0.3), 2)}`);
  {
    // One slow frame must not fire two blows at once (rest capped at one beat).
    const langsam = [{ schlaegt: true, dt: 5 }, ...gleich(12, 0.1)];
    check('a slow frame of 5 s and 12 frames of 0.1 s: 2 events (rest capped), as on the server', zaehle(langsam, 2) === 2 && serverSchlaege(langsam, 2) === 2, `${zaehle(langsam, 2)} / ${serverSchlaege(langsam, 2)}`);
  }
  {
    // KITING at the edge: 1.5 s in the strike band, 0.5 s in the chase band, 10 rounds.
    const kiten = Array.from({ length: 10 }, () => [...gleich(15, 0.1), ...gleich(5, 0.1, false)]).flat();
    const editor = zaehle(kiten, 2);
    const server = serverSchlaege(kiten, 2);
    console.log(`      kiting 20 s: server rule ${server} blows, editor clock ${editor}`);
    check('kiting at the edge of the range (1.5 s in / 0.5 s chase): the editor strikes as often as the server (7)', editor === server && server === 7, `${editor} / ${server}`);
  }
  {
    const t = new SchlagTakt();
    for (let i = 0; i < 15; i++) t.schritt(0, true, 0.1, 2);
    t.verliere(0);
    let aus: string | undefined;
    for (let i = 0; i < 15; i++) aus = t.schritt(0, true, 0.1, 2);
    check('verliere() (target lost) restarts the clock: 1.5 s + lost + 1.5 s is no blow', aus === undefined, String(aus));
    for (let i = 0; i < 10; i++) aus = t.schritt(0, true, 0.1, 2);
    check('...and the counter goes on from there (first blow after 2 s in the band)', aus === 'attack#1', String(aus));
    t.verliere(7);
    check('verliere() of an unknown placement is harmless', true);
  }

  // The real RoutenVorschau with a stub for the draft in localStorage.
  const { RoutenVorschau } = await import('../src/editor/RoutenVorschau.js');
  const { ENTWURF_KEY } = await import('../src/editor/weltdokument.js');
  const g = globalThis as unknown as { localStorage?: { getItem(k: string): string | null } };
  const altLS = g.localStorage;
  const NAH = { x: 0, z: 1.2 };
  const FERN = { x: 0, z: 100 }; // beyond the aggro radius: the target is lost
  type Bild = { i: number; anim: string; einmal?: string };
  const baue = (entwurf: unknown) => {
    g.localStorage = { getItem: (k: string) => (k === ENTWURF_KEY ? JSON.stringify(entwurf) : null) };
    const gez: Bild[] = [];
    const st = { pos: NAH as { x: number; z: number } };
    const vor = new RoutenVorschau({
      zeichne: (i, _p, _x, _z, _yaw, anim, einmal) => void gez.push({ i, anim, einmal }),
      gegriffen: () => -1,
      spieler: () => st.pos,
    });
    vor.setzeAn(true);
    const lauf = (pos: { x: number; z: number }, sek: number): void => {
      st.pos = pos;
      for (let k = 0; k < Math.round(sek * 10); k++) vor.update(0.1);
    };
    const ereignisse = (i: number): string[] => [...new Set(gez.filter((x) => x.i === i).map((x) => x.einmal).filter((x): x is string => x !== undefined))];
    return { vor, gez, lauf, ereignisse };
  };
  const stehend = { placements: [{ prefab: 'FurlocKrieger', x: 0, y: 0, z: 0 }, { prefab: 'FurlocKrieger', x: 500, y: 0, z: 500 }], routes: [] };
  const laeufer = { placements: [{ prefab: 'FurlocKrieger', x: 0, y: 0, z: 0, route: 'w' }], routes: [{ id: 'w', points: [[0, 0], [0, 0.5]], mode: 'loop', speed: 0.1 }] };

  {
    // NO route walker anywhere: the standing warrior must still turn and strike.
    const b = baue(stehend);
    b.lauf(NAH, 10);
    const ev = b.ereignisse(0);
    console.log(`      10 s next to a standing FurlocKrieger, no route in the draft: ${b.gez.filter((x) => x.i === 0 && x.anim === 'attack').length} frames of attack, events ${ev.join(' ')}`);
    check('a standing warrior WITHOUT any route walker in the draft is drawn and strikes', b.gez.some((x) => x.i === 0 && x.anim === 'attack'));
    check('...exactly 5 events in 10 s (attack#1 .. attack#5), the beat of the NPC data', ev.join(' ') === 'attack#1 attack#2 attack#3 attack#4 attack#5', ev.join(' '));
    check('the far warrior never strikes and gets no event', !b.gez.some((x) => x.i === 1 && x.einmal !== undefined));
    // restart of the preview (a placement was deleted): the counter starts again, the client meets fresh entities
    b.vor.ruecksetzen();
    b.lauf(NAH, 2.1);
    const nachher = b.ereignisse(0);
    check('after ruecksetzen() the counter starts again at attack#1 (not attack#6)', nachher.includes('attack#1') && !nachher.includes('attack#6'), nachher.join(' '));
    g.localStorage = altLS;
  }
  {
    // Target lost (player far away) and back: the clock restarts — standing NPC.
    const b = baue(stehend);
    b.lauf(NAH, 1.5);
    b.lauf(FERN, 0.5);
    b.lauf(NAH, 1.0);
    check('standing NPC: 1.5 s + target lost + 1.0 s is no blow (the clock restarted)', b.ereignisse(0).length === 0, b.ereignisse(0).join(' '));
    b.lauf(NAH, 1.5);
    check('...and it strikes 2 s after the return', b.ereignisse(0).join(' ') === 'attack#1', b.ereignisse(0).join(' '));
    g.localStorage = altLS;
  }
  {
    // The same for an NPC that walks a route (the other draw path of the preview).
    const b = baue(laeufer);
    b.lauf(NAH, 10);
    const ev = b.ereignisse(0);
    check('a route walker in striking range writes the blow events too: attack#1 .. attack#5', ev.join(' ') === 'attack#1 attack#2 attack#3 attack#4 attack#5', ev.join(' '));
    const c = baue(laeufer);
    c.lauf(NAH, 1.5);
    c.lauf(FERN, 0.5);
    c.lauf(NAH, 1.0);
    check('route walker: 1.5 s + target lost + 1.0 s is no blow (the clock restarted)', c.ereignisse(0).length === 0, c.ereignisse(0).join(' '));
    g.localStorage = altLS;
  }
}

// ── [9] Hand-over in the editor test flight and in instantiate ──────────
console.log('\n[9] Testflug hand-over (animEinmal) and AssetManager.instantiate');
{
  const { platzierungsUpdate, vorschauZeichner } = await import('../src/editor/testflug/vorschauZeichnen.js');
  const u = platzierungsUpdate({ prefab: 'FurlocKrieger', x: 1, z: 2, anim: 'attack', animEinmal: 'attack#3' }, 4, 10, null);
  check('the update for the entity layer carries animEinmal', u.animEinmal === 'attack#3' && u.anim === 'attack' && u.key === 'edplace-4', JSON.stringify(u));
  check('...and no animEinmal member when there is none (walk/idle frames)', !('animEinmal' in platzierungsUpdate({ prefab: 'FurlocKrieger', x: 1, z: 2, anim: 'walk' }, 4, 10, null)));
  const gezeigt: { animEinmal?: string; anim?: string; i: number }[] = [];
  const zeichne = vorschauZeichner((p, i) => void gezeigt.push({ animEinmal: p.animEinmal, anim: p.anim, i }));
  zeichne(2, { prefab: 'FurlocKrieger' }, 0, 0, 0, 'attack', 'attack#5');
  check("the preview's zeichne callback passes the event on to zeige()", gezeigt[0]?.animEinmal === 'attack#5' && gezeigt[0]?.anim === 'attack' && gezeigt[0]?.i === 2, JSON.stringify(gezeigt));

  // The real instantiate with a stub container: the group of the first sight.
  const { AssetManager } = await import('../src/engine/AssetManager.js');
  const { TransformNode } = await import('@babylonjs/core/Meshes/transformNode.js');
  const { AbstractMesh } = await import('@babylonjs/core/Meshes/abstractMesh.js');
  const am = Object.create(AssetManager.prototype) as unknown as {
    animGruppen: WeakMap<object, unknown[]>;
    mehrdeutigGemeldet: Set<string>;
    einmalMarke: WeakMap<object, number>;
    loadContainer(name: string, key: string): Promise<unknown>;
    fixupMaterial(): Promise<void>;
    instantiate(name: string, animation?: string): Promise<unknown>;
  };
  am.animGruppen = new WeakMap();
  am.mehrdeutigGemeldet = new Set();
  am.einmalMarke = new WeakMap();
  am.fixupMaterial = async () => {};
  const aufrufe: string[] = [];
  const gruppen = ['Run_02', 'Running', 'Walking'].map((name) => ({
    name,
    stop() { aufrufe.push(`stop(${name})`); },
    start() { aufrufe.push(`start(${name})`); },
  }));
  const netz = Object.assign(Object.create(AbstractMesh.prototype) as object, {
    name: 'body', isPickable: true, getTotalVertices: () => 3, setEnabled() {},
  });
  Object.defineProperty(netz, 'material', { value: null, writable: true }); // an accessor on the prototype: set it as an own property
  const wurzel = Object.assign(Object.create(TransformNode.prototype) as object, {
    name: '__root__', getChildMeshes: () => [netz], dispose() {},
  });
  am.loadContainer = async () => ({ instantiateModelsToScene: () => ({ rootNodes: [wurzel], animationGroups: gruppen }) });
  const inst = async (animation: string, modell = 'npc_1_walk'): Promise<{ start: string[]; meldungen: string[] }> => {
    aufrufe.length = 0;
    const meldungen: string[] = [];
    const alt = console.error;
    console.error = (...a: unknown[]) => void meldungen.push(a.join(' '));
    await am.instantiate(modell, animation);
    console.error = alt;
    return { start: aufrufe.filter((x) => x.startsWith('start(')), meldungen };
  };
  const w = await inst('walk');
  check("instantiate('npc_1_walk', 'walk') starts Walking (the old case-sensitive search fell back to Run_02)", w.start.join() === 'start(Walking)', w.start.join());
  const r = await inst('run');
  check("instantiate(..., 'run') is ambiguous: nothing starts, reported with the MODEL name, not '__root__'", r.start.length === 0 && r.meldungen.length === 1 && /'npc_1_walk'/.test(r.meldungen[0] ?? '') && !/__root__/.test(r.meldungen[0] ?? ''), `${r.start.length} started, ${r.meldungen[0] ?? 'no message'}`);
  const r2 = await inst('run', 'anderes_modell');
  check('a second model with the same wish is reported too', r2.meldungen.length === 1 && /'anderes_modell'/.test(r2.meldungen[0] ?? ''), `${r2.meldungen.length}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
