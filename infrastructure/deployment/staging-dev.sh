#!/usr/bin/env bash
# Runs the five development servers for the staging hosts on wov-dev.
# Vite binds all interfaces (--host) because Nginx Proxy Manager reaches it over the internal network.
set -euo pipefail
cd /opt/worldofvikings
export PATH="/usr/local/bin:/usr/bin:/bin"
exec pnpm exec concurrently -k -n packages,website,game,editor,api,assets \
  "pnpm run dev:packages" \
  "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=www.staging.world-of-vikings.com pnpm --filter @wov/website exec vite --host 0.0.0.0" \
  "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=live.staging.world-of-vikings.com pnpm --filter @wov/game exec vite --host 0.0.0.0" \
  "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=editor.staging.world-of-vikings.com pnpm --filter @wov/editor exec vite --host 0.0.0.0" \
  "pnpm --filter @wov/api dev" \
  "pnpm run dev:assets"
