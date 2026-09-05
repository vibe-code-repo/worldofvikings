/**
 * Architecture boundaries as an executable rule set (spec §10, agent rules 7-9).
 *
 * Run with `pnpm lint:boundaries` (part of `pnpm lint` and `pnpm check`).
 * A violation fails the build — the boundaries are not prose.
 */
const EDITOR_ONLY = '(^|/)(apps/editor|packages/editor-core)(/|$)|@wov/editor-core';

/** Anything that pulls the Havok engine in: the package, or our backend module. */
const PHYSICS_BACKEND = '@babylonjs/havok|@wov/physics/havok|^packages/physics/src/havok\\.ts$';

/**
 * The only two modules allowed to name a physics backend (ADR-0008): the
 * implementation itself, and the single loader in the game that lazy-imports it.
 */
const PHYSICS_BACKEND_OWNERS =
  '^(packages/physics/src/havok\\.ts|apps/game/src/physics-backend\\.ts)$';

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
      name: 'physics-backend-stays-in-one-place',
      comment:
        'Only packages/physics/src/havok.ts and apps/game/src/physics-backend.ts may name a ' +
        'physics backend (ADR-0008). Everything else uses the PhysicsWorld contract from ' +
        '@wov/physics, so the engine can be replaced without touching gameplay.',
      severity: 'error',
      from: { pathNot: PHYSICS_BACKEND_OWNERS },
      to: { path: PHYSICS_BACKEND },
    },
    {
      name: 'physics-contract-must-stay-framework-free',
      comment:
        'The @wov/physics entry point is what gameplay imports. It must not reach Babylon.js, ' +
        'Havok or its own backend module, or importing the contract would drag the engine into ' +
        'every bundle (ADR-0008).',
      severity: 'error',
      from: { path: '^packages/physics/src/(index|contract|defaults)\\.ts$' },
      to: { path: 'babylonjs|^packages/physics/src/havok\\.ts$' },
    },
    {
      name: 'editor-must-not-load-physics',
      comment:
        'The editor does not simulate. Keeping the ~2 MB Havok WASM module out of its bundle is ' +
        'the reason the backend sits behind a separate entry point (ADR-0008, spec §38).',
      severity: 'error',
      from: { path: '^(apps/editor|packages/editor-core)/' },
      to: { path: PHYSICS_BACKEND },
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
