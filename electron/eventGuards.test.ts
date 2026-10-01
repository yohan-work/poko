import { describe, expect, it } from "vitest";
import { isTaskEventPayload } from "./eventGuards";

const approval = {
  type: "approvalRequired",
  requestId: "step-1",
  summary: "‘Add one’을 누를게.",
  cwd: null,
  reason: null,
  canApprove: true,
};
const crop = "data:image/png;base64,AA";
const valid = (event: Record<string, unknown>) => isTaskEventPayload({ taskId: "t", event });

describe("task event guards", () => {
  it("lets every kind of approval through, including a screen step with its crop", () => {
    expect(valid({ ...approval, kind: "command" })).toBe(true);
    expect(valid({ ...approval, kind: "file_change", diff: [{ path: "a", change: "b" }] })).toBe(
      true,
    );
    expect(
      valid({
        ...approval,
        kind: "screen_action",
        screen: { action: "type", crop, target: "Search", text: "poko", warning: "조심" },
      }),
    ).toBe(true);
  });

  it("rejects a screen step without a PNG crop or with a malformed preview", () => {
    expect(valid({ ...approval, kind: "screen_action" })).toBe(false);
    expect(
      valid({
        ...approval,
        kind: "screen_action",
        screen: { action: "click", crop: "https://evil.example/x.png", target: "A" },
      }),
    ).toBe(false);
    expect(
      valid({ ...approval, kind: "screen_action", screen: { action: "drag", crop, target: "A" } }),
    ).toBe(false);
    expect(valid({ ...approval, kind: "unknown" })).toBe(false);
  });
});
