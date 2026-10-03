export type KanbanTask = { id: string; title: string; status: string };

declare module "claude-code" {
  interface PluginState {
    kanban: { tick: number };
  }
}
