/**
 * Kartenkacheln des Editors: das Bild wird nicht mehr einmal für die ganze
 * Welt gerechnet, sondern in Kacheln fester Größe für den Ausschnitt, den
 * man gerade sieht.
 *
 * Warum: Das Gesamtbild deckt bei einer 62-km-Karte 30,6 m je Texel ab (das
 * Farbraster darunter sogar 61 m), der Editor zoomt aber bis 4 m/px. Eine
 * größere Gesamttextur würde den Speicher vervierfachen und 4 m/px trotzdem
 * nicht erreichen. Kacheln rechnen dagegen genau die Stelle, die im Bild
 * liegt, und nur so fein, wie der Maßstab es braucht.
 *
 * Das Modul ist frei von DOM und Worker-Globals: die Adressierung, die Wahl
 * der Stufe, der Zwischenspeicher, die Reihenfolge und der Dienst, der die
 * Aufträge an Worker verteilt, laufen so unverändert im Test. Der Worker
 * (mapWorker.ts) ruft nur `rendereKachel`.
 */
import { Biome, WATER_LEVEL, type IGeo } from '@wov/shared';
import { BIOME_COLOR, DEEP_WATER, SHORE_WATER, forestDensity, type RGB } from './MapPalette';
import type { MapTileInit, MapTileRequest, MapWorkerMessage } from './mapTypes';

/** Kantenlänge einer Kachel in Texeln. */
export const KACHEL_PX = 256;
/** Bytes einer fertigen Kachel (RGBA). */
export const KACHEL_BYTES = KACHEL_PX * KACHEL_PX * 4;
/** Feinste Stufe: so viele Weltmeter deckt ein Texel ab. Jede Stufe doppelt so grob. */
export const KACHEL_MIN_METER = 4;
/**
 * Gröbste Kachelstufe (32 m je Texel). Darüber ist das Gesamtbild nicht
 * gröber als eine Kachel würde, also zeichnet es allein.
 */
export const KACHEL_MAX_STUFE = 3;
/** Vorgabe der Speicherobergrenze für fertige Kacheln: 64 MB = 256 Kacheln. */
export const KACHEL_SPEICHER_BYTES = 256 * KACHEL_BYTES;

/**
 * Größte Vergrößerung (Zielbreite / Texel), in der eine Ersatzkachel noch gezeichnet wird. Stärker
 * vergrößerte (grobe) Kacheln lässt der Dienst weg: das geglättete Gesamtbild darunter ist dort
 * genauso grob und billiger als eine Kachel, die man dafür glätten müsste.
 */
const MAX_VERGROESSERUNG = 2.5;

/** Weltmeter je Texel einer Stufe. */
export const texelMeter = (stufe: number): number => KACHEL_MIN_METER * 2 ** stufe;
/** Kantenlänge einer Kachel der Stufe in Weltmetern. */
export const kachelMeter = (stufe: number): number => KACHEL_PX * texelMeter(stufe);

/**
 * Stufe für einen Maßstab (Weltmeter je Bildschirmpixel), oder `null`, wenn
 * das Gesamtbild genügt. Gewählt wird die gröbste Stufe, deren Texel höchstens
 * 1,5 Bildschirmpixel breit ist; mehr als 1,78-mal so viele Texel wie
 * Bildschirmpixel fallen dadurch nie an. Bei 4 m/px ergibt das 4 m je Texel.
 */
export function stufeFuer(massstab: number): number | null {
  const stufe = Math.max(0, Math.floor(Math.log2((1.5 * massstab) / KACHEL_MIN_METER)));
  return stufe > KACHEL_MAX_STUFE ? null : stufe;
}

export interface KachelAdresse {
  stufe: number;
  ix: number;
  iz: number;
}

export const kachelSchluessel = (a: KachelAdresse): string => `${a.stufe}:${a.ix}:${a.iz}`;

/** Weltkoordinate der oberen linken Ecke (kleinstes x und z) und Kantenlänge. */
export function kachelUrsprung(a: KachelAdresse): { x0: number; z0: number; meter: number } {
  const meter = kachelMeter(a.stufe);
  return { x0: a.ix * meter, z0: a.iz * meter, meter };
}

