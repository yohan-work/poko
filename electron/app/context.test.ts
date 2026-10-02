import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { BUSY_MESSAGE, ctx, isQuickPanel, startConversationTask } = await import("./context");

describe("startConversationTask", () => {
  function fakeDatabase() {
    const calls: string[] = [];
    return {
      calls,
      database: {
        getWorkspace: () => "/tmp",
        createTask: () => {
          calls.push("createTask");
          return "t1";
        },
      },
    };
  }

  it("refuses before recording anything while a task runs or another start is counted", async () => {
    const { calls, database } = fakeDatabase();
    ctx.database = database as never;
    ctx.agentCore = { hasActiveTasks: true } as never;
    ctx.startingTasks = 1;
    expect(await startConversationTask("질문", null)).toEqual({ error: BUSY_MESSAGE });

    ctx.agentCore = { hasActiveTasks: false } as never;
    ctx.startingTasks = 2;
    expect(await startConversationTask("질문", null)).toEqual({ error: BUSY_MESSAGE });
    expect(calls).toEqual([]);
    ctx.startingTasks = 0;
    ctx.database = null;
    ctx.agentCore = null;
  });
});

describe("isQuickPanel", () => {
  it("accepts only the panel's own page", () => {
    const own = { sender: "panel" } as never;
    ctx.quickPanel = { owns: (event: unknown) => event === own } as never;
    expect(isQuickPanel(own)).toBe(true);
    expect(isQuickPanel({ sender: "main" } as never)).toBe(false);
    ctx.quickPanel = null;
    expect(isQuickPanel(own)).toBe(false);
  });
});
