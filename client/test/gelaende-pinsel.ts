/**
 * T2 — terrain brush of the test flight (`Reiter „Gelände“`): the pure core, the lock,
 * the wiring with the live ground, and the equality with a freshly compiled world.
 * Reiterkern, Sperre, Anbindung an das lebende Gelände, Gleichheit mit frisch kompilierter Welt.
 *
 *  1. Layer: `DeltaKarte` ↔ document form is canonical (`sanitizeHeightDeltas` leaves it unchanged),
 *     `punktVon` is the mapping `RegionGeo` uses.
 *  2. Stamps: raise / lower / smooth give the expected `heightDeltas`, with a falloff that ends at the rim.
 *  3. Lock (E2): plinth and building circles; a stamp under one changes nothing.
 *  4. Limits: a value over ±100 m, too many points, too many zones — the WHOLE stroke is refused and put back.
 *  5. One stroke = ONE Vorgang however many frames; `invertiere` restores the old layer.
 *  6. Wiring (`GelaendeSteuerung`) on a real `RegionGeo`: 30 frames → one draft write, one protocol entry;
 *     a refused stroke leaves draft and ground untouched; a changed draft takes the stroke back.
 *  7. Equality: the flight's ground after strokes (raise, smooth) is bit-equal to a geo compiled from
 *     layout + the same layer (the server's way), across a zone seam too; `createWorld` (the flight's own
 *     way) agrees.
 *  8. Keys and pace: `[` `]` (AltGr on a German keyboard), `-` `+`, the stamp pace.
 *  9. Texts: every `testflug.gelaende.*` key exists in de and en with the same placeholders.
 * 11. Lock: modular building parts (PIECE flag, store `sm-bld-`) lock, natural objects do not (T2 N1, B3).
 * 12. Effective radius: the preview circle and the lock use what a stamp really reaches (B5).
 * 13. The flight follows the draft when another tab changes it, without tearing an open stroke (B1).
 * 14. `enthaelt` sees `heightDeltas`; the sequence stroke → Ctrl+Z → new change keeps the stroke in the ring (B2).
 * 15. Smoothing across zone seams and the value limit of `wendeVorgang` (B7).
 *
 * Run: npx tsx test/gelaende-pinsel.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo, findPrefabByName, FOLIAGE, getStableHash, HeightmapProvider, istFesterKoerperImSpiel, PrefabFlag, RegionGeo, sanitizeHeightDeltas } from '@wov/shared';
import type { WorldLayout } from '@wov/shared';
import { createWorld } from '../src/world/World';
import { EntwurfsSpeicher } from '../src/editor/entwurfsSpeicher';
import { enthaelt } from '../src/editor/weltdokument';
import {
  DeltaKarte,
  Strich,
  StempelTakt,
  berechneStempel,
  falloff,
  invertiere,
  karteAusEntwurf,
  punktVon,
  radiusSchritt,
  wendeVorgang,
  wirkRadius,
  STEMPEL_HALTE_MS,
  STEMPEL_MIN_MS,
  type StempelEingabe,
} from '../src/editor/testflug/gelaendePinsel';
import { gebaeudeRadius, gesperrtDurch, istBauteil, sperrKreise, type SperrKatalog } from '../src/editor/testflug/gelaendeSperre';
import { GelaendeAktionen } from '../src/editor/testflug/GelaendeAktionen';
import { GelaendeSteuerung, type GelaendeAbh, type Kasten } from '../src/editor/testflug/GelaendeSteuerung';
import { rohHoehenQuelle } from '../src/editor/testflug/gelaendeRoh';
import { entferneKorrekturSicht, installiereKorrekturSicht } from '../src/editor/testflug/gelaendeGeo';

let fehler = 0;
let geprueft = 0;
const pruefe = (bedingung: boolean, text: string): void => {
  geprueft++;
  if (!bedingung) {
    fehler++;
    console.error(`  FAIL: ${text}`);
  }
};

const HIER = dirname(fileURLToPath(import.meta.url));
/** Lock circles add this rim to half the box diagonal (`SPERR_RAND_M`); a part's radius must exceed it. */
const SPERR_RAND_TEST = 0.5;
const flach = (): number => 0;
const deltaAn = (k: DeltaKarte, x: number, z: number): number => {
  const p = punktVon(x, z);
  return k.delta(p.zx, p.zz, p.index);
};
const eingabe = (x: number, z: number, o: Partial<StempelEingabe> = {}): StempelEingabe => ({
  x,
  z,
  radius: 6,
  staerke: 20,
  werkzeug: 'anheben',
  hoehe: flach,
  ...o,
});

// ── 1. Layer ──────────────────────────────────────────────────────────────────
{
  const k = new DeltaKarte();
  for (const [zx, zz, i, cm] of [[0, 0, 5, 12], [0, 0, 70, -3], [-1, 2, 4095, 100], [3, -4, 0, 1], [0, 0, 6, 7]] as const) k.setze(zx, zz, i, cm);
  const zonen = k.alsZonen();
  pruefe(JSON.stringify(sanitizeHeightDeltas(zonen)) === JSON.stringify(zonen), '1: alsZonen ist kanonisch (der Sanitizer ändert nichts)');
  pruefe(JSON.stringify(DeltaKarte.ausZonen(zonen).alsZonen()) === JSON.stringify(zonen), '1: ausZonen(alsZonen) ist verlustfrei');
  pruefe(k.punktzahl === 5 && k.zonenzahl === 3, `1: Punkt-/Zonenzahl (${k.punktzahl}/${k.zonenzahl})`);
  k.setze(0, 0, 5, 0);
  pruefe(k.punktzahl === 4 && k.delta(0, 0, 5) === 0, '1: Delta 0 entfernt den Punkt');
  pruefe(k.deltaM(0, 0, 70) === Math.fround(-3 * 0.01), '1: deltaM = cm × 0,01 als f32 (wie HoehenKorrekturField)');
  const a = punktVon(-32, -32);
  pruefe(a.zx === 0 && a.zz === 0 && a.index === 0, '1: (−32,−32) ist Zone 0/0, Index 0');
  const b = punktVon(32, 32);
  pruefe(b.zx === 1 && b.zz === 1 && b.index === 0, '1: (32,32) gehört zur NÄCHSTEN Zone (Nahtvertex)');
  const c = punktVon(-33, 31);
  pruefe(c.zx === -1 && c.zz === 0 && c.index === 4095, '1: (−33,31) ist Zone −1/0, Index 4095');
  pruefe(karteAusEntwurf(undefined)?.punktzahl === 0, '1: fehlendes Entwurfsfeld = leere Ebene');
  pruefe(karteAusEntwurf('kaputt') === null, '1: Entwurfsfeld „kaputt“ sperrt den Pinsel');
  pruefe(karteAusEntwurf([{ zx: 0, zz: 0, r: ['0|1,1|5,6'] }]) === null, '1: doppelte Spalte im Entwurf sperrt den Pinsel');
  pruefe(karteAusEntwurf(zonen)?.punktzahl === 5, '1: gültiges Entwurfsfeld wird gelesen');
}

