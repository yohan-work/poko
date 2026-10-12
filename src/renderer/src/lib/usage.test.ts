import { describe, expect, it } from "vitest";
import { limitLine, tokenCount, usageLine } from "./usage";

describe("usage formatting", () => {
  it("shortens token counts across unit boundaries", () => {
    expect(tokenCount(850)).toBe("850");
    expect(tokenCount(999.7)).toBe("1.0k");
    expect(tokenCount(4_620)).toBe("4.6k");
    expect(tokenCount(9_960)).toBe("10k");
    expect(tokenCount(12_345)).toBe("12k");
    expect(tokenCount(999_600)).toBe("1.0M");
    expect(tokenCount(1_250_000)).toBe("1.3M");
  });

  it("adds Claude Code's API price, and says when it is under a cent", () => {
    expect(usageLine({ inputTokens: 4620, outputTokens: 4 })).toBe("입력 4.6k · 출력 4");
    expect(usageLine({ inputTokens: 4620, outputTokens: 4, costUsd: 0.082 })).toBe(
      "입력 4.6k · 출력 4 · API 기준 약 $0.08",
    );
    expect(usageLine({ inputTokens: 10, outputTokens: 1, costUsd: 0.004 })).toBe(
      "입력 10 · 출력 1 · API 기준 $0.01 미만",
    );
  });

  it("says how far into a limit the user is and when it resets, in 24-hour time", () => {
    const now = new Date(2026, 9, 12, 10, 0);
    expect(
      limitLine(
        {
          label: "5시간 한도",
          usedPercent: 37.4,
          resetsAt: new Date(2026, 9, 12, 15, 20).toISOString(),
        },
        now,
      ),
    ).toBe("5시간 한도 37% 사용 · 15:20에 초기화");
    expect(limitLine({ label: "5시간 한도", status: "allowed" }, now)).toBe("5시간 한도 정상");
  });

  it("doesn't show an old percent for a window that has already reset", () => {
    const now = new Date(2026, 9, 12, 18, 0);
    expect(
      limitLine(
        {
          label: "5시간 한도",
          usedPercent: 95,
          resetsAt: new Date(2026, 9, 12, 15, 20).toISOString(),
        },
        now,
      ),
    ).toBe("5시간 한도 · 초기화됐어 (다음 작업 때 새로 알려 줘)");
  });
});
