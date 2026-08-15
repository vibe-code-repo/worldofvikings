/**
 * Lighting — Valheim's EnvMan reproduced on Babylon.
 *
 * All keyframe data and the interpolation live in the shared environment
 * model (`shared/src/environment.ts`, which documents what is verified and
 * what is still approximated). This file is only the Babylon binding: it
 * takes an `EnvState` and pushes it into the sun light, the ambient light,
 * the sky dome and the fog.
 *
 * ── Why the fog needs special handling ───────────────────────────────
 * Valheim's fog is EXP2 distance fog with TWO colours per keyframe:
 * `fogColor*` looking away from the sun and `fogColorSun*` looking towards
 * it. That directional, sun-tinted haze is the most recognisable part of
 * the game's look — a single flat fog colour never reads as Valheim, no
 * matter how well tuned.
 *
 * Babylon's built-in fog colour is a single scene-wide uniform
 * (`vFogColor`, see Shaders/ShadersInclude/fogFragmentDeclaration.js), so
 * a true per-pixel gradient would need a custom shader path. We instead
 * evaluate the sun/view term ONCE PER FRAME on the CPU from the camera's
 * forward vector and write the blended result into `scene.fogColor`.
 *
 * Trade-off, stated plainly:
 *  + Works uniformly for every material in the scene — StandardMaterial
 *    (clutter), PBRMaterial (trees/rocks) and the terrain NodeMaterial all
 *    read the same `scene.fogColor` / `NodeMaterialSystemValues.FogColor`,
 *    so the fog can never disagree between them.
 *  + No shader injection, so it behaves identically on WebGL2 and WebGPU.
 *  − The tint is constant across the frame instead of a per-pixel gradient,
 *    so turning towards the sunset warms the whole view at once rather
 *    than glowing only around the sun. Per-pixel is the documented next
 *    step (Docs/03 §2.1); it needs the same blend applied in three shader
 *    paths (Standard/PBR/Node), which is why it is deliberately not
 *    bundled with this change.
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3, Color4, Vector3 } from '@babylonjs/core/Maths/math';
// Wert-Import, nicht nur Typ: Er zieht die Kamera-Erweiterung
// `getForwardRayToRef` mit herein (Culling/ray.core, AddRayExtensions).
import { Ray } from '@babylonjs/core/Culling/ray';
import { Scene } from '@babylonjs/core/scene';
import { ValheimSky } from './ValheimSky';
import {
  Biome,
  WORLD_TIME_LENGTH,
  ENV_CLEAR,
  environmentForBiome,
  evaluateEnv,
  findEnvironment,
  type EnvColor,
  type EnvSetup,
  type EnvState,
} from '@wov/shared';

/**
 * How tightly the sun colour dominates the fog. Higher = tighter glow
 * around the sun direction, lower = the whole sky warms up. Valheim's
 * haze is fairly broad.
 */
const FOG_SUN_EXPONENT = 2.5;

/**
 * Seconds to cross-fade when the environment changes (biome border).
 * Valheim eases between EnvSetups rather than snapping.
 */
const ENV_BLEND_SECONDS = 4;

/**
 * EnvColor in ein GEHALTENES Color3 schreiben.
 *
 * `apply()` läuft in jedem Frame, und jedes `new Color3(...)` darin ist
 * Müll, den der GC in regelmässigen Abständen einsammelt — genau die
 * Sorte Pause, die beim Laufen als Ruckler auffällt. Das Muster steht in
 * dieser Datei schon (`fogColorLinear`: „wird pro Frame in place
 * aktualisiert, nie ersetzt"), es war nur nicht durchgezogen.
 */
const inColor3 = (c: EnvColor, ziel: Color3): Color3 => ziel.set(c.r, c.g, c.b);

