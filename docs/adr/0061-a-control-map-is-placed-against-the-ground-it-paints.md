# ADR-0061: A control map is placed against the ground it paints

- **Status:** accepted. Corrects the placement
  [ADR-0043](0043-the-village-control-map-was-turned-one-flip-short.md) chose,
  and the check it installed.
- **Date:** 2026-09-08
- **Deciders:** asset-pipeline owners

## Context

Two changes landed on the same day from two branches that could not see each
other. ADR-0043 measured which of the eight ways to place a square control map
on a square tile puts the cliff channel on the cliffs, and moved the import from
the anti-diagonal mirror of ADR-0020 to a quarter turn clockwise. ADR-0059 then
found that the height field itself was read on the export's axes rather than the
world's, and turned it.

A control map has no meaning on its own. It is placed **relative to a height
field**, so turning the height field moves the answer. ADR-0043's measurement
was correct for the ground it was taken against, and stale the moment that
ground changed.

The check ADR-0043 installed did not catch this, and the way it failed is worth
recording. It measured `village-splat-b.png` against `terrain-village1.glb` —
the raster as the export wrote it, which ADR-0059 deliberately keeps in the
store on the export's own axes — rather than against
`terrain-village1-samples.glb`, the file the import now writes and the world
file names as `heightSamples`. So after the ground was turned the check went on
reporting the same number, 4.28, for a placement that was now wrong. **A check
that reads a file the product does not use is not a check; it is a second
opinion about a third thing.**

Re-measured against the ground the game actually draws, over the same rarest
channel — 0.32 % of the tile, which can only be a cliff face:

| placement            | mean gradient under the cliff channel |
| -------------------- | ------------------------------------- |
| identity             | 0.77                                  |
| mirror in x          | 0.66                                  |
| **vertical mirror**  | **4.28**                              |
| half turn            | 0.96                                  |
| transpose            | 1.05                                  |
| anti-diagonal mirror | 0.64 — what ADR-0020 named            |
| quarter turn cw      | 1.84 — what ADR-0043 named            |
| quarter turn ccw     | 0.62                                  |

The tile's own 95th percentile is 2.38. One placement clears it by nearly
double; the other seven sit at or below it.

## Decision

The import mirrors a control map vertically (`mirrorVertically`, replacing
`rotateQuarterTurn`, which nothing else used), and `pnpm validate:assets`
measures that placement against `terrain-village1-samples.glb`.

`SPLAT_ORIENTATION` and `HEIGHT_FIELD_ORIENTATION` are stated next to each other
in `terrain-import.ts` and each says that the other one moving invalidates it.

## Alternatives considered

| Alternative                                                     | Why not                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave the quarter turn; it passed the check                     | It passed because the check read the untransposed raster. Against the drawn ground it scores 1.84 against a p95 of 2.38 — it fails.                              |
| Turn the ground back and keep ADR-0043                          | The ground was not turned for the map's sake. 374 authored placements and the whole cliff ring say where the ground goes (ADR-0059); the map follows the ground. |
| Derive the map's placement from the ground's, in code           | They are two different reflections of two different export conventions. Composing them by reasoning is how this was got wrong twice. It is measured, both times. |
| Delete `terrain-village1.glb` so nothing can read it by mistake | ADR-0059 keeps it deliberately, and a prefab names it. The fix is for the check to name the right file, not for the store to hold fewer.                         |

## Consequences

**Positive** — the paint is on the ground the game draws, measured against that
ground. The check now has teeth against the very change that defeated it: the
placement it was installed to defend scores 1.84 and would fail.

**Negative** — this is the third placement shipped for one map, and the second
that looked right. Anyone reading ADR-0020, ADR-0043 and this one in order has
to read all three to know where the paint goes.

**Follow-ups**

- Every picture of the village taken before this is painted differently. That
  includes the ones in ADR-0043.
- The same class of bug is open elsewhere: a validator that reads a store path
  by name will go stale whenever the import renames what it writes. Worth a
  sweep of `validate-assets.ts` for other hard-coded store paths.
