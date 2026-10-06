import { type RefObject, useState } from "react";
import { Icon } from "../Icon";

/** Starts macOS Dictation into a text field: the field is focused first, so words land there. */
export function DictationButton({
  target,
  disabled,
  className = "chip",
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        className={`${className} dictation-button`}
        type="button"
        disabled={disabled}
        aria-label="말로 입력하기"
        title="말로 입력하기 (macOS 받아쓰기). fn 키를 두 번 눌러도 돼."
        onClick={() => {
          target.current?.focus();
          setFailed(false);
          void window.poko.dictation
            .start()
            .catch(() => false)
            .then((started) => {
              setFailed(!started);
              target.current?.focus();
            });
        }}
      >
        <Icon name="mic" />
      </button>
      {failed && (
        <span className="dictation-hint" role="status">
          받아쓰기를 열지 못했어. fn 키를 두 번 눌러 봐.
        </span>
      )}
    </>
  );
}
