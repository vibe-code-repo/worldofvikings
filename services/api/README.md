# @wov/api

Backend API (production: `api.world-of-vikings.com`). It serves `/health` and
the authored content in `CONTENT_DIR` — the editor's only way to list, open and
save worlds (ADR-0017). Rendering never needs it: the game and the editor
viewport start without a backend (spec §35).

- Dev: `pnpm --filter @wov/api dev` → http://localhost:3000/health
- Environment: `API_HOST`, `API_PORT`, `API_CORS_ORIGINS`, `LOG_LEVEL`,
  `CONTENT_DIR`, `WORLDS_READ_ONLY`, `WOV_IMPORT_DIR`, `WOV_ASSET_STORE`,
  `ASSETS_DIR` (see `.env.example`)

## Routes

| Route                            | Answer                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `GET /health`                    | `{ status, service, uptimeSeconds }`                                        |
| `GET /worlds`                    | `{ worlds: [{ id, name, zones, updatedAt }], invalid: [{ id, errors }] }`   |
| `GET /worlds/:id`                | The `WorldDefinition` — 404 unknown, 422 stored file invalid                |
| `PUT /worlds/:id`                | Validates and writes — 201 created, 200 replaced, 400 invalid, 403 locked   |
| `GET /prefabs`                   | `{ prefabs: [{ id, name, …, catalog }], catalogs, invalid }`                |
| `GET /prefabs/:catalog`          | One `PrefabCatalog` — 404 unknown, 422 stored file invalid                  |
| `PUT /prefabs/:catalog`          | Validates and writes one catalogue — same codes as a world                  |
| `POST /actions/import-scene`     | Runs the scene import; `{ report }` — 400 bad path, 501 no `WOV_IMPORT_DIR` |
| `POST /actions/generate-prefabs` | Rebuilds `prefabs/imported.json`; `{ report }`                              |

```bash
curl http://localhost:3000/worlds
curl http://localhost:3000/worlds/example
curl -X PUT http://localhost:3000/worlds/example \
  -H 'content-type: application/json' --data @content/worlds/example.json
```

Rules the routes keep (reasoning in ADR-0017):

- **Ids are the path guard.** `^[a-z0-9][a-z0-9_-]*$`, at most 64 characters,
  and the only value that ever becomes a file name. Anything else is a 400
  before the file system is touched.
- **Both directions are validated** with `parseWorldDefinition`. A broken file
  is reported (422 with the error list), never served as an empty world.
- **Writes are atomic and Prettier-formatted.** Temporary file plus rename, and
  a JSON printer whose output Prettier leaves alone, so `pnpm format:check`
  stays green and `git diff` shows only what changed. Fields are written in
  schema order, whatever order the client sent them in.
- **`WORLDS_READ_ONLY=1` makes every write a 403.** Deployments that carry
  official content set it; editor clients never publish into production data
  directly (spec §49).
- **Every read is conditional** (ADR-0052). All four `GET`s carry
  `cache-control: public, max-age=0, must-revalidate` and a weak `ETag`, and
  answer `304` with no body when the client sends it back in `If-None-Match`.
  The two single-file reads also carry a real `Last-Modified` **HTTP-date**;
  the two listings do not, because a body composed from several files has no
  single modification time. `updatedAt` stays an ISO string **in the body and
  in the listing** — that is what the client reads, and it is not a header.
  The editor's second open of the village now answers `304` for the world, the
  catalogue and the listing; before this it re-sent 1.15 MB every time.

`GET /prefabs` merges every catalogue in `CONTENT_DIR/prefabs`
(`{ schemaVersion, id, prefabs[] }`); the first definition of an id wins, and
clashes and broken catalogues are reported in `invalid`. The catalogue itself
is validated by `parsePrefabCatalog` from `@wov/world-schema` — content formats
are defined there (ADR-0004), never in a service.

**`overrides.json` is the one catalogue that may redefine a prefab** and is
applied last (ADR-0033). `content/prefabs/imported.json` is rewritten whole by
`pnpm generate:prefabs`, so a collision shape corrected in the editor cannot be
saved there — the next regeneration would revert it with no error and no diff.
The editor writes the overlay instead; everything else keeps the first-wins rule.

## Caching, and what the reverse proxy still owes

The validators are computed from the content file's size and modification time
(`src/conditional.ts`), with `CURRENT_WORLD_SCHEMA_VERSION` folded in: the
service does not send the file, it sends a representation it builds from the
parsed file, so a change in how it shapes that JSON has to invalidate caches the
file's mtime knows nothing about. The tags are **weak** — size and mtime do not
prove the bytes, and a weak tag revalidates identically (RFC 9110 §13.1.2) and
survives a proxy that compresses on the fly. The listings' tags are a hash of
the bytes about to be sent, which is the only thing that is true about an
aggregate. The comparison itself is `@wov/shared`'s, shared with the asset
server so the two cannot drift.

Hand-written rather than `@fastify/etag`: the plugin hashes the serialised body
of every response — 1.0 MB on `GET /worlds/:id`, plus the writes and the error
bodies — to produce a validator that `stat` already provides. No new dependency
was justified for it (AGENTS §7, agent rule 12).

**Responses are not compressed here.** Measured over localhost, the village
world is 1,007,111 bytes and gzips to 144,214 (`gzip -6`, 14.3 %); the merged
catalogue is 197,508 and gzips to 22,852 (11.6 %). That is worth roughly 1.04 MB
on a **first** open and nothing at all on any later one, which are empty 304s
now. The reverse proxy in front of `api.staging` already compresses the editor's
JavaScript and simply does not list `application/json`; adding the content type
there is the change, not `@fastify/compress` in this service. Note that nginx
downgrades a strong `ETag` to a weak one when it gzips — harmless here, because
the tags are weak already and the comparison ignores the `W/` prefix.

## The content actions

`POST /actions/import-scene` and `POST /actions/generate-prefabs` run
`importSceneBundle` and `generatePrefabCatalog` from `@wov/content-build` — the
same functions `pnpm import:scene` and `pnpm generate:prefabs` run, so the
editor's **World** menu and the command line cannot drift apart (ADR-0033). Both
answer the command's own report, and both answer 403 under `WORLDS_READ_ONLY`.

The import takes a _file path from a browser_, so the guard is an allow-list and
not a filter (`src/import-paths.ts`): without `WOV_IMPORT_DIR` the action
answers 501 and reads nothing; the bundle is named **relative** to that
directory; an absolute path is refused rather than joined; the resolved path
must still be inside the directory; and it must end in `.glb`. A symlink out of
the tree is not caught — `WOV_IMPORT_DIR` is a directory you control, not a
shared drop box. The catalogue action takes no path at all.

**Why Fastify** (and not Hono/Express): the API will later own accounts, save
synchronisation and published world versions. Fastify gives schema-based
validation, a structured logger and `app.inject()` for tests without opening a
port — all in the core package, so those needs do not each add a dependency.
Hono is smaller but is optimised for edge runtimes we do not target; Express
would need extra packages for logging, validation and typing. See ADR-0005.

Dependencies: `fastify`, `@fastify/cors` (the three dev apps run on their own
origins), `@wov/world-schema` (the world and prefab formats are defined once, ADR-0004),
`@wov/shared` (the conditional-request helpers the asset server uses too, so the
`ETag` comparison exists once — ADR-0052), `tsx` (TypeScript dev runner),
`typescript`. Dev-only
`prettier`: the JSON printer's test asserts against the real formatter instead
of against a hand-written expectation.