// ── 2. Stempel ────────────────────────────────────────────────────────────────
{
  const leer = new DeltaKarte();
  const hoch = berechneStempel(leer, eingabe(0, 0));
  const mitte = hoch.find((a) => a.zx === 0 && a.zz === 0 && a.index === 32 * 64 + 32);
  pruefe(mitte?.neu === 20 && mitte.alt === 0, `2: Mitte +20 cm (${mitte?.neu})`);
  const d3 = hoch.find((a) => a.index === 32 * 64 + 35);
  pruefe(d3?.neu === Math.round(20 * (1 - 0.25) ** 2), `2: Abstand 3 m bei r=6 → ${Math.round(20 * 0.5625)} cm (${d3?.neu})`);
  pruefe(hoch.every((a) => a.neu > 0), '2: Anheben ändert nur nach oben');
  pruefe(!hoch.some((a) => a.index === 32 * 64 + 38), '2: am Rand (d = r) keine Änderung');
  // Falloff monotone and zero at the rim
  let fallend = true;
  for (let d = 0; d < 6; d += 0.25) if (falloff(d + 0.25, 6) > falloff(d, 6)) fallend = false;
  pruefe(fallend && falloff(6, 6) === 0 && falloff(0, 6) === 1, '2: Randabfall monoton, 1 in der Mitte, 0 am Rand');
  const runter = berechneStempel(leer, eingabe(0, 0, { werkzeug: 'absenken' }));
  pruefe(runter.length === hoch.length && runter.every((a, i) => a.neu === -hoch[i]!.neu), '2: Absenken ist genau das Spiegelbild von Anheben');
  const stark = berechneStempel(leer, eingabe(0, 0, { staerke: 40 }));
  pruefe(stark.find((a) => a.index === 32 * 64 + 32)?.neu === 40, '2: doppelte Stärke, doppelter Zuwachs');
  // Smoothing: a 2 m spike on flat ground; the height function includes the layer (as the live ground does)
  const karte = new DeltaKarte();
  const spitze = (x: number, z: number): number => (x === 0 && z === 0 ? 2 : 0) + deltaAn(karte, x, z) / 100;
  const vorher = spitze(0, 0);
  const glatt = berechneStempel(karte, eingabe(0, 0, { werkzeug: 'glaetten', staerke: 25, hoehe: spitze }));
  const mitteG = glatt.find((a) => a.index === 32 * 64 + 32);
  pruefe(mitteG !== undefined && mitteG.neu < 0, `2: Glätten senkt die Spitze (${mitteG?.neu} cm)`);
  pruefe(mitteG !== undefined && Math.abs(mitteG.neu) <= Math.round((vorher - vorher / 9) * 100), '2: Glätten geht nie über den 3×3-Mittelwert hinaus');
  const nachbar = glatt.find((a) => a.index === 32 * 64 + 33);
  pruefe(nachbar !== undefined && nachbar.neu > 0, `2: Glätten hebt die Nachbarn der Spitze (${nachbar?.neu} cm)`);
  const flachGlatt = berechneStempel(new DeltaKarte(), eingabe(0, 0, { werkzeug: 'glaetten', hoehe: () => 5 }));
  pruefe(flachGlatt.length === 0, '2: Glätten auf ebenem Grund ändert nichts');
  // repeated smoothing converges: spike height falls monotonically
  const k2 = new DeltaKarte();
  const h2 = (x: number, z: number): number => (x === 0 && z === 0 ? 2 : 0) + deltaAn(k2, x, z) / 100;
  let hoehen = [h2(0, 0)];
  for (let i = 0; i < 6; i++) {
    for (const a of berechneStempel(k2, eingabe(0, 0, { werkzeug: 'glaetten', staerke: 25, hoehe: h2 }))) k2.setze(a.zx, a.zz, a.index, a.neu);
    hoehen.push(h2(0, 0));
  }
  pruefe(hoehen.every((h, i) => i === 0 || h < hoehen[i - 1]!) && hoehen[6]! < 0.5, `2: sechsmal Glätten: Spitze ${hoehen.map((h) => h.toFixed(2)).join(' → ')}`);
}

// ── 3. Sperre ─────────────────────────────────────────────────────────────────
const katalog: SperrKatalog = {
  def: (n) => (n === 'Baum' ? ({ name: n, flags: PrefabFlag.TREE_BASE, renderScale: { w: 8, h: 8 } } as never) : { name: n, flags: 0n, renderScale: { w: 2, h: 2 } } as never),
  fest: (n) => n !== 'Gras',
  vegetation: (n) => n === 'Busch',
  upload: (n) =>
    ({
      U_Wohnhaus: { breite: 8.9, tiefe: 6.29 },
      U_Fass: { breite: 0.7, tiefe: 0.7 },
      U_Karren: { breite: 2.72, tiefe: 1.6 },
      U_Palisade: { breite: 4, tiefe: 0.6 },
      U_Skaliert: { breite: 2, tiefe: 2, grundskala: 2 },
    })[n as 'U_Wohnhaus'],
};
{
  const haus = gebaeudeRadius({ prefab: 'U_Wohnhaus', x: 0, z: 0 }, katalog);
  pruefe(haus !== null && Math.abs(haus - (Math.hypot(8.9, 6.29) / 2 + 0.5)) < 1e-9, `3: Wohnhaus ist ein Gebäude, Radius halbe Diagonale + 0,5 (${haus})`);
  pruefe(gebaeudeRadius({ prefab: 'U_Fass', x: 0, z: 0 }, katalog) === null, '3: Fass (0,7 m) ist lose');
  pruefe(gebaeudeRadius({ prefab: 'U_Karren', x: 0, z: 0 }, katalog) === null, '3: Karren (2,7 m) ist lose');
  pruefe(gebaeudeRadius({ prefab: 'U_Palisade', x: 0, z: 0 }, katalog) !== null, '3: Palisadenstück (4 m) ist ein Gebäude');
  pruefe(gebaeudeRadius({ prefab: 'U_Karren', x: 0, z: 0, scale: 2 }, katalog) !== null, '3: Skalierung zählt (Karren ×2 = 5,4 m)');
  pruefe(gebaeudeRadius({ prefab: 'U_Skaliert', x: 0, z: 0 }, katalog) !== null, '3: Grundskala des Uploads zählt (2 m × 2 = 4 m)');
  pruefe(gebaeudeRadius({ prefab: 'Baum', x: 0, z: 0 }, katalog) === null, '3: Baum (Flag TREE_BASE) ist lose, auch wenn fest und breit');
  pruefe(gebaeudeRadius({ prefab: 'Busch', x: 0, z: 0 }, katalog) === null, '3: Vegetation ist lose');
  pruefe(gebaeudeRadius({ prefab: 'Gras', x: 0, z: 0 }, katalog) === null, '3: durchlässiges Prefab ist kein Gebäude');
  const kreise = sperrKreise(
    [
      { prefab: 'Baum', x: 0, z: 0, einebnen: 10 },
      { prefab: 'U_Wohnhaus', x: 100, z: 0 },
      { prefab: 'U_Fass', x: 200, z: 0 },
    ],
    katalog
  );
  pruefe(kreise.length === 2 && kreise[0]!.art === 'sockel' && kreise[0]!.r === 10 && kreise[1]!.art === 'gebaeude', '3: ein Sockelkreis, ein Gebäudekreis, das Fass zählt nicht');
  pruefe(gesperrtDurch(kreise, 15, 0, 6)?.art === 'sockel', '3: Pinselkreis berührt den Sockel (15 < 10 + 6)');
  pruefe(gesperrtDurch(kreise, 17, 0, 6) === null, '3: Pinsel daneben ist frei');
  pruefe(gesperrtDurch(kreise, 100, 6, 1)?.art === 'gebaeude', '3: Pinsel am Gebäude ist gesperrt');
  // A stamp under a lock changes nothing
  const karte = new DeltaKarte();
  const strich = new Strich(karte, 'v1');
  const r = strich.stempel(eingabe(5, 0), gesperrtDurch(kreise, 5, 0, 6) !== null);
  pruefe(r.art === 'gesperrt' && karte.punktzahl === 0 && strich.ende() === null, '3: Stempel unter dem Sockel ändert nichts (kein Punkt, kein Vorgang)');
  const strich2 = new Strich(karte, 'v2');
  const frei = strich2.stempel(eingabe(60, 0), gesperrtDurch(kreise, 60, 0, 6) !== null);
  pruefe(frei.art === 'ok' && karte.punktzahl > 0, `3: ein Stempel außerhalb der Sperre wirkt (${frei.art}, ${karte.punktzahl} Punkte)`);
}

