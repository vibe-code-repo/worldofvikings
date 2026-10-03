#!/usr/bin/env node
// Kanban board for Claude Code. Tasks are Markdown files with a small
// front matter block in <project>/kanban/tasks/. No dependencies.
//
//   kanban.mjs board [--json]
//   kanban.mjs add <title> [--desc <text>] [--column <key>]
//   kanban.mjs move <id> <column>
//   kanban.mjs show <id>
//   kanban.mjs columns
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const COLUMNS = [
  { key: "todo", label: "To Do", aliases: ["to do", "todo", "backlog"] },
  { key: "doing", label: "In Arbeit", aliases: ["in arbeit", "doing", "wip", "in progress"] },
  { key: "review", label: "In Review", aliases: ["in review", "review"] },
  { key: "merge", label: "In Merge", aliases: ["in merge", "merge"] },
  { key: "deployed", label: "Ausgerollt", aliases: ["ausgerollt", "deployed", "done", "released"] },
];

export function resolveColumn(input) {
  const needle = String(input ?? "")
    .trim()
    .toLowerCase();
  return COLUMNS.find(
    (c) => c.key === needle || c.label.toLowerCase() === needle || c.aliases.includes(needle),
  );
}

export function parseTask(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { ...meta, body: m[2].trim() };
}

export function serializeTask(t) {
  const head = ["id", "title", "status", "created", "updated"]
    .map((k) => `${k}: ${t[k]}`)
    .join("\n");
  return `---\n${head}\n---\n${t.body ? `${t.body}\n` : ""}`;
}

export function tasksDir(root) {
  return join(root, "kanban", "tasks");
}

export function loadTasks(root) {
  const dir = tasksDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseTask(readFileSync(join(dir, f), "utf8")))
    .filter((t) => t?.id && t.title)
    .map((t) => ({ ...t, status: resolveColumn(t.status)?.key ?? "todo" }))
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

export function nextId(tasks) {
  const max = tasks.reduce((n, t) => Math.max(n, Number(/^K-(\d+)$/.exec(t.id)?.[1] ?? 0)), 0);
  return `K-${String(max + 1).padStart(3, "0")}`;
}

const today = () => new Date().toISOString().slice(0, 10);
const file = (root, id) => join(tasksDir(root), `${id}.md`);

export function addTask(root, title, { desc = "", column = "todo" } = {}) {
  const col = resolveColumn(column);
  if (!col)
    throw new Error(`Unknown column "${column}". Use: ${COLUMNS.map((c) => c.key).join(", ")}`);
  if (!title.trim()) throw new Error("A task needs a title.");
  const tasks = loadTasks(root);
  const task = {
    id: nextId(tasks),
    title: title.trim().replace(/\s+/g, " "),
    status: col.key,
    created: today(),
    updated: today(),
    body: desc,
  };
  mkdirSync(tasksDir(root), { recursive: true });
  writeFileSync(file(root, task.id), serializeTask(task));
  return task;
}

export function moveTask(root, id, column) {
  const col = resolveColumn(column);
  if (!col)
    throw new Error(`Unknown column "${column}". Use: ${COLUMNS.map((c) => c.key).join(", ")}`);
  const wanted = /^\d+$/.test(id) ? `K-${id.padStart(3, "0")}` : id.toUpperCase();
  const task = loadTasks(root).find((t) => t.id === wanted);
  if (!task) throw new Error(`No task ${id}.`);
  task.status = col.key;
  task.updated = today();
  writeFileSync(file(root, task.id), serializeTask(task));
  return task;
}

export function renderBoard(tasks) {
  const out = [];
  for (const col of COLUMNS) {
    const items = tasks.filter((t) => t.status === col.key);
    out.push(`┌─ ${col.label} (${items.length}) ${"─".repeat(Math.max(2, 34 - col.label.length))}`);
    if (!items.length) out.push("│  –");
    for (const t of items) out.push(`│  ${t.id}  ${t.title}`);
    out.push("└" + "─".repeat(40), "");
  }
  return out.join("\n").trimEnd();
}

function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "board":
    case undefined: {
      const tasks = loadTasks(root);
      console.log(rest.includes("--json") ? JSON.stringify(tasks, null, 2) : renderBoard(tasks));
      break;
    }
    case "columns":
      for (const c of COLUMNS) console.log(`${c.key}\t${c.label}`);
      break;
    case "add": {
      const flag = (name) => {
        const i = rest.indexOf(name);
        return i < 0 ? undefined : rest.splice(i, 2)[1];
      };
      const desc = flag("--desc") ?? "";
      const column = flag("--column") ?? "todo";
      const t = addTask(root, rest.join(" "), { desc, column });
      console.log(`Added ${t.id}: ${t.title} (${resolveColumn(t.status).label})`);
      break;
    }
    case "move": {
      const [id, ...col] = rest;
      if (!id || !col.length) throw new Error("Usage: move <id> <column>");
      const t = moveTask(root, id, col.join(" "));
      console.log(`Moved ${t.id} "${t.title}" to ${resolveColumn(t.status).label}`);
      break;
    }
    case "show": {
      const wanted = /^\d+$/.test(rest[0] ?? "")
        ? `K-${rest[0].padStart(3, "0")}`
        : (rest[0] ?? "").toUpperCase();
      const t = loadTasks(root).find((x) => x.id === wanted);
      if (!t) throw new Error(`No task ${rest[0]}.`);
      console.log(
        `${t.id}  ${t.title}\nColumn: ${resolveColumn(t.status).label}\nCreated: ${t.created}  Updated: ${t.updated}\n\n${t.body}`.trimEnd(),
      );
      break;
    }
    default:
      throw new Error("Usage: kanban.mjs board|add|move|show|columns");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
