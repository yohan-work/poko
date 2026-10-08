import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { QuickState } from "../../../../../electron/shared";
import { Character } from "../character/Character";
import { DictationButton } from "../chat/DictationButton";
import { Markdown } from "../chat/Markdown";
import { CopyButton } from "../chat/CopyButton";
import { SpeakButton } from "../chat/SpeakButton";
import { stopSpeaking } from "../../lib/speech";

const IDLE: QuickState = {
  phase: "idle",
  question: "",
  answer: "",
  message: null,
  conversationId: null,
  taskId: null,
  screen: null,
  screenHint: null,
  selection: null,
  opened: 0,
  memory: null,
  followUp: false,
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
  // On by default: selecting text and then opening the panel is the request to ask about it.
  const [withSelection, setWithSelection] = useState(true);
  // Every opening starts without the screen and with the selection again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on each opening
  useEffect(() => {
    setWithScreen(false);
    setWithSelection(true);
  }, [state.opened]);
  // One or the other: a screen task looks at the window, a question reads the selection.
  const selectionOn = Boolean(state.selection) && withSelection && !withScreen;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // The window follows the panel's height (plus its outer margin), so nothing invisible
  // sits over the app below.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      void window.poko.quick.resize(panel.getBoundingClientRect().height + 32);
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
      if (event.key === "Escape" && !event.isComposing) {
        stopSpeaking();
        void window.poko.quick.hide();
      }
    };
    // The panel is hidden, not closed, so reading stops when it loses focus or goes away.
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", stopSpeaking);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", stopSpeaking);
    };
  }, []);

  // A new question replaces the answer being read.
  useEffect(() => {
    if (state.phase !== "done") stopSpeaking();
  }, [state.phase]);

  const busy = state.phase === "running" || state.phase === "approval";
  // After an answer, the next question continues its conversation until 새로 묻기 (main
  // decides when it can); a question with the screen always starts fresh.
  const followingUp = state.followUp && !withScreen;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    void window.poko.quick.ask(question, withScreen && !state.screenHint, selectionOn, followingUp);
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
                : selectionOn
                  ? "선택한 글로 무엇을 할까? (예: 다듬어 줘, 요약해 줘)"
                  : followingUp
                    ? "이어서 물어봐"
                    : "포코에게 물어봐"
          }
          rows={1}
          maxLength={10_000}
          disabled={busy}
          // biome-ignore lint/a11y/noAutofocus: the panel exists to type one question
          autoFocus
        />
        <DictationButton
          target={inputRef}
          disabled={busy}
          className="icon-button"
          inlineHint={false}
        />
      </form>
      {state.selection && !busy && (
        <div className="quick__screen">
          <button
            type="button"
            className="quick__screen-chip"
            aria-pressed={selectionOn}
            onClick={() => {
              const next = !selectionOn;
              setWithSelection(next);
              if (next) setWithScreen(false);
              inputRef.current?.focus();
            }}
            title={
              selectionOn
                ? `선택한 글 ${state.selection.chars.toLocaleString()}자를 질문에 함께 넣어. 다시 누르면 빼.`
                : "누르면 선택한 글을 질문에 함께 넣어."
            }
          >
            <span aria-hidden="true">{selectionOn ? "✓" : "+"}</span>
            <span className="quick__screen-name">“{state.selection.preview}”</span>
            <span>{selectionOn ? "선택한 글과 함께" : "선택한 글과 함께 묻기"}</span>
          </button>
        </div>
      )}
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
                ? "이 창의 스크린샷과 화면 요소 이름을 설정에서 고른 엔진으로 보내. 다시 누르면 빼."
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
      {state.followUp && !busy && (
        <div className="quick__screen">
          <span className="quick__hint">
            {withScreen ? "화면과 함께 묻는 건 새 대화로 시작해." : "이 대화에 이어서 물어."}
          </span>
          <button
            type="button"
            className="quick__screen-chip"
            onClick={() => {
              void window.poko.quick.fresh();
              inputRef.current?.focus();
            }}
          >
            <span aria-hidden="true">+</span>
            <span>새로 묻기</span>
          </button>
        </div>
      )}
      {state.phase !== "idle" && (
        <div className="quick__result">
          {state.question && <p className="quick__question">{state.question}</p>}
          {state.answer && (
            <div className="quick__answer">
              <Markdown>{state.answer}</Markdown>
              {state.phase === "done" && state.taskId && (
                <div className="message__actions">
                  <SpeakButton id={state.taskId} text={state.answer} />
                  <CopyButton text={state.answer} />
                </div>
              )}
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
          {state.memory && (
            <div className="memory-suggestion quick__memory">
              <p className="memory-suggestion__title">이걸 기억해 둘까?</p>
              <p className="memory-suggestion__content">{state.memory.content}</p>
              <div className="memory-suggestion__actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void window.poko.quick.remember(false).catch(() => false)}
                >
                  괜찮아
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void window.poko.quick.remember(true).catch(() => false)}
                >
                  기억하기
                </button>
              </div>
            </div>
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
