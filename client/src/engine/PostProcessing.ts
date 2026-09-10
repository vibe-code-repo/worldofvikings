/**
 * PostProcessing — Nachbildung des Original-Post-Process-Stacks.
 *
 * Quelle der Werte: das Ingame-Post-Process-Profil des Vorbilds (Unity
 * PostProcessing-Stack v2) aus dem Asset-Export,
 * `extracted_assets/MonoBehaviour/
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
 * das Vorbild keine Tiefenunschärfe hat. Es benutzt dafür eine
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
 *    Wir nutzen FXAA plus 4×MSAA auf der Szenenpassage — als EINE
 *    Nutzeroption abschaltbar, genau wie im echten Spiel
 *    (GraphicsSettingBool.AntiAliasing). Die beiden greifen an
 *    verschiedenen Kanten, siehe setzeMsaa().
 *
 *    ⚠ Hier stand bis 17.08.2026: "Babylon hat kein TAA in der
 *    DefaultRenderingPipeline; ohne jegliches AA flimmern unsere
 *    Alpha-Cutout-Grashalme stark (viel mehr als im Original, das
 *    TAA-Historie hat)." Die Diagnose war richtig und ist inzwischen
 *    vermessen; die Behauptung über Babylon nicht mehr: Seit 8.56 gibt
 *    es `TAARenderingPipeline`, und sie ist als eigene Option eingebaut
 *    (setTemporalAA). Sie senkt das gemessene Zappeln um Faktor 75.
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
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline';
import { Constants } from '@babylonjs/core/Engines/constants';
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ValheimDof } from './ValheimDof';
import { setzeGrading } from './Grading';
import { beiLook, hexLinear4, look, type LookProfil } from './lookProfil';
import { strahlenTor, strahlenWinkel } from '@wov/shared';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Nullable } from '@babylonjs/core/types';

/*
  ── Wo die Nachbearbeitungs-Zahlen heute stehen ──────────────────────

  Hier standen sechs Konstanten (BLOOM_INTENSITY/THRESHOLD/KERNEL,
  CHROMATIC_ABERRATION, CONTRAST, EXPOSURE). Sie sind in das Look-Profil
  gewandert (`shared/src/lookProfil.ts`, einstellbar über `look:` in
  server.yml), weil sie genau die Regler sind, an denen der Look haengt —
  und ein Look-Regler, den man nur durch Neuuebersetzen erreicht, ist
  keiner.

  Was NICHT verlorengehen darf, sind die Herleitungen, die an ihnen
  hingen. Sie stehen jetzt bei den Feldern, die sie erklaeren:

   · Bloom-Kernel: Unitys "radius 5.0" ist ein Stufenfaktor der Pyramide,
     Babylons `bloomKernel` eine PIXELGROESSE. → LookBloom.kernel
   · Chromatische Aberration: Unity-intensity 0.15 auf [0..1], Babylons
     `aberrationAmount` ist eine Pixelverschiebung (Vorgabe 30). 0.15 × 30
     ≈ 4.5. → LookCa.staerke
   · Kontrast: Unity wendet seine 1.2 in linearem HDR an, Babylons
     ImageProcessing hier auf das fertige LDR/Gamma-Bild — derselbe Wert
     uebersteuert dort (Bodenmessung RGB(26,61,2), Blaukanal auf 2
     zerquetscht, Strukturvarianz halbiert). Deshalb stand hier 1.0.
     Heute 1,15, und der Unterschied ist gemessen statt geraten: Er
     gehoert zum Tonemapper, mit dem er zusammen kalibriert wurde
     (Tabelle bei LOOK_VORGABE).

  The six post-processing constants moved into the look profile; their
  derivations moved to the fields they explain.
*/
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
/** Name der TAA-Pipeline — auch der Schlüssel beim An-/Abhängen der Kamera. */
const TAA_NAME = 'valheimTaa';
/**
 * Zahl der akkumulierten Abtastmuster (Babylon-Vorgabe 16).
 *
 * Es ist die Länge des Halton-Musters, mit dem die Projektion je Bild
 * versetzt wird — nicht die Zahl gespeicherter Bilder. Bei 60 fps ist ein
 * Zyklus von 16 gut eine Viertelsekunde; darüber wird die Verteilung
 * feiner, aber das Einschwingen nach einem Szenenwechsel länger.
 */
