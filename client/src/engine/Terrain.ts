/**
 * Phase 1+G-TEX — chunked terrain rendering from the verified shared worldgen.
 *
 * One mesh per 64m zone (65×65 shared-edge vertices ⇒ no seams, see
 * Heightmap.ts header). Vertices are zone-local (f32 precision), the mesh
 * node carries the world offset. G-TEX (2026-07-26): the shared material is
 * the TerrainSplat NodeMaterial (original Valheim tiles, biome blending,
 * sand/rock/snow/lava rules) instead of the placeholder vertex colors.
 * The splat vertex attributes (aTiles/aWeights/aLava/aSnow/aRockTile) are
 * baked per chunk from cornerBiomes × smoothstep weights (same math as
 * Heightmap.build, blendSmoothStep=true from server.yml).
 *
 * G-POP: distant low-LOD terrain ring out to FAR_RADIUS (10 zones = 640m):
 * 2×2-zone chunks at 4m stride with a small downward bias (0.35m) so the
 * coarse mesh never z-fights the detailed one where they overlap.
 *
 * Winding: Babylon.js (WebGL) expects CCW front faces for upward normals.
 * The index order matches the C++ collision mesh (Heightmap.cpp):
 * T1=(v00,v01,v10), T2=(v10,v01,v11).
 */
import { Mesh, VertexData } from '@babylonjs/core/Meshes';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import { PhysicsShapeMesh } from '@babylonjs/core/Physics/v2/physicsShape';
import { misst } from './Zeitmessung';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import {
  Biome,
  Heightmap,
  HeightmapProvider,
  E_WIDTH,
  ZONE_UNITS,
  WATER_LEVEL,
} from '@wov/shared';
import type { ClientWorld } from '../world/World';
import { TerrainSplatMaterial, TILE, BIOME_TILE, maskUV, maskUVEmpty } from './TerrainSplat';
import { WaterPlugin } from './WaterPlugin';
import { WaterRefraction } from './WaterRefraction';
import { WaterDepthMap } from './WaterDepthMap';

/** Biome base colors (D5 fallback look — same palette as the three.js reference). */
const BIOME_COLORS: Record<number, [number, number, number]> = {
  [Biome.Meadows]: [0.36, 0.48, 0.24],
  [Biome.BlackForest]: [0.22, 0.34, 0.18],
  [Biome.Swamp]: [0.3, 0.28, 0.2],
  [Biome.Mountain]: [0.45, 0.45, 0.47],
  [Biome.Plains]: [0.55, 0.52, 0.28],
  [Biome.AshLands]: [0.18, 0.15, 0.14],
  [Biome.DeepNorth]: [0.85, 0.87, 0.9],
  [Biome.Ocean]: [0.25, 0.35, 0.35],
  [Biome.Mistlands]: [0.3, 0.35, 0.3],
};
const COLOR_FALLBACK: [number, number, number] = [0.4, 0.4, 0.4];
const SAND: [number, number, number] = [0.76, 0.7, 0.5];
const ROCK: [number, number, number] = [0.42, 0.4, 0.38];
const SNOW: [number, number, number] = [0.9, 0.9, 0.95];
const DEPTH_TINT: [number, number, number] = [0.16, 0.3, 0.34];
const BEACH_TOP = WATER_LEVEL + 2.5;
const ROCK_SLOPE = 0.72;

function blend(colors: Float32Array, vi: number, target: [number, number, number], k: number): void {
  colors[vi * 3] += (target[0] - colors[vi * 3]) * k;
  colors[vi * 3 + 1] += (target[1] - colors[vi * 3 + 1]) * k;
  colors[vi * 3 + 2] += (target[2] - colors[vi * 3 + 2]) * k;
}

/**
 * Zeitbudget pro Frame für den GESAMTEN Terrain-Unterhalt in update() —
 * Boden-Collider, Nah- UND Fernbau zusammen, in Millisekunden, dasselbe
 * Muster wie GrassClutters CELL_BUILD_BUDGET_MS.
 *
 * War vorher drei getrennte Budgets (BUILDS_PER_FRAME als feste Stückzahl,
 * dann je ein Zeitbudget für Chunk-Bau bzw. Boden-Collider), jedes mit
 * einer eigenen "mindestens eins"-Ausnahme, damit der Aufbau bei knappem
 * Budget nicht komplett verhungert. Genau diese drei getrennten Ausnahmen
 * konnten aber alle drei im SELBEN update()-Aufruf durchrutschen — ein
 * Boden-Collider, ein Nah-Chunk und ein Fern-Chunk, jeder für sich
 * unbudgetiert. Gemessen (headless, ohne GPU-Beschleunigung — absolute
 * Werte nicht auf echte Hardware übertragbar, das Verhältnis aber schon):
 * einzelne update()-Aufrufe bis 28,8 ms, während EntityManager/Shadows im
 * selben Test unter 1,2 ms blieben (15.08.2026). Ein GEMEINSAMES Budget
 * mit genau EINER "mindestens eins"-Ausnahme über alle drei Kategorien
 * hinweg (s. TerrainBudget) begrenzt das auf höchstens einen
 * unbudgetierten Posten pro Frame statt bis zu drei.
 */
const TERRAIN_BUDGET_MS = 4;

/** Gemeinsames Zeitfenster + "mindestens eins"-Flag für syncColliders()
 *  und die Chunk-Bau-Schleifen in update() — s. TERRAIN_BUDGET_MS. */
interface TerrainBudget {
  readonly ende: number;
  gebaut: boolean;
}

// G-POP distant ring
const FAR_STRIDE = 4; // meters between far vertices
const FAR_ZONES_PER_CHUNK = 2; // 2×2 zones = 128m per far chunk
const FAR_BIAS = -0.35; // push the coarse mesh below the detailed one

/**
 * "Detailgrad" (real Valheim GraphicsSettingInt.LOD — settings_lod, "Draw
 * distance / level of detail") — near-ring radius (full-res, zones) and
 * far-ring radius (low-LOD, zones) per quality level. Index matches
 * SettingsStore's 0=Niedrig/1=Mittel/2=Hoch/3=Sehr hoch; index 2 is the
 * project's previous fixed default (VIEW_RADIUS=4, FAR_RADIUS=10).
 */
const DETAIL_PRESETS: ReadonlyArray<{ view: number; far: number }> = [
  { view: 2, far: 6 },
  { view: 3, far: 8 },
  { view: 4, far: 10 },
  { view: 5, far: 14 },
];
const DEFAULT_DETAIL_QUALITY = 2;

/** Vertex-Abstand des Nahwassers in Metern. */
/**
 * Vertexabstand des Nahwasser-Netzes (m).
 *
 * EXPORTIERT, weil das Clutter-Plugin es braucht: Seerosen schwimmen auf
 * der Welle und müssen sich an der Fläche ausrichten, die tatsächlich
 * GEZEICHNET wird — und die ist zwischen diesen Stützstellen linear
 * interpoliert, nicht die analytische Welle. Zwei Zahlen, die
 * auseinanderdriften können, wären hier ein sicherer Weg zurück ins
 * Flimmern (siehe ClutterWindPlugin, CLUTTER_AUF_WASSER).
 */
