/**
 * Wind vertex displacement for foliage materials (Phase 2).
 *
 * MaterialPluginBase injecting a sway into the vertex stage, proportional
 * to the local height (position.y) so trunks stay planted while crowns
 * move. Time is a shared global, advanced once per frame by the caller.
 *
 * ── Der ganze Baum, nicht nur das Laub ───────────────────────────────
 * Das Plugin gehört an ALLE Materialien eines Gewächses, Rinde
 * eingeschlossen. Im Original tragen Stamm und Blatt dieselben
 * Sway-Parameter — `birch_bark` und `birch_leaf2` stehen beide auf
 * `_SwayDistance 20, _Height 35, _SwaySpeed 15` (extracted_assets/
 * Material), und 11 weitere Rinden- und Stammmaterialien haben ebenfalls
 * welche. Der Baum biegt sich damit als eine Einheit.
 *
 * Hing es nur am Laub, schwang die belaubte Karte, während der Ast
 * darunter starr stehenblieb — an der Naht löste sich das Laub sichtbar
 * vom Holz. Wer das wieder trennt, bekommt genau diesen Fehler zurück.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';

export class WindPlugin extends MaterialPluginBase {
  /** Global wind time in seconds — advance once per frame. */
  static time = 0;
  /**
   * Sway-Amplitude bei lokaler Höhe 1 m (skaliert linear mit der Höhe).
   *
   * Kalibriert an den Originalmaterialien: beech_leaf hat _SwayDistance 25
   * bei _Height 35, birch_leaf2 20/35 — also grob 0,6 bis 0,7 Auslenkung je
   * Referenzhöhe. Der alte Wert 0,045 stammte aus der Zeit, als das Plugin
   * wirkungslos war (siehe enable-Flag im Konstruktor) und nie an einem
   * Bild justiert wurde; Laub stand damit praktisch still.
   *
   * Von 0,22 auf 0,38 angehoben, als die Ansatz-Dämpfung dazukam (siehe
   * vbAnsatzDaempfung): Die nimmt auch dem äusseren Kronenrand Ausschlag
   * weg, wo gar nichts gedämpft werden soll. Nachgerechnet an Beech1 fiel
   * er dort im Mittel von 1,48 m auf 0,84 m, also um 43 %; der Faktor
   * 0,38/0,22 = 1,73 holt das wieder herein. Ergebnis: aussen wie vorher,
   * am Astansatz rund drei Viertel weniger.
   */
  static strength = 0.38;
  /**
   * Wind direction in XZ and its 0..1 strength, fed from WeatherManager
   * (EnvMan.GetWindForce). Statics because every foliage material shares
   * one wind — the same reason Valheim puts it in a global shader vector.
   *
   * Defaults reproduce the old fixed sway until someone sets them, so a
   * scene without a WeatherManager still looks alive.
   */
  static dirX = 0;
  static dirZ = -1;
  /** 0.05..1 — the gust strength of the current weather. */
  static intensity = 0.5;
  /**
   * Second wind vector and the blend towards it — EnvMan's _GlobalWind2 /
   * _GlobalWindAlpha. The sway is evaluated for BOTH vectors and the two
   * offsets are mixed, exactly as WaterVolume.CalcWave does with its wave
   * heights. Interpolating the vector instead would push it through zero
   * on a ~180° shift and the foliage would briefly go still.
   */
  static dir2X = 0;
  static dir2Z = -1;
  static intensity2 = 0.5;
  static alpha = 0;
  /**
   * Halbe Ausdehnung des Modells in XZ (m) — der Bezug für die Dämpfung am
   * Astansatz. NICHT statisch: Jedes Gewächs hat seine eigene Kronenweite,
   * und das Plugin sitzt je Material.
   *
   * Gefüllt vom AssetManager aus der Bounding-Box; bleibt der Wert 0,
   * schaltet der Shader die Dämpfung ab und verhält sich wie zuvor.
   */
  spread = 0;

  constructor(material: Material) {
    // `enable` (6th arg) defaults to FALSE in MaterialPluginBase. Without
    // it the plugin only ever lands in the PASSIVE list: its uniforms are
    // declared and getUniforms() runs, but _injectCustomCode() and
    // bindForSubMesh() iterate `_activePlugins` — so the vertex code is
    // never injected and nothing sways. That silently no-op'd the entire
    // tree wind (verified 2026-07-29: even a 100x amplitude moved no
    // vertex). ClutterWindPlugin passes it; this one never did.
    super(material, 'Wind', 200, { WIND: true }, true, true);
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
    // plugin is always on for the materials it decorates
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'windTime', size: 1, type: 'float' },
        { name: 'windStrength', size: 1, type: 'float' },
        // xy = direction in XZ, z = 0..1 intensity.
        { name: 'windDir', size: 3, type: 'vec3' },
        { name: 'windDir2', size: 3, type: 'vec3' },
        { name: 'windAlpha', size: 1, type: 'float' },
        { name: 'windSpread', size: 1, type: 'float' },
      ],
    };
  }

  bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    uniformBuffer.updateFloat('windTime', WindPlugin.time);
    uniformBuffer.updateFloat('windStrength', WindPlugin.strength);
    uniformBuffer.updateFloat3('windDir', WindPlugin.dirX, WindPlugin.dirZ, WindPlugin.intensity);
    uniformBuffer.updateFloat3('windDir2', WindPlugin.dir2X, WindPlugin.dir2Z, WindPlugin.intensity2);
    uniformBuffer.updateFloat('windAlpha', WindPlugin.alpha);
    uniformBuffer.updateFloat('windSpread', this.spread);
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== 'vertex') return null;
    return {
      // Two parts, as in Valheim's foliage shader: a steady lean INTO the
      // wind direction that grows with its strength, plus a flutter across
      // it so the crown never looks frozen at constant wind. Both scale
      // with local height, keeping trunks planted.
      // Verschiebung als Funktion, damit sie für beide Windvektoren
      // ausgewertet werden kann (siehe windDir2/windAlpha).
      CUSTOM_VERTEX_DEFINITIONS: /* glsl */ `
        /**
         * Weltposition des OBJEKTURSPRUNGS — die Phasenquelle.
         *
         * finalWorld steht hier noch nicht zur Verfügung: Babylon setzt
         * CUSTOM_VERTEX_UPDATE_POSITION vor <instancesVertex>, wo die
         * Matrix erst zusammengesetzt wird. Deshalb dieselbe Rechnung von
         * Hand — bei Thin Instances trägt world3 die Translation der
         * Instanz, die noch durch die Matrix des Master-Mesh muss.
         */
        vec3 vbObjektUrsprung() {
        #ifdef INSTANCES
          #ifdef THIN_INSTANCES
            return (world * world3).xyz;
          #else
            return world3.xyz;
          #endif
        #else
          return world[3].xyz;
        #endif
        }

        /**
         * Dämpfung am Astansatz: 0 an der Baumachse, 1 an der Kronenkante.
         *
         * ── Das Problem ──────────────────────────────────────────────
         * Die Auslenkung hing allein an der Höhe. Zwei Punkte derselben
         * Höhe bewegten sich damit gleich weit — der Punkt, an dem eine
         * belaubte Karte am Stamm ansetzt, genauso wie ihre Spitze. Am
         * Baum sah das aus, als schwämme das Laub neben dem Holz.
         *
         * ── Warum der Abstand zur Achse ──────────────────────────────
         * Sauber wäre ein Gewicht pro Vertex, wie Unity es über die
         * Vertexfarben löst. Die gerippten Modelle haben keine: Beech1,
         * Birch1 und Oak1 führen nur POSITION, NORMAL, TANGENT und
         * TEXCOORD_0 — der Kanal fehlt, wie schon die Skins bei den
         * Kreaturen.
         *
         * Der Abstand zur Baumachse ist der beste Ersatz, der ohne
         * Modelländerung zu haben ist. Nachgemessen an der echten
         * Geometrie korreliert er mit dem tatsächlichen Abstand zum
         * nächsten Rinden-Vertex zu 0,84 (Beech1), 0,76 (Birch1) und
         * 0,69 (Oak1): Was nah an der Achse sitzt, sitzt nah am Holz.
         *
         * Dass die Karten dadurch in sich geschert werden — innen ruhig,
         * aussen voll — ist hier kein Fehler, sondern genau das Bild
         * eines Astes, der sich biegt.
         */
        float vbAnsatzDaempfung(vec3 pos, float spread) {
          if (spread <= 0.0) return 1.0;
          return clamp(length(pos.xz) / spread, 0.0, 1.0);
        }

        vec3 windOffset(vec3 pos, vec3 ursprung, vec2 dir, float gust, float t, float strength) {
          float windH = max(pos.y, 0.0) * vbAnsatzDaempfung(pos, windSpread);
          // Phase aus der WELTPOSITION DES OBJEKTS, nicht aus der des
          // Vertex.
          //
          // Vorher stand hier pos.x * 0.35 + pos.z * 0.31 mit der lokalen
          // Vertexposition, und das hatte zwei Folgen — beide falsch:
          //
          // 1. Innerhalb EINES Baumes lief die Phase auseinander. Über eine
          //    Buche mit 22 m Kronendurchmesser sind das mehrere Radiant;
          //    benachbarte Vertices schwangen gegeneinander und zogen das
          //    Mesh auseinander. Nachgerechnet auf der echten Geometrie von
          //    Beech1 (1217 Kanten): im Mittel 12,4 %, im Extrem 71,6 %
          //    Kantendehnung, wo ein starr geschwenkter Ast 0 % haben muss.
          //    Sichtbar wurde das an den Astansätzen, die sich gegen den
          //    Stamm verschoben.
          // 2. Zwischen den Bäumen passierte dagegen GAR NICHTS: Lokale
          //    Koordinaten sind bei jeder Instanz desselben Prefabs gleich,
          //    also schwang der ganze Wald im Gleichtakt — genau das, was
          //    die Phase eigentlich verhindern sollte.
          //
          // Mit dem Objektursprung ist die Phase über das Mesh konstant
          // (der Baum biegt sich als Einheit) und unterscheidet sich von
          // Baum zu Baum: 0,35 rad je Meter Abstand.
          float phase = ursprung.x * 0.35 + ursprung.z * 0.31;
          // Stetige Neigung mit dem Wind. Die Frequenz folgt _SwaySpeed der
          // Blattmaterialien (beech_leaf 10, birch_leaf2 15) — Laub wiegt
          // langsam und weit, anders als Gras.
          float lean = (0.6 + 0.4 * sin(t * 1.1 + phase)) * gust;
          vec2 o = dir * (lean * strength * windH);
          // Flattern quer dazu, damit Böen als Bewegung lesbar sind.
          vec2 side = vec2(-dir.y, dir.x);
          o += side * (sin(t * 2.6 + phase * 1.4) * 0.45 * gust * strength * windH);
          return vec3(o.x, 0.0, o.y);
        }
      `,
      CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `
        {
          vec3 ursprung = vbObjektUrsprung();
          vec3 o1 = windOffset(position, ursprung, windDir.xy, windDir.z, windTime, windStrength);
          vec3 o2 = windOffset(position, ursprung, windDir2.xy, windDir2.z, windTime, windStrength);
          // Die WIRKUNG mischen, nicht die Vektoren (WaterVolume.CalcWave).
          vec3 o = mix(o1, o2, windAlpha);
          positionUpdated.x += o.x;
          positionUpdated.z += o.z;
        }
      `,
    };
  }
}
