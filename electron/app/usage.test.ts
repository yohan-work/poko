import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: {}, ipcMain: { handle: vi.fn() } }));

const { localMonth } = await import("./usage");

describe("localMonth", () => {
  it("bounds the local month, so a task just after local midnight on the 1st counts in it", () => {
    const { from, to } = localMonth(new Date(2026, 10, 1, 0, 30));
    expect(new Date(from).getTime()).toBe(new Date(2026, 10, 1).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 11, 1).getTime());
  });
});
