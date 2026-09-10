/**
 * Die Tönung der Spielfigur auftragen — EINE Stelle für alle drei
 * Ladewege.
 *
 * Warum eine eigene Datei: Die Figur wird an drei Stellen geladen, und
 * keine kennt die andere.
 *
 *   AvatarRig.ladeModell      die EIGENE Figur, direkt über SceneLoader
 *   CharakterVorschau         dieselbe Figur im Anmeldebildschirm
 *   AssetManager.fixupMaterial FREMDE Spieler, über den Modellcache
 *
 * Der Faktor selbst und seine Herleitung stehen in
 * `shared/src/figuren.ts` (`FIGUR_TOENUNG`) — dort, wo auch die
 * Figurenliste steht, damit eine neue Figur ihre Tönung neben ihrem
 * Eintrag bekommt und nicht in einem Client-Winkel.
 *
 * Warum nicht `albedoTexture` umfärben: Die Textur ist ein Atlas und
 * wird von allen drei Materialien der Figur geteilt; ein Faktor am
 * Material ist genau das, was der glTF `baseColorFactor` ausdrückt —
 * und es ist derselbe Hebel, den `tools/store-vegetation-aufbereiten.mjs`
 * für jedes andere Synty-Modell im Labor benutzt.
 */

import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { figurToenung } from '@wov/shared';

/**
 * Tönt EIN Material, wenn das Modell eine Tönung hat.
 *
 * Gibt zurück, ob getönt wurde — der Test misst daran, dass der Weg
 * wirklich bis ins Material reicht, statt nur die Tabelle zu lesen.
 *
 * Der Faktor wird GESETZT und nicht multipliziert: `fixupMaterial` läuft
 * je Mesh, und mehrere Meshes teilen sich ein Material (elf Körperteile,
 * drei Materialien). Multipliziert man, wird die Figur bei jedem
 * weiteren Mesh dunkler — ein Fehler, der sich als „mal so, mal so"
 * zeigt und von der Ladereihenfolge abhängt.
 */
export function toeneFigurMaterial(material: Material | null | undefined, modell: string): boolean {
  const toenung = figurToenung(modell);
  if (!toenung || !(material instanceof PBRMaterial)) return false;
  material.albedoColor.set(toenung[0], toenung[1], toenung[2]);
  return true;
}

/** Dasselbe für eine ganze Ladung Meshes. Gibt die Zahl der getönten Materialien zurück. */
export function toeneFigurMeshes(meshes: readonly AbstractMesh[], modell: string): number {
  if (!figurToenung(modell)) return 0;
  const gesehen = new Set<Material>();
  let n = 0;
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!material || gesehen.has(material)) continue;
    gesehen.add(material);
    if (toeneFigurMaterial(material, modell)) n++;
  }
  return n;
}
