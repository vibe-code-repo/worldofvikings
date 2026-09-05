# ADR-0008: The third-person camera lives in the engine package, with its arithmetic separated from Babylon.js

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** Core maintainers

## Context

Spec §26 asks for a third-person camera with mouse rotation, smooth follow,
zoom, collision avoidance, a configurable distance and stable behaviour
indoors. ADR-0007 deliberately left the camera out of `createBaseScene`,
because the game and the editor need different ones — which left open where the
game's camera belongs and what it is allowed to know.

Two things make this more than "add a camera to `apps/game`".

**A camera is the part of the renderer a player feels, and feel is arithmetic
over time.** The failure modes are not visual glitches that a screenshot would
show; they are properties of the numbers:

- `current += (target − current) * rate` per frame is the usual follow lag, and
  it ties the camera's feel to the frame rate: the same code lags twice as long
  at 30 FPS as at 60. Nobody sees this on the machine they wrote it on.
- Pitch clamped at exactly ±π/2 puts the forward vector on the up vector and the
  view rolls at random.
- Yaw accumulated over a session grows without bound and loses precision.
- One backgrounded tab hands back a delta of several seconds on its first frame,
  which closes every lag at once and teleports the camera.
- `WheelEvent.deltaY` is not comparable across browsers: the same notch reports
  ~100 (pixels) in one and 3 (lines) in another, so zooming straight from
  `deltaY` moves a different distance per browser.

None of that is observable through a GPU and none of it needs one.

**Collision avoidance needs physics that does not exist yet.** Havok arrives
with the physics chain (spec §29). A camera that waits for it is a camera that
cannot be finished; a camera that fakes it lies about what it does.

## Decision

The camera goes into `@wov/engine`, split across three modules:

1. **`src/third-person-camera-math.ts` — no Babylon.js, no DOM.** Yaw/pitch
   clamping and wrapping, the exponential follow lag, zoom, the orbit vector,
   the obstacle limit and one `stepThirdPersonCamera(state, input, settings)`
   that composes them. It holds no state: every function takes a state and
   answers a new one. Settings are plain data (numbers, `[x, y, z]` tuples) and
   are validated in `resolveThirdPersonCameraSettings`, like ADR-0007's base
   scene options, so they can come out of world or profile JSON later.
2. **`src/camera-input.ts` — no DOM types.** The state machine that decides
   whether a mouse movement counts: pointer lock, the held-button fallback, and
   cancelling a drag on blur. It takes plain `{ button }`,
   `{ movementX, movementY }` and `{ deltaY, deltaMode }` records.
3. **`src/third-person-camera.ts` — the binding.** Keeps the current state,
   reads the followed point through a getter, writes position and rotation onto
   a Babylon `TargetCamera` on `scene.onBeforeRenderObservable`, and wires the
   real DOM events to the state machine of (2).

**Collision avoidance is an interface with a default of "nothing".**
`CameraObstacleQuery = (probe) => number | null` answers how much of the line
from the pivot to the camera is free. The default, `noCameraObstacles`, always
answers `null`, so the camera behaves exactly as it does outdoors. The physics
chain supplies a Havok-backed query later; nothing else about the camera
changes. The behaviour on a hit is asymmetric on purpose: a wall arrives
instantly (a smoothed approach lets geometry cross the near plane for a few
frames, and the player sees through the world), everything that widens the shot
is eased.

**The camera is not gameplay.** It follows a `() => Vector3` the app supplies
and writes nothing back. In Phase 1 that getter reads a placeholder capsule; in
Phase 2 it reads the player entity, and the camera never learns which (spec
§25). `@wov/gameplay` still may not import a renderer.

**Aimed by rotation, not `setTarget`.** Yaw and pitch are what the camera
already knows; `setTarget` recomputes them from a look-at matrix and — visible
in Babylon's source — nudges `position.z` by an epsilon whenever camera and
target share a z. Setting `camera.rotation = (pitch, yaw, 0)` matches Babylon's
yaw-pitch-roll forward vector `(sin y · cos x, −sin x, cos y · cos x)` exactly.
`third-person-camera.test.ts` asserts this against the computed view matrix
rather than against the numbers that produced it.

**The near plane is lowered to 0.1 m.** Babylon's default is 1 m, which would
clip the character exactly when a wall pushes the camera close — the one moment
it must not.

## Alternatives considered

| Alternative                                               | Why not                                                                                                                                                                                                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Babylon's `ArcRotateCamera` or `FollowCamera`         | Both own their input and their easing, neither has an obstacle seam we can back with Havok, and `ArcRotateCamera`'s per-frame behaviour is untestable without a scene. It is also the heavier option — see the measurement below. |
| Put the camera in `apps/game`                             | The editor will want the same orbit behaviour for its preview, and the arithmetic above is exactly the kind of reusable logic agent rule 14 asks to have tests for.                                                               |
| Put the camera in `@wov/gameplay`                         | `@wov/gameplay` must not import a renderer (spec §25, `pnpm lint:boundaries`), and a camera is presentation, not state.                                                                                                           |
| One module with Babylon types throughout                  | Then the arithmetic is only reachable through a `Scene`, and the frame-rate and clamping properties above stop being testable in a plain Vitest run.                                                                              |
| Wait for Havok and implement collision avoidance for real | Blocks the camera on another chain. An interface with an honest default ships the other five requirements of §26 now, and the physics chain adds a query without touching the camera.                                             |
| Smooth the way in front of an obstacle as well            | The camera would spend those frames inside the wall, which is worse than a hard cut: the player sees through the world.                                                                                                           |
| Take the wheel's `deltaY` as the zoom step                | Not comparable across browsers or devices; `wheelTicks` normalises the three `deltaMode` values first.                                                                                                                            |
| Pointer lock only, no drag fallback                       | Pointer lock needs a user gesture and can be refused outright; the camera would then simply not turn, with nothing on screen saying why. The fallback is also what makes the wiring provable in `pnpm smoke`.                     |
| Update the camera from `RendererHandle.onFrame`           | That hook fires after `scene.render()`, so every pose would be shown one frame late. `onBeforeRenderObservable` is the correct side of the render.                                                                                |

## Consequences

**Positive** — the parts of the camera that are easy to get quietly wrong are
covered by 50 DOM-free tests; the physics chain gets a named seam instead of a
merge conflict; the game's camera settings are already shaped like the JSON that
will carry a player's preferences.

**Negative** — three modules instead of one, and the DOM wiring itself
(`attachControl`) has no unit test, because a structural fake of pointer lock
would prove only that the fake was called. It is covered by a `pnpm smoke` test
that drives a real wheel and a real drag over the canvas and reads back the
camera the renderer actually used; that test was confirmed to fail when
`attachControl` is not called.

**Measured** — replacing the game's `ArcRotateCamera` with this camera plus the
placeholder capsule makes the game bundle **smaller**: 1001.45 kB raw /
241.43 kB gzip before, **940.75 kB raw / 228.26 kB gzip** after
(−60.70 kB / −13.17 kB, Babylon 8.56.2, `pnpm --filter @wov/game build`).
`ArcRotateCamera` drags in the whole camera-input framework — pointers,
keyboard, mouse wheel and gamepad — while `TargetCamera` carries none of it
(spec §38).

**Follow-ups** — the physics chain implements `CameraObstacleQuery` with a Havok
shape cast (a ray through a corner is not enough; the near plane has width).
`invertY` and the sensitivities want a settings UI and persistence. The editor's
viewport can adopt the same camera for its preview mode.
