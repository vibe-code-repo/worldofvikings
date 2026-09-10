/**
 * Die Hindernisse, die der Server bisher nicht kannte.
 * The obstacles the server did not know about.
 *
 * DAS PROBLEM. `handlePlayerInput` schob die Figur bis heute allein gegen
 * die Heightmap: Felsen, Baeume, Haeuser standen nur im CLIENT (Havok).
 * Wer gegen einen Felsen lief, blieb dort stehen, waehrend die
 * Serverposition weiterlief — und der weiche Abgleich in `main.ts` zog die
 * Figur anschliessend durch den Felsen oder liess sie springen. Was Mike
 * als „Lag" sah, war eine zweite Wahrheit ueber dieselbe Welt.
 *
 * WAS HIER STEHT. Eine Strahlabfrage gegen die platzierten Formen einer
 * Gegend — dieselben zwei Fragen, die der Bewegungsschritt stellt
 * (`shared/src/bewegung/abfragen.ts`): was neben der Figur steht und was
 * unter ihr liegt. Die Formen selbst liefert eine `FormQuelle`; woher sie
 * kommen (GLB-Kollisionsnetze, Huellkoerper aus dem Katalog), geht diese
 * Datei nichts an. Ohne Quelle ist die Welt leer, und dann rechnet der
 * Server exakt wie vorher — das ist die Vorgabe und der Rueckfallweg.
 *
 * WARUM ES KEINE ANMELDUNG GIBT. Der naheliegende Bau waere ein eigener
 * Index, den `ZDOManager.createZDO` und `destroyZDO` fuettern. Genau den
 * braucht es nicht: Der ZDO-Speicher IST schon ein Zonenindex
 * (`objectsBySector`, `zdosInZoneXY`), er ist immer aktuell, und eine
 * entladene Zone hat dort keine Objekte mehr. Ein zweiter Index koennte
 * nur eins zusaetzlich: falsch stehen. Die Formen einer Zone verschwinden
 * hier also nicht, WEIL jemand sie abmeldet, sondern weil ihre ZDOs weg
 * sind — eine Doppelanmeldung ist damit strukturell unmoeglich.
 *
 * WARUM EIN NAHFELD. Jeder feste Schritt fragt bis zu dreimal sechs
 * Strahlen ab; bei 20 Eingabepaketen je Sekunde und 25 Spielern waere ein
 * Zonendurchlauf je Strahl die teuerste Schleife des Servers. Stattdessen
 * wird EINMAL je Eingabepaket eingesammelt, was ueberhaupt in Reichweite
 * steht (`nahfeld()`), samt Weltumhuellender und umgekehrter
 * Instanzmatrix; die Strahlen laufen dann nur noch gegen diese Liste.
 */
import type { FormQuelle, KollisionsForm, Vek3 } from '@wov/shared/src/kollision/form.js';
import { skalierungsStufe } from '@wov/shared/src/kollision/formen.js';
import type { BodenAbfrage, HindernisAbfrage, Treffer } from '@wov/shared/src/bewegung/abfragen.js';
import {
  BODEN_VERSATZ,
  KOERPER_RADIUS,
  STRAHL_HOEHEN,
  STUFEN_HOEHE,
  istWand,
} from '@wov/shared/src/bewegung/masse.js';
import type { Vector3 } from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { PrefabManager } from '../prefab/PrefabManager.js';

/** Alle drei Achsen auf die gemeinsame Groessenstufe einrasten. */
function gestufteSkalierung(v: Vector3): Vector3 {
  return { x: skalierungsStufe(v.x), y: skalierungsStufe(v.y), z: skalierungsStufe(v.z) };
}

/** Nichts hat eine Form — der Zustand vor Bauer A's Quelle. */
export const LEERE_FORMQUELLE: FormQuelle = Object.freeze({
  formFuer: (): KollisionsForm | null => null,
});

/**
 * Wie weit ein Bodenstrahl unter die Fuesse reicht, in m.
 *
 * Er beginnt eine Stufenhoehe UEBER den Fuessen (was er von dort nicht
 * erreicht, ist unbesteigbar) und laeuft 3 m nach unten — weit genug, um
 * beim Heruntergehen von einem Felsen dessen Flanke noch zu finden, kurz
 * genug, dass ein Spieler ueber einer Schlucht nicht am Grund klebt.
 */
const BODEN_TIEFE = 3;

/**
 * Wie weit ueber dem rechnerischen Startpunkt der Bodenstrahl beginnt, in m.
 *
 * Ein Zehntelmillimeter, und er ist noetig: Steht die Figur genau eine
 * Stufenhoehe unter einer Kante, faellt der Strahlanfang EXAKT auf deren
 * Oberflaeche. Ein Strahl, der auf der Flaeche beginnt, gilt der
 * Kistenabfrage als „von innen" und meldet die Unterseite — die ist keine
 * begehbare Flaeche, und die Figur wird nicht aufgesetzt. Eine Stufe von
 * exakt 0,40 m waere damit die einzige, die nicht ginge.
 */
const BODEN_START_LUFT = 1e-4;

/**
 * Wie weit ueber die eigentliche Reichweite hinaus eingesammelt wird, in m.
 *
 * Der Umkreis fragt nach dem MITTELPUNKT eines ZDO; ein Felsen von 8 m
 * Kantenlaenge steht mit seinem Mittelpunkt weit ausserhalb und mit seiner
 * Flanke mitten im Weg. Der Zuschlag ist die Antwort darauf. Er kostet
 * nichts als ein paar Huellbox-Vergleiche: Was der Strahl nicht trifft,
 * faellt in der Grobpruefung heraus.
 */
const NAHFELD_ZUSCHLAG = 12;

/** Ab wann ein Netz einen Gitterindex bekommt statt einer Schleife. */
const GITTER_AB_DREIECKEN = 500;

/** Ein platziertes Exemplar mit fertig gerechneter Instanzmatrix. */
interface Koerper {
  readonly form: KollisionsForm;
  /** Weltumhuellende — die Grobpruefung. World AABB, the broad phase. */
  readonly hx0: number; readonly hy0: number; readonly hz0: number;
  readonly hx1: number; readonly hy1: number; readonly hz1: number;
  /** Verschiebung der Instanz. */
  readonly px: number; readonly py: number; readonly pz: number;
  /** Drehmatrix, zeilenweise (r0..r8) — orthonormal, aus dem Quaternion. */
  readonly r: Float64Array;
  /** Skalierung je Achse (darf ungleichfoermig sein). */
  readonly sx: number; readonly sy: number; readonly sz: number;
  /** Gitterindex des Netzes, einmal je Form gebaut. */
  readonly gitter: NetzGitter | null;
}

/** Der Nahfeld-Zustand: eine Momentaufnahme fuer EIN Eingabepaket. */
export interface Nahfeld extends BodenAbfrage, HindernisAbfrage {
  /** Wie viele Koerper in Reichweite stehen — fuer Messung und Diagnose. */
  readonly anzahl: number;
}

// ── Gitterindex fuer grosse Netze ───────────────────────────────────

/**
 * Ein gleichmaessiges Gitter ueber die Huellbox eines Netzes.
 *
 * Gebraucht, weil ein Fels-Kollisionsnetz mehrere tausend Dreiecke haben
 * kann und ein Schritt bis zu 18 Strahlen wirft. Der Strahl eines
 * Schritts ist kurz (12,5 cm plus Radius), seine Huellbox deckt also nur
 * wenige Zellen — es reicht daher, die Dreiecke der ueberdeckten Zellen zu
 * sammeln, statt eine richtige Strahlwanderung zu bauen.
 *
 * Einmal je Form gebaut und an der Form zwischengespeichert (s.
 * `gitterFuer`): Der Bau kostet einen Durchlauf ueber alle Dreiecke, und
 * den soll nicht jeder Schritt zahlen.
 */
class NetzGitter {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly x0: number; readonly y0: number; readonly z0: number;
  readonly zx: number; readonly zy: number; readonly zz: number;
  /** Je Zelle die Dreiecksnummern. */
  private readonly zellen: number[][];

