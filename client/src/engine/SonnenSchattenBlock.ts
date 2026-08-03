/**
 * SonnenSchattenBlock — `LightBlock`, der in einem NodeMaterial tatsächlich
 * Schatten liefert.
 *
 * ── Der Babylon-Fehler ───────────────────────────────────────────────
 * `LightBlock.prepareDefines` (`Materials/Node/Blocks/Dual/lightBlock.js`)
 * hat zwei Zweige:
 *
 *     if (!this.light) {
 *       PrepareDefinesForLights(scene, mesh, defines, true, maxLights);
 *     } else {
 *       const state = { …, shadowEnabled: false, … };
 *       PrepareDefinesForLight(scene, mesh, this.light, this._lightId,
 *                              defines, true, state);
 *       if (state.needRebuild) defines.rebuild();
 *     }
 *
 * Nur die MEHRLICHT-Variante schreibt das Ergebnis in die Defines:
 * `PrepareDefinesForLights` setzt `defines["SHADOWS"] = state.shadowEnabled`
 * (`materialHelper.functions.js:566`) und `SHADOWFLOAT` (:601-602). Der
 * EINZELLICHT-Pfad `PrepareDefinesForLight` setzt zwar intern
 * `state.shadowEnabled = true` (:805), aber der Aufrufer oben liest das
 * Feld nie aus — es wird verworfen.
 *
 * Sobald man also `lightBlock.light = <ein Licht>` setzt (genau das tut
 * `TerrainSplat`, weil nur die Sonne Schatten werfen soll), bleibt
 * `SHADOWS` undefiniert. Und `ShadersInclude/shadowsFragmentFunctions`
 * beginnt in Zeile 4 mit `#ifdef SHADOWS` — die **komplette Datei** fällt
 * dadurch weg, inklusive `computeShadowCSM`, `computeShadowWithCSMPCF1`
 * und aller übrigen Abtastfunktionen. `SHADOW0` und `SHADOWCSM0` sind
 * gesetzt, `lightFragment` ruft die Funktionen also auf — nur existieren
 * sie nicht mehr.
 *
 * Headless nachgestellt (Chromium/SwiftShader):
 *
 *     LightBlock.light gesetzt      → SHADOWS false | SHADOW0 true | SHADOWCSM0 true
 *     LightBlock.light NICHT gesetzt→ SHADOWS true  | SHADOW0 true | SHADOWCSM0 true
 *
 * Das erklärt zweierlei auf einmal:
 *  · warum `usePercentageCloserFiltering` das Terrain-Material zerlegte
 *    (`Shadows.ts` hatte PCF deshalb abgeschaltet) — die PCF-Funktion war
 *    nur das erste fehlende Symbol, das auffiel;
 *  · warum das Terrain auch OHNE PCF keine Schatten empfing, was bislang
 *    unbemerkt blieb, weil `Settings.shadowQuality` ohnehin auf 0 stand.
 *
 * ── Die Umgehung ─────────────────────────────────────────────────────
 * Die Defines nach dem `super()`-Aufruf selbst nachtragen. `SHADOW0` ist
 * an dieser Stelle bereits korrekt gesetzt (das erledigt der
 * Einzellicht-Pfad), es dient hier als verlässliche Quelle dafür, ob für
 * dieses Mesh überhaupt Schatten aktiv sind — damit bleiben
 * `mesh.receiveShadows`, `scene.shadowsEnabled` und `light.shadowEnabled`
 * die maßgeblichen Schalter, ohne sie erneut abfragen zu müssen.
 *
 * `defines.rebuild()` ist zwingend, wenn die Keys neu hinzukommen:
 * `MaterialDefines._keys` wird nur beim Rebuild neu eingesammelt, und
 * `toString()` — die Grundlage des Shader-Cache-Schlüssels — läuft über
 * genau diese Liste. Ohne den Rebuild landen die neuen Defines nicht im
 * generierten Shader.
 */
import { LightBlock } from '@babylonjs/core/Materials/Node/Blocks/Dual/lightBlock';
import { NodeMaterialBlockTargets } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockTargets';
import { NodeMaterialBlockConnectionPointTypes } from '@babylonjs/core/Materials/Node/Enums/nodeMaterialBlockConnectionPointTypes';
import type { NodeMaterial, NodeMaterialDefines } from '@babylonjs/core/Materials/Node/nodeMaterial';
import type { NodeMaterialBuildState } from '@babylonjs/core/Materials/Node/nodeMaterialBuildState';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

