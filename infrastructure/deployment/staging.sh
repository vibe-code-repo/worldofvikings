#!/usr/bin/env bash
# Entry point of `wov-staging.service`: picks how staging serves itself.
#
#   WOV_STAGING_MODE=build  serve the built bundles (the default on wov-dev)
#   WOV_STAGING_MODE=dev    run the five development servers (the old behaviour)
#
# The default is `dev` so a checkout that has never been built still starts.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${WOV_STAGING_MODE:-dev}"
case "$mode" in
  build) exec "$here/staging-serve.sh" ;;
  dev) exec "$here/staging-dev.sh" ;;
  *)
    echo "WOV_STAGING_MODE must be 'build' or 'dev', got: $mode" >&2
    exit 64
    ;;
esac
