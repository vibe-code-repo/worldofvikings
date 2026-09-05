# ADR-0002: Babylon.js as rendering engine

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** project maintainers

## Context

World of Vikings is an engine-style browser application, not a 3D viewer: it
needs rendering, animation and skinning, physics integration, picking, scene
graph handling, cameras, materials, particles, audio, gizmos, and a WebGPU path
where supported. The world editor needs the same feature set plus transform
gizmos and scene inspection.

## Decision

Use **Babylon.js** (`@babylonjs/core`) with TypeScript and Vite, WebGL2 with
WebGPU where supported, Havok for physics (from Phase 1 on) and glTF/GLB assets.

## Alternatives considered

| Alternative              | Why not                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| three.js                 | Excellent renderer, but scene tooling, gizmos, animation blending, physics integration and inspector would each be an extra dependency or hand-written. For an editor-plus-game project that is more surface to maintain. |
| PlayCanvas               | Strong engine, but its editor-centric workflow pulls towards a hosted tool; we need an editor that is part of this open-source repository.                                                                                |
| Unity/Godot WebGL export | Contradicts "browser-first, clone and run" (spec §3) and requires a proprietary or heavy toolchain (agent rule 18).                                                                                                       |

## Consequences

**Positive** — one dependency covers renderer, animation, picking, gizmos and
physics glue; TypeScript types are first-class; WebGPU is available without a
rewrite.

**Negative** — the bundle is large (Phase 0 game bundle is ~1 MB minified). Deep
imports (`@babylonjs/core/...`) instead of the barrel import are mandatory, and
side-effect modules must be imported explicitly or features silently do nothing.

**Follow-ups** — measure and code-split the bundle in Phase 1; document the
required side-effect imports in `@wov/engine` when the shared bootstrap moves
there.
