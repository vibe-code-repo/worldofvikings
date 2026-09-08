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
  canScatter,
  canUndo,
  createEmptyWorld,
  duplicateEntities,
  nextEntityId,
  nextEntityIds,
  catalogForEdit,
  editedPrefab,
  emptyOverrideCatalog,
  removeEntities,
  renameEntity,
  renameZone,
  scatterCommand,
  serializeDocument,
  setLighting,
  setSound,
  setTerrain,
  updateTerrainSurface,
  updateTransform,
  withPrefab,
  type FieldPatch,
  type LightingScope,
  type PrefabEdit,
  type SoundScope,
  type Rect,
  type ScatterOptions,
  type TerrainSurfacePatch,
  type TransformChange,
  type TransformPatch,
} from '@wov/editor-core';
import { tokens } from '@wov/ui';
import type { EntityDefinition, Vector3, WorldDefinition } from '@wov/world-schema';
import {
  createEditorApi,
  type ActionReport,
  type CatalogedPrefab,
  type SceneImportRequest,
  type WorldSummary,
} from './api/client.js';
import { emptyAssetIndex, loadAssetIndex, type AssetIndex } from './api/assets.js';
import { resolveEditorConfig } from './config.js';
import { publishEditorDebug } from './dev-debug.js';
import { targetSwallowsKeystrokes } from './keyboard.js';
import { EditorViewport, type ViewportController } from './EditorViewport.js';
import { AssetBrowser } from './panels/AssetBrowser.js';
import { ContentActions, type ContentAction } from './panels/ContentActions.js';
import { Hierarchy } from './panels/Hierarchy.js';
import { MenuBar } from './panels/MenuBar.js';
import { RightPanel, type RightPanelTab } from './panels/RightPanel.js';
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
  const [rightTab, setRightTab] = useState<RightPanelTab>('entity');
  const [assets, setAssets] = useState<AssetIndex | null>(null);
  const assetsAsked = useRef(false);
  const [lightingScope, setLightingScope] = useState<'world' | 'zone'>('world');
  const [soundScope, setSoundScope] = useState<'world' | 'zone'>('world');
  /**
   * Whether the author is listening to the zone (ADR-0062).
   *
   * **Off when a session starts, and it lives here.** An editor that starts a
   * forge loop the moment a world opens is an editor nobody keeps open. It sits
   * in the shell rather than in the viewport so that it survives the viewport
   * being rebuilt — a renderer restart must not silently turn the sound back
   * off under an author who asked for it. It is a view setting like the grid
   * and is never written to the world file.
   */
  const [listening, setListening] = useState(false);
  const [soundStatus, setSoundStatus] = useState('sound: off');
  const [prefabSaving, setPrefabSaving] = useState(false);
  const [contentAction, setContentAction] = useState<ContentAction>(null);
  const [actionRunning, setActionRunning] = useState(false);
  const [actionReport, setActionReport] = useState<ActionReport | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  /*
   * The asset manifest, read the first time somebody opens the zone inspector.
   *
   * Not on start-up: it is 874 kB describing 1192 assets, and the panels that
   * need it are the two offering files to choose from — height fields and
   * ground textures on the **Zone** tab, clips on **Sound**. A session that
   * never opens either never pays for it, and a session whose asset server is
   * not running gets an empty picker and a text box that still works — which is
   * why the failure sets an index rather than leaving `null` forever.
   *
   * The entity inspector's emitter section needs it too, and does not get its
   * own trigger: an author who has not opened the sound tab yet is offered a
   * text field, exactly as on the zone tab before the manifest lands.
   */
  useEffect(() => {
    if ((rightTab !== 'zone' && rightTab !== 'sound') || assetsAsked.current) {
      return;
    }
    assetsAsked.current = true;
    loadAssetIndex(config.assets).then(setAssets, (error: unknown) => {
      setAssets(emptyAssetIndex());
      dispatch({ type: 'fail', error: `asset manifest: ${describe(error)}` });
    });
  }, [rightTab, config.assets]);

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

  /**
   * Whether the prefab the asset browser has highlighted may be planted.
   *
   * `true` when nothing is highlighted, so the panel keeps saying "select a
   * prefab" rather than "this one cannot be scattered" about nothing.
   */
  const scatterableSelection = useMemo(() => {
    const prefab = placingPrefabId === null ? undefined : prefabs?.get(placingPrefabId);
    return prefab === undefined || canScatter(prefab);
  }, [placingPrefabId, prefabs]);

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

  // --- the blocks that used to be script-only (ADR-0033) ---------------------
  const lighting = useCallback((scope: LightingScope, patches: readonly FieldPatch[]) => {
    dispatch({ type: 'run', command: setLighting(scope, patches), selectCreated: false });
  }, []);

  /**
   * A slider being dragged: the same command, folded into one undo step.
   *
   * The viewport relights from the document, so a live preview *is* a command
   * per step — there is no second path that could paint without editing. What
   * there can be is one history entry for the whole gesture.
   */
  const lightingDrag = useCallback((scope: LightingScope, patch: FieldPatch, gesture: string) => {
    dispatch({
      type: 'run',
      command: setLighting(scope, [patch]),
      selectCreated: false,
      coalesceKey: `lighting:${scope.kind === 'world' ? 'world' : scope.zoneId}:${gesture}`,
    });
  }, []);

  const sound = useCallback((scope: SoundScope, patches: readonly FieldPatch[]) => {
    dispatch({ type: 'run', command: setSound(scope, patches), selectCreated: false });
  }, []);

  const soundDrag = useCallback((scope: SoundScope, patch: FieldPatch, gesture: string) => {
    dispatch({
      type: 'run',
      command: setSound(scope, [patch]),
      selectCreated: false,
      coalesceKey: `sound:${scope.kind === 'world' ? 'world' : scope.zoneId}:${gesture}`,
    });
  }, []);

  const terrain = useCallback((targetZoneId: string, patches: readonly FieldPatch[]) => {
    dispatch({ type: 'run', command: setTerrain(targetZoneId, patches), selectCreated: false });
  }, []);

  const terrainDrag = useCallback((targetZoneId: string, patch: FieldPatch, gesture: string) => {
    dispatch({
      type: 'run',
      command: setTerrain(targetZoneId, [patch]),
      selectCreated: false,
      coalesceKey: `terrain:${targetZoneId}:${gesture}`,
    });
  }, []);

  /**
   * The other command the terrain block is written by (ADR-0032).
   *
   * `updateTerrainSurface` rather than a field patch, because that is what
   * `pnpm terrain-surface` dispatches: one path for a number typed into the
   * panel and a number passed on a command line, refused in one place.
   */
  const surface = useCallback((targetZoneId: string, index: number, patch: TerrainSurfacePatch) => {
    dispatch({
      type: 'run',
      command: updateTerrainSurface(targetZoneId, { layers: [{ index, patch }] }),
      selectCreated: false,
    });
  }, []);

  /** The same command while a Surface slider is dragged, as one undo entry. */
  const surfaceDrag = useCallback(
    (targetZoneId: string, index: number, patch: TerrainSurfacePatch, gesture: string) => {
      dispatch({
        type: 'run',
        command: updateTerrainSurface(targetZoneId, { layers: [{ index, patch }] }),
        selectCreated: false,
        coalesceKey: `terrain-surface:${targetZoneId}:${gesture}`,
      });
    },
    [],
  );

  const flatNormals = useCallback((targetZoneId: string, facetted: boolean) => {
    dispatch({
      type: 'run',
      command: updateTerrainSurface(targetZoneId, { flatNormals: facetted }),
      selectCreated: false,
    });
  }, []);

  // --- prefab catalogues ------------------------------------------------------
  const selectedPrefab: CatalogedPrefab | null =
    placingPrefabId === null ? null : (prefabs?.get(placingPrefabId) ?? null);

  /**
   * Saves a prefab correction into the catalogue it belongs in.
   *
   * The generated catalogue is never written: `catalogForEdit` sends a
   * correction to a generated prefab into `overrides.json`, which the API
   * applies last and `generate:prefabs` does not touch (ADR-0033). A prefab
   * from a hand-written catalogue is written back into its own file.
   */
  const savePrefab = useCallback(
    (prefab: CatalogedPrefab, edit: PrefabEdit) => {
      const catalogId = catalogForEdit(prefab.catalog);
      setPrefabSaving(true);
      const { catalog: _catalog, ...definition } = prefab;
      void api
        .loadCatalog(catalogId)
        .then((existing) =>
          api.saveCatalog(
            withPrefab(existing ?? emptyOverrideCatalog(), editedPrefab(definition, edit)),
          ),
        )
        .then(
          (result) => {
            setPrefabSaving(false);
            dispatch({
              type: 'saved',
              notice: `saved "${prefab.id}" into ${result.id}.json`,
            });
            return api.listPrefabs();
          },
          (error: unknown) => {
            setPrefabSaving(false);
            dispatch({ type: 'fail', error: describe(error) });
            return null;
          },
        )
        .then((listing) => {
          if (listing !== null) {
            setPrefabs(createPrefabIndex(listing.prefabs));
          }
        });
    },
    [api],
  );

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

  // --- the content actions (ADR-0033) ----------------------------------------
  /**
   * Runs one of the two build steps on the API and shows its own report.
   *
   * The world list is refreshed afterwards because an import may have created
   * one; the prefab index because a regeneration certainly changed it.
   */
  const runAction = useCallback(
    (run: () => Promise<ActionReport>, after: 'worlds' | 'prefabs') => {
      setActionRunning(true);
      setActionError(null);
      setActionReport(null);
      run().then(
        (report) => {
          setActionRunning(false);
          setActionReport(report);
          if (after === 'worlds') {
            refreshWorlds();
          } else {
            api.listPrefabs().then(
              (listing) => setPrefabs(createPrefabIndex(listing.prefabs)),
              (error: unknown) => setActionError(describe(error)),
            );
          }
        },
        (error: unknown) => {
          setActionRunning(false);
          setActionError(describe(error));
        },
      );
    },
    [api, refreshWorlds],
  );

  const importScene = useCallback(
    (request: SceneImportRequest) => runAction(() => api.importScene(request), 'worlds'),
    [api, runAction],
  );

  const generatePrefabs = useCallback(
    () => runAction(() => api.generatePrefabs(), 'prefabs'),
    [api, runAction],
  );

  const openAction = useCallback((action: ContentAction) => {
    setContentAction(action);
    setActionReport(null);
    setActionError(null);
  }, []);

  // --- keyboard (spec §14) ---------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // The camera claims WASD/QE while it is flying and marks those events
      // handled; the tool shortcuts must not fire underneath it.
      if (event.defaultPrevented || targetSwallowsKeystrokes(event.target)) {
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

  /*
   * The handlers the memoised panels get, made once.
   *
   * A new arrow per render defeats `React.memo` completely: the props differ
   * every time and the panel rebuilds anyway. These four are what the hierarchy
   * and the right column need, and none of them closes over anything that
   * changes, so they are made once per session (ADR-0048).
   */
  const activateZone = useCallback((id: string) => {
    dispatch({ type: 'activateZone', zoneId: id });
  }, []);

  const selectFromList = useCallback((entityId: string, additive: boolean) => {
    dispatch(
      additive ? { type: 'toggleSelect', entityId } : { type: 'select', entityIds: [entityId] },
    );
  }, []);

  const renameZoneById = useCallback((id: string, name: string) => {
    dispatch({ type: 'run', command: renameZone(id, name) });
  }, []);

  const renameEntityById = useCallback(
    (entityId: string, nextId: string) => {
      if (zoneId !== null) {
        dispatch({ type: 'run', command: renameEntity(zoneId, entityId, nextId) });
      }
    },
    [zoneId],
  );

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
        onImportScene={() => openAction('import-scene')}
        onGeneratePrefabs={() => openAction('generate-prefabs')}
      />

      <div className="body">
        <Hierarchy
          document={document}
          onActivateZone={activateZone}
          onSelect={selectFromList}
          onAddZone={addNewZone}
          onRenameZone={renameZoneById}
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
            listening={listening}
            onSoundStatus={setSoundStatus}
            onPick={onPick}
            onPlace={place}
            onGroundPick={onGroundPick}
            onTransform={transform}
            onAssetSources={setAssetSources}
            onController={onController}
          />
        </section>

        <RightPanel
          tab={rightTab}
          onTab={setRightTab}
          document={document}
          assets={assets}
          selectedPrefab={selectedPrefab}
          prefabSaving={prefabSaving}
          lightingScope={lightingScope}
          onLightingScope={setLightingScope}
          onRename={renameEntityById}
          onTransform={transformOne}
          onRenameZone={renameZoneById}
          onTerrain={terrain}
          onTerrainDrag={terrainDrag}
          onSurface={surface}
          onSurfaceDrag={surfaceDrag}
          onFlatNormals={flatNormals}
          onLighting={lighting}
          onLightingDrag={lightingDrag}
          onSavePrefab={savePrefab}
          sound={{
            document,
            assets,
            scope: soundScope,
            onScope: setSoundScope,
            onSound: sound,
            onSoundDrag: soundDrag,
            listening,
            onListening: setListening,
            soundStatus,
            entity: { assets, onSound: sound, onSoundDrag: soundDrag },
          }}
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
          selectedPrefabScatterable={scatterableSelection}
          region={scatterRegion}
          onRegion={setScatterRegion}
          cornerPick={cornerPick}
          onCornerPick={setCornerPick}
          onScatter={scatter}
        />
      </div>

      <ContentActions
        action={contentAction}
        running={actionRunning}
        report={actionReport}
        error={actionError}
        onClose={() => setContentAction(null)}
        onImportScene={importScene}
        onGeneratePrefabs={generatePrefabs}
      />

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
