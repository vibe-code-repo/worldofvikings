/**
 * Architecture boundaries as an executable rule set (spec §10, agent rules 7-9).
 *
 * Run with `pnpm lint:boundaries` (part of `pnpm lint` and `pnpm check`).
 * A violation fails the build — the boundaries are not prose.
 */
const EDITOR_ONLY = '(^|/)(apps/editor|packages/editor-core)(/|$)|@wov/editor-core';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'game-must-not-use-editor',
      comment:
        'The game bundle must never contain editor code (spec §10). Move shared logic into ' +
        'packages/engine, packages/world-schema or packages/shared instead.',
      severity: 'error',
      from: { path: '^apps/game/' },
      to: { path: EDITOR_ONLY },
    },
    {
      name: 'world-schema-must-stay-renderer-free',
      comment:
        'packages/world-schema describes data, not rendering. It must not depend on Babylon.js, ' +
        'React or any app.',
      severity: 'error',
      from: { path: '^packages/world-schema/' },
      to: { path: 'babylonjs|(^|/)react(/|$)|^apps/' },
    },
    {
      name: 'gameplay-must-not-render',
      comment: 'Gameplay state must stay independent of the renderer (spec §25).',
      severity: 'error',
      from: { path: '^packages/gameplay/' },
      to: { path: 'babylonjs|^packages/engine/|@wov/engine' },
    },
    {
      name: 'packages-must-not-depend-on-apps',
      comment: 'Shared packages are the lower layer; apps depend on them, never the other way.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(apps|services)/' },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies make modules impossible to reason about in isolation.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/|\\.test\\.tsx?$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
