#!/usr/bin/env bash
# Builds the staging bundles. Run this *before* restarting wov-staging.service.
#
# Deliberately not part of the unit's start-up (see README): a build takes
# minutes and can fail on a compile error, and a service whose ExecStartPre
# fails is a service that is down. Building separately means a restart is
# seconds long and can only ever fail on something the build already proved.
#
# The VITE_* variables are baked into the bundles here, at build time. Changing
# one in /etc/wov-staging.env therefore needs a rebuild, not just a restart.
set -euo pipefail
cd "${WOV_STAGING_ROOT:-/opt/worldofvikings}"
# systemd hands the unit a bare PATH; keep whatever a shell already had so the
# same script is runnable by hand.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# The built client is measured on staging (frame counter, draw calls), so the
# debug bridge is compiled in — it still needs `?debug=1` to publish itself.
export WOV_DEBUG_BRIDGE="${WOV_DEBUG_BRIDGE:-1}"
# Nothing in a build should behave like a development build.
export NODE_ENV=production

started=$SECONDS
pnpm run build
printf 'staging build finished in %ds\n' "$((SECONDS - started))"
