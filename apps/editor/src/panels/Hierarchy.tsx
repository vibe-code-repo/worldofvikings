import { useState } from 'react';
import type { JSX } from 'react';
import type { EditorDocument } from '@wov/editor-core';

export interface HierarchyProps {
  readonly document: EditorDocument;
  readonly onActivateZone: (zoneId: string) => void;
  readonly onSelect: (entityId: string, additive: boolean) => void;
  readonly onAddZone: () => void;
  readonly onRenameZone: (zoneId: string, name: string) => void;
}

/**
 * Zones and their entities (spec §13).
 *
 * The tree shows the whole world, not only the active zone, because switching
 * zone is the one navigation an author does that has no equivalent in the
 * viewport. Entities are listed for the active zone only: the viewport shows
 * one zone at a time, and a row that cannot be clicked into view is a row that
 * lies about what selecting does.
 */
export function Hierarchy(props: HierarchyProps): JSX.Element {
  const { document } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const selection = new Set(document.selection);

  return (
    <aside className="panel" data-testid="editor-hierarchy">
      <div className="panel-head">
        <h2>Hierarchy</h2>
        <button type="button" data-testid="hierarchy-add-zone" onClick={props.onAddZone}>
          + Zone
        </button>
      </div>

      {document.world.zones.length === 0 ? (
        <p className="empty" data-testid="hierarchy-empty">
          No zones yet. Add one to start placing.
        </p>
      ) : (
        <ul className="tree">
          {document.world.zones.map((zone) => {
            const active = zone.id === document.activeZoneId;
            return (
              <li key={zone.id}>
                {renaming === zone.id ? (
                  <input
                    autoFocus
                    data-testid="hierarchy-zone-name-input"
                    defaultValue={zone.name}
                    onBlur={(event) => {
                      props.onRenameZone(zone.id, event.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={active ? 'zone active' : 'zone'}
                    data-testid={`hierarchy-zone-${zone.id}`}
                    onClick={() => props.onActivateZone(zone.id)}
                    onDoubleClick={() => setRenaming(zone.id)}
                    title="Double-click to rename"
                  >
                    {zone.name}
                    <span className="menu-hint">{zone.entities.length}</span>
                  </button>
                )}

                {active && (
                  <ul className="entities" data-testid="hierarchy-entities">
                    {zone.entities.map((entity) => (
                      <li key={entity.id}>
                        <button
                          type="button"
                          className={selection.has(entity.id) ? 'entity selected' : 'entity'}
                          data-testid={`hierarchy-entity-${entity.id}`}
                          onClick={(event) =>
                            props.onSelect(entity.id, event.shiftKey || event.ctrlKey)
                          }
                        >
                          {entity.id}
                          <span className="menu-hint">{entity.prefab}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