// ── 4. Grenzen ────────────────────────────────────────────────────────────────
{
  // A value: 200 stamps of 50 cm reach exactly 10 000 cm; the 201st breaks it.
  const karte = new DeltaKarte();
  const strich = new Strich(karte, 'wert');
  let letzte: ReturnType<Strich['stempel']> = { art: 'abgelehnt' };
  let n = 0;
  while (n < 400) {
    letzte = strich.stempel(eingabe(0, 0, { radius: 1, staerke: 50 }), false);
    n++;
    if (letzte.art !== 'ok') break;
  }
  pruefe(n === 201 && letzte.art === 'grenze' && letzte.grund === 'wert', `4: der 201. Stempel reißt ±10 000 cm (Stempel ${n}, ${letzte.art})`);
  pruefe(karte.punktzahl === 0 && strich.ende() === null, '4: der ganze Strich ist zurückgenommen, nichts bleibt in der Ebene');
  pruefe(letzte.art === 'grenze' && letzte.zurueckgenommen.length === 1 && letzte.zurueckgenommen[0]!.neu === 0, '4: die Rücknahme wird für den Neuaufbau gemeldet');
  pruefe(strich.stempel(eingabe(50, 50), false).art === 'abgelehnt', '4: danach ist der Strich tot (weitere Stempel abgelehnt)');
  // exactly at the limit is fine
  const k2 = new DeltaKarte();
  const s2 = new Strich(k2, 'genau');
  let ok = true;
  for (let i = 0; i < 200; i++) ok = ok && s2.stempel(eingabe(0, 0, { radius: 1, staerke: 50 }), false).art === 'ok';
  pruefe(ok && k2.delta(0, 0, 32 * 64 + 32) === 10_000, '4: genau 10 000 cm sind erlaubt');
  // points: radius 20 stamps 41 m apart, ≈1257 points each, 100 000 points break at the 80th
  const k3 = new DeltaKarte();
  const s3 = new Strich(k3, 'punkte');
  let art = 'ok';
  let m = 0;
  for (; m < 200 && art === 'ok'; m++) {
    const rr = s3.stempel(eingabe(m * 41, 0, { radius: 20, staerke: 10 }), false);
    art = rr.art === 'grenze' ? `grenze:${rr.grund}` : rr.art;
  }
  pruefe(art === 'grenze:punkte' && k3.punktzahl === 0, `4: über 100 000 Punkte wird der Strich abgelehnt und zurückgenommen (${art} nach ${m} Stempeln, ${k3.punktzahl} Punkte übrig)`);
  // zones: radius 1 stamps one vertex; a grid 64 m apart touches one zone each
  const k4 = new DeltaKarte();
  const s4 = new Strich(k4, 'zonen');
  let art4 = 'ok';
  let z = 0;
  for (; z < 5000 && art4 === 'ok'; z++) {
    const rr = s4.stempel(eingabe((z % 60) * 64, Math.floor(z / 60) * 64, { radius: 1, staerke: 5 }), false);
    art4 = rr.art === 'grenze' ? `grenze:${rr.grund}` : rr.art;
  }
  pruefe(art4 === 'grenze:zonen' && z === 4097 && k4.zonenzahl === 0, `4: über 4096 Zonen wird der Strich abgelehnt (${art4} nach ${z} Stempeln)`);
}

// ── 5. Ein Strich = ein Vorgang, Umkehr ───────────────────────────────────────
{
  const karte = new DeltaKarte();
  karte.setze(0, 0, 32 * 64 + 32, 7); // something that was there before
  const vorher = JSON.stringify(karte.alsZonen());
  const strich = new Strich(karte, 'strich-1');
  for (let i = 0; i < 40; i++) strich.stempel(eingabe(i * 0.5, 0), false);
  const v = strich.ende();
  pruefe(v !== null && v.vorgangId === 'strich-1', '5: 40 Stempel geben genau EINEN Vorgang');
  pruefe(v !== null && new Set(v.aenderungen.map((a) => `${a.zx},${a.zz},${a.index}`)).size === v.aenderungen.length, '5: jeder Punkt steht im Vorgang nur einmal');
  pruefe(v !== null && v.aenderungen.every((a) => a.alt !== a.neu), '5: der Vorgang enthält nur echte Änderungen');
  pruefe(v !== null && v.aenderungen.find((a) => a.index === 32 * 64 + 32)?.alt === 7, '5: alt ist der Wert VOR dem Strich, nicht vor dem letzten Stempel');
  const nachher = JSON.stringify(karte.alsZonen());
  pruefe(nachher !== vorher, '5: der Strich hat die Ebene geändert');
  const umkehr = invertiere(v!);
  pruefe(umkehr.vorgangId === '~strich-1' && invertiere(umkehr).vorgangId === 'strich-1', '5: Umkehr trägt ~, zweimal umkehren gibt die Kennung zurück');
  pruefe(wendeVorgang(karte, umkehr).ok && JSON.stringify(karte.alsZonen()) === vorher, '5: invertiere stellt den alten Stand wieder her (Byte für Byte)');
  pruefe(wendeVorgang(karte, umkehr).ok === false, '5: dieselbe Umkehr ein zweites Mal ist ein Konflikt (alt passt nicht mehr)');
  pruefe(wendeVorgang(karte, v!).ok && JSON.stringify(karte.alsZonen()) === nachher, '5: der Vorgang lässt sich wieder anwenden');
  const leer = new Strich(new DeltaKarte(), 'nichts');
  pruefe(leer.ende() === null, '5: ein Strich ohne Wirkung gibt keinen Vorgang');
  const zuruck = new Strich(karte, 'verwerfen');
  zuruck.stempel(eingabe(20, 20), false);
  const bewegt = zuruck.verwerfen();
  pruefe(bewegt.length > 0 && JSON.stringify(karte.alsZonen()) === nachher, '5: verwerfen() nimmt einen offenen Strich vollständig zurück');
}

// ── 6./7. Anbindung an eine echte Geo ─────────────────────────────────────────
const LAYOUT = {
  version: 1,
  name: 'gelaende-pinsel-test',
  detailSeed: 'gelaende-pinsel-test',
  continents: [],
  regions: [{ id: 'land', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 2000 }, edgeFalloff: 300 }],
} as unknown as WorldLayout;

interface Entwurf {
  laden(): Record<string, unknown> | null;
  aendern(d: Record<string, unknown>): void;
  schreibungen(): number;
  doc(): Record<string, unknown>;
  setze(d: Record<string, unknown>): void;
}
function entwurf(anfang: Record<string, unknown>): Entwurf {
  let text = JSON.stringify(anfang);
  let n = 0;
  return {
    laden: () => JSON.parse(text) as Record<string, unknown>,
    aendern: (d) => {
      n++;
      text = JSON.stringify(d);
    },
    schreibungen: () => n,
    doc: () => JSON.parse(text) as Record<string, unknown>,
    setze: (d) => {
      text = JSON.stringify(d);
    },
  };
}

interface Aufbau {
  steuerung: GelaendeSteuerung;
  aktionen: GelaendeAktionen;
  entwurf: Entwurf;
  meldungen: string[];
  neuBauen: Kasten[];
  nachStrich: () => number;
  welt: ReturnType<typeof createWorld>;
  setzeZeit(ms: number): number;
  kreise: Array<{ r: number; gesperrt: boolean }>;
  ein: { werkzeug: 'anheben' | 'absenken' | 'glaetten'; radius: number; staerke: number; ziel: number | null };
}
function aufbau(doc: Record<string, unknown>): Aufbau {
  const welt = createWorld('gelaende-pinsel-test', {}, doc);
  const e = entwurf(doc);
  const aktionen = new GelaendeAktionen(e);
  const meldungen: string[] = [];
  const neuBauen: Kasten[] = [];
  let nach = 0;
  const kreise: Array<{ r: number; gesperrt: boolean }> = [];
  let zeit = 1000;
  let vorgaenge = 0;
  const ein: Aufbau['ein'] = { werkzeug: 'anheben', radius: 6, staerke: 20, ziel: null };
  const rohQ = rohHoehenQuelle(welt.geo)!;
  const abh: GelaendeAbh = {
    hoehe: (x, z) => welt.getGroundHeight(x, z),
    geo: () => welt.geo,
    neuBauen: (k) => {
      neuBauen.push(k);
      welt.heightmaps.invalidateArea((k.minX + k.maxX) / 2, (k.minZ + k.maxZ) / 2, Math.hypot(k.maxX - k.minX, k.maxZ - k.minZ) / 2 + 1);
    },
    platzierungen: () => (e.laden()?.placements as never) ?? undefined,
    katalog,
    aktionen,
    einstellung: () => ein,
    setzeZiel: (h) => void (ein.ziel = h),
    rohHoehe: (x, z) => rohQ(x, z),
    pipetteAnzeige: () => undefined,
    meldung: (t) => meldungen.push(t),
    kreis: { zeige: (_x, _z, r, gesperrt) => void kreise.push({ r, gesperrt }), verberge: () => undefined },
    nachStrich: () => {
      nach++;
    },
    jetztMs: () => zeit,
    vorgangId: () => `strich-${++vorgaenge}`,
  };
  return { steuerung: new GelaendeSteuerung(abh), aktionen, entwurf: e, meldungen, neuBauen, nachStrich: () => nach, welt, setzeZeit: (ms) => (zeit += ms), kreise, ein };
}
const zieheStrich = (a: Aufbau, von: [number, number], bis: [number, number], bilder: number, shift = false): void => {
  a.steuerung.druecken({ x: von[0], z: von[1] }, shift);
  for (let i = 1; i <= bilder; i++) {
    a.setzeZeit(16);
    const p = { x: von[0] + ((bis[0] - von[0]) * i) / bilder, z: von[1] + ((bis[1] - von[1]) * i) / bilder };
    a.steuerung.bewegen(p, shift);
    a.steuerung.tick(p, shift);
  }
  a.steuerung.loslassen();
};

