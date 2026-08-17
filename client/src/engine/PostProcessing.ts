/**
 * PostProcessing — Nachbildung des Original-Post-Process-Stacks von Valheim.
 *
 * Quelle der Werte: das echte Ingame-Post-Process-Profil (Unity
 * PostProcessing-Stack v2) aus dem AssetRipper-Export des Clients,
 * `/root/Valheim_Client/extracted_assets/MonoBehaviour/
 *  unnamed_-5654458244375810705.json`. Gemessene Defaults dort:
 *
 *   Bloom                AN   intensity 0.3, threshold 0.7, softKnee 0.7,
 *                             radius 5.0, antiFlicker 1
 *   Motion Blur          AN   shutterAngle 150°, sampleCount 10
 *   Chromatic Aberration AN   intensity 0.15
 *   Color Grading        AN   Tonemapper "Neutral", contrast 1.2,
 *                             temperature -8, postExposure 1.0
 *   Ambient Occlusion    AN   intensity 1.0, radius 0.15, 10 Samples
 *   Depth of Field       AUS  (m_Enabled = 0)  ← irreführend, siehe unten
 *   Anti-Aliasing        AUS  (im Profil deaktiviert; wäre TAA)
 *   Vignette/Grain/LUT/SSR/EyeAdaptation  AUS
 *
 * ACHTUNG beim DOF: Dass es in diesem Profil aus ist, heißt NICHT, dass
 * Valheim keine Tiefenunschärfe hat. Das Spiel benutzt dafür eine
 * zweite, unabhängige Komponente auf derselben Kamera — den alten Image
 * Effect `UnityStandardAssets.ImageEffects.DepthOfField`, gesteuert von
 * `CameraEffects.cs`, standardmäßig AN. Genau daher kommt die weiche
 * Ferne, die hier lange gefehlt hat; nachgebildet in engine/ValheimDof.ts.
 *
 * Das erklärt den vom Nutzer bemängelten Unterschied: unser Bild war
 * "hart"/clean, das Original ist durch Bloom + Motion Blur + leichte
 * chromatische Aberration + Neutral-Tonemapping spürbar weicher.
 *
 * Abweichungen vom Original (bewusst, mit Begründung):
 *  - Anti-Aliasing: Original nutzt TAA und hat es in DIESEM Profil aus.
 *    Babylon hat kein TAA in der DefaultRenderingPipeline; ohne jegliches
 *    AA flimmern unsere Alpha-Cutout-Grashalme stark (viel mehr als im
 *    Original, das TAA-Historie hat). Wir nutzen daher FXAA plus 4×MSAA
 *    auf der Szenenpassage — als EINE Nutzeroption abschaltbar, genau wie
 *    im echten Spiel (GraphicsSettingBool.AntiAliasing). Die beiden
 *    greifen an verschiedenen Kanten, siehe setzeMsaa().
 *  - Ambient Occlusion ist NICHT enthalten: Babylons SSAO2 braucht einen
 *    zusätzlichen Geometry-/Prepass über die gesamte (bereits schwere)
 *    Terrain- und Clutter-Geometrie. Bei radius 0.15 ist der Effekt sehr
 *    kleinräumig und im Gesamtbild der schwächste Beitrag — bewusst
 *    zurückgestellt, statt die Framerate dafür zu opfern.
 *  - Color-Grading-"temperature -8" (leicht kühler) hat in Babylons
 *    ImageProcessingConfiguration keine direkte Entsprechung
 *    (ColorCurves kennt Hue/Density/Saturation/Exposure, keine Kelvin-
 *    Temperatur). Weggelassen statt schlecht approximiert — der Nebel-
 *    und Ambient-Ton kommt bei uns ohnehin aus dem EnvSetup-Modell.
 *
 * Alle vier Effekte, die das Original als Grafikoption anbietet
 * (GraphicsSettingBool: Bloom, DepthOfField, MotionBlur,
 * ChromaticAberration, AntiAliasing), sind hier ebenfalls einzeln
 * schaltbar — siehe ui/Settings.ts.
 */
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { Constants } from '@babylonjs/core/Engines/constants';
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ValheimDof } from './ValheimDof';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Nullable } from '@babylonjs/core/types';

/** Unity-Profilwerte (siehe Header) — hier zentral, damit die Herkunft
 *  jedes Zahlenwerts nachvollziehbar bleibt. */
