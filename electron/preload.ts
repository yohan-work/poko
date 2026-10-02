import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { isAgentEvent, isTaskEventPayload } from "./eventGuards";
import {
  type AppBootstrap,
  type AppSettings,
  type EngineId,
  type ModelOption,
  type ClaudeSetup,
  type DataExportResult,
  type DeleteAllResponse,
  type CodexSetup,
  type EditNote,
  type EditsState,
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
  type SettingsView,
  type TaskEventPayload,
  type TaskStartResponse,
  type WorkspaceInfo,
} from "./shared";

const pokoApi = {
  app: { bootstrap: (): Promise<AppBootstrap> => ipcRenderer.invoke(IPC_CHANNELS.appBootstrap) },
  settings: {
    get: (): Promise<SettingsView> => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (settings: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsSet, settings),
    /** Models the user can pick for an engine. */
    models: (engine: EngineId): Promise<ModelOption[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.modelsList, engine),
  },
  data: {
    /** Asks where to save, then writes everything Poko kept as JSON. */
    export: (): Promise<DataExportResult> => ipcRenderer.invoke(IPC_CHANNELS.dataExport),
    openFolder: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.dataOpenFolder),
    deleteAll: (confirm: string): Promise<DeleteAllResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.dataDeleteAll, { confirm }),
  },
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
    /** Shows the data-use notice again before the next screen task. */
    resetNotice: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.screenResetNotice),
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
    rename: (conversationId: string, title: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationRename, { conversationId, title }),
    delete: (conversationId: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.conversationDelete, conversationId),
  },
  setup: {
    /** Re-checks Codex: install, version and features, and ChatGPT sign-in. */
    status: (): Promise<CodexSetup> => ipcRenderer.invoke(IPC_CHANNELS.setupStatus),
    /** Checks the user's Claude Code CLI: install, options, and sign-in. */
    claudeStatus: (): Promise<ClaudeSetup> => ipcRenderer.invoke(IPC_CHANNELS.setupClaudeStatus),
    login: (): Promise<"started" | "already" | "unavailable"> =>
      ipcRenderer.invoke(IPC_CHANNELS.setupLogin),
    cancelLogin: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.setupCancelLogin),
    onChanged: (listener: (status: CodexSetup) => void) => {
      const handler = (_event: IpcRendererEvent, status: CodexSetup) => listener(status);
      ipcRenderer.on(IPC_CHANNELS.setupChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.setupChanged, handler);
      };
    },
  },
  edits: {
    /** Whether edits are allowed in the selected workspace. */
    get: (): Promise<EditsState> => ipcRenderer.invoke(IPC_CHANNELS.editsGet),
    set: (enabled: boolean): Promise<EditsState | { error: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.editsSet, enabled),
    /** Approved changes in a conversation, with undo while it is still possible. */
    list: (conversationId: string): Promise<EditNote[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.editsList, conversationId),
    undo: (editId: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.editsUndo, editId),
    /** A conversation's changes were settled or undone. */
    onChanged: (listener: (conversationId: string) => void) => {
      const handler = (_event: IpcRendererEvent, id: unknown) => {
        if (typeof id === "string") listener(id);
      };
      ipcRenderer.on(IPC_CHANNELS.editsChanged, handler);
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.editsChanged, handler);
      };
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