const TAA_SAMPLES = 16;
/**
 * Anteil des NEUEN Bildes an der Mischung (Babylon-Vorgabe 0.05).
 *
 * 0.05 heisst: 95 % Historie. Das glättet stark und ist für Standbilder
 * gedacht — bei bewegtem Laub zieht es Schlieren. Hier steht bewusst ein
 * höherer Wert: Er lässt mehr vom aktuellen Bild durch, glättet also
 * weniger, schleppt aber auch weniger Vergangenheit mit. Zusammen mit
 * `clampHistory` ist das die Stellschraube zwischen Flimmern und
 * Ghosting; gemessen wird sie mit `tools/pw-schatten-flimmern.mjs`.
 */
const TAA_FAKTOR = 0.2;
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
/**
 * Tiefe, bis zu der Verdeckung überhaupt gerechnet wird — **der Wert, an
 * dem die gemeldeten Schlieren hingen.**
 *
 * Babylons Vorgabe ist `maxZ = 100`. Jenseits davon liefert der Shader
 * hart „keine Verdeckung", und genau diese Kante war im Bild zu sehen:
 * breite, diagonale dunkle Bänder quer über Wiese und Weg, dort wo die
 * Geländetiefe die 100 überschreitet. Kein Rauschen, kein Bias-Problem —
 * eine Bereichsgrenze, die mitten im Bild lag.
 *
 * Der Grund ist der Maßstab: 100 ist ein vernünftiger Wert für eine
 * Innenraum- oder Objektszene. Unsere Welt rechnet in METERN und reicht
 * bis zur 4-km-Far-Plane; 100 m sind hier der Vordergrund.
 *
 * 1000 m statt eines runden „ganz weit weg": Bei klarem Wetter
 * (`fogDensity` ≈ 0,0019) ist die Sicht dort zu über 95 % vom Nebel
 * geschluckt — die Bereichsgrenze liegt damit hinter allem, was man
 * sehen kann, und kann keine sichtbare Kante mehr erzeugen. Höher zu
 * gehen würde nur noch Pixel bezahlen, die der Nebel ohnehin verdeckt.
 *
 * Nachgewiesen am 17.08.2026 durch Variantenvergleich am selben Ort:
 * mit 100 Bänder, mit 3000 keine — bei sonst identischen Werten.
 */
const SSAO_MAX_Z = 1000;
/** Name der Pipeline — wird zum An- und Abhängen an die Kamera gebraucht. */
const SSAO_NAME = 'valheimSSAO';

/** Kamera-Vorwaerts im lokalen Raum — Konstante, s. `update()`. */
const VORWAERTS = new Vector3(0, 0, 1);

export interface PostProcessingOptions {
  bloom: boolean;
  motionBlur: boolean;
  chromaticAberration: boolean;
  antiAliasing: boolean;
  depthOfField: boolean;
  sunShafts: boolean;
  /** Umgebungsverdeckung (SSAO2) — im Original-Profil an, hier Option. */
  ambientOcclusion: boolean;
  /** Zeitliche Kantenglättung (TAA) gegen das Flimmern der Vegetation. */
  temporalAA: boolean;
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
  // Voreinstellung AUS — siehe setSSAO(). Sie stand einen Abend lang auf
  // an, und das war ein Fehler mit Ansage.
  ambientOcclusion: false,
  // Voreinstellung AUS, bis das Verhältnis von Flimmern zu Ghosting im
  // Bild beurteilt ist — siehe setTemporalAA().
  temporalAA: false,
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
  private readonly taa: TAARenderingPipeline;
  private readonly ssao: SSAO2RenderingPipeline;
  private ssaoAn = false;
  /**
   * Gehaltene Sonnenposition der Lichtstrahlen — update() läuft mit 60 Hz.
   * `customMeshPosition` ist eine schlichte Eigenschaft, die der Pass bei
   * jedem Bild ausliest; ein in place beschriebenes Objekt tut dasselbe wie
   * ein frisches, nur ohne GC-Druck.
   */
  private readonly strahlenQuelle = new Vector3();
  /** Blickachse der Kamera — gehalten, weil das Tor sie in jedem Bild braucht. */
  private readonly blickAchse = new Vector3();
  /** Das geltende Look-Profil (vor dem Anmelden die Vorgabe). */
  private profil: LookProfil = look();
  /**
   * Die zuletzt vom SPIELER gewählten Optionen.
   *
   * Gehalten, weil Profil und Spielerwahl beide über dieselben drei
   * Schalter (CA, DOF, Strahlen) entscheiden und in BELIEBIGER
   * Reihenfolge eintreffen: Das Profil kommt beim Anmelden, die Optionen
   * beim Öffnen der Einstellungen. Wer nur den zuletzt Eingetroffenen
   * auswertet, schaltet dem anderen seine Wahl ab.
   */
  private letzteOptionen: PostProcessingOptions = DEFAULT_POSTPROCESSING;
  /** Abmeldung vom Look-Profil — sonst hält der Beobachter die Pipeline fest. */
  private loeseLook: (() => void) | null = null;
  /** Beobachter, der die Renderliste der Tiefen-Passage setzt (s. dort). */
  private gbufferFilter: Nullable<Observer<Scene>> = null;
  private readonly focusSource: FocusSource | null;

