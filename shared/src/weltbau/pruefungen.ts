/**
 * pruefungen.ts — die Weltprüfung (world_check): sechs Prüfungen über ein
 * WorldLayout-Dokument und die Höhenfunktion seiner Geo.
 *
 *   ueberlappung  feste Grundflächen überlappen (Trennachsen/Schnittfläche)
 *   wasser        Objekt steht im Wasser (Höhe < WATER_LEVEL)
 *   hang          Objekt steht am zu steilen Hang bzw. Gebäude auf zu großer Höhenspanne
 *   eingang       Haus ohne erreichbaren Eingang (Flutfüllung auf dem Begehbarkeitsraster)
 *   route         Route läuft durch feste Körper, Wasser oder zu steile Stücke
 *   budget        zu viele Platzierungen in einer 64-m-Zone
 *
 * Reine Funktion: kein DOM, kein Zufall, keine Datei, kein Netz. Die Geo kommt
 * als `HoehenFeld` herein (`getHeight`), die Hüllen als `HuellenAufloeser`;
 * beides lässt sich im Test durch feste Attrappen ersetzen. Schwellen:
 * `grenzen.ts` (Annahmen, von Mike zu bestätigen).
 *
 * The world check: six checks over a WorldLayout and its height function.
 * Pure and deterministic; the geo and the footprints are injected.
 */
import type { PlacementDef, RouteDef, WorldLayout } from '../worldlayout/types.js';
import { WATER_LEVEL } from '../worldgen/Heightmap.js';
import { ZONE_SIZE } from '../constants.js';
import { KOERPER_RADIUS, STEIGUNGS_GRENZE_GRAD, STUFEN_HOEHE } from '../bewegung/masse.js';
import {
  BEFUNDE_MAX,
  BEREICH_MAX_KANTE,
  EINGANG_ABSTAND,
  EINGANG_RASTER,
  FRIST_MS,
  GEBAEUDE_SPANNE_GELB,
  GEBAEUDE_SPANNE_ROT,
  HANG_GRAD_GELB,
  HANG_GRAD_ROT,
  ROUTEN_MAX,
  ROUTEN_PROBEN_MAX,
  UEBERLAPPUNG_GELB,
  UEBERLAPPUNG_ROT,
  ZONE_OBJEKTE_GELB,
  ZONE_OBJEKTE_ROT,
} from './grenzen.js';
import {
  abstandZuPolygon,
  drehe,
  eckenMitte,
  huelleVon,
  polygonFlaeche,
  rechteck,
  schneide,
  type Polygon,
} from './flaeche.js';
import { WASSERBAU_NAMEN, huellenAufloeser, istHaus, type Huelle, type HuellenAufloeser } from './huelle.js';
import { EINGAENGE, type EingangsTabelle } from './eingaenge.js';

export type Bereich =
  | { x: number; z: number; radius: number }
  | { minX: number; minZ: number; maxX: number; maxZ: number };

