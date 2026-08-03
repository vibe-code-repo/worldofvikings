/**
 * GrassClutter — G-VEG (Babylon-Port): original Valheim clutter system.
 *
 * Port of the three.js reference (valheim-browser GrassClutter.ts, itself a
 * faithful port of the dumped ClutterSystem.cs + ZoneSystem scene data —
 * see Docs/Analyse-Modelle-und-Weltgenerierung.md G-VEG/G-VEG2/G-VEG3).
 *
 * Original algorithm: 10m patches, 45m radius, per-entry deterministic RNG,
 * filters in fixed order: forest → fractal → biome → altitude/tilt →
 * (snap/water). 14 enabled entries from the live-client scene dump
 * (zonesystem_typetree.json + clutter_render_info.json).
 *
 * Babylon adaptation:
 *  - InstancedMesh instead of THREE.InstancedMesh (same concept: one mesh
 *    per 40m cell per entry, matrix per instance).
 *  - Wind sway + distance shrink/fade via a small MaterialPluginBase
 *    (ClutterWindPlugin) — sway/push/fade in the vertex stage, dither in
 *    the fragment stage, up-normals pinning.
 *  - Meadows grass tint: grass_terrain_color sampled on the CPU per
 *    instance → instanceColor buffer (Babylon InstancedMesh color).
 *  - Terrain height/biome/forest via ClientWorld (geo/heightmaps), no
 *    TerrainManager dependency (no getBiomeAt helper needed).
 *
 * Asset note: clutter_default/plane/fern/vass/lily GLBs were copied from
 * the reference asset folder (they are identical in both exports); the
 * real clutter textures were copied from the AssetRipper export (the
 * 0-byte stubs in assets/textures are a known export gap — see the
 * Analyse doc, same class as G-TEX2).
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { Biome, WATER_LEVEL, fbm } from '@wov/shared';
import type { ClientWorld } from '../world/World';
import { ClutterWindPlugin } from './ClutterWindPlugin';

/** Original m_grassPatchSize / m_distance from the dumped scene (documentation
 *  reference only — see BUILD_RADIUS below for the value that actually gates
 *  cell construction). */
const PATCH = 10;
const DISTANCE = 45;
/** Cell = 4×4 patches = 40m — one InstancedMesh per cell per entry. */
const CELL_PATCHES = 4;
const CELL_SIZE = PATCH * CELL_PATCHES;
/** In-game amount scale (the 1.5 in the scene dump is the main-menu hack). */
const AMOUNT_SCALE = 1.0;
/**
 * Wählbare Grasdichten (Faktor auf die Halmzahl pro Patch).
 *
 * Das ist etwas ANDERES als "Vegetationsqualität": Die regelt bei uns nur
 * die Sichtweite (VEGETATION_QUALITY_SCALE), also ab wann Gras
 * ausgeblendet wird. Die Dichte hier bestimmt, wie viele Halme überhaupt
 * entstehen — und genau daran hängen die Kosten, beim Zellaufbau wie beim
 * Zeichnen. Vom Nutzer gemessen: ohne Gras 80 fps statt 45.
 *
 * Die Stufen 0.25 / 0.5 / 1.0 sind NICHT gegriffen, sondern genau das,
 * was das Original tut (ClutterSystem.cs, Zweig über `m_quality`):
 *
 *   Quality.Low => clutter.m_amount / 4
 *   Quality.Med => clutter.m_amount / 2
 *   _           => clutter.m_amount
 *
 * Valheim regelt die Grasmenge also über die ANZAHL, nicht über die
 * Sichtweite — dass wir bisher nur letztere hatten, war die Abweichung.
 * Die Stufe 0 (ganz aus) gibt es im Original nicht; sie ist als
 * Notausgang für schwache Geräte ergänzt.
 */
export const GRASS_DENSITY = [0, 0.25, 0.5, 1.0] as const;
/** Cells to build per update() call — a queue backlog (fast movement,
 *  first load, teleport) must drain faster than the player can walk into
 *  the fade zone, or the "cell pops in late" bug below reappears. */
const CELLS_PER_FRAME = 3;
/**
 * Zeitbudget für den Zellaufbau pro Frame (ms).
 *
 * Bei 60 fps stehen 16,7 ms für ALLES zur Verfügung. 4 ms lassen dem
 * Rendern genug Luft und füllen frisches Gebiet trotzdem in wenigen
 * Frames auf. Siehe die Begründung an der Aufbauschleife.
 */
const CELL_BUILD_BUDGET_MS = 4;

type MeshKey = 'default' | 'droopy' | 'plane' | 'fern' | 'vass' | 'lily';

interface ClutterEntry {
  readonly key: string;
  readonly biome: number;
  readonly amount: number;
  readonly mesh: MeshKey;
  readonly texture: string;
  /** White blade texture — color comes from grass_terrain_color per instance. */
  readonly terrainTint: boolean;
  /** _MainTex scale U (forest materials tile 2× horizontally). */
  readonly texRepeatU: number;
  /** InstanceRenderer m_scale — baked into every instance matrix. */
  readonly prefabScale: readonly [number, number, number];
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly maxTiltCos: number; // cos(rad(m_maxTilt))
  readonly minAlt: number;
  readonly maxAlt: number;
  readonly terrainTilt: boolean;
  readonly snapToWater: boolean;
  /**
   * Liegt die Pflanze AUF dem Wasser und hebt und senkt sich mit der Welle?
   *
   * Kein Originalfeld — der vollständige `ClutterSystem.Clutter`-Datensatz
   * kennt nur `m_snapToWater` (auf den Wasserspiegel setzen) und hebt gar
   * nichts mit dem Wellengang. Für Seerosen brauchen wir die Ergänzung
   * trotzdem: Sie liegen flach an der Oberfläche, und seit das Wasser
   * blickdicht rendert, verschluckt sie jeder Wellenberg (bei 1,5 m
   * Wassersäule steigt er bis 0,88 m über den Spiegel).
   *
   * Schilf hat `snapToWater` im Original genauso gesetzt, WURZELT aber im
   * Grund — es darf sich vertikal nicht mitbewegen, sonst steht es sichtbar
   * auf dem Wasser. Dass die Welle seinen Fuß mal mehr, mal weniger
   * überspült, ist richtig so; sein Halm ragt hoch genug heraus, dass er
   * dabei nie verschwindet.
   */
  readonly schwimmt?: boolean;
  readonly randomOffset: number;
  readonly inForest: boolean;
  readonly forestMin: number;
  readonly forestMax: number;
  /**
   * C# ClutterSystem.Clutter.m_onCleared / m_onUncleared, with the original's
   * defaults (uncleared only). "Cleared" is ground the player painted — dirt
   * path, cultivated soil or paving; grass does not grow back on it.
   */
  readonly onCleared?: boolean;
  readonly onUncleared?: boolean;
  readonly fractalScale: number;
  readonly fractalMin: number;
  readonly fractalMax: number;
  readonly cutoff: number;
  readonly fadeMin: number;
  readonly fadeMax: number;
  /** _SwayDistance/100 — sway amplitude in meters at the mesh top. */
  readonly swayAmp: number;
  readonly pushDist: number;
  /** Cross meshes get up-normals (lit like the ground) — 3D meshes keep theirs. */
  readonly pinUpNormals: boolean;
  readonly color: [number, number, number];
}

