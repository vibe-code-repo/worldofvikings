/**
 * Entfernte Vegetation V1: der Nachfilter wirkt im Ablegen der Streuung — Server-Zone und Testflug-Vorschau.
 * Removed vegetation V1: the post-filter sits in the scatter's place callback — server zone and flight preview.
 *
 * Geprüft wird an einer kuratierten Layoutwelt (81 Zonen um den Nullpunkt):
 *  1. Kreis ohne `nur`: im Kreis steht nichts Gestreutes mehr; ALLES, was fehlt, lag im Kreis; alles andere ist
 *     BITGLEICH (Prefab, Position, Drehung) — der Zufallsstrom bleibt unberührt (kein clearArea).
 *  2. `nur: 'baeume'`: im Kreis fehlen genau die Bäume; Büsche, Kraut und Steine bleiben stehen.
 *  3. Eine Welt ohne Kreise (Feld fehlt, leere Liste) ist über alle 81 Zonen bitgleich zu vorher; ein Kreis weit weg
 *     ändert nur seine Umgebung.
 *  4. Vorschau (BewuchsVorschau) und Server liefern für dieselbe Zone dieselben Funde, mit und ohne Kreis; die Kreise
 *     kommen auch aus der Quelle (Entwurf), nicht nur aus dem Layout; eine Änderung der Quelle streut die Zone neu.
 *
 * Lauf: npx tsx server/test/vegetation-entfernt-zone.ts   (aus der Projektwurzel)
 */

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
} from '@wov/shared';
import { ZDOManager } from '../src/zdo/ZDOManager.js';
import { ZoneManager } from '../src/world/ZoneManager.js';
import { BewuchsVorschau } from '../../client/src/editor/BewuchsVorschau.js';

const SEED = getStableHash('KxSYuZquuw');
// Bewusst ASYMMETRISCH (x != z, beide Vorzeichen): ein im Filteraufruf vertauschtes x/z fiele sonst nicht auf.
const MITTE = { x: -150, z: 90 };
const ZONE = { zx: -2, zy: 1 }; // Zone des Kreismittelpunkts (Mitte zx*64, Kante 64)
const R = 40;

const art = new Map<number, 'baum' | 'sonstiges'>();
for (const f of FOLIAGE) art.set(f.prefabHash, streuArt(f.prefabName));

function layoutMit(extra: Record<string, unknown>) {
  const layout = sanitizeWorldLayout({
    version: 1,
    name: 'Vegetation-entfernt-Probe',
    detailSeed: 've',
    continents: [],
    regions: [
      {
        id: 'probe',
        biome: 'grassland',
        shape: { kind: 'circle', x: 0, z: 0, radius: 1600 },
        edgeFalloff: 200,
        baseLevel: 0.3,
        vegetation: [
          ...GRASLAND_FLORA_NAMEN,
          ...NADELWALD_FLORA_NAMEN.filter((n) => !GRASLAND_FLORA_NAMEN.includes(n)),
        ],
      },
    ],
    ...extra,
  });
  if (!layout) throw new Error('Testlayout wurde verworfen');
  return layout;
}

function baue(extra: Record<string, unknown>) {
  const layout = layoutMit(extra);
  const geo = new RegionGeo(SEED, { worldGenVersion: 2 }, layout);
  const heightmaps = new HeightmapProvider(geo, { blendSmoothStep: true, bilinearSampling: false });
  const zdos = new ZDOManager(1n);
  const zm = new ZoneManager(geo, heightmaps, zdos, SEED);
  return { zm, zdos, geo, heightmaps, layout };
}

interface Fund {
  hash: number;
  x: number;
  y: number;
  z: number;
  q: string;
}

