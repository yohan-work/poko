import { mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { BUSY_MESSAGE, ctx, folderMismatch, isQuickPanel, startConversationTask } = await import(
  "./context"
);

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

describe("folderMismatch", () => {
  it("lets a conversation continue only in its own folder", async () => {
    const here = await realpath(tmpdir());
    const conversations: Record<string, { workspacePath: string | null }> = {
      none: { workspacePath: null },
      same: { workspacePath: here },
      other: { workspacePath: "/" },
      gone: { workspacePath: "/no/such/folder/poko-test" },
      // The same folder, stored as a link to it.
      linked: { workspacePath: join(await mkdtemp(join(tmpdir(), "poko-link-")), "here") },
    };
    await symlink(here, conversations.linked.workspacePath as string);
    ctx.database = { getConversation: (id: string) => conversations[id] ?? null } as never;
    expect(await folderMismatch("none", here)).toBeNull();
    expect(await folderMismatch("same", here)).toBeNull();
    expect(await folderMismatch("other", here)).toContain("폴더에서 나눈 대화야");
    expect(await folderMismatch("gone", here)).toContain("폴더를 찾지 못했어");
    expect(await folderMismatch("linked", here)).toBeNull();
    ctx.database = null;
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
