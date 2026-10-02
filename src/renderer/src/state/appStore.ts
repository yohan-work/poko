import { create } from "zustand";
import { applyDeltas, createDeltaBuffer, type StreamingAnswer } from "../lib/streaming";
import type {
  AgentEvent,
  AppBootstrap,
  AppSettings,
  ClaudeSetup,
  DataExportResult,
  EngineId,
  ModelOption,
  PendingApprovalEvent,
  DeleteAllResponse,
  ApprovalChoice,
  ApprovalOutcome,
  AppView,
  CharacterState,
  TaskEventPayload,
  WorkspaceInfo,
  PersistedMemory,
  MemoryInput,
  CodexSetup,
  EditNote,
  EditsState,
  PersistedConversation,
  ScreenStatus,
  ScreenWindow,
} from "../../../../electron/shared";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  taskId: string;
  taskTitle?: string;
  message: string;
  createdAt: string;
}

export type PendingApproval = PendingApprovalEvent;

export interface ScreenState {
  open: boolean;
  loading: boolean;
  status: ScreenStatus | null;
  windows: ScreenWindow[];
  error: string | null;
}

export interface SessionTask {
  id: string;
  title: string;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

interface AppState {
  setup: CodexSetup | null;
  claudeSetup: ClaudeSetup | null;
  setupChecking: boolean;
  setupDismissed: boolean;
  checkSetup: () => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  dismissSetup: () => void;
  /** A login finished or another change arrived from main. */
  receiveSetup: (setup: CodexSetup) => void;
  /** Checks Codex again from 설정, showing the setup screen if something is missing. */
  recheckSetup: () => Promise<void>;
  settings: AppSettings | null;
  /** False when another app already owns the quick panel shortcut. */
  quickShortcutOk: boolean;
  /** Models per engine, loaded when the picker first needs them. */
  models: Partial<Record<EngineId, ModelOption[]>>;
  loadModels: (engine: EngineId) => Promise<void>;
  appVersion: string | null;
  settingsError: string | null;
  /** Loads preferences and the screen permissions for 설정. */
  loadSettings: () => Promise<void>;
  updateSettings: (change: Partial<AppSettings>) => Promise<void>;
  /** Shows the screen data-use notice again before the next screen task. */
  resetScreenNotice: () => Promise<void>;
  exportData: () => Promise<DataExportResult>;
  openDataFolder: () => Promise<void>;
  /** Deletes all history; resolves an error message, or null when every page was reset. */
  deleteAllData: (confirm: string) => Promise<string | null>;
  edits: EditsState;
  /** Approved changes in the active conversation. */
  editNotes: EditNote[];
  undoingEdit: string | null;
  loadEditNotes: () => Promise<void>;
  /** Resolves to an error message, or null when undone. */
  undoEdit: (id: string) => Promise<string | null>;
  editsConfirmOpen: boolean;
  loadEdits: () => Promise<void>;
  /** Turning edits on asks first; turning them off happens at once. */
  setEdits: (enabled: boolean, confirmed?: boolean) => Promise<void>;
  closeEditsConfirm: () => void;
  conversations: PersistedConversation[];
  /** null: a new conversation, created when its first message is sent. */
  activeConversationId: string | null;
  conversationError: string | null;
  newConversation: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  /** Resolves to an error message, or null when renamed. */
  renameConversation: (id: string, title: string) => Promise<string | null>;
  deleteConversation: (id: string) => Promise<string | null>;
  activeView: AppView;
  characterState: CharacterState;
  isSending: boolean;
  isSelectingWorkspace: boolean;
  messages: ConversationMessage[];
  activities: ActivityEntry[];
  tasks: SessionTask[];
  activeTaskId: string | null;
  /** The answer being written for the active task; replaced by the saved result when it completes. */
  streaming: StreamingAnswer | null;
  /** Oldest first; Codex may ask again before the user answers. */
  pendingApprovals: PendingApproval[];
  /** A task started elsewhere (the quick panel) is running, so this window can't start one. */
  busyElsewhere: boolean;
  /** A task started elsewhere waits for approval in this conversation (null: unknown yet). */
  foreignApproval: { conversationId: string | null } | null;
  /** Shows the conversation of a task started elsewhere and takes it over, cards included. */
  showForeignTask: () => Promise<void>;
  isRespondingToApproval: boolean;
  progressMessage: string | null;
  workspace: WorkspaceInfo | null;
  errorMessage: string | null;
  workspaceError: string | null;
  memories: PersistedMemory[];
  memoryError: string | null;
  /** The search text the memory list currently reflects. */
  memoryQuery: string;
  initializeWorkspace: () => Promise<void>;
  loadMemories: (query?: string) => Promise<void>;
  /** Resolves false when the memory could not be saved. */
  saveMemory: (input: MemoryInput) => Promise<boolean>;
  deleteMemory: (id: string) => Promise<void>;
  selectWorkspace: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  cancelTask: () => Promise<void>;
  screen: ScreenState;
  openScreen: () => Promise<void>;
  closeScreen: () => void;
  refreshScreen: () => Promise<void>;
  acceptScreenNotice: () => Promise<void>;
  openScreenSettings: (kind: "screen" | "accessibility") => void;
  /** Resolves true when the look started, so the caller can clear the draft. */
  lookAtWindow: (windowId: number, question: string) => Promise<boolean>;
  /** Starts a step-by-step task in a browser window; each step waits for approval. */
  actInWindow: (windowId: number, goal: string) => Promise<boolean>;
  respondToApproval: (choice: ApprovalChoice) => Promise<void>;
  setActiveView: (view: AppView) => void;
  clearError: () => void;
}

function createMessage(role: ConversationMessage["role"], content: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function activityText(event: AgentEvent): string | null {
  switch (event.type) {
    case "started":
      return "포코가 요청을 확인했어.";
    case "thinking":
      return event.message ?? "요청을 살펴보고 있어.";
    case "tool":
      return event.detail ?? "프로젝트를 살펴보고 있어.";
    case "completed":
      return "프로젝트 확인을 마쳤어.";
    case "cancelled":
      return "요청을 멈췄어.";
    case "error":
      return "작업을 마치지 못했어.";
    case "approvalRequired":
      return event.canApprove
        ? "포코가 다음 작업의 확인을 기다리고 있어."
        : "안전한 확인 정보가 없어 요청을 거절했어.";
    case "output":
      return null;
  }
}

function eventCharacterState(event: AgentEvent): CharacterState {
  switch (event.type) {
    case "started":
    case "thinking":
      return "thinking";
    case "tool":
    case "output":
      return "working";
    case "completed":
      return "success";
    case "cancelled":
      return "idle";
    case "error":
      return "error";
    case "approvalRequired":
      return event.canApprove ? "approval" : "working";
  }
}

function sessionTaskStatus(event: AgentEvent): SessionTask["status"] | null {
  if (event.type === "completed") return "completed";
  if (event.type === "error") return "failed";
  if (event.type === "cancelled") return "cancelled";
  return null;
}

/** Matches the number of activities loaded at startup. */
const MAX_ACTIVITIES = 500;

function addActivity(state: AppState, taskId: string, message: string): ActivityEntry[] {
  return [
    ...state.activities,
    {
      id: crypto.randomUUID(),
      taskId,
      taskTitle: state.tasks.find((task) => task.id === taskId)?.title,
      message,
      createdAt: new Date().toISOString(),
    },
  ].slice(-MAX_ACTIVITIES);
}

/** The store's view of the data main starts from. */
function fromBootstrap(data: AppBootstrap): Partial<AppState> {
  return {
    workspace: data.workspace,
    conversations: data.conversations,
    activeConversationId: data.conversationId,
    messages: data.messages,
    tasks: data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      // Startup recovery already closed interrupted tasks; anything else is treated as running.
      status: task.status === "queued" ? "running" : task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt ?? undefined,
    })),
    // Storage returns newest first; the store appends new entries, so keep it oldest first.
    activities: [...data.activities].reverse(),
  };
}

