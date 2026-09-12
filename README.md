# World of Vikings

A browser MMORPG — Anglo-Saxons against Vikings — with a Babylon.js client and an
authoritative TypeScript server that share one deterministic world generator.

## Getting started

```bash
git clone https://github.com/vibe-code-repo/worldofvikings.git
cd worldofvikings
npm install
npm run dev
```

That's it — no credentials, no Docker, no manual token file. `npm run dev` starts the
game server, the client, and the admin (ops) service together, and takes care of two
things a fresh clone is missing on its own:

- **Models, textures and sounds** are not in this repository (see [Repository
  structure](#repository-structure)) — they ship as one versioned archive, downloaded
  automatically on first run. If no archive has been published yet, or the network is
  unreachable, `npm run dev` says so and keeps going anyway — the world still loads,
  just without 3D content. Fetch it again any time with `npm run assets:holen`, or point
  `WOV_ASSETS_URL` at a different archive.
- **The admin service's token.** In production an operator places one at
  `/etc/wov-admin.token`; here there is no operator, so the service generates its own
  and writes it to `server/data/admin.token` (outside git) on first start.

Open the client at the URL below. If a website is running in front of it (see
[Repository structure](#repository-structure) — `wov-web/`), it redirects there to sign in
and pick a character; a bare clone with no website has its own small built-in sign-in
dialog instead, so `npm run dev` alone is always enough to create an account and play.

## Local URLs

| Service | URL | What it is |
|---|---|---|
| Game client | http://localhost:5274/play/ | The Babylon.js client (`base: '/play/'`, so it also lines up with `/play/` behind the single-origin reverse proxy — see `deploy/nginx/wov-lab.conf`) |
| World editor | http://localhost:5274/play/editor.html (or `/editor/` behind the proxy) | In-game world/dungeon editor |
| World map | http://localhost:5274/play/karte.html | Rendered world overview |
| Game server | ws://localhost:2467/ws · http://localhost:2467/accounts/ | Proxied by the client dev server under `/ws` and `/accounts/`; behind the reverse proxy also reachable as `/api/accounts/` |
| Admin service | http://localhost:2468/ | Ops service (world document, console, service control); proxied under `/api/`, token-protected |
| Website (optional) | see `wov-web/` | Its own SvelteKit project — `npm install && npm run dev` inside `wov-web/` for it; not needed to play |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start game server, client and admin together (see above) |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Run the test suite (`WOV_OHNE_MODELLE=1` to run it without the asset archive, as CI does) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run build` | Production build of every workspace |
| `npm run assets:holen` | (Re-)download the asset archive into `assets/` |
| `npm run assets:bauen` | Build a new asset archive from `assets/{store,models,textures}` (operator tool, not for daily dev) |
| `npm run store:aufbereiten`, `npm run store:boden` | Derive the aggregated/staged asset folders `assets/store-lab` and `assets/generiert` from `assets/store` |
| `npm run aussehen:json` | Regenerate `assets/appearance.json` (the website's character-creator option lists) from `shared/src/aussehen.ts` |

## Repository structure

```
client/    Babylon.js client, world editor, UI
server/    authoritative game server
shared/    world generation, items, protocol — used by both sides
admin/     ops service (world document, console, service control)
tools/     asset pipeline (incl. assets-paket.mjs), measurement scripts, world map renderer
scripts/   dev/test entry points (dev.mjs, run-tests.mjs)
deploy/    systemd units, nginx config, env template — production only
Docs/      concepts and design decisions
wov-web/   the website — its own npm project in the same repository, not an npm workspace
```

`assets/` is not checked in (see `.gitignore`) — binaries don't delta-compress, so
tracking them would add well over a gigabyte a year to a history every clone carries.
`assets/manifest.json` is the one exception the tests check against; everything else
arrives through the archive described in Getting started.

## Architecture in one screen

```
 ┌───────────────┐   WebSocket (binary)   ┌────────────────────┐
 │ client         │◄──────────────────────►│ server              │
 │ Babylon.js     │   /accounts/ (HTTP)    │ authoritative state  │
 │ WebGPU/WebGL2  │◄──────────────────────►│ ZDOs, zones, physics │
 └───────┬───────┘                         └──────────┬──────────┘
         │ /api/ (HTTP, token)                         │ world doc + save game
         ▼                                              ▼
 ┌────────────────┐                          server/data/{welten,worlds}
 │ admin           │  reads/writes the same files the server uses,
 │ ops service     │  restarts the server, serves the editor's console
 └────────────────┘

              both client and server import from:
 ┌──────────────────────────────────────────────────────────────┐
 │ shared — world generation, item/recipe tables, protocol,      │
 │          appearance & equipment lists. One source for both    │
 │          sides, run through golden tests so client and server │
 │          compute bit-identical terrain.                       │
 └──────────────────────────────────────────────────────────────┘
```

The world is defined, not rolled: an in-game editor writes a *world document* (regions
as polygons/circles, each with a biome), the server compiles it into a distance field,
and Perlin detail inside each region comes from the biome's height functions —
deterministically, on both sides. The server has the final say on movement, inventory,
crafting, terraforming and loot; the client draws and asks, it never asserts.

See `Docs/` for the reasoning behind each of these pieces — why Babylon, how the world
document and dungeon generator work, what the graphics concept measures.
