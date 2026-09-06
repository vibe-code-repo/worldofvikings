import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  DEFAULT_GRID_STEP,
  DEFAULT_ROTATION_STEP_DEGREES,
  activeZone,
  addEntities,
  addEntity,
  addZone,
  canRedo,
  canUndo,
  createEmptyWorld,
  duplicateEntities,
  nextEntityId,
  nextEntityIds,
  removeEntities,
  renameEntity,
  renameZone,
  scatterCommand,
  serializeDocument,
  updateTransform,
  type Rect,
  type ScatterOptions,
  type TransformChange,
  type TransformPatch,
} from '@wov/editor-core';
import { tokens } from '@wov/ui';
import type { EntityDefinition, Vector3, WorldDefinition } from '@wov/world-schema';
import { createEditorApi, type WorldSummary } from './api/client.js';
import { resolveEditorConfig } from './config.js';
import { publishEditorDebug } from './dev-debug.js';
import { EditorViewport, type ViewportController } from './EditorViewport.js';
import { AssetBrowser } from './panels/AssetBrowser.js';
import { Hierarchy } from './panels/Hierarchy.js';
import { Inspector } from './panels/Inspector.js';
import { MenuBar } from './panels/MenuBar.js';
import { ScatterPanel, type CornerPick } from './panels/ScatterPanel.js';
import { TOOL_KEYS, type EditorTool } from './scene/gizmos.js';
import { createPrefabIndex, type PrefabIndex } from './scene/prefab-index.js';
import { createSession, editorReducer } from './state/store.js';

/**
 * The world a fresh session starts with, until one is opened.
 *
 * It has a zone, because an empty world has nowhere to put anything and "add a
 * zone first" is a worse first impression than a zone nobody asked for.
 */
function draftWorld(): WorldDefinition {
  return {
    ...createEmptyWorld('untitled', 'Untitled World'),
    zones: [{ id: 'zone_01', name: 'Zone 1', entities: [] }],
  };
}

/** Where the scatter panel's region starts: a 20 m square around the origin. */
const DEFAULT_SCATTER_REGION: Rect = [-10, -10, 10, 10];

/** How far a duplicate or a paste lands from its source, so it is not inside it. */
const COPY_OFFSET: Vector3 = [DEFAULT_GRID_STEP * 4, 0, DEFAULT_GRID_STEP * 4];

/** A keystroke typed into a field belongs to the field, not to the editor. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The editor (spec §13, §14).
 *
 * One `EditorSession` in one reducer is the only mutable state here: panels
 * read it, keystrokes and the viewport turn gestures into commands against it,
 * and the viewport derives the scene from the document it produces (ADR-0018).
 * Nothing edits the world twice, which is why a gizmo drag, a number typed into
 * the inspector and the Delete key all undo the same way.
 */
