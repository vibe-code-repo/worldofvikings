/**
 * Kartenauswertung — zwei reine Rechnungen über ein WorldLayout, beide
 * DOM-frei (siehe test/karten-auswertung.ts):
 *
 *  - zellUeberlappungen (B6 der Roadmap): wo mehr Regionen um dieselbe
 *    Rasterzelle konkurrieren, als das Kompilat (RegionField, compile.ts)
 *    sich pro Zelle merken kann. `fuelleChunk` dort hält bis zu
 *    MAX_KANDIDATEN (aktuell 4, siehe compile.ts) Kandidaten je Zelle;
 *    kommt ein fünfter hinzu, verdrängt er den mit dem NIEDRIGSTEN
 *    Regions-Index — still, ohne Meldung. Trifft das den tatsächlichen
 *    Gewinner der Z-Regel nicht (der ist ohnehin meist der höchste
 *    Index), bleibt es folgenlos; trifft es ihn doch, zeigt die Karte an
 *    dieser Stelle eine andere Region, als der Designer eingegeben hat.
 *    Genau das soll hier auffallen, BEVOR es als falsch aussehende Küste
 *    im Spiel auffällt.
 *
 *  - flaechenBericht (B7): Landfläche gesamt und je Biom, sowie Regionen
 *    ohne jede Platzierung — für die Kopfzeile des Editors.
 *
 * Beide teilen sich denselben Rasterschritt wie compile.ts (32 m,
 * FIELD_CELL_SIZE, Zentrumsabtastung) und dieselbe Reichweiten-Formel
 * (edgeFalloff + MARGE) — nicht, weil das geometrisch zwingend wäre,
 * sondern damit "wird hier verdrängt" und "wird dort gebaut" exakt
 * dieselbe Zelle meinen. `signedDistance` selbst kommt UNVERÄNDERT aus
 * compile.ts (Import, keine zweite Fassung) — das ist die Funktion, die
 * auch Server und Client fürs echte Terrain rechnen, und eine eigene
 * Nachbildung wäre genau die Art Abweichung, die die Testlehren aus der
 * Nacht auf den 20.08. verbieten.
 *
 * Beide Rechnungen iterieren bewusst NUR die Zellen im
 * Reichweiten-Rechteck jeder einzelnen Region (wie `RegionField.compile`)
 * und NICHT die Bounding-Box des gesamten Layouts: Die Dev-Welt spannt
 * über 40 km auf, während jede einzelne Insel nur wenige hundert bis
 * wenige tausend Meter misst — ein Scan über die volle Ausdehnung würde
 * tausendfach mehr leere Zellen als belegte durchlaufen.
 *
 * Unterschied zu RegionField: Hier wird NICHT auf MAX_KANDIDATEN
 * gekappt — `zellUeberlappungen` braucht die volle Trefferliste, um die
 * Kappung überhaupt zu bewerten, und `flaechenBericht` braucht den
 * WIRKLICHEN Gewinner (sonst wäre die Flächenanzeige an genau den
 * Stellen falsch, die B6 als Bug meldet).
 */

import { signedDistance, FIELD_CELL_SIZE, MAX_KANDIDATEN, MARGE } from './compile.js';
import { shapeBounds, type BiomeName, type WorldLayout } from './types.js';

/** Fläche einer Rasterzelle in m² (32 m × 32 m). */
const ZELLFLAECHE = FIELD_CELL_SIZE * FIELD_CELL_SIZE;

/** Zellmitte einer Rasterkoordinate in Weltmetern — dieselbe +0,5-Regel wie `RegionField.fuelleChunk`. */
function zellMitte(g: number): number {
  return g * FIELD_CELL_SIZE + FIELD_CELL_SIZE / 2;
}

