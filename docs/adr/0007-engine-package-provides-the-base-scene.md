# ADR-0007: The engine package provides the base scene, as an opt-in

- **Status:** accepted
- **Date:** 2026-09-05
- **Deciders:** Core maintainers

## Context

ADR-0006 gave `@wov/engine` the Babylon.js bootstrap and drew a hard line:
"The package owns **no gameplay state and no scene content**: no camera, light,
mesh or material." Its alternatives table rejected putting camera, light and
ground into the package, on the grounds that this would make the renderer own
scene content and that the game and the editor need different content.

Phase 1 makes that line too coarse. Both apps now need the same _empty stage_:
a flat lit ground, a sky colour and matching fog, so that a view opens on an
oriented space instead of a black rectangle, and so that a renderer regression
is visible on sight. Duplicating that in `apps/game` and `apps/editor` brings
back exactly what ADR-0006 removed — two copies of the same Babylon setup that
drift, this time including the parts that are easy to get subtly wrong:

- `Color3.FromHexString` answers black for anything it cannot parse. An
  unvalidated colour surfaces as a lighting bug, far from the bad value.
- A `DirectionalLight` with `shadowEnabled` left at its default plus any later
  `ShadowGenerator` is a second pass per caster, against a hard 60 FPS budget
  (spec §38).
- Linear fog only hides the ground edge when `fogColor` tracks `clearColor` and
  the distances track the ground size. Three values that must agree.

The distinction that actually matters is not "content vs. no content". It is
**gameplay state vs. presentation**. Spec §25 forbids the renderer owning game
state — entities, stats, the player. A ground plane and two lights are neither;
they hold nothing a system reads back.

## Decision

`@wov/engine` gains a second, **separate and opt-in** entry point:
`createBaseScene(scene, options): BaseSceneHandle` in `src/base-scene.ts`.

- `createRenderer` is unchanged and still creates no camera, light or mesh. The
  bootstrap stays content-free; a caller who wants the stage asks for it.
- `createBaseScene` creates the ground, a `HemisphericLight` fill, a
  `DirectionalLight` key with `shadowEnabled = false`, the sky clear colour and
  linear fog in the same colour. It creates **no camera**: the game wants a
  third-person follow camera (spec §26) and the editor a fly camera, so that
  stays with the apps. This is the "the two need different ones" objection from
  ADR-0006, answered by drawing the boundary one step lower.
- Its options are plain data — numbers and `#rrggbb` strings, no Babylon types —
  and are validated in `resolveBaseSceneOptions`, so the same description can
  come out of world JSON later without a second validation layer (agent rule 10).
- Everything it created is returned on `BaseSceneHandle`, including a `dispose`
  that restores the previous sky and fog. The caller can replace any part of it.

This narrows, and does not overturn, ADR-0006: the _bootstrap_ still owns no
content. What changes is that "no scene content anywhere in `@wov/engine`"
becomes "no gameplay state, and no content the bootstrap forces on a caller".

The ground is a placeholder, not terrain. Real terrain is authored in the editor
and loaded from `content/` from Phase 5 on, and nothing here generates world
geometry (agent rule 16).

## Alternatives considered

| Alternative                                          | Why not                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the base scene in each app, as ADR-0006 decided | Two copies of the fog/sky/shadow setup that drift silently. The failure modes above are invisible to `tsc` and to a screenshot taken on a good machine.                               |
| Put it in a new `packages/stage`                     | A package for one 200-line module, depending on `@babylonjs/core` exactly like `@wov/engine` does. More boundary rules to enforce, no boundary actually gained.                       |
| Fold it into `createRenderer` behind a flag          | Makes the bootstrap own content again and gives every caller a mesh it may not want — the editor's asset preview, for one. An opt-in call is the same line of code, without the flag. |
| Put it in `@wov/gameplay`                            | `@wov/gameplay` must not import a renderer (`pnpm lint:boundaries`, spec §25). Ground and lights are Babylon objects.                                                                 |
| Accept Babylon `Color3` in the options               | Colours belong in world data eventually. Hex strings survive JSON; `Color3` does not.                                                                                                 |
| Take colours as hex without validating them          | `Color3.FromHexString` returns black rather than failing, so a typo renders as a lighting bug instead of an error naming the field.                                                   |
| Subdivide the ground for smoother lighting and fog   | Measurably pointless here: Babylon interpolates the position and normal varyings perspective-correctly, so a flat plane is lit and fogged exactly per pixel on two triangles.         |

## Consequences

**Positive** — one validated description of the stage for both apps; the "no
shadows yet" decision is stated in code (`shadowEnabled = false`) instead of
being an accident of nobody having added a `ShadowGenerator`; the options are
already shaped like the world data that will replace them.

**Negative** — `@wov/engine` now pulls `DirectionalLight`, `HemisphericLight`,
`StandardMaterial` and the ground builder into anything that imports it. Measured
on the game bundle (Babylon 8.56.2, `pnpm --filter @wov/game build`), the main
chunk moves from 988.71 kB raw / 238.20 kB gzip to **998.87 kB raw / 240.54 kB
gzip** — +10.16 kB raw / +2.34 kB gzip. That code was previously in
`apps/game/src/scene.ts`, so for the game it is a move, not an addition; for a
future importer that wants only `createRenderer` it is new weight, and the fix
if that ever matters is a second entry point in `exports`, not a copy.

**Follow-ups** — the editor still builds its own viewport content and should
move to `createBaseScene`. When terrain arrives (Phase 5), `createBaseScene`
becomes the fallback for "no terrain loaded", not the terrain itself. `fogMode`
is scene-wide state, so a second `createBaseScene` on the same scene overwrites
the first; that is why `dispose` restores the previous values.
