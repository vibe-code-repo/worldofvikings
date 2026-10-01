/**
 * Entfernte Vegetation V1 (Bäume entfernen): Feld `WorldLayout.vegetationEntfernt` — Sanitizer, Fehlerweg, Prüfer,
 * Baum-Einteilung, Text/Hash, Arbeitskopie.
 * Removed vegetation V1: sanitizer, error path (never a silent drop), grid checker, tree classification, text/hash,
 * working copy.
 *
 *   npx tsx test/vegetation-entfernt.ts   (from shared/)
 *
 * Geprüft:
 *  1. Sanitizer: gültig, Grenzen (Radius 0,5…50, Weltrahmen, 4096 Kreise), kaputt → `vegetationProblem` (nie still
 *     verworfen), fehlendes/leeres Feld → Dokument wie vor dem Feld.
 *  2. `vegetationPruefer.istEntfernt`: Rand zählt dazu, `nur: 'baeume'`, Zellgrenzen, viele Kreise gegen Brute Force.
 *  3. `streuArt`: die Baum-Liste über ALLE Streu-Prefabs (FOLIAGE) steht hier ausgeschrieben.
 *  4. Text-Rundreise und Hash; Schreibweg lehnt Kaputtes ab (`LayoutVegetationUngueltig`), Lesen mit Befund.
 *  5. Arbeitskopie: Dokumente, die sich NUR in den Kreisen unterscheiden, sind verschieden.
 *
 * Nichts wird nach server/data/ oder /var/lib/wov geschrieben (Temp-Verzeichnis).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { sanitizeWorldLayout, sanitizeWorldLayoutMitBericht } from '../src/worldlayout/sanitize.js';
import {
  VEGETATION_KREISE_MAX,
  streuArt,
  vegetationPruefer,
} from '../src/worldlayout/vegetationEntfernt.js';
import {
  LayoutUngueltig,
  LayoutVegetationUngueltig,
  layoutHash,
  layoutLesenMitHash,
  layoutSchreiben,
  layoutText,
} from '../src/worldlayout/layoutDatei.js';
import { basisDatei, kanonHash, weltAbgleichen } from '../src/worldlayout/weltArbeitskopie.js';
import { FOLIAGE } from '../src/vegetation.js';
import type { VegetationEntferntKreis } from '../src/worldlayout/types.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` (${detail})` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
}
const json = (v: unknown): string => JSON.stringify(v);

const basis = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  name: 'Vegetation-entfernt-Probe',
  detailSeed: 've',
  continents: [],
  regions: [{ id: 'kern', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
  ...extra,
});
const bericht = (veg: unknown) => sanitizeWorldLayoutMitBericht(basis({ vegetationEntfernt: veg }))!;

// ── 1) Sanitizer ───────────────────────────────────────────────────────
console.log('== 1 Sanitizer');
{
  const gueltig = [
    { x: 10, z: -20, r: 5 },
    { x: 0, z: 0, r: 0.5, nur: 'baeume' },
    { x: 1, z: 2, r: 50 },
    { x: 39999.5, z: -40000, r: 12.25, nur: 'baeume' },
  ];
  const b = bericht(gueltig);
  check('gültig: alle vier Kreise bleiben, in Reihenfolge', json(b.layout.vegetationEntfernt) === json(gueltig), json(b.layout.vegetationEntfernt));
  check('gültig: kein vegetationProblem', b.vegetationProblem === undefined);
  check('Idempotent: zweiter Durchgang ändert nichts', json(sanitizeWorldLayout(b.layout)!.vegetationEntfernt) === json(gueltig));
  check('nur: undefined zählt als fehlend (kein Schlüssel im Ergebnis)', !('nur' in bericht([{ x: 1, z: 1, r: 1, nur: undefined }]).layout.vegetationEntfernt![0]!));

  // Grenzen: genau getroffen
  check('Radius 0,5 und 50 sind gültig', bericht([{ x: 0, z: 0, r: 0.5 }, { x: 0, z: 0, r: 50 }]).vegetationProblem === undefined);
  check('Weltrahmen ±40000 ist gültig', bericht([{ x: 40000, z: -40000, r: 5 }]).vegetationProblem === undefined);
  const kaputt: Array<[string, unknown, string]> = [
    ['r 0,49', { x: 0, z: 0, r: 0.49 }, 'r'],
    ['r 50,01', { x: 0, z: 0, r: 50.01 }, 'r'],
    ['r 0', { x: 0, z: 0, r: 0 }, 'r'],
    ['r negativ', { x: 0, z: 0, r: -1 }, 'r'],
    ['r Infinity', { x: 0, z: 0, r: Infinity }, 'r'],
    ['r NaN', { x: 0, z: 0, r: NaN }, 'r'],
    ['r als Text', { x: 0, z: 0, r: '5' }, 'r'],
    ['r null', { x: 0, z: 0, r: null }, 'r'],
    ['r fehlt', { x: 0, z: 0 }, 'r'],
    ['x außerhalb', { x: 40001, z: 0, r: 5 }, 'x'],
    ['x negativ außerhalb', { x: -40001, z: 0, r: 5 }, 'x'],
    ['x NaN', { x: NaN, z: 0, r: 5 }, 'x'],
    ['x als Text', { x: '1', z: 0, r: 5 }, 'x'],
    ['z fehlt', { x: 0, r: 5 }, 'z'],
    ['nur "busch"', { x: 0, z: 0, r: 5, nur: 'busch' }, 'nur'],
    ['nur null', { x: 0, z: 0, r: 5, nur: null }, 'nur'],
    ['nur leer', { x: 0, z: 0, r: 5, nur: '' }, 'nur'],
    ['nur Liste', { x: 0, z: 0, r: 5, nur: ['baeume'] }, 'nur'],
    ['unbekannter Schlüssel', { x: 0, z: 0, r: 5, foo: 1 }, 'foo'],
    ['Tippfehler im Schlüssel', { x: 0, z: 0, R: 5 }, 'R'],
    ['Eintrag ist Text', 'kaputt', 'eintrag'],
    ['Eintrag ist null', null, 'eintrag'],
    ['Eintrag ist Liste', [1, 2, 3], 'eintrag'],
  ];
  for (const [name, eintrag, feld] of kaputt) {
    const k = bericht([eintrag]);
    const p = k.vegetationProblem;
    check(`kaputt → Problem, nicht still verworfen: ${name}`, p !== undefined && p.reason === 'invalid' && p.fehlerhaft.some((f) => f.feld === feld && f.eintrag === '#0'), json(p?.fehlerhaft));
    check(`  … und der Eintrag steht nicht im Layout: ${name}`, k.layout.vegetationEntfernt === undefined);
  }
  const gemischt = bericht([{ x: 1, z: 1, r: 1 }, { x: 2, z: 2, r: 99 }, { x: 3, z: 3, r: 3, nur: 'baeume' }]);
  check('gemischt: die gültigen bleiben, der Befund nennt genau #1', gemischt.layout.vegetationEntfernt?.length === 2 && gemischt.vegetationProblem?.fehlerhaft.length === 1 && gemischt.vegetationProblem.fehlerhaft[0]!.eintrag === '#1', json(gemischt.vegetationProblem?.fehlerhaft));
  for (const roh of ['kaputt', {}, 5, true, { x: 1, z: 1, r: 1 }]) {
    const b2 = bericht(roh);
    check(`Feld ist kein Array (${json(roh)}) → Problem, kein Kreis`, b2.vegetationProblem?.reason === 'invalid' && b2.layout.vegetationEntfernt === undefined);
  }
  // Obergrenze
  const viele = (n: number): VegetationEntferntKreis[] => Array.from({ length: n }, (_, i) => ({ x: i, z: 0, r: 1 }));
  const b4096 = bericht(viele(VEGETATION_KREISE_MAX));
  check(`${VEGETATION_KREISE_MAX} Kreise sind gültig`, b4096.vegetationProblem === undefined && b4096.layout.vegetationEntfernt?.length === VEGETATION_KREISE_MAX);
  const b4097 = bericht(viele(VEGETATION_KREISE_MAX + 1));
  check(`${VEGETATION_KREISE_MAX + 1} Kreise → Problem limit (am rohen Wert gezählt)`, b4097.vegetationProblem?.reason === 'limit' && b4097.vegetationProblem.anzahl === VEGETATION_KREISE_MAX + 1 && b4097.vegetationProblem.grenze === VEGETATION_KREISE_MAX);
  check('  … der Sanitizer kürzt dabei auf die Grenze (nur zusammen mit dem Problem)', b4097.layout.vegetationEntfernt?.length === VEGETATION_KREISE_MAX);
  // Fehlendes Feld: alles wie bisher
  const ohne = sanitizeWorldLayoutMitBericht(basis())!;
  check('Feld fehlt → kein Schlüssel, kein Problem', !('vegetationEntfernt' in ohne.layout) && ohne.vegetationProblem === undefined);
  for (const leer of [null, undefined, []]) {
    const l = sanitizeWorldLayoutMitBericht(basis({ vegetationEntfernt: leer }))!;
    check(`Feld ${json(leer) ?? 'undefined'} → Dokument identisch zu "Feld fehlt"`, json(l.layout) === json(ohne.layout) && l.vegetationProblem === undefined);
  }
}

// ── 2) Prüfer ───────────────────────────────────────────────────────────
console.log('== 2 vegetationPruefer');
{
  check('ohne Kreise: leer, nie entfernt', vegetationPruefer(undefined).leer && vegetationPruefer([]).leer && !vegetationPruefer([]).istEntfernt(0, 0, 'baum'));
  const p = vegetationPruefer([{ x: 10, z: 10, r: 5 }]);
  check('Mitte ist entfernt', p.istEntfernt(10, 10, 'baum') && p.istEntfernt(10, 10, 'sonstiges'));
  check('Rand (Abstand == r) zählt dazu', p.istEntfernt(15, 10, 'baum') && p.istEntfernt(10, 5, 'sonstiges') && p.istEntfernt(13, 14, 'baum'));
  check('knapp außerhalb (r + 0,001) ist stehen geblieben', !p.istEntfernt(15.001, 10, 'baum') && !p.istEntfernt(10, 4.999, 'sonstiges'));
  check('Kreis, kein Quadrat: Ecke des Umquadrats bleibt', !p.istEntfernt(14, 14, 'baum'));
  check('nicht endliche Abfrage ist nie entfernt', !p.istEntfernt(NaN, 10, 'baum') && !p.istEntfernt(10, Infinity, 'baum'));
  const nb = vegetationPruefer([{ x: 0, z: 0, r: 5, nur: 'baeume' }]);
  check('nur "baeume": Baum weg, Busch/Stein bleiben', nb.istEntfernt(1, 1, 'baum') && !nb.istEntfernt(1, 1, 'sonstiges'));
  const gemischt = vegetationPruefer([{ x: 0, z: 0, r: 5, nur: 'baeume' }, { x: 2, z: 0, r: 2 }]);
  check('Kreis ohne nur schlägt den Baumkreis: Busch im zweiten Kreis weg', gemischt.istEntfernt(2, 0, 'sonstiges') && !gemischt.istEntfernt(-4, 0, 'sonstiges'));
  // Zellgrenze (32 m) und negative Koordinaten
  const q = vegetationPruefer([{ x: 32, z: -32, r: 3 }, { x: -0.5, z: -0.5, r: 1 }]);
  check('Kreis über Zellgrenzen: beide Seiten treffen', q.istEntfernt(30.1, -32, 'baum') && q.istEntfernt(34.5, -33, 'baum') && q.istEntfernt(32, -29.1, 'baum') && q.istEntfernt(32, -34.9, 'baum'));
  check('Kreis über den Nullpunkt (negative Zellen)', q.istEntfernt(0.2, 0.2, 'baum') && q.istEntfernt(-1.2, -0.4, 'baum') && !q.istEntfernt(1.6, 0, 'baum'));
  // Viele Kreise gegen Brute Force
  let s = 123456789;
  const zufall = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const kreise: VegetationEntferntKreis[] = Array.from({ length: 3000 }, () => ({
    x: Math.round((zufall() - 0.5) * 4000 * 100) / 100,
    z: Math.round((zufall() - 0.5) * 4000 * 100) / 100,
    r: Math.round((0.5 + zufall() * 49.5) * 100) / 100,
    ...(zufall() < 0.4 ? { nur: 'baeume' as const } : {}),
  }));
  const viele = vegetationPruefer(kreise);
  let unterschied = 0;
  let treffer = 0;
  for (let i = 0; i < 40000; i++) {
    const x = (zufall() - 0.5) * 4100;
    const z = (zufall() - 0.5) * 4100;
    const art = zufall() < 0.5 ? 'baum' : 'sonstiges';
    const soll = kreise.some((k) => (k.nur !== 'baeume' || art === 'baum') && (x - k.x) ** 2 + (z - k.z) ** 2 <= k.r * k.r);
    if (soll) treffer++;
    if (viele.istEntfernt(x, z, art) !== soll) unterschied++;
  }
  check('3000 Kreise, 40000 Punkte: Raster = Brute Force', unterschied === 0 && treffer > 500, `${treffer} Treffer, ${unterschied} Abweichungen`);
  // Kosten: Raster hängt nicht an der Gesamtzahl
  const t0 = performance.now();
  for (let i = 0; i < 200000; i++) viele.istEntfernt((i % 4000) - 2000, ((i * 7) % 4000) - 2000, 'baum');
  const ms = performance.now() - t0;
  check('200000 Abfragen bei 3000 Kreisen unter 2 s', ms < 2000, `${ms.toFixed(0)} ms`);
}

// ── 3) Baum-Einteilung ────────────────────────────────────────────────────
console.log('== 3 streuArt');
{
  const BAUM_EIGEN = [
  'Eiche1', 'Eiche1Dick', 'Eiche2', 'Eiche2Dick', 'Eiche3', 'Eiche3Dick', 'BirkeHoch2', 'BirkeHoch2Dick',
  'BirkeHoch3', 'BirkeHoch3Dick', 'BirkeDicht2', 'BirkeDicht2Dick', 'BirkeHoch1', 'BirkeHoch1Dick', 'Eiche4',
  'Eiche4Dick', 'BirkeHoch4', 'BirkeHoch4Dick', 'Kiefer4', 'Fichte6', 'Tanne7', 'Fichte5', 'Fichte5Dick', 'Fichte4',
  'Fichte4Dick', 'Kiefer2', 'Kiefer2Dick', 'Kiefer1', 'Kiefer1Dick', 'Tanne5', 'Tanne5Dick', 'Fichte2',
  'Fichte2Dick', 'Fichte1', 'Fichte1Dick', 'Tanne1', 'Tanne1Dick', 'Fichte3', 'Fichte3Dick', 'Tanne2', 'Tanne2Dick',
  'Tanne3', 'Tanne3Dick', 'Tanne4', 'Tanne4Dick', 'BirkeDicht1', 'BirkeDicht1Dick', 'BirkeDicht4', 'BirkeDicht4Dick',
  'BirkeDicht3', 'BirkeDicht3Dick', 'Weide3', 'Weide2', 'Weide1', 'Kiefer3', 'Kiefer3Dick', 'Tanne6', 'Tanne6Dick',
  ];
  const BAUM_STORE = [
  'vegetation-tree-1a3', 'vegetation-tree-1b3', 'vegetation-tree-1e1', 'vegetation-tree-1e2', 'vegetation-tree-1b2',
  'vegetation-branched-tree-2a3', 'vegetation-branched-tree-2a1', 'vegetation-tree-1c3', 'vegetation-tree-1b1',
  'vegetation-tree-1d2', 'vegetation-tree-1d1', 'vegetation-tree-1c2', 'vegetation-tree-1c1',
  'vegetation-small-thin-tree-1a3', 'vegetation-small-thin-tree-1a5', 'vegetation-small-thin-tree-1a2',
  'vegetation-pine-1b5', 'vegetation-pine-1b3', 'vegetation-massive-tree-1a3', 'vegetation-pine-1b2',
  'vegetation-pine-1b4', 'vegetation-massive-tree-1a2', 'vegetation-split-tree-1a3', 'vegetation-pine-1b1',
  'vegetation-massive-tree-1a1', 'vegetation-split-tree-1a2', 'vegetation-split-tree-1a1', 'vegetation-pine-1b2-1',
  'vegetation-pine-1b4-1', 'vegetation-pine-1b1-1', 'vegetation-massive-tree-1a2-1-dark',
  'vegetation-split-tree-1a3-1-dark', 'vegetation-massive-tree-1a1-1-dark', 'vegetation-split-tree-1a2-1-dark',
  'vegetation-split-tree-1a1-1-dark', 'vegetation-massive-tree-1a3-1-dark', 'vegetation-tree-1a3-1',
  'vegetation-tree-1a4', 'vegetation-tree-1a5', 'vegetation-tree-1a4-1', 'vegetation-tree-1a5-1',
  'vegetation-tree-1b1-1', 'vegetation-tree-1c1-1', 'vegetation-tree-1d1-1', 'vegetation-tree-1e1-1',
  'vegetation-pine-1b5-0', 'vegetation-pine-1b4-0', 'vegetation-pine-1b1-0', 'vegetation-pine-1b5-1',
  'vegetation-pine-1b3-1', 'vegetation-tree-1a3-2', 'vegetation-tree-1b3-1', 'vegetation-tree-1c2-1',
  'vegetation-tree-1d2-1', 'vegetation-tree-1b3-2', 'vegetation-tree-1b2-2', 'vegetation-tree-1a4-2',
  'vegetation-tree-1a5-2', 'vegetation-tree-1b1-2', 'vegetation-tree-1e1-2', 'vegetation-tree-1e2-2',
  'vegetation-tree-1d1-2', 'vegetation-tree-1d2-2', 'vegetation-tree-1c1-2', 'vegetation-tree-1c2-2',
  ];
  // P3 (Angriff #194): auch die Restliste ist ausgeschrieben. Kommt ein Streu-Prefab dazu, das in keiner der beiden Listen
  // steht, wird der Test rot, bis jemand es EINORDNET (sonst fiele ein neuer Baum still unter "sonstiges").
  const SONSTIGE = [
    'environment-sm-env-rock-cliff-02-1', 'environment-sm-env-rock-cliff-01', 'environment-sm-env-rock-cliff-03-1',
    'environment-sm-env-rock-cliff-05', 'environment-sm-env-rock-chunk-03-1', 'environment-sm-env-rock-chunk-02',
    'environment-sm-env-rock-spike-03', 'environment-sm-env-rock-chunk-01', 'environment-sm-env-rock-spike-01',
    'environment-sm-env-rock-spike-02', 'environment-sm-env-rock-spike-04', 'environment-sm-env-stone-02',
    'environment-sm-env-rock-round-01', 'environment-sm-env-rock-round-03', 'environment-sm-env-rock-round-04',
    'environment-sm-env-rock-spike-05', 'environment-sm-env-rock-04', 'environment-sm-env-rock-03-1',
    'environment-sm-env-stone-01', 'environment-sm-env-rock-01', 'environment-sm-env-rock-02',
    'environment-sm-env-rock-pebble-02-1', 'Findling2', 'Findling1', 'Felsplatte1', 'Steinbank1', 'Hasel2', 'Hasel3',
    'Schlehe1', 'Schlehe2', 'Hartriegel1', 'Holunder2', 'Brombeere2', 'Brombeere1', 'Wacholder2', 'Margerite2',
    'Margerite1', 'Glockenblume2', 'Trollblume2', 'Schafgarbe1', 'Brennnessel1', 'Distel1', 'Ampfer1', 'Seggen1',
    'Seggen3', 'Farn2', 'Farn1', 'Felsplatte2', 'Felsblock2', 'Heidelbeere2', 'Heidelbeere3', 'Heidekraut2',
    'Seggen2', 'Wollgras2', 'Wollgras1', 'Wollgras3', 'Wollgras4', 'Brennnessel2', 'Ampfer2', 'Findling3',
    'Felsnadel1', 'Felsblock1', 'Wacholder3', 'Wacholder1', 'Heidekraut3', 'Heidekraut1',
    'vegetation-large-bush-1a5', 'vegetation-large-bush-1a4', 'vegetation-large-bush-1a1',
    'vegetation-large-bush-1a2', 'vegetation-large-bush-1a3', 'vegetation-bush-1a1-small', 'vegetation-bush-1a1',
    'vegetation-bush-1a2', 'vegetation-bush-1a3', 'vegetation-branch-1a1', 'vegetation-branch-1a9',
    'vegetation-bush-1a2-small-1-dark', 'vegetation-branch-1a7', 'vegetation-branch-1a5',
    'vegetation-sm-plant-mushrooms-02', 'vegetation-bush-1a2-small', 'vegetation-bush-1a2-small-1-snow',
  ];
  const erwartet = [...BAUM_EIGEN, ...BAUM_STORE].sort();
  const namen = [...new Set(FOLIAGE.map((f) => f.prefabName))];
  const eingeordnet = new Set([...BAUM_EIGEN, ...BAUM_STORE, ...SONSTIGE]);
  const unbekannt = namen.filter((n) => !eingeordnet.has(n));
  check('jedes Streu-Prefab ist ausdrücklich eingeordnet (Baum- oder Sonstige-Liste), keines fehlt', unbekannt.length === 0, unbekannt.join(' '));
  check('keine tote Zeile: jede eingeordnete Zeile gibt es in FOLIAGE; Listen zusammen = FOLIAGE', eingeordnet.size === namen.length && [...eingeordnet].every((n) => namen.includes(n)) && BAUM_EIGEN.length + BAUM_STORE.length + SONSTIGE.length === eingeordnet.size, `${namen.length} Prefabs`);
  check('die Sonstige-Liste enthält keinen Baum nach der Regel (und umgekehrt)', SONSTIGE.every((n) => streuArt(n) === 'sonstiges'));
  const baeume = namen.filter((n) => streuArt(n) === 'baum').sort();
  const rest = namen.filter((n) => streuArt(n) !== 'baum');
  console.log(`     Baum (${baeume.length}): ${baeume.join(' ')}`);
  console.log(`     kein Baum (${rest.length}): ${rest.join(' ')}`);
  check('die Baum-Liste über alle Streu-Prefabs ist genau die ausgeschriebene', json(baeume) === json(erwartet), `${baeume.length} vs ${erwartet.length}`);
  check('jeder ausgeschriebene Baum kommt in FOLIAGE vor (keine tote Zeile)', erwartet.every((n) => namen.includes(n)));
  check('Büsche, Kraut, Äste, Pilze und Steine sind keine Bäume', ['Hasel2', 'Schlehe1', 'Brombeere1', 'Wacholder3', 'Heidelbeere2', 'Farn1', 'Seggen2', 'Margerite1', 'Findling1', 'Felsplatte2', 'Steinbank1', 'vegetation-bush-1a1', 'vegetation-large-bush-1a2', 'vegetation-branch-1a1', 'vegetation-sm-plant-mushrooms-02', 'environment-sm-env-rock-01', 'environment-sm-env-stone-02'].every((n) => streuArt(n) === 'sonstiges'));
  check('Weide ist ein Baum, Ast (branch) nicht, branched-tree schon', streuArt('Weide2') === 'baum' && streuArt('vegetation-branch-1a9') === 'sonstiges' && streuArt('vegetation-branched-tree-2a1') === 'baum');
  check('Unbekannter oder leerer Name ist kein Baum', streuArt('') === 'sonstiges' && streuArt('Eiche') === 'sonstiges' && streuArt('EicheX1') === 'sonstiges');
}

// ── 2b) Prüfer vertraut seiner Eingabe nicht (P2, Angriff #194) ───────────
console.log('== 2b Prüfer mit rohen Kreisen');
{
  const roh = [
    { x: 0, z: 0, r: Infinity },
    { x: 0, z: 0, r: -Infinity },
    { x: 0, z: 0, r: NaN },
    { x: 0, z: 0, r: -5 },
    { x: 0, z: 0, r: 1e9 },
    { x: NaN, z: 0, r: 5 },
    { x: Infinity, z: 0, r: 5 },
    { x: 0, z: 0, r: '5' },
    { x: 0, z: 0, r: 5, nur: 'busch' },
    null,
    'x',
  ] as unknown as VegetationEntferntKreis[];
  const t0 = performance.now();
  const p = vegetationPruefer(roh);
  const ms = performance.now() - t0;
  check('Infinity, NaN, negativ, 1e9, Text, null: fertig in Millisekunden (kein Hängen)', ms < 200, `${ms.toFixed(1)} ms`);
  check('… kein Kreis davon wirkt (leer, nichts entfernt)', p.leer && !p.istEntfernt(0, 0, 'baum') && !p.istEntfernt(1e6, 0, 'baum'));
  const gemischt = vegetationPruefer([...roh, { x: 100, z: 100, r: 5 }]);
  check('ein gültiger Kreis zwischen den ungültigen wirkt trotzdem', !gemischt.leer && gemischt.istEntfernt(100, 100, 'baum') && !gemischt.istEntfernt(0, 0, 'baum'));
}

// ── 4) Text, Hash, Schreibweg ───────────────────────────────────────────
console.log('== 4 layoutDatei');
const T = mkdtempSync(resolve(tmpdir(), 'wov-vegetation-entfernt-'));
try {
  const kreise = [{ x: 100.5, z: -200.25, r: 7 }, { x: 5, z: 5, r: 0.5, nur: 'baeume' }];
  const mit = sanitizeWorldLayout(basis({ vegetationEntfernt: kreise }))!;
  const ohne = sanitizeWorldLayout(basis())!;
  check('Text enthält das Feld, Rundreise Text → Sanitizer → Text ist gleich', layoutText(mit).includes('"vegetationEntfernt"') && layoutText(sanitizeWorldLayout(JSON.parse(layoutText(mit)))!) === layoutText(mit));
  check('Hash ändert sich durch das Feld', layoutHash(layoutText(mit)) !== layoutHash(layoutText(ohne)));
  check('Hash ändert sich schon durch einen verschobenen Kreis', layoutHash(layoutText(sanitizeWorldLayout(basis({ vegetationEntfernt: [{ ...kreise[0]!, x: 101 }, kreise[1]] }))!)) !== layoutHash(layoutText(mit)));

  const datei = resolve(T, 'welt.json');
  const w = layoutSchreiben(datei, basis({ vegetationEntfernt: kreise }));
  const auf = readFileSync(datei, 'utf-8');
  check('Schreiben: die Datei trägt die Kreise', json(JSON.parse(auf).vegetationEntfernt) === json(kreise) && auf === layoutText(mit));
  check('Schreiben: das Ergebnis meldet den Hash dieser Bytes', w.hash === layoutHash(auf));
  const gelesen = layoutLesenMitHash(datei);
  check('Lesen: Kreise und Hash stimmen', json(gelesen.layout.vegetationEntfernt) === json(kreise) && gelesen.hash === layoutHash(auf));
  // PATCH-Weg (Höhenkorrektur unberührt): das Feld läuft als gewöhnliches Feld mit durch
  layoutSchreiben(datei, { ...gelesen.layout, name: 'umbenannt' }, undefined, { heightDeltasUnberuehrt: true, basis: gelesen.hash });
  check('PATCH-Weg (heightDeltasUnberuehrt): die Kreise bleiben erhalten', json(JSON.parse(readFileSync(datei, 'utf-8')).vegetationEntfernt) === json(kreise));

  // P1 (Angriff #194): der PATCH-Weg reicht die Kreise ROH durch — nie kürzen, nie still verwerfen
  {
    const viele = Array.from({ length: VEGETATION_KREISE_MAX + 4 }, (_, i) => ({ x: i, z: 1, r: 1 }));
    const kaputtes = [{ x: 1, z: 1, r: 5 }, { x: 2, z: 2, r: 500 }, { x: 3, z: 3, r: 5, nur: 'busch' }];
    for (const [name, feld] of [['4100 Kreise', viele], ['beschädigte Kreise', kaputtes]] as const) {
      const d = resolve(T, `roh-${name.length}.json`);
      writeFileSync(d, json(basis({ vegetationEntfernt: feld })));
      const gelesen2 = layoutLesenMitHash(d, { preserveRawHeight: true });
      check(`PATCH-Lesen (${name}): rawVegetation ist der rohe Wert, unverändert`, json(gelesen2.rawVegetation) === json(feld) && gelesen2.layout.vegetationEntfernt === undefined);
      const mitRoh = { ...gelesen2.layout, name: 'umbenannt', vegetationEntfernt: gelesen2.rawVegetation as never };
      layoutSchreiben(d, mitRoh, undefined, { heightDeltasUnberuehrt: true, vegetationUnberuehrt: true, basis: gelesen2.hash });
      check(`PATCH-Schreiben (${name}): das Feld ist danach bytegleich (nichts gekürzt, nichts verworfen)`, json(JSON.parse(readFileSync(d, 'utf-8')).vegetationEntfernt) === json(feld) && JSON.parse(readFileSync(d, 'utf-8')).name === 'umbenannt');
      let wirft = false;
      try {
        layoutSchreiben(d, mitRoh, undefined, { heightDeltasUnberuehrt: true });
      } catch (e) {
        wirft = e instanceof LayoutVegetationUngueltig;
      }
      check(`ohne vegetationUnberuehrt (POST-Weg) bleibt ${name} abgelehnt`, wirft);
    }
  }

  // Kaputt: wird abgelehnt, nichts geschrieben
  const vorher = readFileSync(datei);
  let ausnahme: unknown = null;
  try {
    layoutSchreiben(datei, basis({ vegetationEntfernt: [{ x: 1, z: 1, r: 500 }] }));
  } catch (e) {
    ausnahme = e;
  }
  check('kaputter Kreis: Schreiben wirft LayoutVegetationUngueltig (eine LayoutUngueltig) mit Befund', ausnahme instanceof LayoutVegetationUngueltig && ausnahme instanceof LayoutUngueltig && ausnahme.vegetationProblem?.fehlerhaft[0]?.feld === 'r', String((ausnahme as Error)?.message));
  check('  … die Datei ist byte-identisch (nichts gespeichert)', readFileSync(datei).equals(vorher));
  const neueDatei = resolve(T, 'neu.json');
  let a2: unknown = null;
  try {
    layoutSchreiben(neueDatei, basis({ vegetationEntfernt: 'kaputt' }));
  } catch (e) {
    a2 = e;
  }
  check('Feld kein Array: abgelehnt, keine Datei angelegt', a2 instanceof LayoutVegetationUngueltig && !existsSync(neueDatei));
  let a3: unknown = null;
  try {
    layoutSchreiben(neueDatei, basis({ vegetationEntfernt: Array.from({ length: VEGETATION_KREISE_MAX + 1 }, (_, i) => ({ x: i, z: 0, r: 1 })) }));
  } catch (e) {
    a3 = e;
  }
  check('zu viele Kreise: abgelehnt (limit), keine Datei angelegt', a3 instanceof LayoutVegetationUngueltig && a3.vegetationProblem?.reason === 'limit' && !existsSync(neueDatei));
  // Eine von Hand kaputt gemachte Datei: Lesen meldet, statt still zu kürzen; der Rückweg (preserveRawHeight) liest weiter
  const handDatei = resolve(T, 'hand.json');
  writeFileSync(handDatei, json(basis({ vegetationEntfernt: [{ x: 1, z: 1, r: 5 }, { x: 'a', z: 1, r: 5 }] })));
  let a4: unknown = null;
  try {
    layoutLesenMitHash(handDatei);
  } catch (e) {
    a4 = e;
  }
  check('Lesen einer beschädigten Datei wirft LayoutVegetationUngueltig', a4 instanceof LayoutVegetationUngueltig && a4.vegetationProblem?.fehlerhaft[0]?.eintrag === '#1');
  const hand = layoutLesenMitHash(handDatei, { preserveRawHeight: true });
  check('Lesen mit preserveRawHeight (Zurücksetzen, PATCH) bleibt möglich und liefert die Kreise roh (rawVegetation)', Array.isArray(hand.rawVegetation) && hand.rawVegetation.length === 2 && hand.layout.vegetationEntfernt === undefined);

  // ── 5) Arbeitskopie ───────────────────────────────────────────────────
  console.log('== 5 Arbeitskopie');
  const bytes = (extra: Record<string, unknown>): Buffer => Buffer.from(layoutText(sanitizeWorldLayout(basis(extra))!));
  check('kanonHash: Dokumente, die sich nur in den Kreisen unterscheiden, sind verschieden', kanonHash(bytes({ vegetationEntfernt: kreise })) !== kanonHash(bytes({})) && kanonHash(bytes({ vegetationEntfernt: kreise })) !== kanonHash(bytes({ vegetationEntfernt: [kreise[0]] })));
  check('kanonHash: andere Formatierung, gleiche Kreise → gleich', kanonHash(Buffer.from(json(basis({ vegetationEntfernt: kreise })))) === kanonHash(bytes({ vegetationEntfernt: kreise })));
  const ordner = resolve(T, 'ak');
  mkdirSync(ordner, { recursive: true });
  const repo = resolve(ordner, 'repo-dev.json');
  const arbeit = resolve(ordner, 'dev.json');
  writeFileSync(repo, bytes({ vegetationEntfernt: kreise }));
  writeFileSync(arbeit, bytes({}));
  const a = weltAbgleichen({ repoDatei: repo, arbeitsDatei: arbeit, modus: 'pruefen' });
  check('Repo mit Kreisen, Arbeitskopie ohne, keine Basis → konflikt (nicht "unveraendert")', a.fall === 'konflikt' && !existsSync(basisDatei(arbeit)), a.fall);
  writeFileSync(arbeit, Buffer.from(json(basis({ vegetationEntfernt: kreise }))));
  const b = weltAbgleichen({ repoDatei: repo, arbeitsDatei: arbeit, modus: 'pruefen' });
  check('gleiche Kreise, andere Formatierung → unveraendert', b.fall === 'unveraendert', b.fall);
} finally {
  rmSync(T, { recursive: true, force: true });
}

if (fehler > 0) {
  console.error(`\n${fehler} FAILED`);
  process.exit(1);
}
console.log('\nAll vegetation-entfernt checks passed.');
