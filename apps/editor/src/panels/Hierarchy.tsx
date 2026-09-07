import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { EditorDocument } from '@wov/editor-core';
import { scrollToShowRow, windowedRange } from './list-window.js';

export interface HierarchyProps {
  readonly document: EditorDocument;
  readonly onActivateZone: (zoneId: string) => void;
  readonly onSelect: (entityId: string, additive: boolean) => void;
  readonly onAddZone: () => void;
  readonly onRenameZone: (zoneId: string, name: string) => void;
}

/** Rows kept rendered above and below the visible slice. */
const OVERSCAN = 12;

/**
 * What a row and the panel are assumed to be until the first layout.
 *
 * Guesses, not numbers copied out of the stylesheet: the real ones are read off
 * the DOM in a layout effect, before the browser paints. They only decide how
 * many rows the very first pass builds, and being wrong there costs a few rows
 * either way.
 */
const ROW_HEIGHT_GUESS = 22;
const PANEL_HEIGHT_GUESS = 900;

/** What the panel measured about itself; all in CSS pixels. */
interface PanelMetrics {
  readonly rowHeight: number;
  /** Where the entity list starts, in the panel's own scroll coordinates. */
  readonly listTop: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

const INITIAL_METRICS: PanelMetrics = {
  rowHeight: ROW_HEIGHT_GUESS,
  listTop: 0,
  scrollTop: 0,
  viewportHeight: PANEL_HEIGHT_GUESS,
};

function sameMetrics(left: PanelMetrics, right: PanelMetrics): boolean {
  return (
    left.rowHeight === right.rowHeight &&
    left.listTop === right.listTop &&
    left.scrollTop === right.scrollTop &&
    left.viewportHeight === right.viewportHeight
  );
}

/**
 * Zones and their entities (spec §13).
 *
 * The tree shows the whole world, not only the active zone, because switching
 * zone is the one navigation an author does that has no equivalent in the
 * viewport. Entities are listed for the active zone only: the viewport shows
 * one zone at a time, and a row that cannot be clicked into view is a row that
 * lies about what selecting does.
 *
 * **Only the visible rows exist** (ADR-0048). A zone of 5273 entities is 5273
 * buttons the browser lays out and React reconciles for the thirty a column
 * shows; the rest are two spacers of exactly their height, so the scrollbar and
 * every scroll position stay what they were. A zone small enough to fit is
 * rendered whole, both spacers collapsing to nothing, so the short worlds the
 * smoke tests walk are the same DOM they always were.
 *
 * The component is memoised because the shell re-renders for reasons the
 * hierarchy has nothing to do with — the asset-origins line alone changes 145
 * times while `village1` loads — and a list this long must not be rebuilt for a
 * status bar.
 */
export const Hierarchy = memo(function Hierarchy(props: HierarchyProps): JSX.Element {
  const { document, onSelect } = props;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PanelMetrics>(INITIAL_METRICS);

  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowRef = useRef<HTMLLIElement>(null);

  const selection = useMemo(() => new Set(document.selection), [document.selection]);
  const zones = document.world.zones;
  const activeZoneId = document.activeZoneId;
  const entities = useMemo(
    () => zones.find((zone) => zone.id === activeZoneId)?.entities ?? [],
    [zones, activeZoneId],
  );

  /**
   * Reads the panel's own geometry back out of the DOM.
   *
   * Everything the window depends on is measured rather than copied out of the
   * stylesheet, so a change to the row padding or the panel width cannot
   * silently put the spacers out of step with the rows.
   */
  const remeasure = useCallback(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const list = listRef.current;
    const row = rowRef.current;
    const panelTop = panel.getBoundingClientRect().top;
    setMetrics((previous) => {
      const rowHeight = row === null ? previous.rowHeight : row.getBoundingClientRect().height;
      const listTop =
        list === null
          ? previous.listTop
          : list.getBoundingClientRect().top - panelTop + panel.scrollTop;
      const next: PanelMetrics = {
        rowHeight: rowHeight > 0 ? rowHeight : previous.rowHeight,
        listTop,
        scrollTop: panel.scrollTop,
        viewportHeight: panel.clientHeight > 0 ? panel.clientHeight : previous.viewportHeight,
      };
      return sameMetrics(previous, next) ? previous : next;
    });
  }, []);

  // Before the browser paints, so the first frame the author sees is already
  // the measured window and not the guessed one.
  useLayoutEffect(remeasure);

  useEffect(() => {
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
    };
  }, [remeasure]);

