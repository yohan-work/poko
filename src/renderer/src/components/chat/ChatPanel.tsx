import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";
import { ApprovalCard } from "./ApprovalCard";

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h11M10 4l6 6-6 6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <rect x="5" y="5" width="10" height="10" rx="2" />
    </svg>
  );
}

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const messages = useAppStore((state) => state.messages);
  const characterState = useAppStore((state) => state.characterState);
  const isSending = useAppStore((state) => state.isSending);
  const progressMessage = useAppStore((state) => state.progressMessage);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const workspace = useAppStore((state) => state.workspace);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const cancelTask = useAppStore((state) => state.cancelTask);
  const activeTaskId = useAppStore((state) => state.activeTaskId);
  const hasPendingApproval = useAppStore((state) => state.pendingApproval !== null);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;
    setDraft("");
    void sendMessage(message);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section className="chat-panel" aria-label="Poko와 대화">
      <div className="chat-panel__conversation" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="welcome">
            <Character state={characterState} />
            <p className="welcome__eyebrow">안녕, 나는 포코야</p>
            <h1>무엇을 같이 살펴볼까?</h1>
            <p className="welcome__copy">
              프로젝트를 고르면 포코가 파일을 읽고 구조와 개선점을 살펴볼게.
            </p>
            {!workspace && <p className="welcome__hint">먼저 위에서 작업할 폴더를 선택해 줘.</p>}
          </div>
        ) : (
          <>
            <div className="chat-panel__companion">
              <Character state={characterState} />
            </div>
            <ol className="message-list" aria-label="대화 기록">
              {messages.map((message) => (
                <li className={`message message--${message.role}`} key={message.id}>
                  {message.role === "assistant" && <span className="message__sender">포코</span>}
                  <p>{message.content}</p>
                </li>
              ))}
              <ApprovalCard />
              {isSending && !hasPendingApproval && (
                <li
                  className="message message--assistant message--loading"
                  aria-label="응답 기다리는 중"
                >
                  <span className="thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="message__progress">
                    {progressMessage ?? "프로젝트를 살펴보고 있어."}
                  </span>
                </li>
              )}
            </ol>
          </>
        )}
      </div>

      <form className="composer" onSubmit={submitMessage}>
        <label className="composer__label" htmlFor="poko-message">
          포코에게 메시지
        </label>
        <div
          className="composer__row"
          data-state={
            isSending
              ? "loading"
              : errorMessage
                ? "error"
                : characterState === "success"
                  ? "success"
                  : "default"
          }
        >
          <textarea
            id="poko-message"
            className="composer__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="메시지를 입력해 줘"
            rows={1}
            disabled={isSending}
            aria-describedby={errorMessage ? "composer-error" : "composer-hint"}
            aria-invalid={Boolean(errorMessage)}
          />
          <button
            className="send-button"
            type={isSending ? "button" : "submit"}
            onClick={isSending ? () => void cancelTask() : undefined}
            disabled={isSending ? !activeTaskId : !draft.trim()}
            data-state={
              isSending
                ? "cancel"
                : errorMessage
                  ? "error"
                  : characterState === "success"
                    ? "success"
                    : "default"
            }
            aria-label={isSending ? "작업 멈추기" : "메시지 보내기"}
          >
            {isSending ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
        <div className="composer__meta">
          <p id={errorMessage ? "composer-error" : "composer-hint"} className="composer__hint">
            {errorMessage ??
              (isSending
                ? "작업이 끝날 때까지 기다리거나 멈출 수 있어."
                : "Enter로 보내기 · Shift + Enter로 줄 바꾸기")}
          </p>
          <span className="composer__mode">읽기 전용</span>
        </div>
      </form>
    </section>
  );
}