/**
 * Rasterzelle (32 m) → eindeutige Zahl statt `${gx},${gz}` — dieselbe
 * Begründung wie `rasterSchluessel` in compile.ts (keine Zeichenkette je
 * Zelle bei zehntausenden Abfragen). Eigener Versatz/Faktor, weil dieses
 * Raster direkt in 32-m-Schritten zählt statt in 1024-m-Chunks: Die
 * Werte dürfen mit denen aus compile.ts nicht verglichen werden, nur
 * innerhalb dieser Datei müssen sie eindeutig sein.
 */
const ZELL_VERSATZ = 1 << 21; // deckt ±2,097 Mio. Zellen (~67.000 km) je Achse — LAYOUT_MAX_EXTENT ist 40 km.
const ZELL_FAKTOR = 1 << 22;
function zellSchluessel(gx: number, gz: number): number {
  return (gx + ZELL_VERSATZ) * ZELL_FAKTOR + (gz + ZELL_VERSATZ);
}
function zellAusSchluessel(key: number): { gx: number; gz: number } {
  const gx = Math.floor(key / ZELL_FAKTOR) - ZELL_VERSATZ;
  const gz = (key - (gx + ZELL_VERSATZ) * ZELL_FAKTOR) - ZELL_VERSATZ;
  return { gx, gz };
}

/**
 * Rasterzellen im Reichweiten-Rechteck einer Region ablaufen — dieselbe
 * Bbox-plus-Reichweite-Herleitung wie `RegionField.compile`, nur ohne
 * Chunk-Zwischenschritt. `bei` bekommt Zellkoordinate und -mitte; der
 * Aufrufer entscheidet selbst, ob der Punkt zählt (Kandidat vs. Gewinner
 * brauchen unterschiedliche Schwellen, siehe unten).
 */
function fuerRegion(
  region: WorldLayout['regions'][number],
  bei: (gx: number, gz: number, x: number, z: number) => void
): void {
  const reichweite = region.edgeFalloff + MARGE;
  const b = shapeBounds(region.shape);
  const gx0 = Math.floor((b.minX - reichweite) / FIELD_CELL_SIZE);
  const gx1 = Math.floor((b.maxX + reichweite) / FIELD_CELL_SIZE);
  const gz0 = Math.floor((b.minZ - reichweite) / FIELD_CELL_SIZE);
  const gz1 = Math.floor((b.maxZ + reichweite) / FIELD_CELL_SIZE);
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      bei(gx, gz, zellMitte(gx), zellMitte(gz));
    }
  }
}

// ── B6: Zellbelegung / Überlappungswarnung ─────────────────────────────

/** Eine Rasterzelle, in der mehr Regionen konkurrieren, als das Kompilat sich merken kann. */
export interface ZellBefund {
  /** Weltkoordinate der Zellmitte. */
  x: number;
  z: number;
  /** Anzahl der Regionen, deren Reichweite diese Zelle tatsächlich erreicht. */
  anzahl: number;
  /** Deren IDs, in Layout-Reihenfolge (= Z-Ordnung). */
  regionen: readonly string[];
}

/**
 * Alle Rasterzellen, in denen mehr als MAX_KANDIDATEN Regionen um einen
 * Platz konkurrieren (dieselbe Aufnahmeschwelle wie `fuelleChunk`:
 * `signedDistance > -reichweite`). Absteigend nach Anzahl sortiert, bei
 * Gleichstand nach Position — für eine stabile, wiederholbare Liste im
 * Editor.
 */
