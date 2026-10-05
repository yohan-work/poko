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
      setScreen: (screen: unknown, hint: unknown) =>
        void calls.push(`screen:${JSON.stringify(screen)}:${hint}`),
      begin: () => void calls.push("begin"),
      refuse: (_question: string, message: string) => void calls.push(`refuse:${message}`),
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
      frontWindow: async () => ({ id: 42, app: "Safari", title: "메일" }),
      status: async () => ({
        supported: true,
        permissions: { screen: true, accessibility: true },
        noticeAccepted: true,
      }),
    } as never;
    await toggleQuickPanel();
    expect(calls).toEqual(["show", 'screen:{"app":"Safari","title":"메일"}:null']);

    // The panel can't name a window; only "include it" is read.
    await ask({ question: "요약해 줘", withScreen: true, windowId: 7 });
    expect(startScreenLook).toHaveBeenCalledWith(42, "요약해 줘", null, expect.any(Function));
    await ask({ question: "그냥 질문", withScreen: false });
    expect(startConversationTask).toHaveBeenCalledWith("그냥 질문", null, expect.any(Function));
  });

  it("refuses the screen when it isn't ready, and asks without it otherwise", async () => {
    const { panel, calls } = fakePanel();
    ctx.quickPanel = panel as never;
    ctx.database = { isScreenNoticeAccepted: () => false } as never;
    ctx.screenService = {
      supported: true,
      frontWindow: async () => ({ id: 42, app: "Safari", title: "" }),
      status: async () => ({
        supported: true,
        permissions: { screen: true, accessibility: true },
        noticeAccepted: false,
      }),
    } as never;
    await toggleQuickPanel();
    expect(calls.at(-1)).toContain("안내를 먼저 확인해 줘");
    await ask({ question: "요약해 줘", withScreen: true });
    expect(startScreenLook).not.toHaveBeenCalled();
    expect(calls.at(-1)).toBe("refuse:함께 볼 화면이 없어. 화면 없이 다시 물어봐 줘.");
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
});
