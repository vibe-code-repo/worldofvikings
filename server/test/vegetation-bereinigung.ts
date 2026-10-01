/**
 * Bäume entfernen V2: Bereinigung gespeicherter Streu-ZDOs (`vegetationBereinigung.ts`).
 * Removed vegetation V2: cleanup of saved scatter ZDOs.
 *
 *  A. Bereinigung (ZDOManager): gemarkte Streu-ZDOs im Kreis weg, außerhalb bleiben sie; `nur: 'baeume'` lässt Büsche
 *     stehen; `layoutId`, `spieler`, ungemarkte (gezählt) und Fremd-Prefabs bleiben; Löschliste (Clients); Rand zählt;
 *     Obergrenze lehnt ab und löscht nichts (auch nicht teilweise); trocken löscht nichts.
 *  B. Boot (`bereinigeBeimBoot`): gültiges Feld räumt, beschädigtes Feld löscht nichts und meldet laut, kein Feld still.
 *  C. Live (`LayoutWache` mit dem echten Ast `vegetationLive`): Kreis hinzu räumt sofort, Quittung zählt, kein Geo-Ast,
 *     kein Zählen gegen AENDERUNGEN_MAX, Obergrenze lehnt ganz ab, nur hinzugekommene Kreise, entfernter Kreis bringt
 *     nichts zurück, beschädigtes Feld wird nicht angewendet.
 *  D. Prüfer-Austausch im echten `ZoneManager`: nach der Live-Änderung streut eine NEUE Zone mit dem neuen Kreis.
 *  E. Leistung: 100 Zonen, 100 Kreise (Zahl wird ausgegeben).
 *
 * Lauf: npx tsx server/test/vegetation-bereinigung.ts   (aus der Projektwurzel)
 */
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FOLIAGE,
  GRASLAND_FLORA_NAMEN,
  HeightmapProvider,
  NADELWALD_FLORA_NAMEN,
  RegionGeo,
  getStableHash,
  sanitizeWorldLayout,
  streuArt,
  type VegetationEntferntKreis,
  type WorldLayout,
} from '@wov/shared';
import { quittungLesen } from '@wov/shared/src/worldlayout/quittung.js';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import { LayoutWache } from '../src/world/layoutLive.js';
import { packeHerkunft } from '../src/world/zonenRuecksetzer.js';
import {
  VEGETATION_LIVE_MAX,
  bereinigeBeimBoot,
  bereinigeVegetation,
  hinzugekommeneKreise,
  vegetationLive,
} from '../src/world/vegetationBereinigung.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const BAUM = FOLIAGE.find((f) => streuArt(f.prefabName) === 'baum')!;
const BUSCH = FOLIAGE.find((f) => streuArt(f.prefabName) === 'sonstiges')!;
const FREMD = getStableHash('Kiste');
const HERKUNFT = packeHerkunft({ x: 0, y: 0 });

interface Optionen {
  /** Streu-Marke (Vorgabe: ja). */
  streu?: boolean;
  layoutId?: string;
  spieler?: boolean;
}
function setze(zdos: ZDOManager, hash: number, x: number, z: number, o: Optionen = {}) {
  const zdo = zdos.createZDO(hash, { x, y: 10, z });
  if (o.streu !== false) zdo.setInt('streu', HERKUNFT);
  if (o.layoutId !== undefined) zdo.setString('layoutId', o.layoutId);
  if (o.spieler) zdo.setInt('spieler', 1);
  return zdo;
}
const lebt = (zdos: ZDOManager, id: { toString(): string }): boolean => zdos.getAllZDOs().some((z) => z.zdoid.toString() === id.toString());

const KREIS: VegetationEntferntKreis = { x: 100, z: 50, r: 20 };

console.log('=== vegetation-bereinigung ===');

