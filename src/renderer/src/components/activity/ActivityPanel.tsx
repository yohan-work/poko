import { useMemo, useState } from "react";
import { useAppStore, type ActivityEntry } from "../../state/appStore";
import { clockTime, dayKey, dayLabel } from "../../lib/time";
import { EmptyState, Page, PageHeader, SearchField } from "../page/Page";

export function ActivityPanel() {
  const activities = useAppStore((state) => state.activities);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // The store keeps entries oldest first; reversing keeps same-millisecond steps in order.
    const sorted = activities
      .filter((entry) =>
        `${entry.message}\n${entry.taskTitle ?? ""}`.toLowerCase().includes(needle),
      )
      .reverse();
    // Group by calendar day, not by label, so equal labels from different years stay apart.
    const byDay = new Map<string, { label: string; entries: ActivityEntry[] }>();
    for (const entry of sorted) {
      const key = dayKey(entry.createdAt);
      const group = byDay.get(key) ?? { label: dayLabel(entry.createdAt), entries: [] };
      group.entries.push(entry);
      byDay.set(key, group);
    }
    return [...byDay.entries()];
  }, [activities, query]);

  return (
    <Page labelledBy="activity-title">
      <PageHeader
        id="activity-title"
        title="활동"
        description="포코가 작업하면서 거친 과정이야. 무엇을 확인하고 무엇을 허락받았는지 볼 수 있어."
      />
      <SearchField value={query} onChange={setQuery} placeholder="활동 검색" />

      {activities.length === 0 ? (
        <EmptyState>아직 기록이 없어. 프로젝트를 하나 살펴볼까?</EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>검색과 맞는 기록이 없어.</EmptyState>
      ) : (
        groups.map(([key, { label, entries }]) => (
          <section className="timeline" key={key} aria-label={label}>
            <h2 className="timeline__day">{label}</h2>
            <ol className="timeline__list">
              {entries.map((entry) => (
                <li className="timeline__item" key={entry.id}>
                  <time className="timeline__time" dateTime={entry.createdAt}>
                    {clockTime(entry.createdAt)}
                  </time>
                  <span className="timeline__dot" aria-hidden="true" />
                  <span className="timeline__body">
                    <span className="timeline__message">{entry.message}</span>
                    {entry.taskTitle && (
                      <span className="timeline__task" title={entry.taskTitle}>
                        {entry.taskTitle}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </Page>
  );
}
