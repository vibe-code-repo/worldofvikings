/**
 * Handkorrektur der Geländehöhe (`WorldLayout.heightDeltas`, Karte T1/N1/N2 —
 * Datenmodell, zweifach nachgebessert nach den Angriffen auf PR #114).
 *
 *  1) Sanitizer: gültige Zeilenform, stabil sortiert (Zone, dann Zeile `ry`,
 *     dann Spalte `rx`).
 *  2) Sanitizer-Grenzfälle: jede in der Karte genannte Bedingung, Zeilenschema
 *     (N2: `r: string[]`, je Zeile `"ry|i|d"`, `ry`/`rx` je 0…63).
 *  3) N2-Formatentscheidung: `delta 0` fällt beim Sanitizer weg (Zeile/Zone
 *     dadurch leer: auch die).
 *  4) `hoehenkorrekturFehler` (422-Weg): dieselben Bedingungen, gemeldet statt
 *     still bereinigt; `__proto__`, doppelte Zone, gemischte Punkte, Index 64,
 *     `heightDeltas: "kaputt"` (kein Array) ist ein Fund, kein leeres Feld
 *     (Angriffsbefund N1, dritter Punkt).
 *  5) Fehlendes Feld verhält sich exakt wie ein leeres.
 *  6) Ohne Feld: golden-Datei gegen `origin/main` (N1/B4).
 *  7) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation dazwischen.
 *  8) Sockelfläche (`einebnen`): Korrektur wirkt dort nicht.
 *  9) Cache je Zone: eine ECHTE Änderung der Korrektur wird sichtbar, die
 *     Nachbarzone (gleicher Index) bleibt unverändert.
 * 10) Server = Client: `geo.getHeight` gegen `HeightmapProvider.getGroundHeight`.
 * 11) B2: Naht zwischen Zonen — Band, alle vier Ränder, negative Zonen.
 * 12) N6: Ein geänderter Punkt in einer vollen Zone ergibt einen kleinen Diff
 *     (Zeilenform statt einer Zone-weiten `i`/`d`) — echter `git diff`.
 * 13) 422-Weg (Sanitizer-Ebene): `layoutSchreiben` verweigert ein Dokument mit
 *     ungültigem heightDeltas. Der ECHTE HTTP-Statuscode (422 mit Liste) und
 *     die PATCH-/Live-Wache-Fälle stehen in `admin/test/weltops-
 *     hoehenkorrektur.ts` und `server/test/layout-live-hoehenkorrektur.ts`.
 *
 * Rot-auf-main-Status je Abschnitt: siehe Kopfkommentare der Abschnitte und
 * den Bericht (`Berichte/2026-09-27 Editor Gelaende T1 N2.md`,
 * Zusicherungstabelle).
 *
 *   npx tsx test/hoehenkorrektur.ts   (aus shared/)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo } from '../src/worldgen/factory.js';
import { HeightmapProvider, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import type { RegionGeo } from '../src/worldgen/RegionGeo.js';
import { getStableHash } from '../src/hash.js';
import {
  sanitizeWorldLayout,
  sanitizeHeightDeltas,
  hoehenkorrekturFehler,
  HOEHENKORREKTUR_ZEILE_MAX,
  type WorldLayout,
  type ZoneHeightDelta,
} from '../src/worldlayout/index.js';
import { layoutSchreiben, layoutText, LayoutHoehenkorrekturUngueltig } from '../src/worldlayout/layoutDatei.js';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  } else console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
}

function dok(extra: Record<string, unknown> = {}): WorldLayout {
  return {
    version: 1,
    name: 'hoehenkorrektur-test',
    detailSeed: 'hoehenkorrektur-test',
    continents: [],
    regions: [{ id: 'land', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
    ...extra,
  } as unknown as WorldLayout;
}

/** Eine `ZoneHeightDelta` aus [flacherIndex, deltaCm]-Paaren bauen — gruppiert nach Zeile `ry` (N2-Zeilenform, je Zeile ein String `"ry|i|d"`). */
function zone(zx: number, zz: number, punkte: ReadonlyArray<readonly [number, number]>): ZoneHeightDelta {
  const zeilen = new Map<number, [number, number][]>();
  for (const [index, delta] of punkte) {
    const ry = Math.floor(index / ZONE_UNITS);
    const rx = index % ZONE_UNITS;
    const liste = zeilen.get(ry) ?? [];
    liste.push([rx, delta]);
    zeilen.set(ry, liste);
  }
  const r: string[] = [...zeilen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ry, liste]) => {
      const sortiert = [...liste].sort((a, b) => a[0] - b[0]);
      return `${ry}|${sortiert.map((p) => p[0]).join(',')}|${sortiert.map((p) => p[1]).join(',')}`;
    });
  return { zx, zz, r };
}

