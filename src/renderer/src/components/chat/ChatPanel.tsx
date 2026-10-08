import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { OUTPUT_PROGRESS, useAppStore } from "../../state/appStore";
import { Character } from "../character/Character";
import { Icon } from "../Icon";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";
import { ScreenPicker } from "./ScreenPicker";
import { EffortSelect, ModelSelect } from "./ModelSelect";
import { DictationButton } from "./DictationButton";
import { CopyButton } from "./CopyButton";
import { SpeakButton } from "./SpeakButton";
import { EditNoteItem } from "./EditNoteItem";
import {
  type ChatAttachment,
  type EditNote,
  hideMemoryTag,
  type PersistedMessage,
} from "../../../../../electron/shared";
import { MAX_FILES, readAttachment } from "../../lib/attachments";
import { folderName } from "../../lib/folder";
import { stopSpeaking } from "../../lib/speech";
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
  // Each file gets an id only for the list; it is not sent.
  const [attachments, setAttachments] = useState<Array<ChatAttachment & { id: string }>>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Files still being read, so sending waits for them, and slots already promised to them.
  const [reading, setReading] = useState(0);
  const reserved = useRef(0);

  async function addFiles(files: File[]) {
    if (files.length === 0) return;
    setAttachError(null);
    const room = Math.max(MAX_FILES - attachments.length - reserved.current, 0);
    const taken = files.slice(0, room);
    const notes: string[] = [];
    if (files.length > room) notes.push(`파일은 한 번에 ${MAX_FILES}개까지 붙일 수 있어.`);
    reserved.current += taken.length;
    setReading((count) => count + 1);
    try {
      const read = await Promise.all(taken.map(readAttachment));
      for (const item of read) if ("error" in item) notes.push(item.error);
      const added = read
        .filter((item): item is ChatAttachment => !("error" in item))
        .map((item) => ({ ...item, id: crypto.randomUUID() }));
      // Clamped here too: another drop may have finished since `room` was counted.
      setAttachments((current) => [...current, ...added].slice(0, MAX_FILES));
    } finally {
      reserved.current -= taken.length;
      setReading((count) => count - 1);
      if (notes.length > 0) setAttachError(notes.join(" "));
    }
  }

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
  const anyWaiting = useAppStore((state) => state.waitingQuestions.length > 0);
  // While Poko works, the button sends (the question waits) when there is something to send,
  // and stops the running task when the box is empty.
  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const stopMode = isSending && !hasContent;
  const busy = isSending || busyElsewhere || anyWaiting;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // 고쳐서 묻기: the last question comes back into the box, ready to change.
  const prefill = useAppStore((state) => state.composerPrefill);
  const takeComposerPrefill = useAppStore((state) => state.takeComposerPrefill);
  useEffect(() => {
    if (!prefill) return;
    // Taken once: a message box shown later (another page, a new conversation) starts empty.
    takeComposerPrefill();
    // A cancelled waiting question never replaces what the user is typing.
    if (prefill.ifEmpty && inputRef.current?.value.trim()) return;
    setDraft(prefill.text);
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(prefill.text.length, prefill.text.length);
  }, [prefill, takeComposerPrefill]);

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
    if ((!message && attachments.length === 0) || reading > 0) return;
    const sent = attachments;
    setDraft("");
    setAttachments([]);
    setAttachError(null);
    void sendMessage(
      message,
      sent.map(({ id: _id, ...item }) => item),
    ).then((outcome) => {
      // A refused send (nothing recorded) keeps what the user prepared.
      if (outcome !== "refused") return;
      setDraft((current) => current || message);
      setAttachments((current) => (current.length ? current : sent));
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      className="composer"
      onSubmit={submitMessage}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      <div
        className="composer__box"
        data-state={errorMessage ? "error" : "default"}
        data-dragging={dragging || undefined}
      >
        {attachments.length > 0 && (
          <ul className="composer__attachments" aria-label="붙인 파일">
            {attachments.map((item) => (
              <li className="attachment-chip" key={item.id}>
                {item.kind === "image" ? (
                  <img src={`data:${item.mediaType};base64,${item.data}`} alt="" />
                ) : (
                  <Icon name="file" />
                )}
                <span>{item.name}</span>
                <button
                  type="button"
                  aria-label={`${item.name} 빼기`}
                  onClick={() =>
                    setAttachments((current) => current.filter((other) => other.id !== item.id))
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="sr-only" htmlFor="poko-message">
          포코에게 메시지
        </label>
        <textarea
          ref={inputRef}
          id="poko-message"
          className="composer__input"
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void addFiles(files);
          }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={workspace ? "무엇을 같이 살펴볼까?" : "먼저 작업할 폴더를 골라 줘"}
          rows={1}
          aria-describedby={errorMessage ? "composer-error" : undefined}
          aria-invalid={Boolean(errorMessage)}
        />
        <div className="composer__toolbar">
          <button
            className="chip"
            type="button"
            onClick={() => void selectWorkspace()}
            disabled={isSelectingWorkspace || busy}
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
            disabled={busy}
            title="고른 창을 보고 설명해 줘"
          >
            <Icon name="screen" />
            <span>화면 보기</span>
          </button>
          <DictationButton target={inputRef} />
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
          <EffortSelect />
          <button
            className="send-button"
            type={stopMode ? "button" : "submit"}
            onClick={stopMode ? () => void cancelTask() : undefined}
            disabled={stopMode ? !activeTaskId : !hasContent || reading > 0}
            data-state={stopMode ? "cancel" : "send"}
            aria-label={stopMode ? "작업 멈추기" : "메시지 보내기"}
            title={
              stopMode
                ? "작업 멈추기 (⌘.)"
                : busy
                  ? "보내 두면 지금 작업이 끝난 뒤에 물어볼게. (Enter)"
                  : "보내기 (Enter)"
            }
          >
            <Icon name={stopMode ? "stop" : "send"} />
          </button>
        </div>
      </div>
      {errorMessage && (
        <p id="composer-error" className="composer__error" role="alert">
          {errorMessage}
        </p>
      )}
      {attachError && (
        <p className="composer__error" role="alert">
          {attachError}
        </p>
      )}
      <ScreenPicker question={draft} onPicked={() => setDraft("")} />
    </form>
  );
}

const memoryTypeNames = {
  preference: "취향",
  project: "프로젝트",
  person: "사람",
  decision: "결정",
  fact: "정보",
  routine: "루틴",
} as const;

/** "이걸 기억해 둘까?": a memory the answer suggested, saved only on 기억하기. */
function MemorySuggestionCard() {
  const suggestion = useAppStore((state) => state.memorySuggestion);
  const answer = useAppStore((state) => state.answerMemorySuggestion);
  const error = useAppStore((state) => state.memorySuggestionError);
  const saving = useAppStore((state) => state.savingMemorySuggestion);
  if (!suggestion) return null;
  return (
    <li className="memory-suggestion" aria-label="기억 제안">
      <p className="memory-suggestion__title">이걸 기억해 둘까?</p>
      <p className="memory-suggestion__content">
        <span className="memory-suggestion__type">{memoryTypeNames[suggestion.type]}</span>
        {suggestion.content}
      </p>
      {error && (
        <p className="composer__error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-suggestion__actions">
        <button
          className="secondary-button"
          type="button"
          disabled={saving}
          onClick={() => void answer(false)}
        >
          괜찮아
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={saving}
          onClick={() => void answer(true)}
        >
          {saving ? "저장하는 중" : "기억하기"}
        </button>
      </div>
    </li>
  );
}

/** Under a failed or stopped answer: send the same question again, or change it first. */
/** Questions sent while Poko was busy, waiting in this conversation (or this new one). */
function WaitingRows() {
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const all = useAppStore((state) => state.waitingQuestions);
  const cancel = useAppStore((state) => state.cancelWaitingQuestion);
  const waiting = all.filter((item) => item.conversationId === activeConversationId);
  if (waiting.length === 0) return null;
  return (
    <>
      {waiting.map((item) => (
        <li className="message message--user message--waiting" key={item.taskId}>
          <span className="waiting-chip">대기 중</span>
          <p className="waiting-text">{item.text}</p>
          <button
            className="secondary-button waiting-cancel"
            type="button"
            onClick={() => void cancel(item.taskId)}
            title="이 질문을 보내지 않고 취소해"
          >
            취소
          </button>
        </li>
      ))}
    </>
  );
}

function RetryRow() {
  const retryable = useAppStore(
    (state) =>
      !state.isSending &&
      state.retryable !== null &&
      state.retryable.conversationId === state.activeConversationId,
  );
  const retryLast = useAppStore((state) => state.retryLast);
  const editLastQuestion = useAppStore((state) => state.editLastQuestion);
  if (!retryable) return null;
  return (
    <li className="retry-row">
      <button className="secondary-button" type="button" onClick={() => void retryLast()}>
        <Icon name="repeat" />
        <span>다시 시도</span>
      </button>
      <button className="secondary-button" type="button" onClick={editLastQuestion}>
        <Icon name="pencil" />
        <span>고쳐서 묻기</span>
      </button>
    </li>
  );
}

/** A routine run keeps Poko busy: say which, and offer to stop it and ask now. */
function RoutineBusyBanner() {
  const routine = useAppStore((state) => state.busyRoutine);
  const yieldRoutine = useAppStore((state) => state.yieldRoutine);
  const [stopping, setStopping] = useState(false);
  if (!routine) return null;
  return (
    <div className="foreign-banner" role="status">
      <span>
        🔁 <strong>{routine.title}</strong> 루틴이 실행 중이야. 끝나면 물을 수 있어.
      </span>
      <button
        className="secondary-button"
        type="button"
        disabled={stopping}
        onClick={() => {
          setStopping(true);
          void yieldRoutine().finally(() => setStopping(false));
        }}
      >
        {stopping ? "멈추는 중" : "멈추고 지금 묻기"}
      </button>
    </div>
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

/**
 * Shown when the conversation on screen works in another folder than the one selected: a
 * follow-up there would be refused, so it offers to switch with one click.
 */
function FolderBanner() {
  const folder = useAppStore(
    (state) =>
      state.conversations.find((item) => item.id === state.activeConversationId)?.workspacePath ??
      null,
  );
  const workspace = useAppStore((state) => state.workspace);
  const isSending = useAppStore((state) => state.isSending);
  const gone = useAppStore((state) => state.folderGone === state.activeConversationId);
  const switchToConversationFolder = useAppStore((state) => state.switchToConversationFolder);
  const newConversation = useAppStore((state) => state.newConversation);
  // Shown also when no folder is selected: the switch picks it without the dialog.
  if (!folder || folder === workspace?.realPath) return null;
  const name = folderName(folder);
  if (gone)
    return (
      <div className="foreign-banner" role="status">
        <span>
          이 대화의 <strong>{name}</strong> 폴더를 찾지 못했어. 새 대화에서 물어봐 줘.
        </span>
        <button
          className="secondary-button"
          type="button"
          disabled={isSending}
          onClick={() => void newConversation()}
        >
          새 대화
        </button>
      </div>
    );
  return (
    <div className="foreign-banner" role="status">
      <span>
        이 대화는 <strong>{name}</strong> 폴더에서 나눈 대화야. 이어서 물으려면 폴더를 바꿔 줘.
      </span>
      <button
        className="secondary-button"
        type="button"
        disabled={isSending}
        onClick={() => void switchToConversationFolder()}
      >
        {name}로 바꾸기
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
  // A memory suggestion written at the end of an answer isn't shown while it streams.
  const streamingText = useAppStore((state) => hideMemoryTag(state.streaming?.text ?? ""));
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const isEmpty = messages.length === 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  // An answer being read aloud stops when another conversation or page is shown.
  const conversationId = useAppStore((state) => state.activeConversationId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop on each switch and on unmount
  useEffect(() => () => stopSpeaking(), [conversationId]);

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
          <RoutineBusyBanner />
          <ol className="message-list message-list--waiting" aria-label="기다리는 질문">
            <WaitingRows />
          </ol>
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
                <div className="message__body">
                  <Markdown>{entry.content}</Markdown>
                  <div className="message__actions">
                    <SpeakButton id={entry.id} text={entry.content} />
                    <CopyButton text={entry.content} />
                  </div>
                </div>
              </li>
            );
          })}
          {isSending && streamingText && (
            <li className="message message--assistant message--streaming" aria-busy="true">
              <Character state={characterState} size={26} />
              <Markdown>{streamingText}</Markdown>
            </li>
          )}
          <RetryRow />
          <ApprovalCard />
          <MemorySuggestionCard />
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
          <WaitingRows />
        </ol>
        <div ref={endRef} />
      </div>
      <div className="chat-panel__composer">
        <ForeignBanner />
        <RoutineBusyBanner />
        <FolderBanner />
        <Composer autoFocus={false} />
      </div>
    </section>
  );
}
