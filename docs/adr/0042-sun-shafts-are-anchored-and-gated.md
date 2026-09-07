# ADR-0042: Sun shafts are anchored to a stand-in sun and gated on the view angle

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/licht`

## Context

The reference frames this project is aiming at show soft shafts of light fanning
past a tree and a smoke column when the sun is low and near the camera. Our
build has none: the author's words were "Auch gibt es Sonnenstrahlen", and there
were not.

Nothing in the renderer could have produced them. `packages/engine/src/lighting.ts`
owned exactly two post-processing objects — a `DefaultRenderingPipeline` and an
optional `SSAO2RenderingPipeline` — and the only sun in the frame was a glow term
in the sky fragment program (`pow(dot(dir, -sunDir), sharpness)` in
`sky-shader.ts`), painted on a 2 000 m box that rides with the camera. A glow on
a box that moves with the eye can never be occluded by anything, so it can never
fan out.

Babylon's `VolumetricLightScatteringPostProcess` does produce shafts, and it
works in this scene. But it is not a thing that can be switched on: three
separate pieces have to be built around it, and without any one of them the
effect is not merely disappointing but wrong.

### 1. Our sun is a direction; the effect needs a place

The profile states `sun.direction` and nothing else — there is no sun object in
the world to project onto the screen. So the rig builds one: a billboarded disc
carried by the camera at `anchorDistance` metres along the direction the light
comes from (`sunAnchorPosition` in `sun-shafts.ts`).

The distance is bounded on both sides by things already in the scene. Below the
extent of the painted backdrop the sun hangs _in front of_ the mountains instead
of setting behind them — `apps/game/src/main.ts` records the backdrop as a
1 188 m caster, and a prototype anchor at 900 m showed exactly that flaw. Above
the camera's 10 000 m far plane the anchor is clipped away and the pass renders
nothing at all. 1 400 m clears both, and those two bounds are the whole reason
`anchorDistance` is world data with a floor and a ceiling in its schema rather
than a constant in the renderer.

### 2. The anchor must be invisible to the camera and bright to the pass

Babylon renders the shaft mesh with **its own material** in the occlusion pass
(`renderingMesh === this.mesh` takes the `material.bind` branch) and with the
ordinary pipeline in the camera pass. One material serving both puts a
hard-edged second sun disc in the sky, competing with the sky shader's glow —
visible as a cream square in both prototype pictures.

So the anchor's material carries `disableColorWrite` and `disableDepthWrite`,
and the pass's own `onBeforeRender` / `onAfterRender` clear them for the
duration of the occlusion render. Babylon applies both flags in `Material._afterBind`
and restores them in `unbind()`, and the occlusion pass reaches `_afterBind`
through `material.bind`, so the same material is honestly bright in one pass and
draws nothing in the other.

The sky box goes into `excludedMeshes` for a related reason: it sets
`disableDepthWrite` on its _own_ material, but the occlusion pass binds a shared
effect for every mesh that is not the anchor, so the sky would write depth at
about 1 000 m and bury a 1 400 m anchor behind a wall. Everything else stays in
the pass — the backdrop shells and the 23 clouds are the occluders that make a
shaft read as a shaft.

One thing the diagnosis expected to need did not: the pass's clear colour. It
looked as though `scene.clearColor` (the warm horizon `#dfa974`) would wash the
whole sky, but Babylon's `_createPass` already swaps the scene to opaque black
around the render and puts it back afterwards. The code contradicted the plan
and the code was right.

### 3. Past 90° the effect does not fade out — it lies

The shaft origin comes from `Vector3.Project` of a world-space point. A
perspective divide cannot tell a point in front of the camera from its mirror
image behind it, so past 90° off the view axis the projected origin lands back
inside the frame. Measured with Babylon's own maths at 1280×720, its default
0.8 rad field of view and village1's sun direction, the normalised screen
coordinate the post-process would blur from is:

| sun off axis | screen coordinate               |
| ------------ | ------------------------------- |
| 0°           | (0.500, 0.500)                  |
| 34.8°        | (0.957, 0.628)                  |
| 90°          | (−19 182 274, 17 170 031) — w≈0 |
| 160.6°       | (0.609, 0.132) — **in frame**   |
| 180°         | (0.500, 0.500) — dead centre    |

Confirmed in pixels before this change was written: two prototype frames
containing no sun at all carried a bright cream vertical smear down the middle.

An always-on effect therefore spends a second full pass over the scene's
geometry to paint an artefact in most of the frames a third-person player sees.

## Decision

