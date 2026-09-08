# ADR-0064: Audio is an asset kind, held in the private store behind one silent placeholder

- **Status:** accepted
- **Date:** 2026-09-07
- **Deciders:** project maintainers

## Context

The game has no sound. Adding it starts with a question that is not about
sound at all: **what is an audio file, as far as this repository is concerned?**

The manifest already answers that question for everything else. Every file the
game may download is one row with a `kind`, a size, a hash and five provenance
fields, and `pnpm validate:assets` refuses a row that cannot say where its bytes
came from (spec §46, ADR-0015). Audio had no place in that vocabulary:
`ASSET_KINDS` was `mesh | prefab | terrain | texture`, and the manifest's own
test used `kind: 'audio'` as its example of a kind that must be rejected.

That was not merely a gap, it was an inconsistency the pipeline had already
half-crossed. `isIndexedAssetFile('audio/wind.ogg')` returns `true` — a `.ogg`
under `assets/` was already something the validator expected the manifest to
describe, while the schema had no `kind` it could be described with. The
development asset server likewise already declared `audio/ogg` and `audio/mpeg`
content types for files nothing could list.

The clips themselves are a third-party set whose redistribution rights are not
settled, like the environment and vegetation sets before them. They cannot go
into `assets/`.

## Decision

### 1. `audio` is a fifth asset kind, and not geometry

`ASSET_KINDS` becomes `mesh | prefab | terrain | texture | audio`.
`GEOMETRY_KINDS` is deliberately **not** widened: a sound has a falloff radius in
metres, but that radius belongs to the emitter that plays it in world data, not
to the file. An audio row carrying `bounds` is still refused, with the same
message a texture gets.

`AssetKindHint` in `@wov/world-schema` gains `'audio'` in the same commit — the
two lists are duplicated on purpose (that package may not depend on the asset
system) and the duplication is only safe while they move together. A world-data
field annotated `assetPathOf('audio')` then arrives in the editor as an asset
picker filtered to the clips, with nothing in `apps/editor` changing (ADR-0033).

### 2. Where the answer "is this a sound?" lives

One exported list, `AUDIO_EXTENSIONS`, plus `isAudioAssetPath`. Four places need
that answer and each fails differently when it disagrees:

| Place                            | What a disagreement does                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| the manifest's v1 → v2 migration | a `.ogg` migrated as `mesh` becomes something the prefab catalogue offers as placeable                                 |
| the asset server's content types | a clip served as `application/octet-stream` — which most browsers still decode, so it fails only behind a strict proxy |
| the importer                     | a source file silently skipped                                                                                         |
| anything reading a world file    | a clip path treated as a model path                                                                                    |

The server's audio content types are typed as a **total record** over
`AUDIO_EXTENSIONS`, so adding a format and forgetting the header is a compile
error rather than a header nobody reads.

### 3. The clips live in the private store, with one shared silent placeholder

Every imported clip is `visibility: private`, `redistributable: false`,
`license: NOASSERTION`, recorded exactly the way the environment and vegetation
sets are recorded. The repository gets **one** stand-in for all of them:
`assets/placeholders/audio/silence.wav`: a 44-byte RIFF header followed by
0.1 s of zeroes at 48 kHz, 16-bit, mono — 9 644 bytes, comfortably under the
20 KB this repository accepts for a binary. A tenth of a second is enough
because nothing loops it: it stands in so that a load succeeds, not so that a
brazier hums.

ADR-0015 applies to audio, but at the **texture's** granularity, not the mesh's.
A mesh placeholder must have the right hull, which is why each mesh gets its own
box; 47 texture rows already share one `placeholders/textures/unavailable.png`
because an image has no hull to get wrong. A sound has none either: silence of
any length stands in for any clip. So all audio rows share one file.

WAV and not Ogg, because a valid silent WAV is a 44-byte header followed by
zeroes, which the importer emits with no encoder linked into the repository.

## Alternatives considered

| Alternative                                              | Why not                                                                                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Treat clips as `texture` rows with a different extension | The manifest's job is to make claims checkable. "It is an image" is a false claim, and the prefab catalogue's `PLACEABLE_KINDS` would be the only thing keeping a sound out of the placement list — by accident. |
| No placeholder for audio at all                          | A clean clone would then 404 on 44 rows, and `validate:assets` would have to learn an exception. Silence costs 9 KB once and keeps the rule "a private asset has a placeholder" without a special case.          |
| One silent placeholder **per clip**                      | 44 identical files. The mesh rule exists because hulls differ; nothing differs here.                                                                                                                             |
| Put the clips in `assets/`                               | Their redistribution rights are unsettled. That is what the store is for.                                                                                                                                        |
| Give audio rows `bounds` for their falloff radius        | The radius is a decision about a placement, not a fact about a file. Two emitters using one clip want different radii.                                                                                           |

## Consequences

**Positive** — a clip is a manifest row like everything else: hashed, budgeted,
and unable to exist without a licence statement. The editor gets an audio asset
picker for free the day a world-data field asks for one. A clean clone plays
silence instead of throwing.

**Negative** — an older checkout reading a manifest that contains audio rows
rejects it, because its `AssetKindSchema` has no such member. This is judged
**not** a manifest version bump: the manifest is regenerated by the importers
and makes no compatibility promise to older builds, unlike world files, which
carry a `schemaVersion` precisely because they are authored by hand and read by
many versions. Stated here rather than decided in passing.

**Negative** — the placeholder is silence, so a clone without store access
cannot tell "the store is not mounted" from "this emitter is meant to be quiet".
The asset counter already reports how many placeholders were substituted; the
sound module reports its own count separately for the same reason.

**Follow-ups** — the world-data schema for sound, the engine module that plays
it, and the footstep surface probe are separate decisions
(ADR-0062, ADR-0063, ADR-0065).
