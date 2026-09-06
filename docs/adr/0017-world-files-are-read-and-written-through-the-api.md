# ADR-0017: World files are read and written through the API

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** project maintainers

## Context

Phase 3/4 gives the editor a world document: it has to list the worlds in
`content/worlds/`, open one, and save it back (spec §16, §51). A browser cannot
touch the file system, so something has to stand between the editor and the
repository.

Constraints:

- World data lives in `content/`, never in TypeScript, and everything that
  reads it validates it through `@wov/world-schema` (agent rules 9-10,
  ADR-0004).
- A saved world stays a reviewable file in git. `pnpm format:check` runs over
  `content/`, so a file the editor writes must be byte-identical to what
  Prettier would write, or every save produces a formatting diff.
- The game and the editor must keep working without a backend for rendering
  (spec §35), and local development must need no credentials (agent rule 19).
- "Never allow arbitrary editor clients to directly publish to official
  production data" (spec §49).

## Decision

`services/api` owns file access to authored content and exposes it as four
routes over a configurable `CONTENT_DIR` (default: the `content/` folder of the
checkout):

| Route             | Does                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| `GET /worlds`     | Lists `{ id, name, zones, updatedAt }`, plus the files that failed validation |
| `GET /worlds/:id` | Returns the validated `WorldDefinition` (404 missing, 422 stored file broken) |
| `PUT /worlds/:id` | Validates the body, then writes atomically (400 invalid, 403 read-only)       |
| `GET /prefabs`    | Merges every catalogue in `CONTENT_DIR/prefabs`                               |

Four rules make this safe enough to point at a working copy:

1. **Ids are the path guard.** A world id must match `^[a-z0-9][a-z0-9_-]*$`
   (the schema's own identifier rule) and is the only thing that ever becomes a
   file name, so `../`, an absolute path or an encoded slash is a 400 before any
   file system call.
2. **Validation on both sides of the disk.** The body is parsed with
   `parseWorldDefinition` before it is written, and the file is parsed again
   when it is read. A broken file is a 422 with the error list, never a silent
   empty world.
3. **Atomic writes, Prettier formatting.** The file is written to a temporary
   file in the same folder and renamed, so a crash leaves the old world intact;
   the text is produced by a JSON printer that reproduces Prettier's output, so
   `pnpm format:check` stays green (`json-format.ts`, verified against Prettier
   in its test).
4. **`WORLDS_READ_ONLY=1` turns every write into 403.** A deployment that
   serves official content sets it; only a local checkout accepts writes. This
   is the mechanical form of spec §49 — editor clients never publish into
   production data directly, they produce a change that goes through review.

`GET /prefabs` keeps a small catalogue schema (`schemaVersion`, `id`,
`prefabs[]`) inside the API for now, with a `TODO` pointing at
`parsePrefabCatalog` in `@wov/world-schema`. Prefab entries are validated
loosely (`id` and `name` required, other fields passed through) so the API
never becomes the place that defines a content format.

## Alternatives considered

| Alternative                                        | Why not                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| File System Access API in the browser              | Needs a user gesture per session, is Chromium-only, and leaves no server-side validation — the editor could write a world the game cannot load.    |
| A Vite dev-server plugin in `apps/editor`          | Would put content writing into the editor bundle's dev tooling, where the game and CI cannot reach it, and would not exist in any deployed editor. |
| Download/upload of world JSON                      | Works without a service but loses the file identity: every save becomes `example (3).json` in the download folder, and diffs become manual work.   |
| Writing with `JSON.stringify(world, null, 2)`      | Breaks `[24.3, 1.2, -56.4]` across four lines, so `pnpm format:check` fails or the repository formatting rule has to be weakened.                  |
| Git-level protection instead of `WORLDS_READ_ONLY` | Protects the repository, not the running service: a staging API pointed at a checkout would still rewrite files on every editor request.           |

## Consequences

**Positive** — the editor gets one place to list, open and save worlds; every
write is schema-checked; saved files stay reviewable, formatted and diff-clean;
pointing the service at a scratch directory (`CONTENT_DIR`) makes the whole
surface testable with `app.inject()`.

**Negative** — the editor now needs the API running to open or save a world
(rendering still does not); the API depends on `@wov/world-schema` and Zod; and
the repository owns a Prettier-compatible JSON printer, which has to keep up if
the Prettier configuration changes. Its test compares against real Prettier
output, so that failure is loud.

**Follow-ups** — replace the local prefab catalogue schema with
`@wov/world-schema`'s once it exists; add `pnpm validate:content` coverage for
`content/prefabs/`; add authentication and the draft → review → publish pipeline
before any deployment accepts writes (spec §36, §49, Phase 11).