/**
 * Farbkorrektur für den erzeugten Wiesen-Atlas.
 *
 * Das Original färbt eine WEISSE Halm-Maske mit `grass_terrain_color`
 * ein; unser `grass_meadows_gen.png` ist dagegen bereits grün gebacken,
 * die Tönung muss dort also ausbleiben (sonst grün × grün = Neon).
 * Gemessen unterscheiden sich beide Wege vor allem im Blaukanal:
 *
 *   Original  weiss × grass_terrain_color  →  (89, 119,  66)
 *   unser Atlas grass_meadows_gen          →  (82, 122,  46)
 *
 * Der fehlende Blauanteil ist genau das, was unser Gras giftiger wirken
 * lässt als Valheims. Der Faktor bringt das Verhältnis auf den Originalwert.
 *
 * NEU BERECHNET am 2026-08-01. Der bisherige Wert (0.76, 0.68, 1.0) war im
 * GAMMA-Raum hergeleitet — als reines Verhältnis der beiden sRGB-Mittel.
 * `diffuseColor` wird im Shader aber auf die LINEAREN Werte multipliziert,
 * seit die Texturen oben als sRGB-Buffer geladen werden. Ein Verhältnis
 * überträgt sich nicht durch die Gammakurve, es muss dort gebildet werden,
 * wo es wirkt:
 *
 *   Ziel  (89, 119, 66) / 255 ^2.2  →  (0.0987, 0.1870, 0.0511)
 *   Atlas (82, 122, 46) / 255 ^2.2  →  (0.0820, 0.1986, 0.0233)
 *   Faktor = Ziel / Atlas           →  (1.204,  0.942,  2.192)
 *
 * Nicht mehr auf max = 1 normiert: Die alte Normierung sollte ein
 * Aufhellen verhindern, machte das Gras im linearen Raum aber um Faktor
 * 2.19 zu dunkel. Der exakte Faktor trifft die Originalfarbe genau —
 * Gegenprobe: Atlas × Faktor, zurück nach sRGB, ergibt wieder (89, 119, 66).
 *
 * Die saubere Lösung wäre die Originalmaske plus Tönung. Ein Versuch damit
 * am 2026-07-29 scheiterte an der UV-Belegung: `clutter_default.glb` ist
 * auf den 256²-Atlas ausgelegt, mit der 128²-Originalmaske zerfielen die
 * Halme zu eckigen Schollen. Dafür braucht es die zum Original passende
 * Clutter-Geometrie — bis dahin diese Korrektur.
 */
const MEADOWS_TINT: [number, number, number] = [1.204, 0.942, 2.192];

const cos = (deg: number): number => Math.cos((deg * Math.PI) / 180);
const B = Biome;

/** The dumped clutter table (1:1 from zonesystem_typetree.json +
 *  clutter_render_info.json — see the three.js reference for full notes). */
const ENTRIES: readonly ClutterEntry[] = [
  { key: 'meadowsGrass', biome: B.Meadows | B.Ocean, amount: 200, mesh: 'default', texture: 'grass_meadows_gen', terrainTint: false, texRepeatU: 1, prefabScale: [1.5, 2.0, 1.5], scaleMin: 1.0, scaleMax: 2.3, maxTiltCos: cos(25), minAlt: 0.4, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 5, fractalMin: 0, fractalMax: 1, cutoff: 0.46, fadeMin: 20, fadeMax: 35, swayAmp: 0.1, pushDist: 2.0, pinUpNormals: true, color: MEADOWS_TINT },
  { key: 'meadowsGrassShort', biome: B.Meadows | B.Ocean, amount: 250, mesh: 'default', texture: 'grass_meadows_gen', terrainTint: false, texRepeatU: 1, prefabScale: [1.2, 1.2, 1.2], scaleMin: 1.0, scaleMax: 2.0, maxTiltCos: cos(25), minAlt: 0.3, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 5, fractalMin: 1.0, fractalMax: 3.0, cutoff: 0.46, fadeMin: 20, fadeMax: 35, swayAmp: 0.05, pushDist: 0.5, pinUpNormals: true, color: MEADOWS_TINT },
  { key: 'meadowsShrub', biome: B.Meadows | B.Ocean, amount: 8, mesh: 'plane', texture: 'clutter_shrub', terrainTint: false, texRepeatU: 1, prefabScale: [0.3, 1.0, 0.3], scaleMin: 1.0, scaleMax: 1.5, maxTiltCos: cos(30), minAlt: 1.0, maxAlt: 1000, terrainTilt: false, snapToWater: false, randomOffset: 0, inForest: true, forestMin: 0, forestMax: 1.15, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.05, pushDist: 0.8, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'meadowsFern', biome: B.Meadows, amount: 30, mesh: 'fern', texture: 'autumn_ormbunke_green', terrainTint: false, texRepeatU: 1, prefabScale: [1, 1, 1], scaleMin: 1.0, scaleMax: 1.0, maxTiltCos: cos(18), minAlt: 1.0, maxAlt: 4.0, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: true, forestMin: 0, forestMax: 1.0, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 3.8, fadeMax: 40, swayAmp: 0.04, pushDist: 1.0, pinUpNormals: false, color: [1, 1, 1] },
  { key: 'heathGrass', biome: B.Plains, amount: 200, mesh: 'default', texture: 'grass_heath_gen', terrainTint: false, texRepeatU: 1, prefabScale: [1.3, 3.5, 1.3], scaleMin: 0.7, scaleMax: 1.5, maxTiltCos: cos(30), minAlt: 0.5, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 5, fractalMin: 0, fractalMax: 0.8, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.12, pushDist: 1.5, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'heathFlowers', biome: B.Plains, amount: 100, mesh: 'plane', texture: 'grass_heath_redflower', terrainTint: false, texRepeatU: 1, prefabScale: [0.5, 1.1, 0.5], scaleMin: 1.0, scaleMax: 1.0, maxTiltCos: cos(30), minAlt: 1.0, maxAlt: 1000, terrainTilt: false, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 5, fractalMin: 0, fractalMax: 0.8, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.08, pushDist: 1.5, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'forestCover', biome: B.BlackForest, amount: 50, mesh: 'droopy', texture: 'forest_groundcover', terrainTint: false, texRepeatU: 2, prefabScale: [2.0, 2.2, 2.0], scaleMin: 1.0, scaleMax: 1.0, maxTiltCos: cos(25), minAlt: 0.5, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.02, pushDist: 0.5, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'forestCoverBrown', biome: B.BlackForest, amount: 80, mesh: 'droopy', texture: 'forest_groundcover_brown', terrainTint: false, texRepeatU: 2, prefabScale: [1.5, 1.5, 1.5], scaleMin: 1.0, scaleMax: 1.0, maxTiltCos: cos(25), minAlt: 0.5, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.02, pushDist: 0.5, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'swampGrass', biome: B.Swamp, amount: 150, mesh: 'droopy', texture: 'grass_toon1_yellow_gen', terrainTint: false, texRepeatU: 1, prefabScale: [1.5, 2.0, 1.5], scaleMin: 0.8, scaleMax: 1.0, maxTiltCos: cos(25), minAlt: 0.0, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 20, fadeMax: 35, swayAmp: 0.03, pushDist: 1.0, pinUpNormals: true, color: [1, 1, 1] },
  { key: 'swampFern', biome: B.Swamp, amount: 4, mesh: 'fern', texture: 'autumn_ormbunke_swamp', terrainTint: false, texRepeatU: 1, prefabScale: [1, 1, 1], scaleMin: 0.5, scaleMax: 1.0, maxTiltCos: cos(18), minAlt: 0.0, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 3.8, fadeMax: 40, swayAmp: 0.02, pushDist: 0.5, pinUpNormals: false, color: [1, 1, 1] },
  { key: 'deepforestFern', biome: B.BlackForest, amount: 10, mesh: 'fern', texture: 'autumn_ormbunke_green', terrainTint: false, texRepeatU: 1, prefabScale: [1, 1, 1], scaleMin: 1.0, scaleMax: 1.0, maxTiltCos: cos(18), minAlt: 1.0, maxAlt: 1000, terrainTilt: true, snapToWater: false, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 0, fractalMin: 0.5, fractalMax: 1, cutoff: 0.5, fadeMin: 3.8, fadeMax: 40, swayAmp: 0.04, pushDist: 1.0, pinUpNormals: false, color: [1, 1, 1] },
  { key: 'vass', biome: B.Meadows | B.Swamp | B.Mountain | B.BlackForest | B.Plains | B.Ocean | B.Mistlands, amount: 30, mesh: 'vass', texture: 'vass_texture01', terrainTint: false, texRepeatU: 1, prefabScale: [1, 1, 1], scaleMin: 1.0, scaleMax: 1.3, maxTiltCos: cos(90), minAlt: -1.0, maxAlt: -0.1, terrainTilt: false, snapToWater: true, randomOffset: 0, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 5, fractalMin: 0, fractalMax: 1, cutoff: 0.5, fadeMin: 35, fadeMax: 40, swayAmp: 0.15, pushDist: 1.45, pinUpNormals: false, color: [1, 1, 1] },
  { key: 'lilies', biome: B.Meadows | B.BlackForest, amount: 40, mesh: 'lily', texture: 'waterlilies', terrainTint: false, texRepeatU: 1, prefabScale: [1, 1, 1], scaleMin: 0.4, scaleMax: 0.6, maxTiltCos: cos(90), minAlt: -1.5, maxAlt: -0.2, terrainTilt: false, snapToWater: true, schwimmt: true, randomOffset: 0.1, inForest: false, forestMin: 0, forestMax: 1, fractalScale: 2, fractalMin: 0, fractalMax: 1, cutoff: 0.45, fadeMin: 20, fadeMax: 35, swayAmp: 0.05, pushDist: 2.0, pinUpNormals: false, color: [0.618, 0.618, 0.618] },
];

