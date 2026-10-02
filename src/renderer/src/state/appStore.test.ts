import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveTaskInfo,
  AgentEvent,
  PersistedConversation,
  TaskEventPayload,
  TaskStartedNotice,
} from "../../../../electron/shared";

/**
 * The renderer's task flows, against a fake preload bridge. These pin down races and states
 * that earlier reviews found: events before the start reply, switching while sending, and
 * cards removed by the edit switch.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const conversation = (id: string, title = id): PersistedConversation => ({
  id,
  title,
  updatedAt: "2026-10-02T00:00:00.000Z",
});

function fakePoko() {
  const listeners = new Set<(payload: TaskEventPayload) => void>();
  const startedListeners = new Set<(notice: TaskStartedNotice) => void>();
  let activeReply: ActiveTaskInfo | null = null;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    <T>(method: string, result: (...args: unknown[]) => T) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return result(...args);
    };
  const startReply = deferred<unknown>();
  const openReply = deferred<unknown>();
  const settingsReply = deferred<unknown>();
  const screenReply = deferred<unknown>();
  const poko = {
    tasks: {
      start: record("tasks.start", () => startReply.promise),
      cancel: record("tasks.cancel", async () => true),
      onEvent: (listener: (payload: TaskEventPayload) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      active: record("tasks.active", async () => activeReply),
      onStarted: (listener: (notice: TaskStartedNotice) => void) => {
        startedListeners.add(listener);
        return () => startedListeners.delete(listener);
      },
    },
    conversations: {
      open: record("conversations.open", () => openReply.promise),
      rename: record("conversations.rename", async () => ({ ok: true })),
      delete: record("conversations.delete", async () => ({ ok: true })),
    },
    edits: {
      list: record("edits.list", async () => []),
      set: record("edits.set", async () => ({
        available: true,
        enabled: false,
        declined: [] as Array<{ taskId: string; requestId: string }>,
      })),
    },
    approvals: { respond: record("approvals.respond", async () => "applied") },
    settings: {
      get: record("settings.get", () => settingsReply.promise),
      set: record("settings.set", async (change) => ({
        memoriesInContext: true,
        checkpointDays: 30,
        ...(change as object),
      })),
    },
    screen: { status: record("screen.status", () => screenReply.promise) },
    data: {
      deleteAll: record("data.deleteAll", async () => ({
        ok: true,
        bootstrap: {
          workspace: { path: "/w/project", name: "project" },
          conversationId: null,
          conversations: [],
          messages: [],
          tasks: [],
          activities: [],
        },
      })),
    },
  };
  return {
    poko,
    calls,
    emit: (taskId: string, event: AgentEvent) => {
      for (const listener of [...listeners]) listener({ taskId, event });
    },
    replyToStart: (value: unknown) => startReply.resolve(value),
    replyToOpen: (value: unknown) => openReply.resolve(value),
    startElsewhere: (notice: TaskStartedNotice) => {
      for (const listener of [...startedListeners]) listener(notice);
    },
    setActive: (value: ActiveTaskInfo | null) => {
      activeReply = value;
    },
    replyToSettings: (value: unknown) => settingsReply.resolve(value),
    failScreen: () => screenReply.resolve(Promise.reject(new Error("helper"))),
  };
}

let world: ReturnType<typeof fakePoko>;
let store: typeof import("./appStore").useAppStore;

beforeEach(async () => {
  vi.resetModules();
  world = fakePoko();
  vi.stubGlobal("window", {
    poko: world.poko,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (flush: () => void) => setTimeout(flush, 0),
  });
  ({ useAppStore: store } = await import("./appStore"));
  store.setState({
    workspace: { path: "/w/project", name: "project" },
    conversations: [conversation("a", "first")],
    activeConversationId: "a",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((done) => setTimeout(done, 0));

describe("sending a message", () => {
  it("starts in the active conversation, moves it to the top, and shows the answer", async () => {
    store.setState({ conversations: [conversation("b"), conversation("a", "first")] });
    const sending = store.getState().sendMessage("README 요약해 줘");
    expect(store.getState().isSending).toBe(true);
    expect(world.calls.at(-1)).toEqual({ method: "tasks.start", args: ["README 요약해 줘", "a"] });

    world.replyToStart({ taskId: "t1", conversation: conversation("a", "first") });
    await sending;
    expect(store.getState().conversations.map((item) => item.id)).toEqual(["a", "b"]);
    world.emit("t1", { type: "completed", result: "요약이야." });
    expect(store.getState().isSending).toBe(false);
    expect(store.getState().messages.map((message) => message.content)).toEqual([
      "README 요약해 줘",
      "요약이야.",
    ]);
  });

  it("keeps events that arrive before the start reply and applies them in order", async () => {
    const sending = store.getState().sendMessage("질문");
    world.emit("t1", { type: "started" });
    world.emit("t1", { type: "completed", result: "답" });
    expect(store.getState().isSending).toBe(true); // not applied yet: the task id isn't known
    world.replyToStart({ taskId: "t1", conversation: conversation("a") });
    await sending;
    expect(store.getState().isSending).toBe(false);
    expect(store.getState().messages.at(-1)?.content).toBe("답");
  });

  it("shows main's refusal instead of starting", async () => {
    const sending = store.getState().sendMessage("질문");
    world.replyToStart({ error: "이 대화를 찾을 수 없어. 새 대화로 다시 보내 줘." });
    await sending;
    expect(store.getState()).toMatchObject({
      isSending: false,
      errorMessage: "이 대화를 찾을 수 없어. 새 대화로 다시 보내 줘.",
    });
  });
});

describe("switching conversations", () => {
  it("refuses to switch while sending, but returning to the shown conversation is fine", async () => {
    void store.getState().sendMessage("질문");
    store.setState({ activeView: "tasks" });
    await store.getState().openConversation("b");
    expect(world.calls.some((call) => call.method === "conversations.open")).toBe(false);
    expect(store.getState().conversationError).toContain("작업 중");

    store.setState({ conversationError: null });
    await store.getState().openConversation("a");
    expect(store.getState()).toMatchObject({ activeView: "conversation", conversationError: null });
  });

  it("holds sending while a conversation loads, so no message lands in between", async () => {
    const switching = store.getState().openConversation("b");
    await store.getState().sendMessage("끼어든 메시지");
    expect(world.calls.some((call) => call.method === "tasks.start")).toBe(false);
    world.replyToOpen({ messages: [{ id: "m", role: "user", content: "B", createdAt: "x" }] });
    await switching;
    expect(store.getState()).toMatchObject({ activeConversationId: "b", isSending: false });
    expect(store.getState().messages.map((message) => message.content)).toEqual(["B"]);
  });
});

describe("a switch that finishes after a task started", () => {
  it("keeps the running task's conversation on screen", async () => {
    store.setState({ messages: [{ id: "m", role: "user", content: "A", createdAt: "x" }] });
    const switching = store.getState().openConversation("b");
    // Defense in depth: even if a task got started while the switch was loading…
    store.setState({ isSending: true });
    world.replyToOpen({ messages: [{ id: "n", role: "user", content: "B", createdAt: "x" }] });
    await switching;
    expect(store.getState().activeConversationId).toBe("a");
    expect(store.getState().messages.map((message) => message.content)).toEqual(["A"]);
  });
});

describe("approvals and the edit switch", () => {
  const card = (requestId: string, kind: "file_change" | "command" = "file_change") =>
    ({
      type: "approvalRequired",
      requestId,
      kind,
      summary: "변경",
      cwd: "/w/project",
      reason: null,
      canApprove: true,
    }) as const;

  async function running() {
    const sending = store.getState().sendMessage("고쳐 줘");
    world.replyToStart({ taskId: "t1", conversation: conversation("a") });
    await sending;
  }

  it("removes an answered card and keeps the task waiting while others remain", async () => {
    await running();
    world.emit("t1", card("1"));
    world.emit("t1", card("2"));
    await store.getState().respondToApproval("approve");
    expect(world.calls.at(-1)).toEqual({
      method: "approvals.respond",
      args: ["t1", "1", "approve"],
    });
    expect(store.getState().pendingApprovals.map((item) => item.requestId)).toEqual(["2"]);
    expect(store.getState().characterState).toBe("approval");
  });

  it("turning edits off removes only the cards main declined", async () => {
    await running();
    world.emit("t1", card("1"));
    store.setState((state) => ({
      pendingApprovals: [...state.pendingApprovals, { ...card("9"), taskId: "other-folder-task" }],
    }));
    world.poko.edits.set = async () => ({
      available: true,
      enabled: false,
      declined: [{ taskId: "t1", requestId: "1" }],
    });
    await store.getState().setEdits(false);
    expect(store.getState().pendingApprovals.map((item) => item.requestId)).toEqual(["9"]);
  });
});

describe("deleting the active conversation", () => {
  it("returns to a clean greeting screen", async () => {
    store.setState({
      messages: [{ id: "m", role: "assistant", content: "x", createdAt: "x" }],
      errorMessage: "작업을 마치지 못했어.",
      characterState: "error",
      progressMessage: "…",
    });
    expect(await store.getState().deleteConversation("a")).toBeNull();
    expect(store.getState()).toMatchObject({
      activeConversationId: null,
      messages: [],
      errorMessage: null,
      characterState: "idle",
      progressMessage: null,
      conversations: [],
    });
    await flush();
  });
});

describe("settings", () => {
  it("keeps a save made while an older load was still on its way", async () => {
    const loading = store.getState().loadSettings();
    await store.getState().updateSettings({ memoriesInContext: false });
    world.replyToSettings({
      settings: { memoriesInContext: true, checkpointDays: 30 },
      version: "0.1.0",
    });
    await loading;
    expect(store.getState().settings?.memoriesInContext).toBe(false);
  });

  it("shows the preferences even when the screen check fails, and clears an old error", async () => {
    store.setState({ settingsError: "설정을 불러오지 못했어. 잠시 뒤 다시 시도해 줘." });
    world.failScreen();
    const loading = store.getState().loadSettings();
    world.replyToSettings({
      settings: { memoriesInContext: true, checkpointDays: 7 },
      version: "0.1.0",
    });
    await loading;
    await flush();
    expect(store.getState()).toMatchObject({
      settings: { checkpointDays: 7 },
      settingsError: null,
    });
  });
});

describe("deleting all data", () => {
  it("resets every page to the fresh start data", async () => {
    store.setState({
      messages: [{ id: "m", role: "user", content: "A", createdAt: "x" }],
      tasks: [{ id: "t", title: "작업", status: "completed", createdAt: "x" }],
      activities: [{ id: "a", taskId: "t" } as never],
      memories: [
        {
          id: "k",
          type: "fact",
          content: "기억",
          importance: 3,
          source: "user",
          createdAt: "x",
          updatedAt: "x",
        },
      ],
      editNotes: [{ id: "e" } as never],
      errorMessage: "오류",
      characterState: "error",
    });
    expect(await store.getState().deleteAllData("삭제")).toBeNull();
    expect(world.calls.at(-1)).toEqual({ method: "data.deleteAll", args: ["삭제"] });
    expect(store.getState()).toMatchObject({
      activeConversationId: null,
      conversations: [],
      messages: [],
      tasks: [],
      activities: [],
      memories: [],
      editNotes: [],
      pendingApprovals: [],
      errorMessage: null,
      characterState: "idle",
      workspace: { name: "project" },
    });
  });

  it("refuses while a task is running", async () => {
    void store.getState().sendMessage("질문");
    expect(await store.getState().deleteAllData("삭제")).toContain("작업 중");
    expect(world.calls.some((call) => call.method === "data.deleteAll")).toBe(false);
  });
});

describe("a task started elsewhere (the quick panel)", () => {
  const card = {
    type: "approvalRequired",
    requestId: "q1",
    kind: "file_change",
    summary: "변경",
    cwd: "/w/project",
    reason: null,
    canApprove: true,
  } as const;

  it("keeps its card out of the shown conversation, blocks sending, and adopts it on request", async () => {
    world.startElsewhere({ taskId: "qt", title: "빠른 질문", conversation: conversation("q") });
    world.emit("qt", card);
    expect(store.getState()).toMatchObject({
      busyElsewhere: true,
      pendingApprovals: [],
      foreignApproval: { conversationId: "q" },
    });
    expect(store.getState().conversations[0].id).toBe("q");
    expect(await store.getState().sendMessage("다른 질문")).toBeUndefined();
    expect(world.calls.some((call) => call.method === "tasks.start")).toBe(false);

    world.setActive({ taskId: "qt", conversationId: "q", approvals: [] });
    const adopting = store.getState().showForeignTask();
    // Events while the conversation loads are held, then applied in order.
    world.emit("qt", { type: "output", content: "답변", itemId: "m" });
    world.replyToOpen({
      messages: [{ id: "u", role: "user", content: "빠른 질문", createdAt: "x" }],
    });
    await adopting;
    expect(store.getState()).toMatchObject({
      activeConversationId: "q",
      activeTaskId: "qt",
      isSending: true,
      busyElsewhere: false,
      foreignApproval: null,
    });
    expect(store.getState().pendingApprovals.map((item) => item.requestId)).toEqual(["q1"]);
    world.emit("qt", { type: "completed", result: "끝" });
    expect(store.getState()).toMatchObject({ isSending: false, activeTaskId: null });
    expect(store.getState().messages.at(-1)?.content).toBe("끝");
  });

  it("stays idle when the task ended while its conversation loaded", async () => {
    world.startElsewhere({ taskId: "qt", title: "빠른 질문", conversation: conversation("q") });
    world.setActive(null);
    const adopting = store.getState().openConversation("q");
    world.emit("qt", { type: "completed", result: "끝" });
    world.replyToOpen({ messages: [] });
    await adopting;
    expect(store.getState()).toMatchObject({
      activeConversationId: "q",
      isSending: false,
      activeTaskId: null,
      busyElsewhere: false,
    });
  });

  it("hands events held during a refused start to foreign handling", async () => {
    world.startElsewhere({ taskId: "qt", title: "빠른 질문", conversation: conversation("q") });
    world.emit("qt", { type: "completed", result: "끝" }); // ends: nothing runs elsewhere now
    const sending = store.getState().sendMessage("질문");
    world.emit("qt2", card); // another foreign task's card arrives while the start is pending
    world.replyToStart({ error: "포코가 이미 다른 작업을 하고 있어." });
    await sending;
    expect(store.getState().pendingApprovals).toEqual([]);
    expect(store.getState().foreignApproval).not.toBeNull();
  });

  it("gives held events back when adoption fails, so the window doesn't stay busy", async () => {
    world.startElsewhere({ taskId: "qt", title: "빠른 질문", conversation: conversation("q") });
    const adopting = store.getState().openConversation("q");
    world.emit("qt", { type: "completed", result: "끝" }); // held during the failed adoption
    world.replyToOpen({ error: "포코가 작업 중이라 다른 대화로 옮길 수 없어." });
    await adopting;
    expect(store.getState()).toMatchObject({ busyElsewhere: false, activeTaskId: null });
  });

  it("continues the answer written before the take-over", async () => {
    world.startElsewhere({ taskId: "qt", title: "빠른 질문", conversation: conversation("q") });
    world.setActive({ taskId: "qt", conversationId: "q", approvals: [], answer: "앞부분" });
    const adopting = store.getState().openConversation("q");
    world.replyToOpen({ messages: [] });
    await adopting;
    expect(store.getState().streaming).toEqual({ taskId: "qt", itemId: null, text: "앞부분" });
  });
});