/** Sichtfenster der Karte in Bildschirmpixeln; `mitte*` in Weltmetern. */
export interface Ansicht {
  mitteX: number;
  mitteZ: number;
  /** Weltmeter je Bildschirmpixel. */
  massstab: number;
  breite: number;
  hoehe: number;
}

/**
 * Kacheln einer Stufe, die das Sichtfenster samt Rand schneiden, die
 * mittigste zuerst (Abstand der Kachelmitte zur Bildmitte, bei Gleichstand
 * nach Adresse, damit die Reihenfolge stabil bleibt).
 */
export function sichtbareKacheln(
  a: Ansicht,
  stufe: number,
  randPx: number = KACHEL_PX / 2,
): KachelAdresse[] {
  const meter = kachelMeter(stufe);
  const halbX = (a.breite / 2 + randPx) * a.massstab;
  const halbZ = (a.hoehe / 2 + randPx) * a.massstab;
  const ix0 = Math.floor((a.mitteX - halbX) / meter);
  const ix1 = Math.floor((a.mitteX + halbX) / meter);
  const iz0 = Math.floor((a.mitteZ - halbZ) / meter);
  const iz1 = Math.floor((a.mitteZ + halbZ) / meter);
  const liste: { k: KachelAdresse; d: number }[] = [];
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const dx = (ix + 0.5) * meter - a.mitteX;
      const dz = (iz + 0.5) * meter - a.mitteZ;
      liste.push({ k: { stufe, ix, iz }, d: dx * dx + dz * dz });
    }
  }
  liste.sort((p, q) => p.d - q.d || p.k.iz - q.k.iz || p.k.ix - q.k.ix);
  return liste.map((e) => e.k);
}

/**
 * Zielrechteck einer Kachel im Bild. Die Kanten sind auf ganze Pixel
 * gerundet (links/oben abwärts, rechts/unten aufwärts): Nachbarkacheln
 * überlappen dadurch um höchstens ein Pixel, statt eine Haarlinie
 * durchscheinen zu lassen.
 */
export function kachelRechteck(
  a: Ansicht,
  k: KachelAdresse,
): { x: number; y: number; w: number; h: number } {
  const { x0, z0, meter } = kachelUrsprung(k);
  const px = (x0 - a.mitteX) / a.massstab + a.breite / 2;
  const py = (z0 - a.mitteZ) / a.massstab + a.hoehe / 2;
  const seite = meter / a.massstab;
  const x = Math.floor(px);
  const y = Math.floor(py);
  return { x, y, w: Math.ceil(px + seite) - x, h: Math.ceil(py + seite) - y };
}

/**
 * Einfärbung einer Weltprobe — dieselbe Logik wie im Offline-Werkzeug
 * `shared/test/geo-map.ts:86`, ergänzt um die Wald-Abdunklung, damit man auf
 * der Karte sieht, wo tatsächlich Wald steht und nicht nur, welches Biome.
 * Gemeinsam genutzt vom Gesamtbild und von den Kacheln.
 */
export function farbe(biome: Biome, hoehe: number, wald: number, out: Uint8Array, o: number): void {
  if (biome === Biome.Ocean || hoehe < WATER_LEVEL) {
    // Wassertiefe: 5 m unter dem Pegel ist Ufer, ab 30 m offene See.
    const tiefe = Math.min(Math.max((WATER_LEVEL - hoehe) / 25, 0), 1);
    out[o] = SHORE_WATER[0] + (DEEP_WATER[0] - SHORE_WATER[0]) * tiefe;
    out[o + 1] = SHORE_WATER[1] + (DEEP_WATER[1] - SHORE_WATER[1]) * tiefe;
    out[o + 2] = SHORE_WATER[2] + (DEEP_WATER[2] - SHORE_WATER[2]) * tiefe;
    return;
  }
  const basis: RGB = BIOME_COLOR[biome] ?? BIOME_COLOR[Biome.None];
  // Höhenschattierung: flaches Land dunkler, Gipfel heller.
  const f = 0.74 + 0.26 * Math.min(Math.max((hoehe - WATER_LEVEL) / 110, -0.5), 1);
  // Wald verdunkelt und entsättigt leicht — je dichter, desto kräftiger.
  const w = 1 - 0.28 * wald;
  out[o] = Math.min(255, basis[0] * f * w);
  out[o + 1] = Math.min(255, basis[1] * f * (1 - 0.18 * wald));
  out[o + 2] = Math.min(255, basis[2] * f * w);
}

