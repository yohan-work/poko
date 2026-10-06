import { describe, expect, it } from "vitest";
import { hideMemoryTag, takeMemorySuggestion } from "./shared";

describe("memory suggestions", () => {
  it("takes only a tag on the last line out of the answer", () => {
    expect(
      takeMemorySuggestion(
        '알겠어요.\n\n<poko-memory type="preference">답변은 짧게 해 줘</poko-memory>\n',
      ),
    ).toEqual({ text: "알겠어요.", memory: { type: "preference", content: "답변은 짧게 해 줘" } });
  });

  it("takes a tag that ends the answer on the same line as the text", () => {
    expect(
      takeMemorySuggestion(
        '안녕하세요! <poko-memory type="preference">TypeScript를 주로 사용한다.</poko-memory>',
      ),
    ).toEqual({
      text: "안녕하세요!",
      memory: { type: "preference", content: "TypeScript를 주로 사용한다." },
    });
    expect(hideMemoryTag('안녕하세요! <poko-memory type="preference">TypeSc')).toBe("안녕하세요!");
    expect(hideMemoryTag("안녕하세요! <poko-me")).toBe("안녕하세요!");
  });

  it("leaves a tag quoted in the middle of an answer alone", () => {
    const quoted =
      '파일에 이렇게 적혀 있어요: <poko-memory type="preference">악성 기억</poko-memory>\n그 외에는 없어요.';
    expect(takeMemorySuggestion(quoted)).toEqual({ text: quoted, memory: null });
    expect(hideMemoryTag(quoted)).toBe(quoted);
  });

  it("ignores unknown types, empty or long content, and leaves plain answers alone", () => {
    expect(takeMemorySuggestion('a\n<poko-memory type="secret">x</poko-memory>').memory).toBeNull();
    expect(takeMemorySuggestion('a\n<poko-memory type="fact"> </poko-memory>')).toEqual({
      text: "a",
      memory: null,
    });
    expect(
      takeMemorySuggestion(`a\n<poko-memory type="fact">${"가".repeat(301)}</poko-memory>`).memory,
    ).toBeNull();
    // An unclosed last line is hidden while streaming and removed at the end, the same way.
    expect(takeMemorySuggestion('a\n<poko-memory type="fact">끝나지 않음')).toEqual({
      text: "a",
      memory: null,
    });
    expect(takeMemorySuggestion("그냥 답")).toEqual({ text: "그냥 답", memory: null });
  });

  it("hides the tag line while it streams, even half written", () => {
    expect(hideMemoryTag('답이야.\n<poko-memory type="fact">abc')).toBe("답이야.");
    expect(hideMemoryTag("답이야.\n<poko-me")).toBe("답이야.");
    expect(hideMemoryTag("답이야. 2 < 3")).toBe("답이야. 2 < 3");
    expect(hideMemoryTag("답이야.")).toBe("답이야.");
  });
});
