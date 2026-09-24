# AGENTS.md — working rules for this repository

This file is the contract for every session that works on this repository, human
or agent. Read it before the first edit. If a direct instruction from a human
contradicts this file, the human wins — and this file gets corrected in the same
session.

`CLAUDE.md` is a pointer to this file. `AGENTS.md` is read by more tools (Codex,
Cursor, Copilot, Claude Code) than `CLAUDE.md` is, so **new rules belong here,
not there**.

## 1. Start here

- **One session, one worktree, one branch, one pull request.** Several sessions
  work on this repository at the same time. Never work in the main checkout and
  never in another session's worktree. Section 3 is the recipe.
- **Look before you write.** Run `git status` before your first edit. A file you
  did not change yourself that shows up as modified means you are in the wrong
  directory — stop, do not "clean it up".
- **`npm ci`, never `npm install`.** `npm install` rewrites `package-lock.json`,
  and that file has exactly one writer at a time (section 3).
- **Expect no assets.** `assets/` is deliberately not in the repository, and the
  asset package is deliberately not published yet: `npm run assets:holen` ends
  in a 404, and that is not a bug to fix. When a task needs assets, copy them
  from the DEV deployment (section 3.2); the test runner copes without them
  (`WOV_OHNE_MODELLE=1`, section 5).

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

## 3. Parallel work: one session, one worktree, one branch, one pull request

Several sessions — humans and agents, often several at once — work on
this repository at the same time. Git worktrees make that safe: every worktree
is its own directory with its own checked-out branch and its own index, while
all of them share one object store. A session edits, builds and commits in its
worktree and never sees the half-finished files of another. The rules below keep
it that way.

### 3.1 Layout on the build host (`wov-bau`)

| Path | What it is | Who writes there |
|---|---|---|
| `/opt/worldofvikings` | the DEV deployment. It follows `main` by fast-forward only | nobody edits; only the rollout runs `git merge --ff-only origin/main` |
| `/opt/wov-worktrees/<slug>` | one worktree per task | exactly one session |
| `/opt/wov-worktrees/.slots/<n>/claim` | who holds slot `n`, on which branch, which paths | the session holding the slot |

Anywhere else (a personal clone), use `../wov-<slug>` next to your checkout
and the same rules.

### 3.2 Starting a task

```bash
cd /opt/worldofvikings && git fetch --prune origin
cat /opt/wov-worktrees/.slots/*/claim     # who is working on what, which paths

# Claim a slot. mkdir is atomic: of two sessions, exactly one gets slot n.
mkdir -p /opt/wov-worktrees/.slots
for n in 0 1 2 3 4 5 6 7 8 9 10 11 12 13; do mkdir /opt/wov-worktrees/.slots/$n 2>/dev/null && break; n=; done
echo "slot=$n"                            # empty: all fourteen taken, wait

SLUG=<topic>; AGENT=<claude|codex|deepseek|human>
git worktree add --no-track /opt/wov-worktrees/$SLUG -b agent/$AGENT/$SLUG origin/main
cat > /opt/wov-worktrees/.slots/$n/claim <<EOF
branch:   agent/$AGENT/$SLUG
worktree: /opt/wov-worktrees/$SLUG
since:    $(date -Iminutes)
task:     <identifier from the task list>
paths:    <the paths this task will touch>
EOF

cd /opt/wov-worktrees/$SLUG
npm ci
# only if the task needs assets: a copy, never a symlink (see below)
rsync -a --exclude /manifest.json /opt/worldofvikings/assets/ assets/
```

Read the claims before you write yours. If a path you need is already claimed,
wait or ask — do not take it.

Take your **own** asset copy. Do not symlink `assets/` into
`/opt/worldofvikings/assets`: tools that regenerate assets would write through
the link into the running DEV deployment.

### 3.3 Ports and running instances

Slot `n` owns these ports, and nothing else:

| Service | Port | How to set it |
|---|---|---|
| game server | `247n` | `port:` in `server/data/server.yml` (see below) |
| client (Vite) | `529n` | `WOV_CLIENT_PORT=529n WOV_SPIEL_PORT=247n` |
| admin service | `248n` | `WOV_ADMIN_PORT=248n` |

That is the scheme for slots 0-8. `247n` stops at `2479` and `5299` is fixed in
`tools/dungeon2-*`, so slots 9-13 have their own band (15 numbers that nothing in the repo uses as a port (only
coordinates in world data match) and nothing on the machine listened on, 23.09.2026):