export function zellUeberlappungen(layout: WorldLayout): ZellBefund[] {
  const treffer = new Map<number, number[]>(); // Zellschlüssel -> Regions-Indizes

  for (let ri = 0; ri < layout.regions.length; ri++) {
    const region = layout.regions[ri]!;
    const reichweite = region.edgeFalloff + MARGE;
    fuerRegion(region, (gx, gz, x, z) => {
      if (signedDistance(region.shape, x, z) <= -reichweite) return;
      const key = zellSchluessel(gx, gz);
      let liste = treffer.get(key);
      if (!liste) {
        liste = [];
        treffer.set(key, liste);
      }
      liste.push(ri);
    });
  }

  const befunde: ZellBefund[] = [];
  for (const [key, regionIdx] of treffer) {
    if (regionIdx.length <= MAX_KANDIDATEN) continue;
    const { gx, gz } = zellAusSchluessel(key);
    befunde.push({
      x: zellMitte(gx),
      z: zellMitte(gz),
      anzahl: regionIdx.length,
      regionen: regionIdx.map((ri) => layout.regions[ri]!.id),
    });
  }
  befunde.sort((a, b) => b.anzahl - a.anzahl || a.x - b.x || a.z - b.z);
  return befunde;
}

/** Zusammenfassung von `zellUeberlappungen` — das, was die Kopfzeile/Seitenleiste tatsächlich anzeigt. */
export interface UeberlappungsBericht {
  /** MAX_KANDIDATEN, aus compile.ts übernommen — die Herkunft der "4". */
  schwelle: number;
  /** Anzahl betroffener Zellen. */
  zellenBetroffen: number;
  /** Vereinigung aller beteiligten Region-IDs, ohne Duplikate. */
  regionenBeteiligt: readonly string[];
  /** Die am schlimmsten betroffene Zelle (höchste Regionenzahl), falls vorhanden. */
  schlimmste: ZellBefund | null;
  /** Alle betroffenen Zellen, sortiert wie `zellUeberlappungen`. */
  zellen: readonly ZellBefund[];
}

export function ueberlappungsBericht(layout: WorldLayout): UeberlappungsBericht {
  const zellen = zellUeberlappungen(layout);
  const regionSet = new Set<string>();
  let schlimmste: ZellBefund | null = null;
  for (const z of zellen) {
    for (const id of z.regionen) regionSet.add(id);
    if (!schlimmste || z.anzahl > schlimmste.anzahl) schlimmste = z;
  }
  return {
    schwelle: MAX_KANDIDATEN,
    zellenBetroffen: zellen.length,
    regionenBeteiligt: [...regionSet].sort(),
    schlimmste,
    zellen,
  };
}

/**
 * Betroffene Zellen zu GRUPPEN zusammenfassen: eine je exakter
 * Regionen-Kombination. Grund: In der Dev-Welt liefert `zellUeberlappungen`
 * für ein Cluster benachbarter Inseln hunderte Einzelzellen mit
 * DENSELBEN fünf Regionen (gemessen: 893 Zellen in vier verschiedenen
 * Kombinationen, s. Testlauf im Review) — eine Zeile je Zelle wäre keine Liste
 * mehr, sondern eine Wand. Eine Zeile je Kombination bleibt lesbar und
 * nennt trotzdem "wo" (Mittelpunkt + Spanne) und "wer" (die IDs).
 */
