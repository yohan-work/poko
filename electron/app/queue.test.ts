import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));
const delivered: Array<{ taskId: string; event: { type: string; error?: string } }> = [];
vi.mock("./events", () => ({
  deliverTaskEvent: (payload: { taskId: string; event: { type: string; error?: string } }) =>
    delivered.push(payload),
}));

const { anyTaskBusy, BUSY_MESSAGE, ctx, startConversationTask } = await import("./context");
const {
  cancelQueued,
  enqueueQuestion,
  hasWaiting,
  noteTaskEnded,
  QUEUE_FULL,
  resetQueueForTests,
  startNext,
} = await import("./queue");

const here = await realpath(tmpdir());

/** A database that records what the queue asks of it. */
function fakeDatabase() {
  const calls: string[] = [];
  let next = 0;
  const database = {
    getWorkspace: () => here,
    getConversation: (id: string) => ({ id, title: id, updatedAt: "x", workspacePath: null }),
    queueTask: (message: string) => {
      next += 1;
      calls.push(`queue:${message}`);
      return `w${next}`;
    },
    startQueuedTask: (taskId: string) => {
      calls.push(`start:${taskId}`);
      return `c-${taskId}`;
    },
    getTaskContext: () => ({ memories: [], history: [] }),
    isEditsEnabled: () => false,
    recordTaskEvent: (taskId: string, type: string) => calls.push(`${type}:${taskId}`),
  };
  return { calls, database };
}

function fakeCore() {
  const started: Array<{ taskId?: string; prompt: string; cwd: string }> = [];
  return {
    started,
    core: {
      hasActiveTasks: true,
      startTask: (input: { taskId?: string; prompt: string; cwd: string }) => {
        started.push(input);
        return input.taskId ?? "";
      },
    },
  };
}

let db: ReturnType<typeof fakeDatabase>;
let engine: ReturnType<typeof fakeCore>;

beforeEach(() => {
  resetQueueForTests();
  delivered.length = 0;
  db = fakeDatabase();
  engine = fakeCore();
  ctx.database = db.database as never;
  ctx.agentCore = engine.core as never;
  ctx.startingTasks = 1; // the start under test, as handleTaskStart counts it
  ctx.screenRun = null;
  ctx.deletingData = false;
  ctx.queueFrozen = false;
  ctx.mainWindow = null;
  ctx.attachmentsRoot = null;
  ctx.editManager = null;
});

afterEach(() => {
  ctx.database = null;
  ctx.agentCore = null;
  ctx.startingTasks = 0;
});

const ask = (message: string, conversationId: string | null = "a") =>
  startConversationTask(message, conversationId, undefined, [], { allowQueue: true });

/** Poko becomes free: the running task ended and no start is counted. */
function becomeFree(): void {
  engine.core.hasActiveTasks = false;
  ctx.startingTasks = 0;
}

describe("asking while Poko is busy", () => {
  it("queues the main window's question, and refuses others as before", async () => {
    expect(await ask("이어서 질문")).toEqual({
      queued: { taskId: "w1", conversationId: "a", text: "이어서 질문" },
    });
    expect(hasWaiting()).toBe(true);
    // Folder changes and data deletion wait for it too.
    expect(anyTaskBusy()).toBe(true);
    // The quick panel doesn't queue in milestone 1.
    expect(await startConversationTask("빠른 질문", null)).toEqual({ error: BUSY_MESSAGE });
    expect(db.calls).toEqual(["queue:이어서 질문"]);
  });

  it("holds at most three, and counts places taken by starts still being checked", async () => {
    const asked = await Promise.all([ask("1"), ask("2"), ask("3"), ask("4")]);
    expect(asked.filter((reply) => "queued" in reply)).toHaveLength(3);
    expect(asked.at(-1)).toEqual({ error: QUEUE_FULL });
  });

  it("queues behind a waiting question even when nothing runs, so order stays oldest first", async () => {
    await ask("먼저");
    becomeFree();
    ctx.startingTasks = 1;
    expect(await ask("나중")).toMatchObject({ queued: { text: "나중" } });
    expect(engine.started).toEqual([]);
  });

  it("starts the oldest question only once Poko is fully free, after the last task's edits settle", async () => {
    await ask("첫째");
    await ask("둘째");
    const settled: string[] = [];
    ctx.editManager = {
      settle: async (taskId: string) => {
        settled.push(taskId);
        return false;
      },
    } as never;
    noteTaskEnded("t0");

    // The ended task still counts as active (its terminal event comes first).
    ctx.startingTasks = 0;
    await startNext();
    expect(engine.started).toEqual([]);

    becomeFree();
    await startNext();
    expect(settled).toEqual(["t0"]);
    expect(engine.started).toEqual([
      expect.objectContaining({ taskId: "w1", prompt: "첫째", cwd: here }),
    ]);
    expect(db.calls).toContain("start:w1");
    // One at a time: the second waits for the first to end.
    expect(hasWaiting()).toBe(true);
    expect(ctx.startingTasks).toBe(0);
  });

  it("never starts the next question while quitting or deleting data", async () => {
    await ask("질문");
    becomeFree();
    ctx.queueFrozen = true;
    await startNext();
    ctx.queueFrozen = false;
    ctx.deletingData = true;
    await startNext();
    expect(engine.started).toEqual([]);
    expect(hasWaiting()).toBe(true);
  });

  it("shows why a question couldn't start and moves on to the next one", async () => {
    await ask("첫째");
    await ask("둘째");
    becomeFree();
    let attempts = 0;
    engine.core.startTask = (input) => {
      attempts += 1;
      if (attempts === 1) throw new Error("engine");
      engine.started.push(input);
      return input.taskId ?? "";
    };
    await startNext();
    expect(delivered).toEqual([
      { taskId: "w1", event: { type: "error", error: "작업을 시작하지 못했어." } },
    ]);
    expect(engine.started.map((input) => input.taskId)).toEqual(["w2"]);
  });

  it("fails a question whose folder is gone by its turn", async () => {
    // Queued after its folder was checked; the folder disappears while it waits.
    await enqueueQuestion({
      shown: "질문",
      message: "질문",
      conversationId: "a",
      folder: "/no/such/folder/poko-test",
      attachments: [],
    });
    becomeFree();
    await startNext();
    expect(engine.started).toEqual([]);
    expect(delivered[0]).toMatchObject({ taskId: "w1", event: { type: "error" } });
    expect(delivered[0].event.error).toContain("폴더를 찾지 못했어");
  });

  it("cancels a waiting question without ending anything, and not one that started", async () => {
    await ask("질문");
    expect(cancelQueued("w1")).toBe(true);
    expect(db.calls).toContain("cancelled:w1");
    expect(hasWaiting()).toBe(false);
    expect(delivered).toEqual([]);
    expect(cancelQueued("w1")).toBe(false);
  });
});
