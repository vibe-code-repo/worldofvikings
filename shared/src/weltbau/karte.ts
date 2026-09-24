/**
 * Kartenlogik für map_render, rein und ohne Gelände-Abfrage: Ausschnitt →
 * Bildmaße, Weltmeter ↔ Bildpunkt und das Zeichnen der Ebenen (Platzierungen,
 * Routen, Regionen, Wasserlauf, Befunde) über ein fertiges Geländebild.
 *
 * Das Gelände selbst (Geo-Abfrage und Farbregel des Editors) liegt im
 * MCP-Ordner, weil es aus dem Client-Bündel importiert; dieses Modul kennt nur
 * Eingabedaten und bleibt dadurch im Test ohne Welt ausführbar.
 *
 * Bildachsen: x wächst nach rechts, z nach unten (wie die Editor-Karte).
 */
import { Leinwand, gedrehtesRechteck, type Farbe } from './zeichnen.js';

/** Größte erlaubte Kantenlänge des Ausschnitts in Metern (die ganze Welt mit Luft). */
export const KARTE_KANTE_MAX = 131072;
/** Kleinste Kantenlänge in Metern. */
export const KARTE_KANTE_MIN = 8;
/** Erlaubte Bildgrößen (längste Bildkante) in Pixeln. */
export const KARTE_PIXEL = [128, 256, 512, 1024] as const;
export const KARTE_PIXEL_MAX = 1024;
/** world_check läuft nur bis zu dieser Kantenlänge; darüber entfällt die Befunde-Ebene. */
export const KARTE_BEFUNDE_KANTE_MAX = 512;

export type KartenEbene = 'gelaende' | 'wasser' | 'platzierungen' | 'routen' | 'regionen' | 'befunde' | 'raster';
export const KARTEN_EBENEN: readonly KartenEbene[] = [
  'gelaende',
  'wasser',
  'platzierungen',
  'routen',
  'regionen',
  'befunde',
  'raster',
];
export const KARTEN_EBENEN_VORGABE: readonly KartenEbene[] = ['gelaende', 'wasser', 'platzierungen', 'routen'];

/** Ausschnitt: Rechteck oder Kreis um einen Punkt. */
export type KartenBereich =
  | { minX: number; minZ: number; maxX: number; maxZ: number }
  | { x: number; z: number; radius: number };

/** Grundfläche einer Platzierung, in Metern, lokal um den Ursprung. */
export type Grundflaeche =
  | { art: 'rechteck'; halbX: number; halbZ: number }
  | { art: 'kreis'; radius: number };

export interface KartenObjekt {
  id?: string;
  x: number;
  z: number;
  yaw?: number;
  /** Fehlt sie, zeichnet die Karte einen kleinen Punkt (Mindestgröße). */
  flaeche?: Grundflaeche;
  /** Fester Körper = dunkel, durchlässig = hell. */
  fest?: boolean;
}

export interface KartenRoute {
  id?: string;
  points: ReadonlyArray<readonly number[]>;
}

export interface KartenRegion {
  id?: string;
  shape:
    | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> }
    | { kind: 'circle'; x: number; z: number; radius: number };
}

export interface KartenFluss {
  points: ReadonlyArray<readonly [number, number]>;
  width: number;
}

export interface KartenSee {
  x: number;
  z: number;
  radius: number;
}

export interface KartenBefund {
  schwere: 'rot' | 'gelb';
  x: number;
  z: number;
}

export interface KartenEingabe {
  objekte?: readonly KartenObjekt[];
  routen?: readonly KartenRoute[];
  regionen?: readonly KartenRegion[];
  fluesse?: readonly KartenFluss[];
  seen?: readonly KartenSee[];
  befunde?: readonly KartenBefund[];
}

