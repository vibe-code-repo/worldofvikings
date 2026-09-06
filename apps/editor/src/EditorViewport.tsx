import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import { AssetManager, summarizeAssetSources } from '@wov/asset-system';
import type { AssetSourceConfig } from '@wov/asset-system';
import { snapPosition, snapRotation } from '@wov/editor-core';
import type { EditorDocument, TransformChange } from '@wov/editor-core';
import type { Vector3 } from '@wov/world-schema';
import { publishEditorDebug } from './dev-debug.js';
import {
  createGizmos,
  type EditorTool,
  type GizmoSet,
  type GizmoTransform,
} from './scene/gizmos.js';
import { dropToSurface, pickWorldPoint } from './scene/picking.js';
import type { PrefabIndex } from './scene/prefab-index.js';
import { createSceneSync, type SceneSync } from './scene/scene-sync.js';
import { createSelectionOutline, type SelectionOutline } from './scene/selection-outline.js';
import { createViewport, type ViewportHandle } from './scene/viewport.js';

/** How far the pointer may travel between press and release and still be a click. */
const CLICK_SLOP_PX = 4;

/** The drag-and-drop payload the asset browser writes and the canvas reads. */
export const PREFAB_DRAG_TYPE = 'application/x-wov-prefab';

export interface SnapSettings {
  readonly enabled: boolean;
  /** Grid step in metres. */
  readonly step: number;
  /** Rotation step in degrees. */
  readonly rotationStepDegrees: number;
}

/** What the shell can ask the viewport to do imperatively. */
export interface ViewportController {
  /** Frames these entities, or the whole zone when the list is empty (`F`). */
  focus(entityIds: readonly string[]): void;
}

export interface EditorViewportProps {
  readonly document: EditorDocument;
  /** `null` until `GET /prefabs` answers; the viewport runs without it. */
  readonly prefabs: PrefabIndex | null;
  readonly assetSource: AssetSourceConfig;
  readonly tool: EditorTool;
  readonly gridVisible: boolean;
  readonly snapping: SnapSettings;
  /** The prefab the next viewport click places, or `null` for plain selection. */
  readonly placingPrefabId: string | null;
  readonly onPick: (entityId: string | null, additive: boolean) => void;
  readonly onPlace: (prefabId: string, position: Vector3) => void;
  readonly onTransform: (changes: readonly TransformChange[]) => void;
  /** Reports the asset origins line, e.g. `assets: 2 private, 0 placeholder`. */
  readonly onAssetSources: (line: string) => void;
  readonly onController: (controller: ViewportController | null) => void;
}

/**
 * The Babylon viewport, driven by the document (ADR-0018).
 *
 * React owns the document; this component owns the scene and does exactly two
 * things with it: it makes the scene match the document whenever the document
 * changes, and it turns clicks and drags into *commands* that go back to
 * React. It never edits the world itself — that is the whole reason a gizmo
 * drag can be undone.
 *
 * The mutable props are mirrored into refs because the Babylon event handlers
 * are installed once and live for the lifetime of the scene; reinstalling them
 * on every render would drop a gesture in progress.
 */
