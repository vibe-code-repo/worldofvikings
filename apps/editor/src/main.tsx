/**
 * Editor entry point (Phase 0).
 *
 * Renders the React shell with a Babylon.js viewport placeholder. Selection,
 * gizmos, hierarchy and asset browser follow in Phase 3.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorShell } from './EditorShell.js';

const container = document.querySelector('#root');
if (!container) {
  throw new Error('editor: #root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <EditorShell />
  </StrictMode>,
);