/**
 * Eine Kachel rechnen: je Texel eine Probe in der Texelmitte, dieselben drei
 * Geo-Aufrufe und dieselbe Farbregel wie beim Gesamtbild — nur ohne
 * Zwischenraster und ohne Aufblasen. Flüsse brauchen keine eigene Scheibe:
 * im Layout-Modus stehen sie im Höhenfeld (`riverPointMap` ist dort leer) und
 * sind bei 4 m Texelweite sichtbar.
 */
export function rendereKachel(geo: IGeo, a: KachelAdresse, out?: Uint8Array): Uint8Array {
  const data = out ?? new Uint8Array(KACHEL_BYTES);
  const s = texelMeter(a.stufe);
  const { x0, z0 } = kachelUrsprung(a);
  for (let j = 0; j < KACHEL_PX; j++) {
    const wz = z0 + (j + 0.5) * s;
    for (let i = 0; i < KACHEL_PX; i++) {
      const wx = x0 + (i + 0.5) * s;
      const biome = geo.getBiome(wx, wz);
      const h = geo.getBiomeHeight(biome, wx, wz).height;
      const wald = forestDensity(geo.getForestFactor(wx, wz));
      const o = (j * KACHEL_PX + i) * 4;
      farbe(biome, h, h >= WATER_LEVEL ? wald : 0, data, o);
      data[o + 3] = 255;
    }
  }
  return data;
}

// ── Zwischenspeicher ─────────────────────────────────────────────────

export interface KachelEintrag<B> {
  adresse: KachelAdresse;
  /** Welt-Generation, aus der die Kachel gerechnet wurde. */
  gen: number;
  bild: B;
  bytes: number;
  /** Letzte Benutzung (Zeichnen oder Einlagern), für die Verdrängung. */
  stempel: number;
}

/**
 * Zwischenspeicher mit fester Obergrenze in Bytes. Verdrängt wird die am
 * längsten unbenutzte Kachel; das gerade eingelagerte Bild bleibt.
 * `schliesse` gibt das Bild frei (bei `ImageBitmap`: `close()`).
 */
export class KachelSpeicher<B> {
  private readonly karte = new Map<string, KachelEintrag<B>>();
  private summe = 0;
  private uhr = 0;
  /** Zahl der freigegebenen Bilder — Zeuge, dass nichts liegen bleibt. */
  freigegeben = 0;

  constructor(
    readonly maxBytes: number,
    private readonly schliesse?: (bild: B) => void,
  ) {}

  get bytes(): number {
    return this.summe;
  }
  get groesse(): number {
    return this.karte.size;
  }
  get(schluessel: string): KachelEintrag<B> | undefined {
    return this.karte.get(schluessel);
  }
  alle(): IterableIterator<KachelEintrag<B>> {
    return this.karte.values();
  }
  /** Als benutzt vermerken. */
  beruehre(e: KachelEintrag<B>): void {
    e.stempel = ++this.uhr;
  }
  setze(adresse: KachelAdresse, gen: number, bild: B, bytes: number = KACHEL_BYTES): void {
    const k = kachelSchluessel(adresse);
    this.entferne(k);
    this.karte.set(k, { adresse, gen, bild, bytes, stempel: ++this.uhr });
    this.summe += bytes;
    while (this.summe > this.maxBytes && this.karte.size > 1) {
      let aelteste: string | null = null;
      let stempel = Infinity;
      for (const [key, e] of this.karte) {
        if (key !== k && e.stempel < stempel) {
          stempel = e.stempel;
          aelteste = key;
        }
      }
      if (aelteste === null) break;
      this.entferne(aelteste);
    }
  }
  entferne(schluessel: string): void {
    const e = this.karte.get(schluessel);
    if (!e) return;
    this.karte.delete(schluessel);
    this.summe -= e.bytes;
    this.freigegeben++;
    this.schliesse?.(e.bild);
  }
  leeren(): void {
    for (const k of [...this.karte.keys()]) this.entferne(k);
  }
}

