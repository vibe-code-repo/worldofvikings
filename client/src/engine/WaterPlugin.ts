/**
 * WaterPlugin — Wellen, Ufer-Schaum, Tiefen-Farbverlauf und feines
 * Normal-Detail (StandardMaterial-Plugin, Muster wie ClutterWindPlugin).
 *
 * ── Wellen: die ECHTE Formel aus `WaterVolume.cs` ───────────────────
 * Portiert aus dem dekompilierten Client (`GetWaterSurface`/`CalcWave`/
 * `CreateWave`/`TrochSin`): zehn trochoidale Oktaven, deren Amplitude mit
 * der Wassertiefe skaliert.
 *
 *   TrochSin(x,k) = sin(x - cos(x)·k)·0.5 + 0.5
 *   CreateWave:  v = -(z·dir + x·tangent);  n = time·speed
 *                (TrochSin(n + v.y·len, k) · TrochSin(n·0.123 + v.x·0.13123·len, k) - 0.2) · height
 *   CalcWave:    time = waterTime/20, Summe der Oktaven,
 *                Ergebnis × mix(0, windIntensity, depth01)
 *   depth01 = clamp01(oceanDepth / 10)      ← **10 m**, nicht 2.5
 *
 * "Trochoidal" heißt: spitze Kämme, flache Täler — deshalb liest sich das
 * als Wasser und nicht als Sinusteppich.
 *
 * BUG, den das behebt (vom Nutzer gemeldet): das Wasser hob und senkte
 * sich am Ufer nicht, überflutete den Strand nicht und Pfützen bewegten
 * sich nicht. Ursache war eine Dämpfung, die ich zuvor selbst eingebaut
 * hatte — `h * (1 - 0.65 * shore)` in Terrain.ts — die die Wellen
 * ausgerechnet DORT auf 35 % herunterzog, wo die Bewegung sichtbar sein
 * soll. Das Original dämpft zwar auch zum Ufer hin, aber über 10 m statt
 * 2,5 m und mit einer Rohamplitude, die selbst bei 1 m Tiefe noch
 * Dezimeter- bis Meterhub übrig lässt. Die three.js-Referenz
 * (valheim-browser) dämpft sogar überhaupt nicht — dort ist genau das der
 * Grund, warum der Strand sichtbar überspült wird.
 *
 * Die Verschiebung passiert jetzt im VERTEX-SHADER statt auf der CPU:
 * zehn Oktaven × zwei TrochSin je Vertex sind pro Frame auf der CPU nicht
 * bezahlbar (~330k Trigonometrie-Aufrufe bei 16,6k Vertices).
 *
 * ── Schaum ──────────────────────────────────────────────────────────
 * Struktur nach den Property-Deklarationen des Original-Shaders
 * (`m_PropInfo.m_Props`; Shader-Quellcode war nicht zu gewinnen):
 * `_FoamTex`/`_FoamHighTex`/`_RandomFoamTex`/`_CurlTex` sowie
 * `_FoamDepth`/`_ShoreFade`/`_DepthFade`/`_WaterEdge` ⇒ Schaumstärke ist
 * eine Funktion der Wassertiefe (Ufer-/Intersection-Schaum), keine gemalte
 * Maske. Entsprechend wird der Schaum hier aus der **effektiven** Tiefe
 * gebildet: Grundtiefe + aktueller Wellenhub. Dadurch wandert der
 * Schaumsaum mit der Brandung vor und zurück, statt starr am Ufer zu
 * kleben.
 *
 * WICHTIG — warum der Schaum vorher "absolut nicht realistisch" aussah:
 * die gerippten Schaumtexturen im Asset-Ordner sind **0 Byte**
 * (`foam.png`, `foam_highres.png`, `random_foam.png`, `water_foam.png`,
 * … — 2.639 von 2.763 PNGs dort sind leere Stubs). Der Shader sampelte
 * also leere Dateien.
 *
 * Die Bilddaten waren aber nicht verloren, nur namenlos: unter
 * `extracted_assets/Texture2D/` liegen 1.605 echte PNGs, benannt nach
 * Unity-PathID. Über das `water`-Material (`extracted_assets/Material/`,
 * enthält Klarnamen UND die PathIDs seiner Textur-Slots) ließen sie sich
 * eindeutig zuordnen — siehe `tools/recover-textures.mjs`. Wir benutzen
 * jetzt die ECHTEN Texturen:
 *   _FoamTex       → water_foam_real.png        (256², Graustufen 6..166)
 *   _RandomFoamTex → water_randomfoam_real.png  (1024², dünn besetzt)
 *   _NormalFine    → water_normals_fine.png     (512², echte Fein-Map)
 * Nicht im Export enthalten: _CurlTex, _FoamHighTex, _BubbleTexture —
 * deren Aufgaben werden unten aus den vorhandenen Texturen ersetzt.
 *
 * ── Durchsicht: Refraktion statt Alpha ──────────────────────────────
 * Das Wasser wird OPAK gerendert (`_SrcBlend` One / `_DstBlend` Zero /
 * `_ZWrite` 1 im Original-Material) und mischt sich den Grund selbst aus
 * einem eigenen Szenenpass hinzu — siehe WaterRefraction.ts, dort steht
 * auch die Begründung. Solange die Einstellung "Wasserqualität" auf Aus
 * steht, gibt es kein Refraktionsbild; dann greift der alte Alpha-Pfad
 * (ALPHA_SHALLOW/ALPHA_DEEP) weiter.
 *
 * ── Tiefendaten ─────────────────────────────────────────────────────
 * Das Original liest die Wassertiefe pro Pixel aus dem Tiefenpuffer. Wir
 * backen sie stattdessen auf der CPU aus der echten Geländehöhe in das
 * Vertex-Attribut `aDepth` (Meter) — dieselbe Größe, nur früher
 * berechnet, und ohne Depth-Prepass über die gesamte Geometrie. Das ist
 * auch der Grund, warum wir den Depth-Renderer NICHT brauchen, den der
 * Babylon-Playground UNGKGD dafür aufzieht: die Tiefe liegt bei uns
 * bereits als Vertex-Attribut vor, es bleibt bei EINEM Zusatzpass.
 *
 * Nebenbefund aus dem Original: dort ist `_depth` nur an den VIER Ecken
 * der Zone bekannt (`Heightmap.cs:350-357`) und wird über 64 m bilinear
 * interpoliert. Unser `aDepth` je Vertex ist feiner als das Original —
 * Schaum- und Farbkanten sitzen bei uns also eher zu scharf als zu weich.
 *
 * Injektionspunkt des Schaums ist CUSTOM_FRAGMENT_BEFORE_FOG, nicht
 * ..._BEFORE_FRAGCOLOR: in default.fragment steht `#include<fogFragment>`
 * vor BEFORE_FRAGCOLOR (Zeile 305 vs. 317); danach addierter Schaum
 * bekäme keinen Nebel ab und stäche in der Ferne hell heraus.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Vector4 } from '@babylonjs/core/Maths/math';
import { WATER_LEVEL } from '@wov/shared';
import { SKY_GRADIENT_GLSL } from './ValheimSky';
import { WAVE_GLSL } from './WaterWave';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

const TEX_BASE = '/assets/textures/';

/**
 * Fallback-Windstärke, bis der WeatherManager den echten Wert liefert
 * (er entsteht erst, wenn die Welt steht). Danach überschreiben die
 * Statics unten — siehe WaterPlugin.windIntensity.
 */
