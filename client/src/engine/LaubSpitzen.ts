/**
 * Der Farbverlauf einer Blattkarte — gelbgrüne Spitze über dunklem
 * Ansatz, wie im Vorbild.
 *
 * ── Was fehlte ───────────────────────────────────────────────────────
 * Die Laub-Atlanten sind Graustufen; die Blattfarbe entsteht im
 * Material. Das Vorbild gibt dafür ZWEI Farben an (`Top Color`,
 * `Bottom Color`) und mischt sie über die Karte. glTF kennt nur einen
 * `baseColorFactor`, also stand bei uns deren MITTEL in der Datei — eine
 * flache Fläche statt eines Verlaufs. Im Bild liest sich das als „blass
 * grau-grün" (Mike, 12.09.2026), und keine Belichtung und kein Grading
 * kann einen Verlauf zurückbringen, der in der Albedo nicht drin ist.
 *
 * ── Die Formel ───────────────────────────────────────────────────────
 * Aus dem übersetzten Shader des Vorbilds gelesen, nicht geraten; die
 * Herleitung samt Fundstelle steht in `shared/src/laubSpitzen.ts`:
 *
 *     albedo = mix(base, base * mix(unten, oben, v), menge)
 *
 * mit `v` entlang der Karte — im Vorbild die UV-Koordinate, bei uns
 * `1 − uv.y`, weil glTF die V-Achse andersherum zählt (auch das dort
 * begründet und an der Geometrie nachgemessen).
 *
 * ── Warum ein Material-Plugin und keine zweite Textur ────────────────
 * Weil der Verlauf KEINEN zusätzlichen Zeichenaufruf kosten darf. Ein
 * Laubmaterial steht in der Welt an bis zu tausend Thin Instances; jede
 * zweite Textur, jedes zweite Material verdoppelte diese Kosten. Ein
 * Plugin fügt drei Uniformwerte und vier Rechenbefehle in den
 * Fragment-Shader ein, den es ohnehin gibt — dieselbe Bauart, mit der
 * `WindPlugin` den Sway einsetzt.
 *
 * Die Einsatzstelle ist `CUSTOM_FRAGMENT_BEFORE_LIGHTS`: der einzige
 * Punkt, an dem `surfaceAlbedo` fertig gelesen, noch änderbar und noch
 * unbeleuchtet ist (dieselbe Stelle wie in `DungeonSteinMaterial`).
 *
 * ── Und warum `albedoColor` dabei auf Weiss geht ─────────────────────
 * Weil sonst zweimal getönt würde: Babylon multipliziert `albedoColor`
 * (= der `baseColorFactor` aus der GLB, also das Mittel) bereits in
 * `surfaceAlbedo` hinein, und der Verlauf käme obendrauf. Gesetzt, nicht
 * multipliziert — `fixupMaterial` läuft je MESH, und mehrere Meshes
 * teilen sich ein Material (dieselbe Regel wie in `StoreToenung.ts`).
 *
 * Ein Material ohne Zeile in `LAUB_VORBILD_JE_MODELL` wird NICHT
 * angefasst und behält seinen Faktor. Das ist der Rückweg, falls ein
 * künftiger Speicherstand ein Laubmaterial mitbringt, dessen Vorbild
 * unbekannt ist.
 *
 * Applies the original's two-colour crown gradient as a material plugin:
 * no extra draw call, no extra texture.
 */

import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';

import { LAUB_SPITZEN, type LaubSpitze } from '@wov/shared/src/laubSpitzen.js';
import { LAUB_VORBILD_JE_MODELL } from '@wov/shared/src/laubVorbilder.js';

export class LaubSpitzenPlugin extends MaterialPluginBase {
  /** `Top Color` — an der Blattspitze. */
  oben: [number, number, number] = [1, 1, 1];
  /** `Bottom Color` — am Ansatz der Karte. */
  unten: [number, number, number] = [1, 1, 1];
  /** `Added Color Amount`; darf über 1 liegen, das tut das Vorbild auch. */
  menge = 1;