function funde(zdos: ZDOManager): Fund[] {
  const out: Fund[] = [];
  for (let zy = -6; zy <= 6; zy++) {
    for (let zx = -6; zx <= 6; zx++) {
      for (const zdo of zdos.getZDOsInZone({ x: zx, y: zy })) {
        const r = zdo.rotation;
        out.push({
          hash: zdo.prefabHash,
          x: zdo.position.x,
          y: zdo.position.y,
          z: zdo.position.z,
          q: `${r.x},${r.y},${r.z},${r.w}`,
        });
      }
    }
  }
  return out;
}
const schluessel = (f: Fund): string => `${f.hash}|${f.x},${f.y},${f.z}|${f.q}`;
const sortiert = (l: Fund[]): string[] => l.map(schluessel).sort();
const gleich = (a: Fund[], b: Fund[]): boolean => {
  const x = sortiert(a);
  const y = sortiert(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const imKreis = (f: { x: number; z: number }, k: { x: number; z: number; r: number }): boolean =>
  (f.x - k.x) ** 2 + (f.z - k.z) ** 2 <= k.r * k.r;
/** Mengendifferenz `a \ b` über den vollen Schlüssel. */
const ohne = (a: Fund[], b: Fund[]): Fund[] => {
  const s = new Set(b.map(schluessel));
  return a.filter((f) => !s.has(schluessel(f)));
};

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS ${name}${detail ? ` (${detail})` : ''}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
    failures++;
  }
}

const SPIELER = [{ x: 0, y: 36.05, z: 0 }];
const kreisAlles: VegetationEntferntKreis = { x: MITTE.x, z: MITTE.z, r: R };
const kreisBaeume: VegetationEntferntKreis = { x: MITTE.x, z: MITTE.z, r: R, nur: 'baeume' };

console.log('=== vegetation-entfernt-zone ===');

const alt = baue({});
alt.zm.update(SPIELER, 60_000);
const altFunde = funde(alt.zdos);
const altIm = altFunde.filter((f) => imKreis(f, kreisAlles));
const altImBaeume = altIm.filter((f) => art.get(f.hash) === 'baum').length;
console.log(`  Bezug: ${altFunde.length} Funde in 81 Zonen, im Kreis ${altIm.length} (davon Bäume ${altImBaeume})`);
check('Bezug: im Kreis steht Gestreutes, Bäume und anderes', altImBaeume > 0 && altIm.length - altImBaeume > 0, `${altImBaeume} Bäume, ${altIm.length - altImBaeume} sonstige`);

// ── [1] Kreis für alles ───────────────────────────────────────────────
console.log('\n[1] Kreis ohne `nur`:');
const a = baue({ vegetationEntfernt: [kreisAlles] });
a.zm.update(SPIELER, 60_000);
const aFunde = funde(a.zdos);
check('im Kreis steht nichts mehr', aFunde.filter((f) => imKreis(f, kreisAlles)).length === 0);
const aFehlt = ohne(altFunde, aFunde);
check('alles, was fehlt, lag im Kreis', aFehlt.length > 0 && aFehlt.every((f) => imKreis(f, kreisAlles)), `${aFehlt.length} fehlen`);
check('Zahl: fehlend = alter Bestand im Kreis', aFehlt.length === altIm.length, `${aFehlt.length} vs ${altIm.length}`);
check('nichts Neues dazugekommen', ohne(aFunde, altFunde).length === 0);
check('alles außerhalb bitgleich (Prefab, Position, Drehung)', gleich(altFunde.filter((f) => !imKreis(f, kreisAlles)), aFunde));

// ── [2] nur Bäume ─────────────────────────────────────────────────────
console.log('\n[2] Kreis mit `nur: baeume`:');
const b = baue({ vegetationEntfernt: [kreisBaeume] });
b.zm.update(SPIELER, 60_000);
const bFunde = funde(b.zdos);
const bIm = bFunde.filter((f) => imKreis(f, kreisBaeume));
check('im Kreis steht kein Baum mehr', bIm.every((f) => art.get(f.hash) !== 'baum'));
check('Büsche, Kraut und Steine im Kreis bleiben alle stehen', bIm.length === altIm.length - altImBaeume, `${bIm.length} vs ${altIm.length - altImBaeume}`);
const bFehlt = ohne(altFunde, bFunde);
check('fehlend sind genau die Bäume im Kreis', bFehlt.length === altImBaeume && bFehlt.every((f) => imKreis(f, kreisBaeume) && art.get(f.hash) === 'baum'), `${bFehlt.length}`);
check('alles andere bitgleich', gleich(altFunde.filter((f) => !(imKreis(f, kreisBaeume) && art.get(f.hash) === 'baum')), bFunde));

