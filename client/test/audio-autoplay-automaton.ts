/**
 * AutoplayAutomaton (client/src/engine/Audio/AutoplayAutomaton.ts): the
 * six-state automaton that gates playback until the browser's autoplay
 * rule is satisfied. Pure state logic, no AudioContext. Checks the
 * required starting -> blocked -> unlocked path, the direct-unlock path
 * (context already running), both failure branches, and that
 * out-of-order events are ignored rather than corrupting the state.
 *
 * Lauf: npx tsx client/test/audio-autoplay-automaton.ts   (aus dem Repo-Wurzel)
 */
import { AutoplayAutomaton, type AutoplayState } from '../src/engine/Audio/AutoplayAutomaton';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

console.log('=== AutoplayAutomaton ===');

console.log('\n[1] Pflichtpfad starting -> blocked -> unlocked (mit loading/unlocking dazwischen):');
{
  const verlauf: AutoplayState[] = [];
  const a = new AutoplayAutomaton((s) => verlauf.push(s));
  pruefe('Startzustand ist starting', a.current === 'starting');
  a.beginBuildup();
  a.contextReady('suspended');
  a.gesture();
  a.resumeSucceeded();
  pruefe('Endzustand ist unlocked', a.current === 'unlocked');
  pruefe(
    'Verlauf enthält starting -> ... -> blocked -> ... -> unlocked in der Reihenfolge',
    verlauf.indexOf('blocked') !== -1 &&
      verlauf.indexOf('blocked') < verlauf.indexOf('unlocked') &&
      verlauf[0] !== 'blocked',
    verlauf.join(' -> '),
  );
  pruefe('vollständiger Verlauf: loading, blocked, unlocking, unlocked', verlauf.join(',') === 'loading,blocked,unlocking,unlocked', verlauf.join(','));
}

console.log('\n[2] Direkter Pfad: Kontext war schon running -> sofort unlocked, ohne blocked:');
{
  const verlauf: AutoplayState[] = [];
  const a = new AutoplayAutomaton((s) => verlauf.push(s));
  a.beginBuildup();
  a.contextReady('running');
  pruefe('unlocked ohne Umweg über blocked', a.current === 'unlocked' && !verlauf.includes('blocked'), verlauf.join(','));
}

console.log('\n[3] Fehlerpfad beim Aufbau:');
{
  const a = new AutoplayAutomaton();
  a.beginBuildup();
  a.buildupFailed();
  pruefe('failed nach buildupFailed()', a.current === 'failed');
}

console.log('\n[4] Fehlerpfad beim Entsperren:');
{
  const a = new AutoplayAutomaton();
  a.beginBuildup();
  a.contextReady('suspended');
  a.gesture();
  a.resumeFailed();
  pruefe('failed nach resumeFailed()', a.current === 'failed');
}

console.log('\n[5] Ereignisse ausserhalb ihres Zustands werden ignoriert:');
{
  const a = new AutoplayAutomaton();
  a.gesture(); // vor blocked -- darf nichts tun
  pruefe('gesture() vor blocked bleibt bei starting', a.current === 'starting');
  a.resumeSucceeded(); // vor unlocking -- darf nichts tun
  pruefe('resumeSucceeded() vor unlocking bleibt bei starting', a.current === 'starting');
  a.beginBuildup();
  a.contextReady('running');
  a.gesture(); // schon unlocked -- darf nichts mehr aendern
  pruefe('gesture() nach unlocked bleibt bei unlocked', a.current === 'unlocked');
}

if (fehler > 0) {
  console.error(`\n=== AutoplayAutomaton: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== AutoplayAutomaton: ALLE GRÜN ===');