{
  const a = aufbau({ ...LAYOUT, placements: [{ id: 'sockel-1', prefab: 'BirkeHoch1', x: 60, z: 0, einebnen: 10 }] });
  const basis = a.welt.getGroundHeight(0, 0);
  zieheStrich(a, [0, 0], [15, 0], 30);
  pruefe(a.steuerung.bereit(), '6: Pinsel bereit auf einer RegionGeo');
  pruefe(a.aktionen.protokoll().length === 1, `6: 30 Bilder Ziehen = EIN Vorgang im Protokoll (${a.aktionen.protokoll().length})`);
  pruefe(a.entwurf.schreibungen() === 1, `6: … und EIN Schreiben in den Entwurf (${a.entwurf.schreibungen()})`);
  pruefe(a.neuBauen.length > 2, `6: das Gelände wurde während des Ziehens neu gebaut (${a.neuBauen.length}×)`);
  pruefe(a.nachStrich() === 1, '6: nach dem Strich werden lose Objekte einmal neu aufgesetzt');
  const zonen = a.entwurf.doc().heightDeltas as never;
  pruefe(Array.isArray(zonen) && JSON.stringify(sanitizeHeightDeltas(zonen)) === JSON.stringify(zonen), '6: der Entwurf trägt eine gültige, kanonische heightDeltas');
  pruefe(a.welt.getGroundHeight(0, 0) > basis + 0.3, `6: das lebende Gelände ist höher (${basis.toFixed(2)} → ${a.welt.getGroundHeight(0, 0).toFixed(2)} m)`);
  pruefe(a.meldungen.some((m) => m.includes('Strich im Entwurf gespeichert') || m.includes('Stroke saved')), '6: HUD meldet den gespeicherten Strich');

  // Shift lowers
  const vorSenken = a.welt.getGroundHeight(0, 40);
  zieheStrich(a, [0, 40], [8, 40], 12, true);
  pruefe(a.welt.getGroundHeight(0, 40) < vorSenken - 0.05, '6: Shift kehrt Anheben zu Absenken um');
  pruefe(a.aktionen.protokoll().length === 2, '6: der zweite Strich ist der zweite Vorgang');

  // Lock: a stroke into the plinth circle (60, 0, r 10) does nothing there
  const vorSperre = JSON.stringify(a.entwurf.doc().heightDeltas);
  const sockelVorher = a.welt.getGroundHeight(58, 0);
  zieheStrich(a, [55, 0], [65, 0], 10);
  pruefe(a.welt.getGroundHeight(58, 0) === sockelVorher, '6: unter dem Sockel bleibt das Gelände, wie es war');
  pruefe(JSON.stringify(a.entwurf.doc().heightDeltas) === vorSperre && a.aktionen.protokoll().length === 2, '6: der gesperrte Strich schreibt nichts in den Entwurf (kein Vorgang)');
  pruefe(a.meldungen.some((m) => m.includes('Gesperrt') || m.includes('Locked')), '6: HUD nennt die Sperre');

  // Limit: a refused stroke leaves draft and ground untouched
  a.ein.staerke = 50;
  const vorGrenze = JSON.stringify(a.entwurf.doc().heightDeltas);
  const hoeheVorGrenze = a.welt.getGroundHeight(-40, 40);
  a.steuerung.druecken({ x: -40, z: 40 }, false);
  for (let i = 0; i < 260; i++) {
    a.setzeZeit(STEMPEL_HALTE_MS + 1);
    a.steuerung.tick({ x: -40, z: 40 }, false);
  }
  a.steuerung.loslassen();
  pruefe(JSON.stringify(a.entwurf.doc().heightDeltas) === vorGrenze, '6: ein Strich über der Grenze ändert den Entwurf nicht');
  pruefe(a.welt.getGroundHeight(-40, 40) === hoeheVorGrenze, '6: … und das lebende Gelände ist wieder wie vorher');
  pruefe(a.aktionen.protokoll().length === 2, '6: … und es gibt keinen Vorgang dazu');
  pruefe(a.meldungen.some((m) => m.includes('100 m') && (m.includes('zurückgenommen') || m.includes('taken back'))), '6: HUD meldet die Ablehnung mit Grund');
  a.ein.staerke = 20;

  // The draft changed under the stroke (another tab): the stroke is taken back from the ground too
  const b = aufbau(LAYOUT as unknown as Record<string, unknown>);
  b.steuerung.druecken({ x: 0, z: 0 }, false);
  b.setzeZeit(200);
  b.steuerung.tick({ x: 0, z: 0 }, false);
  b.entwurf.setze({ ...LAYOUT, heightDeltas: [{ zx: 0, zz: 0, r: [`32|32|999`] }] });
  b.steuerung.loslassen();
  pruefe(b.aktionen.protokoll().length === 0 && b.entwurf.schreibungen() === 0, '6: Konflikt: kein Vorgang, kein Schreiben');
  // The stroke is out of the live ground and the ground shows what the draft says (the foreign 999 cm), bit for bit.
  const frischK = createWorld('gelaende-pinsel-test', {}, b.entwurf.doc());
  let ungleichK = 0;
  for (let z = -8; z <= 8; z++) for (let x = -8; x <= 8; x++) if (b.welt.getGroundHeight(x, z) !== frischK.getGroundHeight(x, z)) ungleichK++;
  pruefe(ungleichK === 0, `6: Konflikt: der Strich ist aus dem lebenden Gelände raus, das Gelände zeigt den Entwurf (${ungleichK} Abweichungen)`);
  pruefe(b.meldungen.some((m) => m.includes('geändert') || m.includes('changed')), '6: Konflikt: HUD sagt es');
  const konfliktMeldung = b.meldungen.find((m) => m.includes('unter dem Strich') || m.includes('under the stroke')) ?? '';
  pruefe(/Strich abgelehnt und zurückgenommen/.test(konfliktMeldung) && (konfliktMeldung.match(/zurückgenommen/g) ?? []).length === 1, `6: Konflikt: die Meldung sagt „zurückgenommen“ genau einmal („${konfliktMeldung}“)`);

  // A draft with an unusable field locks the brush
  const c = aufbau(LAYOUT as unknown as Record<string, unknown>);
  c.entwurf.setze({ ...LAYOUT, heightDeltas: 'kaputt' });
  pruefe(c.steuerung.bereit() === false && c.meldungen.length === 1, '6: unbrauchbares Entwurfsfeld sperrt den Pinsel und sagt es');
  const d = new GelaendeAktionen(entwurf({ ...LAYOUT, heightDeltas: 'kaputt' }));
  pruefe(d.ladeKarte().ok === false, '6: GelaendeAktionen.ladeKarte lehnt es ab');
  const leerV = { vorgangId: 'x', aenderungen: [{ zx: 0, zz: 0, index: 1, alt: 0, neu: 5 }] };
  pruefe(d.strichAbschliessen(leerV).ok === false, '6: … und schreibt nichts darüber');
  // no draft at all
  const e2 = new GelaendeAktionen({ laden: () => null, aendern: () => undefined });
  pruefe(e2.strichAbschliessen(leerV).ok === false, '6: ohne Entwurf gibt es kein Schreiben');
}