export interface Kasten {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Ein Bereich, den ein Werkzeug ablehnen muss (zu groß, ungültig). */
export class BereichFehler extends Error {}

export interface HoehenFeld {
  getHeight(x: number, z: number): number;
}

export type PruefArt = 'ueberlappung' | 'wasser' | 'hang' | 'eingang' | 'route' | 'budget';
export const ALLE_PRUEFUNGEN: readonly PruefArt[] = ['ueberlappung', 'wasser', 'hang', 'eingang', 'route', 'budget'];

export interface Schwellen {
  hangGradGelb: number;
  hangGradRot: number;
  spanneGelb: number;
  spanneRot: number;
  zoneObjekteGelb: number;
  zoneObjekteRot: number;
}

export interface Befund {
  pruefung: PruefArt | 'huelle' | 'frist';
  schwere: 'rot' | 'gelb' | 'hinweis';
  x: number;
  z: number;
  ids: string[];
  text: string;
  wert?: number;
  grenze?: number;
  huelleQuelle?: string;
}

export interface CheckOptionen {
  pruefungen?: readonly PruefArt[];
  grenzen?: Partial<Schwellen>;
  /** Startpunkt der Wegsuche für „Haus ohne Eingang“. */
  von?: readonly [number, number];
  huellen?: HuellenAufloeser;
  eingaenge?: EingangsTabelle;
  /** Gesamtfrist in ms (Vorgabe 15 000). Danach bricht die laufende Prüfung ab und die übrigen werden übersprungen. */
  frist?: number;
  /** Zeitquelle in ms (Vorgabe `performance.now`); für Tests austauschbar. */
  uhr?: () => number;
}

/** Wie weit eine Prüfung gekommen ist — nie still weniger prüfen. */
export interface PruefStatus {
  status: 'vollstaendig' | 'abgebrochen' | 'uebersprungen';
  /** Geprüfte Einheiten (Objekte, Routen, Rasterzellen …) und ihre Gesamtzahl. */
  geprueft: number;
  gesamt: number;
  einheit: string;
  grund?: string;
}

/** Frist über eine austauschbare Uhr; einmal abgelaufen, bleibt sie es. */
class Uhr {
  private abgelaufenFlag = false;
  constructor(
    private readonly jetzt: () => number,
    private readonly start: number,
    readonly fristMs: number
  ) {}
  abgelaufen(): boolean {
    if (!this.abgelaufenFlag && this.jetzt() - this.start > this.fristMs) this.abgelaufenFlag = true;
    return this.abgelaufenFlag;
  }
  vergangen(): number {
    return this.jetzt() - this.start;
  }
}

export interface CheckErgebnis {
  ampel: 'gruen' | 'gelb' | 'rot';
  zaehler: { rot: number; gelb: number; hinweis: number };
  /** Platzierungen im Bereich. */
  objekte: number;
  befunde: Befund[];
  /** Wie viele Befunde wegen der Ausgabegrenze fehlen. */
  ausgelassen: number;
  /** Prefab-Namen ohne Hülle (nicht prüfbar). */
  nichtPruefbar: string[];
  /** Dauer der Prüfung in ms. */
  ms: number;
  /** Frist dieser Prüfung in ms. */
  frist: number;
  /** true, wenn mindestens eine Prüfung abgebrochen oder übersprungen wurde: ein TEILBERICHT. */
  teilweise: boolean;
  /** Stand je gewählter Prüfung. */
  pruefstatus: Partial<Record<PruefArt, PruefStatus>>;
  /** Klartext für den Teilbericht (sonst nicht gesetzt). */
  hinweis?: string;
}

export function schwellenVorgabe(): Schwellen {
  return {
    hangGradGelb: HANG_GRAD_GELB,
    hangGradRot: HANG_GRAD_ROT,
    spanneGelb: GEBAEUDE_SPANNE_GELB,
    spanneRot: GEBAEUDE_SPANNE_ROT,
    zoneObjekteGelb: ZONE_OBJEKTE_GELB,
    zoneObjekteRot: ZONE_OBJEKTE_ROT,
  };
}

export interface Bereichsform {
  kasten: Kasten;
  /** Bei einem Kreis: Mitte und Radius. */
  kreis?: { x: number; z: number; radius: number };
}

/** Prüft Form und Größe (Kante höchstens `max`, Vorgabe 512 m) und liefert Kasten und ggf. Kreis. */
export function normalisiereBereich(b: Bereich, max: number = BEREICH_MAX_KANTE): Bereichsform {
  const zahlen = Object.values(b as unknown as Record<string, unknown>);
  if (zahlen.length === 0 || zahlen.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new BereichFehler('Bereich ungültig: alle Werte müssen endliche Zahlen sein.');
  }
  let form: Bereichsform;
  if ('radius' in b) {
    if (!(b.radius > 0)) throw new BereichFehler('Bereich ungültig: radius muss größer als 0 sein.');
    form = {
      kasten: { minX: b.x - b.radius, minZ: b.z - b.radius, maxX: b.x + b.radius, maxZ: b.z + b.radius },
      kreis: { x: b.x, z: b.z, radius: b.radius },
    };
  } else {
    if (!(b.maxX > b.minX) || !(b.maxZ > b.minZ)) {
      throw new BereichFehler('Bereich ungültig: max muss größer als min sein.');
    }
    form = { kasten: { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ } };
  }
  const k = form.kasten;
  const kante = Math.max(k.maxX - k.minX, k.maxZ - k.minZ);
  if (kante > max) {
    throw new BereichFehler(`Bereich zu groß: Kante ${Math.round(kante)} m, zulässig höchstens ${max} m.`);
  }
  return form;
}

export function imBereich(f: Bereichsform, x: number, z: number): boolean {
  if (f.kreis) return Math.hypot(x - f.kreis.x, z - f.kreis.z) <= f.kreis.radius;
  const k = f.kasten;
  return x >= k.minX && x <= k.maxX && z >= k.minZ && z <= k.maxZ;
}

/** Objekte in diesem Abstand außerhalb des Bereichs zählen als Gegenüber (Überlappung, Sperre). */
const RAND = 32;

interface Objekt {
  id: string;
  p: PlacementDef;
  x: number;
  z: number;
  skala: number;
  innen: boolean;
  huelle: Huelle | null;
  flaeche: Polygon | null;
  boden: number;
}

const rund = (n: number): number => Math.round(n * 100) / 100;
const grad = (rad: number): number => (rad * 180) / Math.PI;

function objekteVorbereiten(
  layout: WorldLayout,
  form: Bereichsform,
  geo: HoehenFeld,
  huellen: HuellenAufloeser
): Objekt[] {
  const k = form.kasten;
  const aus: Objekt[] = [];
  for (const p of layout.placements ?? []) {
    if (p.x < k.minX - RAND || p.x > k.maxX + RAND || p.z < k.minZ - RAND || p.z > k.maxZ + RAND) continue;
    const skala = p.scale ?? 1;
    const huelle = huellen(p.prefab);
    const flaeche = huelle
      ? rechteck(p.x, p.z, p.yaw ?? 0, huelle.mitteX * skala, huelle.mitteZ * skala, huelle.halbX * skala, huelle.halbZ * skala)
      : null;
    aus.push({
      id: p.id ?? `${p.prefab}@${Math.round(p.x)},${Math.round(p.z)}`,
      p,
      x: p.x,
      z: p.z,
      skala,
      innen: imBereich(form, p.x, p.z),
      huelle,
      flaeche,
      boden: geo.getHeight(p.x, p.z),
    });
  }
  return aus;
}

function statusVon(geprueft: number, gesamt: number, einheit: string): PruefStatus {
  const voll = geprueft >= gesamt;
  return { status: voll ? 'vollstaendig' : 'abgebrochen', geprueft, gesamt, einheit, grund: voll ? undefined : 'Frist abgelaufen' };
}

// ── P1: überlappende feste Grundflächen ────────────────────────────────────

const ZELLE = 16;

function ueberlappungen(objekte: readonly Objekt[], befunde: Befund[], u: Uhr): PruefStatus {
  const fest = objekte.filter((o) => o.huelle?.fest === true && o.flaeche !== null);
  const zellen = new Map<string, number[]>();
  fest.forEach((o, i) => {
    const [a, b, c, d] = huelleVon(o.flaeche as Polygon);
    for (let cx = Math.floor(a / ZELLE); cx <= Math.floor(c / ZELLE); cx++) {
      for (let cz = Math.floor(b / ZELLE); cz <= Math.floor(d / ZELLE); cz++) {
        const key = `${cx},${cz}`;
        const l = zellen.get(key);
        if (l) l.push(i);
        else zellen.set(key, [i]);
      }
    }
  });
  const gesehen = new Set<string>();
  let zellenGeprueft = 0;
  for (const liste of zellen.values()) {
    if (u.abgelaufen()) break;
    zellenGeprueft++;
    for (let a = 0; a < liste.length; a++) {
      for (let b = a + 1; b < liste.length; b++) {
        const i = Math.min(liste[a], liste[b]);
        const j = Math.max(liste[a], liste[b]);
        const key = `${i}|${j}`;
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        const A = fest[i];
        const B = fest[j];
        if (!A.innen && !B.innen) continue;
        const ha = A.huelle as Huelle;
        const hb = B.huelle as Huelle;
        const a0 = A.boden + ha.minY * A.skala;
        const a1 = A.boden + ha.maxY * A.skala;
        const b0 = B.boden + hb.minY * B.skala;
        const b1 = B.boden + hb.maxY * B.skala;
        if (Math.min(a1, b1) - Math.max(a0, b0) <= 0) continue;
        const schnitt = schneide(A.flaeche as Polygon, B.flaeche as Polygon);
        if (schnitt.length < 3) continue;
        const kleiner = Math.min(polygonFlaeche(A.flaeche as Polygon), polygonFlaeche(B.flaeche as Polygon));
        if (kleiner <= 0) continue;
        const anteil = polygonFlaeche(schnitt) / kleiner;
        if (anteil < UEBERLAPPUNG_GELB) continue;
        const beideBausatz = ha.gebaeude && hb.gebaeude;
        const schwere = anteil >= UEBERLAPPUNG_ROT && !beideBausatz ? 'rot' : 'gelb';
        const mitte = eckenMitte(schnitt);
        befunde.push({
          pruefung: 'ueberlappung',
          schwere,
          x: rund(mitte.x),
          z: rund(mitte.z),
          ids: [A.id, B.id],
          text: `${A.p.prefab} und ${B.p.prefab} überlappen zu ${Math.round(anteil * 100)} % der kleineren Grundfläche`,
          wert: rund(anteil),
          grenze: schwere === 'rot' ? UEBERLAPPUNG_ROT : UEBERLAPPUNG_GELB,
          huelleQuelle: `${ha.quelle}+${hb.quelle}`,
        });
      }
    }
  }
  return {
    status: zellenGeprueft < zellen.size ? 'abgebrochen' : 'vollstaendig',
    geprueft: zellenGeprueft,
    gesamt: zellen.size,
    einheit: 'Rasterzellen (16 m)',
    grund: zellenGeprueft < zellen.size ? 'Frist abgelaufen' : undefined,
  };
}

// ── P2: Objekte im Wasser ──────────────────────────────────────────────────

function imWasser(objekte: readonly Objekt[], geo: HoehenFeld, befunde: Befund[], u: Uhr): PruefStatus {
  const gesamt = objekte.filter((o) => o.innen).length;
  let geprueft = 0;
  for (const o of objekte) {
    if (!o.innen) continue;
    if (u.abgelaufen()) break;
    geprueft++;
    const bau = WASSERBAU_NAMEN.test(o.p.prefab);
    if (o.boden < WATER_LEVEL) {
      befunde.push({
        pruefung: 'wasser',
        schwere: bau ? 'hinweis' : 'rot',
        x: rund(o.x),
        z: rund(o.z),
        ids: [o.id],
        text: `${o.p.prefab} steht im Wasser (Boden ${rund(o.boden)} m, Wasserlinie ${WATER_LEVEL} m)`,
        wert: rund(o.boden),
        grenze: WATER_LEVEL,
      });
    } else if (o.flaeche) {
      const tief = o.flaeche.filter((e) => geo.getHeight(e.x, e.z) < WATER_LEVEL);
      if (tief.length > 0) {
        befunde.push({
          pruefung: 'wasser',
          schwere: bau ? 'hinweis' : 'gelb',
          x: rund(o.x),
          z: rund(o.z),
          ids: [o.id],
          text: `${o.p.prefab} steht am Ufer: ${tief.length} von 4 Ecken liegen unter der Wasserlinie`,
          wert: tief.length,
          grenze: WATER_LEVEL,
        });
      }
    }
  }
  return statusVon(geprueft, gesamt, 'Objekte');
}

// ── P3: Hangneigung ────────────────────────────────────────────────────────

function neigungGrad(geo: HoehenFeld, x: number, z: number): number {
  const dx = (geo.getHeight(x + 1, z) - geo.getHeight(x - 1, z)) / 2;
  const dz = (geo.getHeight(x, z + 1) - geo.getHeight(x, z - 1)) / 2;
  return grad(Math.atan(Math.hypot(dx, dz)));
}

function haenge(objekte: readonly Objekt[], geo: HoehenFeld, s: Schwellen, befunde: Befund[], u: Uhr): PruefStatus {
  const gesamt = objekte.filter((o) => o.innen).length;
  let geprueft = 0;
  for (const o of objekte) {
    if (!o.innen) continue;
    if (u.abgelaufen()) break;
    geprueft++;
    const n = neigungGrad(geo, o.x, o.z);
    if (n > s.hangGradGelb) {
      const rot = n > s.hangGradRot;
      befunde.push({
        pruefung: 'hang',
        schwere: rot ? 'rot' : 'gelb',
        x: rund(o.x),
        z: rund(o.z),
        ids: [o.id],
        text: `${o.p.prefab} steht an einem Hang von ${rund(n)}°`,
        wert: rund(n),
        grenze: rot ? s.hangGradRot : s.hangGradGelb,
      });
    }
    if (o.huelle && o.flaeche && istHaus(o.huelle, o.skala)) {
      const [a, b, c, d] = huelleVon(o.flaeche);
      let lo = Infinity;
      let hi = -Infinity;
      const N = 5;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const h = geo.getHeight(a + ((c - a) * i) / (N - 1), b + ((d - b) * j) / (N - 1));
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      const spanne = hi - lo;
      if (spanne > s.spanneGelb) {
        const rot = spanne > s.spanneRot;
        befunde.push({
          pruefung: 'hang',
          schwere: rot ? 'rot' : 'gelb',
          x: rund(o.x),
          z: rund(o.z),
          ids: [o.id],
          text: `${o.p.prefab}: das Gelände unter der Grundfläche schwankt um ${rund(spanne)} m`,
          wert: rund(spanne),
          grenze: rot ? s.spanneRot : s.spanneGelb,
        });
      }
    }
  }
  return statusVon(geprueft, gesamt, 'Objekte');
}

// ── P4: Haus ohne erreichbaren Eingang ─────────────────────────────────────

interface Raster {
  minX: number;
  minZ: number;
  zelle: number;
  w: number;
  h: number;
  begehbar: Uint8Array;
  hoehe: Float32Array;
}

function rasterBauen(form: Bereichsform, geo: HoehenFeld, festeObjekte: readonly Objekt[], u: Uhr): Raster | null {
  const k = form.kasten;
  const kante = Math.max(k.maxX - k.minX, k.maxZ - k.minZ);
  const zelle = Math.max(EINGANG_RASTER, kante / 1024);
  const w = Math.max(1, Math.ceil((k.maxX - k.minX) / zelle));
  const h = Math.max(1, Math.ceil((k.maxZ - k.minZ) / zelle));
  const hoehe = new Float32Array(w * h);
  const begehbar = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    if (u.abgelaufen()) return null;
    for (let i = 0; i < w; i++) {
      const hh = geo.getHeight(k.minX + (i + 0.5) * zelle, k.minZ + (j + 0.5) * zelle);
      hoehe[j * w + i] = hh;
      begehbar[j * w + i] = hh >= WATER_LEVEL ? 1 : 0;
    }
  }
  for (const o of festeObjekte) {
    if (!o.flaeche) continue;
    if (u.abgelaufen()) return null;
    const [a, b, c, d] = huelleVon(o.flaeche);
    const i0 = Math.max(0, Math.floor((a - KOERPER_RADIUS - k.minX) / zelle));
    const i1 = Math.min(w - 1, Math.floor((c + KOERPER_RADIUS - k.minX) / zelle));
    const j0 = Math.max(0, Math.floor((b - KOERPER_RADIUS - k.minZ) / zelle));
    const j1 = Math.min(h - 1, Math.floor((d + KOERPER_RADIUS - k.minZ) / zelle));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = { x: k.minX + (i + 0.5) * zelle, z: k.minZ + (j + 0.5) * zelle };
        if (abstandZuPolygon(p, o.flaeche) <= KOERPER_RADIUS) begehbar[j * w + i] = 0;
      }
    }
  }
  return { minX: k.minX, minZ: k.minZ, zelle, w, h, begehbar, hoehe };
}