/**
 * BUG (reported): grass/plants visibly "build up" while running in one
 * direction — you can watch whole 40 m blocks pop into existence.
 *
 * Root cause: refreshCells() decided whether a cell was "wanted" (i.e.
 * needs to be built) by measuring the distance from the player to the
 * cell's CENTER. But a cell's nearest corner can be up to half its
 * diagonal (~28 m for a 40 m cell) closer to the player than its center —
 * so a cell could already have a corner deep inside the shader's visible
 * fade-in range (up to MAX_FADE below) while its center-distance test
 * still reported it as "not wanted yet". The cell would only get queued
 * — and appear, fully built, in one frame — once the player had walked
 * close enough for the CENTER to cross the threshold, by which point part
 * of it was already meant to be visible. refreshCells() now measures
 * distance to the nearest point of the cell's footprint instead (see
 * below), which removes this blind spot entirely.
 *
 * BUG 2 (reported, screenshot): even once cells build on time, the fade
 * boundary itself looks unnatural — every blade of a given entry shares
 * the *exact same* fadeMin/fadeMax (the dumped per-entry values), so an
 * entire field vanishes along one perfectly circular line around the
 * player. In low-fog weather (e.g. the "Clear" env) that line is fully
 * exposed as a hard "wall" between detailed 3D grass and flat terrain
 * texture. Addressed without touching the verified ENTRIES data, via two
 * engine-level, user-adjustable knobs (see ClutterWindPlugin.ts for the
 * shader side, Settings.ts/SettingsPanel.ts for the "Vegetationsqualität"
 * UI control — real Valheim setting, GraphicsSettingInt.Vegetation):
 *  - VEGETATION_QUALITY_SCALE (real Valheim "Vegetationsqualität" levels:
 *    Niedrig/Mittel/Hoch/Sehr hoch) multiplies the per-entry fadeMin/
 *    fadeMax uniformly, applied every frame as ClutterWindPlugin's
 *    clutterDistanceScale uniform — NOT baked in at load time, because it
 *    also factors in the current fog visibility (see update() below): in
 *    dense fog the vanish boundary can sit closer (it's obscured anyway —
 *    also a perf win), in clear weather the user's chosen quality decides.
 *  - FADE_JITTER (applied per-instance in ClutterWindPlugin's vertex
 *    shader, via a hash of the instance's world position, to fadeMax
 *    ONLY — see that file's header for why fadeMin must NOT be jittered)
 *    staggers each blade's personal vanish point by up to ±30%, breaking
 *    the circle into a ragged, organic transition.
 *
 * baurRadius(quality): farthest camera distance any instance of THAT quality
 * level can be visible — its VEGETATION_QUALITY_SCALE factor (fog only ever
 * caps this shorter, never extends it) and the worst-case FADE_JITTER
 * outlier — plus REFRESH_SLOP and a small safety margin for build queue lag.
 * Cells are queued once the nearest point of their footprint comes within
 * that radius. Raising the setting mid-game re-queues the newly needed ring
 * from setQuality(); see the function's own comment for why it is no longer
 * pinned to the highest level.
 * REFRESH_SLOP: setPlayerPosition() only recomputes the wanted-set when
 * the player crosses a full PATCH boundary, so that set can already be up
 * to one PATCH (10 m) stale by the time it's evaluated.
 */
/** Real Valheim "Vegetationsqualität" levels (settings_vegetation /
 *  GraphicsSettingInt.Vegetation) — index 0=Niedrig..3=Sehr hoch. Index 2
 *  (Hoch) matches this project's previous fixed default (1.25). */
const VEGETATION_QUALITY_SCALE: readonly number[] = [0.7, 0.95, 1.25, 1.6];
const DEFAULT_VEGETATION_QUALITY = 2;
/** ± fraction of fadeMax jittered per instance (fadeMin is never jittered
 *  — see ClutterWindPlugin.ts) — keep in sync with the `* 0.6` (= 2 × 0.3)
 *  factor in ClutterWindPlugin's vertex shader. */
const FADE_JITTER = 0.3;
/** Representative base fadeMax used to translate the fog-visibility
 *  distance (meters) into a clutterDistanceScale cap in update() below —
 *  matches the common grass/plant entries' raw fadeMax (35). */
const FOG_REFERENCE_FADE = 35;
const ROHER_MAX_FADE = ENTRIES.reduce((m, e) => Math.max(m, e.fadeMax), 0);
const REFRESH_SLOP = PATCH;

/**
 * Baurradius für eine BESTIMMTE Qualitätsstufe (m).
 *
 * ⚠ GEÄNDERT am 2026-08-02: Vorher war das eine Konstante, gebildet aus der
 * HÖCHSTEN Stufe (1.6) — mit der Begründung, dass ein Hochdrehen der
 * Einstellung dann nie einen unfertigen Ring freilegt. Der Preis dafür war
 * hoch und dauerhaft: In der Voreinstellung "Hoch" (Faktor 1.25) verschwindet
 * der letzte Halm bei 40 × 1.25 × 1.3 = 65 m, gebaut wurde aber bis 101 m.
 * Gemessen an einer normalen Spielposition standen dadurch 106 Zellen in der
 * Szene, deren Halme ab 65 m ausnahmslos wegskaliert sind — sichtbar ist
 * davon nichts, gezeichnet wird trotzdem jede.
 *
 * Der ursprüngliche Zweck bleibt gewahrt, nur anders: `setQuality()` ruft
 * jetzt `refreshCells()` auf, der fehlende Ring wird beim Hochdrehen also
 * sofort nachgebaut statt vorsorglich dauerhaft mitgeschleppt.
 *
 * Der Nebel bleibt bewusst DRAUSSEN. Er kann die Sichtweite nur verkürzen
 * (siehe update()), wechselt aber mit dem Wetter — an ihn gekoppelt würde
 * der Radius ständig wandern und bei jedem Aufklaren einen Neuaufbau
 * auslösen.
 */
function baurRadius(quality: number): number {
  const skala = VEGETATION_QUALITY_SCALE[quality] ?? VEGETATION_QUALITY_SCALE[DEFAULT_VEGETATION_QUALITY];
  return ROHER_MAX_FADE * skala * (1 + FADE_JITTER) + REFRESH_SLOP + 8;
}

