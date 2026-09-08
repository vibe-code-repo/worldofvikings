# ADR-0065: Sound has one owner in the engine, and an explicit autoplay state

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** project maintainers

## Context

Babylon 8.56 ships **two** audio APIs side by side. The legacy one
(`@babylonjs/core/Audio/…`, `new Sound(name, url, scene)`) needs
`audioSceneComponent.js` as a side effect and ties every sound to a `Scene`.
The newer one (`@babylonjs/core/AudioV2/…`) is a standalone engine with its own
listener and a bus graph, created by an explicit factory call. Picking one is
not a detail: whichever this project builds on decides what the game, the
editor and every later phase are written against.

There is also a fact about browsers that is easy to treat as an error and is
not. No browser will start an `AudioContext` before the page has been
interacted with. A client that reports that as a failure shows the user
something they cannot act on; a client that ignores it shows them silence with
no explanation. And the browser's own signal is not enough to tell them apart:
the audio context reads `suspended` both when the page has never been clicked
and when playback was interrupted afterwards, and the right thing to show
differs — "click anywhere" is correct for the first and useless for the second.

Finally, the light rig set a precedent worth keeping (ADR-0024): one function,
called by both clients, out of the same data. Sound has the same problem — an
author who places an emitter and cannot hear it has been shown half a scene.

## Decision

### 1. AudioV2, and one module that owns it

`packages/engine/src/audio.ts` is the only module that imports
`@babylonjs/core/AudioV2/…`, the way `lighting.ts` is the only module that
creates a light. It owns the engine, the four buses (`ambience`, `world`, `ui`,
`music`), the listener, the per-URL clip cache and the autoplay state. It does
not own which sounds a world has or where they stand — that is world data, and
it arrives in a later step.

AudioV2 rather than the legacy engine because it is a page-level thing rather
than a scene member, which is what a browser's single `AudioContext` actually
is, and because it is the half of the API that still exists in Babylon 9.

**The engine is a handle, not a scene mutation.** `createAudioEngine` returns an
`AudioSystem`; it does not write into a `Scene`. A caller creates it once, next
to the physics backend, and never awaits it in the frame loop — the rule the
world file and the Havok WASM already follow: a clip that has not arrived
delays sound, not walking.

**The listener follows the camera, not the player.** In third person the
picture is the camera's. A listener at the capsule's feet puts a brazier that is
on screen to your left into your right ear as soon as the camera swings round,
which reads as a bug in the panning rather than as a decision about whose ears
these are.

### 2. Nothing is added to `side-effects.ts`

That file's rule 1 is "only add an import that measurably changes behaviour".
AudioV2 registers nothing on `Scene` and patches no prototype: it is created by
an explicit factory call, and `webAudioEngine.js` pulls its own sub-nodes in
through the create path. An entry there would be pure bundle weight of the kind
the `meshBuilder.js` note already argues against. Recorded here because "we
looked and there was nothing to add" and "we forgot" are indistinguishable
afterwards.

### 3. Autoplay is a state machine with memory

`audio-unlock.ts` is a pure reducer over six statuses — `starting`, `blocked`,
`unlocked`, `interrupted`, `unavailable`, `closed` — carrying one extra fact:
**whether a user gesture has ever reached the page**. That fact is what
separates `blocked` from `interrupted` when the browser reports `suspended` for
both, and it is why this is a machine rather than a mapping from one enum to
another.

Two rules fall out of it and are tested:

- **A gesture never announces success.** It records that the autoplay policy is
  satisfied; the status moves to `unlocked` only when the engine says it is
  running. `resumeAsync()` inside a gesture handler can still fail, and a client
  that printed "sound: on" on the click would be lying about something audible.
- **`unavailable` and `closed` are terminal.** An engine that could not be
  created does not become available because a later poll says `suspended`.

The engine's state is **polled** (250 ms) rather than observed. Babylon's
`stateChangedObservable` lives on `_WebAudioEngine` and is marked `@internal`;
reaching for it would tie this module to a private surface for the sake of a
property read that costs nothing.

A browser that will not give audio at all is reported as
`AudioUnavailableError` with the original cause attached, not thrown past: a
game without sound is a game, a game that refuses to start is not.

### 4. The falloff arithmetic is duplicated on purpose

`audio-falloff.ts` restates the three Web Audio distance models. The browser
already applies them, so this is not needed to _make_ a sound quieter — it is
the only way to **ask about** one. A distance cull needs the radius at which a
source has faded into the bed, and that number lives in the audio thread.
`audibleRadius` inverts each model analytically, and a test pins the inversion
against the curve it came from, so the two cannot drift.

The threshold is 2 % of full gain (about −34 dB) and not zero, because two of
the three curves are asymptotic and "where does it end" has no answer without
one. Where a curve never falls that far — a rolloff of zero, a `linear` floor of
`1 - rolloffFactor` — the answer is `Infinity`, which is honest: a caller
culling on it will never cull, and the sound really is still there.

## Alternatives considered

| Alternative                                                  | Why not                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The legacy `Audio/` engine                                   | Ties sounds to a `Scene`, needs a side-effect import, and is the half that goes away. The editor and the game share one listener, not one scene. |
| Two statuses, `unlocked` and `blocked`                       | Cannot express "clicked, and still no sound", which is the case a prompt does nothing for. The whole cost of six statuses is four extra strings. |
| Report `unlocked` on the gesture                             | `resumeAsync()` can fail. The status is about something the user can hear.                                                                       |
| Use `_WebAudioEngine.stateChangedObservable`                 | `@internal`. A 250 ms property read is cheaper than a dependency on a private surface.                                                           |
| Let callers read the falloff back off `sound.spatial`        | Measured: it lies. See below.                                                                                                                    |
| Put the audio engine on the `Scene`, next to `applyLighting` | An `AudioContext` is a page, not a scene, and the editor swaps scenes without wanting to rebuild the audio graph.                                |

## Consequences

**Positive** — one place creates sound, as one place creates light. The four
buses exist empty from the start, so music and UI later are an `outBus`
argument rather than a re-plumbing. An app can put one honest line on screen.

**Positive** — the two halves that can be reasoned about are pure and tested in
Node: the falloff arithmetic and the autoplay machine.

**Negative, and measured rather than reasoned about** — Babylon's public
`sound.spatial` is a **mirror**: its fields are initialised from
`_SpatialAudioDefaults` and never re-read from the panner sub-node. Verified in
a real browser: a sound created with `spatialDistanceModel: 'inverse'`,
`spatialMinDistance: 1.5`, `spatialRolloffFactor: 1.6` has a sub-node reading
exactly those values — so the sound is correct — while `sound.spatial` reports
`linear / 1 / 1`. `playAt` therefore writes the resolved falloff through the
mirror once after creating the sound. Without that, anything later asking a
sound how far it carries gets a number that has nothing to do with what is
audible, and a distance cull would use it.

**Negative** — `audibleRadius` duplicates arithmetic the browser owns. If a
future specification changes a curve, this drifts silently. Accepted: the models
have been stable since 2013, and the alternative is a cull with no number.

**Negative** — a headless smoke run has no audio device. Assertions there must
be on engine state and clip counts, never on anything audible.

**Follow-ups** — the world-data schema for sound and the function both clients
call with it (ADR-0062), the footstep surface probe (ADR-0063), and the editor
panel that makes an emitter audible where it is placed. A mixer UI, occlusion,
reverb zones and a per-player volume preference are deliberately not here.
