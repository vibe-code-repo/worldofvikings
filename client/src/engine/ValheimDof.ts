/**
 * ValheimDof — die Fern-Unschärfe des Originals.
 *
 * ── Warum es diese Datei überhaupt gibt ──────────────────────────────
 * `PostProcessing.ts` hielt bisher fest: "Depth of Field AUS — im
 * Original-Profil ebenfalls deaktiviert". Das stimmt, greift aber zu
 * kurz und war der Grund, warum uns die weiche Ferne fehlte: Valheim
 * benutzt für DOF gar nicht den PostProcessing-Stack v2. Im Profil
 * (`unnamed_-5654458244375810705.json`) ist `depthOfField` tatsächlich
 * aus — die Unschärfe kommt aus einer ZWEITEN, separaten Komponente auf
 * derselben Kamera: dem alten Image Effect
 * `UnityStandardAssets.ImageEffects.DepthOfField`, gesteuert von
 * `CameraEffects.cs`. Und die ist standardmäßig AN
 * (`GraphicsSettingsManager.cs:46 → m_depthOfField = true`).
 *
 * ── Die Zahlen sind gemessen, nicht geschätzt ────────────────────────
 * Aus dem aktivierten Inspector-Export der Komponente
 * (`extracted_assets/MonoBehaviour/unnamed_9679.json`, `m_Enabled: 1`):
 *
 *   focalSize        0.36    Totzone: so viel Unschärfe bleibt unsichtbar
 *   aperture         0.612   Steilheit des Anstiegs
 *   maxBlurSize      1.5     Kernelbreite, skaliert mit der Auflösung
 *   nearBlur         0       KEINE Nahunschärfe — nur die Ferne
 *   highResolution   1       Vollauflösender Pfad (verdoppelt die Breite)
 *   blurSampleCount  2
 *
 * `nearBlur = 0` ist der entscheidende Punkt: Das ist keine
 * Fotografen-Schärfentiefe, bei der Vorder- UND Hintergrund verschwimmen,
 * sondern eine reine Fernunschärfe. Genau der Eindruck, den man im Spiel
 * hat — Vordergrund plastisch und scharf, Wald und Küste laufen hinten
 * ineinander.
 *
 * Aus `CameraEffects.cs` kommt die Fokussteuerung:
 *   m_dofAutoFocus    Strahl nach vorne, Trefferentfernung = Fokus
 *   m_dofMinDistance  50 m   (Untergrenze)
 *   m_dofMaxDistance  3000 m (kein Treffer ⇒ alles scharf)
 *   focalLength = Lerp(focalLength, ziel, 0.2)  pro Frame
 *
 * ── Was hier rekonstruiert ist ───────────────────────────────────────
 * Die CoC-Kurve selbst steckt in `DepthOfFieldHdr.shader`, der als
 * kompiliertes Binary vorliegt. Bekannt ist aus `DepthOfField.cs:207`
 * nur, wie die Parameter ankommen:
 *
 *   _CurveParams = (1, focalSize, 1/(1-aperture)-1, focalDistance01)
 *
 * Nachgebildet ist daraus die relative Tiefenabweichung
 * `(z - fokus) / z`. Der Grund für "relativ" statt "absolut" ist
 * belegbar: Das Original rechnet in Linear01-Tiefe, also `z/farClip` —
 * die Division durch die Far-Plane kürzt sich in `(d01 - f01)/d01`
 * heraus. Nur so ist die Kurve unabhängig von der Far-Plane, und nur so
 * ergeben die Zahlen einen sinnvollen Verlauf. Mit den echten Werten:
 *
 *   bis  ~70 m   scharf (Totzone)
 *      100 m     ~0.67
 *      150 m     ~0.83
 *   ab  ~250 m   voll weich
 *
 * ── Woher die Tiefe kommt ────────────────────────────────────────────
 * Aus dem GeometryBufferRenderer, den der Motion Blur ohnehin schon
 * anwirft — `geometry.fragment.fx` schreibt `vViewPos.z / vViewPos.w`,
 * und weil `vViewPos = view * worldPos` ist (w = 1), steht dort die
 * View-Space-Tiefe in METERN. Kein Umrechnen nötig.
 *
 * ── Reihenfolge ──────────────────────────────────────────────────────
 * Der Effekt hängt an Index 0 der Kamera, läuft also VOR Bloom,
 * chromatischer Aberration und Tonemapping. Andersherum würde der
 * Kontrast der Ferne nach dem Weichzeichnen wieder angehoben.
 */
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Constants } from '@babylonjs/core/Engines/constants';
// Ohne diesen Side-Effect-Import existiert scene.enableGeometryBufferRenderer
// bei den granularen Babylon-Imports dieses Projekts nicht (dieselbe Falle
// wie bei enablePhysics/enablePrePassRenderer).
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';

