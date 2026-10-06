import { describe, expect, it } from "vitest";
import { IDLE_STATE, reduceQuickState } from "./quickState";

describe("reduceQuickState", () => {
  const running = {
    ...IDLE_STATE,
    phase: "running" as const,
    question: "q",
    taskId: "t",
    conversationId: "c",
  };

  it("streams text, replaces it on a new message, and finishes with the result", () => {
    const item = { current: null as string | null, raw: "" };
    let state = reduceQuickState(running, { type: "output", content: "안", itemId: "m1" }, item);
    state = reduceQuickState(state, { type: "output", content: "녕", itemId: "m1" }, item);
    expect(state.answer).toBe("안녕");
    state = reduceQuickState(state, { type: "output", content: "새 답", itemId: "m2" }, item);
    expect(state.answer).toBe("새 답");
    state = reduceQuickState(state, { type: "completed", result: "최종 답" }, item);
    expect(state).toMatchObject({ phase: "done", answer: "최종 답", message: null });
  });

  it("hands approvals to the app without their details, and shows errors plainly", () => {
    const item = { current: null, raw: "" };
    const approval = reduceQuickState(
      running,
      {
        type: "approvalRequired",
        requestId: "1",
        kind: "command",
        summary: "rm -rf /",
        cwd: "/w",
        reason: null,
        canApprove: true,
      },
      item,
    );
    expect(approval).toMatchObject({
      phase: "approval",
      message: "확인이 필요해. 앱에서 확인해 줘.",
    });
    expect(JSON.stringify(approval)).not.toContain("rm -rf");
    expect(reduceQuickState(running, { type: "error", error: "실패했어." }, item)).toMatchObject({
      phase: "error",
      message: "실패했어.",
    });
  });

  it("keeps the approval phase through output until the app answers", () => {
    const item = { current: null, raw: "" };
    const waiting = {
      ...running,
      phase: "approval" as const,
      message: "확인이 필요해. 앱에서 확인해 줘.",
    };
    expect(reduceQuickState(waiting, { type: "output", content: "x" }, item).phase).toBe(
      "approval",
    );
  });
});
