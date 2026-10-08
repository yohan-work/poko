import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
vi.mock("electron", () => ({
  app: {},
  globalShortcut: { register: vi.fn(() => true), unregister: vi.fn() },
  ipcMain: { handle: (channel: string, handler: never) => handlers.set(channel, handler) },
}));
const startScreenLook = vi.fn();
vi.mock("./screen", () => ({ startScreenLook }));
const startConversationTask = vi.fn();
vi.mock("./context", async (original) => ({
  ...(await original<typeof import("./context")>()),
  startConversationTask,
}));

const { ctx } = await import("./context");
const { registerQuickHandlers, toggleQuickPanel } = await import("./quick");
const { IPC_CHANNELS } = await import("../shared");

const started = { taskId: "t", conversation: { id: "c", title: "q", updatedAt: "x" } };
const panelEvent = { sender: "panel" };

function fakePanel() {
  const calls: string[] = [];
  return {
    calls,
    panel: {
      visible: false,
      owns: (event: unknown) => event === panelEvent,
      show: async () => void calls.push("show"),
      hide: () => void calls.push("hide"),
      setScreen: (screen: unknown, hint: unknown, selection: unknown) =>
        void calls.push(
          `screen:${JSON.stringify(screen)}:${hint}${selection ? `:${JSON.stringify(selection)}` : ""}`,
        ),
      begin: () => void calls.push("begin"),
      wait: (question: string, taskId: string, conversationId: string | null) =>
        void calls.push(`wait:${question}:${taskId}:${conversationId}`),
      waitingTaskId: null as string | null,
      refuse: (_question: string, message: string, conversationId?: string | null) =>
        void calls.push(`refuse:${message}${conversationId ? `@${conversationId}` : ""}`),
      followUpConversation: null as string | null,
      taskId: null as string | null,
    },
  };
}

