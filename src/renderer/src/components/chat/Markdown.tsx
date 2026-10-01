import { isValidElement, useState, type ReactNode } from "react";
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
  const code = textOf(children).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
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
  a: ({ children, href }) => (
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
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
