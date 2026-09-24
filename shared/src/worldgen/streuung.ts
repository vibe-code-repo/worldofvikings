/**
 * Vegetationsstreuung — geteilt zwischen Server und Editor-Vorschau.
 *
 * Portiert aus der Vegetationsstreuung des Referenz-Zonenmanagers
 * und bis 08/2026 nur im Server vorhanden. Der Grund fuer den Umzug
 * hierher ist derselbe wie bei `worldlayout/routenlauf.ts`:
 *
 *   Der Testflug des Editors laeuft OFFLINE. Dort gibt es keinen Server
 *   und damit keinen ZoneManager — die Kuratierungsknoepfe schrieben
 *   ihre Liste ins Layout, aber im Testflug blieb die Insel kahl. Wer
 *   eine Welt gestaltet, entscheidet nach dem, was er sieht.
 *
 * Eine Vorschau, die anders rechnet als der Server, waere schlimmer als
 * keine: Man wuerde nach einem Bild bauen, das die Welt spaeter nicht
 * einloest. Deshalb steht die Rechnung genau EINMAL hier, und beide
 * Seiten rufen sie auf. Der Unterschied liegt allein darin, was mit dem
 * Ergebnis geschieht — der Server legt ZDOs an, die Vorschau zeichnet
 * Instanzen.
 *
 * ── Was beim Verschieben nicht angetastet werden durfte ──────────────
 * Die Reihenfolge der Zufallszuege. Sie ist tragend fuer die Identitaet
 * der Welt: Gezogen wird VOR den Pruefungen (Drehung, Groesse, Neigung),
 * damit der Strom unabhaengig davon weiterlaeuft, ob ein Platz taugt.
 * Wer hier eine Ziehung verschiebt, baut jede bestehende Welt um.
 * Abgesichert von `server/test/e2-vegetation.ts`, das zwei Laeufe auf
 * BIT-Gleichheit prueft.
 */

import { EIGENE_FLORA_HASHES } from '../flora.js';
import { FOLIAGE } from '../vegetation.js';
import { WATER_LEVEL, ZONE_UNITS } from './Heightmap.js';
import { Biome } from '../types.js';
import { XorShiftRandom } from './Random.js';
import { crossF, quatEuler, quatLookRotation, quatMulVec3 } from './Math3d.js';
import type { Quaternion, Vector3 } from '../types.js';
import type { Heightmap } from './Heightmap.js';
import type { HeightmapProvider } from './Heightmap.js';
import type { GeoManager } from './GeoManager.js';
import type { RegionGeo } from './RegionGeo.js';

const f32 = Math.fround;

/** (float)(PI * 2.0). */
const PI2_F = f32(Math.PI * 2);
/** (float)(PI / 180.0). */
const DEG2RAD_F = f32(Math.PI / 180);
/** Smallest POSITIVE float32. */
const FLOAT_MIN_POSITIVE = 1.1754943508222875e-38;
/** Largest float32. */
const FLOAT_MAX = 3.4028234663852886e38;
/** Forward unit vector (0, 0, 1). */
const FORWARD: Vector3 = { x: 0, y: 0, z: 1 };

/** Clear area (center, half-width). */
export interface ClearArea {
  center: Vector3;
  radius: number;
  /** Runde Fläche (Abstand ≤ radius) statt Quadrat; Vorgabe: Quadrat. */
  kreis?: boolean;
}

/** Eine gestreute Pflanze — alles, was der Aufrufer zum Ablegen braucht. */
export interface StreuFund {
  readonly prefabName: string;
  readonly prefabHash: number;
  readonly position: Vector3;
  readonly rotation: Quaternion;
  /** Gezogene Groesse; der Aufrufer vergleicht sie mit `localScale`. */
  readonly scale: number;
}

/** Die Weltdaten, aus denen gestreut wird. */
export interface StreuWelt {
  readonly seed: number;
  readonly geo: GeoManager;
  readonly heightmaps: HeightmapProvider;
  /** Layout-Modus: traegt die Kuratierung je Region. Sonst null. */
  readonly regionGeo: RegionGeo | null;
}

