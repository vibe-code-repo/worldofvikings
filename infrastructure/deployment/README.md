# Deployment

## Staging (wov-dev, CT 102)

The staging hosts (`*.staging.world-of-vikings.com`) run under systemd behind
Nginx Proxy Manager (CT 100, TLS termination, Basic-Auth on website/game/editor).

`WOV_STAGING_MODE` in `/etc/wov-staging.env` decides what they serve:

| Mode              | What runs                                                   | Used on                                                 |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `build`           | the **built bundles** (`vite preview`, `node dist/main.js`) | wov-dev                                                 |
| `dev` _(default)_ | the five development servers                                | nothing today; kept so an unbuilt checkout still starts |

Staging serves built bundles because it is a deployment, not a development
machine — see [ADR-0030](../../docs/adr/0030-staging-serves-built-bundles.md)
for the failure that forced the change (the dev server's dependency optimiser
re-ran mid-session, the browser ended up with two copies of Babylon's
`ShaderStore`, and the render loop stopped on `Unable to compile effect`).

| Host                                  | Upstream on wov-dev | Process in `build` mode                |
| ------------------------------------- | ------------------- | -------------------------------------- |
| `www.staging.world-of-vikings.com`    | `:5172`             | `apps/website/dist` via `vite preview` |
| `live.staging.world-of-vikings.com`   | `:5173`             | `apps/game/dist` via `vite preview`    |
| `editor.staging.world-of-vikings.com` | `:5174`             | `apps/editor/dist` via `vite preview`  |
| `api.staging.world-of-vikings.com`    | `:3000`             | `services/api` — `node dist/main.js`   |
| `assets.staging.world-of-vikings.com` | `:9000`             | `tooling/scripts/asset-server.ts`      |

### Deploying a new revision

Building and starting are two steps on purpose: a build takes minutes and can
fail, and a service whose start-up build fails is a service that is down.

```bash
cd /opt/worldofvikings
git fetch … && git checkout --detach FETCH_HEAD
pnpm install
infrastructure/deployment/staging-build.sh   # ~13 s on wov-dev; must succeed
systemctl restart wov-staging.service        # seconds; only serves
systemctl is-active wov-staging.service
journalctl -u wov-staging.service -n 50 --no-pager
```

`systemctl restart` alone serves whatever was built last. `staging-serve.sh`
refuses to start when an app's `dist/` is missing and logs each bundle's build
time, so a stale deployment says so instead of looking fine.

> **`VITE_*` variables are baked in at build time.** `VITE_API_URL`,
> `VITE_ASSET_URL` and `VITE_GAME_URL` become string literals inside the
> bundles. Changing one in `/etc/wov-staging.env` needs a **rebuild**, not just
> a restart. `API_*`, `ASSET_*` and `WOV_ASSET_STORE` are read at run time and a
> restart is enough for those.

### Files

- `staging.sh` — the unit's `ExecStart`; dispatches on `WOV_STAGING_MODE`.
- `staging-build.sh` — builds the workspace with `WOV_DEBUG_BRIDGE=1` (see
  below) and prints how long it took.
- `staging-serve.sh` — serves the built bundles. Each `vite preview` gets its
  public host name through `WOV_PREVIEW_ALLOWED_HOSTS` (comma-separated; the
  dev server's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` takes only one).
- `staging-dev.sh` — the old development-server mode, unchanged.
- `systemd/wov-staging.service` — install to `/etc/systemd/system/`, then
  `systemctl enable --now wov-staging`.

### `/etc/wov-staging.env` (not in the repo, no secrets)

```ini
WOV_STAGING_MODE=build
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=3000
API_CORS_ORIGINS=https://www.staging.world-of-vikings.com,https://live.staging.world-of-vikings.com,https://editor.staging.world-of-vikings.com
VITE_API_URL=https://api.staging.world-of-vikings.com
VITE_ASSET_URL=https://assets.staging.world-of-vikings.com
VITE_GAME_URL=https://live.staging.world-of-vikings.com
ASSET_HOST=0.0.0.0
ASSET_PORT=9000
WOV_ASSET_STORE=/opt/wov-assets/store
```

`VITE_HMR_CLIENT_PORT` is only meaningful in `dev` mode — a built bundle has no
HMR client.

### Measuring staging

The built client publishes `window.__wov` only when it was **built** with
`WOV_DEBUG_BRIDGE=1` (which `staging-build.sh` does) **and** the page is opened
with `?debug=1`:

```
https://live.staging.world-of-vikings.com/?world=village1&spawn=166,150&debug=1
```

A default `pnpm build` sets neither and ships no bridge at all — ADR-0030 has
the reasoning and the check (`grep -r __wov apps/game/dist/`).

Production (`live.`, `api.`, `assets.`, `www.`) has DNS records but no proxy
hosts yet — they are created when there is something to publish (spec §36).
