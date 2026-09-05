# CLAUDE.md

Read **[`AGENTS.md`](AGENTS.md)** first. It is the contract for this repository:
folder responsibilities, commands, Definition of Done, the 20 development rules
and the hard prohibitions. This file only adds Claude-specific notes.

## Commit rule

English Conventional Commit subject and body, then a one-line German summary,
then the co-author trailer:

```text
feat(editor): add transform gizmo for the selected entity

DE: Verschiebe-Gizmo für die ausgewählte Entität im Editor ergänzt.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

Commit in small steps, one reviewable change each. Never commit to `main`
directly and never commit generated output.

## Before you say it works

Run `pnpm check`, and `pnpm smoke` for anything visible. `pnpm smoke` needs
`npx playwright install chromium` once per machine. If you did not run it, say
so.

## Repository configuration

- `.claude/launch.json` — preview configurations for website, game, editor and API.
- `.claude/settings.json` — pre-approved non-interactive `pnpm` commands.