// ── 7. Gleichheit Testflug ↔ frisch kompilierte Welt ─────────────────────────
{
  const punkte: Array<[number, number]> = [];
  for (let z = -14; z <= 14; z += 2) for (let x = -14; x <= 14; x += 2) punkte.push([x, z]);
  for (const mitte of [[0, 0], [32, 32], [-32, 31], [96, -33]] as const) {
    const seed = getStableHash(LAYOUT.detailSeed);
    const geoA = createGeo({ mode: 'layout', worldSeed: seed, layout: LAYOUT }) as RegionGeo;
    const hmA = new HeightmapProvider(geoA, { blendSmoothStep: true });
    // read once so the zones are cached BEFORE the strokes (the flight has them built too)
    for (const [x, z] of punkte) hmA.getGroundHeight(mitte[0] + x, mitte[1] + z);
    const karte = new DeltaKarte();
    const eingebaut = installiereKorrekturSicht(geoA, karte);
    pruefe(eingebaut, '7: die lebende Sicht lässt sich in die Geo einsetzen');
    const stempeln = (werkzeug: 'anheben' | 'glaetten', cx: number, cz: number, radius: number, staerke: number, n: number): void => {
      const s = new Strich(karte, `t-${werkzeug}`);
      for (let i = 0; i < n; i++) {
        s.stempel({ x: cx, z: cz, radius, staerke, werkzeug, hoehe: (x, z) => hmA.getGroundHeight(x, z) }, false);
        hmA.invalidateArea(cx, cz, radius + 1);
      }
    };
    stempeln('anheben', mitte[0] + 1, mitte[1] - 2, 7, 30, 3);
    stempeln('glaetten', mitte[0], mitte[1], 9, 25, 2);
    pruefe(karte.punktzahl > 100, `7: Strich bei (${mitte}) hat ${karte.punktzahl} Punkte gesetzt`);
    const zonen = karte.alsZonen();
    const layoutB = { ...LAYOUT, heightDeltas: zonen } as unknown as WorldLayout;
    const geoB = createGeo({ mode: 'layout', worldSeed: seed, layout: layoutB }) as RegionGeo;
    const hmB = new HeightmapProvider(geoB, { blendSmoothStep: true });
    let ungleich = 0;
    let geaendert = 0;
    const hmBasis = new HeightmapProvider(createGeo({ mode: 'layout', worldSeed: seed, layout: LAYOUT }) as RegionGeo, { blendSmoothStep: true });
    for (const [x, z] of punkte) {
      const a = hmA.getGroundHeight(mitte[0] + x, mitte[1] + z);
      const b = hmB.getGroundHeight(mitte[0] + x, mitte[1] + z);
      if (a !== b) ungleich++;
      if (a !== hmBasis.getGroundHeight(mitte[0] + x, mitte[1] + z)) geaendert++;
    }
    pruefe(ungleich === 0, `7: Testflug-Gelände = frisch kompiliertes Gelände, bitgleich an ${punkte.length} Punkten um (${mitte}) (${ungleich} Abweichungen)`);
    pruefe(geaendert > 30, `7: der Strich hat die Höhe wirklich verändert (${geaendert} von ${punkte.length} Punkten anders als ohne Korrektur)`);
    entferneKorrekturSicht(geoA);
    pruefe(hmA.getGroundHeight(mitte[0], mitte[1]) !== undefined, '7: (Sicht wieder entfernt)');
  }
  // the flight's own way: createWorld, one stroke, then a fresh createWorld from the draft
  const doc = { ...LAYOUT } as unknown as Record<string, unknown>;
  const a = aufbau(doc);
  zieheStrich(a, [30, 30], [36, 34], 10);
  const doc2 = a.entwurf.doc();
  const frisch = createWorld('gelaende-pinsel-test', {}, doc2);
  let ungleich = 0;
  for (let z = 20; z <= 44; z += 1) for (let x = 20; x <= 46; x += 1) if (a.welt.getGroundHeight(x, z) !== frisch.getGroundHeight(x, z)) ungleich++;
  pruefe(ungleich === 0, `7: createWorld: nach dem Strich = Welt frisch aus dem Entwurf, bitgleich an ${27 * 25} Punkten (${ungleich} Abweichungen)`);
  const hochGenug = a.welt.getGroundHeight(33, 32) - createWorld('gelaende-pinsel-test', {}, LAYOUT).getGroundHeight(33, 32);
  pruefe(hochGenug > 0.3, `7: der Strich wirkt (+${hochGenug.toFixed(2)} m bei (33,32))`);
}

// ── 8. Tasten und Takt ────────────────────────────────────────────────────────
{
  const taste = (key: string, code: string, o: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) =>
    radiusSchritt({ key, code, ctrlKey: false, altKey: false, metaKey: false, ...o });
  pruefe(taste('[', 'Digit8', { ctrlKey: true, altKey: true }) === -1, '8: deutsche Tastatur: AltGr+8 liefert „[“ → Radius −1');
  pruefe(taste(']', 'Digit9', { ctrlKey: true, altKey: true }) === 1, '8: deutsche Tastatur: AltGr+9 liefert „]“ → Radius +1');
  pruefe(taste('[', 'BracketLeft') === -1 && taste(']', 'BracketRight') === 1, '8: amerikanische Tastatur: [ und ] ohne Zusatztaste');
  pruefe(taste('-', 'Slash') === -1 && taste('+', 'BracketRight') === 1, '8: „-“ und „+“ als Zweitbelegung (deutsche Tasten)');
  pruefe(taste('', 'NumpadSubtract') === -1 && taste('', 'NumpadAdd') === 1, '8: Ziffernblock − und +');
  pruefe(taste('ü', 'BracketLeft') === 0 && taste('+', 'BracketRight', { ctrlKey: true }) === 0, '8: das ü der deutschen Tastatur (code BracketLeft) und Strg+Plus (Browser-Zoom) tun nichts');
  // e.key gilt unabhängig von Alt und AltGr; ausgeschlossen bleiben nur Strg ohne Alt und Meta.
  pruefe(taste('[', 'Digit5', { altKey: true }) === -1 && taste(']', 'Digit6', { altKey: true }) === 1, '8: Mac (deutsch): Option+5 liefert „[“ → −1, Option+6 „]“ → +1 (alt allein)');
  pruefe(taste('[', 'Digit8', { altKey: true }) === -1 && taste(']', 'Digit9', { altKey: true }) === 1, '8: Linux/Mac: „[“ und „]“ mit gehaltener Alt-Taste tun dasselbe');
  pruefe(taste('[', 'Digit8') === -1 && taste(']', 'Digit9') === 1, '8: deutsche Tastatur mit AltGr ohne Modifikatorflags (Linux)');
  pruefe(taste('[', 'BracketLeft', { ctrlKey: true }) === 0 && taste(']', 'BracketRight', { ctrlKey: true }) === 0, '8: Strg ohne Alt ist ein Kürzel und tut nichts');
  pruefe(taste('[', 'BracketLeft', { metaKey: true }) === 0 && taste('[', 'Digit5', { altKey: true, metaKey: true }) === 0, '8: Meta tut nichts');
  const takt = new StempelTakt();
  pruefe(takt.faellig(0, 0, 8, 0) === true, '8: der erste Stempel ist sofort fällig');
  pruefe(takt.faellig(0.1, 0, 8, 10) === false, '8: zu wenig Weg und Zeit: nichts');
  let stempel = 1;
  // moving 5 m/s in 1000 events per second for 2 s: at most 1 stamp per STEMPEL_MIN_MS, roughly one per radius/4
  for (let ms = 1; ms <= 2000; ms++) if (takt.faellig(ms * 0.005, 0, 8, ms)) stempel++;
  pruefe(stempel <= 2000 / STEMPEL_MIN_MS + 1 && stempel >= 5, `8: Ziehen mit 1000 Ereignissen/s: ${stempel} Stempel in 2 s (Deckel ${Math.floor(2000 / STEMPEL_MIN_MS) + 1})`);
  const halten = new StempelTakt();
  halten.faellig(5, 5, 8, 0);
  let gehalten = 1;
  for (let ms = 1; ms <= 1200; ms++) if (halten.faellig(5, 5, 8, ms)) gehalten++;
  pruefe(gehalten === 1 + Math.floor(1200 / STEMPEL_HALTE_MS), `8: stehende Maustaste: alle ${STEMPEL_HALTE_MS} ms ein Stempel (${gehalten} in 1,2 s)`);
}

// ── 9. Texte ──────────────────────────────────────────────────────────────────
{
  const lese = (n: string): Record<string, string> => JSON.parse(readFileSync(resolve(HIER, '../src/i18n/katalog', n), 'utf-8')) as Record<string, string>;
  const de = lese('de.json');
  const en = lese('en.json');
  const schluessel = Object.keys(de).filter((k) => k.startsWith('testflug.gelaende.'));
  pruefe(schluessel.length >= 20, `9: ${schluessel.length} Schlüssel testflug.gelaende.*`);
  pruefe(schluessel.every((k) => typeof en[k] === 'string' && en[k]!.length > 0), '9: jeder deutsche Schlüssel hat eine englische Fassung');
  pruefe(Object.keys(en).filter((k) => k.startsWith('testflug.gelaende.')).length === schluessel.length, '9: en hat keine zusätzlichen Schlüssel');
  const platzhalter = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  pruefe(schluessel.every((k) => platzhalter(de[k]!) === platzhalter(en[k]!)), '9: de und en tragen dieselben Platzhalter');
  // the source uses no key that does not exist
  const quellen = ['SpawnPanel.ts', 'testflug/Testflug.ts', 'testflug/GelaendeAktionen.ts', 'testflug/GelaendeSteuerung.ts'].map((f) => readFileSync(resolve(HIER, '../src/editor', f), 'utf-8')).join('\n');
  const benutzt = [...quellen.matchAll(/'(testflug\.gelaende\.[a-z_.]+)'/g)].map((m) => m[1]!);
  pruefe(benutzt.length > 15 && benutzt.every((k) => k in de), `9: alle ${benutzt.length} im Quelltext genannten Schlüssel gibt es (${benutzt.filter((k) => !(k in de)).join(', ')})`);
}

