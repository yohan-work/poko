import { useAppStore } from "../../state/appStore";

const statusLabel = {
  running: "살펴보는 중",
  completed: "완료",
  failed: "멈춤",
  cancelled: "취소됨",
} as const;

export function TasksPanel() {
  const tasks = useAppStore((state) => state.tasks);

  return (
    <section className="session-panel" aria-labelledby="tasks-title">
      <p className="future-view__eyebrow">우리의 프로젝트</p>
      <h1 id="tasks-title">함께한 작업</h1>
      <p className="session-panel__description">이번 실행에서 포코에게 부탁한 일이야.</p>
      {tasks.length === 0 ? (
        <p className="session-panel__empty">아직 작업이 없어. 프로젝트를 골라 말을 걸어 줘.</p>
      ) : (
        <ol className="task-list" aria-label="이번 실행의 작업 목록">
          {tasks.map((task) => (
            <li className="task-list__item" key={task.id}>
              <span className={`task-list__status task-list__status--${task.status}`}>
                {statusLabel[task.status]}
              </span>
              <span className="task-list__title">{task.title}</span>
              <time className="task-list__time" dateTime={task.createdAt}>
                {new Date(task.createdAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="session-panel__footnote">작업 기록은 앱을 닫으면 사라져.</p>
    </section>
  );
}
