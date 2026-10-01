/**
 * Bäume entfernen V2 am echten Spielserver (`createWovServer`): Boot und live.
 * Removed vegetation V2 against a real game server: boot and live.
 *
 *  1. Spielstand mit gespeicherten Zonen (Server A, ohne Kreise).
 *  2. Beschädigtes Feld beim Boot (Server C): der Boot läuft, nichts wird gelöscht, das Problem steht im Log.
 *  3. Gültiger Kreis beim Boot (Server B): die gespeicherten Streu-ZDOs im Kreis sind nach dem Boot weg, die Logzeile
 *     nennt die Zähler, alles außerhalb bleibt.
 *  4. Live (Server B läuft): ein zweiter Kreis wird in die Weltdatei geschrieben, binnen Sekunden sind die Objekte weg
 *     (ohne Neustart), das Entfernen steht in der Löschliste an die Clients, die Quittung zählt es.
 *  5. Neue Zone nach der Live-Änderung: der Nachfilter nutzt den neuen Kreis (Prüfer ausgetauscht).
 *  6. Obergrenze live: mehr als `VEGETATION_LIVE_MAX` Treffer ⇒ Vegetation nichts gelöscht, aber die Platzierung im selben
 *     Speichern kommt an (die Ablehnung blockiert den übrigen Abgleich nicht).
 *
 * Lauf: npx tsx server/test/vegetation-live.ts   (aus der Projektwurzel)
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FOLIAGE,
  GRASLAND_FLORA_NAMEN,
  NADELWALD_FLORA_NAMEN,
  getStableHash,
  streuArt,
  type VegetationEntferntKreis,
} from '@wov/shared';
import { layoutHash } from '@wov/shared/src/worldlayout/layoutDatei.js';
import { quittungLesen, quittungsDatei } from '@wov/shared/src/worldlayout/quittung.js';
import { createWovServer } from '../src/WovServer.js';
import { packeHerkunft } from '../src/world/zonenRuecksetzer.js';
import { VEGETATION_LIVE_MAX } from '../src/world/vegetationBereinigung.js';
import type { ZDO } from '../src/zdo/ZDO.js';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const WURZEL = mkdtempSync(join(tmpdir(), 'wov-vegetation-live-'));
const WELTEN = join(WURZEL, 'worlds');
mkdirSync(WELTEN, { recursive: true });
const LAYOUT = join(WURZEL, 'layout.json');
const INSTANZ = 'vegetationlive';
const QUITTUNG = quittungsDatei(WELTEN, INSTANZ);
const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function warteAuf(bed: () => boolean, ms = 12000): Promise<boolean> {
  const t0 = Date.now();
  while (!bed()) {
    if (Date.now() - t0 > ms) return false;
    await warte(20);
  }
  return true;
}

function dokument(kreise: unknown): Record<string, unknown> {
  return {
    version: 1,
    name: 'Vegetation-Live',
    detailSeed: INSTANZ,
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
    defaultSpawn: [0, 0],
    ...(kreise === undefined ? {} : { vegetationEntfernt: kreise }),
  };
}
function schreibe(d: unknown): string {
  const temp = `${LAYOUT}.probe.tmp`;
  const text = JSON.stringify(d);
  writeFileSync(temp, text);
  renameSync(temp, LAYOUT);
  return layoutHash(readFileSync(LAYOUT));
}

const K1: VegetationEntferntKreis = { x: -150, z: 90, r: 40 };
const K2: VegetationEntferntKreis = { x: 30, z: 20, r: 25 };
const K3: VegetationEntferntKreis = { x: 512, z: 0, r: 30 };
const imKreis = (z: { position: { x: number; z: number } }, k: VegetationEntferntKreis): boolean => (z.position.x - k.x) ** 2 + (z.position.z - k.z) ** 2 <= k.r * k.r;
const BAUM = FOLIAGE.find((f) => streuArt(f.prefabName) === 'baum')!;

const orig = { log: console.log, warn: console.warn, error: console.error };
let zeilen: string[] = [];
function stumm(): void {
  zeilen = [];
  console.log = (...a: unknown[]): void => void zeilen.push(a.join(' '));
  console.warn = (...a: unknown[]): void => void zeilen.push(a.join(' '));
  console.error = (...a: unknown[]): void => void zeilen.push(a.join(' '));
}
function laut(): void {
  Object.assign(console, orig);
}

function neuerServer() {
  return createWovServer({
    port: 0,
    everyoneAdmin: true,
    worldName: INSTANZ,
    worldSeed: INSTANZ,
    worldFeatures: false,
    worldVegetation: true,
    worldCreatures: false,
    worldsDir: WELTEN,
    kontenDir: join(WURZEL, 'konten'),
    worldMode: 'layout',
    worldLayoutPath: LAYOUT,
    saveIntervalMs: 3600_000,
  });
}
type Server = ReturnType<typeof neuerServer>;
const STREU = getStableHash('streu');
const streuZdos = (s: Server): ZDO[] => s.zdos.getAllZDOs().filter((z) => z.hasMember(STREU));

console.log('=== vegetation-live ===');
try {
  // ── 1. Spielstand: Server A erzeugt Zonen und speichert ───────────────
  console.log('\n[1] Spielstand erzeugen (ohne Kreise):');
  schreibe(dokument(undefined));
  stumm();
  const a = neuerServer();
  await a.start();
  for (let zy = -1; zy <= 2; zy++) for (let zx = -2; zx <= 2; zx++) a.zones.erzeugeZone({ x: zx, y: zy });
  const inK1 = streuZdos(a).filter((z) => imKreis(z, K1)).length;
  const inK2 = streuZdos(a).filter((z) => imKreis(z, K2)).length;
  const gesamtA = streuZdos(a).length;
  a.stop();
  await warte(300);
  laut();
  check('Bezug: gespeicherte Zonen haben Streu-ZDOs in K1 und K2', inK1 > 0 && inK2 > 0 && gesamtA > 0, `${inK1} in K1, ${inK2} in K2, ${gesamtA} gesamt`);

  // ── 2. Beschädigtes Feld beim Boot ────────────────────────────────────
  console.log('\n[2] Boot mit beschädigtem Feld:');
  schreibe(dokument([{ x: -150, z: 90, r: -5 }]));
  stumm();
  const c = neuerServer();
  await c.start();
  const nachC = streuZdos(c).length;
  const zeilenC = [...zeilen];
  c.stop();
  await warte(300);
  laut();
  check('Boot läuft, nichts gelöscht', nachC === gesamtA, `${nachC} vs ${gesamtA}`);
  check('Problem steht deutlich im Log', zeilenC.some((z) => /Vegetation \(Boot\).*beschädigt.*NICHTS gelöscht/.test(z)), zeilenC.filter((z) => /Vegetation/.test(z)).join(' | '));

  // ── 3. Boot mit gültigem Kreis ────────────────────────────────────────
  console.log('\n[3] Boot mit Kreis K1:');
  schreibe(dokument([K1]));
  stumm();
  const b = neuerServer();
  await b.start();
  const zeilenB = [...zeilen];
  laut();
  check('im Kreis K1 steht nach dem Boot nichts Gestreutes mehr', streuZdos(b).filter((z) => imKreis(z, K1)).length === 0);
  check('genau die K1-Objekte fehlen, alles andere steht', streuZdos(b).length === gesamtA - inK1, `${streuZdos(b).length} = ${gesamtA} - ${inK1}`);
  check('Logzeile mit Zählern', zeilenB.some((z) => new RegExp(`Vegetation \\(Boot\\): ${inK1} gelöscht`).test(z)), zeilenB.filter((z) => /Vegetation/.test(z)).join(' | '));

  // ── 4. Live ───────────────────────────────────────────────────────────
  console.log('\n[4] Live (Server läuft):');
  stumm();
  const gelistet = new Set<string>();
  const origListe = b.zdos.consumeDestroyList.bind(b.zdos);
  b.zdos.consumeDestroyList = () => {
    const l = origListe();
    for (const id of l) gelistet.add(id.toString());
    return l;
  };
  const ersteQuittung = await warteAuf(() => quittungLesen(QUITTUNG) !== null);
  const idsK2 = streuZdos(b).filter((z) => imKreis(z, K2)).map((z) => z.zdoid.toString());
  const vorLive = streuZdos(b).length;
  const hash4 = schreibe(dokument([K1, K2]));
  const ok4 = await warteAuf(() => quittungLesen(QUITTUNG)?.hash === hash4);
  const q4 = quittungLesen(QUITTUNG);
  await warte(1300); // ein Takt, damit die Löschliste den Weg zu den Clients genommen hat
  laut();
  check('Wache hat den Stand gesehen', ersteQuittung && ok4, `${q4?.ergebnis} ${q4?.grund} ${q4?.detail ?? ''}`);
  check('Quittung: angewendet, kein `geo`', q4?.ergebnis === 'angewendet' && q4.grund === null, `${q4?.ergebnis} ${q4?.grund}`);
  check('ohne Neustart: K2-Objekte weg', streuZdos(b).filter((z) => imKreis(z, K2)).length === 0 && idsK2.length > 0, `${idsK2.length} weg`);
  check('Zahl stimmt: genau die K2-Objekte fehlen', streuZdos(b).length === vorLive - idsK2.length, `${streuZdos(b).length} = ${vorLive} - ${idsK2.length}`);
  check('Löschliste an die Clients nennt alle', idsK2.every((id) => gelistet.has(id)), `${gelistet.size} gelistet`);
  check('Quittung zählt', q4?.zaehler?.vegetationGeloescht === idsK2.length, JSON.stringify(q4?.zaehler));

  // ── 5. Neue Zone nach der Live-Änderung ───────────────────────────────
  console.log('\n[5] Neue Zone nach der Live-Änderung:');
  stumm();
  const hash5 = schreibe(dokument([K1, K2, K3]));
  await warteAuf(() => quittungLesen(QUITTUNG)?.hash === hash5);
  const q5 = quittungLesen(QUITTUNG);
  const neueZone = { x: 8, y: 0 };
  const vorher5 = b.zones.isZoneGenerated(neueZone);
  b.zones.erzeugeZone(neueZone);
  laut();
  check('Quittung K3 angewendet', q5?.ergebnis === 'angewendet', `${q5?.ergebnis} ${q5?.grund}`);
  check('Zone war noch nicht erzeugt und hat jetzt Streu-ZDOs', !vorher5 && b.zones.isZoneGenerated(neueZone) && streuZdos(b).some((z) => Math.abs(z.position.x - 512) < 32 && Math.abs(z.position.z) < 32));
  check('in der neuen Zone: im Kreis K3 steht nichts (Nachfilter mit dem NEUEN Kreis)', streuZdos(b).filter((z) => imKreis(z, K3)).length === 0);

  // ── 6. Obergrenze live ────────────────────────────────────────────────
  console.log('\n[6] Obergrenze live:');
  const K4: VegetationEntferntKreis = { x: -700, z: -700, r: 50 };
  const herkunft = packeHerkunft({ x: -11, y: -11 });
  for (let i = 0; i < VEGETATION_LIVE_MAX + 1; i++) {
    const zdo = b.zdos.createZDO(BAUM.prefabHash, { x: K4.x + ((i % 200) - 100) * 0.1, y: 10, z: K4.z + (Math.floor(i / 200) - 50) * 0.1 });
    zdo.setInt('streu', herkunft);
  }
  const vorher6 = streuZdos(b).length;
  stumm();
  const mitPlatzierung = { ...dokument([K1, K2, K3, K4]), placements: [{ id: 'pl1', prefab: 'Beech1', x: 60, z: 20 }] };
  const hash6 = schreibe(mitPlatzierung);
  await warteAuf(() => quittungLesen(QUITTUNG)?.hash === hash6);
  const q6 = quittungLesen(QUITTUNG);
  laut();
  check(`Obergrenze: ${VEGETATION_LIVE_MAX + 1} Treffer ⇒ nichts gelöscht, Quittung nennt es`, q6?.ergebnis === 'angewendet' && /Vegetation nicht geräumt: 20001/.test(q6.detail ?? '') && streuZdos(b).length === vorher6, `${q6?.ergebnis} ${q6?.grund} ${q6?.detail}`);
  check('B6: die Platzierung im selben Speichern ist angekommen', b.zdos.getAllZDOs().some((z) => z.getString('layoutId') === 'pl1'));
  b.stop();
  await warte(300);
} finally {
  laut();
  if (existsSync(WURZEL)) rmSync(WURZEL, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} Prüfung(en) FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log('\nAlle Prüfungen bestanden.');
process.exit(0);