/** Abbildung Welt → Bild. */
export interface Ansicht {
  /** Weltkoordinate der oberen linken Ecke. */
  x0: number;
  z0: number;
  /** Weltmeter je Bildpunkt (gleich in beiden Richtungen). */
  meterProPx: number;
  breite: number;
  hoehe: number;
}

export const weltZuBildX = (a: Ansicht, x: number): number => (x - a.x0) / a.meterProPx;
export const weltZuBildY = (a: Ansicht, z: number): number => (z - a.z0) / a.meterProPx;
export const bildZuWeltX = (a: Ansicht, px: number): number => a.x0 + px * a.meterProPx;
export const bildZuWeltZ = (a: Ansicht, py: number): number => a.z0 + py * a.meterProPx;

/** Rechteck eines Bereichs (Kreis → umschließendes Quadrat). */
export function bereichRechteck(b: KartenBereich): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if ('radius' in b) return { minX: b.x - b.radius, minZ: b.z - b.radius, maxX: b.x + b.radius, maxZ: b.z + b.radius };
  return { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ };
}

/**
 * Ansicht aus Bereich und Pixelwunsch. Wirft einen Error mit Klartext bei
 * ungültigen oder zu großen Werten (der Aufrufer macht daraus isError).
 * Die längere Seite des Bereichs bekommt `pixel` Bildpunkte, die kürzere
 * entsprechend weniger (Seitenverhältnis bleibt).
 */
export function ansichtAus(bereich: KartenBereich, pixel: number): Ansicht {
  if (!(KARTE_PIXEL as readonly number[]).includes(pixel)) {
    throw new Error(`pixel muss einer von ${KARTE_PIXEL.join(', ')} sein (höchstens ${KARTE_PIXEL_MAX}), war ${pixel}.`);
  }
  const r = bereichRechteck(bereich);
  const zahlen = [r.minX, r.minZ, r.maxX, r.maxZ];
  if (!zahlen.every((n) => Number.isFinite(n))) throw new Error('bereich enthält ungültige Zahlen.');
  const w = r.maxX - r.minX;
  const h = r.maxZ - r.minZ;
  if (!(w > 0) || !(h > 0)) throw new Error('bereich hat keine Fläche (max muss größer als min sein, radius > 0).');
  const lang = Math.max(w, h);
  if (lang > KARTE_KANTE_MAX) {
    throw new Error(`bereich zu groß: ${Math.round(lang)} m Kantenlänge, erlaubt sind höchstens ${KARTE_KANTE_MAX} m.`);
  }
  if (lang < KARTE_KANTE_MIN) {
    throw new Error(`bereich zu klein: ${lang} m Kantenlänge, erlaubt sind mindestens ${KARTE_KANTE_MIN} m.`);
  }
  const meterProPx = lang / pixel;
  return {
    x0: r.minX,
    z0: r.minZ,
    meterProPx,
    breite: Math.max(1, Math.round(w / meterProPx)),
    hoehe: Math.max(1, Math.round(h / meterProPx)),
  };
}

export const KARTEN_FARBEN = {
  fest: [30, 20, 14] as Farbe,
  festRand: [255, 230, 120] as Farbe,
  durchlaessig: [235, 235, 210] as Farbe,
  route: [255, 120, 40] as Farbe,
  routePunkt: [255, 255, 255] as Farbe,
  region: [255, 255, 255] as Farbe,
  fluss: [70, 140, 230] as Farbe,
  see: [70, 140, 230] as Farbe,
  rot: [255, 0, 0] as Farbe,
  gelb: [255, 220, 0] as Farbe,
  raster: [0, 0, 0] as Farbe,
};

/** Rasterlinienabstand in Metern (Zehnerpotenz, so dass es höchstens ~16 Linien je Kante gibt). */
export function rasterAbstand(a: Ansicht): number {
  const kante = Math.max(a.breite, a.hoehe) * a.meterProPx;
  const roh = kante / 12;
  const potenz = 10 ** Math.floor(Math.log10(roh));
  const rest = roh / potenz;
  return (rest >= 5 ? 5 : rest >= 2 ? 2 : 1) * potenz;
}