| Slot | game server | admin service | client (Vite) |
|---|---|---|---|
| 9 | `2709` | `2809` | `5809` |
| 10 | `2710` | `2810` | `5810` |
| 11 | `2711` | `2811` | `5811` |
| 12 | `2712` | `2812` | `5812` |
| 13 | `2713` | `2813` | `5813` |

The same three settings apply (`port:` in `server.yml`, `WOV_ADMIN_PORT`,
`WOV_CLIENT_PORT`/`WOV_SPIEL_PORT`); as a formula: game `2700+n`, admin `2800+n`,
client `5800+n`. Do not put a fixed port from either scheme into a test; the guard
below knows both.

The game server reads its port only from `server/data/server.yml`, which is
tracked. Change it in your worktree and restore it before every commit
(`git checkout -- server/data/server.yml`); `git diff --stat` must not list it
in a pull request. The DEV services on `2467`, `2468`, `5274` and `3000` belong
to `/opt/worldofvikings` — never stop or restart them from a task.

**Tests never choose a port.** A test that starts a server passes `port: 0` and
reads the real port back with `portVon(server)` from `scripts/testport.mjs`
(`freierPort()` there is the second choice, for a child process or config file
that must be told the port before it binds). A constant that only looks like a
port is not allowed either: a test that merely calls `init()` passes `port: 0`
as well. Why this is a rule and not a habit: until 21.09.2026 about 25 test
files bound fixed ports in `2498`-`2610` (and `27314`). Those numbers belong to
nobody. The slot ports above are a different band and protect nothing there:
**no test in the collective run (`npm test`) binds them** - but three manual
tools outside it do, on purpose: `tools/dungeon2-e2e.mjs` (`2477` game server,
`5299` client, both slot 7), `tools/dungeon2-speckle-guard.mjs` (`5299`) and
`tools/pw-dungeon2-effekte.mjs` (`5297`). Start those only while the matching
slot is yours; they are named, with their reason, in
`scripts/pruefe-feste-ports.mjs`. So any session's probe on a test's number, a
second full run or an orphan left by an aborted run made a test fail with
`EADDRINUSE` (one full run then hung for 600 s on it) - or, worse, pass without
checking anything: several tests end in `try { ... } finally { ...; process.exit(...) }`,
which swallows an aborted promise chain. Measured: `g7-bauen.ts` on the old
stand with `2511` held printed `EADDRINUSE`, ran no check and exited 0; eight of
the converted tests do that whenever their connect fails (`b8-angreifbar` and
seven `g7-*`). `port: 0` removes the trigger; the pattern itself is a separate
problem (open). A fixed port that a test really cannot avoid (there is none
today) is written down at the place with its reason and entered in
`FESTE_PORTS` in `scripts/testport.mjs`. Two things keep this true:
`scripts/pruefe-feste-ports.mjs` (in the collective run, text only, ~0.1 s) turns
red on a fixed port in any test file, on a stale entry in its two allowance lists
and on a tool under `tools/` or `scripts/` that starts a server on a slot port
without being named there, and `scripts/listen-spion.mjs` (usage in its header) measures what a run
really binds - logging every `listen()`, and refusing fixed ports without binding
anything if asked.

Full test runs no longer collide on ports. Timing-sensitive tests and frame-time
measurements are skewed by a neighbour that computes or renders, so the host
limits what runs at once. Measured on wov-dev with 20 GB RAM and 8 cores
(23.09.2026): one `typecheck` peaks at 1.8 GB, two at 3.7 GB; two full runs in
two worktrees, three times, were 6/6 green and about 5 % slower each. The CPU,
not memory, is the limit (load 12 on 8 cores with two full runs). So:

| What | Places | Take it with |
|---|---|---|
| `typecheck`, `build`, `npm ci` | 2 | `tools/sperre.sh build -- <command>` |
| full test run (`npm test`) | 2, each in its own worktree | `tools/sperre.sh test -- npm test` |
| frame-time measurement | 1 | `tools/sperre.sh measure -- node tools/pw-fps-bench.mjs` |
| workers per orchestrator on wov-dev | 4 | (a rule, not a lock) |

`lint` needs no lock. The pre-commit hook takes a build place for its typecheck when
`/opt/wov-worktrees/.slots` exists (on wov-dev), so a commit waits like any other
typecheck; on other machines it runs unlocked. A test run that is timing-sensitive (a measurement, a
suspicious red) is repeated alone.

