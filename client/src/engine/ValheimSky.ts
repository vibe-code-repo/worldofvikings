/**
 * ValheimSky — stylised sky dome driven by the SAME EnvSetup data as the fog.
 *
 * ── Why not Babylon's SkyMaterial ────────────────────────────────────
 * `@babylonjs/materials/sky` implements the **Preetham analytic daylight
 * model**: it derives the sky colour physically from turbidity and the sun
 * position, and it has no knowledge whatsoever of Valheim's EnvSetup
 * colours. That is a real defect, not a matter of taste — the horizon it
 * paints CANNOT match `scene.fogColor`, so sky and fog visibly disagree
 * exactly where they meet. In Valheim they match by construction: the
 * horizon *is* the fog colour, which is why the world reads as one
 * atmosphere instead of a backdrop behind a foggy scene.
 *
 * Valheim's sky is also not physical to begin with — it is a stylised
 * vertical gradient with a sun/moon disc, stars and scrolling cloud
 * layers, in the same family as the well-known stylised-skybox recipe
 * (three-stop gradient, sun/moon from the directional light, stars masked
 * by `1 - clouds`).
 *
 * So this dome is built from the environment model instead:
 *   horizon  = state.fogColor         → fuses with the fog, by definition
 *   zenith   = fogColor deepened      → the vertical gradient
 *   sun glow = state.fogColorSun      → ties the glow to the same keyframes
 *   sun/moon disc at the TRUE sun direction (below horizon at night)
 *   stars    fade in with night, masked by clouds
 *   clouds   procedural FBM, coverage from EnvSetup.rainCloudAlpha
 *
 * Everything is procedural: no ripped sky textures, so this needs nothing
 * from the 4.9 GB asset export. Swapping in the real cloud/star textures
 * later is a texture bind, not a rewrite.
 *
 * Implementation note: a raw `ShaderMaterial` (not NodeMaterial) because
 * the dome needs a handful of trig/noise operations that are far clearer —
 * and cheaper to review — as GLSL than as a node graph. Rendered on a
 * back-face sphere with `infiniteDistance`, depth-write off, fog off.
 */
import { Effect } from '@babylonjs/core/Materials/effect';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe';
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial';
// SEITENEFFEKT, nicht wegoptimieren: `BaseTexture.sphericalPolynomial` ist
// eine Modul-Erweiterung und existiert bei den granularen Imports dieses
// Projekts nur, wenn diese Datei geladen wurde. Ohne sie geht die
// Zuweisung unten still ins Leere — dieselbe Klasse von Fallstrick wie der
// fehlende PrePass-Scene-Component in PostProcessing.ts.
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import type { EnvState } from '@wov/shared';

const SHADER_NAME = 'valheimSky';

/**
 * Abtastrichtungen für die Kugelharmonischen des Umgebungslichts.
 * 128 sind für neun Koeffizienten reichlich — die zweite Bande ist bei
 * einem so glatten Verlauf ohnehin fast leer.
 */
const IBL_RICHTUNGEN = 128;
/** Sekunden zwischen zwei Neuberechnungen — Begründung an der Methode. */
const IBL_ABSTAND_S = 2;
/** Goldener Winkel in Radiant: π · (3 − √5). */
const GOLDENER_WINKEL = Math.PI * (3 - Math.sqrt(5));

/**
 * Der Himmelsverlauf als eigenständige GLSL-Funktion — EINE Quelle für die
 * Kuppel und für die Spiegelung im Wasser.
 *
 * ── Warum das geteilt wird ──────────────────────────────────────────
 * Das Wasser las vorher stumpf `state.fogColorSun`, also die Farbe
 * RICHTUNG SONNE, und mischte sie mit bis zu 75 % über die ganze Fläche —
 * unabhängig davon, wohin man blickt. Bei `fogColorSun` (0.92, 0.55,
 * 0.32) am Abend landet man damit bei rund (0.50, 0.30, 0.17): ein
 * flächendeckendes Braun in JEDE Blickrichtung. Genau das hat der Nutzer
 * als "merkwürdige braune Spiegelungen" gemeldet.
 *
 * Für den Nebel macht `Lighting.directionalFogColor()` längst eine
 * Blickrichtungs-Mischung — das Wasser umging sie als einziges.
 *
 * Statt dem Wasser jetzt EINE besser gewählte Farbe zu reichen, wertet es
 * dieselbe Funktion an der Spiegelrichtung aus. Konsistenz zwischen
 * Kuppel und Wasserspiegel ist damit strukturell garantiert und nicht
 * das Ergebnis von Nachjustieren.
 *
 * Bewusst NICHT enthalten: Sonnenscheibe, Wolken und Sterne. Die brauchen
 * die Zusatz-Uniforms und das FBM der Kuppel, und in der bewegten
 * Spiegelung einer Wasserfläche wäre davon ohnehin kaum etwas zu
 * erkennen. Wer sie will, nimmt eine ReflectionProbe mit
 * `renderList = [sky.mesh]` — der Verlauf hier bleibt dann die Grundlage,
 * über die sie geblendet wird.
 *
 * `toSun` zeigt ZUR Sonne (wie `EnvState.sunDir`), nicht in
 * Lichtausbreitungsrichtung.
 */