const BLOOM_INTENSITY = 0.3;
const BLOOM_THRESHOLD = 0.7;
/** Unity-"radius 5.0" ist keine Pixelgröße, sondern ein Stufenfaktor der
 *  Pyramide. Babylons bloomKernel IST eine Pixelgröße (Blur-Kernel).
 *  64 px liefert bei 1080p eine vergleichbar breite, weiche Aura. */
const BLOOM_KERNEL = 64;
/** Unity intensity 0.15 auf [0..1]; Babylons aberrationAmount ist eine
 *  Pixelverschiebung (Default 30 = deutlich sichtbar). 0.15 × 30 ≈ 4.5 →
 *  dezente Farbsäume nur an kontrastreichen Kanten, wie im Original. */
const CHROMATIC_ABERRATION = 4.5;
/**
 * Kontrast 1.0 statt der 1.2 aus dem Original-Profil — BEWUSSTE Abweichung,
 * gemessen begründet: Unity wendet die 1.2 in linearem HDR an, Babylons
 * ImageProcessing hier dagegen auf das fertige LDR/Gamma-Bild. Dort wirkt
 * derselbe Wert massiv übersteuert: Bodenmessung ergab RGB(26,61,2) —
 * Blaukanal auf 2 zerquetscht, Sättigung 98 %, Strukturvarianz halbiert
 * (sd 3.9 vs. 10.0 in der three.js-Referenz). Geclippte Kanäle löschen
 * genau die Textur-Tonwerte aus, die der Nutzer vermisst hat
 * ("man sieht die Bodentexturen nicht").
 */
const CONTRAST = 1.0;
const EXPOSURE = 1.0;
/** shutterAngle 150° / 360° — Anteil der Frame-Zeit, über den verwischt
 *  wird; entspricht Babylons motionStrength-Skala (1.0 = voller Frame). */
const MOTION_STRENGTH = 150 / 360;
const MOTION_SAMPLES = 10;
/**
 * MSAA-Abtastungen auf der Szenenpassage. 4× ist die Stufe, die WebGL2
 * überall kann (`maxMSAASamples` ist auf der Zielhardware 4 oder 8; der
 * Setter deckelt selbst) und die Babylon auch für die eigenen Pipelines
 * als Beispielwert nennt. 8× kostet Bandbreite ohne sichtbaren Zugewinn
 * an unseren überwiegend flachen Geländekanten.
 */
const MSAA_SAMPLES = 4;
/**
 * Umgebungsverdeckung — Werte aus dem Original-Profil (siehe Kopf):
 * `radius 0.15`, `totalStrength 1.0`, 10 Abtastungen. `ratio 0.5` rechnet
 * den Effekt in halber Auflösung; er ist weich, die Auflösung sieht man
 * ihm nicht an — dieselbe Überlegung wie beim Strahlenkranz.
 */
const SSAO_RADIUS = 0.15;
const SSAO_STAERKE = 1.0;
const SSAO_SAMPLES = 10;
const SSAO_RATIO = 0.5;
/** Name der Pipeline — wird zum An- und Abhängen an die Kamera gebraucht. */
const SSAO_NAME = 'valheimSSAO';

export interface PostProcessingOptions {
  bloom: boolean;
  motionBlur: boolean;
  chromaticAberration: boolean;
  antiAliasing: boolean;
  depthOfField: boolean;
  sunShafts: boolean;
  /** Umgebungsverdeckung (SSAO2) — im Original-Profil an, hier Option. */
  ambientOcclusion: boolean;
}

export const DEFAULT_POSTPROCESSING: PostProcessingOptions = {
  bloom: true,
  motionBlur: true,
  chromaticAberration: true,
  antiAliasing: true,
  // Original-Voreinstellung: GraphicsSettingsManager.cs:46 → true.
  depthOfField: true,
  // Bewusst AUS trotz Original-Default — siehe Kostenhinweis in setSunShafts().
  sunShafts: false,
  // Voreinstellung aus Messung, nicht aus Geschmack — siehe setSSAO().
  ambientOcclusion: true,
};

/** Woran der Autofokus sich orientiert — siehe ValheimDof.autoFocus(). */
export interface FocusSource {
  groundHeight: (x: number, z: number) => number;
  waterLevel: number;
}

