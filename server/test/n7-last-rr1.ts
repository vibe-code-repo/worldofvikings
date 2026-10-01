/** Messung N2: Spaetlauf eines 50-ms-Takts waehrend des Neubaus und einer Anlege-/Loeschflut. ANGRIFF_N=10000|100000 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Kontendatenbank } from '../src/konto/Kontendatenbank.js';
import { Armory, ARMORY_NEUBAU_MIN_MS, ARMORY_CACHE_MS } from '../src/konto/Armory.js';

const N = Number(process.env.ANGRIFF_N ?? 10_000);
const NAMEN = process.env.NAMEN ?? 'normal';
let zz = 777;
const cjkName = (): string => Array.from({ length: 24 }, () => { zz = (Math.imul(zz, 1103515245) + 12345) & 0x7fffffff; return String.fromCharCode(0x4e00 + (zz % 20_000)); }).join('');
const ordner = mkdtempSync(join(process.env.ANGRIFF_TMP ?? '/var/tmp', 'ruestkammer-r1-n2-'));
process.on('exit', () => rmSync(ordner, { recursive: true, force: true }));
const db = new Kontendatenbank(join(ordner, 'konten.db'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const roh = (db as any).db as { exec(s: string): void; prepare(s: string): { run(...a: unknown[]): unknown } };
const aus = { figur: 'wikingerin', frisur: 'H_01', haarfarbe: 'mittelbraun', augenfarbe: 'fjordblau', ober: '', beine: '', klasse: 'krieger' };
const t0 = performance.now();
roh.exec('BEGIN');
const kontoIds: number[] = [];
for (let i = 0; i < N / 4; i++) {
  const k = db.kontoAnlegen(`konto${i}`, `k${i}@example.org`, 'x');
  if (!k.ok) throw new Error('Konto');
  kontoIds.push(k.konto.id);
  for (let j = 0; j < 4; j++) {
    const r = db.charakterAnlegen(k.konto.id, NAMEN === 'cjk' ? cjkName() : `Recke ${i}-${j}`, aus);
    if (!r.ok) throw new Error('Charakter');
    roh.prepare('UPDATE charaktere SET zuletzt_gespielt = ? WHERE id = ?').run(1_700_000_000_000 + ((i * 7919 + j * 31) % 1_000_003), r.charakter.id);
  }
}
roh.exec('COMMIT');
console.log(`Bestand ${N} Charaktere, Aufbau ${((performance.now() - t0) / 1000).toFixed(1)} s`);

await new Promise<void>((ok) => setTimeout(ok, 3000)); // Muell des Aufbaus (Massenanlage) vor der Messung abraeumen lassen
let jetzt = 10_000_000_000;
const a = new Armory(db, []);
a.uhr = () => jetzt;

/** Takt von 50 ms; liefert den groessten Spaetlauf und die Zahl der Ticks ueber 20 ms. */
function takt(): { stopp(): { maxSpaet: number; ueber20: number; ticks: number } } {
  let letzte = performance.now();
  let maxSpaet = 0;
  let ueber20 = 0;
  let ticks = 0;
  const h = setInterval(() => {
    const t = performance.now();
    const spaet = t - letzte - 50;
    letzte = t;
    ticks++;
    if (spaet > maxSpaet) maxSpaet = spaet;
    if (spaet > 20) ueber20++;
  }, 50);
  return { stopp: () => { clearInterval(h); return { maxSpaet, ueber20, ticks }; } };
}

