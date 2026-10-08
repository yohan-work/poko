import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, dialog: {}, ipcMain: { handle: vi.fn() } }));

const { ctx } = await import("./context");
const { memoryFolder } = await import("./workspace");

describe("memoryFolder", () => {
  it("files a suggestion under its task's folder, and a typed one under the selected folder", async () => {
    const here = await realpath(tmpdir());
    const tasks: Record<string, string> = { a: "/w/a", screen: "screen:Safari" };
    let selected: string | null = tmpdir();
    ctx.database = {
      hasTask: (id: string) => id in tasks,
      getTaskWorkspace: (id: string) => tasks[id] ?? null,
      getWorkspace: () => selected,
    } as never;
    // Shared types never get a folder.
    expect(await memoryFolder("preference", "a")).toBeNull();
    // From a suggestion: the task's folder, whatever is selected now.
    expect(await memoryFolder("project", "a")).toBe("/w/a");
    expect(await memoryFolder("project", "screen")).toBeNull();
    // A suggesting task that was deleted (모든 데이터 삭제): refused, never quietly shared.
    expect(await memoryFolder("project", "deleted")).toEqual({
      error: expect.stringContaining("어느 폴더 것인지"),
    });
    // Typed on the page: the selected folder, resolved; refused without one.
    expect(await memoryFolder("decision", undefined)).toBe(here);
    selected = "/no/such/folder/poko-test";
    expect(await memoryFolder("decision", undefined)).toEqual({
      error: expect.stringContaining("찾지 못했어"),
    });
    selected = null;
    expect(await memoryFolder("decision", undefined)).toEqual({
      error: expect.stringContaining("먼저 작업할 폴더"),
    });
    ctx.database = null;
  });
});
