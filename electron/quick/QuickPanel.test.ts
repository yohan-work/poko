import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, screen: {} }));
const { QuickPanel } = await import("./QuickPanel");

describe("QuickPanel waiting question", () => {
  it("shows a waiting question, then streams it when it starts", () => {
    const panel = new QuickPanel("", undefined, "");
    panel.wait("질문", "w", null);
    expect(panel.waitingTaskId).toBe("w");
    // 새로 묻기 can't drop a question that is still waiting.
    panel.startFresh();
    expect(panel.waitingTaskId).toBe("w");
    // Another task's start leaves it waiting.
    panel.started("other", "c");
    expect(panel.waitingTaskId).toBe("w");
    panel.started("w", "c");
    expect(panel.waitingTaskId).toBeNull();
    expect(panel.taskId).toBe("w");
    panel.update({ type: "completed", result: "답" });
    expect(panel.followUpConversation).toBe("c");
  });

  it("keeps a cancelled follow-up's conversation for the next try", () => {
    const panel = new QuickPanel("", undefined, "");
    panel.wait("이어서", "w", "c");
    panel.cancelled("w");
    expect(panel.waitingTaskId).toBeNull();
    expect(panel.taskId).toBeNull();
    expect(panel.followUpConversation).toBe("c");
  });
});