  constructor(material: Material) {
    /*
      Das sechste Argument (`enable`) steht in `MaterialPluginBase` auf
      FALSE. Ohne es landet das Plugin nur in der passiven Liste: Die
      Uniformwerte werden deklariert, aber `_injectCustomCode` und
      `bindForSubMesh` laufen über `_activePlugins` — der Shadercode käme
      nie an, und nichts würde sich ändern. Genau dieser Fehler hat das
      Wind-Plugin einmal ein halbes Jahr lang wirkungslos gemacht.
    */
    super(material, 'LaubSpitzen', 210, { LAUBSPITZEN: true }, true, true);
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
    // Immer an für die Materialien, die das Plugin tragen.
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'laubOben', size: 3, type: 'vec3' },
        { name: 'laubUnten', size: 3, type: 'vec3' },
        { name: 'laubMenge', size: 1, type: 'float' },
      ],
    };
  }

  bindForSubMesh(
    uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh
  ): void {
    uniformBuffer.updateFloat3('laubOben', this.oben[0], this.oben[1], this.oben[2]);
    uniformBuffer.updateFloat3('laubUnten', this.unten[0], this.unten[1], this.unten[2]);
    uniformBuffer.updateFloat('laubMenge', this.menge);
  }

  getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    return {
      /*
        `vAlbedoUV` ist dieselbe Koordinate, mit der eine Zeile weiter
        oben die Blattkarte abgetastet wurde — Babylon führt sie als
        Varying oder, wenn die Karte direkt auf UV1 sitzt, als `#define`
        auf `vMainUV1`. Beides steht hier im Sichtbereich.

        `1.0 - ` dreht die V-Achse von glTF auf die des Vorbilds; das
        `clamp` ist die Versicherung gegen kachelnde UVs (Laubkarten
        liegen im Einheitsquadrat, Rinde kachelt bis u = 8,5 — sie trägt
        dieses Plugin nicht, aber ein Materialname ist keine Garantie).

        `mix` mit einer Menge über 1 extrapoliert — genau das tut der
        `mad` des Vorbilds auch, und `Maple Leaves 1` steht dort auf
        1,017. Kein `saturate`, sonst wäre es eine andere Formel.
      */
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: /* glsl */ `
#ifdef LAUBSPITZEN
  #ifdef ALBEDO
    float lsAnteil = clamp(1.0 - vAlbedoUV.y, 0.0, 1.0);
    vec3 lsVerlauf = mix(laubUnten, laubOben, lsAnteil);
    surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * lsVerlauf, laubMenge);
  #endif
#endif`,
    };
  }
}

/** Der Dateiname ohne Pfad und Endung — der Schlüssel der Tabelle. */
function modellSchluessel(modell: string): string {
  const letzter = modell.slice(modell.lastIndexOf('/') + 1);
  return letzter.endsWith('.glb') ? letzter.slice(0, -4) : letzter;
}

/**
 * Das Vorbild dieses Materials — oder `null`, wenn es keines hat.
 *
 * ZWEI Wege, weil es zwei Ladewege gibt:
 *
 *  1. AUFBEREITET (`store-lab/vegetation/…`, der Weg der Welt). Dort
 *     heissen die Materialien nach ihrer ROLLE (`laub`, `nadeln`), weil
 *     die Aufbereitung sie zusammenlegt — welches Vorbild dahinter
 *     steht, sagt die erzeugte Zuordnung.
 *  2. ROH (`store/vegetation/…`, der Weg des Editor-Katalogs und der
 *     Rückfall, solange die Aufbereitung nicht gelaufen ist). Dort trägt
 *     das Material seinen Originalnamen — er IST der Schlüssel.
 *
 * Im zweiten Fall ersetzt der Verlauf den Faktor des Asset-Herstellers.
 * Das ist dieselbe Entscheidung, die die Aufbereitung trifft (die
 * gemessene Farbe des Vorbilds schlägt den Store-Faktor), nur an einem
 * anderen Ort — und ohne sie stünde im Katalog ein anderes Blatt als in
 * der Welt ([[wov-editor-paritaet]]).
 *
 * Exportiert, weil `client/test/laub-spitzen.ts` an derselben Regel
 * misst; zwei Kopien davon liefen auseinander.
 */
export function laubVorbild(materialName: string, modell: string): LaubSpitze | null {
  const name = LAUB_VORBILD_JE_MODELL[modellSchluessel(modell)]?.[materialName] ?? materialName;
  const eintrag = LAUB_SPITZEN[name];
  return eintrag && eintrag.imLabor ? eintrag : null;
}

/**
 * Verlauf an EIN Material hängen. Gibt zurück, OB er hängt.
 *
 * Der Rückgabewert ist der Zeuge: Ein Test, der nur die Tabelle liest,
 * merkte nie, wenn der Weg ins `PBRMaterial` abreisst.
 */
export function laubSpitzenAuftragen(material: Material | null | undefined, modell: string): boolean {
  if (!(material instanceof PBRMaterial)) return false;
  const spitze = laubVorbild(material.name, modell);
  if (!spitze) return false;
  const vorhanden = material.pluginManager?.getPlugin('LaubSpitzen') as LaubSpitzenPlugin | null | undefined;
  const plugin = vorhanden ?? new LaubSpitzenPlugin(material);
  plugin.oben = [...spitze.oben];
  plugin.unten = [...spitze.unten];
  plugin.menge = spitze.menge;
  // Der Faktor aus der GLB IST das Mittel dieser beiden Farben — er
  // steckt jetzt im Verlauf und darf nicht noch einmal multiplizieren.
  material.albedoColor.set(1, 1, 1);
  return true;
}

/**
 * Dasselbe für eine ganze Ladung Meshes — der Weg des Editor-Katalogs,
 * der einen fertigen `AssetContainer` in der Hand hält und nicht Mesh
 * für Mesh durch `fixupMaterial` geht ([[wov-editor-paritaet]]).
 *
 * Gibt die Zahl der MATERIALIEN zurück, nicht der Meshes.
 */
export function laubSpitzenMeshes(meshes: readonly AbstractMesh[], modell: string): number {
  const gesehen = new Set<Material>();
  let n = 0;
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!material || gesehen.has(material)) continue;
    gesehen.add(material);
    if (laubSpitzenAuftragen(material, modell)) n++;
  }
  return n;
}