export class PostProcessing {
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private motionBlur: MotionBlurPostProcess | null = null;
  private dof: ValheimDof | null = null;
  private shafts: VolumetricLightScatteringPostProcess | null = null;
  /** Immer vorhanden, aber nur angehängt, wenn die Option an ist. */
  private readonly ssao: SSAO2RenderingPipeline;
  private ssaoAn = false;
  /**
   * Gehaltene Sonnenposition der Lichtstrahlen — update() läuft mit 60 Hz.
   * `customMeshPosition` ist eine schlichte Eigenschaft, die der Pass bei
   * jedem Bild ausliest; ein in place beschriebenes Objekt tut dasselbe wie
   * ein frisches, nur ohne GC-Druck.
   */
  private readonly strahlenQuelle = new Vector3();
  /** Beobachter, der die Renderliste der Tiefen-Passage setzt (s. dort). */
  private gbufferFilter: Nullable<Observer<Scene>> = null;
  private readonly focusSource: FocusSource | null;

  constructor(scene: Scene, camera: Camera, focusSource: FocusSource | null = null) {
    this.scene = scene;
    this.camera = camera;
    this.focusSource = focusSource;

    // ── SSAO2 VOR der DefaultRenderingPipeline ──────────────────────
    //
    // Die Reihenfolge der Erzeugung ist die Reihenfolge in der Kette, und
    // Umgebungsverdeckung gehört VOR das Tonemapping: Sie verdunkelt
    // Ritzen im linearen Bild. Danach angewandt zöge sie stattdessen ein
    // graues Muster über das fertige, bereits komprimierte Bild.
    //
    // Deshalb entsteht die Pipeline hier immer, auch wenn der Effekt aus
    // ist — an- und abgeschaltet wird über das An- und Abhängen der
    // Kamera (`setSSAO`). Ein Erzeugen erst beim Einschalten hinge sie
    // hinter der DefaultRenderingPipeline ein, also nach dem Tonemapping.
    //
    // Zwei Konstruktor-Parameter tragen je einen dokumentierten
    // Fallstrick (Grafik-Konzept, Stufe 7):
    //
    //  · `forceGeometryBuffer = true` (5.): Der Default-Pfad ruft
    //    `scene.enablePrePassRenderer()`, und die Methode existiert bei
    //    den granularen Imports dieses Projekts gar nicht — derselbe
    //    Abbruch wie beim Motion Blur, siehe setMotionBlur(). Über den
    //    GeometryBufferRenderer läuft es, und den teilen sich DOF und
    //    Motion Blur ohnehin schon.
    //  · `textureType = HALF_FLOAT` (6.): Der Default sind 8 Bit. Die
    //    Pipeline reicht die Szenenfarbe durch (`SSAOOriginalSceneColor`)
    //    — in 8 Bit wäre das HDR-Bild VOR dem Bloom auf LDR geklemmt, und
    //    der Bloom hätte nichts Helles mehr zu greifen.
    this.ssao = new SSAO2RenderingPipeline(
      SSAO_NAME,
      scene,
      SSAO_RATIO,
      undefined, // Kameras erst in setSSAO() anhängen
      true,
      Constants.TEXTURETYPE_HALF_FLOAT
    );
    this.ssao.radius = SSAO_RADIUS;
    this.ssao.totalStrength = SSAO_STAERKE;
    this.ssao.samples = SSAO_SAMPLES;

    this.pipeline = new DefaultRenderingPipeline('valheimPost', true, scene, [camera]);

    this.pipeline.bloomThreshold = BLOOM_THRESHOLD;
    this.pipeline.bloomWeight = BLOOM_INTENSITY;
    this.pipeline.bloomKernel = BLOOM_KERNEL;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.chromaticAberration.aberrationAmount = CHROMATIC_ABERRATION;

    // Das DOF DIESER Pipeline bleibt aus — es ist Babylons physikalisches
    // Kameramodell (Blende/Brennweite) und verwischt auch den Vordergrund.
    // Valheims Unschärfe ist eine reine Fernunschärfe und hängt separat
    // an der Kamera, siehe ValheimDof.
    this.pipeline.depthOfFieldEnabled = false;
    this.pipeline.grainEnabled = false;
    this.pipeline.sharpenEnabled = false;

    this.pipeline.imageProcessingEnabled = true;
    const ip = this.pipeline.imageProcessing;
    if (ip) {
      ip.contrast = CONTRAST;
      ip.exposure = EXPOSURE;
      ip.toneMappingEnabled = true;
      // Unity-Tonemapper "Neutral" — Babylons KHR_PBR_NEUTRAL ist der
      // direkte Gegenpart (hue-erhaltend). Ein ACES-Experiment (um die
      // three.js-Referenz zu treffen, die linear + ACESFilmic rendert)
      // wurde per A/B-Messung VERWORFEN: auf unserer Gamma-LDR-Pipeline
      // dunkelt ACES doppelt ab (Boden RGB(26,61,2) → (6,37,0), Sättigung
      // 98 % → 100 %). Der Sättigungs-Crush entsteht vor dem
      // Post-Processing im Material/Licht — dort ansetzen, nicht hier.
      ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
      ip.vignetteEnabled = false;
    }

    this.apply(DEFAULT_POSTPROCESSING);
  }