/** Engines whose model list is being fetched, so the picker never asks twice at once. */
const modelLoads = new Set<EngineId>();

/** Counts settings saves, so a load that started before one is dropped. */
let settingsSaves = 0;

export const useAppStore = create<AppState>((set, get) => ({
  activeView: "conversation",
  characterState: "idle",
  isSending: false,
  isSelectingWorkspace: false,
  messages: [],
  activities: [],
  tasks: [],
  activeTaskId: null,
  streaming: null,
  pendingApprovals: [],
  busyElsewhere: false,
  foreignApproval: null,
  showForeignTask: async () => {
    const [taskId, foreign] = [...foreignTasks.entries()].at(-1) ?? [];
    if (!taskId || !foreign) return;
    const conversationId =
      foreign.conversationId ??
      (await window.poko.tasks.active().catch(() => null))?.conversationId;
    if (conversationId) await adoptTask(taskId, conversationId);
  },
  isRespondingToApproval: false,
  screen: { open: false, loading: false, status: null, windows: [], error: null },
  progressMessage: null,
  workspace: null,
  errorMessage: null,
  workspaceError: null,
  memories: [],
  memoryError: null,
  memoryQuery: "",
  edits: { available: false, enabled: false },
  editsConfirmOpen: false,
  setup: null,
  claudeSetup: null,
  setupChecking: false,
  setupDismissed: false,
  settings: null,
  quickShortcutOk: true,
  models: {},
  appVersion: null,
  settingsError: null,

  checkSetup: async () => {
    set({ setupChecking: true });
    // The setup screen follows the chosen engine, so the preferences load with the checks.
    if (!get().settings) void get().loadSettings();
    // Keep the last status on a failure; the screen still offers 다시 확인.
    await Promise.all([
      window.poko.setup
        .status()
        .then((setup) => set({ setup }))
        .catch(() => undefined),
      window.poko.setup
        .claudeStatus()
        .then((claudeSetup) => set({ claudeSetup }))
        .catch(() => undefined),
    ]);
    set({ setupChecking: false });
  },

  startLogin: async () => {
    const result = await window.poko.setup.login().catch(() => "unavailable" as const);
    if (result === "unavailable") await get().checkSetup();
  },

  cancelLogin: async () => {
    await window.poko.setup.cancelLogin().catch(() => false);
  },

  dismissSetup: () => set({ setupDismissed: true }),

  receiveSetup: (setup) => set({ setup }),

  loadModels: async (engine) => {
    if (modelLoads.has(engine)) return;
    modelLoads.add(engine);
    const models = await window.poko.settings.models(engine).catch(() => []);
    modelLoads.delete(engine);
    // An empty answer means Codex couldn't be asked; leave it unloaded so the picker retries.
    if (models.length > 0) set({ models: { ...get().models, [engine]: models } });
  },

  recheckSetup: async () => {
    set({ setupDismissed: false });
    await get().checkSetup();
  },

  loadSettings: async () => {
    // Preferences and screen status load separately, so a failed screen check can't lock
    // the switches; a reply that started before a save is dropped, so it can't undo it.
    const saves = settingsSaves;
    void window.poko.screen
      .status()
      .then((status) => set({ screen: { ...get().screen, status } }))
      .catch(() => undefined);
    try {
      const { settings, version, quickShortcutOk } = await window.poko.settings.get();
      if (saves !== settingsSaves) return;
      set({ settings, appVersion: version, quickShortcutOk, settingsError: null });
    } catch {
      set({ settingsError: "설정을 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
    }
  },

  updateSettings: async (change) => {
    settingsSaves += 1;
    set({ settingsError: null });
    try {
      set({ settings: await window.poko.settings.set(change) });
      // A new shortcut may be taken by another app; main knows after registering it.
      if (change.quickShortcut !== undefined) {
        const { quickShortcutOk } = await window.poko.settings.get();
        set({ quickShortcutOk });
      }
    } catch {
      set({ settingsError: "설정을 저장하지 못했어. 다시 시도해 줘." });
    }
  },

  exportData: () => window.poko.data.export().catch(() => "failed" as const),

  openDataFolder: async () => {
    await window.poko.data.openFolder().catch(() => false);
  },

  deleteAllData: async (confirm) => {
    if (get().isSending)
      return "포코가 작업 중이라 지금은 지울 수 없어. 작업이 끝난 뒤 다시 시도해 줘.";
    let response: DeleteAllResponse;
    try {
      response = await window.poko.data.deleteAll(confirm);
    } catch {
      return "데이터를 모두 지우지 못했어. 다시 시도해 줘.";
    }
    if ("error" in response) return response.error;
    // Every page starts over: nothing deleted may stay visible anywhere.
    set({
      ...fromBootstrap(response.bootstrap),
      memories: [],
      memoryQuery: "",
      memoryError: null,
      editNotes: [],
      pendingApprovals: [],
      streaming: null,
      activeTaskId: null,
      errorMessage: null,
      conversationError: null,
      characterState: "idle",
      progressMessage: null,
    });
    return null;
  },

  resetScreenNotice: async () => {
    set({ settingsError: null });
    try {
      await window.poko.screen.resetNotice();
      const status = await window.poko.screen.status();
      set({ screen: { ...get().screen, status } });
    } catch {
      set({ settingsError: "안내 설정을 바꾸지 못했어. 다시 시도해 줘." });
    }
  },
  editNotes: [],
  undoingEdit: null,

  loadEditNotes: async () => {
    const id = get().activeConversationId;
    if (!id) {
      set({ editNotes: [] });
      return;
    }
    try {
      const notes = await window.poko.edits.list(id);
      // Ignore a late answer for a conversation that is no longer shown.
      if (get().activeConversationId === id) set({ editNotes: notes });
    } catch {
      // Keep the notes already shown.
    }
  },

  undoEdit: async (id) => {
    if (get().undoingEdit) return null;
    set({ undoingEdit: id });
    try {
      const response = await window.poko.edits.undo(id);
      if ("error" in response) return response.error;
      await get().loadEditNotes();
      return null;
    } catch {
      return "되돌리지 못했어. 잠시 뒤 다시 시도해 줘.";
    } finally {
      set({ undoingEdit: null });
    }
  },

  loadEdits: async () => {
    try {
      const edits = await window.poko.edits.get();
      set({ edits: { available: edits.available, enabled: edits.enabled } });
    } catch {
      set({ edits: { available: false, enabled: false } });
    }
  },

  setEdits: async (enabled, confirmed = false) => {
    if (enabled && !confirmed) {
      set({ editsConfirmOpen: true });
      return;
    }
    try {
      const response = await window.poko.edits.set(enabled);
      if ("error" in response) {
        set({ errorMessage: response.error, editsConfirmOpen: false });
        return;
      }
      const declined = response.declined ?? [];
      set((state) => ({
        edits: { available: response.available, enabled: response.enabled },
        editsConfirmOpen: false,
        // Exactly the changes main declined (this folder's) leave the screen.
        pendingApprovals: state.pendingApprovals.filter(
          (item) =>
            !declined.some(
              (gone) => gone.taskId === item.taskId && gone.requestId === item.requestId,
            ),
        ),
      }));
    } catch {
      set({
        errorMessage: "수정 설정을 바꾸지 못했어. 잠시 뒤 다시 시도해 줘.",
        editsConfirmOpen: false,
      });
    }
  },

  closeEditsConfirm: () => set({ editsConfirmOpen: false }),

  conversations: [],
  activeConversationId: null,
  conversationError: null,

  newConversation: () => switchConversation(null),

  openConversation: (id) => switchConversation(id),

  renameConversation: async (id, title) => {
    try {
      const response = await window.poko.conversations.rename(id, title);
      if ("error" in response) return response.error;
    } catch {
      return "이름을 바꾸지 못했어. 잠시 뒤 다시 시도해 줘.";
    }
    const clean = title.replace(/\s+/g, " ").trim();
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === id ? { ...item, title: clean } : item,
      ),
    }));
    return null;
  },

  deleteConversation: async (id) => {
    try {
      const response = await window.poko.conversations.delete(id);
      if ("error" in response) return response.error;
    } catch {
      return "대화를 지우지 못했어. 잠시 뒤 다시 시도해 줘.";
    }
    const wasActive = get().activeConversationId === id;
    set((state) => ({
      conversations: state.conversations.filter((item) => item.id !== id),
      // Main already cleared it; show the greeting screen for a new conversation.
      ...(wasActive
        ? {
            activeConversationId: null,
            messages: [],
            editNotes: [],
            streaming: null,
            errorMessage: null,
            conversationError: null,
            characterState: "idle" as const,
            progressMessage: null,
          }
        : {}),
    }));
    return null;
  },

  initializeWorkspace: async () => {
    try {
      set(fromBootstrap(await window.poko.app.bootstrap()));
      void get().loadEdits();
      void get().loadEditNotes();
      // A task may already be running (started from the quick panel, or before a reload).
      const live = await window.poko.tasks.active().catch(() => null);
      if (live) {
        trackForeign(live.taskId, live.conversationId, live.approvals);
        if (live.conversationId) await adoptTask(live.taskId, live.conversationId);
      }
    } catch {
      set({ workspaceError: "저장된 대화와 폴더를 불러오지 못했어. 앱을 다시 시작해 줘." });
    }
  },

  loadMemories: async (query = "") => {
    try {
      const memories = await window.poko.memory.search(query);
      set({ memories, memoryError: null, memoryQuery: query });
    } catch {
      set({ memoryError: "기억을 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
    }
  },

  saveMemory: async (input) => {
    try {
      await window.poko.memory.save(input);
    } catch {
      set({ memoryError: "기억을 저장하지 못했어. 내용을 확인해 줘." });
      return false;
    }
    await get().loadMemories(get().memoryQuery);
    return true;
  },

  deleteMemory: async (id) => {
    try {
      await window.poko.memory.delete(id);
      await get().loadMemories(get().memoryQuery);
    } catch {
      set({ memoryError: "기억을 지우지 못했어. 다시 시도해 줘." });
    }
  },

  selectWorkspace: async () => {
    if (get().isSelectingWorkspace) return;
    set({ characterState: "listening", isSelectingWorkspace: true, workspaceError: null });

    try {
      const workspace = await window.poko.workspace.select();
      if (workspace) {
        set({ workspace, characterState: "success" });
        // Each folder keeps its own edit setting.
        void get().loadEdits();
        window.setTimeout(() => {
          if (!get().isSending && get().characterState === "success") {
            set({ characterState: "idle" });
          }
        }, 1500);
      } else {
        set({ characterState: "idle" });
      }
    } catch {
      set({
        characterState: "error",
        workspaceError: "폴더를 선택하지 못했어. 다시 시도해 줘.",
      });
    } finally {
      set({ isSelectingWorkspace: false });
    }
  },

  sendMessage: async (rawMessage) => {
    const content = rawMessage.trim();
    const current = get();
    if (!content || current.isSending) return;
    if (!current.workspace) {
      set({
        characterState: "error",
        errorMessage: "먼저 작업할 폴더를 선택해 줘.",
      });
      return;
    }
    await runTask(
      content,
      () => window.poko.tasks.start(content, get().activeConversationId),
      "작업을 시작하지 못했어. 폴더와 Codex 설정을 확인해 줘.",
    );
  },

  openScreen: async () => {
    set({ screen: { ...get().screen, open: true, error: null } });
    await get().refreshScreen();
  },

  closeScreen: () => set({ screen: { ...get().screen, open: false } }),

  refreshScreen: async () => {
    set({ screen: { ...get().screen, loading: true, error: null } });
    try {
      const status = await window.poko.screen.status();
      const ready =
        status.supported &&
        status.noticeAccepted &&
        status.permissions.accessibility &&
        status.permissions.screen;
      const windows = ready ? await window.poko.screen.listWindows() : [];
      set({ screen: { ...get().screen, status, windows, loading: false } });
    } catch {
      set({
        screen: {
          ...get().screen,
          loading: false,
          error: "화면 정보를 가져오지 못했어. 잠시 뒤 다시 시도해 줘.",
        },
      });
    }
  },

  acceptScreenNotice: async () => {
    try {
      await window.poko.screen.acceptNotice();
    } catch {
      set({ screen: { ...get().screen, error: "안내 확인을 저장하지 못했어. 다시 시도해 줘." } });
      return;
    }
    await get().refreshScreen();
  },

  openScreenSettings: (kind) => {
    void window.poko.screen.openSettings(kind);
  },

  actInWindow: async (windowId, goal) => {
    if (get().isSending || !goal.trim()) return false;
    const picked = get().screen.windows.find((window) => window.id === windowId);
    set({ screen: { ...get().screen, open: false } });
    return runTask(
      `🖱️ ${picked?.app ?? "앱"}에서 해 줘: ${goal.trim()}`,
      () => window.poko.screen.act(windowId, goal, get().activeConversationId),
      "화면 작업을 시작하지 못했어. 권한을 확인하고 다시 시도해 줘.",
    );
  },

  lookAtWindow: async (windowId, question) => {
    if (get().isSending) return false;
    const picked = get().screen.windows.find((window) => window.id === windowId);
    const asked = question.trim() || "이 화면을 설명해 줘.";
    set({ screen: { ...get().screen, open: false } });
    return runTask(
      `🖥️ ${picked?.app ?? "앱"} 화면 보기: ${asked}`,
      () => window.poko.screen.look(windowId, question, get().activeConversationId),
      "화면을 가져오지 못했어. 권한을 확인하고 다시 시도해 줘.",
    );
  },

  cancelTask: async () => {
    const taskId = get().activeTaskId;
    if (!taskId) return;
    try {
      await window.poko.tasks.cancel(taskId);
    } catch {
      set({ errorMessage: "작업을 멈추지 못했어. 잠시 뒤 다시 시도해 줘." });
    }
  },

  respondToApproval: async (choice) => {
    const approval = get().pendingApprovals[0];
    if (!approval || get().isRespondingToApproval) return;
    set({ isRespondingToApproval: true });
    let outcome: ApprovalOutcome = "stale";
    try {
      outcome = await window.poko.approvals.respond(approval.taskId, approval.requestId, choice);
    } catch {
      outcome = "stale";
    }
    const messages: Record<ApprovalOutcome, { progress: string; activity: string }> = {
      applied:
        choice === "approve"
          ? {
              progress: "확인한 작업을 한 번 진행하고 있어.",
              activity: "확인했어. 이 요청을 한 번 진행할게.",
            }
          : { progress: "요청을 거절하고 이어서 살펴보고 있어.", activity: "요청을 거절했어." },
      declined_unsafe: {
        progress: "안전하지 않은 변경이라 거절하고 이어서 살펴보고 있어.",
        activity: "지금은 안전하게 적용할 수 없는 변경이라 거절했어.",
      },
      stale: {
        progress: "이 확인 요청은 이미 끝났어.",
        activity: "확인 요청이 이미 끝나서 적용하지 않았어.",
      },
    };
    const { progress, activity } = messages[outcome];
    useAppStore.setState((state) => {
      const pendingApprovals = state.pendingApprovals.filter(
        (item) => item.taskId !== approval.taskId || item.requestId !== approval.requestId,
      );
      if (pendingApprovals.length === state.pendingApprovals.length) {
        return { isRespondingToApproval: false };
      }
      const stillWaiting = pendingApprovals.some((item) => item.taskId === approval.taskId);
      return {
        isRespondingToApproval: false,
        pendingApprovals,
        characterState: stillWaiting ? "approval" : "working",
        progressMessage: progress,
        tasks: state.tasks.map((task) =>
          task.id === approval.taskId && task.status === "waiting_approval" && !stillWaiting
            ? { ...task, status: "running" as const }
            : task,
        ),
        activities: addActivity(state, approval.taskId, activity),
      };
    });
  },

  setActiveView: (activeView) => set({ activeView }),
  clearError: () => set({ errorMessage: null, workspaceError: null }),
}));

