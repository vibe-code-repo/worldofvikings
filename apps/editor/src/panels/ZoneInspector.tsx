/**
 * The zone inspector: the ground of the active zone (ADR-0020, ADR-0033).
 *
 * A zone's `terrain` block was written by the terrain import and edited by
 * hand. The editor drew it and could not change it — which meant the one thing
 * an author most wants to try, *swap the layer that paints the hillside*, was a
 * text editor and a reload.
 *
 * Everything below the head is `SchemaFields` over `TerrainDefinitionSchema`,
 * so the fields the terrain work is adding — `normalMap`, `normalScale`,
 * `metallic`, `smoothness` — appear here with their own ranges the moment the
 * schema accepts them, and this file does not change. That includes their
 * pickers: a path field annotated with `assetPathOf('texture')` arrives with
 * the store's images attached to it, because the *schema* says what kind of
 * file the field names and this panel only forwards the manifest.
 *
 * The one thing this panel decides by itself is what to do with a zone that has
 * **no** ground at all, because then there is no block for `SchemaFields` to
 * draw: it offers the height fields the store holds, and the first one chosen
 * builds the smallest terrain the schema accepts.
 */
import type { JSX } from 'react';
import { TERRAIN_FIELDS, activeZone, type EditorDocument, type FieldPatch } from '@wov/editor-core';
import type { AssetIndex } from '../api/assets.js';
import { SchemaFields } from './SchemaFields.js';

export interface ZoneInspectorProps {
  readonly document: EditorDocument;
  /** `null` until the asset manifest has been read; the pickers are empty then. */
  readonly assets: AssetIndex | null;
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
  const assetOptions = (kind: string): readonly string[] => props.assets?.ofKind(kind) ?? [];
  const heightFields = assetOptions('terrain');
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
              assetOptions={assetOptions}
              onChange={(path, value) => props.onTerrain(zone.id, [{ path, value }])}
              onDrag={(path, value, gesture) =>
                props.onTerrainDrag(zone.id, { path, value }, gesture)
              }
            />
          </div>

          {/*
            Says out loud whether the pickers have anything in them. A field
            whose dropdown is empty because no asset server answered looks
            exactly like a field whose dropdown is empty because the store is.
          */}
          <p className="hint" data-testid="zone-terrain-catalog-hint">
            {props.assets === null
              ? 'reading the asset manifest…'
              : `${String(heightFields.length)} height field(s) and ` +
                `${String(assetOptions('texture').length)} texture(s) to choose from`}
          </p>
        </>
      )}
    </aside>
  );
}
