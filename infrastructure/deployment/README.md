# Deployment

## Staging (wov-dev, CT 102)

The staging hosts (`*.staging.world-of-vikings.com`) are served by the
**development servers** running under systemd, behind Nginx Proxy Manager
(CT 100, TLS termination, Basic-Auth on website/game/editor).

| Host                                   | Upstream on wov-dev | Process                   |
| -------------------------------------- | ------------------- | ------------------------- |
| `www.staging.world-of-vikings.com`     | `:5172`             | `apps/website` (Vite)     |
| `live.staging.world-of-vikings.com`    | `:5173`             | `apps/game` (Vite)        |
| `editor.staging.world-of-vikings.com`  | `:5174`             | `apps/editor` (Vite)      |
| `api.staging.world-of-vikings.com`     | `:3000`             | `services/api` (tsx watch) |
| `assets.staging.world-of-vikings.com`  | `:9000`             | `tooling/scripts/asset-server.ts` |

Files:

- `staging-dev.sh` — starts the five processes with `concurrently`. Vite is
  started via `pnpm exec vite --host 0.0.0.0` (a `--host` after `pnpm run --`
  does not reach Vite) and each Vite process gets its public host through
  `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` (Vite accepts exactly one host per
  process through that variable, hence one per app).
- `systemd/wov-staging.service` — unit file; install to
  `/etc/systemd/system/`, then `systemctl enable --now wov-staging`.
- `/etc/wov-staging.env` (not in the repo, no secrets either): `API_HOST=0.0.0.0`,
  `API_CORS_ORIGINS=<the three staging origins>`, `VITE_API_URL`,
  `VITE_ASSET_URL`, `ASSET_PORT`, `NODE_ENV=development`.

Known limits (2026-09-06): the asset server binds `127.0.0.1` and is therefore
not reachable through the proxy yet; Vite HMR does not know the public port
(443), so hot reload over the proxy is not active. Both are small follow-ups in
the app configs.

Production (`live.`, `api.`, `assets.`, `www.`) has DNS records but no proxy
hosts yet — they are created when there is something to publish (spec §36).
