/**
 * Entfernte Vegetation (`WorldLayout.vegetationEntfernt`): Kreise, in denen die Streuung nichts ablegt.
 * Removed vegetation: circles in which the scatter places nothing.
 *
 * EIN Prüfer für alle drei Seiten (Spielserver `ZoneManager.populateFoliage`, Testflug-Vorschau
 * `BewuchsVorschau`, später die Bereinigung gespeicherter Zonen). DOM-frei, ohne Abhängigkeit außer Typen.
 *
 * ── Warum ein Nachfilter und keine Freifläche ──────────────────────────────────────────────────────────────
 * Die Streuung zieht ihre Zufallszahlen weiter, auch für einen abgelehnten Kandidaten. Eine Freifläche vor der
 * Prüfung würfelte die ganze Zone um. Der Filter sitzt deshalb im Ablegen-Callback, NACH allen Zügen: Was nicht
 * im Kreis liegt, bleibt bitgleich.
 *
 * ── Grenzen ────────────────────────────────────────────────────────────────────────────────────────────────
 *  - Radius 0,5…50 m. Unter 0,5 m trifft ein Kreis praktisch keine Pflanze (Streuradien ab 0,5 m, Mindestabstand);
 *    über 50 m wäre das keine Pinselspitze mehr, sondern ein Kahlschlag in einem Eintrag (ein Strich setzt viele
 *    Kreise, keinen riesigen).
 *  - Höchstens 4096 Kreise: ein langer Strich mit Radius 5 m und halbem Radius als Abstand braucht je Kilometer
 *    etwa 400 Kreise, 4096 reichen für zehn solche Kilometer. Der Prüfer rastert (32 m), die Kosten je Fund
 *    hängen deshalb an den Kreisen in der Nähe, nicht an der Gesamtzahl.
 *  - x und z im Weltrahmen (`LAYOUT_MAX_EXTENT`), alle Zahlen endlich (JSON kennt kein NaN, ein Entwurf im
 *    Speicher schon).
 *  - Der Rand zählt dazu: ein Fund bei Abstand == r ist entfernt.
 *
 * ── Einteilung „Baum“ ──────────────────────────────────────────────────────────────────────────────────────
 * `FOLIAGE` mischt Bäume, Büsche, Kraut und Steine ohne Art-Feld. Die Art ergibt sich aus dem Prefab-Namen
 * (`streuArt`): Baum sind die eigene Flora `Eiche`, `BirkeHoch`, `BirkeDicht`, `Kiefer`, `Fichte`, `Tanne`, `Weide`
 * (je mit Ziffer, auch die `…Dick`-Stämme) und die Store-Bäume `vegetation-(tree|branched-tree|small-thin-tree|
 * massive-tree|split-tree|pine)-…`. Kein Baum: Büsche (`Hasel`, `Schlehe`, `Hartriegel`, `Holunder`, `Brombeere`,
 * `Wacholder`, `Heidelbeere`, `vegetation-bush-…`, `vegetation-large-bush-…`), Kraut und Gräser, Äste
 * (`vegetation-branch-…`, ein Ast ist kein Baum), Pilze und alle Steine/Felsen. Weide zählt als Baum: die Weide
 * der Sumpf-Flora ist ein Baum, nur klein gezogen.
 */

import { LAYOUT_MAX_EXTENT, type VegetationEntferntKreis } from './types.js';
import { koordinate } from './zahlen.js';

export const VEGETATION_RADIUS_MIN = 0.5;
export const VEGETATION_RADIUS_MAX = 50;
export const VEGETATION_KREISE_MAX = 4096;

/** Art eines Streufundes für den Filter: `'baum'` oder alles andere Gestreute. */
export type StreuArt = 'baum' | 'sonstiges';

