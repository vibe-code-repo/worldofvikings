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
 *  5. Dienst (mit gestellten Workern, ohne Rechenzeit): erst alles im Bild
 *     (Mitte zuerst), dann der Randring; veraltete Ansichten werden nie
 *     gesendet, Antworten älterer Welt-Generationen fallen weg, 50
 *     Bedienschritte wachsen nicht über die Obergrenze, Ruhe sendet nichts.
 *  6. Große Fenster (4K/8K): der Speicher verdrängt nie, was gerade gesucht
 *     wird (keine Dauerrechnung nach Vorlauf im kleinen Fenster), alle Kacheln
 *     im Bild kommen und „scharf" gilt erst dann, die Obergrenze wächst mit
 *     dem Bedarf bis zur harten Grenze; ein Worker ohne Geo räumt seine Marke
 *     ab, pausiert nach drei Fehlversuchen (1 s, dann doppelt so lang) und wird
 *     danach mit frischem Init neu versucht: auch ein einzelner Worker erholt sich.
 *  7. Kanten: jede Kachelkante liegt auf einem ganzen Pixel, Nachbarn teilen
 *     sie, auch bei gebrochenen Ansichten.
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

  // Zielrechteck: jede Kante liegt auf einem ganzen Pixel, höchstens ein halbes Pixel neben ihrem Weltort
  // (Weltort = zuBild() im Editor), und Nachbarn teilen sich die Kante: keine Lücke, keine Überlappung.
  // Geprüft auf ganzzahligen UND gebrochenen Ansichten (der Mutant floor/round bleibt sonst unentdeckt).
  const ansichten: Ansicht[] = [
    A,
    { mitteX: -17620.37, mitteZ: -5699.61, massstab: 4.63, breite: 1194, hoehe: 796 },
    { mitteX: 15000.5, mitteZ: 9000.25, massstab: 5.29, breite: 3434, hoehe: 2056 },
    { mitteX: -3.3, mitteZ: 7.7, massstab: 6.913, breite: 777, hoehe: 555 },
  ];
  let kanteFalsch = 0;
  let nachbarFalsch = 0;
  let nichtGanz = 0;
  let gebrochen = 0;
  let geprueft = 0;
  for (const an of ansichten) {
    const stufe = stufeFuer(an.massstab)!;
    for (const k of sichtbareKacheln(an, stufe)) {
      const r = kachelRechteck(an, k);
      const u = kachelUrsprung(k);
      const weltX = (u.x0 - an.mitteX) / an.massstab + an.breite / 2;
      const weltY = (u.z0 - an.mitteZ) / an.massstab + an.hoehe / 2;
      const rechts = (u.x0 + u.meter - an.mitteX) / an.massstab + an.breite / 2;
      const unten = (u.z0 + u.meter - an.mitteZ) / an.massstab + an.hoehe / 2;
      geprueft++;
      if (!Number.isInteger(weltX)) gebrochen++;
      if (![r.x, r.y, r.w, r.h].every(Number.isInteger)) nichtGanz++;
      if (r.x !== Math.round(weltX) || r.y !== Math.round(weltY)) kanteFalsch++;
      if (r.x + r.w !== Math.round(rechts) || r.y + r.h !== Math.round(unten)) kanteFalsch++;
      if (Math.abs(r.x - weltX) > 0.5 || Math.abs(r.x + r.w - rechts) > 0.5) kanteFalsch++;
      const n = kachelRechteck(an, { ...k, ix: k.ix + 1 });
      const d = kachelRechteck(an, { ...k, iz: k.iz + 1 });
      if (r.x + r.w !== n.x || r.y !== n.y || r.y + r.h !== d.y || r.x !== d.x) nachbarFalsch++;
    }
  }
  check('Kachelränder liegen auf ganzen Pixeln', nichtGanz === 0, `${nichtGanz}`);
  check('Jede Kante ist auf das nächste Pixel gerundet, höchstens ein halbes neben ihrem Weltort', kanteFalsch === 0, `${kanteFalsch} von ${geprueft}`);
  check('Die geprüften Ansichten haben gebrochene Sollwerte (sonst prüft der Test nichts)', gebrochen > geprueft / 2, `${gebrochen} von ${geprueft}`);
  check('Nachbarkacheln teilen sich jede Kante: keine Lücke, keine Überlappung', nachbarFalsch === 0, `${nachbarFalsch}`);
  {
    // Ein Bildpunkt gehört genau einer Kachel (Überlappung wäre Doppelzeichnen, Lücke eine Haarlinie).
    const an = ansichten[1];
    const stufe = stufeFuer(an.massstab)!;
    const liste = sichtbareKacheln(an, stufe);
    let zaehlFalsch = 0;
    for (let py = 0; py < an.hoehe; py += 7) {
      for (let px = 0; px < an.breite; px += 5) {
        let n = 0;
        for (const k of liste) {
          const r = kachelRechteck(an, k);
          if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) n++;
        }
        if (n !== 1) zaehlFalsch++;
      }
    }
    check('Jeder Bildpunkt liegt in genau einer Kachel', zaehlFalsch === 0, `${zaehlFalsch}`);
  }
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
  // Geschütztes bleibt, solange Ungeschütztes da ist; die Obergrenze gilt trotzdem immer.
  {
    const sp2 = new KachelSpeicher<number>(3 * KACHEL_BYTES);
    const schutz = new Set(['0:1:0', '0:2:0', '0:3:0', '0:4:0']);
    sp2.setze({ stufe: 0, ix: 0, iz: 0 }, 1, 0, KACHEL_BYTES, schutz); // ungeschützt und am ältesten
    sp2.setze({ stufe: 0, ix: 1, iz: 0 }, 1, 1, KACHEL_BYTES, schutz);
    sp2.setze({ stufe: 0, ix: 2, iz: 0 }, 1, 2, KACHEL_BYTES, schutz);
    sp2.setze({ stufe: 0, ix: 3, iz: 0 }, 1, 3, KACHEL_BYTES, schutz);
    check('Verdrängt wird das Ungeschützte, obwohl es das älteste ist und Geschütztes jünger', sp2.get('0:0:0') === undefined && sp2.get('0:1:0') !== undefined && sp2.groesse === 3);
    sp2.setze({ stufe: 0, ix: 4, iz: 0 }, 1, 4, KACHEL_BYTES, schutz);
    check('Ist alles geschützt, hält die Obergrenze trotzdem: das älteste Geschützte geht', sp2.groesse === 3 && sp2.bytes <= 3 * KACHEL_BYTES && sp2.get('0:1:0') === undefined && sp2.get('0:4:0') !== undefined);
    sp2.setzeMax(KACHEL_BYTES, schutz);
    check('Obergrenze zur Laufzeit gesenkt: es bleibt genau eine Kachel', sp2.groesse === 1 && sp2.bytes === KACHEL_BYTES);
  }
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
  /** Den laufenden Auftrag mit „nicht gerechnet" beantworten (Worker ohne Geo dieser Generation). */
  antworteLeer(): MapTileRequest | null {
    const a = this.offen;
    if (!a) return null;
    this.offen = null;
    this.onNachricht?.({ t: 'kachel-leer', gen: a.gen, id: a.id, stufe: a.stufe, ix: a.ix, iz: a.iz });
    return a;
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
  const timer: { fn: () => void; ms: number }[] = [];
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
    warte: (fn, ms) => timer.push({ fn, ms }),
  });
  const stand = { worker, geschlossen, timer, neu: () => neu, eingelagert: () => eingelagert };
  return { dienst, stand };
}
/**
 * Alle Worker antworten lassen, bis Ruhe ist. Liefert die Antwortfolge. Kommt keine Ruhe (der Dienst rechnet
 * endlos), ist das eine fehlgeschlagene Prüfung und kein Abbruch mit Ausnahme.
 */
