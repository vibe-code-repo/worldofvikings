/**
 * StandardGammaFix — entfernt die überzählige Gamma-Konvertierung, die
 * Babylons StandardMaterial an unsere LINEARE Pipeline anhängt.
 *
 * ── Der Fehler ───────────────────────────────────────────────────────
 * `Shaders/default.fragment.js` schließt jedes StandardMaterial-Fragment
 * so ab:
 *
 *     #ifdef IMAGEPROCESSINGPOSTPROCESS
 *     color.rgb=toLinearSpace(color.rgb);          // ← Zeile 307
 *     #else
 *     #ifdef IMAGEPROCESSING
 *     color.rgb=toLinearSpace(color.rgb);color=applyImageProcessing(color);
 *     #endif
 *     #endif
 *
 * Das ist Absicht: StandardMaterial ist bei Babylon per Konvention ein
 * GAMMA-Material. Es rechnet in Gamma-Zahlen und wandelt am Ende einmal
 * nach Linear, damit der ImageProcessing-Pass am Schluss wieder nach
 * Gamma zurückkann. PBRMaterial tut das nicht, das Terrain-NodeMaterial
 * auch nicht (`FragmentOutputBlock.convertToLinearSpace` ist default
 * `false`).
 *
 * Unser Projekt füttert StandardMaterial aber durchgehend LINEAR:
 *   · `Lighting.ts` setzt `sun.diffuse`/`ambient.diffuse` über `toLinear()`
 *   · `Lighting.bindeLinearenNebel()` überschreibt `vFogColor` mit dem
 *     linearen Wert
 *   · `GrassClutter.ts` lädt die Halmtexturen mit `useSRGBBuffer: true`
 *
 * Damit wird ein linearer Wert ein zweites Mal potenziert und als sRGB
 * angezeigt. Das Potenzieren mit 2.2 spreizt Kanalverhältnisse, also
 * STEIGT die Sättigung, statt dass nur die Helligkeit sinkt. Gemessen am
 * Wiesenboden (`node tools/shot-stats.mjs`, Region 300 700 1600 950):
 *
 *     Erwartung korrekt        RGB( 98, 111,  60)   Sättigung 46 %
 *     Vorhersage mit Fehler    RGB(~71, ~77,  ~12)  Sättigung ~84 %
 *     tatsächlich gemessen     RGB( 71,  77,   12)  Sättigung  84 %
 *
 * Der zerquetschte Blaukanal und die Übersättigung des Grases fallen
 * genau aus diesem einen Statement. Siehe Docs/07-Grafik-Konzept.md,
 * Ursache A.
 *
 * ── Die Umsetzung ────────────────────────────────────────────────────
 * Der MaterialPluginManager erlaubt Regex-Ersetzungen im fertig
 * aufgelösten Shadercode über Injektionspunkte mit `!`-Präfix
 * (`materialPluginManager.js:322-352`). Zwei Fallstricke stecken darin,
 * beide unten im Code behandelt:
 *
 *  1. **Leere Ersetzungen werden verworfen.** Zeile 320 prüft
 *     `if (injectedCode.length > 0)` — man kann eine Zeile also NICHT
 *     durch `''` löschen, das ist stillschweigend ein No-Op. Wir ersetzen
 *     sie deshalb durch einen Kommentar (nicht-leer, aber wirkungslos),
 *     der im Shader-Dump zugleich erklärt, warum dort etwas fehlt.
 *  2. **Es gibt ZWEI Vorkommen.** Das zweite (im `#else`-Zweig) ist
 *     KORREKT und muss stehen bleiben: dort wandelt `applyImageProcessing`
 *     unmittelbar danach selbst nach Gamma zurück. Ein Regex auf den
 *     bloßen Ausdruck trifft beide und würde das Bild dort kaputtmachen,
 *     wo das ImageProcessing im Material statt als PostProcess läuft.
 *     Der negative Lookahead unten grenzt sauber ab.
 *
 * Angehängt wird über `scene.onNewMaterialAddedObservable` — dasselbe
 * Muster wie `Lighting.bindeLinearenNebel()`, und aus demselben Grund:
 * Gras, Wasser, Avatar und Platzierungsmarker entstehen in fünf Dateien
 * zu unterschiedlichen Zeitpunkten. Wichtig ist nur, dass die
 * Registrierung VOR `scene.blockMaterialDirtyMechanism = true`
 * (`main.ts`) läuft, sonst würde ein späteres Neuübersetzen blockiert.
 */
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Trifft `color.rgb=toLinearSpace(color.rgb);` NUR im Zweig
 * `#ifdef IMAGEPROCESSINGPOSTPROCESS`. Der negative Lookahead schließt
 * das zweite, korrekte Vorkommen aus, das auf derselben Zeile mit
 * `color=applyImageProcessing(color);` fortfährt.
 *
 * `!!` als Präfix heißt "Regex ohne zusätzliche Flags" (der Manager setzt
 * `g` ohnehin selbst). Ein einfaches `!` würde die führenden Zeichen als
 * Flag-Buchstaben zu lesen versuchen.
 */
const RX_DOPPELTES_GAMMA =
  '!!color\\.rgb=toLinearSpace\\(color\\.rgb\\);(?!color=applyImageProcessing)';

/** Nicht-leerer Ersatz — siehe Fallstrick 1 im Kopfkommentar. */
const ERSATZ = '// valheim: doppelte Gamma-Kodierung entfernt (Docs/07, Ursache A)';

class StandardGammaFixPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    // Priorität 100: früh genug, dass spätere Plugins (Wind, Wasser, Nebel)
    // auf dem bereinigten Code aufsetzen. Der 5. Parameter markiert das
    // Plugin als "addToPluginList", der 6. aktiviert es — ohne den landet
    // es nur in der passiven Liste und getCustomCode() wird nie ausgewertet
    // (derselbe Fallstrick ist in ClutterWindPlugin.ts dokumentiert).
    super(material, 'StandardGammaFix', 100, { STANDARDGAMMAFIX: true }, true, true);
  }

  get isEnabled(): boolean {
    return true;
  }

  prepareDefines(): void {
    // Immer an für die Materialien, die es dekoriert.
  }

  getClassName(): string {
    return 'StandardGammaFixPlugin';
  }

  getCustomCode(shaderType: string): { [p: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return { [RX_DOPPELTES_GAMMA]: ERSATZ };
  }
}

/**
 * Hängt den Fix an jedes vorhandene und künftige StandardMaterial der
 * Szene. Einmal beim Aufbau aufrufen, VOR
 * `scene.blockMaterialDirtyMechanism = true`.
 */
export function installiereStandardGammaFix(scene: Scene): void {
  const haenge = (m: Material): void => {
    if (!(m instanceof StandardMaterial)) return;
    // Doppelt anhängen würde den Regex zweimal laufen lassen; beim zweiten
    // Mal findet er nichts mehr, aber der Manager legt trotzdem einen
    // zweiten Plugin-Eintrag an.
    if (m.pluginManager?.getPlugin('StandardGammaFix')) return;
    new StandardGammaFixPlugin(m);
  };
  for (const m of scene.materials) haenge(m);
  scene.onNewMaterialAddedObservable.add(haenge);
}