/** Eine Zeilen-Zählung für Testzwecke: `"ry|i|d"` → Anzahl Punkte (nach Komma in `i`), 0 bei Strukturbruch. */
function zeilenPunkte(zeile: string): number {
  const teile = zeile.split('|');
  if (teile.length !== 3) return 0;
  return teile[1]!.length > 0 ? teile[1]!.split(',').length : 0;
}

function geoAus(layout: WorldLayout, settings: { bilinearSampling?: boolean } = {}): { geo: RegionGeo; hm: HeightmapProvider } {
  const geo = createGeo({ mode: 'layout', worldSeed: getStableHash('hoehenkorrektur-test'), layout }) as RegionGeo;
  return { geo, hm: new HeightmapProvider(geo, { blendSmoothStep: true, ...settings }) };
}

/** Weltposition des Rasterpunkts `index` (0…4095, `ry*64+rx`) einer Zone. */
function weltpos(zx: number, zz: number, index: number): [number, number] {
  const rx = index % ZONE_UNITS;
  const ry = Math.floor(index / ZONE_UNITS);
  return [zx * ZONE_UNITS - ZONE_UNITS / 2 + rx, zz * ZONE_UNITS - ZONE_UNITS / 2 + ry];
}

// ── 1) Sanitizer: gültige Zeilenform, stabil sortiert ──────────────────
{
  const roh = [
    { zx: 2, zz: -1, r: ['1|10,3|-50,200'] },
    { zx: -3, zz: 0, r: ['63|63|999'] },
  ];
  const s = sanitizeHeightDeltas(roh);
  check('Sanitizer: beide Zonen behalten', s.length === 2, JSON.stringify(s));
  check('Sanitizer: Zonen nach zx,zz sortiert', s[0]!.zx === -3 && s[1]!.zx === 2, JSON.stringify(s));
  check('Sanitizer: i/d je Zeile nach rx sortiert', s[1]!.r[0] === '1|3,10|200,-50', JSON.stringify(s[1]));

  const mehrZeilen = sanitizeHeightDeltas([{ zx: 0, zz: 0, r: ['5|1|10', '2|1|20', '5|2|30'] }]);
  check(
    'Sanitizer: Zeilen nach ry sortiert, doppeltes ry (die zweite Zeile 5) entfällt',
    mehrZeilen[0]!.r.length === 2 && mehrZeilen[0]!.r[0] === '2|1|20' && mehrZeilen[0]!.r[1] === '5|1|10',
    JSON.stringify(mehrZeilen[0])
  );
}

