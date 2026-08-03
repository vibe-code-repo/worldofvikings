/**
 * ClutterWindPlugin — wind sway + camera push + distance shrink/fade for
 * the grass clutter (Babylon-Port of the three.js injectClutterShader,
 * valheim-browser GrassClutter.ts).
 *
 * Vertex stage (per instance): blades shrink smoothly toward 5% size across
 * [fadeMin, fadeMax*jitter], sway by vertex height with a per-instance
 * phase, and the top bends away from the camera when close (player push).
 * Fragment stage: screen-door dither only over the LAST portion of the fade
 * band (see DITHER_START_FRAC below), before the fade cutoff (the original
 * shader's _FadeDistance dither); optionally pins up-normals so cross
 * meshes are lit like the ground (Unity technique — avoids black backfaces).
 *
 * BUG (reported, screenshot): grass in plain view looked "pixelated and
 * transparent". Two compounding causes, both fixed here:
 *  1. The per-instance fade-distance jitter (added to break up the
 *     perfectly circular vanish boundary — see below) was applied to BOTH
 *     fadeMin and fadeMax by the same factor. For instances with negative
 *     jitter, fadeMin moved CLOSER to the camera than the original design
 *     value — pulling nearby, prominent grass into the dither zone. Fixed:
 *     only fadeMax is jittered now; fadeMin (and thus the "always fully
 *     solid" near zone) stays fixed.
 *  2. The dither discard and the size shrink used the *same* fade value
 *     across the *entire* [fadeMin, fadeMax] band, so mid-distance grass
 *     was simultaneously half-shrunk AND ~50% dithered — a strong "broken/
 *     glitchy" look on blades still large enough to scrutinize. Fixed: the
 *     shrink now ramps smoothly across the whole band (reads as "grass
 *     gets shorter with distance", which is natural), while the dither
 *     only kicks in over the last DITHER_START_FRAC of the band, by which
 *     point blades are already small — the discarded pixels are small too
 *     and read as distant sparseness, not as holes in nearby grass.
 *
 * clutterDistanceScale (uniform, set from GrassClutter.ts every frame via
 * the static field below) combines the user's "Vegetationsqualität"
 * setting with the current environment's fog visibility — see
 * GrassClutter.ts's BUILD_RADIUS doc for the full reasoning.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';
import { WATER_LEVEL } from '@wov/shared';
import { WAVE_GLSL } from './WaterWave';
import { WaterPlugin } from './WaterPlugin';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

export interface ClutterWindOptions {
  swayAmp: number;
  pushDist: number;
  fadeMin: number;
  fadeMax: number;
  topY: number;
  pinUpNormals: boolean;
  /**
   * Schwimmt dieses Clutter auf dem Wasser? Gilt für die Einträge mit
   * `snapToWater` — Seerosen und Schilf. Siehe WELLE_GLSL-Block unten.
   */
  aufWasser: boolean;
}

/**
 * Wie weit die schwimmenden Pflanzen ÜBER der Wasseroberfläche sitzen (m).
 *
 * Ohne diesen Abstand lägen Blatt und Wasserfläche exakt koplanar, und
 * welche der beiden Flächen gewinnt, entschiede die Tiefenpufferauflösung
 * — also Z-Fighting-Flimmern über die ganze Seerosenfläche. Klein genug,
 * dass es nicht als Schweben liest.
 */
const WASSER_ABSTAND = 0.03;

export class ClutterWindPlugin extends MaterialPluginBase {
  /** Global wind time in seconds — advance once per frame. */
  static time = 0;
  /**
   * Wind direction in XZ and its 0..1 strength, fed from WeatherManager —
   * the same values WindPlugin gets, so grass and trees lean the same way
   * instead of each swaying on its own private rhythm.
   */
  static dirX = 0;
  static dirZ = -1;
  static intensity = 0.5;
  /** Zweiter Windvektor + Blend (EnvMan _GlobalWind2/_GlobalWindAlpha).
   *  Gemischt wird die Auslenkung, nicht der Vektor — s. WindPlugin. */
  static dir2X = 0;
  static dir2Z = -1;
  static intensity2 = 0.5;
  static alpha = 0;
  /**
   * Gemeinsamer Faktor auf alle swayAmp-Werte der Clutter-Tabelle.
   *
   * Die Einzelwerte dort (0,04 bis 0,1) sind gegen die Originalmaterialien
   * zu zaghaft: grasscross_heath_green hat _SwayDistance 2,5 bei _Height
   * 0,5 — also Auslenkung im Bereich der eigenen Halmhöhe, nicht ein
   * Zwanzigstel davon. Zentral statt in 13 Tabellenzeilen, damit sich die
   * Intensität an einer Stelle justieren lässt.
   */
  static ampScale = 3.0;
  /** Global fade-distance multiplier (quality setting × fog cap) — set once
   *  per frame by GrassClutter.update(), applied to every clutter material. */
  static distanceScale = 1;
  private opts!: ClutterWindOptions;
  /** 1×1-Platzhalter, solange die Grundhöhen-Kachel noch nicht steht. */
  private readonly leer: RawTexture;

