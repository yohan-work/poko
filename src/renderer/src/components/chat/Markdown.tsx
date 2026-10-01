import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Plain text of rendered children, used for the code block copy button. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  const code = textOf(children).replace(/\n$/, "");

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      // A repeat click restarts the timer instead of letting the earlier one reset the label.
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block">
      <button className="code-block__copy" type="button" onClick={() => void copy()}>
        {copied ? "복사했어" : "복사"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  // The renderer never navigates: links stay text, with the address in a tooltip.
  a: ({ children, href }) =>
    // In-page anchors (footnote references) are not addresses worth showing.
    href?.startsWith("#") ? (
      <span>{children}</span>
    ) : (
      <span className="markdown__link" title={href}>
        {children}
      </span>
    ),
  // Remote images are never loaded; show the description instead.
  img: ({ alt }) => (
    <span className="markdown__image">{alt ? `[이미지: ${alt}]` : "[이미지]"}</span>
  ),
};

/** Poko's answers as formatted text. Raw HTML is escaped and shown as text, never rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        // Korean uses a single "~" for ranges (1~2시간), so only "~~" means strikethrough.
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        remarkRehypeOptions={{ footnoteLabel: "각주", footnoteBackLabel: "본문으로" }}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