// ── 2) Sanitizer-Grenzfälle (Zeilenschema N2: je Zeile "ry|i|d", ry/rx je 0…63) ──
{
  check('HOEHENKORREKTUR_ZEILE_MAX ist 63 (64×64, je Achse 0…63)', HOEHENKORREKTUR_ZEILE_MAX === 63, `${HOEHENKORREKTUR_ZEILE_MAX}`);
  const faelle: [string, unknown, number][] = [
    ['falscher Zonenschlüssel (Text)', [{ zx: 'a', zz: 0, r: ['0|0|1'] }], 0],
    ['falscher Zonenschlüssel (Bruch)', [{ zx: 1.5, zz: 0, r: ['0|0|1'] }], 0],
    ['ry außerhalb 0…63 (negativ)', [{ zx: 0, zz: 0, r: ['-1|0|1'] }], 0],
    ['ry 63 ist die GRÖSSTE gültige Zeile', [{ zx: 0, zz: 0, r: ['63|0|1'] }], 1],
    ['ry 64 ist außerhalb (64 Zeilen, 0…63)', [{ zx: 0, zz: 0, r: ['64|0|1'] }], 0],
    ['ry nicht kanonisch ("01", führende Null): die Zeile entfällt', [{ zx: 0, zz: 0, r: ['01|0|1'] }], 0],
    ['rx 63 ist die GRÖSSTE gültige Spalte, "Index 64" (Zeile 1, Spalte 0) ist ein GEWÖHNLICHER gültiger Punkt', [{ zx: 0, zz: 0, r: ['1|0|1'] }], 1],
    ['doppeltes rx in einer Zeile: der zweite entfällt', [{ zx: 0, zz: 0, r: ['0|5,5|1,2'] }], 1],
    ['i/d einer Zeile verschieden lang: die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|5,6|1'] }], 0],
    ['Zeile kein String (Array statt String): die Zeile entfällt', [{ zx: 0, zz: 0, r: [['0', '5', '1']] }], 0],
    ['Zeile mit zu wenigen |-Teilen (zwei statt drei): die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|5'] }], 0],
    ['Zeile mit zu vielen |-Teilen (vier statt drei): die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|5|1|x'] }], 0],
    ['ein Teil von i ist keine kanonische Ganzzahl ("5.0"): die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|5.0|1'] }], 0],
    ['führende Null ("05") in i ist keine kanonische Form: die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|05|1'] }], 0],
    ['Leerzeichen in der Liste: die Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|5, 6|1,2'] }], 0],
    ['Delta außerhalb +10000', [{ zx: 0, zz: 0, r: ['0|5|10001'] }], 0],
    ['Delta außerhalb -10000', [{ zx: 0, zz: 0, r: ['0|5|-10001'] }], 0],
    ['Delta genau an der Grenze (10000/-10000) ist gültig', [{ zx: 0, zz: 0, r: ['0|5,6|10000,-10000'] }], 2],
    ['doppelter Zonenschlüssel: der zweite entfällt', [{ zx: 1, zz: 1, r: ['0|0|1'] }, { zx: 1, zz: 1, r: ['0|1|2'] }], 1],
    ['leeres i/d in einer Zeile: die Zeile entfällt (keine Korrektur ist keine Korrektur)', [{ zx: 0, zz: 0, r: ['0||'] }], 0],
    ['r kein Array: die Zone entfällt', [{ zx: 0, zz: 0, r: 'x' }], 0],
    ['eine Zeile strukturell kaputt (keine drei |-Teile): nur die kaputte Zeile entfällt', [{ zx: 0, zz: 0, r: ['0|1|2', '1|3'] }], 1],
  ];
  for (const [name, roh, erwartet] of faelle) {
    const s = sanitizeHeightDeltas(roh);
    const anzahlPunkte = s.reduce((n, z) => n + z.r.reduce((m, zeile) => m + zeilenPunkte(zeile), 0), 0);
    check(`Sanitizer-Grenzfall: ${name}`, anzahlPunkte === erwartet, `${anzahlPunkte} Punkte behalten (${JSON.stringify(s)})`);
  }
}

// ── 3) N2-Formatentscheidung: delta 0 fällt beim Sanitizer weg ─────────
// Rot auf 4234ef4 (N1): Dort blieb delta 0 in der Datei stehen (nur
// `geoAenderung` normalisierte vor dem Vergleich) — dieser Test prüft den
// SANITIZER selbst, der jetzt die Quelle der Normalisierung ist.
{
  const nurNull = sanitizeHeightDeltas([{ zx: 0, zz: 0, r: ['0|5|0'] }]);
  check('delta 0: der Punkt fällt weg, die Zeile (und die Zone) mit ihm', nurNull.length === 0, JSON.stringify(nurNull));

  const gemischt = sanitizeHeightDeltas([{ zx: 0, zz: 0, r: ['0|5,6,7|0,50,0'] }]);
  check(
    'delta 0 nur bei einzelnen Punkten einer Zeile: die übrigen bleiben',
    gemischt.length === 1 && gemischt[0]!.r.length === 1 && gemischt[0]!.r[0] === '0|6|50',
    JSON.stringify(gemischt)
  );

  const minusNull = sanitizeHeightDeltas([{ zx: 0, zz: 0, r: ['0|5|-0'] }]);
  check('-0 zählt auch als 0 (JS: -0 === 0) und fällt weg', minusNull.length === 0, JSON.stringify(minusNull));
}