/** Punkt in EINER Freifläche (Quadrat, mit `kreis` rund). */
function inArea(a: ClearArea, p: Vector3): boolean {
  if (a.kreis) {
    const dx = p.x - a.center.x;
    const dz = p.z - a.center.z;
    return dx * dx + dz * dz <= a.radius * a.radius;
  }
  return (
    p.x > a.center.x - a.radius &&
    p.x < a.center.x + a.radius &&
    p.z > a.center.z - a.radius &&
    p.z < a.center.z + a.radius
  );
}

/** Ab so vielen Flächen lohnt das Raster (darunter ist die lineare Suche schneller). */
const RASTER_AB = 24;
const RASTER_KANTE = 16;

/**
 * Prüfer „Punkt in einer Freifläche“. Bei vielen Flächen (Zonen mit Hunderten
 * Platzierungen) sortiert ein Raster die Flächen in Zellen ihres Umrisskastens
 * vor; das Ergebnis ist dasselbe wie die lineare Suche, nur ohne jeden
 * Kandidaten gegen alle Flächen zu prüfen.
 */
function freiflaechenPruefer(areas: readonly ClearArea[]): (p: Vector3) => boolean {
  if (areas.length < RASTER_AB) return (p) => areas.some((a) => inArea(a, p));
  const zellen = new Map<number, ClearArea[]>();
  const schluessel = (i: number, j: number): number => i * 65536 + j;
  for (const a of areas) {
    const i0 = Math.floor((a.center.x - a.radius) / RASTER_KANTE);
    const i1 = Math.floor((a.center.x + a.radius) / RASTER_KANTE);
    const j0 = Math.floor((a.center.z - a.radius) / RASTER_KANTE);
    const j1 = Math.floor((a.center.z + a.radius) / RASTER_KANTE);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = schluessel(i, j);
        const liste = zellen.get(k);
        if (liste) liste.push(a);
        else zellen.set(k, [a]);
      }
    }
  }
  return (p) => {
    const liste = zellen.get(schluessel(Math.floor(p.x / RASTER_KANTE), Math.floor(p.z / RASTER_KANTE)));
    return liste !== undefined && liste.some((a) => inArea(a, p));
  };
}

/** Kreis überlappt eine Freifläche (2D). */
function overlapsClearArea(
  areas: readonly ClearArea[],
  p: Vector3,
  radius: number
): boolean {
  for (const a of areas) {
    const dx = f32(p.x - a.center.x);
    const dz = f32(p.z - a.center.z);
    const r = f32(a.radius + radius);
    if (f32(f32(dx * dx) + f32(dz * dz)) < f32(r * r)) return true;
  }
  return false;
}

/** Zufälliger Punkt im Radius um einen Mittelpunkt. */
function getRandomPointInRadius(
  state: XorShiftRandom,
  center: Vector3,
  radius: number
): Vector3 {
  const f = f32(state.nextFloat() * PI2_F);
  const num = state.rangeFloat(0, radius);
  return {
    x: f32(center.x + f32(Math.sin(f) * num)),
    y: center.y,
    z: f32(center.z + f32(Math.cos(f) * num)),
  };
}

/**
 * Gelaendedelta — zehn
 * Zufallsproben auf der ROHEN GeoManager-Hoehe, nicht auf der Heightmap.
 *
 * Die zehn Ziehungen laufen auch dann, wenn die Grenzen 0/0 sind (die
 * Referenz ruft die Funktion bedingungslos) — sie gehoeren zum Zufallsstrom.
 */