// ── A. Bereinigung ──────────────────────────────────────────────────────
console.log('\n[A] Bereinigung:');
{
  const zdos = new ZDOManager(1n);
  const baumIn = setze(zdos, BAUM.prefabHash, 100, 50);
  const buschIn = setze(zdos, BUSCH.prefabHash, 105, 55);
  const baumAussen = setze(zdos, BAUM.prefabHash, 100, 80);
  const baumRand = setze(zdos, BAUM.prefabHash, 120, 50); // Abstand == r
  const baumLayout = setze(zdos, BAUM.prefabHash, 101, 50, { layoutId: 'p1' });
  const baumLeereId = setze(zdos, BAUM.prefabHash, 102, 50, { layoutId: '' });
  const baumSpieler = setze(zdos, BAUM.prefabHash, 103, 50, { spieler: true });
  const baumUngemarkt = setze(zdos, BAUM.prefabHash, 104, 50, { streu: false });
  const buschUngemarkt = setze(zdos, BUSCH.prefabHash, 106, 50, { streu: false });
  const fremd = setze(zdos, FREMD, 107, 50);
  zdos.consumeDestroyList();
  const e = bereinigeVegetation(zdos, [KREIS]);
  check('gemarkter Baum im Kreis weg', !lebt(zdos, baumIn.zdoid));
  check('gemarkter Busch im Kreis weg (ohne `nur`)', !lebt(zdos, buschIn.zdoid));
  check('Fund auf dem Rand (Abstand == r) weg', !lebt(zdos, baumRand.zdoid));
  check('außerhalb bleibt stehen', lebt(zdos, baumAussen.zdoid));
  check('`layoutId` bleibt (von Hand gesetzt)', lebt(zdos, baumLayout.zdoid));
  check('leere `layoutId` bleibt (Member vorhanden)', lebt(zdos, baumLeereId.zdoid));
  check('`spieler` bleibt', lebt(zdos, baumSpieler.zdoid));
  check('ungemarkter Baum bleibt', lebt(zdos, baumUngemarkt.zdoid));
  check('ungemarkter Busch bleibt', lebt(zdos, buschUngemarkt.zdoid));
  check('Prefab außerhalb der Streu-Flora bleibt, auch mit Marke', lebt(zdos, fremd.zdoid));
  check('Zähler: 3 gelöscht, 3 Treffer, 2 ungemarkte Kandidaten, 1 Zone ohne Marke', e.art === 'ok' && e.geloescht === 3 && e.anzahl === 3 && e.ungemarkt === 2 && e.zonenOhneMarke === 1, JSON.stringify(e));
  const liste = new Set(zdos.consumeDestroyList().map((i) => i.toString()));
  check(
    'Löschliste an die Clients nennt genau die drei',
    liste.size === 3 && liste.has(baumIn.zdoid.toString()) && liste.has(buschIn.zdoid.toString()) && liste.has(baumRand.zdoid.toString())
  );
}
{
  const zdos = new ZDOManager(1n);
  const baum = setze(zdos, BAUM.prefabHash, 100, 50);
  const busch = setze(zdos, BUSCH.prefabHash, 105, 55);
  const e = bereinigeVegetation(zdos, [{ ...KREIS, nur: 'baeume' }]);
  check('`nur: baeume`: Baum weg, Busch bleibt', !lebt(zdos, baum.zdoid) && lebt(zdos, busch.zdoid) && e.geloescht === 1, JSON.stringify(e));
}
{
  const zdos = new ZDOManager(1n);
  for (let i = 0; i < 5; i++) setze(zdos, BAUM.prefabHash, 100 + i, 50);
  const e = bereinigeVegetation(zdos, [KREIS], { grenze: 4 });
  check('Obergrenze: abgelehnt, nichts gelöscht (auch nicht teilweise)', e.art === 'zuViele' && e.geloescht === 0 && e.anzahl === 5 && zdos.getAllZDOs().length === 5, JSON.stringify(e));
  const t = bereinigeVegetation(zdos, [KREIS], { trocken: true });
  check('trocken zählt nur', t.art === 'ok' && t.geloescht === 0 && t.anzahl === 5 && zdos.getAllZDOs().length === 5);
  const genau = bereinigeVegetation(zdos, [KREIS], { grenze: 5 });
  check('genau an der Grenze wird gelöscht', genau.art === 'ok' && genau.geloescht === 5 && zdos.getAllZDOs().length === 0);
}
{
  const zdos = new ZDOManager(1n);
  const baum = setze(zdos, BAUM.prefabHash, 100, 50);
  const e = bereinigeVegetation(zdos, []);
  check('keine Kreise: nichts', e.geloescht === 0 && lebt(zdos, baum.zdoid));
  const k = bereinigeVegetation(zdos, [{ x: 100, z: 50, r: Infinity } as VegetationEntferntKreis, { x: NaN, z: 0, r: 5 } as VegetationEntferntKreis]);
  check('ungültige Kreise wirken nicht (und hängen nicht)', k.geloescht === 0 && lebt(zdos, baum.zdoid));
}
{
  const a: VegetationEntferntKreis = { x: 1, z: 2, r: 3 };
  const b: VegetationEntferntKreis = { x: 1, z: 2, r: 3, nur: 'baeume' };
  check('hinzugekommene Kreise: Mehrfachmenge, `nur` unterscheidet', hinzugekommeneKreise([a], [a, b, a]).length === 2 && hinzugekommeneKreise([a, b], [b]).length === 0);
}

