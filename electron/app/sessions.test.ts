import { describe, expect, it, vi } from "vitest";
import type { EngineSession } from "../shared";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { ctx } = await import("./context");
const { finishSession, planSession, recordSessionReport } = await import("./sessions");

function world(stored: EngineSession | null, engine: "codex" | "claude" = "codex") {
  const state = { stored, version: 3 };
  const deleted: string[][] = [];
  ctx.database = {
    getSettings: () => ({ engine }),
    memoryVersion: () => state.version,
    getEngineSession: () => state.stored,
    setEngineSession: (_id: string, session: EngineSession | null) => {
      state.stored = session;
    },
    exchangesAfter: () => [{ request: "화면 질문", answer: "화면 답" }],
    getTaskConversation: () => ({ id: "c1" }),
  } as never;
  ctx.screenProvider = {
    deleteThreads: async (ids: string[]) => void deleted.push(ids),
  } as never;
  return { state, deleted };
}

const session = (overrides: Partial<EngineSession> = {}): EngineSession => ({
  engine: "codex",
  id: "t-old",
  lastTaskId: "t0",
  memoryVersion: 3,
  dirty: false,
  ...overrides,
});

describe("engine sessions", () => {
  it("continues a usable session with the answers it never saw", () => {
    world(session());
    expect(planSession("c1", "t1")).toEqual({
      engine: "codex",
      resumeId: "t-old",
      catchUp: [{ request: "화면 질문", answer: "화면 답" }],
    });
  });

  it("starts fresh when the memories changed, a task failed in it, or another engine runs", () => {
    world(session({ memoryVersion: 2 }));
    expect(planSession("c1", "t1")).toEqual({ engine: "codex", catchUp: [] });
    world(session({ dirty: true }));
    expect(planSession("c1", "t2")).toEqual({ engine: "codex", catchUp: [] });
    // Claude Code keeps no session yet (milestone 2).
    world(session(), "claude");
    expect(planSession("c1", "t3")).toBeUndefined();
  });

  it("keeps a fresh session, marks it after a failure, and deletes the one it replaced", () => {
    const { state, deleted } = world(session({ dirty: true }));
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "t-new", resumed: false, kept: true, forgetPrevious: false });
    finishSession("t1", "cancelled");
    expect(state.stored).toEqual(session({ id: "t-new", lastTaskId: "t1", dirty: true }));
    expect(deleted).toEqual([["t-old"]]);
  });

  it("changes nothing for a one-off answer, but forgets a session the engine refused", () => {
    const { state } = world(session());
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "t-x", resumed: false, kept: false, forgetPrevious: false });
    finishSession("t1", "completed");
    expect(state.stored).toEqual(session());

    const second = world(session());
    planSession("c1", "t2");
    recordSessionReport("t2", { id: "t-new", resumed: false, kept: true, forgetPrevious: true });
    finishSession("t2", "completed");
    expect(second.state.stored).toEqual(session({ id: "t-new", lastTaskId: "t2" }));
    expect(second.deleted).toEqual([["t-old"]]);
    ctx.database = null;
    ctx.screenProvider = null;
  });
});
