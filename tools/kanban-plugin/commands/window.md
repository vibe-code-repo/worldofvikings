---
description: Open the Kanban board as a graphical window (live pane, or an HTML page as fallback)
allowed-tools: Bash(node:*)
---

First try the live pane: tell the user to run `/kanban-pane` (it opens the board in a pane inside Claude Code and redraws after every tool call). Then also build the browser version: run `node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" html` and give the user the printed file path (open it in a browser; rerun to refresh).