const WIND_INTENSITY = 0.75;
// Die Wellenformel selbst (samt WAVE_DEPTH_SCALE und WAVE_MEAN_OFFSET)
// steht in WaterWave.ts — sie wird mit dem Clutter geteilt, damit
// Seerosen und Schilf auf genau der Welle liegen, die hier gezeichnet
// wird. Siehe dort.
// ── Werte aus dem echten `water`-Material ───────────────────────────
// Ausgelesen aus extracted_assets/Material (m_Floats/m_Colors des
// Materials mit m_Name "water"). Vorher standen hier geschätzte Werte.
/** `_FoamDepth` — Wassertiefe (m), bis zu der Ufer-Schaum entsteht.
 *  0,2 m ist ein SEHR schmaler Saum; mit meinem vorherigen Schätzwert
 *  0,55 legte sich der Schaum flächig übers Flachwasser. */
const FOAM_DEPTH = 0.2;
/** `_DepthFade` — Tiefe (m), über die Farbe und Deckkraft von flach nach
 *  tief laufen. */
const DEPTH_FADE = 15;
/** `_FoamColor` — kein reines Weiß, sondern neutrales Hellgrau. */
const FOAM_COLOR = [0.838, 0.838, 0.838] as const;
/** `_ColorBottomShallow` — Farbe über flachem Grund (olivsandig, das ist
 *  der "man sieht den Sand durchs Wasser"-Ton). */
const COLOR_SHALLOW = [0.196, 0.176, 0.106] as const;
/** `_ColorBottom` — Farbe über tiefem Grund. */
const COLOR_DEEP = [0.098, 0.196, 0.169] as const;
/**
 * `_ColorTop` — die Farbe der Wasserfläche selbst, sobald der Grund nicht
 * mehr durchscheint. Das ist der helle Grünton, der Valheim-Meer ausmacht.
 * Er stand bisher ungenutzt im Material: ohne Refraktion gab es keinen
 * Punkt, an dem "Grund" und "Wasserkörper" getrennt gewesen wären.
 */
const COLOR_TOP = [0.315, 0.524, 0.361] as const;
/**
 * Stärke des Sonnenglitzerns.
 *
 * Der Exponent im Shader ist von 180 auf 400 gestiegen, der Glanzfleck
 * also deutlich schmaler; ohne Nachziehen der Stärke wäre er zu schwach.
 * Zugleich ist der Term jetzt Fresnel-gewichtet und nachts gesperrt, kann
 * also nicht mehr flächig aufhellen. Das ist der Stellhebel, falls die
 * Bloom-Schwelle (0.7 in PostProcessing.ts) unangenehm oft anspricht.
 */
const GLITTER_STRENGTH = 1.2;
/**
 * Wie stark die direkte Sonne die Wassersäule aufhellt (0..1).
 *
 * Abgestimmt, nicht aus dem Original gelesen — der Wassershader liegt im
 * Export nur als 0-Byte-Datei vor, die Mischung ist also nicht
 * rekonstruierbar. Voll gewichtet (1.0) kippt die Farbe: die Sonnenfarbe
 * ist warm und nimmt der Fläche das Blau, gemessen stieg der
 * Grünüberschuss bei Mittag von +10 auf +47. Ganz ohne Sonnenanteil
 * verschwindet dagegen der Helligkeitsunterschied zwischen Mittag und
 * Nacht fast, weil das Ambient über den Tag nur um Faktor 1,3 schwankt.
 */
const SONNE_ANTEIL = 0.25;
/**
 * Farbstich auf die Wasserkörperfarben — BEWUSSTE ABWEICHUNG VOM ORIGINAL.
 *
 * Valheims Werte sind grün: `_ColorTop` (0.315, 0.524, 0.361) hat 1,45-mal
 * so viel Grün wie Blau, `_ColorBottom` (0.098, 0.196, 0.169) ähnlich.
 * Solange sie unverändert die Nahfarbe bestimmen, BLEIBT die Fläche
 * türkisgrün — nachgemessen an einer Seeposition, Blick übers Wasser bei
 * Mittag, Wasserpixel nach Bildhöhe getrennt:
 *
 *   nah      RGB (10,  67,  42)   Blau − Grün = −25
 *   mittel   RGB (31, 112, 130)   Blau − Grün = +18
 *   fern     RGB (46, 129, 174)   Blau − Grün = +45
 *
 * Zum Horizont hin trägt die Himmelsspiegelung das Bild ins Blaue, nah
 * dagegen dominiert die Materialfarbe — und der Nahbereich füllt den
 * Grossteil des Blickfelds. Dieser Faktor hebt Blau an und nimmt Grün
 * etwas zurück, sodass Blau im Wasserkörper überwiegt.
 *
 * Er ist ausdrücklich Geschmack, keine Rekonstruktion: auf (1, 1, 1)
 * gesetzt rendert wieder exakt das Original.
 */
const WASSER_STICH: readonly [number, number, number] = [1.0, 0.85, 1.45];
/**
 * Kachelgrösse der beiden Normal-Ebenen, als Kehrwert in Metern:
 * 0.045 ⇒ ~22 m, 0.22 ⇒ ~4,5 m.
 *
 * WELTBEZOGEN (vPositionW.xz), nicht über die Mesh-UV. Vorher hing die
 * grobe Map als bumpTexture mit uScale = 48 am Material, und weil
 * Mesh.CreateGround die UV 0..1 über die ganze Fläche legt, ergab das
 * 10,7 m Kachelung auf dem 512-m-Nahwasser und 42,7 m auf dem 2048-m-
 * Fernwasser. Dieselbe Textur in zwei Grössen, mit sichtbarem Bruch an
 * der Grenze — ein Teil dessen, was als "aufgesetzter Wellenlayer" zu
 * sehen war.
 */
const NORMAL_SCALE = 0.045;
const NORMAL_FINE_SCALE = 0.22;
/**
 * Stärke der beiden Normal-Ebenen. Entspricht in der Grössenordnung dem,
 * was vorher `bumpTexture.level = 0.7` und der feste Faktor 0.35 der
 * Fein-Map geleistet haben — nur wird beides jetzt zusätzlich mit der
 * Wassertiefe und der Kameradistanz gedämpft (siehe wDamp im Shader).
 */
const NORMAL_STRENGTH = 0.3;
const NORMAL_FINE_STRENGTH = 0.18;
/**
 * Deckkraft flach → tief. Nur noch der FALLBACK für "Wasserqualität: Aus" —
 * ohne Refraktionsbild bleibt Alpha-Blending die einzige Möglichkeit,
 * überhaupt etwas durchscheinen zu lassen. Das Original selbst mischt
 * nicht per Alpha, siehe WaterRefraction.ts.
 */
const ALPHA_SHALLOW = 0.16;
const ALPHA_DEEP = 0.88;
/** `_RefractionScale` / `_RefractionMax` — Stärke und Deckel der
 *  Bild-Verzerrung durch die Wasseroberfläche, in Bildschirm-UV. */
const REFRACTION_SCALE = 0.1;
const REFRACTION_MAX = 0.01;
/**
 * Entfernungsband, in dem das Nahwasser zum Fernwasser-Look überblendet.
 *
 * Im Original sind das zwei Materialien mit demselben Shader: `water`
 * (`_Tess` 4, `_VisibleMaxDistance` 120) und `water_lod` (`_Tess` 1,
 * `_IsLod` 1, `_visibleMinDistance` 100, `_LodHideDistance` 120). Der
 * entscheidende Unterschied steht in den Farben: bei `water_lod` sind
 * `_ColorTop` und `_ColorBottom` IDENTISCH — das Fernmeer hat per
 * Konstruktion keinen Tiefenverlauf und ist einheitlich blickdicht.
 * Genau deshalb "beginnt das Meer" dort optisch bei ~120 m und nicht bei
 * einer bestimmten Wassertiefe.
 */