/** A running task this window didn't start, kept until the window takes it over or it ends. */
interface ForeignTask {
  conversationId: string | null;
  approvals: Map<string, PendingApproval>;
}
const foreignTasks = new Map<string, ForeignTask>();
/** Events held while this window's own send waits for its task id (null: not starting). */
let startingSend: TaskEventPayload[] | null = null;
/** A task being taken over: its events are held until its conversation is on screen. */
let adopting: { taskId: string; held: TaskEventPayload[] } | null = null;

/** The only task-event listener: each event goes to the shown task or to foreign handling. */
function routeTaskEvent(payload: TaskEventPayload): void {
  if (startingSend) {
    startingSend.push(payload);
    return;
  }
  if (adopting && payload.taskId === adopting.taskId) {
    adopting.held.push(payload);
    return;
  }
  if (payload.taskId === useAppStore.getState().activeTaskId) {
    applyTaskEvent(payload);
    return;
  }
  applyForeignEvent(payload);
}

function trackForeign(
  taskId: string,
  conversationId: string | null,
  approvals: PendingApproval[] = [],
): ForeignTask {
  const task = foreignTasks.get(taskId) ?? { conversationId, approvals: new Map() };
  task.conversationId ??= conversationId;
  for (const approval of approvals) task.approvals.set(approval.requestId, approval);
  foreignTasks.set(taskId, task);
  useAppStore.setState({
    busyElsewhere: true,
    ...(task.approvals.size > 0
      ? { foreignApproval: { conversationId: task.conversationId } }
      : {}),
  });
  return task;
}