// ── 4) hoehenkorrekturFehler (422-Weg): dieselben Bedingungen, gemeldet ─
{
  const proben: [string, unknown, boolean][] = [
    ['gültiger Eintrag', [{ zx: 0, zz: 0, r: ['0|0|5'] }], false],
    ['"Index 64" (Zeile 1, Spalte 0) ist GÜLTIG, kein Fund', [{ zx: 0, zz: 0, r: ['1|0|5'] }], false],
    ['falscher Zonenschlüssel', [{ zx: 'a', zz: 0, r: ['0|0|5'] }], true],
    ['ry außerhalb (64)', [{ zx: 0, zz: 0, r: ['64|0|5'] }], true],
    ['doppeltes rx in einer Zeile', [{ zx: 0, zz: 0, r: ['0|1,1|5,6'] }], true],
    ['i/d einer Zeile verschieden lang', [{ zx: 0, zz: 0, r: ['0|1,2|5'] }], true],
    ['Delta außerhalb', [{ zx: 0, zz: 0, r: ['0|1|99999'] }], true],
    ['doppelte Zone (Testliste N1/B1)', [{ zx: 0, zz: 0, r: ['0|1|5'] }, { zx: 0, zz: 0, r: ['1|2|5'] }], true],
    [
      'gemischte Punkte: ein gültiger, ein ungültiger in DERSELBEN Zeile (Testliste N1/B1)',
      [{ zx: 0, zz: 0, r: ['0|1,99999|5,6'] }],
      true,
    ],
    ['Zeile kein String (Zahl statt String)', [{ zx: 0, zz: 0, r: [12345] }], true],
    ['Zeile mit falscher Anzahl |-Teile (zwei statt drei)', [{ zx: 0, zz: 0, r: ['0|1'] }], true],
    ['Eintrag kein Objekt', ['x'], true],
    [
      'heightDeltas: "kaputt" (kein Array) ist ein FUND, kein leeres Feld (Angriffsbefund N1, dritter Punkt)',
      'kaputt',
      true,
    ],
    ['heightDeltas fehlt (undefined): KEIN Fund — das ist gültig leer', undefined, false],
    ['heightDeltas: null: KEIN Fund — das ist gültig leer', null, false],
    [
      '__proto__ als Schlüssel EINES Eintrags (Testliste N1/B1): kein Absturz, keine Verschmutzung, normale Prüfung',
      [{ zx: 0, zz: 0, r: ['0|1|5'], __proto__: { polluted: 1 } }],
      false,
    ],
  ];
  for (const [name, roh, erwartetFehler] of proben) {
    const f = hoehenkorrekturFehler(roh);
    check(`hoehenkorrekturFehler: ${name}`, (f.length > 0) === erwartetFehler, JSON.stringify(f));
  }
  check(
    '__proto__-Eintrag verschmutzt Object.prototype nicht',
    (Object.prototype as unknown as { polluted?: unknown }).polluted === undefined
  );
}

// ── 5) Fehlendes Feld verhält sich exakt wie ein leeres ────────────────
{
  const { hm: hmOhne } = geoAus(dok());
  const { hm: hmLeer } = geoAus(dok({ heightDeltas: [] }));
  let abweichend = 0;
  const proben = 300;
  for (let i = 0; i < proben; i++) {
    const x = (i - proben / 2) * 5;
    const z = (((i * 37) % proben) - proben / 2) * 5;
    if (Math.fround(hmOhne.getGroundHeight(x, z)) !== Math.fround(hmLeer.getGroundHeight(x, z))) abweichend++;
  }
  check('Leeres heightDeltas verhält sich exakt wie ein fehlendes Feld', abweichend === 0, `${abweichend}/${proben} abweichend`);
}

// ── 6) Ohne Feld: golden-Datei gegen origin/main (N1, behebt B4) ───────
{
  const HIER = dirname(fileURLToPath(import.meta.url));
  const GOLDEN = resolve(HIER, 'golden/hoehenkorrektur-ohne-feld.bin');
  const devPfad = fileURLToPath(new URL('../../server/data/welten/dev.json', import.meta.url));
  const devRoh = JSON.parse(readFileSync(devPfad, 'utf-8')) as unknown;
  const layout = sanitizeWorldLayout(devRoh)!;
  check('dev.json hat (Ist-Stand) kein heightDeltas', layout.heightDeltas === undefined);
  const geo1 = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout: devRoh }) as RegionGeo;
  const hm1 = new HeightmapProvider(geo1, {});
  const ZONEN: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [2, 2], [-3, 4], [5, -2]];
  const werte: number[] = [];
  for (const [zx, zz] of ZONEN) {
    const z = hm1.getZone(zx, zz);
    for (let i = 0; i < z.heights.length; i++) werte.push(z.heights[i]!);
  }
  check('≥10 000 Stichpunkte über mehrere Zonen gemessen', werte.length >= 10_000, `${werte.length} Punkte über ${ZONEN.length} Zonen`);
  const jetzt = new Float32Array(werte);
  if (process.argv.includes('--schreibe')) {
    mkdirSync(dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, Buffer.from(jetzt.buffer, jetzt.byteOffset, jetzt.byteLength));
    console.log(`Referenz geschrieben: ${GOLDEN} (${jetzt.length} Werte)`);
  } else if (!existsSync(GOLDEN)) {
    check('golden-Datei vorhanden (mit --schreibe erzeugen)', false, GOLDEN);
  } else {
    const roh = readFileSync(GOLDEN);
    const soll = new Float32Array(roh.buffer, roh.byteOffset, roh.byteLength / 4);
    let abweichend = 0;
    if (soll.length === jetzt.length) {
      for (let i = 0; i < soll.length; i++) if (soll[i] !== jetzt[i]) abweichend++;
    }
    check(
      'ohne heightDeltas: bitgleich zur golden-Referenz aus origin/main (echte dev.json, mehrere Zonen)',
      soll.length === jetzt.length && abweichend === 0,
      `${abweichend}/${jetzt.length} abweichend (Referenz ${soll.length} Werte)`
    );
  }
}

