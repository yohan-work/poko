import { describe, expect, it, vi } from "vitest";
import type { EngineSession } from "../shared";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { ctx } = await import("./context");
const { finishSession, memoryHash, planSession, recordSessionReport } = await import("./sessions");

const short = { type: "preference", content: "답은 짧게" };
const other = { type: "project", content: "pnpm을 써" };

function world(
  stored: EngineSession | null,
  options: { engine?: "codex" | "claude"; memories?: (typeof short)[]; missed?: number } = {},
) {
  const state = { stored };
  const deleted: string[][] = [];
  ctx.database = {
    getSettings: () => ({ engine: options.engine ?? "codex" }),
    getTaskContext: () => ({ memories: options.memories ?? [short], history: [] }),
    getEngineSession: () => state.stored,
    setEngineSession: (_id: string, session: EngineSession | null) => {
      state.stored = session;
    },
    exchangesAfter: () => ({
      history: [{ request: "화면 질문", answer: "화면 답" }],
      missed: options.missed ?? 0,
    }),
    getTaskConversation: () => ({ id: "c1" }),
    getTaskWorkspace: () => "/w/project",
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
  memoryHashes: [memoryHash(short)],
  dirty: false,
  ...overrides,
});

describe("engine sessions", () => {
  it("continues a usable session with the answers it never saw", () => {
    world(session(), { memories: [short, other] });
    expect(planSession("c1", "t1")).toEqual({
      engine: "codex",
      resumeId: "t-old",
      catchUp: [{ request: "화면 질문", answer: "화면 답" }],
    });
  });

  it("starts fresh when a memory it saw is gone, a task failed, answers were missed, or another engine runs", () => {
    // Only this session's memories count: a memory it never saw changing doesn't matter.
    world(session(), { memories: [other] });
    expect(planSession("c1", "t1")).toEqual({ engine: "codex", catchUp: [] });
    world(session({ dirty: true }));
    expect(planSession("c1", "t2")).toEqual({ engine: "codex", catchUp: [] });
    world(session(), { missed: 2 });
    expect(planSession("c1", "t3")).toEqual({ engine: "codex", catchUp: [] });
    // A session from the other engine is never continued.
    world(session(), { engine: "claude" });
    expect(planSession("c1", "t4")).toEqual({ engine: "claude", catchUp: [] });
  });

  it("keeps a fresh session, marks it after a failure, and deletes the one it replaced", () => {
    const { state, deleted } = world(session({ dirty: true }));
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "t-new", resumed: false, kept: true, forgetPrevious: false });
    finishSession("t1", "cancelled");
    expect(state.stored).toEqual(session({ id: "t-new", lastTaskId: "t1", dirty: true }));
    expect(deleted).toEqual([["t-old"]]);
  });

  it("remembers every memory a continued session was sent", () => {
    const { state } = world(session(), { memories: [short, other] });
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "t-old", resumed: true, kept: true, forgetPrevious: false });
    finishSession("t1", "completed");
    expect(state.stored?.memoryHashes.sort()).toEqual(
      [memoryHash(short), memoryHash(other)].sort(),
    );
  });

  it("changes nothing for a one-off answer, and never fails the answer when recording does", () => {
    const { state } = world(session());
    planSession("c1", "t1");
    recordSessionReport("t1", { id: "t-x", resumed: false, kept: false, forgetPrevious: false });
    finishSession("t1", "completed");
    expect(state.stored).toEqual(session());

    world(session());
    planSession("c1", "t2");
    recordSessionReport("t2", { id: "t-new", resumed: false, kept: true, forgetPrevious: false });
    ctx.database = {
      getTaskConversation: () => {
        throw new Error("database is closing");
      },
    } as never;
    expect(() => finishSession("t2", "completed")).not.toThrow();
    ctx.database = null;
    ctx.screenProvider = null;
  });

  it("continues a Claude Code session only while its transcript is as Poko left it", async () => {
    const { mkdtemp, mkdir, writeFile, appendFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const config = await mkdtemp(join(tmpdir(), "poko-claude-"));
    ctx.claudeSetup = { runtime: () => ({ environment: { CLAUDE_CONFIG_DIR: config } }) } as never;
    const folder = join(config, "projects", "-w-project");
    await mkdir(folder, { recursive: true });
    const id = "11111111-2222-3333-4444-555555555555";
    await writeFile(join(folder, `${id}.jsonl`), "turn\n");
    const { state } = world(null, { engine: "claude" });
    planSession("c1", "t1");
    recordSessionReport("t1", { id, resumed: false, kept: true, forgetPrevious: false });
    finishSession("t1", "completed");
    expect(state.stored).toMatchObject({ engine: "claude", id, cwd: "/w/project" });
    expect(planSession("c1", "t2")).toMatchObject({ resumeId: id });
    // Continued in a terminal since: Poko starts fresh rather than take in that history.
    await appendFile(join(folder, `${id}.jsonl`), "outside turn\n");
    expect(planSession("c1", "t3")).toEqual({ engine: "claude", catchUp: [] });
    ctx.claudeSetup = null;
    ctx.database = null;
  });

  it("doesn't retry a stored session that a task failed in before it got going", () => {
    const { state } = world(session());
    planSession("c1", "t1");
    finishSession("t1", "error");
    expect(state.stored).toEqual(session({ dirty: true }));
    ctx.database = null;
  });
});