export class SonnenSchattenBlock extends LightBlock {
  override prepareDefines(
    defines: NodeMaterialDefines,
    nodeMaterial: NodeMaterial,
    mesh?: AbstractMesh
  ): void {
    // Dieselbe Vorbedingung wie in der Basisklasse — ohne sie würden wir
    // unten auf einem `mesh` von `undefined` arbeiten.
    if (!mesh || !defines._areLightsDirty) return;

    super.prepareDefines(defines, nodeMaterial, mesh);

    // Nur nachtragen, was der Einzellicht-Pfad verschluckt hat. Ist
    // `this.light` nicht gesetzt, hat die Basisklasse den Mehrlicht-Pfad
    // genommen und alles ist bereits korrekt — dann darf hier nichts
    // überschrieben werden.
    if (!this.light) return;

    const d = defines as unknown as Record<string, unknown>;
    const neu = d['SHADOWS'] === undefined;
    const caps = mesh.getScene().getEngine().getCaps();
    const anAus = !!d['SHADOW0'];

    d['SHADOWS'] = anAus;
    // Wortgleich zu materialHelper.functions.js:601-602, damit die
    // Abtastung denselben Texturtyp annimmt, den der ShadowGenerator
    // tatsächlich angelegt hat.
    d['SHADOWFLOAT'] =
      anAus &&
      ((caps.textureFloatRender && caps.textureFloatLinearFiltering) ||
        (caps.textureHalfFloatRender && caps.textureHalfFloatLinearFiltering));

    if (neu) defines.rebuild();
  }

  /**
   * Zweite Hälfte desselben Babylon-Fehlers, diesmal im VERTEX-Shader.
   *
   * `shadowsVertex` berechnet die Kaskadenauswahl als
   *
   *     vPositionFromCamera{X} = view * worldPos;
   *
   * — mit dem fest verdrahteten Bezeichner `view`. `LightBlock` deklariert
   * den aber nur im Mehrlicht-Zweig (`lightBlock.js:277`):
   *
   *     if (this.view.isConnected) {
   *       compilationString += `${_declareLocalVar("view", Matrix)} = ${this.view.associatedVariableName};`
   *     }
   *
   * Der Einzellicht-Zweig (`:267`) emittiert `shadowsVertex` ohne diese
   * Zeile. Ergebnis:
   *
   *     VERTEX SHADER ERROR: 'view' : undeclared identifier
   *
   * Den `view`-Input bloss zu verbinden genügt NICHT: NodeMaterial vergibt
   * Uniform-Namen mit `u_`-Präfix, die Matrix heisst im generierten Shader
   * also `u_view`. Gebraucht wird die Brücke `mat4 view = u_view;`, und
   * zwar VOR dem Include — deshalb wird sie hier vor `super()` angehängt.
   *
   * `_declareLocalVar` statt eines festen `mat4`-Literals, damit die Zeile
   * unter WGSL (WebGPU) ebenfalls gültig wäre.
   */
  protected override _buildBlock(state: NodeMaterialBuildState): this {
    const istVertex = state.target === NodeMaterialBlockTargets.Vertex;
    if (istVertex && this.light && this.view.isConnected) {
      const s = state as unknown as {
        compilationString: string;
        _declareLocalVar(name: string, type: NodeMaterialBlockConnectionPointTypes): string;
      };
      s.compilationString +=
        `${s._declareLocalVar('view', NodeMaterialBlockConnectionPointTypes.Matrix)}` +
        ` = ${this.view.associatedVariableName};\n`;
    }

    const ergebnis = super._buildBlock(state) as this;

    // ── Dritte Ausprägung desselben Fehlers ─────────────────────────
    // `_injectVertexCode` trägt den Block NUR im Mehrlicht-Zweig in
    // `sharedData.dynamicUniformBlocks` ein:
    //
    //     if (!this.light) { … dynamicUniformBlocks.push(this); }
    //     else            { /* kein push */ }
    //
    // Genau über diese Liste ruft `NodeMaterial` (nodeMaterial.js:1126)
    // aber `updateUniformsAndSamples()` auf — und erst das meldet
    // `shadowTexture{X}` als Sampler an
    // (`PrepareUniformsAndSamplersForLight`,
    // materialHelper.functions.js:1142).
    //
    // Ohne die Anmeldung bleibt der Schatten-Uniform auf seinem
    // Default 0 und teilt sich die Textureinheit mit dem ersten
    // Terrain-Sampler. Gemessen über `gl.getUniform` am fertigen
    // Programm:
    //
    //     Unit  0: tb_lTexture(sampler2D), shadowTexture0(sampler2DArray)
    //     Unit  1: tb_l1Texture …            (Unit 5 blieb frei)
    //
    // Die Folge ist der Treiberfehler "Two textures of different types
    // use the same sampler location" und ein komplett unsichtbares
    // Terrain. Es war ausdrücklich KEIN Mengenproblem — von 32
    // Einheiten waren nur 21 belegt.
    if (this.light) {
      const sd = state.sharedData as unknown as { dynamicUniformBlocks: unknown[] };
      if (sd.dynamicUniformBlocks.indexOf(this) === -1) sd.dynamicUniformBlocks.push(this);
    }
    return ergebnis;
  }

  override getClassName(): string {
    return 'SonnenSchattenBlock';
  }
}
