import type { ApprovalOutcome } from "../../../../../electron/shared";
import { cleanAttachmentName } from "../../../../../electron/shared";
import { adoptTask, foreignTasks, runTask, switchConversation, trackForeign } from "../taskFlow";
import { addActivity, fromBootstrap } from "../taskHelpers";
import type { ConversationSlice, Slice } from "../types";

/** Counts busy notes under the folder button, so only the latest one clears itself. */
let busyNotes = 0;

export const conversationSlice: Slice<ConversationSlice> = (set, get) => ({
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
  progressMessage: null,
  workspace: null,
  errorMessage: null,
  workspaceError: null,

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

  folderGone: null,
  retryable: null,
  composerPrefill: null,

  retryLast: async () => {
    const retry = get().retryable;
    if (!retry || get().isSending || retry.conversationId !== get().activeConversationId) return;
    set({ retryable: null });
    // Refused (busy, another folder): offered again, nothing was recorded. A start that
    // failed offers it again by itself.
    if ((await get().sendMessage(retry.question)) === "refused") set({ retryable: retry });
  },

  editLastQuestion: () => {
    // The question 다시 시도 would send, so the two buttons always mean the same one.
    const retry = get().retryable;
    if (!retry || retry.conversationId !== get().activeConversationId) return;
    set({
      composerPrefill: { text: retry.question, nonce: (get().composerPrefill?.nonce ?? 0) + 1 },
    });
  },

  takeComposerPrefill: () => set({ composerPrefill: null }),

  switchToConversationFolder: async () => {
    const id = get().activeConversationId;
    if (!id) return;
    const response = await window.poko.workspace
      .switchToConversationFolder(id)
      .catch(() => ({ error: "폴더를 바꾸지 못했어. 다시 시도해 줘." }));
    if ("error" in response) {
      // A folder that is gone can't be switched to; the line then says so instead.
      set({
        conversationError: response.error,
        ...("gone" in response && response.gone ? { folderGone: id } : {}),
      });
      return;
    }
    set({
      workspace: response.workspace,
      conversationError: null,
      workspaceError: null,
      folderGone: null,
    });
    // Each folder keeps its own edit setting.
    void get().loadEdits();
  },

  selectWorkspace: async () => {
    if (get().isSelectingWorkspace) return;
    set({ characterState: "listening", isSelectingWorkspace: true, workspaceError: null });

    try {
      const workspace = await window.poko.workspace.select();
      if (workspace && "error" in workspace) {
        // Busy is passing: the note clears itself instead of staying as an error.
        set({ characterState: "idle", workspaceError: workspace.error });
        const note = ++busyNotes;
        window.setTimeout(() => {
          // Only the latest note clears itself; a newer one gets its own 4 seconds.
          if (note === busyNotes && get().workspaceError === workspace.error)
            set({ workspaceError: null });
        }, 4000);
      } else if (workspace) {
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

  sendMessage: async (rawMessage, attachments = []) => {
    const message = rawMessage.trim();
    const current = get();
    if ((!message && attachments.length === 0) || current.isSending) return "refused";
    // Shown the way main records it, so the conversation reads the same after a reload.
    const line = attachments.length
      ? `📎 ${attachments.map((item) => cleanAttachmentName(item.name)).join(", ")}`
      : "";
    const content = line ? (message ? `${message}\n\n${line}` : line) : message;
    if (!current.workspace) {
      set({
        characterState: "error",
        errorMessage: "먼저 작업할 폴더를 선택해 줘.",
      });
      return "refused";
    }
    // Not asked (switching, busy) or a reply with an error: main recorded nothing.
    let asked = false;
    let refused = false;
    const started = await runTask(
      content,
      async () => {
        asked = true;
        const sentFrom = get().activeConversationId;
        const response = await window.poko.tasks.start(message, sentFrom, attachments);
        if ("error" in response) {
          refused = true;
          // The folder is gone: the line offers a new conversation instead of a switch. Only
          // if the conversation it was sent from is still the one shown.
          if (response.gone && get().activeConversationId === sentFrom)
            set({ folderGone: sentFrom });
        }
        return response;
      },
      "작업을 시작하지 못했어. 폴더와 Codex 설정을 확인해 줘.",
    );
    return started ? "started" : refused || !asked ? "refused" : "failed";
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
    set((state) => {
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
});
