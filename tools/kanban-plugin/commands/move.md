---
description: Move a task to another Kanban column
argument-hint: <id> <todo|doing|review|merge|deployed>
allowed-tools: Bash(node:*)
---

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" move $ARGUMENTS`, then show the board with `node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" board`. Columns accept the key or the German label (for example `doing` or `in arbeit`).
