/**
 * ShuffleBag (client/src/engine/Audio/ShuffleBag.ts): a clip group must
 * never repeat the same clip twice in a row, including across a refill
 * boundary — the failure mode a plain Fisher-Yates-per-batch shuffle has.
 * Pure, DOM-free.
 *
 * Lauf: npx tsx client/test/audio-shuffle-bag.ts   (aus dem Repo-Wurzel)
 */
import { ShuffleBag } from '../src/engine/Audio/ShuffleBag';

let fehler = 0;
function pruefe(name: string, an: boolean, detail = ''): void {
  if (an) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler += 1;
  }
}

console.log('=== ShuffleBag ===');

// Seeded PRNG (mulberry32) statt Math.random -- reproduzierbar.
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('\n[1] Nie zweimal hintereinander (viele Ziehungen, mehrere Seeds):');
{
  const items = ['a', 'b', 'c', 'd', 'e'];
  for (let seed = 1; seed <= 20; seed += 1) {
    const bag = new ShuffleBag(items, seededRandom(seed));
    let vorher: string | undefined;
    let wiederholungen = 0;
    for (let i = 0; i < 500; i += 1) {
      const wert = bag.next();
      if (wert === vorher) wiederholungen += 1;
      vorher = wert;
    }
    pruefe(`Seed ${seed}: keine Wiederholung über 500 Ziehungen`, wiederholungen === 0, `${wiederholungen} Treffer`);
  }
}

console.log('\n[2] Jedes Element kommt in jedem Batch von 5 genau einmal vor:');
{
  const items = ['x', 'y', 'z'];
  const bag = new ShuffleBag(items, seededRandom(7));
  for (let batch = 0; batch < 10; batch += 1) {
    const gezogen = [bag.next(), bag.next(), bag.next()];
    const sortiert = [...gezogen].sort();
    pruefe(`Batch ${batch}: alle drei Elemente, keins doppelt`, JSON.stringify(sortiert) === JSON.stringify(['x', 'y', 'z']), sortiert.join(','));
  }
}

console.log('\n[3] Ein einzelnes Element wiederholt sich zwangsläufig, ohne zu werfen:');
{
  const bag = new ShuffleBag(['solo'], seededRandom(3));
  let ok = true;
  for (let i = 0; i < 10; i += 1) {
    if (bag.next() !== 'solo') ok = false;
  }
  pruefe('kein Absturz, immer dasselbe Element', ok);
}

console.log('\n[4] Leerer Pool wirft beim Erzeugen:');
{
  let geworfen = false;
  try {
    new ShuffleBag([]);
  } catch {
    geworfen = true;
  }
  pruefe('leerer Pool wirft', geworfen);
}

if (fehler > 0) {
  console.error(`\n=== ShuffleBag: ${fehler} PRÜFUNG(EN) FEHLGESCHLAGEN ===`);
  process.exit(1);
}
console.log('\n=== ShuffleBag: ALLE GRÜN ===');
