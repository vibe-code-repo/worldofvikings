# ADR-0019: Material bindings and shared texture files in the asset store

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

The world assets imported under ADR-0015 arrive without their materials. 388 of
the 437 models in the store carry a single material named `DefaultMaterial` with
no texture on it, because the per-model part of the export writes geometry and
drops the material assignment. The 49 that do have one came from the authored
prefab folder, which keeps it.

The assignment is not lost, it is in a different file. The export also contains
thirteen **scene bundles** — the assembled levels — and in those the same models
appear with their materials and with the atlases embedded. So the question is
not "where do we get textures" but "how do we get the binding from the scene
bundle back onto the model file", and then "how does the model refer to a
texture that thirty other models also use".

Three constraints shape the answer.

**The bundles are 1.3 GB.** Reading them as files, or with a mesh library, costs
more time and memory than the whole import. Only the JSON chunk and a few image
ranges are needed.

**The scene instance and the store copy are not the same mesh tree.** The store
copy of `Tree_1A3 1` is one primitive of 2564 vertices; the scene instance is
two, of 2564 (`Birch_Bark_A`) and 14852 (`Leaves Birch 1`). Pairing primitives
by position would put leaves on a trunk.

**The export dropped the material settings as well as the assignment.** All 58
material names arrive as `alphaMode: "OPAQUE"`, `doubleSided: false`, with no
factors at all — so leaves come back as solid cards, glass as stone, and every
material renders as rough metal, because the glTF default for `metallicFactor`
is 1 and nothing overrides it.

## Decision

The importer gains a step, **material bindings from scene bundles**, which runs
once before any model is written:

1. Every scene bundle is opened, and only its JSON chunk is parsed. Images are
   read by seeking to their buffer range.
2. A scene node is matched to a store model by name, through an ordered list of
   candidate rewrites (`scene-names.ts`).
3. For each matched model, a material is recorded **per vertex count**, not per
   primitive index. The vertex count is what survives both export paths
   unchanged, so a store primitive of 2564 vertices takes the material the
   scenes give to 2564-vertex primitives of that model.
4. Each bound material's base colour becomes a **file** in the model group's own
   `textures/` folder, named `<model>-<slot>-<hash8>.png` after the first model
   that uses it, deduplicated by content hash, and halved until it fits the
   2048 px budget.
5. The model's GLB gets a material per bound name with
   `pbrMetallicRoughness.baseColorTexture` pointing at `images[].uri:
"textures/<file>.png"`, plus `metallicFactor: 0` and `roughnessFactor: 1`.
6. Which materials are cut out, double-sided or self-lit comes from a **checked
   table** (`materials.ts`), listing all 58 materials the export uses, not from
   a pattern over names. The table is keyed by `materialKey(name)` — twelve hex
   characters of SHA-256 — and each row says in plain words what the material
   is. The source names carry vendor and product wording this repository does
   not repeat, and a digest keeps the table complete and reviewable without
   writing any of them down. `material-key.ts` prints the key for a new one.

A material that already references a texture is never overwritten: that is
authored data. Only the metalness of such a material is corrected.

**The texture URI must not contain `..`.** Babylon.js rejects any image URI
containing `..` in `GLTFLoader._ValidateUri` before it requests anything, so
`environment/rock.glb` cannot point at `../textures/atlas.png` — however correct
that is by the glTF specification. It points at `textures/atlas.png` instead,
and the textures live one level down, per group.

## Alternatives considered

| Alternative                                                           | Why not                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the textures embedded in each GLB                                | Thirty models share one 4 MB atlas: the browser would download and decode it thirty times, and an embedded blob cannot be size-checked against the budget on its own.                  |
| One shared `store/textures/` folder, referenced with `../`            | The GLB is then spec-correct and unloadable: Babylon refuses the URI, falls back to the placeholder or draws grey, and no error names the cause. This is the bug this ADR is fixing.   |
| One shared folder, with the asset server aliasing it under each group | Keeps one copy, but makes the model correct only behind our own server: the store directory alone would no longer resolve, and the routing rule would be invisible from the GLB.       |
| Pair scene primitives with store primitives by index                  | Measured: 280 models bind, 45 mismatch outright, and the mismatches are trees whose trunk would take the leaf atlas. Vertex counts bind 309 with nothing partially bound.              |
| Derive the surface from the material name with a regular expression   | A guess that spreads silently to every future name. A table fails by omission, loudly, and the importer prints what it could not answer.                                               |
| Key the surface table by the source material name                     | The names carry vendor and product wording that does not belong in this repository. A digest plus a description keeps every decision reviewable and the wording out.                   |
| Use a glTF library or Blender for the rewrite                         | Agent rules 12 and 18: a required tool for a normal contribution, in exchange for capabilities this step does not use. The container edit is a few hundred lines of `node:` built-ins. |

## Consequences

**Positive.** 328 of the 437 models now carry a base colour: 49 that kept their
own material, 279 bound from a scene bundle. Textures are 27 files instead of
hundreds of embedded copies, each individually hashed in the manifest and
checkable against the size budget. Foliage is alpha-cut and double-sided, so
leaves read as leaves; nothing renders as metal. The surface table is a document
a person can review row by row, each row saying what its material covers.

**Negative.** A texture used by two groups is stored twice — measured at zero
extra bytes for this export, because no atlas crosses a group, but the rule
allows it. Binding by vertex count is a heuristic, even a measured one: two
distinct sub-meshes of one model with the same vertex count and different
materials would resolve to whichever the scenes use more often, and the importer
does not currently name those. Store paths changed, so the manifest's texture
entries are new rows rather than edited ones.

Two things stay wrong because the export does not contain them, and the report
says so rather than guessing: the leaf and grass atlases are luminance masks
whose green lived in a material tint the export dropped, so foliage
renders grey; and 109 models appear in no scene bundle — 102 that no level
placed, 4 whose scene material has no texture, and 3 collision meshes with no
UVs — so they keep an untextured `DefaultMaterial`.

**Follow-ups.** Recover or author the foliage tint. Decide what to do with the
109 untextured models: bind them from a hand-written table, drop them, or accept
grey. If a future export shares an atlas across groups, revisit whether the
asset server should serve one copy under both prefixes.

## How it is proved

`pnpm smoke` with `WOV_ASSET_STORE` set runs `tooling/smoke/textures.spec.ts`,
which opens the editor on a world of three private models — a building, a rock
and an alpha-leaved bush — and takes three witnesses, because each alone can
lie:

1. every `…/textures/*.png` request answered `200` with `access-control-allow-origin: *`;
2. the _scene_ reports the texture files it finished loading, read off the
   materials of the instantiated meshes — a request that arrives is not a
   texture that got bound;
3. the framed building's pixels are brown: 46% of its lit pixels are coloured
   with the texture against 3.5% without it. Brightness does not separate the
   two (77 against 95) and is reported rather than asserted.

Witness 2 is why `SceneSync.loadedTextures()` and the editor debug bridge's
`loadedTextures` exist. The first version of this change passed every other
check — models loaded, `loadedCount` reached 3, the status line said
`0 placeholder` — while every model on screen was grey.

The test skips itself when no store is configured, so a clean clone still runs
the rest of the suite.