/** Alle vier aus unnamed_9679.json (die aktivierte DOF-Komponente). */
const FOCAL_SIZE = 0.36;
const APERTURE = 0.612;
const MAX_BLUR_SIZE = 1.5;
/** highResolution = 1 verdoppelt internalBlurWidth (DepthOfField.cs:334). */
const HIGH_RES_SCALE = 2;

/** CameraEffects.cs — Fokusgrenzen und Nachführung. */
const MIN_DISTANCE = 50;
const MAX_DISTANCE = 3000;
/** Lerp(focal, ziel, 0.2) pro Frame bei 60 fps ⇒ e-Rate für beliebiges dt. */
const FOCUS_RATE = -60 * Math.log(1 - 0.2);

/**
 * Autofokus-Takt in Sekunden.
 *
 * 0.033 → 0.12 (2026-07-29). Der Strahlmarsch ruft die Höhenfunktion der
 * Welt auf, und die ist mehroktaviges Rauschen — bei bis zu 128 Schritten
 * alle 33 ms war das messbar: Das Abschalten der Tiefenunschärfe senkte
 * den Anteil langsamer Frames von 29 % auf 23 %.
 *
 * Sichtbar ist der niedrigere Takt nicht, weil die Fokusdistanz ohnehin
 * exponentiell nachgeführt wird (FOCUS_RATE) — die Nachführung glättet,
 * unabhängig davon, wie oft das Ziel neu bestimmt wird.
 */
const FOCUS_INTERVAL = 0.12;

const SHADER = 'valheimDof';

Effect.ShadersStore[`${SHADER}FragmentShader`] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;

uniform vec2 texelSize;
uniform float focusDistance;   // Meter
uniform float focusSize;       // Totzone (focalSize)
uniform float apertureTerm;    // 1/(1-aperture)-1
uniform float maxRadius;       // Pixel

// Zerstreuungskreis an einer Bildstelle, 0 = scharf, 1 = maximal weich.
float cocAt(vec2 uv) {
  float z = texture2D(depthSampler, uv).r;
  // Wo nichts gerendert wurde (Himmel), steht 0 im Puffer — das ist nicht
  // "direkt vor der Kamera", sondern unendlich weit weg.
  if (z <= 0.0) z = 1.0e6;
  float rel = (z - focusDistance) / max(z, 1.0e-4);
  // clamp bei 0 statt bei -1: nearBlur ist im Original aus.
  float c = clamp(rel * apertureTerm, 0.0, 1.0);
  return max(0.0, c - focusSize) / (1.0 - focusSize);
}

// Ein Tap. Gewichtet mit der EIGENEN Unschärfe der Probe: Ein scharfer
// Vordergrundpixel trägt nichts zu einem weichen Hintergrundpixel bei,
// sonst blutet die Silhouette eines Baumstamms in den Himmel dahinter.
#define TAP(ox, oy) { \
  vec2 uv = vUV + vec2(ox, oy) * radius * texelSize; \
  float w = cocAt(uv); \
  sum += texture2D(textureSampler, uv).rgb * w; \
  wsum += w; }