  constructor(scene: Scene, camera: Camera, focusSource: FocusSource | null = null) {
    this.scene = scene;
    this.camera = camera;
    this.focusSource = focusSource;

    // ── TAA: Babylon sagt „ganz vorn", die Messung sagt „ganz hinten" ──
    //
    // Babylons Vorgabe steht wörtlich im Kopf von
    // `taaRenderingPipeline.d.ts`: „TAA post-process must be the first in
    // the camera, so TAARenderingPipeline must be created before any other
    // pipeline/post-processing." Die Pipeline entsteht deshalb hier oben.
    //
    // Tatsächlich landet sie trotzdem HINTEN: Sie wird sofort mit
    // `isEnabled = false` abgehängt, und das Wiedereinschalten ruft
    // `attachCamerasToRenderPipeline`, das ans ENDE anhängt.
    //
    // ⚠ DAS IST HIER KEIN FEHLER, SONDERN DIE FUNKTIONIERENDE VARIANTE.
    // Beide Anordnungen sind gemessen (17.08.2026, Zappelmass aus
    // `tools/pw-schatten-flimmern.mjs`, je paarweise in derselben Sitzung):
    //
    //   TAA hinten (wie es sich ergibt)   35,2 %  ->  1,4 %   zappelnd
    //   TAA vorn   (nach Vorgabe)         63,7 %  ->  66,0 %  zappelnd
    //
    // Vorn eingehängt bringt es NICHTS. Die naheliegende Erklärung: TAA
    // versetzt die Projektion je Bild (Halton-Jitter) und rechnet ihn in
    // der eigenen Akkumulation wieder heraus. Steht es vorn, laufen
    // danach noch neun Pässe — darunter Tiefenunschärfe und
    // Bewegungsunschärfe, die ihre Matrizen aus derselben, nun
    // verwackelten Kamera ziehen. Die tragen den Jitter ins fertige Bild
    // zurück, und dort kann ihn niemand mehr herausmitteln. Hinten
    // eingehängt glättet TAA das, was der Spieler wirklich sieht.
    //
    // Ein Versuch, die Pässe per `attachPostProcess(pp, 0)` nach vorn zu
    // holen (derselbe Griff wie bei ValheimDof), war gebaut, hat sauber
    // umsortiert — `TAA(s4)` vorn, `valheimDof` auf s1 — und ist wegen
    // dieser Messung wieder entfernt worden.
    //
    // Die Pipeline entsteht hier oben trotzdem zuerst: Das ist die
    // dokumentierte Reihenfolge, es kostet nichts, und wenn eine spätere
    // Babylon-Version das Anhängen ändert, steht die Konstruktion richtig.
    //
    // ── Warum es TAA überhaupt gibt ─────────────────────────────────
    // Der Kopf dieser Datei führte bisher als bewusste Abweichung: „Original
    // nutzt TAA … Babylon hat kein TAA in der DefaultRenderingPipeline;
    // ohne jegliches AA flimmern unsere Alpha-Cutout-Grashalme stark (viel
    // mehr als im Original, das TAA-Historie hat)." Beide Hälften sind
    // inzwischen überholt: Babylon 8.56 bringt `TAARenderingPipeline` mit,
    // und das Flimmern ist am 17.08.2026 vermessen — 95 % aller bewegten
    // Bildpunkte zappeln, und es sind NICHT die Schatten
    // (Docs/07-Grafik-Konzept.md, „Flimmern: es sind nicht die Schatten").
    //
    // ── Die drei Einstellungen sind keine Vorgaben ──────────────────
    //  · `disableOnCameraMove` steht in Babylon auf true und schaltet TAA
    //    ab, sobald sich die Kamera bewegt. Für Standbilder sinnvoll, für
    //    ein Spiel unbrauchbar: Unsere Kamera hängt am Spieler, sie bewegt
    //    sich fast immer, und das Flimmern stört gerade beim Laufen.
    //  · `clampHistory` klemmt den Historienwert auf das Minimum/Maximum
    //    der 3×3-Nachbarschaft. Das ist die billige Bremse gegen Ghosting
    //    und der Grund, warum wir OHNE Bewegungsvektoren auskommen.
    //  · `reprojectHistory` bleibt AUS. Es braucht den PrePassRenderer
    //    (taaRenderingPipeline.js:216, `enablePrePassRenderer()`), also
    //    eine komplette zusätzliche Szenenpassage — genau den Posten, den
    //    `syncGeometryBuffer()` weiter unten mit Messwerten bekämpft.
    this.taa = new TAARenderingPipeline(TAA_NAME, scene, [camera]);
    this.taa.isEnabled = false;
    if (this.taa.isSupported) {
      this.taa.disableOnCameraMove = false;
      this.taa.clampHistory = true;
      this.taa.samples = TAA_SAMPLES;
      this.taa.factor = TAA_FAKTOR;
    }

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
    this.ssao.maxZ = SSAO_MAX_Z;

    this.pipeline = new DefaultRenderingPipeline('valheimPost', true, scene, [camera]);


    // Das DOF DIESER Pipeline bleibt aus — es ist Babylons physikalisches
    // Kameramodell (Blende/Brennweite) und verwischt auch den Vordergrund.
    // Die Unschärfe des Vorbilds ist eine reine Fernunschärfe und hängt separat
    // an der Kamera, siehe ValheimDof.
    this.pipeline.depthOfFieldEnabled = false;
    this.pipeline.grainEnabled = false;
    this.pipeline.sharpenEnabled = false;

    this.pipeline.imageProcessingEnabled = true;

    this.wendeLookAn(look());
    this.loeseLook = beiLook((profil) => this.wendeLookAn(profil));

    this.apply(DEFAULT_POSTPROCESSING);
  }

