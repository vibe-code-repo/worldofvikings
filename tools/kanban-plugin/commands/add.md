---
description: Add a task to the Kanban board (starts in To Do)
argument-hint: <title> [--desc <text>] [--column todo|doing|review|merge|deployed]
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" add $ARGUMENTS`, then show the board with `node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" board`.