  constructor(form: { positionen: Float32Array; indizes: Uint32Array; min: Vek3; max: Vek3 }) {
    const dreiecke = form.indizes.length / 3;
    // Kantenzahl so, dass im Mittel rund acht Dreiecke je Zelle liegen;
    // nach oben gedeckelt, damit ein langes duennes Netz keine
    // Millionen leerer Zellen bekommt.
    let kanten = 1;
    while (kanten * kanten * kanten * 8 < dreiecke && kanten < 24) kanten += 1;
    this.nx = kanten; this.ny = kanten; this.nz = kanten;
    this.x0 = form.min.x; this.y0 = form.min.y; this.z0 = form.min.z;
    // Nulldicke Achsen (flaches Netz) duerfen nicht durch 0 teilen.
    this.zx = Math.max(form.max.x - form.min.x, 1e-6) / kanten;
    this.zy = Math.max(form.max.y - form.min.y, 1e-6) / kanten;
    this.zz = Math.max(form.max.z - form.min.z, 1e-6) / kanten;
    this.zellen = new Array(kanten * kanten * kanten);
    for (let i = 0; i < this.zellen.length; i += 1) this.zellen[i] = [];

    const p = form.positionen;
    const ix = form.indizes;
    for (let d = 0; d < dreiecke; d += 1) {
      const a = ix[d * 3]! * 3, b = ix[d * 3 + 1]! * 3, c = ix[d * 3 + 2]! * 3;
      const minX = Math.min(p[a]!, p[b]!, p[c]!), maxX = Math.max(p[a]!, p[b]!, p[c]!);
      const minY = Math.min(p[a + 1]!, p[b + 1]!, p[c + 1]!), maxY = Math.max(p[a + 1]!, p[b + 1]!, p[c + 1]!);
      const minZ = Math.min(p[a + 2]!, p[b + 2]!, p[c + 2]!), maxZ = Math.max(p[a + 2]!, p[b + 2]!, p[c + 2]!);
      const gx0 = this.zelleX(minX), gx1 = this.zelleX(maxX);
      const gy0 = this.zelleY(minY), gy1 = this.zelleY(maxY);
      const gz0 = this.zelleZ(minZ), gz1 = this.zelleZ(maxZ);
      for (let x = gx0; x <= gx1; x += 1)
        for (let y = gy0; y <= gy1; y += 1)
          for (let z = gz0; z <= gz1; z += 1)
            this.zellen[(x * this.ny + y) * this.nz + z]!.push(d);
    }
  }

  private zelleX(v: number): number {
    const i = Math.floor((v - this.x0) / this.zx);
    return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
  }
  private zelleY(v: number): number {
    const i = Math.floor((v - this.y0) / this.zy);
    return i < 0 ? 0 : i >= this.ny ? this.ny - 1 : i;
  }
  private zelleZ(v: number): number {
    const i = Math.floor((v - this.z0) / this.zz);
    return i < 0 ? 0 : i >= this.nz ? this.nz - 1 : i;
  }

  /** Dreiecksnummern, deren Zelle die Strahl-Huellbox beruehrt. */
  sammle(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, ziel: number[]): void {
    ziel.length = 0;
    const gx0 = this.zelleX(minX), gx1 = this.zelleX(maxX);
    const gy0 = this.zelleY(minY), gy1 = this.zelleY(maxY);
    const gz0 = this.zelleZ(minZ), gz1 = this.zelleZ(maxZ);
    for (let x = gx0; x <= gx1; x += 1)
      for (let y = gy0; y <= gy1; y += 1)
        for (let z = gz0; z <= gz1; z += 1)
          for (const d of this.zellen[(x * this.ny + y) * this.nz + z]!) ziel.push(d);
  }
}

/** Ein Gitter je Form, nicht je Exemplar — 400 Findlinge teilen eins. */
const GITTER_JE_FORM = new WeakMap<object, NetzGitter>();

function gitterFuer(form: KollisionsForm): NetzGitter | null {
  if (form.art !== 'netz') return null;
  if (form.indizes.length / 3 < GITTER_AB_DREIECKEN) return null;
  let g = GITTER_JE_FORM.get(form);
  if (!g) {
    g = new NetzGitter(form);
    GITTER_JE_FORM.set(form, g);
  }
  return g;
}

// ── Strahl gegen eine einzelne Form (im LOKALRAUM der Instanz) ──────

/** Ergebnis eines Strahlwurfs im Lokalraum: Parameter t und Normale. */
interface LokalTreffer { t: number; nx: number; ny: number; nz: number }

/**
 * Strahl gegen eine achsenparallele Kiste (Slab-Verfahren).
 *
 * Die gemeldete Normale zeigt IMMER aus der Kiste heraus. Beginnt der
 * Strahl INNEN, wird die AUSTRITTSflaeche gemeldet — und das ist kein
 * Randfall, sondern die Fluchttuer: Sobald die Figur dicht an einer Wand
 * steht, starten die seitlichen Strahlen in der Geometrie. Weil die
 * Austrittsnormale in Laufrichtung zeigt, faellt so ein Treffer oben
 * durch die Pruefung „nur was sich naehert, blockiert" — wer drinsteckt,
 * kommt in JEDE Richtung wieder heraus, statt eingemauert zu sein.
 */
function strahlKiste(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number
): LokalTreffer | null {
  let tMin = 0;
  let tMax = weite;
  let achseEin = -1, seiteEin = 1;
  let achseAus = -1, seiteAus = 1;

  for (let a = 0; a < 3; a += 1) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const lo = a === 0 ? x0 : a === 1 ? y0 : z0;
    const hi = a === 0 ? x1 : a === 1 ? y1 : z1;
    if (d > -1e-12 && d < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    // `s` ist die aeussere Normale der EINTRITTSflaeche dieser Achse.
    let s = -1;
    if (t1 > t2) { const h = t1; t1 = t2; t2 = h; s = 1; }
    if (t1 > tMin) { tMin = t1; achseEin = a; seiteEin = s; }
    if (t2 < tMax) { tMax = t2; achseAus = a; seiteAus = -s; }
    if (tMin > tMax) return null;
  }

  if (achseEin === -1) {
    if (achseAus === -1) return null; // Strahl liegt ganz in der Kiste
    return {
      t: tMax,
      nx: achseAus === 0 ? seiteAus : 0,
      ny: achseAus === 1 ? seiteAus : 0,
      nz: achseAus === 2 ? seiteAus : 0,
    };
  }
  return {
    t: tMin,
    nx: achseEin === 0 ? seiteEin : 0,
    ny: achseEin === 1 ? seiteEin : 0,
    nz: achseEin === 2 ? seiteEin : 0,
  };
}

/**
 * Strahl gegen eine stehende Kapsel (Zylinder + zwei Halbkugeln).
 *
 * Als Segmentabstand geschrieben: Der Mantel ist der Zylinder zwischen
 * `yMin` und `yMax`, die Deckel sind Kugeln um die Segmentenden. Das
 * kostet drei quadratische Gleichungen und braucht keine Trigonometrie.
 */
function strahlKapsel(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  cx: number, cz: number, radius: number, yMin: number, yMax: number
): LokalTreffer | null {
  let best: LokalTreffer | null = null;

  const merke = (t: number, nx: number, ny: number, nz: number): void => {
    if (t < 0 || t > weite) return;
    if (best === null || t < best.t) best = { t, nx, ny, nz };
  };

  // Mantel: (o + t d - c) waagerecht auf Radius.
  const mx = ox - cx;
  const mz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-16) {
    const b = 2 * (mx * dx + mz * dz);
    const c = mx * mx + mz * mz - radius * radius;
    const disk = b * b - 4 * a * c;
    if (disk >= 0) {
      const w = Math.sqrt(disk);
      for (const t of [(-b - w) / (2 * a), (-b + w) / (2 * a)]) {
        const y = oy + dy * t;
        if (y >= yMin && y <= yMax) {
          const px = mx + dx * t;
          const pz = mz + dz * t;
          const l = Math.sqrt(px * px + pz * pz);
          if (l > 1e-12) merke(t, px / l, 0, pz / l);
        }
      }
    }
  }

  // Deckel: zwei Kugeln um (cx, yMin/yMax, cz).
  for (const ky of [yMin, yMax]) {
    const qx = ox - cx, qy = oy - ky, qz = oz - cz;
    const a2 = dx * dx + dy * dy + dz * dz;
    if (a2 <= 1e-16) continue;
    const b2 = 2 * (qx * dx + qy * dy + qz * dz);
    const c2 = qx * qx + qy * qy + qz * qz - radius * radius;
    const disk2 = b2 * b2 - 4 * a2 * c2;
    if (disk2 < 0) continue;
    const w2 = Math.sqrt(disk2);
    for (const t of [(-b2 - w2) / (2 * a2), (-b2 + w2) / (2 * a2)]) {
      const py = oy + dy * t;
      if ((ky === yMin && py > yMin) || (ky === yMax && py < yMax)) continue;
      const nx = (qx + dx * t) / radius;
      const ny = (qy + dy * t) / radius;
      const nz = (qz + dz * t) / radius;
      merke(t, nx, ny, nz);
    }
  }

  return best;
}