export function EditorViewport(props: EditorViewportProps): JSX.Element {
  const {
    document: editorDocument,
    prefabs,
    assetSource,
    tool,
    gridVisible,
    snapping,
    placingPrefabId,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);
  const [status, setStatus] = useState('starting…');
  const [frameId, setFrameId] = useState(-1);

  const syncRef = useRef<SceneSync | null>(null);
  const gizmosRef = useRef<GizmoSet | null>(null);
  const outlineRef = useRef<SelectionOutline | null>(null);
  const dragStartRef = useRef<Map<string, GizmoTransform>>(new Map());

  // Live copies of everything the event handlers need to read.
  const documentRef = useRef(editorDocument);
  documentRef.current = editorDocument;
  const snappingRef = useRef(snapping);
  snappingRef.current = snapping;
  const placingRef = useRef(placingPrefabId);
  placingRef.current = placingPrefabId;
  const prefabsRef = useRef(prefabs);
  prefabsRef.current = prefabs;
  const handlersRef = useRef(props);
  handlersRef.current = props;

  // --- the render surface -------------------------------------------------
  // See `scene/viewport.ts` for why this chains onto the previous lifecycle
  // instead of racing it under React StrictMode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    let handle: ViewportHandle | undefined;
    let unsubscribe: (() => void) | undefined;

    const started = lifecycle.current.then(async () => {
      if (cancelled) {
        return;
      }
      try {
        const created = await createViewport(canvas);
        if (cancelled) {
          created.dispose();
          return;
        }
        handle = created;
        setStatus(`viewport ready — ${created.backend}`);
        publishEditorDebug({ backend: created.backend });
        unsubscribe = created.onFrame((index) => {
          setFrameId(index);
          publishEditorDebug({ frameId: index });
        });
        setViewport(created);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            `viewport unavailable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    });
    lifecycle.current = started.catch(() => undefined);

    return () => {
      cancelled = true;
      lifecycle.current = started.then(
        () => {
          unsubscribe?.();
          setViewport(null);
          handle?.dispose();
          handle = undefined;
        },
        () => undefined,
      );
    };
  }, []);

  // --- the scene the document describes ------------------------------------
  useEffect(() => {
    if (!viewport || !prefabs) {
      return;
    }
    const assets = new AssetManager({
      source: assetSource,
      scene: viewport.scene,
      catalog: prefabs.assets,
    });
    const report = (): void => {
      handlersRef.current.onAssetSources(summarizeAssetSources(assets.sources()));
      publishEditorDebug({ meshCount: sync.meshCount() });
    };
    const sync = createSceneSync({
      scene: viewport.scene,
      assets,
      prefabs,
      onSceneChanged: report,
    });
    syncRef.current = sync;
    const outline = createSelectionOutline(viewport.scene);
    outlineRef.current = outline;
    sync.apply(documentRef.current);
    report();

    return () => {
      syncRef.current = null;
      outlineRef.current = null;
      outline.dispose();
      sync.dispose();
      void assets.dispose();
    };
  }, [viewport, prefabs, assetSource]);

  // --- handles, picking and dropping ---------------------------------------
  useEffect(() => {
    if (!viewport) {
      return;
    }
    const canvas = viewport.renderer.engine.getRenderingCanvas();
    if (!canvas) {
      return;
    }

    const gizmos = createGizmos({
      scene: viewport.scene,
      onDragStart() {
        // The whole gesture becomes one command, so the starting transforms of
        // every selected entity are what the delta is measured against.
        const sync = syncRef.current;
        const starts = new Map<string, GizmoTransform>();
        for (const id of documentRef.current.selection) {
          const node = sync?.nodeFor(id);
          if (node) {
            starts.set(id, {
              position: [node.position.x, node.position.y, node.position.z],
              rotation: [node.rotation.x, node.rotation.y, node.rotation.z],
              scale: [node.scaling.x, node.scaling.y, node.scaling.z],
            });
          }
        }
        dragStartRef.current = starts;
      },
      onDragEnd(finished) {
        const selection = documentRef.current.selection;
        const primary = selection.at(-1);
        const start = primary === undefined ? undefined : dragStartRef.current.get(primary);
        if (primary === undefined || start === undefined) {
          return;
        }
        const settings = snappingRef.current;
        const delta = {
          position: subtract(finished.position, start.position),
          rotation: subtract(finished.rotation, start.rotation),
          scale: divide(finished.scale, start.scale),
        };
        const changes: TransformChange[] = [];
        for (const id of selection) {
          const from = dragStartRef.current.get(id);
          if (from === undefined) {
            continue;
          }
          const moved = add(from.position, delta.position);
          const turned = add(from.rotation, delta.rotation);
          const scaled = multiply(from.scale, delta.scale);
          changes.push({
            entityId: id,
            patch: {
              position: settings.enabled ? snapPosition(moved, settings.step) : moved,
              rotation: settings.enabled
                ? snapRotation(turned, settings.rotationStepDegrees)
                : turned,
              scale: scaled,
            },
          });
        }
        if (changes.length > 0) {
          handlersRef.current.onTransform(changes);
        }
      },
    });
    gizmosRef.current = gizmos;

    let pressX = 0;
    let pressY = 0;
    let pressed = false;

    const localPoint = (event: PointerEvent | DragEvent<HTMLCanvasElement>): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    /** Where a click puts something: on the surface, on the grid if snapping. */
    const placementAt = (x: number, y: number): Vector3 | null => {
      const point = pickWorldPoint(viewport.scene, x, y);
      if (point === null) {
        return null;
      }
      const settings = snappingRef.current;
      const planar = settings.enabled ? snapPosition(point, settings.step) : point;
      // Grid decides x and z; the world decides y (spec §14 surface snapping).
      const surfaceY = dropToSurface(viewport.scene, planar[0], planar[2]);
      return [planar[0], surfaceY, planar[2]];
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      pressed = true;
      [pressX, pressY] = localPoint(event);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.button !== 0 || !pressed) {
        return;
      }
      pressed = false;
      const [x, y] = localPoint(event);
      // A drag that happens to end over a prop is a camera move, not a click,
      // and a release right after a gizmo drag is the gizmo's, not a selection.
      if (Math.hypot(x - pressX, y - pressY) > CLICK_SLOP_PX || gizmos.isDragging()) {
        return;
      }

      const placing = placingRef.current;
      if (placing !== null) {
        const position = placementAt(x, y);
        if (position !== null) {
          handlersRef.current.onPlace(placing, position);
        }
        return;
      }

      const picked = viewport.scene.pick(x, y, (mesh) => mesh.isPickable && mesh.isEnabled());
      const entityId = syncRef.current?.entityOf(picked?.pickedMesh) ?? null;
      handlersRef.current.onPick(entityId, event.shiftKey || event.ctrlKey);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    const controller: ViewportController = {
      focus(entityIds) {
        const sync = syncRef.current;
        const bounds =
          sync?.boundsOf(
            entityIds.length > 0
              ? entityIds
              : (documentRef.current.world.zones
                  .find((zone) => zone.id === documentRef.current.activeZoneId)
                  ?.entities.map((entity) => entity.id) ?? []),
          ) ?? null;
        if (bounds !== null) {
          viewport.camera.focus(bounds);
        }
      },
    };
    handlersRef.current.onController(controller);

    return () => {
      handlersRef.current.onController(null);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      gizmosRef.current = null;
      gizmos.dispose();
    };
  }, [viewport]);

  // --- the document reaching the picture ------------------------------------
  useEffect(() => {
    const sync = syncRef.current;
    sync?.apply(editorDocument);

    const primary = editorDocument.selection.at(-1);
    gizmosRef.current?.attach(primary === undefined ? null : (sync?.nodeFor(primary) ?? null));
    outlineRef.current?.show(sync?.boundsOf(editorDocument.selection) ?? null);

    const zone = editorDocument.world.zones.find((each) => each.id === editorDocument.activeZoneId);
    publishEditorDebug({
      worldId: editorDocument.world.id,
      zoneId: editorDocument.activeZoneId,
      entityCount: zone?.entities.length ?? 0,
      meshCount: sync?.meshCount() ?? 0,
      selection: [...editorDocument.selection],
      dirty: editorDocument.dirty,
    });
  }, [editorDocument, viewport, prefabs]);

  useEffect(() => {
    gizmosRef.current?.setTool(tool);
  }, [tool, viewport]);

  useEffect(() => {
    gizmosRef.current?.setSnapping({
      position: snapping.enabled ? snapping.step : 0,
      rotation: snapping.enabled ? (snapping.rotationStepDegrees * Math.PI) / 180 : 0,
    });
  }, [snapping, viewport]);

  useEffect(() => {
    viewport?.grid.setVisible(gridVisible);
  }, [gridVisible, viewport]);

  // --- dropping a prefab out of the asset browser ---------------------------
  const onDragOver = useCallback((event: DragEvent<HTMLCanvasElement>): void => {
    if (event.dataTransfer.types.includes(PREFAB_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLCanvasElement>): void => {
      const prefabId = event.dataTransfer.getData(PREFAB_DRAG_TYPE);
      if (prefabId === '' || !viewport) {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const point = pickWorldPoint(viewport.scene, x, y);
      if (point === null) {
        return;
      }
      const settings = snappingRef.current;
      const planar = settings.enabled ? snapPosition(point, settings.step) : point;
      const surfaceY = dropToSurface(viewport.scene, planar[0], planar[2]);
      handlersRef.current.onPlace(prefabId, [planar[0], surfaceY, planar[2]]);
    },
    [viewport],
  );

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        tabIndex={0}
        onDragOver={onDragOver}
        onDrop={onDrop}
      />
      <div className="viewport-status">
        <span data-testid="editor-viewport-status">{status}</span>
        <span data-testid="editor-frame">
          {frameId < 0 ? 'frame …' : `frame ${String(frameId)}`}
        </span>
      </div>
    </>
  );
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function multiply(left: Vector3, right: Vector3): Vector3 {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

/** Scale is relative, so its delta is a ratio; a zero start would divide by it. */
function divide(left: Vector3, right: Vector3): Vector3 {
  return [
    right[0] === 0 ? 1 : left[0] / right[0],
    right[1] === 0 ? 1 : left[1] / right[1],
    right[2] === 0 ? 1 : left[2] / right[2],
  ];
}