/**
 * ── Farbraum ─────────────────────────────────────────────────────────
 * Die EnvSetup-Werte sind Unity-Inspector-Farben, also GAMMA (sRGB).
 * Valheim rendert im Linear-Farbraum, Unity konvertiert sie deshalb beim
 * Setzen von `RenderSettings.ambientLight` / `Light.color` selbst.
 *
 * Unsere Pipeline rechnet ebenfalls linear: `PostProcessing` hängt einen
 * ImageProcessing-Pass mit Tonemapping an, der die Materialausgabe als
 * linear liest und am Ende nach Gamma wandelt. Nachgemessen am
 * 2026-07-31 (Nebelfarbe gesetzt → Pixel gelesen, 8 Stützstellen):
 *
 *   Bildschirm = toGamma(KHR_PBR_Neutral(Materialausgabe))
 *
 * Wer Gamma-Werte ungewandelt hineinschreibt, wird also aufgehellt — und
 * zwar nichtlinear: 0.65 (Tagnebel) → 0.83 (+28 %), 0.083 (Nachtnebel)
 * → 0.33 (+300 %). Genau daher kam der nachts aufgehellte Boden im
 * Screenshot vom 2026-07-31: Die Bäume sind PBRMaterial und wurden
 * korrekt dunkel (gemessen RGB 4), das Terrain-NodeMaterial schrieb den
 * rohen Nebelwert und wurde hellgrau (gemessen RGB 61) — ein Faktor 15
 * zwischen zwei Flächen, die dieselbe Nebelfarbe zeigen sollten.
 *
 * Deshalb geht ab hier alles LINEAR in die Szene. Zwei Ausnahmen, die
 * keine sind:
 *  · `scene.fogColor` bleibt GAMMA, weil Babylon diesen Wert per
 *    Definition als Gamma führt und ihn für PBR selbst linearisiert
 *    (materialHelper.functions.js, `BindFogParameters(..., true)`).
 *    Wer ihn nicht linearisiert (StandardMaterial, NodeMaterial), holt
 *    sich `fogColorLinear` — siehe unten.
 *  · Texturen bleiben unverändert. Sie sind der zweite Halbschritt zum
 *    vollständig linearen Workflow und verschieben die handgetunten
 *    Albedo-Werte, deshalb bewusst nicht in dieser Änderung.
 */
const inLinear = (c: EnvColor, ziel: Color3): Color3 => {
  ziel.set(c.r, c.g, c.b);
  // In place: toLinearSpaceToRef liest jeden Kanal, bevor es ihn schreibt,
  // Quelle und Ziel dürfen also dasselbe Objekt sein.
  ziel.toLinearSpaceToRef(ziel);
  return ziel;
};

function lerpEnvColor(a: EnvColor, b: EnvColor, t: number): EnvColor {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Blend two evaluated states — used for the biome cross-fade. */
function lerpEnvState(a: EnvState, b: EnvState, t: number): EnvState {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    fogColor: lerpEnvColor(a.fogColor, b.fogColor, t),
    fogColorSun: lerpEnvColor(a.fogColorSun, b.fogColorSun, t),
    fogDensity: l(a.fogDensity, b.fogDensity),
    sunColor: lerpEnvColor(a.sunColor, b.sunColor, t),
    ambColor: lerpEnvColor(a.ambColor, b.ambColor, t),
    lightIntensity: l(a.lightIntensity, b.lightIntensity),
    cloudAlpha: l(a.cloudAlpha, b.cloudAlpha),
    // direction/elevation come from the day fraction, not the weather, so
    // both states agree — take the target to avoid drift during the fade
    lightDir: b.lightDir,
    sunDir: b.sunDir,
    isNight: b.isNight,
    elevation: b.elevation,
  };
}

export class Lighting {
  readonly sun: DirectionalLight;
  readonly ambient: HemisphericLight;
  readonly sky: ValheimSky;

  /** 0..1, 0 = midnight, 0.5 = midday (EnvMan day fraction). */
  timeOfDay = 0.33;
  paused = false;

  /** Currently active environment (after any cross-fade completes). */
  private env: EnvSetup;
  /** Environment being faded out, if a change is in progress. */
  private prevEnv: EnvSetup | null = null;
  private blend = 1;

  /** Last evaluated state — exposed for HUD/debug. */
  state: EnvState;

  /**
   * `scene.fogColor` in LINEAR — für alle Materialien, die Babylon nicht
   * selbst umrechnet (StandardMaterial, das Terrain-NodeMaterial). Wird
   * in `apply()` pro Frame in place aktualisiert, nie ersetzt: Der
   * StandardMaterial-Hook unten hält eine Referenz darauf.
   */
  readonly fogColorLinear = new Color3();

