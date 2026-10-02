import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { OUTPUT_PROGRESS, useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";
import { Icon } from "../Icon";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";
import { ScreenPicker } from "./ScreenPicker";
import { ModelSelect } from "./ModelSelect";
import { EditNoteItem } from "./EditNoteItem";
import type { EditNote, PersistedMessage } from "../../../../../electron/shared";
import { useNow } from "../../lib/useNow";

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "좋은 아침이야";
  if (hour >= 11 && hour < 17) return "좋은 오후야";
  if (hour >= 17 && hour < 22) return "좋은 저녁이야";
  return "늦은 밤이네";
}

/** Messages and approved changes in time order; a change sits where it was approved. */
export function timeline(
  messages: PersistedMessage[],
  notes: EditNote[],
): Array<PersistedMessage | EditNote> {
  return [...messages, ...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
  const edits = useAppStore((state) => state.edits);
  const setEdits = useAppStore((state) => state.setEdits);
  const openScreen = useAppStore((state) => state.openScreen);
  const busyElsewhere = useAppStore((state) => state.busyElsewhere);

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
    if (!message || isSending || busyElsewhere) return;
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
          <button
            className="chip"
            type="button"
            onClick={() => void openScreen()}
            disabled={isSending}
            title="고른 창을 보고 설명해 줘"
          >
            <Icon name="screen" />
            <span>화면 보기</span>
          </button>
          <button
            className="composer__mode"
            type="button"
            data-state={edits.enabled ? "edit" : "read"}
            onClick={() => void setEdits(!edits.enabled)}
            disabled={!edits.available}
            title={
              edits.enabled
                ? "포코가 변경을 제안할 수 있어(Claude Code·macOS에서는 명령도). 하나하나 확인을 받아. 누르면 읽기 전용으로 돌아가."
                : "포코는 파일을 바꾸지 않아. 누르면 수정을 허용할 수 있어."
            }
          >
            {edits.enabled ? "수정 허용" : "읽기 전용"}
          </button>
          <ModelSelect />
          <button
            className="send-button"
            type={isSending ? "button" : "submit"}
            onClick={isSending ? () => void cancelTask() : undefined}
            disabled={isSending ? !activeTaskId : !draft.trim() || busyElsewhere}
            data-state={isSending ? "cancel" : "send"}
            aria-label={isSending ? "작업 멈추기" : "메시지 보내기"}
            title={
              isSending
                ? "작업 멈추기"
                : busyElsewhere
                  ? "포코가 다른 작업 중이야. 끝난 뒤에 보낼 수 있어."
                  : "보내기 (Enter)"
            }
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
      <ScreenPicker question={draft} onPicked={() => setDraft("")} />
    </form>
  );
}

/** A task started from the quick panel waits for approval in another conversation. */
function ForeignBanner() {
  const foreignApproval = useAppStore((state) => state.foreignApproval);
  const showForeignTask = useAppStore((state) => state.showForeignTask);
  if (!foreignApproval) return null;
  return (
    <div className="foreign-banner" role="status">
      <span>다른 대화에서 확인이 필요해.</span>
      <button className="secondary-button" type="button" onClick={() => void showForeignTask()}>
        보기
      </button>
    </div>
  );
}

export function ChatPanel() {
  const messages = useAppStore((state) => state.messages);
  const editNotes = useAppStore((state) => state.editNotes);
  const characterState = useAppStore((state) => state.characterState);
  const isSending = useAppStore((state) => state.isSending);
  const progressMessage = useAppStore((state) => state.progressMessage);
  const hasPendingApproval = useAppStore((state) => state.pendingApprovals.length > 0);
  const streamingText = useAppStore((state) => state.streaming?.text ?? "");
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const isEmpty = messages.length === 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // New messages, approvals, and the start or end of a task always bring the log to the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the log grows
  useEffect(() => {
    followRef.current = true;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, isSending, hasPendingApproval]);

  // Streamed text and progress lines that appear under it are followed only while the reader
  // is at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow each streamed frame and progress change
  useEffect(() => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [streamingText, progressMessage]);

  if (isEmpty) {
    return (
      <section className="chat-panel chat-panel--empty" aria-label="Poko와 대화">
        <div className="welcome">
          <h1 className="welcome__title">
            <Character state={characterState} size={44} />
            <span>{greeting(now)}</span>
          </h1>
          <ForeignBanner />
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
      <div
        ref={scrollRef}
        className="chat-panel__scroll"
        role="log"
        aria-live="polite"
        onScroll={() => {
          const element = scrollRef.current;
          if (!element) return;
          followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <ol className="message-list" aria-label="대화 기록">
          {timeline(messages, editNotes).map((entry) => {
            if ("files" in entry) return <EditNoteItem key={entry.id} note={entry} />;
            return entry.role === "user" ? (
              <li className="message message--user" key={entry.id}>
                <p>{entry.content}</p>
              </li>
            ) : (
              <li className="message message--assistant" key={entry.id}>
                <Character state="idle" size={26} />
                <Markdown>{entry.content}</Markdown>
              </li>
            );
          })}
          {isSending && streamingText && (
            <li className="message message--assistant message--streaming" aria-busy="true">
              <Character state={characterState} size={26} />
              <Markdown>{streamingText}</Markdown>
            </li>
          )}
          <ApprovalCard />
          {/* Keep showing progress (tools, steps after an approval) below a streamed message;
              hide it only while the answer itself is being written. */}
          {isSending &&
            !hasPendingApproval &&
            !(streamingText && progressMessage === OUTPUT_PROGRESS) && (
              <li className="message message--assistant message--loading">
                <Character state={characterState} size={26} />
                <p className="message__progress">
                  {progressMessage ?? "프로젝트를 살펴보고 있어."}
                </p>
              </li>
            )}
        </ol>
        <div ref={endRef} />
      </div>
      <div className="chat-panel__composer">
        <ForeignBanner />
        <Composer autoFocus={false} />
      </div>
    </section>
  );
}
