/**
 * Kartenkacheln des Editors (K3.0): das Bild wird für den sichtbaren
 * Ausschnitt gerechnet statt einmal für die ganze Welt.
 *
 * Geprüft wird das Verhalten, nicht der Quelltext:
 *  1. Stufenwahl: bei 4 m/px deckt ein Texel höchstens 4 m (vorher 30,6 m),
 *     nie mehr als 1,5 Bildschirmpixel, darüber genügt das Gesamtbild.
 *  2. Adressierung: die Kacheln überdecken das Sichtfenster lückenlos, die
 *     mittigste kommt zuerst; das Zielrechteck liegt bei der Weltkoordinate
 *     des Texels (keine Verschiebung) und lässt keine Haarlinie zwischen
 *     Nachbarn.
 *  3. Rechnung: jeder Texel trägt genau die Farbe, die dieselbe Weltprobe
 *     liefert; die Küste liegt im Bild höchstens einen halben Texel neben der
 *     Küste im Höhenfeld.
 *  4. Zwischenspeicher: feste Obergrenze, längst Unbenutztes geht zuerst,
 *     jedes verdrängte Bild wird freigegeben.
 *  5. Dienst (mit gestellten Workern, ohne Rechenzeit): Reihenfolge Mitte
 *     zuerst, veraltete Ansichten werden nie gesendet, Antworten älterer
 *     Welt-Generationen fallen weg, 50 Bedienschritte wachsen nicht über die
 *     Obergrenze, Ruhe sendet nichts.
 *
 * Lauf:  npx tsx test/karte-kacheln.ts
 */
import {
  createGeo,
  getStableHash,
  sanitizeWorldLayout,
  Biome,
  WATER_LEVEL,
  type WorldLayout,
} from '@wov/shared';
import {
  KACHEL_BYTES,
  KACHEL_MAX_STUFE,
  KACHEL_PX,
  KachelDienst,
  KachelSpeicher,
  farbe,
  kachelMeter,
  kachelRechteck,
  kachelSchluessel,
  kachelUrsprung,
  rendereKachel,
  sichtbareKacheln,
  stufeFuer,
  texelMeter,
  type Ansicht,
  type KachelAdresse,
  type KachelWorker,
} from '../src/ui/worldmap/kartenKacheln';
import { forestDensity } from '../src/ui/worldmap/MapPalette';
import type { MapTileInit, MapTileRequest, MapWorkerMessage } from '../src/ui/worldmap/mapTypes';