/**
 * Strahl gegen ein Dreiecksnetz (Moeller-Trumbore), mit Gittervorpruefung.
 *
 * Die Normale wird NICHT nach der Wicklung ausgerichtet und auch nicht
 * gegen den Strahl gedreht, sondern VOM MITTELPUNKT DER HUELLBOX WEG. Zwei
 * Gruende, und beide sind gemessen worden statt vermutet: Ein
 * `_col`-Netz aus einer GLB hat keine verlaessliche Wicklung (halbe
 * Felsen kaemen sonst innen heraus), und eine gegen den Strahl gedrehte
 * Normale zeigt bei einem Strahl, der IM Fels beginnt, zurueck auf die
 * Figur — die haenge dann in der Ecke fest, in die sie geraten ist. Nach
 * aussen orientiert ist beides erledigt: Wer drin steht, laeuft in jede
 * Richtung heraus, wer draussen steht, wird von der Aussenflaeche gestoppt.
 */
function strahlNetz(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  positionen: Float32Array, indizes: Uint32Array, gitter: NetzGitter | null, puffer: number[],
  mx: number, my: number, mz: number
): LokalTreffer | null {
  let best: LokalTreffer | null = null;
  let anzahl = indizes.length / 3;
  let liste: number[] | null = null;

  if (gitter) {
    const ex = ox + dx * weite, ey = oy + dy * weite, ez = oz + dz * weite;
    gitter.sammle(
      Math.min(ox, ex), Math.min(oy, ey), Math.min(oz, ez),
      Math.max(ox, ex), Math.max(oy, ey), Math.max(oz, ez),
      puffer
    );
    liste = puffer;
    anzahl = puffer.length;
  }

  for (let i = 0; i < anzahl; i += 1) {
    const d3 = (liste ? liste[i]! : i) * 3;
    const ia = indizes[d3]! * 3, ib = indizes[d3 + 1]! * 3, ic = indizes[d3 + 2]! * 3;
    const ax = positionen[ia]!, ay = positionen[ia + 1]!, az = positionen[ia + 2]!;
    const e1x = positionen[ib]! - ax, e1y = positionen[ib + 1]! - ay, e1z = positionen[ib + 2]! - az;
    const e2x = positionen[ic]! - ax, e2y = positionen[ic + 1]! - ay, e2z = positionen[ic + 2]! - az;

    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-12 && det < 1e-12) continue; // parallel

    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) continue;

    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < 0 || t > weite) continue;
    if (best !== null && t >= best.t) continue;

    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l <= 1e-12) continue;
    nx /= l; ny /= l; nz /= l;
    // Nach aussen orientieren (s. Kopf): weg vom Huellbox-Mittelpunkt.
    const rx = ox + dx * t - mx, ry = oy + dy * t - my, rz = oz + dz * t - mz;
    if (nx * rx + ny * ry + nz * rz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    best = { t, nx, ny, nz };
  }

  return best;
}

// ── Kugel-Sweep gegen eine Form (im LOKALRAUM der Instanz) ──────────

/*
  WARUM EIN SWEEP UND NICHT DREI STRAHLEN.

  Bis zum 11.09.2026 tastete `ersterTreffer` die Figur mit drei Strahlen je
  Hoehe ab: einer in der Mitte, zwei um einen Koerperradius quer zur
  Laufrichtung versetzt. Das ist eine PUNKTabtastung eines FLAECHIGEN
  Koerpers, und zwischen den Abtastpunkten liegt Nichts: Ein Wandende oder
  eine Hausecke, die lateral GENAU zwischen zwei Strahlen steht, wird von
  keinem getroffen. Der Angreifer-Pruefer hat das reproduziert — diagonal
  auf die Ecke zweier Waende zu, und die Figur laeuft hindurch, bei jeder
  geprueften Wanddicke (0,025 / 0,1 / 0,4 m) und jedem Winkel (35–52 Grad).
  Ein dichteres Strahlenbuendel verschiebt die Luecke nur, es schliesst sie
  nicht; die Luecke ist die Bauart.

  Der Sweep hat keine Luecke, weil er kein Buendel ist: Eine Kugel vom
  Halbmesser r, die den Weg entlangfaehrt, ueberstreicht das VOLLE Profil
  der Figur. Gerechnet wird er als Minkowski-Summe — Strahl gegen die um r
  aufgeblasene Form —, also mit derselben Sorte Algebra wie vorher und
  ohne Iteration.

  WARUM DIE UNTERE KUGEL HOEHER SITZT ALS DER ALTE STRAHL. Die Hoehen aus
  `masse.ts` SIND die Stufenregel: Der untere Strahl lag 3 cm ueber der
  Stufenhoehe, damit ein 0,40-m-Absatz darunter durchlaeuft und ein
  0,5-m-Sockel getroffen wird. Eine Kugel MIT MITTELPUNKT auf 0,43 reicht
  bis 0,03 hinunter und trifft jeden Absatz — die Stufenregel waere weg.
  Der Mittelpunkt der unteren Kugel sitzt deshalb um r hoeher, sodass ihre
  UNTERSEITE genau auf `STRAHL_HOEHEN[0]` liegt. Damit bleibt die
  Stufenregel Zeichen fuer Zeichen dieselbe, und der Bereich, der bisher
  gar nicht abgefragt wurde (zwischen 0,43 und 1,4 — ein Balken in
  Huefthoehe), ist jetzt mit abgedeckt.

  UNGLEICHFOERMIGE SKALIERUNG IST EINE NAEHERUNG. Der Sweep laeuft im
  Lokalraum der Instanz; eine Weltkugel vom Halbmesser r ist dort ein
  Ellipsoid mit den Halbachsen r/sx, r/sy, r/sz. Fuer die KISTE wird das
  exakt behandelt (je Achse um r/s_achse aufgeblasen — der Versatz der
  Flaeche in der Welt ist dann genau r). Fuer Kapsel und Netz waere ein
  Ellipsoid-Sweep eine andere Rechnung; dort steht stattdessen EIN
  Halbmesser r/min(sx,sy,sz). Das ist die groesste der drei Halbachsen,
  die Kugel umschliesst das Ellipsoid also — die Naeherung blockt im
  schlimmsten Fall etwas zu frueh und laesst nie etwas durch. Bei
  gleichfoermiger Skalierung (der Normalfall: `scaleScalar`) ist sie exakt.

  DIE FLUCHTTUER BLEIBT, UND SIE WIRD GENAUER. Wer mit dem MITTELPUNKT in
  einer Form steckt, ist weiterhin in jede Richtung frei. Neu ist der
  Zustand dazwischen: Mittelpunkt draussen, aber naeher als r — die Figur
  BERUEHRT die Wand, weil der Client sie drangestellt hat. Frueher fiel
  dieser Fall unter „Strahl beginnt innen = frei", und die Figur waere ab
  der ersten Beruehrung durch die Wand gelaufen. Jetzt wird er mit t = 0
  und der Normale „vom naechsten Punkt der Flaeche zum Mittelpunkt"
  gemeldet; die Regel „nur was sich NAEHERT, blockiert" entscheidet dann
  richtig herum: weiter hinein ist blockiert, wieder heraus ist frei.
*/

/**
 * Wie weit ueber den Halbmesser hinaus noch als BERUEHRUNG gilt, in m.
 *
 * Ein Zehntel Mikrometer, und er hat denselben Grund wie `BODEN_START_LUFT`
 * weiter oben: Genau AUF der Flaeche ist die eine Lage, die ein
 * Slab-Verfahren nicht entscheiden kann. Wer dort steht, soll in den
 * Beruehrungszweig fallen (Normale aus der Flaeche, Richtungsregel
 * entscheidet), nicht in den Strahlzweig.
 */
const BERUEHR_LUFT = 1e-7;

