import { describe, expect, it } from "vitest";
import { noticeFor, plainLine } from "./taskNotice";

describe("task notices", () => {
  it("turns an answer into one short plain line", () => {
    expect(plainLine("## 요약\n- **첫째** 항목\n```js\ncode()\n```\n[링크](https://x)")).toBe(
      "요약 첫째 항목 링크",
    );
    expect(plainLine("가".repeat(200))).toHaveLength(120);
  });

  it("notifies the end of a task and approvals only", () => {
    expect(noticeFor({ type: "completed", result: "끝났어" })).toEqual({
      title: "포코가 답했어",
      body: "끝났어",
    });
    expect(noticeFor({ type: "error", error: "실패했어." })?.title).toContain("마치지 못했어");
    const card = {
      type: "approvalRequired",
      requestId: "1",
      kind: "command",
      summary: "npm test",
      cwd: "/w",
      reason: null,
    } as const;
    expect(noticeFor({ ...card, canApprove: true })?.body).toBe("npm test");
    expect(noticeFor({ ...card, canApprove: false })).toBeNull();
    expect(noticeFor({ type: "cancelled" })).toBeNull();
    expect(noticeFor({ type: "output", content: "x" })).toBeNull();
  });
});
