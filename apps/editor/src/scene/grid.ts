/**
 * The grid mesh, built from {@link gridGeometry} with Babylon's line system.
 *
 * `CreateLineSystem` is imported from its own builder module rather than from
 * `MeshBuilder`, which would pull every builder Babylon has into the bundle
 * (ADR-0006). Lines need no material, no lighting and no new dependency — the
 * spec's "visible grid" costs three draw calls.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { Scene } from '@babylonjs/core/scene';
import { gridGeometry, type GridLine, type GridOptions } from './grid-lines.js';

/** The three meshes the grid consists of, so each can be coloured on its own. */
export interface GridHandle {
  readonly minor: LinesMesh;
  readonly major: LinesMesh;
  readonly axes: LinesMesh;
  /** Shows or hides all three at once (View ▸ Grid). */
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}

function toLineSystem(lines: readonly GridLine[]): Vector3[][] {
  return lines.map(([start, end]) => [
    new Vector3(start[0], start[1], start[2]),
    new Vector3(end[0], end[1], end[2]),
  ]);
}

function buildLines(
  name: string,
  lines: readonly GridLine[],
  colour: Color3,
  scene: Scene,
): LinesMesh {
  const mesh = CreateLineSystem(name, { lines: toLineSystem(lines) }, scene);
  mesh.color = colour;
  // The grid is scenery, never a pick target: clicking through it is what makes
  // "click the ground to place a prefab" land on the ground.
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}

/** Builds the ground grid for the editor viewport. */
export function createGrid(scene: Scene, options: Partial<GridOptions> = {}): GridHandle {
  const geometry = gridGeometry(options);
  const minor = buildLines('editor-grid-minor', geometry.minor, new Color3(0.2, 0.23, 0.28), scene);
  const major = buildLines(
    'editor-grid-major',
    geometry.major,
    new Color3(0.34, 0.38, 0.45),
    scene,
  );
  // One mesh for both axes, tinted between the usual red and blue: two meshes
  // for two lines would be two draw calls for no visible gain.
  const axes = buildLines('editor-grid-axes', geometry.axes, new Color3(0.62, 0.5, 0.4), scene);

  let visible = true;
  const all = [minor, major, axes];

  return {
    minor,
    major,
    axes,
    setVisible(next) {
      visible = next;
      for (const mesh of all) {
        mesh.setEnabled(next);
      }
    },
    isVisible() {
      return visible;
    },
    dispose() {
      for (const mesh of all) {
        mesh.dispose();
      }
    },
  };
}