/** A task this window doesn't show: lists, Activity, and its cards kept aside (never shown). */
function applyForeignEvent(payload: TaskEventPayload): void {
  const { taskId, event } = payload;
  if (event.type === "output") {
    trackForeign(taskId, null);
    return;
  }
  const status = sessionTaskStatus(event);
  const waitingForUser = event.type === "approvalRequired" && event.canApprove;
  if (status === null) trackForeign(taskId, null, waitingForUser ? [{ ...event, taskId }] : []);
  else foreignTasks.delete(taskId);
  const message = activityText(event);
  const timestamp = new Date().toISOString();
  useAppStore.setState((state) => ({
    tasks: state.tasks.map((task) =>
      task.id !== taskId
        ? task
        : status
          ? { ...task, status, completedAt: timestamp }
          : waitingForUser
            ? { ...task, status: "waiting_approval" as const }
            : task,
    ),
    activities: message ? addActivity(state, taskId, message) : state.activities,
    busyElsewhere: foreignTasks.size > 0,
    foreignApproval: [...foreignTasks.values()].some((task) => task.approvals.size > 0)
      ? state.foreignApproval
      : null,
  }));
}

/**
 * Takes over a running task started elsewhere: its conversation is shown and its stream,
 * cards, and end apply here as if this window had sent it. The task id is set first and its
 * events are held while the conversation loads; if it ended meanwhile, the window stays idle.
 */