/** Eigene Flora: Name + Ziffer (+ `Dick`). */
const BAUM_EIGEN_RE = /^(Eiche|BirkeHoch|BirkeDicht|Kiefer|Fichte|Tanne|Weide)\d+(Dick)?$/;
/** Store-Bäume: die Baumart steht zwischen `vegetation-` und dem nächsten `-` (`branch-` ist KEIN Baum). */
const BAUM_STORE_RE = /^vegetation-(tree|branched-tree|small-thin-tree|massive-tree|split-tree|pine)-/;

export function streuArt(prefabName: string): StreuArt {
  return BAUM_EIGEN_RE.test(prefabName) || BAUM_STORE_RE.test(prefabName) ? 'baum' : 'sonstiges';
}

/** Ein Befund am ROHEN Eintrag: welcher Eintrag (`#<Stelle>`), welches Feld, welcher Wert (gekürzt). */
export interface VegetationFehler {
  eintrag: string;
  feld: string;
  wert: unknown;
}

export interface VegetationProblem {
  reason: 'invalid' | 'limit';
  /** Zahl der rohen Einträge. */
  anzahl: number;
  grenze: number;
  fehlerhaft: VegetationFehler[];
}

const ERLAUBTE_SCHLUESSEL = new Set(['x', 'z', 'r', 'nur']);
/** Mehr Einträge als diese Marge über der Grenze liest die Prüfung nicht (Rest ist ohnehin `limit`). */
const MAX_PRUEFEN = VEGETATION_KREISE_MAX + 1;

function wertKurz(v: unknown): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (v === undefined) return null;
  let text: string | undefined;
  try {
    text = JSON.stringify(v);
  } catch {
    text = undefined;
  }
  return text === undefined ? String(typeof v) : text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function radius(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < VEGETATION_RADIUS_MIN || v > VEGETATION_RADIUS_MAX) return null;
  return Math.round(v * 1000) / 1000;
}

/** Ein einzelner roher Eintrag: der gültige Kreis, sonst die Befunde. */
function eintragPruefen(e: unknown, stelle: number): { kreis: VegetationEntferntKreis | null; fehler: VegetationFehler[] } {
  const name = `#${stelle}`;
  if (typeof e !== 'object' || e === null || Array.isArray(e)) {
    return { kreis: null, fehler: [{ eintrag: name, feld: 'eintrag', wert: wertKurz(e) }] };
  }
  const o = e as Record<string, unknown>;
  const fehler: VegetationFehler[] = [];
  for (const k of Object.keys(o)) {
    if (!ERLAUBTE_SCHLUESSEL.has(k)) fehler.push({ eintrag: name, feld: k, wert: wertKurz(o[k]) });
  }
  const x = koordinate(o.x);
  const z = koordinate(o.z);
  const r = radius(o.r);
  if (x === null) fehler.push({ eintrag: name, feld: 'x', wert: wertKurz(o.x) });
  if (z === null) fehler.push({ eintrag: name, feld: 'z', wert: wertKurz(o.z) });
  if (r === null) fehler.push({ eintrag: name, feld: 'r', wert: wertKurz(o.r) });
  // `nur`: fehlt (alles Gestreute) oder genau 'baeume'. Alles andere (null, '', 'busch') ist ein Fund.
  if (o.nur !== undefined && o.nur !== 'baeume') fehler.push({ eintrag: name, feld: 'nur', wert: wertKurz(o.nur) });
  if (fehler.length > 0 || x === null || z === null || r === null) return { kreis: null, fehler };
  return { kreis: o.nur === 'baeume' ? { x, z, r, nur: 'baeume' } : { x, z, r }, fehler };
}

/**
 * Was am ROHEN `vegetationEntfernt`-Wert nicht gültig ist. Fehlt das Feld (`undefined`/`null`), ist das gültig leer.
 * Ein gesetztes Nicht-Array ist kaputt, nicht leer.
 */
export function vegetationEntferntFehler(roh: unknown): VegetationFehler[] {
  if (roh === undefined || roh === null) return [];
  if (!Array.isArray(roh)) return [{ eintrag: '—', feld: 'vegetationEntfernt', wert: wertKurz(roh) }];
  const fehler: VegetationFehler[] = [];
  roh.slice(0, MAX_PRUEFEN).forEach((e, i) => fehler.push(...eintragPruefen(e, i).fehler));
  return fehler;
}