const zelleVon = (r: Raster, x: number, z: number): number => {
  const i = Math.floor((x - r.minX) / r.zelle);
  const j = Math.floor((z - r.minZ) / r.zelle);
  return i < 0 || j < 0 || i >= r.w || j >= r.h ? -1 : j * r.w + i;
};

/** Flutfüllung (4er-Nachbarschaft) von `start`; Nachbarn nur bei begehbarem Höhensprung. */
function flute(r: Raster, start: number, erreicht: Int32Array, marke: number, u: Uhr): number {
  const maxSprung = Math.max(Math.tan((STEIGUNGS_GRENZE_GRAD * Math.PI) / 180) * r.zelle, STUFEN_HOEHE);
  const stapel = [start];
  erreicht[start] = marke;
  let n = 0;
  while (stapel.length > 0) {
    const c = stapel.pop() as number;
    n++;
    if ((n & 8191) === 0 && u.abgelaufen()) return n;
    const ci = c % r.w;
    const cj = (c - ci) / r.w;
    const nachbarn = [
      ci > 0 ? c - 1 : -1,
      ci < r.w - 1 ? c + 1 : -1,
      cj > 0 ? c - r.w : -1,
      cj < r.h - 1 ? c + r.w : -1,
    ];
    for (const nb of nachbarn) {
      if (nb < 0 || erreicht[nb] !== 0 || r.begehbar[nb] === 0) continue;
      if (Math.abs(r.hoehe[nb] - r.hoehe[c]) > maxSprung) continue;
      erreicht[nb] = marke;
      stapel.push(nb);
    }
  }
  return n;
}

