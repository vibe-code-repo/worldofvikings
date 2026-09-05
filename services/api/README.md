# @wov/api

Backend API (production: `api.world-of-vikings.com`). Phase 0 exposes `/health`
only — the game and the editor must stay usable without a backend (spec §35).

- Dev: `pnpm --filter @wov/api dev` → http://localhost:3000/health
- Environment: `API_HOST`, `API_PORT`, `API_CORS_ORIGINS`, `LOG_LEVEL` (see `.env.example`)

**Why Fastify** (and not Hono/Express): the API will later own accounts, save
synchronisation and published world versions. Fastify gives schema-based
validation, a structured logger and `app.inject()` for tests without opening a
port — all in the core package, so those needs do not each add a dependency.
Hono is smaller but is optimised for edge runtimes we do not target; Express
would need extra packages for logging, validation and typing. See ADR-0005.

Dependencies: `fastify`, `@fastify/cors` (the three dev apps run on their own
origins), `tsx` (TypeScript dev runner), `typescript`.