const LOD_BLEND_START = 100;
const LOD_BLEND_END = 120;
/** `water_lod._ColorTop` (= `_ColorBottom` desselben Materials). Auch das
 *  Fernwasser-Mesh in Terrain.ts färbt sich danach. */
export const COLOR_LOD = [0.098, 0.196, 0.169] as const;

export class WaterPlugin extends MaterialPluginBase {
  /**
   * Echter Wind aus dem WeatherManager (`GetWindIntensity`/`GetWindDir`
   * im Original). WaterVolume.CalcWave nimmt `wind.w` als Amplitude und
   * `wind.xz` als Richtung der ERSTEN Oktave — die übrigen neun haben im
   * Original feste Richtungen. Genau so wird es hier gefüttert; vorher
   * standen beide auf Konstanten, das Wasser war also wetterunabhängig.
   */
  static windIntensity = WIND_INTENSITY;
  static windDirX = 1;
  static windDirZ = 0;
  /** Zweiter Windvektor + Blend. CalcWave rechnet die Welle für beide und
   *  mischt die HÖHEN (Mathf.LerpUnclamped) — genau das macht der Shader. */
  static windIntensity2 = WIND_INTENSITY;
  static windDir2X = 1;
  static windDir2Z = 0;
  static windAlpha = 0;
  /**
   * Himmel und Sonne für Spiegelung und Glitzern. Von aussen je Frame
   * gesetzt (main.ts aus `lighting.sky.reflectState`), analog zu
   * TerrainManager.syncLighting — Babylons Fragment-Shader stellt an
   * diesem Injektionspunkt weder Himmelsfarben noch Lichtrichtung als
   * Varying bereit.
   *
   * Die drei Himmelsfarben speisen `vhSkyGradient` (ValheimSky.ts), das
   * an der SPIEGELRICHTUNG ausgewertet wird. Vorher stand hier eine
   * einzelne Farbe, die stumpf auf `fogColorSun` gesetzt wurde — also
   * immer den Sonnenton zeigte, egal wohin man blickt. Das war der
   * Hauptanteil der gemeldeten "braunen Spiegelungen".
   *
   * Als Instanzen statt als Einzelwerte: sie werden je Frame per
   * `copyFrom` beschrieben, das spart die Allokation.
   */
  static readonly skyHorizon = new Color3(0.55, 0.7, 0.85);
  static readonly skyZenith = new Color3(0.25, 0.39, 0.68);
  static readonly skySunGlow = new Color3(0.85, 0.9, 0.96);
  /** Echte Sonnenfarbe fürs Glitzern (`lighting.sun.diffuse`). */
  static readonly sunColor = new Color3(1, 0.97, 0.9);
  /**
   * Umgebungslicht (`lighting.ambient.diffuse`) und Sonnenstärke
   * (`lighting.sun.intensity`) — zusammen das Licht, unter dem die
   * Wassersäule steht. Im Original macht EnvMan dasselbe global:
   * `Shader.SetGlobalColor(s_sunColor, m_dirLight.color * intensity)` und
   * `s_ambientColor = RenderSettings.ambientLight` (EnvMan.cs:757/758).
   */
  static readonly ambient = new Color3(0.46, 0.57, 0.71);
  static sunIntensity = 1;
  /** 0 = voller Tag, 1 = volle Nacht. Sperrt das Glitzern nach Sonnenuntergang. */
  static night = 0;
  /** Lichtausbreitungsrichtung (zeigt VON der Sonne WEG). */
  static sunX = 0;
  static sunY = -1;
  static sunZ = 0;
  /** Globale Wasserzeit in Sekunden — einmal pro Frame setzen. */
  static time = 0;
  /**
   * Das Refraktionsbild aus WaterRefraction (Szene ohne Wasser/Clutter).
   * `null` bei "Wasserqualität: Aus" — dann bindet das Plugin die
   * 1×1-Ersatztextur und der Shader fällt auf Alpha-Blending zurück.
   *
   * Statisch wie die übrigen Felder hier: das Plugin hängt an zwei
   * Materialien (Nah- und Fernwasser) und beide sollen dieselbe Textur
   * sehen, ohne dass der Aufrufer sie einzeln durchreichen muss.
   */
  static refraction: BaseTexture | null = null;
  /**
   * Grundhöhe je Quadratmeter (WaterDepthMap). Ersetzt im FRAGMENT das
   * interpolierte Vertex-Attribut `aDepth`; im Vertexshader bleibt aDepth
   * die Quelle für die Wellenamplitude, dort sind 4 m mehr als genug.
   */
  static groundMap: BaseTexture | null = null;
  /** (originX, originZ, 1/Kachelgrösse, 0) — siehe WaterDepthMap.info. */
  static groundInfo: Vector4 = new Vector4(0, 0, 1 / 512, 0);
  /**
   * Würfelkarte des Himmels (ValheimSky.probe) für die Spiegelung. Bis
   * ihr erster Durchlauf fertig ist — und wenn sie fehlt — bleibt es beim
   * analytischen Verlauf.
   */
  static skyProbe: BaseTexture | null = null;

  private foamTex!: Texture;
  private foamHighTex!: Texture;
  private normalTex!: Texture;
  private normalFineTex!: Texture;
  /**
   * Ersatz für `refraction`, solange keine Refraktion läuft. Ein Sampler
   * MUSS gebunden sein, auch wenn der Shader ihn nicht ausliest — sonst
   * greift der Treiber auf eine ungültige Texture-Unit zu. 1×1 statt eines
   * Defines, weil `scene.blockMaterialDirtyMechanism` (main.ts) zur
   * Laufzeit ohnehin keine Shader-Neuübersetzung durchlässt.
   */
  private readonly leer: RawTexture;
  /**
   * Ersatz für die Himmels-Würfelkarte. Ein samplerCube MUSS gebunden
   * sein, auch wenn der Shader ihn im jeweiligen Zweig nicht ausliest —
   * sonst greift der Treiber auf eine ungültige Texture-Unit zu. Gleiches
   * Muster wie `leer` für die Refraktion.
   */
  private readonly leerCube: RawCubeTexture;

  constructor(material: Material, scene: Scene) {
    super(material, 'ValheimWater', 220, { VALHEIMWATER: true }, true, true);
    const load = (file: string): Texture => {
      const t = new Texture(TEX_BASE + file, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
      t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
      return t;
    };
    // Echte Original-Texturen, über das `water`-Material zurückgeholt
    // (siehe Kopfkommentar + tools/recover-textures.mjs)
    this.foamTex = load('water_foam_real.png');
    this.foamHighTex = load('water_randomfoam_real.png');
    // _Normal (DXT5nm-gepackt, wird im Shader entpackt) und _NormalFine.
    this.normalTex = load('water_normals_real.png');
    this.normalFineTex = load('water_normals_fine.png');
    // Anisotropie ist bei einer horizontalen Fläche der EINZIGE Filter,
    // der bei streifendem Blick noch etwas ausrichtet: trilinear allein
    // matscht das Meer ab ~100 m zu einer Fläche und flimmert bei 30 m
    // trotzdem.
    this.normalTex.anisotropicFilteringLevel = 8;
    this.normalFineTex.anisotropicFilteringLevel = 8;
    this.leer = RawTexture.CreateRGBATexture(
      new Uint8Array([0, 0, 0, 255]),
      1,
      1,
      scene,
      /* generateMipMaps */ false,
      /* invertY */ false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE
    );
    this.leerCube = new RawCubeTexture(
      scene,
      Array.from({ length: 6 }, () => new Uint8Array([0, 0, 0, 255])),
      1,
      Constants.TEXTUREFORMAT_RGBA,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
      /* generateMipMaps */ false,
      /* invertY */ false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE
    );
  }

  get isEnabled(): boolean {
    return true;
  }

  isReadyForSubMesh(
    _defines: MaterialDefines,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): boolean {
    return (
      this.foamTex.isReady() &&
      this.foamHighTex.isReady() &&
      this.normalTex.isReady() &&
      this.normalFineTex.isReady()
    );
  }

  prepareDefines(): void {
    // immer aktiv für das Material, das es dekoriert
  }

  getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push('aDepth');
  }