function getTerrainDelta(
  geo: GeoManager,
  state: XorShiftRandom,
  center: Vector3,
  radius: number
): number {
  let num2 = FLOAT_MIN_POSITIVE;
  let num3 = FLOAT_MAX;
  for (let i = 0; i < 10; i++) {
    const v = state.insideUnitCircle();
    const px = f32(center.x + f32(v.x * radius));
    const pz = f32(center.z + f32(v.y * radius));
    const groundHeight = geo.getHeight(px, pz);
    if (groundHeight < num3) num3 = groundHeight;
    if (groundHeight > num2) num2 = groundHeight;
  }
  return f32(num2 - num3);
}

/**
 * Streut eine Zone und meldet jede Pflanze an `ablegen`.
 *
 * `clearAreas` sind Flaechen, die freibleiben (Bauwerke/Locations); die
 * Vorschau uebergibt dafuer eine leere Liste, weil sie keine Features
 * kennt — dort stehen dann hoechstens ein paar Pflanzen zu viel, was
 * beim Gestalten nicht stoert.
 */
export function streueZone(
  welt: StreuWelt,
  heightmap: Heightmap,
  clearAreas: readonly ClearArea[],
  ablegen: (fund: StreuFund) => void
): void {
  const imKlaren = freiflaechenPruefer(clearAreas);
  const zoneX = heightmap.zoneX;
  const zoneY = heightmap.zoneY;
  const centerX = zoneX * ZONE_UNITS;
  const centerZ = zoneY * ZONE_UNITS;

  const placedAreas: ClearArea[] = [];

  for (const veg of FOLIAGE) {
    // Large precheck against the zone's corner biomes
    if (!heightmap.haveBiome(veg.biome as Biome)) continue;

    // Same state for all instances of this vegetation in this zone+world.
    // int32 wrap on the sum (the reference's signed overflow wraps).
    const state = new XorShiftRandom(
      (welt.seed + Math.imul(zoneX, 4271) + Math.imul(zoneY, 9187) + veg.prefabHash) | 0
    );

    let num3 = 1;
    // max is used for both chance, and quantity in conjunction with min
    if (veg.max < 1) {
      if (state.nextFloat() > veg.max) continue;
    } else {
      num3 = state.rangeInt(Math.trunc(veg.min), Math.trunc(veg.max) + 1);
    }

    // ── Dichte der Region ───────────────────────────────────────────
    // NACH der Ziehung skaliert, nie davor: Die Zufallszahl selbst muss
    // dieselbe bleiben, sonst veraendert der Regler nicht nur die Menge,
    // sondern wuerfelt die ganze Zone neu — und ein Dreh am Regler
    // versetzte jeden Baum, statt Baeume dazuzustellen.
    //
    // Die Dichte wird in der ZONENMITTE abgefragt, nicht je Pflanze. Eine
    // Zone kann zwei Regionen schneiden; die Alternative waere, den
    // Faktor pro Kandidat zu holen, aber dann haenge die Stueckzahl von
    // einem Punkt ab, der noch gar nicht gezogen wurde.
    const zonenRegion = welt.regionGeo?.regionAt(centerX, centerZ);
    const dichte = zonenRegion?.bewuchsDichte;
    if (dichte !== undefined && dichte !== 1) {
      num3 = Math.max(1, Math.round(num3 * dichte));
    }
    // Mindestabstand der Region — die harte Grenze der Dichte. Er geht
    // quadratisch in die belegte Flaeche ein: Faktor 0.5 vervierfacht die
    // moegliche Stammzahl.
    //
    // Im Nadelwald-NEST ruecken die Staemme zusaetzlich zusammen: Dasselbe
    // Feld hebt an dieser Stelle auch die Gelaendeamplitude an
    // (RegionGeo.landBasis). So entstehen die geschlossenen dunklen
    // Partien mitten im Mischwald, und sie liegen im kupierten Gelaende —
    // statt dass Bewuchs und Landschaft unabhaengig voneinander wuerfeln.
    //
    // Der Faktor wird je ZONE bestimmt, nicht je Pflanze: 64 m sind die
    // richtige Koernung fuer ein Nest, und die Stueckzahl haengt ohnehin
    // an der Zone.
    const nest = welt.regionGeo?.nestFaktor(centerX, centerZ) ?? 0;
    // Bis zur Haelfte enger im Kern des Nests.
    const abstand = (zonenRegion?.abstandFaktor ?? 1) * (1 - 0.5 * nest);
    const radius = veg.radius * abstand;

    const maxTilt = f32(Math.cos(f32(veg.maxTilt * DEG2RAD_F)));
    const minTilt = f32(Math.cos(f32(veg.minTilt * DEG2RAD_F)));
    const num6 = f32(ZONE_UNITS * 0.5 - veg.groupRadius);
    const spawnAttempts = veg.forcePlacement ? num3 * 50 : num3;
    let numSpawned = 0;

    for (let i = 0; i < spawnAttempts; i++) {
      const vx = state.rangeFloat(f32(centerX - num6), f32(centerX + num6));
      const vz = state.rangeFloat(f32(centerZ - num6), f32(centerZ + num6));

      const basePos: Vector3 = { x: vx, y: 0, z: vz };

      const groupCount = state.rangeInt(veg.groupSizeMin, veg.groupSizeMax + 1);
      let generated = false;

      for (let j = 0; j < groupCount; j++) {
        const pos: Vector3 =
          j === 0
            ? { x: basePos.x, y: basePos.y, z: basePos.z }
            : getRandomPointInRadius(state, basePos, veg.groupRadius);

        // Random rotations — drawn BEFORE any checks (rng order is
        // load-bearing for world determinism).
        // The reference's `state.range(0, 360)` resolves to the INT overload!
        const rotY = state.rangeInt(0, 360);
        const scale = state.rangeFloat(veg.scaleMin, veg.scaleMax);
        const rotX = state.rangeFloat(-veg.randTilt, veg.randTilt);
        const rotZ = state.rangeFloat(-veg.randTilt, veg.randTilt);

        // ── GetGroundData ────────────────────────────────────────
        // Heightmap/biome/normal come from the zone AT THE POSITION
        // (may differ from the zone being populated near borders).
        const otherHeightmap = welt.heightmaps.getZoneAt(pos.x, pos.z);
        pos.y = welt.heightmaps.getGroundHeightRaycast(pos.x, pos.z);
        const biome = otherHeightmap.getBiome(pos.x, pos.z);
        const biomeArea = otherHeightmap.getBiomeArea();
        // The reference ignores GetWorldNormal's bool; in-zone positions never fail.
        const normal = otherHeightmap.getWorldNormal(pos.x, pos.z) ?? { x: 0, y: 1, z: 0 };

        // Die Biom-Maske. Sie ist für EIGENE Flora seit Block A
        // durchlässig — `flora.ts` setzt in jedem Eintrag `ALLE_BIOME`.
        //
        // Das ist Absicht und kein Vergessen. Die Maske stand hier als
        // zweiter Riegel gegen eigene Pflanzen, die überall aufgehen;
        // diesen Riegel legt aber schon das Kuratierungstor zwei Zeilen
        // weiter unten um, und zwar genauer (nach ART statt nach BIOM).
        // Solange die Maske daneben mitentschied, gewann die gröbere von
        // zwei Regeln: Vier Regionen der Welt tragen ein anderes Biom als
        // Meadows (blackforest, swamp, deepnorth, ashlands) und wären
        // trotz gefüllter Kuratierungsliste vollständig kahl geblieben —
        // lautlos, weil ein abgewiesener Kandidat der Normalfall ist und
        // nichts protokolliert.
        //
        // Für die Originaleinträge trüge die Maske noch; sie sind seit
        // Block A aus FOLIAGE heraus (vegetation.ts). Was bleibt, ist
        // `biomeArea` (Rand/Mitte) und die Höhenprüfung weiter unten.
        if ((veg.biome & biome) === 0 || (veg.biomeArea & biomeArea) === 0) {
          continue;
        }

        // ── Wer darf hier wachsen ───────────────────────────────────
        // Die Kuratierungsliste der Region ist die ALLEINIGE Autorität:
        //
        // 1. Liste vorhanden: Sie ist EXKLUSIV. Steht sie da, wächst
        //    genau das und sonst nichts (leere Liste = nichts).
        // 2. Keine Liste: Es wächst nichts. Früher galt hier die
        //    Biom-Standardtabelle aus `vegetation.pkg` — die gibt es
        //    nicht mehr, FOLIAGE besteht nur noch aus eigener Flora,
        //    und die wächst NUR auf Bestellung.
        //
        // Der Test darauf ist absichtlich der Hash-Test und nicht
        // „FOLIAGE ist ohnehin nur eigene Flora": Käme je wieder ein
        // Fremdeintrag dazu, bliebe die Regel dieselbe.
        if (welt.regionGeo) {
          const region = welt.regionGeo.regionAt(pos.x, pos.z);
          if (region?.vegetation) {
            if (!region.vegetation.includes(veg.prefabName)) continue;
          } else if (EIGENE_FLORA_HASHES.has(veg.prefabHash)) {
            continue;
          }
        } else if (EIGENE_FLORA_HASHES.has(veg.prefabHash)) {
          // Radialwelt ohne Layout: dort gibt es keine Kuratierung, also
          // auch keine Bestellung. Sie trägt damit gar keinen Bewuchs
          // mehr (server/test/e2-vegetation.ts misst genau das).
          continue;
        }

        const waterDiff = f32(pos.y - WATER_LEVEL);
        if (waterDiff < veg.minAltitude || waterDiff > veg.maxAltitude) {
          continue;
        }

        // Mistlands only
        if (veg.minVegetation !== veg.maxVegetation) {
          const vegetationMask = otherHeightmap.getVegetationMask(pos.x, pos.z);
          if (vegetationMask > veg.maxVegetation || vegetationMask < veg.minVegetation) {
            continue;
          }
        }

        if (veg.minOceanDepth !== veg.maxOceanDepth) {
          const oceanDepth = otherHeightmap.getOceanDepth(pos.x, pos.z);
          if (oceanDepth < veg.minOceanDepth || oceanDepth > veg.maxOceanDepth) {
            continue;
          }
        }

        if (normal.y >= maxTilt && normal.y <= minTilt) {
          if (veg.terrainDeltaRadius > 0) {
            const num12 = getTerrainDelta(welt.geo, state, pos, veg.terrainDeltaRadius);
            if (num12 > veg.maxTerrainDelta || num12 < veg.minTerrainDelta) {
              continue;
            }
          }

          if (veg.inForest) {
            const forestFactor = welt.geo.getForestFactor(pos.x, pos.z);
            if (
              forestFactor < veg.forestTresholdMin ||
              forestFactor > veg.forestTresholdMax
            ) {
              continue;
            }
          }

          if (
            !imKlaren(pos) &&
            (radius === 0 || !overlapsClearArea(placedAreas, pos, radius))
          ) {
            if (veg.snapToWater) {
              pos.y = WATER_LEVEL;
            }
            pos.y = f32(pos.y + veg.groundOffset);

            let rotation: Quaternion;
            if (veg.chanceToUseGroundTilt > 0 && state.nextFloat() <= veg.chanceToUseGroundTilt) {
              const rotation2 = quatEuler(0, rotY, 0);
              rotation = quatLookRotation(
                crossF(normal, quatMulVec3(rotation2, FORWARD)),
                normal
              );
            } else {
              rotation = quatEuler(rotX, rotY, rotZ);
            }

            ablegen({
              prefabName: veg.prefabName,
              prefabHash: veg.prefabHash,
              position: { ...pos },
              rotation,
              scale,
            });

            // Solid objects cannot overlap (radius>0)
            if (radius > 0) {
              placedAreas.push({ center: { ...pos }, radius });
            }

            generated = true;
          }
        }
      }

      if (generated) {
        numSpawned++;
      }

      if (numSpawned >= num3) {
        break;
      }
    }
  }
}
