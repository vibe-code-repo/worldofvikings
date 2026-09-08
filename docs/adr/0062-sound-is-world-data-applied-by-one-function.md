# ADR-0062: Sound is world data, applied by one function both clients call

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** `feat/ton`

## Context

ADR-0065 gave the project an audio engine: one `AudioSystem` per page, four
buses, a clip cache, a listener and an explicit autoplay state. It deliberately
stopped there. It knows how to play a clip; it does not know that this village
has eleven braziers, that the ground beside the forge is gravel, or that the
evening is a wind bed with crows in it.

Those are authored facts, and agent rule 9 says authored facts live in
`content/`, not in TypeScript. The same argument ADR-0024 made for light applies
to sound without a word changed: a village at dusk and a cellar under it should
differ by two blocks in one file, not by an `if` in a renderer.

There is also a second client. `apps/editor` draws the same scene out of the
same `@wov/engine`, and ADR-0033 says anything a script can do the editor must
be able to do too. Sound has a harder version of that rule than light does: an
author placing a brazier must be able to _hear_ it where they put it, and the
only way that is ever true is if the editor's viewport calls the same function
the game calls, rather than a second implementation that agrees for a while.

## Decision

**A `sound` profile is world data, on the world and on the zone, resolved with
defaults in one place, and applied to a scene by one function.**

Three pieces, mirroring lighting exactly:

1. `SoundProfileSchema` in `@wov/world-schema` — every group and every field
   optional, on the world and on the zone. `CURRENT_WORLD_SCHEMA_VERSION` goes
   4 → 5 with a `v4ToV5` migration that adds nothing: a v4 file names no clips,
   so it is a v5 file that is silent, which is exactly how it sounded.
2. `resolveSoundProfile` in `packages/engine/src/sound-profile.ts` — Babylon-free
   and Zod-free, structurally identical to the schema's types, so
   `resolveSoundProfile(world.sound, zone.sound)` on a parsed file needs no
   conversion. Zone beats world group by group, field by field.
3. `applyWorldSound(scene, options)` in `packages/engine/src/sound.ts` — the
   audio twin of `applyLighting`. It attaches the listener, starts the bed,
   places the emitters, schedules the one-shots, culls what is too far to hear,
   and returns a handle carrying `footstep()`, `setMuted()` and `dispose()`.

### The shape of an emitter

An emitter carries **exactly one of `prefab`, `entity` or `position`**, and the
three are three different questions:

- `prefab` is a _rule_: every entity of the zone placed from that prefab sounds.
  Eleven braziers are one line, and a twelfth dropped into the square in the
  editor is audible without anyone touching the sound block.
- `entity` is one named placement.
- `position` is a sound with no object behind it — crows over a hill.

Emitters are a **list on the sound block**, not a field on the entity. The
village has 5273 entities of which seventeen make a noise, so a field on the
entity would be 5273 places to look for seventeen answers; and an emitter has
fields — an interval, a radius, a bus — that have nothing to do with a
transform. A `prefab` rule is capped by `maxCount` (64 by default) and the cap
is _reported_, because a rule that quietly matched four hundred tufts of grass
would be four hundred panners and no error anywhere.

### What merges and what replaces

Groups merge field by field. The two lists — `emitters` and the footstep `banks`
— replace whole. There is no honest merge of two lists: matching by id would
make a zone that states one emitter inherit sixteen it never mentioned, and
appending would leave a zone unable to take one away. A zone that states
emitters states all of them, and `"emitters": []` is how a zone says "none".

### Whose ears these are

**The listener follows the camera, not the player.** In third person the picture
is the camera's. A listener at the capsule's feet puts a brazier that is on the
left of the screen into the right ear as soon as the camera swings round, which
reads as a broken panner rather than as a decision. The editor attaches the same
way to its orbit camera, so an author hears the scene from where they are
looking.

**Footsteps are not spatialised at all.** They come from the listener's own feet.
Spatialising them at the capsule is the same mistake in the other direction: it
puts your own steps behind you whenever the camera orbits.

### Pacing footsteps by ground, not by time

`advanceStride` counts **metres covered**, not seconds elapsed, with a
`minInterval` floor underneath. A clock that ticks in time keeps playing while
the player stands against a wall, plays at the same rate walking and sprinting,
and speeds up on a downhill. The floor is there for the collision solver: a move
that is refused and slid along a face (ADR-0038) can cover ground in bursts, and
without a floor that is a machine-gun. The defaults are set against the movement
tuning this game actually has — 1.1 m at 4.5 m/s is about four steps a second,
1.5 m at 7.2 m/s about five — so the floor never becomes the rhythm.

### Nothing in `side-effects.ts`, and nothing awaited

ADR-0065 already recorded why AudioV2 adds no side-effect import. This ADR adds
the ordering rule: **the audio engine starts next to the physics backend and is
never awaited by the loop, and the zone's clips are loaded after
`placeEntities`.** The village streams hundreds of megabytes of models before
the player can move; a megabyte of audio must not be in that queue. A zone whose
sound has not arrived is silent, never stalled.

