# ADR-0027: Small vegetation receives shadow but does not cast it

- **Status:** accepted (amended by [ADR-0049](0049-the-editor-draws-a-zone-the-way-the-game-does.md))
- **Date:** 2026-09-06
- **Deciders:** engine and game-client owners

> **Amendment (ADR-0049).** The rule below is unchanged; only its address is.
> `castsShadows` and `SHADOW_CASTER_MINIMUM_HEIGHT` now live in
> `packages/world-schema/src/prefab.ts`, because the editor has to ask the same
> question and `lint:boundaries` forbids one app importing another. Everywhere
> this file says `apps/game/src/world-scene.ts`, read `@wov/world-schema`.

## Context

Three decisions met in one frame for the first time when the evening light
(ADR-0024), the scatter tool (ADR-0025) and entity collision (ADR-0026) were
brought together on `village1`.

The light rig's rule is deliberately inverted from Babylon's: **everything casts
and receives unless it is excluded**, because a village arrives over several
seconds and a rule that has to be applied per mesh as it lands is one `await`
away from being applied to none of them (ADR-0024). The scatter tool then
planted 3 473 tufts of grass and 559 bushes into that scene, drawn as thin
instances — one mesh carrying thousands of matrices (ADR-0025).

Those two rules multiply. A mesh in the shadow map's render list is drawn once
per frame _per pass_, and a thin-instanced mesh is drawn with all of its
instances. So every tuft of grass in the village was rasterised a second time
each frame into a map where its whole shadow is about four texels: the map
covers 120 m across 2048 texels — 5.9 cm of ground each — and a tuft of the
scattered grass is 0.25 m tall.

The picture is the worse half of it. Tufts that cast shadows cast them on _each
other_, and a dense field then reads as a dark mat instead of as grass — which
is the opposite of what the scatter was for.

The obvious fix is the exclusion the rig already had, and it is wrong: it takes
the mesh out as a caster **and** as a receiver, so grass standing in the shade
of a house would be lit as though the house were not there. Grass painted on top
of the picture is a worse failure than grass that costs too much, and neither
throws, logs or fails a unit test.

## Decision

**The rig can take a mesh out of the shadow map as a caster only, and the game
does that for vegetation whose model is shorter than half a metre.**

- `LightingHandle.excludeFromCasting(meshes)` drops meshes from the shadow map's
  render-list predicate and leaves `receiveShadows` on. It sits beside the
  existing `excludeFromShadows`, which still removes both halves and is what the
  sky, the ground and the editor's grid use.
- `castsShadows(prefab)` in `apps/game/src/world-scene.ts` answers from the
  prefab's **measured bounds**, not from a list of ids: vegetation under
  `SHADOW_CASTER_MINIMUM_HEIGHT` (0.5 m) does not cast, everything else does.
  A prefab with no measured bounds casts — "we do not know how big it is" must
  not read as "it is small".
- `placeEntities` reports those meshes; `apps/game/src/main.ts` tells the rig.
  The scene builder does not reach for the light, because the app owns the rig
  (ADR-0024) and a second route to it would be a second answer to who lights the
  scene.

Half a metre comes from the two ends of the measurement rather than from taste:
the scattered grass is 0.25 m, the next thing up is a bush at 1.88 m, and
nothing in the village stands between them.

## Alternatives considered

| Alternative                                              | Why not                                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclude the grass with the existing `excludeFromShadows` | Takes the receiving half too. Grass in the shade of a house would be lit as if the house were not there — visibly wrong, and wrong in exactly the frames the shadows are for. |
| A new prefab field, decided at import like `collision`   | A real option, and a bigger one: a schema change, a pipeline change and a migration for a rule that is one number over data the catalogue already carries.                    |
| A list of prefab ids that do not cast                    | Out of date the next time the asset import runs, and silently: a renamed tuft starts casting again and nothing says so.                                                       |
| Category alone — "vegetation does not cast"              | Then the trees stop casting, and the long shadows of the reference picture are mostly trees.                                                                                  |
| Leave it: cast from everything                           | Measured, and kept honest below — the saving is real but small. The reason to do it is the dark mat, which is a picture problem the numbers do not show.                      |

## Consequences

**Positive** — a field of grass costs the shadow pass nothing, and still takes
the shade it stands in. The rule is one number over data the prefab catalogue
already measured, so it follows the art rather than a list.

**Negative** — a tuft of grass casts no shadow at all, not even the four texels
it would have earned. At a much lower sun, or with a much smaller shadow
distance, that will become visible before the threshold does.

**Measured** — village square, `?spawn=166,150`, 1280×720, Chromium on ANGLE:
excluding the grass took 3 972 242 triangles a frame down to 3 937 512 and
23.4 ms to 23.0 ms. That is 0.9 %, and smaller than expected — a tuft is about
ten triangles, so 3 473 of them are 35 000. On a 600-tuft fixture the shadow map
reports **exactly** as many casters with the field as without it, while 38.4 %
of the grass pixels are darkened by a wall beside them and none are brightened.

**Follow-ups** — the cost that does matter is the shadow pass itself: it draws
2 398 casters with no frustum culling, 2.05 M triangles against the camera
pass's 1.89 M. Narrowing the caster list was measured and rejected in ADR-0024;
what is left is cascades, or a shorter shadow distance. If vegetation ever
becomes interactive it stops being a thin instance, and this rule has to be
re-read then.
