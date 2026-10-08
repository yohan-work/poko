import type { StoreApi } from "zustand";
import type { PersistedConversation, TaskEventPayload } from "../../../../electron/shared";
import { applyDeltas, createDeltaBuffer } from "../lib/streaming";
import {
  activityText,
  addActivity,
  createMessage,
  eventCharacterState,
  sessionTaskStatus,
  questionText,
} from "./taskHelpers";
import type { AppState, PendingApproval } from "./types";

/**
 * How tasks reach the window: the window's own sends, tasks started elsewhere (the quick
 * panel) and taken over, and each event routed to the shown task or kept aside.
 */
let store: StoreApi<AppState>;

/** A running task this window didn't start, kept until the window takes it over or it ends. */
interface ForeignTask {
  conversationId: string | null;
  approvals: Map<string, PendingApproval>;
}
export const foreignTasks = new Map<string, ForeignTask>();
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
  if (payload.taskId === store.getState().activeTaskId) {
    applyTaskEvent(payload);
    return;
  }
  applyForeignEvent(payload);
}

export function trackForeign(
  taskId: string,
  conversationId: string | null,
  approvals: PendingApproval[] = [],
): ForeignTask {
  const task = foreignTasks.get(taskId) ?? { conversationId, approvals: new Map() };
  task.conversationId ??= conversationId;
  for (const approval of approvals) task.approvals.set(approval.requestId, approval);
  foreignTasks.set(taskId, task);
  store.setState({
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
  store.setState((state) => ({
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
export async function adoptTask(taskId: string, conversationId: string): Promise<void> {
  if (adopting || startingSend) return;
  const set = store.setState;
  const foreign = trackForeign(taskId, conversationId);
  // This call's own hold: a later take-over must never have its hold cleared by this one.
  const mine: { taskId: string; held: TaskEventPayload[] } = { taskId, held: [] };
  adopting = mine;
  const release = (): void => {
    if (adopting === mine) adopting = null;
  };
  set({ activeTaskId: taskId });
  // On failure the task stays foreign, and the events held meanwhile go to it, not away.
  const giveBack = (): void => {
    release();
    for (const payload of mine.held) applyForeignEvent(payload);
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
      streaming: answerSoFar
        ? { taskId, itemId: answerSoFar.itemId, text: answerSoFar.text }
        : null,
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
      retryable: null,
    });
    // Taken out before replaying, so a failure while replaying can't give them back twice.
    const held = mine.held.splice(0);
    release();
    // Text held during the take-over is already in the answer snapshot (main sent it before
    // answering task:active), so only the other events are replayed then.
    if (running) {
      for (const payload of held) {
        if (!answerSoFar || payload.event.type !== "output") routeTaskEvent(payload);
      }
    } else {
      // It ended while loading: the saved conversation now holds its final answer.
      const again = await window.poko.conversations.open(conversationId).catch(() => null);
      if (again && !("error" in again)) set({ messages: again.messages, retryable: null });
      for (const payload of held) {
        if (sessionTaskStatus(payload.event) !== null) applyForeignEvent(payload);
      }
    }
    void store.getState().loadEditNotes();
  } catch {
    set({
      conversationError: "대화를 불러오지 못했어. 잠시 뒤 다시 시도해 줘.",
      activeTaskId: null,
    });
    giveBack();
  } finally {
    release();
  }
}

/** A conversation main asked to show: adopt its running task, or just switch to it. */
async function focusConversation(conversationId: string): Promise<void> {
  const live = await window.poko.tasks.active().catch(() => null);
  if (
    live &&
    live.conversationId === conversationId &&
    live.taskId !== store.getState().activeTaskId
  ) {
    trackForeign(live.taskId, live.conversationId, live.approvals);
    await adoptTask(live.taskId, conversationId);
    return;
  }
  // Already on screen (a routine that ran in the background): load it again, so its new
  // messages show.
  const state = store.getState();
  if (state.activeConversationId === conversationId && !state.isSending) {
    const response = await window.poko.conversations.open(conversationId).catch(() => null);
    const now = store.getState();
    // Only if that conversation is still the one on screen.
    if (
      response &&
      !("error" in response) &&
      !now.isSending &&
      now.activeConversationId === conversationId
    )
      store.setState({ messages: response.messages, conversationError: null, retryable: null });
  } else await switchConversation(conversationId);
  store.setState({ activeView: "conversation" });
}

/**
 * Shows a conversation (null: a new, empty one). Main refuses while a task runs, so a running
 * task's messages, stream, and approval card stay in their own conversation.
 */
export async function switchConversation(id: string | null): Promise<void> {
  const set = store.setState;
  const state = store.getState();
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
    if (store.getState().isSending) return;
    if ("error" in response) {
      set({ conversationError: response.error });
      return;
    }
    set({
      activeView: "conversation",
      activeConversationId: id,
      editNotes: [],
      memorySuggestion: null,
      memorySuggestionError: null,
      // Checked again when it is next used, so a folder that came back works.
      folderGone: null,
      retryable: null,
      messages: response.messages,
      streaming: null,
      errorMessage: null,
      conversationError: null,
      characterState: "idle",
      progressMessage: null,
    });
    void store.getState().loadEditNotes();
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
export async function runTask(
  content: string,
  start: () => Promise<{ taskId: string; conversation: PersistedConversation } | { error: string }>,
  failure: string,
): Promise<boolean> {
  const set = store.setState;
  if (switching || adopting) return false;
  if (store.getState().busyElsewhere) {
    set({ conversationError: "포코가 다른 작업 중이야. 끝난 뒤에 다시 보내 줘." });
    return false;
  }
  const userMessage = createMessage("user", content);
  set((state) => ({
    activeView: "conversation",
    characterState: "thinking",
    errorMessage: null,
    conversationError: null,
    retryable: null,
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
    // A start that failed can be tried again, as with an answer that failed.
    const question = questionText(content);
    set((state) => ({
      characterState: "error",
      errorMessage: error,
      isSending: false,
      activeTaskId: null,
      progressMessage: null,
      messages: [...state.messages, createMessage("assistant", error)],
      retryable: question ? { conversationId: state.activeConversationId, question } : null,
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
  store.setState((state) => ({ streaming: applyDeltas(state.streaming, deltas) })),
);

function applyTaskEvent(payload: TaskEventPayload): void {
  const { taskId, event } = payload;
  if (event.type === "output") {
    deltaBuffer.push({ taskId, itemId: event.itemId ?? null, content: event.content });
    const state = store.getState();
    if (state.pendingApprovals.length === 0 && state.progressMessage !== OUTPUT_PROGRESS) {
      store.setState({ characterState: "working", progressMessage: OUTPUT_PROGRESS });
    }
    window.clearTimeout(outputPauseTimer);
    outputPauseTimer = window.setTimeout(() => {
      const current = store.getState();
      if (current.isSending && current.progressMessage === OUTPUT_PROGRESS) {
        store.setState({ progressMessage: PAUSED_PROGRESS });
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

  store.setState((state) => {
    const messages =
      event.type === "completed"
        ? [...state.messages, createMessage("assistant", event.result)]
        : event.type === "error" || event.type === "cancelled"
          ? [
              ...state.messages,
              createMessage("assistant", event.type === "error" ? event.error : "요청을 멈췄어."),
            ]
          : state.messages;

    // A failed or stopped answer can be asked again, as it was.
    const lastQuestion =
      event.type === "error" || event.type === "cancelled"
        ? [...state.messages].reverse().find((item) => item.role === "user")
        : undefined;
    const question = lastQuestion ? questionText(lastQuestion.content) : null;
    const retryable =
      status === null
        ? state.retryable
        : question
          ? { conversationId: state.activeConversationId, question }
          : null;

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
      // A new answer replaces an unanswered suggestion; a suggestion comes with its answer.
      memorySuggestion:
        event.type === "completed"
          ? event.memory
            ? { ...event.memory, taskId }
            : null
          : status
            ? null
            : state.memorySuggestion,
      // An error belongs to the card it was shown on.
      memorySuggestionError: status ? null : state.memorySuggestionError,
      retryable,
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
      const state = store.getState();
      if (!state.isSending && state.characterState === "success") {
        store.setState({ characterState: "idle" });
      }
    }, 1600);
  }
}

/**
 * Connects the task flow to the store and, where there is a preload (not in Node tests),
 * subscribes once for the app's lifetime to main's task events and notices.
 */
export function connectTaskFlow(created: StoreApi<AppState>): void {
  store = created;
  const poko = typeof window === "undefined" ? undefined : window.poko;
  poko?.tasks?.onEvent?.(routeTaskEvent);
  poko?.tasks?.onStarted?.((notice) => {
    trackForeign(notice.taskId, notice.conversation.id);
    const createdAt = new Date().toISOString();
    store.setState((state) => ({
      conversations: [
        notice.conversation,
        ...state.conversations.filter((item) => item.id !== notice.conversation.id),
      ],
      tasks: [
        { id: notice.taskId, title: notice.title, status: "running" as const, createdAt },
        ...state.tasks.filter((task) => task.id !== notice.taskId),
      ].slice(0, 50),
    }));
    // A run in the conversation on screen (a routine's) is taken over, so it shows live.
    const state = store.getState();
    if (
      state.activeView === "conversation" &&
      state.activeConversationId === notice.conversation.id &&
      !state.isSending
    )
      void adoptTask(notice.taskId, notice.conversation.id);
  });
  poko?.app?.onFocusConversation?.((id) => void focusConversation(id));
}
