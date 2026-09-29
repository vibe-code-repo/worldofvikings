/**
 * startAudioEngine (client/src/engine/Audio/StartAudio.ts): a rejecting
 * `create` must warn exactly once and never surface as an unhandled
 * rejection; a resolving one hands the engine to `onReady`; a throwing
 * `onReady` is also swallowed with one warning (karte B2 N3).
 *
 * Lauf: npx tsx client/test/audio-start.ts   (aus dem Repo-Wurzel)
 */
import { startAudioEngine } from '../src/engine/Audio/StartAudio';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

let unhandledRejections = 0;
process.on('unhandledRejection', (reason) => {
  unhandledRejections += 1;
  process.exitCode = 1;
  console.error('  UNHANDLED REJECTION:', reason);
});

const warnungen: unknown[][] = [];
console.warn = (...a: unknown[]) => { warnungen.push(a); };
const tick = () => new Promise<void>((r) => setTimeout(r, 20));

async function main(): Promise<void> {
  let bereit = 0;
  startAudioEngine(() => Promise.reject(new Error('kein Geraet')), () => { bereit += 1; });
  await tick();
  pruefe('create rejects: one warning', warnungen.length === 1, `n=${warnungen.length}`);
  pruefe('create rejects: text names AudioEngine.create',
    String(warnungen[0]?.[0] ?? '').includes('AudioEngine.create failed'));
  pruefe('create rejects: onReady not called', bereit === 0);

  warnungen.length = 0;
  let engine: string | null = null;
  startAudioEngine(() => Promise.resolve('motor'), (e) => { engine = e; });
  await tick();
  pruefe('create resolves: onReady gets engine', engine === 'motor');
  pruefe('create resolves: no warning', warnungen.length === 0);

  warnungen.length = 0;
  startAudioEngine(() => Promise.resolve(1), () => { throw new Error('onReady kaputt'); });
  await tick();
  pruefe('onReady throws: one warning', warnungen.length === 1, `n=${warnungen.length}`);

  await tick();
  pruefe('no unhandledRejection', unhandledRejections === 0, `n=${unhandledRejections}`);
  if (fehler > 0) { console.error(`${fehler} Pruefung(en) fehlgeschlagen`); process.exit(1); }
  console.log('OK');
}
void main();