// ── [3] Zonen ohne Kreise ─────────────────────────────────────────────
console.log('\n[3] Zonen ohne Kreise:');
const leer = baue({ vegetationEntfernt: [] });
leer.zm.update(SPIELER, 60_000);
check('leere Liste: alle 81 Zonen bitgleich zu "Feld fehlt"', gleich(funde(leer.zdos), altFunde), `${altFunde.length} ZDOs`);
const fern: VegetationEntferntKreis = { x: 900, z: 900, r: 6 };
const f = baue({ vegetationEntfernt: [fern] });
f.zm.update(SPIELER, 60_000);
check('Kreis weit weg: alles außer seiner Umgebung bitgleich', gleich(altFunde.filter((x) => !imKreis(x, { ...fern, r: fern.r + 20 })), funde(f.zdos).filter((x) => !imKreis(x, { ...fern, r: fern.r + 20 }))));
check('Kreis weit weg: die Zone um den Ursprung (Mitte der Welt) ist bitgleich', gleich(altFunde.filter((x) => Math.abs(x.x) < 300 && Math.abs(x.z) < 300), funde(f.zdos).filter((x) => Math.abs(x.x) < 300 && Math.abs(x.z) < 300)));
check('die Zonenzahl ändert sich nicht (81 Zonen erzeugt)', f.zm.update(SPIELER, 60_000) === 0);

// ── [4] Vorschau = Server ─────────────────────────────────────────────
console.log('\n[4] Vorschau und Server:');
function vorschau(w: ReturnType<typeof baue>, quelle: (() => readonly VegetationEntferntKreis[]) | null) {
  const live = new Map<string, { prefabHash: number; position: { x: number; y: number; z: number } }>();
  const ent = {
    applyUpdate(u: { key: string; prefabHash: number; position: { x: number; y: number; z: number } }) {
      live.set(u.key, u);
    },
    removeZDO(k: string) {
      live.delete(k);
    },
    flush() {},
  };
  const v = new BewuchsVorschau({ seed: SEED, geo: w.geo, heightmaps: w.heightmaps, regionGeo: w.geo }, ent as never, undefined, null, null, quelle);
  return { v, live, innen: v as unknown as { zoneStreuen(x: number, y: number): void } };
}
const punkte = (live: Map<string, { prefabHash: number; position: { x: number; y: number; z: number } }>): string[] =>
  [...live.values()].map((u) => `${u.prefabHash}|${u.position.x},${u.position.y},${u.position.z}`).sort();
const serverZone = (zdos: ZDOManager, zx: number, zy: number): string[] =>
  funde(zdos)
    .filter((x) => Math.abs(x.x - zx * 64) <= 32 && Math.abs(x.z - zy * 64) <= 32)
    .map((x) => `${x.hash}|${x.x},${x.y},${x.z}`)
    .sort();
