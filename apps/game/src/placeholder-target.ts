/**
 * The capsule the camera follows until there is a player.
 *
 * It is a stand-in, and only a stand-in: a mesh with a position, no controller,
 * no state, nothing a system reads back. The camera follows a `Vector3` getter
 * (spec §25), so replacing this with the real player entity in Phase 2 is a
 * change to one line in `./scene.ts` and to nothing in `@wov/engine`.
 *
 * The capsule hangs under a root node whose origin sits at the feet, the way a
 * character transform is rooted: the camera's `targetOffset` is measured from
 * the ground the character stands on, not from the middle of a mesh.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// One specific builder rather than the whole `MeshBuilder` set — see ADR-0006.
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Height of the placeholder in metres — the viking the camera is tuned for. */
export const PLACEHOLDER_HEIGHT = 1.8;
const PLACEHOLDER_RADIUS = 0.35;

export interface PlaceholderTarget {
  /** Origin at the feet; this is what the camera follows. */
  readonly root: TransformNode;
  readonly mesh: Mesh;
  /** The point the camera follows. Read fresh each frame, never cached. */
  position(): Vector3;
  dispose(): void;
}

export function createPlaceholderTarget(scene: Scene, at = Vector3.Zero()): PlaceholderTarget {
  const root = new TransformNode('placeholder-player', scene);
  root.position = at.clone();

  const mesh = CreateCapsule(
    'placeholder-player-body',
    {
      height: PLACEHOLDER_HEIGHT,
      radius: PLACEHOLDER_RADIUS,
      tessellation: 12,
      subdivisions: 1,
      capSubdivisions: 4,
    },
    scene,
  );
  mesh.parent = root;
  // Babylon builds the capsule around its centre; lift it onto its feet.
  mesh.position.y = PLACEHOLDER_HEIGHT / 2;

  const material = new StandardMaterial('placeholder-player-material', scene);
  material.diffuseColor = Color3.FromHexString('#a8956b');
  // Flat stylised surfaces (spec §23), and one lighting term less per pixel.
  material.specularColor = Color3.Black();
  mesh.material = material;

  return {
    root,
    mesh,
    position: () => root.position,
    dispose() {
      material.dispose();
      mesh.dispose();
      root.dispose();
    },
  };
}
