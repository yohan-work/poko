import { create } from "zustand";
import type {
  AgentEvent,
  ApprovalChoice,
  AppView,
  CharacterState,
  TaskEventPayload,
  WorkspaceInfo,
  PersistedMemory,
  MemoryInput,
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

export type PendingApproval = Extract<AgentEvent, { type: "approvalRequired" }> & {
  taskId: string;
};

export interface SessionTask {
  id: string;
  title: string;
  status: "running" | "waiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  completedAt?: string;
}

interface AppState {
  activeView: AppView;
  characterState: CharacterState;
  isSending: boolean;
  isSelectingWorkspace: boolean;
  messages: ConversationMessage[];
  activities: ActivityEntry[];
  tasks: SessionTask[];
  activeTaskId: string | null;
  /** Oldest first; Codex may ask again before the user answers. */
  pendingApprovals: PendingApproval[];
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

export const useAppStore = create<AppState>((set, get) => ({
  activeView: "conversation",
  characterState: "idle",
  isSending: false,
  isSelectingWorkspace: false,
  messages: [],
  activities: [],
  tasks: [],
  activeTaskId: null,
  pendingApprovals: [],
  isRespondingToApproval: false,
  progressMessage: null,
  workspace: null,
  errorMessage: null,
  workspaceError: null,
  memories: [],
  memoryError: null,
  memoryQuery: "",

  initializeWorkspace: async () => {
    try {
      const data = await window.poko.app.bootstrap();
      set({
        workspace: data.workspace,
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
      });
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

    const userMessage = createMessage("user", content);
    set((state) => ({
      activeView: "conversation",
      characterState: "thinking",
      errorMessage: null,
      isSending: true,
      progressMessage: "포코가 요청을 살펴보고 있어.",
      messages: [...state.messages, userMessage],
    }));

    let taskId: string | null = null;
    let unsubscribe = (): void => {};
    const pendingEvents: TaskEventPayload[] = [];
    const onTaskEvent = (payload: TaskEventPayload): void => {
      if (!taskId) {
        pendingEvents.push(payload);
        return;
      }
      if (payload.taskId !== taskId) return;
      applyTaskEvent(payload);
      if (sessionTaskStatus(payload.event) !== null) unsubscribe();
    };

    try {
      unsubscribe = window.poko.tasks.onEvent(onTaskEvent);
      const response = await window.poko.tasks.start(content);
      const startedTaskId = response.taskId;
      taskId = startedTaskId;
      const createdAt = new Date().toISOString();
      set((state) => ({
        activeTaskId: startedTaskId,
        tasks: [
          { id: startedTaskId, title: content, status: "running" as const, createdAt },
          ...state.tasks.filter((task) => task.id !== startedTaskId),
        ].slice(0, 50),
      }));
      const queued = pendingEvents.splice(0);
      for (const payload of queued) onTaskEvent(payload);
    } catch {
      unsubscribe();
      const error = "작업을 시작하지 못했어. 폴더와 Codex 설정을 확인해 줘.";
      set((state) => ({
        characterState: "error",
        errorMessage: error,
        isSending: false,
        activeTaskId: null,
        progressMessage: null,
        messages: [...state.messages, createMessage("assistant", error)],
      }));
    }
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
    let accepted = false;
    try {
      accepted = await window.poko.approvals.respond(approval.taskId, approval.requestId, choice);
    } catch {
      accepted = false;
    }
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
        progressMessage: accepted
          ? choice === "approve"
            ? "확인한 작업을 한 번 진행하고 있어."
            : "요청을 거절하고 이어서 살펴보고 있어."
          : "이 확인 요청은 이미 끝났어.",
        tasks: state.tasks.map((task) =>
          task.id === approval.taskId && task.status === "waiting_approval" && !stillWaiting
            ? { ...task, status: "running" as const }
            : task,
        ),
        activities: addActivity(
          state,
          approval.taskId,
          accepted
            ? choice === "approve"
              ? "확인했어. 이 요청을 한 번 진행할게."
              : "요청을 거절했어."
            : "확인 요청이 이미 끝나서 적용하지 않았어.",
        ),
      };
    });
  },

  setActiveView: (activeView) => set({ activeView }),
  clearError: () => set({ errorMessage: null, workspaceError: null }),
}));

function applyTaskEvent(payload: TaskEventPayload): void {
  const { taskId, event } = payload;
  const message = activityText(event);
  const status = sessionTaskStatus(event);
  const timestamp = new Date().toISOString();

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
    const pendingApprovals = waitingForUser
      ? [...state.pendingApprovals, { ...event, taskId }]
      : status === null
        ? state.pendingApprovals
        : state.pendingApprovals.filter((item) => item.taskId !== taskId);

    return {
      characterState:
        status === null && pendingApprovals.length > 0 ? "approval" : eventCharacterState(event),
      errorMessage: event.type === "error" ? event.error : null,
      isSending: status === null,
      activeTaskId: status === null ? state.activeTaskId : null,
      pendingApprovals,
      progressMessage:
        event.type === "output"
          ? "프로젝트 내용을 정리하고 있어."
          : event.type === "thinking"
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