void main(void) {
  vec4 center = texture2D(textureSampler, vUV);
  float coc = cocAt(vUV);
  float radius = coc * maxRadius;
  vec3 sum = center.rgb;
  float wsum = 1.0;

  // Zwei Ringe à 6 Taps, der äußere um 30° versetzt — 13 Proben ergeben
  // bei diesen kleinen Radien eine glatte Scheibe ohne sichtbare Struktur.
  TAP( 0.500,  0.000) TAP( 0.250,  0.433) TAP(-0.250,  0.433)
  TAP(-0.500,  0.000) TAP(-0.250, -0.433) TAP( 0.250, -0.433)
  TAP( 0.866,  0.500) TAP( 0.000,  1.000) TAP(-0.866,  0.500)
  TAP(-0.866, -0.500) TAP( 0.000, -1.000) TAP( 0.866, -0.500)

  vec4 blurred = vec4(sum / wsum, center.a);
  // WebGPU verlangt Textur-Samples in uniformem Kontrollfluss. Der fruehe
  // pixelabhaengige return sparte im GLSL-Pfad zwar Taps, machte aber alle
  // folgenden Samples in WGSL ungueltig. Bei Radius 0 sampeln die Taps
  // ohnehin denselben Mittelpunkt; mix behaelt exakt den alten Schwellwert.
  gl_FragColor = mix(center, blurred, step(0.002, coc));
}
`;

export class ValheimDof {
  private readonly pp: PostProcess;
  private focal = MIN_DISTANCE;
  private sinceFocus = 0;
  /** Nur für die Diagnoseanzeige. */
  private lastTarget = MIN_DISTANCE;

  /**
   * @param groundHeight Geländehöhe an einer Weltkoordinate — der Ersatz
   *   für den Physik-Raycast des Originals, siehe autoFocus().
   * @param waterLevel   Meeresspiegel; die Wasserfläche zählt als Treffer.
   */
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly groundHeight: (x: number, z: number) => number,
    private readonly waterLevel: number,
    private readonly blurScale = 1
  ) {
    scene.enableGeometryBufferRenderer();

    const engine = scene.getEngine();
    const hdr = engine.getCaps().textureHalfFloatRender;
    this.pp = new PostProcess(
      'valheimDof',
      SHADER,
      ['texelSize', 'focusDistance', 'focusSize', 'apertureTerm', 'maxRadius'],
      ['depthSampler'],
      1.0,
      null, // NICHT über den ctor anhängen — die Position ist wichtig
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      engine,
      false,
      undefined,
      hdr ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_UNSIGNED_INT,
      undefined,
      undefined,
      false,
      undefined,
      // Die Babylon-Passes laufen unter WebGPU nativ als WGSL. Unser Shader
      // liegt bewusst als GLSL vor und wird von Babylon nach SPIR-V uebersetzt.
      ShaderLanguage.GLSL
    );

    this.pp.onApply = (effect) => {
      const gb = this.scene.geometryBufferRenderer;
      if (gb) effect.setTexture('depthSampler', gb.getGBuffer().textures[0]!);
      const w = engine.getRenderWidth();
      const h = engine.getRenderHeight();
      effect.setFloat2('texelSize', 1 / w, 1 / h);
      effect.setFloat('focusDistance', this.focal);
      effect.setFloat('focusSize', FOCAL_SIZE);
      effect.setFloat('apertureTerm', 1 / (1 - APERTURE) - 1);
      // DepthOfField.cs:195/205 — internalBlurWidth = maxBlurSize * width/1024.
      effect.setFloat(
        'maxRadius',
        MAX_BLUR_SIZE * (w / 1024) * HIGH_RES_SCALE * this.blurScale
      );
    };

    // Index 0: vor Bloom/Tonemapping der DefaultRenderingPipeline.
    camera.attachPostProcess(this.pp, 0);
  }

  /**
   * Autofokus. Das Original schießt einen Physik-Strahl nach vorn
   * (`Physics.Raycast(..., m_dofRayMask)`). Bei uns wäre das
   * irreführend: Havok-Körper legen wir nur im Umkreis von rund 50 m an
   * (COLLIDER_RANGE), der Strahl liefe also fast immer ins Leere und
   * damit auf MAX_DISTANCE — also nie Unschärfe.
   *
   * Stattdessen marschiert der Strahl über die Höhenfunktion der Welt.
   * Die kennt das Gelände bis zum Horizont und ist damit näher an dem,
   * was das Original meint, als ein Collider-Treffer es hier sein könnte.
   * Die Wasserfläche zählt mit — sonst wäre der Blick aufs Meer
   * knackscharf bis zur Insel am Horizont.
   */
  private autoFocus(): number {
    const o = this.camera.globalPosition;
    const d = this.camera.getDirection(Vector3.Forward());
    let t = 2;
    // 128 → 48 Schritte bei gröberem Wachstum (0.08 → 0.16): Der Strahl
    // erreicht damit weiterhin die 3000 m, braucht dafür aber ein Drittel
    // der Höhenabfragen. Die Fokusdistanz wirkt relativ (siehe CoC-Kurve
    // im Kopfkommentar), grobe Schritte in der Ferne fallen nicht auf.
    for (let i = 0; i < 48 && t < MAX_DISTANCE; i++) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const h = Math.max(this.groundHeight(x, z), this.waterLevel);
      if (y <= h) return t;
      // Geometrisch wachsende Schrittweite: nah fein, fern grob — die
      // Fokusdistanz wirkt ohnehin relativ (siehe Kurve im Kopf).
      t += Math.max(2, t * 0.16);
    }
    return MAX_DISTANCE;
  }

  update(dt: number): void {
    this.sinceFocus += dt;
    if (this.sinceFocus >= FOCUS_INTERVAL) {
      this.sinceFocus = 0;
      this.lastTarget = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.autoFocus()));
    }
    // Framerate-unabhängige Variante von Lerp(focal, ziel, 0.2) je Frame.
    const k = 1 - Math.exp(-FOCUS_RATE * dt);
    this.focal += (this.lastTarget - this.focal) * k;
  }

  /** Für die Diagnoseanzeige im HUD. */
  get debugLine(): string {
    return `fokus ${this.focal.toFixed(0)}m (ziel ${this.lastTarget.toFixed(0)}m)`;
  }

  dispose(): void {
    this.camera.detachPostProcess(this.pp);
    this.pp.dispose();
  }
}