const ctxLeer = { imageSmoothingEnabled: true, drawImage(): void {} };
async function bisRuhe(
  worker: FalscherWorker[],
  grenze = 3000,
  /** Wie der Editor: nach jeder eingetroffenen Kachel neu zeichnen (das berührt die Kacheln im Speicher). */
  zeichnen?: { dienst: KachelDienst<number>; ansicht: Ansicht },
): Promise<MapTileRequest[]> {
  const folge: MapTileRequest[] = [];
  for (let n = 0; n < grenze; n++) {
    let etwas = false;
    for (const w of worker) {
      const a = w.antworte();
      if (a) {
        folge.push(a);
        etwas = true;
        await mikro();
        zeichnen?.dienst.zeichne(ctxLeer, zeichnen.ansicht);
      }
    }
    if (!etwas) return folge;
  }
  check('Der Dienst kommt zur Ruhe (keine Dauerrechnung)', false, `nach ${grenze} Runden noch Aufträge`);
  return folge;
}

async function dienstProben(): Promise<void> {
  // 5a. Reihenfolge und Ruhe
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    const folge = await bisRuhe(stand.worker);
    const imBildA = sichtbareKacheln(A, 0, 0);
    const setBild = new Set(imBildA.map(kachelSchluessel));
    const sollA = [...imBildA, ...sichtbareKacheln(A, 0).filter((k) => !setBild.has(kachelSchluessel(k)))]
      .slice(0, folge.length)
      .map(kachelSchluessel);
    const ist = folge.map((a) => kachelSchluessel(a));
    check('Ein Worker rechnet zuerst alles im Bild (Mitte zuerst), dann den Randring', ist.join() === sollA.join());
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
      // Die Obergrenze ist der Grundwert oder, bei großer Ansicht, Bedarf plus Reserve — nie mehr.
      if (st.bytes > st.maxBytes || st.maxBytes > Math.max(maxKacheln, st.noetig + 32) * KACHEL_BYTES) ueberGrenze++;
      if (st.offen !== 0) ueberGrenze++;
      eingelagertNach.push(stand.eingelagert() - stand.geschlossen.length);
    }
    check('50 Schritte: Bytes nie über der Obergrenze, die Obergrenze nie über Bedarf plus Reserve, nach jedem Schritt scharf', ueberGrenze === 0 && hoechstBytes <= 512 * KACHEL_BYTES, `max ${hoechstKacheln} Kacheln, ${hoechstBytes} Bytes, ${ueberGrenze} Verstöße`);
    const st = dienst.statistik();
    check('Kein Bild bleibt liegen: eingelagert − freigegeben = im Speicher', stand.eingelagert() - stand.geschlossen.length === st.kacheln && st.freigegeben === stand.geschlossen.length);
    check('Verdrängt wurde tatsächlich (der Lauf wäre sonst zu klein gewesen)', st.freigegeben > 100, `${st.freigegeben}`);
    const hinten = eingelagertNach.slice(25);
    check('Kein Wachstum zwischen Schritt 25 und 50 (nie über dem größten Bedarf des Laufs)', Math.max(...hinten) <= hoechstKacheln);
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
    const gezeichnet: { b: number; x: number; y: number; w: number; h: number; glatt: boolean }[] = [];
    const ctx = {
      imageSmoothingEnabled: true,
      drawImage(b: number, x: number, y: number, w: number, h: number) {
        gezeichnet.push({ b, x, y, w, h, glatt: this.imageSmoothingEnabled });
      },
    };
    dienst.zeichne(ctx, A);
    const imBild = gezeichnet.every((g) => g.x < A.breite && g.y < A.hoehe && g.x + g.w > 0 && g.y + g.h > 0);
    check('Es wird nur gezeichnet, was im Bild liegt, und es wird gezeichnet', imBild && gezeichnet.length > 20 && gezeichnet.length < sichtbareKacheln(A, 0).length);
    check('Bei etwa einem Texel je Pixel wird ungeglättet gezeichnet (Bildzeit im Software-Canvas)', gezeichnet.every((g) => !g.glatt) && gezeichnet.length > 20);
    check('Die Glättung ist danach wieder an (gilt für das Gesamtbild)', ctx.imageSmoothingEnabled === true);
    // Zwei Stufen im Speicher: bei 6 m/px sind 8-m-Kacheln (Stufe 1) das Ziel, die 4-m-Kacheln
    // (Stufe 0) noch nicht zu fein. Grobe zuerst, damit die feinen obenauf liegen.
    const B6: Ansicht = { ...A, massstab: 6 };
    dienst.setzeAnsicht(B6);
    for (let i = 0; i < 3; i++) {
      stand.worker[0].antworte(); // erst drei Kacheln der neuen Stufe: die Ansicht ist noch nicht vollständig
      await mikro();
    }
    gezeichnet.length = 0;
    dienst.zeichne(ctx, B6);
    const breiten = gezeichnet.map((g) => g.w);
    const letzteGrobe = breiten.reduce((m, w, i) => (w >= 300 ? i : m), -1);
    const ersteFeine = breiten.findIndex((w) => w < 200);
    check(
      'Zwei Stufen im Bild: erst alle groben, dann die feinen',
      letzteGrobe >= 0 && ersteFeine >= 0 && letzteGrobe < ersteFeine,
      `${letzteGrobe} / ${ersteFeine}`,
    );
    // Ist die gesuchte Stufe vollständig da, verschwinden die gröberen Kacheln darunter (weniger Zeichenarbeit).
    await bisRuhe(stand.worker);
    gezeichnet.length = 0;
    dienst.zeichne(ctx, B6);
    check(
      'Vollständige Ansicht: nur noch die gesuchte Stufe wird gezeichnet',
      gezeichnet.length >= 10 && gezeichnet.every((g) => g.w > 300),
      `${gezeichnet.length} Kacheln`,
    );
    // Starke Vergrößerung (grobe Ersatzkachel): geglättet.
    {
      const { dienst: d2, stand: s2 } = neuerDienst(1);
      d2.neueWelt(1, 'kachel-test', dok);
      d2.setzeAnsicht({ ...A, massstab: 40 });
      await bisRuhe(s2.worker);
      gezeichnet.length = 0;
      d2.zeichne(ctx, { ...A, massstab: 5 });
      check('32-m-Kacheln bei 5 m/px (6,4-fach vergrößert) bleiben weg: das Gesamtbild übernimmt', gezeichnet.length === 0);
      gezeichnet.length = 0;
      d2.zeichne(ctx, { ...A, massstab: 16 });
      check('Bei 16 m/px (zweifach vergrößert) werden 32-m-Kacheln ungeglättet gezeichnet', gezeichnet.length > 0 && gezeichnet.every((g) => !g.glatt));
    }
    gezeichnet.length = 0;
    dienst.zeichne(ctx, { ...A, massstab: 12 });
    // 12 m/px: 4-m-Kacheln wären 85 px breit (dreifach verkleinert, flimmert), 8-m-Kacheln 171 px.
    check(
      'Bei 12 m/px bleiben 4-m-Kacheln weg, 8-m-Kacheln werden gezeichnet',
      gezeichnet.length > 0 && gezeichnet.every((g) => g.w > 150),
    );
  }
}