async function adoptTask(taskId: string, conversationId: string): Promise<void> {
  if (adopting || startingSend) return;
  const set = useAppStore.setState;
  const foreign = trackForeign(taskId, conversationId);
  adopting = { taskId, held: [] };
  set({ activeTaskId: taskId });
  // On failure the task stays foreign, and the events held meanwhile go to it, not away.
  const giveBack = (): void => {
    const held = adopting?.held ?? [];
    adopting = null;
    for (const payload of held) applyForeignEvent(payload);
  };
  try {
    const response = await window.poko.conversations.open(conversationId);
    if ("error" in response) {
      set({ conversationError: response.error, activeTaskId: null });
      giveBack();
      return;
    }
    const live = await window.poko.tasks.active().catch(() => null);
    const running = live?.taskId === taskId;
    const answerSoFar = running ? live?.answer : undefined;
    for (const approval of live?.approvals ?? [])
      foreign.approvals.set(approval.requestId, approval);
    foreignTasks.delete(taskId);
    const approvals = running ? [...foreign.approvals.values()] : [];
    set({
      activeView: "conversation",
      activeConversationId: conversationId,
      messages: response.messages,
      editNotes: [],
      // The answer written before the take-over, so the stream continues it.
      streaming: answerSoFar ? { taskId, itemId: null, text: answerSoFar } : null,
      errorMessage: null,
      conversationError: null,
      activeTaskId: running ? taskId : null,
      isSending: running,
      pendingApprovals: approvals,
      characterState: running ? (approvals.length > 0 ? "approval" : "working") : "idle",
      progressMessage: running
        ? approvals.length > 0
          ? "네 확인을 기다리고 있어."
          : "포코가 작업하고 있어."
        : null,
      busyElsewhere: foreignTasks.size > 0,
      foreignApproval: null,
    });
    const held = adopting.held;
    adopting = null;
    if (running) for (const payload of held) routeTaskEvent(payload);
    else {
      // It ended while loading: the saved conversation now holds its final answer.
      const again = await window.poko.conversations.open(conversationId).catch(() => null);
      if (again && !("error" in again)) set({ messages: again.messages });
      for (const payload of held)
        if (sessionTaskStatus(payload.event) !== null) applyForeignEvent(payload);
    }
    void useAppStore.getState().loadEditNotes();
  } catch {
    set({
      conversationError: "대화를 불러오지 못했어. 잠시 뒤 다시 시도해 줘.",
      activeTaskId: null,
    });
    giveBack();
  } finally {
    adopting = null;
  }
}