// ── 10. Verdrahtung (Quelltext, nur die Stellen, die ein Laufzeittest ohne Browser nicht erreicht) ──
{
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  const sp = readFileSync(resolve(HIER, '../src/editor/SpawnPanel.ts'), 'utf-8');
  pruefe(/panel\.istGelaendeModus && !e\.altKey && !routen\.istZeichenModus/.test(tf), '10: Linksklick im Reiter formt, Alt greift wie bisher, Routenzeichnen geht vor');
  pruefe(/setzeAb = \(\): void => \{\s*\/\/[^\n]*\n\s*if \(gelaendeUnten\) gelaendeAus\(\);/.test(tf), '10: Loslassen/Fokusverlust/Esc (setzeAb) beendet den Strich');
  pruefe(/if \(panel\.istGelaendeModus\) \{\s*gelaendeAus\(\);\s*panel\.beendeGelaendeModus\(\);/.test(tf), '10: Rechtsklick beendet das Werkzeug');
  pruefe(tf.includes('radiusSchritt(e)') && tf.includes('e.preventDefault();\n      panel.setzeRadius('), '10: Radiustasten laufen über radiusSchritt (e.key, nicht e.code)');
  pruefe(/aufZeichenStart: \(\) => \{[^}]*panel\.beendeGelaendeModus\(\)/.test(tf), '10: Routenzeichnen beendet das Geländewerkzeug');
  pruefe(sp.includes('get istGelaendeModus(): boolean') && sp.includes("if (tab === 'gelaende') this.beendePlatzierModus();"), '10: Reiterwechsel beendet den Setzen-Modus, istGelaendeModus gibt es');
  pruefe(/else if \(this\.tab === 'gelaende'\) \{\s*this\.tab = 'objekte';/.test(sp), '10: ein geschlossenes Panel verlässt den Gelände-Reiter');
}

// ── 11. Sperre: modulare Bauteile (B3) ────────────────────────────────────────
{
  const foliage: ReadonlySet<string> = new Set(FOLIAGE.map((f) => f.prefabName));
  const echt: SperrKatalog = {
    def: (n) => findPrefabByName(n),
    fest: (n) => istFesterKoerperImSpiel(findPrefabByName(n), n),
    vegetation: (n) => foliage.has(n),
    upload: () => undefined,
  };
  const teile = [
    'wood_wall',
    'wood_floor',
    'wood_roof',
    'wood_door',
    'environment-sm-bld-house-floor-wood-beam-01',
    'environment-sm-bld-house-roof-thatch-angled-01',
    'environment-sm-bld-house-wall-peak-04',
    'environment-sm-bld-house-tower-flooring-01',
    'environment-sm-bld-roof-long-01',
  ];
  for (const n of teile) {
    pruefe(findPrefabByName(n) !== undefined, `11: ${n} steht in der Registry`);
    const r = gebaeudeRadius({ prefab: n, x: 0, z: 0 }, echt);
    pruefe(r !== null && r > SPERR_RAND_TEST, `11: Bauteil ${n} sperrt (Radius ${r?.toFixed(2)} m)`);
    pruefe(istBauteil(findPrefabByName(n), n), `11: ${n} gilt als Bauteil`);
  }
  // Every hammer piece counts (the build mode's pieces), not just wall/floor/roof.
  for (const n of ['piece_workbench', 'wood_door', 'portal_wood', 'bed']) {
    pruefe(gebaeudeRadius({ prefab: n, x: 0, z: 0 }, echt) !== null, `11: Baumodus-Teil ${n} sperrt`);
  }
  for (const n of ['Beech1', 'Rock_3', 'Rock_4', 'MineRock_Tin']) {
    pruefe(findPrefabByName(n) !== undefined, `11: ${n} steht in der Registry`);
    pruefe(gebaeudeRadius({ prefab: n, x: 0, z: 0 }, echt) === null, `11: natürliches Objekt ${n} sperrt nicht`);
    pruefe(!istBauteil(findPrefabByName(n), n), `11: ${n} ist kein Bauteil`);
  }
  const kreise = sperrKreise(teile.map((n, i) => ({ prefab: n, x: i * 20, z: 0 })), echt);
  pruefe(kreise.length === teile.length && kreise.every((c) => c.art === 'gebaeude'), `11: ein Gebäudekreis je Bauteil (${kreise.length})`);
  pruefe(gesperrtDurch(kreise, 2 * 20 + 1.5, 0, 0.4) !== null && gesperrtDurch(kreise, 2 * 20 + 6, 0, 1) === null, '11: ein Pinsel am Dachstück ist gesperrt, einer 6 m daneben frei');
}

// ── 12. Wirkradius, Vorschaukreis und Sperre (B5) ─────────────────────────────
{
  let alleWeitenStimmen = true;
  let beispiel = '';
  for (const r of [6, 20]) {
    for (const staerke of [1, 2, 5, 10, 25, 50]) {
      const wirk = wirkRadius('anheben', r, staerke);
      const bl = berechneStempel(new DeltaKarte(), eingabe(0.3, 0.7, { radius: r, staerke }));
      const abstand = (a: (typeof bl)[number]): number => {
        const wx = a.zx * 64 - 32 + (a.index % 64);
        const wz = a.zz * 64 - 32 + Math.floor(a.index / 64);
        return Math.hypot(wx - 0.3, wz - 0.7);
      };
      const geaendert = new Set(bl.map((a) => `${a.zx},${a.zz},${a.index}`));
      const weitester = Math.max(...bl.map(abstand));
      let innenLuecke = 0;
      for (let z = -25; z <= 25; z++) {
        for (let x = -25; x <= 25; x++) {
          const d = Math.hypot(x - 0.3, z - 0.7);
          const p = punktVon(x, z);
          if (d < wirk - 1e-9 && !geaendert.has(`${p.zx},${p.zz},${p.index}`)) innenLuecke++;
        }
      }
      if (weitester > wirk + 1e-9 || innenLuecke > 0) alleWeitenStimmen = false;
      if (staerke === 1 && r === 6) beispiel = `${wirk.toFixed(3)} m von 6 m`;
    }
  }
  pruefe(alleWeitenStimmen, '12: wirkRadius = Reichweite des Stempels (kein Punkt außerhalb, keine Lücke innen) für Radius 6/20 und Stärke 1…50');
  pruefe(wirkRadius('glaetten', 6, 1) === 6, '12: Glätten behält den vollen Radius');
  pruefe(wirkRadius('anheben', 6, 1) < 6 * 0.55 && wirkRadius('anheben', 6, 50) > 6 * 0.94, `12: schwacher Stempel schmal (${beispiel}), starker fast voll`);
  // The circle the flight draws and the lock use it.
  const a = aufbau({ ...LAYOUT, placements: [{ id: 'sockel-2', prefab: 'BirkeHoch1', x: 60, z: 0, einebnen: 10 }] });
  a.ein.radius = 6;
  a.ein.staerke = 1;
  a.steuerung.vorschau({ x: 45, z: 0 });
  const schwach = a.kreise[a.kreise.length - 1]!;
  pruefe(Math.abs(schwach.r - wirkRadius('anheben', 6, 1)) < 1e-12, `12: die Vorschau zeichnet den Wirkradius (${schwach.r.toFixed(3)} m statt 6 m)`);
  pruefe(schwach.gesperrt === false, '12: Abstand 15 m zum Sockel (r 10): mit Wirkradius 3,25 m frei (der volle Radius 6 m hätte „rot“ gezeigt)');
  a.ein.staerke = 50;
  a.steuerung.vorschau({ x: 45, z: 0 });
  pruefe(a.kreise[a.kreise.length - 1]!.gesperrt === true, '12: derselbe Ort mit Stärke 50 (Wirkradius 5,7 m): gesperrt');
}

// ── 13. Der Flug folgt dem Entwurf (B1) ───────────────────────────────────────
{
  /** A foreign layer: a hill of raw points around (cx, cz), as another tab would have written it. */
  const fremdeEbene = (cx: number, cz: number, cm: number): unknown[] => {
    const k = new DeltaKarte();
    for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) {
      const p = punktVon(cx + x, cz + z);
      k.setze(p.zx, p.zz, p.index, cm);
    }
    return k.alsZonen();
  };
  const gleichWieEntwurf = (a: Aufbau, punkte: Array<[number, number]>): number => {
    const frisch = createWorld('gelaende-pinsel-test', {}, a.entwurf.doc());
    return punkte.filter(([x, z]) => a.welt.getGroundHeight(x, z) !== frisch.getGroundHeight(x, z)).length;
  };
  const raster: Array<[number, number]> = [];
  for (let z = -8; z <= 60; z += 2) for (let x = -8; x <= 60; x += 2) raster.push([x, z]);

  // (a) event: another tab replaced the layer, the flight takes it over
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    pruefe(a.steuerung.bereit(), '13: bereit');
    const basis = a.welt.getGroundHeight(40, 40);
    a.entwurf.setze({ ...LAYOUT, heightDeltas: fremdeEbene(40, 40, 300) });
    pruefe(a.welt.getGroundHeight(40, 40) === basis, '13: ohne Nachricht bleibt das Gelände, wie es war (Vorbedingung)');
    const bauteVorher = a.neuBauen.length;
    a.steuerung.entwurfGeaendert();
    const soll = createWorld('gelaende-pinsel-test', {}, a.entwurf.doc()).getGroundHeight(40, 40);
    pruefe(Math.abs(soll - basis - 3) < 1e-9, `13: der Entwurf sagt +3,00 m bei (40,40) (${(soll - basis).toFixed(3)})`);
    pruefe(a.welt.getGroundHeight(40, 40) === soll, `13: nach der Änderung im anderen Tab zeigt der Flug die Höhe des Entwurfs (${a.welt.getGroundHeight(40, 40).toFixed(3)} m = ${soll.toFixed(3)} m)`);
    pruefe(gleichWieEntwurf(a, raster) === 0, `13: … und auf dem ganzen Raster bitgleich zur Welt aus dem Entwurf (${raster.length} Punkte)`);
    pruefe(a.neuBauen.length > bauteVorher && a.nachStrich() === 1, '13: Neuaufbau gemeldet, lose Objekte einmal neu aufgesetzt (auch sie)');
    pruefe(a.meldungen.some((m) => m.includes('anderen Tab')), '13: HUD nennt den Grund');
    // and back: the other tab removes its layer again
    a.entwurf.setze({ ...LAYOUT });
    a.steuerung.entwurfGeaendert();
    pruefe(a.welt.getGroundHeight(40, 40) === basis && gleichWieEntwurf(a, raster) === 0, '13: entfernt der andere Tab die Ebene, ist das Gelände wieder wie am Anfang');
    // nothing changed: no rebuild, no message
    const n = a.neuBauen.length;
    a.steuerung.entwurfGeaendert();
    pruefe(a.neuBauen.length === n, '13: gleicher Entwurf: kein Neuaufbau');
  }
  // (b) an open stroke is not torn; the takeover waits for its end
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    a.steuerung.druecken({ x: 0, z: 0 }, false);
    a.setzeZeit(200);
    a.steuerung.tick({ x: 0, z: 0 }, false);
    const nachStempel = a.neuBauen.length;
    const basis = a.welt.getGroundHeight(40, 40);
    // the foreign layer does not overlap the stroke (0,0 ± 6 m), so the stroke will still be written
    a.entwurf.setze({ ...LAYOUT, heightDeltas: fremdeEbene(40, 40, 300) });
    a.steuerung.entwurfGeaendert();
    pruefe(a.neuBauen.length === nachStempel && a.welt.getGroundHeight(40, 40) === basis, '13: während des Strichs wird nichts übernommen (kein Neuaufbau, Gelände unverändert)');
    pruefe(a.steuerung.strichOffen, '13: der Strich läuft weiter');
    a.steuerung.loslassen();
    const doc = a.entwurf.doc();
    const punkte = DeltaKarte.ausZonen(doc.heightDeltas as never);
    const p40 = punktVon(40, 40);
    pruefe(a.aktionen.protokoll().length === 1 && punkte.delta(p40.zx, p40.zz, p40.index) === 300, '13: der Strich wurde auf den fremden Entwurf geschrieben, die fremde Ebene blieb');
    pruefe(gleichWieEntwurf(a, raster) === 0, '13: nach dem Strichende zeigt der Flug fremde Ebene + Strich, bitgleich zum Entwurf');
    pruefe(a.welt.getGroundHeight(40, 40) > basis + 2.9, '13: die fremde Höhe ist jetzt im Flug');
  }
  // (c) a stroke that collides with the foreign change: taken back, the ground follows the draft
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    a.steuerung.druecken({ x: 0, z: 0 }, false);
    a.entwurf.setze({ ...LAYOUT, heightDeltas: fremdeEbene(0, 0, 500) });
    a.steuerung.entwurfGeaendert();
    a.steuerung.loslassen();
    pruefe(a.aktionen.protokoll().length === 0 && gleichWieEntwurf(a, raster) === 0, '13: Kollision: kein Vorgang, das Gelände zeigt den Entwurf (bitgleich)');
  }
  // (d) no event at all (missed): the next stroke start compares the ground with the draft first
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    a.steuerung.bereit();
    a.entwurf.setze({ ...LAYOUT, heightDeltas: fremdeEbene(40, 40, 300) });
    a.steuerung.druecken({ x: -30, z: -30 }, false);
    a.steuerung.loslassen();
    pruefe(gleichWieEntwurf(a, raster) === 0, '13: auch ohne Nachricht: der Strichbeginn gleicht das Gelände mit dem Entwurf ab');
  }
  // (e) a foreign draft the brush cannot use locks it and says so; a good one unlocks it again
  {
    const a = aufbau(LAYOUT as unknown as Record<string, unknown>);
    a.steuerung.bereit();
    a.entwurf.setze({ ...LAYOUT, heightDeltas: 'kaputt' });
    a.steuerung.entwurfGeaendert();
    a.steuerung.druecken({ x: 0, z: 0 }, false);
    pruefe(!a.steuerung.strichOffen && a.meldungen.some((m) => m.includes('unbrauchbar')), '13: unbrauchbares fremdes Feld sperrt den Pinsel, HUD sagt es');
    a.entwurf.setze({ ...LAYOUT });
    a.steuerung.druecken({ x: 0, z: 0 }, false);
    pruefe(a.steuerung.strichOffen, '13: ein brauchbarer Entwurf entsperrt ihn wieder');
    a.steuerung.loslassen();
  }
  // wiring in the flight
  const tf = readFileSync(resolve(HIER, '../src/editor/testflug/Testflug.ts'), 'utf-8');
  // Since T3 the listener is `gelaendeHoerer.ts`; its behaviour (closed tab, `key === null`, other keys) is run in `gelaende-t3.ts`.
  pruefe(/verdrahteEntwurfHoerer\([^]*?ENTWURF_KEY[^]*?gelaende\.entwurfGeaendert\(\)/.test(tf), '13: Verdrahtung: das storage-Ereignis des Entwurfs ruft über den Hörer entwurfGeaendert()');
}

