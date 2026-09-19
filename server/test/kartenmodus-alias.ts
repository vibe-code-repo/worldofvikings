/**
 * Kartenmodus: `world.mode: radial` und der Altname (Alias).
 *
 * Der radiale Modus hiess frueher `valheim`. Der neue Name ist `radial`; der
 * alte bleibt als Alias gueltig: `leseServerKonfig` meldet genau EINE Warnung
 * und normalisiert auf `radial`. Der Wert steht in keinem Spielstand, keinem
 * Weltdokument und keinem Netzpaket — er darf also nur die Konfiguration
 * betreffen, nie die Welt. Geprueft wird deshalb der ganze Weg:
 *
 *  1. server.yml mit dem Altnamen und mit dem neuen Namen ergibt dieselbe
 *     ServerConfig-Zeile (`worldMode: 'radial'`); nur der Altname warnt,
 *     und zwar genau einmal.
 *  2. Beide fuehren ueber `createGeo` in dieselbe Welt: derselbe Seed liefert
 *     an drei Punkten dieselbe Hoehe, bitgleich — und die Werte stimmen mit
 *     denen ueberein, die der Stand vor der Umbenennung geliefert hat.
 *  3. `layout` bleibt `layout`; ein fehlender oder unbekannter Wert bleibt
 *     wie bisher radial, ohne Alias-Warnung.
 *
 * Lauf: npx tsx test/kartenmodus-alias.ts   (aus server/)
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo, getStableHash } from '@wov/shared';
import { leseServerKonfig, weltmodusAusWert } from '../src/ServerKonfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALTNAME = ['valhe', 'im'].join('');
const SEED = 'KxSYuZquuw';
/** Hoehen des Standes VOR der Umbenennung (Modus damals `valheim`), Seed `KxSYuZquuw`. */
const HOEHEN_VORHER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 36.052001953125],
  [1234.5, -987.25, 2.034379005432129],
  [-4321, 2500, 29.109806060791016],
];

let fehler = 0;
function pruefe(name: string, bedingung: boolean, detail = ''): void {
  if (bedingung) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    fehler++;
  }
}

/** Liest eine server.yml mit `world.mode: <wert>` und sammelt die Warnungen des Lesens. */
function liesMit(wert: string | null): { konfig: ReturnType<typeof leseServerKonfig>; warnungen: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'wov-kartenmodus-'));
  const warnungen: string[] = [];
  const echteWarnung = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnungen.push(args.map(String).join(' '));
  };
  try {
    mkdirSync(join(dir, 'welten'), { recursive: true });
    // Fuer `layout` muss die Weltdatei da sein, sonst beendet leseServerKonfig den Prozess (bewusst).
    copyFileSync(resolve(__dirname, '../data/welten/dev.json'), join(dir, 'welten', 'test.json'));
    const modus = wert === null ? '' : `  mode: ${wert}\n`;
    writeFileSync(join(dir, 'server.yml'), `server:\n  name: Test\nworld:\n${modus}  seed: ${SEED}\n`, 'utf-8');
    return { konfig: leseServerKonfig(dir, 'test'), warnungen };
  } finally {
    console.warn = echteWarnung;
    rmSync(dir, { recursive: true, force: true });
  }
}
const aliasWarnungen = (w: string[]): string[] => w.filter((t) => t.includes(ALTNAME));

console.log('\n[1] Altname und neuer Name ergeben dieselbe Konfiguration');
const alt = liesMit(ALTNAME);
const neu = liesMit('radial');
pruefe('Altname wird auf radial normalisiert', alt.konfig.worldMode === 'radial', String(alt.konfig.worldMode));
pruefe('neuer Name bleibt radial', neu.konfig.worldMode === 'radial', String(neu.konfig.worldMode));
pruefe('Altname: genau eine Warnung', aliasWarnungen(alt.warnungen).length === 1, `${alt.warnungen.length} Warnung(en) gesamt`);
pruefe('Altname: die Warnung nennt den neuen Namen', aliasWarnungen(alt.warnungen)[0]?.includes('"radial"') ?? false);
pruefe('neuer Name: keine Warnung', neu.warnungen.length === 0, neu.warnungen.join(' | '));
// Pfade zeigen in je ein eigenes Wegwerfverzeichnis, alles andere muss gleich sein.
const ohnePfade = (k: ReturnType<typeof leseServerKonfig>): string =>
  JSON.stringify(Object.entries(k).filter(([, v]) => !(typeof v === 'string' && v.includes('wov-kartenmodus-'))));
pruefe('sonst identisch (alle Felder der ServerConfig ausser den Wegwerfpfaden)', ohnePfade(alt.konfig) === ohnePfade(neu.konfig));
// Zwei Lesevorgaenge, zwei Warnungen: die Warnung gehoert zum Lesen, sie ist keine globale Einmal-Sperre,
// die einen zweiten Start still verschluckt.
pruefe('zweites Lesen warnt wieder genau einmal', aliasWarnungen(liesMit(ALTNAME).warnungen).length === 1);

console.log('\n[2] Beide Namen erzeugen dieselbe Welt (derselbe Seed, dieselbe Hoehe)');
const geoAlt = createGeo({ mode: alt.konfig.worldMode!, worldSeed: getStableHash(SEED) });
const geoNeu = createGeo({ mode: neu.konfig.worldMode!, worldSeed: getStableHash(SEED) });
for (const [x, y, vorher] of HOEHEN_VORHER) {
  const a = geoAlt.getHeight(x, y);
  const n = geoNeu.getHeight(x, y);
  pruefe(`(${x}, ${y}): Alias und neuer Name bitgleich`, Object.is(a, n), `${a} / ${n}`);
  pruefe(`(${x}, ${y}): wie vor der Umbenennung`, Object.is(a, vorher), `${a} gegen ${vorher}`);
}

console.log('\n[3] layout bleibt layout, Unbekanntes bleibt wie bisher radial');
const layout = liesMit('layout');
pruefe('layout bleibt layout', layout.konfig.worldMode === 'layout', String(layout.konfig.worldMode));
pruefe('layout: keine Alias-Warnung', aliasWarnungen(layout.warnungen).length === 0);
const ohne = liesMit(null);
pruefe('ohne Eintrag: radial', ohne.konfig.worldMode === 'radial', String(ohne.konfig.worldMode));
const tippfehler = liesMit('radal');
pruefe('unbekannter Wert: radial, ohne Alias-Warnung', tippfehler.konfig.worldMode === 'radial' && aliasWarnungen(tippfehler.warnungen).length === 0);
for (const [wert, erwartet] of [
  ['layout', 'layout'],
  ['radial', 'radial'],
  [ALTNAME, 'radial'],
  [undefined, 'radial'],
  [null, 'radial'],
  [42, 'radial'],
  ['Layout', 'radial'],
] as const) {
  const echteWarnung = console.warn;
  console.warn = (): void => undefined;
  try {
    pruefe(`weltmodusAusWert(${JSON.stringify(wert) ?? 'undefined'}) = ${erwartet}`, weltmodusAusWert(wert) === erwartet);
  } finally {
    console.warn = echteWarnung;
  }
}

if (fehler === 0) {
  console.log('\n=== Kartenmodus-Alias: ALLE PRUEFUNGEN BESTANDEN ===');
} else {
  console.error(`\n=== Kartenmodus-Alias: ${fehler} FEHLER ===`);
  process.exit(1);
}