// ── Dienst: Aufträge an Worker verteilen ─────────────────────────────

/** Was der Dienst von einem Worker braucht (im Editor ein umhüllter `Worker`). */
export interface KachelWorker {
  post(m: MapTileInit | MapTileRequest): void;
  terminate(): void;
  /** Der Dienst setzt hier seinen Empfänger ein. */
  onNachricht: ((m: MapWorkerMessage) => void) | null;
}

export interface KachelDienstOptionen<B> {
  /** Zahl der Worker; jeder rechnet eine Kachel zur Zeit. */
  anzahl: number;
  erzeuge: (index: number) => KachelWorker;
  /** RGBA-Daten einer Kachel in ein zeichenbares Bild verwandeln. */
  bild: (rgba: Uint8Array) => Promise<B> | B;
  schliesse?: (bild: B) => void;
  maxBytes?: number;
  /** Eine Kachel ist eingetroffen: die Karte neu zeichnen. */
  aufNeu?: () => void;
  jetzt?: () => number;
}

export interface KachelStatistik {
  kacheln: number;
  bytes: number;
  maxBytes: number;
  freigegeben: number;
  /** Aufträge an Worker gesendet / beantwortet. */
  gesendet: number;
  fertig: number;
  /** Antworten einer älteren Welt-Generation (verworfen, nicht eingelagert). */
  veraltet: number;
  /** Eingetroffene Kacheln, die zum Ankunftszeitpunkt nicht mehr gesucht waren. */
  ungesucht: number;
  /** Fehlende Kacheln der aktuellen Ansicht (gesucht, noch nicht da). */
  offen: number;
  /** Dauer der letzten Nachrechnung bis alles Gesuchte da war (ms), null solange sie läuft. */
  letzteScharfMs: number | null;
  /** Dauer jedes abgeschlossenen Nachrechnens (die letzten 100). */
  zyklen: number[];
}

/**
 * Verteilt Kachelaufträge und hält den Zwischenspeicher.
 *
 * Reihenfolge und Verwerfen: Es gibt keine Warteschlange, die veralten
 * könnte. Jeder freie Worker bekommt die mittigste noch fehlende Kachel der
 * AKTUELLEN Ansicht; was durch Verschieben aus dem Bild gerutscht ist, wird
 * nie gesendet. Höchstens ein Auftrag je Worker ist unterwegs (eine Kachel
 * rechnet rund 0,1 s), also blockiert nichts und kein Rückstau entsteht.
 *
 * Welt-Generation: nach einer Änderung des Dokuments (`neueWelt`) bleiben
 * die alten Kacheln zum Zeichnen erhalten, bis eine neue an ihre Stelle
 * tritt; Antworten mit älterer Generation werden verworfen.
 */
export class KachelDienst<B> {
  private readonly speicher: KachelSpeicher<B>;
  private readonly worker: KachelWorker[] = [];
  /** Auftrag je Worker (Index), solange er rechnet. */
  private readonly belegt = new Map<number, string>();
  /** Kacheln (mit Generation) in Rechnung oder Umwandlung: nicht doppelt anfordern. */
  private readonly unterwegs = new Set<string>();
  private gen = 0;
  private hatWelt = false;
  private ansicht: Ansicht | null = null;
  private nextId = 1;
  private zyklusStart: number | null = null;
  private readonly jetzt: () => number;
  private readonly st = { gesendet: 0, fertig: 0, veraltet: 0, ungesucht: 0 };
  private letzteScharfMs: number | null = null;
  private zyklen: number[] = [];

  constructor(private readonly opt: KachelDienstOptionen<B>) {
    this.speicher = new KachelSpeicher<B>(opt.maxBytes ?? KACHEL_SPEICHER_BYTES, opt.schliesse);
    this.jetzt = opt.jetzt ?? (() => performance.now());
  }