function startzelle(
  r: Raster,
  layout: WorldLayout,
  form: Bereichsform,
  von: readonly [number, number] | undefined
): { start: number } | { fehler: string } {
  if (von) {
    const c = zelleVon(r, von[0], von[1]);
    if (c < 0) return { fehler: `von (${von[0]}, ${von[1]}) liegt außerhalb des Bereichs` };
    if (r.begehbar[c] === 0) return { fehler: `von (${von[0]}, ${von[1]}) liegt im Wasser oder in einem festen Körper` };
    return { start: c };
  }
  const kandidaten: Array<readonly [number, number]> = [];
  for (const route of layout.routes ?? []) {
    const p = route.points[0];
    if (p && imBereich(form, p[0], p[1])) kandidaten.push([p[0], p[1]]);
  }
  if (layout.defaultSpawn && imBereich(form, layout.defaultSpawn[0], layout.defaultSpawn[1])) {
    kandidaten.push(layout.defaultSpawn);
  }
  for (const [x, z] of kandidaten) {
    const c = zelleVon(r, x, z);
    if (c >= 0 && r.begehbar[c] === 1) return { start: c };
  }
  return { start: -1 };
}

/** `von` muss im Bereich liegen, trocken und außerhalb fester Körper — auch wenn kein Haus im Bereich steht. */
function pruefeVon(
  von: readonly [number, number],
  form: Bereichsform,
  geo: HoehenFeld,
  festeObjekte: readonly Objekt[]
): void {
  const [x, z] = von;
  const k = form.kasten;
  if (x < k.minX || x > k.maxX || z < k.minZ || z > k.maxZ) {
    throw new BereichFehler(`von (${x}, ${z}) liegt außerhalb des Bereichs`);
  }
  const inKoerper = festeObjekte.some((o) => o.flaeche !== null && abstandZuPolygon({ x, z }, o.flaeche) <= KOERPER_RADIUS);
  if (geo.getHeight(x, z) < WATER_LEVEL || inKoerper) {
    throw new BereichFehler(`von (${x}, ${z}) liegt im Wasser oder in einem festen Körper`);
  }
}

