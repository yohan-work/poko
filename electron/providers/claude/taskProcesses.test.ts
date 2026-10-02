import { describe, expect, it } from "vitest";
import { stopTaskProcesses } from "./taskProcesses";

describe("stopTaskProcesses", () => {
  it("pauses, re-checks, and kills only processes that still match; spares helpers", async () => {
    const calls: string[] = [];
    let round = 0;
    const find = async () => {
      round += 1;
      // pid 30 exits (or is reused) between the two checks.
      return round === 1 ? [10, 20, 30] : [10, 20];
    };
    const stopped = await stopTaskProcesses(find, "/t", "/w", new Set([20]), (pid, signal) =>
      calls.push(`${pid}:${signal}`),
    );
    expect(stopped).toBe(1);
    expect(calls).toEqual(["10:SIGSTOP", "30:SIGSTOP", "10:SIGKILL", "30:SIGCONT"]);
  });

  it("does nothing when nothing matches or the helper fails", async () => {
    const calls: string[] = [];
    expect(
      await stopTaskProcesses(
        async () => [],
        "/t",
        "/w",
        new Set(),
        () => calls.push("x"),
      ),
    ).toBe(0);
    expect(
      await stopTaskProcesses(
        () => Promise.reject(new Error("no helper")),
        "/t",
        "/w",
        new Set(),
        () => calls.push("x"),
      ),
    ).toBe(0);
    expect(calls).toEqual([]);
  });
});
