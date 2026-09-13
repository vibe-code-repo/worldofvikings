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

### Try it without registering

Every instance started from this repository's `server/data/server.yml` also creates two
standard accounts on first start: **user `gast`, password `gast`** (character `Gast`) and
**user `guest`, password `guest`** (character `Guest`). There are two because the website
is bilingual — its German sign-in page names `gast`, the English one `guest`, so nobody
has to type the other language's word. Sign in with either one directly — on the built-in
dialog or on `wov-web`'s `/anmelden` page, which shows this same hint whenever the server
it talks to reports the accounts (`GET /accounts/status`, never the passwords themselves).

They are created once, the same way a real registration is (same password hashing, same
account database), and an existing password is never overwritten — so changing the
block below only affects an instance that has not started yet. Neither is ever an
admin account: the module that creates them does not know the admin list exists, and
`players.everyone-admin` — the one switch that would have made them admins anyway — is
`false`.

Operators running a real, public instance should disable this before anyone else finds
the well-known passwords in this public repository — either remove the block from
`server/data/server.yml`:

```yaml
standard-konto:
  - name: gast
    passwort: gast
    charakter: Gast
  - name: guest
    passwort: guest
    charakter: Guest
```

or change each `passwort` to something private. There is no separate on/off switch. A
single block without the list dashes still works and means exactly one account.

### The admin account

The same block has a third entry, and this one *is* an admin:

```yaml
  - name: admin
    passwort: admin
    charakter: Admin
    admin: true
```

`admin: true` puts that account's characters on the server's persistent admin list at
every start — which is what lets them fly, teleport, spawn items and grant admin rights
to others (`admin add <PlayerName>`). It exists because `everyone-admin` is `false`: a
fresh installation would otherwise have no admin at all, and no way to appoint one.
This is the **initial state** of a clone; on a laptop that is exactly the point.

**On anything reachable from the internet, change the password first.** Not here — this
file and `server.yml` are both in the repository, so a password written into them is a
published password, and `git pull` would overwrite it on the next update anyway. Use the
environment instead, alongside the other per-instance settings in `/etc/wov.env`:

```sh
WOV_ADMINKONTO_PASSWORT=<your own>
```

Set it **before the first server start**: an account that already exists keeps its
stored password, so a variable added later changes nothing. The server prints a boxed
warning on every start for as long as the account is still on the published default.
[`docs/server-setup.md`](docs/server-setup.md) §5a has the details — including what to
do if you started the server first and set the variable second.

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
| `npm run assets:bauen` | Build a new asset archive from `assets/{store,models,textures,sprites,vfx,audio,dungeon2}` (operator tool, not for daily dev) |
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

## Running a server

The steps above are for local development. To run your own game server and website
on a machine you control — systemd units, the single-origin nginx config, backups,
updates — see [`docs/server-setup.md`](docs/server-setup.md).

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
