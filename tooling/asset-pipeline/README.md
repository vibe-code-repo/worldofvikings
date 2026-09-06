# tooling/asset-pipeline

Turns a modelling export — one GLB per model, PNG textures — into three things:
files in the **private asset store**, hull-box **placeholders** committed in
`assets/`, and **manifest entries** that record each of them (ADR-0015).

```bash
pnpm import:world-assets --source ~/assets/export --store ~/assets/store
pnpm import:world-assets --source … --store … --dry-run    # report, write nothing
```

Nothing in here is shipped code, and nothing in here runs in CI. A contributor
who never imports an asset never runs it.

## What each module does

| Module                   | Does                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `selection.ts`           | Which files are world building, what they are called, whose they are |
| `glb.ts`                 | Read, measure and rewrite binary glTF                                |
| `png.ts`                 | Decode, halve and encode PNG, to hold textures to 2048 px            |
| `placeholder.ts`         | The hull box a clone loads when the store is not reachable           |
| `import-world-assets.ts` | The command: walks the export, writes the three outputs              |

Everything except the command itself is pure and unit-tested. The command is the
only part that touches a file system, and the only part without a test — which
is why the judgements it makes live in the other four files.

## The decisions, and what they rest on

**Origins are left where their author put them.** "Normalise the origin" usually
means snapping a model to its own hull, and that is what this pipeline did until
the source was counted: 79 of 96 vegetation models and 180 of 359 environment
models place geometry _below_ `y=0` deliberately, because the origin is the
ground-contact point and roots, rock bases and post footings belong in the soil.
Snapping would have lifted every tree a metre into the air. Only terrain is
moved, and only on x/z, where all twelve height fields are authored with the
origin at a corner rather than at an authored anchor. See `originShiftFor`.

**Nothing is ever rescaled to fit.** The source
measures in metres, so a model far outside its group's plausible size is not a
unit problem — it is something that is not what its name says. Nine
`SM_Item_*` files measure 15–156 m because they were exported inside a 100×
character rig; they are excluded and named in the report rather than divided by
a guessed factor. See `sizeLimitFor`.

**The textured prefab wins a name collision.** Thirty-one models appear in both
`Mesh/` and `PrefabHierarchyObject/` under one name, and they are not the same
file: `Mesh/Tree_1A3.glb` is geometry with a single `DefaultMaterial` and no
texture, `PrefabHierarchyObject/Tree_1A3.glb` is the same tree with
`Birch_Bark_A`, `Leaves Birch 1` and both textures. `SOURCE_FOLDERS` is in
priority order for that reason.

**Textures become files instead of staying embedded.** Ten rock prefabs embed
the _same_ 4096×4096 texture — 18 MB of duplicates a browser would download and
decode ten times. Extracted and deduplicated by content hash, the whole import
needs seventeen texture files. They are also individually checkable against the
2048 px budget, which a blob inside an 11 MB GLB is not.

**Provenance is recorded, never invented.** The source collection carries no
licence, no credits and no README, so everything imported is
`license: NOASSERTION`, `redistributable: false`, `visibility: private`, with
the author recorded as unconfirmed and the licence review open. Nothing is filed
under a name that would be a guess. What the manifest _does_ state per file is
geometric: where the origin sits, and how many triangles the model has.

## Dependencies

None. Every module uses `node:` built-ins only.

That is a deliberate choice rather than an accident: the pipeline touches the
glTF _container_, not its geometry — it measures a hull, writes one node
translation, and moves embedded images into files. No vertex is recomputed.
`trimesh`, `pygltflib`, `gltf-transform` or a headless Blender would each add a
required tool for a normal contribution (agent rules 12 and 18) in exchange for
capabilities this does not use, and a re-meshing library is precisely what must
not touch a file whose provenance is being recorded. `sharp` would be the one
real candidate, for the texture resize — but it is a native binary, and what is
actually needed is 8-bit non-interlaced PNG halved by a box filter, which
`node:zlib` does most of.

The narrowness is enforced rather than assumed: compression extensions, sparse
accessors, multiple buffers, 16-bit PNG, interlacing and palettes are all
rejected by name (`assertSupported`, `decodePng`). A file this cannot handle
stops the import; it is never approximated.

## Determinism

Same input, same bytes out, same manifest. Texture file names are content
hashes, JSON is written with stable key order, PNG re-encoding uses one fixed
filter and compression level, and `generatedAt` only moves when the asset list
actually changed. Re-running over an unchanged source produces a byte-identical
`assets/manifest.json`.

## Ownership

Core maintainers. Changing what is selected, how an origin is treated or what
provenance is asserted changes what ends up in the store and what the licence
review will be looking at — all three have tests, and the reasoning above should
be updated with them.