Sun shafts are a `postProcessing.sunShafts` block on the lighting profile,
**off by default**, gated on the angle between the view axis and the sun, and
switched on in `content/worlds/village1.json`.

- **The schema** (`packages/world-schema/src/lighting.ts`) gains `SunShaftsSchema`
  with real ranges, because `describeFields` turns those ranges into the editor's
  controls (ADR-0033): the three scattering fractions, `samples` 8…120,
  `passScale`/`postScale` 0.05…1 (not `Fraction`, because a pass with no pixels
  in it is a texture the shader reads nothing out of rather than a cheap
  effect), `maxAngleDegrees` 0…90, `hysteresisDegrees` 0…30, `anchorDistance`
  1 200…9 000 m and `anchorSize` in metres. The engine mirrors the shape in
  `lighting-profile.ts`, including — the trap ADR-0040 already paid for once —
  the sub-block in the merge, so `{"postProcessing": {"sunShafts": {"maxAngleDegrees": 30}}}`
  resolves rather than validating and doing nothing.
- **The gate and the anchor are arithmetic**, so they live in a Babylon-free
  `packages/engine/src/sun-shafts.ts` next to `shadow-snap.ts` and `fog.ts`:
  `sunViewAngleDegrees`, `sunShaftsGate` and `sunAnchorPosition`, with unit
  tests at 0°, 41°, 55°, 90° and 180° and across the hysteresis band.
- **55° with 5° of hysteresis.** The frame's corner sits at 40.8° off axis at
  16:9, so a sun just outside the picture still fans inwards; 55° stays well
  clear of the 90° singularity; and the band latches, so a player panning along
  the threshold cannot switch a second scene pass on and off every frame. The
  exposure ramps to zero across the band, so detaching is invisible.
- **Attaching means both halves.** `camera.attachPostProcess(effect, 0)` _and_
  pushing the pass's render target back onto `camera.customRenderTargets`.
  Detaching means both, spliced by hand: Babylon's own `dispose(camera)` splices
  `scene.customRenderTargets` while `_createPass` pushed to
  `camera.customRenderTargets`, so trusting it leaves the second scene pass
  running with nothing reading its result. Index 0 puts the shafts in the frame
  the grade then works on rather than pasted over a finished one.
- **`?shafts=off`** joins `?flat=1`, `?shadows=off` and `?shadowFocus=` as a
  diagnostic switch, and the perf views `sun`, `square-no-shafts`,
  `slope-no-shafts` and `sun-no-shafts` join `views.ts`. A gated effect makes a
  frame time depend on where the camera points, so the aim has to be written
  down rather than pasted into a shell; and a cost measured by editing the world
  file between runs would be a cost measured across two builds.

## Consequences

### What it costs, measured

Headless Chromium with ANGLE, 1280×720, world `village1`, one build, the effect
switched by query flag so no build noise can leak into the delta.

The deterministic counters, which are the same on every run:

| view     | draw calls off → on | triangles off → on  | active meshes |
| -------- | ------------------- | ------------------- | ------------- |
| `square` | 549 → **549**       | 4.09 M → **4.09 M** | 974           |
| `slope`  | 369 → 395 (+26)     | 3.75 M → 5.45 M     | 27            |
| `sun`    | 368 → 395 (+27)     | 3.72 M → 5.38 M     | 33            |

`square` is unchanged because the gate is closed there — the sun stands behind
the camera — and `pnpm perf:compare` between the two `square` runs reports
**mean |Δ| 0.0000/255, 0.00 % of 921 600 pixels changed**. Gated off, the effect
is not cheap; it is absent. That is the same result a world that never asks for
the block gets, which is why the default is `false`.

Where the gate opens, the extra pass costs **+27 draw calls and +1.7 M triangles**
in an open view. That is an order of magnitude below the +206 draw calls and
+2.05 M triangles an _ungated_ effect was measured to add in the `square` view,
and the reason is structural rather than lucky: you look at a low sun by looking
out of the village, and a view out of the village carries a tenth of the square's
active meshes. The worst case measured is not the open view but a close one —
a vantage buried in vegetation with the sun overhead came out at +141 draw calls
— so the number to watch is how many meshes are in frame when the sun is, not
the effect's own settings.

**The frame-time delta could not be resolved on the measuring machine and is not
claimed here.** Nine runs per configuration:

