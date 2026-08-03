/**
 * Vite's asset-import types.
 *
 * `import url from './x.wasm?url'` is a Vite feature, not a TypeScript one —
 * without this reference tsc rejects the Havok WASM import in Physics.ts.
 */
/// <reference types="vite/client" />