/** Grösster überhaupt möglicher Baurradius — nur noch für PATCH_RADIUS. */
const MAX_BUILD_RADIUS = baurRadius(VEGETATION_QUALITY_SCALE.length - 1);
/** Outer patch-offset loop bound (patch units) that discovers candidate
 *  cells for the test above — must reach the build radius along a pure axis
 *  direction (the loop's worst-case reach), so a couple of patches of
 *  headroom on top. Bleibt an der HÖCHSTEN Stufe bemessen: die Schleife
 *  sucht nur Kandidaten, aussortiert wird darin über den echten Radius. */
const PATCH_RADIUS = Math.ceil(MAX_BUILD_RADIUS / PATCH) + 2;

const MESH_FILES: Record<MeshKey, string> = {
  default: 'clutter_default',
  droopy: 'grasscross',
  plane: 'clutter_plane',
  fern: 'clutter_fern',
  vass: 'clutter_vass',
  lily: 'clutter_lily',
};

/** Deterministic per-(patch, entry, candidate, field) hash → [0,1). */
function hash(px: number, py: number, entry: number, i: number, field: number): number {
  let h = (px * 374761393 + py * 668265263 + entry * 2246822519 + i * 2654435761 + field * 3266489917) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

interface Variant {
  entry: ClutterEntry;
  geometry: { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array };
  material: StandardMaterial;
  topY: number;
}

interface QueuedCell { cx: number; cy: number; d2: number }

/**
 * One thin-instance mesh of a cell, with its buffers kept alongside. The
 * buffers are what makes clearArea() possible: individual blades can be
 * dropped from them without rebuilding the whole 40 m cell.
 */
interface CellMesh {
  mesh: Mesh;
  matrix: Float32Array;
  color: Float32Array | null;
}

/**
 * Radius (m), in dem um ein aufsammelbares Objekt kein Gras wächst.
 *
 * Valheim hält die Bodenvegetation von Pickables frei, sonst verschwinden
 * Feuerstein, Stein und Löwenzahn im hohen Gras und man findet sie nur
 * durch Zufall. 0,6 m ist knapp genug, dass keine kahlen Flecken
 * entstehen, und weit genug, dass der Gegenstand freisteht.
 */
const CLEARING_RADIUS = 0.6;
/**
 * Rasterweite der Aussparungssuche (m). Pro Grashalm wird nachgeschlagen,
 * ob seine Rasterzelle freigehalten wird — ein Set-Lookup statt eines
 * Abstandsvergleichs gegen hunderte Objekte.
 */
const CLEARING_GRID = 0.5;

/** Wo die Clutter-Texturen liegen (Vite-Plugin serviert assets/ unter /assets). */
const TEX_BASE_URL = '/assets/textures/';

/**
 * HD-Clutter (Willybach's HD Textures, optional — Settings.hdClutter).
 *
 * Zuordnung ENTRIES.texture → Dateiname unter `hd-clutter/` (ohne Saison und
 * Endung), erzeugt von `tools/make-hd-clutter.py`. Die Vorlagen sind
 * layout-gleich zu den Originalen — beides sind Vollbild-Billboards mit Halmen
 * von unten nach oben, keine Sprite-Atlanten —, weshalb dieselben UVs passen.
 *
 * ZWEI Unterschiede, die der Aufrufer ausgleichen muss:
 *  1. Die HD-Vorlagen sind VORGEFÄRBT, die Originale sind weisse Masken.
 *     Deshalb `hdColor` statt `entry.color`: die Wiesen-Tönung MEADOWS_TINT
 *     würde sonst ein zweites Mal Grün auf Grün legen — genau der
 *     "Neonteppich", den der Kommentar bei grass_terrain_color beschreibt.
 *  2. Sie decken ungefähr doppelt so viel Fläche (30 % statt 15 %, an
 *     grasscross_mistlands_short gegen die Original-64²-Textur aus dem
 *     Spiel-Bundle gemessen). Das Gras wirkt damit dichter — Absicht des
 *     Pack-Autors, keine Fehlanpassung.
 */
const HD_CLUTTER: Readonly<Record<string, string>> = {
  grass_meadows_gen: 'grasscross_meadows',
  clutter_shrub: 'clutter_shrub',
  autumn_ormbunke_green: 'ormbunke',
  grass_heath_gen: 'grasscross_heath',
  grass_heath_redflower: 'grasscross_heath_flower',
  forest_groundcover: 'grasscross_forest',
  forest_groundcover_brown: 'grasscross_forest_brown',
  grass_toon1_yellow_gen: 'grasscross_swamp',
  autumn_ormbunke_swamp: 'ormbunke_yellow',
  vass_texture01: 'vass',
  waterlilies: 'clutter_waterlilies',
};

const HD_BASE_URL = '/assets/textures/hd-clutter/';

/**
 * Saison der HD-Texturen. Das Pack liefert jede Textur viermal
 * (@spring/@summer/@fall/@winter); Valheim selbst kennt keine Jahreszeiten,
 * also steht das hier vorerst fest auf Sommer.
 */
const HD_SEASON = 'summer';

/** Tönung im HD-Modus: keine — die Vorlagen bringen ihre Farbe schon mit. */
const HD_COLOR: readonly [number, number, number] = [1, 1, 1];
/**
 * Kantenlänge, auf die grass_terrain_color heruntergerechnet wird.
 * Das Original ist 1024² und wird PRO INSTANZ einmal abgetastet — bei
 * Halmabständen im Meterbereich trägt die volle Auflösung nichts bei,
 * kostet aber 4 MB. 256² sind 256 kB und bei 0.01 Weltskalierung immer
 * noch ein Farbwechsel alle ~0.4 m.
 */
const TINT_SIZE = 256;

export class GrassClutter {
  private readonly scene: Scene;
  private readonly world: ClientWorld;
  private variants: Variant[] = [];
  private ready = false;
  private time = 0;
  /** "Vegetationsqualität" — index into VEGETATION_QUALITY_SCALE, settable
   *  live via setQuality() (SettingsPanel). */
  private quality = DEFAULT_VEGETATION_QUALITY;
  /** Halmzahl-Faktor, siehe GRASS_DENSITY / setDensity(). */
  private density = 1.0;

  /** grass_terrain_color.png pixels for the meadows terrain tint. */
  private tintPixels: Uint8ClampedArray | null = null;
  private tintSize = 0;

  /** HD-Clutter an? Siehe HD_CLUTTER und Settings.hdClutter. */
  private hd = false;
  /** Original-Texturen, Schlüssel = ENTRIES.texture. */
  private texturesOrig = new Map<string, Texture>();
  /**
   * Texturen im Zugriff des Materials, Schlüssel `${hd}:${name}:${repeatU}`.
   * Der Repeat gehört in den Schlüssel, weil uScale an der Texture-Instanz
   * hängt und die Waldvarianten sie 2× kacheln — ohne eigenen Eintrag würde
   * das Umschalten die Kachelung auf die geteilte Instanz schreiben.
   */
  private readonly texCache = new Map<string, Texture>();

  private readonly cells = new Map<string, CellMesh[]>();
  private queue: QueuedCell[] = [];
  private playerPatchX = Number.NaN;
  private playerPatchY = Number.NaN;

  constructor(scene: Scene, world: ClientWorld) {
    this.scene = scene;
    this.world = world;
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const { SceneLoader } = await import('@babylonjs/core/Loading/sceneLoader');
      await import('@babylonjs/loaders/glTF/2.0');

      // Load the 6 clutter meshes (geometry only)
      const meshKeys = Object.keys(MESH_FILES) as MeshKey[];
      const geometries = new Map<MeshKey, Variant['geometry']>();
      for (const k of meshKeys) {
        const res = await SceneLoader.ImportMeshAsync('', '/assets/models/', `${MESH_FILES[k]}.glb`, this.scene);
        const src = res.meshes.find((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
        if (!src) throw new Error(`${MESH_FILES[k]}.glb has no mesh`);
        const positions = Float32Array.from(src.getVerticesData('position') ?? []);
        const normals = Float32Array.from(src.getVerticesData('normal') ?? []);
        const uvs = Float32Array.from(src.getVerticesData('uv') ?? []);
        const indices = Uint32Array.from(src.getIndices() ?? []);
        geometries.set(k, { positions, normals, uvs, indices });
        res.meshes.forEach((m) => m.dispose());
      }
      for (const k of meshKeys) {
        if (!geometries.has(k)) throw new Error(`${MESH_FILES[k]}.glb has no mesh`);
      }

      // Load the clutter textures
      const texNames = [...new Set(ENTRIES.map((e) => e.texture))];
      const textures = new Map<string, Texture>();
      for (const name of texNames) {
        textures.set(name, this.makeTexture(`${TEX_BASE_URL}${name}.png`));
      }
      this.texturesOrig = textures;

      // grass_terrain_color-Tönung: VORGEHALTEN, aber derzeit ungenutzt.
      //
      // ACHTUNG (klargestellt am 2026-08-01): Dieser Block lädt die Tönung,
      // angewandt wird sie aber nirgends — `terrainTint` steht in ALLEN
      // ENTRIES auf false, und nur dieses Feld schaltet den Farb-Buffer
      // (siehe unten `if (variant.entry.terrainTint)`). Der Kommentar
      // behauptete bis hierher das Gegenteil und hat bei der Suche nach
      // dem gelbstichigen Gras Zeit gekostet. Stattdessen färbt MEADOWS_TINT
      // über `material.diffuseColor` pauschal, ohne Ortsabhängigkeit.
      //
      // Der Mechanismus stammt aus dem Original: WEISSE Halm-Maske ×
      // Terrainfarbe. Deaktiviert war er, weil unsere selbst erzeugten
      // Atlanten (`*_gen.png`) bereits grün eingefärbt sind — grün × grün
      // ergab doppelt gesättigtes Neongrün.
      //
      // Behoben wurde jetzt die Ursache statt des Symptoms: Wir benutzen
      // die ECHTEN Clutter-Masken aus dem Client-Export. Gemessen:
      //
      //   grass_meadows.png      (Original)   128²  deckend  9 %  RGB weiß
      //   grass_meadows_gen.png  (erzeugt)    256²  deckend 60 %  RGB grün
      //
      // Der Unterschied ist doppelt: Das Original ist nicht vorgefärbt UND
      // die Halme sind mit 9 % statt 60 % Deckung rund siebenmal dünner
      // besetzt. Beides zusammen war der Neonteppich, den der Nutzer als
      // "Gras wirkt sehr hell" gemeldet hat. Mit der weissen Maske ist die
      // Tönung wieder das, was sie im Original ist: die einzige Farbquelle
      // (grass_terrain_color ø(89,119,66) — ein gedämpftes Oliv).
      try {
        const bild = new Image();
        bild.src = TEX_BASE_URL + 'grass_terrain_color.png';
        await new Promise<void>((fertig, fehler) => {
          bild.onload = () => fertig();
          bild.onerror = () => fehler(new Error('grass_terrain_color.png'));
        });
        // Downsample auf TINT_SIZE: Die Tönung wird pro INSTANZ gezogen,
        // nicht pro Pixel — die volle 1024²-Auflösung wäre 4 MB im RAM für
        // eine Information, die sich über Meter kaum ändert.
        const cv = document.createElement('canvas');
        cv.width = cv.height = TINT_SIZE;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bild, 0, 0, TINT_SIZE, TINT_SIZE);
        this.tintPixels = ctx.getImageData(0, 0, TINT_SIZE, TINT_SIZE).data;
        this.tintSize = TINT_SIZE;
      } catch {
        // Kein Abbruch: terrainTintAt() liefert dann Weiss, das Gras ist
        // heller als gewollt, aber alles andere läuft weiter.
        this.tintPixels = null;
      }

      this.variants = ENTRIES.map((entry) => {
        const geometry = geometries.get(entry.mesh)!;
        // top Y for sway normalization
        let topY = 0;
        for (let i = 1; i < geometry.positions.length; i += 3) topY = Math.max(topY, geometry.positions[i]);
        const material = new StandardMaterial(`clutter_${entry.key}`, this.scene);
        material.alpha = 1;
        // Textur und Tönung setzt applyTexture() unten — dieselbe Stelle,
        // die auch setHdClutter() benutzt, damit beide Wege nicht
        // auseinanderlaufen können.
        material.specularColor.setAll(0);
        // Unity vegetation is unlit-ish: the original relies on the
        // two-sided alpha-cutout shader with a strong ambient term. Babylon's
        // StandardMaterial lights the same texture from below the horizon and
        // produces black backface triangles; two-sided lighting plus eine
        // kleine Eigenleuchtung lassen die Karten wie in der Referenz lesen.
        //
        // 0.12 → 0.04 am 2026-07-29: Eigenleuchtung ist beleuchtungsUNABHÄNGIG
        // und addiert deshalb auch nachts und im dichten Nebel denselben
        // Betrag. Bei "Misty" um 19.7 h (Sonne 0.53, Nebel dunkelgrau) blieb
        // das Gras dadurch als leuchtend grüner Teppich in einer sonst fast
        // schwarzen Szene stehen — im Screenshot des Nutzers deutlich zu
        // sehen. Gegen schwarze Rückseiten genügt `twoSidedLighting` unten
        // allein; die Eigenleuchtung bleibt nur noch als minimaler Sockel.
        //
        // 0.04 → 0.0011 am 2026-07-31: Die Szene rechnet jetzt linear
        // (Farbraum-Block in Lighting.ts). 0.04 war ein Gamma-Betrag;
        // linear stehen gelassen wäre er das Sechsfache der nächtlichen
        // Nebelhelligkeit gewesen — aus dem "minimalen Sockel" wäre
        // wieder genau der leuchtende Teppich geworden, den die Zeile
        // darüber abgeschafft hat. 0.04^2.2 hält den Sockel dort, wo er
        // vorher sichtbar war.
        //
        // WIRKSAM ist dieser Wert allerdings erst seit StandardGammaFix
        // (2026-08-01). Vorher hängte default.fragment ein zweites
        // `toLinearSpace` an, das sich mit dem `toGamma` des
        // ImageProcessing exakt weghob — der Sockel erschien dadurch
        // nicht mit den beabsichtigten ~4 %, sondern mit 0,0011 ≈ 0,1 %
        // Bildschirmhelligkeit, also gar nicht. Mit dem Fix greift die
        // Rechnung 0.04^2.2 so, wie sie hier immer gemeint war:
        // 0.0011^(1/2.2) ≈ 0.045. NICHT weiter absenken — der Wert ist
        // nicht zu hoch, er war bisher nur wirkungslos.
        material.emissiveColor.set(0.0011, 0.0011, 0.0011);
        material.twoSidedLighting = true;
        material.backFaceCulling = false;
        material.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
        material.alphaCutOff = entry.cutoff;
        // Without this, StandardMaterial's ALPHATEST discard compares
        // material.alpha (always 1 here) instead of the texture's actual
        // alpha channel (default.fragment.fx: `alpha *= baseColor.a` is
        // gated behind #ifdef ALPHAFROMDIFFUSE) — the cutout never
        // triggers and every card renders as a fully opaque quad.
        material.useAlphaFromDiffuseTexture = true;
        new ClutterWindPlugin(material, {
          swayAmp: entry.swayAmp,
          pushDist: entry.pushDist,
          // Raw dumped values — the quality/fog scale is applied dynamically
          // every frame via ClutterWindPlugin.distanceScale (see update()),
          // not baked in here, so it can react to fog changes and to the
          // user changing the "Vegetationsqualität" setting mid-game.
          fadeMin: entry.fadeMin,
          fadeMax: entry.fadeMax,
          topY: Math.max(topY * entry.prefabScale[1] * entry.scaleMax, 0.05),
          pinUpNormals: entry.pinUpNormals,
          // Nur was AUF dem Wasser liegt, steigt und fällt mit ihm —
          // nicht alles, was auf den Wasserspiegel gesetzt wird. Der
          // Unterschied zwischen Seerose und Schilf, siehe `schwimmt`.
          aufWasser: entry.schwimmt === true,
        });
        return { entry, geometry, material, topY };
      });
      for (const v of this.variants) this.applyTexture(v);

      this.ready = true;
      console.log(`[GrassClutter] clutter system loaded (${this.variants.length} entries, patch ${PATCH}m, radius ${DISTANCE}m)`);
      if (!Number.isNaN(this.playerPatchX)) this.refreshCells();
    } catch (err) {
      console.warn('[GrassClutter] failed to load clutter assets — ground cover disabled', err);
    }
  }

  /** Per-instance meadows tint: grass_terrain_color at worldXZ × 0.01 (wrap). */
  private terrainTintAt(x: number, z: number): [number, number, number, number] {
    if (!this.tintPixels) return [1, 1, 1, 1];
    const n = this.tintSize;
    const u = ((x * 0.01 * n) % n + n) % n;
    const v = ((z * 0.01 * n) % n + n) % n;
    const idx = ((v | 0) * n + (u | 0)) * 4;
    const p = this.tintPixels;
    return [p[idx] / 255, p[idx + 1] / 255, p[idx + 2] / 255, 1];
  }

  /** Rasterzellen, in denen wegen eines Pickables kein Gras wächst. */
  private clearings = new Set<string>();

  /**
   * Freizuhaltende Stellen setzen (Positionen aufsammelbarer Objekte).
   *
   * Rastert jede Position auf CLEARING_GRID und markiert alle Zellen im
   * Umkreis von CLEARING_RADIUS. Ändert sich etwas, werden die betroffenen
   * Zellen verworfen und beim nächsten Durchlauf neu gebaut.
   */
  setClearings(punkte: ReadonlyArray<{ x: number; z: number }>): void {
    const next = new Set<string>();
    const reach = Math.ceil(CLEARING_RADIUS / CLEARING_GRID);
    for (const p of punkte) {
      const gx = Math.round(p.x / CLEARING_GRID);
      const gz = Math.round(p.z / CLEARING_GRID);
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          // Kreis, nicht Quadrat — sonst bekommt jeder Stein einen
          // sichtbar rechteckigen Hof.
          if (dx * dx + dz * dz > reach * reach) continue;
          next.add(`${gx + dx},${gz + dz}`);
        }
      }
    }
    // Nur die NEU hinzugekommenen Stellen freiräumen. clearArea() filtert
    // die Halme aus den bestehenden Puffern, statt Zellen neu zu bauen —
    // das kostet keinen Frame. Das Nachwachsen verhindert isClearing() im
    // Zellaufbau.
    const neu: Array<{ x: number; z: number }> = [];
    for (const p of punkte) {
      const k = `${Math.round(p.x / CLEARING_GRID)},${Math.round(p.z / CLEARING_GRID)}`;
      if (!this.clearings.has(k)) neu.push(p);
    }
    this.clearings = next;
    for (const p of neu) this.clearArea(p.x, p.z, CLEARING_RADIUS);
  }

  /** Steht an dieser Stelle ein Pickable, das freigehalten wird? */
  private isClearing(x: number, z: number): boolean {
    if (this.clearings.size === 0) return false;
    return this.clearings.has(
      `${Math.round(x / CLEARING_GRID)},${Math.round(z / CLEARING_GRID)}`
    );
  }

  /** Call every frame with the player position; cheap when the patch is unchanged. */
  setPlayerPosition(x: number, z: number): void {
    const px = Math.floor(x / PATCH);
    const py = Math.floor(z / PATCH);
    if (px === this.playerPatchX && py === this.playerPatchY) return;
    this.playerPatchX = px;
    this.playerPatchY = py;
    if (this.ready) this.refreshCells();
  }

  /**
   * "Vegetationsqualität" setting (0=Niedrig..3=Sehr hoch, see
   * VEGETATION_QUALITY_SCALE).
   *
   * Die Sichtweite selbst wirkt sofort — sie ist ein Uniform, das update()
   * jeden Frame neu setzt. Der BAURADIUS hängt seit dem 2026-08-02 aber
   * ebenfalls an der Stufe (siehe baurRadius), deshalb muss die Zellmenge
   * hier neu bestimmt werden: nach oben werden die zusätzlich nötigen
   * Zellen eingereiht, nach unten fallen die überflüssigen sofort weg.
   * Ohne diesen Aufruf bliebe beim Hochdrehen ein grasfreier Ring stehen,
   * bis der Spieler das nächste Mal eine Patchgrenze überquert.
   */
  setQuality(level: number): void {
    const neu = Math.max(0, Math.min(VEGETATION_QUALITY_SCALE.length - 1, level));
    if (neu === this.quality) return;
    this.quality = neu;
    if (this.ready && !Number.isNaN(this.playerPatchX)) this.refreshCells();
  }

  /**
   * HD-Clutter ein-/ausschalten (Settings.hdClutter).
   *
   * Wirkt sofort und ohne Neuaufbau der Zellen: Getauscht wird nur die
   * Textur am Material, die Halm-Geometrie und ihre Instanzmatrizen bleiben
   * unverändert. Nicht abgedeckte Einträge (kein HD_CLUTTER-Eintrag)
   * behalten still ihre Originaltextur.
   */
  setHdClutter(on: boolean): void {
    if (on === this.hd) return;
    this.hd = on;
    for (const v of this.variants) this.applyTexture(v);
  }

  /**
   * Legt die Clutter-Textur so an, wie GrassClutter sie braucht.
   *
   * sRGB→linear MUSS die GPU übernehmen. Die Szene rechnet linear
   * (Farbraum-Block in Lighting.ts), aber StandardMaterial dekodiert
   * `diffuseTexture` von sich aus NICHT — anders als PBRMaterial und anders
   * als der Terrain-TextureBlock, der dafür ausdrücklich
   * `convertToLinearSpace = true` setzt (TerrainSplat.ts).
   *
   * Ohne dieses Flag trifft eine als linear gelesene sRGB-Farbe auf lineares
   * Sonnenlicht. Gemessen am 2026-08-01 um 12 Uhr, gleiche Stelle, gleicher
   * Sonnenstand, Differenzbild Mesh an/aus:
   *
   *   Gras   (93, 91, 15)   R ≈ G, kein Blau  → gelb-oliv
   *   Boden  (65, 84, 25)   G > R             → grün
   *
   * Nur das Gras kippte, weil `sunColorDay` für "Clear" mit
   * (1.0, 0.772, 0.484) linearisiert (1.0, 0.566, 0.203) ergibt: Der
   * Grünkanal wird auf 57 % gedämpft, der Blaukanal auf 20 %. Bei einer
   * korrekt linearisierten Textur ist das Grün stark genug, um das
   * auszuhalten — bei einer gamma-kodierten nicht.
   *
   * Hardware-sRGB statt pow() im Shader, damit auch Filterung und Mipmaps im
   * linearen Raum laufen. Der Alphakanal wird dabei nicht dekodiert, der
   * Cutout bleibt also unverändert.
   */
  private makeTexture(url: string): Texture {
    const tex = new Texture(url, this.scene, {
      noMipmap: false,
      invertY: false,
      samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      useSRGBBuffer: true,
    });
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  /** Setzt Textur und Tönung eines Variants passend zum HD-Schalter. */
  private applyTexture(v: Variant): void {
    const entry = v.entry;
    const hdName = HD_CLUTTER[entry.texture];
    const useHd = this.hd && hdName !== undefined;
    const key = `${useHd ? 'hd' : 'o'}:${entry.texture}:${entry.texRepeatU}`;

    let tex = this.texCache.get(key);
    if (!tex) {
      const base = useHd
        ? this.makeTexture(`${HD_BASE_URL}${hdName}@${HD_SEASON}.png`)
        : this.texturesOrig.get(entry.texture);
      if (!base) return;
      // Bei Repeat ≠ 1 eine eigene Instanz, damit uScale nicht auf der
      // geteilten Basistextur landet (gilt nur für den Originalpfad — die
      // HD-Instanz oben gehört ohnehin allein diesem Schlüssel).
      tex = !useHd && entry.texRepeatU !== 1 ? (base.clone() as Texture) : base;
      tex.hasAlpha = true;
      tex.getAlphaFromRGB = false;
      if (entry.texRepeatU !== 1) tex.uScale = entry.texRepeatU;
      this.texCache.set(key, tex);
    }

    v.material.diffuseTexture = tex;
    v.material.diffuseColor.set(...(useHd ? HD_COLOR : entry.color));
  }

  /**
   * "Grasdichte" setzen (Index in GRASS_DENSITY).
   *
   * Anders als die Sichtweite wirkt die Dichte erst beim ERZEUGEN der
   * Halme. Bereits gebaute Zellen müssen deshalb verworfen und neu
   * aufgebaut werden — sonst bliebe die alte Dichte stehen, bis der
   * Spieler das Gebiet verlässt.
   */
  setDensity(level: number): void {
    const neu = GRASS_DENSITY[Math.max(0, Math.min(GRASS_DENSITY.length - 1, level))] ?? 1;
    if (neu === this.density) return;
    this.density = neu;
    for (const cell of this.cells.values()) for (const c of cell) c.mesh.dispose();
    this.cells.clear();
    this.queue = [];
    // Erzwingt im nächsten update() ein Neubefüllen der Warteschlange.
    this.playerPatchX = Number.NaN;
    this.playerPatchY = Number.NaN;
  }

  /**
   * Per-frame: build ≤CELLS_PER_FRAME queued cells, advance wind time, and
   * recompute the shared clutterDistanceScale uniform from the current
   * quality setting × fog visibility (see the BUILD_RADIUS doc above).
   *
   * fogDensity is the scene's current EXP2 fog density (same value fed to
   * TerrainSplat/scene.fogDensity). For that formula, opacity reaches 90%
   * at distance sqrt(ln 10) / density — rendering clutter further out than
   * that is wasted (it's already all but invisible in the murk) and, in
   * genuinely foggy weather, hides the vanish boundary anyway. This only
   * ever SHORTENS the user's chosen quality distance, never extends it
   * (clear weather has effectively infinite fog-visibility here).
   */
  update(dt: number, fogDensity: number): void {
    this.time += dt;
    ClutterWindPlugin.time = this.time;
    const qualityScale = VEGETATION_QUALITY_SCALE[this.quality];
    const fogVisibility90 = fogDensity > 1e-5 ? Math.sqrt(Math.LN10) / fogDensity : Infinity;
    const fogCapScale = (fogVisibility90 * 1.2) / FOG_REFERENCE_FADE;
    ClutterWindPlugin.distanceScale = Math.max(0.6, Math.min(qualityScale, fogCapScale));
    if (!this.ready) return;
    // ── Zellaufbau mit ZEITBUDGET statt fester Stückzahl ────────────
    // Eine feste Zahl (vorher 3) ist das falsche Mass: Wie teuer eine
    // Zelle ist, hängt von Biom, Dichte und Anzahl der Clutter-Einträge
    // ab — mal 0,3 ms, mal mehrere Millisekunden. Drei teure Zellen in
    // einem Frame reissen das 16,7-ms-Budget.
    //
    // Gemessen am 2026-07-30: Der Median lag durchgehend bei 17,1 ms
    // (also volle 60 fps), aber 25 % der Frames brauchten über 24 ms.
    // Mit abgeschaltetem Gras waren es nur 16 % — die Differenz ist der
    // Zellaufbau, nicht das Zeichnen (die Grasdichte zu senken änderte
    // an der Bildrate nichts, 48 fps bei voll wie bei wenig).
    //
    // Mindestens eine Zelle pro Frame, damit der Aufbau auch bei
    // knappem Budget vorankommt und nichts hängen bleibt.
    const budgetEnde = performance.now() + CELL_BUILD_BUDGET_MS;
    let gebaut = 0;
    while (this.queue.length > 0 && (gebaut === 0 || performance.now() < budgetEnde)) {
      const next = this.queue.shift()!;
      this.buildCell(next.cx, next.cy);
      gebaut++;
    }
  }

  /**
   * Remove the blades inside a circle — the tool-sized counterpart to
   * dropZones(), and what a terrain operation actually needs.
   *
   * C# reference: ClutterSystem.ResetGrass(center, radius), which only touches
   * the 8 m patches within the radius. Dropping whole zones instead (a zone is
   * 64 m, and it spans up to nine 40 m cells here) made a 2 m hoe stroke wipe
   * and rebuild grass across more than a hundred metres — visible as a large
   * neighbouring patch flickering back in over the next frames.
   *
   * Blades are filtered out of the existing thin-instance buffers, so nothing
   * is rebuilt and no frame is dropped. Anything that grows back later goes
   * through buildCell(), which re-checks the paint mask.
   */
  clearArea(x: number, z: number, radius: number): void {
    const r2 = radius * radius;
    const c0x = Math.floor((x - radius) / CELL_SIZE);
    const c1x = Math.floor((x + radius) / CELL_SIZE);
    const c0y = Math.floor((z - radius) / CELL_SIZE);
    const c1y = Math.floor((z + radius) / CELL_SIZE);

    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = `${cx},${cy}`;
        const cell = this.cells.get(key);
        if (!cell) continue;

        let cellChanged = false;
        const kept: CellMesh[] = [];
        for (const c of cell) {
          const count = c.matrix.length / 16;
          // Translation sits at offset 12..14 of each column-major matrix.
          const keep: number[] = [];
          for (let i = 0; i < count; i++) {
            const dx = c.matrix[i * 16 + 12] - x;
            const dz = c.matrix[i * 16 + 14] - z;
            if (dx * dx + dz * dz > r2) keep.push(i);
          }
          if (keep.length === count) {
            kept.push(c);
            continue;
          }
          cellChanged = true;
          if (keep.length === 0) {
            c.mesh.dispose();
            continue;
          }
          const matrix = new Float32Array(keep.length * 16);
          for (let k = 0; k < keep.length; k++) {
            matrix.set(c.matrix.subarray(keep[k] * 16, keep[k] * 16 + 16), k * 16);
          }
          c.mesh.thinInstanceSetBuffer('matrix', matrix, 16, false);
          c.matrix = matrix;
          if (c.color) {
            const color = new Float32Array(keep.length * 4);
            for (let k = 0; k < keep.length; k++) {
              color.set(c.color.subarray(keep[k] * 4, keep[k] * 4 + 4), k * 4);
            }
            c.mesh.thinInstanceSetBuffer('color', color, 4, false);
            c.color = color;
          }
          kept.push(c);
        }
        if (!cellChanged) continue;
        if (kept.length === 0) this.cells.delete(key);
        else this.cells.set(key, kept);
      }
    }
  }

  private refreshCells(): void {
    const { playerPatchX: px, playerPatchY: py } = this;
    const radius = baurRadius(this.quality);
    const wanted = new Set<string>();
    const pxC = (px + 0.5) * PATCH;
    const pyC = (py + 0.5) * PATCH;
    for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
      for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
        const cx = Math.floor((px + dx) / CELL_PATCHES);
        const cy = Math.floor((py + dy) / CELL_PATCHES);
        // Distance to the NEAREST point of the cell's footprint, not its
        // center (see baurRadius doc above) — this is what actually
        // determines whether any part of the cell could already be inside
        // the visible fade zone.
        const x0 = cx * CELL_SIZE;
        const x1 = x0 + CELL_SIZE;
        const z0 = cy * CELL_SIZE;
        const z1 = z0 + CELL_SIZE;
        const ddx = Math.min(Math.max(pxC, x0), x1) - pxC;
        const ddz = Math.min(Math.max(pyC, z0), z1) - pyC;
        if (ddx * ddx + ddz * ddz > radius * radius) continue;
        wanted.add(`${cx},${cy}`);
      }
    }
    for (const [key, cell] of this.cells) {
      if (!wanted.has(key)) {
        for (const c of cell) c.mesh.dispose();
        this.cells.delete(key);
      }
    }
    this.queue = [];
    for (const key of wanted) {
      if (this.cells.has(key)) continue;
      const [cx, cy] = key.split(',').map(Number);
      const ccx = (cx + 0.5) * CELL_SIZE;
      const ccy = (cy + 0.5) * CELL_SIZE;
      const ddx = ccx - (px + 0.5) * PATCH;
      const ddy = ccy - (py + 0.5) * PATCH;
      this.queue.push({ cx, cy, d2: ddx * ddx + ddy * ddy });
    }
    this.queue.sort((a, b) => a.d2 - b.d2);
  }

  /** Original GetPatchBiomes: 4 patch corners OR'd (None aborts the patch). */
  private patchBiomes(cx: number, cy: number): number {
    const x0 = cx * PATCH;
    const z0 = cy * PATCH;
    return (
      this.world.geo.getBiome(x0, z0) |
      this.world.geo.getBiome(x0 + PATCH, z0) |
      this.world.geo.getBiome(x0, z0 + PATCH) |
      this.world.geo.getBiome(x0 + PATCH, z0 + PATCH)
    );
  }

  /** One 40m cell = 4×4 patches × per-entry candidates → InstancedMesh per entry. */
  private buildCell(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    if (this.cells.has(key)) return;

    const matrices: Matrix[][] = this.variants.map(() => []);
    const tints: [number, number, number, number][][] = this.variants.map(() => []);

    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);

    const px0 = cx * CELL_PATCHES;
    const py0 = cy * CELL_PATCHES;

    for (let dpy = 0; dpy < CELL_PATCHES; dpy++) {
      for (let dpx = 0; dpx < CELL_PATCHES; dpx++) {
        const patchX = px0 + dpx;
        const patchY = py0 + dpy;
        const biomes = this.patchBiomes(patchX, patchY);
        if (biomes === Biome.None) continue;
        const centerX = (patchX + 0.5) * PATCH;
        const centerZ = (patchY + 0.5) * PATCH;
        const half = PATCH / 2;

        for (let e = 0; e < this.variants.length; e++) {
          const { entry } = this.variants[e];
          if ((biomes & entry.biome) === 0) continue;
          const count = Math.floor(entry.amount * AMOUNT_SCALE * this.density);

          for (let i = 0; i < count; i++) {
            const x = centerX - half + hash(patchX, patchY, e, i, 0) * PATCH;
            const z = centerZ - half + hash(patchX, patchY, e, i, 1) * PATCH;

            if (entry.inForest) {
              const f = this.world.geo.getForestFactor(x, z);
              if (f < entry.forestMin || f > entry.forestMax) continue;
            }
            if (entry.fractalScale > 0) {
              const f = fbm(x * 0.01 * entry.fractalScale, z * 0.01 * entry.fractalScale, 3, 1.6, 0.7);
              if (f < entry.fractalMin || f > entry.fractalMax) continue;
            }
            if ((this.world.geo.getBiome(x, z) & entry.biome) === 0) continue;

            // C# GenerateVegPatch: the m_onCleared/m_onUncleared test against
            // Heightmap.IsCleared. With the original's defaults this is what
            // keeps grass off a painted path, paving or cultivated soil — and
            // it is checked on every rebuild, so it survives reloading.
            const onCleared = entry.onCleared ?? false;
            const onUncleared = entry.onUncleared ?? true;
            if (!onCleared || !onUncleared) {
              const cleared = this.world.heightmaps.isCleared(x, z);
              if ((onCleared && !cleared) || (onUncleared && cleared)) continue;
            }

            // Rund um aufsammelbare Gegenstände bleibt der Boden frei.
            if (this.isClearing(x, z)) continue;

            const h = this.world.getGroundHeight(x, z);
            const alt = h - WATER_LEVEL;
            if (alt < entry.minAlt || alt > entry.maxAlt) continue;

            let nx = 0, ny = 1, nz = 0;
            if (entry.maxTiltCos > -1) {
              const hx = this.world.getGroundHeight(x + 0.75, z) - this.world.getGroundHeight(x - 0.75, z);
              const hz = this.world.getGroundHeight(x, z + 0.75) - this.world.getGroundHeight(x, z - 0.75);
              const len = Math.sqrt(hx * hx + 1.5 * 1.5 + hz * hz);
              nx = -hx / len; ny = 1.5 / len; nz = -hz / len;
              if (ny < entry.maxTiltCos) continue;
            }

            let y = h;
            if (entry.snapToWater) y = WATER_LEVEL;
            if (entry.randomOffset !== 0) {
              y += (hash(patchX, patchY, e, i, 4) * 2 - 1) * entry.randomOffset;
            }

            const rot = (hash(patchX, patchY, e, i, 2) * 360 * Math.PI) / 180;
            if (entry.terrainTilt) {
              const s = Math.sin(rot / 2);
              q.set(nx * s, ny * s, nz * s, Math.cos(rot / 2));
            } else {
              Quaternion.RotationAxisToRef(up, rot, q);
            }
            const s = entry.scaleMin + hash(patchX, patchY, e, i, 3) * (entry.scaleMax - entry.scaleMin);
            const m = Matrix.Compose(
              new Vector3(s * entry.prefabScale[0], s * entry.prefabScale[1], s * entry.prefabScale[2]),
              q,
              new Vector3(x, y, z)
            );
            matrices[e].push(m);
            if (entry.terrainTint) tints[e].push(this.terrainTintAt(x, z));
          }
        }
      }
    }

    const meshes: CellMesh[] = [];
    for (let e = 0; e < this.variants.length; e++) {
      const list = matrices[e];
      if (list.length === 0) continue;
      const variant = this.variants[e];
      // one Mesh per cell per entry, carrying the variant geometry + thin instances
      const mesh = new Mesh(`clutter_${key}_${variant.entry.key}`, this.scene);
      const v = new VertexData();
      v.positions = variant.geometry.positions;
      v.normals = variant.geometry.normals;
      v.uvs = variant.geometry.uvs;
      v.indices = variant.geometry.indices;
      v.applyToMesh(mesh);
      mesh.material = variant.material;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = false;
      // NICHT `doNotSyncBoundingInfo` setzen. Am 2026-07-29 als
      // Sparmassnahme eingebaut und sofort zurückgenommen: Zusammen mit
      // `alwaysSelectAsActiveMesh = false` oben bleibt der Hüllkörper dann
      // auf dem Stand VOR dem Setzen der Thin Instances — also leer. Die
      // Frustum-Prüfung wirft die Zelle daraufhin jedes Mal weg, und es
      // wächst überhaupt kein Gras mehr.
      // instance matrices (world space)
      const data = new Float32Array(list.length * 16);
      for (let i = 0; i < list.length; i++) list[i].toArray(data, i * 16);
      mesh.thinInstanceSetBuffer('matrix', data, 16, false);
      let col: Float32Array | null = null;
      if (variant.entry.terrainTint) {
        col = new Float32Array(list.length * 4);
        for (let i = 0; i < list.length; i++) col.set(tints[e][i], i * 4);
        mesh.thinInstanceSetBuffer('color', col, 4, false);
      }
      // Buffers are kept so clearArea() can drop single blades later.
      meshes.push({ mesh, matrix: data, color: col });
    }
    this.cells.set(key, meshes);
  }

  dispose(): void {
    for (const cell of this.cells.values()) for (const c of cell) c.mesh.dispose();
    this.cells.clear();
    this.queue = [];
    for (const v of this.variants) v.material.dispose();
    this.variants = [];
  }
}
