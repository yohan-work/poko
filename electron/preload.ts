import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { isAgentEvent, isTaskEventPayload } from "./eventGuards";
import {
  type AppBootstrap,
  type ApprovalChoice,
  type ApprovalOutcome,
  IPC_CHANNELS,
  type MemoryInput,
  type OverlayScene,
  type PersistedMemory,
  type PersistedMessage,
  type ScreenLookResponse,
  type ScreenStatus,
  type ScreenWindow,
  type TaskEventPayload,
  type TaskStartResponse,
  type WorkspaceInfo,
} from "./shared";

const pokoApi = {
  app: { bootstrap: (): Promise<AppBootstrap> => ipcRenderer.invoke(IPC_CHANNELS.appBootstrap) },
  workspace: {
    get: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceGet),
    select: (): Promise<WorkspaceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.workspaceSelect),
  },
  tasks: {
    /** `conversationId` null starts a new conversation titled from the message. */
    start: (message: string, conversationId: string | null): Promise<TaskStartResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.taskStart, { message, conversationId }),
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
  screen: {
    status: (): Promise<ScreenStatus> => ipcRenderer.invoke(IPC_CHANNELS.screenStatus),
    openSettings: (kind: "screen" | "accessibility"): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.screenOpenSettings, kind),
    acceptNotice: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.screenAcceptNotice),
    listWindows: (): Promise<ScreenWindow[]> => ipcRenderer.invoke(IPC_CHANNELS.screenListWindows),
    look: (
      windowId: number,
      question: string,
      conversationId: string | null,
    ): Promise<ScreenLookResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.screenLook, { windowId, question, conversationId }),
    act: (
      windowId: number,
      goal: string,
      conversationId: string | null,
    ): Promise<ScreenLookResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.screenAct, { windowId, goal, conversationId }),
  },
  overlay: {
    onScene: (listener: (scene: OverlayScene) => void) => {
      const handler = (_event: IpcRendererEvent, scene: OverlayScene) => listener(scene);
      ipcRenderer.on(IPC_CHANNELS.overlayScene, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayScene, handler);
    },
    onHide: (listener: () => void) => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.overlayHide, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlayHide, handler);
    },
  },
  approvals: {
    respond: (
      taskId: string,
      requestId: string,
      choice: ApprovalChoice,
    ): Promise<ApprovalOutcome> =>
      ipcRenderer.invoke(IPC_CHANNELS.approvalRespond, { taskId, requestId, choice }),
  },
  conversations: {
    /** Opens a conversation (null: a new one) and returns its messages. */
    open: (
      conversationId: string | null,
    ): Promise<{ messages: PersistedMessage[] } | { error: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationOpen, conversationId),
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