export const SKY_GRADIENT_GLSL = /* glsl */ `
vec3 vhSkyGradient(vec3 dir, vec3 horizon, vec3 zenith, vec3 sunGlow, vec3 toSun, float night) {
  // Zum Horizont hin gestaucht, damit der Himmel dort als "dicke Luft"
  // liest. Exponentiell statt pow(up, 0.45): pow hat bei up=0 eine
  // UNENDLICHE Steigung und setzt damit eine sichtbar harte Kante genau
  // auf den Horizont. exp hat dort eine endliche Steigung und trifft die
  // Null trotzdem exakt — und t(0)=0 ist das, was den Horizont gleich
  // der Nebelfarbe macht.
  float t = 1.0 - exp(-3.2 * max(clamp(dir.y, -1.0, 1.0), 0.0));
  vec3 col = mix(horizon, zenith, t);
  // Breiter Glow: hält die Abendwärme über den Himmel verteilt.
  float sunDot = dot(dir, toSun);
  return mix(col, sunGlow, pow(max(sunDot, 0.0), 8.0) * 0.55 * (1.0 - night));
}
`;

const VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  // Direction from the dome centre — the only thing the sky needs.
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform vec3 uHorizon;     // = EnvState.fogColor  (matches the scene fog)
uniform vec3 uZenith;      // deepened horizon colour
uniform vec3 uSunGlow;     // = EnvState.fogColorSun
uniform vec3 uSunColor;    // = EnvState.sunColor
uniform vec3 uSunDir;      // TRUE sun direction, y<0 after sunset
uniform float uNight;      // 0 = full day, 1 = full night
uniform float uCloud;      // coverage 0..1 (EnvSetup.rainCloudAlpha)
uniform float uTime;       // seconds, drives cloud drift

${SKY_GRADIENT_GLSL}

// ── value noise + fbm (cheap, no texture needed) ──────────────────
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

/**
 * 3D hash for the star field. Deliberately NOT the sin()-based hash above:
 * star cells are quantised direction * 220, so the inputs reach ~+-220 and
 * sin(dot(p, big)) * 43758 loses all precision in float32 there — it
 * degenerates and produced a completely EMPTY night sky (measured: 0 bright
 * pixels). This is the standard sine-free integer hash, which stays well
 * distributed at those magnitudes.
 */
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Star field: sparse bright points from a thresholded hash on a quantised
// direction, so they stay fixed to the sky instead of swimming.
float stars(vec3 dir) {
  vec3 q = floor(dir * 220.0);
  float h = hash31(q);
  float s = smoothstep(0.997, 1.0, h);
  // twinkle
  return s * (0.7 + 0.3 * sin(uTime * 2.0 + h * 100.0));
}

