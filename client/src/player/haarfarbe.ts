/**
 * Haarfarbe auf die Netze einer Frisur legen.
 *
 * ── Warum eine eigene Datei ─────────────────────────────────────────
 * Dieselbe Faerbung braucht die eigene Figur (AvatarRig), jeder
 * Mitspieler (EntityManager) und die Vorschau im Anmeldebildschirm
 * (CharakterVorschau). Dreimal dieselben Zeilen waeren dreimal die
 * Gelegenheit, den heiklen Teil zu vergessen — das eigene Material.
 *
 * ── Warum ueberhaupt ein eigenes Material ───────────────────────────
 * `AssetManager.instantiate` klont ueber `instantiateModelsToScene` die
 * NETZE, aber NICHT die Materialien. Alle Mitspieler mit derselben
 * Frisur haengen deshalb an EINEM `haar_platzhalter`. Wer dort die Farbe
 * setzt, faerbt alle mit — und merkt es allein auf dem Testgestade nie.
 *
 * Derselbe Mechanismus hat in diesem Projekt schon einmal allen Truhen
 * die Textur genommen (s. EntityManager, `dispose(false, false)`).
 *
 * ── Warum NICHT `material.clone()` ──────────────────────────────────
 * Weil es wirft. Babylons `Material._ParsePlugins` holt die
 * Zusatzmodule eines Materials beim Klonen ueber
 * `Tools.Instantiate("BABYLON." + Klassenname)` aus einer globalen
 * Ablage. Dieses Projekt haengt ACHT eigene Zusatzmodule an seine
 * Materialien (PbrNebelFix, NebelRichtung, FackelLicht, Wind, Water,
 * ClutterWind, BaumImpostor, StandardGammaFix); keines steht in jener
 * Ablage. Gemessen:
 *
 *     TypeError: Cannot read properties of undefined
 *                (reading 'PbrNebelFixPlugin')
 *
 * Alle acht dort einzutragen hiesse, fuer eine Haarfarbe in acht fremde
 * Systeme zu greifen. Ein FRISCHES Material braucht das nicht: Die
 * Zusatzmodule haengen sich ueber `scene.onNewMaterialAddedObservable`
 * an jedes neue Material selbst an — genau so kommen sie ueberhaupt an
 * die Materialien der Szene.
 *
 * ── Warum die Kopien gemerkt werden ─────────────────────────────────
 * Kleidung und Frisuren werden mit `dispose(false, false)` entsorgt,
 * damit die geteilten Materialien des Containers ueberleben. Eine je
 * Wechsel neu erzeugte Kopie wuerde dabei liegenbleiben. Die Ablage
 * unten gibt fuer dieselbe Frisur in derselben Farbe immer dasselbe
 * Material zurueck: Zwei Spieler mit schwarzem Zopf teilen es sich —
 * das ist richtig so, denn sie sehen gleich aus.
 *
 * ── Farbraum ────────────────────────────────────────────────────────
 * Die Palette steht als sRGB-Hex in shared/aussehen.ts, weil das ein
 * Mensch liest. `albedoColor` ist LINEAR — glTF legt `baseColorFactor`
 * unveraendert dorthin, und der ist linear definiert. Ohne
 * `toLinearSpace()` waere jede Farbe sichtbar zu hell.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

/** Vorlage-Material + Farbe → fertiges Material. */
const kopien = new Map<string, PBRMaterial>();

function eigenesMaterial(vorlage: PBRMaterial, hex: string, farbe: Color3): PBRMaterial {
  const schluessel = `${vorlage.uniqueId}|${hex}`;
  const bekannt = kopien.get(schluessel);
  // `getScene()` liefert nach dem Entsorgen null — das ist die
  // Pruefung, die Babylon hier hergibt (ein `isDisposed` gibt es
  // am Material nicht).
  if (bekannt && bekannt.getScene()) return bekannt;

  const neu = new PBRMaterial(`${vorlage.name}_${hex.slice(1)}`, vorlage.getScene());
  // Von Hand uebertragen statt serialisiert: Was hier NICHT steht, gibt
  // es an einem Haarmaterial auch nicht — die 21 Frisuren tragen keine
  // einzige Textur (nachgemessen: 0 Bilder je Datei). Kommt spaeter eine
  // dazu, gehoert sie in diese Liste.
  neu.albedoTexture = vorlage.albedoTexture;
  neu.bumpTexture = vorlage.bumpTexture;
  neu.opacityTexture = vorlage.opacityTexture;
  neu.metallic = vorlage.metallic;
  neu.roughness = vorlage.roughness;
  neu.backFaceCulling = vorlage.backFaceCulling;
  neu.twoSidedLighting = vorlage.twoSidedLighting;
  neu.alpha = vorlage.alpha;
  neu.transparencyMode = vorlage.transparencyMode;
  neu.alphaCutOff = vorlage.alphaCutOff;
  neu.albedoColor = farbe;

  kopien.set(schluessel, neu);
  return neu;
}

/**
 * @param netze  Netze der Frisur.
 * @param hex    sRGB-Hex aus HAARFARBEN, z. B. "#6F593F". Leer = nichts tun.
 * @param eigen  Eigenes Material erzwingen. NOETIG ueberall dort, wo die
 *               Netze aus dem Container-Cache stammen (Mitspieler);
 *               unnoetig, wo `ImportMeshAsync` je Figur ohnehin ein
 *               eigenes Material erzeugt hat.
 */
export function faerbeHaar(
  netze: readonly AbstractMesh[],
  hex: string,
  eigen: boolean
): void {
  if (!hex) return;
  const farbe = Color3.FromHexString(hex).toLinearSpace();
  for (const m of netze) {
    const mat = m.material;
    if (!mat) continue;
    if (mat instanceof PBRMaterial) {
      if (eigen) m.material = eigenesMaterial(mat, hex, farbe);
      else mat.albedoColor = farbe;
      continue;
    }
    // Die Klotzfigur traegt ein Standardmaterial und gehoert immer nur
    // einer Figur — dort genuegt das Setzen.
    const std = mat as unknown as { diffuseColor?: Color3 };
    if ('diffuseColor' in std) std.diffuseColor = farbe;
  }
}
