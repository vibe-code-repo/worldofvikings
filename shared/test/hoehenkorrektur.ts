/**
 * Handkorrektur der Geländehöhe (`WorldLayout.heightDeltas`, Karte T1/N1 —
 * Datenmodell, nachgebessert nach Angriff PR #114).
 *
 *  1) Sanitizer: gültige Form, stabil sortiert (Zone, dann Index je Zone).
 *  2) Sanitizer-Grenzfälle: jede in der Karte genannte Bedingung, Zone/Index-
 *     Schema 64×64 (0…4095, N1/B2).
 *  3) `hoehenkorrekturFehler` (422-Weg): dieselben Bedingungen, gemeldet statt
 *     still bereinigt; `__proto__`, doppelte Zone, gemischte Punkte, Index 64
 *     (gültig, N1/B1 Testliste).
 *  4) Fehlendes Feld verhält sich exakt wie ein leeres.
 *  5) Ohne Feld: golden-Datei gegen `origin/main` (N1/B4 — Abschnitt 5 aus
 *     T1 verglich nur zwei Instanzen desselben Codes, kein main).
 *  6) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation dazwischen.
 *  7) Sockelfläche (`einebnen`): Korrektur wirkt dort nicht — mit ehrlichem
 *     Hinweis, was daran unabhängig vom Feld wahr wäre (N1/B4).
 *  8) Cache je Zone: eine ECHTE Änderung der Korrektur (zwei Geo-Aufbauten)
 *     wird sichtbar, die nicht geänderte Nachbarzone bleibt unverändert, auch
 *     bei gleichem Index in beiden Zonen (N1/B4).
 *  9) Server = Client: zwei VERSCHIEDENE Code-Pfade — `geo.getHeight`
 *     (`ZoneManager`/KI-Weltbau-Pfad) gegen `HeightmapProvider.getGroundHeight`
 *     (Client-/Kollisionspfad) — an uniform-biomen Punkten (N1/B4).
 * 10) B2: Naht zwischen Zonen — Band [31,5; 32), alle vier Zonenränder, auch
 *     bei negativen Zonen: `geo.getHeight` und die Heightmap zeigen dieselbe
 *     KORREKTUR-WIRKUNG (Δ), nicht notwendig dieselbe absolute Höhe (die
 *     unterscheidet sich zwischen analytischer und nächster-Vertex-Höhe
 *     unabhängig von dieser Karte).
 * 11) 422-Weg (Sanitizer-Ebene): `layoutSchreiben` verweigert ein Dokument
 *     mit ungültigem heightDeltas. Der ECHTE HTTP-Statuscode (422 mit Liste)
 *     wird über den echten Betriebsdienst in `admin/test/weltops-
 *     hoehenkorrektur.ts` bewiesen (N1/B1) — dieser Test hier beweist nur die
 *     Sanitizer-Schicht.
 *
 * Rot-auf-main-Status je Abschnitt: siehe Kopfkommentare der Abschnitte und
 * den Bericht (`Berichte/2026-09-27 Editor Gelaende T1 N1.md`,
 * Zusicherungstabelle). Mehrere Zusagen (`Sockel gewinnt`, `Interpolation`,
 * `LRU-Treffer` aus T1) sind Regressionswächter, aber NICHT unabhängig rot
 * auf main — main kennt das Feld gar nicht, also ist "ohne Wirkung" dort
 * vakuum wahr. Diese Karte macht das ehrlich, statt es zu verschweigen.
 *
 *   npx tsx test/hoehenkorrektur.ts   (aus shared/)
 */
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
  HOEHENKORREKTUR_INDEX_MAX,
  type WorldLayout,
  type ZoneHeightDelta,
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

