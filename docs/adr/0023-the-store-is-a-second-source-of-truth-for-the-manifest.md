# ADR-0023: The private store is a second source of truth for the asset manifest

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

`assets/manifest.json` is written by three commands over one shared private
store: `import:world-assets` (the per-model export plus the terrain step),
`import:scene-models` (models cut out of a scene bundle) and, indirectly,
`generate:prefabs`, which turns the manifest's private mesh rows into the prefab
catalogue the world file references.

Each command owned some rows and had its own idea of what to do with the rest,
and the two ideas contradicted each other:

- `import:world-assets` **deleted every private row it had not just produced**,
  on the reasoning that an asset which disappeared from the source should
  disappear from the manifest. It relied on `import:scene-models` running
  afterwards and putting its own rows back.
- `import:scene-models` **skipped any path the store already held**, on the
  reasoning that an existing file is not to be overwritten by a bundle copy. It
  found its 138 models still lying in the store, said "already there", and wrote
  nothing at all — including no manifest row.

Neither is wrong on its own. Together they lose data. Running the documented
sequence a second time against the same store measured:

|                                 | first run     | second run    |
| ------------------------------- | ------------- | ------------- |
| `assets/manifest.json`          | 1192 entries  | 1052 entries  |
| `content/prefabs/imported.json` | 577 prefabs   | 439 prefabs   |
| `content/worlds/village1.json`  | 1580 entities | 1187 entities |

A quarter of the authored village vanished — 446 placements under 140 names went
back to being "unmatched" — and nothing failed while it happened. The manifest
was internally consistent, `validate:assets` passed, and the world file was
valid. It was simply a smaller village.

The root cause is an assumption neither script stated: that the manifest alone
says what the store contains. It does not. The store is **persistent and
shared** — no importer deletes from it — so "I did not produce this row" cannot
be read as "this asset is gone".

## Decision

**The store is a second source of truth next to the manifest, and every importer
distinguishes rows it owns from rows it merely found.**

Two rules, one per side of the contradiction:

1. **An importer carries over a private row it does not own for as long as the
   store still holds that file** (`tooling/asset-pipeline/manifest-merge.ts`).
   Public rows are kept unconditionally, produced rows replace their
   predecessors, and a private row whose file has left the store is dropped and
   _named in the report_ rather than dropped silently. Pruning the store is now
   the way an asset leaves the manifest — which is a deliberate act, unlike a
   re-import.

2. **A file found in the store without a manifest row is adopted, not skipped**
   (`storeStateOf` in `tooling/asset-pipeline/scene-models.ts`). "Already there"
   splits into two answers: the manifest names it (nothing to do) or only the
   store has it (write the row back from the file that is there). The file
   itself is still never overwritten, so "it only ever adds" holds for bytes;
   what changed is that it also never _forgets_.

The two rules are deliberately redundant. Rule 1 keeps the rows alive through
the documented sequence; rule 2 repairs a manifest that lost them some other way
— a partial run, a bad merge, a hand-edited file.

An adopted row is byte-identical to the row it replaces: hash and size come from
the store file, the hull is re-measured from it, and the provenance sentence is
rebuilt from the same inputs the cut used — including the node name, which is
read back out of the texture's file name (`textureNodeStem`). A repaired
manifest is therefore indistinguishable from one that was never damaged, which
is the property that makes "import twice, compare" a meaningful test at all.

## Consequences

**Positive.** The documented import sequence is idempotent, and provably so:
running it twice leaves `assets/manifest.json`, `content/prefabs/imported.json`
and `content/worlds/village1.json` byte-identical. The second run is also much
cheaper — nothing is cut, because nothing is missing. An importer can no longer
silently shrink another importer's work, and the one remaining way for an asset
to leave the manifest is visible in the report.

**Negative.** A stale private file left in the store keeps its manifest row
alive for as long as it lies there, so store hygiene is now a real maintenance
task rather than something a re-import did as a side effect. Adoption trusts the
store file rather than verifying it against what a fresh cut would produce; a
store file corrupted in place would be adopted as it is. `validate:assets`
checks hash and size against the manifest on every run, so a divergence that
happens _after_ adoption is caught — one that happened before it is not.

**Not decided here.** Ownership is inferred from what a run produced rather than
recorded in the manifest. An explicit owner field per row would be sturdier, but
it is a manifest format change with a version bump and a migration, and the
inferred rule is enough for three importers over one store.

## How it is proved

- `tooling/asset-pipeline/manifest-merge.test.ts` — the carry-over rule, including
  the case that regressed: a private row another importer owns survives a run
  that does not produce it.
- `tooling/asset-pipeline/scene-models.test.ts` — `storeStateOf` answers `adopt`
  for a store file the manifest has forgotten, and `textureNodeStem` reads a cut
  texture's node back out of its file name.
- The measurement: the full sequence
  (`import:world-assets` → `generate:prefabs` → `import:scene-models` →
  `generate:prefabs` → `import:scene`) run twice against one store, with
  `git diff` empty after the second run.
