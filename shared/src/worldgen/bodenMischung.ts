/**
 * Die Bodenmischung an einem Punkt der Welt — auf der CPU, nach derselben
 * Formel wie der Terrain-Shader (`client/src/engine/TerrainSplat.ts`).
 *
 * ── Wozu ─────────────────────────────────────────────────────────────
 * Die Schrittgeräusche der Figur richten sich nach dem Boden unter den
 * Füßen. Was der Boden dort ist, entscheidet der Shader pro Bildpunkt aus
 * Biom-Kacheln, Hangneigung, Felsrauschen, Sandband am Wasser, Schnee und
 * Lavakruste; die CPU sieht davon nichts. Damit Ohr und Auge nicht
 * auseinanderlaufen, rechnet diese Datei dieselbe Kette nach — mit
 * DENSELBEN Zahlen: Rampen (`RAMPEN`, `RAMPEN_JE_KACHEL`), Rauschmaske (`felsMaskeShaderBei`),
 * Kacheltabellen und Regelwerte (`BODEN_REGELN`) kommen aus `./terrainRampen`,
 * `./felsRauschen` und `./bodenKacheln`, aus denen auch der Shader gebaut wird.
 *
 * ── Die Kette (Reihenfolge wie im Shader) ────────────────────────────
 *  1. Biom-Kacheln der vier Zoneneckpunkte, bilinear mit Smoothstep
 *  2. Sand am Ufer: `sandAnteil` · Rampe über dem Wasserspiegel
 *  3. Hangkachel   (Kachel des stärksten Eckpunkts, `HANG_TILE`)
 *  4. mittlerer Fels (`FELS_TILE` über das Biom, Rauschmaske)
 *  5. rauer Fels   (`RAU_TILE`, Rauschmaske)
 *  6. Schnee       (Höhe/Tiefer Norden · Smoothstep über `ny`)
 *  7. Lavakruste   (Aschelande, Vegetationsmaske)
 * Jede Stufe überblendet die vorigen mit `k`: bestehende Anteile mal
 * `(1 − k)`, die neue Art plus `k`. So bleibt die Summe 1.
 *
 * ── Was NICHT gerechnet wird ─────────────────────────────────────────
 * Die Paint-Maske (Wege/Beete/Pflaster aus dem Weltdokument) und die
 * Tiefen-Tönung unter Wasser (nur Farbe). Ein gemalter Weg ändert das
 * Geräusch also nicht; das ist eine benannte Lücke.
 *
 * Ground mix at a world point on the CPU: the terrain shader's blend chain,
 * fed by the same constants, reduced to one share per ground kind.
 */
import { Biome } from '../types.js';
import { WATER_LEVEL, ZONE_UNITS } from './Heightmap.js';
import { rampenFuerKachel, mischeRampen } from './terrainRampen.js';
import { felsMaskeShaderBei } from './felsRauschen.js';
import { TILE, TILE_ANZAHL, BIOME_TILE, HANG_TILE, FELS_TILE, RAU_TILE, BODEN_REGELN } from './bodenKacheln.js';

/** Was ein Untergrund klanglich ist. */
export const BODENARTEN = ['gras', 'erde', 'sand', 'fels', 'schnee', 'pflaster'] as const;
export type Bodenart = (typeof BODENARTEN)[number];

/** Anteile je Bodenart, Summe 1. */
export type BodenAnteile = Record<Bodenart, number>;

/**
 * Kachel → Bodenart. Wald, Heide und Moos sind Bewuchs (Gras); Erde, Lichtung,
 * Sumpf und Asche sind weicher, lockerer Grund; Fels, Klippe, Basalt und die
 * Lavakruste sind Stein.
 */
export const TILE_BODENART: readonly Bodenart[] = [
  /*  0 Grass     */ 'gras',
  /*  1 Forest    */ 'gras',
  /*  2 Dirt      */ 'erde',
  /*  3 Cleared   */ 'erde',
  /*  4 Rock      */ 'fels',
  /*  5 Cliff     */ 'fels',
  /*  6 LavaEmber */ 'fels',
  /*  7 Ash       */ 'erde',
  /*  8 Heath     */ 'gras',
  /*  9 Sand      */ 'sand',
  /* 10 SwampMud  */ 'erde',
  /* 11 Moss      */ 'gras',
  /* 12 Paved     */ 'pflaster',
  /* 13 SwampDark */ 'erde',
  /* 14 Basalt    */ 'fels',
  /* 15 LavaCrust */ 'fels',
  /* 16 GreyGrass    */ 'gras',
  /* 17 GreyMoss     */ 'gras',
  /* 18 GreyRock     */ 'fels',
  /* 19 GreyRockMoss */ 'fels',
];