// ── 14. enthaelt() und der Ring der verdrängten Entwürfe (B2) ─────────────────
{
  const E = { ...LAYOUT, placements: [] } as unknown as WorldLayout;
  const strich = new DeltaKarte();
  strich.setze(0, 0, 32 * 64 + 32, 120);
  strich.setze(0, 0, 32 * 64 + 33, 80);
  const F = { ...E, heightDeltas: strich.alsZonen() } as WorldLayout;
  pruefe(!enthaelt(E, F), '14: ein Stand ohne Striche enthält den Stand MIT Strichen nicht');
  pruefe(enthaelt(F, E), '14: … der Stand mit Strichen enthält den ohne (nichts geht verloren)');
  pruefe(enthaelt(F, F) && enthaelt(E, E), '14: gleiche Stände enthalten einander');
  const mehr = new DeltaKarte();
  mehr.setze(0, 0, 32 * 64 + 32, 120);
  mehr.setze(0, 0, 32 * 64 + 33, 80);
  mehr.setze(3, -1, 7, 15);
  const G = { ...E, heightDeltas: mehr.alsZonen() } as WorldLayout;
  pruefe(enthaelt(G, F) && !enthaelt(F, G), '14: mehr Punkte enthalten die weniger (punktweise), nicht umgekehrt');
  const andererWert = new DeltaKarte();
  andererWert.setze(0, 0, 32 * 64 + 32, 121);
  andererWert.setze(0, 0, 32 * 64 + 33, 80);
  pruefe(!enthaelt({ ...E, heightDeltas: andererWert.alsZonen() } as WorldLayout, F), '14: derselbe Punkt mit anderem Delta: der alte Wert ginge verloren → nicht enthalten');
  pruefe(enthaelt({ ...E, name: E.name } as WorldLayout, { ...E, heightDeltas: [] } as unknown as WorldLayout), '14: leere Ebene verlangt nichts (Entwürfe ohne heightDeltas: Ergebnis unverändert)');

  // The sequence from the attack: a stroke in the flight, Ctrl+Z in the editor, a new change.
  const speicher = new Map<string, string>();
  const kv = { getItem: (k: string) => speicher.get(k) ?? null, setItem: (k: string, v: string) => void speicher.set(k, v), removeItem: (k: string) => void speicher.delete(k) };
  let editorStand: WorldLayout = E;
  const rueckgaengig: WorldLayout[] = [];
  const ring: WorldLayout[] = [];
  const s = new EntwurfsSpeicher({
    speicher: kv,
    aktuell: () => editorStand,
    beiFremdem: (fremd) => {
      rueckgaengig.push(editorStand); // the editor takes the foreign stand over, its own goes on the undo stack
      editorStand = fremd;
    },
    beiVerdraengt: (alt) => void ring.push(alt),
  });
  s.schreiben(E, 'bearbeitet', null); // the editor's own draft
  kv.setItem('wov-editor-layout', JSON.stringify(F)); // the flight writes the strokes
  pruefe(s.abgleichen() === true && JSON.stringify(editorStand.heightDeltas) === JSON.stringify(F.heightDeltas), '14: der Editor übernimmt den Flugstand mit den Strichen');
  editorStand = rueckgaengig.pop()!; // Ctrl+Z
  pruefe(s.schreiben(editorStand, 'bearbeitet', null) === 'ok', '14: Strg+Z schreibt den Stand ohne Striche');
  pruefe(ring.length === 1 && ring[0]!.heightDeltas?.length === 1 && JSON.stringify(ring[0]!.heightDeltas) === JSON.stringify(F.heightDeltas), `14: der verdrängte Flugstand mit den Strichen liegt im Ring (${ring.length} Eintrag)`);
  // then a new change: the redo entry F is dropped; it must not count as "already contained"
  const G2 = { ...E, placements: [{ id: 'p1', prefab: 'Beech1', x: 5, z: 5 }] } as unknown as WorldLayout;
  pruefe(!enthaelt(G2, F), '14: nach einer neuen Änderung ist der verworfene Flugstand NICHT „schon enthalten“ (der Ring sichert ihn)');
}