/**
 * Kugel-Sweep gegen eine achsenparallele Kiste.
 *
 * `rx/ry/rz` ist der Kugelhalbmesser in LOKALEN Einheiten je Achse
 * (r/skalierung). Die aufgeblasene Kiste hat scharfe Ecken statt runder —
 * das ist der bekannte Fehler der Minkowski-NAEHERUNG mit einer Kiste: An
 * einer Aussenecke blockt sie bis zu r·(√2−1) ≈ 17 cm zu frueh. Zu frueh
 * ist die richtige Seite des Fehlers, und die Alternative (drei
 * Kantenzylinder plus Eckkugeln je Kiste) kostet ein Vielfaches fuer eine
 * Genauigkeit, die kein Spieler von der Wanddicke unterscheiden kann.
 */
function sweepKiste(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  min: Vek3, max: Vek3, rx: number, ry: number, rz: number
): LokalTreffer | null {
  // (1) Fluchttuer: Mittelpunkt IN der Form — frei in jede Richtung.
  if (ox > min.x && ox < max.x && oy > min.y && oy < max.y && oz > min.z && oz < max.z) {
    return null;
  }

  // (2) Beruehrung schon beim Start: Mittelpunkt in der aufgeblasenen Kiste.
  const qx = ox < min.x ? min.x : ox > max.x ? max.x : ox;
  const qy = oy < min.y ? min.y : oy > max.y ? max.y : oy;
  const qz = oz < min.z ? min.z : oz > max.z ? max.z : oz;
  const ax = ox - qx, ay = oy - qy, az = oz - qz;
  /*
    Das `+ BERUEHR_LUFT` ist kein Zierrat. Ein Mittelpunkt, der GENAU
    einen Halbmesser vor der Flaeche sitzt, beruehrt sie; ohne die Luft
    faellt er in den Strahlteil (3), und dort beginnt der Strahl EXAKT auf
    der Slab-Grenze der aufgeblasenen Kiste. Ein Strahl, der auf der
    Flaeche beginnt, gilt dem Slab-Verfahren als „von innen" und meldet
    die AUSTRITTSflaeche — deren Normale zeigt in Laufrichtung, der
    Treffer faellt durch die Pruefung „nur was sich naehert", und die
    Figur laeuft hindurch. Auf einem Raster, dessen Standorte auf der
    Wanddicke aufgehen, waren das 2505 von 5659 beruehrenden Schritten.
  */
  if (
    ax < rx + BERUEHR_LUFT && ax > -rx - BERUEHR_LUFT &&
    ay < ry + BERUEHR_LUFT && ay > -ry - BERUEHR_LUFT &&
    az < rz + BERUEHR_LUFT && az > -rz - BERUEHR_LUFT
  ) {
    const l = Math.sqrt(ax * ax + ay * ay + az * az);
    if (l > 1e-12) return { t: 0, nx: ax / l, ny: ay / l, nz: az / l };
    // Mittelpunkt EXAKT auf der Oberflaeche: die naechstliegende Flaeche
    // traegt die Normale.
    let beste = ox - min.x, nx = -1, ny = 0, nz = 0;
    if (max.x - ox < beste) { beste = max.x - ox; nx = 1; ny = 0; nz = 0; }
    if (oy - min.y < beste) { beste = oy - min.y; nx = 0; ny = -1; nz = 0; }
    if (max.y - oy < beste) { beste = max.y - oy; nx = 0; ny = 1; nz = 0; }
    if (oz - min.z < beste) { beste = oz - min.z; nx = 0; ny = 0; nz = -1; }
    if (max.z - oz < beste) { nx = 0; ny = 0; nz = 1; }
    return { t: 0, nx, ny, nz };
  }

  // (3) Strahl gegen die aufgeblasene Kiste. Der Mittelpunkt liegt nach
  //     (2) ausserhalb, es kann also nur die EINTRITTSflaeche kommen.
  return strahlKiste(
    ox, oy, oz, dx, dy, dz, weite,
    min.x - rx, min.y - ry, min.z - rz,
    max.x + rx, max.y + ry, max.z + rz
  );
}

/**
 * Kugel-Sweep gegen eine stehende Kapsel (Baumstamm).
 *
 * Die Minkowski-Summe aus Kapsel und Kugel ist wieder eine Kapsel —
 * dasselbe Achsensegment, Halbmesser r_form + r. Exakt, keine Naeherung
 * (ausser der oben beschriebenen bei ungleichfoermiger Skalierung).
 */
function sweepKapsel(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  cx: number, cz: number, radius: number, yMin: number, yMax: number, rl: number
): LokalTreffer | null {
  // Abstand des Mittelpunkts zum Achsensegment.
  const py = oy < yMin ? yMin : oy > yMax ? yMax : oy;
  const ex = ox - cx, ey = oy - py, ez = oz - cz;
  const l = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (l < radius) return null;                      // Fluchttuer: steckt drin
  if (l < radius + rl + BERUEHR_LUFT) {             // Beruehrung beim Start
    return l > 1e-12 ? { t: 0, nx: ex / l, ny: ey / l, nz: ez / l } : null;
  }
  return strahlKapsel(ox, oy, oz, dx, dy, dz, weite, cx, cz, radius + rl, yMin, yMax);
}

/**
 * Kugel-Sweep gegen ein Segment vom Halbmesser `rl` (Kantenzylinder samt
 * Eckkugeln) — der Rand des Dreiecks, den der Ebenentest nicht abdeckt.
 *
 * Liefert den kleinsten Parameter t in [0, weite], an dem die Kugel das
 * Segment beruehrt, oder −1. Die Richtung `d` ist im Lokalraum NICHT
 * normiert (sie wurde durch die Skalierung geteilt); die Gleichungen
 * stehen deshalb allgemein da, mit `a` statt 1.
 */
function sweepSegment(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, rl: number
): number {
  const r2 = rl * rl;
  let beste = -1;
  const merke = (t: number): void => {
    if (t < 0 || t > weite) return;
    if (beste < 0 || t < beste) beste = t;
  };

  const mx = bx - ax, my = by - ay, mz = bz - az;
  const mm = mx * mx + my * my + mz * mz;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;

  if (mm > 1e-18) {
    const md = mx * dx + my * dy + mz * dz;
    const mw = mx * wx + my * wy + mz * wz;
    // Anteile senkrecht zur Kantenachse — daraus wird der Zylinder.
    const dpx = dx - (mx * md) / mm, dpy = dy - (my * md) / mm, dpz = dz - (mz * md) / mm;
    const wpx = wx - (mx * mw) / mm, wpy = wy - (my * mw) / mm, wpz = wz - (mz * mw) / mm;
    const a = dpx * dpx + dpy * dpy + dpz * dpz;
    const b = 2 * (dpx * wpx + dpy * wpy + dpz * wpz);
    const c = wpx * wpx + wpy * wpy + wpz * wpz - r2;
    if (c <= 0) {
      const s0 = mw / mm;
      if (s0 >= 0 && s0 <= 1) merke(0);
    } else if (a > 1e-18) {
      const disk = b * b - 4 * a * c;
      if (disk >= 0) {
        const t = (-b - Math.sqrt(disk)) / (2 * a);
        const s = (mw + md * t) / mm;
        if (s >= 0 && s <= 1) merke(t);
      }
    }
  }

  // Die beiden Eckkugeln.
  const a2 = dx * dx + dy * dy + dz * dz;
  for (let e = 0; e < 2; e += 1) {
    const px = e === 0 ? ax : bx, py = e === 0 ? ay : by, pz = e === 0 ? az : bz;
    const qx = ox - px, qy = oy - py, qz = oz - pz;
    const c = qx * qx + qy * qy + qz * qz - r2;
    if (c <= 0) { merke(0); continue; }
    if (a2 <= 1e-18) continue;
    const b = 2 * (qx * dx + qy * dy + qz * dz);
    const disk = b * b - 4 * a2 * c;
    if (disk < 0) continue;
    merke((-b - Math.sqrt(disk)) / (2 * a2));
  }

  return beste;
}

