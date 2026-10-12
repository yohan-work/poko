import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { ctx } = await import("./context");
const { addTaskUsage, localMonth } = await import("./usage");
const { planSession, recordSessionReport } = await import("./sessions");

describe("localMonth", () => {
  it("bounds the local month, so a task just after local midnight on the 1st counts in it", () => {
    const { from, to } = localMonth(new Date(2026, 10, 1, 0, 30));
    expect(new Date(from).getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 11, 1).getTime());
  });
});

describe("addTaskUsage", () => {
  it("records a continued Claude Code session's share of its running cost", () => {
    const added: unknown[] = [];
    ctx.database = {
      getSettings: () => ({ engine: "claude" }),
      getTaskContext: () => ({ memories: [], history: [] }),
      getEngineSession: () => ({
        engine: "claude",
        id: "s1",
        lastTaskId: "t0",
        memoryHashes: [],
        dirty: false,
        cwd: "/w",
        costUsd: 0.212,
      }),
      exchangesAfter: () => ({ history: [], missed: 0 }),
      getTaskConversation: () => ({ id: "c1" }),
      addTaskUsage: (_taskId: string, usage: unknown) => {
        added.push(usage);
        return null;
      },
    } as never;
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "s1", resumed: true, kept: true, forgetPrevious: false });
    const tokens = {
      engine: "claude" as const,
      inputTokens: 4777,
      cachedInputTokens: 4686,
      cacheWriteTokens: 89,
      outputTokens: 83,
    };
    addTaskUsage("t1", tokens, { sessionCostUsd: 0.2173 });
    expect((added[0] as { costUsd: number }).costUsd).toBeCloseTo(0.0053, 4);
    ctx.database = null;
  });
});
