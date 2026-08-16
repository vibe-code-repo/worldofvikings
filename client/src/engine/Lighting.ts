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
 * a true per-pixel gradient needs a custom shader path in every material
 * family the scene uses.
 *
 * ── Seit 2026-08-16 läuft der Blend pro Pixel ─────────────────────────
 * Vorher rechnete diese Datei den Sonnen-/Blick-Term EINMAL PRO FRAME aus
 * dem Kamera-Forward und schrieb das Ergebnis in `scene.fogColor`. Das
 * galt einheitlich für alle Materialien und kostete nichts, hatte aber
 * einen Ton, der über das ganze Bild konstant war: Richtung
 * Sonnenuntergang zu drehen wärmte das gesamte Bild, statt nur um die
 * Sonne herum zu glühen — und am Horizont lief es sichtbar gegen die
 * Himmelskuppel, die ihren Schein längst pro Pixel malt.
 *
 * Diese Datei liefert deshalb jetzt BEIDE Farben plus die Sonnenrichtung
 * an drei Stellen aus, und der Blend passiert im Shader:
 *
 *   Standard + PBR   `engine/NebelRichtung.ts` ersetzt die Mischzeile in
 *                    `fogFragment`; Richtung im SICHTRAUM (`vFogDistance`)
 *   Terrain          eigene Nebelkette im NodeMaterial
 *                    (`TerrainSplat.setzeUmgebung`); Richtung in
 *                    WELTKOORDINATEN, weil die Kette dort ohnehin mit
 *                    `worldPos − cameraPos` rechnet
 *
 * `scene.fogColor` trägt seitdem die UNGEMISCHTE Farbe (Blick von der
 * Sonne weg). Wer sie ohne den Sonnenterm liest, bekommt also den
 * kühleren der beiden Töne — das ist für `clearColor` richtig so und für
 * alles andere die Farbe, von der aus gemischt wird.
 *
 * Der Exponent ist unverändert aus der CPU-Fassung übernommen
 * (`FOG_SUN_EXPONENT`, jetzt in `NebelRichtung.ts`): Der Umbau verschiebt
 * den Ort der Rechnung, nicht die Abstimmung.
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import { Color3, Color4, Vector3 } from '@babylonjs/core/Maths/math';
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

// Der Exponent des Sonnen-/Blick-Terms steht jetzt bei dem Code, der ihn
// auswertet — dem Shader-Plugin. Siehe NebelRichtung.FOG_SUN_EXPONENT.

/**
 * Wie viel des diffusen Grundlichts aus der Himmelskuppel kommt statt aus
 * dem HemisphericLight (Grafik-Konzept Stufe 5).
 *
 * Seit die Sky-Probe als `scene.environmentTexture` hängt, gibt es zwei
 * Quellen für dasselbe Grundlicht. Beide voll laufen zu lassen hiesse, es
 * doppelt zu zählen — das Bild würde heller und flacher, also genau
 * zurück in den Zustand, den Stufe 1 behoben hat.
 *
 * Der Wert ist NICHT frei gewählt, sondern die Grenze dessen, was
 * begründbar ist: Die Kugelharmonischen tragen die Richtung (abends warm
 * von der Sonnenseite, nachts kalt von oben), das HemisphericLight trägt
 * den Rest als flachen Sockel. Ein voller Umstieg auf 1.0 wäre die
 * sauberere Physik, würde aber alle Materialien ohne PBR-Pfad — den
 * Clutter, den Avatar, das Wasser — ohne jedes Grundlicht dastehen
 * lassen: `scene.environmentTexture` wirkt nur auf PBR.
 *
 * Genau deshalb bleibt hier ein Rest stehen, und genau deshalb ist die
 * Zahl eine Abwägung und keine Messung.
 *
 * ── Was die Messung dazu sagt (16.08.2026, RX 7900 XT) ──────────────
 * Mittlere Bildhelligkeit und Tonwertstreuung, gleiche Kamera, gleiche
 * Uhrzeit, nur diese Änderung an und aus:
 *
 *   Tag  (t = 0.30)   56,5 → 54,7  (−3 %)    Streuung 13,7 → 12,6
 *   Nacht             20,5 → 15,2  (−26 %)   Streuung  7,4 →  5,3
 *
 * **Bei Tag geht die Rechnung auf, nachts nicht.** Der Grund steckt im
 * Aufbau: Was die Kuppel an Licht liefert, skaliert mit ihrer eigenen
 * Helligkeit — nachts ist sie fast dunkel. Der Abzug hier ist dagegen
 * fest. Nachts wird also etwas weggenommen, das gar nicht ersetzt wird.
 *
 * Ob das ein Fehler ist, ist keine technische Frage: Die Rendering-Doku
 * führt „der Boden wird im Dunkeln nicht dunkel" ausdrücklich als Mangel,
 * und in diese Richtung geht die Änderung. Die Streuung sinkt allerdings
 * mit, und Streuung ist Tiefe.
 *
 * Der saubere Weg wäre einer von zweien, beide nicht mitgeliefert:
 *  · den Abzug an die tatsächliche Kuppelhelligkeit koppeln — die
 *    Konstante der Kugelharmonischen liegt in `berechneUmgebungslicht()`
 *    ohnehin vor, es fehlt allein ein Bezugswert, und der wäre wieder
 *    geraten;
 *  · oder die Quellen sauber trennen: PBR-Meshes aus dem
 *    HemisphericLight ausschliessen, damit JEDES Material genau eine
 *    Grundlichtquelle hat. Exakt, aber es hängt an Layer-Masken, die
 *    zugleich das Kamera-Culling steuern.
 */