/**
 * Bodenart → Klanggruppe (Ordner/Stamm unter `toene`, ohne Nummer). Der
 * Bestand hat sieben Gruppen (grass, gravel, metal, snow, tile, water, wood);
 * für Sand, Erde und Fels gibt es keine eigene Aufnahme, sie fallen auf
 * `gravel` (körniger, loser Grund) — nichts wird neu erfunden.
 */
export const KLANGGRUPPE: Readonly<Record<Bodenart, string>> = {
  gras: 'footsteps/grass',
  erde: 'footsteps/gravel',
  sand: 'footsteps/gravel',
  fels: 'footsteps/gravel',
  schnee: 'footsteps/snow',
  pflaster: 'footsteps/tile',
};

/** Woher die Mischung ihre Weltdaten liest — `HeightmapProvider` erfüllt das. */
export interface BodenZone {
  readonly zoneX: number;
  readonly zoneY: number;
  readonly cornerBiomes: readonly [Biome, Biome, Biome, Biome];
  getBiome(wx: number, wz: number): Biome;
  getVegetationMask(wx: number, wz: number): number;
}
export interface BodenQuelle {
  getGroundHeight(wx: number, wz: number): number;
  getZoneAt(wx: number, wz: number): BodenZone;
}

function klemme(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Smoothstep wie `sstep` in Terrain.ts und `smoothStepD(0,1,t)` in Heightmap.ts. */
function glatt01(t: number): number {
  const u = klemme(t);
  return u * u * (3 - 2 * u);
}

/** GLSL `smoothstep(e0, e1, x)`. */
function smoothstep(e0: number, e1: number, x: number): number {
  return glatt01((x - e0) / (e1 - e0));
}

function leer(): BodenAnteile {
  return { gras: 0, erde: 0, sand: 0, fels: 0, schnee: 0, pflaster: 0 };
}

/** Neigung `ny` der Normale wie beim Vertex: zentrale Differenz, 1 m Schritt. */
export function nyBei(x: number, z: number, quelle: BodenQuelle): number {
  const hL = quelle.getGroundHeight(x - 1, z);
  const hR = quelle.getGroundHeight(x + 1, z);
  const hD = quelle.getGroundHeight(x, z - 1);
  const hU = quelle.getGroundHeight(x, z + 1);
  const nx = (hL - hR) / 2;
  const nz = (hD - hU) / 2;
  return 1 / Math.sqrt(nx * nx + 1 + nz * nz);
}

/**
 * Wie die Kette ihre Anteile fuehrt: unter welchem Schluessel eine Kachel
 * verbucht wird und wo Sand, Schnee und Lava landen. Die Kette selbst ist
 * fuer Bodenarten und fuer einzelne Kacheln dieselbe Rechnung.
 */
interface Verbuchung<K extends string> {
  readonly schluessel: readonly K[];
  readonly kachel: (kachel: number) => K;
  readonly sand: K;
  readonly schnee: K;
}

function mischungKern<K extends string>(
  x: number,
  z: number,
  quelle: BodenQuelle,
  v: Verbuchung<K>,
): Record<K, number> {
  const hm = quelle.getZoneAt(x, z);
  const h = quelle.getGroundHeight(x, z);
  const ny = nyBei(x, z, quelle);

  // 1. Biom-Kacheln der vier Ecken, gewichtet wie die Vertexattribute.
  const rx = x - (hm.zoneX * ZONE_UNITS - ZONE_UNITS / 2);
  const rz = z - (hm.zoneY * ZONE_UNITS - ZONE_UNITS / 2);
  const tx = glatt01(rx / ZONE_UNITS);
  const ty = glatt01(rz / ZONE_UNITS);
  const gewichte = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const kacheln = hm.cornerBiomes.map((b) => BIOME_TILE[b] ?? TILE.Rock);
  const a = {} as Record<K, number>;
  for (const k of v.schluessel) a[k] = 0;
  for (let i = 0; i < 4; i++) a[v.kachel(kacheln[i])] += gewichte[i];

  const lege = (art: K, k: number): void => {
    if (k <= 0) return;
    for (const b of v.schluessel) a[b] *= 1 - k;
    a[art] += k;
  };

  // 2. Sand am Ufer.
  lege(
    v.sand,
    klemme((WATER_LEVEL + BODEN_REGELN.sandUeberWasser - h) / BODEN_REGELN.sandSpanne) * BODEN_REGELN.sandAnteil,
  );

  // Dominante Ecke — bei Gleichstand gewinnt die spätere (`step(w, next)`).
  let dom = 0;
  for (let i = 1; i < 4; i++) if (gewichte[i] >= gewichte[dom]) dom = i;
  const domKachel = kacheln[dom];

  // 3. Hangkachel, 4. mittlerer Fels, 5. rauer Fels. Die Rampe ist ueber die
  // vier Eckgewichte gemischt (`mischeRampen`), wie im Shader; haben alle Ecken
  // denselben Satz, gilt er unveraendert.
  const r = mischeRampen(kacheln.map(rampenFuerKachel), gewichte);
  const maske = felsMaskeShaderBei(x, z);
  const biom = hm.getBiome(x, z);

  lege(v.kachel(HANG_TILE[domKachel]), klemme((r.hangB - ny) / r.hangW));
  const felsKachel = FELS_TILE[BIOME_TILE[biom] ?? TILE.Rock] ?? TILE.Rock;
  lege(v.kachel(felsKachel), klemme((r.felsB - ny) / r.felsW) * r.felsA * maske);
  lege(v.kachel(RAU_TILE[domKachel]), klemme((r.rauB - ny) / r.rauW) * r.rauA * maske);

  // 6. Schnee.
  const schnee =
    biom === Biome.Mountain && h > BODEN_REGELN.schneeLinie
      ? Math.min(1, (h - BODEN_REGELN.schneeLinie) / BODEN_REGELN.schneeAnstieg)
      : biom === Biome.DeepNorth
        ? BODEN_REGELN.schneeTiefNord
        : 0;
  lege(v.schnee, schnee * smoothstep(BODEN_REGELN.schneeNyKante0, BODEN_REGELN.schneeNyKante1, ny));

  // 7. Lavakruste (zählt als Stein).
  const lava = biom === Biome.AshLands ? klemme(hm.getVegetationMask(x, z)) : 0;
  lege(v.kachel(TILE.LavaCrust), lava * BODEN_REGELN.lavaAnteil);

  return a;
}

const VERBUCHT_ALS_ART: Verbuchung<Bodenart> = {
  schluessel: BODENARTEN,
  kachel: (t) => TILE_BODENART[t],
  sand: 'sand',
  schnee: 'schnee',
};

export function bodenMischungBei(x: number, z: number, quelle: BodenQuelle): BodenAnteile {
  return mischungKern(x, z, quelle, VERBUCHT_ALS_ART);
}

/** Schluessel eines Kachel-Anteils: `kachel0` … `kachel19` und `schnee`. */
export type KachelSchluessel = `kachel${number}` | 'schnee';

const KACHEL_SCHLUESSEL: readonly KachelSchluessel[] = [
  ...Array.from({ length: TILE_ANZAHL }, (_, i): KachelSchluessel => `kachel${i}`),
  'schnee',
];

const VERBUCHT_ALS_KACHEL: Verbuchung<KachelSchluessel> = {
  schluessel: KACHEL_SCHLUESSEL,
  kachel: (t) => `kachel${t}`,
  sand: `kachel${TILE.Sand}`,
  schnee: 'schnee',
};

/**
 * Dieselbe Kette, aber je KACHEL verbucht statt je Bodenart: wie viel des
 * Bodens an diesem Punkt Gras, Moos, Fels … (Kachel 0 … 19) ist. Der Schnee
 * steht unter `schnee`. Das ist die Zahl, gegen die die Flaechenanteile des
 * Bioms gemessen werden (`tools/test/boden-greyglen.ts`).
 */
export function kachelMischungBei(x: number, z: number, quelle: BodenQuelle): Record<KachelSchluessel, number> {
  return mischungKern(x, z, quelle, VERBUCHT_ALS_KACHEL);
}

/** Die Bodenart mit dem größten Anteil; bei Gleichstand die frühere der Liste. */
export function ueberwiegendeBodenart(anteile: BodenAnteile): Bodenart {
  let best: Bodenart = BODENARTEN[0];
  for (const b of BODENARTEN) if (anteile[b] > anteile[best]) best = b;
  return best;
}

/** Klanggruppe der Schritte an einem Punkt des Geländes. */
export function schrittGruppeBei(x: number, z: number, quelle: BodenQuelle): string {
  return KLANGGRUPPE[ueberwiegendeBodenart(bodenMischungBei(x, z, quelle))];
}
