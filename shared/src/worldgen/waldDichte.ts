/**
 * Walddichte — wie viele Bäume die Streuung um einen Punkt erwarten lässt.
 * Forest density: how many trees the scatter run expects around a point.
 *
 * Die Quelle ist DIESELBE, nach der der Server die Bäume setzt
 * (`streuung.ts`): die Streutabelle `FOLIAGE`, der Waldfaktor des
 * Geländes (`getForestFactor`, in der Layoutwelt mit `forestDensity` und
 * `waldKoernung` der Region) und die Kuratierungsliste der Region
 * (`vegetation`, exklusiv), skaliert mit `bewuchsDichte`. Ein Baum wächst
 * dort, wo sein Fenster `[forestTresholdMin, forestTresholdMax]` den
 * Waldfaktor enthält; je Zone (64 × 64 m) werden `min…max` Stück versucht.
 * `baumErwartung` summiert genau das für einen Waldfaktor, `baeumeImUmkreis`
 * mittelt es über eine Kreisscheibe (40 m) und rechnet auf die Fläche um.
 *
 * Die Zahl ist eine ERWARTUNG (Zufall, Hang, Höhe, Mindestabstand und
 * Freiflächen drücken den echten Wert), keine Zählung; `shared/test/
 * wald-dichte.ts` misst sie gegen die tatsächlich gestreuten Bäume. Ohne
 * Region (Radialwelt) und ohne Kuratierungsliste wächst kein Baum, also ist
 * der Wert 0 — wie in der Streuung.
 *
 * Reine Rechnung, keine Engine. B3 (Ton je Region) kann die Kurve später je
 * Region überschreiben: `waldStufe` nimmt die Grenzen als Parameter.
 */
import { FOLIAGE } from '../vegetation.js';

/** Radius der Kreisscheibe (m), über die gemittelt wird; 40 m korreliert mit der echten Zählung besser als 25 m (siehe wald-dichte.ts). */
export const WALD_RADIUS = 40;
const ZONENFLAECHE = 64 * 64;

/**
 * Baumarten der Streutabelle: die Store-Bäume (`vegetation-tree-…`, `-pine-`,
 * `-massive-tree-`, `-split-tree-`, `-small-thin-tree-`, `-branched-tree-`) und
 * die älteren eigenen (Eiche, Birke, Kiefer, Fichte, Tanne). Büsche, Blumen,
 * Äste und Felsen zählen nicht.
 */
export function istWaldbaum(prefabName: string): boolean {
  return /^(vegetation-(tree|pine|massive-tree|split-tree|small-thin-tree|branched-tree)-\d|(Eiche|Birke|Kiefer|Fichte|Tanne)\d)/.test(prefabName);
}

/** Was die Dichte von der Welt braucht: der Waldfaktor und (Layoutwelt) die Region. */
export interface WaldQuelle {
  getForestFactor(x: number, z: number): number;
  /** Nur in der Layoutwelt. Fehlt sie, gibt es keine Kuratierung und damit keinen Baum. */
  regionAt?(x: number, z: number): { vegetation?: readonly string[]; bewuchsDichte?: number } | null;
}

/** Erwartete Bäume je Zone bei diesem Waldfaktor, für die erlaubten Arten (`null` = alle). */
export function baumErwartung(waldfaktor: number, erlaubt: readonly string[] | null): number {
  let summe = 0;
  for (const v of FOLIAGE) {
    if (!istWaldbaum(v.prefabName)) continue;
    if (erlaubt && !erlaubt.includes(v.prefabName)) continue;
    // Das Fenster gilt nur mit `inForest`; ohne die Bedingung wächst die Art überall (wie in der Streuung).
    if (v.inForest && (waldfaktor < v.forestTresholdMin || waldfaktor > v.forestTresholdMax)) continue;
    // max < 1: Wahrscheinlichkeit für ein Stück; sonst Gleichverteilung min..max.
    // `min…max` zählt Gruppen; jede Gruppe bringt groupSizeMin…groupSizeMax Stämme.
    const gruppen = v.max < 1 ? v.max : (v.min + v.max) / 2;
    summe += gruppen * ((v.groupSizeMin + v.groupSizeMax) / 2);
  }
  return summe;
}

const MUSTER_RADIUS = 25;
const STUFE = 0.01;
const TABELLEN_MAX = 2;
const tabellen = new WeakMap<readonly string[], Float32Array>();
let tabelleAlle: Float32Array | null = null;

function baueTabelle(erlaubt: readonly string[] | null): Float32Array {
  const t = new Float32Array(Math.round(TABELLEN_MAX / STUFE) + 1);
  for (let i = 0; i < t.length; i++) t[i] = baumErwartung(i * STUFE, erlaubt);
  return t;
}

function tabelleFuer(erlaubt: readonly string[] | null): Float32Array {
  if (erlaubt === null) return (tabelleAlle ??= baueTabelle(null));
  let t = tabellen.get(erlaubt);
  if (!t) {
    t = baueTabelle(erlaubt);
    tabellen.set(erlaubt, t);
  }
  return t;
}

/** Erwartete Bäume je Zone an einem Punkt (Tabelle je Kuratierungsliste, Stufe 0,01 im Waldfaktor). */
export function baumErwartungBei(x: number, z: number, quelle: WaldQuelle): number {
  const region = quelle.regionAt?.(x, z);
  if (!region?.vegetation) return 0; // ohne Kuratierungsliste wächst nichts
  const faktor = quelle.getForestFactor(x, z);
  if (!(faktor >= 0)) return 0;
  const i = Math.min(Math.round(faktor / STUFE), Math.round(TABELLEN_MAX / STUFE));
  return tabelleFuer(region.vegetation)[i] * (region.bewuchsDichte ?? 1);
}

/** Abtastmuster der Scheibe für 25 m (mit Radius/25 skaliert): Mitte, 8 Punkte bei 10 m, 16 bei 20 m (Gewicht ~ Fläche des Rings). */
const MUSTER: readonly { dx: number; dz: number }[] = (() => {
  const p = [{ dx: 0, dz: 0 }];
  for (const [n, r, versatz] of [[8, 10, 0.2], [16, 20, 0.1]] as const) {
    for (let k = 0; k < n; k++) {
      const w = ((k / n) + versatz) * Math.PI * 2;
      p.push({ dx: Math.cos(w) * r, dz: Math.sin(w) * r });
    }
  }
  return p;
})();

/**
 * Erwartete Bäume in der Kreisscheibe von `WALD_RADIUS` um (x, z): Mittel der
 * Zonenerwartung über 25 Abtastpunkte, mal Scheibenfläche durch Zonenfläche.
 */
export function baeumeImUmkreis(x: number, z: number, quelle: WaldQuelle, radius = WALD_RADIUS): number {
  const k = radius / MUSTER_RADIUS;
  let s = 0;
  for (const m of MUSTER) s += baumErwartungBei(x + m.dx * k, z + m.dz * k, quelle);
  return (s / MUSTER.length) * ((Math.PI * radius * radius) / ZONENFLAECHE);
}

/**
 * Kurve Baumzahl → Stufe 0..1: unter `von` still, ab `voll` volle Stufe,
 * dazwischen weich (Smoothstep), überall monoton steigend.
 */
export function waldStufe(baeume: number, von: number, voll: number): number {
  if (!(baeume > von)) return 0;
  if (baeume >= voll) return 1;
  const t = (baeume - von) / (voll - von);
  return t * t * (3 - 2 * t);
}
