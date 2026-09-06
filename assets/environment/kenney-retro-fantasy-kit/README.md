# Kenney — Retro Fantasy Kit (2.0)

Third-party assets, vendored unmodified. This folder is the whole provenance
record for them; the summary row is in `docs/asset-licenses.md`.

| Field        | Value                                                            |
| ------------ | ---------------------------------------------------------------- |
| Source       | https://kenney.nl/assets/retro-fantasy-kit (kit version 2.0)     |
| Author       | Kenney (www.kenney.nl)                                           |
| License      | CC0 1.0 Universal (public domain dedication)                     |
| License text | https://creativecommons.org/publicdomain/zero/1.0/               |
| Usage rights | Personal, educational and commercial use; redistribution allowed |
| Modified     | No — the files are byte-identical copies from the downloaded kit |

Attribution is not required by CC0. Kenney asks to be credited anyway, and this
project does: here, in `docs/asset-licenses.md` and in `THIRD_PARTY_NOTICES.md`.

## Files

| File                  | What it is                                      |
| --------------------- | ----------------------------------------------- |
| `detail-barrel.glb`   | Small barrel prop, 160 vertices, unlit material |
| `Textures/barrel.png` | 64×64 texture atlas the GLB references          |

## Why the `Textures/` folder keeps its name

`detail-barrel.glb` does not embed its texture; it references
`Textures/barrel.png` as a **relative URI**, which the loader resolves against
the GLB's own URL. Renaming or moving the folder would mean editing the GLB —
so the kit's layout is kept exactly, the files stay unmodified, and the license
question stays trivial to answer. The smoke test asserts that neither file 404s.

## Scale

The kit is authored at roughly a third of a metre per unit: the barrel is 0.30
units tall. Whatever places it scales it up — a world file does so through the
prefab's `defaultScale`.

## Adding more of the kit

Copy the file (and any texture it references) out of the downloaded kit without
changing it, add a row above, and run `pnpm validate:assets --write`.
