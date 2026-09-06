# @wov/api

Backend API (production: `api.world-of-vikings.com`). It serves `/health` and
the authored content in `CONTENT_DIR` — the editor's only way to list, open and
save worlds (ADR-0017). Rendering never needs it: the game and the editor
viewport start without a backend (spec §35).

- Dev: `pnpm --filter @wov/api dev` → http://localhost:3000/health
- Environment: `API_HOST`, `API_PORT`, `API_CORS_ORIGINS`, `LOG_LEVEL`,
  `CONTENT_DIR`, `WORLDS_READ_ONLY` (see `.env.example`)

## Routes

| Route             | Answer                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| `GET /health`     | `{ status, service, uptimeSeconds }`                                      |
| `GET /worlds`     | `{ worlds: [{ id, name, zones, updatedAt }], invalid: [{ id, errors }] }` |
| `GET /worlds/:id` | The `WorldDefinition` — 404 unknown, 422 stored file invalid              |
| `PUT /worlds/:id` | Validates and writes — 201 created, 200 replaced, 400 invalid, 403 locked |
| `GET /prefabs`    | `{ prefabs: [{ id, name, …, catalog }], catalogs, invalid }`              |

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

`GET /prefabs` merges every catalogue in `CONTENT_DIR/prefabs`
(`{ schemaVersion, id, prefabs[] }`); the first definition of an id wins, and
clashes and broken catalogues are reported in `invalid`. The catalogue itself
is validated by `parsePrefabCatalog` from `@wov/world-schema` — content formats
are defined there (ADR-0004), never in a service.

**Why Fastify** (and not Hono/Express): the API will later own accounts, save
synchronisation and published world versions. Fastify gives schema-based
validation, a structured logger and `app.inject()` for tests without opening a
port — all in the core package, so those needs do not each add a dependency.
Hono is smaller but is optimised for edge runtimes we do not target; Express
would need extra packages for logging, validation and typing. See ADR-0005.

Dependencies: `fastify`, `@fastify/cors` (the three dev apps run on their own
origins), `@wov/world-schema` (the world and prefab formats are defined once, ADR-0004),
`tsx` (TypeScript dev runner), `typescript`. Dev-only
`prettier`: the JSON printer's test asserts against the real formatter instead
of against a hand-written expectation.