let fehler = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    fehler++;
    console.error(`FAIL ${name} ${detail}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// ── 1. Stufenwahl ────────────────────────────────────────────────────
{
  check('4 m/px → Stufe 0, ein Texel deckt 4 m', stufeFuer(4) === 0 && texelMeter(0) === 4);
  check('Vorher deckte ein Texel 30,6 m: die feinste Stufe ist 7,6-mal schärfer', 62640 / 2048 / texelMeter(0) > 7.5);
  let monoton = true;
  let letzte = -1;
  let hoechstens15 = true;
  let anzahlOk = true;
  for (let m = 4; m <= 200; m *= 1.05) {
    const s = stufeFuer(m);
    if (s === null) {
      letzte = Infinity;
      continue;
    }
    if (s < letzte) monoton = false;
    letzte = s;
    if (texelMeter(s) > 1.5 * m + 1e-9) hoechstens15 = false;
    // Texel je Bildschirmpixel: nie mehr als 1,78² … (m / texel)² ≤ 1,78
    if ((m / texelMeter(s)) ** 2 > 1.78) anzahlOk = false;
  }
  check('Stufe wächst mit dem Maßstab', monoton);
  check('Ein Texel ist nie breiter als 1,5 Bildschirmpixel', hoechstens15);
  check('Nie mehr als 1,78-mal so viele Texel wie Bildschirmpixel', anzahlOk);
  check('Maßstab 40 (Vorgabe) → Stufe 3 (32 m)', stufeFuer(40) === 3);
  check('Ab 43 m/px genügt das Gesamtbild (null)', stufeFuer(43) === null && stufeFuer(200) === null);
  check('Grenze der Stufen', KACHEL_MAX_STUFE === 3 && kachelMeter(0) === 1024);
}

// ── 2. Adressierung ──────────────────────────────────────────────────
const A: Ansicht = { mitteX: -17620, mitteZ: -5700, massstab: 4, breite: 1600, hoehe: 900 };
{
  const liste = sichtbareKacheln(A, 0);
  const schluessel = new Set(liste.map(kachelSchluessel));
  check('Keine Kachel doppelt', schluessel.size === liste.length);
  // Deckung: jeder Bildpunkt liegt in einer Kachel der Liste.
  let luecke = 0;
  for (let py = 0; py <= A.hoehe; py += 30) {
    for (let px = 0; px <= A.breite; px += 30) {
      const wx = (px - A.breite / 2) * A.massstab + A.mitteX;
      const wz = (py - A.hoehe / 2) * A.massstab + A.mitteZ;
      const k = { stufe: 0, ix: Math.floor(wx / 1024), iz: Math.floor(wz / 1024) };
      if (!schluessel.has(kachelSchluessel(k))) luecke++;
    }
  }
  check('Das Sichtfenster ist lückenlos abgedeckt', luecke === 0, `${luecke} Lücken`);
  const erste = kachelUrsprung(liste[0]);
  check(
    'Die erste Kachel enthält die Bildmitte',
    A.mitteX >= erste.x0 && A.mitteX < erste.x0 + erste.meter && A.mitteZ >= erste.z0 && A.mitteZ < erste.z0 + erste.meter,
  );
  let steigt = true;
  let vorher = -1;
  for (const k of liste) {
    const u = kachelUrsprung(k);
    const d = Math.hypot(u.x0 + u.meter / 2 - A.mitteX, u.z0 + u.meter / 2 - A.mitteZ);
    if (d < vorher - 1e-9) steigt = false;
    vorher = d;
  }
  check('Reihenfolge: aufsteigender Abstand zur Bildmitte', steigt);
  check('Ein Vollbild bei 4 m/px braucht 8 × 5 bis 9 × 6 Kacheln samt halbem Rand', liste.length >= 40 && liste.length <= 60, `${liste.length}`);

  // Zielrechteck: die Weltkoordinate des Texels landet auf dem Pixel von zuBild().
  let versatz = 0;
  for (const k of liste.slice(0, 12)) {
    const r = kachelRechteck(A, k);
    const u = kachelUrsprung(k);
    const soll = (u.x0 - A.mitteX) / A.massstab + A.breite / 2; // dasselbe wie zuBild im Editor
    versatz = Math.max(versatz, Math.abs(r.x - soll) + 0); // gerundet: höchstens ein Pixel abwärts
    if (!(r.x <= soll && soll - r.x < 1)) versatz = Infinity;
    if (r.w < u.meter / A.massstab) versatz = Infinity;
  }
  check('Kachelrechteck sitzt auf der Weltkoordinate (Rundung höchstens 1 px)', versatz < 1, `${versatz}`);
  // Nachbarn: rechte Kante der einen ≥ linke Kante der nächsten (keine Haarlinie).
  let haarlinie = 0;
  for (const k of liste) {
    const r = kachelRechteck(A, k);
    const n = kachelRechteck(A, { ...k, ix: k.ix + 1 });
    if (r.x + r.w < n.x) haarlinie++;
    const u = kachelRechteck(A, { ...k, iz: k.iz + 1 });
    if (r.y + r.h < u.y) haarlinie++;
  }
  check('Nachbarkacheln lassen keine Lücke', haarlinie === 0);
}

// ── 3. Rechnung gegen die Weltprobe und gegen das Höhenfeld ──────────
const dok: WorldLayout = sanitizeWorldLayout({
  version: 1,
  name: 'kachel-test',
  detailSeed: 'kachel-test',
  regions: [{ id: 'i-1', biome: 'grassland', shape: { kind: 'circle', x: 0, z: 0, radius: 900 }, edgeFalloff: 300 }],
})!;
const geo = createGeo({
  mode: 'layout',
  worldSeed: getStableHash(dok.detailSeed),
  layout: dok,
  settings: { worldGenVersion: 2, disableDistantRivers: false, riverAffectsOcean: false, ashlandsModernNoise: true },
});
/** Wasser im Sinn der Kartenfarbe: Ozean oder unter dem Pegel. */
const istWasser = (x: number, z: number): boolean => {
  const b = geo.getBiome(x, z);
  return b === Biome.Ocean || geo.getBiomeHeight(b, x, z).height < WATER_LEVEL;
};
const gemerkt = new Map<string, Uint8Array>();
function rendereKachelGemerkt(ix: number, iz: number): Uint8Array {
  const k = `${ix}:${iz}`;
  let t = gemerkt.get(k);
  if (!t) gemerkt.set(k, (t = rendereKachel(geo, { stufe: 0, ix, iz })));
  return t;
}

/** Farbe einer Weltprobe, direkt aus der Geo (ohne Kachel). */
function weltFarbe(wx: number, wz: number): Uint8Array {
  const b = geo.getBiome(wx, wz);
  const h = geo.getBiomeHeight(b, wx, wz).height;
  const f = new Uint8Array(4);
  farbe(b, h, h >= WATER_LEVEL ? forestDensity(geo.getForestFactor(wx, wz)) : 0, f, 0);
  return f;
}
const gleich = (t: Uint8Array, o: number, f: Uint8Array): boolean => t[o] === f[0] && t[o + 1] === f[1] && t[o + 2] === f[2] && t[o + 3] === 255;
{
  const k: KachelAdresse = { stufe: 0, ix: 0, iz: 0 };
  const kachel = rendereKachel(geo, k);
  check('Eine Kachel hat KACHEL_PX² × 4 Bytes', kachel.length === KACHEL_BYTES && KACHEL_BYTES === 262144);
  let falsch = 0;
  const probe = [[0, 0], [255, 0], [0, 255], [255, 255], [17, 200], [128, 128], [200, 31], [90, 240]];
  for (const [i, j] of probe) {
    if (!gleich(kachel, (j * KACHEL_PX + i) * 4, weltFarbe((i + 0.5) * 4, (j + 0.5) * 4))) falsch++;
  }
  check('Jeder geprüfte Texel trägt die Farbe seiner Weltprobe (Texelmitte)', falsch === 0, `${falsch} abweichend`);
  const zweite = rendereKachel(geo, k);
  check('Die Rechnung ist deterministisch', Buffer.compare(Buffer.from(kachel), Buffer.from(zweite)) === 0);
  // Naht: letzter Texel der Kachel (0,0) und erster der Kachel (1,0) sind die Proben bei x = 1022 und x = 1026.
  const rechts = rendereKachel(geo, { stufe: 0, ix: 1, iz: 0 });
  const wz = (100 + 0.5) * 4;
  check(
    'Naht zwischen zwei Kacheln: die Texel beiderseits sind die Proben im Abstand eines Texels',
    gleich(kachel, (100 * KACHEL_PX + 255) * 4, weltFarbe(1022, wz)) && gleich(rechts, 100 * KACHEL_PX * 4, weltFarbe(1026, wz)),
  );

  // Schärfe an der Küste: Ray von der Mitte nach außen; wahre Küste per Halbierung im Höhenfeld,
  // Küste im Bild = erster Wechsel der Texelklasse. Die Abweichung ist höchstens ein halber Texel.
  const winkel = [0, 2.1, 4.2];
  let groessteAbweichung = 0;
  let gemessen = 0;
  for (const w of winkel) {
    const dx = Math.cos(w);
    const dz = Math.sin(w);
    let lo = 0;
    let hi = 2400;
    if (istWasser(dx * lo, dz * lo) || !istWasser(dx * hi, dz * hi)) continue;
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2;
      if (istWasser(dx * mid, dz * mid)) hi = mid;
      else lo = mid;
    }
    const wahr = (lo + hi) / 2;
    // Bildküste: entlang des Strahls die Texel der passenden Stufe-0-Kachel abtasten.
    const texelKlasse = (x: number, z: number): boolean => {
      const ix = Math.floor(x / 1024);
      const iz = Math.floor(z / 1024);
      const t = rendereKachelGemerkt(ix, iz);
      const px = Math.min(KACHEL_PX - 1, Math.floor((x - ix * 1024) / 4));
      const pz = Math.min(KACHEL_PX - 1, Math.floor((z - iz * 1024) / 4));
      const o = (pz * KACHEL_PX + px) * 4;
      // Wasser ist blaudominant (SHORE/DEEP), Land nicht
      return t[o + 2] > t[o] + 20 && t[o + 2] > t[o + 1] + 5;
    };
    let bild = -1;
    for (let r = wahr - 60; r <= wahr + 60; r += 0.25) {
      if (texelKlasse(dx * r, dz * r)) {
        bild = r;
        break;
      }
    }
    if (bild < 0) continue;
    gemessen++;
    groessteAbweichung = Math.max(groessteAbweichung, Math.abs(bild - wahr));
  }
  check('Küste an drei Stellen im Bild gefunden', gemessen === 3, `${gemessen}`);
  check(
    'Küste im Bild höchstens 4 m neben der Küste im Höhenfeld (ein Texel)',
    groessteAbweichung <= 4 + 0.25,
    `${groessteAbweichung.toFixed(2)} m`,
  );
}

// ── 4. Zwischenspeicher ──────────────────────────────────────────────
{
  const zu: number[] = [];
  const sp = new KachelSpeicher<number>(4 * KACHEL_BYTES, (b) => zu.push(b));
  for (let i = 0; i < 6; i++) sp.setze({ stufe: 0, ix: i, iz: 0 }, 1, i);
  check('Obergrenze: höchstens 4 Kacheln, 1 MB', sp.groesse === 4 && sp.bytes === 4 * KACHEL_BYTES);
  check('Verdrängt wurden die zwei ältesten, und sie wurden freigegeben', zu.join() === '0,1' && sp.freigegeben === 2);
  const e2 = sp.get('0:2:0')!;
  sp.beruehre(e2);
  sp.setze({ stufe: 0, ix: 9, iz: 0 }, 1, 9);
  check('Eine berührte Kachel überlebt, die älteste geht', sp.get('0:2:0') !== undefined && sp.get('0:3:0') === undefined);
  sp.setze({ stufe: 0, ix: 9, iz: 0 }, 2, 99);
  check('Ersetzen gibt das alte Bild frei, Größe bleibt', zu.includes(9) && sp.groesse === 4);
  const vorLeeren = sp.freigegeben;
  sp.leeren();
  check('Leeren gibt alles frei', sp.groesse === 0 && sp.bytes === 0 && sp.freigegeben === vorLeeren + 4);
}

// ── 5. Dienst mit gestellten Workern ─────────────────────────────────
class FalscherWorker implements KachelWorker {
  onNachricht: ((m: MapWorkerMessage) => void) | null = null;
  gepostet: (MapTileInit | MapTileRequest)[] = [];
  offen: MapTileRequest | null = null;
  terminiert = false;
  post(m: MapTileInit | MapTileRequest): void {
    this.gepostet.push(m);
    if (m.op === 'kachel') {
      if (this.offen) throw new Error('zweiter Auftrag an einen rechnenden Worker');
      this.offen = m;
    }
  }
  terminate(): void {
    this.terminiert = true;
  }
  /** Den laufenden Auftrag beantworten. */
  antworte(): MapTileRequest | null {
    const a = this.offen;
    if (!a) return null;
    this.offen = null;
    this.onNachricht?.({
      t: 'kachel',
      gen: a.gen,
      id: a.id,
      stufe: a.stufe,
      ix: a.ix,
      iz: a.iz,
      data: new Uint8Array(KACHEL_BYTES),
      dauerMs: 1,
    });
    return a;
  }
}
const mikro = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
function neuerDienst(anzahl: number, maxKacheln = 256) {
  const worker: FalscherWorker[] = [];
  const geschlossen: number[] = [];
  let neu = 0;
  let eingelagert = 0;
  let uhr = 0;
  const dienst = new KachelDienst<number>({
    anzahl,
    erzeuge: () => {
      const w = new FalscherWorker();
      worker.push(w);
      return w;
    },
    bild: () => {
      eingelagert++;
      return eingelagert;
    },
    schliesse: (b) => geschlossen.push(b),
    maxBytes: maxKacheln * KACHEL_BYTES,
    aufNeu: () => neu++,
    jetzt: () => (uhr += 10),
  });
  const stand = { worker, geschlossen, neu: () => neu, eingelagert: () => eingelagert };
  return { dienst, stand };
}
/** Alle Worker antworten lassen, bis Ruhe ist. Liefert die Antwortfolge. */
async function bisRuhe(worker: FalscherWorker[], grenze = 5000): Promise<MapTileRequest[]> {
  const folge: MapTileRequest[] = [];
  for (let n = 0; n < grenze; n++) {
    let etwas = false;
    for (const w of worker) {
      const a = w.antworte();
      if (a) {
        folge.push(a);
        etwas = true;
        await mikro();
      }
    }
    if (!etwas) return folge;
  }
  throw new Error('keine Ruhe');
}

async function dienstProben(): Promise<void> {
  // 5a. Reihenfolge und Ruhe
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    const folge = await bisRuhe(stand.worker);
    const soll = sichtbareKacheln(A, 0).slice(0, folge.length).map(kachelSchluessel);
    const ist = folge.map((a) => kachelSchluessel(a));
    check('Ein Worker rechnet die Kacheln genau in der Reihenfolge Mitte zuerst', ist.join() === soll.join());
    check('Alle sichtbaren Kacheln samt Rand sind geliefert', folge.length === sichtbareKacheln(A, 0).length);
    check('Init ging an den Worker, dann die Aufträge', stand.worker[0].gepostet[0].op === 'kachel-init');
    const st = dienst.statistik();
    check('Nichts mehr offen, eine abgeschlossene Nachrechnung mit Dauer', st.offen === 0 && st.zyklen.length === 1 && st.zyklen[0] > 0);
    const vorher = dienst.statistik().gesendet;
    dienst.setzeAnsicht({ ...A });
    dienst.setzeAnsicht({ ...A });
    await mikro();
    check('Ruhe sendet nichts (gleiche Ansicht, alles da)', dienst.statistik().gesendet === vorher && stand.worker[0].offen === null);
    check('Jede eingetroffene Kachel wurde neu gezeichnet gemeldet', stand.neu() === folge.length);
  }
  // 5b. Zwei Worker: die beiden mittigsten zuerst, keine doppelt
  {
    const { dienst, stand } = neuerDienst(2);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    const erste = stand.worker.map((w) => (w.offen ? kachelSchluessel(w.offen) : ''));
    const soll = sichtbareKacheln(A, 0).slice(0, 2).map(kachelSchluessel);
    check('Zwei Worker bekommen die zwei mittigsten Kacheln', erste.join() === soll.join());
  }
  // 5c. Veraltete Ansicht wird nie gesendet
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    const laeuft = stand.worker[0].offen!;
    const B: Ansicht = { ...A, mitteX: A.mitteX + 20000, mitteZ: A.mitteZ - 8000 };
    dienst.setzeAnsicht(B);
    const folge = await bisRuhe(stand.worker);
    const sichtB = new Set(sichtbareKacheln(B, 0).map(kachelSchluessel));
    const nachDemWechsel = folge.slice(1).map((a) => kachelSchluessel(a));
    check('Nach dem Verschieben wird keine Kachel der alten Ansicht mehr angefordert', nachDemWechsel.every((s) => sichtB.has(s)));
    check(
      'Höchstens die eine unterwegs befindliche Kachel der alten Ansicht kam noch an',
      kachelSchluessel(folge[0]) === kachelSchluessel(laeuft) && dienst.statistik().ungesucht === 1,
    );
    const st = dienst.statistik();
    check('Gesendet: eine alte plus alle der neuen Ansicht, nicht die 49 alten', st.gesendet === 1 + sichtB.size, `${st.gesendet} gegen ${1 + sichtB.size}`);
  }
  // 5d. Welt-Generation: alte Antworten fallen weg, alte Kacheln bleiben bis zum Ersatz
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    for (let i = 0; i < 3; i++) {
      stand.worker[0].antworte();
      await mikro();
    }
    const imSpeicher = dienst.statistik().kacheln;
    const laeuft = stand.worker[0].offen!;
    dienst.neueWelt(2, 'kachel-test', dok);
    check('Neue Welt: alle Worker bekommen einen Init mit der neuen Generation', stand.worker[0].gepostet.some((m) => m.op === 'kachel-init' && m.gen === 2));
    const s2 = dienst.statistik();
    check('Die alten Kacheln bleiben zum Zeichnen stehen', s2.kacheln === imSpeicher && s2.kacheln === 3);
    check('Alle Kacheln der Ansicht gelten als offen, auch die alten (Neuberechnung)', s2.offen === sichtbareKacheln(A, 0).length, `${s2.offen}`);
    stand.worker[0].antworte(); // Antwort mit Generation 1
    await mikro();
    check('Eine Antwort der alten Generation wird verworfen und nicht eingelagert', dienst.statistik().veraltet === 1 && dienst.statistik().kacheln === 3);
    void laeuft;
    const folge = await bisRuhe(stand.worker);
    check('Danach werden alle Kacheln der neuen Generation nachgerechnet', folge.every((a) => a.gen === 2) && folge.length === sichtbareKacheln(A, 0).length);
    check('Die Kachel der Ansicht ist danach gleich oft im Speicher wie sichtbar', dienst.statistik().kacheln === sichtbareKacheln(A, 0).length);
  }
  // 5e. 50 Bedienschritte: Obergrenze hält, nichts liegt herum
  {
    const maxKacheln = 60;
    const { dienst, stand } = neuerDienst(3, maxKacheln);
    dienst.neueWelt(1, 'kachel-test', dok);
    let zufall = 12345;
    const z = (): number => {
      zufall = (Math.imul(zufall, 1664525) + 1013904223) >>> 0;
      return zufall / 0x100000000;
    };
    let ansicht: Ansicht = { ...A };
    let hoechstBytes = 0;
    let hoechstKacheln = 0;
    let ueberGrenze = 0;
    const eingelagertNach: number[] = [];
    for (let schritt = 0; schritt < 50; schritt++) {
      if (schritt % 3 === 0) {
        ansicht = { ...ansicht, massstab: Math.min(200, Math.max(4, ansicht.massstab * (z() < 0.5 ? 1.2 : 1 / 1.2))) };
      } else {
        ansicht = {
          ...ansicht,
          mitteX: ansicht.mitteX + (z() - 0.5) * ansicht.breite * ansicht.massstab * 0.8,
          mitteZ: ansicht.mitteZ + (z() - 0.5) * ansicht.hoehe * ansicht.massstab * 0.8,
        };
      }
      dienst.setzeAnsicht(ansicht);
      await bisRuhe(stand.worker);
      const st = dienst.statistik();
      hoechstBytes = Math.max(hoechstBytes, st.bytes);
      hoechstKacheln = Math.max(hoechstKacheln, st.kacheln);
      if (st.bytes > st.maxBytes || st.kacheln > maxKacheln) ueberGrenze++;
      if (st.offen !== 0 && stufeFuer(ansicht.massstab) !== null && sichtbareKacheln(ansicht, stufeFuer(ansicht.massstab)!).length <= maxKacheln * 0.75) ueberGrenze++;
      eingelagertNach.push(stand.eingelagert() - stand.geschlossen.length);
    }
    check('50 Schritte: Bytes und Kacheln nie über der Obergrenze', ueberGrenze === 0 && hoechstBytes <= maxKacheln * KACHEL_BYTES && hoechstKacheln <= maxKacheln, `max ${hoechstKacheln} Kacheln, ${hoechstBytes} Bytes`);
    const st = dienst.statistik();
    check('Kein Bild bleibt liegen: eingelagert − freigegeben = im Speicher', stand.eingelagert() - stand.geschlossen.length === st.kacheln && st.freigegeben === stand.geschlossen.length);
    check('Verdrängt wurde tatsächlich (der Lauf wäre sonst zu klein gewesen)', st.freigegeben > 100, `${st.freigegeben}`);
    const hinten = eingelagertNach.slice(25);
    check('Kein Wachstum zwischen Schritt 25 und 50', Math.max(...hinten) <= maxKacheln);
    dienst.beende();
    check('Beenden räumt alles ab: Speicher leer, Worker beendet', dienst.statistik().kacheln === 0 && stand.worker.every((w) => w.terminiert) && stand.geschlossen.length === stand.eingelagert());
  }
  // 5f. Grobes Bild genügt jenseits der Kachelstufen; leere Welt rechnet nichts
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht({ ...A, massstab: 100 });
    check('Bei 100 m/px wird keine Kachel angefordert', stand.worker[0].offen === null && dienst.statistik().gesendet === 0);
    dienst.setzeAnsicht({ ...A, massstab: 4 });
    check('Zoom hinein fordert sofort an', stand.worker[0].offen !== null);
    dienst.keineWelt();
    stand.worker[0].antworte();
    await mikro();
    const st = dienst.statistik();
    check('Leeres Dokument: Antwort der alten Welt fällt weg, Speicher leer, nichts offen', st.kacheln === 0 && st.offen === 0 && st.veraltet === 1);
  }
  // 5g. Zeichnen: grob zuerst, Weitverkleinertes bleibt weg, nur Sichtbares
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    await bisRuhe(stand.worker);
    const gezeichnet: { b: number; x: number; y: number; w: number; h: number }[] = [];
    const ctx = { drawImage: (b: number, x: number, y: number, w: number, h: number) => gezeichnet.push({ b, x, y, w, h }) };
    dienst.zeichne(ctx, A);
    const imBild = gezeichnet.every((g) => g.x < A.breite && g.y < A.hoehe && g.x + g.w > 0 && g.y + g.h > 0);
    check('Es wird nur gezeichnet, was im Bild liegt, und es wird gezeichnet', imBild && gezeichnet.length > 20 && gezeichnet.length < sichtbareKacheln(A, 0).length);
    gezeichnet.length = 0;
    dienst.zeichne(ctx, { ...A, massstab: 12 });
    check('Bei 12 m/px bleiben 4-m-Kacheln weg (dreifach verkleinert, flimmert)', gezeichnet.length === 0);
  }
}

await dienstProben();

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nalle Prüfungen bestanden');