// ── 7) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation ──
{
  const layout = dok();
  const { hm: hmOhne } = geoAus(layout, { bilinearSampling: true });
  const rx = 42;
  const ry = 42;
  const wx = rx - ZONE_UNITS / 2;
  const wz = ry - ZONE_UNITS / 2;
  const deltaCm = 350; // +3.5 m
  const mitKorrektur = dok({ heightDeltas: [zone(0, 0, [[ry * ZONE_UNITS + rx, deltaCm]])] });
  const { hm: hmMit } = geoAus(mitKorrektur, { bilinearSampling: true });

  const basisHoehe = hmOhne.getGroundHeight(wx, wz);
  const neueHoehe = hmMit.getGroundHeight(wx, wz);
  check(
    'Mit Korrektur: +Δ exakt am Rasterpunkt (rot auf main: ja)',
    Math.abs(neueHoehe - (basisHoehe + deltaCm / 100)) < 1e-4,
    `${neueHoehe} vs ${basisHoehe + deltaCm / 100}`
  );

  const nachbarOhne = hmOhne.getGroundHeight(wx + 1, wz);
  const nachbarMit = hmMit.getGroundHeight(wx + 1, wz);
  check('Der nicht getroffene Nachbar-Rasterpunkt bleibt unverändert', nachbarOhne === nachbarMit, `${nachbarOhne} vs ${nachbarMit}`);

  const halbeStelle = hmMit.getGroundHeight(wx + 0.5, wz);
  const erwartet = (neueHoehe + nachbarMit) / 2;
  check(
    'Interpolation zwischen Rasterpunkten: Standard-Bilinear über der korrigierten Höhe (rot auf main: nein für sich allein, s. Bericht)',
    Math.abs(halbeStelle - erwartet) < 1e-3,
    `${halbeStelle} vs ${erwartet}`
  );
}

// ── 8) Sockelfläche (`einebnen`): Korrektur wirkt dort NICHT ───────────
{
  const platzierungen = [{ id: 'sockel', prefab: 'Kiste', x: 100, z: 100, einebnen: 20 }];
  const ohneKorrektur = dok({ placements: platzierungen });
  const rx = 9;
  const ry = 4;
  const wx = 2 * ZONE_UNITS - ZONE_UNITS / 2 + rx; // 105
  const wz = 2 * ZONE_UNITS - ZONE_UNITS / 2 + ry; // 100
  check('Testaufbau: (wx,wz) trifft die erwartete Weltposition', wx === 105 && wz === 100, `${wx},${wz}`);
  const mitKorrektur = dok({
    placements: platzierungen,
    heightDeltas: [zone(2, 2, [[ry * ZONE_UNITS + rx, 500]])], // +5 m, weit über der Böschungsbreite
  });
  const { hm: hmOhneS } = geoAus(ohneKorrektur);
  const { hm: hmMitS } = geoAus(mitKorrektur);
  const hOhne = hmOhneS.getGroundHeight(wx, wz);
  const hMit = hmMitS.getGroundHeight(wx, wz);
  check(
    'Sockelfläche: eine Korrektur innerhalb des Sockelradius ändert die Höhe nicht (rot auf main: nein für sich allein, s. Bericht)',
    Math.abs(hOhne - hMit) < 1e-4,
    `ohne ${hOhne} / mit ${hMit}`
  );
  const nurKorrektur = dok({ heightDeltas: [zone(2, 2, [[ry * ZONE_UNITS + rx, 500]])] });
  const { hm: hmNurBasis } = geoAus(dok());
  const { hm: hmNurKorrektur } = geoAus(nurKorrektur);
  const hBasis = hmNurBasis.getGroundHeight(wx, wz);
  const hKorrigiert = hmNurKorrektur.getGroundHeight(wx, wz);
  check(
    'Gegenprobe: ohne Sockel wirkt derselbe Korrekturpunkt voll (+5 m) — rot auf main: ja',
    Math.abs(hKorrigiert - (hBasis + 5)) < 1e-4,
    `${hKorrigiert} vs ${hBasis + 5}`
  );
}