/**
 * Ebenen über das Geländebild zeichnen. Reihenfolge: Wasserlauf, Regionen,
 * Raster, Platzierungen, Routen, Befunde (Befunde ganz oben).
 */
export function zeichneEbenen(
  l: Leinwand,
  a: Ansicht,
  ebenen: ReadonlySet<KartenEbene>,
  e: KartenEingabe
): void {
  const bx = (x: number) => weltZuBildX(a, x);
  const by = (z: number) => weltZuBildY(a, z);
  const F = KARTEN_FARBEN;

  if (ebenen.has('wasser')) {
    for (const s of e.seen ?? []) l.kreis(bx(s.x), by(s.z), Math.max(1, s.radius / a.meterProPx), F.see, 0.55);
    for (const f of e.fluesse ?? []) {
      const breitePx = Math.max(1, Math.round(f.width / a.meterProPx));
      for (let k = 0; k + 1 < f.points.length; k++) {
        l.linie(bx(f.points[k][0]), by(f.points[k][1]), bx(f.points[k + 1][0]), by(f.points[k + 1][1]), F.fluss, breitePx);
      }
    }
  }

  if (ebenen.has('regionen')) {
    for (const r of e.regionen ?? []) {
      if (r.shape.kind === 'circle') l.ring(bx(r.shape.x), by(r.shape.z), r.shape.radius / a.meterProPx, F.region);
      else l.polygonUmriss(r.shape.points.map(([x, z]) => [bx(x), by(z)] as [number, number]), F.region);
    }
  }

  if (ebenen.has('raster')) {
    const schritt = rasterAbstand(a);
    const x1 = a.x0 + a.breite * a.meterProPx;
    const z1 = a.z0 + a.hoehe * a.meterProPx;
    for (let x = Math.ceil(a.x0 / schritt) * schritt; x <= x1; x += schritt) {
      l.linie(bx(x), 0, bx(x), a.hoehe - 1, F.raster);
    }
    for (let z = Math.ceil(a.z0 / schritt) * schritt; z <= z1; z += schritt) {
      l.linie(0, by(z), a.breite - 1, by(z), F.raster);
    }
  }

  if (ebenen.has('platzierungen')) {
    for (const o of e.objekte ?? []) {
      const farbe = o.fest ? F.fest : F.durchlaessig;
      const f = o.flaeche;
      if (f?.art === 'rechteck') {
        const ecken = gedrehtesRechteck(o.x, o.z, f.halbX, f.halbZ, o.yaw ?? 0).map(
          ([x, z]) => [bx(x), by(z)] as [number, number]
        );
        l.polygonFuellen(ecken, farbe);
        l.polygonUmriss(ecken, o.fest ? F.festRand : F.fest);
      } else if (f?.art === 'kreis') {
        const r = Math.max(1, f.radius / a.meterProPx);
        l.kreis(bx(o.x), by(o.z), r, farbe);
        l.ring(bx(o.x), by(o.z), r, o.fest ? F.festRand : F.fest);
      } else {
        l.kreis(bx(o.x), by(o.z), 1.5, farbe);
      }
    }
  }

  if (ebenen.has('routen')) {
    for (const r of e.routen ?? []) {
      for (let k = 0; k + 1 < r.points.length; k++) {
        l.linie(bx(r.points[k][0]), by(r.points[k][1]), bx(r.points[k + 1][0]), by(r.points[k + 1][1]), F.route, 2);
      }
      for (const p of r.points) l.kreis(bx(p[0]), by(p[1]), 2, F.routePunkt);
    }
  }

  if (ebenen.has('befunde')) {
    for (const b of e.befunde ?? []) {
      l.kreuz(bx(b.x), by(b.z), 5, b.schwere === 'rot' ? F.rot : F.gelb, 2);
    }
  }
}