  /**
   * Gehaltene Puffer für `apply()` — dieselbe Begründung wie bei
   * `fogColorLinear`, nur konsequent für ALLE Farben dieses Pfads.
   *
   * Vorher entstanden pro Frame rund zehn Color3 und ein Color4: zweimal
   * `toLinear(sunColor)`, `toLinear(ambColor)` samt `scale(0.5)`, die
   * beiden Nebelfarben, das Ergebnis von `Color3.Lerp`, das `new Color4`
   * für `clearColor` — und in `directionalFogColor` zusätzlich ein
   * kompletter `Ray` samt zwei Vector3 aus `camera.getForwardRay()`.
   *
   * Die Ziele (`sun.diffuse`, `ambient.diffuse`, `scene.fogColor`,
   * `scene.clearColor`) bekommen diese Objekte EINMAL im Konstruktor
   * zugewiesen und werden danach nur noch in place beschrieben; Babylon
   * liest sie bei jedem Bind neu aus.
   */
  private readonly sonnenFarbe = new Color3();
  private readonly sonnenGlanz = new Color3();
  private readonly ambFarbe = new Color3();
  private readonly ambBoden = new Color3();
  /** Identisch mit `scene.fogColor` (GAMMA, s. Farbraum-Block). */
  private readonly nebelFarbe = new Color3();
  private readonly nebelSonnenFarbe = new Color3();
  /** Identisch mit `scene.clearColor` (LINEAR, geht direkt in den Puffer). */
  private readonly hintergrund = new Color4(0, 0, 0, 1);
  private readonly zurSonne = new Vector3();
  private readonly blickStrahl = new Ray(Vector3.Zero(), Vector3.Zero(), 100);

  constructor(private readonly scene: Scene) {
    this.env = findEnvironment(ENV_CLEAR)!;

    this.sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
    this.ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    // Einmal verdrahten, danach nur noch beschreiben (s. oben).
    this.sun.diffuse = this.sonnenFarbe;
    this.sun.specular = this.sonnenGlanz;
    this.ambient.diffuse = this.ambFarbe;
    this.ambient.groundColor = this.ambBoden;
    scene.fogColor = this.nebelFarbe;
    scene.clearColor = this.hintergrund;

    // Sky dome fed from the same EnvState as the fog — see ValheimSky.ts
    // for why Babylon's SkyMaterial (Preetham) cannot match the fog colour.
    this.sky = new ValheimSky(scene);

    scene.fogMode = Scene.FOGMODE_EXP2;

    this.bindeLinearenNebel();

    this.state = evaluateEnv(this.env, this.timeOfDay);
    this.apply(0);
  }

  /**
   * StandardMaterial bekommt `scene.fogColor` ungewandelt (Babylon ruft
   * `BindFogParameters` ohne `linearSpace`, weil StandardMaterial
   * ursprünglich für eine Gamma-Pipeline gebaut wurde). In unserer
   * linearen Pipeline ist das genau der Fehler, der den Nebel aufhellt —
   * also schieben wir den linearen Wert nach dem Standard-Bind nach.
   *
   * `_afterBind()` (und damit `onBindObservable`) läuft NACH
   * `BindFogParameters` (standardMaterial.js), der Wert überlebt also.
   * Trifft der Uniform nicht zu (Material ohne Nebel), ist `setColor3`
   * ein No-Op — Babylon prüft die Uniform-Location.
   *
   * Bewusst über `onNewMaterialAddedObservable` statt an den einzelnen
   * Erzeugungsstellen: Gras, Wasser, Avatar und Platzierungsmarker
   * entstehen in fünf verschiedenen Dateien und zu unterschiedlichen
   * Zeitpunkten, und jedes künftige StandardMaterial soll den Nebel
   * ebenfalls richtig zeigen, ohne dass man daran denken muss.
   */
  private bindeLinearenNebel(): void {
    const haenge = (m: Material): void => {
      if (!(m instanceof StandardMaterial)) return;
      m.onBindObservable.add(() => {
        m.getEffect()?.setColor3('vFogColor', this.fogColorLinear);
      });
    };
    for (const m of this.scene.materials) haenge(m);
    this.scene.onNewMaterialAddedObservable.add(haenge);
  }

  /** Active environment name (HUD). */
  get environmentName(): string {
    return this.env.name;
  }

  /**
   * Switch to the default weather of `biome`, cross-fading from the
   * current one. Cheap to call every frame — a no-op unless the resolved
   * environment actually differs.
   */
  setBiome(biome: Biome): void {
    this.setEnvironment(environmentForBiome(biome));
  }

  /** Force a specific weather (console `env <name>` equivalent). */
  setEnvironmentByName(name: string): boolean {
    const env = findEnvironment(name);
    if (!env) return false;
    this.setEnvironment(env);
    return true;
  }

