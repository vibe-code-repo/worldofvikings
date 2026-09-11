/**
 * Die Grundfarbe eines Speicher-Materials auftragen — EINE Stelle fuer
 * beide Ladewege.
 *
 * Warum eine eigene Datei, und nicht zwei Zeilen im `AssetManager`: Die
 * Speicher-Modelle werden an ZWEI Stellen geladen, und keine kennt die
 * andere.
 *
 *   AssetManager.fixupMaterial   die Welt, ueber den Modellcache
 *   GegenstandsKatalog           die Editor-Vorschau, mit einem eigenen
 *                                `LoadAssetContainerAsync` am Cache vorbei
 *
 * Ohne den zweiten Aufruf stuende im Katalog ein heller und in der Welt
 * ein dunkler Stein — der Editor waere ueber den Bestand falsch
 * informiert, den er setzt ([[wov-editor-paritaet]]).
 *
 * Der Faktor selbst und seine Herleitung stehen in
 * `shared/src/syntyGrundfarben.ts`, dort, wo auch die Regeln stehen;
 * dieselbe Aufteilung wie bei `FIGUR_TOENUNG`/`FigurToenung.ts`.
 *
 * ── GESETZT, nicht multipliziert ─────────────────────────────────────
 * `fixupMaterial` laeuft je MESH, und mehrere Meshes teilen sich ein
 * Material (ein Findling fuehrt bis zu vier). Multipliziert man, wird
 * dasselbe Modell bei jedem weiteren Mesh dunkler, und zwar abhaengig von
 * der Ladereihenfolge. Setzen macht den Aufruf ausserdem idempotent: Der
 * Katalog darf ueber dasselbe Material zweimal laufen, ohne dass es
 * nachdunkelt.
 *
 * ── Ein Uniform, kein Define ─────────────────────────────────────────
 * `albedoColor` ist ein Uniform. Es geht auch dann durch, wenn
 * `scene.blockMaterialDirtyMechanism` gerade gesetzt ist — und das ist es
 * im laufenden Spiel (gemessen: `blockDirty true`). Ein Define haette an
 * derselben Stelle stumm nichts getan
 * ([[wov-babylon-material-dirty-sperre]]).
 *
 * Applies the store base colour factor; one place for both load paths.
 */

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { syntyGrundfarbe } from '@wov/shared/src/syntyGrundfarben.js';

/**
 * Toent EIN Material, wenn Modell und Materialname eine Grundfarbe
 * haben.
 *
 * Gibt zurueck, OB getoent wurde. Der Test misst daran, dass der Weg
 * wirklich bis ins `PBRMaterial` reicht, statt nur die Tabelle zu lesen —
 * ein Rueckgabewert, den ein wirkungsloser Einbau nicht liefern kann.
 */
export function toeneStoreMaterial(material: Material | null | undefined, modell: string): boolean {
  if (!(material instanceof PBRMaterial)) return false;
  const farbe = syntyGrundfarbe(material.name, modell);
  if (!farbe) return false;
  material.albedoColor.set(farbe[0], farbe[1], farbe[2]);
  return true;
}

/**
 * Dasselbe fuer eine ganze Ladung Meshes — der Weg des Editor-Katalogs,
 * der einen fertigen `AssetContainer` in der Hand haelt und nicht Mesh
 * fuer Mesh durch `fixupMaterial` geht.
 *
 * Gibt die Zahl der getoenten MATERIALIEN zurueck (nicht der Meshes):
 * Ein Modell mit vier Meshes auf einem Material meldet 1, und genau das
 * ist die Zahl, an der sich „setzen statt multiplizieren" ablesen laesst.
 */
export function toeneStoreMeshes(meshes: readonly AbstractMesh[], modell: string): number {
  const gesehen = new Set<Material>();
  let n = 0;
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!material || gesehen.has(material)) continue;
    gesehen.add(material);
    if (toeneStoreMaterial(material, modell)) n++;
  }
  return n;
}
