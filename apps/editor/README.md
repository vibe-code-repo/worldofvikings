# @wov/editor

Standalone world editor (production: `editor.world-of-vikings.com`, access
restricted — spec §48). Phase 0 ships the React shell with a Babylon.js viewport
placeholder; selection, gizmos, hierarchy and asset browser follow in Phase 3.

- Dev: `pnpm --filter @wov/editor dev` → http://localhost:5174
- Environment: `VITE_API_URL`, `VITE_ASSET_URL` (see `.env.example`)

The editor produces an independent bundle (spec §10). Shared logic belongs in
`@wov/engine`, `@wov/world-schema`, `@wov/asset-system`; editor-only logic in
`@wov/editor-core`.

Dependencies: `react`, `react-dom` (editor UI, spec §2.1), `@babylonjs/core`,
`@vitejs/plugin-react`, `vite`, plus `@wov/editor-core`, `@wov/engine`, `@wov/ui`.
