# ADR-0022: The game loads its world from the API, and draws its entities as instances

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** Phase 4 integration

## Context

Three things existed side by side and did not meet:

- an authored world file, `content/worlds/village1.json`, with 1580 placements
  imported from a scene bundle (ADR-0021);
- a terrain format and renderer, and a village height field with its splat
  layers (ADR-0020);
- a game client that walked a capsule over a placeholder plane past three probe
  props hard-coded in `apps/game/src/environment.ts` and one probe tile
  hard-coded in `apps/game/src/terrain-probe.ts`.

Both probes were fixtures with an expiry date written into their own comments:
"this goes away when the game loads a world file". This is that step. It forces
four decisions.

**Where the world comes from.** The editor already reads and writes worlds
through `services/api` (ADR-0017). The game could instead bundle
`content/worlds/*.json` at build time, or read the files directly.

**How the game learns where a prefab's bytes are.** The prefab catalogue
(ADR-0016) maps a prefab id to an asset path, a visibility and a placeholder;
`assets/manifest.json` says the same thing and more, and the game is forbidden
to reach it (ADR-0015, enforced by `pnpm lint:boundaries`).

**How 1216 entities are drawn.** The village zone places 1216 entities from 139
distinct models: eighty copies of one fence, sixty of one plank.
`AssetContainer.instantiateModelsToScene` clones by default.

**How the client behaves when the API is not there.** A clean clone runs
`pnpm dev`, but a client built for a static host may find no API at all.

## Decision

1. **The game reads `GET /worlds/:id` and `GET /prefabs`** from the same API the
   editor uses, at `VITE_API_URL` (default `http://localhost:3000`). Both
   answers are validated with `@wov/world-schema` before anything is built.
   `?world=` names the world, defaulting to `village1`; an id that the schema's
   own character rule would reject falls back to the default rather than being
   sent on.
2. **The prefab catalogue is the game's only source for asset paths.** It never
   reads the manifest. A prefab's `visibility` and `placeholder` become the
   `AssetCatalog` the `AssetManager` is built with, so the store-or-placeholder
   rule of ADR-0015 holds for world entities exactly as it did for the probes.
3. **Entities are drawn as GPU instances.**
   `AssetManager.instantiate({ instanced: true })` passes
   `doNotInstantiate: false` to Babylon, which turns every repeated mesh into an
   `InstancedMesh` sharing geometry and material with the container's mesh.
   Instancing is opt-in, because an instance shares its material and a caller
   that wants to recolour one copy must not get one.
4. **The world has its own status line** (`data-testid="game-world"`). A client
   that cannot reach its API says which URL it tried, in the line the world
   belongs in, and keeps running on the placeholder plane.

One zone is built: the first one with a `terrain` block, falling back to the
first zone. Zone streaming and portals are a later phase.

Order matters and is asserted by the smoke test: world file, then physics, then
the tile as collision geometry, then the placeholder plane off, then the capsule
put down on the ground, then the entities. Putting the capsule down before the
ground is collidable drops it through a floor that does not exist yet.

## Alternatives considered

| Alternative                                                | Why not                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundle `content/worlds/*.json` into the game at build time | A 417 kB world file in the first chunk, and a client that can only ever show the world it was built with. The editor saves through the API; a game that reads a build artefact would show yesterday's world with no way to tell.                                      |
| Read `assets/manifest.json` in the game                    | Forbidden by ADR-0015 and by a boundary rule: the manifest is a build-time document validated with Zod schemas the game must not pull in, and the catalogue already answers the only question the game has.                                                           |
| Reuse the editor's API client                              | `apps/game` must not import `apps/editor` (spec §10). The read-only half is two calls; the shared part that mattered — the validators — is `@wov/world-schema`, which both use. A `packages/world-api` for two `fetch` calls would be a package for a package's sake. |
| Clone every entity, as Babylon does by default             | Measured: 553 draw calls against 196 for the same view of the village, for the same 1018 active meshes and 509 870 triangles. Same picture, 2.8× the calls.                                                                                                           |
| Thin instances (one buffer, no per-instance nodes)         | Cheaper still, but a thin instance is not a node: it cannot be picked, parented or given an entity id, and the editor's selection model (ADR-0018) is built on nodes. Worth revisiting for vegetation, which is scattered and never selected.                         |
| Build every zone at once                                   | Three zones, 1580 entities, of which the interiors are inside buildings nobody can enter yet. Drawing them costs memory and draw calls for something invisible.                                                                                                       |

## Consequences

**Positive.** The client shows the authored village: 1216 entities from 139
models, standing on the village height field, with the ground the player walks
on being the same triangles physics collides against. The probe fixtures are
gone, and with them the two lists of hard-coded asset paths in the game. The
editor draws the same tile, so a prop dropped on a hill in the editor is on that
hill in the game — measured, not assumed: a barrel placed in the editor at
`x=124.5, z=104` landed at `y=10.460524`, and the game's collision ground at that
point answers `10.460754`, 0.23 mm apart.

**Negative.** The game now depends on `@wov/world-schema` and therefore on Zod:
the client bundle grows from 993.66 kB / 244.60 kB gzip to 1086.24 kB /
270.34 kB gzip. That is the price of validating external data (agent rule 10)
rather than trusting a service the client does not control. A world with no API
reachable is a placeholder plane with a message, which is a worse first
impression than a bundled world would be.

Entity meshes are drawn but not collided against: only the terrain becomes
static collision geometry. The player walks through walls.

**Follow-ups.**

- Collision for entities, which needs a decision about which prefabs carry it
  (the export ships `*_collision` meshes for some buildings).
- Zone streaming, and with it a reason to build more than one zone.
- Thin instances for vegetation, once vegetation is scattered rather than
  authored one node at a time.
- Terrain editing in the editor: the tile is drawn and snapped onto, but it is
  not a document object and cannot be selected or moved.
