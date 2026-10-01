import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (markdown: string) => renderToStaticMarkup(<Markdown>{markdown}</Markdown>);

describe("Markdown", () => {
  it("renders lists, inline code, tables, and code blocks with a copy button", () => {
    const html = render(
      "- one\n- `two`\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```",
    );
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>two</code>");
    expect(html).toContain("<table>");
    expect(html).toContain('class="code-block__copy"');
    expect(html).toContain('<code class="language-ts">const x = 1;\n</code>');
  });

  it("shows raw HTML as text instead of rendering it", () => {
    const html = render('hello <img src="x" onerror="alert(1)"> <b>bold</b>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(render("<script>alert(1)</script>")).not.toContain("<script");
    // Block-level HTML is escaped too, never turned into an element.
    const block = render('<div onclick="alert(1)">block</div>');
    expect(block).toContain("&lt;div onclick=");
    expect(block).not.toContain("<div onclick");
  });

  it("keeps Korean ranges like 1~2시간 and strikes only double tildes", () => {
    const html = render("보통 1~2시간 걸리고, 검토는 3~4일 정도야. ~~취소~~");
    expect(html).toContain("1~2시간");
    expect(html).toContain("3~4일");
    expect(html).toContain("<del>취소</del>");
    expect(html.match(/<del>/g)).toHaveLength(1);
  });

  it("labels footnotes in Korean without exposing internal anchors", () => {
    const html = render("본문[^1]\n\n[^1]: 설명");
    expect(html).toContain("각주");
    expect(html).not.toContain("Footnotes");
    expect(html).not.toContain('title="#');
    expect(html).not.toContain("↩");
  });

  it("keeps footnote ids unique across answers", () => {
    const html = renderToStaticMarkup(
      <>
        <Markdown>{"하나[^1]\n\n[^1]: a"}</Markdown>
        <Markdown>{"둘[^1]\n\n[^1]: b"}</Markdown>
      </>,
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not make links navigable or load images", () => {
    const html = render("[docs](https://example.com) ![chart](https://example.com/a.png)");
    expect(html).not.toContain("<a");
    expect(html).toContain('title="https://example.com"');
    expect(html).not.toContain("<img");
    expect(html).toContain("[이미지: chart]");
  });
});