function eingaenge(
  objekte: readonly Objekt[],
  festeObjekte: readonly Objekt[],
  layout: WorldLayout,
  form: Bereichsform,
  geo: HoehenFeld,
  von: readonly [number, number] | undefined,
  tabelle: EingangsTabelle,
  befunde: Befund[],
  u: Uhr
): PruefStatus {
  if (von) pruefeVon(von, form, geo, festeObjekte);
  const haeuser = objekte.filter(
    (o) => o.innen && o.huelle !== null && o.flaeche !== null && (istHaus(o.huelle, o.skala) || tabelle.has(o.p.prefab))
  );
  if (haeuser.length === 0) return { status: 'vollstaendig', geprueft: 0, gesamt: 0, einheit: 'Häuser' };
  const abbruch = (grund: string): PruefStatus => ({
    status: 'abgebrochen',
    geprueft: 0,
    gesamt: haeuser.length,
    einheit: 'Häuser',
    grund,
  });
  const r = rasterBauen(form, geo, festeObjekte, u);
  if (r === null) return abbruch('Frist beim Bau des Begehbarkeitsrasters abgelaufen; keine Aussage über Eingänge');
  const erreicht = new Int32Array(r.w * r.h);
  const s = startzelle(r, layout, form, von);
  if ('fehler' in s) throw new BereichFehler(s.fehler);
  let ziel = 1;
  if (s.start >= 0) {
    flute(r, s.start, erreicht, 1, u);
  } else {
    // Kein Startpunkt im Bereich: die größte zusammenhängende begehbare Fläche.
    let bestGroesse = 0;
    let marke = 0;
    ziel = 0;
    for (let c = 0; c < r.w * r.h; c++) {
      if (erreicht[c] !== 0 || r.begehbar[c] === 0) continue;
      marke++;
      if (u.abgelaufen()) break;
      const n = flute(r, c, erreicht, marke, u);
      if (n > bestGroesse) {
        bestGroesse = n;
        ziel = marke;
      }
    }
  }
  if (u.abgelaufen()) return abbruch('Frist bei der Wegsuche abgelaufen; keine Aussage über Eingänge (kein Teilurteil, das wäre falsch rot)');
  const istErreicht = (x: number, z: number): boolean | null => {
    const c = zelleVon(r, x, z);
    return c < 0 ? null : ziel !== 0 && erreicht[c] === ziel;
  };
  for (const o of haeuser) {
    const h = o.huelle as Huelle;
    const yaw = o.p.yaw ?? 0;
    const eintraege = tabelle.get(o.p.prefab);
    let punkte: Array<{ x: number; z: number }>;
    if (eintraege && eintraege.length > 0) {
      punkte = eintraege.map((e) => {
        const d = drehe(e.x * o.skala, e.z * o.skala, yaw);
        return { x: o.x + d.x, z: o.z + d.z };
      });
    } else {
      const m = drehe(h.mitteX * o.skala, h.mitteZ * o.skala, yaw);
      const cx = o.x + m.x;
      const cz = o.z + m.z;
      const u = drehe(1, 0, yaw);
      const v = drehe(0, 1, yaw);
      const dx = h.halbX * o.skala + EINGANG_ABSTAND;
      const dz = h.halbZ * o.skala + EINGANG_ABSTAND;
      punkte = [
        { x: cx + u.x * dx, z: cz + u.z * dx },
        { x: cx - u.x * dx, z: cz - u.z * dx },
        { x: cx + v.x * dz, z: cz + v.z * dz },
        { x: cx - v.x * dz, z: cz - v.z * dz },
      ];
    }
    const urteile = punkte.map((p) => istErreicht(p.x, p.z)).filter((u): u is boolean => u !== null);
    if (urteile.length === 0) continue;
    const geschaetzt = !(eintraege && eintraege.length > 0);
    if (urteile.some((u) => u)) {
      if (geschaetzt) {
        befunde.push({
          pruefung: 'eingang',
          schwere: 'gelb',
          x: rund(o.x),
          z: rund(o.z),
          ids: [o.id],
          text: `${o.p.prefab}: Eingang geschätzt (keine Türangabe im Katalog); eine Seite ist erreichbar`,
          huelleQuelle: h.quelle,
        });
      }
    } else {
      befunde.push({
        pruefung: 'eingang',
        schwere: 'rot',
        x: rund(o.x),
        z: rund(o.z),
        ids: [o.id],
        text: `${o.p.prefab}: kein Eingang erreichbar (${geschaetzt ? 'alle vier Seiten' : 'alle Türen'} zugestellt, im Wasser oder zu steil)`,
        huelleQuelle: h.quelle,
      });
    }
  }
  return { status: 'vollstaendig', geprueft: haeuser.length, gesamt: haeuser.length, einheit: 'Häuser' };
}