// ── 9) Cache je Zone: EINE ECHTE ÄNDERUNG wird sichtbar, Nachbar bleibt ──
{
  const GEMEINSAMER_INDEX = 500;
  const zonePos = (zx: number, zz: number): [number, number] => weltpos(zx, zz, GEMEINSAMER_INDEX);
  const [wxA, wzA] = zonePos(0, 0);
  const [wxB, wzB] = zonePos(5, -3);

  const { hm: hmBasis } = geoAus(dok());
  const baseA = hmBasis.getGroundHeight(wxA, wzA);
  const baseB = hmBasis.getGroundHeight(wxB, wzB);

  const alt = dok({
    heightDeltas: [zone(0, 0, [[GEMEINSAMER_INDEX, 400]]), zone(5, -3, [[GEMEINSAMER_INDEX, -250]])],
  });
  const { hm: hmAlt } = geoAus(alt);
  const hAaltDelta = hmAlt.getGroundHeight(wxA, wzA) - baseA;
  const hBaltDelta = hmAlt.getGroundHeight(wxB, wzB) - baseB;
  check('Vor der Änderung: Zone A trägt ihr eigenes Delta (+4 m)', Math.abs(hAaltDelta - 4) < 1e-4, `${hAaltDelta}`);
  check('Vor der Änderung: Zone B trägt ihr eigenes, ANDERES Delta (−2,5 m), trotz gleichem Index', Math.abs(hBaltDelta - -2.5) < 1e-4, `${hBaltDelta}`);

  const neu = dok({
    heightDeltas: [zone(0, 0, [[GEMEINSAMER_INDEX, -600]]), zone(5, -3, [[GEMEINSAMER_INDEX, -250]])],
  });
  const { hm: hmNeu } = geoAus(neu);
  const hAneuDelta = hmNeu.getGroundHeight(wxA, wzA) - baseA;
  const hBneuDelta = hmNeu.getGroundHeight(wxB, wzB) - baseB;
  check('Nach der Änderung: Zone A zeigt den NEUEN Wert (−6 m), nicht mehr den alten', Math.abs(hAneuDelta - -6) < 1e-4, `${hAneuDelta}`);
  check(
    'Nach der Änderung: die NICHT geänderte Nachbarzone B bleibt exakt unverändert (kein Bluten über den gemeinsamen Index)',
    Math.abs(hBneuDelta - -2.5) < 1e-4,
    `${hBneuDelta}`
  );
  check('Zone A und B tatsächlich beide gecacht (kein zufälliger Kollisions-Nichttreffer)', hmNeu.cachedZoneCount === 2, `${hmNeu.cachedZoneCount}`);
}

// ── 10) Server = Client: geo.getHeight gegen HeightmapProvider.getGroundHeight ──
{
  const punkte: Array<[number, number]> = [
    [0, 0],
    [10, 5],
    [-20, 30],
    [64, 0],
    [0, 64],
    [-64, -64],
  ];
  for (const mitKorrektur of [false, true]) {
    const layout = mitKorrektur ? dok({ heightDeltas: [zone(0, 0, [[0, 500]]), zone(0, 1, [[0, -300]])] }) : dok();
    const { geo, hm } = geoAus(layout);
    let abweichend = 0;
    for (const [x, z] of punkte) {
      const viaGeo = Math.fround(geo.getHeight(x, z));
      const viaHeightmap = Math.fround(hm.getGroundHeight(x, z));
      if (viaGeo !== viaHeightmap) abweichend++;
    }
    check(
      `Server = Client (${mitKorrektur ? 'mit' : 'ohne'} Korrektur): geo.getHeight === HeightmapProvider.getGroundHeight an Rasterpunkten`,
      abweichend === 0,
      `${abweichend}/${punkte.length} abweichend`
    );
  }
}

