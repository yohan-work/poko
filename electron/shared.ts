export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  taskStart: "task:start",
  taskCancel: "task:cancel",
  taskEvent: "task:event",
} as const;

export type CharacterState =
  | "idle"
  | "listening"
  | "thinking"
  | "working"
  | "success"
  | "error"
  | "approval";

export type AppView = "conversation" | "memory" | "tasks" | "activity";

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface AgentTask {
  id: string;
  prompt: string;
  cwd: string;
  mode: "read" | "write";
}

export type AgentEvent =
  | { type: "started" }
  | { type: "thinking"; message?: string }
  | { type: "tool"; tool: string; detail?: string }
  | { type: "output"; content: string }
  | { type: "completed"; result: string }
  | { type: "cancelled" }
  | { type: "error"; error: string };

export interface TaskEventPayload {
  taskId: string;
  event: AgentEvent;
}

export interface TaskStartResponse {
  taskId: string;
}
