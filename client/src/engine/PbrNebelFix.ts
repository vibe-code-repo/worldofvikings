/**
 * PbrNebelFix — bringt den Nebel von PBR-Materialien auf dieselbe Kurve
 * wie Gras, Wasser und Terrain.
 *
 * ── Das Symptom ──────────────────────────────────────────────────────
 * Gemeldet: "Wenn Nebel oder Dämmerung dazu kommt, sieht es so aus, als
 * würden Steine und Gebäude die Farbe des Nebels annehmen, aber die
 * Silhouetten bleiben gegen den Grund erhalten."
 *
 * Genau so muss es aussehen, wenn ein Objekt STÄRKER eingenebelt wird
 * als der Boden dahinter: Es nimmt die Nebelfarbe an, hebt sich aber
 * weiterhin ab, weil der Boden an derselben Stelle noch Eigenfarbe hat.
 *
 * ── Die Ursache ──────────────────────────────────────────────────────
 * `Shaders/ShadersInclude/fogFragment.js`:
 *
 *     float fog = CalcFogFactor();
 *     #ifdef PBR
 *     fog = toLinearSpace(fog);      // ← nur für PBR
 *     #endif
 *     color.rgb = mix(vFogColor, color.rgb, fog);
 *
 * `fog` ist der SICHTBARKEITS-Anteil (1 = klar, 0 = ganz im Nebel).
 * Babylon potenziert ihn bei PBR zusätzlich mit 2.2. Das verschiebt die
 * gesamte Nebelkurve:
 *
 *     fog     0.9    0.7    0.5    0.3    0.1
 *     fog^2.2 0.79   0.46   0.22   0.07   0.006
 *
 * Bei halber Sichtbarkeit ist ein PBR-Objekt also zu 78 % vernebelt, das
 * Terrain daneben nur zu 50 %. Fels, Gebäude und Bäume (alle PBR)
 * verschwinden dadurch viel früher im Dunst als der Boden, auf dem sie
 * stehen — und genau der Unterschied zeichnet die Silhouette.
 *
 * Die anderen beiden Pfade stimmen bereits überein, das wurde geprüft:
 * StandardMaterial nimmt `fog` roh, und die handgebaute Nebelkette im
 * Terrain-NodeMaterial (`TerrainSplat.ts`) rechnet
 * `1 - exp(-density²·d²)` und mischt umgekehrt herum — mathematisch
 * dasselbe wie Babylons `mix(vFogColor, color, exp(-density²·d²))`.
 * Auch Distanzmaß (euklidisch, `length(vFogDistance)`), Dichte
 * (`scene.fogDensity`) und Farbe (`Lighting.fogColorLinear`) sind in
 * allen drei Pfaden identisch.
 *
 * ── Warum die Potenzierung weg muss und nicht umgekehrt ──────────────
 * Unity — und damit Valheim — mischt den Nebel im linearen Raum mit dem
 * ROHEN Faktor (`UNITY_APPLY_FOG`). Babylons Extra-Schritt ist eine
 * Eigenheit ihres PBR-Pfads, keine physikalische Notwendigkeit. Die
 * beiden anderen Pfade an PBR anzugleichen hieße, den Fehler zu
 * verdreifachen statt ihn zu beheben.
 *
 * ── Umsetzung ────────────────────────────────────────────────────────
 * Regex-Ersetzung im aufgelösten Shadercode, wie in `StandardGammaFix.ts`.
 * Derselbe Fallstrick gilt: Eine LEERE Ersetzung wird verworfen
 * (`materialPluginManager.js:320` prüft `injectedCode.length > 0`),
 * deshalb steht dort ein Kommentar statt nichts.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { PBRBaseMaterial } from '@babylonjs/core/Materials/PBR/pbrBaseMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Trifft die eine Zeile im `#ifdef PBR`-Zweig von `fogFragment`.
 * `!!` = Regex ohne zusätzliche Flags (der Manager setzt `g` selbst).
 */
const RX_PBR_NEBELKURVE = '!!fog=toLinearSpace\\(fog\\);';

/** Nicht-leerer Ersatz — siehe Kopfkommentar. */
const ERSATZ = '// valheim: PBR-Nebelkurve an Terrain/Standard angeglichen (PbrNebelFix.ts)';

class PbrNebelFixPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priorität 110: direkt nach StandardGammaFix (100), damit die
    // Reihenfolge der Farbraum-Korrekturen nachvollziehbar bleibt.
    super(material, 'PbrNebelFix', 110, { PBRNEBELFIX: true }, true, true);
  }

  get isEnabled(): boolean {
    return true;
  }

  prepareDefines(): void {
    // immer an für die Materialien, die es dekoriert
  }

  getClassName(): string {
    return 'PbrNebelFixPlugin';
  }

  getCustomCode(shaderType: string): { [p: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return { [RX_PBR_NEBELKURVE]: ERSATZ };
  }
}

/**
 * Hängt den Fix an jedes vorhandene und künftige PBR-Material der Szene.
 * Einmal beim Aufbau aufrufen, VOR `blockMaterialDirtyMechanism = true`.
 */
export function installierePbrNebelFix(scene: Scene): void {
  const haenge = (m: Material): void => {
    if (!(m instanceof PBRBaseMaterial)) return;
    if (m.pluginManager?.getPlugin('PbrNebelFix')) return;
    new PbrNebelFixPlugin(m);
  };
  for (const m of scene.materials) haenge(m);
  scene.onNewMaterialAddedObservable.add(haenge);
}
