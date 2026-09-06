/**
 * The zone inspector: the ground of the active zone (ADR-0020, ADR-0033).
 *
 * A zone's `terrain` block was written by the terrain import and edited by
 * hand. The editor drew it and could not change it — which meant the one thing
 * an author most wants to try, *swap the layer that paints the hillside*, was a
 * text editor and a reload.
 *
 * Everything below the two pickers is `SchemaFields` over
 * `TerrainDefinitionSchema`, so the fields the terrain work is adding —
 * `normalMap`, `normalScale`, `metallic`, `smoothness` — appear here with their
 * own ranges the moment the schema accepts them, and this file does not change.
 *
 * The two pickers are the exception, and they earn it: a height field and a
 * ground texture are *asset paths*, and the honest control for one is the list
 * of assets that exist, not a text box you can typo into. They fill the same
 * field the text control would.
 */
import type { JSX } from 'react';
import { TERRAIN_FIELDS, activeZone, type EditorDocument, type FieldPatch } from '@wov/editor-core';
import type { PrefabIndex } from '../scene/prefab-index.js';
import { SchemaFields, defaultValueFor } from './SchemaFields.js';

export interface ZoneInspectorProps {
  readonly document: EditorDocument;
  /** `null` until `GET /prefabs` answers; the pickers are then empty. */
  readonly prefabs: PrefabIndex | null;
  readonly onTerrain: (zoneId: string, patches: readonly FieldPatch[]) => void;
  readonly onTerrainDrag: (zoneId: string, patch: FieldPatch, gesture: string) => void;
  readonly onRenameZone: (zoneId: string, name: string) => void;
}

/** A terrain block with the three fields the schema requires and nothing else. */
function emptyTerrain(heightField: string): Record<string, unknown> {
  return { heightField, position: [0, 0, 0], size: [100, 100] };
}

export function ZoneInspector(props: ZoneInspectorProps): JSX.Element {
  const zone = activeZone(props.document);

  if (zone === undefined) {
    return (
      <aside className="panel" data-testid="editor-zone-inspector">
        <h2>Zone</h2>
        <p className="empty" data-testid="zone-inspector-empty">
          This world has no zone.
        </p>
      </aside>
    );
  }

  const terrain = zone.terrain;
  const heightFields = (props.prefabs?.inCategory('terrain') ?? []).map((prefab) => prefab.asset);
  const layers = terrain?.layers ?? [];

  return (
    <aside className="panel" data-testid="editor-zone-inspector">
      <h2>Zone</h2>

      <div className="field">
        <span className="field-label">id</span>
        <span className="field-value" data-testid="zone-inspector-id">
          {zone.id}
        </span>
      </div>

      <label className="field">
        <span className="field-label">name</span>
        <input
          data-testid="zone-inspector-name"
          key={`${zone.id}:${zone.name}`}
          defaultValue={zone.name}
          onBlur={(event) => {
            if (event.target.value !== zone.name) {
              props.onRenameZone(zone.id, event.target.value);
            }
          }}
        />
      </label>

      <h3 className="panel-subhead">Terrain</h3>

      {terrain === undefined ? (
        <div className="zone-terrain-empty">
          <p className="empty" data-testid="zone-terrain-empty">
            This zone has no ground — an interior, or a zone still being blocked out.
          </p>
          <label className="field">
            <span className="field-label">height field</span>
            <select
              data-testid="zone-terrain-add"
              value=""
              onChange={(event) => {
                if (event.target.value !== '') {
                  props.onTerrain(zone.id, [{ path: [], value: emptyTerrain(event.target.value) }]);
                }
              }}
            >
              <option value="">— pick one to give it ground —</option>
              {heightFields.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <>
          <div className="zone-terrain-head">
            <span className="menu-hint" data-testid="zone-terrain-layer-order">
              {layers.map((layer) => layer.texture).join(' | ')}
            </span>
            <button
              type="button"
              data-testid="zone-terrain-remove"
              title="take the ground away from this zone"
              onClick={() => props.onTerrain(zone.id, [{ path: [], value: null }])}
            >
              remove ground
            </button>
          </div>

          <div className="schema-fields" data-testid="zone-terrain-fields">
            <SchemaFields
              fields={TERRAIN_FIELDS}
              value={terrain}
              testId="terrain"
              onChange={(path, value) => props.onTerrain(zone.id, [{ path, value }])}
              onDrag={(path, value, gesture) =>
                props.onTerrainDrag(zone.id, { path, value }, gesture)
              }
            />
          </div>

          {/*
            The asset pickers, filling the same fields the text controls above
            do. Kept below them rather than replacing them: a world may name a
            height field or a texture no catalogue lists, and a picker that
            hides the value would make that world uneditable.
          */}
          <h3 className="panel-subhead">From the catalogue</h3>
          <label className="field">
            <span className="field-label">height field</span>
            <select
              data-testid="zone-terrain-heightfield"
              value={heightFields.includes(terrain.heightField) ? terrain.heightField : ''}
              onChange={(event) => {
                if (event.target.value !== '') {
                  props.onTerrain(zone.id, [{ path: ['heightField'], value: event.target.value }]);
                }
              }}
            >
              <option value="">{terrain.heightField}</option>
              {heightFields.map((asset) => (
                <option key={asset} value={asset}>
                  {asset}
                </option>
              ))}
            </select>
          </label>

          {layers.map((layer, index) => (
            <label className="field" key={`${String(index)}:${layer.texture}`}>
              <span className="field-label">layer {index}</span>
              <input
                type="text"
                data-testid={`zone-terrain-layer-${String(index)}-texture`}
                defaultValue={layer.texture}
                onBlur={(event) => {
                  if (event.target.value !== layer.texture && event.target.value !== '') {
                    props.onTerrain(zone.id, [
                      { path: ['layers', String(index), 'texture'], value: event.target.value },
                    ]);
                  }
                }}
              />
            </label>
          ))}

          <button
            type="button"
            className="tab"
            data-testid="zone-terrain-add-layer"
            onClick={() => {
              const item = TERRAIN_FIELDS.find((field) => field.key === 'layers');
              if (item?.kind !== 'list') {
                return;
              }
              props.onTerrain(zone.id, [
                { path: ['layers'], value: [...layers, defaultValueFor(item.item)] },
              ]);
            }}
          >
            add a layer
          </button>
        </>
      )}
    </aside>
  );
}