const AMBIENT_ANTEIL_HIMMEL = 0.5;

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
   * Die zweite Nebelfarbe (Blick ZUR Sonne) in LINEAR — das Gegenstück zu
   * `fogColorLinear`, aus dem der Shader pro Pixel mischt. Ebenfalls in
   * place aktualisiert, weil der Material-Hook unten eine Referenz hält.
   */
  readonly fogColorSonnenLinear = new Color3();

  /**
   * Richtung ZUR Sonne in WELTKOORDINATEN, normalisiert. Für das
   * Terrain-NodeMaterial, dessen Nebelkette mit `worldPos − cameraPos`
   * rechnet.
   */
  readonly zurSonneWelt = new Vector3(0, 1, 0);

  /**
   * Dieselbe Richtung im SICHTRAUM — für Standard und PBR, die den
   * Sehstrahl aus `vFogDistance` beziehen (siehe `NebelRichtung.ts`).
   *
   * Einmal pro Frame umgerechnet statt einmal je Material: Die
   * View-Matrix gilt für die ganze Szene, und `apply()` läuft ohnehin
   * genau einmal.
   */
  readonly zurSonneSicht = new Vector3(0, 1, 0);

  /**
   * Gehaltene Puffer für `apply()` — dieselbe Begründung wie bei
   * `fogColorLinear`, nur konsequent für ALLE Farben dieses Pfads.
   *
   * Vorher entstanden pro Frame rund zehn Color3 und ein Color4: zweimal
   * `toLinear(sunColor)`, `toLinear(ambColor)` samt `scale(0.5)`, die
   * beiden Nebelfarben, das Ergebnis von `Color3.Lerp`, das `new Color4`
   * für `clearColor` — und in `directionalFogColor` zusätzlich ein
   * kompletter `Ray` samt zwei Vector3 aus `camera.getForwardRay()`.
   * Letzterer ist mit dem Umzug des Blends in den Shader ganz entfallen.
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
  /** GAMMA-Zwischenschritt für `fogColorSonnenLinear`. */
  private readonly nebelSonnenFarbe = new Color3();
  /** Identisch mit `scene.clearColor` (LINEAR, geht direkt in den Puffer). */
  private readonly hintergrund = new Color4(0, 0, 0, 1);

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

    // ── Umgebungslicht aus der Himmelskuppel (Grafik-Konzept Stufe 5) ──
    //
    // Ab hier beleuchtet der Himmel die Szene, statt nur hinter ihr zu
    // hängen: PBR-Materialien nehmen aus dieser Würfelkarte ihre
    // Spiegelung, und aus deren `sphericalPolynomial` (rechnet
    // `ValheimSky.berechneUmgebungslicht()`) ihr diffuses Grundlicht.
    //
    // Die Probe lief bereits für das Wasser — die Renderkosten entstehen
    // hier also nicht neu, sie werden nur ein zweites Mal genutzt.
    //
    // Was das optisch bringt, ist genau das, was ein
    // HemisphericLight NICHT kann: eine RICHTUNG. Das Grundlicht kommt
    // damit von dort, wo der Himmel hell ist — abends warm von der
    // Sonnenseite, nachts kalt von oben —, statt als eine einzige
    // Farbe von überall.
    scene.environmentTexture = this.sky.probe.cubeTexture;
    // Die Umgebungsintensität ist der Regler, mit dem das Grundlicht aus
    // dem Himmel gegen das Hemispheric-Licht abgewogen wird; die
    // Aufteilung steht bei `AMBIENT_ANTEIL_HIMMEL`.
    scene.environmentIntensity = 1;

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
      const standard = m instanceof StandardMaterial;
      const pbr = m instanceof PBRBaseMaterial;
      if (!standard && !pbr) return;
      m.onBindObservable.add(() => {
        const effekt = m.getEffect();
        if (!effekt) return;
        // Nur StandardMaterial braucht die Korrektur — PBR bindet Babylon
        // bereits linear (`BindFogParameters(..., linearSpace = true)`).
        if (standard) effekt.setColor3('vFogColor', this.fogColorLinear);
        // Die zwei Uniforms des gerichteten Nebels. Sie existieren nur in
        // Shadern, die `NebelRichtung` dekoriert hat; bei allen anderen ist
        // `setColor3`/`setVector3` ein No-Op, weil Babylon die
        // Uniform-Location prüft. Deshalb steht hier keine Fallunterscheidung
        // nach Materialart, sondern nur eine nach Farbraum.
        effekt.setColor3('vFogColorSonne', this.fogColorSonnenLinear);
        effekt.setVector3('vZurSonneSicht', this.zurSonneSicht);
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
    // Seit die Himmelskuppel als Umgebungslicht dient (Stufe 5), kommt das
    // Grundlicht aus ZWEI Quellen. Ohne diese Aufteilung zählte es doppelt
    // und das Bild würde flach und zu hell — genau der Zustand, den Stufe 1
    // beseitigt hat. Der Faktor steht bei `AMBIENT_ANTEIL_HIMMEL`.
    this.ambient.intensity = 1 - AMBIENT_ANTEIL_HIMMEL;

    // ── Sky ───────────────────────────────────────────────────────
    // The dome derives horizon/glow from this same state, so it fuses with
    // the fog instead of being a separate backdrop.
    this.sky.update(state, dtSeconds);

    // ── Nebel (Blend pro Pixel — siehe Kopfkommentar) ──────────────
    // `scene.fogColor` bleibt GAMMA — das ist Babylons Konvention, und
    // PBR linearisiert selbst. Alle anderen Pfade lesen fogColorLinear.
    this.scene.fogDensity = state.fogDensity;
    // Schreibt in `nebelFarbe`, und das IST `scene.fogColor` (Konstruktor).
    // UNGEMISCHT: den Sonnenterm legt der Shader je Pixel darüber.
    inColor3(state.fogColor, this.nebelFarbe);
    this.nebelFarbe.toLinearSpaceToRef(this.fogColorLinear);
    inColor3(state.fogColorSun, this.nebelSonnenFarbe);
    this.nebelSonnenFarbe.toLinearSpaceToRef(this.fogColorSonnenLinear);

    // `lightDir` zeigt von der Sonne in die Szene — ZUR Sonne ist also
    // das Gegenteil. Dieselbe Quelle wie vorher in der CPU-Fassung.
    this.zurSonneWelt
      .set(-state.lightDir.x, -state.lightDir.y, -state.lightDir.z)
      .normalize();
    // In den Sichtraum drehen, weil Standard und PBR den Sehstrahl aus
    // `vFogDistance` beziehen und der dort liegt. `TransformNormal`
    // (nicht `TransformCoordinates`) — eine Richtung hat keinen Ort, und
    // die Translation der View-Matrix würde sie sonst verschieben.
    //
    // Zwei Fallstricke stecken in diesen drei Zeilen, beide gemessen statt
    // vermutet — sie haben den Client nacheinander beim Start zerlegt:
    //
    //  1. Der Konstruktor ruft `apply()` selbst auf, und da gibt es die
    //     Kamera des PlayerControllers noch nicht. Ohne die Abfrage stirbt
    //     `TransformNormalToRef` beim Zugriff auf die Matrix. Gerendert
    //     wird ohne Kamera ohnehin nichts.
    //  2. `scene.getViewMatrix()` ist NICHT dasselbe wie
    //     `camera.getViewMatrix()`. Die Szene reicht nur den zuletzt
    //     berechneten Wert durch, und der entsteht erst mitten in
    //     `scene.render()` — in einem `onBeforeRender`-Beobachter ist er
    //     im ersten Frame noch gar nicht da. Die Kamera dagegen rechnet
    //     bei Bedarf nach und liefert immer eine gültige Matrix.
    const kamera = this.scene.activeCamera;
    if (kamera) {
      Vector3.TransformNormalToRef(
        this.zurSonneWelt,
        kamera.getViewMatrix(),
        this.zurSonneSicht
      );
      // Die View-Matrix ist orthonormal, die Länge bleibt also 1 — bis auf
      // Rundung. Der Shader potenziert das Skalarprodukt, und ein Wert
      // knapp über 1 bliebe dabei knapp über 1; normalisieren kostet hier
      // einmal pro Frame und nimmt der Frage jede Bedeutung.
      this.zurSonneSicht.normalize();
    }

    // clearColor geht ohne Material direkt in den Framebuffer, ist also
    // schon der lineare Wert, den der ImageProcessing-Pass erwartet.
    // Ohne Material gibt es auch keinen Sehstrahl — hier bleibt es
    // zwangsläufig bei der ungemischten Farbe. Sichtbar ist das nirgends:
    // Die Himmelskuppel deckt jeden Pixel ab, den sonst clearColor füllte.
    this.hintergrund.set(
      this.fogColorLinear.r,
      this.fogColorLinear.g,
      this.fogColorLinear.b,
      1
    );
  }
}