  getSamplers(samplers: string[]): void {
    samplers.push(
      'waterFoamTex',
      'waterFoamHighTex',
      'waterNormalTex',
      'waterNormalFine',
      'waterRefractionTex',
      'waterGroundTex',
      'waterSkyProbe'
    );
  }

  /**
   * UBO-Layout.
   *
   * ⚠ Zwei harte Regeln, beide aus einem echten Fehlerbild heraus:
   *
   * 1. **Nur was sich zur Laufzeit ändert, gehört hier hinein.** Alles
   *    andere steht als GLSL-`const` im Shader (siehe KONSTANTEN in
   *    CUSTOM_*_DEFINITIONS). Vorher schrieb `bindForSubMesh` sieben
   *    Einträge jeden Frame aus unveränderlichen Modulkonstanten
   *    desselben Files — reine Puffergrösse ohne Gegenwert.
   *
   * 2. **Nach std140 sortieren: erst vec3/vec4, dann vec2, dann float.**
   *    `UniformBuffer.addUniform` erledigt das Padding zwar selbst, aber
   *    in Deklarationsreihenfolge. Sortiert entstehen erst gar keine
   *    Padding-Löcher.
   *
   * Zur Einordnung, weil hier früher das Gegenteil stand: die Meldung
   * "glDrawElements: It is undefined behaviour to have a used but unbound
   * uniform buffer" kommt NICHT vom Wasser.
   *
   * Nachgemessen am 2026-07-31: alle Meshgruppen einzeln stummgeschaltet,
   * je ein Frame gerendert und `gl.getError()` direkt danach abgefragt —
   * im eingeschwungenen Zustand tritt sie NIE auf, auch nicht mit allem
   * aktiv. Sie erscheint genau einmal je Ladevorgang und verschwindet
   * danach; Babylon übersetzt den betroffenen Effect neu, sichtbare
   * Auswirkungen hat sie keine.
   *
   * Zwei Hypothesen dazu wurden geprüft und BEIDE widerlegt:
   *   1. "zu viele UBO-Einträge" — das Aufräumen von 16 auf 9 Einträge
   *      hat an der Meldung nichts geändert.
   *   2. "Plugins werden angehängt, während
   *      scene.blockMaterialDirtyMechanism gesetzt ist" (AssetManager
   *      hängt WindPlugin beim asynchronen Nachladen an, GrassClutter
   *      ebenso) — das Anhängen mit kurz aufgehobener Sperre änderte
   *      die Zahl der Meldungen ebenfalls nicht.
   *
   * Wer hier weitersucht, fängt sinnvollerweise bei den Draws der
   * Ladephase an, nicht beim Wasser.
   *
   * Sollte das Budget je wirklich knapp werden, ist die saubere
   * Eskalation ein eigener benannter Puffer über
   * `getUniformBuffersNames()` — nicht das Zurückstopfen von Konstanten.
   */
  getUniforms() {
    return {
      ubo: [
        // ── vec4 zuerst ──────────────────────────────────────────────
        // x = Kehrwert der Bildbreite, y = der Bildhöhe (gl_FragCoord → UV),
        // z = 1 wenn ein Refraktionsbild vorliegt, sonst 0,
        // w = Nachtanteil 0..1.
        //
        // Nacht steckt bewusst hier im freien vierten Kanal statt als
        // eigener Eintrag: ein `float` bekäme in std140 ohnehin ein
        // eigenes 16-Byte-Fach, der Kanal war frei.
        { name: 'waterScreenRefr', size: 4, type: 'vec4' },
        // (originX, originZ, 1/Kachelgrösse, 0) der Grundhöhen-Textur.
        { name: 'waterGroundInfo', size: 4, type: 'vec4' },
        // ── dann vec3 ────────────────────────────────────────────────
        // Die drei Himmelsfarben für vhSkyGradient (ValheimSky.ts).
        { name: 'waterSkyHorizon', size: 3, type: 'vec3' },
        { name: 'waterSkyZenith', size: 3, type: 'vec3' },
        { name: 'waterSkySunGlow', size: 3, type: 'vec3' },
        { name: 'waterSunColor', size: 3, type: 'vec3' },
        { name: 'waterAmbient', size: 3, type: 'vec3' },
        { name: 'waterSunIntensity', size: 1, type: 'float' },
        { name: 'waterSunDir', size: 3, type: 'vec3' },
        // ── dann vec2 ────────────────────────────────────────────────
        // Windrichtung in XZ (Oktave 0), wie wind.xz in CalcWave.
        { name: 'waterWindDir', size: 2, type: 'vec2' },
        { name: 'waterWindDir2', size: 2, type: 'vec2' },
        // ── dann float ───────────────────────────────────────────────
        { name: 'waterTime', size: 1, type: 'float' },
        { name: 'waterWind', size: 1, type: 'float' },
        { name: 'waterWind2', size: 1, type: 'float' },
        { name: 'waterWindAlpha', size: 1, type: 'float' },
      ],
    };
  }

  bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    // Reihenfolge wie in getUniforms() deklariert (std140-sortiert).
    //
    // getRenderWidth() liefert die Größe des GERADE gebundenen Ziels —
    // beim Zeichnen des Wassers also die des Hauptbildes, auch wenn
    // Post-Processing in ein eigenes Target rendert. Genau das braucht
    // gl_FragCoord.
    const refr = WaterPlugin.refraction;
    const w = engine.getRenderWidth() || 1;
    const h = engine.getRenderHeight() || 1;
    uniformBuffer.updateFloat4('waterScreenRefr', 1 / w, 1 / h, refr ? 1 : 0, WaterPlugin.night);
    const gi = WaterPlugin.groundInfo;
    const probe = WaterPlugin.skyProbe;
    // w: 1 = Würfelkarte benutzen, 0 = analytischer Verlauf. Der freie
    // vierte Kanal spart einen eigenen UBO-Eintrag (ein float bekäme in
    // std140 ohnehin ein volles 16-Byte-Fach).
    uniformBuffer.updateFloat4('waterGroundInfo', gi.x, gi.y, gi.z, probe?.isReady() ? 1 : 0);
    const himmel = WaterPlugin.skyHorizon;
    const zenit = WaterPlugin.skyZenith;
    const glow = WaterPlugin.skySunGlow;
    const sonne = WaterPlugin.sunColor;
    uniformBuffer.updateFloat3('waterSkyHorizon', himmel.r, himmel.g, himmel.b);
    uniformBuffer.updateFloat3('waterSkyZenith', zenit.r, zenit.g, zenit.b);
    uniformBuffer.updateFloat3('waterSkySunGlow', glow.r, glow.g, glow.b);
    uniformBuffer.updateFloat3('waterSunColor', sonne.r, sonne.g, sonne.b);
    const amb = WaterPlugin.ambient;
    uniformBuffer.updateFloat3('waterAmbient', amb.r, amb.g, amb.b);
    uniformBuffer.updateFloat('waterSunIntensity', WaterPlugin.sunIntensity);
    uniformBuffer.updateFloat3('waterSunDir', WaterPlugin.sunX, WaterPlugin.sunY, WaterPlugin.sunZ);
    uniformBuffer.updateFloat2('waterWindDir', WaterPlugin.windDirX, WaterPlugin.windDirZ);
    uniformBuffer.updateFloat2('waterWindDir2', WaterPlugin.windDir2X, WaterPlugin.windDir2Z);
    uniformBuffer.updateFloat('waterTime', WaterPlugin.time);
    uniformBuffer.updateFloat('waterWind', WaterPlugin.windIntensity);
    uniformBuffer.updateFloat('waterWind2', WaterPlugin.windIntensity2);
    uniformBuffer.updateFloat('waterWindAlpha', WaterPlugin.windAlpha);
    uniformBuffer.setTexture('waterFoamTex', this.foamTex);
    uniformBuffer.setTexture('waterFoamHighTex', this.foamHighTex);
    uniformBuffer.setTexture('waterNormalTex', this.normalTex);
    uniformBuffer.setTexture('waterNormalFine', this.normalFineTex);
    uniformBuffer.setTexture('waterRefractionTex', refr ?? this.leer);
    uniformBuffer.setTexture('waterGroundTex', WaterPlugin.groundMap ?? this.leer);
    uniformBuffer.setTexture('waterSkyProbe', probe ?? this.leerCube);
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: /* glsl */ `
          attribute float aDepth;
          varying float vWaveY;

          ${WAVE_GLSL}
        `,
        CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `
        {
          // Weltposition VOR der Verschiebung. Für das Wasser ist 'world'
          // die echte Matrix des Meshs (es wird pro Zone versetzt), nicht
          // wie beim Clutter die Identität.
          vec3 wpos = (world * vec4(positionUpdated, 1.0)).xyz;
          float depth01 = clamp(aDepth / WATER_DEPTH_SCALE, 0.0, 1.0);
          // WaterVolume.CalcWave: zweimal rechnen, die HÖHEN mischen.
          float waveY = mix(
            wCalcWave(wpos.xz, depth01, waterTime, waterWind, waterWindDir),
            wCalcWave(wpos.xz, depth01, waterTime, waterWind2, waterWindDir2),
            waterWindAlpha
          );
          // Das Mesh ist unrotiert ⇒ lokales +Y entspricht Welt-+Y.
          positionUpdated.y += waveY;
          vWaveY = waveY;
        }
        `,
      };
    }
    return {
      // Sampler müssen von Hand deklariert werden: getSamplers() meldet sie
      // nur der JS-seitigen Bind-Liste, erzeugt aber keine GLSL-Deklaration
      // (anders als getUniforms(), das den UBO-Block automatisch schreibt).
      CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
        varying float vWaveY;

        // Himmelsverlauf, geteilt mit der Kuppel — siehe ValheimSky.ts.
        ${SKY_GRADIENT_GLSL}

        uniform sampler2D waterFoamTex;
        uniform sampler2D waterFoamHighTex;
        uniform sampler2D waterNormalTex;
        uniform sampler2D waterNormalFine;
        uniform sampler2D waterGroundTex;
        uniform samplerCube waterSkyProbe;
        uniform sampler2D waterRefractionTex;

        // KONSTANTEN aus dem echten \`water\`/\`water_lod\`-Material.
        // Bewusst als const statt als UBO-Einträge, siehe getUniforms().
        const vec3 WATER_TOP_COL = vec3(${COLOR_TOP.join(', ')});
        const vec3 WATER_LOD_COL = vec3(${COLOR_LOD.join(', ')});
        const float WATER_REFR_SCALE = ${REFRACTION_SCALE.toFixed(4)};
        const float WATER_REFR_MAX = ${REFRACTION_MAX.toFixed(4)};
        const float WATER_LOD_START = ${LOD_BLEND_START.toFixed(1)};
        const float WATER_LOD_END = ${LOD_BLEND_END.toFixed(1)};
        const float WATER_FOAM_DEPTH = ${FOAM_DEPTH.toFixed(4)};
        const float WATER_DEPTH_FADE = ${DEPTH_FADE.toFixed(1)};
        const vec3 WATER_FOAM_COL = vec3(${FOAM_COLOR.join(', ')});
        const vec3 WATER_SHALLOW_COL = vec3(${COLOR_SHALLOW.join(', ')});
        const vec3 WATER_DEEP_COL = vec3(${COLOR_DEEP.join(', ')});
        const float WATER_ALPHA_SHALLOW = ${ALPHA_SHALLOW.toFixed(4)};
        const float WATER_ALPHA_DEEP = ${ALPHA_DEEP.toFixed(4)};
        const float WATER_GLITTER = ${GLITTER_STRENGTH.toFixed(2)};
        const float WATER_SONNE_ANTEIL = ${SONNE_ANTEIL.toFixed(2)};
        const vec3 WATER_STICH = vec3(${WASSER_STICH.join(', ')});
        const float WATER_N_SCALE = ${NORMAL_SCALE.toFixed(4)};
        const float WATER_NF_SCALE = ${NORMAL_FINE_SCALE.toFixed(4)};
        const float WATER_N_STR = ${NORMAL_STRENGTH.toFixed(3)};
        const float WATER_NF_STR = ${NORMAL_FINE_STRENGTH.toFixed(3)};
        // Wasserspiegel und Ersatztiefe ausserhalb der Grundhöhen-Kachel.
        // WATER_LEVEL kommt aus shared/worldgen/Heightmap.ts — dort bleibt
        // die einzige Definition.
        const float WATER_LEVEL_C = ${WATER_LEVEL.toFixed(1)};
        const float WATER_FERN_TIEFE = 40.0;
      `,
      // Feines Wellen-Detail (_NormalFine). Die grobe Normal-Map hängt
      // bereits als bumpTexture am Material. Die Störung wird direkt in
      // Weltachsen addiert (x→x, y→z), was nur gilt, weil die Fläche
      // praktisch horizontal ist (Normale ≈ +Y).
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: /* glsl */ `
        // BEWUSST OHNE eigenen Block-Scope: wEff und wDist werden weiter
        // unten in CUSTOM_FRAGMENT_BEFORE_FOG noch gebraucht, und beide
        // Injektionspunkte liegen in derselben main().

        // ── Wassersäule, PER PIXEL ───────────────────────────────────
        // Grundhöhe aus der 1-m-Kachel (WaterDepthMap) statt aus dem
        // über 4 m interpolierten Vertex-Attribut. Ausserhalb der Kachel
        // gilt "tief" — dort steht ohnehin nur der Fernwasser-Ring.
        //
        // aDepth ist damit nicht überflüssig: im Vertexshader steuert es
        // weiter die Wellenamplitude, und dort sind 4 m reichlich, weil
        // die Amplitude über 10 m hochläuft.
        //
        // Effektive Tiefe = Grundtiefe + aktueller Wellenhub. Dadurch
        // wandert die Schaumlinie mit der Brandung, statt starr zu sein.
        vec2 wGuv = (vPositionW.xz - waterGroundInfo.xy + 0.5) * waterGroundInfo.z;
        float wDrin = step(0.0, wGuv.x) * step(wGuv.x, 1.0)
                    * step(0.0, wGuv.y) * step(wGuv.y, 1.0);
        float wGrund = texture2D(waterGroundTex, clamp(wGuv, 0.0, 1.0)).r;
        float wTiefe = mix(WATER_FERN_TIEFE, WATER_LEVEL_C - wGrund, wDrin);
        float wEff = wTiefe + vWaveY;
        float wDist = distance(vEyePosition.xyz, vPositionW);

        // ── Wo steht überhaupt Wasser? ───────────────────────────────
        // wEff ist die tatsächliche Wassersäule über dem Grund. Sie wird
        // negativ, wo ein Wellental tiefer liegt als der Grund — dort ist
        // die Fläche trockengefallen und darf nicht gezeichnet werden.
        // Ohne dieses discard blieb dort eine Fläche stehen, die (weil
        // der Tiefen-Fade bei 0 nichts abdeckt) den nackten Sandgrund
        // zeigte: die "braunen Wellen".
        //
        // Dass das überhaupt vorkommt, ist kein Portierungsfehler.
        // CalcWave nachgerechnet (200k Proben, Wind 0,46 wie bei klarem
        // Wetter): Median -0,97 m, p1..p99 von -2,06 bis +2,86 m. Die
        // Formel senkt den Wasserspiegel im Mittel also um rund einen
        // Meter — Oktavenhöhen, TrochSin und die windMin/windMax-
        // Skalierung stimmen dabei exakt mit dem Original überein.
        //
        // Steht jetzt VOR der Beleuchtung statt danach: das spart für
        // trockengefallene Pixel den kompletten Lichtdurchlauf.
        //
        // Die Distanzbedingung ist Pflicht: auf dem Fernwasser-Ring ist
        // aDepth konstant, ein Wellental dort dürfte kein Loch zum
        // Himmel reissen.
        if (wEff <= 0.0 && wDist < WATER_LOD_END) discard;

        // ── Oberflächennormale ───────────────────────────────────────
        // Beide Normal-Ebenen liegen jetzt HIER statt als bumpTexture am
        // StandardMaterial. Drei Gründe, jeder für sich ausreichend:
        //
        // 1. Dämpfung. Als bumpTexture wirkte die Störung ungedämpft —
        //    knöcheltiefes Wasser spiegelte wie die Tiefsee (vom Nutzer
        //    gemeldet: "die Transparenz ist kaputt"), und in der Ferne
        //    alias'te das Kachelmuster zu einem sichtbar aufgesetzten
        //    Layer ("es sieht aus als wenn ein Wellenlayer darüber
        //    liegt").
        //
        // 2. Welt-UV. Mesh.CreateGround legt UV 0..1 über die ganze
        //    Fläche, uScale = 48 bedeutete deshalb 512/48 = 10,7 m
        //    Kachelung auf dem Nahwasser, aber 2048/48 = 42,7 m auf dem
        //    Fernwasser — dieselbe Textur in vierfach unterschiedlicher
        //    Grösse, mit sichtbarem Bruch an der Grenze. Über
        //    vPositionW.xz ist die Kachelgrösse überall gleich.
        //
        // 3. Packung. water_normals_real.png ist die ECHTE _Normal aus
        //    dem Spiel, aber Unity-DXT5nm-gepackt: (1, y, y, x), X liegt
        //    im ALPHA-Kanal. Gemessen über alle 262.144 Pixel ist
        //    max|G-B| = 0, und x²+y² <= 1 gilt für (A,G) in 2000 von
        //    2000 Proben, für (R,G) nur in 760. Als bumpTexture liest
        //    Babylon (1, y, y) — Unsinn. Genau deshalb hing dort bisher
        //    die generische water_normals.png.
        float wShore = smoothstep(0.0, 2.0, wEff);                  // flach → glatt
        float wFar = 1.0 - 0.75 * smoothstep(40.0, 160.0, wDist);   // fern → ruhig
        float wDamp = wShore * wFar;

        vec4 wN0 = texture2D(waterNormalTex, vPositionW.xz * WATER_N_SCALE
                             + vec2(waterTime * 0.015, waterTime * 0.011));
        vec2 wSlope = (vec2(wN0.a, wN0.g) * 2.0 - 1.0) * WATER_N_STR;
        vec3 wN1 = texture2D(waterNormalFine, vPositionW.xz * WATER_NF_SCALE
                             + vec2(waterTime * 0.026, waterTime * -0.019)).xyz * 2.0 - 1.0;
        wSlope += wN1.xy * WATER_NF_STR;
        // Weltachsen statt Tangentenraum: gilt, weil die Fläche unrotiert
        // und praktisch horizontal ist (Geometrienormale exakt +Y).
        normalW = normalize(vec3(wSlope.x * wDamp, 1.0, wSlope.y * wDamp));
      `,
      CUSTOM_FRAGMENT_BEFORE_FOG: /* glsl */ `
        {
          float eff = wEff;

          // Tiefen-Verlauf über _DepthFade (15 m). 0 = Wasserkante
          // (Grund unverfälscht sichtbar), 1 = ab 15 m Säule (Grund
          // vollständig zu). Bewusst auf die effektive Tiefe: unter
          // einem Wellenberg steht mehr Wasser und man sieht weniger
          // Grund — genau das lässt die Brandung leben.
          float depthT = clamp(eff / WATER_DEPTH_FADE, 0.0, 1.0);

          // ── Fresnel ────────────────────────────────────────────────
          // Der entscheidende Punkt fürs "am Strand ins Wasser schauen":
          // Ohne ihn spiegelt die Fläche unter JEDEM Blickwinkel gleich
          // stark, und von oben sah man Wolken statt Sandgrund.
          //
          // Schräg drauf (Blick zum Horizont) → Spiegelung.
          // Steil von oben                    → Durchsicht.
          // Schlick-Näherung mit F0 = 0.02 (Wasser gegen Luft).
          vec3 viewDirW = normalize(vEyePosition.xyz - vPositionW);
          vec3 nrm = normalize(normalW);
          float cosView = clamp(dot(viewDirW, nrm), 0.0, 1.0);
          float fresnel = 0.02 + 0.98 * pow(1.0 - cosView, 5.0);

          // ── Licht auf der Wassersäule ──────────────────────────────
          // Die Materialfarben (_ColorTop/_ColorBottom) sind ALBEDO, kein
          // fertiges Bild. Sie ungefiltert auszugeben hiess: Das Wasser
          // ignoriert die Tageszeit vollständig. Gemessen über die
          // Blickrichtungen bei Mittag gegen 22 Uhr — Helligkeit 45 zu 43,
          // in einer Richtung nachts sogar HELLER (44 zu 50). Es leuchtete
          // also taghell grün in eine dunkle Szene, und genau das war als
          // "gerade bei Nacht extrem" gemeldet.
          //
          // Im Original stellt EnvMan dem Wassershader dafür zwei globale
          // Werte bereit (EnvMan.cs:757/758): sunColor × Lichtstärke und
          // ambientColor. Dieselben zwei hier, mit der Flächennormale
          // gewichtet. Der Grund aus dem Refraktionsbild bleibt aussen
          // vor — der ist bereits beleuchtet gerendert.
          // Die direkte Sonne geht dabei nur schwach ein. Sie ist warm
          // (1.00, 0.77, 0.48) und drückt beim Multiplizieren genau den
          // Blaukanal weg: voll gewichtet stieg der Grünüberschuss der
          // Fläche bei Mittag von +10 auf +47. Was eine Wassersäule
          // durchleuchtet, ist ohnehin überwiegend diffuses Himmelslicht
          // — die Sonnenscheibe selbst zeigt sich als Glitzern, und das
          // hat weiter unten seinen eigenen Term. Der Restanteil hält den
          // Tag/Nacht-Kontrast, ohne die Farbe umzukippen.
          vec3 zurSonne = normalize(-waterSunDir);
          vec3 waterLicht = waterAmbient
                          + waterSunColor * waterSunIntensity
                            * max(dot(nrm, zurSonne), 0.0) * WATER_SONNE_ANTEIL;

          // ── Nah → Fern ─────────────────────────────────────────────
          // Im Original zwei Materialien, umgeschaltet über die
          // Kameradistanz (water bis 120 m, water_lod ab 100 m). Wir
          // haben nur EINE Nahwasserfläche, blenden aber im selben Band
          // auf denselben Look über — sonst entstünde eine sichtbare
          // Kante dort, wo unser eigener Fernwasser-Ring übernimmt.
          float lodT = smoothstep(WATER_LOD_START, WATER_LOD_END, wDist);

          // Einfärbung des Grundes durch die Wassersäule, zwischen den
          // echten Materialfarben _ColorBottomShallow und _ColorBottom.
          vec3 tint = mix(WATER_SHALLOW_COL, WATER_DEEP_COL, depthT);
          vec3 bodyCol;

          if (waterScreenRefr.z > 0.5) {
            // ── Refraktionspfad (entspricht dem Original) ────────────
            // Bildschirm-UV des aktuellen Pixels, versetzt um die
            // Wellenneigung. _RefractionScale skaliert, _RefractionMax
            // deckelt — beide sind bereits in Bildschirm-UV formuliert,
            // 0.01 heißt also "höchstens 1 % der Bildbreite".
            // Kein Y-Flip: Babylon rendert das Render-Target mit
            // derselben Projektion wie das Hauptbild, Texturzeile 0 liegt
            // also wie gl_FragCoord.y unten. (Ein testweise eingebauter
            // Flip verschob die Brechung sichtbar — die Kontrolle war der
            // Blick von oben ins Flachwasser: ohne Flip erscheint dort
            // der Sandgrund mit seinen Steinen an der richtigen Stelle.)
            vec2 sUV = gl_FragCoord.xy * waterScreenRefr.xy;
            vec2 off = clamp(nrm.xz * WATER_REFR_SCALE, -WATER_REFR_MAX, WATER_REFR_MAX);
            // Direkt an der Uferkante KEIN Versatz, sonst zieht der
            // Shader Strandpixel ins Wasser hinein (und umgekehrt), was
            // als flimmernder Saum sichtbar wird. Ab 1 m Tiefe voll.
            off *= clamp(eff, 0.0, 1.0) * (1.0 - lodT);
            vec3 grund = texture2D(waterRefractionTex, clamp(sUV + off, 0.0, 1.0)).rgb;
            // ── Absorption des Grundbildes, nach Beer-Lambert ───────
            // Kanalweise, und das ist hier auch richtig: Wasser schluckt
            // Rot zuerst, Blaugrün am längsten. Genau das macht den
            // Unterschied zwischen "Wasser über Sand" und "nassem Sand"
            // — und es ist der Grund, warum flaches Wasser noch Durchsicht
            // hat. Der Fehler lag nicht in dieser Kurve, sondern darin,
            // dasselbe (1 - T) auch als Gewicht der In-Streuung zu nehmen;
            // siehe unten bei "saeule".
            vec3 T = exp(-vec3(0.60, 0.22, 0.16) * eff);
            // Was ankommt: gedämpfter Grund + was die Wassersäule selbst
            // streut.
            //
            // Die In-Streuung ist _ColorTop (das Valheim-Grün) — NICHT
            // mehr eine Mischung, die bei geringer Tiefe gegen
            // _ColorBottomShallow läuft. Der Name sagt schon, was der
            // Wert ist: "Bottom Shallow" ist die Tönung des GRUNDES bei
            // wenig Wasser, nicht das Licht, das die Wassersäule streut.
            // Als In-Streuungsterm eingesetzt addierte er ein Braun
            // (0.196, 0.176, 0.106) in eine Gleichung, in der die
            // Absorption oben bereits vollständig abgebildet ist — und
            // zwar am stärksten genau dort, wo (1 - T) klein und der
            // Effekt am wenigsten gerechtfertigt ist.
            //
            // _ColorBottomShallow bleibt im Alpha-Fallback unten in
            // Gebrauch: dort gibt es kein gebrochenes Bild des Grundes,
            // das es tönen könnte, also übernimmt es die Rolle der
            // Gesamtfarbe.
            //
            // ── _ColorTop und _ColorBottom sind die ENDEN EINES
            //    TIEFENVERLAUFS ───────────────────────────────────────
            // Sie stehen nicht für "Oberfläche" gegen "Grund", sondern
            // für flaches gegen tiefes Wasser. Drei Belege, alle aus den
            // extrahierten Materialien:
            //
            //  1. Bei water_lod sind beide IDENTISCH (0.098, 0.196,
            //     0.169). Das ergibt nur dann Sinn, wenn sie die Enden
            //     eines Verlaufs sind — das Fernmeer hat keinen
            //     Tiefenverlauf, genau wie der Kommentar unten sagt.
            //  2. water_bottomplane folgt demselben Muster in Blau:
            //     Top (0.260, 0.419, 0.549) hell, Bottom (0.098, 0.154,
            //     0.196) dunkel. Top ist stets die HELLERE Farbe.
            //  3. _DepthFade (15 m) ist als "Tiefe, über die die Farbe
            //     von flach nach tief läuft" beschriftet — ein Verlauf
            //     braucht zwei Enden, und das sind diese beiden.
            //
            // Vorher stand _ColorTop allein als In-Streuung, war also die
            // Farbe des UNENDLICH TIEFEN Wassers (bei T → 0 bleibt genau
            // sie übrig). Damit lief das Meer mit zunehmender Tiefe ins
            // helle Grün statt ins dunkle Blaugrün. Gemessen am Ufer bei
            // Mittag: RGB (80, 115, 30) — Grünüberschuss +60 bei fast
            // keinem Blau, also Moosgrün statt Wasser. Verstärkt wird das
            // dadurch, dass (1 - T) im Rotkanal am größten ist: der
            // Streuterm bekommt dadurch zusätzlich einen Gelbstich.
            vec3 streu = mix(WATER_TOP_COL, WATER_DEEP_COL, depthT);
            // Wie viel des Blicks die Wassersäule selbst ausfüllt —
            // SKALAR, damit die Materialfarbe unverdreht bleibt. Die
            // kanalweise Transmission T oben gilt weiter für den GRUND
            // (Wasser schluckt Rot zuerst, das ist der Unterschied
            // zwischen "Wasser über Sand" und "nassem Sand"); sie als
            // Gewicht auch auf den Streuterm zu legen war der Fehler:
            // (1 - T) ist im Rotkanal am größten und hat die grüne
            // Wasserfarbe rotstichig gemacht.
            float saeule = 1.0 - exp(-eff / 4.0);
            bodyCol = grund * T + streu * WATER_STICH * waterLicht * saeule;
            // Opak wie das Original (_SrcBlend One / _DstBlend Zero).
            color.a = 1.0;
          } else {
            // ── Fallback "Wasserqualität: Aus" ──────────────────────
            // Ohne Refraktionsbild bleibt nur Alpha-Blending.
            // color.rgb ist hier die beleuchtete Standardmaterial-Farbe,
            // tint dagegen wieder Albedo — also mitbeleuchten.
            bodyCol = mix(color.rgb, tint * waterLicht, 0.55);
            color.a = mix(WATER_ALPHA_SHALLOW, WATER_ALPHA_DEEP, sqrt(depthT));
            // Steiler Blick macht zusätzlich klarer: sonst bleibt
            // Flachwasser auch von oben milchig.
            color.a = mix(color.a, min(color.a, 0.42), (1.0 - fresnel) * (1.0 - depthT));
          }

          // Fernwasser-Look: _ColorTop und _ColorBottom sind bei
          // water_lod identisch, es gibt dort also weder Tiefenverlauf
          // noch Durchsicht. Das ist der Grund, warum "Meer" im Original
          // bei ~120 m Entfernung beginnt und nicht bei einer Tiefe.
          // Auch das Fernmeer ist Albedo und braucht dasselbe Licht —
          // sonst bliebe ausgerechnet die grösste Fläche im Bild nachts
          // taghell und risse eine Kante zum beleuchteten Nahwasser auf.
          color.rgb = mix(bodyCol, WATER_LOD_COL * WATER_STICH * waterLicht, lodT);
          color.a = mix(color.a, WATER_ALPHA_DEEP, lodT * (1.0 - waterScreenRefr.z));

          // ── Spiegelung: EIN Term, richtungsabhängig ────────────────
          // Der Himmel wird an der SPIEGELRICHTUNG ausgewertet, mit
          // derselben Funktion, die die Kuppel zeichnet (ValheimSky.ts).
          // Bei streifendem Blick zeigt R fast waagerecht → Horizontfarbe
          // (= scene.fogColor, die Farbe, in die der Nebel ohnehin
          // läuft); bei steilem Blick nach oben → Zenit.
          //
          // Vorher stand hier "waterSkyColor * WATER_SURFACE_COL" mit
          // waterSkyColor = fogColorSun: der Sonnenton, richtungsunabhängig,
          // über die gesamte Fläche. Das war der Hauptanteil der
          // gemeldeten "braunen Spiegelungen". Die Multiplikation mit
          // _SurfaceColor (0.728) entfällt mit: ein Wasserspiegel ist
          // nicht 27 % dunkler als der Himmel, das war nur Kompensation
          // für die zu hohe Mischstärke. Was der Wert im Original
          // beschreibt — dass die Fläche nicht glatt ist und ihre
          // Mikroneigung auch bei steilem Blick Himmelslicht streut —
          // steckt jetzt in "sheen" unten, wo es hingehört: an der
          // tatsächlichen Wellensteilheit statt in einer Konstanten.
          vec3 toSun = normalize(-waterSunDir);
          vec3 spiegelRichtung = reflect(-viewDirW, nrm);
          vec3 himmel = vhSkyGradient(spiegelRichtung, waterSkyHorizon, waterSkyZenith,
                                      waterSkySunGlow, toSun, waterScreenRefr.w);
          // Sobald die Würfelkarte der Himmelskuppel steht (ValheimSky.probe),
          // ersetzt sie den Verlauf: sie enthält denselben Verlauf, aber
          // zusätzlich Wolken, Sterne und die Sonnenscheibe. Kein Mischen,
          // das wäre eine Doppelung — der Verlauf ist der Fallback, bis
          // die Sonde ihren ersten Durchlauf hinter sich hat.
          himmel = mix(himmel, textureCube(waterSkyProbe, spiegelRichtung).rgb,
                       waterGroundInfo.w);

          // Kein pauschaler Sockel mehr (war 0.10) und kein 0.75-Deckel.
          // Was der Sockel kompensierte — dass eine bewegte Fläche auch
          // bei senkrechtem Blick Himmelslicht streut — ist ein Effekt
          // der Mikroneigung und hängt deshalb jetzt an der tatsächlichen
          // Wellensteilheit. Der Deckel war zusätzlich energetisch
          // falsch: er liess bei streifendem Blick 25 % Grund
          // durchscheinen, wo physikalisch nichts durchkommt.
          float sheen = 0.04 * clamp(length(nrm.xz) * 6.0, 0.0, 1.0);
          float refl = clamp(fresnel + sheen, 0.0, 1.0);
          color.rgb = mix(color.rgb, himmel, refl);

          // ── Sonnenglitzern ─────────────────────────────────────────
          // Blinn-Phong mit hartem Exponenten auf der gestörten Normalen:
          // die feine Normal-Map zerlegt das Highlight in viele Funken,
          // statt einen einzigen Spiegelfleck stehen zu lassen.
          //
          // Jetzt mit demselben Fresnel-Gewicht wie die Spiegelung, der
          // echten Sonnenfarbe und einer Nachtsperre. Vorher war es ein
          // freilaufender additiver Term mit fester Farbe und fester
          // Stärke — unabhängig von Blickwinkel, Tageszeit und
          // Lichtstärke, und damit die vierte Glanzebene über der
          // Fläche (die drei anderen: StandardMaterial-Specular, der
          // Fresnel-Mix und Bloom).
          {
            float sonneUeberHorizont = smoothstep(0.0, 0.15, toSun.y);
            vec3 halfV = normalize(toSun + viewDirW);
            float glitter = pow(max(dot(nrm, halfV), 0.0), 400.0) * refl * sonneUeberHorizont;
            color.rgb += waterSunColor * glitter * WATER_GLITTER;
          }

          // Schaumsaum: am stärksten direkt an der Wasserkante
          float line = 1.0 - smoothstep(0.0, WATER_FOAM_DEPTH, eff);

          // _FoamTex + _RandomFoamTex, gegenseitig per UV-Versatz verzerrt
          // (Ersatz für die nicht exportierte _CurlTex).
          // Wertebereiche der echten Texturen (gemessen mit
          // tools/png-stats.mjs, Zeilenfilter korrekt zurückgerechnet):
          //   _FoamTex        Graustufe 6..166  (Mitte ≈ 0.33)
          //   _RandomFoamTex  0..133, Mittel 9  — bewusst dünn besetzt,
          //                   liefert vereinzelte Gischtflecken
          // Beide werden auf 0..1 hochskaliert, sonst bliebe der Schaum
          // grau statt weiß.
          vec2 fuv = vPositionW.xz * 0.09;
          vec2 curl = (texture2D(waterFoamTex, fuv * 0.3 + vec2(waterTime * 0.010, waterTime * -0.007)).rg - 0.33) * 0.16;
          float f1 = texture2D(waterFoamTex, fuv + curl + vec2(waterTime * 0.016, waterTime * 0.012)).r / 0.65;
          float f2 = texture2D(waterFoamHighTex, fuv * 1.7 - curl * 1.5 + vec2(waterTime * -0.024, waterTime * 0.018)).r / 0.52;
          float texel = clamp(f1 * 0.85 + f2 * 0.5, 0.0, 1.0);

          // line² macht den Saum schmal und lässt ihn nach außen weich
          // auslaufen. Die Textur geht MULTIPLIKATIV ein (nicht additiv mit
          // Sockel): nur wo die Schaumtextur wirklich hell ist, entsteht
          // Gischt — sonst wird der Saum eine geschlossene weiße Fläche.
          // Kein line² mehr: der Saum ist mit _FoamDepth = 0,2 m ohnehin
          // schmal, ein zusätzliches Quadrieren würde ihn fast wegkürzen.
          float foam = clamp(line * texel * 1.6, 0.0, 1.0);
          // Hohe Schwelle + Deckel unter 1.0: Gischt ist aufgerissen und
          // lässt das Wasser durchscheinen, sie übermalt es nicht.
          foam = smoothstep(0.35, 0.8, foam) * 0.8;

          color.rgb = mix(color.rgb, WATER_FOAM_COL, foam);
          color.a = mix(color.a, 0.95, foam);
        }
      `,
    };
  }
}
