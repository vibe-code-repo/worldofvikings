import { atom, read, update } from "claude-code";
import type { Register } from "claude-code";

import type { KanbanTask } from "../types";

type Fs = {
  fs: {
    exists(path: string): Promise<boolean>;
    list(path?: string): Promise<{ name: string }[]>;
    read(path: string): Promise<string>;
  };
};

const PANE = "kanban";
const DIR = "kanban/tasks";
const COLUMNS = [
  { key: "todo", label: "To Do", color: "gray" },
  { key: "doing", label: "In Arbeit", color: "yellow" },
  { key: "review", label: "In Review", color: "cyan" },
  { key: "merge", label: "In Merge", color: "magenta" },
  { key: "deployed", label: "Ausgerollt", color: "green" },
] as const;

// Bumped to redraw the pane; the tasks themselves are read fresh from disk.
const tick = atom({ plugin: "kanban", key: "tick" } as const, 0);

function parse(text: string): KanbanTask | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.title) return undefined;
  const status = COLUMNS.find((c) => c.key === meta.status)?.key ?? "todo";
  return { id: meta.id, title: meta.title, status };
}

async function loadTasks($: Fs): Promise<KanbanTask[]> {
  if (!(await $.fs.exists(DIR))) return [];
  const entries = await $.fs.list(DIR);
  const tasks: KanbanTask[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    const task = parse(await $.fs.read(`${DIR}/${entry.name}`));
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "kanban-pane",
      description: "Show the Kanban board in a pane",
    });
    return next(e);
  });

  on("command.run", { command: "kanban-pane" }, async ($) => {
    await $.ui.open({ id: PANE, title: "Kanban" });
    return { text: "Kanban pane opened." };
  });

  // Task files change through tools (the /kanban:* commands, edits); redraw after each.
  on("tool.call", async ($, e, next) => {
    const ran = await next(e);
    await update($, tick, (n) => n + 1);
    return ran;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    await read($, tick);
    const tasks = await loadTasks($);

    return (
      <Box flexDirection="column">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col.key);
          return (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color={col.color}>
                {col.label} ({items.length})
              </Text>
              {items.length === 0 && <Text dimColor> –</Text>}
              {items.map((t) => (
                <Text>
                  {"  "}
                  <Text dimColor>{t.id}</Text> {t.title}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
    );
  });
};