/**
 * Der Befund für Schreibweg, Boot und Editor (wie `heightProblem`): `null` = in Ordnung. `limit`, wenn mehr als
 * `VEGETATION_KREISE_MAX` Einträge da sind (am ROHEN Wert gezählt, bevor etwas abgeschnitten wird), sonst `invalid`
 * bei jedem fehlerhaften Eintrag. Der Betriebsdienst lehnt beides mit 422 ab; verworfen wird nie still.
 */
export function vegetationProblem(roh: unknown): VegetationProblem | null {
  const fehlerhaft = vegetationEntferntFehler(roh);
  const anzahl = Array.isArray(roh) ? roh.length : 0;
  if (anzahl > VEGETATION_KREISE_MAX) {
    return { reason: 'limit', anzahl, grenze: VEGETATION_KREISE_MAX, fehlerhaft };
  }
  return fehlerhaft.length > 0 ? { reason: 'invalid', anzahl, grenze: VEGETATION_KREISE_MAX, fehlerhaft } : null;
}

/** Die gültigen Kreise des rohen Wertes (höchstens `VEGETATION_KREISE_MAX`), Reihenfolge bleibt. Fehlerhaftes fällt weg. */
export function sanitizeVegetationEntfernt(roh: unknown): VegetationEntferntKreis[] {
  if (!Array.isArray(roh)) return [];
  const kreise: VegetationEntferntKreis[] = [];
  for (let i = 0; i < Math.min(roh.length, VEGETATION_KREISE_MAX); i++) {
    const { kreis } = eintragPruefen(roh[i], i);
    if (kreis) kreise.push(kreis);
  }
  return kreise;
}

/** Zellkante des Rasters in Metern. */
const ZELLE = 32;
const ZELL_VERSATZ = Math.ceil(LAYOUT_MAX_EXTENT / ZELLE) + 64;
const ZELL_BREITE = 2 * ZELL_VERSATZ + 1;

export interface VegetationPruefer {
  /** Kein Kreis: der Prüfer ändert nie etwas (Aufrufer können den Filter ganz weglassen). */
  readonly leer: boolean;
  /** Liegt der Punkt in einem Kreis, der diese Art betrifft? Rand zählt dazu. */
  istEntfernt(x: number, z: number, art: StreuArt): boolean;
}

/** Prüfer über ein Raster: die Kosten je Abfrage hängen an den Kreisen der Zelle, nicht an der Gesamtzahl. */
export function vegetationPruefer(kreise: readonly VegetationEntferntKreis[] | null | undefined): VegetationPruefer {
  const liste = kreise ?? [];
  if (liste.length === 0) return { leer: true, istEntfernt: () => false };
  const raster = new Map<number, number[]>();
  const zellenKey = (ix: number, iz: number): number => (ix + ZELL_VERSATZ) * ZELL_BREITE + (iz + ZELL_VERSATZ);
  liste.forEach((k, i) => {
    const x0 = Math.floor((k.x - k.r) / ZELLE);
    const x1 = Math.floor((k.x + k.r) / ZELLE);
    const z0 = Math.floor((k.z - k.r) / ZELLE);
    const z1 = Math.floor((k.z + k.r) / ZELLE);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = zellenKey(ix, iz);
        const zelle = raster.get(key);
        if (zelle) zelle.push(i);
        else raster.set(key, [i]);
      }
    }
  });
  return {
    leer: false,
    istEntfernt(x, z, art) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
      const zelle = raster.get(zellenKey(Math.floor(x / ZELLE), Math.floor(z / ZELLE)));
      if (!zelle) return false;
      for (const i of zelle) {
        const k = liste[i]!;
        if (k.nur === 'baeume' && art !== 'baum') continue;
        const dx = x - k.x;
        const dz = z - k.z;
        if (dx * dx + dz * dz <= k.r * k.r) return true;
      }
      return false;
    },
  };
}
