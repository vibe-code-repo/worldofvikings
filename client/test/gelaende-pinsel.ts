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
 *
 * Run: npx tsx test/gelaende-pinsel.ts   (from client/)
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeo, getStableHash, HeightmapProvider, PrefabFlag, RegionGeo, sanitizeHeightDeltas } from '@wov/shared';
import type { WorldLayout } from '@wov/shared';
import { createWorld } from '../src/world/World';
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
  STEMPEL_HALTE_MS,
  STEMPEL_MIN_MS,
  type StempelEingabe,
} from '../src/editor/testflug/gelaendePinsel';
import { gebaeudeRadius, gesperrtDurch, sperrKreise, type SperrKatalog } from '../src/editor/testflug/gelaendeSperre';
import { GelaendeAktionen } from '../src/editor/testflug/GelaendeAktionen';
import { GelaendeSteuerung, type GelaendeAbh, type Kasten } from '../src/editor/testflug/GelaendeSteuerung';
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
  ein: { werkzeug: 'anheben' | 'absenken' | 'glaetten'; radius: number; staerke: number };
}
function aufbau(doc: Record<string, unknown>): Aufbau {
  const welt = createWorld('gelaende-pinsel-test', {}, doc);
  const e = entwurf(doc);
  const aktionen = new GelaendeAktionen(e);
  const meldungen: string[] = [];
  const neuBauen: Kasten[] = [];
  let nach = 0;
  let zeit = 1000;
  let vorgaenge = 0;
  const ein: Aufbau['ein'] = { werkzeug: 'anheben', radius: 6, staerke: 20 };
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
    meldung: (t) => meldungen.push(t),
    kreis: { zeige: () => undefined, verberge: () => undefined },
    nachStrich: () => {
      nach++;
    },
    jetztMs: () => zeit,
    vorgangId: () => `strich-${++vorgaenge}`,
  };
  return { steuerung: new GelaendeSteuerung(abh), aktionen, entwurf: e, meldungen, neuBauen, nachStrich: () => nach, welt, setzeZeit: (ms) => (zeit += ms), ein };
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
  const vorKonflikt = b.welt.getGroundHeight(0, 0);
  b.steuerung.loslassen();
  pruefe(b.aktionen.protokoll().length === 0 && b.entwurf.schreibungen() === 0, '6: Konflikt: kein Vorgang, kein Schreiben');
  pruefe(b.welt.getGroundHeight(0, 0) < vorKonflikt, '6: Konflikt: der Strich ist auch aus dem lebenden Gelände zurückgenommen');
  pruefe(b.meldungen.some((m) => m.includes('geändert') || m.includes('changed')), '6: Konflikt: HUD sagt es');

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
  pruefe(taste('-', 'Slash', { altKey: true }) === 0 && taste('[', 'BracketLeft', { metaKey: true }) === 0, '8: Alt allein und Meta allein sind andere Kürzel');
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

console.log(`\n${geprueft - fehler}/${geprueft} Prüfungen bestanden`);
if (fehler > 0) {
  console.error(`${fehler} FEHLER`);
  process.exit(1);
}
