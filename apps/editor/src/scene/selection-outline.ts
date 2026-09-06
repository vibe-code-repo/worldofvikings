/**
 * The box drawn around the selection.
 *
 * A line box rather than Babylon's `HighlightLayer`: the highlight layer is a
 * post-process that draws a glow around *meshes*, and an entity here is a
 * `TransformNode` with an imported hierarchy under it — the glow would have to
 * be attached mesh by mesh and reattached whenever a model finishes loading.
 * A box around the hull is also what an author actually wants to read: it says
 * how big the thing is, which a glow does not.
 *
 * It reuses the line meshes the grid is built from, so it costs one draw call
 * and no new dependency.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder.js';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Bounds } from './editor-camera-math.js';
import type { GridLine, Point3 } from './grid-lines.js';

/** The twelve edges of an axis-aligned box, as line segments. */
export function boxEdges(bounds: Bounds): readonly GridLine[] {
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  const corner = (x: number, y: number, z: number): Point3 => [x, y, z];

  const bottom: Point3[] = [
    corner(x0, y0, z0),
    corner(x1, y0, z0),
    corner(x1, y0, z1),
    corner(x0, y0, z1),
  ];
  const top: Point3[] = [
    corner(x0, y1, z0),
    corner(x1, y1, z0),
    corner(x1, y1, z1),
    corner(x0, y1, z1),
  ];

  const edges: GridLine[] = [];
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    edges.push([bottom[index] as Point3, bottom[next] as Point3]);
    edges.push([top[index] as Point3, top[next] as Point3]);
    edges.push([bottom[index] as Point3, top[index] as Point3]);
  }
  return edges;
}

export interface SelectionOutline {
  /** Draws the box, or hides it when `bounds` is `null`. */
  show(bounds: Bounds | null): void;
  dispose(): void;
}

export function createSelectionOutline(scene: Scene): SelectionOutline {
  let mesh: LinesMesh | null = null;

  const clear = (): void => {
    mesh?.dispose();
    mesh = null;
  };

  return {
    show(bounds) {
      clear();
      if (bounds === null) {
        return;
      }
      const lines = boxEdges(bounds).map(([start, end]) => [
        new Vector3(start[0], start[1], start[2]),
        new Vector3(end[0], end[1], end[2]),
      ]);
      // Rebuilt rather than updated: the box changes only when the selection or
      // its size does, which is a click or the end of a drag, never a frame.
      mesh = CreateLineSystem('editor-selection', { lines }, scene);
      mesh.color = new Color3(0.78, 0.64, 0.36);
      mesh.isPickable = false;
      // Drawn over the model it surrounds; a box hidden inside a solid prop
      // says nothing.
      mesh.renderingGroupId = 1;
    },
    dispose: clear,
  };
}