/** A conversation main asked to show: adopt its running task, or just switch to it. */
async function focusConversation(conversationId: string): Promise<void> {
  const live = await window.poko.tasks.active().catch(() => null);
  if (
    live &&
    live.conversationId === conversationId &&
    live.taskId !== useAppStore.getState().activeTaskId
  ) {
    trackForeign(live.taskId, live.conversationId, live.approvals);
    await adoptTask(live.taskId, conversationId);
    return;
  }
  await switchConversation(conversationId);
  useAppStore.setState({ activeView: "conversation" });
}

// Subscribed once for the app's lifetime; absent where there is no preload (Node tests).
const poko = typeof window === "undefined" ? undefined : window.poko;
poko?.tasks?.onEvent?.(routeTaskEvent);
poko?.tasks?.onStarted?.((notice) => {
  trackForeign(notice.taskId, notice.conversation.id);
  const createdAt = new Date().toISOString();
  useAppStore.setState((state) => ({
    conversations: [
      notice.conversation,
      ...state.conversations.filter((item) => item.id !== notice.conversation.id),
    ],
    tasks: [
      { id: notice.taskId, title: notice.title, status: "running" as const, createdAt },
      ...state.tasks.filter((task) => task.id !== notice.taskId),
    ].slice(0, 50),
  }));
});
poko?.app?.onFocusConversation?.((id) => void focusConversation(id));

