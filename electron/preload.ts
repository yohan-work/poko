import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type AgentEvent,
  type TaskEventPayload,
  type TaskStartResponse,
  type WorkspaceInfo,
  type AppBootstrap,
  type MemoryInput,
  type PersistedMemory,
} from "./shared";

function isTaskEventPayload(value: unknown): value is TaskEventPayload {
  if (typeof value !== "object" || value === null || !("taskId" in value) || !("event" in value)) {
    return false;
  }
  const payload = value as { taskId: unknown; event: unknown };
  if (
    typeof payload.taskId !== "string" ||
    typeof payload.event !== "object" ||
    payload.event === null
  ) {
    return false;
  }

  const event = payload.event as Record<string, unknown>;
  switch (event.type) {
    case "started":
    case "cancelled":
      return true;
    case "thinking":
      return event.message === undefined || typeof event.message === "string";
    case "tool":
      return (
        typeof event.tool === "string" &&
        (event.detail === undefined || typeof event.detail === "string")
      );
    case "output":
      return typeof event.content === "string";
    case "completed":
      return typeof event.result === "string";
    case "error":
      return typeof event.error === "string";
    default:
      return false;
  }
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return typeof value === "object" && value !== null && "type" in value;
}

const pokoApi = {
  app: { bootstrap: (): Promise<AppBootstrap> => ipcRenderer.invoke(IPC_CHANNELS.appBootstrap) },
  workspace: {
    get: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
    select: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect),
  },
  tasks: {
    start: (message: string): Promise<TaskStartResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.taskStart, message),
    cancel: (taskId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.taskCancel, taskId),
    onEvent: (callback: (payload: TaskEventPayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, rawPayload: unknown): void => {
        if (isTaskEventPayload(rawPayload) && isAgentEvent(rawPayload.event)) callback(rawPayload);
      };
      ipcRenderer.on(IPC_CHANNELS.taskEvent, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.taskEvent, listener);
    },
  },
  memory: {
    list: (): Promise<PersistedMemory[]> => ipcRenderer.invoke(IPC_CHANNELS.memoryList),
    search: (query: string): Promise<PersistedMemory[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.memorySearch, query),
    save: (input: MemoryInput): Promise<PersistedMemory> =>
      ipcRenderer.invoke(IPC_CHANNELS.memorySave, input),
    delete: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.memoryDelete, id),
  },
};

contextBridge.exposeInMainWorld("poko", pokoApi);

export type PokoApi = typeof pokoApi;
