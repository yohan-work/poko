import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PersistedMemory } from "../../../../../electron/shared";
import { FOLDER_MEMORY_TYPES, type MemoryInput } from "../../../../../electron/shared";
import { folderName } from "../../lib/folder";
import { relativeTime } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { useAppStore } from "../../state/appStore";
import { Icon } from "../Icon";
import { EmptyState, Page, PageHeader, SearchField } from "../page/Page";

const memoryTypes: { value: MemoryInput["type"]; label: string }[] = [
  { value: "preference", label: "취향" },
  { value: "project", label: "프로젝트" },
  { value: "person", label: "사람" },
  { value: "decision", label: "결정" },
  { value: "fact", label: "정보" },
  { value: "routine", label: "루틴" },
];

function NewMemoryForm({ onClose }: { onClose: () => void }) {
  const saveMemory = useAppStore((state) => state.saveMemory);
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryInput["type"]>("preference");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    // Keep the draft open when saving fails so nothing the user typed is lost.
    if (await saveMemory({ type, content, importance: 3 })) onClose();
  }

  return (
    <form className="memory-form" onSubmit={(event) => void submit(event)}>
      <label className="sr-only" htmlFor="memory-content">
        새 기억
      </label>
      <textarea
        ref={inputRef}
        id="memory-content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={(event) => {
          // Escape cancels an IME composition first, and never discards a draft.
          if (event.key === "Escape" && !event.nativeEvent.isComposing && !content.trim()) {
            onClose();
          }
        }}
        maxLength={4000}
        rows={3}
        placeholder="포코가 기억했으면 하는 걸 적어 줘. 예: 답변은 편안하고 간결하게 해줘."
        required
      />
      <div className="memory-form__row">
        <fieldset className="segmented">
          <legend className="sr-only">기억 종류</legend>
          {memoryTypes.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={type === item.value}
              className={`segmented__item${type === item.value ? " is-active" : ""}`}
              onClick={() => setType(item.value)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <div className="memory-form__actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary-button" type="submit" disabled={!content.trim()}>
            기억하기
          </button>
        </div>
      </div>
    </form>
  );
}