/**
 * Kugel-Sweep gegen ein Dreiecksnetz.
 *
 * Je Dreieck drei Stufen, und die teureren laufen nur, wenn die billige
 * nicht reicht:
 *  1. EBENE. Wann beruehrt die Kugel die um rl verschobene Dreiecksebene?
 *     Bleibt der Abstand zur Ebene immer groesser als rl (Kugel entfernt
 *     sich oder ist zu weit weg), faellt das Dreieck hier heraus — das ist
 *     der Fall fuer die allermeisten.
 *  2. FLAECHE. Liegt der Beruehrpunkt IM Dreieck (Baryzentrik), ist der
 *     Treffer gefunden; Normale ist die Ebenennormale.
 *  3. RAND. Sonst koennen es nur die drei Kanten sein — je ein
 *     Segment-Sweep (Zylinder + zwei Eckkugeln). Erster Treffer gewinnt,
 *     Normale = (Kugelmittelpunkt beim Treffer − naechster Punkt auf dem
 *     Segment), normiert.
 *
 * Die Normale wird am Ende nach AUSSEN orientiert (weg vom Mittelpunkt der
 * Huellbox) — aus denselben zwei Gruenden wie bei `strahlNetz`: Ein
 * `_col`-Netz aus einer GLB hat keine verlaessliche Wicklung, und eine
 * gegen die Bewegung gedrehte Normale mauert eine Figur ein, die im Netz
 * steckt.
 */
function sweepNetz(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, weite: number,
  positionen: Float32Array, indizes: Uint32Array, gitter: NetzGitter | null, puffer: number[],
  mx: number, my: number, mz: number, rl: number
): LokalTreffer | null {
  let bestT = -1;
  let bnx = 0, bny = 0, bnz = 0;
  let bkx = 0, bky = 0, bkz = 0; // Beruehrpunkt auf der Flaeche
  let anzahl = indizes.length / 3;
  let liste: number[] | null = null;

  if (gitter) {
    const ex = ox + dx * weite, ey = oy + dy * weite, ez = oz + dz * weite;
    // Die Gitterabfrage muss um den Kugelhalbmesser weiter greifen —
    // sonst faellt genau das Dreieck heraus, das die Kugel seitlich
    // streift, und der Sweep haette dieselbe Luecke wie die Strahlen.
    gitter.sammle(
      Math.min(ox, ex) - rl, Math.min(oy, ey) - rl, Math.min(oz, ez) - rl,
      Math.max(ox, ex) + rl, Math.max(oy, ey) + rl, Math.max(oz, ez) + rl,
      puffer
    );
    liste = puffer;
    anzahl = puffer.length;
  }

  for (let i = 0; i < anzahl; i += 1) {
    const d3 = (liste ? liste[i]! : i) * 3;
    const ia = indizes[d3]! * 3, ib = indizes[d3 + 1]! * 3, ic = indizes[d3 + 2]! * 3;
    const px = positionen[ia]!, py = positionen[ia + 1]!, pz = positionen[ia + 2]!;
    const e1x = positionen[ib]! - px, e1y = positionen[ib + 1]! - py, e1z = positionen[ib + 2]! - pz;
    const e2x = positionen[ic]! - px, e2y = positionen[ic + 1]! - py, e2z = positionen[ic + 2]! - pz;

    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nn = nx * nx + ny * ny + nz * nz;
    if (nn <= 1e-24) continue; // entartetes Dreieck
    const nl = Math.sqrt(nn);
    nx /= nl; ny /= nl; nz /= nl;

    // (1) Ebene. Normale auf die Seite des Mittelpunkts drehen, damit der
    //     Abstand positiv ist.
    let sd = (ox - px) * nx + (oy - py) * ny + (oz - pz) * nz;
    if (sd < 0) { nx = -nx; ny = -ny; nz = -nz; sd = -sd; }
    const dn = dx * nx + dy * ny + dz * nz;
    let tE: number;
    if (sd <= rl + BERUEHR_LUFT) {
      tE = 0;                               // beruehrt die Ebene schon
    } else if (dn < -1e-12) {
      tE = (sd - rl) / -dn;
      if (tE > weite) continue;
    } else {
      continue;                             // Ebene bleibt ausser Reichweite
    }
    if (bestT >= 0 && tE >= bestT) continue; // kann den Bestand nicht schlagen

    // (2) Flaeche: Beruehrpunkt in die Ebene projizieren und baryzentrisch
    //     pruefen. `nn` ist zugleich die Determinante der Baryzentrik.
    const abst = sd + dn * tE;
    const bx = ox + dx * tE - nx * abst;
    const by = oy + dy * tE - ny * abst;
    const bz = oz + dz * tE - nz * abst;
    const vx = bx - px, vy = by - py, vz = bz - pz;
    const d00 = e1x * e1x + e1y * e1y + e1z * e1z;
    const d01 = e1x * e2x + e1y * e2y + e1z * e2z;
    const d11 = e2x * e2x + e2y * e2y + e2z * e2z;
    const d20 = vx * e1x + vy * e1y + vz * e1z;
    const d21 = vx * e2x + vy * e2y + vz * e2z;
    const det = d00 * d11 - d01 * d01;
    if (det <= 1e-24) continue;
    const u = (d11 * d20 - d01 * d21) / det;
    const v = (d00 * d21 - d01 * d20) / det;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      bestT = tE; bnx = nx; bny = ny; bnz = nz; bkx = bx; bky = by; bkz = bz;
      continue;
    }

    // (3) Rand: die drei Kanten als Segment-Sweep.
    const cx = px + e1x, cy = py + e1y, cz = pz + e1z;   // zweiter Eckpunkt
    const ex2 = px + e2x, ey2 = py + e2y, ez2 = pz + e2z; // dritter Eckpunkt
    const grenze = bestT >= 0 && bestT < weite ? bestT : weite;
    for (let e = 0; e < 3; e += 1) {
      const sax = e === 0 ? px : e === 1 ? cx : ex2;
      const say = e === 0 ? py : e === 1 ? cy : ey2;
      const saz = e === 0 ? pz : e === 1 ? cz : ez2;
      const sbx = e === 0 ? cx : e === 1 ? ex2 : px;
      const sby = e === 0 ? cy : e === 1 ? ey2 : py;
      const sbz = e === 0 ? cz : e === 1 ? ez2 : pz;
      const t = sweepSegment(ox, oy, oz, dx, dy, dz, grenze, sax, say, saz, sbx, sby, sbz, rl);
      if (t < 0) continue;
      if (bestT >= 0 && t >= bestT) continue;
      // Normale: vom naechsten Punkt des Segments zum Kugelmittelpunkt.
      const kx = ox + dx * t, ky = oy + dy * t, kz = oz + dz * t;
      const sx2 = sbx - sax, sy2 = sby - say, sz2 = sbz - saz;
      const smm = sx2 * sx2 + sy2 * sy2 + sz2 * sz2;
      let s = smm > 1e-18 ? ((kx - sax) * sx2 + (ky - say) * sy2 + (kz - saz) * sz2) / smm : 0;
      if (s < 0) s = 0; else if (s > 1) s = 1;
      const qx = sax + sx2 * s, qy = say + sy2 * s, qz = saz + sz2 * s;
      let gx = kx - qx, gy = ky - qy, gz = kz - qz;
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (gl <= 1e-12) continue;
      gx /= gl; gy /= gl; gz /= gl;
      bestT = t; bnx = gx; bny = gy; bnz = gz; bkx = qx; bky = qy; bkz = qz;
    }
  }

  if (bestT < 0) return null;
  // Nach aussen orientieren: weg vom Huellbox-Mittelpunkt.
  const rx = bkx - mx, ry = bky - my, rz = bkz - mz;
  if (bnx * rx + bny * ry + bnz * rz < 0) { bnx = -bnx; bny = -bny; bnz = -bnz; }
  return { t: bestT, nx: bnx, ny: bny, nz: bnz };
}

// ── Die Welt ────────────────────────────────────────────────────────

export class Kollisionswelt {
  private quelle: FormQuelle;
  /** Wiederverwendeter Puffer der Gitterabfrage — kein Muell je Strahl. */
  private readonly dreieckPuffer: number[] = [];
  /** Fertige Koerper je ZDO — s. `koerperVon`. Schwach, damit ein
   *  entferntes ZDO nicht als Matrix im Speicher haengen bleibt. */
  private readonly koerperCache = new WeakMap<
    object,
    { koerper: Koerper; form: KollisionsForm; pos: Vector3; rot: { x: number; y: number; z: number; w: number }; rev: number }
  >();