export const WATER_STEP = 4;
/**
 * Zeitbudget für das Backen der Ufer-Nähe (ms je Frame).
 *
 * Die Ufer-Nähe braucht einen `getGroundHeight()`-Aufruf je Wasser-Vertex
 * (129² ≈ 16,6k bei 512 m / 4 m). Neu gebacken wird, sobald das Wasser
 * umgesetzt wird — alle 64 m, beim Sprint also alle ~8,5 s.
 *
 * Vorher stand hier `SHORE_ROWS_PER_FRAME = 16` mit der Annahme, sechzehn
 * Reihen seien "unauffällig". Die Messung vom 16.08.2026 sagt etwas
 * anderes: Dieser Posten ist mit **37 % der Terrain-Zeit der grösste
 * überhaupt** — grösser als die Zonengenerierung, grösser als das
 * Havok-Cooking. Der Grund ist derselbe wie bei den drei bereits
 * korrigierten Stellen im Projekt: `getGroundHeight()` ist variabel teuer.
 * Liegt die Zone im Cache, kostet der Aufruf fast nichts; muss sie erst
 * erzeugt werden, rechnet er eine ganze Zone durch. Eine feste Reihenzahl
 * trifft damit mal nichts und mal alles.
 *
 * Vier Millisekunden sind derselbe Wert wie `TERRAIN_BUDGET_MS` und
 * `GrassClutter.CELL_BUILD_BUDGET_MS`.
 */
const UFER_BUDGET_MS = 4;

/**
 * Deckkraft des Wassers bei "Wasserqualität: Aus" (ohne Refraktionsbild).
 *
 * Von 0.82 auf 0.90 angehoben. Vorher lagen an jeder Stelle ZWEI Flächen
 * à 0.82 übereinander (Nahwasser plus die alte Fernwasser-Vollfläche),
 * effektiv also 1 - 0.18² ≈ 0.97. Seit der Ring nicht mehr überlappt,
 * ist es nur noch eine Lage — mit dem alten Wert wirkte das Wasser
 * schlagartig zu durchsichtig. Die eigentliche Tiefenstaffelung macht
 * ohnehin der Shader (WATER_ALPHA_SHALLOW..DEEP); das hier ist der
 * Deckel darüber.
 */
const WATER_ALPHA_FALLBACK = 0.9;

/** Aussenmass des Fernwassers (m). EXP2-Nebel schluckt die Aussenkante. */
const FAR_WATER_SIZE = 2048;
/**
 * `aDepth` des Fernwasser-Rings (m). Gross genug, dass depth01 = 1 (volle
 * Wellenamplitude) gilt und der Wellenhub die Fläche niemals trockenfallen
 * lässt — gemessen liegt er bei p1..p99 zwischen -2,1 und +2,9 m.
 */
const FAR_WATER_DEPTH = 40;

/**
 * Fernwasser als RING (Rahmen mit exaktem Loch) statt als Vollfläche.
 *
 * BUG, den das behebt (vom Nutzer gemeldet: "ein Wellenlayer liegt
 * darüber, der auch im Flachwasser ankommt, wo dann die Transparenz
 * kaputt ist"): vorher lag hier ein 2048-m-Vollflächenquad bei
 * WATER_LEVEL - 0.05, also UNTER der gesamten Nahwasserfläche und ÜBER
 * jedem Strandgrund unterhalb 29,95 m. Es trug das WaterPlugin nicht und
 * hatte damit weder Tiefenlogik noch Schaum noch Durchsicht. Überall, wo
 * das Nahwasser per discard trockenfällt, zeichnete es sich hart durch.
 * Bei Wasserqualität 0 standen zusätzlich ZWEI Flächen à alpha 0.82
 * übereinander: effektiv 0.97 Deckkraft, also praktisch keine Transparenz.
 *
 * Das Loch ist exakt so gross wie die Nahwasserfläche, und beide Meshes
 * folgen derselben auf ZONE_UNITS gesnappten Position — es gibt weder
 * Überlappung noch Lücke. Damit entfällt auch der 5-cm-Höhenversatz, der
 * die Sortierung im transparenten Pass entarten liess (beide Flächen
 * haben dasselbe XZ-Zentrum; Babylon sortiert nach Abstand Kamera ↔
 * Bounding-Sphere-Zentrum, und die Reihenfolge kippte beim Untertauchen).
 *
 * Acht Quads, 16 Vertices. Ein feineres Gitter bringt nichts: die
 * Wellenverschiebung braucht der Ring nicht (er liegt jenseits des
 * LOD-Bands), und koplanare Flächen können keine T-Junction-Risse
 * erzeugen.
 *
 * Winding wie im Rest der Datei: T1=(v00,v01,v10), T2=(v10,v01,v11).
 */
function buildWaterRing(inner: number, outer: number): VertexData {
  const hi = inner / 2;
  const ho = outer / 2;
  const koord = [-ho, -hi, hi, ho];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      positions.push(koord[i], 0, koord[j]);
      normals.push(0, 1, 0);
      uvs.push((koord[i] + ho) / outer, (koord[j] + ho) / outer);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue; // das Loch — hier liegt das Nahwasser
      const v00 = j * 4 + i;
      const v10 = v00 + 1;
      const v01 = (j + 1) * 4 + i;
      const v11 = v01 + 1;
      indices.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return vd;
}

/** Smoothstep like shared smoothStepD(0,1,t) (mirrored — Heightmap uses it
 *  internally; server.yml blendSmoothStep=true). */