  constructor(material: Material, opts: ClutterWindOptions) {
    // MaterialPluginBase registers the plugin during super(), and the
    // plugin manager immediately calls getCustomCode() to collect the
    // injection point names — before the constructor body can assign
    // fields. So getCustomCode must tolerate opts being unset and fall
    // back to the defaults (real values are bound per-frame in
    // bindForSubMesh, which runs after construction).
    //
    // `enable` (6th ctor arg) defaults to false in MaterialPluginBase —
    // without it the plugin is only ever added to the *passive* plugin
    // list (uniform declarations get added, getUniforms()/getSamplers()
    // still run) but never to `_activePlugins`, which is what
    // MaterialPluginManager._injectCustomCode() and bindForSubMesh()
    // actually iterate. Omitting it silently no-ops the entire plugin:
    // no wind sway, no distance fade/shrink, no up-normal pin — the
    // uniforms exist in the shader but nothing sets or reads them.
    // CLUTTER_AUF_WASSER kommt aus `opts` (Parameter, also schon vor
    // super() lesbar) und NICHT aus `this.opts`: getCustomCode() läuft
    // bereits während super(), wenn das Feld noch leer ist. Genau daran
    // scheiterte der erste Anlauf — der Wellenblock hing an
    // `this.opts.aufWasser`, war beim einzigen Aufruf immer false und
    // fehlte im fertigen Shader. Über ein Define ist der Code immer da
    // und der Präprozessor entscheidet.
    super(
      material,
      'ClutterWind',
      210,
      { CLUTTERWIND: true, CLUTTER_AUF_WASSER: opts.aufWasser },
      true,
      true
    );
    this.opts = opts;
    // Ein Sampler, der im Shader deklariert ist, MUSS gebunden werden —
    // auch bevor die Kachel existiert. Höhe 0 heißt "Grund auf Meeres-
    // niveau", was ohne Wasser ohnehin folgenlos bleibt.
    // ⚠ Der TYP muss mitgegeben werden. `CreateRTexture` hat als Vorgabe
    // TEXTURETYPE_FLOAT (rawTexture.js) — mit einem Uint8Array lehnt WebGL
    // den Upload ab:
    //
    //   INVALID_OPERATION: texImage2D: type FLOAT but ArrayBufferView
    //   not Float32Array
    //
    // Einmal je Clutter-Material, in der Konsole also 13-mal beim Start.
    // Die Textur blieb dabei uninitialisiert; folgenlos war das nur, weil
    // sie sowieso nur bis zum ersten Aufbau der Grundhöhen-Kachel gebunden
    // wird.
    this.leer = RawTexture.CreateRTexture(
      new Uint8Array([0]),
      1,
      1,
      material.getScene(),
      false,
      false,
      Texture.NEAREST_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE
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
    return true;
  }

  prepareDefines(): void {
    // always on for the materials it decorates
  }

  getSamplers(samplers: string[]): void {
    // Immer anmelden, nicht an this.opts hängen: die Methode läuft wie
    // getCustomCode() schon während super(), das Feld ist dann noch leer.
    // Wo der Sampler per #ifdef aus dem Shader fällt, findet Babylon
    // keine Location und das Binden verpufft folgenlos.
    samplers.push('clutterGroundTex');
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'clutterTime', size: 1, type: 'float' },
        // Wellen-Zustand des Wassers, damit schwimmende Pflanzen genau
        // auf der Oberfläche liegen. xy = Windrichtung, z = Stärke.
        { name: 'clutterWaveWind', size: 3, type: 'vec3' },
        { name: 'clutterWaveWind2', size: 3, type: 'vec3' },
        { name: 'clutterWaveAlpha', size: 1, type: 'float' },
        { name: 'clutterWaveTime', size: 1, type: 'float' },
        // xy = Ursprung der Grundhöhen-Kachel, z = 1/Kantenlänge.
        { name: 'clutterGroundInfo', size: 4, type: 'vec4' },
        // xy = wind direction in XZ, z = 0..1 intensity.
        { name: 'clutterWind', size: 3, type: 'vec3' },
        { name: 'clutterWind2', size: 3, type: 'vec3' },
        { name: 'clutterWindAlpha', size: 1, type: 'float' },
        { name: 'clutterSwayAmp', size: 1, type: 'float' },
        { name: 'clutterPushDist', size: 1, type: 'float' },
        { name: 'clutterFadeMin', size: 1, type: 'float' },
        { name: 'clutterFadeMax', size: 1, type: 'float' },
        { name: 'clutterDistanceScale', size: 1, type: 'float' },
        { name: 'clutterTopY', size: 1, type: 'float' },
      ],
    };
  }

  bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    uniformBuffer.updateFloat('clutterTime', ClutterWindPlugin.time);
    uniformBuffer.updateFloat3(
      'clutterWind',
      ClutterWindPlugin.dirX,
      ClutterWindPlugin.dirZ,
      ClutterWindPlugin.intensity
    );
    uniformBuffer.updateFloat3(
      'clutterWind2',
      ClutterWindPlugin.dir2X,
      ClutterWindPlugin.dir2Z,
      ClutterWindPlugin.intensity2
    );
    uniformBuffer.updateFloat('clutterWindAlpha', ClutterWindPlugin.alpha);
    uniformBuffer.updateFloat('clutterSwayAmp', this.opts.swayAmp * ClutterWindPlugin.ampScale);
    uniformBuffer.updateFloat('clutterPushDist', this.opts.pushDist);
    uniformBuffer.updateFloat('clutterFadeMin', this.opts.fadeMin);
    uniformBuffer.updateFloat('clutterFadeMax', this.opts.fadeMax);
    uniformBuffer.updateFloat('clutterDistanceScale', ClutterWindPlugin.distanceScale);
    uniformBuffer.updateFloat('clutterTopY', this.opts.topY);

    if (!this.opts.aufWasser) return;

    // Wellenzustand aus DEM Plugin, das die Oberfläche zeichnet — nicht
    // aus den clutter-eigenen Windfeldern oben. Die beiden sind zwar aus
    // derselben Quelle gespeist, aber nur die Wasserwerte ergeben exakt
    // die Höhe, auf der das Wasser gerade steht.
    uniformBuffer.updateFloat3(
      'clutterWaveWind',
      WaterPlugin.windDirX,
      WaterPlugin.windDirZ,
      WaterPlugin.windIntensity
    );
    uniformBuffer.updateFloat3(
      'clutterWaveWind2',
      WaterPlugin.windDir2X,
      WaterPlugin.windDir2Z,
      WaterPlugin.windIntensity2
    );
    uniformBuffer.updateFloat('clutterWaveAlpha', WaterPlugin.windAlpha);
    uniformBuffer.updateFloat('clutterWaveTime', WaterPlugin.time);
    const gi = WaterPlugin.groundInfo;
    uniformBuffer.updateFloat4('clutterGroundInfo', gi.x, gi.y, gi.z, 0);
    uniformBuffer.setTexture('clutterGroundTex', WaterPlugin.groundMap ?? this.leer);
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    // see constructor: opts may be unset during the manager's initial
    // collect call — fall back to safe defaults (bindForSubMesh sets the
    // real uniforms per submesh later).
    const opts = this.opts ?? { swayAmp: 0, pushDist: 1, fadeMin: 20, fadeMax: 35, topY: 1, pinUpNormals: false, aufWasser: false };
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `
        {
          vec3 iPos = vec3(0.0);
          #ifdef INSTANCES
            // 'world' here is the mesh's OWN uniform matrix (identity — our
            // cell meshes never move, only their thin instances do), not
            // the per-instance transform. The real per-instance world
            // position is the raw instance attribute world3 (translation
            // column) — the finalWorld/world0..world3 combination happens
            // in #include<instancesVertex>, which runs AFTER this
            // injection point (default.vertex.js), so world3 must be read
            // directly here. Verified in Shaders/ShadersInclude/
            // instancesDeclaration.js + instancesVertex.js. Without this,
            // iPos was always (0,0,0) — camDist measured "camera to world
            // origin" instead of "camera to this blade", so all grass
            // faded out together once the player was ~20-35m from spawn,
            // regardless of direction or of how close the blade actually was.
            iPos = world3.xyz;
          #endif
          // clutterDistanceScale: quality setting × fog-visibility cap, set
          // once per frame from outside (GrassClutter.ts) — never touches
          // fadeMin so the always-solid near zone stays put regardless.
          float fMinS = clutterFadeMin * clutterDistanceScale;
          float fMaxS = clutterFadeMax * clutterDistanceScale;
          // Per-instance jitter on fadeMax ONLY: without this every blade of
          // a given clutter entry vanishes at the exact same distance, so an
          // entire field disappears along one perfectly circular boundary
          // around the player — an artificial "wall" between detailed grass
          // and flat terrain, especially in low-fog weather (reported via
          // screenshot). Jittering fadeMin too (an earlier version of this
          // fix) pulled some instances' near edge CLOSER than the design
          // value, dragging nearby, prominent grass into the dither zone —
          // also reported ("pixelated and transparent" in plain view).
          // Keep the 0.6 factor in sync with GrassClutter.ts's FADE_JITTER
          // constant (0.6 = 2 × 0.3, since fJit ranges over [-0.5, 0.5)).
          float fJit = fract(sin(dot(iPos.xz, vec2(41.3, 289.1))) * 43758.5453) - 0.5;
          float fMaxJ = max(fMinS + 0.5, fMaxS * (1.0 + fJit * 0.6));
          float camDist = distance(iPos.xz, vEyePosition.xyz.xz);
          // Size shrink ramps across the WHOLE band — reads as "grass gets
          // shorter with distance", which looks natural even mid-band.
          float shrinkFade = 1.0 - smoothstep(fMinS, fMaxJ, camDist);
          // Dither (fragment screen-door discard, see vClutterFade below)
          // only kicks in over the last 40% of the band, where blades are
          // already shrunk small — discarding pixels of an already-tiny
          // blade reads as distant sparseness, not as holes in nearby grass.
          float ditherStart = mix(fMinS, fMaxJ, 0.6);
          vClutterFade = 1.0 - smoothstep(ditherStart, fMaxJ, camDist);
          float hFactor = clamp(positionUpdated.y / clutterTopY, 0.0, 1.0);
          // distance shrink (InstanceRenderer LOD) — blades sink into the ground
          positionUpdated *= mix(0.05, 1.0, shrinkFade);
          // wind sway: phase from instance position, amplitude by vertex height
          float phase = iPos.x * 0.15 + iPos.z * 0.13;
          // Neigung mit dem Wind, mit einer Welle, die entlang der Windachse
          // durchs Feld läuft — so liest sich eine Bö als Übergang statt als
          // Zittern auf der Stelle. Für BEIDE Windvektoren ausgewertet und
          // die Auslenkung gemischt (s. WindPlugin/CalcWave).
          vec2 wDirA = clutterWind.xy;
          vec2 wDirB = clutterWind2.xy;
          vec2 offA, offB;
          {
            float travel = dot(iPos.xz, wDirA) * 0.25;
            // Gras schwingt im Original mit _SwaySpeed 60 gegen 10 beim Laub
            // (grasscross_heath_green vs. beech_leaf) — also deutlich
            // schneller. Vorher lag es mit 1.4 sogar UNTER der Baumfrequenz.
            float ripple = 0.65 + 0.35 * sin(clutterTime * 5.5 + phase + travel);
            offA = wDirA * (ripple * clutterWind.z * clutterSwayAmp * hFactor);
            vec2 side = vec2(-wDirA.y, wDirA.x);
            offA += side * (sin(clutterTime * 4.2 + phase * 1.3) * 0.4 * clutterWind.z * clutterSwayAmp * hFactor);
          }
          {
            float travel = dot(iPos.xz, wDirB) * 0.25;
            float ripple = 0.65 + 0.35 * sin(clutterTime * 5.5 + phase + travel);
            offB = wDirB * (ripple * clutterWind2.z * clutterSwayAmp * hFactor);
            vec2 side = vec2(-wDirB.y, wDirB.x);
            offB += side * (sin(clutterTime * 4.2 + phase * 1.3) * 0.4 * clutterWind2.z * clutterSwayAmp * hFactor);
          }
          positionUpdated.xz += mix(offA, offB, clutterWindAlpha);
          // player push: bend the top away from the camera when close
          vec2 away = iPos.xz - vEyePosition.xyz.xz;
          float ad = length(away);
          if (ad < clutterPushDist && ad > 0.001) {
            float push = (1.0 - ad / clutterPushDist) * hFactor * 0.6;
            positionUpdated.xz += (away / ad) * push;
          }
        #ifdef CLUTTER_AUF_WASSER
        {
          // ── Auf der Welle schwimmen ───────────────────────────────
          // Seerosen und Schilf werden bei der Platzierung starr auf den
          // Wasserspiegel gesetzt (GrassClutter: snapToWater, im Original
          // ClutterSystem.cs:449 genauso). Die Oberfläche selbst steht
          // aber nicht still: WaterPlugin verschiebt sie im Vertexshader
          // um CalcWave. Solange das Wasser per Alpha durchsichtig war,
          // fiel das kaum auf; seit es blickdicht rendert (_SrcBlend One,
          // siehe Terrain.setWaterQuality) verschwinden die Pflanzen bei
          // jedem Wellenberg vollständig. Genau das war gemeldet.
          //
          // Also dieselbe Höhe hier nachrechnen. Die Formel kommt aus
          // WaterWave.ts, damit es bei EINER Quelle bleibt — eine zweite,
          // "ungefähr gleiche" Kopie würde die Pflanzen wieder eintauchen
          // lassen.
          //
          // Die Grundhöhe liefert dieselbe Kachel wie beim Wasser. Das
          // Wasser nimmt seine Tiefe im Vertexshader zwar aus dem über 4 m
          // interpolierten Attribut aDepth statt aus dieser 1-m-Kachel;
          // die Amplitude skaliert linear mit der Tiefe, der Unterschied
          // bleibt bei den 0,2 bis 1,5 m Wassersäule dieser Pflanzen
          // deshalb im Bereich von Zentimetern — und darauf sitzt der
          // Abstand oben.
          vec2 gUV = (iPos.xz - clutterGroundInfo.xy + 0.5) * clutterGroundInfo.z;
          float drin = step(0.0, gUV.x) * step(gUV.x, 1.0)
                     * step(0.0, gUV.y) * step(gUV.y, 1.0);
          float grund = texture2D(clutterGroundTex, clamp(gUV, 0.0, 1.0)).r;
          float tiefe = (CLUTTER_WATER_LEVEL - grund) * drin;
          float d01 = clamp(tiefe / WATER_DEPTH_SCALE, 0.0, 1.0);
          float welle = mix(
            wCalcWave(iPos.xz, d01, clutterWaveTime, clutterWaveWind.z, clutterWaveWind.xy),
            wCalcWave(iPos.xz, d01, clutterWaveTime, clutterWaveWind2.z, clutterWaveWind2.xy),
            clutterWaveAlpha
          );
          // positionUpdated ist LOKAL. Die Instanzmatrix skaliert (Seerosen
          // 0,4 bis 0,6) — ein lokales +Y käme in der Welt entsprechend
          // kleiner an. Also durch die Y-Skalierung teilen, das ist die
          // Länge der zweiten Spalte. Die Drehung ist reines Yaw und lässt
          // +Y unberührt.
          float skalaY = 1.0;
          #ifdef INSTANCES
            skalaY = max(length(world1.xyz), 1e-4);
          #endif
          positionUpdated.y += (welle + CLUTTER_ABSTAND) / skalaY;
        }
        #endif
        }
        `,
        // Must be declared at global scope (before main()), not inside it —
        // CUSTOM_VERTEX_MAIN_BEGIN sits right after the `void main(void) {`
        // brace, and Babylon rewrites `varying` to `out` for WebGL2/GLSL300es;
        // `out` on a local variable is a GLSL compile error.
        CUSTOM_VERTEX_DEFINITIONS: /* glsl */ `
          varying float vClutterFade;
          #ifdef CLUTTER_AUF_WASSER
            uniform sampler2D clutterGroundTex;
            const float CLUTTER_WATER_LEVEL = ${WATER_LEVEL.toFixed(1)};
            const float CLUTTER_ABSTAND = ${WASSER_ABSTAND};
            ${WAVE_GLSL}
          #endif
        `,
      };
    }
    // fragment: dither before the fade cutoff + optional up-normals pin.
    // Pinning must happen at CUSTOM_FRAGMENT_BEFORE_LIGHTS — that's the
    // last injection point before the light loop consumes `normalW`.
    // CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR runs after `color` (the fully lit
    // result) is already assembled, so writing the normal there — under
    // the wrong name `normal`, which doesn't even exist in this shader —
    // never had any effect on the lit backfaces it was meant to fix.
    return {
      // Global scope again: `varying`/function definitions can't live inside
      // main() (see the CUSTOM_VERTEX_DEFINITIONS note above).
      CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
        varying float vClutterFade;
        float clutterHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      `,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: opts.pinUpNormals ? 'normalW = vec3(0.0, 1.0, 0.0);' : '',
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: /* glsl */ `
        // distance dither (shader _FadeDistance): screen-door dissolve
        if (vClutterFade < 0.999 && clutterHash(gl_FragCoord.xy) > vClutterFade + 0.001) discard;
      `,
    };
  }
}
