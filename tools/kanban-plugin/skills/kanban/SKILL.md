---
name: kanban
description: Use when the user talks about the task board, backlog or the state of a task (To Do, In Arbeit, In Review, In Merge, Ausgerollt), or when a task of this project starts, goes into review, merges or is rolled out.
---

# Kanban board

Tasks live as Markdown files in `kanban/tasks/` (`K-001.md`, ...), committed with the repository. Columns, left to right:

| Key        | Label      | Meaning                                      |
| ---------- | ---------- | -------------------------------------------- |
| `todo`     | To Do      | not started                                  |
| `doing`    | In Arbeit  | someone works on it                          |
| `review`   | In Review  | pull request is open and waits for review/CI |
| `merge`    | In Merge   | approved, being merged                       |
| `deployed` | Ausgerollt | live on `wov-live`                           |

Use the script, never edit the front matter by hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" board
node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" add "Title" --desc "Details"
node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" move K-001 review
node "${CLAUDE_PLUGIN_ROOT}/bin/kanban.mjs" show K-001
```

When you start work on a task, move it to `doing`; when you open its pull request, to `review`. Moving to `merge` and `deployed` is the human's call unless asked.