  constructor(
    private readonly zdos: ZDOManager,
    private readonly prefabs: PrefabManager,
    private readonly gelaende: (x: number, z: number) => number,
    quelle: FormQuelle = LEERE_FORMQUELLE
  ) {
    this.quelle = quelle;
  }

  /**
   * Die Umschaltstelle fuer Bauer A's `KollisionsFormen`.
   *
   * Vorgabe ist die leere Quelle: Solange sie steht, rechnet der Server
   * wie vor diesem Umbau. Der Integrator haengt A's Quelle EINMAL hier
   * ein (s. `WovServer.init`), und nichts anderes muss sich aendern.
   */
  setzeFormQuelle(quelle: FormQuelle): void {
    this.quelle = quelle;
  }

  /** Hat der Server ueberhaupt Formen? Nein = Verhalten wie frueher. */
  get hatFormen(): boolean {
    return this.quelle !== LEERE_FORMQUELLE;
  }

  /**
   * Sammelt EINMAL ein, was in Reichweite steht, und gibt die beiden
   * Abfragen darauf zurueck.
   *
   * `reichweite` ist der Weg, den die Figur in diesem Eingabepaket
   * hoechstens zuruecklegt; der Zuschlag fuer die Ausdehnung der Koerper
   * kommt hier dazu.
   */
  nahfeld(mitte: Vector3, reichweite: number): Nahfeld {
    const koerper: Koerper[] = [];
    if (this.quelle !== LEERE_FORMQUELLE) {
      const umkreis = reichweite + 2 * KOERPER_RADIUS + NAHFELD_ZUSCHLAG;
      for (const zdo of this.zdos.getZDOsInRadius(mitte, umkreis)) {
        const prefab = this.prefabs.getByHash(zdo.prefabHash);
        if (!prefab) continue;
        const form = this.quelle.formFuer(prefab.name);
        if (!form) continue;
        koerper.push(this.koerperVon(zdo, prefab, form));
      }
    }
    return this.baueNahfeld(koerper);
  }

  /**
   * Der fertige Koerper eines ZDO — aus dem Zwischenspeicher, wenn sich
   * an ihm nichts geaendert hat.
   *
   * Ein Findling steht still, seit die Zone gestreut wurde; seine
   * Drehmatrix und seine Weltumhuellende jedes Eingabepaket neu zu rechnen
   * ist die Sorte Arbeit, die nur in Messreihen auftaucht: bei 25 Spielern
   * und 20 Hz waeren das 100.000 Quaternion-Aufloesungen je Sekunde fuer
   * Zahlen, die sich nie aendern.
   *
   * Die Gueltigkeit haengt an drei Dingen, und alle drei sind billig zu
   * pruefen: Position und Drehung als OBJEKTE (der ZDO-Speicher setzt sie
   * neu, statt sie zu beschreiben) und die Datenrevision, die jedes
   * `setMember` hochzaehlt — also auch eine geaenderte Skalierung.
   */
  private koerperVon(
    zdo: {
      position: Vector3;
      rotation: { x: number; y: number; z: number; w: number };
      revision: { dataRevision: number };
      getVec3(n: string, d?: Vector3): Vector3;
      getFloat(n: string, d?: number): number;
    },
    prefab: { localScale: Vector3 },
    form: KollisionsForm
  ): Koerper {
    const alt = this.koerperCache.get(zdo);
    if (
      alt !== undefined &&
      alt.pos === zdo.position &&
      alt.rot === zdo.rotation &&
      alt.rev === zdo.revision.dataRevision &&
      alt.form === form
    ) {
      return alt.koerper;
    }
    const koerper = this.baueKoerper(form, zdo.position, zdo.rotation, this.skalierung(zdo, prefab));
    this.koerperCache.set(zdo, {
      koerper, form,
      pos: zdo.position,
      rot: zdo.rotation,
      rev: zdo.revision.dataRevision,
    });
    return koerper;
  }

  /**
   * Ein Nahfeld aus fertigen Koerpern — der Weg fuer Tests und Messbaenke,
   * die keine ZDOs anlegen wollen.
   */
  nahfeldAus(
    eintraege: ReadonlyArray<{ form: KollisionsForm; position: Vector3; rotation?: { x: number; y: number; z: number; w: number }; skalierung?: Vector3 }>
  ): Nahfeld {
    const koerper = eintraege.map((e) =>
      this.baueKoerper(
        e.form,
        e.position,
        e.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
        e.skalierung ?? { x: 1, y: 1, z: 1 }
      )
    );
    return this.baueNahfeld(koerper);
  }

  /**
   * Skalierung eines Exemplars — dieselbe Kette wie im Client
   * (`EntityManager.composeZdoWorld`): ZDO-Member `scale` (ungleichfoermig),
   * sonst `scaleScalar` (gleichfoermig), sonst die `localScale` des
   * Prefabs, sonst 1. Die letzte Stufe ist kein Zierrat: Rock_3/Rock_4
   * stehen mit localScale 2 im Katalog, und wer sie mit 1 rechnet, laesst
   * den Server an halben Felsen vorbeilaufen.
   *
   * ZUM SCHLUSS DIE STUFE. Was hier herauskommt, geht durch
   * `skalierungsStufe` — dieselbe Funktion, die der Client auf dieselbe
   * Zahl anwendet, bevor er sein Havok-Shape baut
   * (`Physics.formFuerSkalierung`). Das ist KEINE Sparmassnahme auf
   * dieser Seite (der Server baut keine Netze nach, er rechnet gegen die
   * Form der Vorlage); es ist die Bedingung dafuer, dass die Ersparnis
   * auf der Client-Seite nicht eine neue Abweichung aufmacht. Rastet nur
   * einer von beiden ein, stehen wieder zwei verschiedene Felsen in
   * derselben Welt — und das ist der Fehler, den diese ganze Datei
   * aufraeumt.
   */
  private skalierung(
    zdo: { getVec3(n: string, d?: Vector3): Vector3; getFloat(n: string, d?: number): number },
    prefab: { localScale: Vector3 }
  ): Vector3 {
    const v = zdo.getVec3('scale', { x: 0, y: 0, z: 0 });
    if (v.x !== 0 || v.y !== 0 || v.z !== 0) return gestufteSkalierung(v);
    const s = zdo.getFloat('scaleScalar', 0);
    if (s !== 0) {
      const g = skalierungsStufe(s);
      return { x: g, y: g, z: g };
    }
    return gestufteSkalierung(prefab.localScale);
  }

  /** T·R·S einmal aufloesen: Drehmatrix, Skalierung, Weltumhuellende. */
  private baueKoerper(
    form: KollisionsForm,
    position: Vector3,
    rotation: { x: number; y: number; z: number; w: number },
    skalierung: Vector3
  ): Koerper {
    const { x, y, z, w } = rotation;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    // Zeilenweise: r[0..2] ist die erste Zeile von R.
    const r = new Float64Array(9);
    r[0] = 1 - 2 * (yy + zz); r[1] = 2 * (xy - wz);     r[2] = 2 * (xz + wy);
    r[3] = 2 * (xy + wz);     r[4] = 1 - 2 * (xx + zz); r[5] = 2 * (yz - wx);
    r[6] = 2 * (xz - wy);     r[7] = 2 * (yz + wx);     r[8] = 1 - 2 * (xx + yy);

    // Lokale Huellbox der Form.
    let lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number;
    if (form.art === 'kapsel') {
      lx0 = form.x - form.radius; lx1 = form.x + form.radius;
      lz0 = form.z - form.radius; lz1 = form.z + form.radius;
      ly0 = form.yMin - form.radius; ly1 = form.yMax + form.radius;
    } else {
      lx0 = form.min.x; ly0 = form.min.y; lz0 = form.min.z;
      lx1 = form.max.x; ly1 = form.max.y; lz1 = form.max.z;
    }

    // Acht Ecken durch T·R·S schicken und wieder umhuellen.
    let hx0 = Infinity, hy0 = Infinity, hz0 = Infinity;
    let hx1 = -Infinity, hy1 = -Infinity, hz1 = -Infinity;
    for (let i = 0; i < 8; i += 1) {
      const ex = (i & 1 ? lx1 : lx0) * skalierung.x;
      const ey = (i & 2 ? ly1 : ly0) * skalierung.y;
      const ez = (i & 4 ? lz1 : lz0) * skalierung.z;
      const wx2 = position.x + r[0]! * ex + r[1]! * ey + r[2]! * ez;
      const wy2 = position.y + r[3]! * ex + r[4]! * ey + r[5]! * ez;
      const wz2 = position.z + r[6]! * ex + r[7]! * ey + r[8]! * ez;
      if (wx2 < hx0) hx0 = wx2; if (wx2 > hx1) hx1 = wx2;
      if (wy2 < hy0) hy0 = wy2; if (wy2 > hy1) hy1 = wy2;
      if (wz2 < hz0) hz0 = wz2; if (wz2 > hz1) hz1 = wz2;
    }

    return {
      form, r, gitter: gitterFuer(form),
      px: position.x, py: position.y, pz: position.z,
      sx: skalierung.x || 1, sy: skalierung.y || 1, sz: skalierung.z || 1,
      hx0, hy0, hz0, hx1, hy1, hz1,
    };
  }