  /** Neue oder geänderte Welt: jeder Worker baut die Geo neu, dann wird nachgerechnet. */
  neueWelt(gen: number, seed: string, layout: unknown): void {
    this.gen = gen;
    this.hatWelt = true;
    this.zyklusStart = null;
    while (this.worker.length < this.opt.anzahl) this.starteWorker();
    for (const w of this.worker) w.post({ op: 'kachel-init', gen, seed, layout });
    this.planen();
  }

  /** Keine Welt (leeres Dokument): nichts mehr rechnen, Zwischenspeicher leeren. */
  keineWelt(): void {
    this.hatWelt = false;
    this.gen++;
    this.unterwegs.clear();
    this.speicher.leeren();
  }

  setzeAnsicht(a: Ansicht): void {
    this.ansicht = a;
    this.planen();
  }

  /** Alle Worker beenden (Editor schließt). */
  beende(): void {
    for (const w of this.worker) {
      w.onNachricht = null;
      w.terminate();
    }
    this.worker.length = 0;
    this.belegt.clear();
    this.unterwegs.clear();
    this.speicher.leeren();
  }

  /**
   * Fertige Kacheln in die Ansicht zeichnen, gröbste zuerst, damit die
   * feinste obenauf liegt. Sehr viel feinere Kacheln als der Maßstab
   * verlangt (mehr als zweifach verkleinert) bleiben weg: sie flimmern und
   * das Gesamtbild darunter ist dort ruhiger.
   */
  zeichne(
    ctx: { imageSmoothingEnabled: boolean; drawImage(bild: B, x: number, y: number, w: number, h: number): void },
    a: Ansicht,
  ): void {
    const hier: KachelEintrag<B>[] = [];
    for (const e of this.speicher.alle()) {
      if (texelMeter(e.adresse.stufe) * 2 < a.massstab) continue;
      const r = kachelRechteck(a, e.adresse);
      if (r.w / KACHEL_PX > MAX_VERGROESSERUNG) continue;
      if (r.x >= a.breite || r.y >= a.hoehe || r.x + r.w <= 0 || r.y + r.h <= 0) continue;
      hier.push(e);
    }
    // Sind alle Kacheln der gesuchten Stufe im Bild da, sind die gröberen Ersatzkacheln darunter verdeckt:
    // sie wegzulassen spart jeden Bildaufbau die Zeichenarbeit von zwei bis drei Lagen.
    const stufe = stufeFuer(a.massstab);
    if (stufe !== null && sichtbareKacheln(a, stufe, 0).every((k) => this.speicher.get(kachelSchluessel(k)))) {
      for (let i = hier.length - 1; i >= 0; i--) if (hier[i].adresse.stufe !== stufe) hier.splice(i, 1);
    }
    hier.sort((p, q) => q.adresse.stufe - p.adresse.stufe);
    for (const e of hier) {
      this.speicher.beruehre(e);
      const r = kachelRechteck(a, e.adresse);
      // Ungeglättet: ein Texel liegt ungefähr auf einem Pixel. Die bilineare Glättung kostet im
      // Software-Canvas je Kachel und Bild Zeit (gemessen: beim Ziehen während des Nachrechnens
      // Bildzeit p95 67 statt 33 ms, 18 statt 3 Bilder über 50 ms).
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(e.bild, r.x, r.y, r.w, r.h);
    }
    ctx.imageSmoothingEnabled = true;
  }

  statistik(): KachelStatistik {
    return {
      kacheln: this.speicher.groesse,
      bytes: this.speicher.bytes,
      maxBytes: this.speicher.maxBytes,
      freigegeben: this.speicher.freigegeben,
      gesendet: this.st.gesendet,
      fertig: this.st.fertig,
      veraltet: this.st.veraltet,
      ungesucht: this.st.ungesucht,
      offen: this.gesucht().length + this.laufende(),
      letzteScharfMs: this.letzteScharfMs,
      zyklen: [...this.zyklen],
    };
  }

