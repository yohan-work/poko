import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";
import { Icon } from "../Icon";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";
import { useNow } from "../../lib/useNow";

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "좋은 아침이야";
  if (hour >= 11 && hour < 17) return "좋은 오후야";
  if (hour >= 17 && hour < 22) return "좋은 저녁이야";
  return "늦은 밤이네";
}

function Composer({ autoFocus }: { autoFocus: boolean }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSending = useAppStore((state) => state.isSending);
  const errorMessage = useAppStore((state) => state.errorMessage);
  const workspace = useAppStore((state) => state.workspace);
  const isSelectingWorkspace = useAppStore((state) => state.isSelectingWorkspace);
  const selectWorkspace = useAppStore((state) => state.selectWorkspace);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const cancelTask = useAppStore((state) => state.cancelTask);
  const activeTaskId = useAppStore((state) => state.activeTaskId);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize whenever the draft changes
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
  }, [draft]);

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || isSending) return;
    setDraft("");
    void sendMessage(message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="composer" onSubmit={submitMessage}>
      <div className="composer__box" data-state={errorMessage ? "error" : "default"}>
        <label className="sr-only" htmlFor="poko-message">
          포코에게 메시지
        </label>
        <textarea
          ref={inputRef}
          id="poko-message"
          className="composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={workspace ? "무엇을 같이 살펴볼까?" : "먼저 작업할 폴더를 골라 줘"}
          rows={1}
          disabled={isSending}
          aria-describedby={errorMessage ? "composer-error" : undefined}
          aria-invalid={Boolean(errorMessage)}
        />
        <div className="composer__toolbar">
          <button
            className="chip"
            type="button"
            onClick={() => void selectWorkspace()}
            disabled={isSelectingWorkspace || isSending}
            title={workspace?.path ?? "작업할 폴더 선택"}
          >
            <Icon name="folder" />
            <span>{workspace?.name ?? "폴더 선택"}</span>
            <Icon name="chevron" />
          </button>
          <span className="composer__mode" title="포코는 확인 없이 파일을 바꾸지 않아">
            읽기 전용
          </span>
          <button
            className="send-button"
            type={isSending ? "button" : "submit"}
            onClick={isSending ? () => void cancelTask() : undefined}
            disabled={isSending ? !activeTaskId : !draft.trim()}
            data-state={isSending ? "cancel" : "send"}
            aria-label={isSending ? "작업 멈추기" : "메시지 보내기"}
            title={isSending ? "작업 멈추기" : "보내기 (Enter)"}
          >
            <Icon name={isSending ? "stop" : "send"} />
          </button>
        </div>
      </div>
      {errorMessage && (
        <p id="composer-error" className="composer__error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}

export function ChatPanel() {
  const messages = useAppStore((state) => state.messages);
  const characterState = useAppStore((state) => state.characterState);
  const isSending = useAppStore((state) => state.isSending);
  const progressMessage = useAppStore((state) => state.progressMessage);
  const hasPendingApproval = useAppStore((state) => state.pendingApprovals.length > 0);
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const isEmpty = messages.length === 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the log grows
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isSending, hasPendingApproval]);

  if (isEmpty) {
    return (
      <section className="chat-panel chat-panel--empty" aria-label="Poko와 대화">
        <div className="welcome">
          <h1 className="welcome__title">
            <Character state={characterState} size={44} />
            <span>{greeting(now)}</span>
          </h1>
          <Composer autoFocus />
          <p className="welcome__hint">
            포코가 고른 폴더의 파일을 읽고 구조와 개선점을 살펴볼게. 명령 실행이나 파일 변경은 항상
            먼저 물어볼게.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-panel" aria-label="Poko와 대화">
      <div className="chat-panel__scroll" role="log" aria-live="polite">
        <ol className="message-list" aria-label="대화 기록">
          {messages.map((message) =>
            message.role === "user" ? (
              <li className="message message--user" key={message.id}>
                <p>{message.content}</p>
              </li>
            ) : (
              <li className="message message--assistant" key={message.id}>
                <Character state="idle" size={26} />
                <Markdown>{message.content}</Markdown>
              </li>
            ),
          )}
          <ApprovalCard />
          {isSending && !hasPendingApproval && (
            <li className="message message--assistant message--loading">
              <Character state={characterState} size={26} />
              <p className="message__progress">{progressMessage ?? "프로젝트를 살펴보고 있어."}</p>
            </li>
          )}
        </ol>
        <div ref={endRef} />
      </div>
      <div className="chat-panel__composer">
        <Composer autoFocus={false} />
      </div>
    </section>
  );
}
