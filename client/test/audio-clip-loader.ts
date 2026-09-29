/**
 * ClipLoader (client/src/engine/Audio/ClipLoader.ts): a failing clip
 * load must resolve to null, warn exactly once per key, and — the
 * point of this test — never surface as an unhandled promise rejection
 * (karte B2 N1, Befund B2: the shipped `void AudioEngine.create(...)
 * .then(...)` had no `.catch`, and loadClip had no failure handling at
 * all). `process.on('unhandledRejection', ...)` counts real rejections
 * during the run; a broken `loadWithWarnOnce` would show up there, not
 * just in a thrown assertion.
 *
 * Lauf: npx tsx client/test/audio-clip-loader.ts   (aus dem Repo-Wurzel)
 */
import { loadWithWarnOnce } from '../src/engine/Audio/ClipLoader';

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

async function lauf(): Promise<void> {
  console.log('=== ClipLoader ===');

  console.log('\n[1] Ein fehlschlagender Ladeversuch liefert null, wirft nicht:');
  {
    const warned = new Set<string>();
    const fehlschlaege: Array<[string, unknown]> = [];
    const ergebnis = await loadWithWarnOnce(
      'klip-404',
      () => Promise.reject(new Error('404')),
      warned,
      (key, err) => fehlschlaege.push([key, err]),
    );
    pruefe('Ergebnis ist null', ergebnis === null);
    pruefe('onFail genau einmal aufgerufen', fehlschlaege.length === 1, JSON.stringify(fehlschlaege.map(([k]) => k)));
    pruefe('warned-Set enthält den Schlüssel danach', warned.has('klip-404'));
  }

  console.log('\n[2] Wiederholte Fehlschläge desselben Klips warnen nur einmal:');
  {
    const warned = new Set<string>();
    const fehlschlaege: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await loadWithWarnOnce('klip-immer-kaputt', () => Promise.reject(new Error('decode')), warned, (key) => fehlschlaege.push(key));
    }
    pruefe('nur eine Warnung über 5 Versuche', fehlschlaege.length === 1, `${fehlschlaege.length} Warnungen`);
  }

  console.log('\n[3] Ein erfolgreicher Ladeversuch liefert den Wert, warnt nie:');
  {
    const warned = new Set<string>();
    let gewarnt = false;
    const ergebnis = await loadWithWarnOnce('klip-ok', () => Promise.resolve('sound-objekt'), warned, () => {
      gewarnt = true;
    });
    pruefe('Ergebnis kommt durch', ergebnis === 'sound-objekt');
    pruefe('keine Warnung bei Erfolg', !gewarnt);
  }

  console.log('\n[4] Verschiedene Schlüssel warnen unabhängig voneinander:');
  {
    const warned = new Set<string>();
    const fehlschlaege: string[] = [];
    await loadWithWarnOnce('a', () => Promise.reject(new Error('x')), warned, (key) => fehlschlaege.push(key));
    await loadWithWarnOnce('b', () => Promise.reject(new Error('x')), warned, (key) => fehlschlaege.push(key));
    await loadWithWarnOnce('a', () => Promise.reject(new Error('x')), warned, (key) => fehlschlaege.push(key));
    pruefe('a und b je einmal, a beim zweiten Versuch nicht erneut', fehlschlaege.sort().join(',') === 'a,b', fehlschlaege.join(','));
  }

  // Eine Tick-Pause, damit ein evtl. unhandled rejection-Ereignis (das
  // Node asynchron nach dem Reject feuert) sicher vor der Auswertung ankommt.
  await new Promise((resolve) => setTimeout(resolve, 50));

  console.log('\n[5] Keine einzige unhandled rejection über den ganzen Lauf:');
  pruefe('process "unhandledRejection" wurde nie ausgelöst', unhandledRejections === 0, `${unhandledRejections} Ereignisse`);

  if (fehler > 0) {
    console.error(`\n=== ClipLoader: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
    process.exit(1);
  }
  console.log('\n=== ClipLoader: ALLE GRÜN ===');
}

lauf().catch((e) => {
  console.error(e);
  process.exit(1);
});