// 1. erster Aufbau
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gc = (globalThis as any).gc as (() => void) | undefined;
  gc?.();
  const heap0 = process.memoryUsage();
  const m = takt();
  const s = performance.now();
  a.liste('1', '');
  await a.bereit();
  const d = performance.now() - s;
  const r = m.stopp();
  console.log(`N1 erster Aufbau: ${d.toFixed(0)} ms Wanduhr, ${a.statistik.schritte} Haeppchen, laengstes ${a.statistik.laengsterSchrittMs.toFixed(1)} ms, Takt hoechstens ${r.maxSpaet.toFixed(1)} ms zu spaet, ${r.ueber20}/${r.ticks} Ticks > 20 ms; gesamt ${a.liste('1', '')!.gesamt}`);
  gc?.();
  const heap1 = process.memoryUsage();
  console.log(`N6 Namen ${NAMEN}: Index ${(a.statistik.indexBytes / 1e6).toFixed(1)} MB (Int32Array), Zuwachs durch den ganzen Stand: Heap ${((heap1.heapUsed - heap0.heapUsed) / 1e6).toFixed(1)} MB, ArrayBuffers ${((heap1.arrayBuffers - heap0.arrayBuffers) / 1e6).toFixed(1)} MB`);
}
// 2. Neubau nach Ablauf der Frist, waehrend Anfragen laufen
for (let lauf = 0; lauf < 3; lauf++) {
  a.statistik.schritte = 0; a.statistik.laengsterSchrittMs = 0;
  jetzt += ARMORY_CACHE_MS + 1;
  const m = takt();
  const s = performance.now();
  let anfragen = 0;
  a.liste('1', 'recke');
  while ((a as unknown as { lauf: unknown }).lauf) { a.liste('1', `recke ${anfragen % 50}`); anfragen++; await new Promise<void>((ok) => setImmediate(ok)); }
  const d = performance.now() - s;
  const r = m.stopp();
  console.log(`N2 Neubau ${lauf + 1}: ${d.toFixed(0)} ms Wanduhr, ${a.statistik.schritte} Haeppchen, laengstes ${a.statistik.laengsterSchrittMs.toFixed(1)} ms, ${anfragen} Anfragen waehrenddessen, Takt hoechstens ${r.maxSpaet.toFixed(1)} ms zu spaet, ${r.ueber20}/${r.ticks} Ticks > 20 ms`);
}
// 3. Suchflut: Takt waehrend dauernder Suchanfragen (wechselnd und gleich), 5 s je Fall, plus Kosten je Anfrage
async function suchflut(name: string, q: (i: number) => string, seite: (i: number) => string): Promise<void> {
  const m = takt();
  const ende = performance.now() + 5000;
  let n = 0;
  const k0 = a.statistik.suchKandidaten;
  const s0 = performance.now();
  while (performance.now() < ende) {
    a.liste(seite(n), q(n));
    n++;
    if ((n & 15) === 0) await new Promise<void>((ok) => setImmediate(ok)); // andere Arbeit des Fadens kommt dazwischen
  }
  const d = performance.now() - s0;
  const r = m.stopp();
  console.log(`N4 Suchflut ${name}: ${n} Anfragen in ${d.toFixed(0)} ms (${(d / n * 1000).toFixed(1)} us je Anfrage), ${((a.statistik.suchKandidaten - k0) / n).toFixed(0)} Kandidaten je Anfrage, Takt hoechstens ${r.maxSpaet.toFixed(1)} ms zu spaet, ${r.ueber20}/${r.ticks} Ticks > 20 ms`);
}
await suchflut('q=recke, wechselnde seite', () => 'recke', (i) => String(1 + (i % 500)));
await suchflut('wechselnde q (recke 1..)', (i) => `recke ${i}`, () => '1');
await suchflut('wechselnde q (nur eine Ziffer/Zeichenfolge, unselektiv)', (i) => `e ${(i % 97).toString(36)}${(i >> 3).toString(36)}`, () => '1');
await suchflut('wechselnde q, 3 Zeichen aus dem Alphabet', (i) => `${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'ecr'[(i >> 5) % 3]}${'ke -0123456789'[(i >> 7) % 14]}`, () => '1');
{
  const h0 = process.memoryUsage().heapUsed;
  console.log(`N5 Heap jetzt ${(h0 / 1e6).toFixed(0)} MB (Stand mit Index fuer ${N} Charaktere, plus Ergebnis-Puffer)`);
}