  /**
   * Ein Strahl — oder ein Kugel-Sweep — gegen EINEN Koerper.
   *
   * Der Strahl wird in den Lokalraum der Instanz gebracht (S⁻¹·Rᵀ·(p−T));
   * der Parameter t bleibt dabei derselbe, weil eine affine Abbildung ihn
   * nicht veraendert — die gemeldete Entfernung ist also weiterhin die in
   * der WELT gemessene. Die Normale kommt mit R·(S⁻¹⊙n) zurueck (die
   * inverse Transponierte von R·S), danach normiert.
   *
   * `radius` = 0 ist der reine Strahl (so fragt die BODENabfrage, deren
   * fuenf Versaetze die Standflaeche schon abdecken und die auf die
   * Punktgenauigkeit angewiesen ist). `radius` > 0 fegt eine Kugel dieses
   * Halbmessers den Weg entlang — s. den Abschnittskopf oben. `weite` ist
   * in beiden Faellen der Weg des MITTELPUNKTS.
   */
  private strahl(
    k: Koerper,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    weite: number,
    radius = 0
  ): Treffer | null {
    // Grobpruefung gegen die Weltumhuellende (Slab, ohne Normale), um den
    // Kugelhalbmesser geweitet.
    {
      let t0 = 0, t1 = weite;
      for (let a = 0; a < 3; a += 1) {
        const o = a === 0 ? ox : a === 1 ? oy : oz;
        const d = a === 0 ? dx : a === 1 ? dy : dz;
        const lo = (a === 0 ? k.hx0 : a === 1 ? k.hy0 : k.hz0) - radius;
        const hi = (a === 0 ? k.hx1 : a === 1 ? k.hy1 : k.hz1) + radius;
        if (d > -1e-12 && d < 1e-12) {
          if (o < lo || o > hi) return null;
          continue;
        }
        const inv = 1 / d;
        let a1 = (lo - o) * inv, a2 = (hi - o) * inv;
        if (a1 > a2) { const h = a1; a1 = a2; a2 = h; }
        if (a1 > t0) t0 = a1;
        if (a2 < t1) t1 = a2;
        if (t0 > t1) return null;
      }
    }

    // In den Lokalraum.
    const vx = ox - k.px, vy = oy - k.py, vz = oz - k.pz;
    const lox = (k.r[0]! * vx + k.r[3]! * vy + k.r[6]! * vz) / k.sx;
    const loy = (k.r[1]! * vx + k.r[4]! * vy + k.r[7]! * vz) / k.sy;
    const loz = (k.r[2]! * vx + k.r[5]! * vy + k.r[8]! * vz) / k.sz;
    const ldx = (k.r[0]! * dx + k.r[3]! * dy + k.r[6]! * dz) / k.sx;
    const ldy = (k.r[1]! * dx + k.r[4]! * dy + k.r[7]! * dz) / k.sy;
    const ldz = (k.r[2]! * dx + k.r[5]! * dy + k.r[8]! * dz) / k.sz;

    /*
      Der Kugelhalbmesser in LOKALEN Einheiten. Fuer die Kiste je Achse
      (dann ist der Flaechenversatz in der Welt genau `radius`), fuer
      Kapsel und Netz einer — die groesste der drei Halbachsen, damit die
      Ersatzkugel das Ellipsoid umschliesst und nichts durchrutscht
      (s. Abschnittskopf). Bei gleichfoermiger Skalierung sind beide gleich.
    */
    const sMin = Math.min(Math.abs(k.sx), Math.abs(k.sy), Math.abs(k.sz));

    let lok: LokalTreffer | null;
    if (k.form.art === 'kiste') {
      if (radius === 0) {
        lok = strahlKiste(
          lox, loy, loz, ldx, ldy, ldz, weite,
          k.form.min.x, k.form.min.y, k.form.min.z,
          k.form.max.x, k.form.max.y, k.form.max.z
        );
      } else {
        lok = sweepKiste(
          lox, loy, loz, ldx, ldy, ldz, weite, k.form.min, k.form.max,
          radius / Math.abs(k.sx), radius / Math.abs(k.sy), radius / Math.abs(k.sz)
        );
      }
    } else if (k.form.art === 'kapsel') {
      lok = radius === 0
        ? strahlKapsel(lox, loy, loz, ldx, ldy, ldz, weite, k.form.x, k.form.z, k.form.radius, k.form.yMin, k.form.yMax)
        : sweepKapsel(lox, loy, loz, ldx, ldy, ldz, weite, k.form.x, k.form.z, k.form.radius, k.form.yMin, k.form.yMax, radius / sMin);
    } else {
      const mmx = (k.form.min.x + k.form.max.x) / 2;
      const mmy = (k.form.min.y + k.form.max.y) / 2;
      const mmz = (k.form.min.z + k.form.max.z) / 2;
      lok = radius === 0
        ? strahlNetz(
            lox, loy, loz, ldx, ldy, ldz, weite,
            k.form.positionen, k.form.indizes, k.gitter, this.dreieckPuffer, mmx, mmy, mmz
          )
        : sweepNetz(
            lox, loy, loz, ldx, ldy, ldz, weite,
            k.form.positionen, k.form.indizes, k.gitter, this.dreieckPuffer, mmx, mmy, mmz,
            radius / sMin
          );
    }
    if (lok === null) return null;

    // Normale zurueck in den Weltraum: R·(S⁻¹⊙n), das ist die inverse
    // Transponierte von R·S. Danach normieren, weil S sie laengt.
    const nx0 = lok.nx / k.sx, ny0 = lok.ny / k.sy, nz0 = lok.nz / k.sz;
    const wx = k.r[0]! * nx0 + k.r[1]! * ny0 + k.r[2]! * nz0;
    const wy = k.r[3]! * nx0 + k.r[4]! * ny0 + k.r[5]! * nz0;
    const wz = k.r[6]! * nx0 + k.r[7]! * ny0 + k.r[8]! * nz0;
    const l = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (l <= 1e-12) return null;
    const nx = wx / l, ny = wy / l, nz = wz / l;

    /*
      `punkt` ist der Punkt auf der FLAECHE, nicht der Mittelpunkt der
      Kugel. Beim reinen Strahl (radius = 0) sind beide dasselbe und die
      Rechnung faellt weg — die Bodenabfrage bekommt Bit fuer Bit, was sie
      vorher bekam. Beim Sweep steht der Mittelpunkt einen Halbmesser VOR
      der Flaeche; wer den als Trefferpunkt meldet, meldet einen Punkt in
      der Luft, und `kollision-einhaengung` misst genau das (sie haelt den
      Treffer gegen die Huellbox der Form).
    */
    const mx2 = ox + dx * lok.t, my2 = oy + dy * lok.t, mz2 = oz + dz * lok.t;
    return {
      normale: { x: nx, y: ny, z: nz },
      abstand: lok.t,
      punkt: radius === 0
        ? { x: mx2, y: my2, z: mz2 }
        : { x: mx2 - nx * radius, y: my2 - ny * radius, z: mz2 - nz * radius },
    };
  }