export function EditorShell(): JSX.Element {
  // The three variables the editor reads, picked out explicitly. `import.meta.env`
  // carries Vite's own keys too, and handing the whole object over would let a
  // typo in `EditorEnv` pass unnoticed (same rule as `apps/game/src/main.ts`).
  const config = useMemo(
    () =>
      resolveEditorConfig({
        VITE_API_URL: import.meta.env.VITE_API_URL,
        VITE_ASSET_URL: import.meta.env.VITE_ASSET_URL,
        VITE_ASSET_STORE_URL: import.meta.env.VITE_ASSET_STORE_URL,
      }),
    [],
  );
  const api = useMemo(() => createEditorApi(config.apiUrl), [config.apiUrl]);

  const [session, dispatch] = useReducer(editorReducer, draftWorld(), createSession);
  const [worlds, setWorlds] = useState<readonly WorldSummary[]>([]);
  const [prefabs, setPrefabs] = useState<PrefabIndex | null>(null);
  const [prefabError, setPrefabError] = useState<string | null>(null);
  const [placingPrefabId, setPlacingPrefabId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>('select');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapStep, setSnapStep] = useState(DEFAULT_GRID_STEP);
  const [assetSources, setAssetSources] = useState('assets: 0 private, 0 placeholder');
  const [saving, setSaving] = useState(false);
  const controllerRef = useRef<ViewportController | null>(null);
  const [scatterRegion, setScatterRegion] = useState<Rect>(DEFAULT_SCATTER_REGION);
  const [cornerPick, setCornerPick] = useState<CornerPick>(null);

  const { document } = session.state;
  const zone = activeZone(document);
  const zoneId = zone?.id ?? null;

  // --- what the API knows ---------------------------------------------------
  const refreshWorlds = useCallback(() => {
    api.listWorlds().then(
      (listing) => setWorlds(listing.worlds),
      (error: unknown) => dispatch({ type: 'fail', error: describe(error) }),
    );
  }, [api]);

  useEffect(() => {
    refreshWorlds();
    api.listPrefabs().then(
      (listing) => {
        setPrefabs(createPrefabIndex(listing.prefabs));
        setPrefabError(
          listing.invalid.length === 0
            ? null
            : `${String(listing.invalid.length)} catalogue problem(s): ${
                listing.invalid[0]?.errors[0] ?? ''
              }`,
        );
      },
      (error: unknown) => {
        // An unreachable catalogue must not take the viewport with it: the
        // camera, the grid and an already-open world all still work.
        setPrefabs(createPrefabIndex([]));
        setPrefabError(describe(error));
      },
    );
  }, [api, refreshWorlds]);

  // --- editing --------------------------------------------------------------
  const entities = zone?.entities;
  const usedEntityIds = useMemo(() => (entities ?? []).map((entity) => entity.id), [entities]);

  const place = useCallback(
    (prefabId: string, position: Vector3) => {
      if (zoneId === null) {
        dispatch({ type: 'fail', error: 'add a zone before placing anything' });
        return;
      }
      const prefab = prefabs?.get(prefabId);
      const entity: EntityDefinition = {
        id: nextEntityId(usedEntityIds, prefabId),
        prefab: prefabId,
        position,
        // The catalogue's default scale, when it names one. Absent means
        // `[1, 1, 1]`, and writing that out would put a field into every world
        // file for nothing.
        ...(prefab?.defaultScale === undefined ? {} : { scale: prefab.defaultScale }),
      };
      dispatch({ type: 'run', command: addEntity(zoneId, entity) });
    },
    [zoneId, prefabs, usedEntityIds],
  );

  const transform = useCallback(
    (changes: readonly TransformChange[]) => {
      if (zoneId !== null && changes.length > 0) {
        dispatch({ type: 'run', command: updateTransform(zoneId, changes) });
      }
    },
    [zoneId],
  );

  const transformOne = useCallback(
    (entityId: string, patch: TransformPatch) => transform([{ entityId, patch }]),
    [transform],
  );

  const selection = document.selection;

  const remove = useCallback(() => {
    if (zoneId !== null && selection.length > 0) {
      dispatch({ type: 'run', command: removeEntities(zoneId, selection) });
    }
  }, [zoneId, selection]);

  const duplicate = useCallback(() => {
    if (zoneId !== null && selection.length > 0) {
      dispatch({
        type: 'run',
        command: duplicateEntities(zoneId, selection, { offset: COPY_OFFSET }),
      });
    }
  }, [zoneId, selection]);

  const clipboard = session.clipboard;

  const paste = useCallback(() => {
    if (zoneId === null || clipboard.length === 0) {
      return;
    }
    const ids = nextEntityIds(
      usedEntityIds,
      clipboard.map((entity) => entity.prefab),
    );
    const entries = clipboard.map((entity, index) => ({
      entity: {
        ...entity,
        id: ids[index] ?? entity.id,
        position: [
          entity.position[0] + COPY_OFFSET[0],
          entity.position[1] + COPY_OFFSET[1],
          entity.position[2] + COPY_OFFSET[2],
        ] as Vector3,
      },
    }));
    dispatch({ type: 'run', command: addEntities(zoneId, entries) });
  }, [zoneId, clipboard, usedEntityIds]);

  const zones = document.world.zones;

  const addNewZone = useCallback(() => {
    const taken = new Set(zones.map((each) => each.id));
    let index = zones.length + 1;
    while (taken.has(zoneIdFor(index))) {
      index += 1;
    }
    const id = zoneIdFor(index);
    dispatch({
      type: 'run',
      command: addZone({ id, name: `Zone ${String(index)}`, entities: [] }),
    });
    dispatch({ type: 'activateZone', zoneId: id });
  }, [zones]);

  // --- files ----------------------------------------------------------------
  const open = useCallback(
    (worldId: string) => {
      api.loadWorld(worldId).then(
        (world) => dispatch({ type: 'open', world }),
        (error: unknown) => dispatch({ type: 'fail', error: describe(error) }),
      );
    },
    [api],
  );

  const save = useCallback(() => {
    const serialized = serializeDocument(document);
    if (!serialized.ok) {
      // Better here than as a 400 from the API: this message names the field.
      dispatch({ type: 'fail', error: `cannot save: ${serialized.errors.join('; ')}` });
      return;
    }
    setSaving(true);
    api.saveWorld(serialized.world).then(
      (result) => {
        setSaving(false);
        dispatch({
          type: 'saved',
          notice: `${result.created ? 'created' : 'saved'} "${result.id}"`,
        });
        refreshWorlds();
      },
      (error: unknown) => {
        setSaving(false);
        dispatch({ type: 'fail', error: describe(error) });
      },
    );
  }, [api, document, refreshWorlds]);

  // --- keyboard (spec §14) ---------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // The camera claims WASD/QE while it is flying and marks those events
      // handled; the tool shortcuts must not fire underneath it.
      if (event.defaultPrevented || isTyping(event.target)) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        switch (event.code) {
          case 'KeyZ':
            event.preventDefault();
            dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
            return;
          case 'KeyY':
            event.preventDefault();
            dispatch({ type: 'redo' });
            return;
          case 'KeyD':
            event.preventDefault();
            duplicate();
            return;
          case 'KeyC':
            event.preventDefault();
            dispatch({ type: 'copy' });
            return;
          case 'KeyV':
            event.preventDefault();
            paste();
            return;
          case 'KeyS':
            event.preventDefault();
            save();
            return;
          default:
            return;
        }
      }

      const shortcut = TOOL_KEYS[event.code];
      if (shortcut !== undefined) {
        event.preventDefault();
        setTool(shortcut);
        return;
      }

      switch (event.code) {
        case 'KeyF':
          event.preventDefault();
          controllerRef.current?.focus(selection);
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          remove();
          return;
        case 'Escape':
          setPlacingPrefabId(null);
          dispatch({ type: 'clearSelection' });
          return;
        default:
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duplicate, paste, remove, save, selection]);

  // --- the debug bridge -----------------------------------------------------
  const history = session.state.history;
  useEffect(() => {
    publishEditorDebug({
      undoDepth: history.past.length,
      redoDepth: history.future.length,
    });
  }, [history]);

  const onPick = useCallback((entityId: string | null, additive: boolean) => {
    if (entityId === null) {
      dispatch({ type: 'clearSelection' });
    } else if (additive) {
      dispatch({ type: 'toggleSelect', entityId });
    } else {
      dispatch({ type: 'select', entityIds: [entityId] });
    }
  }, []);

  const onController = useCallback((controller: ViewportController | null) => {
    controllerRef.current = controller;
  }, []);

  /** A viewport click while a corner is armed moves that corner of the region. */
  const onGroundPick = useCallback(
    (position: Vector3) => {
      setScatterRegion((region) =>
        cornerPick === 0
          ? [position[0], position[2], region[2], region[3]]
          : [region[0], region[1], position[0], position[2]],
      );
      setCornerPick(null);
    },
    [cornerPick],
  );

  /**
   * One scatter run, as one command.
   *
   * The ground comes from the viewport's own surface query, so a scattered tuft
   * of grass lands exactly where a dragged prop would. Nothing is selected
   * afterwards: selecting three thousand tufts would put three thousand
   * outlines on screen and hand the next gizmo drag all of them.
   */
  const scatter = useCallback(
    (options: Omit<ScatterOptions, 'heightAt'>) => {
      if (zoneId === null) {
        dispatch({ type: 'fail', error: 'add a zone before scattering into it' });
        return;
      }
      const built = scatterCommand(zoneId, {
        ...options,
        heightAt: (x, z) => controllerRef.current?.surfaceAt(x, z) ?? 0,
      });
      if (!built.ok) {
        dispatch({ type: 'fail', error: built.error });
        return;
      }
      if (built.value.plan.entities.length === 0) {
        dispatch({ type: 'fail', error: 'that region and density produce nothing to place' });
        return;
      }
      dispatch({ type: 'run', command: built.value.command, selectCreated: false });
    },
    [zoneId],
  );

  return (
    <div className="shell" style={{ background: tokens.colorBackground, color: tokens.colorText }}>
      <MenuBar
        worldName={document.world.name}
        dirty={document.dirty}
        worlds={worlds}
        canUndo={canUndo(session.state)}
        canRedo={canRedo(session.state)}
        hasSelection={selection.length > 0}
        saving={saving}
        tool={tool}
        gridVisible={gridVisible}
        snapping={snapEnabled}
        snapStep={snapStep}
        onNew={() => dispatch({ type: 'open', world: draftWorld() })}
        onOpen={open}
        onSave={save}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onDuplicate={duplicate}
        onDelete={remove}
        onTool={setTool}
        onToggleGrid={() => setGridVisible((visible) => !visible)}
        onToggleSnapping={() => setSnapEnabled((enabled) => !enabled)}
        onSnapStep={setSnapStep}
      />

      <div className="body">
        <Hierarchy
          document={document}
          onActivateZone={(id) => dispatch({ type: 'activateZone', zoneId: id })}
          onSelect={(entityId, additive) =>
            dispatch(
              additive
                ? { type: 'toggleSelect', entityId }
                : { type: 'select', entityIds: [entityId] },
            )
          }
          onAddZone={addNewZone}
          onRenameZone={(id, name) => dispatch({ type: 'run', command: renameZone(id, name) })}
        />

        <section className="viewport">
          <EditorViewport
            document={document}
            prefabs={prefabs}
            assetSource={config.assets}
            tool={tool}
            gridVisible={gridVisible}
            snapping={{
              enabled: snapEnabled,
              step: snapStep,
              rotationStepDegrees: DEFAULT_ROTATION_STEP_DEGREES,
            }}
            placingPrefabId={placingPrefabId}
            groundPicking={cornerPick !== null}
            onPick={onPick}
            onPlace={place}
            onGroundPick={onGroundPick}
            onTransform={transform}
            onAssetSources={setAssetSources}
            onController={onController}
          />
        </section>

        <Inspector
          document={document}
          onRename={(entityId, nextId) => {
            if (zoneId !== null) {
              dispatch({ type: 'run', command: renameEntity(zoneId, entityId, nextId) });
            }
          }}
          onTransform={transformOne}
        />
      </div>

      <div className="drawers">
        <AssetBrowser
          prefabs={prefabs}
          error={prefabError}
          selectedPrefabId={placingPrefabId}
          onSelectPrefab={setPlacingPrefabId}
        />

        <ScatterPanel
          zoneId={zoneId}
          selectedPrefabId={placingPrefabId}
          region={scatterRegion}
          onRegion={setScatterRegion}
          cornerPick={cornerPick}
          onCornerPick={setCornerPick}
          onScatter={scatter}
        />
      </div>

      <footer className="statusbar" style={{ background: tokens.colorSurface }}>
        <span data-testid="editor-asset-sources">{assetSources}</span>
        <span data-testid="editor-zone">
          {zone === undefined
            ? 'no zone'
            : `${zone.name} — ${String(zone.entities.length)} entities`}
        </span>
        <span data-testid="editor-selection">
          {selection.length === 0 ? 'nothing selected' : `${String(selection.length)} selected`}
        </span>
        <span data-testid="editor-placing">
          {placingPrefabId === null ? 'click to select' : `click to place ${placingPrefabId}`}
        </span>
        <span className="spacer" />
        {session.error !== null && (
          <button
            type="button"
            className="error"
            data-testid="editor-error"
            onClick={() => dispatch({ type: 'dismiss' })}
          >
            {session.error}
          </button>
        )}
        {session.notice !== null && <span data-testid="editor-notice">{session.notice}</span>}
      </footer>
    </div>
  );
}

function zoneIdFor(index: number): string {
  return `zone_${String(index).padStart(2, '0')}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