export function MemoryPanel() {
  const memories = useAppStore((state) => state.memories);
  const memoryError = useAppStore((state) => state.memoryError);
  const loadMemories = useAppStore((state) => state.loadMemories);
  const deleteMemory = useAppStore((state) => state.deleteMemory);
  const [query, setQuery] = useState("");
  const [isAdding, setAdding] = useState(false);
  const workspace = useAppStore((state) => state.workspace);
  // "이 폴더": the memories tasks in the selected folder get (shared ones and its own).
  const [onlyHere, setOnlyHere] = useState(false);
  // The filter applies only while it can be seen and changed.
  const filtering = onlyHere && Boolean(workspace?.realPath);
  const shown = filtering
    ? memories.filter(
        (memory) => !memory.workspacePath || memory.workspacePath === workspace?.realPath,
      )
    : memories;

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemories(query), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, loadMemories]);

  return (
    <Page labelledBy="memory-title">
      <PageHeader
        id="memory-title"
        title="기억"
        description="직접 저장하거나 '기억하기'로 고른 내용만 기억해. 이 컴퓨터에 보관되고, 요청할 때 엔진에 함께 전달돼. 프로젝트와 결정 기억은 저장한 폴더의 작업에만 전달돼."
        action={
          !isAdding && (
            <button className="primary-button" type="button" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              <span>새 기억</span>
            </button>
          )
        }
      />
      {isAdding && <NewMemoryForm onClose={() => setAdding(false)} />}
      <SearchField value={query} onChange={setQuery} placeholder="기억 검색" />
      {memoryError && (
        <p className="page-error" role="alert">
          {memoryError}
        </p>
      )}

      {workspace?.realPath && (
        <fieldset className="segmented memory-scope">
          <legend className="sr-only">보여 줄 기억</legend>
          {(
            [
              [false, "모두"],
              [true, `${workspace.name} 폴더에 쓰이는 것`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={onlyHere === value}
              className={`segmented__item${onlyHere === value ? " is-active" : ""}`}
              onClick={() => setOnlyHere(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}
      {shown.length === 0 ? (
        <EmptyState>
          {query
            ? "검색과 맞는 기억이 없어."
            : filtering && memories.length > 0
              ? "이 폴더에 쓰이는 기억이 없어. 다른 폴더의 기억은 '모두'에서 볼 수 있어."
              : "아직 저장된 기억이 없어. 새 기억을 추가해 볼까?"}
        </EmptyState>
      ) : (
        <ul className="card-grid" aria-label="저장된 기억">
          {shown.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onDelete={() => void deleteMemory(memory.id)}
            />
          ))}
        </ul>
      )}
    </Page>
  );
}

/** Changes what a memory says, in place; Escape or 취소 keeps it as it was. */
function MemoryEditor({ memory, onDone }: { memory: PersistedMemory; onDone: () => void }) {
  // Closing waits for a save in progress, so its result (or error) is never lost.
  const updateMemory = useAppStore((state) => state.updateMemory);
  const [content, setContent] = useState(memory.content);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = content.trim() && content.trim() !== memory.content;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    const failed = await updateMemory(memory.id, content);
    setSaving(false);
    if (failed) setError(failed);
    else onDone();
  }

  return (
    <form className="memory-form memory-card__editor" onSubmit={(event) => void submit(event)}>
      <label className="sr-only" htmlFor={`memory-edit-${memory.id}`}>
        기억 고치기
      </label>
      <textarea
        id={`memory-edit-${memory.id}`}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) onDone();
        }}
        maxLength={4000}
        rows={3}
        // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this memory
        autoFocus
      />
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      <div className="memory-form__actions">
        <button className="secondary-button" type="button" onClick={onDone} disabled={saving}>
          취소
        </button>
        <button className="primary-button" type="submit" disabled={!changed || saving}>
          저장
        </button>
      </div>
    </form>
  );
}

function MemoryCard({ memory, onDelete }: { memory: PersistedMemory; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const now = useNow();
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLParagraphElement>(null);

  // Measure the clamped text so the toggle appears whenever lines are actually hidden; the
  // text is a new element after editing, so it is measured again then too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure after edits
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, editing, memory.content]);

  return (
    <li className="memory-card">
      <span className="memory-card__type">
        {memoryTypes.find((item) => item.value === memory.type)?.label}
        {memory.workspacePath ? (
          <span className="memory-card__folder" title={memory.workspacePath}>
            {" · "}
            {folderName(memory.workspacePath)} 폴더
          </span>
        ) : FOLDER_MEMORY_TYPES.includes(memory.type) ? (
          <span
            className="memory-card__folder"
            title="어느 폴더에도 묶이지 않은 기억이야. 모든 작업에 전달돼."
          >
            {" · "}모든 폴더
          </span>
        ) : null}
      </span>
      {editing ? (
        <MemoryEditor
          memory={memory}
          onDone={() => {
            setEditing(false);
            // Back where the user started, not the top of the page.
            window.setTimeout(() => editButton.current?.focus(), 0);
          }}
        />
      ) : (
        <div>
          <p ref={contentRef} className={`memory-card__content${expanded ? " is-expanded" : ""}`}>
            {memory.content}
          </p>
          {(overflows || expanded) && (
            <button
              className="memory-card__more"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "접기" : "더 보기"}
            </button>
          )}
        </div>
      )}
      <div className="memory-card__footer">
        <time dateTime={memory.updatedAt}>{relativeTime(memory.updatedAt, now)}</time>
        <button
          ref={editButton}
          className="icon-button memory-card__edit"
          type="button"
          onClick={() => setEditing(true)}
          disabled={editing}
          aria-label="기억 고치기"
          title="기억 고치기"
        >
          <Icon name="pencil" />
        </button>
        <button
          className="icon-button memory-card__delete"
          type="button"
          onClick={onDelete}
          aria-label="기억 삭제"
          title="기억 삭제"
        >
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}