  /**
   * Alles, was das Look-Profil an dieser Pipeline steuert.
   *
   * ── Warum ACES jetzt gilt und die alte Messung trotzdem stimmt ──────
   * Hier stand KHR-Neutral mit einer A/B-Messung als Begründung: ACES
   * dunkelt "doppelt ab" (Boden RGB(26,61,2) → (6,37,0)) und die
   * Sättigung stieg von 98 auf 100 %. Beide Zahlen sind richtig gemessen
   * — und beide wurden unter Belichtung 1,0 und OHNE Sättigungsregler
   * genommen. Genau das sind die zwei Regler, die zum Tonemapper gehören:
   * ACES ist dunkler UND flauer als Neutral, deshalb steht im Profil
   * Belichtung 1,15 daneben, und deshalb steht der Sättigungsregler
   * ueberhaupt erst hier. ADR-0040 des Schwesterprojekts hat dieselbe
   * Wahl an denselben Zahlen getroffen: Neutral liefert 0,70 mittlere
   * Sättigung, ACES 0,52 — Neutral macht das Bild BUNTER, und "bunter"
   * ist das Gegenteil des Ziels.
   *
   * Neutral bleibt als `tonemapping: neutral` erreichbar; die alte
   * Einstellung ist damit nicht verloren, sondern eine Zeile in
   * server.yml.
   *
   * ── Sättigung ist PROZENT ───────────────────────────────────────────
   * `ColorCurves.globalSaturation` rechnet intern `value / 100`. Das
   * Profil führt sie deshalb als 68 und nicht als 0,68 — eine 0,68 hier
   * wäre eine Sättigung von 0,68 % und ein graues Bild. Der
   * Sättigungsregler ist ausserdem NUR wirksam, wenn `colorCurvesEnabled`
   * gesetzt ist: Babylon prüft das Flag beim Anlegen der Defines, ein
   * gesetzter Wert ohne Flag ist stumm.
   */
  private wendeLookAn(profil: LookProfil): void {
    this.profil = profil;

    this.pipeline.bloomThreshold = profil.bloom.schwelle;
    this.pipeline.bloomWeight = profil.bloom.staerke;
    this.pipeline.bloomKernel = profil.bloom.kernel;
    this.pipeline.bloomScale = profil.bloom.skala;
    this.pipeline.chromaticAberration.aberrationAmount = profil.ca.staerke;

    const ip = this.pipeline.imageProcessing;
    if (ip) {
      ip.contrast = profil.kontrast;
      ip.exposure = profil.belichtung;
      ip.toneMappingEnabled = profil.tonemapping !== 'aus';
      ip.toneMappingType =
        profil.tonemapping === 'aces'
          ? ImageProcessingConfiguration.TONEMAPPING_ACES
          : ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;

      /*
        Die EINE Umrechnung vom Profilfaktor auf Babylons Regler.

        `ColorCurves` klemmt die Sättigung auf −100…+100 und rechnet
        daraus intern `1 + s/100` (colorCurves.js, `result.a`). 0 ist
        also neutral, +68 hiesse "68 % MEHR". Der Profilfaktor 0,68 wird
        damit zu −32.

        Das ist keine Vermutung, sondern ein bezahlter Fehler: Mit einer
        direkt durchgereichten 68 stieg die gemessene Sättigung am
        Referenzort auf 0,98, statt auf 0,45 zu fallen — das Bild war
        knallgrün statt matt.
      */
      const kurven = ip.colorCurves ?? new ColorCurves();
      kurven.globalSaturation = (profil.saettigung - 1) * 100;
      ip.colorCurves = kurven;
      // Faktor 1 ist neutral — dann kostet die Kurve nur Instruktionen
      // und ändert nichts, also bleibt sie aus.
      ip.colorCurvesEnabled = Math.abs(profil.saettigung - 1) > 1e-4;

      /*
        ── Die Farbhandschrift des Vorbilds ───────────────────────────
        `ShadowsMidtonesHighlights` als 3D-Nachschlagetabelle, gebaut
        wie URPs `LutBuilder3D` und in denselben Steckplatz gehängt:
        Babylon wendet `colorGradingTexture` NACH Tonemapping, Gamma und
        Kontrast an — dieselbe Stelle der Kette. Die Rechnung und der
        Befund, dass die Lichter-Zeile des Vorbilds nie feuert, stehen
        in `Grading.ts`.
      */
      // `ip` ist der POST-PROCESS und reicht nur einen Teil der Regler
      // durch (Kontrast, Belichtung, Vignette). `colorGradingTexture`
      // gehört nicht dazu — die Tabelle wird deshalb an der
      // Konfiguration selbst gesetzt, die dahinter steht.
      setzeGrading(this.scene, ip.imageProcessingConfiguration, profil.grading);

      ip.vignetteEnabled = profil.vignette.an;
      ip.vignetteWeight = profil.vignette.staerke;
      hexLinear4(profil.vignette.farbe, ip.vignetteColor);
      // MULTIPLY statt Babylons Vorgabe OPAQUE: OPAQUE legt die
      // Vignettenfarbe DECKEND über die Ränder, MULTIPLY dunkelt sie ab
      // und lässt die Struktur stehen. Für eine dunkle Ecke ist das der
      // gemeinte Effekt; deckend wäre ein schwarzer Rahmen.
      ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    }

    // CA und DOF sind zugleich Spieler-Einstellungen (PostProcessingOptions).
    // Das Profil sagt, ob sie ÜBERHAUPT in Frage kommen; `apply()` sagt,
    // ob der Spieler sie will. Beides muss zutreffen — sonst überschriebe
    // der Serverwert eine Einstellung, die der Spieler abgeschaltet hat.
    this.pipeline.chromaticAberrationEnabled =
      profil.ca.an && this.letzteOptionen.chromaticAberration;
    this.setDepthOfField(profil.dof.an && this.letzteOptionen.depthOfField);
    this.setSunShafts(profil.strahlen.an && this.letzteOptionen.sunShafts);
    /*
      ZULETZT, aus demselben Grund wie in `apply()`: Die drei Zeilen
      darüber hängen Pässe an und ab, also steht erst jetzt fest, welcher
      Pass vorne in der Kette liegt — und MSAA wirkt nur dort (die lange
      Begründung steht an `setzeMsaa`).

      Ohne diese Zeile blieb die Abtastung nach einem Profilwechsel auf
      dem Pass stehen, der VORHER vorne lag. Das Profil kommt vom Server
      und trifft den Client mitten im Spiel (Anmeldung, Wetterwechsel);
      wer dabei die Tiefenunschärfe verliert und den Strahlenkranz
      bekommt, verlöre sonst still seine Kantenglättung.
    */
    this.setzeMsaa(this.letzteOptionen.antiAliasing);
  }

