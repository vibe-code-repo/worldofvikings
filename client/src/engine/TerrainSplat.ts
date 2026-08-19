/**
 * G-TEX (Babylon-Port) — Original-Valheim-Terrain-Texturen als Splat-Shader.
 *
 * Babylon-Äquivalent zum three.js-Referenzprojekt (valheim-browser
 * Terrain.ts, siehe Docs/Analyse-Modelle-und-Weltgenerierung.md „G-TEX"):
 * statt Vertex-Farben sampelt ein NodeMaterial die 16 gestapelten
 * Original-Tiles (`terrain_d_array.png`, 256×4096) mit den
 * Zonen-Eckbiomen × denselben Smoothstep-Gewichten wie der Heightmap-Blend
 * ⇒ weiche Biomübergänge. Variety-Noise (`TerrainVarietyNoise.png`) rotiert
 * die Tile-UVs gegen sichtbare Kachelung und moduliert die Helligkeit.
 *
 * Regeln (im Fragment, identisch zur three.js-Version):
 *  - 4 Eck-Tiles pro Vertex (BIOME_TILE), Gewichte = cornerBiomes ×
 *    Smoothstep(tx/ty) — dieselbe Mathe wie Heightmap.ts build().
 *  - Sand-Band an der Wasserlinie, Fels (rock/cliff-Tile) auf steilen
 *    Flanken, Schnee über der Schneelinie, Tiefen-Tönung unter Wasser.
 *  - AshLands-Lava (vegMask-Kanal): dunkle Kruste + glühende Risse
 *    (emissive, Tile 15 ist die Graustufen-Emissionsmaske).
 *
 * Chunk-Vertex-Attribute (in Terrain.buildChunk befüllt):
 *  aTiles(vec4)   — die 4 Eck-Tile-Indizes
 *  aWeights(vec4) — Smoothstep-Gewichte der 4 Ecken (normalisiert im Shader)
 *  aLava(float)   — B5-Lava-Maske aus vegMask (nur AshLands)
 *  aSnow(float)   — Schneebedeckung (Mountain > 80 m, DeepNorth)
 *  aRockTile(float)— Fels-Tile für steile Flanken (cliff bei Mountain, sonst rock)
 *
 * Beleuchtung: einfaches Lambert (dot(N,-L)) — der volle Light-Block/
 * Schatten kommt mit Phase 3 (Lighting-§3). Nebel: manuelles EXP2 passend
 * zur Scene-Fog-Density (NodeMaterial ignoriert Scene-Fog nicht automatisch
 * für Custom-Fragment-Output).
 *
 * G-TEX2 (Bump-Detail via terraintile_n_0/1/2) ist bewusst vorerst
 * ausgelassen (subtil, kein visueller Blocker — s. Analyse-Dokument).
 */
import { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import type { NodeMaterialBlock } from '@babylonjs/core/Materials/Node/nodeMaterialBlock';
import { InputBlock } from '@babylonjs/core/Materials/Node/Blocks/Input/inputBlock';
import { TextureBlock } from '@babylonjs/core/Materials/Node/Blocks/Dual/textureBlock';
import { ImageSourceBlock } from '@babylonjs/core/Materials/Node/Blocks/Dual/imageSourceBlock';
import { SonnenSchattenBlock } from './SonnenSchattenBlock';
// Derselbe Exponent wie in den Shader-Pfaden für Standard und PBR — der
// gerichtete Nebel muss über alle drei Materialfamilien identisch
// abgestimmt sein, sonst zeigt der Boden einen anderen Sonnenton als der
// Baum darauf.
import { FOG_SUN_EXPONENT } from './NebelRichtung';
import { AddBlock } from '@babylonjs/core/Materials/Node/Blocks/addBlock';
import { SubtractBlock } from '@babylonjs/core/Materials/Node/Blocks/subtractBlock';
import { MultiplyBlock } from '@babylonjs/core/Materials/Node/Blocks/multiplyBlock';
import { DivideBlock } from '@babylonjs/core/Materials/Node/Blocks/divideBlock';
import { ModBlock } from '@babylonjs/core/Materials/Node/Blocks/modBlock';
import { MaxBlock } from '@babylonjs/core/Materials/Node/Blocks/maxBlock';
import { ClampBlock } from '@babylonjs/core/Materials/Node/Blocks/clampBlock';
import { PowBlock } from '@babylonjs/core/Materials/Node/Blocks/powBlock';
import { StepBlock } from '@babylonjs/core/Materials/Node/Blocks/stepBlock';
import { LerpBlock } from '@babylonjs/core/Materials/Node/Blocks/lerpBlock';
import { SmoothStepBlock } from '@babylonjs/core/Materials/Node/Blocks/smoothStepBlock';
import { VectorSplitterBlock } from '@babylonjs/core/Materials/Node/Blocks/vectorSplitterBlock';
import { VectorMergerBlock } from '@babylonjs/core/Materials/Node/Blocks/vectorMergerBlock';
import { TransformBlock } from '@babylonjs/core/Materials/Node/Blocks/transformBlock';
import { VertexOutputBlock } from '@babylonjs/core/Materials/Node/Blocks/Vertex/vertexOutputBlock';
import { FragmentOutputBlock } from '@babylonjs/core/Materials/Node/Blocks/Fragment/fragmentOutputBlock';
import { TrigonometryBlock, TrigonometryBlockOperations } from '@babylonjs/core/Materials/Node/Blocks/trigonometryBlock';
import { CustomBlock } from '@babylonjs/core/Materials/Node/Blocks/customBlock';
import { NodeMaterialSystemValues } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialSystemValues';
import { NodeMaterialBlockConnectionPointTypes } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockConnectionPointTypes';
import { NodeMaterialBlockTargets } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockTargets';
import { NodeMaterialModes } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialModes';
import type { NodeMaterialConnectionPoint } from '@babylonjs/core/Materials/Node/nodeMaterialBlockConnectionPoint';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Vector2, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';

/** Tile-Indizes im 256×4096-Stack (G-TEX, 16/16 gegen Slices verifiziert). */
export const TILE = {
  Grass: 0, Forest: 1, Dirt: 2, Cleared: 3, Rock: 4, Cliff: 5, LavaEmber: 6,
  Ash: 7, Heath: 8, Sand: 9, SwampMud: 10, Moss: 11, Paved: 12,
  SwampDark: 13, Basalt: 14, LavaCrust: 15,
} as const;

/** Biome-Enum-Wert → Tile (Biome aus shared/types.ts). */
export const BIOME_TILE: Record<number, number> = {
  1: TILE.Grass, // Meadows
  2: TILE.SwampMud, // Swamp
  4: TILE.Rock, // Mountain
  8: TILE.Forest, // BlackForest
  16: TILE.Heath, // Plains
  32: TILE.Ash, // AshLands
  64: TILE.Rock, // DeepNorth (+ Schnee)
  256: TILE.Sand, // Ocean
  512: TILE.Moss, // Mistlands
};

const TEX_BASE = '/assets/textures/';

/**
 * Paint mask atlas — one 65×65 tile per visible zone in a single texture.
 *
 * Valheim gives every Heightmap its own 65×65 `_ClearedMaskTex`, which works
 * there because each zone has its own material instance. Our terrain shares a
 * single NodeMaterial across all chunks (NodeMaterial.clone() would rebuild
 * the graph per chunk — 80+ shader programs and a compile stutter whenever the
 * ring advances), so the per-zone masks are packed into one atlas instead.
 *
 * Zone (zx, zy) lives at slot (zx mod 12, zy mod 12). With a near ring of at
 * most 5 zones radius (11 across) no two live chunks can collide, so the slot
 * is a pure function of the zone and can be baked into the vertex data.
 *
 * The 13th row/column is reserved: slot (12, 12) stays zero forever and is
 * where far chunks point, which keeps paint off the distant LOD without a
 * shader branch — same as the original, where distant heightmaps skip
 * TerrainComp entirely.
 */
const MASK_TILES = 12;
const MASK_TILE_PX = 65;
const MASK_ATLAS_PX = (MASK_TILES + 1) * MASK_TILE_PX;

/** Atlas slot of a zone. Deliberately positive-modulo for negative zones. */
export function maskSlot(zoneX: number, zoneY: number): [number, number] {
  return [
    ((zoneX % MASK_TILES) + MASK_TILES) % MASK_TILES,
    ((zoneY % MASK_TILES) + MASK_TILES) % MASK_TILES,
  ];
}

/** UV of a zone-local vertex inside the atlas — exact texel centre. */
export function maskUV(zoneX: number, zoneY: number, rx: number, ry: number): [number, number] {
  const [sx, sy] = maskSlot(zoneX, zoneY);
  return [
    (sx * MASK_TILE_PX + rx + 0.5) / MASK_ATLAS_PX,
    (sy * MASK_TILE_PX + ry + 0.5) / MASK_ATLAS_PX,
  ];
}

/** Reused for clearing a recycled slot; never written to. */
const EMPTY_MASK_TILE = new Uint8Array(MASK_TILE_PX * MASK_TILE_PX * 4);

/** UV of the permanently empty slot — used by far chunks. */
export function maskUVEmpty(): [number, number] {
  const c = (MASK_TILES * MASK_TILE_PX + MASK_TILE_PX / 2) / MASK_ATLAS_PX;
  return [c, c];
}

function sysInput(name: string, system: NodeMaterialSystemValues): InputBlock {
  const b = new InputBlock(name);
  b.setAsSystemValue(system);
  return b;
}
function attr(name: string): InputBlock {
  const b = new InputBlock(name);
  b.setAsAttribute(name);
  return b;
}
/** Custom-Attribute: Babylon inferiert den GLSL-Typ nur für bekannte
 *  Attribut-Namen (position/normal/uv/…). Für eigene Attribute muss der
 *  InputBlock direkt mit dem Zieltyp konstruiert werden — der dritte
 *  Konstruktor-Parameter ist `type` (InputBlock ctor). */
function attrT(name: string, type: NodeMaterialBlockConnectionPointTypes): InputBlock {
  const b = new InputBlock(name, undefined, type);
  b.setAsAttribute(name);
  return b;
}
function cnst(name: string, value: number): InputBlock {
  const b = new InputBlock(name);
  b.value = value;
  return b;
}
function cnst3(name: string, value: Color3): InputBlock {
  const b = new InputBlock(name);
  b.value = value;
  return b;
}
/** Wie `cnst3`, nur als Richtung statt als Farbe — der InputBlock leitet
 *  seinen Typ aus dem zugewiesenen Wert ab, ein Vector3 wird also zu
 *  `vec3` ohne Farbraum-Bedeutung. */
function cnst3v(name: string, value: Vector3): InputBlock {
  const b = new InputBlock(name);
  b.value = value;
  return b;
}
function cnst2(name: string, value: Vector2): InputBlock {
  const b = new InputBlock(name);
  b.value = value;
  return b;
}

// ── Glanz, wie ihn `Heightmap_basematerial` beschreibt ──────────────
// Ausgelesen aus extracted_assets/Material (m_Floats des Materials mit
// m_Name "Heightmap_basematerial"). Das Terrain ist als Ganzes matt,
// aber NICHT überall gleich matt: Fels und Schnee haben eigene Werte.
/** `_Glossiness` — der Grundwert für alles, was weder Fels noch Schnee ist. */
const GLOSS_BASIS = 0.1;
/** `_RockGloss` — Felsflächen (Hangneigung), deutlich glatter. */
const GLOSS_FELS = 0.7;
/** `_SnowGloss` — Schnee, der glänzendste Untergrund im Spiel. */
const GLOSS_SCHNEE = 1.0;
/**
 * Reflexionsgrad bei senkrechtem Einfall.
 *
 * `_Metallic` steht auf 0, der Boden ist also durchweg ein Dielektrikum —
 * damit gilt der übliche Wert 0.04 statt einer Metallreflexion. Genau
 * dieselbe Größe, deren falscher Wert (1) die Objekte nachts schwarz
 * gerendert hat, siehe AssetManager.setzeMetallgrad.
 */
const FRESNEL_F0 = 0.04;

// ── Farbvariation über mehrere Skalen ───────────────────────────────
// Bis zum 2026-08-01 zog die Helligkeit aus EINER Noise-Skala:
//   bright = 0.85 + 0.3 * nz.g   bei noiseUVScale 0.015
// Ausgemessen an `TerrainVarietyNoise.png` (512², drei Kanäle) ist das
// viel weniger Variation, als die Formel vermuten lässt:
//
//   Kanal   Mittel   Streuung (1σ)
//     r      0.456      0.147
//     g      0.312      0.138
//     b      0.497      0.125
//
// Der Grünkanal liegt also im Mittel bei 0.31, nicht bei 0.5. Der
// Faktor schwankte damit um 0.944 ± 0.041 — magere ±4 % auf einer
// einzigen Periode von 1/0.015 ≈ 67 m. Auf einem Berghang von mehreren
// hundert Metern wiederholt sich dieselbe Struktur mehrfach, und
// dazwischen gibt es nichts Feineres: der "zu gleichmäßige" Eindruck.
//
// Jetzt drei Oktaven. Jede zieht einen anderen KANAL bei einer anderen
// SKALA — beides verschieden, damit sich die Oktaven nicht gegenseitig
// abbilden.
/** Grobe Oktave: Periode 1/0.004 = 250 m, Kanal r. */
const VAR_SKALA_GROB = 0.004;
/** Mittlere Oktave: Periode 67 m, Kanal g — die bisherige, unverändert. */
const VAR_SKALA_MITTEL = 0.015;
/** Feine Oktave: Periode 20 m, Kanal b. Verschwindet in der Ferne im Mipmap. */
const VAR_SKALA_FEIN = 0.05;
/** Kanalmittel, gemessen an der Textur — zentriert jede Oktave auf null. */
const VAR_MITTE_GROB = 0.456;
const VAR_MITTE_MITTEL = 0.312;
const VAR_MITTE_FEIN = 0.497;
// Amplituden. Da die Oktaven unabhängig sind, addieren sich ihre
// VARIANZEN: √((0.55·0.147)² + (0.40·0.138)² + (0.25·0.125)²) = 0.103.
// Aus ±4 % werden damit ±10 %, verteilt über drei Größenordnungen.
/**
 * Makro-Ebene gegen die sichtbare Kachelwiederholung (siehe `antiKachel`).
 *
 * `MAKRO_FREQ` ist bewusst UNRUND: Zwei Kachelungen mit einem glatten
 * Verhältnis (1/8, 1/4) fielen regelmäßig wieder zusammen und erzeugten
 * ein neues, gröberes Raster. 0.137 entspricht rund 7,3× gröber; das
 * gemeinsame Vielfache liegt damit weit außerhalb der Sichtweite.
 */
/**
 * Entfernungsunschärfe der Bodentextur (siehe `bias` in vbTileSample).
 *
 * Ab `FERN_START` Metern wächst der Mip-Bias linear; je `FERN_SKALA`
 * Meter kommt Faktor 1 dazu, und Faktor 2 ist eine ganze Mip-Stufe.
 * Bei 30/45 ist die Textur ab 75 m eine Stufe weicher, ab 120 m knapp
 * zwei, ab 210 m rund zweieinhalb. `FERN_MAX` deckelt das, damit ferne
 * Hänge nicht zu einer einzigen Farbfläche verschmelzen.
 *
 * Erste Fassung war 40/70/6 und wirkte zu dezent — die Kachelung blieb
 * in der Ferne als Muster lesbar. Wer hier nachjustiert: kleinerer
 * START setzt die Unschärfe früher an, kleinere SKALA lässt sie
 * schneller wachsen. Der Nahbereich bis START bleibt in jedem Fall
 * unberührt scharf.
 */
const FERN_START = 30;
const FERN_SKALA = 45;
const FERN_MAX = 8;

const MAKRO_FREQ = 0.137;
/** UV-Versatz, damit fein und grob nicht deckungsgleich starten. */
const MAKRO_VERSATZ: readonly [number, number] = [0.37, 0.61];
/** Anteil der Makro-Ebene an der Grundfarbe. */
const MAKRO_ANTEIL = 0.3;

const VAR_AMP_GROB = 0.55;
const VAR_AMP_MITTEL = 0.4;
const VAR_AMP_FEIN = 0.25;
/**
 * Mittlere Helligkeit.
 *
 * 0.944 ist exakt der bisherige Mittelwert (0.85 + 0.3 · 0.312). Bewusst
 * NICHT auf 1.0 gesetzt: Das Terrain würde dadurch um 5.6 % heller, und
 * diese Änderung soll die Variation vergrößern, nicht die Gesamthelligkeit
 * verschieben.
 */
const VAR_BASIS = 0.944;
/** Sicherheitsgrenzen, falls alle drei Oktaven gleichzeitig ausschlagen. */
const VAR_MIN = 0.6;
const VAR_MAX = 1.35;

export class TerrainSplatMaterial {
  readonly material: NodeMaterial;
  /** Sonnenrichtung/-farbe/-ambient + Nebeldichte werden pro Frame gesetzt. */
  readonly sunDirection: Vector3 = new Vector3(0.5, -1, 0.3);
  readonly sunColor: Color3 = new Color3(1, 0.96, 0.88);
  readonly ambientColor: Color3 = new Color3(0.45, 0.48, 0.52);
  fogDensity = 0.0055;

  /** Paint mask atlas — see MASK_TILES for the slot layout. */
  private readonly maskTexture: RawTexture;
  private readonly sunDirBlock: InputBlock;
  private readonly sunColBlock: InputBlock;
  private readonly ambientBlock: InputBlock;
  private readonly fogDensityBlock: InputBlock;
  /** Nebelfarbe in LINEAR — siehe Begründung an der Erzeugungsstelle. */
  private readonly fogColorBlock: InputBlock;
  /** Zweite Nebelfarbe (Blick zur Sonne), ebenfalls LINEAR. */
  private readonly fogColorSonnenBlock: InputBlock;
  /** Richtung ZUR Sonne in Weltkoordinaten, normalisiert. */
  private readonly zurSonneBlock: InputBlock;

  constructor(scene: Scene, waterLevel: number, sonne: DirectionalLight) {
    const mat = new NodeMaterial('terrainSplat', scene, { emitComments: false });
    mat.mode = NodeMaterialModes.Material;

    // ── Vertex inputs ───────────────────────────────────────────────
    const position = attr('position');
    const normal = attr('normal');
    const aTiles = attrT('aTiles', NodeMaterialBlockConnectionPointTypes.Vector4);
    const aWeights = attrT('aWeights', NodeMaterialBlockConnectionPointTypes.Vector4);
    const aLava = attrT('aLava', NodeMaterialBlockConnectionPointTypes.Float);
    const aSnow = attrT('aSnow', NodeMaterialBlockConnectionPointTypes.Float);
    const aRockTile = attrT('aRockTile', NodeMaterialBlockConnectionPointTypes.Float);
    const aMaskUV = attrT('aMaskUV', NodeMaterialBlockConnectionPointTypes.Vector2);

    // Drei einzelne Float-Attribute belegen beim Uebergang in den
    // Fragment-Shader drei komplette Varying-Locations. WebGPU zaehlt
    // Locations, nicht Komponenten; zusammen mit den CSM-Schattenwerten
    // landete das Terrain deshalb bei 17 statt der erlaubten 16. Im
    // Vertex-Shader zu vec3 packen und im Fragment-Shader wieder teilen
    // behaelt die Mesh-Daten unveraendert, braucht aber nur eine Location.
    const terrainMarker = new VectorMergerBlock('terrainMarker');
    terrainMarker.target = NodeMaterialBlockTargets.Vertex;
    aRockTile.output.connectTo(terrainMarker.x);
    aSnow.output.connectTo(terrainMarker.y);
    aLava.output.connectTo(terrainMarker.z);
    const terrainMarkerSplit = new VectorSplitterBlock('terrainMarkerSplit');
    terrainMarkerSplit.target = NodeMaterialBlockTargets.Fragment;
    terrainMarker.xyzOut.connectTo(terrainMarkerSplit.xyzIn);
    const world = sysInput('world', NodeMaterialSystemValues.World);
    const worldViewProjection = sysInput('worldViewProjection', NodeMaterialSystemValues.WorldViewProjection);
    const cameraPos = sysInput('cameraPosition', NodeMaterialSystemValues.CameraPosition);
    // NICHT NodeMaterialSystemValues.FogColor: Der Systemwert liefert
    // `scene.fogColor` roh, und Babylon führt den per Konvention im
    // GAMMA-Raum (für PBR ruft es `BindFogParameters(..., linearSpace)`
    // und rechnet dort selbst um). Dieses Material schreibt aber direkt
    // in die lineare Pipeline — der rohe Wert wurde deshalb vom
    // ImageProcessing-Pass ein zweites Mal aufgehellt und liess den
    // Boden nachts hellgrau werden, während die PBR-Bäume davor korrekt
    // schwarz blieben (gemessen 2026-07-31: RGB 61 gegen RGB 4 bei
    // derselben Nebelfarbe). Lighting.fogColorLinear liefert den
    // umgerechneten Wert, syncLighting() schiebt ihn pro Frame nach.
    const fogColor = cnst3('fogColorLinear', new Color3(0.5, 0.55, 0.6));
    this.fogColorBlock = fogColor;
    // Zweite Nebelfarbe (Blick ZUR Sonne) und die Sonnenrichtung — der
    // gerichtete Nebel, den Standard und PBR über `NebelRichtung.ts`
    // bekommen. Hier in WELTKOORDINATEN, weil die Nebelkette unten
    // ohnehin `worldPos − cameraPos` bildet; die beiden anderen Pfade
    // rechnen im Sichtraum. Beide Vektoren stammen aus derselben Zeile in
    // `Lighting.apply()`, sind also garantiert dieselbe Richtung.
    const fogColorSonne = cnst3('fogColorSonnenLinear', new Color3(0.75, 0.7, 0.6));
    this.fogColorSonnenBlock = fogColorSonne;
    const zurSonne = cnst3v('zurSonneWelt', new Vector3(0, 1, 0));
    this.zurSonneBlock = zurSonne;

    // ── Vertex: world pos, world normal, clip pos ───────────────────
    const worldPos = new TransformBlock('worldPos');
    position.output.connectTo(worldPos.vector);
    world.output.connectTo(worldPos.transform);
    const wps = new VectorSplitterBlock('wps');
    // Die vec4-Ausgabe wird auch vom Schattenblock gebraucht. Aus genau
    // dieser einen Uebergabe im Fragment wieder xyz zu bilden vermeidet ein
    // zweites, inhaltlich identisches WorldPos-Varying.
    worldPos.output.connectTo(wps.xyzw);

    const normalW = new TransformBlock('normalW');
    normalW.transformAsDirection = true;
    normal.output.connectTo(normalW.vector);
    world.output.connectTo(normalW.transform);
    const nrmSplit = new VectorSplitterBlock('nrmSplit');
    normalW.output.connectTo(nrmSplit.xyzw);

    // Clip position: use the engine-provided WorldViewProjection system value
    // directly (Babylon composes World * ViewProjection via Matrix.multiplyToRef,
    // which is NOT the same as chaining raw GLSL `world * view * projection`
    // through MultiplyBlocks — that produced garbage clip coords and made the
    // whole terrain invisible).
    const clipPos = new TransformBlock('clipPos');
    position.output.connectTo(clipPos.vector);
    worldViewProjection.output.connectTo(clipPos.transform);

    const vertexOut = new VertexOutputBlock('vertexOut');
    clipPos.output.connectTo(vertexOut.vector);

    // ── Textures ────────────────────────────────────────────────────
    // three.js reference: wrapS=Repeat, wrapT=ClampToEdge (T-wrap is done
    // in-shader via fract — see splatLayer/fracUV below); flipY=false so
    // layer L sits at V∈[L/16,(L+1)/16] top→bottom, matching the
    // AssetRipper tile order (Babylon: invertY=false mirrors flipY=false).
    // Maximale anisotrope Filterung für ALLE Terrain-Texturen. Das ist der
    // entscheidende Schärfe-Unterschied zur three.js-Referenz, die
    // `terrain.setAnisotropy(renderer.capabilities.getMaxAnisotropy())`
    // (üblich 16×) setzt, während Babylons Default bei 4 liegt. Terrain
    // wird praktisch immer in flachem Winkel betrachtet — genau dort
    // verwäscht Trilinear-Mipmapping ohne hohe Anisotropie die Tiles zu
    // strukturlosem Matsch ("man sieht die Texturen nicht", obwohl die
    // Daten korrekt gesampelt werden).
    const maxAniso = scene.getEngine().getCaps().maxAnisotropy;
    const splatTex = new Texture(TEX_BASE + 'terrain_d_array.png', scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    splatTex.anisotropicFilteringLevel = maxAniso;
    splatTex.wrapU = Texture.WRAP_ADDRESSMODE;
    splatTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const noiseTexO = new Texture(TEX_BASE + 'TerrainVarietyNoise.png', scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    noiseTexO.anisotropicFilteringLevel = maxAniso;
    noiseTexO.wrapU = Texture.WRAP_ADDRESSMODE;
    noiseTexO.wrapV = Texture.WRAP_ADDRESSMODE;

    // Paint mask atlas. Starts fully black = unpainted everywhere; alpha is
    // unused here (the vegetation mask lives in aLava/the heightmap).
    //
    // No mipmaps on purpose: they would blend across tile borders and bleed
    // one zone's paint into its neighbour in the atlas. Bilinear filtering is
    // kept, matching Unity's default on the original Texture2D — that one-texel
    // ramp is what softens the path edge just enough.
    //
    // convertToLinearSpace stays OFF: this is data, not colour. Same
    // distinction the normal maps already make below.
    const maskData = new Uint8Array(MASK_ATLAS_PX * MASK_ATLAS_PX * 4);
    const maskTexO = new RawTexture(
      maskData,
      MASK_ATLAS_PX,
      MASK_ATLAS_PX,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      false, // generateMipMaps
      false, // invertY
      Texture.BILINEAR_SAMPLINGMODE
    );
    maskTexO.wrapU = Texture.CLAMP_ADDRESSMODE;
    maskTexO.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.maskTexture = maskTexO;

    // ── World XZ → tile UV + noise UV ───────────────────────────────
    const worldXZ = new VectorMergerBlock('worldXZ');
    wps.x.connectTo(worldXZ.x);
    wps.z.connectTo(worldXZ.y);

    const uvScale = cnst('uvScale', 0.5);
    const tileUV = new MultiplyBlock('tileUV');
    worldXZ.xy.connectTo(tileUV.left);
    uvScale.output.connectTo(tileUV.right);

    const noiseUVScale = cnst('noiseUVScale', 0.015);
    const noiseUV = new MultiplyBlock('noiseUV');
    worldXZ.xy.connectTo(noiseUV.left);
    noiseUVScale.output.connectTo(noiseUV.right);
    const noiseTex = new TextureBlock('noiseTex');
    noiseTex.fragmentOnly = true;
    noiseTex.texture = noiseTexO;
    noiseUV.output.connectTo(noiseTex.uv);
    const noiseSplit = new VectorSplitterBlock('noiseSplit');
    noiseTex.rgb.connectTo(noiseSplit.xyzIn);

    // ── Variety-Noise-UV-Rotation + fract(uv) ───────────────────────
    // Die Tile-UVs werden pro Pixel um einen aus der Variety-Noise
    // gelesenen Winkel gedreht (Referenz valheim-browser Terrain.ts:
    //   float ang = nz.r * 6.2831853;
    //   vec2 uv = mat2(ca, sa, -sa, ca) * wuv;
    // ). Ohne diese Drehung wiederholt sich jede Tile-Textur stur im
    // 2-m-Raster — genau der gleichförmig-gekachelte Boden, den der
    // Nutzer als "Boden braucht noch Texturen" gemeldet hat.
    //
    // Das war hier zwischenzeitlich mit dem Vermerk "erzeugt harte Nähte
    // an jeder Noise-Grenze" abgeschaltet. Die Referenz fährt dieselbe
    // Rotation auf denselben absoluten Welt-UVs ohne dieses Problem: der
    // Winkel ändert sich durch die bilineare Filterung der Noise-Textur
    // stetig, und das anschließende fract() + der 0.02-Inset in
    // sampleLayer() (beides bei uns identisch vorhanden) fangen den Rest
    // ab. Falls doch Nähte auftauchen, zuerst dort nachsehen.
    const angScale = cnst('angScale', Math.PI * 2);
    const rotAng = new MultiplyBlock('rotAng');
    noiseSplit.x.connectTo(rotAng.left);
    angScale.output.connectTo(rotAng.right);
    const rotCos = new TrigonometryBlock('rotCos');
    rotCos.operation = TrigonometryBlockOperations.Cos;
    rotAng.output.connectTo(rotCos.input);
    const rotSin = new TrigonometryBlock('rotSin');
    rotSin.operation = TrigonometryBlockOperations.Sin;
    rotAng.output.connectTo(rotSin.input);

    const tileUVSplit = new VectorSplitterBlock('tileUVSplit');
    tileUV.output.connectTo(tileUVSplit.xyIn);
    // uv.x = ca*x - sa*y
    const rxA = new MultiplyBlock('rxA'); rotCos.output.connectTo(rxA.left); tileUVSplit.x.connectTo(rxA.right);
    const rxB = new MultiplyBlock('rxB'); rotSin.output.connectTo(rxB.left); tileUVSplit.y.connectTo(rxB.right);
    const rotX = new SubtractBlock('rotX'); rxA.output.connectTo(rotX.left); rxB.output.connectTo(rotX.right);
    // uv.y = sa*x + ca*y
    const ryA = new MultiplyBlock('ryA'); rotSin.output.connectTo(ryA.left); tileUVSplit.x.connectTo(ryA.right);
    const ryB = new MultiplyBlock('ryB'); rotCos.output.connectTo(ryB.left); tileUVSplit.y.connectTo(ryB.right);
    const rotY = new AddBlock('rotY'); ryA.output.connectTo(rotY.left); ryB.output.connectTo(rotY.right);
    const rotUV = new VectorMergerBlock('rotUV');
    rotX.output.connectTo(rotUV.x);
    rotY.output.connectTo(rotUV.y);

    const fracUVOp = new TrigonometryBlock('fracUVOp');
    fracUVOp.operation = TrigonometryBlockOperations.Fract;
    // ROTATION BEWUSST AUS (siehe Block oben): Der A/B-Vergleich am nackten
    // Terrain (Gras zur Laufzeit ausgeblendet) zeigt mit Rotation großflächig
    // verschmierte Wirbelmuster statt Grasstruktur, ohne Rotation eine saubere,
    // natürlich gefleckte Oberfläche. Die Nachbardifferenz misst das NICHT
    // (1.00 mit vs. 1.20 ohne) — großflächige Verzerrung ist für diese Metrik
    // unsichtbar, deshalb war der Blick aufs Bild nötig. Der ursprüngliche
    // Projektkommentar ("erzeugt harte Nähte / Artefakte") war also korrekt;
    // die Rotation der Referenz ist hier nicht übertragbar.
    tileUV.output.connectTo(fracUVOp.input);
    const fracUV = new VectorSplitterBlock('fracUV');
    fracUVOp.output.connectTo(fracUV.xyIn);

    // ── splatLayer(L, uv): layer offset (16 gestapelte Tiles, REPEAT wrap) ──
    // Gibt den TextureBlock zurück (statt nur .rgb), damit der Alpha-Kanal
    // erreichbar ist. Aktuell wird nur .rgb benutzt — Alpha ist bewusst
    // ungenutzt, siehe unten.
    //
    // BEFUND (gemessen, Nachbardifferenz RGB → Alpha je Tile):
    //   Erde 2.37 → 18.50   Klippe 4.92 → 19.84   Sand 3.82 → 13.90
    //   Sumpfschlamm 2.39 → 18.28   Gepflastert 7.64 → 7.78
    //   Gras 0.91 → 0.18    (übrige Tiles: Alpha konstant 255)
    // Der Alpha-Kanal trägt bei diesen fünf Tiles also deutlich mehr
    // Struktur als RGB — beim Sand steckt praktisch das gesamte Korn dort
    // (RGB ist nahezu weiß).
    //
    // WOFÜR er da ist, ist aber NICHT geklärt, und ein Versuch, ihn als
    // Smoothness für einen Glanzterm zu nutzen, war nachweislich falsch:
    // `Heightmap_basematerial` hat `_SmoothnessTextureChannel: 0`
    // (= Unity liest Smoothness aus der Metallic-Map, nicht aus dem
    // Albedo-Alpha) und `_Glossiness: 0.1` (das Terrain ist matt). Der
    // Term brachte im Render auch keine messbare Änderung (2.00 → 1.99).
    //
    // Plausibler ist Höhe/Parallax: dasselbe Material setzt
    // `_Parallax: 0.02`, `_Displacement: 0.05` und `_Tess: 4` — das
    // Original tesselliert und verschiebt den Boden anhand einer
    // Höhenkarte. Solange nicht belegt ist, dass diese Höhenkarte der
    // Albedo-Alpha ist, bleibt der Kanal hier ungenutzt statt geraten.
    // Eine gemeinsame Sampler-Quelle für ALLE Tile-Zugriffe. Vorher hatte
    // jeder Zugriff seinen eigenen `TextureBlock` — zehn Sampler-Uniforms
    // für ein und dieselbe Textur. Über `ImageSourceBlock` teilen sich
    // jetzt alle Zugriffe einen einzigen.
    const splatQuelle = new ImageSourceBlock('splatAtlas');
    splatQuelle.texture = splatTex;

    /**
     * Ein Tile aus dem 16er-Stapel lesen — mit `textureGrad` statt
     * `texture`.
     *
     * ── Warum nicht der normale TextureBlock ────────────────────────
     * Die Tile-UV entsteht aus `fract(weltUV)`. An JEDER Kachelgrenze
     * springt sie damit von 0.999 auf 0.0. Die Hardware leitet die
     * Mip-Stufe aber aus `dFdx/dFdy` der übergebenen UV ab und sieht an
     * genau diesen Stellen einen riesigen Gradienten — sie wählt dort
     * die gröbste Mip-Stufe. Das Ergebnis ist eine verwaschene Linie
     * entlang jeder Kachelgrenze; in der Ferne, wo die Kacheln dicht
     * liegen, verdichten sich diese Linien zu einem Streifenmuster.
     * Genau das war die Meldung "die Texturkanten bilden sich als
     * Linien/Streifen ab".
     *
     * `textureGrad` nimmt die Ableitungen als Argument. Wir übergeben
     * die der KONTINUIERLICHEN Welt-UV, die den Sprung nicht kennt —
     * damit stimmt die Mip-Wahl über die Kachelgrenze hinweg.
     *
     * Bewusst NICHT `textureLod` (das könnte der TextureBlock über
     * seinen `lod`-Eingang auch): Ein fester LOD verliert die anisotrope
     * Filterung, und die ist beim flachen Blick übers Terrain der
     * Unterschied zwischen Struktur und Matsch (siehe `maxAniso` oben).
     * `textureGrad` behält sie.
     *
     * Der y-Gradient muss in den Atlas-Raum: Die Tile-Zeile ist
     * `(layer + 0.02 + fract(uv.y)*0.96) / 16`, also skaliert die
     * Ableitung mit 0.96/16.
     */
    const tileSampler = (
      layerInput: NodeMaterialConnectionPoint,
      name: string,
      /** UV-Faktor: 1 = normale Kachelung, <1 = gröber (für die Makro-Ebene). */
      freq = 1,
      /** UV-Versatz, damit grobe und feine Ebene nicht deckungsgleich laufen. */
      versatz: readonly [number, number] = [0, 0]
    ): NodeMaterialConnectionPoint => {
      if (scene.getEngine().isWebGPU) {
        // glslang erlaubt einen kombinierten sampler2D(texture, sampler)
        // nur direkt am texture*-Aufruf, nicht als Funktionsargument. Der
        // CustomBlock unten uebergibt ihn jedoch an vbTileSample_* und ist
        // deshalb unter WebGPU unuebersetzbar. Derselbe Atlaszugriff wird
        // hier aus Babylon-Bloecken aufgebaut; TextureBlock emittiert den
        // Sampler-Konstruktor direkt am Sample und ist WebGPU-gueltig.
        //
        // Einzige optische Abweichung des Testpfads: TextureBlock kann die
        // kontinuierlichen Gradienten des GLSL-Helfers nicht uebernehmen.
        // Die Tile-Auswahl, Atlas-Insets und sRGB-Linearisierung bleiben
        // identisch; ein nativer WGSL-Block kann textureSampleGrad spaeter
        // wieder exakt nachziehen, falls WebGPU den Messvergleich gewinnt.
        const skala = new MultiplyBlock(`tile_${name}_skala`);
        tileUV.output.connectTo(skala.left);
        cnst(`tile_${name}_freq`, freq).output.connectTo(skala.right);

        const verschoben = new AddBlock(`tile_${name}_versatz`);
        skala.output.connectTo(verschoben.left);
        cnst2(`tile_${name}_versatzWert`, new Vector2(versatz[0], versatz[1])).output.connectTo(
          verschoben.right
        );

        const gebrochen = new TrigonometryBlock(`tile_${name}_fract`);
        gebrochen.operation = TrigonometryBlockOperations.Fract;
        verschoben.output.connectTo(gebrochen.input);
        const f = new VectorSplitterBlock(`tile_${name}_f`);
        gebrochen.output.connectTo(f.xyIn);

        const fy = new MultiplyBlock(`tile_${name}_fy`);
        f.y.connectTo(fy.left);
        cnst(`tile_${name}_yinset`, 0.96).output.connectTo(fy.right);
        const layerInset = new AddBlock(`tile_${name}_layerInset`);
        layerInput.connectTo(layerInset.left);
        cnst(`tile_${name}_padding`, 0.02).output.connectTo(layerInset.right);
        const ySumme = new AddBlock(`tile_${name}_ySumme`);
        layerInset.output.connectTo(ySumme.left);
        fy.output.connectTo(ySumme.right);
        const yAtlas = new MultiplyBlock(`tile_${name}_yAtlas`);
        ySumme.output.connectTo(yAtlas.left);
        cnst(`tile_${name}_atlasHoehe`, 1 / 16).output.connectTo(yAtlas.right);

        const atlasUv = new VectorMergerBlock(`tile_${name}_atlasUv`);
        f.x.connectTo(atlasUv.x);
        yAtlas.output.connectTo(atlasUv.y);
        const tex = new TextureBlock(`tile_${name}_tex`);
        tex.fragmentOnly = true;
        splatQuelle.source.connectTo(tex.source);
        atlasUv.xy.connectTo(tex.uv);

        const linear = new PowBlock(`tile_${name}_linear`);
        tex.rgb.connectTo(linear.value);
        cnst3(`tile_${name}_gamma`, new Color3(2.2, 2.2, 2.2)).output.connectTo(linear.power);
        return linear.output;
      }

      const cb = new CustomBlock(`tile_${name}`);
      const fn = `vbTileSample_${name}`;
      cb.options = {
        name: `tile_${name}`,
        target: 'Fragment',
        functionName: fn,
        inParameters: [
          { name: 'atlas', type: 'sampler2D' },
          { name: 'uvKont', type: 'Vector2' },
          { name: 'layer', type: 'Float' },
          { name: 'wpos', type: 'Vector3' },
          { name: 'cpos', type: 'Vector3' },
        ],
        outParameters: [{ name: 'result', type: 'Vector3' }],
        code: [
          `void ${fn}(sampler2D atlas, vec2 uvKontRoh, float layer, vec3 wpos, vec3 cpos, out vec3 result) {`,
          `  vec2 uvKont = uvKontRoh * ${freq.toFixed(4)} + vec2(${versatz[0].toFixed(3)}, ${versatz[1].toFixed(3)});`,
          '  vec2 ddx = dFdx(uvKont);',
          '  vec2 ddy = dFdy(uvKont);',
          // ── Entfernungsunschärfe ──────────────────────────────────
          // Je weiter weg, desto gröber die Mip-Stufe. `textureGrad`
          // leitet die Stufe aus den Ableitungen ab — sie aufzublasen
          // ist deshalb dasselbe wie ein Mip-Bias, kostet aber KEIN
          // zusätzliches Sample und behält die anisotrope Filterung.
          //
          // Zweck ist nicht Performance, sondern Optik: Aus der Ferne
          // liest sich eine gekachelte Textur sonst als regelmäßiges
          // Muster, weil dort viele Kacheln auf wenige Pixel fallen.
          // Verwaschen verschwindet die Regelmäßigkeit, und die Fläche
          // wirkt wie Gelände statt wie Tapete. Faktor 2 entspricht
          // einer Mip-Stufe.
          `  float dist = length(cpos - wpos);`,
          `  float bias = 1.0 + max(0.0, (dist - ${FERN_START.toFixed(1)}) / ${FERN_SKALA.toFixed(1)});`,
          `  bias = min(bias, ${FERN_MAX.toFixed(1)});`,
          '  ddx *= bias;',
          '  ddy *= bias;',
          '  vec2 f = fract(uvKont);',
          // 0.02-Inset + 0.96-Stauchung halten das Sample innerhalb der
          // Tile-Zeile, damit die Nachbarzeile nicht hereinblutet.
          '  float y = (layer + 0.02 + f.y * 0.96) / 16.0;',
          '  const float YS = 0.96 / 16.0;',
          '  vec3 c = textureGrad(atlas, vec2(f.x, y),',
          '                       vec2(ddx.x, ddx.y * YS),',
          '                       vec2(ddy.x, ddy.y * YS)).rgb;',
          // sRGB → linear, wie zuvor `TextureBlock.convertToLinearSpace`.
          // OHNE DAS wird das Terrain DOPPELT gamma-kodiert: die
          // Tile-Werte sind sRGB, werden aber als linear beleuchtet, und
          // das ImageProcessing hängt am Ende nochmal die Gamma-Kurve an.
          // Gemessen: Tile 0 hat in der Datei RGB(81,112,64), gerendert
          // kam RGB(162,185,138) heraus. Nur für die Diffuse-Tiles —
          // Noise- und Normal-Maps sind Daten, keine Farben.
          '  result = pow(c, vec3(2.2));',
          '}',
        ],
      };
      const o = cb as unknown as Record<string, NodeMaterialConnectionPoint>;
      splatQuelle.source.connectTo(o.atlas);
      tileUV.output.connectTo(o.uvKont);
      layerInput.connectTo(o.layer);
      wps.xyzOut.connectTo(o.wpos);
      cameraPos.output.connectTo(o.cpos);
      return (cb as unknown as { result: NodeMaterialConnectionPoint }).result;
    };
    const sampleLayer = (l: NodeMaterialConnectionPoint, n: string): NodeMaterialConnectionPoint =>
      tileSampler(l, n);

    // ── Eck-Tiles + Gewichte (vec4 → xyzw-Input des Splitters) ─────
    const tilesSplit = new VectorSplitterBlock('tilesSplit');
    aTiles.output.connectTo(tilesSplit.xyzw);
    const weightsSplit = new VectorSplitterBlock('weightsSplit');
    aWeights.output.connectTo(weightsSplit.xyzw);

    const wSum1 = new AddBlock('wSum1');
    weightsSplit.x.connectTo(wSum1.left); weightsSplit.y.connectTo(wSum1.right);
    const wSum2 = new AddBlock('wSum2');
    weightsSplit.z.connectTo(wSum2.left); weightsSplit.w.connectTo(wSum2.right);
    const wSum = new AddBlock('wSum');
    wSum1.output.connectTo(wSum.left); wSum2.output.connectTo(wSum.right);
    const wEps = cnst('wEps', 1e-5);
    const wSumMax = new MaxBlock('wSumMax');
    wSum.output.connectTo(wSumMax.left); wEps.output.connectTo(wSumMax.right);
    const wx = new DivideBlock('wx'); weightsSplit.x.connectTo(wx.left); wSumMax.output.connectTo(wx.right);
    const wy = new DivideBlock('wy'); weightsSplit.y.connectTo(wy.left); wSumMax.output.connectTo(wy.right);
    const wz = new DivideBlock('wz'); weightsSplit.z.connectTo(wz.left); wSumMax.output.connectTo(wz.right);
    const ww = new DivideBlock('ww'); weightsSplit.w.connectTo(ww.left); wSumMax.output.connectTo(ww.right);

    const l0 = tileSampler(tilesSplit.x, 'l0');
    const l1 = tileSampler(tilesSplit.y, 'l1');
    const l2 = tileSampler(tilesSplit.z, 'l2');
    const l3 = tileSampler(tilesSplit.w, 'l3');
    const c0 = new MultiplyBlock('c0'); l0.connectTo(c0.left); wx.output.connectTo(c0.right);
    const c1 = new MultiplyBlock('c1'); l1.connectTo(c1.left); wy.output.connectTo(c1.right);
    const c2 = new MultiplyBlock('c2'); l2.connectTo(c2.left); wz.output.connectTo(c2.right);
    const c3 = new MultiplyBlock('c3'); l3.connectTo(c3.left); ww.output.connectTo(c3.right);
    const colA = new AddBlock('colA'); c0.output.connectTo(colA.left); c1.output.connectTo(colA.right);
    const colB = new AddBlock('colB'); c2.output.connectTo(colB.left); c3.output.connectTo(colB.right);
    const baseCol = new AddBlock('baseCol'); colA.output.connectTo(baseCol.left); colB.output.connectTo(baseCol.right);

    // ── Helligkeitsvariation aus drei Oktaven ───────────────────────
    // Siehe den Konstantenblock oben für die Messwerte und die Herleitung
    // der Amplituden. Die mittlere Oktave ist der bisherige Sampler
    // (`noiseSplit`, Skala VAR_SKALA_MITTEL) — er liefert weiterhin auch
    // den Rotationswinkel der Tile-UVs.
    const varOktave = (skala: number, name: string): VectorSplitterBlock => {
      const s = cnst(`${name}Scale`, skala);
      const uv = new MultiplyBlock(`${name}UV`);
      worldXZ.xy.connectTo(uv.left);
      s.output.connectTo(uv.right);
      const tex = new TextureBlock(`${name}Tex`);
      tex.fragmentOnly = true;
      // Dieselbe Texture-Instanz wie die mittlere Oktave: Babylon legt pro
      // TextureBlock einen eigenen Sampler an, die GPU-Textur dahinter
      // bleibt aber dieselbe — kein zusätzlicher VRAM.
      tex.texture = noiseTexO;
      uv.output.connectTo(tex.uv);
      const split = new VectorSplitterBlock(`${name}Split`);
      tex.rgb.connectTo(split.xyzIn);
      return split;
    };
    const grobSplit = varOktave(VAR_SKALA_GROB, 'varGrob');
    const feinSplit = varOktave(VAR_SKALA_FEIN, 'varFein');

    const variation = new CustomBlock('terrainVariation');
    variation.options = {
      name: 'terrainVariation',
      target: 'Fragment',
      functionName: 'vbTerrainVariation',
      inParameters: [
        { name: 'nGrob', type: 'Float' },
        { name: 'nMittel', type: 'Float' },
        { name: 'nFein', type: 'Float' },
      ],
      outParameters: [{ name: 'result', type: 'Float' }],
      code: [
        'void vbTerrainVariation(float nGrob, float nMittel, float nFein, out float result) {',
        // Jede Oktave um ihr eigenes Kanalmittel zentriert, sonst
        // verschöbe die Summe die Gesamthelligkeit statt sie zu streuen.
        `  float v = ${VAR_AMP_GROB.toFixed(2)} * (nGrob - ${VAR_MITTE_GROB.toFixed(3)})`,
        `          + ${VAR_AMP_MITTEL.toFixed(2)} * (nMittel - ${VAR_MITTE_MITTEL.toFixed(3)})`,
        `          + ${VAR_AMP_FEIN.toFixed(2)} * (nFein - ${VAR_MITTE_FEIN.toFixed(3)});`,
        `  result = clamp(${VAR_BASIS.toFixed(3)} + v, ${VAR_MIN.toFixed(2)}, ${VAR_MAX.toFixed(2)});`,
        '}',
      ],
    };
    grobSplit.x.connectTo(variation.getInputByName('nGrob')!);
    noiseSplit.y.connectTo(variation.getInputByName('nMittel')!);
    feinSplit.z.connectTo(variation.getInputByName('nFein')!);

    // ── Makro-Ebene gegen die sichtbare Kachelwiederholung ──────────
    //
    // Die Oktaven-Variation oben ist ein reiner HELLIGKEITSfaktor: Sie
    // streut die Tonwerte, lässt die Tile-Struktur aber unangetastet.
    // Über weite, flach einsehbare Flächen bleibt die Kachelung deshalb
    // als regelmäßiges Muster erkennbar — gemeldet als "die Texturen
    // wiederholen sich, das sieht alles so gleichmäßig aus".
    //
    // Dagegen hilft nur eine zweite STRUKTUR-Ebene: dasselbe Tile ein
    // weiteres Mal, aber mit einer anderen, unrunden Frequenz und einem
    // UV-Versatz. Zwei überlagerte Kachelungen wiederholen sich erst im
    // kleinsten gemeinsamen Vielfachen ihrer Perioden — bei 0.137
    // (≈ 7,3× gröber) liegt das so weit draußen, dass es im Bild nicht
    // mehr als Raster lesbar ist.
    //
    // Bewusst DASSELBE Tile als Quelle: Damit stammt die Beimischung aus
    // demselben Material und kann keine fremde Farbe einschleppen. Und
    // bewusst nur der dominante Eck-Tile (`tilesSplit.x`) statt aller
    // vier — das kostet EIN zusätzliches Sample statt vier, und für eine
    // grobe Strukturstörung genügt die vorherrschende Textur.
    //
    // 0.30 ist ein Kompromiss: genug, um das Raster zu brechen, wenig
    // genug, dass der Nahbereich seine Schärfe behält (die Makro-Ebene
    // ist dort stark vergrößert und damit unscharf).
    const makro = tileSampler(tilesSplit.x, 'makro', MAKRO_FREQ, MAKRO_VERSATZ);
    const antiKachel = new LerpBlock('antiKachel');
    baseCol.output.connectTo(antiKachel.left);
    makro.connectTo(antiKachel.right);
    cnst('makroAnteil', MAKRO_ANTEIL).output.connectTo(antiKachel.gradient);

    const colBright = new MultiplyBlock('colBright');
    antiKachel.output.connectTo(colBright.left);
    variation.getOutputByName('result')!.connectTo(colBright.right);

    // ── Sand am Ufer UND auf dem Grund ──────────────────────────────
    // Hier stand ein Dreiecksband, das nur zwischen 29,5 m und 32,5 m
    // Sand einblendete und mit `step(29.5, y)` nach unten hart abschnitt.
    // Unterhalb des Wasserspiegels galt damit wieder die Biom-Textur —
    // und die ist in Küstennähe Meadows, also GRAS. Nachgezählt über die
    // Vertex-Attribute von 40 Chunks: 76.621 Vertices unter Wasser tragen
    // das Gras-Tile gegen 8.450 mit Sand. Der Meeresboden vor dem Strand
    // war also eine überflutete Wiese; das ist zugleich der Grund, warum
    // das flache Wasser grün durchscheint (siehe WaterPlugin: der Grund
    // kommt bei 1 m Säule zu 55-85 % durch).
    //
    // Dass der Shader den Wasserspiegel überhaupt kennen muss, sagt das
    // Original selbst: `Heightmap_basematerial` führt `_WaterLevel: 30`
    // als eigene Property. Einen anderen Zweck als die Unterscheidung
    // „über/unter Wasser" hat dieser Wert im Terrain nicht.
    //
    // Jetzt eine Rampe statt eines Bandes: kein Sand ab 2,5 m über dem
    // Spiegel, voll ab 0,5 m darunter, und darunter bleibt es voll.
    const sandTile = cnst('sandTile', TILE.Sand);
    const sandSample = sampleLayer(sandTile.output, 'sand');
    const wlOben = cnst('wlOben', waterLevel + 2.5);
    const sandOben = new SubtractBlock('sandOben'); wlOben.output.connectTo(sandOben.left); wps.y.connectTo(sandOben.right);
    const sandSpanne = cnst('sandSpanne', 3);
    const sandT = new DivideBlock('sandT'); sandOben.output.connectTo(sandT.left); sandSpanne.output.connectTo(sandT.right);
    const sandClamp = new ClampBlock('sandClamp'); sandT.output.connectTo(sandClamp.value);
    const c08 = cnst('c08', 0.8);
    const sandK = new MultiplyBlock('sandK'); sandClamp.output.connectTo(sandK.left); c08.output.connectTo(sandK.right);
    const sandLerp = new LerpBlock('sandLerp'); colBright.output.connectTo(sandLerp.left); sandSample.connectTo(sandLerp.right); sandK.output.connectTo(sandLerp.gradient);

    // ── Fels auf steilen Flanken ────────────────────────────────────
    // Exakt die Werte der three.js-Referenz (valheim-browser
    // Terrain.ts): rockK = clamp((0.72 - ny) / 0.25, 0, 1) * 0.85.
    //
    // HINWEIS: Hier stand zwischenzeitlich eine Variante mit Schwelle
    // 0.85, schmalerer Rampe (/0.10) und rauschverschobener Schwelle, um
    // den gesprenkelten Fels/Moos-Rand aus einem Original-Screenshot
    // nachzubauen. Das war eine Eigenerfindung ohne Beleg — die Referenz
    // benutzt genau die glatte Rampe unten, ganz ohne Rauschen. Der
    // körnige Eindruck im Original entsteht nicht im Blend, sondern aus
    // der Tile-Textur selbst plus der UV-Rotation (oben) und den
    // Tile-Normal-Maps. Deshalb zurückgesetzt.
    // NACHGEMESSEN: Die Rampe begann bei ny = 0.72, also erst ab 44°
    // Hangneigung. Über die Vertex-Normalen von 40 Chunks ausgezählt
    // liegt die Geländeverteilung so:
    //
    //   bis 26°   80.7 %      35-44°    4.7 %
    //   26-35°    12.4 %      über 44°  2.2 %
    //
    // Fels konnte damit auf 2 % der Fläche überhaupt erscheinen und war
    // erst ab 62° voll ausgefahren — auf 0.03 % der Vertices. Genau das
    // ist die gemeldete Beobachtung: Berghänge ohne Steintextur.
    //
    // Die Rampe beginnt jetzt bei 30° und ist bei 44° voll. Das trifft
    // die 13 % Gelände, die als „Hang" durchgehen, und lässt die 80 %
    // unter 26° unberührt. Der Wert ist ABGESTIMMT, nicht rekonstruiert:
    // die Schwelle steht im Original-Shader, und der liegt im Export nur
    // als 0-Byte-Datei vor (die Materialdaten führen keine dazu).
    const rockSample = sampleLayer(terrainMarkerSplit.x, 'rock');
    const felsBeginn = cnst('felsBeginn', 0.87);   // ny bei 30 Grad
    const rockD = new SubtractBlock('rockD'); felsBeginn.output.connectTo(rockD.left); nrmSplit.y.connectTo(rockD.right);
    const felsRampe = cnst('felsRampe', 0.15);     // voll bei 44 Grad
    const rockT2 = new DivideBlock('rockT2'); rockD.output.connectTo(rockT2.left); felsRampe.output.connectTo(rockT2.right);
    const rockClamp = new ClampBlock('rockClamp'); rockT2.output.connectTo(rockClamp.value);
    const c085r = cnst('c085r', 0.85);
    const rockK = new MultiplyBlock('rockK'); rockClamp.output.connectTo(rockK.left); c085r.output.connectTo(rockK.right);
    // ── Paint-Mask (Dirt / Cultivated / Paved) ──────────────────────
    // Sitzt bewusst NACH dem Sandband und VOR dem Fels:
    //  - nach Sand, damit ein Lehmweg am Strand als Weg liest
    //  - vor Fels, damit man keine Klippe pflastern kann
    //  - vor Schnee/Lava, damit Schnee sich über Bergstraßen legt
    // Das entspricht der Wirkungsreihenfolge im Original-Shader.
    const maskTex = new TextureBlock('maskTex');
    maskTex.fragmentOnly = true;
    maskTex.texture = maskTexO;
    aMaskUV.output.connectTo(maskTex.uv);

    // Die drei Paint-Tiles laufen über dieselbe sampleLayer-Hilfe wie die
    // Biom-Tiles und erben damit 0.02-Inset, fract()-Wrap und die
    // sRGB→linear-Wandlung — sonst säßen sie farblich neben dem Untergrund.
    const dirtSample = sampleLayer(cnst('dirtTile', TILE.Dirt).output, 'pdirt');
    const cultSample = sampleLayer(cnst('cultTile', TILE.Cleared).output, 'pcult');
    const pavedSample = sampleLayer(cnst('pavedTile', TILE.Paved).output, 'ppaved');

    const paint = new CustomBlock('terrainPaint');
    paint.options = {
      name: 'terrainPaint',
      target: 'Fragment',
      functionName: 'vbTerrainPaint',
      inParameters: [
        { name: 'baseCol', type: 'Vector3' },
        { name: 'm', type: 'Vector4' },
        { name: 'cDirt', type: 'Vector3' },
        { name: 'cCult', type: 'Vector3' },
        { name: 'cPaved', type: 'Vector3' },
      ],
      outParameters: [{ name: 'result', type: 'Vector3' }],
      code: [
        'void vbTerrainPaint(vec3 baseCol, vec4 m, vec3 cDirt, vec3 cCult, vec3 cPaved, out vec3 result) {',
        // Die Kanäle sind weder normalisiert noch exklusiv (Original: sie
        // werden per Lerp überblendet). Gewichtet mischen, und die Stärke des
        // Übergangs zum Biom-Untergrund über den dominanten Kanal steuern.
        '  float wsum = m.r + m.g + m.b;',
        '  float k = clamp(max(max(m.r, m.g), m.b), 0.0, 1.0);',
        '  vec3 pc = (cDirt * m.r + cCult * m.g + cPaved * m.b) / max(wsum, 1e-5);',
        '  result = mix(baseCol, pc, k);',
        '}',
      ],
    };
    sandLerp.output.connectTo((paint as unknown as Record<string, never>).baseCol);
    maskTex.rgba.connectTo((paint as unknown as Record<string, never>).m);
    dirtSample.connectTo((paint as unknown as Record<string, never>).cDirt);
    cultSample.connectTo((paint as unknown as Record<string, never>).cCult);
    pavedSample.connectTo((paint as unknown as Record<string, never>).cPaved);
    const painted = (paint as unknown as { result: NodeMaterialConnectionPoint }).result;

    const rockLerp = new LerpBlock('rockLerp'); painted.connectTo(rockLerp.left); rockSample.connectTo(rockLerp.right); rockK.output.connectTo(rockLerp.gradient);

    // ── Schnee (Mountain/DeepNorth), nur auf flachen Stellen ────────
    const snowCol = cnst3('snowCol', new Color3(0.93, 0.95, 0.99));
    const snowSS = new SmoothStepBlock('snowSS');
    const ss04 = cnst('ss04', 0.4);
    const ss065 = cnst('ss065', 0.65);
    ss04.output.connectTo(snowSS.edge0); ss065.output.connectTo(snowSS.edge1); nrmSplit.y.connectTo(snowSS.value);
    const snowK = new MultiplyBlock('snowK'); terrainMarkerSplit.y.connectTo(snowK.left); snowSS.output.connectTo(snowK.right);
    const snowLerp = new LerpBlock('snowLerp'); rockLerp.output.connectTo(snowLerp.left); snowCol.output.connectTo(snowLerp.right); snowK.output.connectTo(snowLerp.gradient);

    // ── Lava (AshLands): dunkle Kruste + glühende Risse ─────────────
    const crustTile = cnst('crustTile', TILE.LavaCrust);
    const crustSample = sampleLayer(crustTile.output, 'crust');
    const crustTint = cnst3('crustTint', new Color3(0.45, 0.42, 0.4));
    const crustDark = new MultiplyBlock('crustDark'); crustSample.connectTo(crustDark.left); crustTint.output.connectTo(crustDark.right);
    const lavaClamp = new ClampBlock('lavaClamp'); terrainMarkerSplit.z.connectTo(lavaClamp.value);
    const c09 = cnst('c09', 0.9);
    const lavaK = new MultiplyBlock('lavaK'); lavaClamp.output.connectTo(lavaK.left); c09.output.connectTo(lavaK.right);
    const lavaLerp = new LerpBlock('lavaLerp'); snowLerp.output.connectTo(lavaLerp.left); crustDark.output.connectTo(lavaLerp.right); lavaK.output.connectTo(lavaLerp.gradient);
    const crustSplit = new VectorSplitterBlock('crustSplit'); crustSample.connectTo(crustSplit.xyzIn);
    const emisSS = new SmoothStepBlock('emisSS');
    const es022 = cnst('es022', 0.22);
    const es065 = cnst('es065', 0.65);
    es022.output.connectTo(emisSS.edge0); es065.output.connectTo(emisSS.edge1); crustSplit.x.connectTo(emisSS.value);
    const lava3 = new PowBlock('lava3');
    lavaClamp.output.connectTo(lava3.value); cnst('c3p', 3).output.connectTo(lava3.power);
    const emis1 = new MultiplyBlock('emis1'); lava3.output.connectTo(emis1.left); emisSS.output.connectTo(emis1.right);
    const emisC = cnst3('emisC', new Color3(1, 0.3, 0.03));
    const emis2 = new MultiplyBlock('emis2'); emisC.output.connectTo(emis2.left); emis1.output.connectTo(emis2.right);
    const c25 = cnst('c25', 2.5);
    const lavaEmissive = new MultiplyBlock('lavaEmissive'); emis2.output.connectTo(lavaEmissive.left); c25.output.connectTo(lavaEmissive.right);

    // ── Tiefen-Tönung unter Wasser ──────────────────────────────────
    const depthCol = cnst3('depthCol', new Color3(0.16, 0.3, 0.34));
    const wl = cnst('wl', waterLevel);
    const depthD = new SubtractBlock('depthD'); wl.output.connectTo(depthD.left); wps.y.connectTo(depthD.right);
    const c12 = cnst('c12', 12);
    const depthT = new DivideBlock('depthT'); depthD.output.connectTo(depthT.left); c12.output.connectTo(depthT.right);
    const depthClamp = new ClampBlock('depthClamp'); depthT.output.connectTo(depthClamp.value);
    const c07 = cnst('c07', 0.7);
    const depthK = new MultiplyBlock('depthK'); depthClamp.output.connectTo(depthK.left); c07.output.connectTo(depthK.right);
    const depthLerp = new LerpBlock('depthLerp'); lavaLerp.output.connectTo(depthLerp.left); depthCol.output.connectTo(depthLerp.right); depthK.output.connectTo(depthLerp.gradient);

    // ── G-TEX2: Tile-Normal-Maps ────────────────────────────────────
    // Ohne diese Ebene ist das Terrain nur eine flach beleuchtete
    // Farbfläche — genau der "wir sehen immer noch das Standard-Terrain
    // als Untergrund"-Eindruck, den der Nutzer gemeldet hat. Die
    // three.js-Referenz (valheim-browser Terrain.ts, G-TEX2) benutzt sie;
    // bei uns lagen die Dateien zwar vor (256², valide Tangent-Space-Maps),
    // wurden aber nie gesampelt.
    //
    // Der Rip enthält KEIN 16-Ebenen-Normal-Array, nur drei
    // Rauheitsgruppen. Die Zuordnung Tile→Gruppe unten ist 1:1 aus der
    // Referenz gespiegelt (`tileNormalGroup`).
    // ── Normal-Maps: die eigenen des Originals statt drei Sammelgruppen ──
    // `Heightmap_basematerial` führt neben dem Normal-Array fünf EIGENE
    // Normal-Maps, jede mit einem Slot, der sagt, wofür sie da ist:
    // `_CliffNormal`, `_ForestNormal`, `_SnowNormal`, `_PavedNormal` und
    // `_CultivatedNormal`. Bisher liefen alle 16 Tiles über drei
    // Gruppen-Kacheln (terraintile_n_0/1/2) — und diese drei sind, wie der
    // Vergleich der Kanalmittel zeigt, nichts anderes als die entpackten
    // Layer 0..2 des Normal-Arrays. Fels bekam damit dieselbe Körnung wie
    // Sumpfschlamm.
    //
    // Die fünf dedizierten Karten liegen bereits ENTPACKT vor (XY in RG,
    // Z in B, gemessen ~(127, 128, 253)) und brauchen deshalb keine
    // DXT5nm-Rückrechnung wie das Array selbst.
    //
    // Reihenfolge = Gruppenindex in vbTileNormalGroup unten.
    const normalTexs = [
      'terraintile_n_0',      // 0 weich: Grass, Heath, Sand, Moss
      'forest_n',             // 1 Waldboden        (_ForestNormal)
      'terraintile_n_1',      // 2 mittel: Dirt, Ash, Sumpf
      'cultivated_n',         // 3 umgegraben       (_CultivatedNormal)
      'gouacherock_big_n',    // 4 Fels und Lava    (_CliffNormal)
      'paved_n',              // 5 gepflastert      (_PavedNormal)
      'snow_normal',          // 6 Schnee           (_SnowNormal)
    ].map((n, i) => {
      const t = new Texture(TEX_BASE + n + '.png', scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
      t.anisotropicFilteringLevel = maxAniso;
      // WRAP statt fract(): jede Normal-Map ist eine eigene Textur (kein
      // gestapelter Atlas), deshalb darf die Hardware kacheln. Ein
      // fract() im Shader würde an den Kachelgrenzen Mipmap-Nähte erzeugen.
      t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
      const tb = new TextureBlock(`normalTex${i}`);
      tb.fragmentOnly = true;
      tb.texture = t;
      rotUV.xy.connectTo(tb.uv);
      return tb;
    });

    const normalStrength = cnst('normalStrength', 0.7); // Referenzwert uNormalStrength
    const perturb = new CustomBlock('terrainNormal');
    perturb.options = {
      name: 'terrainNormal',
      target: 'Fragment',
      functionName: 'terrainNormalPerturb',
      inParameters: [
        { name: 'n0', type: 'Vector3' },
        { name: 'n1', type: 'Vector3' },
        { name: 'n2', type: 'Vector3' },
        { name: 'n3', type: 'Vector3' },
        { name: 'n4', type: 'Vector3' },
        { name: 'n5', type: 'Vector3' },
        { name: 'nSnow', type: 'Vector3' },
        { name: 'schnee', type: 'Float' },
        { name: 'tiles', type: 'Vector4' },
        { name: 'weights', type: 'Vector4' },
        { name: 'wpos', type: 'Vector3' },
        { name: 'uv', type: 'Vector2' },
        { name: 'surfN', type: 'Vector3' },
        { name: 'strength', type: 'Float' },
      ],
      outParameters: [{ name: 'result', type: 'Vector3' }],
      code: [
        // Tile → welche der sechs Normal-Maps. Die Zuordnung folgt den
        // Slot-Namen des Originals: was `_ForestNormal` heisst, liegt auf
        // Waldboden, `_CliffNormal` auf Fels und Lava, und so weiter.
        'float vbTileNormalGroup(float tile) {',
        `  if (tile == ${TILE.Forest}.0) return 1.0;`,
        `  if (tile == ${TILE.Cleared}.0) return 3.0;`,
        `  if (tile == ${TILE.Paved}.0) return 5.0;`,
        `  if (tile == ${TILE.Rock}.0 || tile == ${TILE.Cliff}.0 || tile == ${TILE.LavaEmber}.0`,
        `   || tile == ${TILE.Basalt}.0 || tile == ${TILE.LavaCrust}.0) return 4.0;`,
        `  if (tile == ${TILE.Grass}.0 || tile == ${TILE.Heath}.0 || tile == ${TILE.Sand}.0`,
        `   || tile == ${TILE.Moss}.0) return 0.0;`,
        '  return 2.0;',   // Dirt, Ash, SwampMud, SwampDark
        '}',
        // Branchfreie Auswahl: je Gruppe eine 0/1-Maske aus zwei step().
        'vec3 vbPickGroup(float g, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec3 f) {',
        '  return a * (step(g, 0.5))',
        '       + b * (step(0.5, g) * step(g, 1.5))',
        '       + c * (step(1.5, g) * step(g, 2.5))',
        '       + d * (step(2.5, g) * step(g, 3.5))',
        '       + e * (step(3.5, g) * step(g, 4.5))',
        '       + f * (step(4.5, g));',
        '}',
        'void terrainNormalPerturb(vec3 n0, vec3 n1, vec3 n2, vec3 n3, vec3 n4, vec3 n5,',
        '                          vec3 nSnow, float schnee, vec4 tiles, vec4 weights,',
        '                          vec3 wpos, vec2 uv, vec3 surfN, float strength, out vec3 result) {',
        '  vec4 w = weights / max(weights.x + weights.y + weights.z + weights.w, 1e-5);',
        '  vec3 nc = vbPickGroup(vbTileNormalGroup(tiles.x), n0, n1, n2, n3, n4, n5) * w.x',
        '          + vbPickGroup(vbTileNormalGroup(tiles.y), n0, n1, n2, n3, n4, n5) * w.y',
        '          + vbPickGroup(vbTileNormalGroup(tiles.z), n0, n1, n2, n3, n4, n5) * w.z',
        '          + vbPickGroup(vbTileNormalGroup(tiles.w), n0, n1, n2, n3, n4, n5) * w.w;',
        // Schnee liegt ÜBER der Tile-Mischung, genau wie seine Farbe: er
        // deckt zu, statt sich einzumischen. Derselbe Faktor wie dort.
        '  nc = mix(nc, nSnow, clamp(schnee, 0.0, 1.0));',
        '  vec3 mapN = nc * 2.0 - 1.0;',
        '  mapN.xy *= strength;',
        // Tangentenfreie Störung (Schüler-Technik, wie in der Referenz):
        // unsere Terrain-Geometrie führt keine Tangenten mit, deshalb wird
        // die Basis pro Pixel aus den Screen-Space-Ableitungen von
        // Weltposition und UV rekonstruiert. Braucht Ableitungen — in
        // GLSL ES 3.00 (WebGL2, unser Pfad) Kernsprache.
        '  vec3 q0 = dFdx(wpos);',
        '  vec3 q1 = dFdy(wpos);',
        '  vec2 st0 = dFdx(uv);',
        '  vec2 st1 = dFdy(uv);',
        '  vec3 N = normalize(surfN);',
        '  vec3 q1perp = cross(q1, N);',
        '  vec3 q0perp = cross(N, q0);',
        '  vec3 T = q1perp * st0.x + q0perp * st1.x;',
        '  vec3 B = q1perp * st0.y + q0perp * st1.y;',
        '  float det = max(dot(T, T), dot(B, B));',
        '  float sc = (det == 0.0) ? 0.0 : inversesqrt(det);',
        '  result = normalize(T * (mapN.x * sc) + B * (mapN.y * sc) + N * mapN.z);',
        '}',
      ],
    };
    const pIn = perturb as unknown as Record<string, never>;
    normalTexs[0].rgb.connectTo(pIn.n0);
    normalTexs[1].rgb.connectTo(pIn.n1);
    normalTexs[2].rgb.connectTo(pIn.n2);
    normalTexs[3].rgb.connectTo(pIn.n3);
    normalTexs[4].rgb.connectTo(pIn.n4);
    normalTexs[5].rgb.connectTo(pIn.n5);
    normalTexs[6].rgb.connectTo(pIn.nSnow);
    snowK.output.connectTo(pIn.schnee);
    aTiles.output.connectTo((perturb as unknown as Record<string, never>).tiles);
    aWeights.output.connectTo((perturb as unknown as Record<string, never>).weights);
    wps.xyzOut.connectTo((perturb as unknown as Record<string, never>).wpos);
    rotUV.xy.connectTo((perturb as unknown as Record<string, never>).uv);
    nrmSplit.xyzOut.connectTo((perturb as unknown as Record<string, never>).surfN);
    normalStrength.output.connectTo((perturb as unknown as Record<string, never>).strength);
    const litNrm = new VectorSplitterBlock('litNrm');
    (perturb as unknown as { result: NodeMaterialConnectionPoint }).result.connectTo(litNrm.xyzIn);

    // ── Beleuchtung (Lambert) ───────────────────────────────────────
    this.sunDirBlock = new InputBlock('sunDir');
    this.sunDirBlock.value = new Vector3(0.5, -1, 0.3);
    this.sunColBlock = new InputBlock('sunCol');
    this.sunColBlock.value = new Color3(1, 0.96, 0.88);
    this.ambientBlock = new InputBlock('ambient');
    this.ambientBlock.value = new Color3(0.45, 0.48, 0.52);

    const negL = new MultiplyBlock('negL'); this.sunDirBlock.output.connectTo(negL.left); cnst('cneg', -1).output.connectTo(negL.right);
    const negLS = new VectorSplitterBlock('negLS'); negL.output.connectTo(negLS.xyzIn);
    // Beleuchtet wird mit der per Normal-Map GESTÖRTEN Normalen (litNrm).
    // Fels-/Schnee-Schwellen oben benutzen weiterhin bewusst die
    // GEOMETRISCHE Normale (nrmSplit): sie beschreiben die Hangneigung,
    // und die darf nicht von der Oberflächenkörnung abhängen — sonst
    // flackern Fels- und Schneegrenzen mit dem Texturdetail.
    const nSx = new MultiplyBlock('nSx'); litNrm.x.connectTo(nSx.left); negLS.x.connectTo(nSx.right);
    const nSy = new MultiplyBlock('nSy'); litNrm.y.connectTo(nSy.left); negLS.y.connectTo(nSy.right);
    const nSz = new MultiplyBlock('nSz'); litNrm.z.connectTo(nSz.left); negLS.z.connectTo(nSz.right);
    const dotA = new AddBlock('dotA'); nSx.output.connectTo(dotA.left); nSy.output.connectTo(dotA.right);
    const dotN = new AddBlock('dotN'); dotA.output.connectTo(dotN.left); nSz.output.connectTo(dotN.right);
    const lambert = new MaxBlock('lambert'); dotN.output.connectTo(lambert.left); cnst('czero', 0).output.connectTo(lambert.right);
    const sunTerm = new MultiplyBlock('sunTerm'); this.sunColBlock.output.connectTo(sunTerm.left); lambert.output.connectTo(sunTerm.right);

    // ── Schlagschatten der Sonne ────────────────────────────────────
    // Der `LightBlock` ist hier NICHT als Beleuchtung eingehängt — die
    // rechnet der Graph oben weiterhin selbst (Lambert gegen die per
    // Normal-Map gestörte Normale, plus Ambient). Benutzt wird
    // ausschliesslich sein `shadow`-Ausgang: ein Faktor 0..1, in dem
    // Babylons Kaskaden-Abtastung schon steckt.
    //
    // Das ist der Grund, warum das Terrain vorher keine Schatten
    // empfangen konnte: Ein NodeMaterial mit rein handgebauter
    // Beleuchtung kennt Babylons Lichtsystem nicht. Mit diesem Block
    // kennt es genau den Teil davon, den wir brauchen — ohne dass die
    // bewusst so gebaute Lambert-Berechnung ersetzt werden muss.
    //
    // Beleuchtet wird mit der GEOMETRISCHEN Normale (normalW), nicht mit
    // der gestörten: Der Schattenfaktor hängt an der Geometrie, und die
    // Texturkörnung darf die Schattenkante nicht ausfransen.
    //
    // Der Boden empfängt Schatten. Bis das lief, mussten VIER Fehler weg —
    // drei in Babylon, einer bei uns.
    //
    // Die ersten drei stecken alle im Einzellicht-Zweig von `LightBlock`
    // und sind in SonnenSchattenBlock.ts ausführlich beschrieben:
    //   1. `SHADOWS` wird nur im Mehrlicht-Pfad von
    //      `LightBlock.prepareDefines` gesetzt; mit gesetztem `.light`
    //      fällt `shadowsFragmentFunctions` komplett aus dem Shader.
    //   2. `shadowsVertex` benutzt den fest verdrahteten Bezeichner `view`,
    //      den nur derselbe Mehrlicht-Pfad deklariert.
    //
    //   3. Der Schatten-Sampler `shadowTexture0` bekam nie eine eigene
    //      Textureinheit und kollidierte mit dem ersten Terrain-Sampler,
    //      was das Terrain komplett unsichtbar machte. Auch das ist
    //      derselbe Fehler: `_injectVertexCode` trägt den Block nur im
    //      Mehrlicht-Zweig in `dynamicUniformBlocks` ein, und nur über
    //      diese Liste meldet Babylon den Sampler an. Behoben.
    //
    // Der VIERTE Fehler lag bei uns und kostete am meisten Zeit, weil er
    // sich als Nichtdeterminismus zeigte: Ob dieses Material mit
    // Schattencode kompiliert, war ein WETTLAUF gegen den
    // ShadowGenerator — je nachdem, ob der erste Chunk vor oder nach ihm
    // entsteht. Zweimal derselbe Startvorgang gemessen, einmal war
    // `computeShadowCSM` im Fragment-Shader, einmal nicht. Babylon würde
    // das über `light._markMeshesAsLightDirty()` selbst richten, aber
    // `main.ts` setzt `blockMaterialDirtyMechanism = true`, und
    // `markAsDirty` steigt dann sofort wieder aus (`material.js:1151`).
    // Behoben in `Shadows.nodeMaterialsNeuUebersetzen()`.
    //
    // Verifiziert: Der Schlagschatten des Spielers liegt sichtbar auf dem
    // Boden, auch bei Grasdichte 0 — es ist also wirklich das Terrain und
    // nicht das Clutter darüber.
    //
    // ⚠️ Die Prüfung "steht `computeShadowCSM` im Fragment-Quelltext?"
    // über `material.getEffect()` ist dafür KEIN taugliches Maß: Sie
    // meldete `false`, während der Schatten im Bild sichtbar war (nach
    // dem Neuübersetzen greift der Getter offenbar einen anderen Effekt
    // ab). Im Zweifel das Bild ansehen.
    const TERRAIN_EMPFAENGT_SCHATTEN = true;
    // Der Ausgang, der in `litSum` weitergeht — mit Schatten der
    // multiplizierte, ohne Schatten der unveränderte Sonnenterm.
    let sunAusgang = sunTerm.output;
    // Der Glanzterm weiter unten liest denselben Schattenfaktor. Ohne
    // Schattenempfang ist er konstant 1 ("voll besonnt").
    let schattenAusgang = cnst('keinSchatten', 1).output;
    if (TERRAIN_EMPFAENGT_SCHATTEN) {
      const schattenLicht = new SonnenSchattenBlock('sonnenSchatten');
      schattenLicht.light = sonne;
      worldPos.output.connectTo(schattenLicht.worldPosition);
      normalW.output.connectTo(schattenLicht.worldNormal);
      cameraPos.output.connectTo(schattenLicht.cameraPosition);
      const viewMatrix = sysInput('view', NodeMaterialSystemValues.View);
      viewMatrix.output.connectTo(schattenLicht.view);
      const m = new MultiplyBlock('sunSchattiert');
      sunTerm.output.connectTo(m.left);
      schattenLicht.shadow.connectTo(m.right);
      sunAusgang = m.output;
      schattenAusgang = schattenLicht.shadow;
    }

    const litSum = new AddBlock('litSum'); sunAusgang.connectTo(litSum.left); this.ambientBlock.output.connectTo(litSum.right);
    const lit = new MultiplyBlock('lit'); depthLerp.output.connectTo(lit.left); litSum.output.connectTo(lit.right);

    // ── Glanz, nach Untergrund unterschiedlich ──────────────────────
    // Bis hierher war die Beleuchtung rein diffus: Lambert plus Ambient,
    // kein Spiegelanteil. Das Original hat einen, und zwar einen, der
    // vom Untergrund abhängt — `_Glossiness 0.1` für alles, `_RockGloss
    // 0.7` für Fels, `_SnowGloss 1.0` für Schnee. Eine nasse Felsplatte
    // und eine Schneefläche heben sich damit deutlich von der Wiese ab,
    // die matt bleibt.
    //
    // Die Anteile kommen aus dem Graphen, der ohnehin schon entscheidet,
    // WELCHE Textur an dieser Stelle liegt: `rockK` steuert die
    // Felsmischung (Hangneigung), `snowK` die Schneedecke. Damit sitzt
    // der Glanz automatisch genau dort, wo auch das Material liegt, ohne
    // eine zweite Schwelle, die mit der ersten auseinanderlaufen könnte.
    //
    // Beleuchtet wird mit derselben gestörten Normalen wie der
    // Lambert-Term (litNrm) — der Glanz ist der Teil, der von der
    // Oberflächenkörnung am stärksten profitiert.
    const glanz = new CustomBlock('terrainGlanz');
    glanz.options = {
      name: 'terrainGlanz',
      target: 'Fragment',
      functionName: 'vbTerrainGlanz',
      inParameters: [
        { name: 'nrm', type: 'Vector3' },
        { name: 'sunDir', type: 'Vector3' },
        { name: 'wpos', type: 'Vector3' },
        { name: 'cpos', type: 'Vector3' },
        { name: 'sunCol', type: 'Vector3' },
        { name: 'schatten', type: 'Float' },
        { name: 'fels', type: 'Float' },
        { name: 'schnee', type: 'Float' },
      ],
      outParameters: [{ name: 'result', type: 'Vector3' }],
      code: [
        'void vbTerrainGlanz(vec3 nrm, vec3 sunDir, vec3 wpos, vec3 cpos, vec3 sunCol,',
        '                    float schatten, float fels, float schnee, out vec3 result) {',
        '  vec3 N = normalize(nrm);',
        '  vec3 L = normalize(-sunDir);',
        '  vec3 V = normalize(cpos - wpos);',
        '  vec3 H = normalize(L + V);',
        `  float gloss = mix(${GLOSS_BASIS.toFixed(2)}, ${GLOSS_FELS.toFixed(2)}, clamp(fels, 0.0, 1.0));`,
        `  gloss = mix(gloss, ${GLOSS_SCHNEE.toFixed(2)}, clamp(schnee, 0.0, 1.0));`,
        // Unitys Standard-Shader bildet Glossiness so auf die Schärfe des
        // Glanzflecks ab: 0.1 ergibt 2 (praktisch matt), 1.0 ergibt 2048.
        '  float schaerfe = exp2(gloss * 11.0);',
        '  float nh = max(dot(N, H), 0.0);',
        '  float nl = max(dot(N, L), 0.0);',
        // Normalisierter Blinn-Phong: ohne (n+8)/(8π) würde ein schmalerer
        // Fleck auch dunkler, statt nur kleiner zu werden.
        '  float norm = (schaerfe + 8.0) / 25.1327;',
        `  result = sunCol * (${FRESNEL_F0.toFixed(2)} * norm * pow(nh, schaerfe) * nl * schatten);`,
        '}',
      ],
    };
    const g = glanz as unknown as Record<string, never>;
    (perturb as unknown as { result: NodeMaterialConnectionPoint }).result.connectTo(g.nrm);
    this.sunDirBlock.output.connectTo(g.sunDir);
    wps.xyzOut.connectTo(g.wpos);
    cameraPos.output.connectTo(g.cpos);
    this.sunColBlock.output.connectTo(g.sunCol);
    schattenAusgang.connectTo(g.schatten);
    rockK.output.connectTo(g.fels);
    snowK.output.connectTo(g.schnee);
    const glanzTeil = (glanz as unknown as { result: NodeMaterialConnectionPoint }).result;

    const mitGlanz = new AddBlock('mitGlanz'); lit.output.connectTo(mitGlanz.left); glanzTeil.connectTo(mitGlanz.right);
    const finalCol = new AddBlock('finalCol'); mitGlanz.output.connectTo(finalCol.left); lavaEmissive.output.connectTo(finalCol.right);

    // ── Nebel (EXP2 manuell) ────────────────────────────────────────
    const camD = new SubtractBlock('camD'); wps.xyzOut.connectTo(camD.left); cameraPos.output.connectTo(camD.right);
    const camDS = new VectorSplitterBlock('camDS'); camD.output.connectTo(camDS.xyzIn);
    const dx2 = new MultiplyBlock('dx2'); camDS.x.connectTo(dx2.left); camDS.x.connectTo(dx2.right);
    const dy2 = new MultiplyBlock('dy2'); camDS.y.connectTo(dy2.left); camDS.y.connectTo(dy2.right);
    const dz2 = new MultiplyBlock('dz2'); camDS.z.connectTo(dz2.left); camDS.z.connectTo(dz2.right);
    const d2A = new AddBlock('d2A'); dx2.output.connectTo(d2A.left); dy2.output.connectTo(d2A.right);
    const dist2 = new AddBlock('dist2'); d2A.output.connectTo(dist2.left); dz2.output.connectTo(dist2.right);
    this.fogDensityBlock = new InputBlock('fogDensity');
    this.fogDensityBlock.value = 0.0055;
    const fd2 = new MultiplyBlock('fd2'); this.fogDensityBlock.output.connectTo(fd2.left); this.fogDensityBlock.output.connectTo(fd2.right);
    const expo = new MultiplyBlock('expo'); fd2.output.connectTo(expo.left); dist2.output.connectTo(expo.right);
    const negExpo = new MultiplyBlock('negExpo'); expo.output.connectTo(negExpo.left); cnst('cnege', -1).output.connectTo(negExpo.right);
    const eBase = cnst('eBase', Math.E);
    const expVal = new PowBlock('expVal'); eBase.output.connectTo(expVal.value); negExpo.output.connectTo(expVal.power);
    const fogFactor = new SubtractBlock('fogFactor'); cnst('c1fog', 1).output.connectTo(fogFactor.left); expVal.output.connectTo(fogFactor.right);

    // ── Gerichteter Nebel: zwei Farben, gemischt über den Sehstrahl ──
    // Dieselbe Rechnung wie in `NebelRichtung.ts`, nur in Weltkoordinaten
    // statt im Sichtraum — `camD` (worldPos − cameraPos) liegt oben schon
    // fertig da, wird für die Distanz aber nur quadriert gebraucht.
    //
    // Als CustomBlock statt als fünf verkettete Blöcke (Normalize, Dot,
    // Max, Pow, Lerp): Der Blockgraph würde die Formel über den halben
    // Bildschirm verteilen, und der Exponent muss mit dem der beiden
    // anderen Pfade zusammenpassen — hier steht er lesbar an einer Stelle.
    const nebelRichtung = new CustomBlock('nebelRichtung');
    nebelRichtung.options = {
      name: 'nebelRichtung',
      target: 'Fragment',
      functionName: 'vbNebelRichtung',
      inParameters: [
        { name: 'camD', type: 'Vector3' },
        { name: 'zurSonne', type: 'Vector3' },
        { name: 'fogAb', type: 'Vector3' },
        { name: 'fogZu', type: 'Vector3' },
      ],
      outParameters: [{ name: 'result', type: 'Vector3' }],
      code: [
        'void vbNebelRichtung(vec3 camD, vec3 zurSonne, vec3 fogAb, vec3 fogZu, out vec3 result) {',
        // max() gegen normalize(0) am Augenpunkt — dort ist die Farbe zwar
        // belanglos, NaN aber trotzdem falsch (s. NebelRichtung.ts).
        '  vec3 blick = camD / max(length(camD), 1e-4);',
        `  float t = pow(max(dot(blick, zurSonne), 0.0), ${FOG_SUN_EXPONENT});`,
        '  result = mix(fogAb, fogZu, t);',
        '}',
      ],
    };
    camD.output.connectTo((nebelRichtung as unknown as Record<string, never>).camD);
    zurSonne.output.connectTo((nebelRichtung as unknown as Record<string, never>).zurSonne);
    fogColor.output.connectTo((nebelRichtung as unknown as Record<string, never>).fogAb);
    fogColorSonne.output.connectTo((nebelRichtung as unknown as Record<string, never>).fogZu);
    const nebelFarbe = (nebelRichtung as unknown as { result: NodeMaterialConnectionPoint }).result;

    const fogLerp = new LerpBlock('fogLerp'); finalCol.output.connectTo(fogLerp.left); nebelFarbe.connectTo(fogLerp.right); fogFactor.output.connectTo(fogLerp.gradient);

    const fragOut = new FragmentOutputBlock('fragOut');
    fogLerp.output.connectTo(fragOut.rgb);

    mat.addOutputNode(vertexOut);
    mat.addOutputNode(fragOut);

    // NodeMaterial legt neutrale Rechenbloecke standardmaessig moeglichst
    // frueh in den Vertex-Shader. Fuer dieses grosse Terrain-Netz ist das
    // kontraproduktiv: Jede Zwischenstufe, die der Fragment-Shader spaeter
    // braucht, wird zu einem eigenen Varying. Der GLSL->WebGPU-Pfad kam so
    // auf 27 Vertex-Ausgaenge (mit CSM 34), WebGPU erlaubt aber 16.
    //
    // Nur Weltposition/-normale und Clipposition muessen im Vertex-Shader
    // bleiben. Alle uebrigen neutralen Operationen rechnen wir pro Pixel;
    // dadurch gehen lediglich die tatsaechlich benoetigten Attribute und
    // Weltwerte ueber die Stufengrenze statt jeder UV-Zwischenrechnung.
    const vertexPflicht = new Set<NodeMaterialBlock>([worldPos, normalW, clipPos]);
    const fragmentBloecke = new Set<NodeMaterialBlock>();
    const sammleFragmentBloecke = (block: NodeMaterialBlock): void => {
      if (fragmentBloecke.has(block)) return;
      fragmentBloecke.add(block);
      for (const input of block.inputs) {
        const quelle = input.connectedPoint?.ownerBlock;
        if (quelle) sammleFragmentBloecke(quelle);
      }
    };
    sammleFragmentBloecke(fragOut);
    for (const block of fragmentBloecke) {
      if (block.target === NodeMaterialBlockTargets.Neutral && !vertexPflicht.has(block)) {
        block.target = NodeMaterialBlockTargets.Fragment;
      }
    }
    mat.build();

    // Terrain must render both faces — the NodeMaterial does manual Lambert
    // lighting so backface culling would hide upward faces depending on the
    // winding order of the chunk indices.
    mat.backFaceCulling = false;

    this.material = mat;
  }

  /**
   * Schreibt die Paint-Maske einer Zone in ihren Atlas-Slot.
   *
   * `null` löscht den Slot — nötig, weil Slots wiederverwendet werden: läuft
   * der Spieler 12 Zonen weit, landet eine neue Zone auf dem Slot einer alten
   * und würde sonst deren Bemalung erben.
   *
   * Aktualisiert nur die 65×65 des Slots (≈17 KB) statt des ganzen Atlas
   * (2,9 MB) — bei mehreren Operationen pro Sekunde ist das der Unterschied
   * zwischen unbemerkt und spürbar.
   */
  uploadMaskTile(zoneX: number, zoneY: number, rgba: Uint8Array | null): void {
    const internal = this.maskTexture.getInternalTexture();
    if (!internal) return;
    const [sx, sy] = maskSlot(zoneX, zoneY);
    const data = rgba ?? EMPTY_MASK_TILE;
    // updateTextureData deklariert ThinEngine, nicht AbstractEngine — zur
    // Laufzeit ist die Engine immer eine ThinEngine (WebGL2/WebGPU).
    const engine = this.maskTexture.getScene()?.getEngine() as
      | import('@babylonjs/core/Engines/thinEngine').ThinEngine
      | undefined;
    if (!engine) return;
    engine.updateTextureData(
      internal,
      data,
      sx * MASK_TILE_PX,
      sy * MASK_TILE_PX,
      MASK_TILE_PX,
      MASK_TILE_PX
    );
  }

  /** Pro Frame von Lighting aufrufen: Sonne/Ambient/Nebel synchronisieren. */
  syncLighting(
    sunDir: Vector3,
    sunColor: Color3,
    ambient: Color3,
    fogDensity: number,
    /** LINEAR (Lighting.fogColorLinear), nicht `scene.fogColor`. */
    fogColor: Color3,
    /** LINEAR (Lighting.fogColorSonnenLinear) — Blick ZUR Sonne. */
    fogColorSonne: Color3,
    /** Richtung ZUR Sonne in WELTKOORDINATEN (Lighting.zurSonneWelt). */
    zurSonneWelt: Vector3
  ): void {
    this.sunDirBlock.value = sunDir;
    this.sunColBlock.value = sunColor;
    this.ambientBlock.value = ambient;
    this.fogDensityBlock.value = fogDensity;
    this.fogColorBlock.value = fogColor;
    this.fogColorSonnenBlock.value = fogColorSonne;
    this.zurSonneBlock.value = zurSonneWelt;
  }
}