  apply(opts: PostProcessingOptions): void {
    this.pipeline.bloomEnabled = opts.bloom;
    this.pipeline.chromaticAberrationEnabled = opts.chromaticAberration;
    this.pipeline.fxaaEnabled = opts.antiAliasing;
    this.setMotionBlur(opts.motionBlur);
    this.setDepthOfField(opts.depthOfField);
    this.setSunShafts(opts.sunShafts);
    this.setSSAO(opts.ambientOcclusion);
    this.syncGeometryBuffer();
    // ZULETZT: Erst jetzt steht fest, welcher Pass vorne in der Kette hängt.
    this.setzeMsaa(opts.antiAliasing);
  }

  /**
   * MSAA auf die Szenenpassage legen (Grafik-Konzept, Stufe 2).
   *
   * Sobald ein PostProcess an der Kamera hängt, rendert die Szene nicht
   * mehr in den Framebuffer des Canvas, sondern in die Zieltextur des
   * ERSTEN Passes. Das `antialias: true` der Engine läuft damit ins Leere —
   * es gilt nur dem Canvas, den die Szene gar nicht mehr direkt beschreibt.
   * Wirksam wird MSAA ausschließlich dort, wo die Geometrie tatsächlich
   * rasterisiert wird: auf genau diesem ersten Ziel. Jeder weitere Pass
   * bekommt ein fertiges Bild als Textur gereicht; ein Mehrfach-Abtasten
   * kostete dort Bandbreite, ohne eine einzige Kante zu glätten — deshalb
   * setzt die Schleife alle übrigen ausdrücklich auf 1 zurück.
   *
   * Welcher Pass der erste ist, wechselt im Betrieb: `ValheimDof` hängt
   * sich mit `attachPostProcess(pp, 0)` bewusst ganz nach vorn, und die
   * DefaultRenderingPipeline hängt ihre Pässe bei jedem Umschalten neu an.
   * Deshalb wird die Kette hier gelesen statt geraten — das ist derselbe
   * Weg, den Babylon intern für seine Pipelines geht
   * (`_enableMSAAOnFirstPostProcess`), nur über die ganze Kamera statt nur
   * über die Pässe einer Pipeline. `pipeline.samples` bleibt aus demselben
   * Grund auf 1: Es träfe verlässlich nur den ersten Pipeline-Pass, und der
   * ist bei eingeschalteter Tiefenunschärfe nicht der erste der Kamera.
   *
   * FXAA ersetzt das nicht und wird davon auch nicht überflüssig. MSAA
   * glättet Dreieckskanten und sieht Alpha-Test-Kanten nicht — genau die
   * Kanten, aus denen unser Gras und das Laub bestehen. FXAA sieht
   * umgekehrt nur das fertige Bild. Beide zusammen sind der Grund, warum
   * der eine Schalter „Kantenglättung" beides schaltet.
   */
  private setzeMsaa(an: boolean): void {
    // Der Setter deckelt selbst auf `maxMSAASamples`; wir tun es hier
    // vorher, damit der Vergleich unten nicht bei jedem Aufruf danebenliegt
    // und die Zieltextur unnötig neu anlegt.
    const max = this.scene.getEngine().getCaps().maxMSAASamples;
    const wunsch = an ? Math.min(MSAA_SAMPLES, max) : 1;
    let ersterGesehen = false;
    for (const pp of this.camera._postProcesses) {
      if (!pp) continue; // Babylon lässt beim Abhängen Lücken stehen
      const soll = ersterGesehen ? 1 : wunsch;
      ersterGesehen = true;
      if (pp.samples !== soll) pp.samples = soll;
    }
  }