// ── B. Boot ─────────────────────────────────────────────────────────────
console.log('\n[B] Boot:');
const stumm = () => {
  const zeilen: string[] = [];
  return { zeilen, log: { log: (t: string) => zeilen.push(`log ${t}`), warn: (t: string) => zeilen.push(`warn ${t}`), error: (t: string) => zeilen.push(`error ${t}`) } };
};
{
  const zdos = new ZDOManager(1n);
  const baum = setze(zdos, BAUM.prefabHash, 100, 50);
  const s = stumm();
  const e = bereinigeBeimBoot(zdos, { vegetationEntfernt: [KREIS] }, s.log);
  check('gültiges Feld: Baum weg', !lebt(zdos, baum.zdoid) && e !== null && 'geloescht' in e && e.geloescht === 1);
  check('Logzeile mit Zählern', s.zeilen.length === 1 && /Vegetation \(Boot\): 1 gelöscht in 1 Zone/.test(s.zeilen[0]!), s.zeilen.join(' | '));
}
for (const kaputt of [[{ x: 100, z: 50, r: -3 }], 'kaputt', [{ x: 100, z: 50, r: 20 }, 7], new Array(4097).fill({ x: 1, z: 1, r: 1 })]) {
  const zdos = new ZDOManager(1n);
  const baum = setze(zdos, BAUM.prefabHash, 100, 50);
  const s = stumm();
  const e = bereinigeBeimBoot(zdos, { vegetationEntfernt: kaputt }, s.log);
  check(
    `beschädigtes Feld (${Array.isArray(kaputt) ? `Liste ${kaputt.length}` : typeof kaputt}): nichts gelöscht, kein Absturz, laut im Log`,
    lebt(zdos, baum.zdoid) && e !== null && 'reason' in e && s.zeilen.length === 1 && /^error .*beschädigt.*NICHTS gelöscht/.test(s.zeilen[0]!),
    s.zeilen.join(' | ')
  );
}
{
  const zdos = new ZDOManager(1n);
  const baum = setze(zdos, BAUM.prefabHash, 100, 50);
  const s = stumm();
  check('ohne Feld: nichts, still', bereinigeBeimBoot(zdos, {}, s.log) === null && bereinigeBeimBoot(zdos, null, s.log) === null && s.zeilen.length === 0 && lebt(zdos, baum.zdoid));
}
{
  const zdos = new ZDOManager(1n);
  setze(zdos, BAUM.prefabHash, 100, 50, { streu: false });
  const s = stumm();
  bereinigeBeimBoot(zdos, { vegetationEntfernt: [KREIS] }, s.log);
  check('Zone ohne Marke: nicht geräumt, Warnung mit der Zahl', s.zeilen.length === 1 && /^warn .*1 ungemarkte Kandidaten in 1 Zone/.test(s.zeilen[0]!), s.zeilen.join(' | '));
}