const gleicheListe = (p: string[], s: string[]): boolean => p.length === s.length && p.every((e, i) => e === s[i]);
{
  // Kreis aus dem Layout
  const p = vorschau(b, null);
  let zonen = 0;
  let gleicheZonen = 0;
  let summe = 0;
  for (let zy = 0; zy <= 2; zy++) {
    for (let zx = -3; zx <= -1; zx++) {
      p.live.clear();
      p.innen.zoneStreuen(zx, zy);
      const vs = punkte(p.live);
      zonen++;
      summe += vs.length;
      if (gleicheListe(vs, serverZone(b.zdos, zx, zy))) gleicheZonen++;
    }
  }
  check('Kreis im Layout (nur Bäume): 9 Zonen Vorschau = Server', gleicheZonen === zonen, `${gleicheZonen}/${zonen} Zonen, ${summe} Funde`);

  // Kreis nur aus der Quelle (Entwurf), Layout ohne Kreis
  const q = vorschau(alt, () => [kreisAlles]);
  q.innen.zoneStreuen(ZONE.zx, ZONE.zy);
  const inQ = [...q.live.values()].filter((u) => imKreis(u.position, kreisAlles)).length;
  check('Kreis aus der Quelle (Entwurf) gilt, auch wenn das Layout keinen hat', q.live.size > 0 && inQ === 0, `${q.live.size} Funde, ${inQ} im Kreis`);
  const ohneQuelle = vorschau(alt, null);
  ohneQuelle.innen.zoneStreuen(ZONE.zx, ZONE.zy);
  check('Kontrolle: ohne Quelle und ohne Kreis steht dort Gestreutes', [...ohneQuelle.live.values()].filter((u) => imKreis(u.position, kreisAlles)).length > 0);
  check('Zone ohne Kreise: Vorschau-Schlüssel und Funde wie vor der Änderung (Zähler läuft durch)', gleicheListe(punkte(ohneQuelle.live), serverZone(alt.zdos, ZONE.zx, ZONE.zy)));

  // Schlüssel: Vorschau mit Kreis vs. ohne Kreis. Was bleibt, trägt denselben Schlüssel `bewuchs-<zone>-<i>` und denselben
  // Inhalt wie ohne Kreis (der Zähler läuft auch für entfernte Funde weiter); weg sind genau die Funde im Kreis.
  {
    const mitKreis = vorschau(alt, () => [kreisAlles]);
    const ohneKreis = vorschau(alt, null);
    mitKreis.innen.zoneStreuen(ZONE.zx, ZONE.zy);
    ohneKreis.innen.zoneStreuen(ZONE.zx, ZONE.zy);
    const inhalt = (u: { prefabHash: number; position: { x: number; y: number; z: number } }): string => `${u.prefabHash}|${u.position.x},${u.position.y},${u.position.z}`;
    const gleicheSchluessel = [...mitKreis.live].every(([k, u]) => ohneKreis.live.has(k) && inhalt(ohneKreis.live.get(k)!) === inhalt(u));
    const weg = [...ohneKreis.live].filter(([k]) => !mitKreis.live.has(k));
    check('Vorschau-Schlüssel: jeder verbliebene Fund trägt Schlüssel und Inhalt wie ohne Kreis', gleicheSchluessel && mitKreis.live.size > 0, `${mitKreis.live.size} von ${ohneKreis.live.size}`);
    check('Vorschau-Schlüssel: weg sind genau die Funde im Kreis', weg.length > 0 && weg.every(([, u]) => imKreis(u.position, kreisAlles)) && ohneKreis.live.size - mitKreis.live.size === weg.length, `${weg.length}`);
  }

  // Die Quelle ändert sich: Zone wird neu gestreut
  let kreise: VegetationEntferntKreis[] = [];
  const w = vorschau(alt, () => kreise);
  w.innen.zoneStreuen(ZONE.zx, ZONE.zy);
  const vorher = [...w.live.values()].filter((u) => imKreis(u.position, kreisAlles)).length;
  kreise = [kreisAlles];
  let t = 1000;
  for (let i = 0; i < 40; i++) {
    t += 300;
    w.v.schritt(MITTE.x, MITTE.z, t);
  }
  const nachher = [...w.live.values()].filter((u) => imKreis(u.position, kreisAlles)).length;
  check('Änderung der Quelle: die Zone wird neu gestreut, der Kreis ist leer', vorher > 0 && nachher === 0 && w.live.size > 0, `${vorher} → ${nachher}`);
  kreise = [];
  for (let i = 0; i < 40; i++) {
    t += 300;
    w.v.schritt(MITTE.x, MITTE.z, t);
  }
  const zurueck = [...w.live.values()].filter((u) => imKreis(u.position, kreisAlles)).length;
  check('Kreis wieder weg: der Bewuchs kehrt zurück (Zahl wie im Server-Bezug ohne Kreis)', zurueck === altIm.length, `${zurueck} vs ${altIm.length}`);
}

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}
console.log('\nAll vegetation-entfernt-zone checks passed.');