  /**
   * Der GeometryBufferRenderer ist eine KOMPLETTE zusätzliche Renderpassage
   * über die gesamte Szene — Terrain, Vegetation, jede Instanz. Damit ist er
   * der teuerste Einzelposten hier, und Motion Blur wie Tiefenunschärfe
   * teilen ihn sich (beide brauchen daraus nur die Tiefe).
   *
   * Ohne diese Synchronisation blieb er dauerhaft an, sobald ihn einer der
   * beiden einmal angefordert hatte: Babylon schaltet ihn beim Wegfall des
   * letzten Nutzers nicht von selbst ab, und `MotionBlurPostProcess.dispose()`
   * räumt ausdrücklich nur seine Velocity-Matrizen auf. Gemessen am
   * 2026-07-29 hiess das: beide Effekte abzuschalten brachte nur 34 → 40 fps,
   * weil die Extrapassage unverändert weiterlief. Erst hier fällt sie weg.
   */
  private syncGeometryBuffer(): void {
    // SSAO zählt als dritter Nutzer — ohne ihn hier risse das Abschalten
    // von Tiefenunschärfe UND Bewegungsunschärfe der Umgebungsverdeckung
    // die Tiefenpassage unter den Füßen weg (Grafik-Konzept, Stufe 7,
    // Fallstrick 4).
    if (this.dof || this.motionBlur || this.ssaoAn) {
      this.scene.enableGeometryBufferRenderer();
      this.beschraenkeGeometryBuffer();
    } else {
      this.loeseGeometryBufferFilter();
      this.scene.disableGeometryBufferRenderer();
    }
  }

  /**
   * Das Gras aus der Tiefen-Passage nehmen.
   *
   * Der GeometryBufferRenderer rendert ohne eigene Renderliste alle aktiven
   * Meshes — bei uns rund 245, davon 51 Clutter-Zellen. Gemessen am
   * 2026-08-02 kostete die Passage 244 der 1134 Zeichenaufrufe pro Frame;
   * ohne Gras sind es rund 60 weniger.
   *
   * Sichtbar ist das nicht: Der einzige Abnehmer der Tiefe ist die
   * FERN-Unschärfe (ValheimDof, Autofokus im zweistelligen Meterbereich).
   * Grashalme stehen im Nahbereich und verschwinden ohnehin spätestens bei
   * ~60 m (ClutterWindPlugin-Fade); ihre Fragmente bekommen jetzt die Tiefe
   * des Bodens dahinter, der praktisch dieselbe ist. Was der Effekt
   * dagegen wirklich braucht — Gelände, Bäume, Felsen, Gebautes — bleibt
   * vollständig drin.
   *
   * Zeitpunkt wie bei der Wasserbrechung: nach der Auswertung der aktiven
   * Meshes, damit die Liste dieses Frames gilt und das Frustum-Culling der
   * Szene erhalten bleibt (siehe WaterRefraction.ts).
   */
  private beschraenkeGeometryBuffer(): void {
    if (this.gbufferFilter) return;
    const gbuffer = this.scene.geometryBufferRenderer?.getGBuffer();
    if (!gbuffer) return;
    this.gbufferFilter = this.scene.onAfterActiveMeshesEvaluationObservable.add(() => {
      const aktiv = this.scene.getActiveMeshes();
      const liste: AbstractMesh[] = [];
      for (let i = 0; i < aktiv.length; i++) {
        const m = aktiv.data[i]!;
        if (!m.name.startsWith('clutter_')) liste.push(m);
      }
      gbuffer.renderList = liste;
    });
  }

  private loeseGeometryBufferFilter(): void {
    if (!this.gbufferFilter) return;
    this.scene.onAfterActiveMeshesEvaluationObservable.remove(this.gbufferFilter);
    this.gbufferFilter = null;
    const gbuffer = this.scene.geometryBufferRenderer?.getGBuffer();
    if (gbuffer) gbuffer.renderList = null;
  }

  /**
   * Einmal pro Frame — führt Autofokus und Sonnenposition nach.
   *
   * @param sunDir Richtung ZUR Sonne (EnvState.sunDir); unter dem Horizont
   *   schaltet sich der Strahlenkranz von selbst ab, weil die Quelle dann
   *   hinter der Kamera liegt.
   */
  update(dt: number, sunDir?: { x: number; y: number; z: number }): void {
    this.dof?.update(dt);
    if (this.shafts && sunDir) {
      // Die Quelle muss weit genug weg sein, dass sie sich beim Laufen nicht
      // mitbewegt — sonst wandert der Kranz mit dem Spieler statt am Himmel
      // zu stehen. 2 km liegt innerhalb der Far-Plane (4 km).
      const c = this.camera.globalPosition;
      this.strahlenQuelle.set(
        c.x + sunDir.x * 2000,
        c.y + sunDir.y * 2000,
        c.z + sunDir.z * 2000
      );
      this.shafts.customMeshPosition = this.strahlenQuelle;
    }
  }

