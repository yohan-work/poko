import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { QuickState } from "../../../../../electron/shared";
import { Character } from "../character/Character";
import { Markdown } from "../chat/Markdown";

const IDLE: QuickState = {
  phase: "idle",
  question: "",
  answer: "",
  message: null,
  conversationId: null,
  taskId: null,
  screen: null,
  screenHint: null,
  opened: 0,
};

const characterFor = {
  idle: "idle",
  running: "working",
  approval: "approval",
  done: "success",
  error: "error",
} as const;

/** The quick panel: one question, its streaming answer, and a way into the app. */
export function QuickPanel() {
  const [state, setState] = useState<QuickState>(IDLE);
  const [draft, setDraft] = useState("");
  // Off by default: a screenshot leaves the Mac only when the user includes it.
  const [withScreen, setWithScreen] = useState(false);
  // Every opening starts without the screen again, even over the same window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on each opening
  useEffect(() => setWithScreen(false), [state.opened]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // The window follows the panel's height (plus its outer margin), so nothing invisible
  // sits over the app below.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      void window.poko.quick.resize(panel.getBoundingClientRect().height + 16);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      window.poko.quick.onState((next) => {
        setState(next);
        inputRef.current?.focus();
      }),
    [],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) void window.poko.quick.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const busy = state.phase === "running" || state.phase === "approval";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    void window.poko.quick.ask(question, withScreen && !state.screenHint);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="quick" aria-label="포코에게 묻기" ref={panelRef}>
      <form className="quick__ask" onSubmit={submit}>
        <Character state={characterFor[state.phase]} size={28} />
        <label className="sr-only" htmlFor="quick-input">
          포코에게 물어볼 내용
        </label>
        <textarea
          id="quick-input"
          ref={inputRef}
          className="quick__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            busy
              ? "포코가 답하는 중이야…"
              : withScreen
                ? "이 화면에 대해 물어봐"
                : "포코에게 물어봐"
          }
          rows={1}
          maxLength={10_000}
          disabled={busy}
          // biome-ignore lint/a11y/noAutofocus: the panel exists to type one question
          autoFocus
        />
      </form>
      {state.screen && !busy && (
        <div className="quick__screen">
          <button
            type="button"
            className="quick__screen-chip"
            aria-pressed={withScreen}
            disabled={Boolean(state.screenHint)}
            onClick={() => {
              setWithScreen((value) => !value);
              inputRef.current?.focus();
            }}
            title={
              withScreen
                ? "이 창의 스크린샷과 화면 요소 이름을 Codex로 보내. 다시 누르면 빼."
                : "누르면 이 창을 질문에 함께 넣어."
            }
          >
            <span aria-hidden="true">{withScreen ? "✓" : "+"}</span>
            <span className="quick__screen-name">
              {state.screen.app}
              {state.screen.title ? ` · ${state.screen.title}` : ""}
            </span>
            <span>{withScreen ? "함께 보는 중" : "화면과 함께 묻기"}</span>
          </button>
          {state.screenHint && <span className="quick__hint">{state.screenHint}</span>}
        </div>
      )}
      {state.phase !== "idle" && (
        <div className="quick__result">
          {state.question && <p className="quick__question">{state.question}</p>}
          {state.answer && (
            <div className="quick__answer">
              <Markdown>{state.answer}</Markdown>
            </div>
          )}
          {state.message && (
            <p
              className="quick__status"
              data-tone={state.phase === "error" ? "error" : "default"}
              role={state.phase === "error" ? "alert" : undefined}
            >
              {state.message}
            </p>
          )}
          <div className="quick__actions">
            <span className="quick__hint">Esc로 닫기 · 닫아도 계속 진행돼</span>
            <button
              className={state.phase === "approval" ? "primary-button" : "secondary-button"}
              type="button"
              onClick={() => void window.poko.quick.openInApp(state.conversationId)}
            >
              {state.phase === "approval" ? "앱에서 확인하기" : "앱에서 이어서"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