// ── P5: Routen ─────────────────────────────────────────────────────────────

/** Der Teil der Strecke a→b im Kasten als Parameterbereich [t0, t1] (Liang–Barsky), sonst null. */
function klemmeStrecke(a: { x: number; z: number }, b: { x: number; z: number }, k: Kasten): readonly [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [pk, q] of [[-dx, a.x - k.minX], [dx, k.maxX - a.x], [-dz, a.z - k.minZ], [dz, k.maxZ - a.z]] as const) {
    if (pk === 0) {
      if (q < 0) return null;
    } else {
      const r = q / pk;
      if (pk < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
  }
  return t0 > t1 ? null : [t0, t1];
}

function streckenVon(route: RouteDef): Array<readonly [{ x: number; z: number }, { x: number; z: number }]> {
  const pts = route.points.map((p) => ({ x: p[0], z: p[1] }));
  const aus = pts.slice(0, -1).map((p, i) => [p, pts[i + 1]] as const);
  if (route.mode === 'loop' && pts.length > 2) aus.push([pts[pts.length - 1], pts[0]]);
  if (pts.length === 1) aus.push([pts[0], pts[0]]);
  return aus;
}

const ROUTEN_SCHRITT = 0.25;
const ROUTEN_LAUFEN_MAX = 20;

function routen(
  layout: WorldLayout,
  form: Bereichsform,
  festeObjekte: readonly Objekt[],
  geo: HoehenFeld,
  befunde: Befund[],
  u: Uhr
): PruefStatus {
  const k = form.kasten;
  const steilTan = Math.tan((STEIGUNGS_GRENZE_GRAD * Math.PI) / 180);
  // Eine Route zählt, wenn IRGENDEINE ihrer Strecken den Bereich schneidet (nicht nur ihre Endpunkte).
  const inDerNaehe = (route: RouteDef): boolean => streckenVon(route).some(([a, b]) => klemmeStrecke(a, b, k) !== null);
  const relevant = (layout.routes ?? ([] as readonly RouteDef[])).filter(inDerNaehe);
  let geprueft = 0;
  let proben = 0;
  let abbruchGrund: string | undefined;
  for (const route of relevant) {
    if (geprueft >= ROUTEN_MAX) {
      abbruchGrund = `Kappe: höchstens ${ROUTEN_MAX} Routen je Aufruf`;
      break;
    }
    if (u.abgelaufen()) {
      abbruchGrund = 'Frist abgelaufen';
      break;
    }
    const strecken = streckenVon(route);
    const eigene = (o: Objekt): boolean => o.p.route === route.id;
    const getroffen = new Set<string>();
    let laeufe = 0;
    strecken.forEach(([a, b], si) => {
      if (abbruchGrund !== undefined) return;
      if (u.abgelaufen()) {
        abbruchGrund = 'Frist abgelaufen';
        return;
      }
      // Nur der Teil der Strecke im Bereich wird abgetastet (Liang–Barsky); der Rest wird ohnehin nie geprüft.
      const klemm = klemmeStrecke(a, b, k);
      if (klemm === null) return;
      const [t0, t1] = klemm;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(len / ROUTEN_SCHRITT));
      const tStart = Math.max(0, Math.floor(t0 * n) - 1);
      const tEnde = Math.min(n, Math.ceil(t1 * n) + 1);
      proben += tEnde - tStart + 1;
      if (proben > ROUTEN_PROBEN_MAX) {
        abbruchGrund = `Kappe: höchstens ${ROUTEN_PROBEN_MAX} Stützpunkte je Aufruf`;
        return;
      }
      const nah = festeObjekte.filter((o) => {
        if (!o.flaeche || eigene(o)) return false;
        const [x0, z0, x1, z1] = huelleVon(o.flaeche);
        return (
          x1 + KOERPER_RADIUS >= Math.min(a.x, b.x) &&
          x0 - KOERPER_RADIUS <= Math.max(a.x, b.x) &&
          z1 + KOERPER_RADIUS >= Math.min(a.z, b.z) &&
          z0 - KOERPER_RADIUS <= Math.max(a.z, b.z)
        );
      });
      let imWasserLauf = false;
      let steilLauf = false;
      let vorherH = Number.NaN;
      for (let t = tStart; t <= tEnde; t++) {
        if ((t & 1023) === 0 && u.abgelaufen()) {
          abbruchGrund = 'Frist abgelaufen';
          return;
        }
        const x = a.x + ((b.x - a.x) * t) / n;
        const z = a.z + ((b.z - a.z) * t) / n;
        if (!imBereich(form, x, z)) {
          imWasserLauf = false;
          steilLauf = false;
          vorherH = Number.NaN;
          continue;
        }
        for (const o of nah) {
          if (getroffen.has(o.id)) continue;
          if (abstandZuPolygon({ x, z }, o.flaeche as Polygon) <= KOERPER_RADIUS) {
            getroffen.add(o.id);
            befunde.push({
              pruefung: 'route',
              schwere: 'rot',
              x: rund(x),
              z: rund(z),
              ids: [route.id, o.id],
              text: `Route ${route.id} (Strecke ${si}) läuft durch ${o.p.prefab}`,
              huelleQuelle: o.huelle?.quelle,
            });
          }
        }
        const h = geo.getHeight(x, z);
        const nass = h < WATER_LEVEL;
        if (nass && !imWasserLauf && laeufe < ROUTEN_LAUFEN_MAX) {
          laeufe++;
          befunde.push({
            pruefung: 'route',
            schwere: 'gelb',
            x: rund(x),
            z: rund(z),
            ids: [route.id],
            text: `Route ${route.id} (Strecke ${si}) läuft ins Wasser (Boden ${rund(h)} m)`,
            wert: rund(h),
            grenze: WATER_LEVEL,
          });
        }
        imWasserLauf = nass;
        const steil = !Number.isNaN(vorherH) && Math.abs(h - vorherH) / ROUTEN_SCHRITT > steilTan;
        if (steil && !steilLauf && laeufe < ROUTEN_LAUFEN_MAX) {
          laeufe++;
          befunde.push({
            pruefung: 'route',
            schwere: 'gelb',
            x: rund(x),
            z: rund(z),
            ids: [route.id],
            text: `Route ${route.id} (Strecke ${si}) läuft über eine Stelle steiler als ${STEIGUNGS_GRENZE_GRAD}°`,
            grenze: STEIGUNGS_GRENZE_GRAD,
          });
        }
        steilLauf = steil;
        vorherH = h;
      }
    });
    if (abbruchGrund === undefined) geprueft++;
  }
  return {
    status: abbruchGrund === undefined ? 'vollstaendig' : 'abgebrochen',
    geprueft,
    gesamt: relevant.length,
    einheit: `Routen (${proben} Stützpunkte)`,
    grund: abbruchGrund,
  };
}