// ── 15. Glätten über die Zonengrenze, Wertgrenze in wendeVorgang (B7) ─────────
{
  // Translation invariance: the same spike next to a zone seam and in the middle of a zone must smooth alike.
  const bild = (sx: number, sz: number, cx: number, cz: number): string => {
    const spitze = (x: number, z: number): number => (x === sx && z === sz ? 2 : 0);
    const bl = berechneStempel(new DeltaKarte(), eingabe(cx, cz, { werkzeug: 'glaetten', staerke: 25, radius: 3, hoehe: spitze }));
    // the same list relative to the stamp centre, so that two places can be compared
    return JSON.stringify(
      bl
        .map((a) => [a.zx * 64 - 32 + (a.index % 64) - cx, a.zz * 64 - 32 + Math.floor(a.index / 64) - cz, a.neu])
        .sort((p, q) => p[1]! - q[1]! || p[0]! - q[0]!)
    );
  };
  const innen = bild(20, 20, 19, 20); // deep inside zone 0/0
  pruefe(innen !== '[]', '15: Vergleichsprobe innerhalb einer Zone glättet');
  pruefe(bild(32, 0, 31, 0) === bild(20, 0, 19, 0), '15: Glätten über die Zonennaht in x (Zone 0/0 | 1/0) = Glätten mitten in einer Zone');
  pruefe(bild(0, 32, 0, 31) === bild(0, 20, 0, 19), '15: … in z (Zone 0/0 | 0/1)');
  pruefe(bild(-32, 5, -33, 5) === bild(-10, 5, -11, 5), '15: … über die Naht bei negativen Zonen (−1/0 | 0/0)');
  pruefe(bild(32, 32, 31, 31) === bild(10, 10, 9, 9), '15: … über die Ecke (vier Zonen)');
  const naht = berechneStempel(new DeltaKarte(), eingabe(31, 0, { werkzeug: 'glaetten', staerke: 25, radius: 3, hoehe: (x, z) => (x === 32 && z === 0 ? 2 : 0) }));
  const links = naht.find((a) => a.zx === 0 && a.zz === 0 && a.index === 32 * 64 + 63);
  const rechts = naht.find((a) => a.zx === 1 && a.zz === 0 && a.index === 32 * 64 + 0);
  pruefe(links !== undefined && links.neu > 0 && rechts !== undefined && rechts.neu < 0, '15: die Spitze in Zone 1 hebt den Nachbarn in Zone 0 und wird selbst gesenkt');

  // Wertgrenze: direkt am Vorgang (der Strich prüft sie schon selbst, wendeVorgang ist das zweite Tor: Entwurf, Umkehr)
  const k = new DeltaKarte();
  const zuHoch = wendeVorgang(k, { vorgangId: 'v', aenderungen: [{ zx: 0, zz: 0, index: 5, alt: 0, neu: 10_001 }] });
  pruefe(!zuHoch.ok && zuHoch.grund === 'wert' && k.punktzahl === 0, '15: wendeVorgang lehnt 10 001 cm ab (Grund „wert“) und lässt die Ebene, wie sie war');
  const zuTief = wendeVorgang(k, { vorgangId: 'v', aenderungen: [{ zx: 0, zz: 0, index: 5, alt: 0, neu: -10_001 }] });
  pruefe(!zuTief.ok && zuTief.grund === 'wert' && k.punktzahl === 0, '15: … und −10 001 cm');
  const genau = wendeVorgang(k, { vorgangId: 'v', aenderungen: [{ zx: 0, zz: 0, index: 5, alt: 0, neu: 10_000 }, { zx: 0, zz: 0, index: 6, alt: 0, neu: -10_000 }] });
  pruefe(genau.ok && k.delta(0, 0, 5) === 10_000 && k.delta(0, 0, 6) === -10_000, '15: genau ±10 000 cm sind erlaubt');
  const halb = wendeVorgang(k, { vorgangId: 'v', aenderungen: [{ zx: 0, zz: 0, index: 7, alt: 0, neu: 5 }, { zx: 0, zz: 0, index: 8, alt: 0, neu: 20_000 }] });
  pruefe(!halb.ok && halb.grund === 'wert' && k.delta(0, 0, 7) === 0, '15: ein Vorgang mit einem zu hohen Punkt wird GANZ zurückgenommen (auch der gute Punkt)');
  const viele = new DeltaKarte();
  const punkte = Array.from({ length: 100_001 }, (_, i) => ({ zx: Math.floor(i / 4096), zz: 0, index: i % 4096, alt: 0, neu: 1 }));
  const zuViele = wendeVorgang(viele, { vorgangId: 'v', aenderungen: punkte });
  pruefe(!zuViele.ok && zuViele.grund === 'punkte' && viele.punktzahl === 0, '15: 100 001 Punkte: abgelehnt (Grund „punkte“), Ebene leer');
  const zonen = wendeVorgang(new DeltaKarte(), { vorgangId: 'v', aenderungen: Array.from({ length: 4097 }, (_, i) => ({ zx: i, zz: 0, index: 0, alt: 0, neu: 1 })) });
  pruefe(!zonen.ok && zonen.grund === 'zonen', '15: 4097 Zonen: abgelehnt (Grund „zonen“)');
}

console.log(`\n${geprueft - fehler}/${geprueft} Prüfungen bestanden`);
if (fehler > 0) {
  console.error(`${fehler} FEHLER`);
  process.exit(1);
}