  apply(opts: PostProcessingOptions): void {
    this.letzteOptionen = opts;
    this.pipeline.bloomEnabled = opts.bloom && this.profil.bloom.an;
    this.pipeline.chromaticAberrationEnabled = opts.chromaticAberration && this.profil.ca.an;
    this.pipeline.fxaaEnabled = opts.antiAliasing;
    this.setMotionBlur(opts.motionBlur);
    this.setDepthOfField(opts.depthOfField && this.profil.dof.an);
    this.setSunShafts(opts.sunShafts && this.profil.strahlen.an);
    this.setSSAO(opts.ambientOcclusion);
    this.setTemporalAA(opts.temporalAA);
    this.syncGeometryBuffer();
    // ZULETZT: Erst jetzt steht fest, welcher Pass vorne in der Kette hängt.
    this.setzeMsaa(opts.antiAliasing);
  }

  /**
   * Zeitliche Kantenglättung an- oder abschalten.
   *
   * ── Wogegen sie hilft ───────────────────────────────────────────────
   * Gegen das gemessene Flimmern der Vegetation: Cutout-Laub kennt keine
   * Teildeckung, ein Bildpunkt an einer Blattkante ist entweder Blatt oder
   * Hintergrund und kippt beim kleinsten Windversatz ganz um. MSAA sieht
   * diese Kanten nicht (der `discard` verwirft den ganzen Bildpunkt),
   * FXAA glättet sie räumlich, aber nicht über die ZEIT — und genau
   * zeitlich entsteht das Problem. Ausführlich samt Messreihen in
   * Docs/07-Grafik-Konzept.md, „Flimmern: es sind nicht die Schatten".
   *
   * ── Warum ein eigener Schalter und nicht Teil von „Kantenglättung" ──
   * Weil TAA einen Preis hat, den FXAA und MSAA nicht haben: Ghosting.
   * Ohne Bewegungsvektoren (die bräuchten den PrePassRenderer, s.
   * Konstruktor) kann nur `clampHistory` gegenhalten, und was diese
   * Klemme nicht fängt, zieht Schlieren. Das ist eine Geschmacksfrage und
   * gehört dem Spieler in die Hand, nicht in einen Sammelschalter.
   *
   * `isEnabled` hängt die Kamera an bzw. ab (taaRenderingPipeline.js) —
   * abgeschaltet läuft kein Pass, es bleiben nur die beiden
   * Ping-Pong-Texturen im Speicher liegen.
   */
  private setTemporalAA(enabled: boolean): void {
    // Ohne `texelFetch` baut Babylon die Pipeline gar nicht erst auf; ein
    // Zugriff auf ihre Schalter liefe dann ins Leere.
    if (!this.taa.isSupported) return;
    if (this.taa.isEnabled === enabled) return;
    this.taa.isEnabled = enabled;
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
      // zu stehen. `look.strahlen.ankerAbstand` liegt innerhalb der
      // Far-Plane (4 km); die 1400 m der Vorgabe stammen aus ADR-0042.
      const d = this.profil.strahlen.ankerAbstand;
      const c = this.camera.globalPosition;
      this.strahlenQuelle.set(c.x + sunDir.x * d, c.y + sunDir.y * d, c.z + sunDir.z * d);
      this.shafts.customMeshPosition = this.strahlenQuelle;

      /*
        ── Das Tor (ADR-0042) ──────────────────────────────────────────

        Der Ursprung des Kranzes entsteht aus einer Projektion, und eine
        perspektivische Division kann einen Punkt VOR der Kamera nicht
        von seinem Spiegelbild dahinter unterscheiden: Jenseits von 90°
        landet der projizierte Ursprung wieder im Bild, und der Effekt
        malt einen Strahlenkranz um eine Sonne, die im Ruecken steht.
        Der Effekt faellt dort nicht aus — er LUEGT, und zwar in genau
        den Bildern, die ein Spieler in der dritten Person meistens
        sieht.

        Warum die Belichtung und nicht der Pass: Ab- und Anhaengen ist
        eine ganze zweite Szenenpassage, und ein Schwenk entlang der
        Schwelle taete das in jedem Bild. Die Rampe ueber das
        Hysterese-Band blendet stattdessen aus; bei 0 kostet der Pass
        zwar noch, malt aber nichts mehr.

        Der Bildwinkel deckelt den Torwinkel nach unten: Bei 16:9 sitzt
        die Bildecke rund 41° neben der Achse, eine Sonne knapp
        ausserhalb des Bildes faechert also noch herein. 55° laesst ihr
        das und bleibt weit weg von der 90°-Singularitaet.

        The gate: past 90° the projected origin folds back into frame and
        the effect lies. Ramp the exposure across the hysteresis band.
      */
      // Blickachse ohne Zuteilung: `getForwardRay()` legt pro Frame einen
      // Ray samt zwei Vector3 an — genau der Muell, den `Lighting.apply()`
      // sich vor einem Jahr abgewoehnt hat.
      Vector3.TransformNormalToRef(VORWAERTS, this.camera.getWorldMatrix(), this.blickAchse);
      this.blickAchse.normalize();
      const winkel = strahlenWinkel(this.blickAchse, sunDir);
      const tor = strahlenTor(
        winkel,
        this.profil.strahlen.torWinkel,
        this.profil.strahlen.hysterese
      );
      this.shafts.exposure = this.profil.strahlen.exposure * tor;
    }
  }

  /** Nur zum Messen: was der Strahlenkranz gerade tut. / For measuring only. */
  get strahlenMesswerte(): { an: boolean; exposure: number; ankerAbstand: number } | null {
    return this.shafts
      ? {
          an: true,
          exposure: +this.shafts.exposure.toFixed(4),
          ankerAbstand: this.profil.strahlen.ankerAbstand,
        }
      : null;
  }

  /** Fokusdistanz fürs HUD, leer wenn DOF aus ist. */
  get debugLine(): string {
    return this.dof ? this.dof.debugLine : 'aus';
  }

  /**
   * Sonnenstrahlen — `SunShafts` des Vorbilds (GraphicsSettingBool.SunShafts,
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
   * "aus" (das Vorbild liefert SunShafts standardmässig an aus). Begründung: Der
   * Nutzer hat den Framerate-Verfall ausdrücklich als Problem benannt; ein
   * Effekt, der die Bildrate halbiert, gehört nicht in die Voreinstellung.
   * Einschaltbar bleibt er über die Einstellungen.
   *
   * ── ZWEI Verhältnisse, nicht eines (Stufe 2, gemessen 09.09.2026) ───
   *
   * Babylon nimmt für `ratio` entweder eine Zahl oder ein Paar:
   * `passRatio` misst die VERDECKUNGS-Passage (das Teure),
   * `postProcessRatio` die AUSGABE des Passes. Hier stand eine einzelne
   * `0.25` und hat damit beides verkleinert. Die Verdeckung darf klein
   * sein; die Ausgabe darf es nicht, und zwar aus einem Grund, der mit
   * dem Aussehen des Kranzes nichts zu tun hat:
   *
   * Sobald ein PostProcess an der Kamera hängt, rendert die Szene in die
   * Zieltextur des ERSTEN Passes der Kette — dessen Größe ist also die
   * Auflösung des ganzen Spiels. Steht der Strahlenpass vorn und misst
   * ein Viertel, läuft das komplette Bild in 400×225 und wird auf
   * 1600×900 hochgezogen. Das sieht aus wie „MSAA ist weg" und ist in
   * Wahrheit ein Viertel der Bildpunkte: schneller UND treppig, ohne
   * dass irgendwo ein Schalter auf aus stünde.
   *
   * Vorn steht er, sobald kein vollformatiger Pass mehr vor ihm hängt.
   * Nachgestellt am Referenzort (~/wov-lab-mess/stufe2-msaa2.mjs): Mit
   * dem ausgelieferten Profil hängt er hinten (Index 9) und alles ist in
   * Ordnung. Schaltet der Spieler Tiefenunschärfe, Bewegungsunschärfe
   * und chromatische Aberration ab, rutscht er auf Index 0 — und die
   * Szene rendert 400×225. Das ist der Befund, den Bauer Licht gemeldet
   * hat (schneller, aliased); die Strahlen SCHALTEN das MSAA nicht ab,
   * `setzeMsaa()` ist richtig.
   *
   * `postProcessRatio: 1` behebt das an der Wurzel: Der Pass gibt in
   * voller Auflösung aus und ist damit als erster Pass unschädlich. Die
   * Verdeckungs-Passage bleibt bei 0,25 — dort liegen die Kosten, und
   * ihre Auflösung sieht man dem weichen Kranz nicht an.
   */
  private setSunShafts(enabled: boolean): void {
    if (enabled && !this.shafts) {
      const vls = new VolumetricLightScatteringPostProcess(
        'valheimSunShafts',
        // Verdeckung klein (dort liegen die Kosten), Ausgabe VOLL — die
        // Begründung steht im Block oben, sie ist nicht optisch.
        { passRatio: 0.25, postProcessRatio: 1 },
        this.camera,
        undefined,
        60, // Samples
        undefined,
        this.scene.getEngine(),
        false
      );
      vls.useCustomMeshPosition = true;
      vls.exposure = this.profil.strahlen.exposure;
      vls.decay = this.profil.strahlen.decay;
      vls.weight = this.profil.strahlen.gewicht;
      vls.density = this.profil.strahlen.dichte;
      /*
        ── Die Kuppel raus aus der Verdeckung (ADR-0042, Punkt 2) ──────

        `ValheimSky.mesh` traegt `infiniteDistance` — es reitet mit der
        Kamera und liegt in der Tiefe VOR dem Anker, den `update()` in
        `ankerAbstand` Metern setzt. In der Verdeckungspassage schreibt
        es damit eine Wand ueber den ganzen Himmel, hinter der der Anker
        begraben liegt: Der Kranz kaeme nie zustande, und zwar ohne dass
        irgendetwas falsch aussieht — es faechert einfach nichts.

        Alles ANDERE bleibt drin. Baeume, Felsen und Gebaeude sind genau
        die Verdecker, die aus einem Lichtfleck einen Faecher machen.

        The sky dome rides with the camera and would bury the anchor
        behind a depth wall in the occlusion pass. Everything else stays.
      */
      const kuppel = this.scene.getMeshByName('valheimSky');
      if (kuppel) vls.excludedMeshes.push(kuppel);
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
   * ── Sie stand einen Abend auf AN. Das war falsch. ───────────────────
   * Gemeldet am 17.08.2026 aus dem SPIEL: „Die Umgebungsverdeckung in den
   * Grafikeinstellungen erzeugt diese Schlieren/Schatten." Damit ist sie
   * wieder aus, und der Weg dorthin gehört aufgeschrieben, weil er ein
   * Muster ist:
   *
   * Die Messung unten sagte +3,5 % Tonwertstreuung und nannte das einen
   * Gewinn — die Streuung ist schließlich DIE Kennzahl der Diagnose im
   * Grafik-Konzept. Nur misst sie nicht Qualität, sondern Kontrast. **Ein
   * Artefakt aus dunklen Schlieren erhöht sie genauso zuverlässig wie
   * echte Tiefe in den Ritzen.** Die Zahl war richtig gerechnet und hat
   * trotzdem das Gegenteil belegt.
   *
   * ── Und die Kostenangabe galt nur für die Voreinstellung ────────────
   * „Die Tiefenpassage läuft ohnehin" stimmt, WENN Tiefen- oder
   * Bewegungsunschärfe an sind — beide sind voreingestellt an und teilen
   * sich den GeometryBufferRenderer mit der Verdeckung. Wer sie abschaltet
   * (und genau das tut Mike), lässt die Verdeckung die ganze Passage
   * allein bezahlen. Nachgemessen am 17.08.2026, gleicher Ort, gleiche
   * Uhrzeit, verschränkt in vier Wechseln:
   *
   *   Voreinstellung   10,30 ms → 10,36 ms   (+0,6 %)
   *   ohne DOF und MB  13,37 ms → 14,00 ms   (**+4,7 %**)
   *
   * Bestätigt an der Ursache selbst: `scene.geometryBufferRenderer`
   * existiert in dieser Einstellung nur, solange die Verdeckung an ist.
   *
   * Die Lehre ist allgemeiner als der Effekt: **Eine Messung unter den
   * Voreinstellungen ist keine Messung für den, der sie geändert hat.**
   *
   * Dieselbe Lehre steht seit dem 16.08.2026 über dem FPS-Wächter (E3):
   * Eine Messung sagt, ob Zahlen besser werden. Ob es besser AUSSIEHT,
   * sagt nur das Spielen. Beim Wächter war es die Bildrate, hier die
   * Streuung — und beide Male hat die Zahl den Blick ersetzt statt ihn zu
   * schärfen.
   *
   * Die Ursache der Schlieren ist inzwischen gefunden und behoben — es
   * war `SSAO_MAX_Z`, siehe dort. **Beide Verdächtigen, die hier standen,
   * waren es nicht:** Ein Variantenvergleich am selben Ort zeigte Bänder
   * mit Radius 0,15 UND mit 1,5, mit und ohne `expensiveBlur`. Nur die
   * Bereichsgrenze trug.
   *
   * Nachgemessen ist auch, dass der Radius als Regler der STÄRKE nicht
   * taugt: von 0,15 bis 2,0 — Faktor 13 — ändert sich der Bildunterschied
   * praktisch nicht (24,8 % der Pixel gegenüber 24,5 %). Wer die
   * Verdeckung kräftiger will, dreht an `totalStrength`, nicht hier.
   *
   * ── Die Zahlen von damals, unverändert ──────────────────────────────
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
    this.loeseLook?.();
    this.loeseLook = null;
    this.setMotionBlur(false);
    this.setDepthOfField(false);
    this.setSunShafts(false);
    this.setSSAO(false);
    this.ssao.dispose();
    this.loeseGeometryBufferFilter();
    this.pipeline.dispose();
  }
}
