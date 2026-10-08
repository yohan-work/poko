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

  const label = state === "copied" ? "복사했어" : state === "failed" ? "복사하지 못했어" : "복사";
  return (
    <>
      <button
        className="speak-button"
        type="button"
        title="답변 복사"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setState("copied"),
            () => setState("failed"),
          )
        }
      >
        <Icon name={state === "copied" ? "check" : "copy"} />
        <span>{label}</span>
      </button>
      {/* Announced on its own: a status inside a labelled button isn't read reliably. */}
      <span className="sr-only" role="status">
        {state === "idle" ? "" : label}
      </span>
    </>
  );
}