`tools/sperre.sh <name> -- <command>` is a counting semaphore on `flock`. The number
of places is fixed in the tool (`build` 2, `test` 2, `measure` 1), not chosen by the
caller: an unknown name, or a number that does not match (`build 3`), exits 64 with a
`sperre: usage:` line. The old form `<name> <n> -- <command>` is accepted only while
`<n>` equals the table. It takes the first free place (`<name>.lock`, then
`<name>.2.lock` ... in `/opt/wov-worktrees/.slots`), runs the command while holding it
and waits (poll, not a queue, no time limit) when all are busy. Place 1 is the old lock
file, so a plain `flock .../build.lock ...` still holds place 1 and stays correct
during the changeover, but a plain `flock` waiter that sits in the kernel wins against
the polling `sperre.sh` when the place frees up. **From the merge of this tool on, use
only `sperre.sh`** (also for `measure`), so nobody starves. Check the tool with
`tools/sperre.sh --selbsttest`; `--plaetze <name>` prints a name's places. If SSH
hangs, the emergency way goes through the host: `ssh wov-host 'pct exec 102 -- ...'`;
end only your own processes there.

What the lock covers, and what it does not:

- **The place belongs to the command and to everything that inherits the lock
  descriptor.** A daemon started under the lock (`setsid server &`) keeps the place
  after the command ends, without a time limit. **Never start servers, watchers or dev
  processes under `sperre.sh`**; it is for commands that finish.
- **`kill -9` on `sperre.sh` ends the wrapper, not its child.** The orphaned child keeps
  the place until it ends itself; end the child (by its PID) to free it.
- Nesting on one name needs a second free place (with `measure`, one place, it
  deadlocks). The lock files in `.slots` are part of the contract: deleting one lifts
  the lock, so do not `rm` them.
- Exit 64 is the tool's usage error and also possible for a command. The tool tells them
  apart on stderr: `sperre: usage:` against `sperre: command exited 64`.
- `WOV_SPERREN_PLAETZE_<NAME>` overrides the table for the tool's own self-test only and
  is ignored on the real directory; never set it.

### 3.4 While you work

- **Commit early, push early.** `git push -u origin HEAD` after the first
  commit, then open the pull request as a draft with the paths from your claim.
  A branch without a pull request is invisible work. If `gh` is missing on your
  machine, push and hand the compare link
  (`https://github.com/vibe-code-repo/worldofvikings/compare/main...<branch>?expand=1`)
  to the human.
- **Stay in your worktree.** Do not `cd` into another worktree or into
  `/opt/worldofvikings` to edit, and do not `git checkout` another branch in
  yours: the branch belongs to the worktree.
- **No `git stash`.** The stash is shared by all worktrees of the repository;
  another session can pop your changes. Commit a work-in-progress instead.
- **Never touch what is not yours:** no `git worktree remove`, `git branch -D`,
  `git worktree prune` or `git gc` for other sessions' worktrees and branches.
  A worktree that looks abandoned is reported to the human, not deleted.
- **Keep up with `main`.** `git fetch origin && git rebase origin/main` before
  you mark the pull request ready; resolve conflicts in your branch, never on
  `main`.

### 3.5 Finishing

Once the pull request is merged (or closed), clean up everything that belongs to
the slot — a run that leaves the machine dirty is not finished:

```bash
cd /opt/worldofvikings
git worktree remove /opt/wov-worktrees/$SLUG
git branch -D agent/$AGENT/$SLUG          # the remote branch is deleted on merge
rm -r /opt/wov-worktrees/.slots/$n
```

Stop your own server, client and test processes first — by the PIDs you
started, never with `pkill -f <pattern>`: on shared machines a pattern such as
`org.blender.Blender` also matches other sessions' processes. Then check with
`ss -ltn` that the slot's three ports are free
(`247n`/`248n`/`529n`, slots 9-13: see the table above).

### 3.6 Branches, ownership and hot files

- **Branch.** New branches are named `agent/<agent>/<topic>`, for example
  `agent/codex/seidraven-body-variants`. The older `codex/*`, `perf/*` and
  `fix/*` branches keep their names; the `agent/` prefix is there so that agent
  work is recognisable in `git branch`.
- **Lifetime.** Do not let a branch outlive its task: a pull request nobody has
  touched for three days is either finished or closed. One open pull request
  per session at a time.
- **Paths are the unit of ownership, not files.** Write down the paths your task
  touches in the claim and in the pull request body before you start. Two tasks
  must not claim the same path; if they do, one of them waits.
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