describe("quick:ask", () => {
  beforeEach(() => {
    handlers.clear();
    startScreenLook.mockReset().mockResolvedValue(started);
    startConversationTask.mockReset().mockResolvedValue(started);
    registerQuickHandlers();
  });

  const ask = (raw: unknown) => handlers.get(IPC_CHANNELS.quickAsk)?.(panelEvent, raw);

  it("includes only the window that was in front when the panel opened", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    ctx.database = { isScreenNoticeAccepted: () => true } as never;
    ctx.screenService = {
      supported: true,
      selectedText: async () => null,
      frontWindow: async () => ({ id: 42, app: "Safari", title: "메일" }),
      status: async () => ({
        supported: true,
        permissions: { screen: true, accessibility: true },
        noticeAccepted: true,
      }),
    } as never;
    await toggleQuickPanel();
    // The chip is settled before the panel appears.
    expect(calls).toEqual(['screen:{"app":"Safari","title":"메일"}:null', "show"]);

    // The panel can't name a window; only "include it" is read.
    await ask({ question: "요약해 줘", withScreen: true, windowId: 7 });
    expect(startScreenLook).toHaveBeenCalledWith(42, "요약해 줘", null, expect.any(Function));
    await ask({ question: "그냥 질문", withScreen: false });
    expect(startConversationTask).toHaveBeenCalledWith(
      "그냥 질문",
      null,
      expect.any(Function),
      [],
      {
        allowQueue: true,
        fromQuick: true,
      },
    );
  });

  it("adds only the selection main read when the panel opened, and only when asked", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    ctx.database = { isScreenNoticeAccepted: () => true } as never;
    ctx.database = { isScreenNoticeAccepted: () => false } as never;
    const selectedText = vi.fn(async () => "  고칠   문장이야. ");
    ctx.screenService = {
      supported: true,
      selectedText,
      frontWindow: async () => null,
      status: async () => ({}),
    } as never;
    // Nothing is read before the screen notice was accepted.
    await toggleQuickPanel();
    expect(selectedText).not.toHaveBeenCalled();
    expect(calls[0]).toBe("screen:null:null");
    calls.length = 0;
    ctx.database = { isScreenNoticeAccepted: () => true } as never;
    ctx.screenService = {
      supported: true,
      selectedText: async () => "  고칠   문장이야. ",
      frontWindow: async () => null,
      status: async () => ({}),
    } as never;
    await toggleQuickPanel();
    // The panel gets a one-line preview and the length, not the text.
    expect(calls[0]).toBe(
      `screen:null:null:{"preview":"고칠 문장이야.","chars":${"  고칠   문장이야. ".length}}`,
    );
    // The panel only says "include it"; the text is the one main kept.
    await ask({ question: "다듬어 줘", withScreen: false, withSelection: true, text: "다른 글" });
    expect(startConversationTask).toHaveBeenLastCalledWith(
      "다듬어 줘",
      null,
      expect.any(Function),
      [{ kind: "text", name: "선택한 글", text: "  고칠   문장이야. " }],
      { allowQueue: true, fromQuick: true },
    );
    await ask({ question: "그냥", withScreen: false, withSelection: false });
    expect(startConversationTask).toHaveBeenLastCalledWith("그냥", null, expect.any(Function), [], {
      allowQueue: true,
      fromQuick: true,
    });
  });

  it("refuses the screen when it isn't ready, and asks without it otherwise", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    ctx.database = { isScreenNoticeAccepted: () => false } as never;
    ctx.screenService = {
      supported: true,
      selectedText: async () => null,
      frontWindow: async () => ({ id: 42, app: "Safari", title: "" }),
      status: async () => ({
        supported: true,
        permissions: { screen: true, accessibility: true },
        noticeAccepted: false,
      }),
    } as never;
    await toggleQuickPanel();
    expect(calls).toEqual([expect.stringContaining("안내를 먼저 확인해 줘"), "show"]);
    await ask({ question: "요약해 줘", withScreen: true });
    expect(startScreenLook).not.toHaveBeenCalled();
    expect(calls.at(-1)).toBe("refuse:함께 볼 화면이 없어. 화면 없이 다시 물어봐 줘.");
  });

  it("continues only the conversation main knows the panel shows, and only when asked", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    ctx.screenService = { supported: false } as never;
    panel.followUpConversation = "c1";
    // The panel can't name a conversation; only "continue" is read.
    await ask({ question: "이어서", withScreen: false, followUp: true, conversationId: "other" });
    expect(startConversationTask).toHaveBeenLastCalledWith(
      "이어서",
      "c1",
      expect.any(Function),
      [],
      { allowQueue: true, fromQuick: true },
    );
    await ask({ question: "새 질문", withScreen: false, followUp: false });
    expect(startConversationTask).toHaveBeenLastCalledWith(
      "새 질문",
      null,
      expect.any(Function),
      [],
      { allowQueue: true, fromQuick: true },
    );
    // A refused follow-up keeps its conversation for the next try…
    startConversationTask.mockResolvedValueOnce({ error: "다른 폴더야." });
    await ask({ question: "또", withScreen: false, followUp: true });
    expect(calls.at(-1)).toBe("refuse:다른 폴더야.@c1");
    // …unless the conversation (or its folder) is gone.
    startConversationTask.mockResolvedValueOnce({ error: "폴더를 찾지 못했어.", gone: true });
    await ask({ question: "또", withScreen: false, followUp: true });
    expect(calls.at(-1)).toBe("refuse:폴더를 찾지 못했어.");

    // Not a conversation the main window has gone on with since the panel's answer.
    panel.taskId = "t-panel";
    ctx.database = { latestTaskId: () => "t-newer" } as never;
    await ask({ question: "이어서", withScreen: false, followUp: true });
    expect(startConversationTask).toHaveBeenLastCalledWith(
      "이어서",
      null,
      expect.any(Function),
      [],
      { allowQueue: true, fromQuick: true },
    );
    ctx.database = { latestTaskId: () => "t-panel" } as never;
    await ask({ question: "이어서", withScreen: false, followUp: true });
    expect(startConversationTask).toHaveBeenLastCalledWith(
      "이어서",
      "c1",
      expect.any(Function),
      [],
      { allowQueue: true, fromQuick: true },
    );
    ctx.database = null;
  });

  it("lets a question wait while Poko is busy, but never a question with the screen", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    startConversationTask.mockResolvedValue({
      queued: { taskId: "w", conversationId: null, text: "나중에" },
    });
    expect(await ask({ question: "나중에" })).toEqual({ ok: true });
    expect(startConversationTask.mock.calls[0][4]).toEqual({ allowQueue: true, fromQuick: true });
    expect(calls).toContain("wait:나중에:w:null");
    // Nothing waits in the panel: 취소 has nothing to cancel.
    expect(await handlers.get(IPC_CHANNELS.quickCancel)?.(panelEvent, undefined)).toBe(false);
    expect(() =>
      handlers.get(IPC_CHANNELS.quickCancel)?.({ sender: "other" }, undefined),
    ).toThrow();
  });

  it("refuses senders other than the panel", async () => {
    ctx.quickPanel = fakePanel().panel as never;
    await expect(
      handlers.get(IPC_CHANNELS.quickAsk)?.(
        { sender: "main" },
        { question: "x", withScreen: false },
      ),
    ).rejects.toThrow();
  });

  it("cancels an opening when the shortcut is pressed again before it shows", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    let release = () => {};
    ctx.screenService = {
      supported: true,
      selectedText: async () => null,
      frontWindow: () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    } as never;
    const first = toggleQuickPanel();
    await toggleQuickPanel(); // pressed again while the front window is still being read
    release();
    await first;
    expect(calls).toEqual([]);
  });
});