  /** Die beiden Abfragen ueber einer festen Koerperliste. */
  private baueNahfeld(koerper: readonly Koerper[]): Nahfeld {
    const gelaende = this.gelaende;
    const selbst = this;
    /*
      Vorfilter je Abfrage — und der lohnt sich, weil eine Abfrage sechs
      Strahlen wirft und ein Bodenblick fuenf. Ohne ihn liefe JEDER Strahl
      gegen JEDEN Koerper des Nahfelds: bei 200 Formen sind das ueber
      14.000 Slab-Tests je Eingabepaket (gemessen 0,81 ms). Der Weg eines
      Schritts ist aber nur 12,5 cm lang; was ihn nicht einmal mit seiner
      Huellbox beruehrt, faellt hier mit sechs Vergleichen heraus statt
      mit drei Divisionen je Strahl.
    */
    // Zwei Puffer, nicht einer: `gleitBewegung` fragt den Boden MITTEN im
    // Aufbau einer Hindernisabfrage (das Ziel des Suchwegs liegt auf der
    // Bodenhoehe). Ein geteilter Puffer wuerde dabei unter der laufenden
    // Schleife ausgetauscht — der klassische Fehler, den niemand sieht,
    // weil er nur bei bestimmten Standorten zuschlaegt.
    const pufferWand: Koerper[] = [];
    const pufferBoden: Koerper[] = [];
    const vorfilter = (
      ziel: Koerper[],
      x0: number, y0: number, z0: number, x1: number, y1: number, z1: number
    ): Koerper[] => {
      ziel.length = 0;
      for (const k of koerper) {
        if (k.hx1 < x0 || k.hx0 > x1) continue;
        if (k.hy1 < y0 || k.hy0 > y1) continue;
        if (k.hz1 < z0 || k.hz0 > z1) continue;
        ziel.push(k);
      }
      return ziel;
    };

    return {
      anzahl: koerper.length,

      /**
       * Hoehe unter `(x, z)`: Gelaende ODER die hoechste nach oben
       * gerichtete Flaeche, die ein Bodenstrahl von einer Stufenhoehe
       * ueber den Fuessen nach unten findet.
       *
       * Ohne den zweiten Teil steht die Serverfigur AUF JEDEM FELSEN in
       * der Gelaendehoehe, waehrend der Client oben steht — mehrere Meter
       * y-Drift, sichtbar als Ruck, sobald der weiche Abgleich anzieht.
       *
       * FUENF Strahlen, nicht einer: Das Original setzt die Figur mit
       * einem Kapsel-Sweep auf; ein einzelner Fussstrahl faellt zwischen
       * zwei konvexen Felsnetzen in die Luecke und meldet dort das
       * Gelaende. Mitte plus vier Versaetze bei 0,7·r decken die
       * Standflaeche ab, der HOECHSTE Treffer traegt — wie bei einer
       * Kapsel, die auf der obersten Kante aufliegt.
       */
      hoeheBei(x: number, z: number, yFuss: number): number | null {
        const boden = gelaende(x, z);
        if (koerper.length === 0) return boden;
        const oy = yFuss + STUFEN_HOEHE + BODEN_START_LUFT;
        const v = KOERPER_RADIUS * BODEN_VERSATZ;
        const nahe = vorfilter(pufferBoden, x - v, oy - BODEN_TIEFE, z - v, x + v, oy, z + v);
        if (nahe.length === 0) return boden;
        let hoechste = boden;
        for (let f = 0; f < 5; f += 1) {
          const px = x + (f === 1 ? -v : f === 2 ? v : 0);
          const pz = z + (f === 3 ? -v : f === 4 ? v : 0);
          for (const k of nahe) {
            const t = selbst.strahl(k, px, oy, pz, 0, -1, 0, BODEN_TIEFE + BODEN_START_LUFT);
            if (t === null) continue;
            // Nur begehbare Flaechen tragen: Die Flanke eines Felsens ist
            // kein Boden, sonst stuende die Figur in der Wand.
            if (istWand(t.normale)) continue;
            if (t.punkt.y > hoechste) hoechste = t.punkt.y;
          }
        }
        return hoechste;
      },

      /**
       * ZWEI Kugel-Sweeps: je Hoehe eine Kugel vom Halbmesser `radius`,
       * die den Weg von `von` nach `nach` entlangfaehrt.
       *
       * Bis zum 11.09.2026 standen hier sechs STRAHLEN — zwei Hoehen mal
       * drei Versaetze quer zur Laufrichtung. Warum das nicht reicht und
       * was der Sweep stattdessen tut, steht im Abschnittskopf
       * „Kugel-Sweep gegen eine Form" weiter oben; die Kurzfassung: Ein
       * Wandende, das lateral ZWISCHEN zwei Strahlen liegt, wird von
       * keinem getroffen, und die Figur laeuft durch die Hausecke.
       *
       * Die Hoehen aus `masse.ts` bleiben, was sie sind. Die UNTERE Kugel
       * sitzt mit ihrem Mittelpunkt um `radius` hoeher, damit ihre
       * Unterseite genau auf `STRAHL_HOEHEN[0]` liegt — sonst waere die
       * Stufenregel dahin (ein 0,40-m-Absatz wuerde blockieren). Die obere
       * behaelt ihren Mittelpunkt auf Brusthoehe.
       *
       * Kein Kapsel-Sweep ueber die ganze Koerperhoehe: Ein gefegter
       * Koerper, der bis zu den Fuessen reicht, faengt auf jedem Hang das
       * Gelaende unter sich ein — die zwei Hoehen SIND die Stufen- und
       * Hangregel, und die soll ein Sweep nicht ersetzen, sondern erben.
       */
      ersterTreffer(von: Vek3, nach: Vek3, radius: number): Treffer | null {
        if (koerper.length === 0) return null;
        const wx = nach.x - von.x;
        const wz = nach.z - von.z;
        const weg = Math.sqrt(wx * wx + wz * wz);
        if (weg === 0) return null;

        const vx = wx / weg;
        const vz = wz / weg;
        // Der MITTELPUNKT faehrt genau den Weg; den Radius bringt die
        // Kugel selbst mit (frueher lag er als Zuschlag auf der Weite).
        const weite = weg;

        /*
          Alles, was die beiden Kugeln zusammen ueberstreichen, in EINER
          Huellbox. Waagerecht: der Weg, um den Halbmesser nach allen
          Seiten geweitet. Senkrecht: von der Unterseite der unteren Kugel
          (= `STRAHL_HOEHEN[0]`, unveraendert gegenueber dem Strahlenbau)
          bis zur Oberseite der oberen.
        */
        const nahe = vorfilter(
          pufferWand,
          Math.min(von.x, von.x + vx * weite) - radius,
          Math.min(von.y, nach.y) + STRAHL_HOEHEN[0]!,
          Math.min(von.z, von.z + vz * weite) - radius,
          Math.max(von.x, von.x + vx * weite) + radius,
          Math.max(von.y, nach.y) + STRAHL_HOEHEN[STRAHL_HOEHEN.length - 1]! + radius,
          Math.max(von.z, von.z + vz * weite) + radius
        );
        if (nahe.length === 0) return null;

        // Die Kugeln folgen dem Hoehenunterschied der Bewegung, damit sie
        // an einer Steigung nicht in den Berg zeigen.
        const dy = (nach.y - von.y) / weite;
        const laenge = Math.sqrt(1 + dy * dy);
        const dx = vx / laenge, dz = vz / laenge, dyn = dy / laenge;
        const strecke = weite * laenge;

        let naechster: Treffer | null = null;
        for (let h = 0; h < STRAHL_HOEHEN.length; h += 1) {
          // Untere Kugel: Unterseite auf der Strahlhoehe (s. Kopf).
          const hoehe = h === 0 ? STRAHL_HOEHEN[h]! + radius : STRAHL_HOEHEN[h]!;
          for (const k of nahe) {
            const t = selbst.strahl(k, von.x, von.y + hoehe, von.z, dx, dyn, dz, strecke, radius);
            if (t === null) continue;
            // Hang oder Stufe, keine Wand: Darueber laeuft die Figur,
            // die Bodenabfrage hebt sie an.
            if (!istWand(t.normale)) continue;
            // Nur was sich NAEHERT, steht im Weg (s. `abfragen.ts`). Das
            // ist zugleich die Regel, die eine BERUEHRUNG beim Start
            // richtig herum aufloest: weiter in die Wand ist blockiert,
            // von ihr weg ist frei.
            const flach = Math.sqrt(t.normale.x * t.normale.x + t.normale.z * t.normale.z);
            if (flach <= 1e-9) continue;
            const naeherung = (wx * t.normale.x + wz * t.normale.z) / flach;
            if (naeherung > -1e-6) continue;
            if (naechster === null || t.abstand < naechster.abstand) naechster = t;
          }
        }
        return naechster;
      },
    };
  }
}