/** Eine `ZoneHeightDelta`-Zeile aus [index, deltaCm]-Paaren bauen (sortiert `i`/`d`). */
function zone(zx: number, zz: number, punkte: ReadonlyArray<readonly [number, number]>): ZoneHeightDelta {
  const sortiert = [...punkte].sort((a, b) => a[0] - b[0]);
  return { zx, zz, i: sortiert.map((p) => p[0]).join(','), d: sortiert.map((p) => p[1]).join(',') };
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

// ── 1) Sanitizer: gültige Form, stabil sortiert ────────────────────────
{
  const roh = [
    { zx: 2, zz: -1, i: '100,3', d: '-50,200' },
    { zx: -3, zz: 0, i: '4095', d: '999' },
  ];
  const s = sanitizeHeightDeltas(roh);
  check('Sanitizer: beide Zonen behalten', s.length === 2, JSON.stringify(s));
  check('Sanitizer: Zonen nach zx,zz sortiert', s[0]!.zx === -3 && s[1]!.zx === 2, JSON.stringify(s));
  check('Sanitizer: i/d je Zone nach Index sortiert', s[1]!.i === '3,100' && s[1]!.d === '200,-50', JSON.stringify(s[1]));
}

// ── 2) Sanitizer-Grenzfälle (Zone/Index-Schema N1: 64×64, 0…4095) ──────
{
  check('HOEHENKORREKTUR_INDEX_MAX ist 4095 (64×64 − 1, N1/B2)', HOEHENKORREKTUR_INDEX_MAX === 4095, `${HOEHENKORREKTUR_INDEX_MAX}`);
  const faelle: [string, unknown, number][] = [
    ['falscher Zonenschlüssel (Text)', [{ zx: 'a', zz: 0, i: '0', d: '1' }], 0],
    ['falscher Zonenschlüssel (Bruch)', [{ zx: 1.5, zz: 0, i: '0', d: '1' }], 0],
    ['Index außerhalb 0…4095 (negativ, als Text ohnehin kein GANZZAHL_TEXT)', [{ zx: 0, zz: 0, i: '-1', d: '1' }], 0],
    ['Index 4095 ist der GRÖSSTE gültige (nicht mehr tot, N1/B2)', [{ zx: 0, zz: 0, i: '4095', d: '1' }], 1],
    ['Index 4096 ist außerhalb (64×64 = 4096 Punkte, 0…4095)', [{ zx: 0, zz: 0, i: '4096', d: '1' }], 0],
    ['Index 64 ist ein GEWÖHNLICHER gültiger Punkt (Zeile 1, Spalte 0 — nicht mehr die tote Randspalte von vor N1)', [{ zx: 0, zz: 0, i: '64', d: '1' }], 1],
    ['doppelter Index: der zweite entfällt', [{ zx: 0, zz: 0, i: '5,5', d: '1,2' }], 1],
    ['i/d verschieden lang: die ganze Zone entfällt', [{ zx: 0, zz: 0, i: '5,6', d: '1' }], 0],
    ['i kein String: die ganze Zone entfällt', [{ zx: 0, zz: 0, i: [5], d: '1' }], 0],
    ['ein Teil von i ist keine kanonische Ganzzahl ("5.0"): die ganze Zone entfällt', [{ zx: 0, zz: 0, i: '5.0', d: '1' }], 0],
    ['führende Null ("05") ist keine kanonische Form: die ganze Zone entfällt', [{ zx: 0, zz: 0, i: '05', d: '1' }], 0],
    ['Leerzeichen in der Liste: die ganze Zone entfällt', [{ zx: 0, zz: 0, i: '5, 6', d: '1,2' }], 0],
    ['Delta außerhalb +10000', [{ zx: 0, zz: 0, i: '5', d: '10001' }], 0],
    ['Delta außerhalb -10000', [{ zx: 0, zz: 0, i: '5', d: '-10001' }], 0],
    ['Delta genau an der Grenze (10000/-10000) ist gültig', [{ zx: 0, zz: 0, i: '5,6', d: '10000,-10000' }], 2],
    ['doppelter Zonenschlüssel: der zweite entfällt', [{ zx: 1, zz: 1, i: '0', d: '1' }, { zx: 1, zz: 1, i: '1', d: '2' }], 1],
    ['leeres i/d: die Zone entfällt (keine Korrektur ist keine Korrektur)', [{ zx: 0, zz: 0, i: '', d: '' }], 0],
  ];
  for (const [name, roh, erwartet] of faelle) {
    const s = sanitizeHeightDeltas(roh);
    const anzahlPunkte = s.reduce((n, z) => n + (z.i.length > 0 ? z.i.split(',').length : 0), 0);
    check(`Sanitizer-Grenzfall: ${name}`, anzahlPunkte === erwartet, `${anzahlPunkte} Punkte behalten (${JSON.stringify(s)})`);
  }
}

// ── 3) hoehenkorrekturFehler (422-Weg): dieselben Bedingungen, gemeldet ─
{
  const proben: [string, unknown, boolean][] = [
    ['gültiger Eintrag', [{ zx: 0, zz: 0, i: '0', d: '5' }], false],
    ['Index 64 ist GÜLTIG (N1/B2 Testliste), kein Fund', [{ zx: 0, zz: 0, i: '64', d: '5' }], false],
    ['falscher Zonenschlüssel', [{ zx: 'a', zz: 0, i: '0', d: '5' }], true],
    ['Index außerhalb (4096)', [{ zx: 0, zz: 0, i: '4096', d: '5' }], true],
    ['doppelter Index', [{ zx: 0, zz: 0, i: '1,1', d: '5,6' }], true],
    ['i/d verschieden lang', [{ zx: 0, zz: 0, i: '1,2', d: '5' }], true],
    ['Delta außerhalb', [{ zx: 0, zz: 0, i: '1', d: '99999' }], true],
    ['doppelte Zone (Testliste N1/B1)', [{ zx: 0, zz: 0, i: '1', d: '5' }, { zx: 0, zz: 0, i: '2', d: '5' }], true],
    [
      'gemischte Punkte: ein gültiger, ein ungültiger in DERSELBEN Zone (Testliste N1/B1) — die ganze Zone/Liste ist betroffen',
      [{ zx: 0, zz: 0, i: '1,99999', d: '5,6' }],
      true,
    ],
    ['i kein String', [{ zx: 0, zz: 0, i: 5, d: '5' }], true],
    ['Eintrag kein Objekt', ['x'], true],
    [
      '__proto__ als Schlüssel EINES Eintrags (Testliste N1/B1): kein Absturz, keine Verschmutzung, normale Prüfung',
      [{ zx: 0, zz: 0, i: '1', d: '5', __proto__: { polluted: 1 } }],
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

// ── 5) Ohne Feld: golden-Datei gegen origin/main (N1, behebt B4) ───────
// Referenz `golden/hoehenkorrektur-ohne-feld.bin` wurde EINMAL erzeugt
// (`--schreibe`), aus einem Codestand, der `git archive origin/main`
// byte-für-byte gleich maß (Bericht, Abschnitt "Nachweis Fläche 1"). Jeder
// weitere Lauf vergleicht dagegen — echter Regressionswächter, nicht nur
// zwei Instanzen desselben aktuellen Codes wie in der T1-Fassung.
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

// ── 6) Mit Korrektur: +Δ exakt am Rasterpunkt, Standard-Interpolation ──
// Rot auf main: JA (main hat keinen `korrektur`-Zweig in getBiomeHeight —
// die Höhe an einem Punkt mit einer erfundenen heightDeltas-Angabe bliebe
// dort unverändert, dieser Test würde `neueHoehe === basisHoehe` sehen).
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

  // Interpolation: dieselbe (bestehende) Bilinear-Formel über den bereits
  // eingebackenen Höhen. Rot auf main: NEIN für sich allein (main
  // interpoliert auch ohne heightDeltas ganz normal) — beweisend ist NUR die
  // Kombination mit dem +Δ-Fund oben: Es gibt keinen eigenen neuen
  // Interpolationszweig, den man vergessen könnte.
  const halbeStelle = hmMit.getGroundHeight(wx + 0.5, wz);
  const erwartet = (neueHoehe + nachbarMit) / 2;
  check(
    'Interpolation zwischen Rasterpunkten: Standard-Bilinear über der korrigierten Höhe (rot auf main: nein für sich allein, s. Bericht)',
    Math.abs(halbeStelle - erwartet) < 1e-3,
    `${halbeStelle} vs ${erwartet}`
  );
}

// ── 7) Sockelfläche (`einebnen`): Korrektur wirkt dort NICHT ───────────
// Rot auf main: Die "Gegenprobe" (Korrektur ohne Sockel wirkt voll) ist rot
// auf main (kein heightDeltas dort). "Sockel gewinnt" für sich allein ist
// NICHT unabhängig rot: Der Sockel überschreibt in main JEDE Eingabe
// bedingungslos, das ist keine neue Eigenschaft von T1/N1. Beide zusammen
// beweisen: Die Korrektur existiert (Gegenprobe) UND wird innerhalb des
// Sockels korrekt unterdrückt (erster Teil) — dieselbe Kombination, die
// den Angriff selbst überzeugt hat (URTEIL: "Sockelvorrang… hält").
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

// ── 8) Cache je Zone: EINE ECHTE ÄNDERUNG wird sichtbar, Nachbar bleibt ──
// Rot auf main: JA — main kann heightDeltas nicht ändern (existiert nicht),
// „neuer Wert sichtbar" wäre dort unbeweisbar.
{
  const GEMEINSAMER_INDEX = 500; // absichtlich derselbe Index in Zone A und B: ein Schlüssel-Kollisions-Fehler würde hier zuschlagen
  const zonePos = (zx: number, zz: number): [number, number] => weltpos(zx, zz, GEMEINSAMER_INDEX);
  const [wxA, wzA] = zonePos(0, 0); // Zone A: wird geändert
  const [wxB, wzB] = zonePos(5, -3); // Zone B: Nachbar/andere Zone, bleibt unverändert, TRÄGT DENSELBEN INDEX

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

  // ECHTE Änderung: Zone A bekommt ein anderes Delta (Neustart-Fall, neue Geo). Zone B bleibt unangetastet.
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

// ── 9) Server = Client: geo.getHeight (ZoneManager-Pfad) gegen ─────────
//      HeightmapProvider.getGroundHeight (Client-/Kollisionspfad)
// Rot auf main: main hat keinen `korrektur`-Zweig, also käme "mit
// Korrektur ändert sich beides gleich" dort nie zustande (beide Pfade
// zeigten stur die unveränderte Basis). Uniform-biome Punkte (mitten in
// der einzigen Region dieses Testdokuments, weit von jeder Kante): sonst
// weicht `geo.getHeight` (EIN Biom, analytisch) von der Heightmap
// (möglicher Eckbiom-Blend mehrerer Biome) aus einem ganz anderen, seit
// jeher bestehenden Grund ab (Hinweis im Angriffsbericht: Mischbiom-Zonen
// sind nicht bitexakt) — das hat mit dieser Karte nichts zu tun und würde
// den Test flakey machen, wenn man es nicht vermeidet.
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

// ── 10) B2: Naht zwischen Zonen — Band [31,5; 32), alle vier Ränder, ───
//       negative Zonen. Verglichen wird die KORREKTUR-WIRKUNG (Δ), nicht
//       die absolute Höhe (die unterscheidet sich zwischen `geo.getHeight`
//       und der nächsten-Vertex-Heightmap unabhängig von jeder Korrektur).
// Rot auf main: main hat keinen Zone/Index-Mapping-Fehler zu beheben, weil
// es das ganze Konzept nicht kennt — dieser Test ist strukturell an T1/N1
// gebunden (Importfehler auf main).
{
  type Randfall = { name: string; korrekturWelt: [number, number]; innerhalbBand: [number, number]; unberuehrt: [number, number] };
  // Je Fall: eine Korrektur GENAU auf einem Rasterpunkt an einer Zonengrenze,
  // ein Punkt im Band [rand-0,5; rand) davor (muss densel­ben Δ zeigen), ein
  // Punkt klar auf der anderen Seite (muss Δ=0 zeigen, andere Adresse).
  const FAELLE: Randfall[] = [
    { name: 'positive Zone, +x-Rand (x=32)', korrekturWelt: [32, 10], innerhalbBand: [31.7, 10], unberuehrt: [30.5, 10] },
    { name: 'positive Zone, +z-Rand (z=32)', korrekturWelt: [10, 32], innerhalbBand: [10, 31.7], unberuehrt: [10, 30.5] },
    { name: 'negative Zone, −x-Rand (x=−32)', korrekturWelt: [-32, -800], innerhalbBand: [-31.7, -800], unberuehrt: [-30.5, -800] },
    { name: 'negative Zone, −z-Rand (z=−32)', korrekturWelt: [-800, -32], innerhalbBand: [-800, -31.7], unberuehrt: [-800, -30.5] },
    { name: 'negative Zone, +x-Rand bei negativem zx (x=−96 = Grenze zx −2/−1)', korrekturWelt: [-96, -800], innerhalbBand: [-96.3, -800], unberuehrt: [-97.5, -800] },
  ];
  for (const f of FAELLE) {
    const [kx, kz] = f.korrekturWelt;
    // Zone/Index der Korrektur GENAU aus derselben Formel wie RegionGeo.zoneUndIndex (floor nach Runden).
    const halb = ZONE_UNITS / 2;
    const zx = Math.floor((Math.round(kx) + halb) / ZONE_UNITS);
    const zz = Math.floor((Math.round(kz) + halb) / ZONE_UNITS);
    const rx = Math.round(kx) - (zx * ZONE_UNITS - halb);
    const ry = Math.round(kz) - (zz * ZONE_UNITS - halb);
    check(`${f.name}: Testaufbau, rx/ry in [0,63]`, rx >= 0 && rx <= 63 && ry >= 0 && ry <= 63, `rx=${rx} ry=${ry}`);
    const index = ry * ZONE_UNITS + rx;
    const layoutOhne = dok();
    const layoutMit = dok({ heightDeltas: [zone(zx, zz, [[index, 700]])] }); // +7 m
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

    // Toleranz 1e-3 statt 1e-6: `f32(r.height + d) - r.height` ist bei f32-
    // Rundung nicht bitgenau `d` (float32 hat bei ~30 m Größenordnung nur
    // rund 3–4·10⁻⁶ m Auflösung) — das ist eine Eigenschaft der f32-
    // Arithmetik selbst (Angriffsbericht, Hinweis "Mischbiom-Zonen": bis
    // 1,5·10⁻⁵ m), keine neue Ungenauigkeit dieser Karte.
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

// ── 11) 422-Weg (Sanitizer-Ebene): layoutSchreiben verweigert ──────────
// Der ECHTE HTTP-Statuscode über den Betriebsdienst steht in
// `admin/test/weltops-hoehenkorrektur.ts` (N1/B1) — hier nur die
// Sanitizer/Schreibweg-Schicht, unverändert aus T1 außer dem neuen Format.
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
        heightDeltas: [zone(1, 1, [[10, 50]]), { zx: 0, zz: 0, i: '99999', d: '5' }],
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
