# AGENTS.md — working rules for this repository

This file is the contract for every session that works on this repository, human
or agent. Read it before the first edit. If a direct instruction from a human
contradicts this file, the human wins — and this file gets corrected in the same
session.

`CLAUDE.md` is a pointer to this file. `AGENTS.md` is read by more tools (Codex,
Cursor, Copilot, Claude Code) than `CLAUDE.md` is, so **new rules belong here,
not there**.

## 1. Start here

- **Look before you write.** Several sessions work on this repository in parallel
  and they commit rarely. Run `git status` and check the modification time of
  every file you are about to touch. Overwriting someone else's uncommitted work
  is final.
- **One task, one worktree, one branch, one pull request.** Never work in the
  main checkout. See section 3.
- **`npm ci`, never `npm install`.** `npm install` rewrites `package-lock.json`,
  and that file has exactly one writer at a time (section 3).
- **Expect no assets.** `assets/` is deliberately not in the repository. Fetch
  the asset package with `npm run assets:holen` when the task needs it; the test
  runner copes without it (`WOV_OHNE_MODELLE=1`, section 5).

## 2. Language: English

New source code, identifiers, comments and documentation IN THE REPOSITORY are
written in English. The repository is public on GitHub and English is the
language there.

**The legacy is German and stays German.** Identifiers such as `figurKnoten` or
`ueberaufloesung`, the German comments and `Docs/` predate the rule. It applies
from 2026-08-23 and NOT retroactively — translating what exists would be a
project of its own. When you add lines to a German file, follow the style around
you instead of converting half the file.

**English means everything we write** — not only comments: identifiers, CSS
class names, i18n keys, file names, test data and invented example names. On
2026-08-24 this was caught in a test character called `ReckeWeb39108`: the
English term is `character`, and what holds for source code also holds for the
name a test script makes up.

The **game vocabulary of visible texts** is not affected. On the German side
player characters are still "Recken", the map "Die Karte" and the forum "Das
Thing" — that is the translation, not the code. Only the key above it is
English. Project terms without a sensible translation stay as they are: file
names, the `__vb` hooks, `wov-web`, the roadmap identifiers.

## 3. Parallel work: one task, one worktree, one branch, one pull request

Several agents work on this repository at the same time. The rules below exist
so that they cannot overwrite or duplicate each other.

- **Worktree.** One worktree per task, never two sessions in one checkout.
  On the build host (`wov-bau`) they live in `/opt/wov-worktrees/<slug>`;
  anywhere else `../wov-<slug>` next to the main checkout is fine. Delete the
  worktree once its pull request is merged.
- **Branch.** New branches are named `agent/<agent>/<topic>`, for example
  `agent/codex/seidraven-body-variants`. The older `codex/*`, `perf/*` and
  `fix/*` branches keep their names; the `agent/` prefix is there so that agent
  work is recognisable in `git branch`.
- **Pull request early.** A branch without a pull request is invisible work. Do
  not let a branch outlive its task: a pull request nobody has touched for three
  days is either finished or closed. At most three open branches and one open
  pull request per agent at a time.
- **Paths are the unit of ownership, not files.** Write down the paths your task
  touches in the pull request body before you start. Two tasks must not claim
  the same path; if they do, one of them waits.
- **Hot files have one writer at a time:** `package.json`, `package-lock.json`,
  `.github/**`, `AGENTS.md`, `CLAUDE.md`, `tsconfig.json`, `eslint.config.mjs`
  and the shared tables `shared/src/*Data.json`. Announce the change in the task
  list before touching one of them. If `package-lock.json` conflicts, do not
  merge it by hand — regenerate it with `npm install` in your branch and commit
  the result.
- **The leading task list lives outside this repository.** `Docs/06-Roadmap.md`
  is history, not a work list. Take your task from the external list and name
  its identifier in the pull request body.

## 4. Commit messages: English, with a German translation below

```
Editor: one click places ONE island -- the shape tool ends after it

Why ... (the reasoning, not a list of the diff)

--- Deutsche Übersetzung ---

Editor: Ein Klick setzt EINE Insel -- Formen-Werkzeug endet danach

Warum ... (die Begruendung)
```

The first line is the ENGLISH subject — that is what `git log --oneline` shows.

**Why German as well:** the commit texts of this project are unusually detailed
and carry the reasoning; they are documentation, not a label. They should stay
readable in German too.

**Style:** name the effect, not the file. "Editor: one click places ONE island"
beats "update SpawnPanel.ts". The body carries the REASONING — why this way and
not the other, what was measured, what remains open. References to roadmap
identifiers (`F17`, `G7`, `Review 11/12/27`) belong there where they exist.

The same holds for pull requests: say what changed and why, and name the paths
you touched.

## 5. Checks: what "done" means

Run these in your worktree before you open the pull request:

```bash
npm ci                 # once per worktree
npm run typecheck      # shared, server, client, admin
npm run lint
npm test               # the runner; CI runs it with WOV_OHNE_MODELLE=1
npm run build
```

"I ran it on my machine" is not a check — the CI job on the pull request is the
arbiter, and a pull request is merged only when it is green.

Playwright based measurements (`tools/pw-*`) are deliberately NOT part of CI:
they run locally against the `:5274` tunnel, because no Chromium starts in a
plain runner container. If your task depends on one of them, say so in the pull
request and give the measured numbers.

## 6. Line endings: do not flatten them

Many files still carry **CRLF** from the original Windows import. Python's
`pathlib.read_text()` silently turns CRLF into LF while reading and
`write_text()` writes LF back. A script over many files therefore produces a
diff over the WHOLE file without meaning to. Read and write binary
(`read_bytes`/`write_bytes`) or use `open(..., newline='')`.

Counter-check: if `git diff --shortstat` reports a multiple of the line count
you expected, it is the line endings.

A `.gitattributes` marks binary files and generated artefacts. A global
`* text=auto eol=lf` is deliberately NOT set yet: it would renormalize every
legacy CRLF file at once and invalidate every branch that is open at that
moment. That change is announced separately; until then the rule above is the
law.

## 7. Where changes are built, and how they reach production

Changes are built and tested on `wov-dev` (CT 102, SSH alias `wov-bau`). They
reach `wov-live` only by `git pull` or `tools/wov-update.sh`. Never work
directly on `wov-live`.

`main` on GitHub is the source of truth for the code. Work is delivered as a
pull request against `main`; a `wov-dev` checkout and every worktree are
workbenches of that same repository, not a second truth. The old path — push
into the `wov-bau` checkout and pull from there — is a historical shortcut and is
being retired.

## 8. The website lives in `wov-web/`

Its own npm project inside the same repository, **deliberately not a workspace**
— otherwise `npm ci` at the root would pull SvelteKit and Vite onto every
container, including the pure game server. It brings its own `node_modules` and
its own lockfile. It is deployed with `wov-web/tools/ausrollen.sh`.
