# ADR-0030: Staging serves built bundles, not a development server

- **Status:** accepted
- **Date:** 2026-09-06
- **Deciders:** deployment and game-client owners

## Context

`*.staging.world-of-vikings.com` ran the five **development** servers under
systemd behind Nginx Proxy Manager. The game client stopped there a few frames
into the village with

```text
Unable to compile effect … fragment: rgbdDecode
```

— the failure ADR-0029 is about. ADR-0029 removed its cause on a developer's
machine by giving every Babylon module one import specifier, and no local run
has reproduced it since (Chromium with and without a GPU, cold and warm cache).
Staging still failed after that fix.

The mechanism was visible in what staging served. Vite's dependency optimiser
stamps every pre-bundled module's internal imports with the **current** browser
hash; on staging the served modules carried `?v=9c17f69d` while
`node_modules/.vite/deps/_metadata.json` reported `browserHash 8bf254f8`, and
the server log carried the optimiser's "page reload" notices. Two URLs that
differ only in `?v=` are two ES modules, so the browser held two copies of the
chunk that defines `ShaderStore`; the shaders Babylon imports lazily
(`rgbdDecode`, `bloomMerge`, `fxaa`, `extractHighlights`, `kernelBlur`)
registered themselves in one copy and were looked up in the other, Babylon fell
back to fetching `src/Shaders/*.fx` over XHR, and the dev server answered every
unknown path with `index.html`.

Chasing which late discovery re-triggered the optimiser on that host is the
wrong question. A development server is allowed to re-optimise while a page is
live — that is what it is for. Staging is not a development machine: nobody
edits files on it, nothing needs hot reload, and its whole purpose is to show
what a visitor will get.

## Decision

**Staging serves the built bundles. The development server is a local tool.**

- `WOV_STAGING_MODE` picks the mode. `build` serves; `dev` runs the five
  development servers exactly as before and stays the **default**, so a
  checkout that has never been built still starts. wov-dev sets `build`.
- Building and serving are two commands, not one.
  `infrastructure/deployment/staging-build.sh` builds (about 13 s for the whole
  workspace on a developer machine); `staging-serve.sh` only serves, and
  refuses to start when a `dist/` is missing. A build inside the unit's
  start-up would make `systemctl restart` minutes long and would leave the
  service **down** on a compile error; keeping them apart means a restart can
  only fail on something the build already proved.
- The three apps are served with `vite preview --host 0.0.0.0 --port … --strictPort`
  on the ports they already had (5172/5173/5174), the API with
  `node dist/main.js` (`pnpm --filter @wov/api start`), and the asset server
  unchanged. `vite preview` rather than a static server of our own: it is
  already a dependency and it serves each app from the config that built it —
  base path, SPA fallback, MIME types, hashed-asset caching — where a
  hand-written server would be a second implementation of all of it (rule 12).
- The public host name reaches the preview server through
  `WOV_PREVIEW_ALLOWED_HOSTS` (comma-separated) in each app's `vite.config.ts`,
  the same shape as `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` does for the dev
  server, minus its one-host-per-process limit.
- **`VITE_*` variables are baked in at build time.** Changing `VITE_API_URL` or
  `VITE_ASSET_URL` in `/etc/wov-staging.env` now needs a rebuild, not just a
  restart. This is the one behaviour a reader would otherwise get wrong.

## The debug bridge in a built bundle

A deployment nobody can measure is a deployment nobody can prove is working —
and the witnesses staging has to produce are the ones ADR-0029's smoke test
uses: a climbing frame counter, `render.drawCalls`, collision `ready`. Those
live on `window.__wov`, which until now existed only in a development build.

The gate is now two conditions, both deliberate:

```ts
if (import.meta.env.DEV || (__WOV_DEBUG_BRIDGE__ && isDebugRequested(location.search)))
```

`__WOV_DEBUG_BRIDGE__` is a Vite `define`, set only by a build started with
`WOV_DEBUG_BRIDGE=1`. It is a `define` and not `import.meta.env.VITE_…` on
purpose: Rollup has to see a literal `false` to fold the branch and drop
`dev-debug.ts` from the bundle. `pnpm build` without the variable still leaves
nothing behind — `grep -r __wov apps/game/dist/` finds nothing, measured. With
the flag, the bundle carries the bridge but publishes it only for a visitor who
asked with `?debug=1`, so a staging URL handed to someone does not come with a
handle into the running client attached.

## Alternatives considered

- **Pin the dev server's dependency cache on staging** (`optimizeDeps.include`,
  or a pre-warmed `.vite/deps`). Treats the symptom, freezes a module list that
  goes stale on the next import move, and still leaves staging showing
  something no visitor will ever be served.
- **A small static file server written here.** No new dependency either way,
  because `vite preview` is already installed; this one would only add code to
  own.
- **Build in `ExecStartPre`.** One command to run, at the price of a restart
  that takes minutes and can leave the host with nothing serving.
- **Publish the debug bridge unconditionally in a built bundle.** Simpler, and
  it would put a handle into the client's internals into the eventual public
  build. The build flag costs one variable.
- **Measure staging through `data-testid` status lines and pixels only.** It
  proves the picture but not the loop: the status line says `collision: ready`
  on a client whose render loop has since stopped, which is exactly the failure
  this ADR is about.