function sstep(t: number): number {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

interface Chunk {
  mesh: Mesh;
  zoneX: number;
  zoneY: number;
  /**
   * Retained so terraforming can rewrite them in place (refreshZones) instead
   * of rebuilding the chunk. Only these three depend on height — aTiles,
   * aWeights, aLava and aRockTile are biome-derived and never change.
   */
  positions: Float32Array;
  normals: Float32Array;
  aSnow: Float32Array;
}

interface FarChunk {
  mesh: Mesh;
  /** far-chunk grid coords (each covers FAR_ZONES_PER_CHUNK² zones) */
  fx: number;
  fy: number;
}

export class TerrainManager {
  private readonly scene: Scene;
  private readonly world: ClientWorld;
  private readonly splat: TerrainSplatMaterial;
  private readonly material: NodeMaterial;
  /** Debug flat vertex-color material (?flat=1) — bypasses the splat shader. */
  private readonly flatMaterial: StandardMaterial;
  /** True when ?flat=1: use vertex colors instead of the splat NodeMaterial. */
  readonly flatMode: boolean;
  private readonly chunks = new Map<string, Chunk>();
  private readonly buildQueue: Array<[number, number]> = [];
  private readonly water: Mesh;
  // G-POP far terrain ring
  private readonly farChunks = new Map<string, FarChunk>();
  private readonly farBuildQueue: Array<[number, number]> = [];
  // G-POP far water (static, to the horizon) — RING, siehe buildWaterRing
  private readonly waterRing: Mesh;
  private readonly waterMat: StandardMaterial;
  /** Szenenpass für die Durchsicht — siehe WaterRefraction.ts. */
  private readonly refraction: WaterRefraction;
  /** Grundhöhe je Quadratmeter fürs Fragment — siehe WaterDepthMap.ts. */
  private readonly depthMap: WaterDepthMap;
  // near water data (Verschiebung selbst läuft im Shader, s. WaterPlugin)
  private readonly waterBaseXZ: Float32Array;
  /** Wassertiefe pro Wasser-Vertex in Metern (0 = Grund über Wasser). */
  private readonly waterDepth: Float32Array;
  private readonly waterVertsPerRow: number;
  /** Nächste zu backende Zeile; -1 = nichts zu tun (siehe bakeShoreRows). */
  private shoreBakeRow = -1;
  private shoreBakeOriginX = 0;
  private shoreBakeOriginZ = 0;
  /** Siehe `ready` — bis dahin bleibt das Wasser unsichtbar. */
  private initialReady = false;
  // "Detailgrad" setting (see DETAIL_PRESETS) — full-res / low-LOD ring radii
  private viewRadius = DETAIL_PRESETS[DEFAULT_DETAIL_QUALITY].view;
  private farRadius = DETAIL_PRESETS[DEFAULT_DETAIL_QUALITY].far;

  constructor(scene: Scene, world: ClientWorld, sonne: DirectionalLight) {
    this.scene = scene;
    this.world = world;

    // G-TEX: original Valheim tiles + biome blending (replaces vertex colors)
    this.splat = new TerrainSplatMaterial(scene, WATER_LEVEL, sonne);
    this.material = this.splat.material;

    // ?flat=1 debug: plain biome vertex colors (validates geometry + biome bake
    // independently of the splat NodeMaterial). The splat NodeMaterial is the
    // real/default terrain look (fixed 2026-07-26: the manual world*view*
    // projection MultiplyBlock chain in TerrainSplat.ts used the wrong
    // multiplication order and made the whole terrain invisible — that bug,
    // not a texturing issue, was why ?flat=1 briefly became the accidental
    // default here).
    const params = new URLSearchParams(location.search);
    this.flatMode = params.has('flat');
    this.flatMaterial = new StandardMaterial('terrainFlat', scene);
    this.flatMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.flatMaterial.backFaceCulling = false;
    this.flatMaterial.specularPower = 64;

    // Near water: 8×8 zones (512m), 4m vertex spacing for sine animation
    const waterSize = ZONE_UNITS * 8;
    const waterSeg = (waterSize / WATER_STEP) | 0;
    const water = Mesh.CreateGround('water', waterSize, waterSize, waterSeg, scene);
    water.position.y = WATER_LEVEL;
    water.isPickable = false;
    const waterMat = new StandardMaterial('waterMat', scene);
    waterMat.diffuseColor = new Color3(0.10, 0.19, 0.24);
    // Alpha nur für "Wasserqualität: Aus". Sobald das Refraktionsbild
    // steht, wird das Material OPAK — so rendert auch das Original
    // (_SrcBlend One / _DstBlend Zero / _ZWrite 1), siehe setWaterQuality().
    waterMat.alpha = WATER_ALPHA_FALLBACK;
    // Kein StandardMaterial-Glanz: Spiegelung und Sonnenglitzern kommen
    // ausschliesslich aus dem WaterPlugin. Vorher lagen VIER unabhängige
    // Glanzebenen übereinander (dieses Specular mit der orangen
    // sun.specular-Farbe, der Fresnel-Sky-Mix, das Glitzern und darüber
    // noch Bloom) — das war ein Teil der gemeldeten "braunen Spiegelungen".
    waterMat.specularColor = Color3.Black();
    this.waterMat = waterMat;
    // Die Normal-Maps liegen im WaterPlugin, nicht als bumpTexture: nur
    // dort lassen sie sich tiefen- und distanzabhängig dämpfen, auf
    // Weltkoordinaten kacheln (statt auf Mesh-UV, was auf Nah- und
    // Fernfläche verschieden gross ausfiel) und im Fall der echten
    // _Normal überhaupt korrekt entpacken. Begründung im Plugin.
    water.material = waterMat;
    this.water = water;

    // Mesh-lokale XZ je Vertex — Basis für das Tiefen-Backen unten
    const posData = water.getVerticesData('position')!;
    const waterVerts = posData.length / 3;
    this.waterBaseXZ = new Float32Array(waterVerts * 2);
    for (let i = 0; i < waterVerts; i++) {
      this.waterBaseXZ[i * 2] = posData[i * 3];
      this.waterBaseXZ[i * 2 + 1] = posData[i * 3 + 2];
    }
    // Wassertiefe pro Vertex in METERN (0 = Grund auf/über Wasserhöhe).
    // Das WaterPlugin liest sie als `aDepth` und leitet daraus sowohl die
    // Wellenamplitude (÷10 m, wie `Depth()` im Original) als auch den
    // Ufer-Schaum ab.
    this.waterDepth = new Float32Array(waterVerts);
    this.waterVertsPerRow = waterSeg + 1;
    water.setVerticesData('aDepth', this.waterDepth, true, 1);
    // Plugin erst NACH setVerticesData anhängen (es meldet `aDepth` als
    // benötigtes Attribut an; fehlt der Buffer beim ersten Kompilieren,
    // rendert der erste Frame ohne Wellen/Schaum).
    //
    // ⚠ NICHT umstellen und nichts dazwischenschieben, das das Material
    // zum Rendern bringt: MaterialPluginManager baut den Uniform-Buffer
    // NEU auf, wenn sein Layout beim Anhängen bereits steht. Ein zu
    // diesem Zeitpunkt schon kompilierter Effect zeigt dann auf den
    // alten, zu kleinen Puffer — Symptom ist "used but unbound uniform
    // buffer" beim Zeichnen. Siehe auch getUniforms() im Plugin.
    new WaterPlugin(waterMat, scene);
    // Die Verschiebung passiert im Shader — Babylons Frustum-Culling
    // kennt nur die unverformte Bounding-Box. Ohne das hier könnte die
    // Fläche bei Wellenbergen am Bildrand wegkulliert werden.
    water.alwaysSelectAsActiveMesh = true;

    // G-POP: static far water out to the horizon (fog swallows the edge)
    //
    // Das ist unser Gegenstück zum `water_lod`-Material des Originals.
    // Dessen Kennzeichen: _ColorTop und _ColorBottom sind IDENTISCH
    // (0.098/0.196/0.169) — kein Tiefenverlauf, keine Durchsicht, eine
    // einheitlich blickdichte Fläche. Den Look erzeugt das Plugin selbst
    // über sein LOD-Band; der Ring braucht dafür kein eigenes Material
    // mehr. Genau das ist der Punkt: EIN Material, EIN Plugin, EIN UBO —
    // vorher musste jede Korrektur am Wasser doppelt gepflegt werden, und
    // die Fernfläche fiel bei jeder davon durchs Raster.
    const ring = new Mesh('waterRing', scene);
    buildWaterRing(waterSize, FAR_WATER_SIZE).applyToMesh(ring);
    // Konstante Tiefsee. Das Plugin verlangt `aDepth` als Attribut; ohne
    // den Buffer bliebe der Ring beim ersten Kompilieren ohne Wellen.
    ring.setVerticesData('aDepth', new Float32Array(16).fill(FAR_WATER_DEPTH), false, 1);
    ring.position.y = WATER_LEVEL; // KEIN -0.05: keine Überlappung, kein Z-Fight
    ring.isPickable = false;
    ring.material = waterMat;
    ring.alwaysSelectAsActiveMesh = true;
    this.waterRing = ring;
    this.refraction = new WaterRefraction(scene);
    this.depthMap = new WaterDepthMap(scene, world);
    WaterPlugin.groundMap = this.depthMap.texture;
    WaterPlugin.groundInfo = this.depthMap.info;

    // Wasser bleibt unsichtbar, bis der Nah-Ring steht. Sonst liegt beim
    // Einloggen die 512-m-Wasserfläche über noch ungebautem Gelände —
    // man sieht dann Wasser (und dessen Ufer-Schaum) mitten auf dem Land,
    // was der Nutzer als "Schaumkrone auf Landflächen" gemeldet hat.
    water.setEnabled(false);
    ring.setEnabled(false);

    // ── Render-Order explizit ─────────────────────────────────────
    // Vorher lag alles in Gruppe 0 und die Sichtbarkeit hing allein an
    // Babylons Alpha-Heuristik (needAlphaBlending() liest alpha < 1) —
    // die Wasserfläche wanderte also je nach Qualitätsstufe zwischen
    // opakem und transparentem Durchgang, ohne dass das irgendwo stand.
    //
    // Gruppe 1 ist frei (nur ValheimSky setzt überhaupt einen Wert,
    // nämlich 0). Die zweite Zeile ist dabei PFLICHT: autoClear ist für
    // Gruppen > 0 per Default an, und ohne sie löscht Babylon vor
    // Gruppe 1 den Tiefenpuffer — das Wasser zeichnete sich dann über
    // Gelände, das davor steht.
    water.renderingGroupId = 1;
    ring.renderingGroupId = 1;
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  }

  /** Per frame: sync sun/ambient/fog into the splat material (Lighting). */
  syncLighting(
    sunDir: Vector3,
    sunColor: Color3,
    ambient: Color3,
    fogDensity: number,
    fogColor: Color3
  ): void {
    this.splat.syncLighting(sunDir, sunColor, ambient, fogDensity, fogColor);
  }

  /**
   * Backt die Wassertiefe (`aDepth`, in Metern) für einen Teil der
   * Wasser-Vertices und lädt den Buffer hoch, sobald das Gitter fertig
   * ist. Der Shader leitet daraus Wellenamplitude (÷10 m) und Schaumsaum
   * ab — siehe WaterPlugin.ts.
   *
   * Über mehrere Frames verteilt (SHORE_ROWS_PER_FRAME), weil je Vertex
   * ein getGroundHeight()-Aufruf mit voller Worldgen-Noise anfällt.
   */
  private bakeShoreRows(): void {
    if (this.shoreBakeRow < 0) return;
    const perRow = this.waterVertsPerRow;
    const originX = this.shoreBakeOriginX;
    const originZ = this.shoreBakeOriginZ;
    // Zeitbudget statt fester Reihenzahl. Genau EINE Reihe geht immer
    // durch, sonst kommt der Bake bei knappem Budget nie ans Ende und das
    // Wasser bliebe dauerhaft ohne Ufersaum.
    const ende = performance.now() + UFER_BUDGET_MS;
    let row = this.shoreBakeRow;
    for (; row < perRow; row++) {
      for (let col = 0; col < perRow; col++) {
        const i = row * perRow + col;
        const x = this.waterBaseXZ[i * 2] + originX;
        const z = this.waterBaseXZ[i * 2 + 1] + originZ;
        // Rohe Tiefe in Metern; negativ (Grund über Wasser) auf 0 geklemmt.
        // Der Shader leitet daraus sowohl Wellenamplitude als auch
        // Schaumsaum ab — die Normalisierung passiert dort.
        const depth = WATER_LEVEL - this.world.getGroundHeight(x, z);
        this.waterDepth[i] = depth > 0 ? depth : 0;
      }
      // Nach der Reihe prüfen, nicht davor: so ist die "mindestens eins"-
      // Ausnahme ohne zweiten Zähler erfüllt.
      if (performance.now() >= ende) {
        row++;
        break;
      }
    }
    this.shoreBakeRow = Math.min(row, perRow);
    if (this.shoreBakeRow >= perRow) {
      this.shoreBakeRow = -1;
      this.water.updateVerticesData('aDepth', this.waterDepth);
    }
  }

  /**
   * Phase G: Dungeon-Instanz betreten/verlassen. Das Wasser folgt sonst dem
   * Spieler (update setzt water.position auf die Spielerkoordinaten) und
   * läge als Ozeanfläche unter den Räumen; die Terrain-Chunks bleiben
   * stehen, sind aber 100 km entfernt und fallen aus dem Frustum. Der
   * Aufrufer pausiert zusätzlich update() — deshalb muss die Sichtbarkeit
   * hier explizit geschaltet werden (initialReady schaltet sonst wieder ein).
   */
  setInstanzModus(aktiv: boolean): void {
    const sichtbar = !aktiv && this.initialReady;
    this.water.setEnabled(sichtbar);
    this.waterRing.setEnabled(sichtbar);
  }

  /** "Detailgrad" setting (0=Niedrig..3=Sehr hoch) — see DETAIL_PRESETS.
   *  Takes effect on the next update() call: a larger radius queues the
   *  newly-needed rings, a smaller one drops out-of-range chunks. */
  setDetailQuality(level: number): void {
    const preset = DETAIL_PRESETS[Math.max(0, Math.min(DETAIL_PRESETS.length - 1, level))];
    this.viewRadius = preset.view;
    this.farRadius = preset.far;
  }

  /**
   * Einstellung "Wasserqualität" (0..3). Baut den Refraktionspass auf bzw.
   * ab und schaltet das Wassermaterial entsprechend zwischen OPAK (mit
   * Refraktion, wie im Original) und alphagemischt (Stufe 0) um.
   *
   * Das Umschalten der Deckkraft muss `blockMaterialDirtyMechanism`
   * (main.ts) kurz aufheben: die Sperre unterdrückt sonst genau die
   * Neubewertung von needAlphaBlending(), und das Wasser bliebe im
   * transparenten Renderdurchgang hängen.
   */
  setWaterQuality(level: number): void {
    this.refraction.setQuality(level);
    const tex = this.refraction.texture;
    WaterPlugin.refraction = tex;

    const opak = tex !== null;
    const alpha = opak ? 1 : WATER_ALPHA_FALLBACK;
    if (this.waterMat.alpha === alpha) return;
    const gesperrt = this.scene.blockMaterialDirtyMechanism;
    this.scene.blockMaterialDirtyMechanism = false;
    this.waterMat.alpha = alpha;
    // Den Modus mitschalten statt ihn aus der Deckkraft raten zu lassen.
    if (opak) {
      // Wie das Original: _SrcBlend One / _DstBlend Zero / _ZWrite 1.
      this.waterMat.transparencyMode = Material.MATERIAL_OPAQUE;
    } else {
      this.waterMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      this.waterMat.alphaMode = Constants.ALPHA_COMBINE;
      // Unschädlich, seit Nahfläche und Ring nicht mehr überlappen: pro
      // Pixel gibt es nur EINE Wasserlage. Verhindert, dass anderes
      // Transparentes hinter dem Wasser darüber zeichnet.
      this.waterMat.forceDepthWrite = true;
    }
    this.scene.blockMaterialDirtyMechanism = gesperrt;
  }

  /** Call every frame with the camera/player position. */
  update(px: number, pz: number, elapsed: number): void {
    const cz = HeightmapProvider.worldToZone(px);
    const cw = HeightmapProvider.worldToZone(pz);

    // Ein Budget, eine "mindestens eins"-Ausnahme für den gesamten
    // Terrain-Unterhalt dieses Aufrufs — s. TERRAIN_BUDGET_MS.
    const budget: TerrainBudget = { ende: performance.now() + TERRAIN_BUDGET_MS, gebaut: false };

    misst('terrain.colliderSync', () => this.syncColliders(cz, cw, budget));

    // queue missing chunks inside the ring (center-out)
    misst('terrain.ringScan', () => {
    for (let r = 0; r <= this.viewRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const zx = cz + dx;
          const zy = cw + dy;
          const key = `${zx},${zy}`;
          if (!this.chunks.has(key) && !this.buildQueue.some(([qx, qy]) => qx === zx && qy === zy)) {
            this.buildQueue.push([zx, zy]);
          }
        }
      }
    }
    });

    // drop chunks outside the ring
    misst('terrain.chunkVerwerfen', () => {
    for (const [key, chunk] of this.chunks) {
      if (Math.max(Math.abs(chunk.zoneX - cz), Math.abs(chunk.zoneY - cw)) > this.viewRadius + 1) {
        chunk.mesh.dispose();
        this.chunks.delete(key);
      }
    }
    });

    // budgeted near builds — teilt sich `budget` mit syncColliders() und
    // dem Fernbau unten, s. TERRAIN_BUDGET_MS.
    while (this.buildQueue.length > 0 && (!budget.gebaut || performance.now() < budget.ende)) {
      const [zx, zy] = this.buildQueue.shift()!;
      if (this.chunks.has(`${zx},${zy}`)) continue;
      this.buildChunk(zx, zy);
      budget.gebaut = true;
    }

    // G-POP: far chunk ring — queue/dispose
    misst('terrain.fernRing', () => this.refreshFarChunks(cz, cw));
    // budgeted far builds (only when no near chunk is pending), gleiches
    // Budget wie oben.
    if (this.buildQueue.length === 0) {
      while (
        this.farBuildQueue.length > 0 &&
        (!budget.gebaut || performance.now() < budget.ende)
      ) {
        const [fx, fy] = this.farBuildQueue.shift()!;
        if (this.farChunks.has(`${fx},${fy}`)) continue;
        this.buildFarChunk(fx, fy);
        budget.gebaut = true;
      }
    }

    // water follows the player (snapped to zone grid for wave phase stability)
    const wx = Math.round(px / ZONE_UNITS) * ZONE_UNITS;
    const wz = Math.round(pz / ZONE_UNITS) * ZONE_UNITS;
    this.water.position.x = wx;
    this.water.position.z = wz;
    this.waterRing.position.x = wx;
    this.waterRing.position.z = wz;

    // Ufer-Nähe neu backen, sobald das Wasser umgesetzt wurde
    if (wx !== this.shoreBakeOriginX || wz !== this.shoreBakeOriginZ || this.shoreBakeRow === -1) {
      if (wx !== this.shoreBakeOriginX || wz !== this.shoreBakeOriginZ) {
        this.shoreBakeOriginX = wx;
        this.shoreBakeOriginZ = wz;
      }
      this.shoreBakeRow = 0;
    }
    misst('terrain.uferBacken', () => this.bakeShoreRows());
    // Tiefenkarte fürs Fragment — dieselbe gesnappte Mitte wie die Meshes.
    this.depthMap.setzeMitte(wx, wz);
    misst('terrain.tiefenkarte', () => this.depthMap.schritt());

    // Nah-Ring vollständig + Ufer-Nähe einmal gebacken ⇒ Wasser einblenden
    // und den Ladebildschirm freigeben.
    if (
      !this.initialReady &&
      this.buildQueue.length === 0 &&
      this.shoreBakeRow === -1 &&
      this.depthMap.fertig
    ) {
      const want = (2 * this.viewRadius + 1) ** 2;
      if (this.chunks.size >= want) {
        this.initialReady = true;
        this.water.setEnabled(true);
        this.waterRing.setEnabled(true);
      }
    }

    // Die Wellenverschiebung läuft jetzt im Vertex-Shader (WaterPlugin,
    // echte WaterVolume.CalcWave-Formel). Hier bleibt nichts zu tun:
    // zehn Oktaven × zwei TrochSin je Vertex wären auf der CPU pro Frame
    // nicht bezahlbar (~330k Trigonometrie-Aufrufe bei 16,6k Vertices).
    //
    // Frühere CPU-Variante hatte zusätzlich einen echten Fehler: sie
    // dämpfte die Wellen mit `* (1 - 0.65 * shore)` ausgerechnet am Ufer
    // und verhinderte damit genau das Überspülen des Strands, das das
    // Original zeigt. Details im Kopfkommentar von WaterPlugin.ts.

    // Wasserzeit — treibt Wellen, Normal-Scroll und Schaum im WaterPlugin.
    // Das Scrollen der Normal-Maps lief früher hier über uOffset/vOffset
    // der bumpTexture; es passiert jetzt im Shader, weil die Maps dort
    // liegen.
    WaterPlugin.time = elapsed;
  }

  /**
   * F4: dispose chunks whose heightmaps changed (terrain leveling under
   * locations, registered via HeightmapProvider.addTerrainModifier). The
   * regular update() ring-scan re-queues and rebuilds them.
   */
  rebuildZones(zones: ReadonlyArray<readonly [number, number]>): void {
    // Der Meeresgrund hat sich geändert — die Wassertiefe stimmt nicht mehr.
    if (zones.length > 0) this.depthMap.invalidiere();
    for (const [zx, zy] of zones) {
      const chunk = this.chunks.get(`${zx},${zy}`);
      if (chunk) {
        chunk.mesh.dispose();
        this.chunks.delete(`${zx},${zy}`);
      }
      // Far chunks overlapping the re-leveled zone must rebuild too
      const fk = this.farKeyForZone(zx, zy);
      const far = this.farChunks.get(fk);
      if (far) {
        far.mesh.dispose();
        this.farChunks.delete(fk);
      }
    }
  }

  /** G-POP: recompute the needed far-chunk set (2×2-zone grid, fixed even alignment). */
  private refreshFarChunks(cz: number, cw: number): void {
    // Dispose far chunks that overlap the near area OR are out of range.
    // "Overlaps" (not "fully covered"): a far chunk covering zones 4-5 with
    // viewRadius=4 has zone 4 in the near ring — two meshes z-fight there.
    for (const [key, fc] of this.farChunks) {
      const zx = fc.fx * FAR_ZONES_PER_CHUNK;
      const zy = fc.fy * FAR_ZONES_PER_CHUNK;
      const overlapsNear =
        Math.max(zx - cz, 0, cz - (zx + FAR_ZONES_PER_CHUNK - 1)) <= this.viewRadius &&
        Math.max(zy - cw, 0, cw - (zy + FAR_ZONES_PER_CHUNK - 1)) <= this.viewRadius;
      const nearestX = Math.max(zx - cz, 0, cz - (zx + FAR_ZONES_PER_CHUNK - 1));
      const nearestY = Math.max(zy - cw, 0, cw - (zy + FAR_ZONES_PER_CHUNK - 1));
      if (overlapsNear || Math.max(nearestX, nearestY) > this.farRadius + 1) {
        fc.mesh.dispose();
        this.farChunks.delete(key);
      }
    }

    this.farBuildQueue.length = 0;
    const half = Math.ceil(this.farRadius / FAR_ZONES_PER_CHUNK);
    const cfx = Math.floor(cz / FAR_ZONES_PER_CHUNK);
    const cfy = Math.floor(cw / FAR_ZONES_PER_CHUNK);
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) {
        const fx = cfx + dx;
        const fy = cfy + dz;
        const zx = fx * FAR_ZONES_PER_CHUNK;
        const zy = fy * FAR_ZONES_PER_CHUNK;
        // Skip chunks overlapping the near area at all
        const overlapsNear =
          Math.max(zx - cz, 0, cz - (zx + FAR_ZONES_PER_CHUNK - 1)) <= this.viewRadius &&
          Math.max(zy - cw, 0, cw - (zy + FAR_ZONES_PER_CHUNK - 1)) <= this.viewRadius;
        if (overlapsNear) continue;
        const nearestX = Math.max(zx - cz, 0, cz - (zx + FAR_ZONES_PER_CHUNK - 1));
        const nearestY = Math.max(zy - cw, 0, cw - (zy + FAR_ZONES_PER_CHUNK - 1));
        if (Math.max(nearestX, nearestY) > this.farRadius) continue;
        const key = `${fx},${fy}`;
        if (!this.farChunks.has(key)) {
          this.farBuildQueue.push([fx, fy]);
        }
      }
    }
    // Sort nearest first
    this.farBuildQueue.sort(([ax, ay], [bx, by]) => {
      const d2a = (ax * FAR_ZONES_PER_CHUNK - cz) ** 2 + (ay * FAR_ZONES_PER_CHUNK - cw) ** 2;
      const d2b = (bx * FAR_ZONES_PER_CHUNK - cz) ** 2 + (by * FAR_ZONES_PER_CHUNK - cw) ** 2;
      return d2a - d2b;
    });
  }

  private farKeyForZone(zx: number, zy: number): string {
    return `${Math.floor(zx / FAR_ZONES_PER_CHUNK)},${Math.floor(zy / FAR_ZONES_PER_CHUNK)}`;
  }

  /**
   * Generic terrain grid builder shared by near and far chunks.
   * `zonesPerSide`² zones starting at zone (zx0,zy0), vertex spacing `step`
   * meters (must divide 64), all positions biased by `yBias`.
   *
   * Positions are WORLD-space (mesh node stays at origin). Winding:
   * T1=(v00,v01,v10), T2=(v10,v01,v11) — same as C++ Heightmap.cpp
   * collision mesh. Babylon.js (WebGL) CCW front face with upward normal.
   */
  private buildGridGeometry(
    zx0: number,
    zy0: number,
    zonesPerSide: number,
    step: number,
    yBias: number
  ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array;
       colors: Float32Array;
       aTiles: Float32Array; aWeights: Float32Array; aLava: Float32Array;
       aSnow: Float32Array; aRockTile: Float32Array; aMaskUV: Float32Array } {
    const n = (zonesPerSide * ZONE_UNITS) / step + 1; // vertices per axis
    const ox = zx0 * ZONE_UNITS - ZONE_UNITS / 2;
    const oz = zy0 * ZONE_UNITS - ZONE_UNITS / 2;
    const vertexCount = n * n;
    const SNOW_LINE = 80;

    // Cache zone heightmaps
    //
    // Hier steckt die Weltgenerierung: `getZone()` wertet fuer eine noch
    // unbekannte Zone das Rauschen an 65x65 = 4225 Vertices aus. Getrennt
    // gemessen, weil nur DIESER Posten in einen Web Worker auswandern
    // koennte — und weil die Rechnung "46 ms fuer 4225 Auswertungen"
    // rund hundertmal langsamer waere als eine gewoehnliche
    // Rauschfunktion. Entweder stimmt die Annahme nicht, oder hier liegt
    // ein algorithmisches Problem.
    const hms: Heightmap[] = misst('terrain.zonenRaster', () => {
      const raus: Heightmap[] = [];
      for (let dz = 0; dz < zonesPerSide; dz++) {
        for (let dx = 0; dx < zonesPerSide; dx++) {
          raus.push(this.world.heightmaps.getZone(zx0 + dx, zy0 + dz));
        }
      }
      return raus;
    });
    const hmAt = (dx: number, dz: number): Heightmap => hms[dz * zonesPerSide + dx];

    /**
     * Height at a zone-local vertex, following across zone borders.
     *
     * The central-difference normals below sample rx±1 / ry±1, which steps
     * outside the grid on every chunk edge. Clamping there (the previous
     * behaviour) yields a one-sided difference, so the normal tilts. On
     * generated terrain that is invisible; the moment a player raises ground
     * against a zone border it shows up as a hard lighting seam.
     *
     * Zone zx vertex rx is world zx*64 − 32 + rx, so rx = −1 is rx = 63 of
     * zone zx−1, and rx = 65 is rx = 1 of zone zx+1.
     */
    const heightAcross = (zx: number, zy: number, rx: number, ry: number): number => {
      // Fast path: still inside this chunk's own cached zones. Worth having —
      // this runs 4× per vertex, and getZone() does an LRU touch on every hit.
      if (rx >= 0 && rx < E_WIDTH && ry >= 0 && ry < E_WIDTH) {
        const dx = zx - zx0;
        const dz = zy - zy0;
        if (dx >= 0 && dz >= 0 && dx < zonesPerSide && dz < zonesPerSide) {
          return hmAt(dx, dz).heights[ry * E_WIDTH + rx];
        }
      }
      return this.heightAcrossZones(zx, zy, rx, ry);
    };

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const aTiles = new Float32Array(vertexCount * 4);
    const aWeights = new Float32Array(vertexCount * 4);
    const aLava = new Float32Array(vertexCount);
    const aSnow = new Float32Array(vertexCount);
    const aRockTile = new Float32Array(vertexCount);
    const aMaskUV = new Float32Array(vertexCount * 2);
    // Fern-Chunks decken 2×2 Zonen ab und zeigen kein Paint (wie im Original,
    // wo entfernte Heightmaps TerrainComp überspringen) — sie bekommen den
    // dauerhaft leeren Atlas-Slot.
    const farMaskUV = zonesPerSide > 1 ? maskUVEmpty() : null;

    for (let iy = 0; iy < n; iy++) {
      const wz = oz + iy * step;
      const dz = Math.min(zonesPerSide - 1, (iy * step) / ZONE_UNITS | 0);
      const ry = iy * step - dz * ZONE_UNITS;
      const ty = sstep(ry / ZONE_UNITS);
      for (let ix = 0; ix < n; ix++) {
        const wx = ox + ix * step;
        const dx = Math.min(zonesPerSide - 1, (ix * step) / ZONE_UNITS | 0);
        const rx = ix * step - dx * ZONE_UNITS;
        const hm = hmAt(dx, dz);
        const vi = iy * n + ix;

        const h = hm.heights[ry * E_WIDTH + rx] + yBias;
        positions[vi * 3 + 0] = wx;
        positions[vi * 3 + 1] = h;
        positions[vi * 3 + 2] = wz;

        // central-difference normal (1m grid), continued across zone borders
        const zvx = zx0 + dx;
        const zvy = zy0 + dz;
        const hL = heightAcross(zvx, zvy, rx - 1, ry);
        const hR = heightAcross(zvx, zvy, rx + 1, ry);
        const hD = heightAcross(zvx, zvy, rx, ry - 1);
        const hU = heightAcross(zvx, zvy, rx, ry + 1);
        let nx = (hL - hR) / 2;
        let nz = (hD - hU) / 2;
        const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        nx *= inv; nz *= inv;
        const ny = inv;
        normals[vi * 3 + 0] = nx;
        normals[vi * 3 + 1] = ny;
        normals[vi * 3 + 2] = nz;

        // G-TEX splat attributes
        const biome = hm.getBiome(wx, wz);
        const tx = sstep(rx / ZONE_UNITS);
        const cb = hm.cornerBiomes;

        // D5 fallback vertex colors (biome + sand/rock/snow/depth rules)
        const bc = BIOME_COLORS[biome] ?? COLOR_FALLBACK;
        colors[vi * 3] = bc[0];
        colors[vi * 3 + 1] = bc[1];
        colors[vi * 3 + 2] = bc[2];
        if (h >= WATER_LEVEL - 0.5 && h < BEACH_TOP) {
          const t = Math.min(1, (h - (WATER_LEVEL - 0.5)) / (BEACH_TOP - (WATER_LEVEL - 0.5)));
          const k = 1 - Math.abs(t - 0.4) * 1.6;
          blend(colors, vi, SAND, Math.max(0, Math.min(1, k)) * 0.8);
        }
        if (h < WATER_LEVEL) {
          const d = Math.min(1, (WATER_LEVEL - h) / 12);
          blend(colors, vi, DEPTH_TINT, d * 0.7);
        }
        if (h > SNOW_LINE && biome === Biome.Mountain) {
          blend(colors, vi, SNOW, Math.min(1, (h - SNOW_LINE) / 20));
        }
        // rock on steep slopes (needs the normal computed above)
        if (ny < ROCK_SLOPE) {
          const k = Math.min(1, (ROCK_SLOPE - ny) / 0.25);
          blend(colors, vi, ROCK, k * 0.85);
        }
        aTiles[vi * 4] = BIOME_TILE[cb[0]] ?? TILE.Rock;
        aTiles[vi * 4 + 1] = BIOME_TILE[cb[1]] ?? TILE.Rock;
        aTiles[vi * 4 + 2] = BIOME_TILE[cb[2]] ?? TILE.Rock;
        aTiles[vi * 4 + 3] = BIOME_TILE[cb[3]] ?? TILE.Rock;
        aWeights[vi * 4] = (1 - tx) * (1 - ty);
        aWeights[vi * 4 + 1] = tx * (1 - ty);
        aWeights[vi * 4 + 2] = (1 - tx) * ty;
        aWeights[vi * 4 + 3] = tx * ty;

        aLava[vi] =
          biome === Biome.AshLands
            ? Math.min(1, Math.max(0, hm.getVegetationMask(wx, wz)))
            : 0;
        aSnow[vi] =
          biome === Biome.Mountain && h > SNOW_LINE
            ? Math.min(1, (h - SNOW_LINE) / 20)
            : biome === Biome.DeepNorth
              ? 0.9
              : 0;
        aRockTile[vi] = biome === Biome.AshLands ? TILE.Basalt : TILE.Rock;

        if (farMaskUV) {
          aMaskUV[vi * 2] = farMaskUV[0];
          aMaskUV[vi * 2 + 1] = farMaskUV[1];
        } else {
          const [mu, mv] = maskUV(zx0, zy0, rx, ry);
          aMaskUV[vi * 2] = mu;
          aMaskUV[vi * 2 + 1] = mv;
        }
      }
    }

    // Indices: T1=(v00,v01,v10), T2=(v10,v01,v11) — matches C++ Heightmap.cpp
    const cells = n - 1;
    const indices = new Uint32Array(cells * cells * 6);
    let ii = 0;
    for (let ry = 0; ry < cells; ry++) {
      for (let rx = 0; rx < cells; rx++) {
        const v00 = ry * n + rx;
        const v10 = v00 + 1;
        const v01 = v00 + n;
        const v11 = v01 + 1;
        indices[ii++] = v00; indices[ii++] = v01; indices[ii++] = v10;
        indices[ii++] = v10; indices[ii++] = v01; indices[ii++] = v11;
      }
    }

    return { positions, normals, indices, colors, aTiles, aWeights, aLava, aSnow, aRockTile, aMaskUV };
  }

  // ── Collision ────────────────────────────────────────────────────
  //
  // The ground needs a collider or a Havok rigid body falls through the
  // world. Only the zones AROUND THE PLAYER get one: a zone mesh is ~8k
  // triangles, and building that BVH for the whole 81-zone view ring costs
  // far more than it buys — you can only stand on the one under your feet.
  // Unity does the same via its loaded-zone set.

  /** Chebyshev radius in zones that carries a ground collider. */
  private static readonly COLLIDER_RADIUS = 1;
  private readonly groundBodies = new Map<string, PhysicsBody>();
  private physicsEnabled = false;

  /** Called once Havok is up (initPhysics resolves asynchronously). */
  enablePhysics(): void {
    this.physicsEnabled = true;
  }

  /**
   * Add/drop ground colliders so they follow the player.
   *
   * Teilt sich `budget` mit dem Nah-/Fernbau in update() — s.
   * TERRAIN_BUDGET_MS. Ein Zonenwechsel (alle ZONE_SIZE=64 m, beim
   * Sprinten ~8,5 s) bringt bis zu drei neue Zonen auf einmal in den
   * 3×3-Ring (die Vorderkante in Laufrichtung); ohne Budget cookte das für
   * alle drei synchron im selben Frame PhysicsShapeMesh — eine Havok-BVH
   * über ~8k Dreiecke je Zone.
   */
  private syncColliders(cz: number, cw: number, budget: TerrainBudget): void {
    if (!this.physicsEnabled) return;
    const r = TerrainManager.COLLIDER_RADIUS;
    for (const [key, body] of this.groundBodies) {
      const [zx, zy] = key.split(',').map(Number);
      if (Math.max(Math.abs(zx - cz), Math.abs(zy - cw)) > r) {
        body.shape?.dispose();
        body.dispose();
        this.groundBodies.delete(key);
      }
    }
    // Neue Collider verteilt aufbauen statt alle im selben Frame.
    // syncColliders() läuft jeden Frame, ein in diesem Frame nicht
    // geschaffter Collider kommt beim nächsten Mal dran (der `has`-Check
    // oben überspringt bereits vorhandene).
    outer: for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (budget.gebaut && performance.now() >= budget.ende) break outer;
        const key = `${cz + dx},${cw + dy}`;
        if (this.groundBodies.has(key)) continue;
        const chunk = this.chunks.get(key);
        if (!chunk) continue;
        this.buildGroundBody(key, chunk.mesh);
        budget.gebaut = true;
      }
    }
  }

  private buildGroundBody(key: string, mesh: Mesh): void {
    const body = new PhysicsBody(mesh, PhysicsMotionType.STATIC, false, this.scene);
    // Der teure Posten: PhysicsShapeMesh cookt eine Havok-BVH ueber die
    // ~8k Dreiecke der Zone. Getrennt gemessen, weil genau hier der
    // Verdacht liegt — ein Gelaendestueck ist ein Hoehenfeld, und
    // PhysicsShapeType.HEIGHTFIELD braucht gar keine BVH.
    body.shape = misst('terrain.havokShape', () => new PhysicsShapeMesh(mesh, this.scene));
    this.groundBodies.set(key, body);
  }

  /** Rebuild a zone's collider after terraforming changed its heights. */
  private refreshGroundBody(zx: number, zy: number): void {
    const key = `${zx},${zy}`;
    const body = this.groundBodies.get(key);
    if (!body) return;
    body.shape?.dispose();
    body.dispose();
    this.groundBodies.delete(key);
    const chunk = this.chunks.get(key);
    if (chunk) this.buildGroundBody(key, chunk.mesh);
  }

  /** Build one near zone chunk (1 zone, 1m stride, no bias). */
  private buildChunk(zoneX: number, zoneY: number): void {
    // Gitterbau: Vertexdaten, Normalen, Biom-Attribute. Enthaelt den
    // Zonenraster-Posten nicht mehr — misst() zieht Kindabschnitte ab.
    const geo = misst('terrain.gitterbau', () => this.buildGridGeometry(zoneX, zoneY, 1, 1, 0));

    const vd = new VertexData();
    vd.positions = geo.positions;
    vd.normals = geo.normals;
    vd.indices = geo.indices;
    if (this.flatMode) vd.colors = geo.colors;

    const mesh = new Mesh(`terrain_${zoneX}_${zoneY}`, this.scene);
    // Der Upload in die GPU-Puffer. Getrennt gemessen, weil er als
    // einziger Posten NICHT in einen Web Worker auswandern kann: er
    // braucht den GL-Kontext und lebt damit zwingend auf diesem Thread.
    misst('terrain.gpuUpload', () => {
      // updatable: refreshZones() rewrites position/normal in place when the
      // player digs. Without it updateVerticesData() silently does nothing.
      vd.applyToMesh(mesh, true);
      if (this.flatMode) return;
      mesh.setVerticesData('aTiles', geo.aTiles, false, 4);
      mesh.setVerticesData('aWeights', geo.aWeights, false, 4);
      mesh.setVerticesData('aLava', geo.aLava, false, 1);
      mesh.setVerticesData('aSnow', geo.aSnow, true, 1); // height-dependent
      mesh.setVerticesData('aRockTile', geo.aRockTile, false, 1);
      mesh.setVerticesData('aMaskUV', geo.aMaskUV, false, 2);
    });
    if (this.flatMode) {
      mesh.material = this.flatMaterial;
    } else {
      mesh.material = this.material;
    }
    mesh.isPickable = false;
    // ── Frustum-Culling BLEIBT AN ───────────────────────────────────
    // Hier stand `alwaysSelectAsActiveMesh = true`, um sich nach dem
    // Graben ein `refreshBoundingInfo()` zu sparen (siehe applyDig weiter
    // unten). Der Tausch war schlecht kalkuliert: gespart wurde eine
    // einmalige Rechnung JE GRABUNG, bezahlt wurde sie mit jedem Chunk
    // der Welt in JEDEM Frame.
    //
    // Gemessen an einer normalen Spielposition: 310 Terrain-Meshes im
    // Zeichenpfad, davon nur 99 im Kamerafrustum — 211 Chunks lagen
    // hinter oder neben der Kamera und wurden trotzdem gezeichnet. Über
    // die Mesh-Zahl aufgenommen ergibt das 45 fps bei 310, 55 bei 155 und
    // 57 bei 104; ab rund hundert Meshes limitiert der Rest der Szene.
    // Das Culling holt also etwa ein Viertel der Bildrate zurück, ohne
    // dass ein einziges sichtbares Dreieck wegfällt.
    mesh.freezeWorldMatrix();

    // Slot immer schreiben, auch ohne Bemalung: Slots werden alle 12 Zonen
    // wiederverwendet, ein ungeschriebener Slot trüge noch die Maske der
    // vorherigen Zone.
    this.splat.uploadMaskTile(zoneX, zoneY, this.world.heightmaps.getTerrainComp(zoneX, zoneY)?.paintMask ?? null);

    this.chunks.set(`${zoneX},${zoneY}`, {
      mesh,
      zoneX,
      zoneY,
      positions: geo.positions,
      normals: geo.normals,
      aSnow: geo.aSnow,
    });
  }

  /**
   * Terraforming: rewrite the height-dependent vertex data of live chunks
   * instead of rebuilding them.
   *
   * rebuildZones() would dispose the chunk and let the ring-scan re-queue it,
   * which costs a full worldgen pass (one getBiome() noise evaluation per
   * vertex, 4225 per zone) and — budgeted via TERRAIN_BUDGET_MS — leaves a
   * visible hole under the player for a frame or two on every swing.
   *
   * Zones without a live chunk are skipped; they read the updated heights when
   * they are built normally.
   */
  refreshZones(zones: ReadonlyArray<readonly [number, number]>): void {
    const SNOW_LINE = 80;
    for (const [zx, zy] of zones) {
      const chunk = this.chunks.get(`${zx},${zy}`);
      if (!chunk) continue;

      const hm = this.world.heightmaps.getZone(zx, zy);
      const ox = zx * ZONE_UNITS - ZONE_UNITS / 2;
      const oz = zy * ZONE_UNITS - ZONE_UNITS / 2;

      for (let ry = 0; ry < E_WIDTH; ry++) {
        for (let rx = 0; rx < E_WIDTH; rx++) {
          const vi = ry * E_WIDTH + rx;
          const h = hm.heights[vi];
          chunk.positions[vi * 3 + 1] = h;

          const hL = this.heightAcrossZones(zx, zy, rx - 1, ry);
          const hR = this.heightAcrossZones(zx, zy, rx + 1, ry);
          const hD = this.heightAcrossZones(zx, zy, rx, ry - 1);
          const hU = this.heightAcrossZones(zx, zy, rx, ry + 1);
          let nx = (hL - hR) / 2;
          let nz = (hD - hU) / 2;
          const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
          nx *= inv;
          nz *= inv;
          chunk.normals[vi * 3 + 0] = nx;
          chunk.normals[vi * 3 + 1] = inv;
          chunk.normals[vi * 3 + 2] = nz;

          // Snow coverage follows height, so it has to be rebaked as well.
          const biome = hm.getBiome(ox + rx, oz + ry);
          chunk.aSnow[vi] =
            biome === Biome.Mountain && h > SNOW_LINE
              ? Math.min(1, (h - SNOW_LINE) / 20)
              : biome === Biome.DeepNorth
                ? 0.9
                : 0;
        }
      }

      chunk.mesh.updateVerticesData('position', chunk.positions);
      chunk.mesh.updateVerticesData('normal', chunk.normals);
      if (!this.flatMode) chunk.mesh.updateVerticesData('aSnow', chunk.aSnow);
      // The collision mesh is a snapshot of the vertices, so digging has to
      // rebuild it — otherwise the player keeps walking on the old surface.
      this.refreshGroundBody(zx, zy);
      // Das Graben verschiebt Vertices, also stimmt der Hüllkörper nicht
      // mehr. Da die Chunks jetzt regulär gekullt werden (siehe
      // buildChunk), muss er nachgezogen werden — sonst verschwindet ein
      // aufgeschütteter Hügel am Bildrand, weil der Culler noch die alte,
      // zu flache Box kennt. Das läuft einmal je Grabung; der Aufwand
      // dafür ist ein Bruchteil dessen, was die abgeschaltete Kullung in
      // jedem einzelnen Frame gekostet hat.
      chunk.mesh.refreshBoundingInfo();
    }
  }

  /**
   * Nach dem Bemalen: nur den Atlas-Slot der Zone neu hochladen.
   *
   * Malen bewegt keinen Vertex — Mesh und Normalen bleiben gültig, es ändert
   * sich ausschließlich die Maskentextur.
   */
  refreshPaint(zoneX: number, zoneY: number): void {
    if (!this.chunks.has(`${zoneX},${zoneY}`)) return; // nicht sichtbar
    const comp = this.world.heightmaps.getTerrainComp(zoneX, zoneY);
    this.splat.uploadMaskTile(zoneX, zoneY, comp?.paintMask ?? null);
  }

  /** Height at a zone-local vertex, following across zone borders. */
  private heightAcrossZones(zx: number, zy: number, rx: number, ry: number): number {
    if (rx < 0) { zx--; rx += ZONE_UNITS; }
    else if (rx >= E_WIDTH) { zx++; rx -= ZONE_UNITS; }
    if (ry < 0) { zy--; ry += ZONE_UNITS; }
    else if (ry >= E_WIDTH) { zy++; ry -= ZONE_UNITS; }
    return this.world.heightmaps.getZone(zx, zy).heights[ry * E_WIDTH + rx];
  }

  /** G-POP: build one far chunk (FAR_ZONES_PER_CHUNK² zones, FAR_STRIDE stride, biased down). */
  private buildFarChunk(fx: number, fy: number): void {
    const zx0 = fx * FAR_ZONES_PER_CHUNK;
    const zy0 = fy * FAR_ZONES_PER_CHUNK;
    const geo = this.buildGridGeometry(zx0, zy0, FAR_ZONES_PER_CHUNK, FAR_STRIDE, FAR_BIAS);

    const vd = new VertexData();
    vd.positions = geo.positions;
    vd.normals = geo.normals;
    vd.indices = geo.indices;
    if (this.flatMode) vd.colors = geo.colors;

    const mesh = new Mesh(`terrain_far_${fx}_${fy}`, this.scene);
    vd.applyToMesh(mesh);
    if (this.flatMode) {
      mesh.material = this.flatMaterial;
    } else {
      mesh.setVerticesData('aTiles', geo.aTiles, false, 4);
      mesh.setVerticesData('aWeights', geo.aWeights, false, 4);
      mesh.setVerticesData('aLava', geo.aLava, false, 1);
      mesh.setVerticesData('aSnow', geo.aSnow, false, 1);
      mesh.setVerticesData('aRockTile', geo.aRockTile, false, 1);
      mesh.setVerticesData('aMaskUV', geo.aMaskUV, false, 2);
      mesh.material = this.material;
    }
    mesh.isPickable = false;
    // Fernchunks werden nie umgegraben, ihr Hüllkörper stimmt also ab
    // dem Bau dauerhaft — Culling erst recht unbedenklich. Sie stellten
    // mit 189 von 310 Meshes sogar die Mehrheit des Zeichenpfads.
    mesh.freezeWorldMatrix();

    this.farChunks.set(`${fx},${fy}`, { mesh, fx, fy });
  }

  get chunkCount(): number {
    return this.chunks.size;
  }
  get queuedCount(): number {
    return this.buildQueue.length;
  }

  /**
   * True, sobald der volle Nah-Ring steht und die Ufer-Nähe einmal
   * gebacken wurde. Bis dahin ist das Wasser ausgeblendet (s.
   * `initialReady`-Block in update()) und der Ladebildschirm sichtbar.
   */
  get ready(): boolean {
    return this.initialReady;
  }

  /** Fortschritt 0..1 für den Ladebildschirm. */
  get loadProgress(): number {
    const want = (2 * this.viewRadius + 1) ** 2;
    return Math.min(1, this.chunks.size / want);
  }
}

export { Heightmap };
