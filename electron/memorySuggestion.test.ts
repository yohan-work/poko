import { describe, expect, it } from "vitest";
import { hideMemoryTag, takeMemorySuggestion } from "./shared";

describe("memory suggestions", () => {
  it("takes the first tag out of the answer", () => {
    expect(
      takeMemorySuggestion(
        '알겠어요.\n\n<poko-memory type="preference">답변은 짧게 해 줘</poko-memory>\n<poko-memory type="fact">x</poko-memory>',
      ),
    ).toEqual({ text: "알겠어요.", memory: { type: "preference", content: "답변은 짧게 해 줘" } });
  });

  it("ignores unknown types, empty or long content, and leaves plain answers alone", () => {
    expect(takeMemorySuggestion('a <poko-memory type="secret">x</poko-memory>').memory).toBeNull();
    expect(takeMemorySuggestion('a <poko-memory type="fact"> </poko-memory>')).toEqual({
      text: "a",
      memory: null,
    });
    expect(
      takeMemorySuggestion(`<poko-memory type="fact">${"가".repeat(301)}</poko-memory>`).memory,
    ).toBeNull();
    expect(takeMemorySuggestion("그냥 답")).toEqual({ text: "그냥 답", memory: null });
  });

  it("hides a tag while it streams, even half written", () => {
    expect(hideMemoryTag('답이야.\n<poko-memory type="fact">abc')).toBe("답이야.");
    expect(hideMemoryTag("답이야.\n<poko-me")).toBe("답이야.");
    expect(hideMemoryTag("답이야. 2 < 3")).toBe("답이야. 2 < 3");
    expect(hideMemoryTag("답이야.")).toBe("답이야.");
  });
});
