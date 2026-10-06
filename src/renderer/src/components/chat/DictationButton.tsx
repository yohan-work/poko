import { type RefObject, useEffect, useState } from "react";
import { Icon } from "../Icon";

const FAILED = "받아쓰기를 열지 못했어. fn 키를 두 번 눌러 봐.";

/**
 * Starts macOS Dictation into a text field: the field is focused first, so words land there.
 * `inlineHint` shows a failure next to the button; where the row has no room (the quick
 * panel), the failure goes in the button's tooltip instead.
 */
export function DictationButton({
  target,
  disabled,
  className = "chip",
  inlineHint = true,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  className?: string;
  inlineHint?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed) return;
    const timer = window.setTimeout(() => setFailed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [failed]);

  return (
    <>
      <button
        className={`${className} dictation-button`}
        type="button"
        // A second press while starting would turn Dictation straight back off.
        disabled={disabled || starting}
        aria-label="말로 입력하기"
        title={failed ? FAILED : "말로 입력하기 (macOS 받아쓰기). fn 키를 두 번 눌러도 돼."}
        onClick={() => {
          target.current?.focus();
          setFailed(false);
          setStarting(true);
          void window.poko.dictation
            .start()
            .catch(() => false)
            .then((started) => {
              setStarting(false);
              setFailed(!started);
              target.current?.focus();
            });
        }}
      >
        <Icon name="mic" />
      </button>
      {failed && inlineHint && (
        <span className="dictation-hint" role="status">
          {FAILED}
        </span>
      )}
    </>
  );
}
