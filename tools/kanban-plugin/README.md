# Kanban plugin for Claude Code

A Kanban board for the tasks of this project, with the columns **To Do**, **In Arbeit**, **In Review**, **In Merge**, **Ausgerollt**.

Tasks are Markdown files in `kanban/tasks/` at the repository root, so the board is versioned and reviewed like code. One file per task keeps merge conflicts rare.

## Install

```
/plugin marketplace add vibe-code-repo/worldofvikings
/plugin install kanban@worldofvikings
```

Or test locally from a checkout: `claude --plugin-dir tools/kanban-plugin`.

## Commands

| Command                                           | Does                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `/kanban:board`                                   | shows the board                                                          |
| `/kanban:add <title> [--desc ...] [--column ...]` | new task (default To Do)                                                 |
| `/kanban:move <id> <column>`                      | moves a task; `doing`, `review`, `merge`, `deployed` or the German label |
| `/kanban:show <id>`                               | one task with its description                                            |

The script also runs standalone: `node tools/kanban-plugin/bin/kanban.mjs board`.

## Task file

```
---
id: K-001
title: Short title
status: doing
created: 2026-10-03
updated: 2026-10-03
---
Free-form description.
```
