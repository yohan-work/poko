import { useEffect, useState, type FormEvent } from "react";
import type { MemoryInput } from "../../../../../electron/shared";
import { useAppStore } from "../../state/appStore";

const memoryTypes: { value: MemoryInput["type"]; label: string }[] = [
  { value: "preference", label: "취향" },
  { value: "project", label: "프로젝트" },
  { value: "person", label: "사람" },
  { value: "decision", label: "결정" },
  { value: "fact", label: "정보" },
  { value: "routine", label: "루틴" },
];

export function MemoryPanel() {
  const memories = useAppStore((state) => state.memories);
  const memoryError = useAppStore((state) => state.memoryError);
  const loadMemories = useAppStore((state) => state.loadMemories);
  const saveMemory = useAppStore((state) => state.saveMemory);
  const deleteMemory = useAppStore((state) => state.deleteMemory);
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryInput["type"]>("preference");

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemories(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, loadMemories]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    await saveMemory({ type, content, importance: 3 });
    setContent("");
  }

  return (
    <section className="session-panel memory-panel" aria-labelledby="memory-title">
      <p className="session-panel__eyebrow">포코가 기억할 내용</p>
      <h1 id="memory-title">우리의 기억</h1>
      <p className="session-panel__description">직접 저장한 내용은 이 컴퓨터에만 보관돼.</p>
      <form className="memory-form" onSubmit={(event) => void submit(event)}>
        <label className="memory-form__label" htmlFor="memory-content">
          새 기억
        </label>
        <textarea
          id="memory-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={4000}
          placeholder="예: 답변은 편안하고 간결하게 해줘."
          required
        />
        <div className="memory-form__row">
          <select
            aria-label="기억 종류"
            value={type}
            onChange={(event) => setType(event.target.value as MemoryInput["type"])}
          >
            {memoryTypes.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button className="primary-button" type="submit" disabled={!content.trim()}>
            기억하기
          </button>
        </div>
      </form>
      <label className="memory-search">
        <span className="sr-only">기억 검색</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="기억 검색"
        />
      </label>
      {memoryError && (
        <p className="memory-error" role="alert">
          {memoryError}
        </p>
      )}
      {memories.length === 0 ? (
        <p className="session-panel__empty">아직 저장된 기억이 없어.</p>
      ) : (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li className="memory-list__item" key={memory.id}>
              <span className="memory-list__type">
                {memoryTypes.find((item) => item.value === memory.type)?.label}
              </span>
              <p>{memory.content}</p>
              <button
                className="memory-list__delete"
                type="button"
                onClick={() => void deleteMemory(memory.id)}
                aria-label="기억 삭제"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