  private setEnvironment(env: EnvSetup): void {
    if (env === this.env) return;
    // Fade out whatever is on screen right now, not the previous target —
    // otherwise a second biome change mid-fade snaps.
    this.prevEnv = this.env;
    this.env = env;
    this.blend = 0;
  }

  /** Advance the cycle and push the resulting state into the scene. */
  apply(dtSeconds: number): void {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + dtSeconds / WORLD_TIME_LENGTH) % 1;
    }

    let state = evaluateEnv(this.env, this.timeOfDay);
    if (this.prevEnv) {
      this.blend = Math.min(1, this.blend + dtSeconds / ENV_BLEND_SECONDS);
      state = lerpEnvState(evaluateEnv(this.prevEnv, this.timeOfDay), state, this.blend);
      if (this.blend >= 1) this.prevEnv = null;
    }
    this.state = state;

    // ── Sun / moon ────────────────────────────────────────────────
    // Lichtfarben gehen linear in die Szene (siehe Farbraum-Block oben);
    // Babylon rechnet Light.diffuse nirgends um.
    this.sun.direction.set(state.lightDir.x, state.lightDir.y, state.lightDir.z);
    this.sun.direction.normalize();
    inLinear(state.sunColor, this.sonnenFarbe);
    this.sonnenGlanz.copyFrom(this.sonnenFarbe);
    this.sun.intensity = state.lightIntensity;

    // ── Ambient ───────────────────────────────────────────────────
    // ambColorNight ist bei "Misty" (0.357, 0.361, 0.404) — als linearer
    // Faktor gelesen war das nachts rund dreimal zu viel Grundlicht und
    // der zweite Grund, warum der Boden im Dunkeln nicht dunkel wurde.
    const amb = inLinear(state.ambColor, this.ambFarbe);
    amb.scaleToRef(0.5, this.ambBoden);
    this.ambient.intensity = 1;

    // ── Sky ───────────────────────────────────────────────────────
    // The dome derives horizon/glow from this same state, so it fuses with
    // the fog instead of being a separate backdrop.
    this.sky.update(state, dtSeconds);

    // ── Fog (see the file header for the per-frame trade-off) ──────
    // `scene.fogColor` bleibt GAMMA — das ist Babylons Konvention, und
    // PBR linearisiert selbst. Alle anderen Pfade lesen fogColorLinear.
    this.scene.fogDensity = state.fogDensity;
    // Schreibt in `nebelFarbe`, und das IST `scene.fogColor` (Konstruktor).
    this.directionalFogColorToRef(state, this.nebelFarbe);
    this.nebelFarbe.toLinearSpaceToRef(this.fogColorLinear);
    // clearColor geht ohne Material direkt in den Framebuffer, ist also
    // schon der lineare Wert, den der ImageProcessing-Pass erwartet.
    this.hintergrund.set(
      this.fogColorLinear.r,
      this.fogColorLinear.g,
      this.fogColorLinear.b,
      1
    );
  }

  /**
   * Valheim's two-colour fog collapsed to this frame's view direction:
   * `fogColorSun` when looking towards the sun, `fogColor` away from it.
   */
  private directionalFogColorToRef(state: EnvState, ziel: Color3): Color3 {
    inColor3(state.fogColor, ziel);
    const camera = this.scene.activeCamera;
    if (!camera) return ziel; // before PlayerController exists

    // `getForwardRay()` legt pro Aufruf einen frischen Ray samt zwei
    // Vector3 an — bei 60 Hz ist das der teuerste Posten dieser Methode.
    // Die ToRef-Variante schreibt in den gehaltenen Strahl und liefert die
    // Richtung bereits normalisiert (Culling/ray.core: NormalizeToRef).
    const forward = camera.getForwardRayToRef(this.blickStrahl).direction;
    // lightDir points sun→scene, so the direction TOWARDS the sun is -lightDir
    const toSun = this.zurSonne
      .set(-state.lightDir.x, -state.lightDir.y, -state.lightDir.z)
      .normalize();
    const facing = Math.max(0, Vector3.Dot(forward, toSun));
    const t = Math.pow(facing, FOG_SUN_EXPONENT);
    // LerpToRef darf links und Ziel teilen — es liest jeden Kanal, bevor
    // es ihn schreibt.
    Color3.LerpToRef(ziel, inColor3(state.fogColorSun, this.nebelSonnenFarbe), t, ziel);
    return ziel;
  }
}
