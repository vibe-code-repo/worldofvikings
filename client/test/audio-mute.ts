/**
 * PlaybackGate (client/src/engine/Audio/PlaybackGate.ts): `?mute=1`
 * (main.ts -> AudioEngine.create({ muted })) must silence every bus, in
 * every autoplay state — not just once the browser has unlocked audio.
 * AudioEngine.playAsync calls this predicate directly, so this is the
 * actual mute gate, not a stand-in. Pure, DOM-free.
 *
 * Lauf: npx tsx client/test/audio-mute.ts   (aus dem Repo-Wurzel)
 */
import { isPlaybackAllowed } from '../src/engine/Audio/PlaybackGate';
import type { AutoplayState } from '../src/engine/Audio/AutoplayAutomaton';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

console.log('=== PlaybackGate (?mute=1) ===');

const ALLE_ZUSTAENDE: AutoplayState[] = ['starting', 'loading', 'blocked', 'unlocking', 'unlocked', 'failed'];

console.log('\n[1] Muted bleibt in jedem Zustand stumm, auch unlocked:');
{
  for (const zustand of ALLE_ZUSTAENDE) {
    pruefe(`muted + ${zustand} -> kein Abspielen`, isPlaybackAllowed(zustand, true) === false);
  }
}

console.log('\n[2] Unmuted spielt nur im Zustand unlocked:');
{
  for (const zustand of ALLE_ZUSTAENDE) {
    const erwartet = zustand === 'unlocked';
    pruefe(`unmuted + ${zustand} -> ${erwartet ? 'darf' : 'darf nicht'} abspielen`, isPlaybackAllowed(zustand, false) === erwartet);
  }
}

console.log('\n[3] unlocked + unmuted ist der einzige erlaubte Fall:');
{
  const erlaubt = ALLE_ZUSTAENDE.flatMap((zustand) => [true, false].map((muted) => ({ zustand, muted, ergebnis: isPlaybackAllowed(zustand, muted) })))
    .filter((f) => f.ergebnis);
  pruefe('genau eine erlaubte Kombination', erlaubt.length === 1 && erlaubt[0].zustand === 'unlocked' && erlaubt[0].muted === false, JSON.stringify(erlaubt));
}

if (fehler > 0) {
  console.error(`\n=== PlaybackGate: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== PlaybackGate: ALLE GRÜN ===');