  /** Fokusdistanz fürs HUD, leer wenn DOF aus ist. */
  get debugLine(): string {
    return this.dof ? this.dof.debugLine : 'aus';
  }

  /**
   * Sonnenstrahlen — Valheims `SunShafts` (GraphicsSettingBool.SunShafts,
   * gesetzt in CameraEffects.SetSunShafts). Das Original benutzt den
   * Unity-Image-Effect gleichen Namens; Babylons direkter Gegenpart ist
   * `VolumetricLightScatteringPostProcess` (radiales Blur ausgehend von der
   * Lichtquelle im Bildraum, dasselbe Verfahren).
   *
   * ACHTUNG Kosten: Der Effekt rendert eine eigene VERDECKUNGS-PASSAGE der
   * gesamten Szene in ein RTT — mit unserer Vegetation ist das der mit
   * Abstand teuerste Posten der ganzen Pipeline. Gemessen am 2026-07-29 an
   * der Küste: 40 fps → 17 fps bei Ratio 0.5/100 Samples. Mit Ratio 0.25 und
   * 60 Samples bleibt der Kranz optisch praktisch gleich (er ist weich, die
   * Auflösung sieht man ihm nicht an), kostet aber nur noch einen Bruchteil.
   *
   * Deshalb steht er als EINZIGER Grafikschalter abweichend vom Original auf
   * "aus" (Valheim liefert SunShafts standardmässig an aus). Begründung: Der
   * Nutzer hat den Framerate-Verfall ausdrücklich als Problem benannt; ein
   * Effekt, der die Bildrate halbiert, gehört nicht in die Voreinstellung.
   * Einschaltbar bleibt er über die Einstellungen.
   */
  private setSunShafts(enabled: boolean): void {
    if (enabled && !this.shafts) {
      const vls = new VolumetricLightScatteringPostProcess(
        'valheimSunShafts',
        0.25, // Viertelauflösung — siehe Kostenhinweis oben
        this.camera,
        undefined,
        60, // Samples
        undefined,
        this.scene.getEngine(),
        false
      );
      vls.useCustomMeshPosition = true;
      vls.exposure = 0.18;
      vls.decay = 0.965;
      vls.weight = 0.5;
      vls.density = 0.94;
      this.shafts = vls;
    } else if (!enabled && this.shafts) {
      this.shafts.dispose(this.camera);
      this.shafts = null;
    }
  }

  /**
   * Umgebungsverdeckung an- und abhängen.
   *
   * Die Pipeline selbst entsteht im Konstruktor (Reihenfolge, siehe dort);
   * hier wird nur die Kamera an- oder abgehängt. Das ist auch der billige
   * Weg: Eine abgehängte Pipeline rendert nichts und hält bloss ihre
   * Zieltexturen.
   *
   * ── Warum sie AN voreingestellt ist ─────────────────────────────────
   * Im Unity-Profil des Originals ist Ambient Occlusion an (intensity 1.0,
   * radius 0.15, 10 Samples). Hier stand über ein Jahr die Begründung,
   * der Effekt sei „im Gesamtbild der schwächste Beitrag" und koste eine
   * zusätzliche Geometriepassage — deshalb wurde er zurückgestellt.
   *
   * **Die zweite Hälfte davon stimmt nicht mehr, und die erste war nie
   * gemessen.** Den GeometryBufferRenderer teilt sich die Verdeckung mit
   * Tiefen- und Bewegungsunschärfe, und die sind beide voreingestellt an
   * — die Passage läuft ohnehin. Übrig bleibt der eigene Aufwand des
   * Effekts, und der ist klein.
   *
   * Gemessen am 16.08.2026 (RX 7900 XT, 1280×720, feste Kamera und
   * Uhrzeit, VERSCHRÄNKT in vier Wechseln, weil die ersten Läufe
   * systematisch schneller werden und ein einfaches Vorher/Nachher diese
   * Drift mitmisst):
   *
   *   Frame-Zeit   aus 12,67 ms   an 12,86 ms   (+1,5 %)
   *                Rohwerte aus 12,43…13,06, an 12,42…13,29 — sie
   *                überlappen, der Aufwand liegt im Rauschen
   *   Streuung     aus 14,85      an 15,37     (+3,5 %)
   *
   * Die Tonwertstreuung ist dabei keine beliebige Zahl: Das
   * Grafik-Konzept führt sie als Kennzahl der Diagnose (unser Bild hatte
   * die HALBE Streuung des Originals), und Verdeckung in Ritzen ist genau
   * das, was sie erhöht. Ein Effekt, der ein diagnostiziertes Defizit
   * angeht und dabei unter 2 % kostet, gehört in die Voreinstellung.
   *
   * Abschaltbar bleibt er — auf schwacher Hardware ist er ein guter
   * erster Kandidat.
   */
  private setSSAO(enabled: boolean): void {
    if (enabled === this.ssaoAn) return;
    this.ssaoAn = enabled;
    const manager = this.scene.postProcessRenderPipelineManager;
    if (enabled) {
      manager.attachCamerasToRenderPipeline(SSAO_NAME, this.camera);
    } else {
      manager.detachCamerasFromRenderPipeline(SSAO_NAME, this.camera);
    }
  }