## Consequences

**Measured, on this machine, with the private store mounted, `--view square`.**

_Bytes on the wire._ The village loads 182.4 MB without sound and 183.5 MB with
it: **+1.11 MB, 0.6 %**. That is 465 KB of clips — the bed, two emitter loops
and 28 footstep clips, all the profile preloads — plus 618 KB the splat probe
pays to re-download the two splat maps (see ADR-0063; the design expected an
HTTP-cache hit and the development asset server sends no cache headers, which is
a deployment question and not one this repository should answer by caching a
file an importer rewrites).

_Load time._ Time to a complete village: **10.5 s with sound, 10.8 s without** —
the same within the run-to-run spread. The audio path runs from 1.0 s _after_
the village is complete to 7.0 s after it, entirely behind everything the player
is waiting for.

_Frame cost._ Eight paired runs of `pnpm perf:frame --view square`, alternating
`?mute=1`:

|                   | sound on  | sound off (`?mute=1`) |
| ----------------- | --------- | --------------------- |
| mean scene.render | 17.74 ms  | 18.59 ms              |
| median            | 17.49 ms  | 17.59 ms              |
| standard dev.     | 2.86 ms   | 4.23 ms               |
| draw calls        | 549       | 549                   |
| active meshes     | 974       | 974                   |
| triangles         | 4 093 763 | 4 093 763             |

**The frame cost is effectively zero, and the rig cannot resolve better than
about ±4 ms here.** The mean difference is _negative_ — the runs with sound were
the marginally faster group — which is the clearest possible statement that what
is being measured is the machine and not the feature. The counters are identical
to the triangle, which is the part that is not noise: sound adds no draw call,
no mesh and no pass. What it does add per frame is nothing at all — the listener
updates at 30 Hz inside Babylon, each panner at 20 Hz, the distance cull twice a
second, and the surface probe is asked once per footstep, roughly four times a
second.

**What this buys.** A zone's sound is a block in its world file. A world with no
sound block loads, validates and is silent. `pnpm validate:content` checks that
every clip is in the manifest, that every surface named has a bank, that every
emitter points at something that exists, and that `layerSurfaces` is as long as
the terrain has layers.

**What it costs.** `layerSurfaces` is an array parallel to `terrain.layers`
rather than a `surface` field on the layer. The natural home is the layer, and a
later change should move it there; it lives here because the `terrain` block was
owned by another change this round, and because it is defensible on its own
terms — which _sound_ a painted rock makes is a sound decision, not a
ground-material one. The validator's length check is what keeps the two from
drifting silently in the meantime.

**Editor parity, and the half of it a schema cannot give you.** The engine
function is the shared one by construction and `SoundProfileSchema` is
schema-drawn like every other panel's fields, so the **Sound** tab is a scope
pair and one `SchemaFields` — every clip field arrives as a picker filtered to
audio because the schema says `assetPathOf('audio')`, and a field added to the
format appears in the editor with nothing in `apps/editor` changing.

Two things did need deciding.

_An emitter is placed from the entity, not from the list._ The format keeps
emitters on the zone because 5273 entities of which seventeen sound would be
5273 places to look — but an author meets them the other way round, selecting a
brazier and asking what it sounds like. `entity-sound.ts` in `@wov/editor-core`
is that join: it finds the emitter that sounds a selected entity, says whether
it **names** the entity or merely **matches its prefab** (and how many
placements a rule would change, so quietening one brazier cannot silence ten
without saying so), and writes a new one as a single patch over the whole
`emitters` list — which is what makes one undo take the whole block back out.
The three anchor fields are not offered there, and not because the panel lists
them: the schema marks them `emitterAnchor` through `turnedBy`, the same
mechanism that keeps the terrain block one panel with two commands.

_Listening is a view setting, and it is off._ An editor that starts a forge loop
the moment a world opens is an editor nobody keeps open, and the browser would
refuse to start one before a gesture anyway. The **Listen** switch lives in the
shell rather than in the viewport so that a renderer restart cannot silently
turn it off under an author who asked for it, and the audio engine itself is a
module-level singleton, because an audio context is a per-page resource and
React mounts the viewport twice in development. Nothing is written to the world
file: muting a forge you are working next to must not change what a player
hears. The zone's sound is rebuilt on the world id, the zone id and the two
`sound` blocks — never on the document, which is replaced on every gizmo drag.

**What the panel caught.** `services/api/src/world-file.ts` writes a world file
by naming keys, and it had never been told about `sound`. Opening the village
and pressing Ctrl+S wrote it back silent — no error, no warning, a diff
removing a block nobody had touched. It is fixed by reading the key order off
the sound schemas rather than listing them, the same bargain `canonicalTerrain`
already makes, so the next field the format grows survives a round trip without
anybody remembering that file. It is worth recording that no unit test found
this and no amount of schema work would have: it took saving through the panel
and reading the file back.
