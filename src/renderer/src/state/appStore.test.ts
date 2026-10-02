import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEvent,
  PersistedConversation,
  TaskEventPayload,
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
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    <T>(method: string, result: (...args: unknown[]) => T) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return result(...args);
    };
  let startReply = deferred<unknown>();
  let openReply = deferred<unknown>();
  const poko = {
    tasks: {
      start: record("tasks.start", () => startReply.promise),
      cancel: record("tasks.cancel", async () => true),
      onEvent: (listener: (payload: TaskEventPayload) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    conversations: {
      open: record("conversations.open", () => openReply.promise),
      rename: record("conversations.rename", async () => ({ ok: true })),
      delete: record("conversations.delete", async () => ({ ok: true })),
    },
    edits: {
      list: record("edits.list", async () => []),
      set: record("edits.set", async () => ({ available: true, enabled: false, declined: [] })),
    },
    approvals: { respond: record("approvals.respond", async () => "applied") },
    screen: {
      act: record("screen.act", () => startReply.promise),
      look: record("screen.look", () => startReply.promise),
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
    resetReplies: () => {
      startReply = deferred();
      openReply = deferred();
    },
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