// ── 11) B2: Naht zwischen Zonen ─────────────────────────────────────────
{
  type Randfall = { name: string; korrekturWelt: [number, number]; innerhalbBand: [number, number]; unberuehrt: [number, number] };
  const FAELLE: Randfall[] = [
    { name: 'positive Zone, +x-Rand (x=32)', korrekturWelt: [32, 10], innerhalbBand: [31.7, 10], unberuehrt: [30.5, 10] },
    { name: 'positive Zone, +z-Rand (z=32)', korrekturWelt: [10, 32], innerhalbBand: [10, 31.7], unberuehrt: [10, 30.5] },
    { name: 'negative Zone, −x-Rand (x=−32)', korrekturWelt: [-32, -800], innerhalbBand: [-31.7, -800], unberuehrt: [-30.5, -800] },
    { name: 'negative Zone, −z-Rand (z=−32)', korrekturWelt: [-800, -32], innerhalbBand: [-800, -31.7], unberuehrt: [-800, -30.5] },
    { name: 'negative Zone, +x-Rand bei negativem zx (x=−96 = Grenze zx −2/−1)', korrekturWelt: [-96, -800], innerhalbBand: [-96.3, -800], unberuehrt: [-97.5, -800] },
  ];
  for (const f of FAELLE) {
    const [kx, kz] = f.korrekturWelt;
    const halb = ZONE_UNITS / 2;
    const zx = Math.floor((Math.round(kx) + halb) / ZONE_UNITS);
    const zz = Math.floor((Math.round(kz) + halb) / ZONE_UNITS);
    const rx = Math.round(kx) - (zx * ZONE_UNITS - halb);
    const ry = Math.round(kz) - (zz * ZONE_UNITS - halb);
    check(`${f.name}: Testaufbau, rx/ry in [0,63]`, rx >= 0 && rx <= 63 && ry >= 0 && ry <= 63, `rx=${rx} ry=${ry}`);
    const index = ry * ZONE_UNITS + rx;
    const layoutOhne = dok();
    const layoutMit = dok({ heightDeltas: [zone(zx, zz, [[index, 700]])] });
    const { geo: geoOhne, hm: hmOhne } = geoAus(layoutOhne);
    const { geo: geoMit, hm: hmMit } = geoAus(layoutMit);

    const deltaAn = (punkt: [number, number]): { geo: number; hm: number } => ({
      geo: geoMit.getHeight(punkt[0], punkt[1]) - geoOhne.getHeight(punkt[0], punkt[1]),
      hm: hmMit.getGroundHeight(punkt[0], punkt[1]) - hmOhne.getGroundHeight(punkt[0], punkt[1]),
    });

    const amPunkt = deltaAn([kx, kz]);
    check(
      `${f.name}: am Rasterpunkt selbst zeigen geo.getHeight und Heightmap denselben Δ (+7 m)`,
      Math.abs(amPunkt.geo - 7) < 1e-3 && Math.abs(amPunkt.hm - 7) < 1e-3,
      `geo Δ=${amPunkt.geo.toFixed(4)} hm Δ=${amPunkt.hm.toFixed(4)}`
    );

    const imBand = deltaAn(f.innerhalbBand);
    check(
      `${f.name}: im Band [rand-0,5; rand) rundet BEIDES auf denselben Rasterpunkt — gleicher Δ auf beiden Seiten der Naht (B2-Fund behoben)`,
      Math.abs(imBand.geo - amPunkt.geo) < 1e-3 && Math.abs(imBand.hm - amPunkt.hm) < 1e-3 && Math.abs(imBand.geo - imBand.hm) < 1e-3,
      `geo Δ=${imBand.geo.toFixed(4)} hm Δ=${imBand.hm.toFixed(4)}`
    );

    const unberuehrt = deltaAn(f.unberuehrt);
    check(
      `${f.name}: ein klar anderer Rasterpunkt bleibt unberührt (Δ=0 auf beiden Seiten)`,
      Math.abs(unberuehrt.geo) < 1e-3 && Math.abs(unberuehrt.hm) < 1e-3,
      `geo Δ=${unberuehrt.geo.toFixed(6)} hm Δ=${unberuehrt.hm.toFixed(6)}`
    );
  }
}

