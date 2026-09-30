export const IPC_CHANNELS = {
  workspaceGet: "workspace:get",
  workspaceSelect: "workspace:select",
  taskStart: "task:start",
  taskCancel: "task:cancel",
  taskEvent: "task:event",
  appBootstrap: "app:bootstrap",
  memoryList: "memory:list",
  memorySearch: "memory:search",
  memorySave: "memory:save",
  memoryDelete: "memory:delete",
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

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}
export interface PersistedTask {
  id: string;
  title: string;
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
}
export interface PersistedActivity {
  id: string;
  taskId: string;
  type: string;
  message: string;
  createdAt: string;
}
export interface PersistedMemory {
  id: string;
  type: "preference" | "project" | "person" | "decision" | "fact" | "routine";
  content: string;
  importance: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface AppBootstrap {
  workspace: WorkspaceInfo | null;
  conversationId: string;
  messages: PersistedMessage[];
  tasks: PersistedTask[];
  activities: PersistedActivity[];
}
export interface MemoryInput {
  type: PersistedMemory["type"];
  content: string;
  importance: number;
}