  private setDepthOfField(enabled: boolean): void {
    if (enabled && !this.dof && this.focusSource) {
      this.dof = new ValheimDof(
        this.scene,
        this.camera,
        this.focusSource.groundHeight,
        this.focusSource.waterLevel
      );
    } else if (!enabled && this.dof) {
      this.dof.dispose();
      this.dof = null;
    }
  }

  /**
   * Motion Blur läuft NICHT über die DefaultRenderingPipeline (die kennt
   * ihn nicht) und wird deshalb separat an die Kamera gehängt.
   *
   * Zwei Fallstricke, beide hier bewusst behandelt:
   *
   * 1. Der Default-Pfad ruft `scene.enablePrePassRenderer()` — diese
   *    Methode existiert bei den granularen Babylon-Imports dieses
   *    Projekts gar nicht (der Side-Effect-Import des PrePass-Scene-
   *    Components fehlt), was zur Laufzeit sofort mit "…is not a
   *    function" abbricht. Mit `forceGeometryBuffer = true` (letztes
   *    ctor-Argument) läuft es stattdessen über den GeometryBufferRenderer,
   *    dessen Scene-Component motionBlurPostProcess.js selbst importiert.
   *
   * 2. `isObjectBased = false` (reiner Kamera-Blur aus Tiefe + vorheriger
   *    ViewProjection) liest der Konstruktor bereits VOR unserer
   *    Zuweisung, und der Setter zieht `enableVelocity` nicht nach. Ohne
   *    das explizite Abschalten unten schriebe der Geometry-Buffer
   *    weiterhin Velocity-Daten für jede Terrain- und Clutter-Instanz —
   *    genau der teure Pfad, den wir vermeiden wollen. Das Original
   *    verwischt beim Laufen ohnehin überwiegend durch Kamerabewegung.
   *
   * Bleibt: ein zusätzlicher Geometrie-Pass über die Szene. Das ist der
   * teuerste der vier Post-Process-Schalter — falls die Framerate klemmt,
   * ist dies der erste, den man in den Einstellungen abschaltet.
   */
  private setMotionBlur(enabled: boolean): void {
    if (enabled && !this.motionBlur) {
      this.motionBlur = new MotionBlurPostProcess(
        'valheimMotionBlur',
        this.scene,
        1.0,
        this.camera,
        undefined,
        undefined,
        false,
        0,
        false,
        true // forceGeometryBuffer — siehe (1)
      );
      this.motionBlur.isObjectBased = false;
      const gbr = this.scene.geometryBufferRenderer;
      if (gbr) gbr.enableVelocity = false; // siehe (2)
      this.motionBlur.motionStrength = MOTION_STRENGTH;
      this.motionBlur.motionBlurSamples = MOTION_SAMPLES;
    } else if (!enabled && this.motionBlur) {
      this.motionBlur.dispose(this.camera);
      this.motionBlur = null;
    }
  }

  dispose(): void {
    this.setMotionBlur(false);
    this.setDepthOfField(false);
    this.setSunShafts(false);
    this.setSSAO(false);
    this.ssao.dispose();
    this.loeseGeometryBufferFilter();
    this.pipeline.dispose();
  }
}