export interface UeberlappungsGruppe {
  /** Beteiligte Region-IDs, sortiert (die Kombination IST die Gruppe). */
  regionen: readonly string[];
  /** Anzahl der Zellen mit genau dieser Kombination. */
  zellenAnzahl: number;
  /** Flächenschwerpunkt der Zellen dieser Gruppe, in Weltmetern. */
  mitteX: number;
  mitteZ: number;
  /** Räumliche Spanne der Zellen dieser Gruppe (achsenparallel). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function ueberlappungsGruppen(layout: WorldLayout): UeberlappungsGruppe[] {
  const zellen = zellUeberlappungen(layout);
  const gruppen = new Map<string, { regionen: string[]; zellen: ZellBefund[] }>();
  for (const z of zellen) {
    const regionen = [...z.regionen].sort();
    const schluessel = regionen.join(' ');
    let g = gruppen.get(schluessel);
    if (!g) {
      g = { regionen, zellen: [] };
      gruppen.set(schluessel, g);
    }
    g.zellen.push(z);
  }

  const ergebnis: UeberlappungsGruppe[] = [];
  for (const g of gruppen.values()) {
    let sx = 0;
    let sz = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const z of g.zellen) {
      sx += z.x;
      sz += z.z;
      if (z.x < minX) minX = z.x;
      if (z.x > maxX) maxX = z.x;
      if (z.z < minZ) minZ = z.z;
      if (z.z > maxZ) maxZ = z.z;
    }
    ergebnis.push({
      regionen: g.regionen,
      zellenAnzahl: g.zellen.length,
      mitteX: sx / g.zellen.length,
      mitteZ: sz / g.zellen.length,
      minX,
      maxX,
      minZ,
      maxZ,
    });
  }
  ergebnis.sort((a, b) => b.zellenAnzahl - a.zellenAnzahl || a.regionen.join().localeCompare(b.regionen.join()));
  return ergebnis;
}

// ── B7: Flächen- und Landmassenanzeige ──────────────────────────────────

export interface FlaechenBericht {
  /** Landfläche gesamt in m² — jede Zelle höchstens einmal gezählt, auch bei Überlappung. */
  gesamtQm: number;
  /** Landfläche je Biom in m² (nur Biome mit Fläche > 0 sind enthalten). */
  jeBiom: ReadonlyMap<BiomeName, number>;
  /** IDs der Regionen, in deren Fläche keine einzige Platzierung liegt. */
  regionenOhnePlatzierung: readonly string[];
}

/**
 * Landfläche gesamt/je Biom sowie Regionen ohne Platzierung.
 *
 * Flächenrechnung: Region-Shapes dürfen sich überlappen (siehe B6) — eine
 * reine Summe der Einzelflächen (Kreis: πr², Polygon: Shoelace) würde
 * überlappte Fläche mehrfach zählen. Stattdessen wird, wie beim
 * Kompilieren, pro 32-m-Rasterzelle die GEWINNENDE Region nach derselben
 * Z-Regel wie `RegionField.sample` bestimmt (unter allen Kandidaten mit
 * signedDistance > 0 gewinnt der späteste Layout-Index) und nur DIESE
 * Zelle gezählt — macht jede Zelle unabhängig von der Anzahl
 * überlappender Regionen zu genau einer Landzelle oder keiner.
 * Absichtlich OHNE die MAX_KANDIDATEN-Kappung von RegionField: Die
 * Fläche muss den wirklichen Gewinner treffen, nicht einen, der laut B6
 * bereits verdrängt sein könnte.
 */
export function flaechenBericht(layout: WorldLayout): FlaechenBericht {
  const gewinnerIndex = new Map<number, number>(); // Zellschlüssel -> Regions-Index

  for (let ri = 0; ri < layout.regions.length; ri++) {
    const region = layout.regions[ri]!;
    fuerRegion(region, (gx, gz, x, z) => {
      if (signedDistance(region.shape, x, z) <= 0) return; // nur "innen" ist Land dieser Region
      const key = zellSchluessel(gx, gz);
      const bisher = gewinnerIndex.get(key);
      if (bisher === undefined || ri > bisher) gewinnerIndex.set(key, ri);
    });
  }

  const jeBiom = new Map<BiomeName, number>();
  let gesamtQm = 0;
  for (const ri of gewinnerIndex.values()) {
    const biom = layout.regions[ri]!.biome;
    jeBiom.set(biom, (jeBiom.get(biom) ?? 0) + ZELLFLAECHE);
    gesamtQm += ZELLFLAECHE;
  }

  const regionenOhnePlatzierung: string[] = [];
  for (const r of layout.regions) {
    const belegt = (layout.placements ?? []).some((p) => signedDistance(r.shape, p.x, p.z) > 0);
    if (!belegt) regionenOhnePlatzierung.push(r.id);
  }

  return { gesamtQm, jeBiom, regionenOhnePlatzierung };
}
