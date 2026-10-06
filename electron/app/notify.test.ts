import { beforeEach, describe, expect, it, vi } from "vitest";

const shown: Array<{ title: string; body: string }> = [];
let focused: unknown = null;
vi.mock("electron", () => {
  class Notification {
    static isSupported = () => true;
    constructor(private readonly options: { title: string; body: string }) {}
    on() {}
    show() {
      shown.push({ title: this.options.title, body: this.options.body });
    }
  }
  return {
    app: {},
    ipcMain: { handle: vi.fn() },
    BrowserWindow: { getFocusedWindow: () => focused },
    Notification,
  };
});

const { ctx } = await import("./context");
const { notifyTaskEvent } = await import("./notify");

describe("notifyTaskEvent", () => {
  let enabled = true;
  beforeEach(() => {
    shown.length = 0;
    focused = null;
    enabled = true;
    ctx.database = {
      getSettings: () => ({ taskNotifications: enabled }),
      getTaskConversation: () => ({ id: "c" }),
    } as never;
  });

  it("notifies when no Poko window is in front", () => {
    notifyTaskEvent({ taskId: "t", event: { type: "completed", result: "**끝**났어" } });
    expect(shown).toEqual([{ title: "포코가 답했어", body: "끝났어" }]);
  });

  it("stays quiet while Poko is in front, when turned off, and for other events", () => {
    focused = {};
    notifyTaskEvent({ taskId: "t", event: { type: "completed", result: "x" } });
    focused = null;
    enabled = false;
    notifyTaskEvent({ taskId: "t", event: { type: "completed", result: "x" } });
    enabled = true;
    notifyTaskEvent({ taskId: "t", event: { type: "output", content: "x" } });
    expect(shown).toEqual([]);
  });
});
