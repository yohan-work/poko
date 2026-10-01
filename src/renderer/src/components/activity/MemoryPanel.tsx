import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PersistedMemory } from "../../../../../electron/shared";
import type { MemoryInput } from "../../../../../electron/shared";
import { useAppStore } from "../../state/appStore";
import { relativeTime } from "../../lib/time";
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
          if (event.key === "Escape") onClose();
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

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemories(query), query ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [query, loadMemories]);

  return (
    <Page labelledBy="memory-title">
      <PageHeader
        id="memory-title"
        title="기억"
        description="직접 저장한 내용만 기억해. 이 컴퓨터에만 보관돼."
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

      {memories.length === 0 ? (
        <EmptyState>
          {query ? "검색과 맞는 기억이 없어." : "아직 저장된 기억이 없어. 새 기억을 추가해 볼까?"}
        </EmptyState>
      ) : (
        <ul className="card-grid" aria-label="저장된 기억">
          {memories.map((memory) => (
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

/** Rough check for text that the 4-line clamp would hide. */
function isLong(content: string): boolean {
  return content.length > 120 || content.split("\n").length > 4;
}

function MemoryCard({ memory, onDelete }: { memory: PersistedMemory; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="memory-card">
      <span className="memory-card__type">
        {memoryTypes.find((item) => item.value === memory.type)?.label}
      </span>
      <div>
        <p className={`memory-card__content${expanded ? " is-expanded" : ""}`}>{memory.content}</p>
        {isLong(memory.content) && (
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
      <div className="memory-card__footer">
        <time dateTime={memory.updatedAt}>{relativeTime(memory.updatedAt)}</time>
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
