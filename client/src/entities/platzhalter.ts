/**
 * Placeholder box for dynamic entities without a model, with one cached material
 * per scene and prefab name. The cache exists exactly once.
 * Moved verbatim out of EntityManager.ts.
 */

import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math';
import type { Scene } from '@babylonjs/core/scene';

/** Small named box for dynamic entities without a model in the export. */
/**
 * Platzhalter-Materialien je Szene und Prefabname.
 *
 * Sie hängen nur an der FARBE, die aus dem Namen gerechnet wird — zwei
 * Platzhalter desselben Prefabs brauchen also kein zweites Material.
 * Wichtiger noch: Instanzen werden ohne ihr Material entsorgt (s.
 * removeZDO), ein frisch erzeugtes Material je Platzhalter bliebe sonst
 * bei jedem Entfernen liegen. Geteilt und gecacht kann das nicht
 * passieren.
 */
const platzhalterMaterialien = new WeakMap<Scene, Map<string, StandardMaterial>>();

function makePlaceholder(scene: Scene, name: string): TransformNode {
  const root = new TransformNode(`ph_${name}`, scene);
  const box = MeshBuilder.CreateBox(`ph_${name}_box`, { size: 0.7 }, scene);
  let cache = platzhalterMaterialien.get(scene);
  if (!cache) {
    cache = new Map();
    platzhalterMaterialien.set(scene, cache);
  }
  let mat = cache.get(name);
  if (!mat) {
    mat = new StandardMaterial(`ph_${name}_mat`, scene);
    const hue = (Array.from(name).reduce((a, c) => a + c.charCodeAt(0) * 31, 7) % 360) / 360;
    mat.diffuseColor = Color3.FromHSV(hue * 360, 0.45, 0.75);
    mat.specularColor = new Color3(0, 0, 0);
    cache.set(name, mat);
  }
  box.material = mat;
  box.position.y = 0.5;
  box.parent = root;
  return root;
}

export { makePlaceholder };
