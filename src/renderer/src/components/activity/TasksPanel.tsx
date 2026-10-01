import { useMemo, useState } from "react";
import { useAppStore, type SessionTask } from "../../state/appStore";
import { relativeTime } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { EmptyState, Page, PageHeader, SearchField } from "../page/Page";

const statusLabel: Record<SessionTask["status"], string> = {
  running: "살펴보는 중",
  waiting_approval: "확인 기다리는 중",
  completed: "완료",
  failed: "멈춤",
  cancelled: "취소됨",
};

const filters = [
  { id: "all", label: "전체" },
  { id: "active", label: "진행 중" },
  { id: "completed", label: "완료" },
  { id: "stopped", label: "멈춤" },
] as const;

type Filter = (typeof filters)[number]["id"];

function matchesFilter(task: SessionTask, filter: Filter): boolean {
  if (filter === "active") return task.status === "running" || task.status === "waiting_approval";
  if (filter === "completed") return task.status === "completed";
  if (filter === "stopped") return task.status === "failed" || task.status === "cancelled";
  return true;
}

export function TasksPanel() {
  const tasks = useAppStore((state) => state.tasks);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter(
      (task) => matchesFilter(task, filter) && task.title.toLowerCase().includes(needle),
    );
  }, [tasks, query, filter]);

  return (
    <Page labelledBy="tasks-title">
      <PageHeader
        id="tasks-title"
        title="작업"
        description="포코에게 맡긴 요청과 결과야. 이 컴퓨터에만 저장돼."
      />
      <SearchField value={query} onChange={setQuery} placeholder="작업 검색" />
      <div className="page-toolbar">
        <fieldset className="segmented">
          <legend className="sr-only">작업 상태 필터</legend>
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`segmented__item${filter === item.id ? " is-active" : ""}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <span className="page-toolbar__count">{visible.length}개의 작업</span>
      </div>

      {tasks.length === 0 ? (
        <EmptyState>아직 작업이 없어. 대화에서 프로젝트에 대해 물어봐 줘.</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>조건에 맞는 작업이 없어.</EmptyState>
      ) : (
        <ul className="row-list" aria-label="작업 목록">
          {visible.map((task) => (
            <li className="row-list__item" key={task.id}>
              <span className="row-list__title" title={task.title}>
                {task.title}
              </span>
              <span className="row-list__meta">
                <span className={`status-badge status-badge--${task.status}`}>
                  {statusLabel[task.status]}
                </span>
                <time dateTime={task.createdAt}>{relativeTime(task.createdAt, now)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