// ── C. Live (LayoutWache + echter Ast) ──────────────────────────────────
console.log('\n[C] Live:');
const WURZEL = mkdtempSync(join(tmpdir(), 'wov-vegetation-bereinigung-'));
let nr = 0;
function basis(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Vegetation-Live',
    detailSeed: 'vl',
    continents: [],
    regions: [{ id: 'r', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 800 }, edgeFalloff: 100, baseLevel: 0.3 }],
    ...extra,
  };
}
function live(start: Record<string, unknown>, ohneAst = false) {
  const pfad = join(WURZEL, `layout-${nr++}.json`);
  const q = `${pfad}.quittung`;
  const schreibe = (d: unknown): void => {
    const tmp = `${pfad}.tmp`;
    writeFileSync(tmp, JSON.stringify(d));
    renameSync(tmp, pfad);
  };
  schreibe(start);
  const zdos = new ZDOManager(1n);
  const gesetzt: (readonly VegetationEntferntKreis[] | undefined)[] = [];
  const zones = { setzeVegetationEntfernt: (k: readonly VegetationEntferntKreis[] | undefined) => void gesetzt.push(k) };
  let angewendet = 0;
  let aktuell: unknown = start;
  const wache = new LayoutWache({
    pfad,
    quittungsPfad: q,
    aktuell: () => aktuell,
    speichertGerade: () => false,
    anwenden: () => {
      angewendet++;
      return { art: 'angewendet', zaehler: {} };
    },
    uebernehmen: (roh) => {
      aktuell = roh;
    },
    ...(ohneAst ? {} : { vegetationLive: (alt: WorldLayout, neu: WorldLayout, trocken: boolean) => vegetationLive({ zdos, zones }, alt, neu, trocken) }),
  });
  const stand = (): { angewendet: number } => ({ angewendet });
  const tick = (d: unknown) => {
    schreibe(d);
    wache.tick();
    return quittungLesen(q);
  };
  return { zdos, gesetzt, tick, stand };
}
const logStumm = <T>(f: () => T): T => {
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (): void => undefined;
  try {
    return f();
  } finally {
    Object.assign(console, o);
  }
};
{
  const t = live(basis());
  const baumIn = setze(t.zdos, BAUM.prefabHash, 100, 50);
  const baumAussen = setze(t.zdos, BAUM.prefabHash, 300, 50);
  t.zdos.consumeDestroyList();
  const q = logStumm(() => t.tick(basis({ vegetationEntfernt: [KREIS] })));
  check('Quittung: angewendet, kein `geo`', q?.ergebnis === 'angewendet' && q.grund === null, `${q?.ergebnis} ${q?.grund} ${q?.detail}`);
  check('Kreis hinzu: Baum im Kreis sofort weg, außerhalb bleibt', !lebt(t.zdos, baumIn.zdoid) && lebt(t.zdos, baumAussen.zdoid));
  check('Löschliste (Clients) hat den Baum', t.zdos.consumeDestroyList().some((i) => i.toString() === baumIn.zdoid.toString()));
  check('Quittung zählt: vegetationGeloescht = 1', q?.zaehler?.vegetationGeloescht === 1, JSON.stringify(q?.zaehler));
  check('Prüfer neuer Zonen ausgetauscht (neuer Stand übergeben)', t.gesetzt.length === 1 && t.gesetzt[0]?.length === 1 && t.gesetzt[0]![0]!.x === 100);
}
{
  const t = live(basis());
  const baumIn = setze(t.zdos, BAUM.prefabHash, 100, 50);
  // 100 Kreise auf einmal: zählt nicht gegen AENDERUNGEN_MAX (40) und ist keine Geo-Änderung
  const kreise = Array.from({ length: 100 }, (_, i) => ({ x: 100 + (i % 10) * 3, z: 50 + Math.floor(i / 10) * 3, r: 2 }));
  const q = logStumm(() => t.tick(basis({ vegetationEntfernt: kreise })));
  check('100 Kreise in einem Vorgang: angewendet (kein AENDERUNGEN_MAX, kein geo)', q?.ergebnis === 'angewendet' && q.grund === null && !lebt(t.zdos, baumIn.zdoid), `${q?.ergebnis} ${q?.grund}`);
}
{
  const t = live(basis());
  const ids = [];
  for (let i = 0; i < VEGETATION_LIVE_MAX + 1; i++) ids.push(setze(t.zdos, BAUM.prefabHash, 100 + (i % 200) * 0.1, 50 + Math.floor(i / 200) * 0.01).zdoid);
  const q = logStumm(() => t.tick(basis({ vegetationEntfernt: [KREIS] })));
  check(
    `Obergrenze (${VEGETATION_LIVE_MAX + 1} Treffer): abgelehnt, nichts gelöscht, nichts angewendet`,
    q?.ergebnis === 'nicht-angewendet' && q.grund === 'zu-viele-aenderungen' && t.zdos.getAllZDOs().length === VEGETATION_LIVE_MAX + 1 && t.stand().angewendet === 0 && t.gesetzt.length === 0,
    `${q?.grund} ${q?.detail}`
  );
}
{
  // nur HINZUGEKOMMENE Kreise räumen; ein entfernter Kreis bringt nichts zurück
  const A: VegetationEntferntKreis = { x: 100, z: 50, r: 10 };
  const B: VegetationEntferntKreis = { x: 200, z: 50, r: 10 };
  const t = live(basis({ vegetationEntfernt: [A] }));
  const inA = setze(t.zdos, BAUM.prefabHash, 100, 50); // steht im ALTEN Kreis (neu gespawnt/übersehen): wird nicht angefasst
  const inB = setze(t.zdos, BAUM.prefabHash, 200, 50);
  logStumm(() => t.tick(basis({ vegetationEntfernt: [A, B] })));
  check('nur der hinzugekommene Kreis B räumt, A wird nicht erneut angewendet', lebt(t.zdos, inA.zdoid) && !lebt(t.zdos, inB.zdoid));
  const vorher = t.zdos.getAllZDOs().length;
  const q = logStumm(() => t.tick(basis({ vegetationEntfernt: [B] })));
  check('Kreis entfernt: angewendet, nichts gelöscht, nichts zurück', q?.ergebnis === 'angewendet' && t.zdos.getAllZDOs().length === vorher && t.gesetzt.at(-1)?.length === 1);
  const q2 = logStumm(() => t.tick(basis({ vegetationEntfernt: [] })));
  check('alle Kreise entfernt: Prüfer neuer Zonen bekommt die leere Liste', q2?.ergebnis === 'angewendet' && t.gesetzt.length === 3 && (t.gesetzt.at(-1)?.length ?? 0) === 0);
}
{
  const t = live(basis());
  const baum = setze(t.zdos, BAUM.prefabHash, 100, 50);
  const q = logStumm(() => t.tick(basis({ vegetationEntfernt: [{ x: 100, z: 50, r: -1 }] })));
  check('beschädigtes Feld live: verworfen, nichts gelöscht, nichts angewendet', q?.grund === 'verworfen' && /vegetationEntfernt/.test(q.detail ?? '') && lebt(t.zdos, baum.zdoid) && t.stand().angewendet === 0, `${q?.grund} ${q?.detail}`);
  const q2 = logStumm(() => t.tick(basis({ vegetationEntfernt: [KREIS] })));
  check('nach der Korrektur greift der Abgleich', q2?.ergebnis === 'angewendet' && !lebt(t.zdos, baum.zdoid));
}
{
  const t = live(basis(), true);
  const baum = setze(t.zdos, BAUM.prefabHash, 100, 50);
  logStumm(() => t.tick(basis({ vegetationEntfernt: [KREIS] })));
  check('Gegenprobe ohne Ast (Wache ohne `vegetationLive`): nichts gelöscht', lebt(t.zdos, baum.zdoid));
}