// ── 12) Größen: Strich, volle Zone, Diff bei einem geänderten Punkt (N6) ──
{
  const dir = mkdtempSync(join(tmpdir(), 'wov-hoehenkorrektur-groesse-'));
  try {
    const groesse = (layout: WorldLayout): number => Buffer.byteLength(layoutText(layout), 'utf-8');
    const basisGroesse = groesse(dok());

    // Strich r = 3 m: alle Rasterpunkte im Kreis um (32,32) einer Zone, realistischer Falloff.
    const strichPunkte: [number, number][] = [];
    for (let ry = 0; ry < 64; ry++) {
      for (let rx = 0; rx < 64; rx++) {
        const dx = rx - 32;
        const dy = ry - 32;
        if (dx * dx + dy * dy <= 9) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          const delta = Math.round(50 * (1 - dist / 3));
          if (delta !== 0) strichPunkte.push([ry * ZONE_UNITS + rx, delta]);
        }
      }
    }
    const mitStrich = dok({ heightDeltas: [zone(0, 0, strichPunkte)] });
    const strichByte = groesse(mitStrich) - basisGroesse;
    check(`Strich r=3m (${strichPunkte.length} Punkte): ≤ 400 Byte`, strichByte <= 400, `${strichByte} Byte`);

    // Volle Zone, realistisch (sanfter Hügel, keine Extremwerte).
    const vollePunkte: [number, number][] = [];
    for (let idx = 0; idx < 4096; idx++) {
      const rx = idx % 64;
      const ry = Math.floor(idx / 64);
      const dx = rx - 32;
      const dy = ry - 32;
      const r = Math.sqrt(dx * dx + dy * dy);
      const delta = Math.round(300 * Math.cos((r / 45) * (Math.PI / 2)));
      vollePunkte.push([idx, delta === 0 ? 1 : delta]);
    }
    const volleZone = dok({ heightDeltas: [zone(0, 0, vollePunkte)] });
    const volleByte = groesse(volleZone) - basisGroesse;
    check(`Volle Zone (${vollePunkte.length} Punkte, realistisch): ≤ 40 KB`, volleByte <= 40_960, `${volleByte} Byte`);

    // N6: EIN Punkt geändert in der vollen Zone → Diff (echter `git diff --no-index`).
    const vorPfad = join(dir, 'vor.json');
    const nachPfad = join(dir, 'nach.json');
    writeFileSync(vorPfad, layoutText(volleZone));
    const geaendertePunkte = vollePunkte.map((p, i) => (i === 0 ? [p[0], p[1] + 1] : p)) as [number, number][];
    const volleZoneGeaendert = dok({ heightDeltas: [zone(0, 0, geaendertePunkte)] });
    writeFileSync(nachPfad, layoutText(volleZoneGeaendert));
    const diff = spawnSync('git', ['diff', '--no-index', '--no-color', vorPfad, nachPfad], { encoding: 'utf-8' });
    const diffByte = Buffer.byteLength(diff.stdout ?? '', 'utf-8');
    check(
      'N6: git diff bei EINEM geänderten Punkt in einer vollen Zone ist klein (≤ 4 KB, Ziel ~2 KB) statt der ganzen Zone',
      diffByte > 0 && diffByte <= 4096,
      `${diffByte} Byte`
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── 13) 422-Weg (Sanitizer-Ebene): layoutSchreiben verweigert ──────────
{
  const dir = mkdtempSync(join(tmpdir(), 'wov-hoehenkorrektur-'));
  const pfad = join(dir, 'welt.json');
  try {
    const gueltig = dok({ placements: [] });
    layoutSchreiben(pfad, gueltig);
    let warf: unknown = null;
    try {
      layoutSchreiben(pfad, {
        ...gueltig,
        heightDeltas: [zone(1, 1, [[10, 50]]), { zx: 0, zz: 0, r: ['0|99999|5'] }],
      });
    } catch (e) {
      warf = e;
    }
    check(
      '422-Weg: ungültiger Rasterindex in heightDeltas wirft LayoutHoehenkorrekturUngueltig, nichts geschrieben',
      warf instanceof LayoutHoehenkorrekturUngueltig,
      String(warf)
    );
    const nachher = JSON.parse(readFileSync(pfad, 'utf-8')) as { heightDeltas?: unknown };
    check('422-Weg: die Datei auf der Platte blieb unverändert (kein heightDeltas)', nachher.heightDeltas === undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\n=== HOEHENKORREKTUR: ALL PASSED ===');
