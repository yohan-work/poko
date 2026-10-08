import { useEffect, useState } from "react";
import { Icon } from "../Icon";

/** Copies a whole answer as written (Markdown), and says so for a moment. */
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <button
      className="speak-button"
      type="button"
      aria-label="답변 복사"
      title="답변 복사"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
    >
      <Icon name={state === "copied" ? "check" : "copy"} />
      <span role="status">
        {state === "copied" ? "복사했어" : state === "failed" ? "복사하지 못했어" : "복사"}
      </span>
    </button>
  );
}
