import type { JSX } from 'react';
import { tokens } from '@wov/ui';
import { createEmptyWorld } from '@wov/editor-core';
import { Viewport } from './Viewport.js';

const draft = createEmptyWorld('draft', 'Untitled World');

/** Static Phase 0 layout: menubar, hierarchy, viewport, inspector (spec §13). */
export function EditorShell(): JSX.Element {
  return (
    <div className="shell" style={{ background: tokens.colorBackground, color: tokens.colorText }}>
      <header className="menubar" style={{ background: tokens.colorSurface }}>
        <span data-testid="editor-marker" style={{ color: tokens.colorAccent }}>
          World of Vikings &ndash; world editor dev build
        </span>
      </header>
      <div className="body">
        <aside className="panel" style={{ background: tokens.colorSurface }}>
          <h2>Hierarchy</h2>
          <p>
            {draft.name} ({draft.zones.length} zones)
          </p>
        </aside>
        <section className="viewport">
          <Viewport />
        </section>
        <aside className="panel" style={{ background: tokens.colorSurface }}>
          <h2>Inspector</h2>
          <p>Nothing selected.</p>
        </aside>
      </div>
    </div>
  );
}
