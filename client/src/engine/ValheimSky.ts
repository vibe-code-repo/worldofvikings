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
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Color3, Vector3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';
import type { EnvState } from '@wov/shared';

const SHADER_NAME = 'valheimSky';

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

    this.probe = new ReflectionProbe('skyProbe', 128, scene);
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
    const horizon = new Color3(state.fogColor.r, state.fogColor.g, state.fogColor.b).toLinearSpace();
    // Zenith: a deeper, slightly bluer version of the horizon. Derived
    // rather than authored so any EnvSetup — including ones only the dump
    // tool knows about — gets a sane sky without extra data.
    //
    // Der Blau-Sockel ist mit dem Horizont mitgewandert: 0.04 war ein
    // Gamma-Betrag, linear sind das ~0.001. Unverändert übernommen hätte
    // er den Zenit überstrahlt, weil die linearen Nachtfarben rund eine
    // Zehnerpotenz kleiner sind als die Gamma-Werte vorher.
    const zenith = new Color3(
      horizon.r * 0.45,
      horizon.g * 0.55,
      Math.min(1, horizon.b * 0.8 + 0.001)
    );

    const night = 1 - Math.min(1, Math.max(0, (state.elevation + 0.25) / 0.45));

    const sunGlow = new Color3(
      state.fogColorSun.r,
      state.fogColorSun.g,
      state.fogColorSun.b
    ).toLinearSpace();
    const sunColor = new Color3(
      state.sunColor.r,
      state.sunColor.g,
      state.sunColor.b
    ).toLinearSpace();

    // Für Konsumenten der Spiegelung (WaterPlugin) — dieselben Werte, die
    // unten in die Uniforms gehen. Siehe reflectState.
    this.reflectState.horizon.copyFrom(horizon);
    this.reflectState.zenith.copyFrom(zenith);
    this.reflectState.sunGlow.copyFrom(sunGlow);
    this.reflectState.toSun.set(state.sunDir.x, state.sunDir.y, state.sunDir.z).normalize();
    this.reflectState.night = night;

    this.material.setColor3('uHorizon', horizon);
    this.material.setColor3('uZenith', zenith);
    this.material.setColor3('uSunGlow', sunGlow);
    this.material.setColor3('uSunColor', sunColor);
    this.material.setVector3(
      'uSunDir',
      new Vector3(state.sunDir.x, state.sunDir.y, state.sunDir.z)
    );
    this.material.setFloat('uNight', night);
    this.material.setFloat('uCloud', state.cloudAlpha);
    this.material.setFloat('uTime', this.time);
  }

  dispose(): void {
    this.probe.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}
