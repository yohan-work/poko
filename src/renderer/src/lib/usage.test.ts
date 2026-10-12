import { describe, expect, it } from "vitest";
import { limitLine, tokenCount, usageLine } from "./usage";

describe("usage formatting", () => {
  it("shortens token counts and adds Claude Code's API price", () => {
    expect(tokenCount(850)).toBe("850");
    expect(tokenCount(12_345)).toBe("12k");
    expect(tokenCount(4_620)).toBe("4.6k");
    expect(tokenCount(1_250_000)).toBe("1.3M");
    expect(usageLine({ inputTokens: 4620, outputTokens: 4 })).toBe("입력 4.6k · 출력 4");
    expect(usageLine({ inputTokens: 4620, outputTokens: 4, costUsd: 0.082 })).toBe(
      "입력 4.6k · 출력 4 · API 기준 약 $0.08",
    );
  });

  it("says how far into a limit the user is, and when it resets", () => {
    const now = new Date(2026, 9, 12, 10, 0);
    const line = limitLine(
      {
        label: "5시간 한도",
        usedPercent: 37.4,
        resetsAt: new Date(2026, 9, 12, 15, 20).toISOString(),
      },
      now,
    );
    expect(line.startsWith("5시간 한도 37% 사용 · ")).toBe(true);
    expect(line.endsWith("에 초기화")).toBe(true);
    expect(limitLine({ label: "5시간 한도", status: "allowed" }, now)).toBe("5시간 한도 정상");
  });
});
