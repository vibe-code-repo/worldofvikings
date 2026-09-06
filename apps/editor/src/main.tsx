/**
 * Editor entry point.
 *
 * Renders the React shell around the Babylon.js viewport. The dev-only debug
 * bridge is installed before the first render so `window.__wovEditor` exists by
 * the time anything can report into it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isDebugRequested } from '@wov/shared';
import { EditorShell } from './EditorShell.js';
import { installEditorDebugBridge } from './dev-debug.js';

// Both operands on the left are build-time literals, so a default build folds
// this to `false` and never installs a bridge (ADR-0030).
if (import.meta.env.DEV || (__WOV_DEBUG_BRIDGE__ && isDebugRequested(window.location.search))) {
  installEditorDebugBridge();
}

const container = document.querySelector('#root');
if (!container) {
  throw new Error('editor: #root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <EditorShell />
  </StrictMode>,
);