// ── D. Prüfer-Austausch im echten ZoneManager ───────────────────────────
console.log('\n[D] Prüfer-Austausch (ZoneManager):');
const SEED = getStableHash('KxSYuZquuw');
function zoneManager() {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Vegetation-Live-Zone',
    detailSeed: 've',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [...GRASLAND_FLORA_NAMEN, ...NADELWALD_FLORA_NAMEN.filter((n) => !GRASLAND_FLORA_NAMEN.includes(n))],
      },
    ],
  })!;
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  return { zm: new ZoneManager(geo, heightmaps, zdos, SEED), zdos };
}
{
  const ZONE = { x: -2, y: 1 };
  const MITTE = { x: -150, z: 90, r: 40 };
  const imKreis = (z: { position: { x: number; z: number } }): boolean => (z.position.x - MITTE.x) ** 2 + (z.position.z - MITTE.z) ** 2 <= MITTE.r ** 2;
  const zahl = (zdos: ZDOManager): number => zdos.getAllZDOs().filter(imKreis).length;
  const ohne = zoneManager();
  ohne.zm.erzeugeZone(ZONE);
  const vorher = zahl(ohne.zdos);
  const mit = zoneManager();
  mit.zm.setzeVegetationEntfernt([MITTE]);
  mit.zm.erzeugeZone(ZONE);
  check('Bezug: die Zone hat im Kreis Gestreutes', vorher > 0, `${vorher}`);
  check('nach dem Austausch streut eine NEUE Zone ohne Objekte im Kreis', zahl(mit.zdos) === 0 && mit.zdos.getAllZDOs().length > 0, `${zahl(mit.zdos)} im Kreis, ${mit.zdos.getAllZDOs().length} gesamt`);
  const zurueck = zoneManager();
  zurueck.zm.setzeVegetationEntfernt([MITTE]);
  zurueck.zm.setzeVegetationEntfernt([]);
  zurueck.zm.erzeugeZone(ZONE);
  check('leere Liste: der Kreis gilt in neuen Zonen nicht mehr', zahl(zurueck.zdos) === vorher, `${zahl(zurueck.zdos)} vs ${vorher}`);
  // Zusammenspiel: Live-Ast tauscht den Prüfer des echten ZoneManagers
  const z = zoneManager();
  const t = live(basis());
  const zones = z.zm;
  const gesetzt: unknown[] = [];
  vegetationLive({ zdos: t.zdos, zones: { setzeVegetationEntfernt: (k) => (gesetzt.push(k), zones.setzeVegetationEntfernt(k)) } }, basis() as unknown as WorldLayout, basis({ vegetationEntfernt: [MITTE] }) as unknown as WorldLayout, false);
  zones.erzeugeZone(ZONE);
  check('`vegetationLive` (nicht trocken) wirkt auf den echten ZoneManager', gesetzt.length === 1 && zahl(z.zdos) === 0);
  const z2 = zoneManager();
  vegetationLive({ zdos: new ZDOManager(1n), zones: z2.zm }, basis() as unknown as WorldLayout, basis({ vegetationEntfernt: [MITTE] }) as unknown as WorldLayout, true);
  z2.zm.erzeugeZone(ZONE);
  check('trocken tauscht nichts aus', zahl(z2.zdos) === vorher);
}