/**
 * Shows a conversation (null: a new, empty one). Main refuses while a task runs, so a running
 * task's messages, stream, and approval card stay in their own conversation.
 */
async function switchConversation(id: string | null): Promise<void> {
  const set = useAppStore.setState;
  const state = useAppStore.getState();
  // The conversation of a task started elsewhere: show it and take the task over.
  const foreign = [...foreignTasks.entries()].find(([, task]) => task.conversationId === id);
  if (foreign && id !== null) {
    await adoptTask(foreign[0], id);
    return;
  }
  // Going back to the conversation already shown is always fine, even while Poko works.
  if (id === state.activeConversationId && id !== null) {
    set({ activeView: "conversation", conversationError: null });
    return;
  }
  if (state.isSending) {
    set({
      conversationError: "포코가 작업 중이라 다른 대화로 옮길 수 없어. 끝난 뒤에 다시 골라 줘.",
    });
    return;
  }
  if (switching) return;
  switching = true;
  try {
    const response = await window.poko.conversations.open(id);
    // Sending waits for a switch (see runTask), but a running task's conversation must stay on
    // screen, so check again before replacing the messages.
    if (useAppStore.getState().isSending) return;
    if ("error" in response) {
      set({ conversationError: response.error });
      return;
    }
    set({
      activeView: "conversation",
      activeConversationId: id,
      editNotes: [],
      messages: response.messages,
      streaming: null,
      errorMessage: null,
      conversationError: null,
      characterState: "idle",
      progressMessage: null,
    });
    void useAppStore.getState().loadEditNotes();
  } catch {
    set({ conversationError: "대화를 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
  } finally {
    switching = false;
  }
}

/** True while a conversation is loading; a message can't be sent until it is shown. */
let switching = false;

/**
 * Shows the user's message, starts a task, and follows its events until it ends. `start`
 * returns the new task id, or an `error` to show instead. Resolves true when the task started.
 */
async function runTask(
  content: string,
  start: () => Promise<{ taskId: string; conversation: PersistedConversation } | { error: string }>,
  failure: string,
): Promise<boolean> {
  const set = useAppStore.setState;
  if (switching || adopting) return false;
  if (useAppStore.getState().busyElsewhere) {
    set({ conversationError: "포코가 다른 작업 중이야. 끝난 뒤에 다시 보내 줘." });
    return false;
  }
  const userMessage = createMessage("user", content);
  set((state) => ({
    activeView: "conversation",
    characterState: "thinking",
    errorMessage: null,
    conversationError: null,
    isSending: true,
    progressMessage: "포코가 요청을 살펴보고 있어.",
    messages: [...state.messages, userMessage],
  }));

  // Until the start reply names the task, every event is held (see routeTaskEvent), then each
  // goes where it belongs: this task's to the window, any other to foreign handling.
  startingSend = [];
  const release = (): void => {
    const held = startingSend ?? [];
    startingSend = null;
    for (const payload of held) routeTaskEvent(payload);
  };

  const fail = (error: string) => {
    set((state) => ({
      characterState: "error",
      errorMessage: error,
      isSending: false,
      activeTaskId: null,
      progressMessage: null,
      messages: [...state.messages, createMessage("assistant", error)],
    }));
  };

  try {
    const response = await start();
    if ("error" in response) {
      fail(response.error);
      release();
      return false;
    }
    const startedTaskId = response.taskId;
    const createdAt = new Date().toISOString();
    const { conversation } = response;
    set((state) => ({
      activeTaskId: startedTaskId,
      // A new conversation is created with its first message; either way it moves to the top.
      activeConversationId: conversation.id,
      conversations: [
        conversation,
        ...state.conversations.filter((item) => item.id !== conversation.id),
      ],
      tasks: [
        { id: startedTaskId, title: content, status: "running" as const, createdAt },
        ...state.tasks.filter((task) => task.id !== startedTaskId),
      ].slice(0, 50),
    }));
    release();
    return true;
  } catch {
    fail(failure);
    release();
    return false;
  }
}

/** Progress text while Codex is writing the answer itself. */
export const OUTPUT_PROGRESS = "답변을 쓰고 있어.";
const PAUSED_PROGRESS = "이어서 살펴보고 있어.";
/** Without new text for this long, Codex is likely doing other work (reasoning, file changes). */
const OUTPUT_PAUSE_MS = 1500;
let outputPauseTimer: number | undefined;

// Deltas arrive per token; render them at most once per frame.
const deltaBuffer = createDeltaBuffer((deltas) =>
  useAppStore.setState((state) => ({ streaming: applyDeltas(state.streaming, deltas) })),
);

function applyTaskEvent(payload: TaskEventPayload): void {
  const { taskId, event } = payload;
  if (event.type === "output") {
    deltaBuffer.push({ taskId, itemId: event.itemId ?? null, content: event.content });
    const state = useAppStore.getState();
    if (state.pendingApprovals.length === 0 && state.progressMessage !== OUTPUT_PROGRESS) {
      useAppStore.setState({ characterState: "working", progressMessage: OUTPUT_PROGRESS });
    }
    window.clearTimeout(outputPauseTimer);
    outputPauseTimer = window.setTimeout(() => {
      const current = useAppStore.getState();
      if (current.isSending && current.progressMessage === OUTPUT_PROGRESS) {
        useAppStore.setState({ progressMessage: PAUSED_PROGRESS });
      }
    }, OUTPUT_PAUSE_MS);
    return;
  }
  window.clearTimeout(outputPauseTimer);
  const message = activityText(event);
  const status = sessionTaskStatus(event);
  const timestamp = new Date().toISOString();
  // The saved result (or the error/cancel message) replaces the partial answer, which is never kept.
  if (status !== null) deltaBuffer.discard(taskId);

  useAppStore.setState((state) => {
    const messages =
      event.type === "completed"
        ? [...state.messages, createMessage("assistant", event.result)]
        : event.type === "error" || event.type === "cancelled"
          ? [
              ...state.messages,
              createMessage("assistant", event.type === "error" ? event.error : "요청을 멈췄어."),
            ]
          : state.messages;

    const waitingForUser = event.type === "approvalRequired" && event.canApprove;
    const tasks = state.tasks.map((task) =>
      task.id !== taskId
        ? task
        : status
          ? { ...task, status, completedAt: timestamp }
          : waitingForUser
            ? { ...task, status: "waiting_approval" as const }
            : task,
    );
    const known = state.pendingApprovals.some(
      (item) => item.taskId === taskId && item.requestId === (event as PendingApproval).requestId,
    );
    const pendingApprovals = waitingForUser
      ? known
        ? state.pendingApprovals
        : [...state.pendingApprovals, { ...event, taskId }]
      : status === null
        ? state.pendingApprovals
        : state.pendingApprovals.filter((item) => item.taskId !== taskId);

    return {
      characterState:
        status === null && pendingApprovals.length > 0 ? "approval" : eventCharacterState(event),
      errorMessage: event.type === "error" ? event.error : null,
      isSending: status === null,
      activeTaskId: status === null ? state.activeTaskId : null,
      streaming: status !== null && state.streaming?.taskId === taskId ? null : state.streaming,
      pendingApprovals,
      progressMessage:
        event.type === "thinking"
          ? (event.message ?? "요청을 살펴보고 있어.")
          : event.type === "tool"
            ? (event.detail ?? "프로젝트를 살펴보고 있어.")
            : waitingForUser
              ? "네 확인을 기다리고 있어."
              : status === null
                ? state.progressMessage
                : null,
      messages,
      tasks,
      activities: message ? addActivity(state, taskId, message) : state.activities,
    };
  });

  if (status !== null && status !== "failed" && status !== "cancelled") {
    window.setTimeout(() => {
      const state = useAppStore.getState();
      if (!state.isSending && state.characterState === "success") {
        useAppStore.setState({ characterState: "idle" });
      }
    }, 1600);
  }
}
