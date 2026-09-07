#!/usr/bin/env bash
# Serves the *built* staging bundles (WOV_STAGING_MODE=build).
#
# Why built bundles: staging is a deployment, not a development machine
# (ADR-0030). The development server optimises dependencies on demand, and
# behind the reverse proxy it re-optimised mid-session: the browser ended up
# holding two copies of the renderer's core chunk, the shader registry stopped
# being a singleton, lazily registered shaders landed in the wrong copy and the
# render loop stopped on "Unable to compile effect". A built bundle has one
# copy of every module by construction. No HMR, no optimizer, no `?v=` hashes.
#
# Why `vite preview` and not a static server of our own: it is already a
# dependency, it serves each app from the same config that built it (base path,
# SPA fallback, MIME types, an ETag on every file), and it fails loudly when
# `dist/` is missing. A hand-written server would be a second implementation of
# all of that for no gain (agent rule 12: no new dependency, and no new code
# where a present one already answers).
#
# It does *not* mark the hashed `/assets/*` files immutable, whatever an earlier
# version of this comment claimed: measured on vite 7.3.6, every file including
# index.html gets `cache-control: no-cache` plus an ETag, and a reload answers
# 304 for all of them. `preview.headers` is applied by a callback that is handed
# no path, so it cannot say one thing for `/assets/*` and another for
# index.html; setting `immutable` on the hashed paths belongs in the reverse
# proxy (ADR-0052).
#
# Run `staging-build.sh` first — this script only serves.
set -euo pipefail
cd "${WOV_STAGING_ROOT:-/opt/worldofvikings}"
# systemd hands the unit a bare PATH; keep whatever a shell already had so the
# same script is runnable by hand.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

for app in website game editor; do
  if [[ ! -f "apps/$app/dist/index.html" ]]; then
    echo "apps/$app/dist is missing — run infrastructure/deployment/staging-build.sh first" >&2
    exit 69
  fi
  printf 'serving apps/%s built %s\n' "$app" "$(date -r "apps/$app/dist/index.html" -Iseconds)"
done
if [[ ! -f services/api/dist/main.js ]]; then
  echo "services/api/dist is missing — run infrastructure/deployment/staging-build.sh first" >&2
  exit 69
fi

# Ports and public host names have defaults rather than being hard-coded, so
# this same script can be run against a scratch stack (that is how it is tested
# before it reaches wov-dev) without a second copy of it existing.
website_port="${WOV_WEBSITE_PORT:-5172}"
game_port="${WOV_GAME_PORT:-5173}"
editor_port="${WOV_EDITOR_PORT:-5174}"
website_host="${WOV_WEBSITE_ALLOWED_HOST:-www.staging.world-of-vikings.com}"
game_host="${WOV_GAME_ALLOWED_HOST:-live.staging.world-of-vikings.com}"
editor_host="${WOV_EDITOR_ALLOWED_HOST:-editor.staging.world-of-vikings.com}"

# One allowed host per app: `vite preview` answers on the public name only.
# `localhost` is always allowed as well, so a health check on the box itself and
# the reverse proxy do not need two configurations.
exec pnpm exec concurrently -k -n website,game,editor,api,assets \
  "WOV_PREVIEW_ALLOWED_HOSTS=$website_host,localhost pnpm --filter @wov/website exec vite preview --host 0.0.0.0 --port $website_port --strictPort" \
  "WOV_PREVIEW_ALLOWED_HOSTS=$game_host,localhost pnpm --filter @wov/game exec vite preview --host 0.0.0.0 --port $game_port --strictPort" \
  "WOV_PREVIEW_ALLOWED_HOSTS=$editor_host,localhost pnpm --filter @wov/editor exec vite preview --host 0.0.0.0 --port $editor_port --strictPort" \
  "pnpm --filter @wov/api start" \
  "pnpm run dev:assets"
