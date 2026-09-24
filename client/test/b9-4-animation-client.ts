/**
 * B9.4 — the client side of the animation path that needs no scene.
 *
 *  [1] The diagnostic hooks (dynMasse, dynSprung) leave the
 *      animation as they found it: ten calls, exactly one group playing.
 *      The old hooks started the measured clip and never stopped it.
 *  [2] The one-shot member format (`<clip>#<n>`): parse, count up, refuse junk.
 *  [3] The group search: exact before partial, two partial hits are ambiguous.
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