/**
 * Sind alle Kacheln der gesuchten Stufe im Bild (ohne Randring) da? Fasst den Dienst nur über `hat` an; die
 * ältere Fassung ohne `hat` wird über die Zahl der Kacheln im Speicher geprüft (sie reicht, um sie rot zu machen).
 */
function alleDa(dienst: KachelDienst<number>, a: Ansicht): boolean {
  const stufe = stufeFuer(a.massstab);
  if (stufe === null) return true;
  const sichtbar = sichtbareKacheln(a, stufe, 0);
  const d = dienst as unknown as { hat?: (k: KachelAdresse) => boolean };
  if (typeof d.hat === 'function') return sichtbar.every((k) => d.hat!(k));
  return dienst.statistik().kacheln >= sichtbar.length;
}
const V4K = { breite: 3434, hoehe: 2056 }; // Leinwand eines 3840 x 2160-Fensters

async function dienstProben2(): Promise<void> {
  // 6a. Verdrängungsschleife (B1): Vorlauf im kleinen Fenster füllt den Speicher mit feineren Ersatzkacheln,
  // dann ein 4K-Fenster mit 4 -> 4,5 -> 5 -> 5,3 -> 6 m/px. Der Dienst muss zur Ruhe kommen und scharf werden.
  {
    const { dienst, stand } = neuerDienst(4);
    dienst.neueWelt(1, 'kachel-test', dok);
    let x = -16279;
    let z = -5700;
    let m = 4;
    for (let i = 1; i <= 20; i++) {
      if (i % 2 === 0) m = Math.min(40, Math.max(4, m * 1.2));
      else {
        x += 0.8 * 1600 * m * (i % 4 === 1 ? 1 : -1);
        z += 0.5 * 900 * m * (i % 4 === 3 ? 1 : -1);
      }
      const an: Ansicht = { mitteX: x, mitteZ: z, massstab: m, breite: 1600, hoehe: 900 };
      dienst.setzeAnsicht(an);
      dienst.zeichne(ctxLeer, an);
      await bisRuhe(stand.worker, 3000, { dienst, ansicht: an });
    }
    let alleScharf = true;
    let ruhig = true;
    let bezug = '';
    for (const mm of [4, 4.5, 5, 5.3]) {
      const an: Ansicht = { mitteX: 15000, mitteZ: 9000, massstab: mm, ...V4K };
      dienst.setzeAnsicht(an);
      dienst.zeichne(ctxLeer, an);
      await bisRuhe(stand.worker, 3000, { dienst, ansicht: an });
      const st = dienst.statistik();
      if (st.offen !== 0 || st.letzteScharfMs === null || !alleDa(dienst, an)) alleScharf = false;
      bezug += ` @${mm}: offen ${st.offen} kacheln ${st.kacheln} gesendet ${st.gesendet};`;
    }
    const K6: Ansicht = { mitteX: 15000, mitteZ: 9000, massstab: 6, ...V4K };
    const vor6 = dienst.statistik().gesendet;
    dienst.setzeAnsicht(K6);
    dienst.zeichne(ctxLeer, K6);
    const folge6 = await bisRuhe(stand.worker, 3000, { dienst, ansicht: K6 });
    const st6 = dienst.statistik();
    const gesendet6 = st6.gesendet - vor6;
    check('4K nach Vorlauf, 4 bis 5,3 m/px: offen 0, scharf gemeldet, alle Kacheln im Bild da', alleScharf, bezug);
    check('4K bei 6 m/px nach Vorlauf: alle Kacheln im Bild da, scharf, offen 0', st6.offen === 0 && st6.letzteScharfMs !== null && alleDa(dienst, K6), `offen ${st6.offen}`);
    // Jede Kachel höchstens einmal angefordert: keine Schleife.
    const stufe6 = stufeFuer(6)!;
    check('4K bei 6 m/px: höchstens so viele Aufträge wie gesuchte Kacheln (keine Verdrängungsschleife)', gesendet6 <= sichtbareKacheln(K6, stufe6).length && folge6.length === gesendet6, `${gesendet6} Aufträge, ${sichtbareKacheln(K6, stufe6).length} gesucht`);
    const nach = dienst.statistik().gesendet;
    dienst.setzeAnsicht({ ...K6 });
    dienst.setzeAnsicht({ ...K6 });
    const still = await bisRuhe(stand.worker);
    ruhig = still.length === 0 && dienst.statistik().gesendet === nach;
    check('Danach kommt nichts mehr: keine neue Anforderung ohne Änderung der Ansicht', ruhig);
    check('Bytes nie über der Obergrenze (die mit dem Bedarf wächst)', st6.bytes <= st6.maxBytes);
    dienst.beende();
  }
  // 6b. Deckel (B2): bei 4K und 4 / 5 / 5,3 / 6 m/px müssen ALLE Kacheln im Bild kommen, und „scharf" gilt erst dann.
  for (const mm of [4, 5, 5.3, 6]) {
    const { dienst, stand } = neuerDienst(4);
    dienst.neueWelt(1, 'kachel-test', dok);
    const an: Ansicht = { mitteX: 15000, mitteZ: 9000, massstab: mm, ...V4K };
    dienst.setzeAnsicht(an);
    let zuFruh = 0;
    for (let runde = 0; runde < 3000; runde++) {
      let etwas = false;
      for (const w of stand.worker) {
        if (w.antworte()) {
          etwas = true;
          // „scharf" gemeldet, obwohl im Bild noch etwas fehlt? Gleich nach der Antwort prüfen: die letzte Kachel ist
          // dann noch in der Umwandlung, und der Dienst darf sie nicht schon als da zählen.
          if (dienst.statistik().letzteScharfMs !== null && !alleDa(dienst, an)) zuFruh++;
          await mikro();
          if (dienst.statistik().letzteScharfMs !== null && !alleDa(dienst, an)) zuFruh++;
        }
      }
      if (!etwas) break;
    }
    const st = dienst.statistik();
    const stufe = stufeFuer(mm)!;
    const noetig = sichtbareKacheln(an, stufe, 0).length;
    console.log(`     4K @${mm} m/px: im Bild ${noetig} Kacheln, gesendet ${st.gesendet}, im Speicher ${st.kacheln}, Deckel ${Math.round(st.maxBytes / KACHEL_BYTES)}, scharf nach ${st.letzteScharfMs === null ? '-' : Math.round(st.letzteScharfMs)} (Zeitgeber)`);
    check(`4K @${mm} m/px: alle ${noetig} Kacheln im Bild sind da`, alleDa(dienst, an), `${st.kacheln} im Speicher`);
    check(`4K @${mm} m/px: „scharf" wird erst gemeldet, wenn alles im Bild da ist`, zuFruh === 0 && st.letzteScharfMs !== null, `${zuFruh}× zu früh`);
    dienst.beende();
  }
  // 6c. Harte Grenze: ein Fenster, das mehr braucht als der Speicher hält, wird gekappt und sagt es.
  {
    const { dienst, stand } = neuerDienst(4);
    dienst.neueWelt(1, 'kachel-test', dok);
    const an: Ansicht = { mitteX: 15000, mitteZ: 9000, massstab: 4, breite: 7680, hoehe: 4320 };
    dienst.setzeAnsicht(an);
    await bisRuhe(stand.worker);
    const st = dienst.statistik();
    check('8K bei 4 m/px: Bytes bleiben unter der harten Obergrenze (128 MB)', st.bytes <= 512 * KACHEL_BYTES && st.maxBytes <= 512 * KACHEL_BYTES, `${st.bytes}`);
    check('8K bei 4 m/px: der Dienst sagt, dass er kappt', (st as unknown as { gekappt?: boolean }).gekappt === true);
    dienst.beende();
  }
  // 6d. „nicht gerechnet" (B4): die Marke wird abgeräumt, der Worker bekommt sein Init noch einmal, die Kachel kommt später.
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    stand.worker[0].antworteLeer();
    await mikro();
    const inits = stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length;
    check('Nach „nicht gerechnet" bekommt der Worker sein Init noch einmal', inits === 2, `${inits}`);
    await bisRuhe(stand.worker);
    const st = dienst.statistik();
    check('Danach ist alles da: offen 0, scharf gemeldet (die leere Kachel wurde neu angefordert)', st.offen === 0 && st.letzteScharfMs !== null && alleDa(dienst, A), `offen ${st.offen}`);
    dienst.neueWelt(2, 'kachel-test', dok);
    await bisRuhe(stand.worker);
    check('Die Marke überlebt keine neue Welt: offen 0 und scharf auch in Generation 2', dienst.statistik().offen === 0 && dienst.statistik().zyklen.length >= 2);
    dienst.beende();
  }
  // 6e. Ein Worker, der dauernd „nicht gerechnet" sagt, pausiert, statt eine Dauerschleife zu erzeugen.
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    let n = 0;
    for (; n < 50; n++) {
      if (!stand.worker[0].antworteLeer()) break;
      await mikro();
    }
    const kachelAuftraege = stand.worker[0].gepostet.filter((m) => m.op === 'kachel').length;
    check('Ein Worker ohne Geo bekommt höchstens dreimal einen Auftrag', kachelAuftraege === 3 && n === 3, `${kachelAuftraege} Aufträge, ${n} Antworten`);
    check('Er pausiert genau eine Sekunde lang (ein Zeitgeber, 1000 ms)', stand.timer.length === 1 && stand.timer[0].ms === 1000, `${JSON.stringify(stand.timer.map((t) => t.ms))}`);
    dienst.beende();
  }
  // 6f. Ein einzelner Worker, dessen Init dreimal scheitert und danach wieder gut ist: die Karte wird scharf
  // (vorher blieb sie bis zur nächsten Dokumentänderung unscharf: offen 40, keine Erholung).
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    for (let i = 0; i < 3; i++) {
      stand.worker[0].antworteLeer();
      await mikro();
    }
    const vorPause = dienst.statistik();
    check('Während der Pause kommt kein Auftrag und die Karte ist nicht scharf', stand.worker[0].offen === null && vorPause.offen > 0 && vorPause.letzteScharfMs === null);
    const inits0 = stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length;
    // Die Pause endet: frisches Init, dann wieder Aufträge; der Worker antwortet jetzt gut.
    for (const t of stand.timer.splice(0)) t.fn();
    const inits1 = stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length;
    check('Nach der Pause bekommt der Worker ein frisches Init und wieder einen Auftrag', inits1 === inits0 + 1 && stand.worker[0].offen !== null, `${inits0} -> ${inits1}`);
    await bisRuhe(stand.worker);
    const st = dienst.statistik();
    check('Danach ist die Karte scharf: offen 0, scharf gemeldet, alle Kacheln im Bild da', st.offen === 0 && st.letzteScharfMs !== null && alleDa(dienst, A), `offen ${st.offen}`);
    dienst.beende();
  }
  // 6g. Scheitert der Worker nach der Pause wieder, wird die nächste Pause länger; ein Erfolg setzt sie zurück.
  {
    const { dienst, stand } = neuerDienst(1);
    dienst.neueWelt(1, 'kachel-test', dok);
    dienst.setzeAnsicht(A);
    const pausen: number[] = [];
    let beantwortet = 0;
    for (let runde = 0; runde < 3; runde++) {
      for (let i = 0; i < 3; i++) {
        if (stand.worker[0].antworteLeer()) beantwortet++;
        await mikro();
      }
      for (const t of stand.timer.splice(0)) {
        pausen.push(t.ms);
        t.fn();
      }
    }
    check('Die Pausen wachsen: 1 s, 2 s, 4 s', pausen.join() === '1000,2000,4000', pausen.join());
    check('Nach jeder Pause gibt es wieder drei Versuche, bevor die nächste beginnt', beantwortet === 9, `${beantwortet} Antworten`);
    await bisRuhe(stand.worker);
    check('Nach dem Erfolg ist die Karte scharf', dienst.statistik().offen === 0 && dienst.statistik().letzteScharfMs !== null);
    // Neue Welt: die Zählung beginnt von vorn, ein überholter Zeitgeber tut nichts.
    dienst.setzeAnsicht({ ...A, mitteX: A.mitteX + 9000 });
    for (let i = 0; i < 3; i++) {
      stand.worker[0].antworteLeer();
      await mikro();
    }
    const alt = stand.timer.splice(0);
    check('Nach dem Erfolg beginnt die nächste Pause wieder bei 1 s', alt.length === 1 && alt[0].ms === 1000, alt.map((t) => t.ms).join());
    dienst.neueWelt(2, 'kachel-test', dok);
    const initsVor = stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length;
    alt[0].fn();
    check('Ein Zeitgeber der alten Welt tut nichts (kein zusätzliches Init)', stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length === initsVor);
    // Eine neue Pause der neuen Welt läuft schon: der alte Zeitgeber darf sie nicht vorzeitig beenden.
    dienst.setzeAnsicht({ ...A, mitteX: A.mitteX - 9000 });
    for (let i = 0; i < 3; i++) {
      stand.worker[0].antworteLeer();
      await mikro();
    }
    const initsNeu = stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length;
    alt[0].fn();
    check('Ein alter Zeitgeber beendet eine neuere Pause nicht vorzeitig', stand.worker[0].gepostet.filter((m) => m.op === 'kachel-init').length === initsNeu && stand.worker[0].offen === null);
    dienst.beende();
  }
}

await dienstProben();
await dienstProben2();

if (fehler > 0) {
  console.error(`\n${fehler} Prüfung(en) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nalle Prüfungen bestanden');