| view               | mean sceneRenderMs | sd   | min   | max   |
| ------------------ | ------------------ | ---- | ----- | ----- |
| `square`           | 23.99              | 3.85 | 18.79 | 29.56 |
| `square-no-shafts` | 25.41              | 5.49 | 20.16 | 36.25 |
| `slope`            | 19.74              | 4.32 | 12.84 | 28.06 |
| `slope-no-shafts`  | 19.70              | 2.86 | 15.82 | 23.54 |

A per-configuration spread of ±4 ms swamps an effect of one to three, and in
several aggregates the _on_ configuration came out cheaper than _off_, which is
not a result but a measurement of the machine: it carried a load average of 14
to 16 from work unrelated to this. The honest statement is that the counters
bound the cost and the clock did not measure it. A quiet machine should re-run
`pnpm perf:frame --view slope` and `--view slope-no-shafts` before anyone quotes
a millisecond figure.

One thing the pictures say that the counters do not: `slope` sits at **52.8°**
off axis, inside the band with the sun out of frame entirely, and what it buys
there is a whole-frame lift towards the sun side rather than a shaft. That is
the honest price of choosing 55° over the frame corner's 41° — light scattering
in the air near a sun you cannot see is real, but it is paid in geometry. It is
world data precisely so an author who disagrees can turn it down without a code
change.

### What is now true that was not

- Ratio tuning does not buy much. Dropping the occlusion pass from half to
  quarter resolution _and_ the post-process from full to half _and_ the samples
  from 100 to 40 was measured to buy 0.60 ms of a 2.52 ms ungated cost. The
  other 1.92 ms is the geometry: `_createPass` sets `renderList = null`, so the
  render target re-renders every active mesh through its own render function.
  The cost knob that matters is the gate, not `passScale`.
- The occlusion pass is a **second list with different rules** from the shadow
  map. It deliberately includes meshes ADR-0031 keeps out of the shadow map — the
  backdrop should occlude the sun even though it must not cast — so the next
  person adding an exclusion has two places to think about.
- The anchor is a real mesh in the scene and moves every frame. It is not
  pickable (the editor's surface snapping), not in the shadow map (this rig
  excludes it), not fogged, and not frozen — `freezeStaticNodes` is called on the
  zone's entity roots in `apps/game/src/main.ts` and never touches it.
- Disposing a scene that holds a detached shaft effect used to throw. Babylon's
  `Scene.dispose` walks its post-processes and calls `dispose()` with no camera;
  this effect's override then reads `camera.getScene()` on `undefined`. The rig
  takes itself down on `scene.onDisposeObservable` first, and its `dispose` is
  idempotent. This was found by a test, not in the field.
- Bundle price: +12.3 kB raw, +3.6 kB gzip for the post-process and the disc
  builder. The post-process imports its own four shader programs, so
  `side-effects.ts` needs no new entry (ADR-0006, ADR-0029).

### Editor parity (ADR-0033)

Nothing changed in `apps/editor`. `LIGHTING_FIELDS` is
`describeFields(LightingProfileSchema)` and the panel renders that list, so the
twelve new fields appear under Post Processing with the ranges and steps their
Zod bounds imply. The `evening` and `noon` presets state `sunShafts` so a preset
cannot leave a previous world's value standing.

The editor's viewport calls the same `applyLighting`, so an author turning the
gizmo drives the same gate. That is the intended behaviour — the editor should
show what the game shows — and the hysteresis is what keeps it from flickering
under a moving camera.

### What this does not fix

The reference's shafts sit alongside a muted palette and a hazed distance, both
of which landed first in this branch (ADR-0040, ADR-0041). Ordering mattered:
shafts added on top of the earlier oversaturated, high-contrast grade would have
read as a bright bloom rather than as light through air.

And `village1` has no trees. The occluders that cut into the sun are the painted
clouds and the palisade, so the fans are softer than the reference's, which are
thrown past a trunk. The picture will improve when the world does, without
another change here.

## Alternatives considered

- **Always on.** Rejected on both counts above: it pays a full geometry pass in
  every frame and paints an artefact in most of them.
- **A gate on `Vector3.Project` returning an on-screen coordinate.** That is the
  quantity the effect actually uses, and it is exactly the quantity that lies
  past 90°. The angle is the honest question.
- **Detaching with `effect.dispose(camera)` and rebuilding on re-entry.**
  Rejected: it splices the wrong array, and rebuilding a render target every time
  the player turns towards the sun trades a steady cost for a stutter.
- **A cheaper radial blur with no occlusion pass** (blurring the finished frame
  towards the sun). Rejected: with nothing occluding the source it produces the
  isotropic halo we already have from the sky glow, which is the look this change
  exists to get away from.