// ── E. Leistung ─────────────────────────────────────────────────────────
console.log('\n[E] Leistung (100 Zonen, 100 Kreise):');
{
  const zdos = new ZDOManager(1n);
  const arten = FOLIAGE;
  let s = 7;
  const zufall = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  let gesamt = 0;
  for (let zy = 0; zy < 10; zy++) {
    for (let zx = 0; zx < 10; zx++) {
      for (let i = 0; i < 95; i++) {
        setze(zdos, arten[(zufall() * arten.length) | 0]!.prefabHash, zx * 64 + (zufall() - 0.5) * 64, zy * 64 + (zufall() - 0.5) * 64);
        gesamt++;
      }
    }
  }
  const kreise: VegetationEntferntKreis[] = Array.from({ length: 100 }, () => ({ x: zufall() * 640 - 32, z: zufall() * 640 - 32, r: 8 }));
  const trocken = bereinigeVegetation(zdos, kreise, { trocken: true });
  const e = bereinigeVegetation(zdos, kreise);
  console.log(`  MESSUNG: ${gesamt} ZDOs in 100 Zonen, 100 Kreise (r 8): ${e.geloescht} gelöscht in ${e.zonen} Zonen, ${e.ms.toFixed(1)} ms (trocken ${trocken.ms.toFixed(1)} ms)`);
  check('Messlauf löscht genau die Treffer', e.geloescht === trocken.anzahl && e.geloescht > 0 && zdos.getAllZDOs().length === gesamt - e.geloescht, `${e.geloescht}`);
}

rmSync(WURZEL, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
