import { useAppStore } from "../../state/appStore";

export function ActivityPanel() {
  const activities = useAppStore((state) => state.activities);

  return (
    <section className="session-panel" aria-labelledby="activity-title">
      <p className="future-view__eyebrow">함께한 순간</p>
      <h1 id="activity-title">포코의 활동</h1>
      <p className="session-panel__description">포코가 작업한 과정의 기록이야.</p>
      {activities.length === 0 ? (
        <p className="session-panel__empty">아직 기록이 없어. 프로젝트를 하나 살펴볼까?</p>
      ) : (
        <ol className="activity-list" aria-label="이번 실행의 활동 기록">
          {activities.map((entry) => (
            <li className="activity-list__item" key={entry.id}>
              <span className="activity-list__dot" aria-hidden="true" />
              <span className="activity-list__message">{entry.message}</span>
              <time className="activity-list__time" dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="session-panel__footnote">활동 기록은 이 컴퓨터에 저장돼.</p>
    </section>
  );
}