// ── P6: Objektbudget je Zone ───────────────────────────────────────────────

function budget(layout: WorldLayout, form: Bereichsform, s: Schwellen, befunde: Befund[]): PruefStatus {
  const zahlen = new Map<string, number>();
  for (const p of layout.placements ?? []) {
    const key = `${Math.floor(p.x / ZONE_SIZE)},${Math.floor(p.z / ZONE_SIZE)}`;
    zahlen.set(key, (zahlen.get(key) ?? 0) + 1);
  }
  const k = form.kasten;
  for (let zx = Math.floor(k.minX / ZONE_SIZE); zx <= Math.floor(k.maxX / ZONE_SIZE); zx++) {
    for (let zz = Math.floor(k.minZ / ZONE_SIZE); zz <= Math.floor(k.maxZ / ZONE_SIZE); zz++) {
      const n = zahlen.get(`${zx},${zz}`) ?? 0;
      if (n <= s.zoneObjekteGelb) continue;
      const rot = n > s.zoneObjekteRot;
      befunde.push({
        pruefung: 'budget',
        schwere: rot ? 'rot' : 'gelb',
        x: (zx + 0.5) * ZONE_SIZE,
        z: (zz + 0.5) * ZONE_SIZE,
        ids: [],
        text: `Zone (${zx}, ${zz}) enthält ${n} Platzierungen`,
        wert: n,
        grenze: rot ? s.zoneObjekteRot : s.zoneObjekteGelb,
      });
    }
  }
  return { status: 'vollstaendig', geprueft: zahlen.size, gesamt: zahlen.size, einheit: 'Zonen mit Objekten' };
}