  /** Die Kacheln der gewünschten Ansicht, die noch fehlen — mittigste zuerst. */
  gesucht(): KachelAdresse[] {
    const a = this.ansicht;
    if (!a || !this.hatWelt) return [];
    const stufe = stufeFuer(a.massstab);
    if (stufe === null) return [];
    // Höchstens drei Viertel des Speichers für die gesuchte Stufe, der Rest
    // bleibt für gröbere Ersatzkacheln beim Zoomen.
    const limit = Math.floor((this.speicher.maxBytes / KACHEL_BYTES) * 0.75);
    return sichtbareKacheln(a, stufe)
      .slice(0, limit)
      .filter((k) => {
        const s = kachelSchluessel(k);
        if (this.unterwegs.has(`${this.gen}|${s}`)) return false;
        const e = this.speicher.get(s);
        return !(e && e.gen === this.gen);
      });
  }

  /** Kacheln der aktuellen Generation in Rechnung oder Umwandlung. */
  private laufende(): number {
    let n = 0;
    for (const marke of this.unterwegs) if (marke.startsWith(`${this.gen}|`)) n++;
    return n;
  }

  private starteWorker(): void {
    const index = this.worker.length;
    const w = this.opt.erzeuge(index);
    w.onNachricht = (m) => this.beiNachricht(index, m);
    this.worker.push(w);
  }

  private planen(): void {
    if (!this.hatWelt || !this.ansicht) return;
    for (let index = 0; index < this.worker.length; index++) {
      if (this.belegt.has(index)) continue;
      const k = this.gesucht()[0];
      if (!k) break;
      if (this.zyklusStart === null) this.zyklusStart = this.jetzt();
      const id = this.nextId++;
      const s = kachelSchluessel(k);
      this.belegt.set(index, `${this.gen}|${s}`);
      this.unterwegs.add(`${this.gen}|${s}`);
      this.st.gesendet++;
      this.worker[index].post({ op: 'kachel', gen: this.gen, id, stufe: k.stufe, ix: k.ix, iz: k.iz });
    }
    this.pruefeScharf();
  }

  private pruefeScharf(): void {
    if (this.zyklusStart === null || !this.hatWelt) return;
    if (this.belegt.size > 0 || this.unterwegs.size > 0 || this.gesucht().length > 0) return;
    const ms = this.jetzt() - this.zyklusStart;
    this.zyklusStart = null;
    this.letzteScharfMs = ms;
    this.zyklen.push(ms);
    if (this.zyklen.length > 100) this.zyklen.shift();
  }

  private beiNachricht(index: number, m: MapWorkerMessage): void {
    if (m.t === 'kachel-leer') {
      this.gebeFrei(index);
      this.planen();
      return;
    }
    if (m.t !== 'kachel') return;
    const s = kachelSchluessel(m);
    const marke = `${m.gen}|${s}`;
    this.gebeFrei(index);
    if (m.gen !== this.gen) {
      this.st.veraltet++;
      this.unterwegs.delete(marke);
      this.planen();
      return;
    }
    this.st.fertig++;
    if (!this.istGesucht(m)) this.st.ungesucht++;
    // Den Worker sofort wieder füttern; die Umwandlung läuft nebenher.
    this.planen();
    void Promise.resolve(this.opt.bild(m.data)).then((bild) => {
      this.unterwegs.delete(marke);
      if (m.gen !== this.gen) {
        this.opt.schliesse?.(bild);
        this.planen();
        return;
      }
      this.speicher.setze({ stufe: m.stufe, ix: m.ix, iz: m.iz }, m.gen, bild);
      this.opt.aufNeu?.();
      this.planen();
    });
  }

  private gebeFrei(index: number): void {
    this.belegt.delete(index);
  }

  private istGesucht(k: KachelAdresse): boolean {
    const a = this.ansicht;
    if (!a) return false;
    const stufe = stufeFuer(a.massstab);
    if (stufe !== k.stufe) return false;
    return sichtbareKacheln(a, stufe).some((v) => v.ix === k.ix && v.iz === k.iz);
  }
}