void main(void) {
  vec3 dir = normalize(vDir);
  float up = clamp(dir.y, -1.0, 1.0);

  // ── vertical gradient + broad sun glow ──────────────────────────
  // Beides steckt in vhSkyGradient (siehe SKY_GRADIENT_GLSL oben) —
  // dieselbe Funktion wertet das WaterPlugin an der Spiegelrichtung aus.
  //
  // max(up, 0.0) darin lässt die GESAMTE untere Halbkugel auf exakt
  // uHorizon, also exakt scene.fogColor — wo die Kuppel unter dem
  // Horizont sichtbar wird (über Wasser, einen Hang hinunter) hat sie
  // damit schon die Farbe, gegen die der Nebel läuft, und es gibt keine
  // Naht zu verstecken. Ein früherer Versuch, unterhalb abzudunkeln, sah
  // plausibel aus, brach aber genau diese Eigenschaft (Nebel-Übereinstimmung
  // ging von 0.002 auf 0.155) — deshalb fehlt er bewusst.
  vec3 toSun = normalize(uSunDir);
  vec3 col = vhSkyGradient(dir, uHorizon, uZenith, uSunGlow, toSun, uNight);

  // ── sun / moon ──────────────────────────────────────────────────
  float sunDot = dot(dir, toSun);
  // tight disc — sun by day, moon by night (the moon is the same direction
  // mirrored, so use -sunDir once the sun is down)
  float disc = smoothstep(0.9995, 0.9999, sunDot);
  col += uSunColor * disc * 3.0 * (1.0 - uNight);
  float moonDot = dot(dir, normalize(-uSunDir));
  float moonDisc = smoothstep(0.9992, 0.9998, moonDot);
  float moonGlow = pow(max(moonDot, 0.0), 64.0);
  col += vec3(0.75, 0.8, 0.95) * (moonDisc * 2.0 + moonGlow * 0.25) * uNight;

  // ── clouds ──────────────────────────────────────────────────────
  // Project onto a plane above the viewer; guard the horizon so the
  // division doesn't explode as dir.y -> 0.
  float h = max(up, 0.06);
  vec2 cp = dir.xz / h;
  float c1 = fbm(cp * 1.2 + vec2(uTime * 0.006, uTime * 0.004));
  float c2 = fbm(cp * 2.6 - vec2(uTime * 0.011, uTime * 0.008));
  float clouds = clamp((c1 * 0.65 + c2 * 0.35) * 1.6 - (1.25 - uCloud * 1.15), 0.0, 1.0);
  // fade clouds out at the horizon so they don't form a hard band
  clouds *= smoothstep(0.0, 0.28, up);
  // lit from the sun side by day, dim blue-grey by night
  vec3 cloudLit = mix(uSunGlow * 0.9 + uSunColor * 0.25, uHorizon * 1.1, uNight);
  vec3 cloudDark = mix(uHorizon * 0.75, uHorizon * 0.5, uNight);
  vec3 cloudCol = mix(cloudDark, cloudLit, pow(max(sunDot, 0.0), 2.0) * 0.6 + 0.4);

  // ── stars (behind the clouds) ───────────────────────────────────
  // uNight squared: stars should vanish quickly once the sky starts to
  // brighten. At dusk/dawn uNight is still ~0.44, and a linear fade left
  // them clearly visible against an already-blue sky.
  col += vec3(stars(dir)) * uNight * uNight * (1.0 - clouds) * smoothstep(0.0, 0.15, up);

  col = mix(col, cloudCol, clouds);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

let registered = false;
function registerShader(): void {
  if (registered) return;
  Effect.ShadersStore[`${SHADER_NAME}VertexShader`] = VERTEX;
  Effect.ShadersStore[`${SHADER_NAME}FragmentShader`] = FRAGMENT;
  registered = true;
}

export class ValheimSky {
  readonly mesh: Mesh;
  /**
   * Würfelkarte des Himmels für die Wasserspiegelung — mit Wolken,
   * Sternen und Sonnenscheibe, die der analytische Verlauf allein nicht
   * liefert.
   *
   * Kostet fast nichts: die Renderliste enthält GENAU ein Mesh (die
   * Kuppel), die Auflösung ist 128², und aktualisiert wird nur jeden
   * 15. Frame. Zum Vergleich die Messwerte in WaterRefraction.ts — dort
   * kostet ein Pass über ~630 Meshes 12 fps. Eine Spiegelung der echten
   * Szene (MirrorTexture) wäre teurer als das und ist deshalb bewusst
   * nicht gebaut.
   *
   * Die Position bleibt im Ursprung: die Kuppel hat `infiniteDistance`,
   * wird also um die jeweilige Renderkamera zentriert — was die Sonde
   * sieht, hängt damit nicht davon ab, wo sie steht.
   *
   * `vhSkyGradient` bleibt trotzdem im Wassershader: solange die Sonde
   * ihren ersten Durchlauf nicht hinter sich hat, ist ihre Textur
   * schwarz, und ein schwarz spiegelndes Meer wäre schlimmer als ein
   * Verlauf ohne Wolken.
   */
  readonly probe: ReflectionProbe;
  private readonly material: ShaderMaterial;
  private time = 0;
  /** Sekunden seit der letzten Neuberechnung des Umgebungslichts. */
  private iblAlter = Number.POSITIVE_INFINITY;
  /** Gehaltene Puffer der Kugelharmonischen-Rechnung (kein Müll pro Lauf). */
  private readonly iblRichtung = new Vector3();
  private readonly iblFarbe = new Color3();

  /**
   * Momentaufnahme für alles, was den Himmel spiegeln will (heute: das
   * WaterPlugin). Enthält genau die Werte, die auch in die Uniforms der
   * Kuppel gehen — hier zu lesen statt sie beim Aufrufer nachzubauen,
   * damit Kuppel und Spiegelbild nicht auseinanderlaufen können.
   *
   * Wird in `update()` befüllt und in place beschrieben (kein neues
   * Objekt je Frame).
   */
  readonly reflectState = {
    /** = EnvState.fogColor, identisch mit scene.fogColor */
    horizon: new Color3(),
    /** abgedunkelter, blauerer Horizont */
    zenith: new Color3(),
    /** = EnvState.fogColorSun */
    sunGlow: new Color3(),
    /** Richtung ZUR Sonne (normalisiert), y < 0 nach Sonnenuntergang */
    toSun: new Vector3(0, 1, 0),
    /** 0 = voller Tag, 1 = volle Nacht (aus der Sonnenhöhe, nicht binär) */
    night: 0,
  };

  /**
   * Die restlichen Uniform-Werte, ebenfalls gehalten statt pro Frame neu.
   *
   * `update()` legte pro Frame acht Objekte an: `new Color3(...)` für
   * Horizont, Zenit, Sonnenglühen und Sonnenfarbe, davon drei mit einem
   * zweiten aus `toLinearSpace()`, dazu ein `new Vector3` für `uSunDir`.
   * Das Muster stand direkt daneben — `reflectState` ist ausdrücklich als
   * „wird in place beschrieben (kein neues Objekt je Frame)" dokumentiert;
   * es war nur nicht auf die Uniforms durchgezogen.
   *
   * ShaderMaterial.setColor3/setVector3 merken sich die REFERENZ und lesen
   * sie erst beim Binden — ein gehaltenes, in place beschriebenes Objekt
   * ist hier also nicht nur billiger, sondern der eigentlich gemeinte Weg.
   */
  private readonly sonnenFarbe = new Color3();
  private readonly sonnenRichtung = new Vector3(0, 1, 0);

  constructor(scene: Scene, radius = 3000) {
    registerShader();

    this.material = new ShaderMaterial(
      'valheimSkyMat',
      scene,
      SHADER_NAME,
      {
        attributes: ['position'],
        uniforms: [
          'worldViewProjection',
          'uHorizon',
          'uZenith',
          'uSunGlow',
          'uSunColor',
          'uSunDir',
          'uNight',
          'uCloud',
          'uTime',
        ],
      }
    );
    // The dome is the backdrop: never occlude, never be fogged, never lit.
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.fogEnabled = false;

    this.mesh = MeshBuilder.CreateSphere(
      'valheimSky',
      { segments: 48, diameter: radius * 2 },
      scene
    );
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    // Render before everything else so it can't overdraw the world.
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true;

    // `useFloat` und `linearSpace` (5. und 6. Parameter) sind beide
    // Voraussetzung dafür, dass die Probe nicht nur das Wasser spiegelt,
    // sondern als Umgebungslicht taugt (Grafik-Konzept Stufe 5):
    //
    //  · **useFloat** hält Werte über 1 fest. Der Himmel um die Sonne ist
    //    genau das — ein 8-Bit-Ziel schnitte die Spitze ab, und mit ihr
    //    den Unterschied zwischen „hell" und „Lichtquelle".
    //  · **linearSpace** sagt Babylon, dass hier bereits LINEARE Werte
    //    stehen. Ohne die Angabe linearisiert der PBR-Pfad die
    //    Himmelsfarbe ein zweites Mal — derselbe Fehlertyp wie die
    //    doppelte Gammakodierung aus Ursache A des Grafik-Konzepts.
    //
    // Für das Wasser ändert sich dadurch nichts: Es bindet die Würfelkarte
    // über `uniformBuffer.setTexture` aus einem Plugin heraus und liest
    // die Texel roh, ohne Babylons Farbraum-Automatik.
    this.probe = new ReflectionProbe('skyProbe', 128, scene, true, true, true);
    this.probe.renderList!.push(this.mesh);
    this.probe.refreshRate = 15;
    this.probe.position.set(0, 0, 0);
    // ⚠ Ohne diese Zeile wird die Würfelkarte NIE gezeichnet und bleibt
    // schwarz. Babylon rendert ein RenderTargetTexture nur, wenn es in
    // customRenderTargets steht oder von einem Material referenziert
    // wird, das die Szene selbst als benutzt erkennt. Das Wasser bindet
    // sie über uniformBuffer.setTexture aus einem Material-Plugin heraus
    // — das zählt nicht. Symptom war ein durchgehend dunkles Meer
    // (nachgemessen: Mittelwert der +Y-Fläche exakt 0,0,0).
    // WaterRefraction.ts macht dasselbe für seinen Szenenpass.
    scene.customRenderTargets.push(this.probe.cubeTexture);
  }

  /**
   * Push one frame of environment state into the dome.
   *
   * `night` is derived from the sun elevation rather than `state.isNight`
   * so the sky eases through dusk instead of flipping the instant the sun
   * crosses the horizon.
   */
  update(state: EnvState, dtSeconds: number): void {
    this.time += dtSeconds;

    // LINEAR, wie alles, was ohne Babylon-Material direkt in den Buffer
    // geht — der ImageProcessing-Pass wandelt am Ende nach Gamma. Siehe
    // den Farbraum-Block in Lighting.ts; `scene.fogColor` selbst bleibt
    // dort bewusst Gamma, deshalb wird hier umgerechnet statt kopiert.
    //
    // Geschrieben wird gleich in `reflectState` — das ist derselbe Wert,
    // der auch in die Uniforms geht, und genau dafür ist es gedacht.
    const horizon = this.reflectState.horizon;
    horizon.set(state.fogColor.r, state.fogColor.g, state.fogColor.b);
    horizon.toLinearSpaceToRef(horizon);
    // Zenith: a deeper, slightly bluer version of the horizon. Derived
    // rather than authored so any EnvSetup — including ones only the dump
    // tool knows about — gets a sane sky without extra data.
    //
    // Der Blau-Sockel ist mit dem Horizont mitgewandert: 0.04 war ein
    // Gamma-Betrag, linear sind das ~0.001. Unverändert übernommen hätte
    // er den Zenit überstrahlt, weil die linearen Nachtfarben rund eine
    // Zehnerpotenz kleiner sind als die Gamma-Werte vorher.
    const zenith = this.reflectState.zenith;
    zenith.set(horizon.r * 0.45, horizon.g * 0.55, Math.min(1, horizon.b * 0.8 + 0.001));

    const night = 1 - Math.min(1, Math.max(0, (state.elevation + 0.25) / 0.45));

    const sunGlow = this.reflectState.sunGlow;
    sunGlow.set(state.fogColorSun.r, state.fogColorSun.g, state.fogColorSun.b);
    sunGlow.toLinearSpaceToRef(sunGlow);
    const sunColor = this.sonnenFarbe;
    sunColor.set(state.sunColor.r, state.sunColor.g, state.sunColor.b);
    sunColor.toLinearSpaceToRef(sunColor);

    // Für Konsumenten der Spiegelung (WaterPlugin): horizon/zenith/sunGlow
    // sind oben bereits IN reflectState geschrieben worden, hier bleiben
    // nur die beiden übrigen Felder.
    this.reflectState.toSun.set(state.sunDir.x, state.sunDir.y, state.sunDir.z).normalize();
    this.reflectState.night = night;

    // uSunDir ist die ROHE Sonnenrichtung, nicht die normalisierte aus
    // reflectState.toSun — deshalb ein eigener gehaltener Vektor.
    this.sonnenRichtung.set(state.sunDir.x, state.sunDir.y, state.sunDir.z);

    this.material.setColor3('uHorizon', horizon);
    this.material.setColor3('uZenith', zenith);
    this.material.setColor3('uSunGlow', sunGlow);
    this.material.setColor3('uSunColor', sunColor);
    this.material.setVector3('uSunDir', this.sonnenRichtung);
    this.material.setFloat('uNight', night);
    this.material.setFloat('uCloud', state.cloudAlpha);
    this.material.setFloat('uTime', this.time);

    // Umgebungslicht nachziehen — aber nicht mit 60 Hz, siehe dort.
    this.iblAlter += dtSeconds;
    if (this.iblAlter >= IBL_ABSTAND_S) {
      this.iblAlter = 0;
      this.berechneUmgebungslicht();
    }
  }

  /**
   * Der diffuse Anteil des Umgebungslichts, analytisch aus demselben
   * Verlauf gerechnet, den die Kuppel zeichnet.
   *
   * ── Warum nicht aus der Würfelkarte lesen ────────────────────────────
   * Babylon KANN die Kugelharmonischen aus einer Textur gewinnen — dazu
   * muss es sie aber von der GPU zurücklesen, und ein Rücklesen hält die
   * Pipeline an. Der Setter für `sphericalPolynomial` existiert daneben,
   * also rechnen wir sie selbst: `SKY_GRADIENT_GLSL` steht als
   * eigenständige Funktion da und ist auf der CPU ein Dutzend Zeilen
   * (`himmelsFarbeToRef` unten). Der Nebeneffekt ist der eigentliche
   * Gewinn: Kuppel, Spiegelung, Nebel UND Umgebungslicht stammen damit
   * garantiert aus derselben Quelle und können nicht auseinanderlaufen.
   *
   * ── Die Abtastung ───────────────────────────────────────────────────
   * 128 Richtungen auf einer Fibonacci-Kugel. Die Punkte liegen dort
   * gleichmässig ohne die Polhäufung eines Kugelkoordinaten-Rasters, und
   * jede Richtung trägt denselben Raumwinkel `4π/N` — nur deshalb darf
   * `deltaSolidAngle` ein konstanter Wert sein.
   *
   * `convertIncidentRadianceToIrradiance` faltet mit dem Kosinuslappen,
   * `convertIrradianceToLambertianRadiance` teilt durch π. Beide Schritte
   * sind Pflicht: Ohne sie stünde in der Polynomialform die
   * EINSTRAHLDICHTE statt der abgegebenen Leuchtdichte, und die Szene
   * wäre um Faktor π zu hell.
   *
   * ── Warum alle zwei Sekunden ────────────────────────────────────────
   * Der Lauf kostet rund eine halbe Millisekunde. Bei 60 Hz wären das
   * 3 % der Frame-Zeit für eine Grösse, die sich mit dem Sonnenstand
   * ändert — also über Minuten. Zwei Sekunden sind unterhalb jeder
   * Wahrnehmungsschwelle für eine Ambient-Änderung und kosten 0,03 %.
   */
  private berechneUmgebungslicht(): void {
    const sh = new SphericalHarmonics();
    const raumwinkel = (4 * Math.PI) / IBL_RICHTUNGEN;
    for (let i = 0; i < IBL_RICHTUNGEN; i++) {
      // Fibonacci-Kugel: y läuft gleichmässig von +1 nach −1, der
      // Azimut in Schritten des goldenen Winkels.
      const y = 1 - (2 * i + 1) / IBL_RICHTUNGEN;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * GOLDENER_WINKEL;
      this.iblRichtung.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
      this.himmelsFarbeToRef(this.iblRichtung, this.iblFarbe);
      sh.addLight(this.iblRichtung, this.iblFarbe, raumwinkel);
    }
    sh.convertIncidentRadianceToIrradiance();
    sh.convertIrradianceToLambertianRadiance();
    this.probe.cubeTexture.sphericalPolynomial = SphericalPolynomial.FromHarmonics(sh);
  }

  /**
   * CPU-Fassung von `vhSkyGradient` aus `SKY_GRADIENT_GLSL`.
   *
   * Zeile für Zeile dasselbe wie im Shader — wenn dort etwas geändert
   * wird, gehört es hier nachgezogen. Die beiden auseinanderlaufen zu
   * lassen hiesse, das Umgebungslicht aus einem Himmel zu rechnen, den
   * niemand sieht.
   */
  private himmelsFarbeToRef(richtung: Vector3, ziel: Color3): Color3 {
    const s = this.reflectState;
    const hoch = Math.max(Math.min(Math.max(richtung.y, -1), 1), 0);
    const t = 1 - Math.exp(-3.2 * hoch);
    const r = s.horizon.r + (s.zenith.r - s.horizon.r) * t;
    const g = s.horizon.g + (s.zenith.g - s.horizon.g) * t;
    const b = s.horizon.b + (s.zenith.b - s.horizon.b) * t;
    const sonne = Math.max(0, Vector3.Dot(richtung, s.toSun));
    const k = Math.pow(sonne, 8) * 0.55 * (1 - s.night);
    ziel.set(
      r + (s.sunGlow.r - r) * k,
      g + (s.sunGlow.g - g) * k,
      b + (s.sunGlow.b - b) * k
    );
    return ziel;
  }

  dispose(): void {
    this.probe.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
