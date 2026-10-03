#!/usr/bin/env node
// Kanban board for Claude Code. Tasks are Markdown files with a small
// front matter block in <project>/kanban/tasks/. No dependencies.
//
//   kanban.mjs board [--json]
//   kanban.mjs add <title> [--desc <text>] [--column <key>]
//   kanban.mjs move <id> <column>
//   kanban.mjs show <id>
//   kanban.mjs html [--out <file>]   (self-contained page, default out/kanban.html)
//   kanban.mjs html [--out <file>]   (self-contained page, default out/kanban.html)
//   kanban.mjs columns
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// Self-contained page: five columns, light/dark, no scripts, no network.
export function renderHtml(tasks) {
  const cols = COLUMNS.map((col) => {
    const items = tasks.filter((t) => t.status === col.key);
    const cards = items
      .map(
        (t) =>
          `<article><b>${esc(t.id)}</b><h3>${esc(t.title)}</h3>${t.body ? `<p>${esc(t.body)}</p>` : ""}<small>${esc(t.updated)}</small></article>`,
      )
      .join("");
    return `<section class="${col.key}"><h2>${esc(col.label)} <span>${items.length}</span></h2>${cards || '<p class="empty">–</p>'}</section>`;
  }).join("");
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kanban</title>
<style>
:root{--bg:#f4f5f7;--col:#e6e8ec;--card:#fff;--fg:#1d2330;--dim:#6b7280;--todo:#6b7280;--doing:#d97706;--review:#0891b2;--merge:#9333ea;--deployed:#16a34a}
@media(prefers-color-scheme:dark){:root{--bg:#14171d;--col:#1d222b;--card:#262c37;--fg:#e6e9ef;--dim:#9aa3b2}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
main{display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:12px;align-items:start;overflow-x:auto}
section{background:var(--col);border-radius:10px;padding:10px;border-top:4px solid var(--c)}
${COLUMNS.map((c) => `.${c.key}{--c:var(--${c.key})}`).join("")}
h2{margin:0 0 8px;font-size:15px;display:flex;justify-content:space-between}h2 span{color:var(--dim)}
article{background:var(--card);border-radius:8px;padding:8px 10px;margin-bottom:8px}
article b{color:var(--dim);font-size:12px}h3{margin:2px 0;font-size:15px}article p{margin:4px 0;color:var(--dim);font-size:13px}small{color:var(--dim)}.empty{color:var(--dim);margin:0}
</style></head><body><main>${cols}</main></body></html>
`;
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
    case "html": {
      const i = rest.indexOf("--out");
      const out = resolve(root, i >= 0 ? rest[i + 1] : join("out", "kanban.html"));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, renderHtml(loadTasks(root)));
      console.log(out);
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
      throw new Error("Usage: kanban.mjs board|add|move|show|html|columns");
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
