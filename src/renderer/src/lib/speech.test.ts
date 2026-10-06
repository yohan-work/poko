import { describe, expect, it } from "vitest";
import { speakableText } from "./speech";

describe("speakableText", () => {
  it("reads the words and leaves out code and Markdown marks", () => {
    expect(
      speakableText(
        "## 결과\n\n- **첫째**, `pnpm dev`를 실행해.\n- [문서](https://x.dev)를 봐.\n\n```ts\nconst a = 1;\n```\n\n끝.",
      ),
    ).toBe("결과\n첫째, pnpm dev를 실행해.\n문서를 봐.\n(코드는 생략할게.)\n끝.");
  });

  it("reads tables as plain cells", () => {
    expect(speakableText("| 이름 | 값 |\n| --- | --- |\n| a | 1 |")).toBe("이름 값\na 1");
  });
});
