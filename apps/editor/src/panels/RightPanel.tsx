/**
 * The right-hand column: four inspectors behind four tabs.
 *
 * They are tabs and not four stacked panels because they answer four questions
 * about four different things — the selected entity, the active zone's ground,
 * the highlighted prefab, and the light — and only one of those is ever the
 * question. Stacking them would put the lighting sliders below a scroll nobody
 * reaches.
 *
 * *Zone* is where the whole `terrain` block lives, dials included: it is one
 * block and it gets one panel, even though two commands write it (ADR-0032,
 * ADR-0033).
 *
 * *Entity* stays the tab a session opens on: it is the one that answers to a
 * click in the viewport, and moving it would make selecting a prop feel like it
 * did nothing.
 */
import type { JSX } from 'react';
import type {
  EditorDocument,
  FieldPatch,
  LightingScope,
  PrefabEdit,
  TerrainSurfacePatch,
  TransformPatch,
} from '@wov/editor-core';
import type { AssetIndex } from '../api/assets.js';
import type { CatalogedPrefab } from '../api/client.js';
import { Inspector } from './Inspector.js';
import { LightingPanel } from './LightingPanel.js';
import { PrefabInspector } from './PrefabInspector.js';
import { ZoneInspector } from './ZoneInspector.js';

export const RIGHT_PANEL_TABS = ['entity', 'zone', 'prefab', 'lighting'] as const;
export type RightPanelTab = (typeof RIGHT_PANEL_TABS)[number];

export interface RightPanelProps {
  readonly tab: RightPanelTab;
  readonly onTab: (tab: RightPanelTab) => void;
  readonly document: EditorDocument;
  /** The asset manifest, once it has been read; the zone pickers need it. */
  readonly assets: AssetIndex | null;
  readonly selectedPrefab: CatalogedPrefab | null;
  readonly prefabSaving: boolean;
  readonly lightingScope: 'world' | 'zone';
  readonly onLightingScope: (scope: 'world' | 'zone') => void;
  readonly onRename: (entityId: string, nextId: string) => void;
  readonly onTransform: (entityId: string, patch: TransformPatch) => void;
  readonly onRenameZone: (zoneId: string, name: string) => void;
  readonly onTerrain: (zoneId: string, patches: readonly FieldPatch[]) => void;
  readonly onTerrainDrag: (zoneId: string, patch: FieldPatch, gesture: string) => void;
  readonly onSurface: (zoneId: string, index: number, patch: TerrainSurfacePatch) => void;
  readonly onFlatNormals: (zoneId: string, facetted: boolean) => void;
  readonly onLighting: (scope: LightingScope, patches: readonly FieldPatch[]) => void;
  readonly onLightingDrag: (scope: LightingScope, patch: FieldPatch, gesture: string) => void;
  readonly onSavePrefab: (prefab: CatalogedPrefab, edit: PrefabEdit) => void;
}

const LABELS: Record<RightPanelTab, string> = {
  entity: 'Entity',
  zone: 'Zone',
  prefab: 'Prefab',
  lighting: 'Lighting',
};

export function RightPanel(props: RightPanelProps): JSX.Element {
  return (
    <div className="right-panel" data-testid="editor-right-panel">
      <div className="tabs" role="tablist">
        {RIGHT_PANEL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={props.tab === tab}
            className={props.tab === tab ? 'tab active' : 'tab'}
            data-testid={`right-tab-${tab}`}
            onClick={() => props.onTab(tab)}
          >
            {LABELS[tab]}
          </button>
        ))}
      </div>

      {props.tab === 'entity' && (
        <Inspector
          document={props.document}
          onRename={props.onRename}
          onTransform={props.onTransform}
        />
      )}
      {props.tab === 'zone' && (
        <ZoneInspector
          document={props.document}
          assets={props.assets}
          onTerrain={props.onTerrain}
          onTerrainDrag={props.onTerrainDrag}
          onSurface={props.onSurface}
          onFlatNormals={props.onFlatNormals}
          onRenameZone={props.onRenameZone}
        />
      )}
      {props.tab === 'prefab' && (
        <PrefabInspector
          prefab={props.selectedPrefab}
          saving={props.prefabSaving}
          onSave={props.onSavePrefab}
        />
      )}
      {props.tab === 'lighting' && (
        <LightingPanel
          document={props.document}
          scope={props.lightingScope}
          onScope={props.onLightingScope}
          onLighting={props.onLighting}
          onLightingDrag={props.onLightingDrag}
        />
      )}
    </div>
  );
}
