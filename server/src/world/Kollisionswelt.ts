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
import type { BodenAbfrage, HindernisAbfrage, Treffer } from '@wov/shared/src/bewegung/abfragen.js';
import {
  BODEN_VERSATZ,
  KOERPER_RADIUS,
  STEIGUNGS_GRENZE_COS,
  STRAHL_HOEHEN,
  STUFEN_HOEHE,
} from '@wov/shared/src/bewegung/masse.js';
import type { Vector3 } from '@wov/shared';
import type { ZDOManager } from '../zdo/ZDOManager.js';
import type { PrefabManager } from '../prefab/PrefabManager.js';

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
  min: Vek3, max: Vek3
): LokalTreffer | null {
  let tMin = 0;
  let tMax = weite;
  let achseEin = -1, seiteEin = 1;
  let achseAus = -1, seiteAus = 1;

  for (let a = 0; a < 3; a += 1) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const lo = a === 0 ? min.x : a === 1 ? min.y : min.z;
    const hi = a === 0 ? max.x : a === 1 ? max.y : max.z;
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

// ── Die Welt ────────────────────────────────────────────────────────

export class Kollisionswelt {
  private quelle: FormQuelle;
  /** Wiederverwendeter Puffer der Gitterabfrage — kein Muell je Strahl. */
  private readonly dreieckPuffer: number[] = [];

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
        koerper.push(this.baueKoerper(form, zdo.position, zdo.rotation, this.skalierung(zdo, prefab)));
      }
    }
    return this.baueNahfeld(koerper);
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
   */
  private skalierung(
    zdo: { getVec3(n: string, d?: Vector3): Vector3; getFloat(n: string, d?: number): number },
    prefab: { localScale: Vector3 }
  ): Vector3 {
    const v = zdo.getVec3('scale', { x: 0, y: 0, z: 0 });
    if (v.x !== 0 || v.y !== 0 || v.z !== 0) return v;
    const s = zdo.getFloat('scaleScalar', 0);
    if (s !== 0) return { x: s, y: s, z: s };
    return prefab.localScale;
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
   * Ein Strahl gegen EINEN Koerper.
   *
   * Der Strahl wird in den Lokalraum der Instanz gebracht (S⁻¹·Rᵀ·(p−T));
   * der Parameter t bleibt dabei derselbe, weil eine affine Abbildung ihn
   * nicht veraendert — die gemeldete Entfernung ist also weiterhin die in
   * der WELT gemessene. Die Normale kommt mit R·(S⁻¹⊙n) zurueck (die
   * inverse Transponierte von R·S), danach normiert.
   */
  private strahl(
    k: Koerper,
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    weite: number
  ): Treffer | null {
    // Grobpruefung gegen die Weltumhuellende (Slab, ohne Normale).
    {
      let t0 = 0, t1 = weite;
      for (let a = 0; a < 3; a += 1) {
        const o = a === 0 ? ox : a === 1 ? oy : oz;
        const d = a === 0 ? dx : a === 1 ? dy : dz;
        const lo = a === 0 ? k.hx0 : a === 1 ? k.hy0 : k.hz0;
        const hi = a === 0 ? k.hx1 : a === 1 ? k.hy1 : k.hz1;
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

    let lok: LokalTreffer | null;
    if (k.form.art === 'kiste') {
      lok = strahlKiste(lox, loy, loz, ldx, ldy, ldz, weite, k.form.min, k.form.max);
    } else if (k.form.art === 'kapsel') {
      lok = strahlKapsel(lox, loy, loz, ldx, ldy, ldz, weite, k.form.x, k.form.z, k.form.radius, k.form.yMin, k.form.yMax);
    } else {
      lok = strahlNetz(
        lox, loy, loz, ldx, ldy, ldz, weite,
        k.form.positionen, k.form.indizes, k.gitter, this.dreieckPuffer,
        (k.form.min.x + k.form.max.x) / 2,
        (k.form.min.y + k.form.max.y) / 2,
        (k.form.min.z + k.form.max.z) / 2
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

    return {
      normale: { x: nx, y: ny, z: nz },
      abstand: lok.t,
      punkt: { x: ox + dx * lok.t, y: oy + dy * lok.t, z: oz + dz * lok.t },
    };
  }

  /** Die beiden Abfragen ueber einer festen Koerperliste. */
  private baueNahfeld(koerper: readonly Koerper[]): Nahfeld {
    const gelaende = this.gelaende;
    const selbst = this;

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
        const oy = yFuss + STUFEN_HOEHE;
        const v = KOERPER_RADIUS * BODEN_VERSATZ;
        let hoechste = boden;
        for (let f = 0; f < 5; f += 1) {
          const px = x + (f === 1 ? -v : f === 2 ? v : 0);
          const pz = z + (f === 3 ? -v : f === 4 ? v : 0);
          for (const k of koerper) {
            const t = selbst.strahl(k, px, oy, pz, 0, -1, 0, BODEN_TIEFE);
            if (t === null) continue;
            // Nur begehbare Flaechen tragen: Die Flanke eines Felsens ist
            // kein Boden, sonst stuende die Figur in der Wand.
            if (t.normale.y < STEIGUNGS_GRENZE_COS) continue;
            if (t.punkt.y > hoechste) hoechste = t.punkt.y;
          }
        }
        return hoechste;
      },

      /**
       * Sechs Strahlen: zwei Hoehen ueber den Fuessen, je drei seitliche
       * Versaetze (−r / 0 / +r), jeder reicht einen Radius ueber das Ziel
       * hinaus — so haelt die Figur VOR der Wand statt in ihr.
       *
       * Kein Kapselwurf: Ein gefegter Koerper faengt auf jedem Hang das
       * Gelaende unter den eigenen Fuessen ein; Strahlen lassen sich
       * genau dorthin zielen, wo eine Wand waere, und ihre HOEHEN sind
       * zugleich die Stufenregel.
       */
      ersterTreffer(von: Vek3, nach: Vek3, radius: number): Treffer | null {
        if (koerper.length === 0) return null;
        const wx = nach.x - von.x;
        const wz = nach.z - von.z;
        const weg = Math.sqrt(wx * wx + wz * wz);
        if (weg === 0) return null;

        const vx = wx / weg;
        const vz = wz / weg;
        // Quer zur Laufrichtung — der Versatz der Schulterstrahlen.
        const qx = -vz;
        const qz = vx;
        const weite = weg + radius;

        let naechster: Treffer | null = null;
        for (const hoehe of STRAHL_HOEHEN) {
          // Die Strahlen folgen dem Hoehenunterschied der Bewegung, damit
          // sie an einer Steigung nicht in den Berg zeigen.
          const dy = (nach.y - von.y) / weite;
          const laenge = Math.sqrt(1 + dy * dy);
          const dx = vx / laenge, dz = vz / laenge, dyn = dy / laenge;
          const strecke = weite * laenge;
          for (let s = -1; s <= 1; s += 1) {
            const ox = von.x + qx * radius * s;
            const oz = von.z + qz * radius * s;
            for (const k of koerper) {
              const t = selbst.strahl(k, ox, von.y + hoehe, oz, dx, dyn, dz, strecke);
              if (t === null) continue;
              // Hang oder Stufe, keine Wand: Darueber laeuft die Figur,
              // die Bodenabfrage hebt sie an.
              if (t.normale.y >= STEIGUNGS_GRENZE_COS) continue;
              // Nur was sich NAEHERT, steht im Weg (s. `abfragen.ts`).
              const flach = Math.sqrt(t.normale.x * t.normale.x + t.normale.z * t.normale.z);
              if (flach <= 1e-9) continue;
              const naeherung = (wx * t.normale.x + wz * t.normale.z) / flach;
              if (naeherung > -1e-6) continue;
              if (naechster === null || t.abstand < naechster.abstand) naechster = t;
            }
          }
        }
        return naechster;
      },
    };
  }
}
