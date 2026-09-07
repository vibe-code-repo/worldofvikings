import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, JSX } from 'react';
import { AssetManager, summarizeAssetSources } from '@wov/asset-system';
import type { AssetSourceConfig } from '@wov/asset-system';
import { snapPosition } from '@wov/editor-core';
import type { EditorDocument, TransformChange } from '@wov/editor-core';
import type { Vector3 } from '@wov/world-schema';
import { createCoalescer } from './coalesce.js';
import { isEditorDebugInstalled, publishEditorDebug } from './dev-debug.js';
import { changesFromDrag } from './scene/gizmo-commit.js';
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
import { createZoneTerrain, type ZoneTerrain } from './scene/zone-terrain.js';

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
  /**
   * Height of the drawn surface at `[x, z]`, the same query a dropped prop
   * lands on. The scatter panel stands its instances on it, so a scattered
   * tuft of grass and a dragged prop agree about where the ground is.
   */
  surfaceAt(x: number, z: number): number;
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
  /**
   * When set, the next click reports a point on the ground instead of picking
   * or placing — how the scatter panel takes a region corner off the viewport
   * rather than having it typed in.
   */
  readonly groundPicking: boolean;
  readonly onPick: (entityId: string | null, additive: boolean) => void;
  readonly onPlace: (prefabId: string, position: Vector3) => void;
  readonly onGroundPick: (position: Vector3) => void;
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
  const terrainRef = useRef<ZoneTerrain | null>(null);
  /** The profile the viewport was last lit with, so a gizmo drag does not relight. */
  const lightingKeyRef = useRef<string>('');
  const dragStartRef = useRef<Map<string, GizmoTransform>>(new Map());

  // Live copies of everything the event handlers need to read.
  const documentRef = useRef(editorDocument);
  documentRef.current = editorDocument;
  const snappingRef = useRef(snapping);
  snappingRef.current = snapping;
  const placingRef = useRef(placingPrefabId);
  placingRef.current = placingPrefabId;
  const groundPickingRef = useRef(props.groundPicking);
  groundPickingRef.current = props.groundPicking;
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
    /**
     * The asset-origins line, forwarded only when it says something new.
     *
     * It is React state in the shell, and the shell is the whole editor. The
     * count changes once per *asset* — 145 times for `village1` — while the
     * scene changes once per *entity and texture*, about ten thousand times, so
     * without this the status bar re-renders the shell for a string it already
     * shows (ADR-0048).
     */
    let reportedSources: string | null = null;
    const reportSources = (): void => {
      const line = summarizeAssetSources(assets.sources());
      if (line !== reportedSources) {
        reportedSources = line;
        handlersRef.current.onAssetSources(line);
      }
    };
    const report = (): void => {
      reportSources();
      // One guard, not one per field: every argument below is a walk over the
      // whole zone, and a session that never opened the bridge must not pay for
      // a number nobody can read (ADR-0048).
      if (isEditorDebugInstalled()) {
        publishEditorDebug({
          meshCount: sync.meshCount(),
          loadedCount: sync.loadedCount(),
          frozenCount: sync.frozenCount(),
          loadedTextures: sync.loadedTextures(),
        });
      }
      // The outline is first drawn around the stand-in cube, because that is
      // all that exists until the GLB lands. Redrawing it here is what makes it
      // end up around the model rather than around a 1 m box.
      outline.show(sync.boundsOf(documentRef.current.selection));
    };
    /*
     * One report per frame, however many models and textures landed in it.
     *
     * `onSceneChanged` fires once per loaded model and once per loaded texture,
     * and each report walks every entity of the zone — which made opening
     * `village1` quadratic in its own entity count (ADR-0048). Nothing is lost
     * by folding them: a report reads the current state, so the one that
     * happens stands for all the asks that arrived before it, and a frame
     * always follows the last one.
     */
    const reports = createCoalescer(report);
    const outline = createSelectionOutline(viewport.scene);
    outlineRef.current = outline;
    // Scenery, not a document object: it is drawn and it is what a prop snaps
    // onto, and nothing in the editor can select or move it yet (ADR-0022).
    const terrain = createZoneTerrain({
      scene: viewport.scene,
      source: assetSource,
      onChanged: (tile) => {
        reportSources();
        // The ground receives shadows through its own shader and must not cast
        // (ADR-0024): a height field in its own shadow map self-shadows every
        // slope it has.
        if (tile) {
          viewport.excludeFromShadows(tile.meshes);
        }
        publishEditorDebug({
          terrain:
            tile === null
              ? null
              : {
                  program:
                    typeof tile.material.shaderPath === 'string'
                      ? tile.material.shaderPath
                      : JSON.stringify(tile.material.shaderPath),
                  meshes: tile.meshes.length,
                  textures: tile.textures.length,
                },
        });
      },
      onFailed: (reason) => {
        console.warn(`[editor] the ground of this zone did not load: ${reason}`);
      },
    });
    terrainRef.current = terrain;
    const sync = createSceneSync({
      scene: viewport.scene,
      assets,
      prefabs,
      onSceneChanged: () => {
        reports.schedule();
      },
      shadows: viewport,
    });
    syncRef.current = sync;
    sync.apply(documentRef.current);
    report();

    return () => {
      syncRef.current = null;
      outlineRef.current = null;
      terrainRef.current = null;
      reports.dispose();
      terrain.dispose();
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
        const changes = changesFromDrag(
          selection,
          dragStartRef.current,
          selection.at(-1),
          finished,
          snappingRef.current,
        );
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

      if (groundPickingRef.current) {
        // Unsnapped on purpose: a region corner is a place on the map, not a
        // prop that has to line up with the grid.
        const point = pickWorldPoint(viewport.scene, x, y);
        if (point !== null) {
          handlersRef.current.onGroundPick([
            point[0],
            dropToSurface(viewport.scene, point[0], point[2]),
            point[2],
          ]);
        }
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
      surfaceAt(x, z) {
        return dropToSurface(viewport.scene, x, z);
      },
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

    // Relight before the ground is (re)drawn, and only when the profile really
    // changed: the tile compiles its shadow lookup against the map that exists
    // when it is built, and the document is replaced on every gizmo drag —
    // rebuilding the shadow map and the post-processing chain on each of those
    // would cost more than the edit.
    const lightingKey = JSON.stringify([
      editorDocument.world.lighting ?? null,
      zone?.lighting ?? null,
    ]);
    if (viewport && lightingKey !== lightingKeyRef.current) {
      lightingKeyRef.current = lightingKey;
      viewport.relight([editorDocument.world.lighting, zone?.lighting]);
    }

    terrainRef.current?.show(zone?.terrain, `${editorDocument.world.id}:${zone?.id ?? 'no-zone'}`);
    // `meshCount`, `loadedCount` and `loadedTextures` each walk the whole zone,
    // and this effect runs on every edit — a gizmo drag, a nudged number, a
    // ground dial. One guard around all of them, so only a session with the
    // bridge open pays (ADR-0048).
    if (isEditorDebugInstalled()) {
      publishEditorDebug({
        worldId: editorDocument.world.id,
        zoneId: editorDocument.activeZoneId,
        entityCount: zone?.entities.length ?? 0,
        meshCount: sync?.meshCount() ?? 0,
        loadedCount: sync?.loadedCount() ?? 0,
        // Published from here as well as from `report`, because a selection is
        // exactly what changes the answer and changes no mesh at all: the
        // reconciler's early return means `onSceneChanged` never fires for it
        // (ADR-0049).
        frozenCount: sync?.frozenCount() ?? 0,
        loadedTextures: sync?.loadedTextures() ?? [],
        selection: [...editorDocument.selection],
        dirty: editorDocument.dirty,
      });
    }
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