// ── Zusammenbau ────────────────────────────────────────────────────────────

const REIHENFOLGE = { rot: 0, gelb: 1, hinweis: 2 } as const;

export function pruefeWelt(
  layout: WorldLayout,
  geo: HoehenFeld,
  bereich: Bereich,
  optionen: CheckOptionen = {}
): CheckErgebnis {
  const startZeit = (optionen.uhr ?? (() => performance.now()))();
  const form = normalisiereBereich(bereich);
  const arten = new Set(optionen.pruefungen ?? ALLE_PRUEFUNGEN);
  const s: Schwellen = { ...schwellenVorgabe(), ...optionen.grenzen };
  const huellen = optionen.huellen ?? huellenAufloeser();
  const objekte = objekteVorbereiten(layout, form, geo, huellen);
  const festeObjekte = objekte.filter((o) => o.huelle?.fest === true && o.flaeche !== null);
  const befunde: Befund[] = [];

  const frist = optionen.frist ?? FRIST_MS;
  const jetzt = optionen.uhr ?? (() => performance.now());
  const u = new Uhr(jetzt, startZeit, frist);
  const pruefstatus: Partial<Record<PruefArt, PruefStatus>> = {};
  // Billig zuerst, das Raster der Wegsuche zuletzt: bei knapper Frist bleibt so das Meiste vollständig.
  const lauf: Array<[PruefArt, () => PruefStatus]> = [
    ['budget', () => budget(layout, form, s, befunde)],
    ['wasser', () => imWasser(objekte, geo, befunde, u)],
    ['hang', () => haenge(objekte, geo, s, befunde, u)],
    ['ueberlappung', () => ueberlappungen(objekte, befunde, u)],
    ['route', () => routen(layout, form, festeObjekte, geo, befunde, u)],
    ['eingang', () => eingaenge(objekte, festeObjekte, layout, form, geo, optionen.von, optionen.eingaenge ?? EINGAENGE, befunde, u)],
  ];
  for (const [art, fuehreAus] of lauf) {
    if (!arten.has(art)) continue;
    pruefstatus[art] = u.abgelaufen()
      ? { status: 'uebersprungen', geprueft: 0, gesamt: 0, einheit: '-', grund: 'Frist schon vor Beginn abgelaufen' }
      : fuehreAus();
  }

  const nichtPruefbar = [...new Set(objekte.filter((o) => o.innen && o.huelle === null).map((o) => o.p.prefab))].sort();
  if (arten.has('ueberlappung') || arten.has('eingang') || arten.has('route')) {
    for (const name of nichtPruefbar) {
      const mit = objekte.filter((o) => o.innen && o.p.prefab === name);
      befunde.push({
        pruefung: 'huelle',
        schwere: 'gelb',
        x: rund(mit[0].x),
        z: rund(mit[0].z),
        ids: mit.slice(0, 10).map((o) => o.id),
        text: `${name}: keine Hülle bekannt, ${mit.length} Objekt(e) nicht prüfbar (Überlappung, Eingang, Route)`,
      });
    }
  }

  befunde.sort(
    (a, b) => REIHENFOLGE[a.schwere] - REIHENFOLGE[b.schwere] || a.x - b.x || a.z - b.z || a.pruefung.localeCompare(b.pruefung)
  );
  const zaehler = { rot: 0, gelb: 0, hinweis: 0 };
  for (const b of befunde) zaehler[b.schwere]++;
  const unvollstaendig = (Object.entries(pruefstatus) as Array<[PruefArt, PruefStatus]>).filter(([, st]) => st.status !== 'vollstaendig');
  const teilweise = unvollstaendig.length > 0;
  let hinweis: string | undefined;
  if (teilweise) {
    const teile = unvollstaendig.map(([art, st]) =>
      st.status === 'uebersprungen'
        ? `${art}: übersprungen (${st.grund})`
        : `${art}: abgebrochen nach ${st.geprueft} von ${st.gesamt} ${st.einheit} (${st.grund})`
    );
    const fertig = (Object.entries(pruefstatus) as Array<[PruefArt, PruefStatus]>).filter(([, st]) => st.status === 'vollstaendig').map(([art]) => art);
    hinweis =
      `TEILBERICHT nach ${Math.round(u.vergangen())} ms (Frist ${frist} ms). Vollständig: ${fertig.join(', ') || 'keine'}. ` +
      `${teile.join('; ')}. Bereich verkleinern und erneut prüfen.`;
    befunde.push({ pruefung: 'frist', schwere: 'gelb', x: (form.kasten.minX + form.kasten.maxX) / 2, z: (form.kasten.minZ + form.kasten.maxZ) / 2, ids: [], text: hinweis });
    zaehler.gelb++;
  }
  const ausgabe = befunde.slice(0, BEFUNDE_MAX);
  return {
    ampel: zaehler.rot > 0 ? 'rot' : zaehler.gelb > 0 ? 'gelb' : 'gruen',
    zaehler,
    objekte: objekte.filter((o) => o.innen).length,
    befunde: ausgabe,
    ausgelassen: befunde.length - ausgabe.length,
    nichtPruefbar,
    ms: Math.round(u.vergangen()),
    frist,
    teilweise,
    pruefstatus,
    hinweis,
  };
}