  const view = windowedRange({
    count: entities.length,
    rowHeight: metrics.rowHeight,
    listTop: metrics.listTop,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    overscan: OVERSCAN,
  });

  /*
   * Selecting an entity anywhere else brings its row into view.
   *
   * It has to: outside the window the row does not exist, so a viewport click
   * on a prop three thousand rows down would otherwise leave the hierarchy
   * looking as though nothing had been selected. Keyed on the last-picked id
   * alone — scrolling on every document change would fight the author's own
   * scrolling during a gizmo drag.
   */
  const primary = document.selection.at(-1) ?? null;
  const showRow = useCallback(
    (entityId: string) => {
      const panel = panelRef.current;
      if (panel === null) {
        return;
      }
      const to = scrollToShowRow({
        index: entities.findIndex((entity) => entity.id === entityId),
        rowHeight: metrics.rowHeight,
        listTop: metrics.listTop,
        scrollTop: panel.scrollTop,
        viewportHeight: panel.clientHeight,
      });
      if (to !== null) {
        panel.scrollTop = to;
        remeasure();
      }
    },
    [entities, metrics.rowHeight, metrics.listTop, remeasure],
  );
  const showRowRef = useRef(showRow);
  showRowRef.current = showRow;
  useEffect(() => {
    if (primary !== null) {
      showRowRef.current(primary);
    }
  }, [primary]);

  const rows = entities.slice(view.first, view.end);

  return (
    <aside className="panel" data-testid="editor-hierarchy" ref={panelRef} onScroll={remeasure}>
      <div className="panel-head">
        <h2>Hierarchy</h2>
        <button type="button" data-testid="hierarchy-add-zone" onClick={props.onAddZone}>
          + Zone
        </button>
      </div>

      {zones.length === 0 ? (
        <p className="empty" data-testid="hierarchy-empty">
          No zones yet. Add one to start placing.
        </p>
      ) : (
        <ul className="tree">
          {zones.map((zone) => {
            const active = zone.id === activeZoneId;
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
                    onClick={() => {
                      props.onActivateZone(zone.id);
                    }}
                    onDoubleClick={() => {
                      setRenaming(zone.id);
                    }}
                    title="Double-click to rename"
                  >
                    {zone.name}
                    <span className="menu-hint">{zone.entities.length}</span>
                  </button>
                )}

                {active && (
                  <ul className="entities" data-testid="hierarchy-entities" ref={listRef}>
                    {view.leadingPx > 0 && (
                      <li aria-hidden="true" style={{ height: view.leadingPx }} />
                    )}
                    {rows.map((entity, offset) => (
                      <li key={entity.id} ref={offset === 0 ? rowRef : null}>
                        <EntityRow
                          entityId={entity.id}
                          prefab={entity.prefab}
                          selected={selection.has(entity.id)}
                          onSelect={onSelect}
                        />
                      </li>
                    ))}
                    {view.trailingPx > 0 && (
                      <li aria-hidden="true" style={{ height: view.trailingPx }} />
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
});

interface EntityRowProps {
  readonly entityId: string;
  readonly prefab: string;
  readonly selected: boolean;
  readonly onSelect: (entityId: string, additive: boolean) => void;
}

/**
 * One entity row.
 *
 * Its own memoised component, so a scroll or a selection change rebuilds the
 * two rows whose state actually differs and not the whole window.
 */
const EntityRow = memo(function EntityRow(props: EntityRowProps): JSX.Element {
  const { entityId, onSelect } = props;
  const click = useCallback(
    (event: { readonly shiftKey: boolean; readonly ctrlKey: boolean }) => {
      onSelect(entityId, event.shiftKey || event.ctrlKey);
    },
    [entityId, onSelect],
  );
  return (
    <button
      type="button"
      className={props.selected ? 'entity selected' : 'entity'}
      data-testid={`hierarchy-entity-${entityId}`}
      title={`${entityId} — ${props.prefab}`}
      onClick={click}
    >
      <span className="entity-id">{entityId}</span>
      <span className="menu-hint">{props.prefab}</span>
    </button>
  );
});
