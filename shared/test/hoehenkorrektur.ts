/**
 * Handkorrektur der Geländehöhe (`WorldLayout.heightDeltas`, Karte T1 —
 * Datenmodell). Deckt die Karte Punkt für Punkt:
 *
 *  1) Sanitizer: gültige Form, stabil sortiert (Zone, dann Index je Zone).
 *  2) Sanitizer-Grenzfälle: jede in der Karte genannte Bedingung.
 *  3) `hoehenkorrekturFehler` (422-Weg): dieselben Bedingungen, gemeldet statt still bereinigt.
 *  4) Fehlendes Feld verhält sich exakt wie ein leeres.
 *  5) Ohne Feld: ≥10 000 Stichpunkte über mehrere Zonen der echten dev.json.
 *  6) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation dazwischen.
 *  7) Sockelfläche (`einebnen`): Korrektur wirkt dort nicht.
 *  8) Cache je Zone: eine Korrektur bleibt an ihre eigene Zone gebunden.
 *  9) Server = Client: unabhängig aufgebaute Geo liefert bitgleiche Höhen.
 * 10) 422-Weg: `layoutSchreiben` verweigert ein Dokument mit ungültigem heightDeltas.
 *
 * Alle Prüfungen hier sind auf `origin/main` rot: Das Feld, `sanitizeHeightDeltas`,
 * `hoehenkorrekturFehler`, `HoehenKorrekturField` und `LayoutHoehenkorrekturUngueltig`
 * existieren dort nicht (Importfehler).
 *
 *   npx tsx test/hoehenkorrektur.ts   (aus shared/)
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo } from '../src/worldgen/factory.js';
import { HeightmapProvider, E_WIDTH, ZONE_UNITS } from '../src/worldgen/Heightmap.js';
import type { RegionGeo } from '../src/worldgen/RegionGeo.js';
import { getStableHash } from '../src/hash.js';
import {
  sanitizeWorldLayout,
  sanitizeHeightDeltas,
  hoehenkorrekturFehler,
  type WorldLayout,
} from '../src/worldlayout/index.js';
import { layoutSchreiben, LayoutHoehenkorrekturUngueltig } from '../src/worldlayout/layoutDatei.js';

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

function geoAus(layout: WorldLayout, settings: { bilinearSampling?: boolean } = {}): { geo: RegionGeo; hm: HeightmapProvider } {
  const geo = createGeo({ mode: 'layout', worldSeed: getStableHash('hoehenkorrektur-test'), layout }) as RegionGeo;
  return { geo, hm: new HeightmapProvider(geo, { blendSmoothStep: true, ...settings }) };
}

// ── 1) Sanitizer: gültige Form, stabil sortiert ────────────────────────
{
  const roh = [
    { zx: 2, zz: -1, points: [[100, -50], [3, 200]] },
    { zx: -3, zz: 0, points: [[4224, 999]] },
  ];
  const s = sanitizeHeightDeltas(roh);
  check('Sanitizer: beide Zonen behalten', s.length === 2, JSON.stringify(s));
  check('Sanitizer: Zonen nach zx,zz sortiert', s[0]!.zx === -3 && s[1]!.zx === 2, JSON.stringify(s));
  check(
    'Sanitizer: Punkte je Zone nach Index sortiert',
    JSON.stringify(s[1]!.points) === JSON.stringify([[3, 200], [100, -50]]),
    JSON.stringify(s[1]!.points)
  );
}

// ── 2) Sanitizer-Grenzfälle ─────────────────────────────────────────────
{
  const faelle: [string, unknown, number][] = [
    ['falscher Zonenschlüssel (Text)', [{ zx: 'a', zz: 0, points: [[0, 1]] }], 0],
    ['falscher Zonenschlüssel (Bruch)', [{ zx: 1.5, zz: 0, points: [[0, 1]] }], 0],
    ['Index außerhalb 0…4224 (negativ)', [{ zx: 0, zz: 0, points: [[-1, 1]] }], 0],
    ['Index außerhalb 0…4224 (4225)', [{ zx: 0, zz: 0, points: [[4225, 1]] }], 0],
    ['doppelter Index: der zweite entfällt', [{ zx: 0, zz: 0, points: [[5, 1], [5, 2]] }], 1],
    ['nicht ganzzahliger Wert (Delta 1.5)', [{ zx: 0, zz: 0, points: [[5, 1.5]] }], 0],
    ['NaN (Delta)', [{ zx: 0, zz: 0, points: [[5, NaN]] }], 0],
    ['Delta außerhalb +10000', [{ zx: 0, zz: 0, points: [[5, 10_001]] }], 0],
    ['Delta außerhalb -10000', [{ zx: 0, zz: 0, points: [[5, -10_001]] }], 0],
    ['Delta genau an der Grenze (10000/-10000) ist gültig', [{ zx: 0, zz: 0, points: [[5, 10_000], [6, -10_000]] }], 2],
    ['doppelter Zonenschlüssel: der zweite entfällt', [{ zx: 1, zz: 1, points: [[0, 1]] }, { zx: 1, zz: 1, points: [[1, 2]] }], 1],
    ['points kein Array', [{ zx: 0, zz: 0, points: 'x' }], 0],
    ['Zone ohne gültigen Punkt entfällt ganz', [{ zx: 0, zz: 0, points: [['x', 1]] }], 0],
  ];
  for (const [name, roh, erwartet] of faelle) {
    const s = sanitizeHeightDeltas(roh);
    const anzahlPunkte = s.reduce((n, z) => n + z.points.length, 0);
    check(`Sanitizer-Grenzfall: ${name}`, anzahlPunkte === erwartet, `${anzahlPunkte} Punkte behalten (${JSON.stringify(s)})`);
  }
  const zuViele = { zx: 0, zz: 0, points: Array.from({ length: 5000 }, (_, i) => [i % 4225, (i % 199) - 99]) };
  const sZuViele = sanitizeHeightDeltas([zuViele]);
  check('Sanitizer-Grenzfall: zu viele Einträge je Zone werden gekappt, nicht 5000', (sZuViele[0]?.points.length ?? 0) <= 4225, `${sZuViele[0]?.points.length}`);
}

// ── 3) hoehenkorrekturFehler (422-Weg): dieselben Bedingungen, gemeldet ─
{
  const proben: [string, unknown, boolean][] = [
    ['gültiger Eintrag', [{ zx: 0, zz: 0, points: [[0, 5]] }], false],
    ['falscher Zonenschlüssel', [{ zx: 'a', zz: 0, points: [[0, 5]] }], true],
    ['Index außerhalb', [{ zx: 0, zz: 0, points: [[9999, 5]] }], true],
    ['doppelter Index', [{ zx: 0, zz: 0, points: [[1, 5], [1, 6]] }], true],
    ['Delta keine Ganzzahl', [{ zx: 0, zz: 0, points: [[1, 5.5]] }], true],
    ['Delta NaN', [{ zx: 0, zz: 0, points: [[1, NaN]] }], true],
    ['Delta außerhalb', [{ zx: 0, zz: 0, points: [[1, 99_999]] }], true],
    ['doppelter Zonenschlüssel', [{ zx: 0, zz: 0, points: [[1, 5]] }, { zx: 0, zz: 0, points: [[2, 5]] }], true],
    ['zu viele Punkte', [{ zx: 0, zz: 0, points: Array.from({ length: 4300 }, (_, i) => [i, 1]) }], true],
    ['points kein Array', [{ zx: 0, zz: 0, points: 'x' }], true],
    ['Eintrag kein Objekt', ['x'], true],
    ['Punkt kein Zweiertupel', [{ zx: 0, zz: 0, points: [[1, 2, 3]] }], true],
  ];
  for (const [name, roh, erwartetFehler] of proben) {
    const f = hoehenkorrekturFehler(roh);
    check(`hoehenkorrekturFehler: ${name}`, (f.length > 0) === erwartetFehler, JSON.stringify(f));
  }
  check('hoehenkorrekturFehler: kein Array meldet nichts (listenPruefen übernimmt das)', hoehenkorrekturFehler(undefined).length === 0 && hoehenkorrekturFehler(null).length === 0 && hoehenkorrekturFehler('x').length === 0);
}

// ── 4) Fehlendes Feld verhält sich exakt wie ein leeres ────────────────
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

// ── 5) Ohne Feld: ≥10 000 Stichpunkte über mehrere Zonen der echten dev.json ──
{
  const devPfad = fileURLToPath(new URL('../../server/data/welten/dev.json', import.meta.url));
  const devRoh = JSON.parse(readFileSync(devPfad, 'utf-8')) as unknown;
  const layout = sanitizeWorldLayout(devRoh)!;
  check('dev.json hat (Ist-Stand) kein heightDeltas', layout.heightDeltas === undefined);
  const geo1 = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout: devRoh }) as RegionGeo;
  const hm1 = new HeightmapProvider(geo1, {});
  const geo2 = createGeo({ mode: 'layout', worldSeed: getStableHash(layout.detailSeed), layout: devRoh }) as RegionGeo;
  const hm2 = new HeightmapProvider(geo2, {});
  const ZONEN: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [2, 2], [-3, 4], [5, -2]];
  let proben = 0;
  let abweichend = 0;
  for (const [zx, zz] of ZONEN) {
    const z1 = hm1.getZone(zx, zz);
    const z2 = hm2.getZone(zx, zz);
    for (let i = 0; i < z1.heights.length; i++) {
      if (z1.heights[i] !== z2.heights[i]) abweichend++;
      proben++;
    }
  }
  check('≥10 000 Stichpunkte über mehrere Zonen gemessen', proben >= 10_000, `${proben} Punkte über ${ZONEN.length} Zonen`);
  check(
    'ohne heightDeltas: zwei unabhängig aufgebaute Geo/Provider liefern bitgleiche Höhen an der echten dev.json',
    abweichend === 0,
    `${abweichend}/${proben} abweichend`
  );
  // Der Vergleich GEGEN origin/main (git archive) ist der Bericht des Bauern
  // (siehe Berichte/2026-09-27 Editor Gelaende T1.md) — dieser Test beweist
  // die interne Determinismus-Voraussetzung dafür.
}

// ── 6) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation ──
{
  const layout = dok();
  const { hm: hmOhne } = geoAus(layout, { bilinearSampling: true });
  // Zone (0,0): baseX = baseZ = -32. Weltposition (10,10) trifft exakt rx=42, ry=42.
  const rx = 42;
  const ry = 42;
  const wx = rx - ZONE_UNITS / 2;
  const wz = ry - ZONE_UNITS / 2;
  const deltaCm = 350; // +3.5 m
  const mitKorrektur = dok({ heightDeltas: [{ zx: 0, zz: 0, points: [[ry * E_WIDTH + rx, deltaCm]] }] });
  const { hm: hmMit } = geoAus(mitKorrektur, { bilinearSampling: true });

  const basisHoehe = hmOhne.getGroundHeight(wx, wz);
  const neueHoehe = hmMit.getGroundHeight(wx, wz);
  check(
    'Mit Korrektur: +Δ exakt am Rasterpunkt',
    Math.abs(neueHoehe - (basisHoehe + deltaCm / 100)) < 1e-4,
    `${neueHoehe} vs ${basisHoehe + deltaCm / 100}`
  );

  const nachbarOhne = hmOhne.getGroundHeight(wx + 1, wz);
  const nachbarMit = hmMit.getGroundHeight(wx + 1, wz);
  check('Der nicht getroffene Nachbar-Rasterpunkt bleibt unverändert', nachbarOhne === nachbarMit, `${nachbarOhne} vs ${nachbarMit}`);

  // Zwischen den Rasterpunkten: dieselbe (bestehende) Bilinear-Formel über
  // den bereits eingebackenen Höhen — keine eigene neue Interpolation.
  const halbeStelle = hmMit.getGroundHeight(wx + 0.5, wz);
  const erwartet = (neueHoehe + nachbarMit) / 2;
  check(
    'Interpolation zwischen Rasterpunkten: Standard-Bilinear über der korrigierten Höhe',
    Math.abs(halbeStelle - erwartet) < 1e-3,
    `${halbeStelle} vs ${erwartet}`
  );
}

// ── 7) Sockelfläche (`einebnen`): Korrektur wirkt dort NICHT ───────────
{
  const platzierungen = [{ id: 'sockel', prefab: 'Kiste', x: 100, z: 100, einebnen: 20 }];
  const ohneKorrektur = dok({ placements: platzierungen });
  // Weltposition (105, 100), 5 m vom Plattenmittelpunkt entfernt: fest
  // innerhalb des Sockelradius (20 m). Zone: zx = floor((105+32)/64) = 2,
  // baseX = 96, rx = 9; zz = floor((100+32)/64) = 2, baseZ = 96, ry = 4.
  const rx = 9;
  const ry = 4;
  const wx = 2 * ZONE_UNITS - ZONE_UNITS / 2 + rx; // 105
  const wz = 2 * ZONE_UNITS - ZONE_UNITS / 2 + ry; // 100
  check('Testaufbau: (wx,wz) trifft die erwartete Weltposition', wx === 105 && wz === 100, `${wx},${wz}`);
  const mitKorrektur = dok({
    placements: platzierungen,
    heightDeltas: [{ zx: 2, zz: 2, points: [[ry * E_WIDTH + rx, 500]] }], // +5 m, weit über der Böschungsbreite
  });
  const { hm: hmOhneS } = geoAus(ohneKorrektur);
  const { hm: hmMitS } = geoAus(mitKorrektur);
  const hOhne = hmOhneS.getGroundHeight(wx, wz);
  const hMit = hmMitS.getGroundHeight(wx, wz);
  check(
    'Sockelfläche: eine Korrektur innerhalb des Sockelradius ändert die Höhe nicht (Sockel gewinnt)',
    Math.abs(hOhne - hMit) < 1e-4,
    `ohne ${hOhne} / mit ${hMit}`
  );
  // Gegenprobe: derselbe Korrekturpunkt OHNE Sockel wirkt voll.
  const nurKorrektur = dok({ heightDeltas: [{ zx: 2, zz: 2, points: [[ry * E_WIDTH + rx, 500]] }] });
  const { hm: hmNurBasis } = geoAus(dok());
  const { hm: hmNurKorrektur } = geoAus(nurKorrektur);
  const hBasis = hmNurBasis.getGroundHeight(wx, wz);
  const hKorrigiert = hmNurKorrektur.getGroundHeight(wx, wz);
  check(
    'Gegenprobe: ohne Sockel wirkt derselbe Korrekturpunkt voll (+5 m)',
    Math.abs(hKorrigiert - (hBasis + 5)) < 1e-4,
    `${hKorrigiert} vs ${hBasis + 5}`
  );
}

// ── 8) Cache je Zone: eine Korrektur bleibt an ihre eigene Zone gebunden ──
{
  const zA = { zx: 0, zz: 0, idx: 100, delta: 400 };
  const zB = { zx: 5, zz: -3, idx: 200, delta: -250 };
  const weltpos = (z: { zx: number; zz: number; idx: number }): [number, number] => {
    const rx = z.idx % E_WIDTH;
    const ry = Math.floor(z.idx / E_WIDTH);
    return [z.zx * ZONE_UNITS - ZONE_UNITS / 2 + rx, z.zz * ZONE_UNITS - ZONE_UNITS / 2 + ry];
  };
  const [wxA, wzA] = weltpos(zA);
  const [wxB, wzB] = weltpos(zB);

  const { hm: hmOhne } = geoAus(dok());
  const baseA = hmOhne.getGroundHeight(wxA, wzA);
  const baseB = hmOhne.getGroundHeight(wxB, wzB);

  const layout = dok({
    heightDeltas: [
      { zx: zA.zx, zz: zA.zz, points: [[zA.idx, zA.delta]] },
      { zx: zB.zx, zz: zB.zz, points: [[zB.idx, zB.delta]] },
    ],
  });
  const { geo, hm } = geoAus(layout);

  const hA1 = hm.getGroundHeight(wxA, wzA);
  const hB1 = hm.getGroundHeight(wxB, wzB);
  check('Cache je Zone: Zone A trägt ihre eigene Korrektur', Math.abs(hA1 - (baseA + zA.delta / 100)) < 1e-4, `${hA1} vs ${baseA + zA.delta / 100}`);
  check('Cache je Zone: Zone B trägt ihre eigene, ANDERE Korrektur', Math.abs(hB1 - (baseB + zB.delta / 100)) < 1e-4, `${hB1} vs ${baseB + zB.delta / 100}`);
  check('Cache je Zone: zwei Zonen tatsächlich gecacht', hm.cachedZoneCount === 2, `${hm.cachedZoneCount}`);

  const hA2 = hm.getGroundHeight(wxA, wzA);
  check('Cache je Zone: LRU-Treffer liefert weiter die eigene Korrektur (kein Bluten von B nach A)', hA2 === hA1, `${hA2} vs ${hA1}`);

  // Verdrängen (Cap 1) und neu bauen: dieselbe Geo, weiterhin die richtige Korrektur je Zone.
  const hmKlein = new HeightmapProvider(geo, { blendSmoothStep: true }, 1);
  hmKlein.getGroundHeight(wxA, wzA); // baut + cacht A (Cap 1)
  const nB = hmKlein.getGroundHeight(wxB, wzB); // verdrängt A aus dem Cap-1-Cache
  check('Cache je Zone: nach Verdrängung + Neubau weiterhin die richtige Korrektur (B)', Math.abs(nB - (baseB + zB.delta / 100)) < 1e-4, `${nB}`);
  const nA2 = hmKlein.getGroundHeight(wxA, wzA); // baut A neu aus derselben Geo
  check('Cache je Zone: nach Verdrängung + Neubau weiterhin die richtige Korrektur (A, neu gebaut)', Math.abs(nA2 - (baseA + zA.delta / 100)) < 1e-4, `${nA2}`);
}

// ── 9) Server = Client: unabhängig aufgebaute Geo liefert bitgleiche Höhen ──
{
  const layout = dok({
    heightDeltas: [
      { zx: 1, zz: 1, points: [[500, 777], [0, -321]] },
      { zx: -2, zz: 3, points: [[4224, 10_000], [1, -10_000]] },
    ],
  });
  const serverSeite = geoAus(layout);
  const clientSeite = geoAus(layout);
  let abweichend = 0;
  let proben = 0;
  for (let zx = -3; zx <= 3; zx++) {
    for (let zz = -3; zz <= 3; zz++) {
      const zS = serverSeite.hm.getZone(zx, zz);
      const zC = clientSeite.hm.getZone(zx, zz);
      for (let i = 0; i < zS.heights.length; i++) {
        if (zS.heights[i] !== zC.heights[i]) abweichend++;
        proben++;
      }
    }
  }
  check(
    'Server = Client: unabhängig aufgebaute Geo liefert bitgleiche Höhen (mit Korrektur)',
    abweichend === 0 && proben > 0,
    `${abweichend}/${proben} abweichend`
  );
}

// ── 10) 422-Weg: layoutSchreiben verweigert ein Dokument mit ungültigem heightDeltas ──
{
  const dir = mkdtempSync(join(tmpdir(), 'wov-hoehenkorrektur-'));
  const pfad = join(dir, 'welt.json');
  try {
    const gueltig = dok({ placements: [] });
    layoutSchreiben(pfad, gueltig);
    let warf: unknown = null;
    try {
      // Eine gültige Zone bleibt übrig (Feld insgesamt nicht leer): Der
      // granulare 422-Weg greift, nicht die pauschale "Feld ganz leer"-Prüfung.
      layoutSchreiben(pfad, {
        ...gueltig,
        heightDeltas: [
          { zx: 1, zz: 1, points: [[10, 50]] },
          { zx: 0, zz: 0, points: [[99_999, 5]] },
        ],
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
