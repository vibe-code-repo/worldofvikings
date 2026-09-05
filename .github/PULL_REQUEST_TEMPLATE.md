## What and why

<!-- One paragraph: what changes and what problem it solves. Link the issue. -->

Closes #

## How to test

<!-- Exact commands and, for visual changes, what to look at and where. -->

```bash
pnpm check
pnpm build
```

## Checklist (spec §41)

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes (including architecture boundaries)
- [ ] `pnpm test` passes
- [ ] `pnpm smoke` passes, or this change is not visible
- [ ] No generated files committed (`dist/`, `node_modules/`, `playwright-report/`)
- [ ] Architecture changes documented in an ADR under `docs/adr/`
- [ ] New dependencies justified in the package README or an ADR
- [ ] Package README still describes reality (purpose, public API, dependencies)
- [ ] New assets have a row in `docs/asset-licenses.md`
- [ ] No secrets committed

## Screenshots / video

<!-- Required for visual editor or game changes. -->

## Notes for reviewers

<!-- Trade-offs, things you are unsure about, follow-ups you deliberately left out. -->
