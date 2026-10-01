import { describe, expect, it } from "vitest";
import { CONTEXT_LIMITS, formatContext, limitContext } from "./context";

const exchange = (n: number, size = 10) => ({
  request: `q${n} ${"x".repeat(size)}`,
  answer: `a${n} ${"y".repeat(size)}`,
});

describe("limitContext", () => {
  it("keeps the newest exchanges when the history cap is hit, then returns them oldest first", () => {
    // Newest first, each exchange ~3,000 characters, so only two fit in 8,000.
    const newestFirst = [exchange(5, 1500), exchange(4, 1500), exchange(3, 1500)];
    const { history } = limitContext([], newestFirst);
    expect(history.map((item) => item.request.slice(0, 2))).toEqual(["q4", "q5"]);
  });

  it("caps exchange count and truncates each side", () => {
    const many = Array.from({ length: 8 }, (_, i) => exchange(8 - i, 3000));
    const { history } = limitContext([], many);
    expect(history.length).toBeLessThanOrEqual(CONTEXT_LIMITS.exchangeCount);
    for (const item of history) {
      expect(item.request.length).toBeLessThanOrEqual(CONTEXT_LIMITS.exchangeSideChars);
      expect(item.answer.endsWith("…")).toBe(true);
    }
    expect(history.at(-1)?.request.startsWith("q8")).toBe(true);
  });

  it("keeps memories in priority order within the count and character caps", () => {
    const memories = Array.from({ length: 50 }, (_, i) => ({
      type: "fact",
      content: `${i} ${"m".repeat(300)}`,
    }));
    const result = limitContext(memories, []);
    const total = result.memories.reduce((sum, item) => sum + item.content.length, 0);
    expect(result.memories[0].content.startsWith("0 ")).toBe(true);
    expect(result.memories.length).toBeLessThanOrEqual(CONTEXT_LIMITS.memoryCount);
    expect(total).toBeLessThanOrEqual(CONTEXT_LIMITS.memoryChars);
    expect(
      limitContext([{ type: "fact", content: "z".repeat(5000) }], []).memories[0].content,
    ).toHaveLength(CONTEXT_LIMITS.memoryEntryChars);
  });

  it("drops empty entries", () => {
    const result = limitContext([{ type: "fact", content: "   " }], [{ request: "q", answer: "" }]);
    expect(result).toEqual({ memories: [], history: [] });
  });
});

describe("formatContext", () => {
  it("labels memories as user-written and never overriding safety, then lists history", () => {
    const [memories, history] = formatContext({
      memories: [{ type: "preference", content: "답변은 간결하게" }],
      history: [{ request: "구조 설명해 줘", answer: "Electron 앱이야." }],
    });
    expect(memories).toContain("never override the safety rules");
    expect(memories).toContain("- [preference] 답변은 간결하게");
    expect(history).toContain("User: 구조 설명해 줘\nPoko: Electron 앱이야.");
  });

  it("adds nothing without context", () => {
    expect(formatContext(undefined)).toEqual([]);
    expect(formatContext({ memories: [], history: [] })).toEqual([]);
  });
});
